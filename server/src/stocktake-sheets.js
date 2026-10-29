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
function missingCost(stock,actual){if(!stock)return null;if(Number(actual)>=Number(stock.quantity))return 0;const fifo=require('./fifo-costs');if(fifo.enabled(stock)){const copy=structuredClone(stock);return c.round(-fifo.count({},copy,actual,'preview-only'));}return Number.isFinite(stock.costPrice)&&Number.isFinite(stock.stockValue)?c.round((stock.quantity-actual)*stock.costPrice):null;}
function compare(store,user,payload){
 c.permit(user,'stocktake');
 if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>2000)throw new c.HttpError(400,'请先填写实点商品，每张盘点表最多2000行');
 const started=Date.parse(payload.startedAt),ended=Date.now();
 if(!Number.isFinite(started)||started>ended+60000)throw new c.HttpError(400,'盘点开始时间不正确');
 const products=new Map((store.products||[]).map(p=>[p.skuId,p])),stocks=new Map((store.inventory||[]).map(s=>[JSON.stringify([s.warehouseId||'wh-sale',s.skuId]),s]));
 const keys=new Set(),allSerials=new Set();
 const rows=payload.rows.map(input=>{
  const p=products.get(input.skuId),w=warehouses.byId(input.warehouseId);
  if(!p||p.stockManaged===false||!w)throw new c.HttpError(400,'请选择实物商品和有效仓库');
  const key=JSON.stringify([w.id,p.skuId]);if(keys.has(key))throw new c.HttpError(409,'同一商品在同一仓库只填一行');keys.add(key);
  const stock=stocks.get(key),tracked=inventory.tracked(p),expected=Number(stock?.quantity||0);
  if(!Number.isSafeInteger(expected)||expected<0)throw new c.HttpError(409,'该商品账面数量异常，请先核实：'+p.name);
  let serials=[],actual;
  if(tracked){
   if(input.counted!==true||!Array.isArray(input.serials)||input.serials.length>10000)throw new c.HttpError(400,'请确认已点清完整串号：'+p.name);
   const featurePhone=['功能机','功能手机'].includes(p.type),phone=inventory.phone(p)||featurePhone;
   serials=input.serials.map(value=>{const no=c.text(value,'完整串号');return phone?no:no.toUpperCase();});
   if(serials.some(no=>phone?!/^[0-9]{15}$/.test(no)&&!(featurePhone&&/^(?=.*[A-Z])[A-Z0-9]{15}$/.test(no)):!/^[A-Z0-9-]{5,40}$/.test(no)))throw new c.HttpError(400,'请填写'+(phone?'15位手机串号'+(featurePhone?'或原表15位大写字母数字串号':''):'完整串号')+'：'+p.name);
   for(const no of serials){if(allSerials.has(no))throw new c.HttpError(409,'实点串号重复：'+no);allSerials.add(no);}
   actual=serials.length;
  }else{
   actual=c.number(input.actual,'实点数量');
   if(!Number.isSafeInteger(actual))throw new c.HttpError(400,'实点数量必须为整数：'+p.name);
  }
  const expectedSerials=tracked?(stock?.serials||[]).filter(inventory.inStock).map(s=>String(s.no).toUpperCase()):[];
  const book=new Set(expectedSerials),physical=new Set(serials),missingSerials=expectedSerials.filter(no=>!physical.has(no)),extraSerials=serials.filter(no=>!book.has(no));
  const movements=(store.movements||[]).filter(m=>m.skuId===p.skuId&&(m.warehouseId||'wh-sale')===w.id&&Date.parse(m.createdAt)>=started);
  const serialChanged=tracked&&(stock?.serials||[]).some(s=>['soldAt','returnedAt','updatedAt'].some(field=>Date.parse(s[field])>=started));
  const changedDuringCount=movements.length>0||serialChanged;
  const different=actual!==expected||missingSerials.length>0||extraSerials.length>0||tracked&&expectedSerials.length!==expected;
  return {skuId:p.skuId,product:p.name,externalCode:p.externalCode||'',warehouseId:w.id,warehouseName:w.name,trackSerial:tracked,unit:tracked?'台':p.unit||'件',
   bookSnapshot:{quantity:expected,missingCostValue:tracked?null:missingCost(stock,actual),stockValue:stock?.stockValue??null,costPrice:stock?.costPrice??null,costSources:structuredClone(stock?.costSources||[]),serials:structuredClone(stock?.serials||[])},expected,actual,delta:actual-expected,actualSerials:serials,expectedSerials,missingSerials,extraSerials,serialBookDifference:tracked?expected-expectedSerials.length:0,
   changedDuringCount,movementsDuringCount:movements.map(m=>({id:m.id,type:m.type,quantity:m.quantity,sourceId:m.sourceId,createdAt:m.createdAt})),status:changedDuringCount?'盘点期间有出入库':different?'有差异':'一致',different:Boolean(different)};
 });
 // A complete serial count also fills serials missing from existing stock.
 // Quantity and cost stay unchanged; discrepancies and movements still need review.
 let boundSerialCount=0;
 for(const row of rows){
  if(!row.trackSerial||row.changedDuringCount||row.actual!==row.expected)continue;
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
 const differenceCount=rows.filter(r=>r.different||r.changedDuringCount).length;
 const row={id:c.id('ST'),kind:'blind',rows,uncounted,startedAt:new Date(started).toISOString(),createdAt:c.now(),operatorId:user.id,operator:user.name,differenceCount,status:differenceCount?'差异待核实':uncounted.length?'已核对（部分商品）':'账实一致'};
 store.stocktakes.unshift(row);c.audit(store,user,'stock:blind-compare',row.id+' · 实点 '+rows.length+' 行 · 待核实 '+differenceCount+' 行');
 return {...row,message:differenceCount?'实点表已保存，差异待核实。':boundSerialCount?'实点表已保存，已盘商品账实一致；已补录 '+boundSerialCount+' 个串号。':'实点表已保存，已盘商品账实一致。'};
}
function list(store,user){
 c.permit(user,'stocktake');
 const rows=(store.stocktakes||[]).filter(row=>row.kind==='blind');
 const pending=rows.filter(row=>row.status==='差异待核实');
 return [...pending,...rows.filter(row=>row.status!=='差异待核实').slice(0,Math.max(0,100-pending.length))];
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
