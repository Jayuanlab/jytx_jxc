const c = require("./common");
const { createHash } = require("node:crypto");
const { notice } = require("./feishu-notices");

const METRICS = [
  ["cardNew", "新开卡", "笔"], ["cardReplace", "补卡", "笔"],
  ["rechargeCount", "话费充值", "笔"], ["rechargeAmount", "话费充值", "元"],
  ["fusionBroadband", "融合宽带", "笔"],
  ["packageUp", "套餐升档", "笔"], ["packageDown", "套餐降档", "笔"],
  ["deviceContract", "设备绑合约", "笔"],
  ["airOpening", "空充期初", "元"], ["airChange", "空充净变动", "元"], ["airClosing", "空充期末", "元"],
  ["commissionExpected", "新增预计酬金", "元"],
  ["commissionConfirmed", "移动确认酬金", "元"],
  ["commissionReceived", "酬金实际到账", "元"],
];
const round = c.round;
const sum = (rows, field) => round(rows.reduce((n, row) => n + Number(row[field] || 0), 0));
function active(store, id) { return store.users.find((u) => u.id === id && u.status === "active"); }
function sameDay(value, day) { return value && c.day(value) === day; }
function metricAuto(store, date) {
  const services = (store.carrierServices || []).filter((r) => r.serviceDate === date);
  const kinds = (type) => services.filter((r) => r.type === type);
  const typed = (rows, subtype) => rows.some((r) => !r.subType || r.subType === "unknown") ? null : rows.filter((r) => r.subType === subtype).length;
  const cards = kinds("card"), recharges = kinds("recharge"), broadband = kinds("broadband"), packages = kinds("package");
  const airCashSales = (store.airRechargeEvents||[]).filter((r)=>r.kind==="customer_recharge"&&r.businessDate===date&&!recharges.some((s)=>s.externalOrderNo===r.reference));
  const expected = round(services.reduce((n, r) => n + (r.schedule || []).reduce((m, p) => m + Number(p.expected || 0), 0), 0));
  const allParts = (store.carrierServices || []).flatMap((r) => r.schedule || []);
  const confirmed = round(allParts.filter((p) => sameDay(p.confirmedAt, date)).reduce((n, p) => n + Number(p.confirmed || 0), 0));
  const received = round(allParts.flatMap((p) => p.events || []).filter((e) => sameDay(e.createdAt, date)).reduce((n, e) => n + Number(e.amount || 0), 0));
  const air = (store.airRechargeEvents || []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const before = air.filter((e) => e.businessDate < date);
  const today = air.filter((e) => e.businessDate === date);
  const hasOpening = air.some((e) => e.kind === "opening" && e.businessDate <= date);
  const opening = hasOpening ? round(before.reduce((n, e) => n + Number(e.amount || 0), 0) + today.filter((e) => e.kind === "opening").reduce((n, e) => n + Number(e.amount || 0), 0)) : null;
  const change = hasOpening ? round(today.filter((e) => e.kind !== "opening").reduce((n, e) => n + Number(e.amount || 0), 0)) : null;
  return {
    cardNew: typed(cards, "new"), cardReplace: typed(cards, "replace"),
    rechargeCount: recharges.length + airCashSales.length,
    rechargeAmount: recharges.some((r) => r.transactionAmount == null) ? null : round(sum(recharges, "transactionAmount") + sum(airCashSales, "debitAmount")),
    fusionBroadband: typed(broadband, "fusion"),
    packageUp: typed(packages, "up"), packageDown: typed(packages, "down"),
    deviceContract: kinds("contract").length,
    airOpening: opening, airChange: change, airClosing: opening == null ? null : round(opening + change),
    commissionExpected: expected, commissionConfirmed: confirmed, commissionReceived: received,
  };
}
function mobileRows(store, date, manual = {}) {
  const auto = metricAuto(store, date);
  return METRICS.map(([key, label, unit]) => {
    const entered = manual[key] == null || manual[key] === "" ? null : Number(manual[key]);
    if (entered != null && (!Number.isFinite(entered) || (unit === "笔" && (!Number.isSafeInteger(entered) || entered < 0))))
      throw new c.HttpError(400, label + "的移动BOSS数字不正确");
    const value = entered == null ? null : round(entered);
    const own = auto[key];
    return { key, label, unit, own, boss: value, difference: own == null || value == null ? null : round(own - value),
      status: own == null ? "我方缺基础数据" : value == null ? "待抄录" : Math.abs(round(own - value)) > 0.0001 ? "有差异" : "一致" };
  });
}
function costEvents(store, date) {
  const adjustments = (store.costAdjustments || []).filter((row) => sameDay(row.createdAt, date));
  const corrections = (store.supplierAdjustments || []).filter((row) => row.type === "purchase_price_correction" && sameDay(row.createdAt, date));
  const correctionIds = new Set(corrections.map((row) => row.id));
  const entryIds = new Set(corrections.map((row) => row.entryId).filter(Boolean));
  const settlementIds = new Set(corrections.flatMap((row) => row.settlementIds || [row.settlementId]).filter(Boolean));
  const correctionEntries = (store.supplierEntries || []).filter((row) => entryIds.has(row.id) || (row.sourceType === "purchase_price_correction" && (correctionIds.has(row.sourceId) || sameDay(row.createdAt, date))));
  for (const row of correctionEntries) entryIds.add(row.id);
  const settlements = (store.supplierSettlements || []).filter((row) => settlementIds.has(row.id) || (sameDay(row.createdAt, date) && (entryIds.has(row.sourceId) || row.type === "purchase_price_correction")));
  const relatedEntryIds = new Set(entryIds);
  for (const row of settlements) { relatedEntryIds.add(row.sourceId); if (row.targetId) relatedEntryIds.add(row.targetId); }
  const entries = (store.supplierEntries || []).filter((row) => relatedEntryIds.has(row.id));
  // These are additional events, not a rewrite of the original purchase/sale day.
  return { adjustments, corrections, entries, settlements };
}
function costFingerprintExtension(store, date) {
  const events = costEvents(store, date);
  return Object.values(events).some((rows) => rows.length) ? ["cost-events-v1", events] : null;
}
function fingerprintSources(store, date) {
  const source = [
    store.sales.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.profit, (r.items || []).map((i) => [i.id, i.quantity, i.amount, i.cost, i.profit, i.serialNo])]),
    store.saleReturns.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.profit, (r.items || []).map((i) => [i.itemId, i.quantity, i.amount, i.cost, i.profit])]),
    store.purchases.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.supplierId, (r.items || []).map((i) => [i.skuId, i.quantity, i.cost, i.amount])]),
    store.movements.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.skuId, r.warehouseId, r.quantity, r.cost]),
    store.receipts.filter((r) => (r.transactionDate || c.day(r.createdAt)) === date).map((r) => [r.id,r.amount,r.account,r.kind,r.sourceId,...(r.partId||r.paymentAccountId?[r.partId||"",r.paymentAccountId||"",r.accountName||"",r.accountOwnerId||"",r.accountOwnerName||""]:[])]),
    (store.carrierServices || []).filter((r) => r.serviceDate === date).map((r) => [r.id, r.type, r.subType, r.transactionAmount]),
    (store.airRechargeEvents || []).filter((r) => r.businessDate === date).map((r) => [r.id, r.kind, r.amount]),
    (store.carrierServices || []).flatMap((r) => r.schedule || []).filter((p) => sameDay(p.confirmedAt, date)).map((p) => [p.month, p.confirmed, p.statementNo]),
    (store.carrierServices || []).flatMap((r) => r.schedule || []).flatMap((p) => p.events || []).filter((e) => sameDay(e.createdAt, date)).map((e) => [e.id, e.amount, e.bankRef]),
    (store.cashHandovers || []).filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.status, r.actualAmount, r.bankRef]),
  ];
  const extension = costFingerprintExtension(store, date);
  if (extension) source.push(extension);
  return source;
}
function fingerprintCore(store, date) {
  const source = fingerprintSources(store, date).slice(0, 5);
  const extension = costFingerprintExtension(store, date);
  if (extension) source.push(extension);
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}
function fingerprint(store, date) { return createHash("sha256").update(JSON.stringify(fingerprintSources(store, date))).digest("hex"); }
function cashHandoverTotals(store, date) {
  const rows = (store.cashHandovers || []).filter((r) => sameDay(r.createdAt, date));
  return { confirmed: round(rows.filter((r) => r.status === "已确认收到").reduce((n, r) => n + Number(r.amount || 0), 0)),
    pending: rows.filter((r) => r.status === "待接收人确认"),
    disputed: rows.filter((r) => r.status === "金额有异议") };
}
function snapshot(store, date = c.day()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > c.day()) throw new c.HttpError(400, "扎账日期不正确");
  const sales = store.sales.filter((r) => sameDay(r.createdAt, date));
  const returns = store.saleReturns.filter((r) => sameDay(r.createdAt, date));
  const purchases = store.purchases.filter((r) => sameDay(r.createdAt, date));
  const receipts = store.receipts.filter((r) => (r.transactionDate || c.day(r.createdAt)) === date);
  const movements = store.movements.filter((r) => sameDay(r.createdAt, date));
  const transactions = sales.flatMap((o) => (o.items || []).map((item) => ({
    orderId: o.id, at: o.createdAt, product: item.name, serialNo: item.serialNo || "",
    quantity: item.quantity, amount: item.amount, cost: item.cost, profit: item.profit,
    account: o.paymentMethod, operator: o.operator, salesperson: o.salesperson,
  })));
  const gifts = store.sales.flatMap((order) => (order.giftOrders || []).filter((gift) => sameDay(gift.createdAt, date)).map((gift) => ({ order, gift })));
  transactions.push(...gifts.flatMap(({order, gift}) => gift.items.map((item) => ({
    orderId: order.id, giftId: gift.id, at: gift.createdAt, product: "赠品 · " + item.name, serialNo: item.serialNo || "",
    quantity: item.quantity, amount: 0, cost: item.cost, profit: -item.cost,
    account: "无收款", operator: gift.operator, salesperson: order.salesperson,
  }))));
  const originalCost = round(transactions.reduce((n, row) => n + Number(row.cost || 0), 0) - sum(returns, "cost"));
  const originalGrossProfit = round(sum(sales, "profit") - sum(returns, "profit") - gifts.reduce((n, row) => n + Number(row.gift.cost || 0), 0));
  const events = costEvents(store, date);
  const saleById = new Map(store.sales.map((order) => [order.id, order]));
  const salesCostAdjustments = events.adjustments.filter((row) => row.orderId && saleById.has(row.orderId));
  const salesCostAdjustmentAmount = sum(salesCostAdjustments, "costDelta");
  const costAdjustmentProfit = round(-salesCostAdjustmentAmount);
  transactions.push(...salesCostAdjustments.map((row) => {
    const order = saleById.get(row.orderId), item = (order.items || []).find((part) => part.id === row.itemId);
    const correction = events.corrections.find((part) => part.id === row.sourceId);
    return { kind: "costadjust", costAdjustmentId: row.id, adjustmentSourceId: row.sourceId,
      orderId: row.orderId, itemId: row.itemId, at: row.createdAt,
      product: (correction ? "进货价录错更正 · " : "成本调整 · ") + (row.name || item?.name || row.skuId || "原销售商品"),
      serialNo: row.serialNo || "", quantity: 0, amount: 0, cost: Number(row.costDelta || 0), profit: round(-Number(row.costDelta || 0)),
      account: "无收付款", operator: row.operator || "", salesperson: order.salesperson || order.operator || "" };
  }));
  const purchaseAmount = sum(purchases, "amount");
  const purchaseCorrectionAmount = sum(events.corrections, "priceDelta");
  const cashHandover = cashHandoverTotals(store, date);
  const paymentAccountTotals={};
  for(const r of receipts){const key=r.paymentAccountId||r.account+"/"+(r.accountOwnerId||"");const value=paymentAccountTotals[key]||{paymentAccountId:r.paymentAccountId||null,accountName:r.accountName||r.account,account:r.account,accountOwnerId:r.accountOwnerId||null,amount:0};value.amount=round(value.amount+Number(r.amount||0));paymentAccountTotals[key]=value;}
  const accountTotals = {};
  for (const r of receipts) accountTotals[r.account] = round((accountTotals[r.account] || 0) + Number(r.amount || 0));
  const products = new Map(store.products.map((p) => [p.skuId, p]));
  const inventory = store.inventory.filter((r) => products.get(r.skuId)?.stockManaged !== false).map((r) => {
    const p = products.get(r.skuId);
    const related = movements.filter((m) => m.skuId === r.skuId && (m.warehouseId || "wh-sale") === (r.warehouseId || "wh-sale"));
    const delta = related.reduce((n, m) => n + Number(m.quantity || 0), 0);
    return { skuId: r.skuId, name: p?.name || r.skuId, category: p?.type || "其他",
      warehouse: r.warehouseName || "销售仓", openingQuantity: Number(r.quantity) - delta,
      inQuantity: related.filter((m) => m.quantity > 0).reduce((n, m) => n + m.quantity, 0),
      outQuantity: -related.filter((m) => m.quantity < 0).reduce((n, m) => n + m.quantity, 0),
      quantity: r.quantity, trackSerial: !!p?.trackSerial,
      serials: (r.serials || []).filter((s) => ["可售", "未激活"].includes(s.status)).map((s) => s.no) };
  });
  const lastLocked = (store.dailyCloseouts || []).filter((r) => r.status === "已锁定" && r.date < date).sort((a,b) => a.date.localeCompare(b.date)).at(-1);
  const supplierTotals = require("./suppliers").list(store, { roleCode: "owner" }).totals;
  return {
    date, asOf: c.now(), fingerprint: fingerprint(store, date), coreFingerprint: fingerprintCore(store, date),
    transactions, mobile: mobileRows(store, date),
    salesCount: sales.length, salesAmount: sum(sales, "amount"),
    returnCount: returns.length, returnAmount: sum(returns, "amount"),
    purchaseCount: purchases.length, purchaseAmount,
    purchaseCorrectionCount: events.corrections.length, purchaseCorrectionAmount,
    netPurchaseActivityAmount: round(purchaseAmount + purchaseCorrectionAmount),
    purchaseCorrectionNote: "采购金额保留当日原入库金额；更正差额按更正发生日单列，采购及更正净额不表示现金收付。",
    purchaseCorrections: events.corrections.map((row) => ({ id: row.id, purchaseId: row.purchaseId, itemId: row.itemId,
      name: row.name, priceDelta: row.priceDelta, originalUnitPrice: row.originalUnitPrice, currentRecordedPrice: row.currentRecordedPrice,
      correctedUnitPrice: row.correctedUnitPrice, inventoryDelta: row.inventoryDelta, salesDelta: row.salesDelta, at: row.createdAt })),
    originalGrossProfit, costAdjustmentProfit, grossProfit: round(originalGrossProfit + costAdjustmentProfit),
    adjustedGrossProfit: round(originalGrossProfit + costAdjustmentProfit),
    giftCost: round(gifts.reduce((n, row) => n + Number(row.gift.cost || 0), 0)),
    originalCost, salesCostAdjustmentAmount, cost: round(originalCost + salesCostAdjustmentAmount),
    costAdjustmentNote: "成本与毛利调整计入调整发生日，原销售金额、数量和原始毛利快照保持原记录。",
    accountTotals,paymentAccountTotals:Object.values(paymentAccountTotals), cashChange: accountTotals["现金"] || 0,
    cashHandoverConfirmed: cashHandover.confirmed, cashHandoverPending: cashHandover.pending.map((r) => ({ id: r.id, amount: r.amount, recipient: r.recipient })), cashHandoverDisputed: cashHandover.disputed.map((r) => ({ id: r.id, amount: r.amount, countedAmount: r.countedAmount })),
    stockMovementCount: movements.length, inventory, supplierTotals, customerReceivables: null,
    openingCashSuggested: lastLocked ? lastLocked.actualCash : null,
    mobileServiceCount: (store.carrierServices || []).filter((r) => r.serviceDate === date).length,
  };
}
function hideSnapshot(shot, user) {
  if (!shot) return;
  const caps = c.capabilities(user);
  if (!caps.cost) {
    for (const key of ["cost", "originalCost", "giftCost", "salesCostAdjustmentAmount", "purchaseCorrectionAmount", "netPurchaseActivityAmount", "purchaseCorrections"]) delete shot[key];
    for (const row of shot.transactions || []) delete row.cost;
  }
  if (!caps.profit) {
    for (const key of ["grossProfit", "originalGrossProfit", "adjustedGrossProfit", "costAdjustmentProfit"]) delete shot[key];
    for (const row of shot.transactions || []) delete row.profit;
  }
  if (!caps.supplierView) delete shot.supplierTotals;
}
function publicRow(row, user) {
  const copy = structuredClone(row);
  hideSnapshot(copy.snapshot, user);
  for (const revision of copy.revisions || []) hideSnapshot(revision.snapshot, user);
  return copy;
}
function preview(store, user, date) {
  c.permit(user, "sell");
  const shot = snapshot(store, date);
  hideSnapshot(shot, user);
  return shot;
}
function list(store, user) {
  return (store.dailyCloseouts || []).filter((r) => user.roleCode === "owner" || r.cashierId === user.id || r.reviewerId === user.id).map((r) => publicRow(r, user)).reverse();
}
function validateManual(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new c.HttpError(400, "移动BOSS核对数字不正确");
  const result = {};
  for (const [key] of METRICS) {
    const value = input[key];
    if (value == null || value === "") { result[key] = null; continue; }
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new c.HttpError(400, "移动BOSS核对数字不正确");
    result[key] = round(n);
  }
  return result;
}
function submit(store, user, payload) {
  c.permit(user, "sell");
  const date = c.text(payload.date, "扎账日期");
  if (date !== c.day()) throw new c.HttpError(400, "正式扎账只能提交今天；历史日期请由老板登记补正");
  if ((store.dailyCloseouts || []).some((r) => r.date === date && !["已驳回", "已解锁"].includes(r.status)))
    throw new c.HttpError(409, "今天已有进行中的正式扎账单");
  const reviewer = active(store, payload.reviewerId);
  if (!reviewer || reviewer.id === user.id || reviewer.roleCode === "owner" || !c.capabilities(reviewer).sell)
    throw new c.HttpError(400, "请选择另一名有开单权限的在职营业员复核");
  const manual = validateManual(payload.manual || {});
  const shot = snapshot(store, date);
  shot.mobile = mobileRows(store, date, manual);
  const actualCash = c.money(payload.actualCash, "抽屉实点现金");
  const openingCash = shot.openingCashSuggested == null ? c.money(payload.openingCash || 0, "现金期初") : shot.openingCashSuggested;
  const expectedCash = round(openingCash + shot.cashChange - shot.cashHandoverConfirmed);
  const cashDifference = round(actualCash - expectedCash);
  const note = String(payload.note || "").trim().slice(0, 1000);
  if (cashDifference && !note) throw new c.HttpError(400, "现金有差异，请填写原因");
  const row = { id: c.id("DC"), date, status: "待领取复核", cashierId: user.id, cashier: user.name,
    reviewerId: reviewer.id, reviewer: reviewer.name, submittedAt: c.now(), snapshot: shot, manual,
    openingCash, actualCash, expectedCash, cashDifference, note, revisions: [], events: [{ type: "提交", by: user.id, at: c.now() }] };
  store.dailyCloseouts ||= [];
  store.dailyCloseouts.push(row);
  c.audit(store, user, "daily-close:submit", row.id);
  notice(store, "daily-close:" + row.id, "每日扎账待复核", { id: row.id, summary: date + " · " + reviewer.name + " 待领取复核；现金差异 " + cashDifference + " 元" });
  return publicRow(row, user);
}
function find(store, id) {
  const row = (store.dailyCloseouts || []).find((r) => r.id === id);
  if (!row) throw new c.HttpError(404, "扎账单不存在");
  return row;
}
function claim(store, user, payload) {
  const row = find(store, payload.id);
  if (row.reviewerId !== user.id || row.cashierId === user.id) throw new c.HttpError(403, "只有指定的另一位营业员可以领取");
  if (row.status !== "待领取复核") throw new c.HttpError(409, "此扎账单不可领取");
  row.status = "复核中";
  row.events.push({ type: "领取", by: user.id, at: c.now() });
  c.audit(store, user, "daily-close:claim", row.id);
  return publicRow(row, user);
}
function review(store, user, payload) {
  const row = find(store, payload.id);
  if (row.reviewerId !== user.id || row.cashierId === user.id) throw new c.HttpError(403, "提交人不能复核自己的扎账单");
  if (row.status !== "复核中" && !(row.status === "待老板签认" && payload.decision === "驳回")) throw new c.HttpError(409, "请先领取复核任务；复核通过后仍可驳回重核");
  const decision = payload.decision === "通过" ? "待老板签认" : payload.decision === "驳回" ? "已驳回" : "";
  if (!decision) throw new c.HttpError(400, "请选择通过或驳回");
  const note = String(payload.note || "").trim().slice(0, 1000);
  const requiredChecks = ["sales", "stock", "serials", "cash", "mobile", "suppliers"];
  if (decision === "待老板签认" && !requiredChecks.every((key) => payload.checks?.[key] === true)) throw new c.HttpError(400, "须逐栏勾选交易、库存、串码、现金、移动业务和往来核对");
  const differences = row.snapshot.mobile.filter((r) => r.status === "有差异" || r.status === "我方缺基础数据");
  if ((decision === "已驳回" || row.cashDifference || differences.length) && !note)
    throw new c.HttpError(400, "存在疑义或差异，请填写复核说明");
  row.status = decision;
  row.reviewNote = note;
  row.checks = decision === "待老板签认" ? Object.fromEntries(requiredChecks.map((key) => [key, true])) : {};
  row.reviewedAt = c.now();
  row.events.push({ type: payload.decision, by: user.id, at: row.reviewedAt, note });
  c.audit(store, user, "daily-close:review", row.id + " " + decision);
  notice(store, "daily-close-review:" + row.id + ":" + row.events.length, "每日扎账复核结果", { id: row.id, summary: row.date + " · " + decision + (note ? " · " + note : "") });
  return publicRow(row, user);
}
function resubmit(store, user, payload) {
  const row = find(store, payload.id);
  if (row.cashierId !== user.id || row.status !== "已驳回") throw new c.HttpError(403, "只能补正本人被驳回的扎账单");
  row.revisions.push({ snapshot: row.snapshot, manual: row.manual, actualCash: row.actualCash, note: row.note, at: c.now() });
  const manual = validateManual(payload.manual || row.manual);
  if (row.date !== c.day() && row.snapshot.coreFingerprint !== fingerprintCore(store, row.date)) throw new c.HttpError(409, "历史交易、库存或资金流水已变化，请老板按当日补正单处理");
  row.snapshot = row.date === c.day() ? snapshot(store, row.date) : structuredClone(row.snapshot);
  row.snapshot.fingerprint = fingerprint(store, row.date);
  const cashHandover = cashHandoverTotals(store, row.date);
  row.snapshot.cashHandoverConfirmed = cashHandover.confirmed;
  row.snapshot.cashHandoverPending = cashHandover.pending.map((r) => ({ id: r.id, amount: r.amount, recipient: r.recipient }));
  row.snapshot.cashHandoverDisputed = cashHandover.disputed.map((r) => ({ id: r.id, amount: r.amount, countedAmount: r.countedAmount }));
  row.snapshot.mobile = mobileRows(store, row.date, manual);
  row.manual = manual;
  row.actualCash = c.money(payload.actualCash, "抽屉实点现金");
  row.openingCash = c.money(payload.openingCash, "现金期初");
  row.expectedCash = round(row.openingCash + row.snapshot.cashChange - row.snapshot.cashHandoverConfirmed);
  row.cashDifference = round(row.actualCash - row.expectedCash);
  row.note = String(payload.note || "").trim().slice(0, 1000);
  if (row.cashDifference && !row.note) throw new c.HttpError(400, "现金差异须填写原因");
  row.status = "待领取复核";
  row.events.push({ type: "补正再提交", by: user.id, at: c.now() });
  c.audit(store, user, "daily-close:resubmit", row.id);
  notice(store, 'daily-close-resubmit:' + row.id + ':' + row.events.length, '每日扎账补正待复核', { id: row.id, summary: row.date + ' · ' + row.reviewer + ' 请重新领取复核' });
  return publicRow(row, user);
}
function lock(store, user, payload) {
  if (user.roleCode !== "owner") throw new c.HttpError(403, "只有老板可以签认锁定");
  const row = find(store, payload.id);
  if (row.status !== "待老板签认") throw new c.HttpError(409, "须先由另一名营业员复核通过");
  if (row.date >= c.day()) throw new c.HttpError(409, "当日仍可能继续营业，请次日签认锁定");
  if (cashHandoverTotals(store, row.date).pending.length) throw new c.HttpError(409, "当天还有未被接收人确认的现金交接，暂不能锁账");
  if (row.snapshot.fingerprint !== fingerprint(store, row.date)) throw new c.HttpError(409, "该日有新业务或流水，须重新生成扎账快照");
  const note = String(payload.note || "").trim().slice(0, 1000);
  const unresolved = row.snapshot.mobile.filter((m) => m.status !== "一致");
  if ((row.cashDifference || unresolved.length) && !note) throw new c.HttpError(400, "有未一致核对项，老板须写明签认意见");
  row.status = "已锁定"; row.lockedAt = c.now(); row.lockedBy = user.id; row.lockNote = note;
  row.events.push({ type: "签认锁定", by: user.id, at: row.lockedAt, note });
  c.audit(store, user, "daily-close:lock", row.id);
  return publicRow(row, user);
}
function unlock(store, user, payload) {
  if (user.roleCode !== "owner") throw new c.HttpError(403, "只有老板可以解锁");
  const row = find(store, payload.id);
  if (row.status !== "已锁定") throw new c.HttpError(409, "只有已锁定的日期可解锁");
  const note = c.text(payload.note, "解锁原因").slice(0, 1000);
  row.status = "已解锁"; row.unlockedAt = c.now(); row.unlockedBy = user.id; row.unlockNote = note;
  row.events.push({ type: "老板解锁", by: user.id, at: row.unlockedAt, note });
  c.audit(store, user, "daily-close:unlock", row.id);
  return publicRow(row, user);
}
function airEntry(store, user, payload) {
  c.permit(user, "finance");
  const kind = String(payload.kind || "");
  if (!["opening", "increase", "decrease"].includes(kind)) throw new c.HttpError(400, "空充流水类型不正确");
  const date = c.text(payload.businessDate, "业务日期");
  if (date !== c.day()) throw new c.HttpError(400, "空充余额只登记今天；历史差异请备注并交老板处理");
  if ((store.dailyCloseouts || []).some((r) => r.date === date && r.status === "已锁定")) throw new c.HttpError(409, "该营业日已锁定");
  const amount = c.money(payload.amount, "空充金额");
  if (amount <= 0) throw new c.HttpError(400, "空充金额须大于零");
  const reference = c.text(payload.reference, "移动BOSS流水号");
  store.airRechargeEvents ||= [];
  if (store.airRechargeEvents.some((r) => r.reference === reference)) throw new c.HttpError(409, "空充流水号已登记");
  if (kind === "opening" && store.airRechargeEvents.some((r) => r.kind === "opening")) throw new c.HttpError(409, "空充期初已登记");
  if (kind !== "opening" && !store.airRechargeEvents.some((r) => r.kind === "opening")) throw new c.HttpError(409, "请先由负责人登记空充期初");
  if (kind === "opening" && user.roleCode !== "owner") throw new c.HttpError(403, "空充期初须老板登记");
  const signed = kind === "decrease" ? -amount : amount;
  const balance = round(store.airRechargeEvents.reduce((n, r) => n + Number(r.amount || 0), 0) + signed);
  if (balance < 0) throw new c.HttpError(409, "空充余额不足");
  const row = { id: c.id("AIR"), kind, amount: signed, balance, reference,
    businessDate: date, note: String(payload.note || "").trim().slice(0, 500),
    createdAt: c.now(), operatorId: user.id, operator: user.name };
  store.airRechargeEvents.push(row);
  c.audit(store, user, "air-recharge:" + kind, row.id + " " + signed);
  notice(store, "air-recharge:" + row.id, "空充台账变动", { id: row.id, summary: kind + " " + signed + " 元；期末余额 " + balance + " 元" });
  return row;
}
function airFunding(store, user, payload) {
  c.permit(user, "finance");
  const date = c.day();
  if ((store.dailyCloseouts || []).some((r) => r.date === date && r.status === "已锁定"))
    throw new c.HttpError(409, "该营业日已锁定");
  if (!(store.airRechargeEvents || []).some((r) => r.kind === "opening"))
    throw new c.HttpError(409, "请先登记空充期初");
  const paidAmount = c.money(payload.paidAmount, "实际转出金额");
  const creditedAmount = c.money(payload.creditedAmount, "平台实际入账金额");
  if (paidAmount <= 0 || creditedAmount <= 0 || creditedAmount > paidAmount)
    throw new c.HttpError(400, "实际转出与平台入账金额不正确");
  const method = c.text(payload.method, "转出方式");
  if (!["微信", "银行卡", "支付宝"].includes(method))
    throw new c.HttpError(400, "请选择实际转出方式");
  const bankRef = c.text(payload.bankRef, "转出流水号").slice(0, 80);
  const platformRef = c.text(payload.platformRef, "移动BOSS流水号").slice(0, 80);
  if ((store.airRechargeEvents || []).some((r) => r.reference === platformRef || r.bankRef === bankRef))
    throw new c.HttpError(409, "转出或移动BOSS流水号已登记");
  const balance = round((store.airRechargeEvents || []).reduce((n, r) => n + Number(r.amount || 0), 0) + creditedAmount);
  const row = { id: c.id("AIR"), kind: "funding", amount: creditedAmount, paidAmount,
    difference: round(paidAmount - creditedAmount), balance, reference: platformRef,
    bankRef, method, payerId: user.id, payer: user.name, businessDate: date,
    note: String(payload.note || "").trim().slice(0, 500),
    createdAt: c.now(), operatorId: user.id, operator: user.name };
  store.airRechargeEvents ||= [];
  store.airRechargeEvents.push(row);
  store.receipts.push({ id: c.id("RC"), kind: "air_funding", sourceId: row.id,
    amount: -paidAmount, account: method, accountOwnerId: user.id,
    operatorId: user.id, transactionDate: date, createdAt: row.createdAt });
  c.audit(store, user, "air-recharge:funding", row.id + " 实付 " + paidAmount + " 平台入账 " + creditedAmount);
  notice(store, "air-funding:" + row.id, "空充平台充值待核对", { id: row.id,
    summary: user.name + " 实付 " + paidAmount + " 元，平台入账 " + creditedAmount +
      " 元，差额 " + row.difference + " 元，需核对扣款性质" });
  return row;
}
function airCashSale(store, user, payload) {
  c.permit(user, "sell");
  const date = c.day();
  if ((store.dailyCloseouts || []).some((r) => r.date === date && r.status === "已锁定"))
    throw new c.HttpError(409, "该营业日已锁定");
  if (!(store.airRechargeEvents || []).some((r) => r.kind === "opening"))
    throw new c.HttpError(409, "请先由负责人登记空充期初");
  if (payload.cashConfirmed !== true)
    throw new c.HttpError(400, "必须先实收顾客现金并确认");
  const phone = c.text(payload.customerPhone, "顾客手机号");
  if (!/^1[3-9][0-9]{9}$/.test(phone)) throw new c.HttpError(400, "顾客手机号不正确");
  const cashReceived = c.money(payload.cashReceived, "实收现金");
  const debitAmount = c.money(payload.debitAmount, "平台实际扣减");
  if (cashReceived <= 0 || debitAmount <= 0)
    throw new c.HttpError(400, "充值金额须大于零");
  if (cashReceived !== debitAmount)
    throw new c.HttpError(409, "顾客实收现金与平台扣减不同，请交老板核实，不能按普通充值单入账");
  const platformRef = c.text(payload.platformRef, "移动BOSS流水号").slice(0, 80);
  if ((store.airRechargeEvents || []).some((r) => r.reference === platformRef))
    throw new c.HttpError(409, "移动BOSS流水号已登记");
  const balance = round((store.airRechargeEvents || []).reduce((n, r) => n + Number(r.amount || 0), 0) - debitAmount);
  if (balance < 0) throw new c.HttpError(409, "平台可用余额不足");
  const row = { id:c.id("AIR"), kind:"customer_recharge", amount:-debitAmount,
    debitAmount, cashReceived, balance, reference:platformRef,
    customerPhone:phone, customerMask:phone.slice(0,3)+"****"+phone.slice(-4),
    businessDate:date, createdAt:c.now(), operatorId:user.id, operator:user.name,
    note:String(payload.note||"").trim().slice(0,500) };
  store.airRechargeEvents ||= [];
  store.airRechargeEvents.push(row);
  store.receipts.push({id:c.id("RC"),kind:"cash_recharge",sourceId:row.id,
    amount:cashReceived,account:"现金",transactionDate:date,operatorId:user.id,
    createdAt:row.createdAt});
  const receptions=require("./receptions");
  const receptionId=payload.receptionId || receptions.create(store,user,{phone,purpose:"现金充值",source:"到店",needs:"话费充值"}).id;
  receptions.link(store,user,{receptionId},"现金充值单",row);
  row.receptionId=receptionId;
  row.customerId=(store.receptions||[]).find((r)=>r.id===receptionId)?.customerId;
  c.audit(store,user,"air-recharge:cash-sale",row.id+" "+cashReceived+" "+platformRef);
  notice(store,"air-recharge-sale:"+row.id,"顾客现金充值",{
    id:row.id,summary:row.customerMask+" · 实收现金 "+cashReceived+
      " 元 · 平台扣减 "+debitAmount+" 元 · 余额 "+balance+" 元"});
  return { ...row, customerPhone:undefined };
}
function airBalance(store,user) {
  c.permit(user,"sell");
  const rows=store.airRechargeEvents||[];
  return { hasOpening:rows.some((r)=>r.kind==="opening"),
    balance:round(rows.reduce((n,r)=>n+Number(r.amount||0),0)) };
}
function airCashSales(store,user) {
  c.permit(user,"sell");
  return (store.airRechargeEvents||[]).filter((r)=>r.kind==="customer_recharge" &&
    (c.capabilities(user).finance || r.operatorId===user.id))
    .slice().reverse().map((r)=>({ ...r, customerPhone:undefined }));
}
function airList(store, user) {
  c.permit(user, "finance");
  return (store.airRechargeEvents || []).slice().reverse();
}
module.exports = { METRICS, metricAuto, mobileRows, snapshot, preview, list, submit, claim, review, resubmit, lock, unlock, airEntry, airFunding, airCashSale, airCashSales, airBalance, airList };




