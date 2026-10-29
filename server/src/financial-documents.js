const c=require('./common'),erp=require('./erp'),reconciliation=require('./receipt-reconciliation'),purpose=require('./business-purpose');
const reversalKinds=new Set(['expense_red','other_income_red']);
const names={store_transfer_out:'门店互转转出',store_transfer_in:'门店互转转入',sale:'销售收款',refund:'销售退款',supplier_payment:'供应商付款',supplier_refund:'供应商退款',supplier_outbound_receipt:'供货商调货实收款',purchase:'采购付款',expense:'费用付款',other_income:'其他收入',carrier:'移动佣金到账',carrier_clawback:'移动佣金扣回',carrier_rental:'移动租金',payroll:'工资发放',cash_recharge:'空充收款'};
function list(store,user,query){
 const direction=query.get('direction')||'receive',q=(query.get('q')||'').trim().toLowerCase(),from=query.get('from')||'',to=query.get('to')||'';
 if(!['receive','pay'].includes(direction))throw new c.HttpError(400,'单据方向不正确');
 const who=direction==='receive'?reconciliation.scope(store,user,query):require('./master-data').actor(store,user);if(direction==='pay')c.permit(who,'finance');
 for(const date of [from,to])if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new c.HttpError(400,'日期格式不正确');
 if(from&&to&&from>to)throw new c.HttpError(400,'开始日期不能晚于结束日期');
 const salesById=new Map((store.sales||[]).map(row=>[row.id,row]));
 const saleNumbers=new Map((store.documentNumbers||[]).filter(row=>row.collection==='sales').map(row=>[row.sourceId,row.displayNo]));
 const outboundsBySale=new Map();for(const row of store.movements||[])if(row.type==='销售出库'){const rows=outboundsBySale.get(row.sourceId)||[];rows.push({id:row.id,product:row.product||'',warehouseId:row.warehouseId||'',warehouseName:row.warehouseName||'',quantity:Math.abs(Number(row.quantity||0))});outboundsBySale.set(row.sourceId,rows);}
 const rows=require('./serial-source-corrections').receiptRows(store).filter(row=>!row.isReversal&&!reversalKinds.has(row.kind)&&(direction==='receive'?row.amount>0&&reconciliation.owns(store,who,row):row.amount<0)).filter(row=>!query.get('id')&&!query.get('sourceId')||row.id===(query.get('id')||query.get('sourceId'))||row.sourceId===(query.get('id')||query.get('sourceId'))).map(row=>{
  const source=(store.storeCashWalletTransfers||[]).find(x=>x.id===row.sourceId)||store.expenses.find(x=>x.id===row.sourceId)||(store.otherIncome||[]).find(x=>x.id===row.sourceId)||(store.supplierCash||[]).find(x=>x.id===row.sourceId)||(store.supplierOutboundTransfers||[]).find(x=>x.id===row.sourceId)||store.sales.find(x=>x.id===row.sourceId)||store.saleReturns.find(x=>x.id===row.sourceId)||{};
  const reversed=source.redReversedBy||store.receipts.some(x=>x.originalReceiptId===row.id&&(x.isReversal||reversalKinds.has(x.kind)));
  const supplier=store.suppliers.find(x=>x.id===(row.supplierId||source.supplierId));
  const counterparty=(require('./wallet-funding-read').isReceipt(row)?'门店微信内部充值':'')||row.counterparty||source.counterparty||supplier?.name||source.customerName||names[row.kind]||row.kind;
  const candidate=row.kind==='sale'?salesById.get(row.sourceId):null;
  const sale=candidate&&(who.roleCode==='owner'||candidate.operatorId===who.id||candidate.salespersonId===who.id)?candidate:null;
  const goods=(sale?.items||[]).map(item=>({name:item.name||item.skuId,externalCode:item.externalCode||item.skuId||'',type:item.type||'',subType:item.subType||'',thirdType:item.thirdType||'',serialNo:item.serialNo||'',quantity:item.quantity,warehouseName:item.warehouseName||''}));
  const saleDisplayNo=sale?saleNumbers.get(sale.id)||sale.displayNo||sale.id:'';
  const match=/^(?:SO|XS)-(\d{6,8})-(\d{3,})$/i.exec(saleDisplayNo);
  const outbound=sale?outboundsBySale.get(sale.id)||[]:[];
  const linked={saleId:sale?.id||'',saleDisplayNo,outboundDisplayNo:outbound.length?(match?'CK-'+match[1]+'-'+match[2]:'CK-'+saleDisplayNo):'',goods,outbound};
  const exchange=require('./wallet-cash-exchanges').forReceipt(store,row.id);
  const visible={...row,...require('./account-ownership').project(store,row),...linked,...(row.account==='现金'&&require('./cash-custody').inVault(row)?{accountOwnerName:'门市抽屉'}:{}),amount:Math.abs(row.amount),business:require('./store-transfer').isReceipt(row)?require('./store-transfer').label(row):require('./wallet-funding-read').isReceipt(row)?require('./wallet-funding-read').label(row):row.internalTransferId?'内转资金交接':purpose.isPassThrough(store,row)?'代充值 · '+(row.amount>0?'收款':'付款')+(exchange?' · 已关联':' · 待关联'):names[row.kind]||row.kind,businessPurpose:purpose.purpose(store,row),economicClass:purpose.isPassThrough(store,row)?'pass_through':'operating',pairStatus:require('./store-transfer').isReceipt(row)||require('./wallet-funding-read').isReceipt(row)?null:purpose.isPassThrough(store,row)?exchange?'linked':'unlinked':null,counterparty,note:row.note||source.note||source.reason||'',reference:row.reference||source.reference||'',operator:row.operator||store.users.find(x=>x.id===row.operatorId)?.name||row.operatorId,status:reversed?'已红冲':'已登记',date:row.transactionDate||c.day(row.createdAt),...(exchange?{walletCashExchange:{id:exchange.id,businessPurpose:'agency_topup',economicClass:'pass_through',otherReceiptId:row.id===exchange.cashReceiptId?exchange.walletReceiptId:exchange.cashReceiptId,accountName:exchange.accountName,noAdditionalReceipt:true}}:{})};return direction==='receive'?reconciliation.decorate(store,visible):visible;
 }).filter(row=>(!query.get('kind')||row.kind===query.get('kind'))&&(!from||row.date>=from)&&(!to||row.date<=to)&&(!q||(row.id+' '+row.sourceId+' '+row.counterparty+' '+row.reference+' '+row.note+' '+row.account+' '+(row.accountName||'')).toLowerCase().includes(q))).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
 return {direction,rows,total:c.round(rows.filter(r=>r.status!=='已红冲').reduce((n,r)=>n+r.amount,0)),...(direction==='receive'?{personalOnly:who.roleCode!=='owner',canReconcile:who.roleCode==='owner'}:{})};
}
const ownerRedPacketPolicy=Symbol('owner-red-packet');
function create(store,user,payload,policy){purpose.normalizePurpose(payload.businessPurpose);
 if(payload.direction==='pay'&&!c.capabilities(require('./master-data').actor(store,user)).finance)return require('./normal-payment-registration').create(store,user,payload);
 if(!['receive','pay'].includes(payload.direction))throw new c.HttpError(400,'单据方向不正确');
 user=payload.direction==='receive'?reconciliation.actor(store,user):require('./master-data').actor(store,user);if(payload.direction==='pay')c.permit(user,'finance');
 if(payload.direction==='receive'&&(payload.kind!=null&&payload.kind!=='other_income'||['pay','payment','expense'].includes(String(payload.type||''))))throw new c.HttpError(403,'收款单只能登记正常收款，付款及其他业务须走各自原权限');
 const amount=require('./payment-accounts').cents(payload.amount)/100;if(amount<=0)throw new c.HttpError(400,'金额必须大于零');
 const pa=require('./payment-accounts'),parts=pa.normalize(store,payload,amount);purpose.validateParts(store,payload.businessPurpose,payload.direction,parts);
 if(payload.direction==='pay'){
  if(policy===ownerRedPacketPolicy){
   if(user.roleCode!=='owner'||parts.length!==1||parts.some(p=>p.account!=='微信'||p.accountOwnerId!==user.id||(p.paymentAccountId&&p.accountName!=='老板微信')))throw new c.HttpError(400,'红包须由老板本人微信支付，不能使用门店微信或门店现金');
  }else pa.assertAllowedPaymentParts(store,parts);
 }
 if(payload.direction==='receive')for(const part of parts)if(part.account==='现金')Object.assign(part,require('./cash-custody').place(store,user,{...part,cashDestination:'vault'}));
 if(payload.direction==='receive')reconciliation.validateParts(store,user,parts,payload);
 const counterparty=c.text(payload.counterparty,'收付款对象').slice(0,100),note=c.text(payload.note,'收付款事由').slice(0,500),reference=String(payload.reference||'').trim().slice(0,100);
 const date=payload.date||c.day();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>c.day()||c.day(date+'T04:00:00.000Z')!==date)throw new c.HttpError(400,'实际收付日期不正确');
 if((store.dailyCloseouts||[]).some(x=>(x.date===date||x.date===c.day())&&x.status==='已锁定'))throw new c.HttpError(409,'营业日已锁定，请先办理日结更正');
 if(payload.confirmed!==true)throw new c.HttpError(400,'请确认款项已实际收付');pa.reference(store,reference);
 let row,receipts;
 if(payload.direction==='pay'){row=erp.expense(store,user,{type:note,amount,payments:parts});receipts=store.receipts.filter(x=>x.sourceId===row.id);}
 else {row={id:c.id('SK'),type:note,amount,paymentParts:parts,createdAt:c.now(),operatorId:user.id,operator:user.name};store.otherIncome||=[];store.otherIncome.push(row);receipts=pa.record(store,user,'other_income',row.id,parts);}
 if(policy===ownerRedPacketPolicy){for(const part of row.paymentParts)part.accountName='老板微信';for(const receipt of receipts)Object.assign(receipt,{accountName:'老板微信',paymentScope:'owner_red_packet'});row.paymentScope='owner_red_packet';}
 purpose.classify(store,row,payload.businessPurpose);Object.assign(row,{counterparty,note,reference,date});for(const receipt of receipts)Object.assign(receipt,{counterparty,note,transactionDate:date,...(!receipt.reference&&parts.length===1&&reference?{reference}:{})});
 const review=payload.direction==='receive'?reconciliation.register(store,user,row,receipts,payload):null;
 c.audit(store,user,payload.direction==='pay'?'payment:create':'receipt:create',{sourceId:row.id,amount,partCount:parts.length,counterparty,note});return {id:receipts[0].id,sourceId:row.id,receiptIds:receipts.map(row=>row.id),paymentParts:row.paymentParts,businessPurpose:row.businessPurpose,economicClass:row.economicClass,...(review?{reconciliation:review}:{}),message:payload.direction==='receive'?'收款单已正常登记，已发老板事后对账；不代表银行自动验证到账':'付款单已保存'};
}
module.exports={list,create};
// Server-only entry for a completed mobile card bundle. The customer payment
// remains one normal receipt with the existing owner reconciliation trail.
module.exports.createMobileCardBundleReceipt=function(store,user,payload){
 const bundle=(store.mobileCardBundles||[]).find(row=>row.id===payload.bundleId);
 if(!bundle||bundle.incomeId||bundle.operatorId!==user.id||require('./payment-accounts').cents(payload.amount)!==require('./payment-accounts').cents(bundle.customerPay))throw new c.HttpError(409,'移动组合单或收款金额不一致，请核对原单');
 if(!['现金','微信'].includes(payload.account))throw new c.HttpError(400,'移动组合单只接受实际微信扫码收款或门店现金');
 const result=create(store,user,{direction:'receive',amount:bundle.customerPay,counterparty:'顾客',note:'移动业务 · 巴渝卡坐扣 '+bundle.tier+'元档 · '+bundle.openedMask,reference:payload.reference,date:payload.date,confirmed:true,payments:[{amount:bundle.customerPay,account:payload.account,paymentAccountId:payload.paymentAccountId,reference:payload.reference}]});
 const income=(store.otherIncome||[]).find(row=>row.id===result.sourceId);
 if(!income||result.receiptIds.length!==1)throw new c.HttpError(409,'移动组合单收款原单未完整生成');
 Object.assign(income,{mobileCardBundleId:bundle.id,businessCategory:'移动业务',businessType:'新办卡组合办理'});
 for(const receipt of (store.receipts||[]).filter(row=>result.receiptIds.includes(row.id)))Object.assign(receipt,{mobileCardBundleId:bundle.id,businessCategory:'移动业务'});
 return result;
};
// Server-only entry: ordinary HTTP payment creation cannot supply the private policy token.
module.exports.createOwnerRedPacket=function(store,user,payload,redPacketId){
 const who=require('./master-data').actor(store,user),rows=(store.orderRedPackets||[]).filter(r=>r.id===redPacketId),row=rows[0];
 if(who.roleCode!=='owner')throw new c.HttpError(403,'红包须由老板本人发放');
 if(rows.length!==1||row.status!=='已核定待支付'||row.expenseId||payload.direction!=='pay'||require('./payment-accounts').cents(payload.amount)!==row.approvedAmountCents||payload.counterparty!==c.userById(store,row.employeeId).name)throw new c.HttpError(409,'红包原单、领取人或核定金额不一致');
 return require('./master-data').wrapFinancial((s,u,p)=>create(s,u,p,ownerRedPacketPolicy))(store,who,payload);
};

const createWithParty=require('./master-data').wrapFinancial(create);
module.exports.create=function(store,user,payload){if(payload.direction==='receive'&&!String(payload.fundPartyKey||'').trim()&&!String(payload.counterparty||'').trim()){const result=create(store,user,{...payload,counterparty:'其他'});for(const r of [...(store.otherIncome||[]),...(store.receipts||[])])if(r.id===result.sourceId||r.sourceId===result.sourceId)Object.assign(r,{counterpartyNameSnapshot:'其他',counterpartyKind:'other',counterpartyDefaulted:true});return result;}return createWithParty(store,user,payload);};
module.exports.list=require("./master-data").wrapFinancialList(module.exports.list);
const filteredList=module.exports.list;module.exports.list=function(...args){const result=filteredList(...args);return result.direction==='receive'?{...result,reconciliationSummary:reconciliation.summary(result.rows)}:result;};
const ledgerList=module.exports.list;
module.exports.list=function(store,user,query){return query.get('view')==='documents'?require('./payment-document-query').list(store,user,query,ledgerList):ledgerList(store,user,query);};
