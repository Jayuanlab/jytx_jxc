const c = require('./common');
const parts = require('./sale-payment-parts');

function received(store, user, order, amount, reference = '') {
  if (!amount) return;
  store.receipts.push({
    id: c.id('RC'), kind: 'sale', sourceId: order.id, amount: c.round(amount),
    account: order.paymentMethod,
    ...(order.accountOwnerId ? {accountOwnerId: order.accountOwnerId} : {}),
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
  const recipient = cash ? owner : order.accountOwnerId ? c.userById(store, order.accountOwnerId) : owner;
  if (!recipient) throw new c.HttpError(409, '没有可核对的老板账号');
  if (!cash && !c.capabilities(recipient).financeReceive)
    throw new c.HttpError(400, '收款账户持有人必须有财务权限');
  const status = amount === 0 ? '无需收款' : cash ? '待老板核对' : '待收款人确认';
  order.paymentReview = {
    status, amount, recipientId: recipient.id, recipient: recipient.name,
    declaredBy: user.id, declaredAt: c.now(),
    ...(cash ? {cashDrawerConfirmed: payload.cashDrawerConfirmed === true} : {accountOwnerUnspecified: !order.accountOwnerId}),
    events: [{type: cash ? payload.cashDrawerConfirmed === true ? '开单人声明现金入抽屉' : '开单人表示现金待核实' : '待账户持有人确认', by: user.id, at: c.now()}],
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
    .map((order) => ({
      orderId: order.id, date: order.createdAt, operatorId: order.operatorId, salesperson: order.salesperson || order.operator,
      paymentMethod: order.paymentMethod, amount: order.paymentReview.amount,
      customerName: order.customerName || '散客', customerMask: order.customerMask || '',
      paymentReview: order.paymentReview,
      mineToReview: (user.roleCode === 'owner' || order.paymentReview.recipientId === user.id) && ['待老板核对','待收款人确认','有异议'].includes(order.paymentReview.status),
      canConfirm: order.paymentReview.recipientId === user.id && ['待老板核对','待收款人确认','有异议'].includes(order.paymentReview.status),
    })).concat(parts.list(store,user));
}
function find(store, id) {
  const order = store.sales.find((row) => row.id === id);
  if (!order || !order.paymentReview) throw new c.HttpError(404, '收款核对单不存在');
  return order;
}
function confirm(store, user, payload) {
  if (store.sales.find(row=>row.id===payload.orderId)?.paymentParts) return parts.confirm(store,user,payload);
  const order = find(store, payload.orderId);
  const review = order.paymentReview;
  if (review.recipientId !== user.id) throw new c.HttpError(403, '必须由实际收款账户持有人本人确认；现金须老板核对');
  if (!['待老板核对','待收款人确认','有异议'].includes(review.status))
    throw new c.HttpError(409, '此单已经核对');
  const amount = c.money(payload.actualAmount, '实际到账金额');
  if (amount !== review.amount) throw new c.HttpError(409, '金额有差异，请登记异议，不可按全额确认');
  const cash = order.paymentMethod === '现金';
  const reference = String(payload.reference || '').trim().slice(0, 100);
  if (!cash && review.accountOwnerUnspecified) throw new c.HttpError(409, '请先由老板指定实际收款账户持有人');
  if (!cash && !reference) throw new c.HttpError(400, '请填写实际到账凭证或流水号');
  if (reference && store.receipts.some((row) => row.reference === reference))
    throw new c.HttpError(409, '该到账流水号已登记');
  if (!cash || !store.receipts.some((row) => row.kind === 'sale' && row.sourceId === order.id)) {
    received(store, user, order, amount, reference);
    order.receivedAmount = c.round((order.paymentCredit || 0) + amount);
  }
  review.status = cash ? '已核对' : '已确认到账';
  review.confirmedBy = user.id; review.confirmedAt = c.now();
  review.reference = reference;
  review.events.push({type: review.status, by: user.id, at: review.confirmedAt, amount, reference});
  c.audit(store, user, 'sale:payment-confirm', order.id + ' · ' + amount);
  return {orderId: order.id, status: review.status};
}
function declareCash(store, user, payload) {
  if (store.sales.find(row=>row.id===payload.orderId)?.paymentParts) return parts.declareCash(store,user,payload);
  const order = find(store, payload.orderId);
  if (order.operatorId !== user.id) throw new c.HttpError(403, '只有原开单人能补充现金声明');
  if (order.paymentMethod !== '现金') throw new c.HttpError(400, '此单不是现金收款');
  const review = order.paymentReview;
  if (review.status === '已核对') throw new c.HttpError(409, '老板已核对，请申请留痕更正');
  const declaration = String(payload.declaration || '');
  if (!['drawer','not_received','uncertain'].includes(declaration)) throw new c.HttpError(400, '请选择现金实际情况');
  const note = String(payload.note || '').trim().slice(0,500);
  if (declaration === 'not_received' && !note) throw new c.HttpError(400, '未收到现金请填写说明');
  const alreadyRecorded = store.receipts.some((row) => row.kind === 'sale' && row.sourceId === order.id);
  review.cashDrawerConfirmed = declaration === 'drawer'; review.cashDeclaration = declaration;
  review.cashDeclarationNote = note; review.declaredAt = c.now();
  if (declaration === 'drawer' && !alreadyRecorded) {received(store,user,order,review.amount); order.receivedAmount = c.round((order.paymentCredit || 0) + review.amount);}
  if (declaration === 'not_received' || (alreadyRecorded && declaration !== 'drawer')) {review.status = '有异议'; review.disputeReason = note || '原现金声明已撤回，待老板核对';}
  review.events.push({type:'开单人补充现金声明',by:user.id,at:review.declaredAt,declaration,note});
  c.audit(store,user,'sale:cash-declare',order.id+' · '+declaration);
  return {orderId:order.id,status:review.status,declaration};
}
function assign(store, user, payload) {
  if (store.sales.find(row=>row.id===payload.orderId)?.paymentParts) return parts.assign(store,user,payload);
  c.permit(user, 'manageUsers');
  const order = find(store, payload.orderId);
  const review = order.paymentReview;
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
  if (review.recipientId !== user.id) throw new c.HttpError(403, '只有指定收款人或老板可以提出异议');
  if (!['待老板核对','待收款人确认','有异议'].includes(review.status))
    throw new c.HttpError(409, '此单已经核对');
  const reason = c.text(payload.reason, '差异说明').slice(0, 500);
  const actual = payload.actualAmount == null || payload.actualAmount === '' ? null : c.money(payload.actualAmount, '实际金额');
  review.status = '有异议'; review.disputeReason = reason; review.disputedAt = c.now(); review.actualAmount = actual;
  review.events.push({type: '有异议', by: user.id, at: review.disputedAt, actualAmount: actual, reason});
  c.audit(store, user, 'sale:payment-dispute', order.id + ' · ' + reason);
  return {orderId: order.id, status: review.status};
}
module.exports = {init, list, confirm, dispute, assign, declareCash};
