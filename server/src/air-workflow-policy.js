'use strict';
// Reuse explicit workflow evidence. Never create a receipt or invent owner verification.
const cents=n=>Math.round(Number(n||0)*100);
const find=(s,k,id)=>(s[k]||[]).find(r=>r.id===id);
function cashProof(s,r){
 if(r.kind!=='cash_recharge'||r.account!=='现金'||!(r.amount>0)||r.isReversal||r.sourceClaimId)return null;
 const e=find(s,'airRechargeEvents',r.sourceId),v=(s.moneyVerifications||[]).find(x=>x.receiptId===r.id);
 if(!e||e.kind!=='customer_recharge'||cents(e.cashReceived)!==cents(r.amount)||cents(e.debitAmount)!==cents(r.amount)||cents(e.amount)!==-cents(r.amount)||['disputed','partial'].includes(v?.status))return null;
 if((s.receipts||[]).some(x=>x.originalReceiptId===r.id&&(x.isReversal||/_red$/.test(x.kind||''))))return null;
 const transfers=(s.cashVaultTransfers||[]).filter(t=>t.receiptId===r.id),moved=transfers.reduce((n,t)=>n+cents(t.amount),0);
 if(r.cashDestination==='employee'&&moved===cents(r.amount))return {kind:'cash_vault_handover',by:transfers.at(-1)?.by,at:transfers.at(-1)?.at,label:'充值现金已交入门店现金，交接完成'};
 if(r.cashDestination==='vault'&&r.cashCustodyDeclaredBy&&r.cashCustodyDeclaredAt)return {kind:'cash_vault_declaration',by:r.cashCustodyDeclaredBy,at:r.cashCustodyDeclaredAt,label:'经办人已确认充值现金入门店现金'};
 return null;
}
function fundingProof(s,r){
 if(r.kind!=='air_funding'||!(r.amount<0)||r.isReversal)return null;
 const o=(s.airFundingOrders||[]).find(o=>o.paymentReceiptIds?.includes(r.id));
 if(!o||!o.paidAt||!o.payerId||o.payerId!==r.operatorId||o.payerId!==r.accountOwnerId||!o.events?.some(e=>e.type==='老板已充值'&&e.by===o.payerId))return null;
 const rs=o.paymentReceiptIds.map(id=>find(s,'receipts',id));
 if(rs.some(x=>!x||x.kind!=='air_funding'||x.sourceId!==o.id||x.amount>=0)||rs.reduce((n,x)=>n-cents(x.amount),0)!==cents(o.paidAmount))return null;
 if((s.moneyVerifications||[]).some(x=>x.receiptId===r.id&&['disputed','partial'].includes(x.status))||(s.receipts||[]).some(x=>x.originalReceiptId===r.id&&(x.isReversal||/_red$/.test(x.kind||''))))return null;
 return {kind:'owner_recorded_air_funding',by:o.payerId,at:o.paidAt,label:'老板已登记实际充值付款；平台到账按空充单确认'};
}
function receiptState(s,r,base){const proof=cashProof(s,r)||fundingProof(s,r);if(!proof)return null;return {...base,verifiedAmount:base.reportedAmount,unverifiedAmount:0,verificationNotRequired:true,verifiedByHolder:false,verifiedByOwner:false,status:'workflow_complete',statusLabel:proof.label,workflowEvidence:proof,note:'已使用原流程确认依据，不重复要求老板核实，不新增资金流水。'};}
function route(s,collection,row){
 if(collection==='airFundingOrders'&&['待老板充值','待到账确认','待核到账','已启用','已撤回'].includes(row.status)){
  if((s.moneyVerifications||[]).some(v=>row.paymentReceiptIds?.includes(v.receiptId)&&['disputed','partial'].includes(v.status)))return null;
  return {label:row.status==='已撤回'?'申请已撤回，保留记录':row.status==='已启用'?'平台到账已确认，空充流程完成':'按空充单当前步骤办理',href:'/air-accounts?order='+encodeURIComponent(row.id)};
 }
 if(collection==='airRechargeEvents'&&row.kind==='funding'&&row.fundingOrderId){const o=find(s,'airFundingOrders',row.fundingOrderId);if(o?.status==='已启用'&&o.rechargeEventId===row.id&&cents(o.creditedAmount)===cents(row.amount)&&route(s,'airFundingOrders',o))return {label:'平台到账已确认，空充流程完成',href:'/air-accounts?order='+encodeURIComponent(o.id)};}
 if(collection==='airRechargeEvents'&&row.kind==='customer_recharge'){const rs=(s.receipts||[]).filter(r=>r.sourceId===row.id&&!r.isReversal);if(rs.length===1&&cashProof(s,rs[0]))return {label:'充值现金已确认入门店现金',href:'/air-recharge?event='+encodeURIComponent(row.id)};}
 return null;
}
function reviewRoute(s,row){if(row.status==='disputed')return null;const source=find(s,row.sourceCollection,row.sourceId);return source?route(s,row.sourceCollection,source):null;}
function noticeState(s,n){
 const br=(s.businessReconciliations||[]).find(r=>r.id===(n.businessReconciliationId||n.orderId));
 if(br){const result=reviewRoute(s,br);if(result)return {...result,kind:'空充流程记录',ownerActionRequired:false};}
 const o=find(s,'airFundingOrders',n.orderId);
 if(o&&/^air-order-/.test(n.key||'')){
  const active=(n.key.startsWith('air-order-created:')&&o.status==='待老板充值')||(n.key.startsWith('air-order-not-arrived:')&&o.status==='待核到账')||(n.key.startsWith('air-order-paid:')&&o.status==='待到账确认'&&o.receiverId===o.payerId);
  if(!active)return {label:'当前状态：'+o.status,href:'/air-accounts?order='+encodeURIComponent(o.id),kind:'空充流程记录',ownerActionRequired:false};
 }
 if(n.key?.startsWith('air-recharge-sale:')){const e=find(s,'airRechargeEvents',n.orderId),result=e&&route(s,'airRechargeEvents',e);if(result)return {...result,kind:'顾客充值入库记录',ownerActionRequired:false};}
 return null;
}
module.exports={cashProof,fundingProof,receiptState,route,reviewRoute,noticeState};
