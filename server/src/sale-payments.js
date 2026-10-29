const c = require('./common');
const parts = require('./sale-payment-parts');
const accounts=require('./payment-accounts'),ownership=require('./account-ownership');
function receiptNos(store,orderId,partId){return (store.receipts||[]).filter(row=>row.kind==='sale'&&row.sourceId===orderId&&(!partId||row.partId===partId)&&Number(row.amount)>0&&!row.isReversal).map(row=>(store.documentNumbers||[]).find(entry=>entry.collection==='receipts'&&entry.sourceId===row.id)?.displayNo).filter(Boolean);}
function legacyAccount(store,order){
 const direct=ownership.project(store,{...accounts.snapshot(order),account:order.paymentMethod});
 if(ownership.isStoreAccount(store,direct))return direct;
 const originals=(store.receipts||[]).filter(r=>r.kind==='sale'&&r.sourceId===order.id&&r.amount>0&&!r.isReversal).map(r=>ownership.project(store,r));
 if(originals.length&&originals.every(r=>ownership.isStoreAccount(store,r)&&r.account===order.paymentMethod)&&new Set(originals.map(r=>r.account+'/'+(r.paymentAccountId||r.accountName||''))).size===1)return ownership.project(store,{...direct,...accounts.snapshot(originals[0])});
 return direct;
}
function bindLegacyStore(store,order){const account=legacyAccount(store,order);if(ownership.isStoreAccount(store,account)){Object.assign(order,accounts.snapshot(account));if(order.paymentReview)Object.assign(order.paymentReview,{accountScope:'store',accountVerifierId:account.accountVerifierId||'',accountOwnerUnspecified:false});}return account;}

function received(store, user, order, amount, reference = '') {
  if (!amount) return;
  store.receipts.push({
    id: c.id('RC'), kind: 'sale', sourceId: order.id, amount: c.round(amount),
    ...accounts.snapshot(legacyAccount(store,order)),account: order.paymentMethod,
    ...(order.paymentMethod === '现金' ? require('./cash-custody').place(store,user,{cashDestination:'employee'}) : {}),
    operatorId: user.id, createdAt: c.now(),
    ...(reference ? {reference} : {}),
  });
}
function init(store, user, order, payload, paymentCredit = 0) {
  if (payload.payments != null || payload.paymentAccountId) return parts.init(store,user,order,payload,paymentCredit);
  if(paymentCredit < 0 || paymentCredit > order.amount)throw new c.HttpError(400,'换货抵款不正确');
  if(paymentCredit)order.paymentCredit=paymentCredit;
  const amount = c.round((order.saleMode === 'guobu' ? order.amount - order.subsidyAmount : order.amount)-paymentCredit);
  if (amount < 0) throw new c.HttpError(400, '应收金额不能小于零');
  const cash = order.paymentMethod === '现金';
  const owner = store.users.find((row) => row.roleCode === 'owner' && row.status === 'active');
  const account=bindLegacyStore(store,order),storeOwned=ownership.isStoreAccount(store,account);
  const recipient = cash ? user : storeOwned ? (account.accountVerifierId?c.userById(store,account.accountVerifierId):owner) : order.accountOwnerId ? c.userById(store, order.accountOwnerId) : owner;
  if (!recipient) throw new c.HttpError(409, '没有可核对的老板账号');
  if (!cash && !storeOwned && !c.capabilities(recipient).financeReceive)
    throw new c.HttpError(400, '收款账户持有人必须有财务权限');
  const status = amount === 0 ? '无需收款' : cash ? payload.cashDrawerConfirmed === true ? '待现金入库' : '待确认收现金' : '待收款人确认';
  order.paymentReview = {
    status, amount, recipientId: recipient.id, recipient: recipient.name,
    declaredBy: user.id, declaredAt: c.now(),
    ...(storeOwned?{accountScope:'store',accountVerifierId:account.accountVerifierId||recipient.id}:{}),
    ...(cash ? {cashReceivedConfirmed:payload.cashDrawerConfirmed===true,cashReceivedAt:payload.cashDrawerConfirmed===true?c.now():null,cashDrawerConfirmed:false} : {accountOwnerUnspecified: storeOwned?false:!order.accountOwnerId}),
    events: [{type: cash ? payload.cashDrawerConfirmed === true ? '营业员确认收到顾客现金' : '待营业员确认收到现金' : storeOwned?'待门店账户核对':'待账户持有人确认', by: user.id, at: c.now()}],
  };
  const cashDeclared = cash && payload.cashDrawerConfirmed === true;
  order.receivedAmount = c.round(paymentCredit + (cashDeclared ? amount : 0));
  if (cashDeclared && amount) received(store, user, order, amount);
  c.audit(store, user, 'sale:payment-submit', order.id + ' · ' + status + ' · ' + amount);
}
function visible(store, user, order) {
  return user.roleCode === 'owner' || order.operatorId === user.id || order.salespersonId === user.id || order.paymentReview?.recipientId === user.id;
}
function list(store, user) {
  c.permit(user, 'learn');
  return store.sales.filter((order) => !order.paymentParts && order.paymentReview && visible(store, user, order))
    .map((order) => {const account=legacyAccount(store,order),storeOwned=ownership.isStoreAccount(store,account);return ({
      orderId: order.id, receiptNos:receiptNos(store,order.id), date: order.createdAt, operatorId: order.operatorId, salesperson: order.salesperson || order.operator,
      paymentMethod: order.paymentMethod, amount: order.paymentReview.amount,
      ...accounts.snapshot(account),
      customerName: order.customerName || '散客', customerMask: order.customerMask || '',
      paymentReview: storeOwned?{...order.paymentReview,accountScope:'store',accountVerifierId:account.accountVerifierId||'',accountOwnerUnspecified:false}:order.paymentReview,
      mineToReview: ['待老板核对','待确认收现金','待现金入库','待收款人确认','有异议'].includes(order.paymentReview.status) && order.operatorId === user.id,
      canBossReceive: false,
      canDeclare: order.paymentMethod !== '现金' && order.operatorId === user.id && ['待收款人确认','有异议'].includes(order.paymentReview.status),
      canConfirm: false,
    });}).concat(parts.list(store,user));
}
function find(store, id) {
  const order = store.sales.find((row) => row.id === id);
  if (!order || !order.paymentReview) throw new c.HttpError(404, '收款核对单不存在');
  return order;
}
function declarePaid(store,user,payload){
 if(store.sales.find(row=>row.id===payload.orderId)?.paymentParts)return parts.declarePaid(store,user,payload);
 const order=find(store,payload.orderId),review=order.paymentReview;
 if(order.operatorId!==user.id)throw new c.HttpError(403,'只有原经办营业员能核对顾客付款');
 if(order.paymentMethod==='现金')throw new c.HttpError(400,'现金请使用现金声明');
 if(review.status==='已确认到账')return {orderId:order.id,status:review.status,alreadyDeclared:true};
 if(!['待收款人确认','有异议'].includes(review.status))throw new c.HttpError(409,'此笔不能再确认顾客付款');
 const existing=(store.receipts||[]).filter(row=>row.kind==='sale'&&row.sourceId===order.id&&!row.isReversal);
 if(existing.reduce((n,row)=>n+Number(row.amount||0),0)>review.amount)throw new c.HttpError(409,'收款累计超过原金额，请核对');
 const reference=String(payload.reference||'').trim().slice(0,100);
 if(reference&&store.receipts.some(row=>row.reference===reference))throw new c.HttpError(409,'该到账流水号已登记');
 if(!existing.length)received(store,user,order,review.amount,reference);
 const at=c.now();order.receivedAmount=c.round((order.paymentCredit||0)+review.amount);
 review.customerPaidDeclaredAt ||= at;review.customerPaidDeclaredBy ||= user.id;
 Object.assign(review,{status:'已确认到账',confirmedBy:user.id,confirmedAt:at,reference,disputeReason:''});
 review.events ||= [];review.events.push({type:'营业员核对支付到账反馈',by:user.id,at,amount:review.amount,reference});
 c.audit(store,user,'sale:customer-paid-declare',order.id);
 (store.localCatalogNotices ||= []).push({key:'sale-payment-local:'+order.id,kind:'销售资金已确认',orderId:order.id,displayNo:order.displayNo||null,summary:(order.operator||'营业员')+' · '+order.paymentMethod+' · '+Number(review.amount||0).toFixed(2)+' 元',amount:review.amount,createdAt:at,readAt:null,localOnly:true});
 return {orderId:order.id,status:review.status};
}
function confirm(store, user, payload) {
  if (store.sales.find(row=>row.id===payload.orderId)?.paymentParts) return parts.confirm(store,user,payload);
  const order = find(store, payload.orderId);
  const review = order.paymentReview;
  if (order.paymentMethod === '现金') throw new c.HttpError(400, '门市现金由开单营业员确认入库；交给老板请使用内部现金交接单');
  const account=bindLegacyStore(store,order),storeOwned=ownership.isStoreAccount(store,account);
  if (storeOwned?!ownership.canVerify(store,user,account):review.recipientId !== user.id) throw new c.HttpError(403, '须由有权限的门店核对人或实际个人账户持有人确认');
  if (!['待老板核对','待收款人确认','有异议'].includes(review.status))
    throw new c.HttpError(409, '此单已经核对');
  const amount = c.money(payload.actualAmount, '实际到账金额');
  if (amount !== review.amount) throw new c.HttpError(409, '金额有差异，请登记异议，不可按全额确认');
  const cash = order.paymentMethod === '现金';
  const reference = String(payload.reference || '').trim().slice(0, 100);
  if (!cash && !review.customerPaidDeclaredAt) throw new c.HttpError(409, '请先由经办营业员确认顾客已付款');
  if (!cash && !storeOwned && review.accountOwnerUnspecified) throw new c.HttpError(409, '请先由老板指定实际收款账户持有人');
  if (reference && store.receipts.some((row) => row.reference === reference&&(!storeOwned||row.kind!=='sale'||row.sourceId!==order.id)))
    throw new c.HttpError(409, '该到账流水号已登记');
  if(storeOwned){
    const posted=c.round((store.receipts||[]).filter(r=>r.kind==='sale'&&r.sourceId===order.id&&!r.isReversal).reduce((n,r)=>n+Number(r.amount||0),0));
    if(posted>amount)throw new c.HttpError(409,'原单收款累计超过应收金额，请核对');
    if(posted<amount)received(store,user,order,c.round(amount-posted),reference);
    order.receivedAmount=c.round((order.paymentCredit||0)+amount);
  }else if (!cash || !store.receipts.some((row) => row.kind === 'sale' && row.sourceId === order.id)) {
    received(store, user, order, amount, reference);
    order.receivedAmount = c.round((order.paymentCredit || 0) + amount);
  }
  review.status = cash ? '已核对' : '已确认到账';
  review.confirmedBy = user.id; review.confirmedAt = c.now();
  review.reference = reference;
  review.events.push({type: review.status, by: user.id, at: review.confirmedAt, amount, reference});
  c.audit(store, user, 'sale:payment-confirm', order.id + ' · ' + amount);
  store.localCatalogNotices||=[];store.localCatalogNotices.push({key:'sale-payment-local:'+order.id,kind:'销售资金已确认',orderId:order.id,displayNo:order.displayNo||null,summary:(order.operator||'营业员')+' · '+order.paymentMethod+' · '+Number(amount||0).toFixed(2)+' 元',amount,createdAt:c.now(),readAt:null,localOnly:true});
  return {orderId: order.id, status: review.status};
}
function declareCash(store, user, payload) {
  if (store.sales.find(row=>row.id===payload.orderId)?.paymentParts) return parts.declareCash(store,user,payload);
  const order = find(store, payload.orderId);
  if (order.operatorId !== user.id) throw new c.HttpError(403, '只有原开单人能补充现金声明');
  if (order.paymentMethod !== '现金') throw new c.HttpError(400, '此单不是现金收款');
  const review = order.paymentReview;
  if (review.status === '已核对') throw new c.HttpError(409, '现金已入库，请申请留痕更正');
  const declaration = String(payload.declaration || '');
  if (!['received','drawer','not_received','uncertain'].includes(declaration)) throw new c.HttpError(400, '请选择现金实际情况');
  const note = String(payload.note || '').trim().slice(0,500);
  if (declaration === 'not_received' && !note) throw new c.HttpError(400, '未收到现金请填写说明');
  const alreadyRecorded = store.receipts.some((row) => row.kind === 'sale' && row.sourceId === order.id);
  review.cashDeclaration = declaration;
  review.cashDeclarationNote = note; review.declaredAt = c.now();
  if (declaration === 'received') {if (!alreadyRecorded) {received(store,user,order,review.amount); order.receivedAmount=c.round((order.paymentCredit||0)+review.amount);} review.cashReceivedConfirmed=true; review.cashReceivedAt=review.declaredAt; review.status='待现金入库'; review.disputeReason='';} else if (declaration === 'drawer') {if (!alreadyRecorded&&!review.cashReceivedConfirmed) throw new c.HttpError(409,'请先确认已收到顾客现金'); require('./cash-custody').receiveSale(store,user,order.id,'legacy',review.amount,'sale-drawer:'+order.id); review.cashDrawerConfirmed=true; review.status='已核对'; review.confirmedBy=user.id; review.confirmedAt=review.declaredAt; review.disputeReason='';}
  if (declaration === 'not_received' || (alreadyRecorded && declaration === 'uncertain')) {review.status = '有异议'; review.disputeReason = note || '原现金声明已撤回，待门市核对';}
  review.events.push({type:'开单人补充现金声明',by:user.id,at:review.declaredAt,declaration,note});
  c.audit(store,user,'sale:cash-declare',order.id+' · '+declaration);
  if(declaration==='received'||declaration==='drawer'){store.localCatalogNotices||=[];store.localCatalogNotices.push({key:'sale-cash-local:'+order.id+':'+declaration,kind:declaration==='received'?'销售现金已收':'销售现金已入库',orderId:order.id,displayNo:order.displayNo||null,summary:(order.operator||user.name||'营业员')+' · '+Number(review.amount||0).toFixed(2)+' 元',amount:review.amount,createdAt:c.now(),readAt:null,localOnly:true});}
  return {orderId:order.id,status:review.status,declaration};
}
function assign(store, user, payload) {
  if (store.sales.find(row=>row.id===payload.orderId)?.paymentParts) return parts.assign(store,user,payload);
  c.permit(user, 'manageUsers');
  const order = find(store, payload.orderId);
  const review = order.paymentReview;
  if(ownership.isStoreAccount(store,legacyAccount(store,order)))throw new c.HttpError(409,'门店账户只配置核对人，不能改成个人账户持有人');
  if (order.paymentMethod === '现金') throw new c.HttpError(400, '现金单无需指定账户持有人');
  if (!['待收款人确认','有异议'].includes(review.status)) throw new c.HttpError(409, '已核对单不能改收款人');
  const person = c.userById(store, payload.accountOwnerId);
  if (!c.capabilities(person).financeReceive) throw new c.HttpError(400, '收款人须有财务权限');
  order.accountOwnerId = person.id; review.recipientId = person.id; review.recipient = person.name; review.accountOwnerUnspecified = false;
  review.events.push({type:'老板指定收款人',by:user.id,at:c.now(),recipientId:person.id});
  c.audit(store,user,'sale:payment-assign',order.id+' · '+person.name);
  return {orderId:order.id,recipient:person.name};
}
function dispute(store, user, payload) {
  if (store.sales.find(row=>row.id===payload.orderId)?.paymentParts) return parts.dispute(store,user,payload);
  const order = find(store, payload.orderId);
  const review = order.paymentReview;
  const account=legacyAccount(store,order);
  if (ownership.isStoreAccount(store,account)?!ownership.canVerify(store,user,account):review.recipientId !== user.id) throw new c.HttpError(403, '只有有权限的门店核对人或指定个人收款人可以提出异议');
  if (!['待老板核对','待收款人确认','有异议'].includes(review.status))
    throw new c.HttpError(409, '此单已经核对');
  const reason = String(payload.reason || '').trim().slice(0, 500) || '未收到';
  const actual = payload.actualAmount == null || payload.actualAmount === '' ? null : c.money(payload.actualAmount, '实际金额');
  review.status = '有异议'; review.disputeReason = reason; review.disputedAt = c.now(); review.actualAmount = actual;
  if (order.paymentMethod !== '现金') { review.customerPaidDeclaredAt = null; review.returnedToOperatorAt = review.disputedAt; review.returnedToOperatorBy = user.id; }
  review.events.push({type: '有异议', by: user.id, at: review.disputedAt, actualAmount: actual, reason});
  c.audit(store, user, 'sale:payment-dispute', order.id + ' · ' + reason);
  return {orderId: order.id, status: review.status};
}
function bossReceived(store,user,payload){
 c.permit(user,'manageUsers');const order=find(store,payload.orderId);
 if(order.paymentParts){
  const part=payload.partId?order.paymentParts.find(p=>p.id===payload.partId):order.paymentParts.length===1?order.paymentParts[0]:null;
  if(!part)throw new c.HttpError(400,'请选择具体收款分笔');const review=part.paymentReview,storeOwned=ownership.isStoreAccount(store,part);
  if(part.account==='现金')throw new c.HttpError(400,'现金请按原现金核对流程');
  if(!['待收款人确认','有异议'].includes(review.status))throw new c.HttpError(409,'此分笔已处理');
  if(storeOwned?!ownership.canVerify(store,user,part):review.recipientId!==user.id)throw new c.HttpError(403,'只能核对有权限的门店账户或实际进入本人账户的款');
  if(!storeOwned&&review.accountOwnerUnspecified)parts.assign(store,user,{orderId:order.id,partId:part.id,accountOwnerId:user.id});
  if(storeOwned)Object.assign(review,{accountScope:'store',accountVerifierId:ownership.verifierId(store,part),accountOwnerUnspecified:false});
  if(!review.customerPaidDeclaredAt){review.customerPaidDeclaredAt=c.now();review.customerPaidDeclaredBy=user.id;review.declaredOnBehalfOf=order.operatorId;review.events ||= [];review.events.push({type:storeOwned?'代经办核对门店收款记录':'老板代经办核实顾客付款',by:user.id,onBehalfOf:order.operatorId,at:review.customerPaidDeclaredAt});c.audit(store,user,storeOwned?'sale:store-payment-check':'sale:boss-declare-on-behalf',{orderId:order.id,partId:part.id,operatorId:order.operatorId});}
  return parts.confirm(store,user,{orderId:order.id,partId:part.id,actualAmount:part.amount,reference:''});
 }
 const review=order.paymentReview,account=bindLegacyStore(store,order),storeOwned=ownership.isStoreAccount(store,account);
 if(order.paymentMethod==='现金')throw new c.HttpError(400,'现金请按原现金核对流程');
 if(!['待收款人确认','有异议'].includes(review.status))throw new c.HttpError(409,'此单已处理');
 if(storeOwned?!ownership.canVerify(store,user,account):review.recipientId!==user.id)throw new c.HttpError(403,'只能核对有权限的门店账户或实际进入本人账户的款');
 if(!storeOwned&&review.accountOwnerUnspecified)assign(store,user,{orderId:order.id,accountOwnerId:user.id});
 if(!review.customerPaidDeclaredAt){review.customerPaidDeclaredAt=c.now();review.customerPaidDeclaredBy=user.id;review.declaredOnBehalfOf=order.operatorId;review.events ||= [];review.events.push({type:storeOwned?'代经办核对门店收款记录':'老板代经办核实顾客付款',by:user.id,onBehalfOf:order.operatorId,at:review.customerPaidDeclaredAt});c.audit(store,user,storeOwned?'sale:store-payment-check':'sale:boss-declare-on-behalf',order.id+' · '+order.operatorId);}
 return confirm(store,user,{orderId:order.id,actualAmount:review.amount,reference:''});
}
module.exports = {init, list, declarePaid:require("./scan-collection").declarePaid(declarePaid), confirm, dispute, assign, declareCash, bossReceived};
