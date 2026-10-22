"use strict";
const { createHash } = require("node:crypto");
const c = require("./common"), costs = require("./supplier-costs"), suppliers = require("./suppliers");
const TYPE = "purchase_price_correction", PENDING = "待老板审核";
function owner(store, user) {
  try { return require("./sale-return-requests").assertOwner(store, user); }
  catch (error) { if (error.statusCode === 403) throw new c.HttpError(403, "只有老板本人可以更正进货价"); throw error; }
}
function currentUnitPrice(store, purchaseId, itemId) {
  const line = (store.purchases || []).find(p => p.id === purchaseId)?.items?.find(i => i.id === itemId);
  if (!line) throw new c.HttpError(404, "原采购明细不存在");
  return c.round(c.money(line.costPrice, "原入库单价") + (store.supplierAdjustments || []).filter(a => a.type === TYPE && a.purchaseId === purchaseId && a.itemId === itemId).reduce((n, a) => n + Number(a.unitDelta), 0));
}
function source(store, payload) {
  const purchaseId = c.text(payload.purchaseId, "原入库单"), itemId = c.text(payload.itemId, "原入库明细");
  const order = (store.purchases || []).find(p => p.id === purchaseId && p.supplierId === payload.supplierId), line = order?.items?.find(i => i.id === itemId);
  if (!order || !line) throw new c.HttpError(404, "原采购明细不存在或不属于该往来单位");
  if (order.redOf || order.redReversedBy || ["已红冲", "已退货", "returned", "reversed"].includes(order.status)) throw new c.HttpError(409, "该入库单已经退货或红冲，须先核实原单");
  if ((store.purchaseReturns || []).some(r => r.purchaseId === order.id)) throw new c.HttpError(409, "该入库单已发生采购退货，暂不能自动更正原价");
  if ((store.purchaseReturnRequests || []).some(r => r.purchaseId === order.id && r.status === PENDING) || (store.redReversals || []).some(r => (r.sourceId || r.expenseId) === order.id && r.status === PENDING)) throw new c.HttpError(409, "该入库单有待审核退货或红冲申请，请先处理申请");
  const product = (store.products || []).find(p => p.skuId === line.skuId), stock = (store.inventory || []).find(s => s.skuId === line.skuId && (s.warehouseId || "wh-sale") === (product?.warehouseId || "wh-sale"));
  if (!product || !stock) throw new c.HttpError(409, "原入库商品或库存资料不完整");
  const due = (store.supplierEntries || []).find(e => e.id === order.supplierEntryId && e.supplierId === order.supplierId && e.kind === "payable" && e.sourceType === "purchase" && e.sourceId === order.id);
  if (!due) throw new c.HttpError(409, "原采购应付记录不完整，须先核对往来账");
  c.quantity(line.quantity);
  return { order, line, product, stock, due };
}
function batchGift(store, line) {
  return (store.sales || []).some(s => (s.giftOrders || []).some(g => (g.items || []).some(i => i.skuId === line.skuId && ((i.serialNo && (line.serials || []).includes(i.serialNo)) || (i.costSources || []).some(p => p.sourceId === line.id)))));
}
function affectedBusiness(store, order, line, targets) {
  if (batchGift(store, line)) throw new c.HttpError(409, "该原批次已作赠品出库，须人工核实赠品成本，暂不能自动更正");
  const saleIds = new Set(targets.filter(t => t.destination === "sale").map(t => t.orderId));
  if (targets.some(t => t.materialIndex != null)) throw new c.HttpError(409, "该原批次已作维修耗材等复杂出库，须人工核实成本来源");
  if ((store.saleReturnRequests || []).some(r => saleIds.has(r.orderId) && r.status === PENDING) || (store.redReversals || []).some(r => saleIds.has(r.sourceId || r.expenseId) && r.status === PENDING)) throw new c.HttpError(409, "受影响销售单有待审核退换货或红冲申请，请先处理申请");
  if ((store.giftApprovals || []).some(r => r.status === "待审批" && (saleIds.has(r.orderId) || (r.items || []).some(i => i.skuId === line.skuId)))) throw new c.HttpError(409, "相关商品或销售单有待审批赠品，请先处理赠品申请");
  if ((store.sales || []).some(s => saleIds.has(s.id) && (s.redOf || s.redReversedBy || ["returned", "已红冲"].includes(s.status)))) throw new c.HttpError(409, "受影响销售单已退货或红冲，须先核实原单成本来源");
}
function dateOf(row) { return row.date || (row.createdAt ? c.day(row.createdAt) : c.day()); }
function lockedDates(store, order, targets) {
  const days = new Set([dateOf(order), c.day()]);
  for (const t of targets.filter(t => t.destination === "sale")) { const sale = (store.sales || []).find(s => s.id === t.orderId); if (!sale) throw new c.HttpError(409, "相关销售单缺失，须核实成本来源"); days.add(dateOf(sale)); }
  const state = [...days].sort().map(date => ({ date, closeouts: (store.dailyCloseouts || []).filter(d => d.date === date) }));
  if (state.some(d => d.closeouts.some(r => r.status === "已锁定"))) throw new c.HttpError(409, "相关营业日已锁定，须先完成日结更正流程");
  return state;
}
function ownAdjustment(store, order, entry) {
  return (store.supplierAdjustments || []).find(a => a.type === TYPE && a.purchaseId === order.id && a.supplierId === order.supplierId && a.entryId === entry.id && a.id === entry.sourceId && a.kind === entry.kind);
}
function payableEntries(store, order) {
  const ids = new Set((store.supplierAdjustments || []).filter(a => a.type === TYPE && a.purchaseId === order.id && a.kind === "payable").map(a => a.entryId));
  return (store.supplierEntries || []).filter(e => e.supplierId === order.supplierId && e.kind === "payable" && (e.id === order.supplierEntryId || ids.has(e.id))).sort((a, b) => a.id === order.supplierEntryId ? -1 : b.id === order.supplierEntryId ? 1 : String(a.createdAt).localeCompare(String(b.createdAt)));
}
function remaining(store, row) {
  const active = (store.supplierSettlements || []).filter(s => !s.reversedAt && (s.sourceId === row.id || s.targetId === row.id));
  if (!Number.isSafeInteger(row.cents) || row.cents < 0 || active.some(s => s.supplierId !== row.supplierId || !Number.isSafeInteger(s.cents) || s.cents <= 0)) throw new c.HttpError(409, "原采购往来余额异常，须先核对往来账");
  const value = row.cents - active.reduce((n, s) => n + s.cents, 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new c.HttpError(409, "原采购往来余额异常，须先核对往来账");
  return value;
}
function linked(adjustment, settlement) { return !!adjustment && (adjustment.settlementIds || [adjustment.settlementId]).includes(settlement.id); }
function internalOffset(store, order, settlement, from, payableIds) {
  if (!from || from.kind !== "cash" || from.sourceType !== TYPE || settlement.type !== TYPE || settlement.automatic !== true || !payableIds.has(settlement.targetId)) return false;
  const original = ownAdjustment(store, order, from), to = (store.supplierEntries || []).find(e => e.id === settlement.targetId);
  if (!original || !to || to.supplierId !== order.supplierId || to.kind !== "payable") return false;
  const targetCorrection = ownAdjustment(store, order, to);
  // Downward offsets are linked by their source correction; upward offsets by
  // the new target correction. Historical corrections are never rewritten.
  return linked(original, settlement) || linked(targetCorrection, settlement);
}
function reliableCash(store,entry,type,settlement){
 const cash=(store.supplierCash||[]).find(r=>r.supplierId===entry.supplierId&&r.type===type&&(type==='payment'?r.id===entry.sourceId&&r.sourceId===entry.id:r.id===settlement.cashId&&r.sourceId===entry.id));
 if(!cash||suppliers.cents(cash.amount)!==(type==='payment'?entry.cents:settlement.cents))return false;
 const receipts=(store.receipts||[]).filter(r=>r.sourceId===cash.id&&r.kind===(type==='payment'?'supplier_payment':'supplier_refund')&&r.supplierId===entry.supplierId),sign=type==='payment'?-1:1;
 if(!cash.paymentParts)return receipts.length===1&&c.round(receipts[0].amount)===sign*c.round(cash.amount);
 const parts=cash.paymentParts,ids=new Set(parts.map(p=>p.id));if(!parts.length||ids.size!==parts.length||receipts.length!==parts.length)return false;
 let sum=0;for(const part of parts){const matched=receipts.filter(r=>r.partId===part.id);if(matched.length!==1)return false;const r=matched[0];if(c.round(r.amount)!==sign*c.round(part.amount)||['account','paymentAccountId','accountName','accountOwnerId'].some(key=>(r[key]||'')!==(part[key]||'')))return false;sum+=suppliers.cents(part.amount);}
 return sum===suppliers.cents(cash.amount);
}
function settlementState(store, order) {
  const payable = payableEntries(store, order), ids = new Set(payable.map(e => e.id));
  const previousRefunds = (store.supplierEntries || []).filter(e => e.supplierId === order.supplierId && e.kind === "cash" && e.sourceType === TYPE && ownAdjustment(store, order, e));
  for (const e of [...payable, ...previousRefunds]) remaining(store, e);
  for (const s of (store.supplierSettlements || []).filter(s => !s.reversedAt && ids.has(s.targetId))) {
    const from = (store.supplierEntries || []).find(e => e.id === s.sourceId);
    if (!from || from.supplierId !== order.supplierId) throw new c.HttpError(409, "原采购核销来源不完整，暂不能自动更正");
    remaining(store, from);
    if (internalOffset(store, order, s, from, ids)) continue;
    if (from.kind !== "advance" || from.sourceType !== "payment" || !reliableCash(store, from, "payment", s)) throw new c.HttpError(409, "原采购含仅抵货款或非现金核销，须人工核对，不能自动转成应退现金");
  }
  for (const from of previousRefunds) for (const s of (store.supplierSettlements || []).filter(s => !s.reversedAt && s.sourceId === from.id)) {
    if (internalOffset(store, order, s, from, ids)) continue;
    if (s.type !== "refund" || s.targetId != null || !reliableCash(store, from, "refund", s)) throw new c.HttpError(409, "历史更正权益核销来源不完整，须先核对实际退款");
  }
  return { payable: payable.map(e => ({ id: e.id, remainingCents: remaining(store, e) })), previousRefunds: previousRefunds.map(e => ({ id: e.id, remainingCents: remaining(store, e) })) };
}
function fingerprint(store, order, stock, targets, dateState) {
  const saleIds = new Set(targets.filter(t => t.destination === "sale").map(t => t.orderId));
  const body = { order, stock, dates: dateState, sales: (store.sales || []).filter(s => saleIds.has(s.id)), adjustments: (store.supplierAdjustments || []).filter(a => a.purchaseId === order.id), costAdjustments: (store.costAdjustments || []).filter(a => a.skuId === stock.skuId || saleIds.has(a.orderId)), entries: (store.supplierEntries || []).filter(e => e.supplierId === order.supplierId), settlements: (store.supplierSettlements || []).filter(s => s.supplierId === order.supplierId), cash: (store.supplierCash || []).filter(r => r.supplierId === order.supplierId), receipts: (store.receipts || []).filter(r => r.supplierId === order.supplierId), purchaseRequests: (store.purchaseReturnRequests || []).filter(r => r.purchaseId === order.id), saleRequests: (store.saleReturnRequests || []).filter(r => saleIds.has(r.orderId)), redRequests: (store.redReversals || []).filter(r => r.sourceId === order.id || saleIds.has(r.sourceId || r.expenseId)), giftRequests: (store.giftApprovals || []).filter(r => saleIds.has(r.orderId) || (r.items || []).some(i => i.skuId === stock.skuId)) };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
function preview(store, user, payload) {
  const actor = owner(store, user), view = structuredClone(store), { order, line, stock } = source(view, payload);
  const reference = c.text(payload.reference, "更正编号"), reason = c.text(payload.reason || payload.note, "录错更正依据");
  if (reference.length > 120 || reason.length < 4 || reason.length > 500) throw new c.HttpError(400, "更正编号最多120字，依据须为4至500字");
  if ((view.supplierAdjustments || []).some(a => a.supplierId === order.supplierId && a.reference === reference)) throw new c.HttpError(409, "该更正或补差编号已登记，请核对原记录");
  const originalUnitPrice = c.money(line.costPrice, "原入库单价"), currentRecordedPrice = currentUnitPrice(view, order.id, line.id), correctedUnitPrice = c.money(payload.newUnitPrice, "正确入库单价"), unitDelta = c.round(correctedUnitPrice - currentRecordedPrice);
  if (!unitDelta) throw new c.HttpError(400, "正确单价与当前记录价相同，无需更正");
  const { payable, previousRefunds } = settlementState(view, order);
  affectedBusiness(view, order, line, []);
  // Reuse only the allocation preview, on a clone. Earlier corrections become
  // price adjustments in this temporary view so conservative checks see them.
  for (const a of view.supplierAdjustments || []) if (a.type === TYPE) { a.type = "price"; a.direction = a.unitDelta < 0 ? "decrease" : "increase"; a.unitAmount = Math.abs(a.unitDelta); a.scope = "all"; }
  const allocation = costs.preview(view, actor, { supplierId: order.supplierId, purchaseId: order.id, itemId: line.id, reference, note: reason, scope: "all", direction: unitDelta < 0 ? "decrease" : "increase", unitAmount: Math.abs(unitDelta), kind: "cash" });
  affectedBusiness(store, order, line, allocation.targets);
  const dateState = lockedDates(store, order, allocation.targets), priceDelta = c.round(unitDelta * line.quantity);
  if (Math.abs(allocation.quantity - line.quantity) > 1e-7 || c.round(allocation.inventoryDelta + allocation.salesDelta) !== priceDelta) throw new c.HttpError(409, "原批次成本无法完整追溯，暂不能自动更正");
  const offsetAmount = priceDelta < 0 ? c.round(Math.min(-priceDelta, payable.reduce((n, e) => n + e.remainingCents, 0) / 100)) : 0;
  const offsetPreviousRefundAmount = priceDelta > 0 ? c.round(Math.min(priceDelta, previousRefunds.reduce((n, e) => n + e.remainingCents, 0) / 100)) : 0;
  const refundDue = priceDelta < 0 ? c.round(-priceDelta - offsetAmount) : 0;
  const result = { supplierId: order.supplierId, purchaseId: order.id, itemId: line.id, skuId: line.skuId, name: line.name, quantity: line.quantity, reference, reason, note: reason, originalUnitPrice, currentRecordedPrice, correctedUnitPrice, unitDelta, priceDelta, amount: Math.abs(priceDelta), kind: unitDelta < 0 ? "cash" : "payable", inventoryDelta: allocation.inventoryDelta, salesDelta: allocation.salesDelta, profitDelta: -allocation.salesDelta, targets: allocation.targets, offsetAmount, refundDue, payable, previousRefunds, affectedDates: dateState.map(d => d.date), message: "更正只登记差额与依据，保留原入库和销售记录；不登记实际付款或退款，不自动修改已确认或已发工资。", payableDecrease: offsetAmount, cashReceivableIncrease: refundDue, grossPayableIncrease: priceDelta > 0 ? priceDelta : 0, offsetPreviousRefundAmount, payableIncrease: priceDelta > 0 ? c.round(priceDelta - offsetPreviousRefundAmount) : 0, cashReceivableDecrease: offsetPreviousRefundAmount };
  result.accountingNote = priceDelta > 0 ? `追加应付 ${priceDelta} 元，自动抵同原采购未退的历史更正权益 ${offsetPreviousRefundAmount} 元，净增应付 ${result.payableIncrease} 元；不登记实际付款，已到账退款不撤回。` : `自动抵减原采购及其历次更正未付货款 ${offsetAmount} 元；剩余应退 ${refundDue} 元，实际退款另行登记。`;
  result.previewToken = createHash("sha256").update(JSON.stringify({ result, allocationToken: allocation.previewToken, state: fingerprint(store, order, stock, allocation.targets, dateState) })).digest("hex");
  return result;
}
function automaticOffset(store, actor, row, sourceId, targetId, n) {
  if (n <= 0) return;
  const settlement = { id: c.id("SS"), supplierId: row.supplierId, sourceId, targetId, cents: n, type: TYPE, automatic: true, note: "入库进价录错更正自动抵减同一原采购往来", ...suppliers.stamp(actor) };
  store.supplierSettlements.push(settlement); row.settlementIds.push(settlement.id); row.settlementId ||= settlement.id;
}
function confirm(store, user, payload) {
  const actor = owner(store, user), result = preview(store, actor, payload);
  if (payload.previewToken !== result.previewToken) throw new c.HttpError(409, "库存、销售、往来余额或更正内容已变化，请重新预览");
  const { stock } = source(store, result), row = { ...result, id: c.id("PPC"), type: TYPE, ...suppliers.stamp(actor) };
  const e = suppliers.entry(store, { supplierId: row.supplierId, kind: row.kind, cents: suppliers.cents(row.amount), title: row.kind === "cash" ? "入库进价录错更正（减少）" : "入库进价录错更正（增加）", sourceType: TYPE, sourceId: row.id, purchaseId: row.purchaseId, note: row.reason, ...suppliers.stamp(actor) });
  row.entryId = e.id; row.settlementId = null; row.settlementIds = [];
  if (row.kind === "cash") {
    let left = suppliers.cents(row.offsetAmount);
    for (const due of row.payable) { const n = Math.min(left, due.remainingCents); automaticOffset(store, actor, row, e.id, due.id, n); left -= n; }
  } else {
    let left = suppliers.cents(row.offsetPreviousRefundAmount);
    for (const previous of row.previousRefunds) { const n = Math.min(left, previous.remainingCents); automaticOffset(store, actor, row, previous.id, e.id, n); left -= n; }
  }
  stock.stockValue = c.round(Number(stock.stockValue ?? stock.quantity * stock.costPrice) + row.inventoryDelta); stock.costPrice = stock.quantity ? Number((stock.stockValue / stock.quantity).toFixed(6)) : 0;
  for (const target of row.targets) { if (target.serialNo) { const serial = stock.serials.find(s => s.no === target.serialNo); serial.costPrice = c.round(serial.costPrice + target.costDelta); } store.costAdjustments.push({ id: c.id("CA"), kind: target.destination, sourceId: row.id, skuId: row.skuId, ...target, ...suppliers.stamp(actor) }); }
  if (row.inventoryDelta) store.movements.unshift({ id: c.id("MV"), skuId: row.skuId, product: row.name, quantity: 0, cost: row.inventoryDelta, type: "入库进价录错更正", warehouseId: stock.warehouseId || "wh-sale", warehouseName: stock.warehouseName || "销售仓", sourceId: row.id, ...suppliers.stamp(actor) });
  store.supplierAdjustments.push(row); c.audit(store, actor, "purchase:price-correction", `${row.id} · 原入库 ${row.purchaseId} · ${row.currentRecordedPrice} → ${row.correctedUnitPrice} · 差额 ${row.priceDelta} 元 · ${row.reason}`);
  return row;
}
module.exports = { preview, confirm, currentUnitPrice };
