'use strict';
const c=require('./common'),{createHash}=require('node:crypto');
const POLICY='whole-store-vault-v2';
const day=r=>r.transactionDate||r.businessDate||c.day(r.createdAt);
function cents(value,label){const n=Number(value),v=Math.round(n*100);if(value==null||!Number.isFinite(n)||Math.abs(n*100-v)>0.00001)throw new c.HttpError(409,label+'金额异常，请核对原单');return v;}
function unique(rows,label){const ids=new Set();for(const r of rows){if(!r.id||ids.has(r.id))throw new c.HttpError(409,label+'编号重复或缺失，请核对原单');ids.add(r.id);}return rows;}
function build(s,date){
 const rows=unique(require('./serial-source-corrections').receiptRows(s).filter(r=>day(r)===date&&r.account==='现金'&&!r.sourceClaimId&&require('./cash-custody').inVault(r)),'现金流水');
 const transfers=unique((s.cashVaultTransfers||[]).filter(t=>t.date===date),'现金入库交接');
 const bank=unique((s.cashHandovers||[]).filter(h=>(h.transactionDate||c.day(h.confirmedAt||h.createdAt))===date&&(h.kind==='bank'||h.receiptKind==='bank_deposit')&&!h.sourceCorrection&&h.status==='已确认收到'),'现金转存银行');
 const outgoing=unique(require('./cash-custody').confirmedStoreOutgoing(s,date),'门店现金内部交出');
 const sum=(rs,key)=>rs.reduce((n,r)=>n+cents(r[key],key),0),transferTotal=sum(transfers,'amount'),storeOutgoingTotal=sum(outgoing,'actualAmount'),net=sum(rows,'amount')+transferTotal-storeOutgoingTotal,bankTotal=sum(bank,'actualAmount');
 const ref=(s.financeDayReferences||[]).filter(r=>r.date===date).at(-1),previousDate=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10),prior=(s.financeDayReports||[]).filter(r=>r.date===previousDate&&r.status==='confirmed'&&r.cashClosing!=null).at(-1),previousReference=(s.financeDayReferences||[]).filter(r=>r.date===previousDate).at(-1),lastLocked=(s.dailyCloseouts||[]).filter(r=>r.date===previousDate&&r.status==='已锁定').at(-1);
 const opening=ref?cents(ref.openingCash,'期初'):prior?cents(prior.cashClosing,'上日确认结存'):previousReference?.reportedClosing!=null?cents(previousReference.reportedClosing,'上日报表结存'):lastLocked?cents(lastLocked.actualCash,'上日扎账结存'):null,adjustment=ref?cents(ref.cashAdjustment??0,'已核清调整'):0;
 const fingerprint=createHash('sha256').update(JSON.stringify({policy:POLICY,date,rows:rows.map(r=>[r.id,r.amount,r.cashDestination||'',r.sourceId]),transfers:transfers.map(t=>[t.id,t.receiptId,t.amount]),bank:bank.map(h=>[h.id,h.actualAmount,h.transactionDate||'',h.confirmedAt]),outgoing:outgoing.map(h=>[h.id,h.actualAmount,h.recipientId,h.confirmedBy,h.transactionDate||'',h.confirmedAt]),opening,adjustment})).digest('hex');
 return {policy:POLICY,scope:'whole_store_vault',rows,transfers,bank,outgoing,transferTotal,storeOutgoingTotal,bankTotal,net,opening,adjustment,ref,prior,previousReference,lastLocked,fingerprint,received:sum(rows.filter(r=>r.amount>0),'amount')+transferTotal,paid:-sum(rows.filter(r=>r.amount<0),'amount')};
}
function snapshot(s,date){const b=build(s,date);return {cashBasisPolicy:POLICY,cashScope:b.scope,cashBasisFingerprint:b.fingerprint,cashChange:b.net/100,cashBankDeposits:b.bankTotal/100,cashStoreOutgoing:b.storeOutgoingTotal/100,cashAdjustment:b.adjustment/100,openingCashSuggested:b.opening==null?null:b.opening/100};}
function expected(opening,shot){if(shot.cashBasisPolicy!==POLICY)throw new c.HttpError(409,'旧扎账现金口径须先重算');return (cents(opening,'期初')+cents(shot.cashChange,'现金净流水')-cents(shot.cashBankDeposits,'转存银行')+cents(shot.cashAdjustment,'已核清调整'))/100;}
// Cash counts may carry an owner-verified basis across days without changing formal settlement snapshots.
function rollingSnapshot(s,date){
 const current=snapshot(s,date),dates=[...(s.financeDayReferences||[]).map(r=>r.date),...(s.financeDayReports||[]).filter(r=>r.status==='confirmed'&&r.cashClosing!=null).map(r=>r.date),...(s.dailyCloseouts||[]).filter(r=>r.status==='已锁定').map(r=>r.date)].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=date).sort().reverse();
 let anchor=null;
 for(const d of [...new Set(dates)]){
  const ref=(s.financeDayReferences||[]).filter(r=>r.date===d).at(-1);
  if(d===date&&ref){anchor={date:d,amount:cents(ref.openingCash,'期初'),source:'owner_reference',id:ref.id};break;}
  if(d===date)continue;
  const next=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const report=(s.financeDayReports||[]).filter(r=>r.date===d&&r.status==='confirmed'&&r.cashClosing!=null).at(-1);
  if(report){anchor={date:next,amount:cents(report.cashClosing,'上日确认结存'),source:'confirmed_report',id:report.id};break;}
  if(ref?.reportedClosing!=null){anchor={date:next,amount:cents(ref.reportedClosing,'上日报表结存'),source:'owner_reported_closing',id:ref.id};break;}
  const locked=(s.dailyCloseouts||[]).filter(r=>r.date===d&&r.status==='已锁定').at(-1);
  if(locked){anchor={date:next,amount:cents(locked.actualCash,'上日扎账结存'),source:'locked_closeout',id:locked.id};break;}
  if(ref){anchor={date:d,amount:cents(ref.openingCash,'已核实期初'),source:'owner_reference',id:ref.id};break;}
 }
 if(!anchor)return {...current,openingCashSource:null,openingCashAnchorDate:null};
 const span=(Date.parse(date+'T00:00:00Z')-Date.parse(anchor.date+'T00:00:00Z'))/86400000;
 if(span<0||span>1095)throw new c.HttpError(409,'现金依据跨度过长，请老板重新核实期初');
 let opening=anchor.amount;const chain=[];
 for(let d=anchor.date;d<date;d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
  const row=build(s,d);opening+=row.net-row.bankTotal+row.adjustment;
  chain.push([d,row.fingerprint]);
 }
 const cashBasisFingerprint=createHash('sha256').update(JSON.stringify({policy:POLICY,scope:'cash_count_only',date,anchor,chain,today:current.cashBasisFingerprint,opening})).digest('hex');
 return {...current,openingCashSuggested:opening/100,cashBasisFingerprint,openingCashSource:anchor.source,openingCashAnchorDate:anchor.date};
}
module.exports={POLICY,build,snapshot,rollingSnapshot,expected};
