const c = require("./common");
function inspect(store) {
  const findings = [];
  const add = (id, severity, summary) => findings.push({ id, severity, summary });
  const products = new Map(store.products.map((p) => [p.skuId, p]));
  const serials = new Map();
  for (const row of store.inventory) {
    const product = products.get(row.skuId);
    const key = row.skuId + ":" + (row.warehouseId || "wh-sale");
    if (!product) findings.push({ id: "orphan-stock:" + key, severity: "高", summary: "库存找不到商品档案 " + key });
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 0)
      findings.push({ id: "invalid-quantity:" + key, severity: "高", summary: "库存数量异常 " + key });
    const available = (row.serials || []).filter((s) => ["可售", "未激活"].includes(s.status));
    if (product && product.trackSerial && available.length !== row.quantity)
      findings.push({ id: "serial-balance:" + key, severity: "高", summary: "串码可售数与库存数量不符：" + product.name });
    for (const serial of row.serials || []) {
      const no = String(serial.no || "").trim();
      if (!no) findings.push({ id: "empty-serial:" + key, severity: "高", summary: "存在空串码：" + (product?.name || key) });
      else if (serials.has(no)) findings.push({ id: "duplicate-serial:" + no, severity: "高", summary: "串码重复：" + no });
      else serials.set(no, key);
    }
  }
  for (const order of store.sales) {
    const total = c.round((order.items || []).reduce((n, item) => n + Number(item.amount || 0), 0));
    if (Math.abs(total - Number(order.amount || 0)) > 0.009)
      findings.push({ id: "sale-total:" + order.id, severity: "高", summary: "销售单合计与明细不符：" + order.id });
    for (const item of order.items || [])
      if ((item.returnedQuantity || 0) > item.quantity)
        findings.push({ id: "over-return:" + order.id + ":" + item.id, severity: "高", summary: "退货数量超过销售数量：" + order.id });
  }
  const ids = new Set();
  for (const row of [...store.sales, ...store.purchases, ...store.saleReturns, ...store.purchaseReturns]) {
    if (ids.has(row.id)) findings.push({ id: "duplicate-document:" + row.id, severity: "高", summary: "业务单据编号重复：" + row.id });
    ids.add(row.id);
  }
  for (const row of store.closeouts || []) {
    if ([row.actualCash, row.expectedCash, row.difference].every(Number.isFinite) &&
        Math.abs(c.round(row.actualCash - row.expectedCash) - row.difference) > 0.009)
      findings.push({ id: "closeout-difference:" + row.id, severity: "高", summary: "交班结算现金差异计算不符：" + row.id });
  }
  const cashReceipts = (store.receipts || []).filter((row) => row.account === "现金");
  const rechargeReceipts = cashReceipts.filter((row) => row.kind === "cash_recharge");
  const rechargeEvents = (store.airRechargeEvents || []).filter((row) => row.kind === "customer_recharge");
  const rechargeIds = new Set(rechargeEvents.map((row) => row.id));
  const platformRefs = new Set();
  for (const row of rechargeEvents) {
    const ref = String(row.reference || "").trim();
    if (!ref) add("recharge-reference:" + row.id, "待核实", "现金充值缺少移动BOSS流水号：" + row.id);
    else if (platformRefs.has(ref)) add("recharge-duplicate-reference:" + row.id, "高", "现金充值的移动BOSS流水号重复：" + row.id);
    else platformRefs.add(ref);
    if (![row.cashReceived, row.debitAmount].every((value) => Number.isFinite(value) && value > 0))
      add("recharge-amount:" + row.id, "待核实", "现金充值缺少有效的实收现金或平台扣减金额：" + row.id);
    else if (Math.abs(c.round(row.cashReceived - row.debitAmount)) > 0.009)
      add("recharge-amount:" + row.id, "高", "现金充值实收与平台扣减不一致，须分别核对：" + row.id);
    const linked = rechargeReceipts.filter((receipt) => receipt.sourceId === row.id);
    if (linked.length !== 1) add("recharge-receipt:" + row.id, "待核实", "现金充值对应的现金流水不是一笔，请核对原单：" + row.id);
    else if (!Number.isFinite(linked[0].amount) || !Number.isFinite(row.cashReceived) ||
             Math.abs(c.round(linked[0].amount - row.cashReceived)) > 0.009 ||
             linked[0].transactionDate !== row.businessDate)
      add("recharge-receipt:" + row.id, "高", "现金充值原单与现金流水金额或业务日期不一致：" + row.id);
  }
  for (const row of rechargeReceipts)
    if (!rechargeIds.has(row.sourceId)) add("orphan-recharge-receipt:" + row.id, "待核实", "现金充值流水找不到对应空充原单：" + row.id);
  for (const row of cashReceipts) {
    const entered = row.createdAt && c.day(row.createdAt);
    if (row.transactionDate && entered && row.transactionDate !== entered)
      add("cross-day-cash:" + row.id, "待核实", "现金流水业务日期与录入日期不同，日结时按业务日期逐笔核对：" + row.id);
  }
  for (const row of store.dailyCloseouts || []) {
    if (["已驳回", "已解锁"].includes(row.status)) continue;
    const cashChange = row.snapshot?.cashChange;
    const handover = row.snapshot?.cashHandoverConfirmed;
    if (![row.openingCash, cashChange, handover, row.expectedCash, row.actualCash, row.cashDifference].every(Number.isFinite)) {
      add("daily-close-evidence:" + row.id, "待核实", "正式扎账缺少现金期初、流水、已确认交接或实点依据：" + row.id);
      continue;
    }
    if (Math.abs(c.round(row.openingCash + cashChange - handover - row.expectedCash)) > 0.009 ||
        Math.abs(c.round(row.actualCash - row.expectedCash - row.cashDifference)) > 0.009)
      add("daily-close-formula:" + row.id, "高", "正式扎账现金计算与原始分项不一致：" + row.id);
    if (row.snapshot.cashHandoverPending?.length || row.snapshot.cashHandoverDisputed?.length)
      add("daily-close-handover:" + row.id, "待核实", "正式扎账仍有待确认或有异议的现金交接：" + row.id);
    if (Math.abs(row.cashDifference) > 0.009)
      add("daily-close-cash-difference:" + row.id, "待核实", "正式扎账登记了现金差异，须核对实点和补录原单：" + row.id);
  }
  return findings;
}
function collect(store) {
  const findings = inspect(store);
  if (!findings.length) return { checked: true, findings: 0 };
  const { notice } = require("./feishu-notices");
  const day = c.day();
  for (const finding of findings) notice(store, "guardian:" + day + ":" + finding.id, "系统预警", { id: finding.id, summary: finding.summary });
  return { checked: true, findings: findings.length };
}
module.exports = { inspect, collect };
