'use strict';
// Invoked inside the normal authenticated repository transaction. Only opening
// omissions are appended; purchases and all money records remain untouched.
const {createHash}=require('node:crypto');
const c=require('./common'),directory=require('./warehouse-directory'),codes=require('./product-codes'),details=require('./inventory-details');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const FINANCE=['purchases','supplierEntries','supplierSettlements','supplierCash','receipts','expenses','otherIncome','sales','saleReturns','purchaseReturns'];
const HISTORY=['inventory','purchases','sales','saleReturns','purchaseReturns','saleReturnRequests','purchaseReturnRequests','saleExchanges','stockTransfers','openingImportBatches','serialSourceCorrections','usedPhones','usedPhoneAssessments','usedPhonePurchases','stocktakes','stocktakeSheets','movements'];
function owner(store,user){
 const actual=(store.users||[]).find(x=>x.id===user?.id&&x.status==='active');
 if(!actual||user.status!=='active'||actual.roleCode!=='owner'||user.roleCode!=='owner'||actual.assistantCustomerOnly||user.assistantCustomerOnly)throw new c.HttpError(403,'追加期初手机须由在职老板本人操作');
 return actual;
}
function clean(value,label,max=120,optional=false){
 if(optional&&(value==null||value===''))return '';const text=c.text(value,label).normalize('NFKC');
 if(text.length>max||/[\x00-\x1f\x7f]/.test(text))throw new c.HttpError(400,label+'过长或含换行控制字符');return text;
}
function money(value,label,positive=false){const n=c.money(value,label);if(positive&&n<=0)throw new c.HttpError(400,label+'须大于零');if(Math.abs(Number(value)-n)>0.000001)throw new c.HttpError(400,label+'最多保留两位小数');return n;}
function date(value){
 if(value==null||value==='')return '';const text=String(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text||text>c.day())throw new c.HttpError(400,'实际进货日期须为有效日期且不能在未来');return text;
}
function assertPhase(store){
 const baseline=store.openingBalance?.status==='completed'||(store.openingImportBatches||[]).length||(store.inventory||[]).some(s=>(s.serials||[]).some(v=>v.sourceType==='opening_balance'||v.openingBatch));
 if(!baseline)throw new c.HttpError(409,'尚无期初建账基线，请先完成期初建账');
 if((store.dailyCloseouts||[]).some(d=>d.date===c.day()&&d.status==='已锁定'))throw new c.HttpError(409,'今日扎账已锁定，请先按日结流程解锁后再补录');
}
function serialHistory(store){
 const found=new Set();
 const arrayKeys=new Set(['serials','serialNos','actualSerials','expectedSerials','missingSerials','extraSerials','boundSerials']);
 const recorded=value=>typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value);
 const add=value=>{const key=serialKey(value);if(key)found.add(key);};
 function scan(value,key=''){
  if(Array.isArray(value)){for(const item of value)if(recorded(item)&&arrayKeys.has(key))add(item);else scan(item,key);return;}
  if(value&&typeof value==='object'){for(const [name,item]of Object.entries(value))scan(item,name);return;}
  if(recorded(value)&&['serialNo','no'].includes(key))add(value);
 }
 for(const key of HISTORY)scan(store[key]||[]);return found;
}
// Compare recorded serials without discarding historical formats. Only this
// key is case-normalized; a newly accepted serial is stored exactly as entered.
function serialKey(value){return String(value??'').trim().toUpperCase();}
function serialNumber(value,type){
 const no=c.text(value,'完整手机串号');
 if(!/^[0-9]{15}$/.test(no)&&!(type==='功能机'&&/^(?=.*[A-Z])[A-Z0-9]{15}$/.test(no)))throw new c.HttpError(400,type==='功能机'?'功能机须填写完整15位数字串号，或原表15位大写英文字母数字串号':'请逐台填写完整15位数字手机串号');
 return no;
}
function provenance(value){
 if(value==null)return null;if(typeof value!=='object'||Array.isArray(value))throw new c.HttpError(400,'原表行依据格式不正确');
 const sheet=clean(value.sheet,'原表工作表名称',80),row=Number(value.row);
 if(!Number.isSafeInteger(row)||row<1||row>1048576)throw new c.HttpError(400,'请填写真实原表行号');return {sheet,row};
}
const kind=value=>({'智能手机':'智能机','功能手机':'功能机','二手机':'二手手机'})[value]||value;
const identity=row=>JSON.stringify([row.name,row.type,row.subType,row.thirdType,row.unit,row.warehouseId]);
function phoneTotals(store,warehouseId){
 const phones=new Set((store.products||[]).filter(p=>p.stockManaged!==false&&details.tracked(p)&&details.phone(p)).map(p=>p.skuId));
 const stocks=(store.inventory||[]).filter(s=>s.warehouseId===warehouseId&&phones.has(s.skuId));
 if(stocks.some(s=>!Number.isSafeInteger(s.quantity)||s.quantity<0||!Number.isFinite(s.stockValue)||s.stockValue<0))throw new c.HttpError(409,'A仓手机数量或成本数据异常，请先核对');
 return {units:stocks.reduce((n,s)=>n+s.quantity,0),stockValue:c.round(stocks.reduce((n,s)=>n+s.stockValue,0))};
}
function stockCheck(store,product){
 const matches=(store.inventory||[]).filter(s=>s.skuId===product.skuId&&s.warehouseId===product.warehouseId);
 if(matches.length>1)throw new c.HttpError(409,'该型号仓库库存记录重复，请先核对');const stock=matches[0];if(!stock)return null;
 if(!Number.isSafeInteger(stock.quantity)||stock.quantity<0||!Number.isFinite(stock.stockValue)||stock.stockValue<0||stock.costingMethod==='fifo-v1')throw new c.HttpError(409,'原型号库存数量或成本口径异常，请先核对');
 const serials=(stock.serials||[]).filter(details.inStock);
 if(serials.length!==stock.quantity||serials.some(s=>!Number.isFinite(s.costPrice)||s.costPrice<0)||Math.round(serials.reduce((n,s)=>n+s.costPrice,0)*100)!==Math.round(stock.stockValue*100))throw new c.HttpError(409,'原型号串号数量或逐台成本与账面不一致，请先核对');return stock;
}
function prepare(store,user,payload){
 const actor=owner(store,user);assertPhase(store);
 const warehouseId=clean(payload.warehouseId,'仓库',80),warehouse=directory.list(store,true).find(w=>w.id===warehouseId);
 if(warehouseId!=='wh-a'||!warehouse||warehouse.active===false)throw new c.HttpError(400,'本入口只可追加到在用A仓，请明确选择A仓');
 const sourceRef=clean(payload.sourceRef,'期初补录来源依据',300),reason=clean(payload.reason,'期初漏录说明',500);if(reason.length<4)throw new c.HttpError(400,'期初漏录说明至少4字');
 const sourceFile=clean(payload.sourceFile,'原表文件名',160,true),sourceSha256=String(payload.sourceSha256||'').toLowerCase();
 if(!!sourceFile!==!!sourceSha256||sourceSha256&&!/^[a-f0-9]{64}$/.test(sourceSha256)||/[\\/]/.test(sourceFile))throw new c.HttpError(400,'原表文件名与真实SHA256须同时填写，文件名不含路径');
 if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>100)throw new c.HttpError(400,'请逐台填写1至100台期初手机');
 const existingSerials=serialHistory(store),seen=new Set(),newNames=new Map(),warnings=[],sourceRows=new Set();
 const usedSourceRows=new Set((store.openingImportBatches||[]).flatMap(b=>(b.products||[]).map(p=>p.sourceRowKey).filter(Boolean)));
 const rows=payload.rows.map((input,index)=>{
  if(!input||typeof input!=='object')throw new c.HttpError(400,'第'+(index+1)+'台资料不正确');
  const name=clean(input.name,'完整型号名称',160),type=kind(clean(input.type,'手机分类',30)),subType=clean(input.subType,'品牌',60),thirdType=clean(input.thirdType,'三级分类',60,true),unit=input.unit==null?'台':clean(input.unit,'单位',8);
  if(!['智能机','功能机','二手手机'].includes(type)||unit!=='台')throw new c.HttpError(400,'只可补录按串号管理的手机，单位须为台');
  const serialNo=serialNumber(input.serialNo,type),key=serialKey(serialNo);
  if(seen.has(key)||existingSerials.has(key))throw new c.HttpError(409,'串号 '+serialNo+' 已在库存或历史记录中，不能重复追加');seen.add(key);
  if(input.quantity!=null&&Number(input.quantity)!==1)throw new c.HttpError(400,'每个完整串号只能对应1台手机');
  const costPrice=money(input.costPrice,'该台期初成本',true),hasPrice=input.salePrice!==undefined&&input.salePrice!==null&&input.salePrice!=='',requestedPrice=hasPrice?money(input.salePrice,'预设售价'):null;
  const supplierId=clean(input.supplierId,'已有供货商',120),supplier=(store.suppliers||[]).find(s=>s.id===supplierId&&s.active!==false&&s.status!=='inactive');if(!supplier)throw new c.HttpError(400,'供货商不存在或已停用，请先核对档案');
  const actualPurchaseDate=date(input.actualPurchaseDate),rowProvenance=provenance(input.rowProvenance);if(rowProvenance&&!sourceSha256)throw new c.HttpError(400,'原表工作表和行号需配套真实文件SHA256');
  const sourceRowKey=rowProvenance?hash({sourceSha256,...rowProvenance}):'';if(sourceRowKey&&(sourceRows.has(sourceRowKey)||usedSourceRows.has(sourceRowKey)))throw new c.HttpError(409,'这条原表行已经提交期初补录，请核对原记录');if(sourceRowKey)sourceRows.add(sourceRowKey);
  const skuId=clean(input.skuId,'明确选择的已有型号',120,true),shape={name,type,subType,thirdType,unit,warehouseId};let salePrice=requestedPrice??0,action='new';
  if(skuId){
   const product=(store.products||[]).find(p=>p.skuId===skuId);if(!product||product.active===false||product.stockManaged===false||!details.tracked(product)||identity({...product,type:kind(product.type),subType:product.subType||'',thirdType:product.thirdType||''})!==identity(shape))throw new c.HttpError(409,'所选原型号的名称、分类、单位或仓库不一致，请重新选择');
   if(hasPrice&&requestedPrice!==Number(product.salePrice))throw new c.HttpError(409,'已有型号的预设售价不能在期初补录中修改，请沿用原价');stockCheck(store,product);salePrice=Number(product.salePrice)||0;action='existing';
  }else{
   if((store.products||[]).some(p=>p.warehouseId===warehouseId&&String(p.name).normalize('NFKC')===name))throw new c.HttpError(409,'A仓已有同名型号，请明确选择原商品编号，不能重复建档');
   const key=identity(shape),prior=newNames.get(key);if(prior!=null&&prior!==salePrice)throw new c.HttpError(409,'同一新型号的预设售价须保持一致');newNames.set(key,salePrice);
   const paths=require('./product-categories').allPaths(store,warehouseId);if(paths.size&&!([...paths.values()].some(p=>JSON.stringify(p)===JSON.stringify([type,subType,thirdType].filter(Boolean)))))throw new c.HttpError(409,'所填手机分类/品牌不在A仓现有目录，请先核对分类');
   if(!hasPrice&&!warnings.includes(name+' 未设预设售价，追加后显示0待补'))warnings.push(name+' 未设预设售价，追加后显示0待补');
  }
  return {...shape,serialNo,quantity:1,costPrice,salePrice,supplierId,supplier:supplier.name,actualPurchaseDate,skuId,action,rowProvenance,sourceRowKey};
 });
 const totals=phoneTotals(store,warehouseId),existingUnits=totals.units,existingStockValue=totals.stockValue,stockValue=c.round(rows.reduce((n,r)=>n+r.costPrice,0));
 return {actor,sourceRef,reason,sourceFile,sourceSha256,warehouse,rows,warnings,summary:{existingUnits,units:rows.length,totalUnitsAfter:existingUnits+rows.length,existingStockValue,stockValue,totalStockValueAfter:c.round(existingStockValue+stockValue),newProducts:newNames.size,warehouseId,warehouseName:warehouse.name}};
}
function fingerprint(store){return hash({products:store.products,inventory:store.inventory,suppliers:store.suppliers,history:HISTORY.map(k=>[k,store[k]||[]]),warehouseProfiles:store.warehouseProfiles,categories:store.productCategoryCatalog,productCodeSequence:store.productCodeSequence,dailyCloseouts:store.dailyCloseouts});}
function preview(store,user,payload){
 const p=prepare(store,user,payload),result={mode:'opening_append',sourceRef:p.sourceRef,reason:p.reason,sourceFile:p.sourceFile,sourceSha256:p.sourceSha256,rows:p.rows,summary:p.summary,warnings:p.warnings,noNewCash:true,noNewPayable:true,message:'仅追加漏录的期初手机及真实库存成本；原库存与历史单据保留，进货日期未知则继续待补。'};
 return {...result,previewToken:hash({actorId:p.actor.id,result,state:fingerprint(store)})};
}
function confirm(store,user,payload){
 const actor=owner(store,user),view=preview(store,actor,payload);
 if(payload.confirmed!==true)throw new c.HttpError(400,'请先逐台核对期初追加预览');
 if(payload.previewToken!==view.previewToken)throw new c.HttpError(409,'库存、来源证据或基础资料已变化，请重新预览');
 const financeBefore=hash(FINANCE.map(k=>[k,store[k]||[]])),at=c.now(),id='OBA-'+hash({sourceRef:view.sourceRef,sourceSha256:view.sourceSha256,serials:view.rows.map(r=>r.serialNo).sort()}).slice(0,24);
 if((store.openingImportBatches||[]).some(b=>b.id===id||b.batchId===id))throw new c.HttpError(409,'该期初追加批次已入账，请刷新库存核对');
 const next={...store,products:(store.products||[]).slice(),inventory:(store.inventory||[]).map(s=>structuredClone(s)),movements:(store.movements||[]).slice(),openingImportBatches:(store.openingImportBatches||[]).slice()},created=new Map(),products=[];
 for(const row of view.rows){
  let product=row.skuId?next.products.find(p=>p.skuId===row.skuId):created.get(identity(row));
  if(!product){product={skuId:c.id('SKU'),externalCode:codes.next(next),name:row.name,shortName:row.name,type:row.type,subType:row.subType,thirdType:row.thirdType,unit:'台',stockManaged:true,trackSerial:true,warehouseId:row.warehouseId,costPrice:row.costPrice,salePrice:row.salePrice,active:true,openingSourceId:id};next.products.push(product);created.set(identity(row),product);}
  let stock=next.inventory.find(s=>s.skuId===product.skuId&&s.warehouseId===row.warehouseId);if(!stock){stock={skuId:product.skuId,warehouseId:row.warehouseId,warehouseName:view.summary.warehouseName,quantity:0,costPrice:0,stockValue:0,serials:[]};next.inventory.push(stock);}
  stock.quantity++;stock.stockValue=c.round(stock.stockValue+row.costPrice);stock.costPrice=Number((stock.stockValue/stock.quantity).toFixed(6));
  const serial={no:row.serialNo,status:'可售',costPrice:row.costPrice,sourceType:'opening_balance',sourceId:id,openingBatch:id,openingSupplierId:row.supplierId,openingSupplier:row.supplier,actualPurchaseDate:row.actualPurchaseDate,sourceRef:view.sourceRef,sourceFile:view.sourceFile,sourceSha256:view.sourceSha256,rowProvenance:row.rowProvenance,openingAppendedAt:at,openingAppendedBy:actor.id};
  stock.serials.push(serial);products.push({...row,skuId:product.skuId,externalCode:product.externalCode,sourceId:id,serials:[row.serialNo]});
  next.movements.unshift({id:c.id('MV'),skuId:product.skuId,product:product.name,warehouseId:row.warehouseId,warehouseName:stock.warehouseName,quantity:1,cost:row.costPrice,type:'期初漏录追加',sourceType:'opening_balance',sourceId:id,serialNo:row.serialNo,operatorId:actor.id,operator:actor.name,createdAt:at});
 }
 next.openingImportBatches.push({id,batchId:id,kind:'opening_append',status:'completed',sourceType:'opening_balance',sourceRef:view.sourceRef,sourceFile:view.sourceFile,sourceSha256:view.sourceSha256,reason:view.reason,products,units:view.summary.units,stockValue:view.summary.stockValue,operatorId:actor.id,operator:actor.name,createdAt:at});
 const afterTotals=phoneTotals(next,view.summary.warehouseId),otherStocks=s=>(s.inventory||[]).filter(stock=>stock.warehouseId!==view.summary.warehouseId);
 if(hash(FINANCE.map(k=>[k,next[k]||[]]))!==financeBefore||afterTotals.units!==view.summary.totalUnitsAfter||afterTotals.stockValue!==view.summary.totalStockValueAfter||JSON.stringify(otherStocks(store))!==JSON.stringify(otherStocks(next)))throw new c.HttpError(409,'期初追加数量、成本或财务守恒检查未通过');
 store.products=next.products;store.inventory=next.inventory;store.movements=next.movements;store.openingImportBatches=next.openingImportBatches;store.productCodeSequence=next.productCodeSequence;
 c.audit(store,actor,'stock:opening-append',JSON.stringify({id,units:view.summary.units,stockValue:view.summary.stockValue,serialNos:view.rows.map(r=>r.serialNo),sourceRef:view.sourceRef,sourceSha256:view.sourceSha256,reason:view.reason,noNewCash:true,noNewPayable:true}));
 return {id,mode:'opening_append',rows:products,summary:view.summary,noNewCash:true,noNewPayable:true,message:'已追加 '+products.length+' 台期初手机，新增库存成本 '+view.summary.stockValue.toFixed(2)+' 元；没有新增采购、应付或收付款。'};
}
module.exports={preview,confirm};
