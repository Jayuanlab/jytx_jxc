'use strict';
const c=require('./common'),warehouses=require('./warehouses'),origins=require('./inventory-details');
const UNKNOWN='__unknown__',SERVICE='__service__';
function filters(query){
 const text=key=>String(query.get(key)||'').trim().slice(0,160);
 const from=text('from'),to=text('to');
 const parse=value=>{
  if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value))throw new c.HttpError(400,'请选择正确的日期和时间');
  const [date,time='00:00']=value.split('T');
  if(!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new c.HttpError(400,'日期或时间不正确');
  return Date.parse(date+'T'+time+':00+08:00');
 };
 let start=from?parse(from):null,end=to?parse(to)+(to.includes('T')?60000:86400000):null;
 if(start!=null&&end!=null&&start>=end)throw new c.HttpError(400,'开始时间不能晚于结束时间');
 const page=Number(query.get('page')||1),limit=Number(query.get('limit')||30);
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new c.HttpError(400,'分页参数不正确');
 return {from,to,start,end,page,limit,q:text('q').toLowerCase(),warehouse:text('warehouse'),salesperson:text('salesperson'),product:text('product'),supplier:text('supplier')};
}
function sourceKey(s){return s.supplierId||(s.supplier?'name:'+s.supplier:UNKNOWN);}
function source(store,order,quantity){const supplier=(store.suppliers||[]).find(s=>s.id===order?.supplierId);return {purchaseId:order?.id||'',supplierId:order?.supplierId||'',supplier:order?.supplier||supplier?.name||'',quantity};}
function lineSources(store,refs,order,item){
 if(item.stockManaged===false)return [{supplierId:SERVICE,supplier:'服务项目',quantity:Number(item.quantity)}];
 if(item.supplySources?.length)return item.supplySources;
 if(item.serialNo){
  const matches=(refs.serials.get(JSON.stringify([item.skuId,item.serialNo]))||[])
   .filter(x=>(!x.item.warehouseId||!item.warehouseId||x.item.warehouseId===item.warehouseId)&&Date.parse(x.order.createdAt)<=Date.parse(order.createdAt));
  const selected=item.purchaseId?matches.filter(x=>x.order.id===item.purchaseId):matches;
  // Duplicate origin records are not guessed: keep them visibly unassigned.
  return [source(store,selected.length===1?selected[0].order:null,Number(item.quantity))];
 }
 return (item.costSources?.length?item.costSources:[{quantity:Number(item.quantity)}]).map(s=>{
  const ref=refs.items.get(s.sourceId);return source(store,ref?.item.skuId===item.skuId?ref.order:null,Number(s.quantity||0));
 });
}
function allocations(store,refs,order,item){
 const groups=new Map(),qty=Number(item.quantity||0);
 for(const s of lineSources(store,refs,order,item)){
  if(!(s.quantity>0))continue;const id=sourceKey(s);
  const group=groups.get(id)||{id,name:s.supplier||(id===SERVICE?'服务项目':'来源待补'),quantity:0,purchases:[]};
  group.quantity+=Number(s.quantity);if(s.purchaseId&&!group.purchases.includes(s.purchaseId))group.purchases.push(s.purchaseId);groups.set(id,group);
 }
 let rows=[...groups.values()],total=rows.reduce((n,s)=>n+s.quantity,0);
 if(!total)return [{id:UNKNOWN,name:'来源待补',quantity:qty,purchases:[],weight:1}];
 if(total<qty-1e-6){rows.push({id:UNKNOWN,name:'来源待补',quantity:qty-total,purchases:[]});total=qty;}
 return rows.map(s=>({...s,quantity:s.quantity/total*qty,weight:s.quantity/total}));
}
function shares(rows,totals){
 let netLeft=Math.round(totals.netAmount*100),returnedLeft=Math.round(totals.returnedAmount*100),profitLeft=totals.netProfit==null?null:Math.round(totals.netProfit*100);
 return rows.map((s,index)=>{
  const last=index===rows.length-1,net=last?netLeft:Math.round(totals.netAmount*100*s.weight),ret=last?returnedLeft:Math.round(totals.returnedAmount*100*s.weight);
  netLeft-=net;returnedLeft-=ret;
  const profit=profitLeft===null?null:last?profitLeft:Math.round(totals.netProfit*100*s.weight);if(profitLeft!==null)profitLeft-=profit;
  return {...s,quantity:totals.quantity*s.weight,returnedQuantity:totals.returnedQuantity*s.weight,netQuantity:totals.netQuantity*s.weight,netAmount:net/100,returnedAmount:ret/100,grossAmount:(net+ret)/100,...('netProfit' in totals?{netProfit:profit===null?null:profit/100}:{})};
 });
}
function options(store,user,orders,rows){
 const pairs=(catalog,historical)=>[...new Map([...catalog,...historical].map(x=>[x.id,{id:x.id,name:x.name}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const caps=c.capabilities(user);
 const people=(store.users||[]).filter(u=>!u.assistantCustomerOnly&&u.roleCode!=='customer-assistant'&&(caps.allSales||u.id===user.id)).map(u=>({id:u.id,name:u.name}));
 return {
  warehouses:pairs(warehouses.WAREHOUSES||warehouses.list(),rows.map(r=>({id:r.warehouseId||SERVICE,name:r.warehouseName}))),
  salespeople:pairs(people,orders.map(o=>({id:o.salespersonId||o.operatorId,name:o.salesperson||o.operator||'未记录营业员'}))),
  products:pairs((store.products||[]).map(p=>({id:p.skuId,name:p.name})),rows.map(r=>({id:r.skuId,name:r.name}))),
  suppliers:pairs((store.suppliers||[]).map(s=>({id:s.id,name:s.name})),rows.flatMap(r=>r.suppliers))
 };
}
function profits(store,order){
 const items=order.items||[],total=items.reduce((n,i)=>n+Math.max(0,Number(i.amount??Number(i.quantity||0)*Number(i.salePrice||0))),0);
 const gift=Math.round(Number(order.giftCost||0)*100);let cumulative=0,allocated=0;
 const valid=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
 return items.map((i,index)=>{
  const quantity=Number(i.quantity||0),returned=Math.min(quantity,Math.max(0,Number(i.returnedQuantity||0))),gross=c.round(Number(i.amount??quantity*Number(i.salePrice||0)));
  cumulative+=Math.max(0,gross);
  const giftCents=index===items.length-1?gift:Math.round(gift*(total?cumulative/total:(index+1)/items.length)),giftPart=(giftCents-allocated)/100;allocated=giftCents;
  if(order.redReversedBy)return 0;
  const cost=valid(i.cost)?Number(i.cost):valid(i.costPrice)?Number(i.costPrice)*quantity:valid(i.profit)?gross-Number(i.profit):null;
  if(cost===null||cost<0)return null;
  const adjustment=(store.costAdjustments||[]).filter(a=>a.orderId===order.id&&a.itemId===i.id).reduce((n,a)=>n+Number(a.costDelta||0),0);
  const retainedCost=c.round(cost-(i.stockManaged!==false&&quantity?c.round(cost*returned/quantity):0)+adjustment);
  const netAmount=c.round(gross-c.round(gross*(quantity?returned/quantity:0)));
  return c.round(netAmount-retainedCost-giftPart);
 });
}

function report(store,user,f){
 const caps=c.capabilities(user);
 if(!caps.allSales&&f.salesperson&&f.salesperson!==user.id)throw new c.HttpError(403,'只能查询本人销售清单');
 const refs=origins.index(store),orders=(store.sales||[]).filter(o=>{
  const at=Date.parse(o.createdAt);return Number.isFinite(at)&&(caps.allSales||(o.salespersonId||o.operatorId)===user.id)&&(f.start==null||at>=f.start)&&(f.end==null||at<f.end);
 }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 const rows=orders.flatMap(o=>{const margins=caps.profit?profits(store,o):[];return (o.items||[]).map((i,index)=>{
  const quantity=Number(i.quantity||0),returnedQuantity=Math.min(quantity,Math.max(0,Number(i.returnedQuantity||0)));
  const grossAmount=c.round(Number(i.amount??quantity*Number(i.salePrice||0))),returnedAmount=o.redReversedBy?grossAmount:c.round(grossAmount*(quantity?returnedQuantity/quantity:0));
  const suppliers=shares(allocations(store,refs,o,i),{quantity,returnedQuantity:o.redReversedBy?quantity:returnedQuantity,netQuantity:o.redReversedBy?0:quantity-returnedQuantity,grossAmount,returnedAmount,netAmount:c.round(grossAmount-returnedAmount),...(caps.profit?{netProfit:margins[index]}:{})});
  return {id:i.id||o.id+'/'+index,orderId:o.id,createdAt:o.createdAt,skuId:i.skuId,name:i.name,externalCode:i.externalCode||'',serialNo:i.serialNo||'',warehouseId:i.warehouseId||'',warehouseName:i.warehouseName||(i.stockManaged===false?'服务项目':warehouses.byId(i.warehouseId)?.name||'未记录仓库'),salespersonId:o.salespersonId||o.operatorId,salesperson:o.salesperson||o.operator||'未记录营业员',customerName:o.customerName||'散客',customerMask:o.customerMask||'',salePrice:Number(i.salePrice||0),quantity,returnedQuantity:o.redReversedBy?quantity:returnedQuantity,netQuantity:o.redReversedBy?0:quantity-returnedQuantity,grossAmount,returnedAmount,netAmount:c.round(grossAmount-returnedAmount),status:o.redReversedBy?'已红冲':returnedQuantity>=quantity?'已退货':returnedQuantity>0?'部分退货':'已销售',paymentStatus:o.paymentReview?.status||'历史收款记录',suppliers,allocation:false,...(caps.profit?{netProfit:margins[index]}:{})};
 });});
 const allOptions=options(store,user,orders,rows),filtered=[];
 for(const r of rows){
  if(f.warehouse&&(r.warehouseId||SERVICE)!==f.warehouse||f.salesperson&&r.salespersonId!==f.salesperson||f.product&&r.skuId!==f.product||f.productIds&&!f.productIds.has(r.skuId))continue;
  if(f.q&&!([r.orderId,r.name,r.externalCode,r.serialNo,r.salesperson,r.customerName,r.customerMask,...r.suppliers.map(s=>s.name)].join(' ').toLowerCase().includes(f.q)))continue;
  const chosen=f.supplier?r.suppliers.filter(s=>s.id===f.supplier):f.supplierIds?r.suppliers.filter(s=>f.supplierIds.has(s.id)):r.suppliers;
  if(!chosen.length)continue;
  const weight=chosen.reduce((n,s)=>n+s.weight,0),row={...r,suppliers:chosen,allocation:weight<1-1e-9||r.suppliers.length>1};
  for(const key of ['quantity','returnedQuantity','netQuantity'])row[key]=Number(chosen.reduce((n,s)=>n+s[key],0).toFixed(6));
  for(const key of ['grossAmount','returnedAmount','netAmount'])row[key]=c.round(chosen.reduce((n,s)=>n+s[key],0));
  if(caps.profit)row.netProfit=r.netProfit===null?null:c.round(chosen.reduce((n,s)=>n+s.netProfit,0));
  filtered.push(row);
 }
 const groups=new Map(),totals={orderCount:new Set(filtered.map(r=>r.orderId)).size,lineCount:filtered.length,quantity:0,returnedQuantity:0,netQuantity:0,grossAmount:0,returnedAmount:0,netAmount:0};
 for(const r of filtered){
  for(const key of ['quantity','returnedQuantity','netQuantity','grossAmount','returnedAmount','netAmount'])totals[key]+=r[key];
  r.suppliers.forEach(s=>{
   const g=groups.get(s.id)||{id:s.id,name:s.name,quantity:0,returnedQuantity:0,netQuantity:0,grossAmount:0,returnedAmount:0,netAmount:0,orderIds:new Set(),allocated:false};
   for(const key of ['quantity','returnedQuantity','netQuantity','grossAmount','returnedAmount','netAmount'])g[key]+=s[key];
   g.orderIds.add(r.orderId);g.allocated||=r.allocation;groups.set(s.id,g);
  });
 }
 for(const key of ['quantity','returnedQuantity','netQuantity'])totals[key]=Number(totals[key].toFixed(6));
 for(const key of ['grossAmount','returnedAmount','netAmount'])totals[key]=c.round(totals[key]);
 if(caps.profit){totals.unknownProfitLines=filtered.filter(r=>r.netProfit===null).length;totals.netProfit=totals.unknownProfitLines?null:c.round(filtered.reduce((n,r)=>n+r.netProfit,0));}
 const supplierSummary=[...groups.values()].map(({orderIds,...g})=>({...g,orderCount:orderIds.size,quantity:Number(g.quantity.toFixed(6)),returnedQuantity:Number(g.returnedQuantity.toFixed(6)),netQuantity:Number(g.netQuantity.toFixed(6)),grossAmount:c.round(g.grossAmount),returnedAmount:c.round(g.returnedAmount),netAmount:c.round(g.netAmount)})).sort((a,b)=>b.netAmount-a.netAmount||b.netQuantity-a.netQuantity||a.name.localeCompare(b.name,'zh-CN'));
 const pages=Math.max(1,Math.ceil(filtered.length/f.limit)),page=Math.min(f.page,pages);
 return {canProfit:caps.profit,rows:filtered.slice((page-1)*f.limit,page*f.limit),totals,supplierSummary,options:allOptions,page,pages,limit:f.limit,from:f.from,to:f.to,scope:caps.allSales?'门店销售':'本人销售',basis:'按原销售单开单时间筛选，扣减截至查询时的累计退货和红冲；混合供货来源按原出库来源数量分摊。'};
}
module.exports={filters,report,lineSources};
