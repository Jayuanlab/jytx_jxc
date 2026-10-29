const fifo=require("./fifo-costs");
"use strict";
const {createHash}=require("node:crypto"),c=require("./common"),warehouses=require("./warehouses"),details=require("./inventory-details"),costs=require("./supplier-costs");
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function permit(user){c.permit(user,"purchase");c.permit(user,"stocktake");}
function validStock(stock){if(!stock||!Number.isSafeInteger(stock.quantity)||stock.quantity<0||!Number.isFinite(stock.stockValue)||stock.stockValue<0||!Number.isSafeInteger(Math.round(stock.stockValue*100))||Math.abs(c.round(stock.stockValue)-stock.stockValue)>0.000001||!Number.isFinite(stock.costPrice)||stock.costPrice<0||(!stock.quantity&&stock.stockValue!==0))throw new c.HttpError(409,"库存数量或金额异常，请先盘库核对");}
function validSources(stock,tracked){
 if(stock.costSources!==undefined&&!Array.isArray(stock.costSources))throw new c.HttpError(409,"库存成本来源资料异常，请先核对");
 if(tracked){if(stock.costSources?.length)throw new c.HttpError(409,"串号商品含历史成本来源，须先核对；调拨以每台真实串号的原采购来源和成本为准");return;}
 const sources=stock.costSources||[{sourceId:"untraced",quantity:stock.quantity}];
 if(!Array.isArray(sources)||sources.some(s=>typeof s.sourceId!=="string"||!s.sourceId||!Number.isFinite(s.quantity)||s.quantity<0)||Math.abs(sources.reduce((n,s)=>n+s.quantity,0)-stock.quantity)>0.000001)throw new c.HttpError(409,"库存成本来源数量不一致，请先核对");
}
function serialOrigin(store,source,serial,seen=new Set()){
 const originSkuId=serial.originSkuId||source.skuId;
 if(originSkuId!==source.skuId){
  const rows=(store.stockTransfers||[]).filter(t=>t.id===serial.lastTransferId&&t.status==="completed"),t=rows[0],previous=t?.serials?.filter(s=>s.no===serial.no)||[],proof=t?.serialSources?.filter(s=>s.no===serial.no)||[],parent=store.products.find(p=>p.skuId===t?.sourceSkuId);
  const keys=["no","costPrice","purchaseId","purchaseItemId","costBasis","boundBy","boundAt"];
  if(rows.length!==1||seen.has(t.id)||t.targetSkuId!==source.skuId||t.targetWarehouseId!==source.warehouseId||!(t.serialNos||[]).includes(serial.no)||previous.length!==1||proof.length!==1||proof[0].originSkuId!==originSkuId||!parent||keys.some(k=>previous[0][k]!==serial[k])||serial.lastTransferredAt!==t.createdAt||serial.lastTransferredBy!==t.operatorId||(previous[0].originSkuId||parent.skuId)!==originSkuId)throw new c.HttpError(409,"串号原商品与当前源商品不一致，调拨来源链无法核验："+serial.no);
  const next=new Set(seen);next.add(t.id);const verified=serialOrigin(store,parent,previous[0],next);
  if([...new Set([...Object.keys(verified),...Object.keys(proof[0])])].some(k=>verified[k]!==proof[0][k]))throw new c.HttpError(409,"串号调拨来源记录不一致，请先核对："+serial.no);
  return verified;
 }
 if(serial.purchaseId||serial.purchaseItemId){
  const orders=(store.purchases||[]).filter(order=>order.id===serial.purchaseId),items=orders[0]?.items?.filter(item=>item.id===serial.purchaseItemId&&item.skuId===originSkuId&&(item.serials||[]).includes(serial.no))||[];
  if(orders.length!==1||items.length!==1)throw new c.HttpError(409,"串号原采购单、明细或商品来源不匹配，请先核对："+serial.no);
  return {no:serial.no,sourceType:"purchase",sourceStatus:"原采购单",purchaseId:orders[0].id,purchaseItemId:items[0].id,originSkuId};
 }
 const at=Date.parse(serial.boundAt),logs=(store.operationLogs||[]).filter(log=>{const parts=String(log.detail||"").split(" · "),elapsed=Date.parse(log.createdAt)-at;return log.action==="stock:bind-serials"&&log.operatorId===serial.boundBy&&parts[0]===originSkuId&&String(parts[1]||"").split("、").includes(serial.no)&&Number.isFinite(elapsed)&&elapsed>=0&&elapsed<=60000;});
 if(serial.costBasis!=="原库存剩余成本分摊"||!serial.boundBy||!Number.isFinite(at)||logs.length!==1)throw new c.HttpError(409,"串号缺少可核验的原采购或真实补绑定记录，请先核对："+serial.no);
 return {no:serial.no,sourceType:"historical-bound",sourceStatus:"历史来源待补",bindingAuditId:logs[0].id,originSkuId};
}
function visible(row,user){permit(user);const result=structuredClone(row);if(!c.capabilities(user).cost){for(const key of ["cost","serials","sourceCostSources","sourceValueBefore","targetValueBefore"])delete result[key];}return result;}
function familyRoot(store,source){
 const seen=new Set();let root=source;
 while(root.warehouseVariantOf||root.mobileVariantOf){
  if(seen.has(root.skuId))throw new c.HttpError(409,"同款商品关联循环，请管理员核对");seen.add(root.skuId);
  const parent=store.products.find(p=>p.skuId===(root.warehouseVariantOf||root.mobileVariantOf));
  if(!parent||parent.stockManaged===false||warehouses.baseName(parent.name)!==warehouses.baseName(root.name)||details.tracked(parent)!==details.tracked(root)||(parent.unit&&root.unit&&parent.unit!==root.unit))throw new c.HttpError(409,"同款商品关联、单位或串号方式不一致，请管理员核对");
  root=parent;
 }
 return root;
}
function target(store,user,source,targetWarehouseId){
 const root=familyRoot(store,source),stocks=store.inventory.filter(s=>s.skuId===source.skuId&&s.warehouseId===targetWarehouseId);
 if(stocks.length>1)throw new c.HttpError(409,"目标仓库存资料重复，请先核对");
 if(stocks.length){validStock(stocks[0]);validSources(stocks[0],details.tracked(source));}
 return {product:source,stock:stocks[0]||{quantity:0,stockValue:0,costPrice:0,serials:[]},exists:!!stocks.length,root};
}
function prepare(store,user,payload){
 permit(user);
 const targetWarehouseId=c.text(payload.targetWarehouseId,"目标仓库");if((!warehouses.byId(targetWarehouseId)||warehouses.byId(targetWarehouseId).active===false))throw new c.HttpError(400,"请选择A、B、C或其他仓作为调拨目标");
 const sourceSkuId=c.text(payload.sourceSkuId,"原商品"),warehouseId=c.text(payload.sourceWarehouseId,"原仓库"),quantity=c.quantity(payload.quantity);
 if(quantity>10000)throw new c.HttpError(400,"单次调拨数量不能超过10000");
 if((!warehouses.byId(warehouseId)||warehouses.byId(warehouseId).active===false))throw new c.HttpError(400,"请选择A、B、C或其他仓的在库商品");
 if(warehouseId===targetWarehouseId)throw new c.HttpError(400,"原仓与目标仓不能相同");
 const source=store.products.find(p=>p.skuId===sourceSkuId);
 if(!source||source.stockManaged===false||source.active===false)throw new c.HttpError(400,"请选择原仓在用的实物商品");
 const rows=store.inventory.filter(s=>s.skuId===sourceSkuId&&s.warehouseId===warehouseId);
 if(rows.length!==1)throw new c.HttpError(404,"原仓没有唯一的商品库存");
 const stock=rows[0];validStock(stock);validSources(stock,details.tracked(source));
 if(stock.quantity<quantity)throw new c.HttpError(409,"原仓库存不足，不能把未收货订货数量调拨");
 const relatedSkuIds=new Set([sourceSkuId,familyRoot(store,source).skuId,...(stock.serials||[]).map(s=>s.originSkuId).filter(Boolean)]),sourceIds=new Set((stock.costSources||[]).filter(s=>s.quantity>0).map(s=>s.sourceId));
 for(const order of store.purchases||[])for(const item of order.items||[])if(sourceIds.has(item.id))relatedSkuIds.add(item.skuId);
 const pending=(store.purchaseReturnRequests||[]).some(r=>r.status==="待老板审核"&&(relatedSkuIds.has(r.skuId)||(r.items||[]).some(i=>relatedSkuIds.has(i.skuId))))||(store.redReversals||[]).some(r=>r.status==="待老板审核"&&r.kind==="purchase"&&(store.purchases||[]).some(p=>p.id===r.sourceId&&(p.items||[]).some(i=>relatedSkuIds.has(i.skuId))));
 if(pending)throw new c.HttpError(409,"该商品有待审核采购退货或红冲，请先核对");
 const reason=c.text(payload.reason,"调拨说明");if(reason.length>500)throw new c.HttpError(400,"调拨说明不能超过500字");
 let serials=[],serialSources=[],sourceCostSources=[],amount;
 if(details.tracked(source)){
  if(!Array.isArray(payload.serialNos)||payload.serialNos.length!==quantity||quantity>200)throw new c.HttpError(400,"串号商品须逐台选择真实在库串号，最多200台");
  const numbers=payload.serialNos.map(no=>c.text(no,"完整串号"));
  if(new Set(numbers).size!==numbers.length)throw new c.HttpError(409,"调拨串号重复");
  serials=numbers.map(no=>{
   const matches=(stock.serials||[]).filter(s=>s.no===no&&details.inStock(s));
   const all=store.inventory.flatMap(s=>(s.serials||[]).filter(x=>x.no===no));
   if(matches.length!==1||all.length!==1)throw new c.HttpError(409,"串号不是原仓唯一的可售实物，已售或待补串号不能调拨："+no);
   if(!Number.isFinite(matches[0].costPrice)||matches[0].costPrice<0)throw new c.HttpError(409,"串号成本不完整，请先核对："+no);
   return matches[0];
  });serialSources=serials.map(serial=>serialOrigin(store,source,serial));amount=c.round(serials.reduce((n,s)=>n+s.costPrice,0));
 }else{
  if(payload.serialNos?.length)throw new c.HttpError(400,"数量商品不能填写串号");
  const sources=stock.costSources||[{sourceId:"untraced",quantity:stock.quantity}];
  sourceCostSources=fifo.enabled(stock)?fifo.take(structuredClone(stock),quantity):sources.map(s=>({sourceId:s.sourceId,quantity:Number((s.quantity*quantity/stock.quantity).toFixed(12))}));
  amount=fifo.enabled(stock)?fifo.total(sourceCostSources):quantity===stock.quantity?stock.stockValue:c.round(stock.stockValue*quantity/stock.quantity);
 }
 if(amount>stock.stockValue||quantity===stock.quantity&&Math.abs(amount-stock.stockValue)>0.000001)throw new c.HttpError(409,"库存总金额与选定实物成本不一致，请先核对");
 const planned=target(store,user,source,targetWarehouseId);
 const sourceBarcode=details.tracked(source)?"":String(source.sourceBarcode||source.barcode||planned.root.sourceBarcode||planned.root.barcode||""),targetBarcodeBefore=details.tracked(source)?"":String(planned.product.sourceBarcode||planned.product.barcode||"");
 if(sourceBarcode&&targetBarcodeBefore&&sourceBarcode!==targetBarcodeBefore)throw new c.HttpError(409,"同款目标仓已有不同原厂条码，已保留原码且未调拨；请先核对型号、包装和商品档案");
 const fingerprint={source,sourceStock:stock,target:planned.exists?{product:planned.product,stock:planned.stock}:planned.product,root:planned.root,targetWarehouseId,quantity,serialNos:serials.map(s=>s.no),amount,reason,sourceCostSources,serialSources};
 return {source,stock,planned,targetWarehouseId,quantity,serials,amount,reason,sourceCostSources,serialSources,sourceBarcode,targetBarcodeBefore,previewToken:hash(fingerprint)};
}
function preview(store,user,payload){
 const p=prepare(store,user,payload),view={sourceSkuId:p.source.skuId,sourceName:p.source.name,sourceWarehouseId:p.stock.warehouseId,sourceWarehouseName:warehouses.byId(p.stock.warehouseId).name,targetWarehouseId:p.targetWarehouseId,targetWarehouseName:warehouses.byId(p.targetWarehouseId).name,targetName:p.planned.product.name,targetSkuId:p.source.skuId,targetExists:p.planned.exists,quantity:p.quantity,serialNos:p.serials.map(s=>s.no),serialSources:p.serialSources,reason:p.reason,previewToken:p.previewToken,sourceBarcode:p.sourceBarcode,targetSourceBarcode:p.targetBarcodeBefore||p.sourceBarcode,sourceQuantityBefore:p.stock.quantity,targetQuantityBefore:p.planned.stock.quantity,sourceQuantityAfter:p.stock.quantity-p.quantity,targetQuantityAfter:p.planned.stock.quantity+p.quantity,amount:p.amount,noCashPosting:true,noSupplierPosting:true,message:"核对实物后确认调拨；同一商品编码在原仓转出、目标仓转入。"};
 if(!c.capabilities(user).cost)delete view.amount;return view;
}
function create(store,user,payload){
 const p=prepare(store,user,payload);
 if(payload.confirmed!==true||payload.previewToken!==p.previewToken)throw new c.HttpError(409,"库存、成本或调拨内容已变化，请重新预览并确认");
 const targetProduct=p.source;
 if(!p.planned.exists){
  store.inventory.push({skuId:p.source.skuId,warehouseId:p.targetWarehouseId,warehouseName:warehouses.byId(p.targetWarehouseId).name,quantity:0,costPrice:0,stockValue:0,serials:[]});
 }
 const destination=store.inventory.find(s=>s.skuId===targetProduct.skuId&&s.warehouseId===p.targetWarehouseId),id=c.id("TR"),at=c.now();
 if(p.sourceBarcode&&!targetProduct.sourceBarcode&&!targetProduct.barcode){targetProduct.sourceBarcode=p.sourceBarcode;targetProduct.sourceBarcodeInheritedFrom={sourceSkuId:p.source.skuId,rootSkuId:p.planned.root.skuId,transferId:id,at,by:user.id};}
 const row={id,sourceBarcode:p.sourceBarcode,targetBarcodeBefore:p.targetBarcodeBefore,targetBarcodeAfter:String(targetProduct.sourceBarcode||targetProduct.barcode||""),status:"completed",kind:"转入"+(p.targetWarehouseId==="wh-other"?"其他":warehouses.byId(p.targetWarehouseId).code)+"仓",sourceSkuId:p.source.skuId,sourceName:p.source.name,sourceWarehouseId:p.stock.warehouseId,targetSkuId:targetProduct.skuId,targetName:targetProduct.name,targetWarehouseId:p.targetWarehouseId,quantity:p.quantity,cost:p.amount,serialNos:p.serials.map(s=>s.no),serials:structuredClone(p.serials),serialSources:p.serialSources,sourceCostSources:p.sourceCostSources,reason:p.reason,operatorId:user.id,operator:user.name,createdAt:at,sourceQuantityBefore:p.stock.quantity,targetQuantityBefore:destination.quantity,sourceValueBefore:p.stock.stockValue,targetValueBefore:destination.stockValue};
 if(details.tracked(p.source)){
  const selected=new Set(row.serialNos);p.stock.serials=(p.stock.serials||[]).filter(s=>!selected.has(s.no));destination.serials||=[];
  for(const serial of p.serials)destination.serials.push({...serial,originSkuId:serial.originSkuId||p.source.skuId,lastTransferId:id,lastTransferredAt:at,lastTransferredBy:user.id});
 }else{
  const taken=costs.take(p.stock,p.quantity);costs.restore(destination,taken,1,p.quantity);
 }
 p.stock.quantity-=p.quantity;p.stock.stockValue=c.round(p.stock.stockValue-p.amount);p.stock.costPrice=p.stock.quantity?Number((p.stock.stockValue/p.stock.quantity).toFixed(6)):0;
 destination.quantity+=p.quantity;destination.stockValue=c.round(destination.stockValue+p.amount);destination.costPrice=Number((destination.stockValue/destination.quantity).toFixed(6));
 for(const [product,stock,sign,type] of [[p.source,p.stock,-1,"调拨转出"],[targetProduct,destination,1,"调拨转入"]])store.movements.unshift({id:c.id("MV"),skuId:product.skuId,product:product.name,warehouseId:stock.warehouseId,warehouseName:warehouses.byId(stock.warehouseId).name,quantity:sign*p.quantity,cost:sign*p.amount,type,sourceId:id,transferId:id,operatorId:user.id,operator:user.name,createdAt:at});
 (store.stockTransfers||=[]).push(row);
 (store.localCatalogNotices||=[]).push({key:"stock-transfer:"+id,kind:"库存调拨",orderId:id,sourceId:id,summary:user.name+" 调拨："+p.source.name+" · "+warehouses.byId(p.stock.warehouseId).name+" → "+warehouses.byId(p.targetWarehouseId).name+" · "+p.quantity+" "+(p.source.unit||"件")+"；商品编码不变，总数量与总成本不变。",amount:null,createdAt:at,readAt:null,localOnly:true});c.audit(store,user,"stock:transfer",id+" · "+p.source.name+" · "+p.stock.warehouseId+" → "+p.targetWarehouseId+" · "+p.quantity+" "+(p.source.unit||"件"));
 return {...visible(row,user),message:"调拨已完成：原仓转出，"+(warehouses.byId(p.targetWarehouseId).name+"入库，商品名称保持一致")+"；库存总数量和总成本不变。"};
}
function list(store,user){permit(user);return(store.stockTransfers||[]).slice(-100).reverse().map(row=>visible(row,user));}
module.exports={preview,create,list,prepare,visible,serialOrigin};
