'use strict';
const c=require('./common');
const text=value=>value==null?'':String(value);
const present=value=>value!==null&&value!==undefined&&value!=='';
const number=value=>present(value)&&Number.isFinite(Number(value))?Number(value):null;
function carrier(row,store={}){
  const saved=row.businessOptionSnapshot||{};
  let resolved={};
  try{resolved=require('./business-options').resolve(store,{type:row.businessTypeId||row.type,subType:row.businessSubTypeId||row.subType});}catch{}
  // Use the saved name first. A missing/retired option must not invent a new name.
  const typeName=text(row.typeName||saved.typeName||resolved.typeName);
  const canonicalSubtype=resolved.subTypeName||({new:'新开卡',replace:'补卡',topup:'话费充值',fusion:'融合宽带',up:'套餐升档',down:'套餐降档',device:'设备绑合约',unknown:'未分类／未设置细类'}[row.subType])||'';
  const subTypeName=text(row.subTypeName||saved.subTypeName||canonicalSubtype);
  const schedule=(row.schedule||[]).map(part=>({month:text(part.month),expected:number(part.expected),confirmed:number(part.confirmed),received:number(part.received),statementNo:text(part.statementNo),reference:text(part.reference||part.bankReference),note:text(part.note)}));
  const product=row.commissionProductSnapshot;
  return {kind:'carrier',businessName:[typeName,product?.name||subTypeName].filter(Boolean).join(' · '),typeName,subTypeName,productName:product?.name||'',expectedCommissionTotal:product?.expectedTotal??null,commissionSourceName:product?.sourceName||'',commissionSourceRange:product?.sourceRange||'',commissionTimingUnconfirmed:!!product&&!product.terms,
    operator:text(row.operator),businessDate:text(row.serviceDate),recordedAt:text(row.createdAt),employeeId:text(row.employeeId||row.operatorId),employeeName:text(row.employeeName||row.operatorName),
    customerMask:text(row.customerMask),externalOrderNo:text(row.externalOrderNo),reference:text(row.reference),note:text(row.note),
    mobileAppLoggedIn:typeof row.mobileAppLoggedIn==='boolean'?row.mobileAppLoggedIn:null,transactionAmount:number(row.transactionAmount),
    commissionRuleStatus:text(row.commissionRuleStatus),commissionRuleLabel:text(row.commissionRuleSnapshot?.label),commissionRuleRevision:row.commissionRuleSnapshot?.revision??null,
    hasCommissionPlan:schedule.length>0,schedule,
    missingBusinessName:!typeName||!subTypeName||(row.subType==='unknown'&&!row.subTypeName&&!saved.subTypeName)};
}
function project(store,collection,row,{label='',recordedByName=''}={}){
  if(!row)return {available:false,label,fields:[],items:[],payments:[]};
  const id=row.id||row.skuId;
  const registry=(store.documentNumbers||[]).find(entry=>entry.collection===collection&&entry.sourceId===id);
  const preview=require('./pending-preview').make(collection,row,label);
  const products=new Map((store.products||[]).map(item=>[item.skuId,item]));
  const document={available:true,id,label,collection,sourceId:id,displayNo:text(registry?.displayNo||row.displayNo||row.number||id),
    businessName:preview.purpose||row.name||row.typeName||'',object:preview.object||'',businessDate:text(row.date||row.serviceDate||row.occurredAt||row.createdAt),
    recordedAt:text(row.createdAt),recordedByName:text(row.employeeName||row.operatorName||row.applicantName||recordedByName),businessStatus:text(row.status||'已登记'),
    note:text(row.note||row.description||row.reason),amount:number(row.amount??row.transactionAmount??row.plannedAmount),
    counterparty:text(row.counterparty||row.payerName||row.payeeName||row.supplier||row.supplierName),
    reference:text(row.reference||row.externalOrderNo),
    items:(row.items||row.rows||[]).map(item=>({name:text(item.name||item.product||item.productName||products.get(item.skuId)?.name||item.skuId),
      code:text(item.externalCode||products.get(item.skuId)?.externalCode),quantity:item.quantity??null,received:item.received??item.actual??null,
      serialNo:text(item.serialNo),serials:(item.serials||[]).map(text),warehouse:text(item.warehouseName||item.warehouseId||row.warehouseName||row.warehouseId)})),
    payments:(row.paymentParts||[]).map(part=>{const linked=(store.receipts||[]).find(receipt=>receipt.sourceId===id&&receipt.partId===part.id),account=require('./account-ownership').project(store,part);return {amount:number(part.amount),accountName:text(part.displayName||account.accountName||part.accountName||part.account),reference:text(part.reference||linked?.reference),status:text(part.paymentReview?.status)};})};
  if(collection==='carrierServices'||collection==='cardBusinesses'){
    document.carrier=carrier(row,store);document.businessName=document.carrier.businessName;document.recordedByName=document.carrier.employeeName||document.recordedByName;
  }
  return document;
}
module.exports={carrier,project};
