'use strict';
const c=require('./common'),accounts=require('./payment-accounts'),master=require('./master-data'),ownership=require('./account-ownership');
function actor(store,user){const who=master.actor(store,user);c.permit(who,'receiptRegister');return who;}
function source(store,row){return (store.otherIncome||[]).find(x=>x.id===row.sourceId)||(store.sales||[]).find(x=>x.id===row.sourceId)||(store.supplierCash||[]).find(x=>x.id===row.sourceId)||(store.saleReturns||[]).find(x=>x.id===row.sourceId)||(store.expenses||[]).find(x=>x.id===row.sourceId)||{};}
function owns(store,who,row){const origin=source(store,row);return who.roleCode==='owner'||row.registeredById===who.id||row.operatorId===who.id||origin.operatorId===who.id||origin.salespersonId===who.id;}
function scope(store,user,query){
 const who=actor(store,user);
 if(who.roleCode!=='owner'){
  for(const key of ['userId','operatorId','applicantId','employeeId','salespersonId'])if(query.get(key)&&query.get(key)!==who.id)throw new c.HttpError(403,'营业员只能查询本人收款单');
  const id=query.get('id')||query.get('sourceId');if(id){const hits=(store.receipts||[]).filter(r=>r.id===id||r.sourceId===id);if(hits.some(r=>!owns(store,who,r)))throw new c.HttpError(403,'营业员只能查询本人收款单');}
 }
 return who;
}
function validateParts(store,user,parts,payload){
 const who=actor(store,user);
 for(const part of parts){
  Object.assign(part,ownership.project(store,part));
  if(ownership.isStoreAccount(store,part))continue;
  if(!part.accountOwnerId)throw new c.HttpError(400,'请明确每笔款项的实际账户持有人，不能用暂不确定登记收款');
  if(!(part.account==='现金'&&part.cashDestination==='employee'&&part.accountOwnerId===who.id))accounts.holder(store,part.accountOwnerId);
 }
 if(payload.holderVerified===true&&parts.some(p=>ownership.isStoreAccount(store,p)||p.accountOwnerId!==who.id))throw new c.HttpError(403,'门店账户核对不等于本人收到款项，不能声明为本人账户到账');
 return who;
}
function addNotice(store,row,kind='收款单待老板核对'){
 const key='receipt-reconciliation:'+row.id+':'+row.reconciliation.version;
 store.localCatalogNotices||=[];if(store.localCatalogNotices.some(n=>n.key===key))return;
 store.localCatalogNotices.push({key,kind,orderId:row.id,summary:row.operator+' 登记收款 '+row.amount+'元 · '+row.counterparty+' · '+row.note+'；账面已登记，等待核对，不代表银行自动验证到账。',amount:row.amount,createdAt:c.now(),readAt:null,localOnly:true});
}
function register(store,user,row,receipts,payload){
 const who=actor(store,user),at=c.now();
 row.reconciliation={status:'待老板核对',version:1,registeredAmount:row.amount,registeredById:who.id,registeredByName:who.name,registeredAt:at,actualCheckedAmount:null,events:[{action:'营业员登记已收',by:who.id,name:who.name,at}]};
 for(const receipt of receipts){receipt.registeredById=who.id;receipt.registeredByName=who.name;receipt.reconciliation=structuredClone(row.reconciliation);receipt.holderVerification={status:payload.holderVerified===true?'持有人已核实':'尚未由持有人核实',verifiedByHolder:payload.holderVerified===true,...(payload.holderVerified===true?{by:who.id,at}:{}),method:'人工声明，不是银行自动验证'};}
 addNotice(store,row);return row.reconciliation;
}
function decorate(store,row){
 row=ownership.project(store,row);
 const origin=source(store,row),reconciliation=origin.reconciliation||row.reconciliation||null;
 let verified=row.holderVerification?.verifiedByHolder??null;
 if(verified===null&&row.kind==='sale'){
  const part=(origin.paymentParts||[]).find(p=>p.id===row.partId),review=part?.paymentReview||origin.paymentReview;
  if(review?.confirmedBy&&review.confirmedBy===row.accountOwnerId&&['已核对','已确认到账'].includes(review.status))verified=true;
 }
 const verifiedState=(store.moneyVerifications||[]).some(part=>part.receiptId===row.id)?require('./money-verifications').state(store,row):null;if(verifiedState)verified=verifiedState.verifiedByHolder;
 return {...row,...(verifiedState?{holderVerifiedAmount:verifiedState.verifiedAmount,holderUnverifiedAmount:verifiedState.unverifiedAmount,holderVerificationStatus:verifiedState.status}:{}),reconciliation:reconciliation?structuredClone(reconciliation):null,reconciliationStatus:reconciliation?.status||'历史记录（未单列对账状态）',verifiedByHolder:verified,holderVerification:verifiedState?{verifiedByHolder:verified,status:verifiedState.statusLabel,verifiedAmount:verifiedState.verifiedAmount,unverifiedAmount:verifiedState.unverifiedAmount,method:'实际持有人手工核实，不是银行自动验证'}:row.holderVerification||{verifiedByHolder:verified,status:verified===true?'原业务持有人已核实':'未提供独立持有人核实记录',method:'人工业务记录，不是银行自动验证'}};
}
function summary(rows){const sum=filter=>c.round(rows.filter(r=>r.status!=='已红冲'&&filter(r)).reduce((n,r)=>n+Number(r.amount),0));return {registeredAmount:sum(()=>true),reconciledAmount:sum(r=>r.reconciliationStatus==='已核对'),disputedAmount:sum(r=>r.reconciliationStatus==='有差异'),pendingReconciliationAmount:sum(r=>['待老板核对','待营业员更正'].includes(r.reconciliationStatus)),verifiedByHolderAmount:sum(r=>r.verifiedByHolder===true),legacyWithoutReconciliationAmount:sum(r=>!r.reconciliation),note:'账面登记、老板对账和持有人核实分别统计；均不表示银行自动验证。'};}
function pending(store){return (store.otherIncome||[]).filter(row=>row.reconciliation&&['待老板核对','有差异'].includes(row.reconciliation.status)&&!row.redReversedBy);}
function reconcile(store,user,payload){
 const who=master.actor(store,user);if(who.roleCode!=='owner')throw new c.HttpError(403,'收款单对账只能由老板本人完成');
 const row=(store.otherIncome||[]).find(r=>r.id===payload.id);if(!row||!row.reconciliation)throw new c.HttpError(404,'没有找到本次需要核对的收款单');
 const current=row.reconciliation,receipts=(store.receipts||[]).filter(r=>r.sourceId===row.id&&r.kind==='other_income'&&!r.isReversal);
 if(row.redReversedBy||!receipts.length||receipts.some(r=>(store.receipts||[]).some(x=>x.originalReceiptId===r.id&&(x.isReversal||x.kind==='other_income_red'))))throw new c.HttpError(409,'原收款单已红冲或流水不完整，请按原单核对');
 if(current.version!==payload.version||!['待老板核对','有差异'].includes(current.status))throw new c.HttpError(409,'这张收款单已核对或发生变化，请刷新');
 if(!['match','dispute'].includes(payload.decision))throw new c.HttpError(400,'请选择核对一致或登记差异');
 const actual=accounts.cents(payload.actualAmount,'老板实际核对金额')/100,note=payload.note==null?'':master.clean(payload.note,'对账说明',500,true);
 if(payload.decision==='match'&&actual!==row.amount)throw new c.HttpError(409,'实际金额与账面不一致，请登记差异');
 if(payload.decision==='dispute'&&!note)throw new c.HttpError(400,'有差异请填写核实说明');
 if(payload.holderVerified===true&&payload.decision!=='match')throw new c.HttpError(400,'有差异的款项不能标为全额持有人已核实');
 if(payload.holderVerified===true&&receipts.some(r=>ownership.isStoreAccount(store,r)||r.accountOwnerId!==who.id||(r.account==='现金'&&require('./cash-custody').inVault(r))))throw new c.HttpError(403,'门店账户由门店保管，核对不能标为老板本人账户已收款');
 if(payload.holderVerified===true)for(const receipt of receipts){const state=require('./money-verifications').state(store,receipt);if(!state.verifiedByHolder)require('./money-verifications').confirm(store,who,{receiptId:receipt.id,version:state.version,decision:'verify',verifiedAmount:Math.abs(receipt.amount),confirmed:true,evidence:note||'本人通过收款单入口明确核实本人账户款项'});}
 const at=c.now(),next={...structuredClone(current),status:payload.decision==='match'?'已核对':'有差异',version:current.version+1,actualCheckedAmount:actual,difference:c.round(actual-row.amount),checkedById:who.id,checkedByName:who.name,checkedAt:at,note};
 next.events.push({action:next.status,by:who.id,name:who.name,at,actualCheckedAmount:actual,note});row.reconciliation=next;
 for(const receipt of receipts){receipt.reconciliation=structuredClone(next);if(payload.holderVerified===true)receipt.holderVerification={status:'持有人已核实',verifiedByHolder:true,by:who.id,at,method:'人工声明，不是银行自动验证'};}
 for(const notice of store.localCatalogNotices||[])if(notice.key?.startsWith('receipt-reconciliation:'+row.id+':'))notice.readAt||=at;
 if(next.status==='有差异')addNotice(store,row,'收款单对账有差异');
 c.audit(store,who,'receipt:reconcile',{sourceId:row.id,status:next.status,registeredAmount:row.amount,actualCheckedAmount:actual,note});
 return {id:row.id,reconciliation:structuredClone(next),noAdditionalReceipt:true,message:next.status==='已核对'?'已记录老板核对结果，原收款不重复记账':'差异已留痕，账面原金额保留，未自动调账'};
}
module.exports={actor,scope,owns,validateParts,register,decorate,summary,pending,reconcile,addNotice};
