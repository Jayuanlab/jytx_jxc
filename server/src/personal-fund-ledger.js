'use strict';
// Personal finance is projected from source records. No posting or acknowledgement occurs here.
const c=require('./common'),master=require('./master-data'),sfr=require('./sale-fund-responsibility'),ownership=require('./account-ownership'),businessPurpose=require('./business-purpose');
const fields=['paid','unpaid','received','unreceived'];
const cents=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100):null;};
const money=n=>n/100;
const date=v=>v?(/^\d{4}-\d{2}-\d{2}$/.test(v)?v:c.day(v)):'';
function build(store,user){
 const who=master.actor(store,user),myKey='mine:'+who.id,rows=[],custody=[],warnings=[];
 const account={key:myKey,id:who.id,name:'我的账户',ownerName:who.name,kind:'mine',active:true,scope:'仅本人经办或本人账户的登记、待核与交接。提交交款不等于接收人收到；待确认期间仍由交款人负责。登记金额不代表手中实点余额。',totals:Object.fromEntries(fields.map(k=>[k,0])),pendingAmount:0,pendingCount:0,warningCount:0,rows,custody};
 const sources=new Map();for(const key of ['sales','saleReturns','airRechargeEvents','expenses','otherIncome','purchases','supplierCash','storeWalletFundingRequests','payrollStatements'])for(const r of store[key]||[])sources.set(r.id,r);
 const ownSales=sfr.project(store).filter(r=>r.operatorId===who.id);
 const receiptRows=require('./serial-source-corrections').receiptRows(store),seen=new Set(),reversed=new Set((store.receipts||[]).filter(r=>r.originalReceiptId&&(r.isReversal||['expense_red','other_income_red'].includes(r.kind))).map(r=>r.originalReceiptId));
 const summary={registeredCashIn:0,registeredCashOut:0,confirmedCashIn:0,confirmedCashOut:0,pendingCashOut:0,pendingCashIn:0};
 function add(input){const view={party:who.name,partyKey:myKey,...input};rows.push(view);if(input.bucket==='custody')custody.push(view);if(fields.includes(input.bucket))account.totals[input.bucket]+=cents(input.amount)||0;}
 for(const r of receiptRows){const source=sources.get(r.sourceId)||{},operatorId=r.operatorId||source.operatorId;
  const view={...r,...ownership.project(store,r)},storeAccount=ownership.isStoreAccount(store,r),personallyHeld=ownership.isPersonallyHeld(store,r,who.id);if(operatorId!==who.id&&!personallyHeld&&!(r.kind==='payroll'&&source.employeeId===who.id))continue;
  const key=r.projectionKey||r.id+(r.attributionCorrected?'::'+r.supplierId:'');if(seen.has(key)){warnings.push('本人资金流水重复：'+r.id);continue;}seen.add(key);
  const n=cents(r.amount);if(n==null){warnings.push('本人资金流水金额待核：'+r.id);continue;}if(!n)continue;
  const correction=r.isReversal||reversed.has(r.id)||['expense_red','other_income_red'].includes(r.kind)||source.redReversedBy;
  const passThrough=businessPurpose.isPassThrough(store,r),bucket=correction?'correction':passThrough?'internal':storeAccount?'custody':n>0?'received':'paid';
  const href=require('./wallet-funding-read').isReceipt(r)?'/store-wallet-funding?request='+encodeURIComponent(r.sourceId):r.kind==='sale'?'/sale-fund-responsibility?order='+encodeURIComponent(r.sourceId)+(r.partId?'&part='+encodeURIComponent(r.partId):''):r.kind==='cash_recharge'?'/daily-cash-receipts?date='+date(r.transactionDate||r.createdAt):'/app?tab='+(n>0?'receipts':'payments')+'&sourceId='+encodeURIComponent(r.sourceId||'');
  add({id:'receipt:'+key,receiptId:r.id,kind:r.kind,sourceId:r.sourceId,sourceNo:source.displayNo||r.sourceId,partId:r.partId||'',amount:money(Math.abs(n)),bucket,at:r.createdAt,date:date(r.transactionDate||r.createdAt),businessPurpose:businessPurpose.purpose(store,r),economicClass:passThrough?'pass_through':'operating',account:view.displayName||view.accountName||r.account||'',accountScope:view.accountScope||'',accountOwnerId:view.accountOwnerId||'',custodyLabel:view.custodyLabel||'',channel:r.account||'',label:require('./wallet-funding-read').isReceipt(r)?require('./wallet-funding-read').label(r):passThrough?(n>0?'代充值收款':'代充值付款'):r.kind==='cash_recharge'?'充值收现':r.kind==='sale'?'销售收款登记':r.kind==='payroll'?'本人工资资金记录':n>0?'收款登记':'付款登记',operator:operatorId===who.id?who.name:'其他经办人',state:correction?'账务更正':storeAccount?'本人经办门店账户，非本人持有':'本人相关资金登记，实际核收另看原单',note:storeAccount?'门店资金不计个人收支；交接须由指定接收人本人确认。':'已登记不等于老板已收到；内部交接不重复计入收款。',href});
  if(!correction&&!passThrough&&!storeAccount&&r.account==='现金'&&operatorId===who.id)summary[n>0?'registeredCashIn':'registeredCashOut']+=Math.abs(n);
 }
 for(const r of ownSales.filter(r=>r.pendingAmount>0||r.amount==null))add({id:'responsibility:'+r.key,kind:'sale_responsibility',label:'销售待交／待核责任',amount:r.pendingAmount,bucket:'pending',sourceId:r.orderId,sourceNo:r.displayNo,partId:r.partId,at:r.createdAt,date:date(r.createdAt),channel:r.channel,state:r.statusLabel,goods:r.goods.map(g=>g.name+' × '+g.quantity).join('；'),href:r.href,note:'本项是原销售经办责任，不与收款登记、交接金额重复相加。提交交款后须接收人核收，关联责任才按原单销挂。'});
 for(const h of store.cashHandovers||[]){if(h.senderId!==who.id&&h.recipientId!==who.id)continue;
  const out=h.senderId===who.id,confirmed=ownership.confirmedCashHandover(h),pending=h.status==='待接收人确认',n=cents(h.amount);if(n==null){warnings.push('现金交接金额待核：'+h.id);continue;}
  const amount=confirmed?cents(h.actualAmount):n;if(confirmed)summary[out?'confirmedCashOut':'confirmedCashIn']+=amount;if(pending)summary[out?'pendingCashOut':'pendingCashIn']+=n;
  const row={id:'handover:'+h.id,kind:'cash_handover',ownerReceived:confirmed&&!out,actualReceivedAmount:confirmed&&!out?money(amount):0,label:(out?'交出给 ':'接收自 ')+(out?h.recipient:h.sender),amount:money(amount),bucket:'internal',at:h.createdAt,date:date(h.createdAt),sourceId:h.id,sourceNo:h.id,channel:'现金',state:h.status,href:'/cash-handover?handover='+encodeURIComponent(h.id),note:pending?(out?'尚未销交款责任：接收人未确认前，仍挂本人。':'仅待接收确认，不计本人已收到；仍挂交款人。'):confirmed?'接收人已确认现金位置转移；不重复计算营业收入。':'依原单状态核实，不按已收自动转移责任。'};
  add(row);custody.push({...row,bucket:'custody'});
 }
 const confirmedTransfers=new Set(require('./funds-network').confirmedStoreTransfers(store).map(t=>t.id));
 for(const t of store.fundTransfers||[]){if(t.fromId!==who.id&&t.toId!==who.id&&t.operatorId!==who.id)continue;const storeSource=t.sourceScope==='store',out=t.fromId===who.id,operatorOnly=storeSource&&t.operatorId===who.id&&t.toId!==who.id,received=t.toId===who.id&&(storeSource?confirmedTransfers.has(t.id):t.status==='已确认到账'&&t.processedBy===who.id);add({id:'transfer:'+t.id,kind:'internal_transfer',label:operatorOnly?'经办门店账户交出给 '+t.to:(out?'转出给 ':'接收自 ')+(out?t.to:t.from),amount:t.amount,bucket:'internal',ownerReceived:received,actualReceivedAmount:received?Number(t.actualAmount):0,sourceScope:t.sourceScope||'personal',sourceAccountId:t.sourceAccountId||'',at:t.confirmedAt||t.createdAt,date:date(t.confirmedAt||t.createdAt),sourceId:t.id,sourceNo:t.id,channel:t.method,state:t.status,href:'/funds?transfer='+encodeURIComponent(t.id),note:t.status==='待收款人确认'?'待确认，不计收款人已到账。':'内部交接，不重复计算营业收入或费用。'});}
 account.ownerActualInternalReceivedAmount=c.round(rows.filter(r=>r.kind==='internal_transfer'&&r.ownerReceived).reduce((n,r)=>n+Number(r.actualReceivedAmount),0));
 account.saleResponsibility={...sfr.sumRows(ownSales),href:'/sale-fund-responsibility?employeeId='+encodeURIComponent(who.id)};
 account.totals.unreceived=cents(account.saleResponsibility.notPostedAmount)||0;
 account.pendingAmount=account.saleResponsibility.pendingAmount;account.pendingCount=rows.filter(r=>r.bucket==='pending').length;account.warningCount=warnings.length;
 for(const k of fields)account.totals[k]=money(account.totals[k]);
 account.cashCustody=Object.fromEntries(Object.entries(summary).map(([k,n])=>[k,money(n)]));
 rows.sort((a,b)=>String(b.at).localeCompare(String(a.at)));custody.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
 return {asOf:c.now(),today:c.day(),myKey,personalOnly:true,accounts:[account],daily:rows.filter(r=>r.bucket!=='pending'),warnings};
}
function report(store,user,query=new URLSearchParams()){
 const data=build(store,user),who=master.actor(store,user),key=query.get('account')||query.get('party')||data.myKey;
 if(![data.myKey,'person:'+who.id].includes(key))throw new c.HttpError(403,'只能查看本人财务账户');
 const day=query.get('date')||data.today;if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day>data.today)throw new c.HttpError(400,'请选择有效日期');
 const bucket=query.get('bucket')||'';if(!['',...fields,'pending','balance','internal','correction','custody'].includes(bucket))throw new c.HttpError(400,'往来明细类型不正确');
 const offset=name=>{const n=Number(query.get(name)||0);if(!Number.isSafeInteger(n)||n<0||n>1e7)throw new c.HttpError(400,'页码不正确');return n;};
 const q=(query.get('q')||'').trim().toLowerCase(),account=data.accounts[0],rows=(bucket==='custody'?account.custody:account.rows).filter(r=>(!bucket||r.bucket===bucket)&&(!q||[r.sourceNo,r.sourceId,r.receiptId,r.label,r.channel,r.goods,r.note].join(' ').toLowerCase().includes(q))),daily=data.daily.filter(r=>r.date===day),start=offset('offset'),ds=offset('dailyOffset'),{rows:unused,custody,...a}=account;
 return {...data,accounts:[{...a,rowCount:account.rows.length,custodyCount:custody.length}],selected:{...a,rows:rows.slice(start,start+50),totalRows:rows.length,offset:start,pageSize:50,bucket,custodyCount:custody.length},daily:{date:day,paid:c.round(daily.filter(r=>r.bucket==='paid').reduce((n,r)=>n+r.amount,0)),received:c.round(daily.filter(r=>r.bucket==='received').reduce((n,r)=>n+r.amount,0)),pending:account.rows.filter(r=>r.date===day&&r.bucket==='pending').length,rows:daily.slice(ds,ds+50),totalRows:daily.length,offset:ds,pageSize:50}};
}
module.exports={build,report};
