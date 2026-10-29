'use strict';
// Observations are reconciliation evidence. Only a locked book settlement can
// carry forward. An initial basis requires a separate, explicit owner decision.
const c=require('./common'),{createHash}=require('node:crypto');
const POLICY='wallet-locked-book-v1';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dated=r=>r.transactionDate||c.day(r.createdAt);
function inputs(store,account,date){
 const receipts=(store.receipts||[]).filter(r=>r.paymentAccountId===account.id&&dated(r)<=date);
 const transfers=require('./funds-network').confirmedStoreTransfers(store).filter(t=>t.sourceAccountId===account.id&&c.day(t.confirmedAt)<=date);
 const facts=receipts.map(r=>['receipt',r.id,dated(r),Number(r.amount),r.sourceId,r.kind,r.originalReceiptId||''])
  .concat(transfers.map(t=>['handover',t.id,c.day(t.confirmedAt),-Number(t.actualAmount),t.confirmedBy,t.recipientId])).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return {receipts,transfers,ledgerFingerprint:hash([account.id,facts])};
}
function proof(row){return hash([row.id,row.lockedAt,row.lockedBy,row.reviewedAt,row.reviewerId,row.walletSettlement]);}
function qualified(store,account,date){
 const valid=new Map();
 for(const row of (store.dailyCloseouts||[]).filter(r=>r.date<date).slice().sort((a,b)=>a.date.localeCompare(b.date))){
  const s=row.walletSettlement;
  if(row.status!=='已锁定'||!row.lockedAt||!row.lockedBy||!row.reviewedAt||!row.reviewerId||row.reviewerId===row.cashierId||row.checks?.wallet!==true||s?.policy!==POLICY||s.accountId!==account.id||typeof s.bookClosingBalance!=='number'||!Number.isFinite(s.bookClosingBalance))continue;
  if(s.ledgerFingerprint!==inputs(store,account,row.date).ledgerFingerprint)continue;
  if(s.kind==='initial'){
   if(!s.baselineEvidence||s.establishedBy!==row.lockedBy||s.baselineExplicit!==true)continue;
  }else if(s.kind==='carry'){
   const base=valid.get(s.basisId);
   if(!base||s.basisProof!==proof(base))continue;
   const f=inputs(store,account,row.date),change=f.receipts.filter(r=>dated(r)>base.date).reduce((n,r)=>n+Number(r.amount),0)-f.transfers.filter(t=>c.day(t.confirmedAt)>base.date).reduce((n,t)=>n+Number(t.actualAmount),0);
   if(c.round(base.walletSettlement.bookClosingBalance+change)!==s.bookClosingBalance)continue;
  }else continue;
  valid.set(row.id,row);
 }
 return [...valid.values()].sort((a,b)=>b.date.localeCompare(a.date)||String(b.lockedAt).localeCompare(String(a.lockedAt)))[0]||null;
}
function basis(store,account,date){
 const direct=require('./wallet-owner-baseline').calculate(store,account,date);if(direct)return direct;
 const previous=qualified(store,account,date),f=inputs(store,account,date);
 const since=previous?f.receipts.filter(r=>dated(r)>previous.date):[],transfers=previous?f.transfers.filter(t=>c.day(t.confirmedAt)>previous.date):[];
 const movement=c.round(since.reduce((n,r)=>n+Number(r.amount),0)-transfers.reduce((n,t)=>n+Number(t.actualAmount),0));
 const prior=previous?.walletSettlement.bookClosingBalance??null;
 return {policy:POLICY,previousId:previous?.id||null,previousDate:previous?.date||null,previousBalance:prior,basisProof:previous?proof(previous):null,ledgerFingerprint:f.ledgerFingerprint,movementSinceBasis:previous?movement:null,expectedBalance:prior==null?null:c.round(prior+movement),basisStatus:previous?'locked_book':'missing',fingerprint:hash([POLICY,account.id,previous?proof(previous):null,f.ledgerFingerprint])};
}
function assertFresh(store,row){
 const current=require('./wallet-daily').summary(store,row.date);
 if(!current.available||row.snapshot?.wallet?.policy!==POLICY||row.snapshot.wallet.fingerprint!==current.fingerprint)throw new c.HttpError(409,'门店微信规则、锁定基准或收付款已变化，请退回重新生成快照并复核');
 return current;
}
function settlement(store,row,user,payload){
 const w=assertFresh(store,row);
 if(row.checks?.wallet!==true||!row.reviewedAt||row.reviewerId===row.cashierId)throw new c.HttpError(409,'门店微信须由另一名营业员逐笔复核');
 const base={policy:POLICY,accountId:w.accountId,ledgerFingerprint:w.ledgerFingerprint};
 if(w.expectedBalance!=null){
  if(payload.walletBaselineClosing!=null&&payload.walletBaselineClosing!=='')throw new c.HttpError(409,'已有锁定账面基准，不能用实看余额或另填数字覆盖');
  return {...base,kind:'carry',bookClosingBalance:w.expectedBalance,basisId:w.previousId,basisProof:w.basisProof};
 }
 if(payload.walletBaselineClosing==null||payload.walletBaselineClosing==='')return {...base,kind:'unestablished',bookClosingBalance:null};
 const amount=c.money(payload.walletBaselineClosing,'首次门店微信账面结余基准'),evidence=String(payload.walletBaselineEvidence||'').trim().slice(0,1000);
 if(user.roleCode!=='owner'||payload.walletBaselineConfirmed!==true||!evidence||amount<0)throw new c.HttpError(400,'首次基准须老板单独填写非负金额、核实依据并明确确认；不自动采用实看余额');
 return {...base,kind:'initial',bookClosingBalance:amount,baselineExplicit:true,baselineEvidence:evidence,establishedBy:user.id};
}
module.exports={POLICY,basis,assertFresh,settlement,qualified};
