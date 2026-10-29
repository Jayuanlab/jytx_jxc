'use strict';
const c=require('./common');
const NAME='门店微信',NAMES=new Set(['门店微信','信号机微信']);
function summary(store,date){
 const candidates=(store.paymentAccounts||[]).filter(x=>NAMES.has(x.name)&&x.channel==='微信'&&x.active!==false);
 if(candidates.length>1)return {accountName:NAME,displayName:NAME,available:false,reason:'门店微信存在多个启用账户，请先核实具体账户，不合并余额'};
 const account=candidates[0];
 if(!account)return {accountName:NAME,displayName:'门店微信',available:false,reason:'门店微信账户未启用'};
 const dated=r=>r.transactionDate||c.day(r.createdAt);
 const receipts=(store.receipts||[]).filter(r=>r.paymentAccountId===account.id&&dated(r)<=date);
 const today=receipts.filter(r=>dated(r)===date);
 const book=require('./wallet-book-balance').basis(store,account,date);
 const transfers=require('./funds-network').confirmedStoreTransfers(store).filter(t=>t.sourceAccountId===account.id&&c.day(t.confirmedAt)<=date),todayTransfers=transfers.filter(t=>c.day(t.confirmedAt)===date);
 const sourceRows=[...(store.otherIncome||[]),...(store.expenses||[]),...(store.cashHandovers||[])];const documentNo=id=>(store.documentNumbers||[]).find(d=>d.sourceId===id)?.displayNo||id;
 const entries=today.map(r=>({displayNo:documentNo(r.id),sourceDisplayNo:documentNo(r.sourceId),counterparty:r.counterparty||sourceRows.find(s=>s.id===r.sourceId)?.counterparty||'',business:require('./store-transfer').isReceipt(r)?require('./store-transfer').label(r):r.kind==='other_income'?'门店微信收款':r.kind==='expense'?'门店微信付款':r.kind==='mobile_activity_customer_payment'?'活动机门店返用户':r.kind,reason:r.note||sourceRows.find(s=>s.id===r.sourceId)?.note||(r.activityId?'关联活动单 '+r.activityId:''),transactionDate:dated(r),id:r.id,sourceId:r.sourceId,kind:r.kind,amount:Number(r.amount),at:r.createdAt,accountName:NAME,displayName:'门店微信'})).concat(todayTransfers.map(t=>({id:'internal:'+t.id,sourceId:t.id,kind:'internal_handover',amount:-Number(t.actualAmount),at:t.confirmedAt,accountName:NAME,displayName:'门店微信',recipientId:t.recipientId,confirmedBy:t.confirmedBy,noAdditionalReceipt:true})));
 return {accountId:account.id,accountName:NAME,displayName:'门店微信',available:true,...book,todayIn:c.round(today.filter(r=>r.amount>0).reduce((n,r)=>n+Number(r.amount),0)),todayOut:c.round(-today.filter(r=>r.amount<0).reduce((n,r)=>n+Number(r.amount),0)+todayTransfers.reduce((n,t)=>n+Number(t.actualAmount),0)),todayNet:c.round(today.reduce((n,r)=>n+Number(r.amount),0)-todayTransfers.reduce((n,t)=>n+Number(t.actualAmount),0)),entries};
}
function confirm(shot,payload){
 if(!shot.available)throw new c.HttpError(409,shot.reason||'门店微信账户不可用');
 if(payload.walletActualBalance==null||payload.walletActualBalance==='')throw new c.HttpError(400,'请核对门店微信增减记录并填写实看余额');
 const actual=c.money(payload.walletActualBalance,'门店微信实看余额');
 if(actual<0)throw new c.HttpError(400,'门店微信实看余额不能为负');
 if(payload.walletChecked!==true)throw new c.HttpError(400,'请逐笔核对门店微信收支后确认');
 const difference=shot.expectedBalance==null?null:c.round(actual-shot.expectedBalance);
 return {actual,difference};
}
function reviewMovement(shot,payload,user){if(!shot.available)throw new c.HttpError(409,shot.reason||'门店微信账户不可用');if(payload.walletInChecked!==true||payload.walletOutChecked!==true)throw new c.HttpError(400,'请分别逐笔核对门店微信当日增加和减少；无发生也须确认');return {policy:'store-wallet-daily-movement-v1',accountId:shot.accountId,inChecked:true,outChecked:true,todayIn:shot.todayIn,todayOut:shot.todayOut,todayNet:shot.todayNet,receiptIds:shot.entries.map(r=>r.id),checkedBy:user.id,checkedAt:c.now()};}
module.exports={summary,confirm,reviewMovement};
