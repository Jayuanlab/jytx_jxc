'use strict';
const {createHash}=require('node:crypto'),c=require('./common'),fifo=require('./fifo-costs'),details=require('./inventory-details'),sources=require('./serial-sources'),suppliers=require('./suppliers');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inStock=s=>['可售','未激活'].includes(s.status);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function reached(store,target,origin,sourceId,seen=new Set()){if(target===origin)return true;if(seen.has(target))return false;const next=new Set(seen);next.add(target);return (store.stockTransfers||[]).some(t=>t.status==='completed'&&t.targetSkuId===target&&(t.sourceCostSources||[]).some(part=>part.sourceId===sourceId&&part.quantity>0)&&reached(store,t.sourceSkuId,origin,sourceId,next));}
function permit(user){c.permit(user,'purchase');}
function supplier(store,id,name){const rows=(store.suppliers||[]).filter(s=>id?s.id===id:s.name===name);return rows.length===1&&rows[0].active!==false?rows[0]:null;}
function groups(store){
 const result=new Map(),refs=details.index(store),batchRows=(store.openingImportBatches||[]).flatMap(batch=>(batch.products||[]).map(item=>({batch,item})));
 function add(stock,product,supplierRow,batchId,sourceId,serial,layer,evidence){
  if(!supplierRow||!batchId||!sourceId)return;
  const warehouseId=stock.warehouseId||product.warehouseId||'wh-sale',key='OPEN-RETURN-'+hash([product.skuId,warehouseId,supplierRow.id,batchId,sourceId]);
  let row=result.get(key);if(!row){row={key,sourceType:'opening',openingBatchId:batchId,sourceId,skuId:product.skuId,name:product.name,externalCode:product.externalCode||'',warehouseId,warehouseName:stock.warehouseName||warehouseId,supplierId:supplierRow.id,supplier:supplierRow.name,serialRequired:details.tracked(product),quantity:0,cost:0,serialNos:[],unit:product.unit||'件',_stock:stock,_product:product,_serials:[],_layers:[],_evidence:[]};result.set(key,row);}
  if(serial){row.quantity++;row.cost=c.round(row.cost+Number(serial.costPrice));row.serialNos.push(serial.no);row._serials.push(serial);}else{row.quantity+=layer.quantity;row.cost=c.round(row.cost+layer.valueCents/100);row._layers.push(layer);}
  row._evidence.push(evidence);
 }
 for(const stock of store.inventory||[]){
  if(!(stock.quantity>0))continue;const product=(store.products||[]).find(p=>p.skuId===stock.skuId);if(!product||product.stockManaged===false)continue;
  if(details.tracked(product)){
   for(const serial of stock.serials||[]){
    if(!inStock(serial)||!sources.opening(serial)||serial.costPrice==null||!Number.isFinite(Number(serial.costPrice))||Number(serial.costPrice)<0)continue;
    const resolved=sources.resolve(store,product,serial,refs);if(resolved.sourceConflict||resolved.purchaseId)continue;
    const sid=supplier(store,resolved.supplierId,resolved.supplier),batchId=serial.openingBatch||serial.sourceId;
    add(stock,product,sid,batchId,batchId,serial,null,{serial,source:resolved});
   }
  }else if(fifo.enabled(stock)){
   fifo.assertStock(stock);
   for(const layer of stock.costSources||[]){
    const matches=batchRows.filter(({item})=>item.sourceId===layer.sourceId&&reached(store,product.skuId,item.skuId,layer.sourceId));if(matches.length!==1)continue;
    const {batch,item}=matches[0],sid=supplier(store,item.supplierId,item.supplier);
    add(stock,product,sid,batch.id||batch.batchId,layer.sourceId,null,layer,{batchId:batch.id||batch.batchId,item});
   }
  }
 }
 return [...result.values()];
}
function publicRow(row){const {_stock,_product,_serials,_layers,_evidence,...visible}=row;return {...visible,unitPrice:row.quantity?c.round(row.cost/row.quantity):0};}
function candidates(store,user){permit(user);return groups(store).map(publicRow);}
function normalize(payload){
 if(payload.confirmed!==true)throw new c.HttpError(400,'请确认提交期初退货申请');
 const note=String(payload.note||'期初库存退回供货商').trim(),reference=String(payload.reference||c.id('OPEN-REF')).trim();
 if(note.length>500||reference.length>100)throw new c.HttpError(400,'退货备注或对方单号过长');
 return {sourceType:'opening',openingKey:c.text(payload.openingKey,'期初库存来源'),supplierId:c.text(payload.supplierId,'供货商'),quantity:c.quantity(payload.quantity),unitPrice:c.money(payload.unitPrice,'退货单价'),serialNos:Array.isArray(payload.serialNos)?payload.serialNos.map(no=>c.text(no,'串号')):[],kind:suppliers.creditKind(payload),note:note||'期初库存退回供货商',reference:reference||c.id('OPEN-REF'),confirmed:true};
}
function plan(store,user,payload){
 permit(user);if(payload.sourceType!=='opening')throw new c.HttpError(400,'期初退货来源不正确');
 if((store.dailyCloseouts||[]).some(r=>r.date===c.day()&&r.status==='已锁定'))throw new c.HttpError(409,'今日已锁定，请先完成日结更正流程');
 const selected=groups(store).find(r=>r.key===payload.openingKey&&r.supplierId===payload.supplierId);if(!selected)throw new c.HttpError(409,'该供货商的期初可退库存已变化，请重新选择');
 const quantity=c.quantity(payload.quantity);if(quantity>selected.quantity||quantity>selected._stock.quantity)throw new c.HttpError(409,'超过该期初来源可退库存');
 const unitPrice=c.money(payload.unitPrice,'退货单价'),amount=c.round(quantity*unitPrice);if(!amount)throw new c.HttpError(400,'退货款必须大于零');
 const kind=suppliers.creditKind(payload),reference=c.text(payload.reference,'退货确认编号'),note=c.text(payload.note,'退货说明');
 if((store.purchaseReturns||[]).some(r=>r.supplierId===selected.supplierId&&r.reference===reference))throw new c.HttpError(409,'该退货确认编号已登记');
 let cost,serialNos=[],costSources=[];
 if(selected.serialRequired){
  const actual=(selected._stock.serials||[]).filter(inStock);if(actual.length!==selected._stock.quantity||new Set(actual.map(s=>s.no)).size!==actual.length||actual.some(s=>s.costPrice==null||!Number.isFinite(Number(s.costPrice))||Number(s.costPrice)<0)||c.round(actual.reduce((n,s)=>n+Number(s.costPrice),0))!==c.round(selected._stock.stockValue??selected._stock.quantity*selected._stock.costPrice))throw new c.HttpError(409,'串号数量或成本与库存不一致，请先核对');
  serialNos=payload.serialNos||[];if(serialNos.length!==quantity||new Set(serialNos).size!==quantity||serialNos.some(no=>!selected.serialNos.includes(no)))throw new c.HttpError(409,'请选择本批次可退的完整串号，数量须一致');
  cost=c.round(serialNos.reduce((n,no)=>n+Number(selected._serials.find(s=>s.no===no).costPrice),0));
 }else{
  if(payload.serialNos?.length)throw new c.HttpError(400,'该期初商品不按串号管理');
  costSources=fifo.take(structuredClone(selected._stock),quantity,selected.sourceId);cost=fifo.total(costSources);
 }
 const stockValue=c.round(selected._stock.stockValue??selected._stock.quantity*selected._stock.costPrice);if(!Number.isFinite(stockValue)||cost>stockValue)throw new c.HttpError(409,'期初库存成本不一致，请先核对');
 const row={sourceType:'opening',openingKey:selected.key,openingBatchId:selected.openingBatchId,openingSourceId:selected.sourceId,purchaseId:'',itemId:'',supplierId:selected.supplierId,supplier:selected.supplier,skuId:selected.skuId,name:selected.name,warehouseId:selected.warehouseId,warehouseName:selected.warehouseName,quantity,unitPrice,amount,cost,kind,reference,note,serialNos,costSources};
 const fingerprint={row,stock:{quantity:selected._stock.quantity,stockValue,serials:selected.serialRequired?selected._serials:selected._stock.costSources},source:selected._evidence};
 const scoped={row,serials:row.serialNos.map(no=>({serial:selected._serials.find(s=>s.no===no),source:selected._evidence.find(e=>e.serial?.no===no)?.source}))};
 return {row,selected,legacyToken:hash(fingerprint),previewToken:selected.serialRequired?'opening-v2:'+hash(canonical(scoped)):hash(fingerprint)};
}
function preview(store,user,payload){const p=plan(store,user,payload);return {...p.row,previewToken:p.previewToken};}
function apply(store,user,payload){
 require('./sale-return-requests').assertOwner(store,user);const {row,selected,previewToken}=plan(store,user,payload);
 if(payload.confirmed!==true||payload.previewToken!==previewToken)throw new c.HttpError(409,'期初库存或退货资料已有变化，请重新申请');
 return applyPlan(store,user,{row,selected});
}
function applyPlan(store,user,{row,selected}){
 const stock=selected._stock;if(selected.serialRequired)for(const no of row.serialNos)selected._serials.find(s=>s.no===no).status='已退供应商';else row.costSources=fifo.take(stock,row.quantity,row.openingSourceId);
 stock.stockValue=c.round((stock.stockValue??stock.quantity*stock.costPrice)-row.cost);stock.quantity-=row.quantity;if(!stock.quantity)stock.stockValue=0;stock.costPrice=stock.quantity?Number((stock.stockValue/stock.quantity).toFixed(6)):0;fifo.assertStock(stock);
 row.id=c.id('PR');Object.assign(row,suppliers.stamp(user));
 store.supplierEntries||=[];row.entryId=suppliers.entry(store,{supplierId:row.supplierId,kind:row.kind,cents:suppliers.cents(row.amount),title:'期初库存退货款',sourceType:'purchase_return',sourceId:row.id,note:row.note,...suppliers.stamp(user)}).id;
 (store.purchaseReturns||=[]).push(row);(store.movements||=[]).unshift({id:c.id('MV'),skuId:row.skuId,product:row.name,quantity:-row.quantity,cost:-row.cost,type:'期初库存退货',sourceType:'opening_purchase_return',sourceId:row.id,openingBatchId:row.openingBatchId,openingSourceId:row.openingSourceId,warehouseId:row.warehouseId,warehouseName:row.warehouseName,supplierId:row.supplierId,...suppliers.stamp(user)});
 c.audit(store,user,'supplier:return',row.id+' · 期初批次 '+row.openingBatchId+' · '+row.name+' × '+row.quantity+' · '+row.amount+' 元');return row;
}
// Old requests retain their original token. Reconstruct only documented later
// purchase additions, then require the exact old whole-stock hash to match.
// A changed requested serial, cost, source, quantity or quote still fails.
function legacyAdditionProof(store,user,request,current){
 if(!current.selected.serialRequired||String(request.previewToken||'').startsWith('opening-v2:'))return null;
 const requestedAt=Date.parse(request.createdAt);if(!Number.isFinite(requestedAt))return null;
 const stock=current.selected._stock,added=[];
 for(const serial of stock.serials||[]){
  if(!inStock(serial)||sources.opening(serial)||!serial.purchaseId||!serial.purchaseItemId)continue;
  const order=(store.purchases||[]).find(p=>p.id===serial.purchaseId),line=(order?.items||[]).find(i=>i.id===serial.purchaseItemId);
  if(!order||!line||!(Date.parse(order.createdAt)>requestedAt)||line.skuId!==stock.skuId||(line.warehouseId||'wh-sale')!==(stock.warehouseId||'wh-sale')||!(line.serials||[]).includes(serial.no)||!Number.isFinite(Number(serial.costPrice))||Number(serial.costPrice)<0)continue;
  added.push(serial);
 }
 if(!added.length)return null;
 const prior=structuredClone(stock),numbers=new Set(added.map(s=>s.no));prior.serials=prior.serials.filter(s=>!numbers.has(s.no));prior.quantity-=added.length;prior.stockValue=c.round((stock.stockValue??stock.quantity*stock.costPrice)-added.reduce((n,s)=>n+Number(s.costPrice),0));prior.costPrice=prior.quantity?prior.stockValue/prior.quantity:0;
 if(prior.quantity<0||prior.stockValue<0)return null;
 const reconstructed={...store,inventory:store.inventory.map(s=>s===stock?prior:s)};
 try{if(plan(reconstructed,user,request.payload).legacyToken!==request.previewToken)return null;}catch{return null;}
 return {mode:'exact_legacy_token_after_documented_later_purchases',purchaseIds:[...new Set(added.map(s=>s.purchaseId))],serialNos:added.map(s=>s.no),originalToken:request.previewToken};
}
function applyReviewed(store,user,request){
 require('./sale-return-requests').assertOwner(store,user);
 const current=plan(store,user,request.payload);
 const exact=request.previewToken===current.previewToken||request.previewToken===current.legacyToken;
 const proof=exact?null:legacyAdditionProof(store,user,request,current);
 if(!exact&&!proof)throw new c.HttpError(409,'库存、成本或退货资料已有变化，请驳回后重新申请');
 const result=applyPlan(store,user,current);if(proof)result.approvalValidation=proof;return result;
}
module.exports={candidates,normalize,preview,apply,applyReviewed};
