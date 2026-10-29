'use strict';
const {createHash}=require('node:crypto');
const c=require('./common'),fifo=require('./fifo-costs'),directory=require('./warehouse-directory'),details=require('./inventory-details');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const norm=v=>String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const FAMILIES={E:'E系列钢化膜',M:'M系列水凝膜',G:'G系列光固膜',GB:'GB系列光固膜',MY:'MY系列水凝膜',B:'B系列高清膜'};
const FINANCE=['users','suppliers','warehouseProfiles','purchases','sales','saleReturns','purchaseReturns','supplierEntries','supplierSettlements','supplierCash','receipts','expenses','otherIncome'];
function text(value,label,max=200,optional=false){if(optional&&(value==null||value===''))return '';if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\x00-\x1f\x7f]/.test(value))throw new c.HttpError(400,label+'不正确');return value.trim();}
function owner(store,user){const actual=(store.users||[]).find(u=>u.id===user?.id&&u.status==='active');if(!actual||actual.roleCode!=='owner'||user.roleCode!=='owner'||user.status!=='active'||actual.assistantCustomerOnly||user.assistantCustomerOnly)throw new c.HttpError(403,'只有当前门店老板本人可追加期初库存');return actual;}
function dayOpen(store){if((store.dailyCloseouts||[]).some(d=>d.date===c.day()&&d.status==='已锁定'))throw new c.HttpError(409,'今日已日结锁定，请先完成日结更正流程');}
function openingExists(store){return !!(store.openingCompletedAt||store.openingBalance?.completedAt||(store.openingImportBatches||[]).length||(store.inventory||[]).some(s=>(s.serials||[]).some(u=>u.sourceType==='opening_balance'||u.openingBatch))||(store.movements||[]).some(r=>r.sourceType==='opening_balance'||r.type==='期初建账'));}
function money(value,label){if(value===undefined||value===null||value===''||typeof value==='boolean')throw new c.HttpError(400,label+'必须明确填写，0元请填写0');const n=c.money(value,label),cents=Math.round(n*100);if(!Number.isSafeInteger(cents)||Math.abs(Number(value)-n)>0.000001)throw new c.HttpError(400,label+'最多两位小数');return {value:n,cents};}
function source(payload){
 const sourceFile=text(payload.sourceFile,'来源文件名',200);if(/[\\/]/.test(sourceFile))throw new c.HttpError(400,'来源文件请填写文件名');
 const sourceSHA256=text(payload.sourceSHA256??payload.sourceSha256,'来源文件SHA256',64).toLowerCase();if(!/^[a-f0-9]{64}$/.test(sourceSHA256))throw new c.HttpError(400,'来源SHA256须为64位摘要');
 const sourceSheet=text(payload.sourceSheet||'CSV','来源工作表',100),sourceRef=text(payload.sourceRef,'来源依据编号',200),reason=text(payload.reason,'追加依据',500);if(reason.length<4)throw new c.HttpError(400,'追加依据至少4个字');
 let originalSourceEvidence=null;if(payload.originalSourceEvidence){const e=payload.originalSourceEvidence;const file=text(e.sourceFile,'原始资料文件名',200),sha=text(e.sourceSHA256,'原始资料SHA256',64).toLowerCase();if(!/^[a-f0-9]{64}$/.test(sha))throw new c.HttpError(400,'原始资料摘要不正确');originalSourceEvidence={sourceFile:file,sourceSHA256:sha,sourceSheet:text(e.sourceSheet||'','原始工作表',100,true)};}
 return {sourceFile,sourceSHA256,sourceSheet,sourceRef,reason,originalSourceEvidence};
}
function normalize(store,payload){
 const provenance=source(payload);if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>500)throw new c.HttpError(400,'请提交1至500行非串号期初商品');
 const warehouseId=text(payload.warehouseId,'仓库',100),warehouse=directory.list(store,true).find(w=>w.id===warehouseId&&w.active!==false&&w.code==='B');if(!warehouse)throw new c.HttpError(400,'请选择启用中的B仓配件维修仓库');
 const rows=payload.rows.map(input=>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new c.HttpError(400,'期初商品行不正确');
  const sourceRow=Number(input.sourceRow);if(!Number.isSafeInteger(sourceRow)||sourceRow<1)throw new c.HttpError(400,'来源行号须为正整数');
  const name=text(input.name,'商品名称',200),model=text(input.model||input.shortName,'商品简称/型号',100),sourceBarcode=text(input.sourceBarcode??input.barcode??'','原表编码',120,true);
  const supplierId=text(input.supplierId,'供货商',100),supplier=(store.suppliers||[]).find(s=>s.id===supplierId&&s.active!==false&&s.status!=='inactive');if(!supplier)throw new c.HttpError(400,'第'+sourceRow+'行供货商不存在或已停用，请明确选择');
  const originalSupplier=text(input.supplier||supplier.name,'原表供货商',200);if(payload.sourceSupplierMap&&payload.sourceSupplierMap[originalSupplier]!==supplierId)throw new c.HttpError(400,'原表供货商对应与选择的供货商不一致');
  if(input.quantity===undefined||input.quantity===null||input.quantity===''||typeof input.quantity==='boolean')throw new c.HttpError(400,'第'+sourceRow+'行数量必须明确填写');const quantity=c.number(input.quantity,'数量');if(!Number.isSafeInteger(quantity))throw new c.HttpError(400,'数量须为整数；0数量只建零库存档案');
  const cost=money(input.unitCost,'第'+sourceRow+'行单位进价'),valueCents=quantity*cost.cents;if(!Number.isSafeInteger(valueCents))throw new c.HttpError(400,'该行库存金额超出范围');
  const salePrice=input.salePrice==null||input.salePrice===''?null:money(input.salePrice,'第'+sourceRow+'行零售价').value;
  const prefix=/^(MY|GB|G|E|M|B)\d+$/i.exec(model)?.[1]?.toUpperCase(),thirdType=text(input.thirdType||FAMILIES[prefix]||'','系列分类',100);
  if(input.type!=null&&input.type!=='配件产品'||input.subType!=null&&input.subType!=='保护膜'||input.unit!=null&&input.unit!=='张'||input.trackSerial===true||input.kind==='service')throw new c.HttpError(400,'本入口仅追加B仓按张管理的非串号保护膜');
  if(input.purchaseDate)throw new c.HttpError(400,'本批未提供实际进货日期，请留空；不能以登记日期代替');
  const skuId=text(input.skuId||'','已有商品SKU',120,true);
  return {sourceRow,name,model,sourceBarcode,supplierId:supplier.id,supplier:supplier.name,originalSupplier,quantity,unitCost:cost.value,salePrice,valueCents,value:valueCents/100,skuId,type:'配件产品',subType:'保护膜',thirdType,unit:'张',purchaseDate:''};
 }).sort((a,b)=>a.sourceRow-b.sourceRow);
 if(new Set(rows.map(r=>r.sourceRow)).size!==rows.length)throw new c.HttpError(409,'同一来源行号重复，不能重复追加');
 const newNames=rows.filter(r=>!r.skuId).map(r=>norm(r.name));if(new Set(newNames).size!==newNames.length)throw new c.HttpError(409,'本批有同名新品，请明确商品档案后再追加，不按名称猜匹配');
 const ids=rows.filter(r=>r.skuId).map(r=>r.skuId);if(new Set(ids).size!==ids.length)throw new c.HttpError(409,'同一已有商品在本批出现多次，请先合并核对');
 const batchId='OQA-'+digest({sourceSHA256:provenance.sourceSHA256,sourceSheet:provenance.sourceSheet}).slice(0,32),inputDigest=digest({provenance,warehouseId,rows});
 return {...provenance,warehouseId,warehouseName:warehouse.name,rows,batchId,inputDigest};
}
function priorBatch(store,prepared){
 const same=(store.openingImportBatches||[]).filter(b=>b.id===prepared.batchId||b.kind==='opening_quantity_append'&&b.sourceSHA256===prepared.sourceSHA256&&b.sourceSheet===prepared.sourceSheet);
 if(same.length>1)throw new c.HttpError(409,'期初来源批次重复，请先核对');
 if(same.length&&same[0].inputDigest!==prepared.inputDigest)throw new c.HttpError(409,'该来源已登记不同内容，不能重复追加或更改已入账批次');
 if(!same.length){const overlap=(store.openingImportBatches||[]).find(b=>b.sourceSHA256===prepared.sourceSHA256&&(b.sourceSheet||'Sheet1')===prepared.sourceSheet&&(b.products||[]).some(p=>prepared.rows.some(r=>r.sourceRow===p.sourceRow)));if(overlap)throw new c.HttpError(409,'该文件部分来源行已经入账，请先核对原批次');}
 return same[0]||null;
}
function stockState(stock){if(!Number.isSafeInteger(stock.quantity)||stock.quantity<0||!Number.isFinite(stock.costPrice)||stock.costPrice<0||!Number.isFinite(stock.stockValue)||stock.stockValue<0||!Number.isSafeInteger(Math.round(stock.stockValue*100))||Math.abs(c.round(stock.stockValue)-stock.stockValue)>0.000001||(stock.serials||[]).length)throw new c.HttpError(409,'原商品数量、库存金额或串号异常，请先核对');if(!fifo.enabled(stock)&&(stock.quantity!==0||stock.stockValue!==0))throw new c.HttpError(409,'已有非空库存缺少FIFO批次，不能通过期初追加重估历史成本');fifo.assertStock(stock);}
function plan(store,p){
 const virtual={products:store.products||[],productCodeSequence:store.productCodeSequence},codes=new Map();for(const r of p.rows)if(r.sourceBarcode)codes.set(r.sourceBarcode,(codes.get(r.sourceBarcode)||0)+1);
 return p.rows.map(row=>{
  let product=null,stock=null;if(row.skuId){product=(store.products||[]).find(p=>p.skuId===row.skuId);if(!product||product.active===false||product.stockManaged===false||details.tracked(product)||product.warehouseId!==p.warehouseId||product.unit!=='张')throw new c.HttpError(409,'明确选择的已有商品不是当前B仓可用的按张管理商品');if(row.salePrice!=null&&Number(product.salePrice)!==row.salePrice)throw new c.HttpError(409,'已有商品零售价与原表不同，请先走独立调价审批：'+row.name);const stocks=(store.inventory||[]).filter(s=>s.skuId===product.skuId&&(s.warehouseId||'wh-sale')===p.warehouseId);if(stocks.length!==1)throw new c.HttpError(409,'已有商品仓库记录缺失或重复');stock=stocks[0];stockState(stock);}
  else{const matches=(store.products||[]).filter(p=>norm(p.name)===norm(row.name));if(matches.length){const error=new c.HttpError(409,'已有同名商品 '+row.name+'，请明确选择SKU，不会自动匹配或重复建档');error.candidates=matches.map(p=>({skuId:p.skuId,name:p.name,warehouseId:p.warehouseId,code:p.externalCode}));throw error;}}
  const collision=row.sourceBarcode&&(store.products||[]).some(other=>other.skuId!==product?.skuId&&(other.barcode===row.sourceBarcode||(other.legacyExternalCodes||[]).includes(row.sourceBarcode)));
  if(collision)throw new c.HttpError(409,'原表编码已能定位另一商品，请先核实共用厂码并使用独立商品二维码：'+row.sourceBarcode);
  const sharedSourceBarcode=!!row.sourceBarcode&&codes.get(row.sourceBarcode)>1,quantityBefore=stock?.quantity||0,stockValueBefore=stock?.stockValue||0;
  const quantityAfter=quantityBefore+row.quantity,valueCents=Math.round(stockValueBefore*100)+row.valueCents;if(!Number.isSafeInteger(quantityAfter)||!Number.isSafeInteger(valueCents))throw new c.HttpError(400,'追加后的数量或金额超出范围');
  return {...row,action:product?'append':'create',code:product?.externalCode||require('./product-codes').next(virtual),sharedSourceBarcode,quantityBefore,quantityAfter,stockValueBefore,stockValueAfter:valueCents/100,sourceId:p.batchId+':R'+row.sourceRow};
 });
}
function fingerprint(store,p,rows,actorId){return digest({actorId,input:p,rows,products:store.products,inventory:store.inventory,suppliers:store.suppliers,history:store.openingImportBatches,warehouseProfiles:store.warehouseProfiles,categories:store.productCategoryCatalog,productCodeSequence:store.productCodeSequence,costBatchSequence:store.costBatchSequence,closeouts:store.dailyCloseouts});}
function summary(p,rows){return {batchId:p.batchId,sourceFile:p.sourceFile,sourceSHA256:p.sourceSHA256,sourceSheet:p.sourceSheet,sourceRef:p.sourceRef,reason:p.reason,originalSourceEvidence:p.originalSourceEvidence,warehouseId:p.warehouseId,warehouseName:p.warehouseName,rows,productCount:rows.length,totalQuantity:rows.reduce((n,r)=>n+r.quantity,0),totalValue:rows.reduce((n,r)=>n+r.valueCents,0)/100,newProducts:rows.filter(r=>r.action==='create').length,existingProducts:rows.filter(r=>r.action==='append').length,zeroQuantityProducts:rows.filter(r=>r.quantity===0).length,zeroCostQuantity:rows.filter(r=>r.unitCost===0).reduce((n,r)=>n+r.quantity,0),retailPriceProvided:rows.filter(r=>r.salePrice!=null).length,noNewPayments:true,noCashPosting:true,noPurchasePosting:true,costsKnown:true,purchaseDate:''};}
function preview(store,user,payload){
 const actor=owner(store,user);dayOpen(store);if(!openingExists(store))throw new c.HttpError(409,'当前账套尚无期初基线，请先使用完整期初建账');const p=normalize(store,payload),prior=priorBatch(store,p);
 if(prior)return {...prior,id:prior.id,alreadyImported:true,rows:prior.products,message:'此来源批次已经登记；重试不会增加库存。'};
 const rows=plan(store,p),result=summary(p,rows);result.previewToken=fingerprint(store,p,rows,actor.id);result.message=`将新增 ${result.newProducts} 个商品档案，追加 ${result.totalQuantity} 张，期初库存金额 ${result.totalValue} 元；${result.zeroQuantityProducts} 项只建零库存档案，不生成采购或收付款。`;return result;
}
function confirm(store,user,payload){
 const actual=owner(store,user);dayOpen(store);const p=normalize(store,payload),prior=priorBatch(store,p);if(prior)return {...prior,id:prior.id,alreadyImported:true,message:'此来源批次已登记，库存没有重复增加。'};
 const prepared=preview(store,actual,payload);if(payload.confirmed!==true)throw new c.HttpError(400,'请核对预览并确认期初库存追加');if(!prepared.previewToken||payload.previewToken!==prepared.previewToken)throw new c.HttpError(409,'商品、库存或来源资料已变化，请重新预览');
 const financeBefore=digest(FINANCE.map(k=>[k,store[k]||[]])),quantityBefore=(store.inventory||[]).reduce((n,s)=>n+s.quantity,0),valueBefore=c.round((store.inventory||[]).reduce((n,s)=>n+s.stockValue,0));
 const stage=structuredClone(store),actor=(stage.users||[]).find(u=>u.id===actual.id),at=c.now(),products=[],reviewIds=new Set((store.catalogAdditionReviews||[]).map(r=>r.id));directory.remember(stage);
 for(const row of prepared.rows){
  let product=row.skuId?stage.products.find(p=>p.skuId===row.skuId):null;
  if(!product){const saved=require('./erp').saveProduct(stage,actor,{name:row.name,shortName:row.model,type:row.type,subType:row.subType,thirdType:row.thirdType,kind:'physical',trackSerial:false,unit:'张',salePrice:row.salePrice??0,aliases:[row.model,...(row.sourceBarcode?[row.sourceBarcode]:[])]},{internal:true,initialWarehouseId:p.warehouseId});product=stage.products.find(p=>p.skuId===saved.skuId);if(product.externalCode!==row.code)throw new c.HttpError(409,'商品编号已变化，请重新预览');product.costPrice=row.unitCost;product.supplierId=row.supplierId;product.supplierName=row.supplier;}
  const stock=stage.inventory.find(s=>s.skuId===product.skuId&&(s.warehouseId||'wh-sale')===p.warehouseId);if(!stock)throw new c.HttpError(409,'商品库存行未建立，本次未追加');stockState(stock);
  product.defaultCostPrice=row.unitCost;product.costPriceKnown=true;product.costNeedsConfirmation=false;product.aliases=[...new Set([...(product.aliases||[]),row.model,...(row.sourceBarcode?[row.sourceBarcode]:[])])];
  if(row.sourceBarcode){product.sourceBarcode=row.sourceBarcode;product.sharedSourceBarcode=row.sharedSourceBarcode;if(!row.sharedSourceBarcode){product.legacyExternalCodes=[...new Set([...(product.legacyExternalCodes||[]),row.sourceBarcode])];if(!product.barcode)product.barcode=row.sourceBarcode;}}
  const priorSource=product.importSource||{},fields={'商品名':row.name,'简称':row.model,'编码':row.sourceBarcode,'数量':row.quantity,'供货商':row.originalSupplier,'进价':row.unitCost,...(row.salePrice!=null?{'卖价':row.salePrice}:{})};
  product.importSource={...priorSource,sourceFile:p.sourceFile,sourceSHA256:p.sourceSHA256,sourceSheet:p.sourceSheet,sourceRow:row.sourceRow,sourceBatchId:p.batchId,sourceBatchIds:[...new Set([...(priorSource.sourceBatchIds||[]),...(priorSource.sourceBatchId?[priorSource.sourceBatchId]:[]),p.batchId])],previousSources:[...(priorSource.previousSources||[]),...(priorSource.sourceBatchId?[{sourceFile:priorSource.sourceFile,sourceSHA256:priorSource.sourceSHA256,sourceSheet:priorSource.sourceSheet,sourceRow:priorSource.sourceRow,sourceBatchId:priorSource.sourceBatchId,fields:priorSource.fields}]:[])],fields,quantityProvided:true,unitCostProvided:true,costNeedsConfirmation:false,zeroCostConfirmed:row.unitCost===0,retailPriceProvided:row.salePrice!=null||priorSource.retailPriceProvided||false,stockDateProvided:false,originalSourceEvidence:p.originalSourceEvidence,sourceRef:p.sourceRef};
  if(row.quantity>0){if(!fifo.receive(stage,stock,row.sourceId,row.quantity,row.unitCost))throw new c.HttpError(409,'原库存不支持FIFO追加，本次未入账');stock.quantity+=row.quantity;stock.stockValue=c.round(stock.stockValue+row.value);stock.costPrice=Number((stock.stockValue/stock.quantity).toFixed(6));stock.costPriceKnown=true;stage.movements.unshift({id:c.id('OB'),type:'期初建账',sourceType:'opening_balance',sourceId:row.sourceId,sourceBatchId:p.batchId,skuId:product.skuId,externalCode:product.externalCode,product:product.name,quantity:row.quantity,cost:row.value,warehouseId:p.warehouseId,warehouseName:p.warehouseName,supplierId:row.supplierId,supplier:row.supplier,purchaseDate:'',operatorId:actor.id,operator:actor.name,createdAt:at});}
  else if(row.action==='create'){stock.costPrice=row.unitCost;stock.costPriceKnown=true;}
  fifo.assertStock(stock);products.push({...row,skuId:product.skuId,code:product.externalCode,sourceSHA256:p.sourceSHA256,sourceSheet:p.sourceSheet,purchaseDate:'',costKnown:true,originalSourceEvidence:p.originalSourceEvidence});
 }
 const base=summary(p,products),batch={...base,id:p.batchId,kind:'opening_quantity_append',inputDigest:p.inputDigest,sourceType:'opening_balance',sourceSupplierMap:payload.sourceSupplierMap||Object.fromEntries(products.map(r=>[r.originalSupplier,r.supplierId])),quantity:base.totalQuantity,stockValue:base.totalValue,products,operatorId:actor.id,operator:actor.name,createdAt:at};delete batch.rows;
 (stage.openingImportBatches||=[]).push(batch);c.audit(stage,actor,'opening:quantity-append',{batchId:p.batchId,sourceFile:p.sourceFile,sourceSHA256:p.sourceSHA256,sourceSheet:p.sourceSheet,reason:p.reason,productCount:base.productCount,quantity:base.totalQuantity,stockValue:base.totalValue,zeroCostQuantity:base.zeroCostQuantity,zeroQuantityProducts:base.zeroQuantityProducts,noNewPayments:true});
 for(const review of stage.catalogAdditionReviews||[])if(!reviewIds.has(review.id)&&['待老板核对','需完善'].includes(review.status))require('./catalog-reviews').review(stage,actor,{id:review.id,decision:'confirm',note:'老板按本次期初追加预览确认：'+p.reason});
 if(digest(FINANCE.map(k=>[k,stage[k]||[]]))!==financeBefore||(stage.inventory||[]).reduce((n,s)=>n+s.quantity,0)!==quantityBefore+base.totalQuantity||c.round((stage.inventory||[]).reduce((n,s)=>n+s.stockValue,0))!==c.round(valueBefore+base.totalValue))throw new c.HttpError(409,'期初追加数量、金额或财务守恒未通过，本次未入账');
 fifo.assertStore(stage);for(const key of ['products','inventory','movements','openingImportBatches','operationLogs','catalogAdditionReviews','localCatalogNotices','productCategoryCatalog','costBatchSequence','productCodeSequence'])if(Object.hasOwn(stage,key))store[key]=stage[key];directory.remember(store);
 return {...batch,alreadyImported:false,message:`期初追加完成：${products.length}款、${base.totalQuantity}张、库存金额${base.totalValue}元；原有库存和资金流水保留。`};
}
module.exports={preview,confirm,FAMILIES};
