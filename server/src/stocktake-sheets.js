'use strict';
const c=require('./common'),inventory=require('./inventory-details'),warehouses=require('./warehouses');
const scope=require('./capacity/context');
function catalog(store,user){
 c.permit(user,'stocktake');
 const stockLocations=new Map();
 for(const row of store.inventory||[]){if(!stockLocations.has(row.skuId))stockLocations.set(row.skuId,new Set());stockLocations.get(row.skuId).add(row.warehouseId||'wh-sale');}
 return {scopeKey:[scope.current().tenantId||'local',scope.current().branchId||'local'].join('/'),warehouses:warehouses.WAREHOUSES,
  products:(store.products||[]).filter(p=>p.stockManaged!==false).map(p=>({skuId:p.skuId,name:p.name,externalCode:p.externalCode||'',type:p.type||'',trackSerial:inventory.tracked(p),phone:inventory.phone(p),unit:p.unit||'件',warehouseIds:[...new Set([p.warehouseId,...(stockLocations.get(p.skuId)||[])].filter(Boolean))]}))};
}
function compare(store,user,payload){
 c.permit(user,'stocktake');
 if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>2000)throw new c.HttpError(400,'请先填写实点商品，每张盘点表最多2000行');
 const started=Date.parse(payload.startedAt),ended=Date.now();
 if(!Number.isFinite(started)||started>ended+60000)throw new c.HttpError(400,'盘点开始时间不正确');
 const products=new Map((store.products||[]).map(p=>[p.skuId,p])),stocks=new Map((store.inventory||[]).map(s=>[JSON.stringify([s.warehouseId||'wh-sale',s.skuId]),s]));
 const keys=new Set(),allSerials=new Set(),photoZones=new Map(),photoHashes=new Map();
 const rows=payload.rows.map(input=>{
  const p=products.get(input.skuId),w=warehouses.byId(input.warehouseId);
  if(!p||p.stockManaged===false||!w)throw new c.HttpError(400,'请选择实物商品和有效仓库');
  const key=JSON.stringify([w.id,p.skuId]);if(keys.has(key))throw new c.HttpError(409,'同一商品在同一仓库只填一行');keys.add(key);
  const stock=stocks.get(key),tracked=inventory.tracked(p),expected=Number(stock?.quantity||0);
  if(!Number.isSafeInteger(expected)||expected<0)throw new c.HttpError(409,'该商品账面数量异常，请先核实：'+p.name);
  const quantityOnly=input.countMode==='photo-quantity';
  if(quantityOnly&&!inventory.phone(p))throw new c.HttpError(400,'手机照相数量盘点只用于手机商品');
  let serials=[],actual,photoAreas=[];
  if(quantityOnly){
   if(input.counted!==true)throw new c.HttpError(400,'请确认已经核实照片中的实际数量：'+p.name);
   actual=c.number(input.actual,'实点数量');if(!Number.isSafeInteger(actual))throw new c.HttpError(400,'实点数量必须为整数：'+p.name);
   if(!Array.isArray(input.photoAreas)||input.photoAreas.length<1||input.photoAreas.length>100)throw new c.HttpError(400,'请保留照相盘点区域记录');
   const areas=new Set();photoAreas=input.photoAreas.map(a=>{
    const area=c.text(a.area,'拍摄区域');if(area.length>60||areas.has(area))throw new c.HttpError(400,'拍摄区域重复或名称过长');areas.add(area);
    if(typeof a.photoId!=='string'||! /^[a-f0-9]{64}$/.test(a.photoId))throw new c.HttpError(400,'照片记录不正确');
    const zone=JSON.stringify([w.id,area.normalize('NFKC').replace(/\s+/g,' ').toLowerCase()]);
    if(photoZones.has(zone)&&photoZones.get(zone)!==a.photoId||photoHashes.has(a.photoId)&&photoHashes.get(a.photoId)!==zone)throw new c.HttpError(409,'同一区域只能使用一张照片，同张照片不能重复计入不同区域');photoZones.set(zone,a.photoId);photoHashes.set(a.photoId,zone);
    const quantity=c.number(a.quantity,'区域数量');if(!Number.isSafeInteger(quantity))throw new c.HttpError(400,'区域数量必须是整数');
    return {area,photoId:a.photoId,quantity};
   });
   if(photoAreas.reduce((n,a)=>n+a.quantity,0)!==actual)throw new c.HttpError(400,'区域数量合计与实点数量不一致，请重新核实');
  }else if(tracked){
   if(input.counted!==true||!Array.isArray(input.serials)||input.serials.length>10000)throw new c.HttpError(400,'请确认已点清完整串号：'+p.name);
   serials=input.serials.map(value=>c.text(value,'完整串号').toUpperCase());
   if(serials.some(no=>inventory.phone(p)?!/^\d{15}$/.test(no):!/^[A-Z0-9-]{5,40}$/.test(no)))throw new c.HttpError(400,'请填写'+(inventory.phone(p)?'15位手机串号':'完整串号')+'：'+p.name);
   for(const no of serials){if(allSerials.has(no))throw new c.HttpError(409,'实点串号重复：'+no);allSerials.add(no);}
   actual=serials.length;
  }else{
   actual=c.number(input.actual,'实点数量');
   if(!Number.isSafeInteger(actual))throw new c.HttpError(400,'实点数量必须为整数：'+p.name);
  }
  const expectedSerials=tracked&&!quantityOnly?(stock?.serials||[]).filter(inventory.inStock).map(s=>String(s.no).toUpperCase()):[];
  const book=new Set(expectedSerials),physical=new Set(serials),missingSerials=expectedSerials.filter(no=>!physical.has(no)),extraSerials=serials.filter(no=>!book.has(no));
  const movements=(store.movements||[]).filter(m=>m.skuId===p.skuId&&(m.warehouseId||'wh-sale')===w.id&&Date.parse(m.createdAt)>=started);
  const serialChanged=tracked&&(stock?.serials||[]).some(s=>['soldAt','returnedAt','updatedAt'].some(field=>Date.parse(s[field])>=started));
  const changedDuringCount=movements.length>0||serialChanged;
  const different=actual!==expected||missingSerials.length>0||extraSerials.length>0||tracked&&!quantityOnly&&expectedSerials.length!==expected;
  return {skuId:p.skuId,product:p.name,externalCode:p.externalCode||'',warehouseId:w.id,warehouseName:w.name,trackSerial:tracked,unit:tracked?'台':p.unit||'件',
   expected,actual,delta:actual-expected,actualSerials:quantityOnly?null:serials,expectedSerials,missingSerials,extraSerials,serialBookDifference:tracked&&!quantityOnly?expected-expectedSerials.length:0,
   ...(quantityOnly?{countMode:'photo-quantity',serialsPending:true,photoAreas}:{}),
   changedDuringCount,movementsDuringCount:movements.map(m=>({id:m.id,type:m.type,quantity:m.quantity,sourceId:m.sourceId,createdAt:m.createdAt})),status:changedDuringCount?'盘点期间有出入库':different?'有差异':quantityOnly?'数量相符，串号未核对':'一致',different:Boolean(different)};
 });
 // A complete serial count also fills serials missing from existing stock.
 // Quantity and cost stay unchanged; discrepancies and movements still need review.
 let boundSerialCount=0;
 for(const row of rows){
  if(!row.trackSerial||row.countMode==='photo-quantity'||row.changedDuringCount||row.actual!==row.expected||!row.actualSerials)continue;
  const current=new Set(row.expectedSerials),physical=new Set(row.actualSerials);
  if(row.expectedSerials.some(no=>!physical.has(no)))continue;
  const missing=row.expected-row.expectedSerials.length;
  if(missing<=0||row.actualSerials.length-row.expectedSerials.length!==missing)continue;
  const serials=row.actualSerials.filter(no=>!current.has(no));
  inventory.bind(store,user,{skuId:row.skuId,warehouseId:row.warehouseId,expectedQuantity:row.expected,expectedSerials:row.expectedSerials,serials,reason:'实点表扫码盘点补录完整串号'});
  row.boundSerials=serials;row.extraSerials=[];row.serialBookDifference=0;row.different=false;row.status='串号已补录，账实一致';
  boundSerialCount+=serials.length;
 }
 const selectedWarehouses=new Set(rows.map(r=>r.warehouseId));
 const uncounted=(store.inventory||[]).filter(s=>selectedWarehouses.has(s.warehouseId)&&Number(s.quantity)>0&&!keys.has(JSON.stringify([s.warehouseId,s.skuId]))).map(s=>({skuId:s.skuId,product:products.get(s.skuId)?.name||s.skuId,warehouseId:s.warehouseId,warehouseName:warehouses.byId(s.warehouseId)?.name||s.warehouseId}));
 const differenceCount=rows.filter(r=>r.different||r.changedDuringCount||r.serialsPending).length;
 const row={id:c.id('ST'),kind:'blind',rows,uncounted,startedAt:new Date(started).toISOString(),createdAt:c.now(),operatorId:user.id,operator:user.name,differenceCount,status:differenceCount?'差异待核实':uncounted.length?'已核对（部分商品）':'账实一致'};
 store.stocktakes.unshift(row);c.audit(store,user,'stock:blind-compare',row.id+' · 实点 '+rows.length+' 行 · 待核实 '+differenceCount+' 行');
 return {...row,message:differenceCount?'实点表已保存，差异待核实。':boundSerialCount?'实点表已保存，已盘商品账实一致；已补录 '+boundSerialCount+' 个串号。':'实点表已保存，已盘商品账实一致。'};
}
function list(store,user){
 c.permit(user,'stocktake');
 return (store.stocktakes||[]).filter(row=>row.kind==='blind').slice(0,100);
}
function review(store,user,payload){
 c.permit(user,'manageUsers');const row=(store.stocktakes||[]).find(x=>x.id===payload.id&&x.kind==='blind');
 if(!row)throw new c.HttpError(404,'盘点表不存在');
 if(row.status!=='差异待核实')throw new c.HttpError(409,'这张表没有待核实差异');
 const note=c.text(payload.note,'核实结果');if(note.length>1000)throw new c.HttpError(400,'核实结果不能超过1000字');
 row.reviewNote=note;row.reviewedAt=c.now();row.reviewedBy=user.id;row.status='已核实';
 c.audit(store,user,'stock:blind-review',row.id+' · '+note);return {message:'核实结果已保存。'};
}
module.exports={catalog,compare,list,review};
