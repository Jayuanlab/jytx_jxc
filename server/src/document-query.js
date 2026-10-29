'use strict';
const c=require('./common'),origins=require('./inventory-details'),salesList=require('./sales-list');
const norm=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
function filters(query){
 const text=name=>String(query.get(name)||'').trim();const from=text('from'),to=text('to'),q=text('q'),supplier=text('supplier'),productName=text('productName');
 for(const value of [q,supplier,productName])if(value.length>160||/[\x00-\x1f\x7f]/.test(value))throw new c.HttpError(400,'查询条件过长或含控制字符');
 for(const date of [from,to])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))throw new c.HttpError(400,'请选择真实有效的开始和结束日期');
 if(from&&to&&from>to)throw new c.HttpError(400,'开始日期不能晚于结束日期');
 return {from,to,q,supplier,productName,start:from?Date.parse(from+'T00:00:00+08:00'):null,end:to?Date.parse(to+'T00:00:00+08:00')+86400000:null};
}
function inDate(row,f){if(f.start===null&&f.end===null)return true;const at=Date.parse(row.createdAt);return Number.isFinite(at)&&(f.start===null||at>=f.start)&&(f.end===null||at<f.end);}
function productMatches(item,term,product){if(!term)return true;const values=norm([item.name,item.externalCode,product?.name,product?.shortName,...(product?.aliases||[])].join(' '));return norm(term).split(/\s+/).filter(Boolean).every(word=>values.includes(word));}
function supplierMatches(source,term,store){if(!term)return true;if(term==='__unknown__')return !source?.supplierId&&!source?.supplier;const current=(store.suppliers||[]).find(row=>row.id===source?.supplierId);return norm(source?.supplierId)===norm(term)||norm([source?.supplier,current?.name].filter(Boolean).join(' ')).includes(norm(term));}
function purchaseItemSources(order,item){return [{supplierId:order.supplierId,supplier:order.supplier}];}
function sourceReaches(store,skuId,originSkuId,sourceId,seen=new Set()){
 if(skuId===originSkuId)return true;if(seen.has(skuId))return false;const next=new Set(seen);next.add(skuId);
 return (store.stockTransfers||[]).some(row=>row.status==='completed'&&row.targetSkuId===skuId&&(row.sourceCostSources||[]).some(part=>part.sourceId===sourceId&&Number(part.quantity)>0)&&sourceReaches(store,row.sourceSkuId,originSkuId,sourceId,next));
}
function saleItemSources(store,refs,order,item){
 if(item.serialNo||item.stockManaged===false||item.supplySources?.length||!item.costSources?.length)return salesList.lineSources(store,refs,order,item);
 return item.costSources.filter(part=>Number(part.quantity)>0).map(part=>{
  const purchase=refs.items.get(part.sourceId);let source=purchase&&sourceReaches(store,item.skuId,purchase.item.skuId,part.sourceId)?purchase.order:null;
  if(!source){const matches=(store.openingImportBatches||[]).filter(batch=>batch.kind==='opening_quantity_append').flatMap(batch=>(batch.products||[]).filter(row=>row.sourceId===part.sourceId&&sourceReaches(store,item.skuId,row.skuId,part.sourceId)));if(matches.length===1)source=matches[0];}
  const supplier=(store.suppliers||[]).find(row=>row.id===source?.supplierId);return {supplierId:source?.supplierId||'',supplier:supplier?.name||source?.supplier||'',quantity:Number(part.quantity)};
 });
}
function itemMatches(store,order,item,f,refs,kind){
 if(!productMatches(item,f.productName,(store.products||[]).find(p=>p.skuId===item.skuId)))return false;
 if(!f.supplier)return true;
 const sources=kind==='sale'?saleItemSources(store,refs,order,item):purchaseItemSources(order,item);
 return sources.some(source=>supplierMatches(source,f.supplier,store));
}
function textMatches(row,q){if(!q)return true;const items=[...(row.items||[]),...(row.giftOrders||[]).flatMap(g=>g.items||[])],values=[row.id,row.displayNo,row.number,row.supplier,row.operator,row.salesperson,row.reference,...items.flatMap(item=>[item.name,item.externalCode,item.serialNo,...(item.serials||[]),...(item.serialSources||[]).flatMap(s=>[s.serialNo,s.supplier])]),...(row.supplierAllocations||[]).flatMap(s=>[s.supplier,...(s.serialNos||[])])];return norm(values.join(' ')).includes(norm(q));}
function prepared(store,query){return filters(require('./document-numbers').queryParams(store,query));}
function canReadPurchase(user,order){return c.capabilities(user).supplierView||order.operatorId===user.id||order.receiverId===user.id;}
function purchaseRows(store,user,query){const f=prepared(store,query);return require('./suppliers').purchaseRows(store,user).filter(order=>canReadPurchase(user,order)&&inDate(order,f)&&textMatches(order,f.q)&&(!f.productName&&!f.supplier||(order.items||[]).some(item=>itemMatches(store,order,item,f,null,'purchase'))));}
function planRows(store,user,query){const f=prepared(store,query);return require('./suppliers').planRows(store,user).filter(order=>canReadPurchase(user,order)&&inDate(order,f)&&textMatches(order,f.q)&&(!f.productName&&!f.supplier||(order.items||[]).some(item=>itemMatches(store,order,item,f,null,'purchase'))));}
function salesRows(store,user,query){const f=prepared(store,query),refs=origins.index(store),raw=new Map(store.sales.map(order=>[order.id,order]));return require('./erp').orders(store,user,f.q).filter(visible=>{const order=raw.get(visible.id);return inDate(order,f)&&(!f.productName&&!f.supplier||[...(order.items||[]),...(order.giftOrders||[]).flatMap(g=>g.items||[])].some(item=>itemMatches(store,order,item,f,refs,'sale')));});}
function page(rows,query){
 const limit=Number(query.get('limit')||40);if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new c.HttpError(400,'每页数量须为1至100');let cursor=null;
 if(query.get('cursor'))try{cursor=JSON.parse(Buffer.from(query.get('cursor'),'base64url').toString('utf8'));if(!Array.isArray(cursor)||cursor.length!==2||!cursor.every(v=>typeof v==='string')||!Number.isFinite(Date.parse(cursor[0]))||cursor[1].length>160)throw Error();}catch{throw new c.HttpError(400,'分页位置不正确，请重新查询');}
 const sorted=rows.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||String(b.id).localeCompare(String(a.id))),after=cursor?sorted.filter(row=>row.createdAt<cursor[0]||row.createdAt===cursor[0]&&row.id<cursor[1]):sorted,selected=after.slice(0,limit),last=selected.at(-1);
 return {rows:selected,nextCursor:after.length>limit?Buffer.from(JSON.stringify([last.createdAt,last.id])).toString('base64url'):null,limit};
}
function salesPage(store,user,query){return page(salesRows(store,user,query),query);}
module.exports={filters,inDate,productMatches,supplierMatches,purchaseItemSources,saleItemSources,canReadPurchase,itemMatches,textMatches,purchaseRows,planRows,salesRows,salesPage,page};
