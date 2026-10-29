 'use strict';
const c=require('./common'),ownership=require('./account-ownership');
const POLICY='scan-payment-owner-account-v1',FROM='2026-10-22',CHANNELS=['微信','支付宝'];
const owner=(store,id)=>(store.users||[]).find(u=>u.id===id&&u.roleCode==='owner'&&u.status==='active'&&!u.assistantCustomerOnly);
const accountId=(channel,id)=>'owner-'+(channel==='微信'?'wechat':'alipay')+':'+id;
function accounts(store){return (store.users||[]).filter(u=>owner(store,u.id)).flatMap(u=>CHANNELS.map(channel=>({id:accountId(channel,u.id),name:'老板'+channel,displayName:'扫码支付 · 老板'+channel,channel,ownerId:u.id,ownerName:u.name,accountScope:'personal',active:true,system:true,note:'扫码支付为收款方式；该账户为实际到账账户，与门店微信备用资金分开。'})));}
function target(store,row,date){if(date<FROM||!CHANNELS.includes(row.account)||ownership.isStoreAccount(store,row)||!owner(store,row.accountOwnerId))return null;
 const profile=(store.paymentAccounts||[]).find(p=>p.id===row.paymentAccountId),name=profile?.name||row.accountName||row.account;
 // A specific configured third-party account is never inferred to be an owner's wallet.
 if(profile&&name!=='老板'+row.account)return null;
 if(!['老板'+row.account,row.account,'扫码支付','门店微信扫码','微信扫码'].includes(name))return null;
 if(name==='老板'+row.account||row.kind==='sale'||row.collectionMethod==='scan_payment')return {id:accountId(row.account,row.accountOwnerId),name:'老板'+row.account,ownerId:row.accountOwnerId,scope:'personal'};return null;
}
function isScan(store,row,date){return !!target(store,row,date)&&['sale','refund','sale_red','refund_red','internal_scan_in'].includes(row.kind);}
function declarePaid(handler){return function(store,user,payload){const beforeNotices=new Set((store.localCatalogNotices||[]).map(n=>n.key)),result=handler(store,user,payload),order=(store.sales||[]).find(o=>o.id===payload.orderId);if(!order||result.alreadyDeclared)return result;
 const part=order.paymentParts?.find(p=>p.id===(payload.partId||result.partId)),date=order.transactionDate||c.day(order.createdAt),facts=part?{...part,kind:'sale'}:{account:order.paymentMethod,accountName:order.accountName||order.paymentMethod,accountOwnerId:order.paymentReview?.recipientId||order.accountOwnerId,kind:'sale'},a=target(store,facts,date);
 if(!a)return result;const evidence={policy:POLICY,method:'scan_payment',label:'扫码支付',channel:facts.account,destinationAccountId:a.id,destinationAccountName:a.name,confirmedBy:user.id,confirmedAt:c.now(),reconciliationStatus:'待核对',noAdditionalReceipt:true};
 (part||order.paymentReview).scanCollectionConfirmation=evidence;
 for(const r of store.receipts||[])if(r.kind==='sale'&&r.sourceId===order.id&&(!part||r.partId===part.id))Object.assign(r,{collectionMethod:'scan_payment',collectionMethodLabel:'扫码支付',destinationAccountId:a.id,destinationAccountName:a.name});
 store.localCatalogNotices=(store.localCatalogNotices||[]).filter(n=>beforeNotices.has(n.key)||!String(n.key).startsWith('sale-payment-local:'+order.id));
 return {...result,scanReceiptConfirmed:true,collectionMethod:'scan_payment',destinationAccountName:a.name};};}
module.exports={POLICY,FROM,CHANNELS,accountId,accounts,target,isScan,declarePaid};
