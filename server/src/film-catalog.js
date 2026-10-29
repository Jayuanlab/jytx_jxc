"use strict";
const {createHash}=require('node:crypto');
const c=require('./common');
const erp=require('./erp');
const warehouses=require('./warehouses');
const details=require('./inventory-details');
const FAMILIES=Object.freeze([{id:'mfs',name:'膜法师资料系列',prefix:'MFS'},{id:'ey',name:'EY资料系列',prefix:'EY'},{id:'mc',name:'麦橙资料系列',prefix:'MC'},{id:'yzs',name:'一座山资料系列',prefix:'B'}]);
const SERVICE_CODE='FILM-SERVICE';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g,'');
const fail=(status,message,code)=>{const error=new c.HttpError(status,message);if(code)error.code=code;throw error;};
function currentUser(store,user,owner=false){
 const actual=(store.users||[]).find(row=>row.id===user?.id);
 if(!actual||actual.status!=='active'||actual.roleCode!==user.roleCode||actual.assistantCustomerOnly===true||user.assistantCustomerOnly===true||['personal-assistant','customer-assistant'].includes(actual.roleCode))fail(403,'此账号不能访问门店膜管理');
 const caps=c.capabilities(actual);
 if(owner?actual.roleCode!=='owner':!['sell','purchase','stocktake','manageProducts'].some(key=>caps[key]))fail(403,owner?'膜资料批量导入须由老板本人确认':'当前岗位没有膜库存查询权限');
 return actual;
}
function family(id){const row=FAMILIES.find(value=>value.id===id);if(!row)fail(400,'请选择膜法师、EY、麦橙或一座山资料系列');return row;}
function string(value,label,max=300,optional=false){if(optional&&(value==null||value===''))return '';if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,label+'不正确');return value.trim();}
function locator(value,source){
 if(value==null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||value.file!==source.file||value.sha256!==source.sha256||typeof value.sheet!=='string'||!value.sheet||!/^\$?[A-Z]+\$?\d+$/.test(value.cell||''))fail(400,'膜资料来源单元格无法核对');
 return {file:source.file,sha256:source.sha256,sheet:value.sheet,cell:value.cell,...(Number.isSafeInteger(value.row)?{row:value.row}:{}),...(Number.isSafeInteger(value.column)?{column:value.column}:{}),...(value.mergedRange?{mergedRange:String(value.mergedRange)}:{})};
}
function prepareCatalog(catalog){
 if(['maicheng-v1','yizuoshan-v1'].includes(catalog?.kind))return require('./film-maicheng').prepareCatalog(catalog);
 if(!catalog||typeof catalog!=='object'||Array.isArray(catalog)||!Array.isArray(catalog.sources)||catalog.sources.length!==2||!Array.isArray(catalog.rows)||!catalog.rows.length||catalog.rows.length>2000)fail(400,'膜通用表资料格式不正确');
 const sources=catalog.sources.map(source=>{if(!source||typeof source!=='object'||Array.isArray(source))fail(400,'膜资料来源不正确');return {id:string(source.id,'来源编号',100),file:string(source.file,'来源文件名',200),sha256:string(source.sha256,'来源摘要',64)};});
 if(new Set(sources.map(source=>source.id)).size!==sources.length||sources.some(source=>!/^\w[\w-]*$/.test(source.id)||!/^[a-f0-9]{64}$/.test(source.sha256)))fail(400,'膜资料来源编号或摘要不正确');
 const sourceDigest=createHash('sha256').update(JSON.stringify(sources.map(({file,sha256})=>({file,sha256})))).digest('hex');
 if(catalog.sourceDigest!==sourceDigest)fail(409,'膜资料来源版本摘要不一致');
 const rows=catalog.rows.map(input=>{
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'膜资料行不正确');
  const f=family(input.family),source=sources.find(value=>value.id===input.sourceId);
  if(!source||input.sourceId!==(input.family==='mfs'?'source-1':'source-2')||input.sourceFile!==source.file||input.sourceSHA256!==source.sha256)fail(400,'膜资料行与来源文件不一致');
  const sourceCode=string(input.sourceCode,'原表膜编号',30).toUpperCase();
  if(!/^(?:E|G|U|GB)\d{1,4}$/.test(sourceCode))fail(400,'原表膜编号不正确');
  for(const key of ['inventoryQuantity','purchasePrice','salePrice','barcode','unit','warehouse'])if(input[key]!=null)fail(400,'通用型号表不能作为实际库存、价格或仓库数据');
  if(!Array.isArray(input.fragments)||input.fragments.length>200||!Array.isArray(input.locators)||['qualifiersRaw','primaryModelsRaw','sourceRecordIds','sourceCodeRaw'].some(key=>input[key]!=null&&!Array.isArray(input[key])))fail(400,'通用型号原文或单元格资料不正确');
  const fragments=input.fragments.map(fragment=>{
   if(!fragment||typeof fragment!=='object'||Array.isArray(fragment)||!Array.isArray(fragment.tokens)||fragment.tokens.length>500||fragment.semanticExpansion===true)fail(400,'只允许保留原表明确型号，不展开简写');
   const raw=string(fragment.raw,'通用型号原文',12000),tokens=fragment.tokens.map(token=>string(token,'原文型号片段',1000));
   if(JSON.stringify(tokens)!==JSON.stringify(raw.split('/').map(value=>value.trim()).filter(Boolean)))fail(400,'通用型号片段不在原文中');
   return {brand:string(fragment.brand,'原表品牌',100,true)||null,raw,tokens,locator:locator(fragment.locator,source),brandLocator:locator(fragment.brandLocator,source),semanticExpansion:false};
  });
  const filmType=string(input.filmType,'原表膜类',200,true)||'待核';
  const fields={catalogKey:f.id+':'+sourceCode,family:f.id,sourceCode,filmType,filmTypeStatus:filmType==='待核'?'pending':'source-explicit',qualifiersRaw:(input.qualifiersRaw||[]).map(value=>string(value,'原编号说明',500)),primaryModelsRaw:(input.primaryModelsRaw||[]).map(value=>string(value,'原表主型号',1000)),fragments,sourceFile:source.file,sourceSHA256:source.sha256,locators:input.locators.map(value=>locator(value,source)).filter(Boolean),sourceRecordIds:(input.sourceRecordIds||[]).map(value=>string(value,'原资料记录编号',300)),sourceDigest,sourceCodeRaw:(input.sourceCodeRaw||[sourceCode]).map(value=>string(value,'原膜编号文字',300)),unitConvention:'张为本系统默认计量约定；原表未提供单位',compatibilityNote:'仅原表通用型号资料，不展开简写；贴膜前仍须核对实机、曲面及开孔'};
  return {externalCode:f.prefix+'-'+sourceCode,name:f.name+' '+sourceCode+(filmType==='待核'?'':(' '+filmType))+(fields.qualifiersRaw.length?' '+fields.qualifiersRaw.join(' '):''),repairFilm:fields};
 });
 if(new Set(rows.map(row=>row.externalCode)).size!==rows.length)fail(409,'同资料系列的膜编号重复；请先合并侧注与兼容关系');
 const contentDigest=digest({sourceDigest,rows});
 return {sourceDigest,contentDigest,sources,rows:rows.map(row=>({...row,repairFilm:{...row.repairFilm,contentDigest,rowDigest:digest(row.repairFilm)}}))};
}
function rootProduct(store,product){
 let row=product;const seen=new Set();
 while(row.warehouseVariantOf||row.mobileVariantOf){
  if(seen.has(row.skuId))fail(409,'膜仓库商品来源关联形成循环');seen.add(row.skuId);
  row=(store.products||[]).find(value=>value.skuId===(row.warehouseVariantOf||row.mobileVariantOf));
  if(!row||row.stockManaged===false)fail(409,'膜仓库商品来源关联缺失，请管理员核对');
 }
 return row;
}
function getFilm(store,product){return rootProduct(store,product).repairFilm||null;}
function findService(store){
 const rows=(store.products||[]).filter(row=>row.externalCode===SERVICE_CODE&&row.repairFilmService===true);
 if(rows.length>1)fail(409,'手机贴膜服务档案重复，请管理员核对');
 const service=rows[0];
 if(service&&(service.stockManaged!==false||service.type!=='维修'))fail(409,'手机贴膜服务档案类型不一致');
 return service;
}
function planCatalog(store,prepared){
 const seen=new Set(),existingVersion=(store.products||[]).filter(row=>row.repairFilm?.sourceDigest===prepared.sourceDigest);
 if(existingVersion.some(row=>row.repairFilm.contentDigest!==prepared.contentDigest))fail(409,'相同来源版本的膜资料内容发生变化，不能作为重复导入');
 const actions=prepared.rows.map(row=>{
  const found=(store.products||[]).filter(product=>product.externalCode===row.externalCode);
  if(found.length>1)fail(409,'膜商品编号已有重复：'+row.externalCode);
  const existing=found[0];
  if(existing&&(!existing.repairFilm||existing.repairFilm.catalogKey!==row.repairFilm.catalogKey||existing.stockManaged===false||details.tracked(existing)||existing.warehouseId!=='wh-b'||existing.warehouseVariantOf||existing.mobileVariantOf))fail(409,'膜商品编号已存在或档案不一致，原商品不会覆盖：'+row.externalCode);
  if(existing&&existing.repairFilm.sourceDigest===prepared.sourceDigest&&existing.repairFilm.rowDigest!==row.repairFilm.rowDigest)fail(409,'相同来源版本的膜资料行发生变化：'+row.externalCode);
  if(existing)seen.add(existing.skuId);
  return {...row,existing,action:!existing?'create':existing.repairFilm.sourceDigest===prepared.sourceDigest?'replay':'version'};
 });
 const collisions=(store.products||[]).filter(row=>row.repairFilm?.sourceDigest===prepared.sourceDigest&&!row.warehouseVariantOf&&!row.mobileVariantOf&&!seen.has(row.skuId));
 if(collisions.length)fail(409,'相同来源版本的膜商品范围不完整，请管理员核对');
 const serviceMatches=(store.products||[]).filter(row=>row.externalCode===SERVICE_CODE);
 if(serviceMatches.length>1||serviceMatches.length===1&&(serviceMatches[0].repairFilmService!==true||serviceMatches[0].stockManaged!==false||serviceMatches[0].type!=='维修'))fail(409,'手机贴膜服务编号已被其他档案占用');
 if(existingVersion.length&&actions.some(row=>row.action==='create'))fail(409,'该来源版本已有部分膜档案，不能重试补造缺失商品');
 return {actions,service:serviceMatches[0]||null};
}
function previewCatalog(store,user,catalog){
 currentUser(store,user,true);const prepared=prepareCatalog(catalog),plan=planCatalog(store,prepared);
 return {sourceDigest:prepared.sourceDigest,contentDigest:prepared.contentDigest,rows:prepared.rows.length,create:plan.actions.filter(row=>row.action==='create').length,updateSourceVersion:plan.actions.filter(row=>row.action==='version').length,replay:plan.actions.filter(row=>row.action==='replay').length,createService:!plan.service,warehouseId:'wh-b',defaultUnit:'张',defaultUnitFromSource:false,initialQuantity:0,quantityMeaning:'未录入实物库存',priceNeedsConfirmation:true,sourceFiles:prepared.sources.map(({file,sha256})=>({file,sha256})),noCashPosting:true,noStockReceipt:true};
}
function applyCatalog(store,user,catalog){
 const actual=currentUser(store,user,true),prepared=prepareCatalog(catalog),plan=planCatalog(store,prepared);
 if(plan.actions.every(row=>row.action==='replay')&&plan.service)return {changed:false,replayed:true,sourceDigest:prepared.sourceDigest,contentDigest:prepared.contentDigest,products:prepared.rows.length,serviceSkuId:plan.service.skuId,inventoryAdded:0};
 const stage=structuredClone(store),owner=stage.users.find(row=>row.id===actual.id),at=c.now();
 let created=0,updated=0;
 for(const row of plan.actions){
  if(row.action==='replay')continue;
  let product;
  if(row.action==='create'){
   const saved=erp.saveProduct(stage,owner,{name:row.name,externalCode:row.externalCode,type:'配件',subType:['mc','yzs'].includes(row.repairFilm.family)?'保护膜':'维修材料',thirdType:['mc','yzs'].includes(row.repairFilm.family)?row.repairFilm.series:'手机膜',unit:'张',kind:'physical',trackSerial:false,salePrice:0},{internal:true,initialWarehouseId:'wh-b'});
   product=stage.products.find(value=>value.skuId===saved.skuId);created++;
   product.importSource={source:'film-catalog',sourceDigest:prepared.sourceDigest,priceNeedsConfirmation:true,priceSource:'pending',inventoryQuantityProvided:false,quantityMeaning:'未录入实物库存',unitDefaultConvention:true,classificationSource:'system-convention',warehouseSource:'owner-approved-system-convention'};
  }else{product=stage.products.find(value=>value.skuId===row.existing.skuId);updated++;}
  const history=product.repairFilm?.history||[];
  if(product.repairFilm){const previous=structuredClone(product.repairFilm);delete previous.history;history.push(previous);}
  product.repairFilm={...structuredClone(row.repairFilm),importedAt:at,importedBy:owner.id,history};
  if(row.action==='version')c.audit(stage,owner,'film:source-version',product.externalCode+' · 来源版本 '+prepared.sourceDigest);
 }
 let service=plan.service?stage.products.find(row=>row.skuId===plan.service.skuId):null;
 if(!service){
  const saved=erp.saveProduct(stage,owner,{name:'手机贴膜服务',externalCode:SERVICE_CODE,type:'维修',subType:'维修服务',thirdType:'贴膜',unit:'次',kind:'service',salePrice:0},{internal:true});
  service=stage.products.find(row=>row.skuId===saved.skuId);service.repairFilmService=true;service.importSource={source:'film-catalog-service',priceNeedsConfirmation:true,priceSource:'pending',requiresActualCharge:true,zeroChargeNeedsReason:true,unitDefaultConvention:true,classificationSource:'system-convention'};
 }
 c.audit(stage,owner,'film:catalog-import','膜资料 '+prepared.sourceDigest+' · 新建 '+created+' · 来源更新 '+updated+'；数量0仅代表未入库，售价和进价待核');
 for(const key of ['products','inventory','operationLogs','catalogAdditionReviews','localCatalogNotices'])if(Object.hasOwn(stage,key))store[key]=stage[key];
 return {changed:true,replayed:false,sourceDigest:prepared.sourceDigest,contentDigest:prepared.contentDigest,products:prepared.rows.length,created,updatedSourceVersion:updated,serviceSkuId:service.skuId,inventoryAdded:0,noCashPosting:true,priceNeedsConfirmation:true};
}
function readQuery(query,name){return query&&typeof query.get==='function'?query.get(name):query?.[name];}
function warehouseFilter(query,required=false){const id=readQuery(query,'warehouseId')||'';if(required&&!id)fail(400,'请选择实际入库或领用的仓库');if(id&&!warehouses.byId(id))fail(400,'仓库不正确');return id;}
function filmProducts(store){return (store.products||[]).filter(row=>row.active!==false&&row.stockManaged!==false&&!details.tracked(row)&&getFilm(store,row));}
function view(store,product){
 const film=getFilm(store,product),inventory=(store.inventory||[]).filter(row=>row.skuId===product.skuId&&row.warehouseId===product.warehouseId);
 if(inventory.length>1||!inventory.length&&((store.inventory||[]).some(row=>row.skuId===product.skuId)||(store.movements||[]).some(row=>row.skuId===product.skuId)))fail(409,'膜商品库位记录缺失或重复，请先核对');
 const stock=inventory[0]||{quantity:0};if(!Number.isSafeInteger(stock.quantity)||stock.quantity<0)fail(409,'膜库存数量不正确');
 return {skuId:product.skuId,code:product.externalCode,name:product.name,unit:product.unit||'张',warehouseId:product.warehouseId,warehouseName:warehouses.byId(product.warehouseId)?.name||product.warehouseId,quantity:stock.quantity,saleQuantity:stock.quantity,inventoryRecorded:stock.quantity>0||(store.movements||[]).some(row=>row.skuId===product.skuId),quantityMeaning:stock.quantity?'系统已登记库存':'未录入或已用完；请核对实物',priceNeedsConfirmation:product.importSource?.priceNeedsConfirmation===true||(!product.importSource&&rootProduct(store,product).importSource?.priceNeedsConfirmation===true),salePrice:product.salePrice,qrCode:'JY1:'+product.skuId,film:structuredClone({...film,history:undefined}),unitDefaultConvention:rootProduct(store,product).importSource?.unitDefaultConvention===true};
}
function serviceView(store){const row=findService(store);return row&&row.active!==false?{skuId:row.skuId,code:row.externalCode,name:row.name,stockManaged:false,priceNeedsConfirmation:row.importSource?.priceNeedsConfirmation===true,requiresActualCharge:true,zeroChargeNeedsReason:true}:null;}
function setup(store,user){const actual=currentUser(store,user);return {families:FAMILIES.map(row=>({id:row.id,name:row.name})),warehouses:warehouses.WAREHOUSES,service:serviceView(store),canImport:actual.roleCode==='owner',canPurchase:c.capabilities(actual).purchase,canIssue:c.capabilities(actual).sell,locatorsMeaning:'原资料单元格位置，不是实物库位',compatibilityNote:'仅检索原表明确文字；简写不推断扩展，贴膜前核对实机'};}
function search(store,user,query={}){
 currentUser(store,user);const warehouseId=warehouseFilter(query),f=readQuery(query,'family')||'',model=string(readQuery(query,'model')||readQuery(query,'q')||'','手机型号',100,true),brand=string(readQuery(query,'brand')||'','品牌',100,true);
 if(f)family(f);
 const offsetRaw=readQuery(query,'cursor')||'0',limitRaw=readQuery(query,'limit')||'250';
 if(!/^\d+$/.test(String(offsetRaw))||!/^\d+$/.test(String(limitRaw)))fail(400,'查询分页不正确');
 const offset=Number(offsetRaw),limit=Number(limitRaw);if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(limit)||limit<1||limit>500)fail(400,'查询分页超出范围');
 const rows=filmProducts(store).filter(product=>{
  const film=getFilm(store,product);if(warehouseId&&product.warehouseId!==warehouseId||f&&film.family!==f)return false;
  const fragments=film.fragments||[];
  const texts=fragments.flatMap(fragment=>[fragment.raw,...(fragment.tokens||[]),...(fragment.brand?[fragment.brand+' '+fragment.raw,...(fragment.tokens||[]).map(token=>fragment.brand+' '+token)]:[])]).concat(film.primaryModelsRaw||[],film.qualifiersRaw||[],[film.sourceCode,product.externalCode,product.name]);
  return (!brand||fragments.some(fragment=>norm(fragment.brand).includes(norm(brand))||norm(fragment.raw).includes(norm(brand))))&&(!model||texts.some(text=>norm(text).includes(norm(model))));
 }).map(product=>({...view(store,product),match:{mode:model?'source-literal-text':'browse',model,brand,semanticExpansion:false,requiresDeviceCheck:true}})).sort((a,b)=>a.code.localeCompare(b.code,'zh-CN')||a.warehouseId.localeCompare(b.warehouseId));
 return {...setup(store,user),rows:rows.slice(offset,offset+limit),total:rows.length,nextCursor:offset+limit<rows.length?String(offset+limit):null,query:{model,brand,family:f,warehouseId},pricesAreNotVerified:rows.some(row=>row.priceNeedsConfirmation)};
}
function resolve(store,user,query={}){
 currentUser(store,user);const code=string(readQuery(query,'code'),'膜二维码或编号',120),warehouseId=warehouseFilter(query),f=readQuery(query,'family')||'';
 if(f)family(f);let rows;
 if(code.startsWith('JY1:'))rows=filmProducts(store).filter(product=>product.skuId===code.slice(4));
 else rows=filmProducts(store).filter(product=>product.externalCode===code||norm(getFilm(store,product).sourceCode)===norm(code));
 rows=rows.filter(product=>(!warehouseId||product.warehouseId===warehouseId)&&(!f||getFilm(store,product).family===f));
 if(!rows.length)fail(404,'未找到该仓在用膜商品；手机串号不能作为膜编号');
 if(rows.length!==1){const error=new c.HttpError(409,'该膜原编号对应多个资料系列或仓库，请明确选择，不会自动取第一项');error.code='FILM_CODE_AMBIGUOUS';error.candidates=rows.map(product=>({skuId:product.skuId,code:product.externalCode,family:getFilm(store,product).family,warehouseId:product.warehouseId,name:product.name}));throw error;}
 return {...view(store,rows[0]),service:serviceView(store),locatorsMeaning:'原资料单元格位置，不是实物库位'};
}
function validateSale(store,user,payload){
 const serviceItems=(Array.isArray(payload?.items)?payload.items:[]).filter(item=>(store.products||[]).some(product=>product.skuId===item?.skuId&&product.repairFilmService===true));
 if(!serviceItems.length)return payload;
 const actual=currentUser(store,user);c.permit(actual,'sell');for(const item of serviceItems){const p=(store.products||[]).find(product=>product.skuId===item?.skuId);
  if(p.active===false||p.stockManaged!==false||p.type!=='维修')fail(409,'手机贴膜服务档案不可用');
  if(item.salePrice==null||item.salePrice===''||typeof item.salePrice==='boolean')fail(400,'请填写本次实际贴膜收费；待核价的默认0不作为实际收费');
  const price=c.money(item.salePrice,'本次实际贴膜收费');if(price===0&&(typeof item.note!=='string'||item.note.trim().length<4||item.note.trim().length>500))fail(400,'0元贴膜请在本项备注写明至少4字原因');
  if(!Array.isArray(item.materials)||!item.materials.length||item.noMaterials===true)fail(400,'手机贴膜服务必须登记实际领用的膜耗材');
  for(const material of item.materials){const product=(store.products||[]).find(row=>row.skuId===material?.skuId);if(!product||product.active===false||product.stockManaged===false||details.tracked(product)||!getFilm(store,product))fail(400,'手机贴膜服务请使用已登记的实际膜商品');}
 }
 return payload;
}
module.exports={FAMILIES,SERVICE_CODE,prepareCatalog,previewCatalog,applyCatalog,search,resolve,setup,validateSale};
