'use strict';
const c=require('./common'),businessPurpose=require('./business-purpose');
function build(original,viewer,boss,preparedLedger){
 const store=structuredClone(original),sources=new Map(),people=new Map(store.users.map(u=>[u.id,u])),rows=[],seen=new Set();
 for(const key of ['sales','purchases','saleReturns','expenses','otherIncome','supplierCash','storeWalletFundingRequests','storeCashWalletTransfers','payrollStatements','carrierServices','govSubsidyClaims','airFundingOrders','airRechargeEvents','procurementPlans','mobileCoinClaims'])for(const r of store[key]||[])sources.set(r.id,r);
 const number=r=>r?.displayNo||r?.orderNo||r?.id||'';
 function add(r){if(seen.has(r.id))return;seen.add(r.id);if(!Number.isFinite(r.amount)||r.amount<=0)return;const s=sources.get(r.sourceId)||{},sale=store.sales.find(x=>x.id===s.orderId),employeeId=r.employeeId||s.employeeId||s.operatorId||s.salespersonId||sale?.operatorId||sale?.salespersonId||r.operatorId||'';rows.push({...r,amount:c.round(r.amount),employeeId,employeeName:people.get(employeeId)?.name||'经办人待核实',sourceNo:r.sourceNo||number(s)||r.sourceId});}
 const ledger=preparedLedger||require('./fund-party-ledgers').build(store,boss);
 for(const r of ledger.daily)if(['unreceived','unpaid'].includes(r.bucket))add({id:'due:'+r.id,bucket:r.bucket,amount:r.amount,sourceId:r.sourceId,sourceNo:r.sourceNo,title:r.label,party:r.party,partyKey:r.partyKey,date:r.date,status:r.state,href:r.detailHref||r.href});
 const reversed=new Set(store.receipts.filter(r=>r.originalReceiptId&&(r.isReversal||/_red$/.test(r.kind||''))).map(r=>r.originalReceiptId));
 for(const r of store.receipts){const s=sources.get(r.sourceId)||{};if(r.isReversal||/_red$/.test(r.kind||'')||reversed.has(r.id)||s.redReversedBy||r.sourceClaimId||seen.has('receipt:'+r.id))continue;seen.add('receipt:'+r.id);
  const state=require('./money-verifications').state(store,r),pay=r.amount<0,verified=Math.min(state.reportedAmount,Math.max(0,state.verifiedAmount||0)),rest=Math.max(0,state.reportedAmount-verified),supplier=store.suppliers.find(p=>p.id===(r.supplierId||s.supplierId));
  const passThrough=businessPurpose.isPassThrough(store,r);
  const base={businessPurpose:businessPurpose.purpose(store,r),economicClass:passThrough?'pass_through':'operating',sourceId:r.sourceId,sourceNo:number(s)||r.sourceId,operatorId:r.operatorId||r.registeredById,title:require('./store-transfer').isReceipt(r)?require('./store-transfer').label(r):require('./wallet-funding-read').isReceipt(r)?require('./wallet-funding-read').label(r):passThrough?(pay?'代充值付款':'代充值收款'):pay?'付款':'收款',party:r.counterparty||s.counterparty||supplier?.name||s.customerName||'对方未填写',partyKey:r.fundPartyKey||s.fundPartyKey||(supplier?'supplier:'+supplier.id:''),date:r.transactionDate||s.date||c.day(r.createdAt),status:state.statusLabel,href:require('./store-transfer').isReceipt(r)?'/store-transfer?id='+encodeURIComponent(r.sourceId):'/business-reconciliation?id=money-'+encodeURIComponent(r.id)+'#money-'+encodeURIComponent(r.id)};
  if(verified)add({...base,id:'verified:'+r.id,bucket:pay?'paid':'received',amount:verified});
  if(rest)add({...base,id:'pending:'+r.id,bucket:pay?'pendingPaid':'pendingReceived',amount:rest});
 }
 const employees=[...people.values()].filter(u=>['owner','manager','employee','warehouse'].includes(u.roleCode)).map(u=>({id:u.id,name:u.name}));if(rows.some(r=>!r.employeeId))employees.push({id:'',name:'经办人待核实'});
 const parties=ledger.accounts.filter(p=>!['mine','wallet'].includes(p.kind)).map(p=>({key:p.key,name:p.name}));
 return {asOf:c.now(),employees,parties,rows:rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))),warnings:ledger.warnings,note:'应收应付按所选业务日期查询，余额截至目前；已收已付只计已核实金额。账面未核实款单列待核收／待核付，内部交款不重复计收入；代收代付不计营业收入或费用。'};
}
module.exports={build};
