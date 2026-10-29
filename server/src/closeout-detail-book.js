 'use strict';
const c=require('./common'),ownership=require('./account-ownership');
const POLICY='closeout-details-scan-summary-v1';
function build(store,date){
 const scanRows=[],seen=new Set(),documents=store.documentNumbers||[],number=id=>documents.find(d=>d.sourceId===id)?.displayNo||id;
 for(const r of require('./serial-source-corrections').receiptRows(store)){
  if(seen.has(r.id)||(r.transactionDate||c.day(r.createdAt))!==date||!['微信','支付宝'].includes(r.account)||ownership.isStoreAccount(store,r))continue;seen.add(r.id);
  if(!['sale','refund','sale_red','refund_red','other_income','other_income_red','internal_scan_in'].includes(r.kind))continue;
  const amount=c.round(Number(r.amount)),correction=!!r.isReversal||/_red$/.test(r.kind||''),target=require('./scan-collection').target(store,r,date),source=(r.kind.startsWith('other_income')?store.otherIncome:r.kind.startsWith('refund')?store.saleReturns:store.sales)||[],origin=source.find(o=>o.id===r.sourceId);
  const tab=r.kind.startsWith('other_income')?'receipts':r.kind.startsWith('refund')?'returns':'orders';
  scanRows.push({id:r.id,sourceId:r.sourceId,displayNo:number(r.sourceId),date,at:r.createdAt,amount,kind:r.kind,correction,method:'scan_payment',methodLabel:'扫码支付',channel:r.account,accountName:target?.name||r.accountName||'具体到账账户待核',accountId:target?.id||r.paymentAccountId||'',operator:(store.users||[]).find(u=>u.id===r.operatorId)?.name||origin?.operator||'经办人待核',counterparty:origin?.counterparty||origin?.customerName||'散客',href:r.internalTransferId?'/cash-handover?view=history&handover='+encodeURIComponent(r.sourceId):'/app?tab='+tab+'&sourceId='+encodeURIComponent(r.sourceId)+'&q='+encodeURIComponent(r.sourceId),status:correction?'账务更正，不是实际支付':'已登记'});
 }
 const sum=rows=>c.round(rows.reduce((n,r)=>n+r.amount,0)),real=scanRows.filter(r=>!r.correction),scanSummary={policy:POLICY,title:'扫码支付汇总',date,received:sum(real.filter(r=>r.amount>0)),paid:Math.abs(sum(real.filter(r=>r.amount<0))),adjustment:sum(scanRows.filter(r=>r.correction)),net:sum(scanRows),entries:scanRows,reportOnly:true,note:'按收款方式汇总微信、支付宝扫码；不与资金账户重复相加。门店微信备用资金、老板账户费用和现金转存均不计入此汇总。'};
 const airDetails=(store.airRechargeEvents||[]).filter(r=>r.businessDate<=date).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).map(r=>({id:r.id,displayNo:number(r.id),date:r.businessDate,kind:r.kind,amount:r.amount,reference:r.reference||'',note:r.note||'',operator:(store.users||[]).find(u=>u.id===r.operatorId||u.id===r.createdBy)?.name||'',href:'/air-accounts'}));
 return {policy:POLICY,scanSummary,airDetails};
}
module.exports={POLICY,build};
