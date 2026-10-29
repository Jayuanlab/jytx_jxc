'use strict';
const c=require('./common'),crypto=require('node:crypto');
const POLICY='wallet-owner-confirmed-baseline-v1';
const rawHash=x=>crypto.createHash('sha256').update(JSON.stringify(x??null)).digest('hex');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const hash=x=>rawHash(canonical(x));
// Accept existing first-baseline proof without rewriting it. JSONB changes object
// key order, not values. Preserve unknown fields so additions still invalidate it.
function legacyFactsHash(rows){return rawHash(rows.map(r=>{const keys=String(r.key).startsWith('receipt:')?['key','date','at','amount','sourceId','kind','originalReceiptId']:['key','date','at','amount','confirmedBy','recipientId'];return Object.fromEntries([...keys.filter(k=>Object.hasOwn(r,k)),...Object.keys(r).filter(k=>!keys.includes(k)).sort()].map(k=>[k,r[k]]));}));}
const dated=r=>r.transactionDate||c.day(r.createdAt);
function facts(store,account,date){
 const receipts=(store.receipts||[]).filter(r=>r.paymentAccountId===account.id&&dated(r)<=date).map(r=>({key:'receipt:'+r.id,date:dated(r),at:r.createdAt,amount:c.round(Number(r.amount)),sourceId:r.sourceId,kind:r.kind,originalReceiptId:r.originalReceiptId||''}));
 const transfers=require('./funds-network').confirmedStoreTransfers(store).filter(r=>r.sourceAccountId===account.id&&c.day(r.confirmedAt)<=date).map(r=>({key:'handover:'+r.id,date:c.day(r.confirmedAt),at:r.confirmedAt,amount:-c.round(Number(r.actualAmount)),confirmedBy:r.confirmedBy,recipientId:r.recipientId}));
 const rows=receipts.concat(transfers).sort((a,b)=>a.key.localeCompare(b.key));
 if(new Set(rows.map(r=>r.key)).size!==rows.length||rows.some(r=>!Number.isFinite(r.amount)||!r.date||!Number.isFinite(Date.parse(r.at))))throw new c.HttpError(409,'门店微信流水重复或缺少有效日期，请先核对');
 return rows;
}
function baseline(store,account,date){return (store.walletBookBaselines||[]).filter(r=>r.accountId===account.id&&r.date<=date).sort((a,b)=>b.date.localeCompare(a.date)||b.confirmedAt.localeCompare(a.confirmedAt))[0]||null;}
function calculate(store,account,date){
 const b=baseline(store,account,date);if(!b)return null;
 const rows=facts(store,account,date),byKey=new Map(rows.map(r=>[r.key,r])),captured=new Set((b.facts||[]).map(r=>r.key));
 const valid=b.policy===POLICY&&b.confirmed===true&&Number.isFinite(b.balance)&&b.balance>=0&&b.evidence&&b.confirmedBy&&Array.isArray(b.facts)&&(b.factsHash===hash(b.facts)||b.factsHash===legacyFactsHash(b.facts))&&b.facts.every(r=>hash(byKey.get(r.key))===hash(r));
 const added=rows.filter(r=>!captured.has(r.key));
 const reason=!valid?'门店微信基准来源已变化，须核对原流水；不能自动覆盖基准':added.some(r=>r.date<b.date||Date.parse(r.at)<=Date.parse(b.confirmedAt))?'门店微信新增了基准前的补录流水，须核对是否已包含在实看余额中':'';
 const movement=c.round(added.reduce((n,r)=>n+r.amount,0));
 return {policy:'wallet-locked-book-v1',basisPolicy:POLICY,previousId:b.id,previousDate:b.date,previousBalance:b.balance,basisProof:hash(b),ledgerFingerprint:hash(rows),movementSinceBasis:reason?null:movement,expectedBalance:reason?null:c.round(b.balance+movement),basisStatus:reason?'source_changed':'owner_confirmed',reason,baselineAt:b.confirmedAt,baselineEvidence:b.evidence,baselineConfirmedBy:b.confirmedBy,fingerprint:hash([POLICY,b,rows])};
}
function establish(store,user,payload){
 const who=c.userById(store,user.id);if(user.roleCode!=='owner'||who.roleCode!=='owner'||who.status!=='active'||who.assistantCustomerOnly)throw new c.HttpError(403,'门店微信首次余额基准只能由老板本人确认');
 const accounts=(store.paymentAccounts||[]).filter(a=>['门店微信','信号机微信'].includes(a.name)&&a.channel==='微信'&&a.active!==false);
 if(accounts.length!==1||payload.accountId!==accounts[0].id)throw new c.HttpError(409,'请核实唯一的门店微信账户');const account=accounts[0];
 if(payload.confirmed!==true||payload.date!==c.day()||!String(payload.evidence||'').trim())throw new c.HttpError(400,'须明确确认今天实际结余及核实依据');
 const amount=require('./payment-accounts').cents(payload.balance,'门店微信实际结余')/100;
 const existing=(store.walletBookBaselines||[]).filter(r=>r.accountId===account.id);if(existing.length){const old=existing[0];if(existing.length===1&&old.date===payload.date&&old.balance===amount&&old.confirmedBy===who.id&&calculate(store,account,payload.date)?.basisStatus==='owner_confirmed')return old;throw new c.HttpError(409,'已有账面基准，不能重复建立或覆盖');}
 if(require('./wallet-book-balance').qualified(store,account,payload.date))throw new c.HttpError(409,'已有锁定账面基准，不能用实看余额覆盖');
 const rows=facts(store,account,payload.date);if(payload.expectedFactsHash!==hash(rows))throw new c.HttpError(409,'账户流水已变化，请重新核对后登记基准');
 const row={id:c.id('WB'),policy:POLICY,accountId:account.id,accountName:'门店微信',date:payload.date,balance:amount,confirmed:true,confirmedAt:c.now(),confirmedBy:who.id,confirmedByName:who.name,evidence:String(payload.evidence).trim().slice(0,1500),facts:rows,factsHash:hash(rows),effect:'余额基准；不产生收入、支出、现金或历史账单更改'};
 (store.walletBookBaselines||=[]).push(row);c.audit(store,who,'wallet:establish-owner-baseline',{id:row.id,accountId:row.accountId,date:row.date,balance:row.balance,evidence:row.evidence,factsHash:row.factsHash});return row;
}
function findings(store){
 const w=require('./wallet-daily').summary(store,c.day());if(!w.available)return [];
 if(w.expectedBalance==null)return [{id:'wallet-book-basis:'+w.accountId,severity:w.basisStatus==='source_changed'?'高':'中',summary:w.reason||'门店微信缺少已确认账面基准；实报余额不能自动当作期初',inAppOnly:true,href:'/simple-daily-close'}];
 return w.expectedBalance<0?[{id:'wallet-book-negative:'+w.accountId,severity:'高',summary:'门店微信账面余额为负，请核对漏记收支',inAppOnly:true,href:'/simple-daily-close'}]:[];
}
module.exports={POLICY,facts,hash,calculate,establish,findings};
