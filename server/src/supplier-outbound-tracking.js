'use strict';
const c = require('./common');
const details = require('./inventory-details');
const fifo = require('./fifo-costs');
const costs = require('./supplier-costs');
const suppliers = require('./suppliers');
const accounts = require('./payment-accounts');
const ownership = require('./account-ownership');
const warehouses = require('./warehouses');
const rules = require('./supplier-outbound-core.cjs');

const fail = (code, message) => { throw new c.HttpError(code, message); };
const text = (value, label, max) => { const result = c.text(value, label); if (result.length > max) fail(400, `${label}不能超过${max}字`); return result; };
const cents = (value, label) => { try { return rules.toCents(value, label); } catch (error) { fail(400, error.message); } };
const amount = value => value / 100;
const owner = user => { c.permit(user, 'manageUsers'); if (user.roleCode !== 'owner') fail(403, '这一步由老板本人办理'); };
const records = store => (store.supplierOutboundTransfers ||= []);
const get = (store, id) => { const row = records(store).find(x => x.id === id); if (!row) fail(404, '供货商调货原单不存在'); return row; };
const canRead = (user, row) => user.roleCode === 'owner' || row.applicantId === user.id || c.capabilities(user).supplierView;
const event = (row, user, type, extra = {}) => row.events.push({ type, at: c.now(), by: user.id, name: user.name, ...extra });
const number = row => { try { return rules.compute(row); } catch (error) { fail(409, error.message); } };

function options(store, user) {
  c.permit(user, 'purchase');
  return { suppliers: (store.suppliers || []).filter(x => x.active !== false).map(x => ({ id: x.id, name: x.name })), products: (store.products || []).filter(x => x.stockManaged !== false && x.active !== false).map(p => ({ skuId: p.skuId, name: p.name, type: p.type, subType: p.subType, thirdType: p.thirdType, trackSerial: details.tracked(p), stocks: (store.inventory || []).filter(s => s.skuId === p.skuId).map(s => ({ warehouseId: s.warehouseId, warehouseName: s.warehouseName, quantity: s.quantity, serials: details.tracked(p) ? (s.serials || []).filter(details.inStock).map(x => x.no) : [] })) })) };
}

function create(store, user, payload) {
  c.permit(user, 'purchase');
  const supplier = suppliers.get(store, text(payload.supplierId, '供货商', 100));
  const receivingStore = text(payload.receivingStore, '实际接收门店', 100);
  const agreement = text(payload.agreement, '约定备注', 1000);
  let lines; try { lines = rules.linesFromCatalog(payload.items, store.products || [], store.inventory || []); } catch (error) { fail(409, error.message); }
  if (!lines.every(line => warehouses.byId(line.warehouseId)?.active !== false)) fail(409, '调出仓库已停用');
  if (lines.some(line => (store.products || []).find(p => p.skuId === line.skuId) && details.tracked(store.products.find(p => p.skuId === line.skuId)) !== rules.isTracked(store.products.find(p => p.skuId === line.skuId)))) fail(409, '商品串号属性需要核对');
  const at = c.now();
  const row = { id: c.id('SOT'), title: '供货商调货跟踪', status: '待老板批准', supplierId: supplier.id, supplierName: supplier.name, receivingStore, agreement, confirmedDueAt: null, dueConfirmedBy: null, lines, applicantId: user.id, applicantName: user.name, appliedAt: at, deliveredAt: null, cashReceipts: [], goodsReceipts: [], events: [{ type: '申请提交', at, by: user.id, name: user.name }] };
  records(store).unshift(row);
  c.audit(store, user, 'supplier-outbound:apply', row.id);
  return project(row);
}

function project(row) {
  const balance = number(row);
  return { ...structuredClone(row), balance, urgency: rules.urgency(row), href: `/supplier-outbound-tracking?id=${encodeURIComponent(row.id)}` };
}
function list(store, user, query) {
  c.permit(user, 'purchase');
  const id = String(query?.get?.('id') || '');
  const rows = records(store).filter(row => canRead(user, row) && (!id || row.id === id)).map(project);
  return { rows, canReview: user.roleCode === 'owner', canVerifyMoney: c.capabilities(user).paymentRegister };
}

function review(store, user, payload) {
  owner(user); const row = get(store, payload.id);
  if (row.status !== '待老板批准') fail(409, '本单已处理，不能重复批准');
  const approved = payload.approved === true;
  const note = String(payload.note || '').trim().slice(0, 500);
  row.status = approved ? '已批准待交货' : '已驳回'; row.reviewedAt = c.now(); row.reviewerId = user.id;
  event(row, user, approved ? '老板批准' : '老板驳回', { note });
  c.audit(store, user, 'supplier-outbound:review', { id: row.id, approved }); return project(row);
}

function confirmDue(store, user, payload) {
  const row = get(store, payload.id);
  if (!canRead(user, row)) fail(403, '无权核对本单约定时间');
  if (row.status === '已驳回' || row.status === '已闭合') fail(409, '本单不能再修改跟踪时间');
  const dueAt = text(payload.dueAt, '经核对的约定时间', 40);
  const instant = Date.parse(dueAt);
  if (!Number.isFinite(instant) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(dueAt)) fail(400, '请输入明确年月日和时间；备注不明确时先向供货商确认');
  const evidence = text(payload.agreementQuote, '备注中的约定原话或再次确认内容', 300);
  row.confirmedDueAt = new Date(instant).toISOString(); row.dueConfirmedBy = user.id; row.dueEvidence = evidence;
  event(row, user, '跟踪时间已核对', { dueAt: row.confirmedDueAt, evidence });
  c.audit(store, user, 'supplier-outbound:due', row.id); return project(row);
}

function handoff(store, user, payload) {
  c.permit(user, 'purchase'); const row = get(store, payload.id);
  if (row.status !== '已批准待交货') fail(409, '须先由老板批准；已交货不能重复出库');
  if (user.roleCode !== 'owner' && row.applicantId !== user.id) fail(403, '只能由经办人或老板确认实际交货');
  if (payload.actualHandoff !== true) fail(400, '请确认商品已实际交给供货商或指定接收人');
  const receiver = text(payload.receiver, '实际接收人', 100), proof = text(payload.proof, '交货凭证或交接记录', 300);
  // The signed original lines are rechecked against live inventory in this transaction.
  try { rules.linesFromCatalog(row.lines.map(x => ({ ...x, agreedUnitPrice: amount(x.unitPriceCents) })), store.products || [], store.inventory || []); } catch (error) { fail(409, error.message); }
  const at = c.now();
  for (const line of row.lines) {
    const product = store.products.find(p => p.skuId === line.skuId), stock = store.inventory.find(s => s.skuId === line.skuId && s.warehouseId === line.warehouseId);
    if (!product || !stock || product.active === false || stock.quantity < line.quantity) fail(409, `${line.productName} 当前库存不足或档案已停用`);
    const beforeQuantity = stock.quantity, beforeValue = stock.stockValue;
    let cost, costSources = [];
    if (details.tracked(product)) {
      const serials = line.serialNos.map(no => stock.serials?.find(x => x.no === no && details.inStock(x)));
      if (serials.some(x => !x) || new Set(line.serialNos).size !== serials.length) fail(409, `${line.productName} 串号已不在库`);
      cost = c.round(serials.reduce((n, x) => n + Number(x.costPrice), 0));
      for (const serial of serials) { serial.status = '已调出'; serial.supplierOutboundId = row.id; }
    } else {
      costSources = costs.take(stock, line.quantity);
      cost = fifo.enabled(stock) ? fifo.total(costSources) : line.quantity === beforeQuantity ? beforeValue : c.round(beforeValue * line.quantity / beforeQuantity);
    }
    if (!Number.isFinite(cost) || cost < 0 || cost > beforeValue) fail(409, `${line.productName} 库存成本异常`);
    stock.quantity -= line.quantity; stock.stockValue = c.round(beforeValue - cost); stock.costPrice = stock.quantity ? Number((stock.stockValue / stock.quantity).toFixed(6)) : 0;
    line.actualCost = cost; line.costSources = costSources; line.deliveredAt = at;
    store.movements.unshift({ id: c.id('MV'), skuId: product.skuId, product: product.name, warehouseId: stock.warehouseId, warehouseName: stock.warehouseName, quantity: -line.quantity, cost: -cost, type: '供货商外调出库', sourceId: row.id, supplierOutboundId: row.id, operatorId: user.id, operator: user.name, createdAt: at });
  }
  row.status = '已交货待结'; row.deliveredAt = at; row.deliveredBy = user.id; row.receiver = receiver; row.handoffProof = proof;
  event(row, user, '实际交货并出库', { receiver, proof }); c.audit(store, user, 'supplier-outbound:handoff', row.id); return project(row);
}

function receiveCash(store, user, payload) {
  c.permit(user, 'paymentRegister'); const row = get(store, payload.id);
  if (row.status !== '已交货待结' || payload.actualReceived !== true) fail(409, '必须先实际交货并核实真实到账');
  const valueCents = cents(payload.amount, '实收金额');
  try { rules.settlement(row, 'cash', valueCents); } catch (error) { fail(409, error.message); }
  const account = accounts.resolve(store, { paymentAccountId: text(payload.paymentAccountId, '实际收款账户', 100) });
  if (!ownership.isStoreAccount(store, account) || !ownership.canVerify(store, user, account)) fail(403, '请由实际账户核实人确认门店账户到账');
  const reference = text(payload.reference, '到账流水号', 100);
  accounts.reference(store, reference);
  const part = { id: c.id('PP'), ...account, amount: amount(valueCents), reference };
  const receipt = accounts.record(store, user, 'supplier_outbound_receipt', row.id, [part], 1, { supplierId: row.supplierId, supplierOutboundId: row.id, counterpartyNameSnapshot: row.supplierName })[0];
  const at=c.now();
  (store.moneyVerifications||=[]).push({id:'MVF-'+receipt.id,receiptId:receipt.id,accountOwnerId:'',accountScope:'store',reportedAmount:amount(valueCents),verifiedAmount:amount(valueCents),status:'verified',version:1,updatedAt:at,events:[{by:user.id,name:user.name,at,decision:'verify',verifiedAmount:amount(valueCents),evidence:reference,note:'供货商调货跟踪原单核实实际到账',verificationScope:'store',verifierId:user.id,method:'经当前有权核实门店账户的账号手工核对，非银行自动验证'}]});
  row.cashReceipts.push({ id: c.id('SOCR'), valueCents, receiptId: receipt.id, accountId: account.paymentAccountId || account.id, reference, at, verifiedBy: user.id });
  event(row, user, '实收款已核实', { valueCents, receiptId: receipt.id, reference });
  if (number(row).balanceCents === 0) { row.status = '已闭合'; row.closedAt = c.now(); event(row, user, '本单收钱或换货已核清'); }
  c.audit(store, user, 'supplier-outbound:cash', row.id); return project(row);
}

function receiveGoods(store, user, payload) {
  c.permit(user, 'purchase'); const row = get(store, payload.id);
  if (row.status !== '已交货待结' || payload.actualReceived !== true) fail(409, '须先实际交货并验收到店实物');
  if (user.roleCode !== 'owner' && row.applicantId !== user.id) fail(403, '仅本单经办人或老板可登记换回实物');
  const proof = text(payload.proof, '收货验收凭证', 300);
  const inputs = payload.items;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) fail(400, '请填写一至一百行实际验收商品');
  const receiptId = c.id('SOGR'), at = c.now(), seen = new Set();
  const prepared = inputs.map((input, index) => {
    const p = (store.products || []).find(x => x.skuId === input.skuId && x.stockManaged !== false && x.active !== false);
    if (!p) fail(409, `第${index + 1}行不是当前在用库存商品`);
    const warehouse = warehouses.byId(input.warehouseId);
    if (!warehouse || warehouse.active === false) fail(409, `第${index + 1}行仓库不存在或停用`);
    const matches = (store.inventory || []).filter(x => x.skuId === p.skuId && x.warehouseId === warehouse.id);
    if (matches.length > 1) fail(409, `第${index + 1}行库存档案重复`);
    const quantity = c.quantity(input.quantity), unitCents = cents(input.agreedUnitPrice, '换回货约定单价');
    if (unitCents < 1 || !Number.isSafeInteger(quantity * unitCents)) fail(400, `第${index + 1}行金额不正确`);
    const serialNos = input.serialNos || [];
    if (details.tracked(p)) {
      if (!Array.isArray(serialNos) || serialNos.length !== quantity || quantity > 200) fail(409, `第${index + 1}行须逐台填写完整串号`);
      for (const no of serialNos) {
        if (typeof no !== 'string' || !/^[a-z0-9-]{5,40}$/i.test(no) || seen.has(no)) fail(409, `第${index + 1}行串号不完整或重复`);
        seen.add(no);
        const all = (store.inventory || []).flatMap(s => (s.serials || []).filter(x => x.no === no));
        if (all.length && !(all.length === 1 && all[0].status === '已调出' && all[0].supplierOutboundId === row.id && matches[0]?.serials?.includes(all[0]))) fail(409, `第${index + 1}行串号已登记在其他商品或未从本单调出`);
      }
    } else if (serialNos.length) fail(400, `第${index + 1}行数量商品不能填串号`);
    return { id: c.id('SOGI'), skuId: p.skuId, productName: p.name, warehouseId: warehouse.id, warehouseName: warehouse.name, quantity, unitPriceCents: unitCents, valueCents: quantity * unitCents, serialNos: [...serialNos] };
  });
  const valueCents = prepared.reduce((n, x) => n + x.valueCents, 0);
  if (!Number.isSafeInteger(valueCents) || valueCents < 1) fail(400, '换回货金额不正确');
  const outstanding = number(row).balanceCents;
  const offsetCents = Math.min(valueCents, outstanding), extraPayableCents = valueCents - offsetCents;
  for (const line of prepared) {
    const p = store.products.find(x => x.skuId === line.skuId);
    let stock = store.inventory.find(x => x.skuId === p.skuId && x.warehouseId === line.warehouseId);
    if (!stock) { stock = { skuId: p.skuId, warehouseId: line.warehouseId, warehouseName: line.warehouseName, quantity: 0, stockValue: 0, costPrice: 0, serials: [] }; store.inventory.push(stock); }
    const unit = amount(line.unitPriceCents), value = amount(line.valueCents);
    if (details.tracked(p)) {
      for (const no of line.serialNos) {
        const existing = (stock.serials || []).find(s => s.no === no);
        if (existing) { existing.status = '可售'; existing.costPrice = unit; existing.returnedBySupplierOutboundId = row.id; existing.returnedAt = at; }
        else stock.serials.push({ no, status: '可售', costPrice: unit, sourceType: 'supplier_outbound_return', supplierOutboundId: row.id, supplierOutboundReceiptId: receiptId, supplierId: row.supplierId, receivedAt: at });
      }
    } else costs.receive(stock, line.id, line.quantity, unit, store);
    stock.quantity += line.quantity; stock.stockValue = c.round(stock.stockValue + value); stock.costPrice = Number((stock.stockValue / stock.quantity).toFixed(6));
    store.movements.unshift({ id: c.id('MV'), skuId: p.skuId, product: p.name, warehouseId: stock.warehouseId, warehouseName: stock.warehouseName, quantity: line.quantity, cost: value, type: '供货商调货换回入库', sourceId: row.id, supplierOutboundId: row.id, supplierOutboundReceiptId: receiptId, operatorId: user.id, operator: user.name, createdAt: at });
  }
  const receipt = { id: receiptId, items: prepared, valueCents, offsetCents, extraPayableCents, proof, at, receivedBy: user.id };
  if (extraPayableCents) {
    const payable = suppliers.entry(store, { kind: 'payable', cents: extraPayableCents, supplierId: row.supplierId, sourceId: row.id, sourceType: 'supplier_outbound_goods_extra', title: '调货换回货差额待付', ...suppliers.stamp(user) });
    receipt.extraPayableEntryId = payable.id;
  }
  row.goodsReceipts.push(receipt);
  event(row, user, '换回货已验收入库', { receiptId, valueCents, offsetCents, extraPayableCents, proof });
  if (number(row).balanceCents === 0) { row.status = extraPayableCents ? '已闭合，差额待付' : '已闭合'; row.closedAt = at; event(row, user, '本单收钱或换货已核清', { extraPayableCents }); }
  c.audit(store, user, 'supplier-outbound:goods', row.id); return project(row);
}

function followup(store, user, payload) {
  const row = get(store, payload.id); if (!canRead(user, row)) fail(403, '无权跟进本单');
  if (row.status !== '已交货待结') fail(409, '仅未闭合调货单可跟进');
  const note = text(payload.note, '本次联系结果', 500);
  event(row, user, '跟进供货商', { note }); row.lastFollowupAt = c.now();
  c.audit(store, user, 'supplier-outbound:followup', row.id); return project(row);
}

module.exports = { options, create, list, review, confirmDue, handoff, receiveCash, receiveGoods, followup, project };
