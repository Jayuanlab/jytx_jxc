'use strict';
// Read-only document projection over the existing, authorized payment ledger.
const c=require('./common');
const kinds={store_wallet_funding_out:['storeWalletFundingRequests'],internal_transfer_out:['cashHandovers'],expense:['expenses'],supplier_payment:['supplierCash'],purchase:['purchases'],refund:['saleReturns'],payroll:['payrollStatements'],carrier:['cardEvents'],carrier_clawback:['cardEvents'],air_funding:['airFundingOrders','airRechargeEvents'],fund_transfer:['fundTransfers'],transfer_out:['fundTransfers'],bank_deposit:['cashHandovers'],cash_bank_deposit:['cashHandovers']};
const labels={store_wallet_funding_out:'门店微信充值转出',internal_transfer_out:'内转资金交接',expense:'费用付款',supplier_payment:'供应商付款',purchase:'采购付款',refund:'销售退款',payroll:'工资发放',carrier:'移动酬金退回',carrier_clawback:'移动酬金扣回',air_funding:'空充平台充值付款',gov_subsidy_refund:'国补补贴退回',fund_transfer:'内部资金划转',transfer_out:'内部资金划转',bank_deposit:'现金转存银行',cash_bank_deposit:'现金转存银行'};
const money=n=>n/100;
function cents(value){const amount=Number(value),n=Math.round(amount*100);if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(n)||Math.abs(amount*100-n)>0.00001)throw new c.HttpError(409,'付款流水金额异常，请核对原单');return n;}
function dateValue(value,label){if(!value)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new c.HttpError(400,label+'日期不正确');return value;}
function number(store,collection,row){return row?.displayNo||(store.documentNumbers||[]).find(r=>r.collection===collection&&r.sourceId===row?.id)?.displayNo||row?.id||'';}
function source(store,row){
 const found=[];for(const collection of kinds[row.kind]||[])for(const original of store[collection]||[])if(original.id===row.sourceId)found.push({collection,row:original});
 if(row.kind==='gov_subsidy_refund')for(const claim of store.govSubsidyClaims||[])for(const event of claim.events||[])if(event.id===row.sourceId&&event.type==='refund')found.push({collection:'govSubsidyEvents',row:event,parent:claim});
 if(row.kind==='carrier_rental')for(const service of store.carrierServices||[])for(const month of service.schedule||[])for(const event of month.events||[])if(event.id===row.sourceId)found.push({collection:'carrierServiceEvents',row:event,parent:service});
 return found.length===1?found[0]:{collection:'unknown',row:null,warning:found.length?'原业务来源编号不唯一，按单笔流水保留':'原业务来源未明确，按单笔流水保留'};
}
function counterpart(store,row,resolved){
 const original=resolved.row||{},raw=(store.receipts||[]).find(r=>r.id===row.id)||{},person=id=>(store.users||[]).find(u=>u.id===id)?.name||'',supplier=id=>(store.suppliers||[]).find(s=>s.id===id)?.name||'',actual=(...values)=>values.map(v=>typeof v==='string'?v.trim():'').find(v=>v&&v!==row.kind&&!Object.values(labels).includes(v));
 if(row.kind==='supplier_payment')return supplier(row.supplierId||original.supplierId)||row.counterparty||original.supplier||original.counterparty||'供应商待核实';
 if(row.kind==='purchase')return supplier(row.supplierId||original.supplierId)||original.supplier||row.counterparty||'供应商待核实';
 if(row.kind==='payroll')return original.name||original.employeeName||person(original.employeeId)||row.counterparty||'工资领取人待核实';
 if(row.kind==='refund'){const sale=(store.sales||[]).find(s=>s.id===original.orderId),customer=(store.customers||[]).find(r=>r.id===(original.customerId||sale?.customerId));return actual(original.customerName,sale?.customerName,customer?.name,customer?.customerName,raw.counterpartyNameSnapshot,raw.counterparty,original.counterpartyNameSnapshot,original.counterparty)||'退款顾客未记录';}
 if(['carrier','carrier_clawback','carrier_rental'].includes(row.kind))return '中国移动';
 if(row.kind==='gov_subsidy_refund')return '国补平台';
 if(row.kind==='air_funding')return '移动BOSS空充平台';
 if(['fund_transfer','transfer_out','bank_deposit','cash_bank_deposit'].includes(row.kind))return original.to||original.recipient||original.destinationAccountName||row.counterparty||'内部接收方待核实';
 return actual(row.counterpartyNameSnapshot,raw.counterpartyNameSnapshot,raw.counterparty,original.counterpartyNameSnapshot,original.counterparty)||'付款单位未记录';
}
function href(row,resolved){
 const original=resolved.row;if(!original)return '';
 if(require('./wallet-funding-read').isReceipt(row))return '/store-wallet-funding?request='+encodeURIComponent(original.id);
 if(row.kind==='supplier_payment'||row.kind==='purchase'){const id=row.supplierId||original.supplierId;return id?'/app?tab=suppliers&supplierId='+encodeURIComponent(id):'';}
 if(row.kind==='refund')return original.orderId?'/app?tab=orders&q='+encodeURIComponent(original.orderId):'/app?tab=returns';
 if(row.kind==='payroll')return '/app?tab=payroll&view=details'+(original.employeeId?'&employeeId='+encodeURIComponent(original.employeeId):'');
 if(['carrier','carrier_clawback','carrier_rental'].includes(row.kind))return '/carrier';
 if(row.kind==='gov_subsidy_refund')return '/subsidy';
 if(row.kind==='air_funding')return '/air-accounts?order='+encodeURIComponent(original.fundingOrderId||original.id);
 if(['bank_deposit','cash_bank_deposit'].includes(row.kind))return '/cash-handover?handover='+encodeURIComponent(original.id);
 if(['fund_transfer','transfer_out'].includes(row.kind))return '/app?tab=finance';
 if(row.kind==='expense'){const packet=(row.paymentScope==='owner_red_packet'||original.paymentScope==='owner_red_packet')&&(original.orderRedPacketId||original.redPacketId);return packet?'/order-red-packets?request='+encodeURIComponent(packet):'/app?tab=payments&sourceId='+encodeURIComponent(original.id);}
 return '';
}
function accountName(row){if(row.accountScope==='store'&&row.account==='现金')return '门店现金';if(row.accountScope==='store'&&['信号机微信','门店微信'].includes(row.accountName))return '门店微信';const name=row.displayName||row.accountName||'';if(row.account==='微信'&&!row.paymentAccountId&&(!name||name===row.account))return '微信（原单未指定具体账户）';return name||row.account||'账户待核实';}
function list(store,user,query,legacyList){
 if(query.get('direction')!=='pay')throw new c.HttpError(400,'单据视图仅支持付款查询');
 const from=dateValue(query.get('from')||'','开始'),to=dateValue(query.get('to')||'','结束');if(from&&to&&from>to)throw new c.HttpError(400,'开始日期不能晚于结束日期');
 const allQuery=new URLSearchParams(query);for(const field of ['view','q','from','to','id','sourceId','sourceCollection'])allQuery.delete(field);allQuery.set('direction','pay');
 // Retain the legacy permission and counterparty filters. Date and search are
 // applied only after grouping so a matching split cannot hide its siblings.
 const legacy=legacyList(store,user,allQuery),groups=new Map(),selectedParty=query.get('fundPartyKey')||'';
 for(const originalPart of legacy.rows){
  if(selectedParty){const explicit=originalPart.attributionCorrected&&originalPart.supplierId?'supplier:'+originalPart.supplierId:originalPart.fundPartyKey||source(store,originalPart).row?.fundPartyKey||'';if(explicit&&explicit!==selectedParty)continue;}
  const part={...originalPart,displayNo:number(store,'receipts',originalPart)},resolved=source(store,part),key='paydoc:'+encodeURIComponent(resolved.collection)+':'+encodeURIComponent(resolved.row?part.sourceId:(part.projectionKey||part.id))+':'+encodeURIComponent(part.kind||'unknown');
  part.counterparty=counterpart(store,part,resolved);
  part.originalAccountName=originalPart.accountName||'';
  part.accountName=accountName(part);
  if(part.originalSupplierId)part.originalSupplierName=(store.suppliers||[]).find(s=>s.id===part.originalSupplierId)?.name||'';
  let group=groups.get(key);if(!group){group={key,resolved,parts:[]};groups.set(key,group);}group.parts.push(part);
 }
 const docs=[...groups.values()].map(({key,resolved,parts})=>{
  const representative=parts[0],original=resolved.row,sourceDisplayNo=original?number(store,resolved.collection,original):'',dates=[...new Set(parts.map(p=>p.date||p.transactionDate||'').filter(Boolean))].sort(),counterparties=[...new Set(parts.map(p=>counterpart(store,p,resolved)))],accountMap=new Map();
  let amount=0,activeAmount=0;for(const part of parts){const n=cents(part.amount);amount+=n;const reversed=part.status==='已红冲'||!!original?.redReversedBy;if(!reversed)activeAmount+=n;const name=accountName(part),accountKey=part.paymentAccountId||[name,part.account,part.accountScope,part.accountOwnerId].join('|');let account=accountMap.get(accountKey);if(!account){account={paymentAccountId:part.paymentAccountId||'',accountName:name,account:part.account||'',amount:0,accountScope:part.accountScope||'',accountOwnerName:part.accountScope==='store'?'门店':part.accountOwnerName||''};accountMap.set(accountKey,account);}account.amount+=n;}
  const accounts=[...accountMap.values()].map(a=>({...a,amount:money(a.amount)})),receiptIds=[...new Set(parts.map(p=>p.id))],purposes=[...new Set(parts.map(p=>p.businessPurpose||original?.businessPurpose||'').filter(Boolean))],classes=[...new Set(parts.map(p=>p.economicClass||'operating'))],businessPurpose=purposes.length===1?purposes[0]:'',economicClass=classes.length===1?classes[0]:'mixed',business=require('./wallet-funding-read').isReceipt(representative)?require('./wallet-funding-read').label(representative):representative.internalTransferId?'内转资金交接':businessPurpose==='agency_topup'||economicClass==='pass_through'?representative.business||'代充值付款':labels[representative.kind]||representative.business||'付款（来源待补）',sourceHref=href(representative,resolved);
  return {id:key,displayNo:sourceDisplayNo||representative.displayNo,sourceId:representative.sourceId||'',sourceCollection:resolved.collection,sourceDisplayNo,business,counterparty:counterparties.length>1?'多个单位：'+counterparties.join('、'):counterparties[0],counterparties,amount:money(amount),activeAmount:money(activeAmount),partCount:receiptIds.length,projectionCount:parts.length,accounts,accountSummary:accounts.map(a=>a.accountName+' '+money(cents(a.amount)).toFixed(2)+'元').join('；'),date:dates[0]||'',dateTo:dates.at(-1)||'',status:activeAmount===0?'已红冲':activeAmount===amount?'已登记':'部分红冲',note:original?.note||original?.reason||representative.note||'',operator:original?.operator||original?.payer||representative.operator||'',parts,receiptIds,receiptAliases:[...new Set(parts.flatMap(p=>[p.id,p.displayNo,p.projectionKey].filter(Boolean)))],businessPurpose,economicClass,...(sourceHref?{sourceHref}:{}),...(resolved.warning?{sourceWarning:resolved.warning}:{}),...(query.get('fundPartyKey')?{filteredToParty:true,filterNotice:'仅所选往来单位的付款份额'}:{})};
 });
 const q=(query.get('q')||'').trim().normalize('NFKC').toLowerCase(),id=query.get('id')||'',sourceId=query.get('sourceId')||'',collection=query.get('sourceCollection')||'';
 const selected=docs.filter(doc=>{
  if(collection&&doc.sourceCollection!==collection)return false;
  if(sourceId&&![doc.sourceId,doc.sourceDisplayNo,...doc.receiptAliases].includes(sourceId))return false;
  if(id&&![doc.id,doc.sourceId,doc.sourceDisplayNo,...doc.receiptAliases].includes(id))return false;
  if((from||to)&&!doc.parts.some(p=>{const day=p.date||p.transactionDate||'';return !!day&&(!from||day>=from)&&(!to||day<=to);}))return false;
  if(q){const text=[doc.id,doc.displayNo,doc.sourceId,doc.sourceDisplayNo,doc.business,doc.counterparty,doc.note,doc.accountSummary,...doc.accounts.map(a=>a.accountName),...doc.receiptAliases,...doc.parts.flatMap(p=>[p.reference,p.note,p.counterparty,p.account,p.accountName,p.originalAccountName,p.displayName,p.operator])].filter(Boolean).join(' ').normalize('NFKC').toLowerCase();if(!text.includes(q))return false;}
  return true;
 }).sort((a,b)=>String(b.dateTo).localeCompare(String(a.dateTo))||String(b.displayNo).localeCompare(String(a.displayNo))||a.id.localeCompare(b.id));
 return {direction:'pay',view:'documents',rows:selected,total:money(selected.reduce((n,r)=>n+cents(r.activeAmount),0)),documentCount:selected.length,flowCount:new Set(selected.flatMap(r=>r.receiptIds)).size,...(query.get('fundPartyKey')?{filteredToParty:true,filterNotice:'仅所选往来单位的付款份额'}:{})};
}
module.exports={list};
