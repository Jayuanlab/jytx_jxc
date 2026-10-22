'use strict';
// Separate branch records. Business IDs, original dates and foreign keys never change.
const {AsyncLocalStorage}=require('node:async_hooks'),{createHash}=require('node:crypto');
const storage=new AsyncLocalStorage();
const DEFINITIONS=Object.freeze({
 receptions:'JD',purchases:'JH',sales:'XS',receipts:row=>Number(row.amount)<0?'FK':'SK',
 saleReturnRequests:row=>row.kind==='exchange'?'HS':'TS',saleReturns:'TH',saleExchanges:'HH',
 purchaseReturnRequests:'CS',purchaseReturns:'CT',redReversals:'HC',stockTransfers:'DB',
 stocktakes:'PD',closeouts:'JB',expenses:row=>row.redOf?'FH':'FY',otherIncome:row=>row.redOf?'SH':'SR',
 procurementPlans:'CG',supplierCash:'WL',supplierSettlements:'WJ',supplierAdjustments:'TJ',
 dailyCloseouts:'RJ',cashHandovers:'JJ',fundTransfers:'ZZ',workJournals:'GZ',
 conversionClaims:'ZH',assistCommissionAllocations:'XC',cardBusinesses:'KB',carrierServices:'YW',
 govSubsidyClaims:'GB',payrollStatements:'GZJ',payrollAdjustments:'GZT',productPriceChanges:'SJ',
 usedPhoneAssessments:'ES',dutyAssignments:'QJ',learningRecords:'XX',airRechargeEvents:'KC',cardEvents:'KE',giftApprovals:'ZS',giftOrders:'ZP',receptionAssists:'XZ',supplierEntries:'WE'
});
const ID_FIELDS=new Set(['id','orderId','sourceId','purchaseId','receptionId','returnId','newOrderId','requestId','originalReceiptId','expenseId','settlementId','planId','referenceId','closeoutId','transferId','journalId','sourceOrderId','originalStatementId','giftId','assistId','resolved','sourceReceptionId','targetReceptionId','businessId']);
const TEXT_FIELDS=new Set(['message','answer','reply','label','summary','title','detail','basis','reason','usageNote']);
const aliasPattern=/\b(?:GZJ|GZT|JD|JH|XS|FK|SK|HS|TS|TH|HH|CS|CT|HC|DB|PD|JB|FH|FY|SH|SR|CG|WL|WJ|TJ|RJ|JJ|ZZ|GZ|ZH|XC|KB|YW|GB|SJ|ES|QJ|XX|KC|KE|ZS|ZP|XZ|WE)-\d{6}-\d{3,}\b/gi;
function fail(message){const {HttpError}=require('./http');throw new HttpError(409,message);}
function run(work){return storage.run({rows:[]},work);}
function remember(store){const scope=storage.getStore();if(scope)scope.rows=store.documentNumbers||[];}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function key(collection,id){return collection+'/'+String(id);}
function prefix(collection,row){const def=DEFINITIONS[collection];return typeof def==='function'?def(row):def;}
function dateKey(row){
 const value=row.createdAt||row.confirmedAt||row.approvedAt||row.date||row.at||row.startedAt;
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('单据缺少有效原始日期，请先核对：'+row.id);
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)).replace(/-/g,'').slice(2);
}
function existingHuman(collection,row){
 if(collection==='sales'&&/^(?:SO|XS)-\d{6,8}-\d+$/i.test(String(row.id||'')))return String(row.id);
 if(collection==='workJournals'&&/^GZ\d{11,}$/.test(String(row.displayNo||'')))return row.displayNo;
 return '';
}
function indexes(store){
 const bySource=new Map(),byAlias=new Map();
 for(const row of store.documentNumbers||[]){
  if(!DEFINITIONS[row.collection]||typeof row.sourceId!=='string'||typeof row.displayNo!=='string'||row.id!==key(row.collection,row.sourceId))fail('单据短号登记资料不完整');
  if(bySource.has(row.id)||byAlias.has(row.displayNo.toUpperCase()))fail('单据短号登记重复，请先核对');
  bySource.set(row.id,row);byAlias.set(row.displayNo.toUpperCase(),row);
 }
 return {bySource,byAlias};
}
function assign(store,collection,row,index=indexes(store)){
 if(!row||typeof row.id!=='string'||!row.id)fail('单据缺少稳定编号');
 const sourceKey=key(collection,row.id),old=index.bySource.get(sourceKey);if(old)return old.displayNo;
 const human=existingHuman(collection,row),code=prefix(collection,row),day=dateKey(row);
 let displayNo=human;
 if(!displayNo){
  let sequence=0;
  if(!Number.isSafeInteger(sequence)||sequence<0)fail('单据短号计数资料不正确');
  for(const entry of store.documentNumbers||[]){const m=new RegExp('^'+code+'-'+day+'-(\\d+)$').exec(entry.displayNo);if(m)sequence=Math.max(sequence,Number(m[1]));}
  do{sequence++;if(!Number.isSafeInteger(sequence))fail('单据短号计数已超出限制');displayNo=code+'-'+day+'-'+String(sequence).padStart(3,'0');}while(index.byAlias.has(displayNo.toUpperCase()));
 }
 if(index.byAlias.has(displayNo.toUpperCase()))fail('现有单据展示号重复，请先核对');
 const entry={id:sourceKey,collection,sourceId:row.id,displayNo,originalDate:row.createdAt||row.confirmedAt||row.approvedAt||row.date||row.at||row.startedAt,...(row.dateOrigin?{dateOrigin:row.dateOrigin}:{}),registeredAt:new Date().toISOString()};
 store.documentNumbers ||= [];store.documentNumbers.push(entry);index.bySource.set(sourceKey,entry);index.byAlias.set(displayNo.toUpperCase(),entry);return displayNo;
}
function rowsFor(store,name){return name==='giftOrders'?(store.sales||[]).flatMap(order=>(order.giftOrders||[]).map(row=>row.createdAt?row:{...row,createdAt:order.createdAt,dateOrigin:'parent-sale-createdAt'})):name==='receptionAssists'?(store.receptions||[]).flatMap(row=>row.assists||[]):store[name]||[];}
function capture(store){indexes(store);return {...Object.fromEntries(Object.keys(DEFINITIONS).map(name=>[name,new Set(rowsFor(store,name).map(row=>row.id))])),registry:structuredClone(store.documentNumbers||[])};}
function commitNew(store,before){
 const current=indexes(store);
 for(const entry of before.registry||[]){const found=current.bySource.get(entry.id);if(found&&JSON.stringify(found)!==JSON.stringify(entry))fail('单据短号登记只能追加，不可更改历史');if(!found){store.documentNumbers ||= [];store.documentNumbers.push(structuredClone(entry));}}
 const index=indexes(store);
 for(const name of Object.keys(DEFINITIONS))for(const row of rowsFor(store,name))if(!before[name]?.has(row.id))assign(store,name,row,index);
 remember(store);
}
function previewBackfill(store,{collectErrors=false}={}){
 const clone=structuredClone(store),index=indexes(clone),before=clone.documentNumbers?.length||0,blocked=[];
 for(const name of Object.keys(DEFINITIONS))for(const row of rowsFor(clone,name).slice().sort((a,b)=>String(a.createdAt||a.confirmedAt||a.approvedAt||a.date||'').localeCompare(String(b.createdAt||b.confirmedAt||b.approvedAt||b.date||''))||String(a.id).localeCompare(String(b.id)))){try{assign(clone,name,row,index);}catch(error){if(!collectErrors||error.statusCode!==409)throw error;blocked.push({collection:name,sourceId:row.id,message:error.message});}}
 const added=(clone.documentNumbers||[]).slice(before);
 return {count:added.length,blocked,byCollection:Object.fromEntries(Object.keys(DEFINITIONS).map(name=>[name,added.filter(row=>row.collection===name).length])),digest:hash(added.map(({registeredAt,...row})=>row)),added};
}
function backfill(store,expectedDigest){
 const preview=previewBackfill(store);if(preview.count===0&&/^[a-f0-9]{64}$/.test(String(expectedDigest||'')))return {registered:0,alreadyRegistered:true,byCollection:preview.byCollection,digest:preview.digest};if(typeof expectedDigest!=='string'||preview.digest!==expectedDigest)fail('单据或短号登记已变化，请重新核对登记预览');
 const index=indexes(store);for(const entry of preview.added){const row=rowsFor(store,entry.collection).find(row=>row.id===entry.sourceId);assign(store,entry.collection,row,index);}
 remember(store);return {registered:preview.count,byCollection:preview.byCollection,digest:preview.digest};
}
function resolve(store,value){
 if(typeof value!=='string')return value;
 const found=indexes(store).byAlias.get(value.trim().toUpperCase());return found?found.sourceId:value;
}
function queryParams(store,params){
 const copy=new URLSearchParams(params);
 for(const [name,value] of copy){if(ID_FIELDS.has(name)||name==='q')copy.set(name,resolve(store,value));}
 return copy;
}
function input(store,payload){
 const visit=(value,name)=>{
  if(typeof value==='string')return ID_FIELDS.has(name)?resolve(store,value):value;
  if(Array.isArray(value))return value.map(item=>visit(item,name));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,val])=>[key,visit(val,key)]));return value;
 };
 return visit(payload,'');
}
function project(payload,store){
 const rows=store?.documentNumbers||storage.getStore()?.rows||[],byId=new Map();
 for(const row of rows){if(byId.has(row.sourceId)&&byId.get(row.sourceId)!==row.displayNo)byId.set(row.sourceId,null);else byId.set(row.sourceId,row.displayNo);}
 const shown=id=>byId.get(String(id||''));
 const text=value=>String(value).replace(/\b[A-Z][A-Z0-9]*-[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b(?:SO|XS)-\d{6,8}-\d+\b/g,id=>shown(id)||id);
 const visit=(value,name)=>{
  if(typeof value==='string')return TEXT_FIELDS.has(name)?text(value):value;
  if(Array.isArray(value))return value.map(item=>visit(item,name));
  if(!value||typeof value!=='object'||value instanceof Date||Buffer.isBuffer(value))return value;
  const out=Object.fromEntries(Object.entries(value).map(([key,val])=>[key,visit(val,key)]));
  for(const [field,id] of Object.entries(value))if(ID_FIELDS.has(field)&&typeof id==='string'&&shown(id)){const target=field==='id'?'displayNo':field==='resolved'?'resolvedDisplayNo':field.slice(0,-2)+'DisplayNo';out[target] = shown(id);}
  return out;
 };
 return visit(payload,'');
}

const HREFS={receptions:'/receptions',purchases:'/app?tab=purchase',sales:'/app?tab=orders',saleReturnRequests:'/app?tab=returns',saleReturns:'/app?tab=returns',saleExchanges:'/app?tab=returns',purchaseReturnRequests:'/app?tab=purchase',purchaseReturns:'/app?tab=purchase',redReversals:'/app?tab=red',stockTransfers:'/app?tab=inventory',stocktakes:'/stocktake',expenses:'/app?tab=payments',otherIncome:'/app?tab=receipts',procurementPlans:'/app?tab=purchase',supplierCash:'/app?tab=suppliers',supplierSettlements:'/app?tab=suppliers',supplierAdjustments:'/app?tab=suppliers',supplierEntries:'/app?tab=suppliers',dailyCloseouts:'/daily-close',closeouts:'/close',cashHandovers:'/cash-handover',fundTransfers:'/app?tab=finance',workJournals:'/work-journal',conversionClaims:'/receptions',assistCommissionAllocations:'/receptions',cardBusinesses:'/app?tab=cards',carrierServices:'/carrier',govSubsidyClaims:'/subsidy',payrollStatements:'/app?tab=payroll',payrollAdjustments:'/app?tab=payroll',productPriceChanges:'/app?tab=products',learningRecords:'/learning',airRechargeEvents:'/daily-close',cardEvents:'/app?tab=cards',giftApprovals:'/gift-approvals',giftOrders:'/app?tab=orders',receptionAssists:'/receptions'};
function readable(store,user,name,row){
 const c=require('./common'),actual=c.userById(store,user.id),caps=c.capabilities(actual);
 if(actual.assistantCustomerOnly||actual.roleCode==='customer-assistant')return false;
 const has=rows=>(rows||[]).some(item=>item.id===row.id);
 switch(name){
  case 'receptions':return has(require('./receptions').list(store,actual).rows);
  case 'receptionAssists':return require('./receptions').list(store,actual).rows.some(parent=>(parent.assists||[]).some(assist=>assist.id===row.id));
  case 'sales':return has(require('./erp').orders(store,actual));
  case 'purchases':return has(require('./suppliers').purchaseRows(store,actual));
  case 'receipts':case 'expenses':case 'otherIncome':return has(require('./erp').finance(store,actual)[name]);
  case 'saleReturnRequests':return has(require('./sale-return-requests').list(store,actual));
  case 'purchaseReturnRequests':return has(require('./purchase-return-requests').list(store,actual));
  case 'saleReturns':case 'saleExchanges':return require('./erp').orders(store,actual).some(order=>order.id===row.orderId);
  case 'redReversals':return has(require('./red-reversals').list(store,actual));
  case 'stockTransfers':return has(require('./inventory-transfers').list(store,actual));
  case 'stocktakes':c.permit(actual,'stocktake');return true;
  case 'procurementPlans':return has(require('./suppliers').planRows(store,actual));
  case 'supplierCash':case 'supplierSettlements':case 'supplierAdjustments':case 'supplierEntries':case 'purchaseReturns':{
   const property={supplierCash:'cash',supplierSettlements:'settlements',supplierAdjustments:'adjustments',supplierEntries:'entries',purchaseReturns:'returns'}[name];return has(require('./suppliers').detail(store,actual,row.supplierId)[property]);
  }
  case 'dailyCloseouts':return has(require('./daily-close').list(store,actual));
  case 'closeouts':return has(require('./closeouts').closeouts(store,actual));
  case 'cashHandovers':return has(require('./cash-handovers').list(store,actual));
  case 'fundTransfers':return has(require('./funds-network').listTransfers(store,actual));
  case 'workJournals':return has(require('./work-journal').list(store,actual));
  case 'conversionClaims':return has(require('./conversions').list(store,actual));
  case 'assistCommissionAllocations':return actual.roleCode==='owner';
  case 'cardBusinesses':return has(require('./erp').cards(store,actual).rows);
  case 'carrierServices':return has(require('./carrier-rentals').list(store,actual));
  case 'govSubsidyClaims':return has(require('./gov-subsidy').claims(store,actual));
  case 'payrollStatements':case 'payrollAdjustments':{const data=require('./payroll').getPayroll(store,actual,row.month,row.employeeId);return has(name==='payrollStatements'?data.rows:data.adjustments);}
  case 'productPriceChanges':return has(require('./product-pricing').list(store,actual));
  case 'usedPhoneAssessments':return has(require('./used-phones').snapshot(store,actual).rows);
  case 'dutyAssignments':return has(require('./staff-duties').snapshot(store,actual,row.date).rows);
  case 'learningRecords':return has(require('./learning').list(store,actual));
  case 'airRechargeEvents':return has(require('./daily-close').airList(store,actual));
  case 'cardEvents':c.permit(actual,'finance');return true;
  case 'giftApprovals':return has(require('./erp').giftApprovals(store,actual));
  case 'giftOrders':return require('./erp').orders(store,actual).some(order=>(order.giftOrders||[]).some(gift=>gift.id===row.id));
  default:return false;
 }
}
function lookup(store,user,value){
 const text=String(value||'').trim(),index=indexes(store),entry=index.byAlias.get(text.toUpperCase())||[...index.bySource.values()].find(row=>row.sourceId===text);
 const missing=()=>{const {HttpError}=require('./http');throw new HttpError(404,'未找到可查询的单据，请核对号码或当前门店');};
 if(!entry)return missing();const row=rowsFor(store,entry.collection).find(row=>row.id===entry.sourceId);if(!row)return missing();
 let allowed=false;try{allowed=readable(structuredClone(store),user,entry.collection,row);}catch(error){if(![400,403,404].includes(error.statusCode))throw error;}
 if(!allowed)return missing();
 const queryId=entry.collection==='receptionAssists'?(store.receptions||[]).find(parent=>(parent.assists||[]).some(assist=>assist.id===row.id))?.id||row.id:entry.collection==='giftOrders'?(store.sales||[]).find(order=>(order.giftOrders||[]).some(gift=>gift.id===row.id))?.id||row.id:row.id;
 const href=entry.collection==='receipts'?'/app?tab='+(Number(row.amount)<0?'payments':'receipts'):HREFS[entry.collection]||'/search',join=href.includes('?')?'&':'?',parameter=['receptions','receptionAssists'].includes(entry.collection)?'highlight':'q';
 return {id:row.id,displayNo:entry.displayNo,collection:entry.collection,kind:prefix(entry.collection,row),createdAt:entry.originalDate,href:href+join+parameter+'='+encodeURIComponent(queryId)};
}
function questionLookup(store,user,question){
 const q=String(question||'');if(!/查|看|找|核对|确认|单号|记录/.test(q)||/新建|开单|修改|删除|批准|驳回|提交|保存/.test(q))return null;
 const matches=q.match(aliasPattern)||[];if(matches.length!==1)return null;
 let doc;try{doc=lookup(store,user,matches[0]);}catch(error){if(error.statusCode!==404)throw error;return {answer:'未找到可查询的单据，请核对号码或当前门店。',sources:[],metrics:{kind:'document-query',matchedCount:0}};}return {answer:'找到单据 '+doc.displayNo+'，点“查看单据”核对明细。',sources:[{label:'查看单据',id:doc.id,displayNo:doc.displayNo,href:doc.href}],metrics:{kind:'document-query',matchedCount:1,collection:doc.collection}};
}

module.exports={lookup,questionLookup,rowsFor,DEFINITIONS,run,remember,capture,commitNew,previewBackfill,backfill,resolve,queryParams,input,project};
