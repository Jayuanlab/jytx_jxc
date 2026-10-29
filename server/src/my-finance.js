'use strict';

// A current-user, read-only projection. It never posts money, clears a task,
// confirms a receipt, or repairs historical evidence merely because it is read.
const c=require('./common');
const ownership=require('./account-ownership');
const moneyVerifications=require('./money-verifications');
const cashCustody=require('./cash-custody');
const saleFunds=require('./sale-fund-responsibility');
const redPackets=require('./order-red-packets');
const START_DATE='2026-10-28';
const PAGE_SIZE=30;
const CATEGORIES=new Set(['all','flows','custody','transfers','redPackets']);
const ROLES=new Set(['owner','manager','employee','warehouse']);
const RECEIPT_LABELS={sale:'销售收款',refund:'销售退款',purchase:'采购付款',supplier_payment:'供应商付款',supplier_refund:'供应商退款',supplier_outbound_receipt:'供货商调货收款',expense:'费用付款',other_income:'收款',carrier:'移动酬金到账',carrier_rental:'移动酬金到账',carrier_clawback:'移动酬金扣回',gov_subsidy:'国补到账',gov_subsidy_refund:'国补退回',air_funding:'空充平台付款',cash_recharge:'顾客充值收款',payroll:'工资'};
const SOURCE_COLLECTIONS=['sales','saleReturns','expenses','otherIncome','purchases','supplierCash','storeWalletFundingRequests','storeCashWalletTransfers','payrollStatements','airRechargeEvents','airFundingOrders','carrierServices','cardEvents','govSubsidyClaims','mobileCardBundles','businessChangeRequests','supplierOutboundTransfers','fundTransfers','cashHandovers'];

function actor(store,user){
 const who=c.userById(store,user?.id);
 if(!user||who.roleCode!==user.roleCode||who.status!=='active'||who.assistantCustomerOnly||!ROLES.has(who.roleCode))throw new c.HttpError(403,'请使用本人有效门店账号查看我的财务');
 return who;
}
function cents(value){
 if(value==null||value===''||typeof value==='boolean')return null;
 const n=Number(value),result=Math.round(n*100);
 return Number.isFinite(n)&&Number.isSafeInteger(result)&&Math.abs(n*100-result)<0.00001?result:null;
}
const amount=value=>value==null?null:c.round(value/100);
function validDay(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function dayOf(value){
 if(!value)return '';
 if(validDay(value))return value;
 try{return Number.isFinite(Date.parse(value))?c.day(value):'';}catch{return '';}
}
function safeHref(value){try{const u=new URL(value,'https://my-finance.invalid');return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&u.origin==='https://my-finance.invalid'?u.pathname+u.search+u.hash:'/funds';}catch{return '/funds';}}
const text=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();

function report(store,user,query=new URLSearchParams()){
 const who=actor(store,user),today=c.day(),warnings=[],warningKeys=new Set();
 const scope=query.get('scope')||'day',allHistory=scope==='all';if(!['day','all'].includes(scope))throw new c.HttpError(400,'请选择当天或全部累计范围');
 const warn=(key,message,originDate)=>{const dates=(Array.isArray(originDate)?originDate:[originDate]).map(dayOf);if(!allHistory&&dates.length&&dates.every(date=>date&&date<START_DATE))return;if(!warningKeys.has(key)){warningKeys.add(key);warnings.push(message+(dates.some(date=>!date)?'；原始日期待核，请核对原单历史':''));}};
 for(const key of ['userId','employeeId','operatorId','accountOwnerId','applicantId'])for(const value of query.getAll(key))if(value&&value!==who.id)throw new c.HttpError(403,'我的财务只能查看当前登录本人，不能指定其他人员');
 for(const key of ['account','party'])for(const value of query.getAll(key))if(value&&!['mine:'+who.id,'person:'+who.id].includes(value))throw new c.HttpError(403,'我的财务不能切换到其他人的账户');
 for(const key of ['scope','from','to','q','category','offset'])if(query.getAll(key).length>1)throw new c.HttpError(400,'查询条件重复，请重新选择');
 const from=query.get('from')||(allHistory?'1970-01-01':today),to=query.get('to')||today;
 if(!validDay(from)||!validDay(to)||from>today||to>today||from>to)throw new c.HttpError(400,'请选择今天或之前的有效起止日期');
 if(!allHistory&&(from<START_DATE||to<START_DATE))throw new c.HttpError(400,'当天范围从'+START_DATE+'开始；之前记录请切换全部累计查看，原记录及处理责任保留');
 const q=text(query.get('q')||'').normalize('NFKC').toLowerCase();if(q.length>200)throw new c.HttpError(400,'查询内容最多200字');
 const category=query.get('category')||'all';if(!CATEGORIES.has(category))throw new c.HttpError(400,'财务记录分类不正确');
 const offset=Number(query.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>10000000)throw new c.HttpError(400,'页码不正确');
 const users=new Map((store.users||[]).map(row=>[row.id,row]));
 const name=id=>users.get(id)?.name||'原记录人员待核实';
 const sources=new Map(),sourceConflicts=new Set();
 for(const collection of SOURCE_COLLECTIONS)for(const row of store[collection]||[]){if(!row?.id)continue;const prior=sources.get(row.id);if(prior)sourceConflicts.add(row.id);else sources.set(row.id,{collection,row});}
 for(const parent of store.carrierServices||[])for(const part of parent.schedule||[])for(const event of part.events||[])if(event.id&&!sources.has(event.id))sources.set(event.id,{collection:'carrierServices',row:parent,event});
 const numberMap=new Map();
 for(const row of store.documentNumbers||[]){if(!row.collection||!row.sourceId||!row.displayNo)continue;const key=row.collection+'\0'+row.sourceId,set=numberMap.get(key)||new Set();set.add(row.displayNo);numberMap.set(key,set);}
 function number(collection,rowOrId){
  const row=typeof rowOrId==='object'&&rowOrId?rowOrId:{id:rowOrId},set=numberMap.get(collection+'\0'+row.id);
  if(set?.size===1)return [...set][0];
  if(set?.size>1){const originals=(store[collection]||[]).filter(item=>item.id===row.id);warn('number:'+collection+':'+row.id,'原单展示号存在冲突，请核对原档案：'+row.id,(originals.length?originals:[row]).map(item=>item.createdAt||item.date||item.transactionDate));}
  return text(row.displayNo||row.number||row.orderNo||row.id||'原单编号待核');
 }
 function sourceFor(receipt){return sourceConflicts.has(receipt.sourceId)?{collection:'receipts',row:{id:receipt.sourceId||receipt.id},conflict:true}:sources.get(receipt.sourceId)||{collection:'receipts',row:{id:receipt.sourceId||receipt.id}};}
 function sourceLink(resolved,receipt){
  const source=resolved.row,collection=resolved.collection,id=source.id||receipt.sourceId||'';
  if(source.mobileCardBundleId)return {href:'/mobile-card-bundles?order='+encodeURIComponent(source.mobileCardBundleId),actionLabel:'查看组合原单',relatedSourceNo:number('mobileCardBundles',source.mobileCardBundleId)};
  if(collection==='sales')return {href:'/sale-fund-responsibility?order='+encodeURIComponent(id)+(receipt.partId?'&part='+encodeURIComponent(receipt.partId):''),actionLabel:'查看原单收款'};
  if(collection==='carrierServices')return {href:'/carrier?service='+encodeURIComponent(id),actionLabel:'查看移动酬金原单'};
  if(collection==='payrollStatements')return {href:'/app?tab=payroll&view=details',actionLabel:'查看本人工资记录'};
  if(collection==='cashHandovers')return {href:'/cash-handover?handover='+encodeURIComponent(id),actionLabel:'查看现金交接'};
  if(collection==='fundTransfers')return {href:'/funds?transfer='+encodeURIComponent(id),actionLabel:'查看内部转款'};
  if(collection==='storeWalletFundingRequests')return {href:'/store-wallet-funding?request='+encodeURIComponent(id),actionLabel:'查看门店微信充值'};
  if(collection==='mobileCardBundles')return {href:'/mobile-card-bundles?order='+encodeURIComponent(id),actionLabel:'查看组合原单'};
  if(['purchases','supplierCash'].includes(collection))return {href:'/app?tab=suppliers'+(receipt.supplierId||source.supplierId?'&supplierId='+encodeURIComponent(receipt.supplierId||source.supplierId):''),actionLabel:'查看往来原单'};
  return {href:'/app?tab='+(Number(receipt.amount)<0?'payments':'receipts')+'&sourceId='+encodeURIComponent(receipt.sourceId||id),actionLabel:'查看收付原单'};
 }
 const rows=[],openItems=[],rowIds=new Set(),openIds=new Set();
 const summary={responsibilityCount:0,responsibilityAmount:0,unknownResponsibilityCount:0,pendingConfirmationCount:0,periodRegisteredIn:0,periodRegisteredOut:0,periodHandledIn:0,periodHandledOut:0,redPacketRequested:0,redPacketApprovedUnpaid:0,redPacketRecordedPaid:0};
 const summaryCents={responsibilityAmount:0,periodRegisteredIn:0,periodRegisteredOut:0,periodHandledIn:0,periodHandledOut:0,redPacketRequested:0,redPacketApprovedUnpaid:0,redPacketRecordedPaid:0};
 const dashboardCents={paid:{purchaseAmount:0,redPacketAmount:0,otherAmount:0},received:{noncashAmount:0,cashHandedInAmount:0,rewardAmount:0,otherAmount:0},payable:{purchaseAmount:0,redPacketAmount:0,otherAmount:0}};
 const payableItems=[],payableSeen=new Set(),payableUnknownCategories=new Set(),dashboardCashIds=new Set();
 function payable(input){const date=dayOf(input.date);if(!date){warn('payable-date:'+input.id,'待支付原申请／原单创建日期待核，'+(allHistory?'按原职责保留在全部累计，未伪造日期':'未计入'+START_DATE+'起的新账，请切换全部累计核对')+'：'+input.sourceNo);if(!allHistory)return;}if(!allHistory&&date<START_DATE||payableSeen.has(input.id))return;payableSeen.add(input.id);const key=input.kind==='purchase'?'purchaseAmount':input.kind==='redPacket'?'redPacketAmount':'otherAmount',n=cents(input.amount);if(input.unknown||n==null){payableUnknownCategories.add(key);payableItems.push({...input,date,amount:null,unknown:true});}else if(n>0){dashboardCents.payable[key]+=n;payableItems.push({...input,date,amount:amount(n),unknown:false});}}
 const inPeriod=row=>row.date&&row.date>=from&&row.date<=to;
 function normalize(input){return {...input,id:input.id,category:input.category,label:text(input.label),date:dayOf(input.date||input.at),at:input.at||'',amount:input.amount??null,amountLabel:text(input.amountLabel),direction:input.direction||'none',status:text(input.status),sourceNo:text(input.sourceNo),sourceId:text(input.sourceId),account:text(input.account),operator:text(input.operator),relatedPerson:text(input.relatedPerson),note:text(input.note),nextStep:text(input.nextStep),href:safeHref(input.href),actionLabel:text(input.actionLabel||'查看原单'),settled:input.settled===true};}
 function addRow(input){const row=normalize(input);if(rowIds.has(row.id)){warn('row:'+row.id,'已跳过重复个人财务投影：'+row.sourceNo,input.originDate||row.date);return;}rowIds.add(row.id);rows.push(row);}
 function addOpen(input,{responsibility=false,pendingConfirmation=false}={}){
  const row=normalize(input),originDate=Object.prototype.hasOwnProperty.call(input,'originDate')?dayOf(input.originDate):row.date;if(!originDate){warn('open-date:'+row.id,'未处理事项的原始日期待核，'+(allHistory?'按原职责保留在全部累计，未伪造日期':'未计入'+START_DATE+'起的新账，请切换全部累计核对')+'：'+row.sourceNo);if(!allHistory)return;}if(!allHistory&&originDate<START_DATE||openIds.has(row.id))return;openIds.add(row.id);row.settled=false;row.opening=false;
  openItems.push(row);
  if(responsibility){summary.responsibilityCount++;const n=cents(row.amount);if(n==null)summary.unknownResponsibilityCount++;else summaryCents.responsibilityAmount+=n;}
  if(pendingConfirmation)summary.pendingConfirmationCount++;
 }
 function verification(receipt){try{return moneyVerifications.state(store,receipt);}catch(error){warn('verify:'+receipt.id,'款项核实证据未能完整读取，请核对原单：'+number('receipts',receipt),receipt.createdAt||receipt.date||receipt.transactionDate);return {status:'evidence_error',statusLabel:'核实依据待核',verifiedAmount:0,unverifiedAmount:Math.abs(Number(receipt.amount)||0),verifiedByHolder:false};}}

 // Original operator responsibility remains separate from ledger registration
 // and pending handovers, so the same money is never summed twice as debt.
 const ownSales=(store.sales||[]).filter(row=>(row.operatorId||row.salespersonId)===who.id);
 const ownSaleProjections=saleFunds.project({...store,sales:ownSales}),ownSaleByPart=new Map(ownSaleProjections.map(row=>[JSON.stringify([row.orderId,row.partId||'legacy']),row]));
 for(const row of ownSaleProjections.filter(row=>row.operatorId===who.id&&(row.pendingAmount>0||row.amount==null))){
  const source=(store.sales||[]).find(item=>item.id===row.orderId),sourceNo=number('sales',source||row.orderId),unknown=row.amount==null;
  addOpen({id:'open:responsibility:'+row.key,category:'custody',label:row.cash?'本人销售现金待交／待核':'本人销售收款待核',date:dayOf(row.createdAt),at:row.createdAt,amount:unknown?null:row.pendingAmount,amountLabel:unknown?'原单金额待核':'原单剩余责任',direction:'none',status:unknown?'原单金额异常待核':row.statusLabel,sourceId:row.orderId,sourceNo,account:row.accountName||row.channel,operator:who.name,relatedPerson:row.targetHolder,note:[row.note,row.sourceWarning,(row.goods||[]).map(item=>item.name+' × '+item.quantity).join('；')].filter(Boolean).join('；'),nextStep:row.sourceWarning?'先核对退货、红冲及原始收款证据':row.cash?'按原单核实现金是否已交入门店，再由原经办确认':'核对原单支付反馈与真实到账记录',href:row.sourceHref||row.href,actionLabel:'处理本人原单',partId:row.partId,operatorId:who.id,relatedIds:[row.orderId,row.partId].filter(Boolean),responsibilityOnly:true},{responsibility:true});
 }

 const rawReceipts=store.receipts||[],reversedIds=new Set(rawReceipts.filter(row=>row.originalReceiptId&&(row.isReversal||/_red$/.test(row.kind||''))).map(row=>row.originalReceiptId));
 const packetByExpense=new Map((store.orderRedPackets||[]).filter(row=>row.expenseId).map(row=>[row.expenseId,row]));
 const receiptSeen=new Set(),moneyOpenSeen=new Set();
 for(const receipt of require('./serial-source-corrections').receiptRows(store)){
  const resolved=sourceFor(receipt),source=resolved.row,operatorId=receipt.operatorId||receipt.registeredById||source.operatorId||source.recordedBy||'',registeredById=receipt.registeredById||operatorId;
  const storeAccount=ownership.isStoreAccount(store,receipt),personalAccount=!storeAccount&&ownership.isPersonallyHeld(store,receipt,who.id),payrollRecipient=receipt.kind==='payroll'&&source.employeeId===who.id;
  const handled=operatorId===who.id||registeredById===who.id||source.operatorId===who.id;
  if(!handled&&!personalAccount&&!payrollRecipient)continue;
  if(resolved.conflict)warn('source:'+receipt.sourceId,'本人相关收付来源编号重复，按原流水保留待核：'+receipt.sourceId,receipt.createdAt||receipt.date||receipt.transactionDate);
  const projectionKey=receipt.projectionKey||receipt.id+(receipt.attributionCorrected?'::'+(receipt.supplierId||''):''),id='receipt:'+projectionKey;
  if(receiptSeen.has(projectionKey)){warn('duplicate-receipt:'+projectionKey,'已跳过重复收付流水：'+receipt.id,receipt.createdAt||receipt.date||receipt.transactionDate);continue;}receiptSeen.add(projectionKey);
  const n=cents(receipt.amount);if(n==null){warn('amount:'+projectionKey,'本人相关流水金额异常，保留原单待核：'+receipt.id,receipt.createdAt||receipt.date||receipt.transactionDate);}
  if(n===0)continue;
  const view=ownership.project(store,receipt),correction=!!receipt.isReversal||reversedIds.has(receipt.id)||/_red$/.test(receipt.kind||'')||!!source.redReversedBy;
  const state=verification(receipt),reclassified=!!receipt.sourceClaimId||state.status==='reclassified',sourceNo=number(resolved.collection,source),link=sourceLink(resolved,receipt),date=dayOf(receipt.transactionDate||source.date||receipt.createdAt),at=receipt.createdAt||source.createdAt||'',cash=receipt.account==='现金';
  const packet=packetByExpense.get(receipt.sourceId)||(receipt.redPacketId&&(store.orderRedPackets||[]).find(row=>row.id===receipt.redPacketId));
  // One HB is the personal remuneration record; its backing expense receipt
  // must not become a second visible red-packet payment.
  if(packet){
   if(!correction&&!reclassified&&personalAccount&&!state.verificationNotRequired&&(state.status==='disputed'||Number(state.unverifiedAmount)>0)&&!moneyOpenSeen.has(receipt.id)){
    moneyOpenSeen.add(receipt.id);addOpen({id:'open:money:'+receipt.id,category:'flows',label:'本人红包付款账户待核实',date,at,amount:state.status==='disputed'?amount(n==null?null:Math.abs(n)):state.unverifiedAmount,amountLabel:state.status==='disputed'?'登记金额（存在核实异议）':'本人账户尚未核实金额',direction:'out',status:state.statusLabel||'本人账户待核实',sourceId:receipt.sourceId,sourceNo,account:view.displayName||view.accountName||receipt.account,operator:name(operatorId),relatedPerson:packet.employeeName||name(packet.employeeId),note:'关联红包 '+number('orderRedPackets',packet)+'；红包发放登记与本人账户核实分别保留。这里只核实已有款项，不再次发放红包。',nextStep:'核对本人付款账户真实支出凭据，不重复付款',href:'/business-reconciliation?id=money-'+encodeURIComponent(receipt.id),actionLabel:'核实本人付款',receiptId:receipt.id,operatorId,accountOwnerId:who.id,verificationStatus:state.status,relatedIds:[receipt.id,receipt.sourceId,packet.id]},{pendingConfirmation:true});
   }
   continue;
  }
  const explicitTransfer=resolved.collection==='cashHandovers'||resolved.collection==='fundTransfers';
  if(explicitTransfer)continue;
  let passThrough=false;try{passThrough=require('./business-purpose').isPassThrough(store,receipt);}catch{warn('purpose:'+receipt.id,'资金用途待核：'+receipt.id,receipt.createdAt||receipt.date||receipt.transactionDate);}
  const direction=payrollRecipient?'in':n==null?'none':n>0?'in':'out',category=personalAccount||payrollRecipient?'flows':'custody',relatedPerson=payrollRecipient?'工资发放方':personalAccount?text(receipt.counterparty||source.counterparty||source.employeeName):storeAccount?(view.custodyLabel||'门店'):name(receipt.accountOwnerId);
  let cashReview=null;
  if(!correction&&!reclassified&&cash&&n>0&&category==='custody'){
   if(receipt.kind==='sale'){
    const responsibility=ownSaleByPart.get(JSON.stringify([receipt.sourceId,receipt.partId||'legacy']));
    if(responsibility?.pendingAmount===0&&responsibility.cashInStore===true)cashReview={cashInStore:true,personalPendingAmount:0,status:'已确认交入门店，个人待交0',note:'原销售分笔已按入门店现金的确认凭据清除个人待交责任；原收款和入店凭据保留，不新增一笔支出，也不表示老板本人收到现金。',nextStep:'查看原销售入店确认与现金记录'};
    else if(responsibility&&(responsibility.pendingAmount>0||responsibility.amount==null))cashReview={cashInStore:false,personalPendingAmount:responsibility.amount==null?null:responsibility.pendingAmount,status:responsibility.statusLabel,note:'原销售仍缺完整入店完成依据，单有现金声明不按已确认入店处理；继续按原分笔核对，不改历史。',nextStep:'按原销售分笔核实现金去向和入店完成凭据'};
   }else if(receipt.cashDestination==='vault'&&cashCustody.inVault(receipt))cashReview={cashInStore:true,personalPendingAmount:0,status:'已登记入门店现金，个人待交已清',note:'本笔原收款明确登记在门店现金，不再挂个人待交；这是入店登记口径，现场现金仍按真实清点核对，不能据此认定老板个人实收。',nextStep:'查看原收款及门店现金入店登记'};
   else if(receipt.cashDestination==='employee'){
    const moved=cents(cashCustody.moved(store,receipt.id)),remaining=moved==null?null:Math.max(0,n-moved);
    if(remaining===0&&state.verifiedByStore===true)cashReview={cashInStore:true,personalPendingAmount:0,status:'已确认交入门店，个人待交0',note:'原暂存现金已有足额交入门店的确认记录，个人待交为0；原收款和交入记录保留，不新增一笔支出。',nextStep:'查看原现金暂存及足额入店记录'};
    else cashReview={cashInStore:false,personalPendingAmount:amount(remaining),status:state.statusLabel||'本人暂存现金，入店完成依据待核',note:'只按已登记的真实入店金额清除责任；尚未足额交入的部分继续待核，声明本身不代替入店完成记录。',nextStep:'核对暂存现金实际去向和入店确认记录'};
   }
  }
  const status=reclassified?'原误记收款已转移动应收（不作实际收款）':correction?'已红冲或账务更正（不计实际收付）':cashReview?.status|| (payrollRecipient?'工资发放已登记，领取证据以原单为准':category==='custody'?'本人经办款项已登记；实际账户核实另列':state.status==='disputed'?'已登记；本人账户核实有差异':state.verifiedByHolder||state.verifiedByOwner?'已登记；本人账户已人工核实':'已登记；本人账户核实另列');
  const note=[category==='custody'?'这是本人经办的门店业务资金；实际收款账户或门店保管与本人经办分列，不计为个人收入或个人实点余额。':'这是资金登记记录，登记不等于本人已独立核实到账。',cashReview?.note||'',handled&&operatorId!==who.id?'原业务由本人经办，本次资金登记人为 '+name(operatorId)+'。':'',passThrough?'内部资金或代收代付，不计营业收入或费用。':'',link.relatedSourceNo?'关联组合原单 '+link.relatedSourceNo:'',receipt.note||source.note||'',receipt.reference?'凭据 '+receipt.reference:'',receipt.attributionCorrected?'原流水供货商归属已更正；按真实分摊投影，不另生付款。':''].filter(Boolean).join('；');
  const ownSaleResponsibility=receipt.kind==='sale'?ownSaleByPart.get(JSON.stringify([receipt.sourceId,receipt.partId||'legacy'])):null,settled=!correction&&!reclassified&&!!(cashReview?.cashInStore&&cashReview.personalPendingAmount===0||ownSaleResponsibility?.pendingAmount===0&&ownSaleResponsibility.amount!=null||state.verificationNotRequired||state.verifiedByHolder||state.verifiedByOwner||state.verifiedByStore);
  const record={id,category,label:payrollRecipient?'本人工资发放记录':(RECEIPT_LABELS[receipt.kind]||'资金收付')+'登记',date,at,amount:n==null?null:amount(Math.abs(n)),amountLabel:category==='custody'?'经手登记金额':payrollRecipient?'工资发放登记':'本人账户登记金额',direction,status,sourceId:receipt.sourceId||source.id,sourceNo,account:view.displayName||view.accountName||receipt.account,operator:name(operatorId),relatedPerson,note:reclassified?'原误记的收款流水已转为移动应收，原记录保留供追溯，不计实际收款或个人收支。':note,nextStep:correction||reclassified?'查看更正及原单证据':cashReview?.nextStep||(personalAccount&&!state.verifiedByHolder&&!state.verifiedByOwner?'按原单核实本人账户真实收付':'查看原单与核实记录'),...link,receiptId:receipt.id,registeredById,operatorId,originalOperatorId:source.operatorId||'',accountOwnerId:personalAccount?who.id:'',verificationStatus:state.status,verifiedAmount:state.verifiedAmount??0,unverifiedAmount:state.unverifiedAmount??null,correction,reclassified,settled,...(cashReview?{cashInStore:cashReview.cashInStore,personalPendingAmount:cashReview.personalPendingAmount}:{}),relatedIds:[receipt.id,receipt.sourceId,source.mobileCardBundleId].filter(Boolean)};
  addRow(record);
  if(inPeriod(record)&&!correction&&!reclassified&&n!=null&&!passThrough){
   if(category==='custody'&&handled)summaryCents[direction==='in'?'periodHandledIn':'periodHandledOut']+=Math.abs(n);
   else if(personalAccount||payrollRecipient)summaryCents[direction==='in'?'periodRegisteredIn':'periodRegisteredOut']+=Math.abs(n);
   if(personalAccount&&n<0)dashboardCents.paid[['purchase','supplier_payment'].includes(receipt.kind)?'purchaseAmount':'otherAmount']+=Math.abs(n);
   if(personalAccount&&n>0&&receipt.account!=='现金')dashboardCents.received.noncashAmount+=n;
   if(payrollRecipient&&n<0)dashboardCents.received.otherAmount+=Math.abs(n);
  }
  // Non-sale cash held by its actual custodian is a separate responsibility.
  if(!correction&&!reclassified&&receipt.kind!=='sale'&&cash&&n>0&&receipt.cashDestination==='employee'&&(cashCustody.custodianId(receipt)||operatorId)===who.id){
   const moved=cents(cashCustody.moved(store,receipt.id)),remaining=moved==null?null:Math.max(0,n-moved);
   if(remaining==null||remaining>0)addOpen({...record,id:'open:cash:'+projectionKey,category:'custody',label:'本人暂存门店现金待交',amount:amount(remaining),amountLabel:'暂存尚未交入门店金额',direction:'none',status:'本人暂存现金，待入门店或内部交接',note:'门店资金由本人暂存，不是个人收入；交入门店或由指定接收人确认后再清责任。',nextStep:'核实原收款及现金实际去向',actionLabel:'查看原现金登记',responsibilityOnly:true},{responsibility:true});
  }
  // Store verifiers may see many store receipts elsewhere. This page only
  // assigns the actual personal account's verification to the logged-in owner.
  if(!correction&&!reclassified&&personalAccount&&!state.verificationNotRequired&&(state.status==='disputed'||Number(state.unverifiedAmount)>0)&&!moneyOpenSeen.has(receipt.id)){
   moneyOpenSeen.add(receipt.id);addOpen({...record,id:'open:money:'+receipt.id,label:'本人账户'+(direction==='in'?'收款':'付款')+'待核实',amount:state.status==='disputed'?record.amount:state.unverifiedAmount,amountLabel:state.status==='disputed'?'登记金额（存在核实异议）':'本人账户尚未核实金额',status:state.statusLabel||'本人账户待核实',nextStep:'亲自核对实际账户收付或登记异议',href:'/business-reconciliation?id=money-'+encodeURIComponent(receipt.id),actionLabel:'核实本人款项'},{pendingConfirmation:true});
  }
 }

 for(const handover of store.cashHandovers||[]){
  const out=handover.senderId===who.id,into=handover.recipientId===who.id;if(!out&&!into)continue;
  const confirmed=ownership.confirmedCashHandover(handover),pending=handover.status==='待接收人确认',disputed=handover.status==='金额有异议',evidenceProblem=!confirmed&&handover.status==='已确认收到',n=cents(confirmed?handover.actualAmount:handover.amount),sourceNo=number('cashHandovers',handover);
  const record={id:'handover:'+handover.id,category:'transfers',label:out?'本人交出现金':'待本人接收现金',date:dayOf(handover.transactionDate||handover.confirmedAt||handover.createdAt),at:handover.confirmedAt||handover.createdAt,amount:amount(n),amountLabel:confirmed?'接收人已确认金额':'交接登记金额',direction:out?'out':'in',status:confirmed?'接收人已确认现金交接':evidenceProblem?'原单标已收，确认凭据待核':handover.status||'交接状态待核',sourceId:handover.id,sourceNo,account:handover.destinationAccountName||handover.sourceAccountName||'门店现金',operator:name(handover.createdBy||handover.senderId),relatedPerson:out?(handover.recipient||name(handover.recipientId)):(handover.sender||name(handover.senderId)),note:pending?(out?'接收人尚未确认，仍保留交款责任；不再重复相加到原销售挂账。':'仅待本人接收，不计本人已收到；仍由交出人负责。'):confirmed?'本笔是资金位置变动，不重复计算营业收入或费用。':'依原交接证据核实，不按状态文字自动转移责任。',nextStep:evidenceProblem?'核对指定接收人的实际确认凭据':pending?(into?'按实际收到金额核实接收':'跟进指定接收人核收'):disputed?'核对交出和接收凭据':'查看交接历史',href:'/cash-handover?handover='+encodeURIComponent(handover.id),actionLabel:pending&&into?'核对本笔交接':'查看现金交接',senderId:handover.senderId,recipientId:handover.recipientId,confirmed,relatedIds:[handover.id,handover.sourceOrderId,handover.sourcePartId].filter(Boolean)};
  record.settled=confirmed;addRow(record);if(confirmed&&into&&!handover.sourceCorrection&&inPeriod(record)&&n>0&&!dashboardCashIds.has(handover.id)){dashboardCashIds.add(handover.id);dashboardCents.received.cashHandedInAmount+=n;}if(pending||disputed||evidenceProblem)addOpen({...record,id:'open:'+record.id,originDate:handover.createdAt||handover.date||handover.transactionDate},{pendingConfirmation:true});
  if(evidenceProblem)warn('handover-proof:'+handover.id,'交接标为已收但确认凭据不完整：'+sourceNo,handover.createdAt||handover.date||handover.transactionDate);
 }
 const personalTransfers=(store.fundTransfers||[]).filter(transfer=>transfer.fromId===who.id||transfer.toId===who.id||transfer.sourceScope==='store'&&transfer.operatorId===who.id);
 const confirmedStoreTransfers=new Set(require('./funds-network').confirmedStoreTransfers({...store,fundTransfers:personalTransfers}).map(row=>row.id));
 for(const transfer of personalTransfers){
  const out=transfer.fromId===who.id,into=transfer.toId===who.id,operatorOnly=transfer.sourceScope==='store'&&transfer.operatorId===who.id&&!out&&!into;if(!out&&!into&&!operatorOnly)continue;
  const confirmed=transfer.sourceScope==='store'?confirmedStoreTransfers.has(transfer.id):transfer.status==='已确认到账'&&transfer.processedBy===transfer.toId&&(!transfer.confirmedBy||transfer.confirmedBy===transfer.toId)&&!!(transfer.confirmedAt||transfer.processedAt)&&cents(transfer.actualAmount)>0&&cents(transfer.actualAmount)===cents(transfer.amount)&&(transfer.events||[]).some(event=>event.type==='已确认到账'&&event.by===transfer.toId&&cents(event.actualAmount)===cents(transfer.actualAmount));
  const pending=transfer.status==='待收款人确认',disputed=transfer.status==='到账有异议',evidenceProblem=!confirmed&&transfer.status==='已确认到账',n=cents(confirmed?transfer.actualAmount:transfer.amount),sourceNo=number('fundTransfers',transfer);
  const record={id:'transfer:'+transfer.id,category:'transfers',label:operatorOnly?'本人经办门店转款':out?'本人转出登记':'待本人接收转款',date:dayOf(transfer.confirmedAt||transfer.createdAt),at:transfer.confirmedAt||transfer.createdAt,amount:amount(n),amountLabel:confirmed?'接收人已确认金额':'转款登记金额',direction:operatorOnly?'none':out?'out':'in',status:confirmed?'接收人已确认到账':evidenceProblem?'原单标已到账，确认凭据待核':transfer.status||'转款状态待核',sourceId:transfer.id,sourceNo,account:transfer.sourceScope==='store'?(transfer.sourceAccountName||'门店账户'):(transfer.method||'本人账户'),operator:name(transfer.operatorId||transfer.fromId),relatedPerson:out||operatorOnly?(transfer.to||name(transfer.toId)):(transfer.from||name(transfer.fromId)),note:[operatorOnly?'本人仅经办门店账户转出，不算本人个人付出。':'内部资金往来不重复计算营业收入或费用。',pending?'接收人尚未确认，不计其实际收到。':'',transfer.purpose||'',transfer.note||''].filter(Boolean).join('；'),nextStep:evidenceProblem?'核对指定接收人的实际到账确认凭据':pending?(into?'亲自核实实际到账':'跟进指定接收人核收'):disputed?'核对实际转款与到账凭据':'查看内部转款历史',href:'/funds?transfer='+encodeURIComponent(transfer.id),actionLabel:pending&&into?'核实本笔到账':'查看内部转款',senderId:transfer.fromId,recipientId:transfer.toId,operatorId:transfer.operatorId,confirmed,relatedIds:[transfer.id,transfer.relatedOrderId].filter(Boolean)};
  record.settled=confirmed;addRow(record);if(pending||disputed||evidenceProblem)addOpen({...record,id:'open:'+record.id,originDate:transfer.createdAt||transfer.date||transfer.transactionDate},{pendingConfirmation:true});
  if(evidenceProblem)warn('transfer-proof:'+transfer.id,'转款标为到账但接收人确认凭据不完整：'+sourceNo,transfer.createdAt||transfer.date||transfer.transactionDate);
 }

 function packetSource(packet){const snapshot=packet.sourceSnapshot||{},collection=packet.collection||snapshot.collection,id=packet.sourceId||snapshot.sourceId,found=(store[collection]||[]).filter(row=>row.id===id),resolved=found.length===1?found[0]:null,sourceNo=number(collection,resolved||id);if(found.length>1)warn('packet-source:'+collection+':'+id,'本人相关红包原业务编号重复，请核对原单：'+sourceNo,packet.createdAt||packet.date);return {collection,id,row:resolved,sourceNo,label:text(snapshot.label||'原业务单')+' '+sourceNo};}
 function packetClaimText(source){
  const original=source.row||{},income=original.incomeId?(store.otherIncome||[]).find(row=>row.id===original.incomeId):null,receiptIds=new Set(original.receiptIds||[]);
  return [original.note,original.reference,original.receiptReference,income?.note,income?.reference,...rawReceipts.filter(row=>receiptIds.has(row.id)).flatMap(row=>[row.note,row.reference])].filter(Boolean).join('；');
 }
 // A possible duplicate reward requires the complete customer phone, the
 // original employee, the business date and the exact ordinary new-card type.
 // Masked numbers, matching suffixes and Chinese labels are never evidence.
 const activePacketStatuses=new Set(['待老板核定','已核定待支付','已支付']),packetsBySource=new Map(),duplicatePacketLinks=new Map(),customerRows=new Map(),ordinaryByIdentity=new Map();
 for(const customer of store.customers||[]){const list=customerRows.get(customer.id)||[];list.push(customer);customerRows.set(customer.id,list);}
 for(const packet of store.orderRedPackets||[]){if(!activePacketStatuses.has(packet.status)||!packet.id||!packet.employeeId)continue;const collection=packet.collection||packet.sourceSnapshot?.collection,id=packet.sourceId||packet.sourceSnapshot?.sourceId,key=collection+'\0'+id+'\0'+packet.employeeId,list=packetsBySource.get(key)||[];list.push(packet);packetsBySource.set(key,list);}
 for(const ordinary of store.carrierServices||[]){
  if(ordinary.type!=='card'||ordinary.subType!=='new'||!ordinary.employeeId||!validDay(ordinary.serviceDate)||sourceConflicts.has(ordinary.id))continue;
  const customers=customerRows.get(ordinary.customerId)||[];if(customers.length!==1)continue;const phone=text(customers[0].phone);
  if(!/^1[3-9]\d{9}$/.test(phone))continue;
  const key=phone+'\0'+ordinary.employeeId+'\0'+ordinary.serviceDate,list=ordinaryByIdentity.get(key)||[];list.push(ordinary);ordinaryByIdentity.set(key,list);
 }
 const duplicatePairsSeen=new Set();
 for(const bundle of store.mobileCardBundles||[]){
  const phone=text(bundle.openedNumber);if(!/^1[3-9]\d{9}$/.test(phone)||!bundle.employeeId||!validDay(bundle.serviceDate)||sourceConflicts.has(bundle.id))continue;
  const bundlePackets=packetsBySource.get('mobileCardBundles\0'+bundle.id+'\0'+bundle.employeeId)||[];if(!bundlePackets.length)continue;
  for(const ordinary of ordinaryByIdentity.get(phone+'\0'+bundle.employeeId+'\0'+bundle.serviceDate)||[]){
   const ordinaryPackets=packetsBySource.get('carrierServices\0'+ordinary.id+'\0'+bundle.employeeId)||[];
   for(const ordinaryPacket of ordinaryPackets)for(const bundlePacket of bundlePackets){
    if(ordinaryPacket.id===bundlePacket.id)continue;const pairKey=JSON.stringify([ordinary.id,bundle.id,ordinaryPacket.id,bundlePacket.id]);if(duplicatePairsSeen.has(pairKey))continue;duplicatePairsSeen.add(pairKey);
    const pair={ordinary,bundle,ordinaryPacket,bundlePacket};for(const packetId of [ordinaryPacket.id,bundlePacket.id]){const list=duplicatePacketLinks.get(packetId)||[];list.push(pair);duplicatePacketLinks.set(packetId,list);}
   }
  }
 }
 function duplicatePacketEvidence(packet){
  const links=duplicatePacketLinks.get(packet.id)||[];if(!links.length)return null;
  const messages=[],sourceIds=new Set(),packetIds=new Set();
  for(const pair of links){const ordinaryNo=number('carrierServices',pair.ordinary),bundleNo=number('mobileCardBundles',pair.bundle),bothPaid=pair.ordinaryPacket.status==='已支付'&&pair.bundlePacket.status==='已支付',onePaid=pair.ordinaryPacket.status==='已支付'||pair.bundlePacket.status==='已支付';
   messages.push('同日同号跨入口关联记录：普通新开卡原单 '+ordinaryNo+' 与组合 '+bundleNo+' 各有红包，按实际付款凭据核对为同次补录还是不同发放。'+(bothPaid?'两个来源均登记已发，仍按各自真实付款凭据核对。':onePaid?'其中一个来源登记已发，另一个来源尚未完成发放登记；按各自真实付款凭据核对。':'两个来源的申请与实际付款分别保留，按原单和真实付款凭据核对。'));
   sourceIds.add(pair.ordinary.id);sourceIds.add(pair.bundle.id);packetIds.add(pair.ordinaryPacket.id);packetIds.add(pair.bundlePacket.id);
  }
  return {message:[...new Set(messages)].join('；'),sourceIds:[...sourceIds],packetIds:[...packetIds]};
 }
 const packetSeen=new Set();
 for(const packet of redPackets.list(store,who).rows){
  if(packetSeen.has(packet.id)){warn('packet-duplicate:'+packet.id,'已跳过重复红包单：'+number('orderRedPackets',packet),packet.createdAt||packet.date);continue;}packetSeen.add(packet.id);
  const incoming=packet.employeeId===who.id,owner=who.roleCode==='owner',awaiting=['待老板核定','已核定待支付'].includes(packet.status),parts=packet.paymentParts||[],personalPayer=packet.paidBy===who.id||parts.some(part=>!ownership.isStoreAccount(store,part)&&part.accountOwnerId===who.id),related=packet.requesterId===who.id||packet.reviewerId===who.id;
  if(!incoming&&!(owner&&(awaiting||personalPayer||packet.status!=='已支付'&&related)))continue;
  const source=packetSource(packet),sourceNo=number('orderRedPackets',packet),paid=packet.status==='已支付'&&packet.paymentState==='recorded',evidenceProblem=packet.status==='已支付'&&!paid,claim=/红包.{0,6}(?:已领|已收|已发|收到|领取)|(?:已领|已收|已发).{0,6}红包/.test(packetClaimText(source))&&!paid,duplicate=duplicatePacketEvidence(packet);
  const requested=cents(packet.requestedAmount),approved=cents(packet.approvedAmount),paidCents=paid?approved:0,rawAmount=packet.status==='已支付'?approved:packet.status==='已核定待支付'?approved:requested;
  const at=packet.status==='已支付'?(packet.paidAt||packet.createdAt):packet.status==='已核定待支付'?(packet.reviewedAt||packet.createdAt):packet.createdAt,date=dayOf(packet.status==='已支付'?(packet.paymentDate||at):packet.createdAt);
  const status=evidenceProblem?'发放记录证据待核':claim?'原单备注与红包发放记录待核':paid?(incoming?'老板已登记发放（本人到账未独立确认）':packet.paidBy===who.id?'本人已登记实际发放':'本人账户红包付款已登记'):packet.status;
  const record={id:'redPacket:'+packet.id,category:'redPackets',label:incoming?'我的红包记录':'本人红包发放／待核定事项',date,at,amount:amount(rawAmount),amountLabel:paid?(incoming?'老板登记发放金额':'本人登记发放金额'):packet.status==='已核定待支付'?'已核定未付款金额':'申请金额（尚未付款）',direction:incoming?'in':'out',status,sourceId:packet.id,sourceNo,sourceLabel:source.label,account:parts.map(part=>part.accountName||part.account).filter(Boolean).join('、')||(paid?'付款账户待核':'尚未登记付款'),operator:paid?name(packet.paidBy):name(packet.requesterId),relatedPerson:incoming?(paid?name(packet.paidBy):'老板核定与发放'):packet.employeeName||name(packet.employeeId),note:[packet.message,paid&&incoming?'这是老板已登记发放记录；消息已读不等于本人已独立核实到账。':'',evidenceProblem?'原状态为已支付，但费用、付款流水或红冲证据不完整；不计可信已发，禁止据此自动再次付款。':'',claim?'原单备注称红包已领，但系统尚无完整发放记录；请先核实实际支付凭据，避免重复发放。':'',duplicate?.message||'',packet.reason||''].filter(Boolean).join('；'),nextStep:evidenceProblem||claim?'先核实原付款凭据与员工实际收款，避免重复发放':duplicate?'按实际付款凭据核对为同次补录还是不同发放':paid?'查看发放凭据与关联原单':incoming?'跟进老板核定与实际发放':'核对原单及实际付款后在红包原流程办理',href:'/order-red-packets?request='+encodeURIComponent(packet.id),actionLabel:'查看红包原单',requestedAmount:amount(requested),approvedAmount:amount(approved),paidAmount:paid?amount(paidCents):null,paymentState:packet.paymentState,employeeId:packet.employeeId,paidBy:packet.paidBy||'',relatedIds:[...new Set([packet.id,source.id,packet.expenseId,...(packet.receiptIds||[]),...(duplicate?.sourceIds||[]),...(duplicate?.packetIds||[])].filter(Boolean))],claimConflict:claim,evidenceProblem,duplicateRedPacket:!!duplicate,duplicateSourceIds:duplicate?.sourceIds||[],duplicatePacketIds:duplicate?.packetIds||[]};
  record.settled=paid&&!evidenceProblem&&!claim;addRow(record);
  if(inPeriod(record)){
   if(packet.status==='待老板核定'&&requested!=null)summaryCents.redPacketRequested+=requested;
   if(packet.status==='已核定待支付'&&approved!=null)summaryCents.redPacketApprovedUnpaid+=approved;
   if(paid&&paidCents!=null)summaryCents.redPacketRecordedPaid+=paidCents;
   if(paid&&incoming&&paidCents!=null)dashboardCents.received.rewardAmount+=paidCents;
   // Boss's backing expense is shown once as HB. Preserve its registered
   // personal-account outflow metric without duplicating a visible flow row.
   if(owner&&paid){
    const ids=new Set(),backing=rawReceipts.filter(receipt=>receipt.sourceId===packet.expenseId&&receipt.kind==='expense'&&!receipt.isReversal&&!reversedIds.has(receipt.id)&&!ids.has(receipt.id)&&ids.add(receipt.id));
    for(const receipt of backing){const n=cents(receipt.amount);if(!(n<0))continue;if(!ownership.isStoreAccount(store,receipt)&&ownership.isPersonallyHeld(store,receipt,who.id)){summaryCents.periodRegisteredOut+=Math.abs(n);dashboardCents.paid.redPacketAmount+=Math.abs(n);}else if(receipt.operatorId===who.id||packet.paidBy===who.id)summaryCents.periodHandledOut+=Math.abs(n);}
   }
  }
  if(awaiting||evidenceProblem||claim)addOpen({...record,id:'open:'+record.id});
  if(evidenceProblem)warn('packet-evidence:'+packet.id,'红包发放凭据需核实：'+sourceNo+'；不计可信已发金额',packet.createdAt||packet.date);
  if(claim)warn('packet-claim:'+packet.id,'原单备注称红包已领，但系统未有完整付款记录：'+sourceNo+'，请核实实际凭据，避免重复发放',packet.createdAt||packet.date);
  if(duplicate)warn('packet-duplicate-source:'+packet.id,'跨入口红包关联：'+sourceNo+'；'+duplicate.message,packet.createdAt||packet.date);
  if(owner&&packet.status==='已核定待支付'){
   const actualPaid=rawReceipts.filter(receipt=>receipt.sourceId===packet.expenseId&&receipt.kind==='expense'&&!receipt.isReversal&&!reversedIds.has(receipt.id)&&Number(receipt.amount)<0).reduce((n,receipt)=>n+Math.abs(cents(receipt.amount)||0),0);
   if(actualPaid>0)payable({id:'payable:packet:'+packet.id,date:packet.createdAt||packet.date,kind:'redPacket',sourceId:packet.id,sourceNo,label:'红包付款状态待核',amount:null,unknown:true,reason:'原状态待支付，但已有对应付款记录；先核实原单，不再直接计算为待付或再次付款',href:record.href});
   else if(packet.reviewerId===who.id||parts.some(part=>!ownership.isStoreAccount(store,part)&&ownership.isPersonallyHeld(store,part,who.id)))payable({id:'payable:packet:'+packet.id,date:packet.createdAt||packet.date,kind:'redPacket',sourceId:packet.id,sourceNo,label:'本人已核定未付红包',amount:amount(approved),reason:'已核定不等于已付款；仍按红包原流程登记实际发放',href:record.href});
   else if(!packet.reviewerId)payable({id:'payable:packet:'+packet.id,date:packet.createdAt||packet.date,kind:'redPacket',sourceId:packet.id,sourceNo,label:'已核定红包付款职责待明确',amount:null,unknown:true,reason:'原单未明确本人核定或实际付款账户，不能当作本人欠款',href:record.href});
  }
 }
 // The day scope starts with original request/document dates at START_DATE;
 // explicit all scope retains every earlier outstanding obligation. Neither
 // scope turns paid-but-unverified receipts into a second amount payable.
 const requestCoverage=new Map(),requestSources=row=>[row.orderId,row.purchaseId,row.planId,row.sourceId].filter(Boolean);
 function personalPayer(row){const profile=(store.paymentAccounts||[]).find(account=>account.id===(row.paymentAccountId||row.accountId));const scope={...row,...(profile?{paymentAccountId:profile.id,accountScope:profile.accountScope,accountOwnerId:profile.ownerId,account:profile.channel}: {})};return !ownership.isStoreAccount(store,scope)&&(scope.accountOwnerId||row.payerId||row.paymentOwnerId)===who.id;}
 function assignedId(row){const profile=(store.paymentAccounts||[]).find(account=>account.id===(row.paymentAccountId||row.accountId));return row.payerId||row.paymentOwnerId||row.accountOwnerId||profile?.ownerId||'';}
 for(const request of store.paymentRequests||[]){
  if(request.executionStatus!=='awaiting_holder')continue;const assigned=assignedId(request),related=request.applicantId===who.id||assigned===who.id||who.roleCode==='owner'&&!assigned;if(!related||assigned&&assigned!==who.id)continue;
  const n=cents(request.amount),kind=request.supplierId||request.orderId||request.purchaseId||request.planId?'purchase':'other',sourceNo=number('paymentRequests',request),known=personalPayer(request);
  payable({id:'payable:request:'+request.id,date:request.createdAt||request.date,kind,sourceId:request.id,sourceNo,label:known?'待本人账户执行付款':'付款账户或执行职责待明确',amount:known?amount(n):null,unknown:!known,reason:known?'指定本人实际账户尚未执行；已登记支付待核的请求不列待支付':'只明确申请或门店账户，未明确本人个人账户付款职责，不能把金额记为本人欠款',href:'/business-reconciliation?request='+encodeURIComponent(request.id)});
  if(n>0)for(const sourceId of requestSources(request))requestCoverage.set(sourceId,(requestCoverage.get(sourceId)||0)+n);
 }
 if(who.roleCode==='owner'){
  for(const plan of store.procurementPlans||[]){const review=plan.paymentReview||{};if(plan.status!=='open'||review.status!=='approved')continue;const payer=assignedId({...plan,...review,paymentAccountId:review.paymentAccountId||plan.paymentAccountId}),related=payer===who.id||!payer&&review.reviewerId===who.id;if(!related||payer&&payer!==who.id)continue;
   const approved=cents(review.approvedAmount),paid=(store.supplierCash||[]).filter(row=>row.planId===plan.id&&row.type==='payment'&&!row.redReversedBy).reduce((n,row)=>n+Math.max(0,cents(row.amount)||0),0),remaining=approved==null?null:Math.max(0,approved-paid-(requestCoverage.get(plan.id)||0));if(remaining===0)continue;
   const known=!!payer&&personalPayer({...plan,...review,paymentAccountId:review.paymentAccountId||plan.paymentAccountId});payable({id:'payable:plan:'+plan.id,date:plan.createdAt||plan.date,kind:'purchase',sourceId:plan.id,sourceNo:number('procurementPlans',plan),label:known?'明确本人账户的已批准货款':'已批准货款付款职责待明确',amount:known?amount(remaining):null,unknown:!known,reason:known?'按已批准金额减已有付款及已列付款请求；不重复计算已付待核':'货款审批不等于老板个人付款；原单没有明确本人付款账户或指派，金额待核，不假定为0',href:'/app?tab=purchase&focusPlan='+encodeURIComponent(plan.id)});
  }
  for(const statement of store.payrollStatements||[]){if(statement.status!=='confirmed')continue;const payer=assignedId(statement);if(payer&&payer!==who.id||!payer&&statement.confirmedBy!==who.id)continue;const total=cents(statement.total),paid=rawReceipts.filter(receipt=>receipt.kind==='payroll'&&receipt.sourceId===statement.id&&!receipt.isReversal&&!reversedIds.has(receipt.id)&&Number(receipt.amount)<0).reduce((n,receipt)=>n+Math.abs(cents(receipt.amount)||0),0),remaining=total==null?null:Math.max(0,total-paid-(requestCoverage.get(statement.id)||0));if(remaining===0)continue;
   const known=!!payer&&personalPayer(statement);payable({id:'payable:payroll:'+statement.id,date:statement.createdAt||statement.date,kind:'other',sourceId:statement.id,sourceNo:number('payrollStatements',statement),label:known?'明确本人账户的已核定工资待付':'已核定工资付款账户待明确',amount:known?amount(remaining):null,unknown:!known,reason:known?'已核定且尚无足额付款登记；已付款待核不重列待付':'本人确认工资金额不等于已明确本人付款账户；先在原工资流程明确实际付款职责',href:'/app?tab=payroll&view=manage'});
  }
 }
 // Direct owner cash confirmation is an existing proof, not another receipt.
 // Count only unambiguous increments dated in this period, once per original
 // confirmation; ordinary store cash receipts are not counted as personal in.
 if(who.roleCode==='owner'){
  const confirmations=(store.saleFundResponsibilityConfirmations||[]).filter(row=>row.ownerId===who.id&&(row.events||[]).some(event=>event.by===who.id&&event.receiptKind==='owner_direct_cash')),proofTotals=new Map(),seen=new Set();
  for(const receipt of rawReceipts){if(receipt.kind!=='sale'||receipt.account!=='现金'||receipt.isReversal||reversedIds.has(receipt.id)||seen.has(receipt.id)||!confirmations.some(row=>row.orderId===receipt.sourceId&&row.partId===(receipt.partId||'legacy')))continue;seen.add(receipt.id);try{const proof=require('./owner-direct-cash').receiptState(store,receipt);if(proof?.derivedOwnerDirectReceipt?.by===who.id){const id=proof.derivedOwnerDirectReceipt.confirmationId;proofTotals.set(id,(proofTotals.get(id)||0)+Math.max(0,cents(proof.verifiedAmount)||0));}}catch{warn('dashboard-direct:'+receipt.id,'本人直接收现证明未能完整核对，未计入进账汇总：'+number('receipts',receipt));}}
  for(const record of confirmations){const eligible=proofTotals.get(record.id)||0;if(!eligible)continue;const events=(record.events||[]).filter(event=>event.by===who.id&&event.receiptKind==='owner_direct_cash'&&cents(event.thisAmount)>0),total=events.reduce((n,event)=>n+cents(event.thisAmount),0),confirmed=cents(record.actualAmount);if(confirmed==null||total!==confirmed){warn('dashboard-direct-events:'+record.id,'本人直接收现历史分次日期或金额依据不完整，未自动归入本期进账：'+number('sales',record.orderId));continue;}const overlap=(store.cashHandovers||[]).some(h=>h.recipientId===who.id&&h.sourceOrderId===record.orderId&&h.sourcePartId===record.partId&&!h.sourceCorrection&&ownership.confirmedCashHandover(h));if(overlap){warn('dashboard-direct-overlap:'+record.id,'本人现金交接与直接收现记录存在同原单关联，本期仅计已确认交入，直接收现另待原证据去重：'+number('sales',record.orderId));continue;}const current=events.filter(event=>{const date=dayOf(event.transactionDate||event.at);return date>=from&&date<=to;}).reduce((n,event)=>n+cents(event.thisAmount),0);dashboardCents.received.cashHandedInAmount+=Math.min(eligible,current);}
 }
 for(const key of Object.keys(summaryCents))summary[key]=amount(summaryCents[key]);
 const dashboard={paid:{amount:amount(Object.values(dashboardCents.paid).reduce((a,b)=>a+b,0)),...Object.fromEntries(Object.entries(dashboardCents.paid).map(([key,n])=>[key,amount(n)]))},received:{amount:amount(Object.values(dashboardCents.received).reduce((a,b)=>a+b,0)),...Object.fromEntries(Object.entries(dashboardCents.received).map(([key,n])=>[key,amount(n)]))},payable:{amount:payableItems.some(item=>item.unknown)?null:amount(Object.values(dashboardCents.payable).reduce((a,b)=>a+b,0)),knownAmount:amount(Object.values(dashboardCents.payable).reduce((a,b)=>a+b,0)),...Object.fromEntries(Object.entries(dashboardCents.payable).map(([key,n])=>[key,payableUnknownCategories.has(key)?null:amount(n)])),unknownCount:payableItems.filter(item=>item.unknown).length,details:payableItems,scope:START_DATE+'起原申请／原单的当前待支付；之前全部记录请查资金往来累计历史'},notes:['已支付按本人个人账户的付款登记归类；经办门店账户支出不算个人账户付款。','进账分列本人非现金收款登记、老板登记发给本人的红包和已确认现金内部交入；内部交入不再算门店营业收入。','工资付款登记列入本人工资收款人的其他进账，实际领取证据看原工资单，不代表员工已独立核实领取。','待支付只汇总'+START_DATE+'起已明确本人付款职责且尚未支付的原记录；之前全部记录保留在资金往来累计历史。审批或已付待核不直接变成待支付，归属不明时显示待核，不按0处理。']};
 const matches=row=>!q||[row.label,row.status,row.sourceNo,row.sourceId,row.account,row.operator,row.relatedPerson,row.note,row.sourceLabel,...(row.relatedIds||[])].join(' ').normalize('NFKC').toLowerCase().includes(q);
 const ordered=(a,b)=>String(b.at||b.date||'').localeCompare(String(a.at||a.date||''))||a.id.localeCompare(b.id);
 const periodRows=rows.filter(inPeriod).filter(matches).sort(ordered),categoryCounts={all:periodRows.length,flows:0,custody:0,transfers:0,redPackets:0};for(const row of periodRows)categoryCounts[row.category]++;
 const filtered=periodRows.filter(row=>category==='all'||row.category===category);
 const tracedDates=rows.concat(openItems,payableItems).map(row=>row.date).filter(date=>date&&date>=from&&date<=to).sort(),displayedFrom=allHistory?(tracedDates[0]||to):from;
 dashboard.payable.scope=allHistory?'全部历史原申请／原单的当前待支付':'2026-10-28起原申请／原单的当前待支付；此前记录切换全部累计查询';
 dashboard.notes[3]=(allHistory?'全部累计按全部历史原记录':'当日范围只跟进2026-10-28起原记录')+'中已明确本人付款职责且尚未支付的项目；原记录不删除、不销账，已付待核不重复计待付，归属不明仍显示待核。';
 return {viewer:{id:who.id,name:who.name,roleCode:who.roleCode},personalOnly:true,scope,startDate:START_DATE,asOf:c.now(),period:{from:displayedFrom,to,today,startDate:START_DATE,scope},summary,dashboard,openItems:openItems.filter(matches).sort(ordered),categoryCounts,rows:filtered.slice(offset,offset+PAGE_SIZE),totalRows:filtered.length,offset,pageSize:PAGE_SIZE,warnings};
}
module.exports={report};
