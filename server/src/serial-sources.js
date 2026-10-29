'use strict';
const c=require('./common');
function date(value){return !value?'':/^\d{4}-\d{2}-\d{2}$/.test(value)?value:Number.isFinite(Date.parse(value))?c.day(value):'';}
// All current serial-source displays use this resolver. A SKU is never evidence
// of the supplier of an individual unit.
function supplierName(store,id,fallback='') { return (store.suppliers||[]).find(s=>s.id===id)?.name || fallback || ''; }
function history(store,no) { return (store.serialSourceCorrections||[]).filter(r=>r.serialNo===no); }
function opening(serial) { return serial.sourceType==='opening_balance' || !!serial.openingBatch; }
function original(store,product,serial,refs) {
 const blank={purchaseId:'',purchaseItemId:'',supplierId:'',supplier:'',purchaseDate:''};
 if(serial.sourceType==='supplier_exchange') {
  const order=(store.supplierExchanges||[]).find(row=>row.id===serial.supplierExchangeId),receipt=order?.receipts?.find(row=>row.id===serial.supplierExchangeReceiptId),matched=receipt?.items?.some(item=>item.skuId===product.skuId&&item.serialNos?.includes(serial.no));
  return {...blank,supplierId:matched?order.supplierId:'',supplier:matched?supplierName(store,order.supplierId,order.supplierName):'',purchaseDate:matched?date(receipt.at):'',sourceType:'supplier_exchange',sourceStatus:matched?'供货商换货验收入库':'换货来源待核',supplierExchangeId:serial.supplierExchangeId||'',sourceConflict:!matched};
 }
 if(serial.sourceType==='supplier_outbound_return') {
  const order=(store.supplierOutboundTransfers||[]).find(row=>row.id===serial.supplierOutboundId);
  const receipt=order?.goodsReceipts?.find(row=>row.id===serial.supplierOutboundReceiptId);
  const matched=receipt?.items?.some(item=>item.skuId===product.skuId&&item.serialNos?.includes(serial.no));
  return {...blank,supplierId:matched?order.supplierId:'',supplier:matched?supplierName(store,order.supplierId,order.supplierName):'',purchaseDate:matched?date(receipt.at):'',sourceType:'supplier_outbound_return',sourceStatus:matched?'供货商调货换回验收入库':'换回货来源待核',supplierOutboundId:serial.supplierOutboundId||'',supplierOutboundReceiptId:serial.supplierOutboundReceiptId||'',sourceConflict:!matched};
 }
 if(opening(serial)) {
  const id=serial.openingSupplierId||serial.supplierId||'',name=serial.openingSupplier||serial.supplier||'';
  const supplier=id?(store.suppliers||[]).find(s=>s.id===id):(store.suppliers||[]).find(s=>s.name===name);
  return {...blank,supplierId:supplier?.id||id,supplier:supplier?.name||name,purchaseDate:date(serial.actualPurchaseDate),sourceType:'opening',sourceStatus:supplier?.name||name?'期初登记':'期初供货商待补'};
 }
 const skuId=serial.originSkuId||product.skuId;
 const choices=serial.purchaseId ? (store.purchases||[]).filter(p=>p.id===serial.purchaseId).flatMap(order=>(order.items||[]).filter(item=>item.skuId===skuId && (!serial.purchaseItemId||item.id===serial.purchaseItemId) && (item.serials||[]).includes(serial.no)).map(item=>({order,item}))) :
  (refs?.serials?.get(JSON.stringify([skuId,serial.no])) || (store.purchases||[]).flatMap(order=>(order.items||[]).filter(item=>item.skuId===skuId&&(item.serials||[]).includes(serial.no)).map(item=>({order,item}))));
 if(choices.length===1) {const {order,item}=choices[0];return {...blank,purchaseId:order.id,purchaseItemId:item.id,supplierId:order.supplierId||'',supplier:supplierName(store,order.supplierId,order.supplier),purchaseDate:date(order.actualPurchaseDate||order.purchaseDate||order.createdAt),sourceType:'purchase',sourceStatus:'原入库单'};}
 return {...blank,sourceType:'historical',sourceStatus:choices.length>1||serial.purchaseId?'来源冲突待核实':'历史来源待补',sourceConflict:choices.length>1||!!serial.purchaseId};
}
function resolve(store,product,serial,refs) {
 const base=original(store,product,serial,refs),rows=history(store,serial.no),last=rows.at(-1);
 if(!last)return {...base,correctionId:'',correctionCount:0};
 return {...base,...last.after,supplier:supplierName(store,last.after.supplierId,last.after.supplier),sourceType:base.sourceType,sourceStatus:'来源已补录/更正',correctionId:last.id,correctionCount:rows.length};
}
function forSale(store,item,refs) {
 if(!item.serialNo)return null;
 const hits=(store.inventory||[]).flatMap(stock=>(stock.serials||[]).filter(s=>s.no===item.serialNo).map(serial=>({stock,serial})));
 if(hits.length===1){const {stock,serial}=hits[0];return resolve(store,(store.products||[]).find(p=>p.skuId===stock.skuId)||{skuId:stock.skuId},serial,refs);}
 return resolve(store,{skuId:item.skuId},{no:item.serialNo,purchaseId:item.purchaseId,purchaseItemId:item.purchaseItemId,originSkuId:item.originSkuId},refs);
}
module.exports={resolve,original,history,opening,supplierName,forSale};
