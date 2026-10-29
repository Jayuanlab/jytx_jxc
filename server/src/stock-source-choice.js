'use strict';
const c=require('./common'),details=require('./inventory-details'),serialSources=require('./serial-sources');
const key=row=>row.supplierId||(row.supplier?'name:'+row.supplier:'__unknown__');
function find(store,skuId,warehouseId){
 const product=(store.products||[]).find(row=>row.skuId===skuId);
 const matches=(store.inventory||[]).filter(row=>row.skuId===skuId&&(row.warehouseId||'wh-sale')===warehouseId),stock=matches[0];
 if(matches.length>1)throw new c.HttpError(409,'该商品在所选仓库有重复库存记录，请先核对');
 if(!product||!stock)throw new c.HttpError(404,'该仓没有此商品库存');
 return {product,stock};
}
function list(store,skuId,warehouseId){
 const {product,stock}=find(store,skuId,warehouseId),refs=details.index(store),groups=new Map(),serials=[];
 function add(source,quantity,sourceId,serialNo){
  const id=key(source),name=source.supplier||'供货来源待核';
  if(!groups.has(id))groups.set(id,{id,name,quantity:0,sourceIds:[]});
  const group=groups.get(id);group.quantity+=quantity;
  if(sourceId)group.sourceIds.push(sourceId);
  if(serialNo)serials.push({no:serialNo,supplierId:id,supplier:name});
 }
 if(details.tracked(product)){
  for(const row of stock.serials||[]){if(!details.inStock(row))continue;add(serialSources.resolve(store,product,row,refs),1,'',row.no);}
  const difference=Math.max(0,Number(stock.quantity||0)-serials.length);
  if(difference)add({},difference,'','');
 }else{
  const layers=(stock.costSources||[]).filter(row=>Number(row.quantity)>0);
  for(const layer of layers){
   const source=details.enrich(store,product,{...stock,costSources:[layer],serials:[]},refs).stockSources[0]||{};
   add(source,Number(layer.quantity),layer.sourceId,'');
  }
  const difference=Math.max(0,Number(stock.quantity||0)-layers.reduce((sum,row)=>sum+Number(row.quantity||0),0));
  if(difference)add({},difference,'untraced','');
 }
 const options=[...groups.values()],total=options.reduce((sum,row)=>sum+row.quantity,0);
 if(Math.abs(total-Number(stock.quantity||0))>1e-6)throw new c.HttpError(409,'该仓商品来源数量与账面库存不一致，请先核对');
 return {skuId,warehouseId,warehouseTotalQuantity:Number(stock.quantity||0),options,serials,stock,product};
}
function choose(store,skuId,warehouseId,supplierId='',serialNo=''){
 const result=list(store,skuId,warehouseId);
 let selected=String(supplierId||'').trim();
 if(serialNo){const serial=result.serials.find(row=>row.no===serialNo);if(!serial)throw new c.HttpError(409,'该串号已售或不在所选仓库');if(selected&&selected!==serial.supplierId)throw new c.HttpError(409,'所选供货商与该台串号来源不一致');selected=serial.supplierId;}
 if(!selected&&result.options.length===1)selected=result.options[0].id;
 if(!selected)throw new c.HttpError(400,'请选择本次销售出库的供货商');
 const option=result.options.find(row=>row.id===selected);
 if(!option)throw new c.HttpError(409,'所选供货商在该仓已无此商品库存，请刷新');
 return {...option,sourceIds:new Set(option.sourceIds)};
}
module.exports={list,choose,key};
