'use strict';
const c=require('./common'),master=require('./master-data');
const KEY='wallet:cash-vault';
function account(store){
 const existing=(store.paymentAccounts||[]).find(a=>a.active!==false&&a.channel==='现金'&&['现金库','门店现金'].includes(a.name));
 if(existing){const verifierId=existing.verifierId||existing.ownerId||'',verifier=(store.users||[]).find(u=>u.id===verifierId);return {...existing,name:'门店现金',accountScope:'store',ownerId:'',ownerName:'门店',custodyLabel:'门店抽屉',verifierId,verifierName:existing.verifierName||verifier?.name||''};}
 const owners=(store.users||[]).filter(u=>u.status==='active'&&u.roleCode==='owner'&&!u.assistantCustomerOnly);
 const verifier=owners.length===1?owners[0]:null;return {id:'SYSTEM-CASH-VAULT',name:'门店现金',channel:'现金',accountScope:'store',ownerId:'',ownerName:'门店',custodyLabel:'门店抽屉',verifierId:verifier?.id||'',verifierName:verifier?.name||'',active:true,system:true,note:'现金归门店，保管地点为门店抽屉；核对人不表示个人实际持有。交给个人须由内部交接单接收人本人确认。'};
}
function project(store,user){
 const who=master.actor(store,user),vault=account(store),rows=[],seen=new Set(),receipts=store.receipts||[];
 const reversed=new Set(receipts.filter(r=>r.originalReceiptId&&(r.isReversal||/_red$/.test(r.kind||''))).map(r=>r.originalReceiptId));
 const saleRows=require('./sale-fund-responsibility').project(store);let incoming=0,outgoing=0,deposits=0,unverified=0;
 const person=id=>(store.users||[]).find(u=>u.id===id)?.name||id||'未注明';
 const number=id=>(store.documentNumbers||[]).find(n=>n.sourceId===id)?.displayNo||id;
 for(const r of receipts){
  if(r.account!=='现金'||!require('./cash-custody').inVault(r)||r.sourceClaimId||r.isReversal||/_red$/.test(r.kind||'')||reversed.has(r.id))continue;
  if(!r.id||seen.has(r.id))throw new c.HttpError(409,'现金流水编号重复，暂不能汇总门店现金');seen.add(r.id);
  const amount=Number(r.amount);if(!Number.isFinite(amount))throw new c.HttpError(409,'现金金额异常，请核对原单');
  if(!amount)continue;let state=require('./money-verifications').state(store,r);if(r.kind==='sale'){const part=saleRows.find(x=>x.orderId===r.sourceId&&x.partId===(r.partId||'legacy'));if(part){const same=receipts.filter(x=>x.kind==='sale'&&x.sourceId===r.sourceId&&(x.partId||'legacy')===(r.partId||'legacy')&&!x.isReversal&&!reversed.has(x.id)&&Number(x.amount)>0),index=same.findIndex(x=>x.id===r.id),start=same.slice(0,index).reduce((n,x)=>n+Math.round(Number(x.amount)*100),0),end=start+Math.round(amount*100),covered=part.coverageRanges.reduce((n,x)=>n+Math.max(0,Math.min(end,x.toCents)-Math.max(start,x.fromCents)),0)/100,verified=state.status==='disputed'?Number(state.verifiedAmount||0):Math.min(amount,Math.max(Number(state.verifiedAmount||0),covered));state={...state,verifiedAmount:verified,unverifiedAmount:c.round(Math.max(0,amount-verified)),verifiedByHolder:false,verifiedByOwner:false,verifiedByStore:state.status!=='disputed'&&verified>=amount};}}
  if(amount>0){incoming+=amount;unverified+=Math.max(0,state.unverifiedAmount);}else outgoing-=amount;
  const verification=state.verification?.events?.at(-1)||state.derivedOwnerDirectReceipt||r.holderVerification;
  rows.push({id:'vault:'+r.id,receiptId:r.id,sourceId:r.sourceId,sourceNo:number(r.sourceId),party:'门店现金',kind:r.kind,label:require('./store-transfer').isReceipt(r)?require('./store-transfer').label(r):amount>0?'门店现金收款登记':'门店现金付款登记',amount:Math.abs(amount),bucket:amount>0?'received':'paid',at:r.createdAt,date:r.transactionDate||c.day(r.createdAt),channel:'门店现金',holder:'门店抽屉',operator:person(r.operatorId||r.registeredById),verifiedByStore:state.verifiedByStore===true,verifiedByHolder:false,verifiedByOwner:false,pendingAmount:Number(state.unverifiedAmount||0),state:state.status==='disputed'?'门店账户核实有差异':state.verifiedByStore?'门店已核实':state.verifiedAmount>0?'门店已部分核实':'门店账户待核实',note:'门店账户核对与个人实收分别留痕'+(verification?.by?'；核对人 '+person(verification.by):'')+(verification?.at?'；核对时间 '+verification.at:''),reference:r.reference||'',href:require('./store-transfer').isReceipt(r)?'/store-transfer?id='+encodeURIComponent(r.storeTransferId):r.kind==='sale'?'/sale-fund-responsibility?order='+encodeURIComponent(r.sourceId)+(r.partId?'&part='+encodeURIComponent(r.partId):''):'/business-reconciliation?section=money'});
 }
 for(const h of store.cashHandovers||[]){
  if(h.sourceCorrection||!(h.kind==='bank'||h.receiptKind==='bank_deposit')||h.status!=='已确认收到')continue;
  const amount=Number(h.actualAmount);if(!Number.isFinite(amount)||amount<0)throw new c.HttpError(409,'存款交接金额异常');
  deposits+=amount;rows.push({id:'vault-deposit:'+h.id,sourceId:h.id,sourceNo:number(h.id),party:'门店现金',kind:'cash_bank_deposit',label:'门店现金转存银行',amount,bucket:'internal',at:h.confirmedAt||h.createdAt,date:h.transactionDate||c.day(h.confirmedAt||h.createdAt),channel:'现金 → '+(h.destinationAccountName||'银行账户'),operator:h.sender||person(h.senderId),holder:h.recipient||person(h.recipientId),state:'已确认存款',reference:h.bankRef||'',note:'内部转存，不重复营业收入；确认人 '+person(h.confirmedBy)+'；确认时间 '+(h.confirmedAt||''),href:'/cash-handover?handover='+encodeURIComponent(h.id)});
 }
 for(const t of store.cashVaultTransfers||[]){incoming+=Number(t.amount);rows.push({id:'vault-transfer:'+t.id,sourceId:t.sourceId,sourceNo:number(t.sourceId),receiptId:t.receiptId,party:'门店现金',kind:'cash_custody_transfer',label:'员工暂存现金交入门店现金',amount:t.amount,bucket:'internal',at:t.at,date:t.date,channel:'员工暂存 → 门店现金',operator:person(t.fromId),holder:t.name,state:'营业员已确认入库',note:'只转移现金保管，不重复营业收入；确认人 '+t.name,href:'/business-reconciliation?section=money'});}
 let personHandovers=0;
 for(const h of require('./cash-custody').confirmedStoreOutgoing(store)){personHandovers+=Number(h.actualAmount);rows.push({id:'vault-handover:'+h.id,sourceId:h.id,sourceNo:number(h.id),party:'门店现金',kind:'store_cash_handover',label:'门店现金内部交接给个人',amount:Number(h.actualAmount),bucket:'internal',at:h.confirmedAt,date:h.transactionDate||c.day(h.confirmedAt),channel:'门店现金 → 个人接收',operator:h.sender||person(h.senderId),holder:h.recipient||person(h.recipientId),state:'接收人本人已确认',note:'只转移资金保管，不重复营业收入或费用',href:'/cash-handover?handover='+encodeURIComponent(h.id)});}
 for(const row of rows)if(row.kind!=='store_cash_handover'&&row.kind!=='cash_bank_deposit')row.holder='门店抽屉';
 rows.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
 const report=require('./assistant-finance').build(store,who,c.day()),visible=report.cashBalanceVisible,confirmed=(store.financeDayReports||[]).some(r=>r.date===report.date&&r.status==='confirmed'&&r.cashMatched&&(r.postFingerprint||r.fingerprint)===report.fingerprint);
 const position={balanceVisible:visible,balance:report.cash.expected,openingKnown:report.cash.opening!=null,balanceDate:report.date,asOf:report.asOf,verificationStatus:!visible?'提交实点后核对':report.referenceNeedsReview?'待复核':confirmed?'已核实':report.cash.difference!=null&&report.cash.difference!==0?'有差异 · 待核实':'待核实',opening:report.cash.opening,todayReceived:report.cash.received,todayPaid:report.cash.paid,todayBankDeposits:report.cash.bankDeposits,adjustment:report.cash.adjustment,physical:report.cash.physical,difference:report.cash.difference};
 return {key:KEY,name:'门店现金',accountId:vault?.id||'',accountScope:'store',ownerId:'',ownerName:'门店',custodyLabel:'门店抽屉',verifierId:vault?.verifierId||'',registeredIn:c.round(incoming),registeredOut:c.round(outgoing),confirmedBankDeposits:c.round(deposits),confirmedPersonalHandovers:c.round(personHandovers),registeredNetMovement:c.round(incoming-outgoing-deposits-personHandovers),unverifiedAmount:c.round(unverified),...position,notice:visible?'当前余额为账面应有门店现金；内部交接经接收人确认后才转出，扎账提交实点后核对。':'先独立清点并提交实点，提交后显示应有数与差额。',rows};
}
function decorate(store,user,data){
 const v=project(store,user);
 data.cashVault={...v,rows:undefined};
 data.accounts=data.accounts.filter(a=>a.key!==KEY);
 data.accounts.push({key:KEY,id:v.accountId,name:v.name,kind:'wallet',accountScope:'store',ownerId:'',custodyLabel:'门店抽屉',active:true,scope:v.notice,totals:{paid:v.registeredOut,received:v.registeredIn,unpaid:0,unreceived:0},pendingAmount:v.unverifiedAmount,pendingCount:v.rows.filter(r=>r.pendingAmount>0).length,warningCount:0,rows:v.rows,custody:[],cashVault:true,registeredNetMovement:v.registeredNetMovement,confirmedBankDeposits:v.confirmedBankDeposits,confirmedPersonalHandovers:v.confirmedPersonalHandovers});
 return data;
}
function summary(store,user){const {rows,...data}=project(store,user);return data;}module.exports={KEY,account,project,summary,decorate};
