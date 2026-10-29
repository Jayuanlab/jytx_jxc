'use strict';
// Economic purpose is explicit business data. Notes never determine postings.
const c=require('./common');
const TOPUP='agency_topup',OPERATING='operating',POLICY=require('./active-business-rules.json').rules.find(r=>r.topicKey==='agency_topup').version;
function normalizePurpose(value){if(value==null||value==='')return OPERATING;if(typeof value!=='string'||![OPERATING,TOPUP].includes(value))throw new c.HttpError(400,'请选择正常经营收付或代充值收付');return value;}
function linked(store,row){const id=row.id,sourceId=row.sourceId;return (store.walletCashExchanges||[]).some(x=>(id&&[x.cashReceiptId,x.walletReceiptId,x.cashSourceId,x.walletSourceId].includes(id))||(sourceId&&[x.cashSourceId,x.walletSourceId].includes(sourceId)));}
function isPassThrough(store,row,seen=new Set()){
 if(!row||typeof row!=='object'||seen.has(row)||seen.size>20)return false;seen.add(row);
 if(row.businessPurpose===TOPUP||row.economicClass==='pass_through'||linked(store,row))return true;
 const parents=[row.originalReceiptId,row.redOf,row.sourceId].filter(Boolean);
 for(const id of parents){for(const collection of ['receipts','expenses','otherIncome']){const parent=(store[collection]||[]).find(x=>x.id===id);if(parent&&parent!==row&&isPassThrough(store,parent,seen))return true;}}
 return false;
}
function purpose(store,row){if(require('./store-transfer').isReceipt(row)||require('./wallet-funding-read').isReceipt(row))return 'internal_transfer';return isPassThrough(store,row)?TOPUP:OPERATING;}
function validateParts(store,value,direction,parts){
 const selected=normalizePurpose(value);if(selected!==TOPUP)return selected;
 if(!['receive','pay'].includes(direction))throw new c.HttpError(400,'代充值须分别登记收款单和付款单');
 const accounts=require('./payment-accounts'),ownership=require('./account-ownership');
 if(!Array.isArray(parts)||parts.length!==1)throw new c.HttpError(400,'代充值每张单只登记一笔实际收付，请分别开现金收款单和门店微信付款单');
 const p=parts[0];if(!(Number(p.amount)>0)||!ownership.isStoreAccount(store,p))throw new c.HttpError(400,'代充值必须使用门店资金账户');
 if(direction==='receive'&&p.account!=='现金')throw new c.HttpError(400,'代充值收款单请选择门店现金');
 const wallets=new Set(accounts.allowedPaymentAccounts(store).filter(a=>a.channel==='微信').map(a=>a.id));
 if(direction==='pay'&&(p.account!=='微信'||!wallets.has(p.paymentAccountId)))throw new c.HttpError(400,'代充值付款单请选择门店微信具体账户');
 return selected;
}
function classify(store,source,value){
 const selected=normalizePurpose(value),fields={businessPurpose:selected,economicClass:selected===TOPUP?'pass_through':'operating',businessPurposePolicy:POLICY};
 Object.assign(source,fields);for(const part of source.paymentParts||[])Object.assign(part,fields);for(const receipt of store.receipts||[])if(receipt.sourceId===source.id)Object.assign(receipt,fields);
 return fields;
}
module.exports={TOPUP,OPERATING,POLICY,normalizePurpose,isPassThrough,purpose,validateParts,classify};
