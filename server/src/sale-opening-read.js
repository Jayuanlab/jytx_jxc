'use strict';
const c=require('./common'),erp=require('./erp');
const productKeys=['skuId','name','shortName','externalCode','legacyExternalCodes','barcode','sourceBarcode','aliases','type','subType','thirdType','unit','salePrice','pricePending','costPrice','referenceCostPrice','active','stockManaged','trackSerial','warehouseId','carrier','packageName','expected','repair'];
const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
function readOptions(part){
 if(part==='base')return {collections:['products','inventory','receptions','paymentAccounts'],saleSerialMode:'none'};
 if(part==='serials')return {collections:['products','inventory'],saleSerialMode:'available'};
 if(part==='sources')return {collections:['products','inventory','purchases','suppliers','openingImportBatches','stockTransfers','serialSourceCorrections'],saleSerialMode:'available'};
 if(part==='reception')return {collections:['receptions','customers','assistCommissionAllocations'],saleSerialMode:'none'};
 throw new c.HttpError(400,'销售资料类型不正确');
}
function get(store,user,query=new URLSearchParams()){
 c.permit(user,'sell');const part=query.get('part')||'base';readOptions(part);
 if(part==='sources'){
  const result=require('./stock-source-choice').list(store,query.get('skuId')||'',query.get('warehouseId')||'');
  return {skuId:result.skuId,warehouseId:result.warehouseId,warehouseTotalQuantity:result.warehouseTotalQuantity,options:result.options.map(({id,name,quantity})=>({id,name,quantity})),serials:result.serials};
 }
 if(part==='serials')return {rows:erp.currentInventory(store,user).filter(r=>r.trackSerial).map(r=>({skuId:r.skuId,warehouseId:r.warehouseId,quantity:r.quantity,serials:(r.serials||[]).filter(s=>s.inStock).map(s=>pick(s,['no','status','inStock','costPrice']))}))};
 if(part==='reception'){
  const row=require('./receptions').list(store,user).rows.find(r=>r.id===query.get('id')&&!r.publicAssist&&r.status!=='已结案');
  if(!row)throw new c.HttpError(404,'接待单不存在、已结案或无权关联');return {row};
 }
 const stock=erp.currentInventory(store,user);
 const products=(store.products||[]).map(p=>{const row=pick(p,productKeys);row.trackSerial=require('./inventory-details').tracked(p);if(!c.capabilities(user).cost){delete row.costPrice;delete row.referenceCostPrice;}return row;});
 const rows=require('./receptions').list(store,user).rows.filter(r=>r.status!=='已结案'&&!r.publicAssist).map(r=>pick(r,['id','no','documentNo','number','customerMask','purpose','status','ownerId','ownerName']));
 return {giftRules:erp.giftRules(store),paymentAccounts:require('./payment-accounts').list(store,user),products,inventory:stock.map(r=>({...pick(r,['skuId','stockKey','warehouseId','warehouseName','quantity','costPrice','stockValue','serialRequired','trackSerial','stockManaged']),serials:[]})),users:(store.users||[]).filter(r=>!require('./assistant-roles').personalOnly(r)).map(c.publicUser),receptions:{rows},searchMeta:{synonyms:store.searchSynonyms||[]},warehouses:require('./warehouses').WAREHOUSES};
}
module.exports={readOptions,get};
