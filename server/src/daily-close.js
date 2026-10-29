const c = require("./common");
const { createHash } = require("node:crypto");
const { notice } = require("./feishu-notices");

const METRICS = [["airOpening", "空充期初", "元"], ["airChange", "空充净变动", "元"], ["airClosing", "空充期末", "元"]];
const round = c.round;
const sum = (rows, field) => round(rows.reduce((n, row) => n + Number(row[field] || 0), 0));
function active(store, id) { return store.users.find((u) => u.id === id && u.status === "active"); }
function sameDay(value, day) { return value && c.day(value) === day; }
function metricAuto(store, date) {
  const receipts=require('./serial-source-corrections').receiptRows(store),channels=new Set(require('./payment-accounts').channels.filter(x=>x!=='现金'));
  const reversedIds=new Set(receipts.filter(r=>(r.transactionDate||c.day(r.createdAt))<=date&&r.originalReceiptId&&(r.isReversal||['expense_red','other_income_red'].includes(r.kind))).map(r=>r.originalReceiptId));
  const bankSourceIds=new Set((store.cashHandovers||[]).filter(h=>h.kind==='bank'||h.receiptKind==='bank_deposit').map(h=>h.id));
  const walletNames=new Set(['门店微信','信号机微信']),signalIds=new Set((store.paymentAccounts||[]).filter(a=>walletNames.has(a.name)&&a.channel==='微信').map(a=>a.id));
  const effective=receipts.filter(r=>!bankSourceIds.has(r.sourceId)&&!['bank_deposit','cash_bank_deposit'].includes(r.kind)&&(r.transactionDate||c.day(r.createdAt))===date&&channels.has(r.account)&&!walletNames.has(r.accountName)&&!signalIds.has(r.paymentAccountId)&&!r.isReversal&&!['expense_red','other_income_red','fund_transfer','transfer_in','transfer_out'].includes(r.kind)&&!reversedIds.has(r.id));
  const aggregateDetails=[...channels].map(account=>{const items=effective.filter(r=>r.account===account),received=round(items.filter(r=>r.amount>0).reduce((n,r)=>n+Number(r.amount),0)),refunded=round(-items.filter(r=>r.kind==='refund'&&r.amount<0).reduce((n,r)=>n+Number(r.amount),0));return {account,received,refunded,net:round(received-refunded)};}).filter(r=>r.received||r.refunded);
  const bankBasis=require('./cash-basis').build(store,date),bankDeposits=bankBasis.bankTotal/100;
  const pendingBankDeposits=(store.cashHandovers||[]).filter(h=>(h.transactionDate||c.day(h.createdAt))===date&&(h.kind==='bank'||h.receiptKind==='bank_deposit')&&!h.sourceCorrection&&h.status==='待接收人确认').map(h=>({id:h.id,amount:h.amount,sender:h.sender,status:'待老板确认'}));
  const aggregatePayments={received:round(aggregateDetails.reduce((n,r)=>n+r.received,0)),refunded:round(aggregateDetails.reduce((n,r)=>n+r.refunded,0)),bankDeposits,pendingBankDeposits,net:round(aggregateDetails.reduce((n,r)=>n+r.net,0)+bankDeposits),details:aggregateDetails};
  const services = (store.carrierServices || []).filter((r) => r.serviceDate === date);
  const kinds = (type) => services.filter((r) => r.type === type);
  const typed = (rows, subtype) => rows.some((r) => !r.subType || r.subType === "unknown") ? null : rows.filter((r) => r.subType === subtype).length;
  const cards = kinds("card"), recharges = kinds("recharge"), broadband = kinds("broadband"), packages = kinds("package");
  const airCashSales = (store.airRechargeEvents||[]).filter((r)=>r.kind==="customer_recharge"&&r.businessDate===date&&!(r.reference&&recharges.some((s)=>s.externalOrderNo===r.reference)));
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
    aggregatePayments, aggregateReceived:aggregatePayments.net, cardNew: typed(cards, "new"), cardReplace: typed(cards, "replace"),
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
function salePaymentAudit(store, sales, date) {
  const finished = new Set(["已核对", "已确认到账", "无需收款", "已红冲", "已退货"]);
  const rows = sales.map((order) => {
    const parts = Array.isArray(order.paymentParts) ? order.paymentParts : [];
    const rawDue = order.paymentReview?.amount ?? (parts.length ? parts.reduce((n, part) => n + Number(part.amount || 0), 0) : null);
    const due = rawDue == null || !Number.isFinite(Number(rawDue)) ? null : round(Number(rawDue));
    const receipts = require("./serial-source-corrections").receiptRows(store).filter((r) => r.kind === "sale" && r.sourceId === order.id &&
      (r.transactionDate || (r.createdAt && c.day(r.createdAt)) || "") <= date);
    const recorded = sum(receipts, "amount");
    const returnedFace=(store.saleReturns||[]).filter(r=>r.orderId===order.id&&r.createdAt&&c.day(r.createdAt)<=date).reduce((n,r)=>n+Number(r.originalAmount??r.amount??0),0);
    const outstanding = due == null ? null : round(Math.max(0, due - recorded - returnedFace));
    const status = order.paymentReview?.status || (due === 0 ? "无需收款" : "无收款核对单");
    const needsReview = outstanding == null || outstanding > 0 || !finished.has(status) ||
      parts.some((part) => !finished.has(part.paymentReview?.status));
    return require("./mobile-coin-claims").paymentAudit(store,{ orderId: order.id, account: order.paymentMethod || "未标明", due, recorded, outstanding,
      status, needsReview, unverifiedRecorded: needsReview ? recorded : 0 },date);
  });
  return { rows, recordedAmount: sum(rows, "recorded"), outstandingAmount: round(rows.reduce((n, row) => n + Number(row.outstanding || 0), 0)),
    unsettledCount: rows.filter((row) => row.needsReview).length, unknownCount: rows.filter((row) => row.due == null).length,
    unverifiedRecordedAmount: sum(rows, "unverifiedRecorded") };
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
function savedInventory(store,date){
 return (store.dailyCloseouts||[]).filter(r=>r.date===date&&r.snapshot&&Array.isArray(r.snapshot.inventory)&&!['已驳回','已被后次替代','已撤回'].includes(r.status)).slice().sort((a,b)=>(Number(b.status==='已锁定')-Number(a.status==='已锁定'))||String(b.submittedAt||'').localeCompare(String(a.submittedAt||'')))[0]||null;
}
function inventoryBasis(store,date){
 if(date!==c.day()){const saved=savedInventory(store,date)?.snapshot.inventoryBasis;return saved?{version:saved.version,rows:saved.rows,products:saved.products}:null;}
 return {version:2,rows:(store.inventory||[]).map(r=>[r.skuId,r.warehouseId||'wh-sale',Number(r.quantity||0),Number(r.stockValue||0),(r.serials||[]).map(s=>[s.no,s.status,Number(s.costPrice||0)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]).sort((a,b)=>JSON.stringify(a.slice(0,2)).localeCompare(JSON.stringify(b.slice(0,2)))),products:(store.products||[]).map(p=>[p.skuId,p.name,p.type,p.stockManaged!==false,!!p.trackSerial]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))};
}
function fingerprintSources(store, date) {
  const source = [
    store.sales.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.profit, r.paymentReview?.status, r.paymentReview?.amount, r.paymentReview?.customerPaidDeclaredAt, r.receivedAmount, r.pendingAmount, (r.paymentParts || []).map((p) => [p.id, p.amount, p.account, p.paymentReview?.status, p.paymentReview?.customerPaidDeclaredAt, p.paymentReview?.cashDrawerConfirmed, p.paymentReview?.reference]), (r.items || []).map((i) => [i.id, i.quantity, i.amount, i.cost, i.profit, i.serialNo])]),
    store.saleReturns.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.profit, (r.items || []).map((i) => [i.itemId, i.quantity, i.amount, i.cost, i.profit])]),
    store.purchases.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.supplierId, (r.items || []).map((i) => [i.skuId, i.quantity, i.cost, i.amount])]),
    store.movements.filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.skuId, r.warehouseId, r.quantity, r.cost]),
    store.receipts.filter((r) => (r.transactionDate || c.day(r.createdAt)) === date).map((r) => [r.id,r.amount,r.account,r.kind,r.sourceId,...(r.partId||r.paymentAccountId?[r.partId||"",r.paymentAccountId||"",r.accountName||"",r.accountOwnerId||"",r.accountOwnerName||""]:[])]),
    (store.carrierServices || []).filter((r) => r.serviceDate === date).map((r) => [r.id, r.type, r.subType, r.transactionAmount, (r.schedule||[]).map(p=>[p.month,p.expected,p.confirmed,p.confirmedAt,p.received])]),
    (store.airRechargeEvents || []).filter((r) => r.businessDate === date).map((r) => [r.id, r.kind, r.amount]),
    (store.carrierServices || []).flatMap((r) => r.schedule || []).filter((p) => sameDay(p.confirmedAt, date)).map((p) => [p.month, p.confirmed, p.statementNo]),
    (store.carrierServices || []).flatMap((r) => r.schedule || []).flatMap((p) => p.events || []).filter((e) => sameDay(e.createdAt, date)).map((e) => [e.id, e.amount, e.bankRef]),
    (store.cashHandovers || []).filter((r) => sameDay(r.createdAt, date)).map((r) => [r.id, r.amount, r.status, r.actualAmount, r.bankRef]),
    require("./funds-network").confirmedStoreTransfers(store,date).map(t=>[t.id,t.sourceAccountId,t.actualAmount,t.recipientId,t.confirmedBy,t.confirmedAt]),
  ];
  const extension = costFingerprintExtension(store, date);
  if (extension) source.push(extension);
  const annotations=require('./source-annotations').entries(store).filter(x=>x.date===date);if(annotations.length)source.push(annotations);
  const mobileClaims=require("./mobile-coin-claims").atDate(store,date);if(mobileClaims.length)source.push(mobileClaims);
  source.push(['inventory-basis-v2',inventoryBasis(store,date)]);
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
  const paymentAudit = salePaymentAudit(store, sales, date);
  const returns = store.saleReturns.filter((r) => sameDay(r.createdAt, date));
  const purchases = store.purchases.filter((r) => sameDay(r.createdAt, date));
  const receipts = require('./serial-source-corrections').receiptRows(store).filter((r) => (r.transactionDate || c.day(r.createdAt)) === date);
  const sourceAnnotations=require('./source-annotations').entries(store).filter(x=>x.date===date);
  const testIds=new Set(sourceAnnotations.filter(x=>x.test).map(x=>x.orderId));
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
  for(const {order,gift} of gifts){const residual=round(Number(gift.cost||0)-(gift.items||[]).reduce((n,i)=>n+Number(i.cost||0),0));if(residual)transactions.push({orderId:order.id,giftId:gift.id,at:gift.createdAt,product:'赠品成本分摊差额',quantity:0,amount:0,cost:residual,profit:-residual,account:'无收款',operator:gift.operator,salesperson:order.salesperson});}
  for(const ret of returns){const source=store.sales.find(o=>o.id===ret.orderId);for(const item of ret.items||[]){const original=source?.items?.find(i=>i.id===item.itemId);const face=Number(item.originalAmount??item.amount??0),cost=Number(item.cost||0);transactions.push({kind:'return',orderId:ret.id,sourceOrderId:ret.orderId,at:ret.createdAt,product:'退货 / 红冲 · '+(item.name||original?.name||item.skuId||'原商品'),serialNo:item.serialNo||original?.serialNo||'',quantity:-Number(item.quantity||0),amount:-face,cost:-cost,profit:round(cost-Number(item.amount??item.originalAmount??0)),account:ret.paymentMethod||ret.account||'原退款账户',operator:ret.operator||'',salesperson:source?.salesperson||''});}}
  for(const row of transactions)if(testIds.has(row.sourceOrderId||row.orderId)){row.isTest=true;row.product='【测试原单】'+row.product;}
  const originalCost = round(transactions.filter(r=>r.kind!=='return').reduce((n, row) => n + Number(row.cost || 0), 0) - sum(returns, "cost"));
  const returnFaceAmount=round(returns.reduce((n,r)=>n+Number(r.originalAmount??r.amount??0),0));
  const allReceipts=require('./serial-source-corrections').receiptRows(store);
  const refundRows=receipts.filter(r=>r.kind==='refund');
  const actualRefundAmount=round(-sum(refundRows,'amount')),declaredRefundAmount=sum(returns,'amount');
  const cancelledUnreceived=returns.filter(ret=>{const sale=store.sales.find(o=>o.id===ret.orderId),ids=new Set([ret.orderId,ret.id]);const evidence=allReceipts.filter(r=>ids.has(r.sourceId)&&['sale','refund'].includes(r.kind));return !evidence.length&&((sourceAnnotations.some(a=>a.orderId===ret.orderId&&a.originalReceived===0&&a.actualRefund===0&&a.remainder===0))||(sale?.redReversedBy===ret.id&&sale.receivedAmount===0));});
  const cancelledIds=new Set(cancelledUnreceived.map(r=>r.id));
  const cancelledUnreceivedReturnAmount=sum(cancelledUnreceived,'amount');
  const refundUnrecordedAmount=round(returns.filter(r=>!cancelledIds.has(r.id)).reduce((n,ret)=>n+Math.max(0,Number(ret.amount||0)+sum(allReceipts.filter(r=>r.kind==='refund'&&r.sourceId===ret.id&&(r.transactionDate||c.day(r.createdAt))<=date),'amount')),0));
  const refundDifferenceAmount=round(returnFaceAmount-declaredRefundAmount);
  const originalReturnProfit=round(returns.reduce((n,r)=>n+Number(r.amount??r.originalAmount??0)-(Array.isArray(r.items)?r.items.reduce((m,i)=>m+Number(i.cost||0),0):Number(r.cost||0)),0));
  const originalGrossProfit = round(sum(sales, "profit") - originalReturnProfit - gifts.reduce((n, row) => n + Number(row.gift.cost || 0), 0));
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
  const cashHandover = cashHandoverTotals(store, date),cashBasis=require('./cash-basis').snapshot(store,date);
  const paymentAccountTotals={};
  for(const r of receipts){const view=require("./account-ownership").project(store,r),key=view.paymentAccountId||view.account+"/"+(view.accountScope||view.accountOwnerId||"");const value=paymentAccountTotals[key]||{paymentAccountId:view.paymentAccountId||null,accountName:view.displayName||view.accountName||view.account,account:view.account,accountScope:view.accountScope||"",accountOwnerId:view.accountOwnerId||null,accountOwnerName:view.accountOwnerName||"",accountVerifierId:view.accountVerifierId||"",custodyLabel:view.custodyLabel||"",amount:0};value.amount=round(value.amount+Number(r.amount||0));paymentAccountTotals[key]=value;}
  const accountTotals = {};
  for (const r of receipts) accountTotals[r.account] = round((accountTotals[r.account] || 0) + Number(r.amount || 0));
  const products = new Map(store.products.map((p) => [p.skuId, p]));
  const inventoryNow = store.inventory.filter((r) => products.get(r.skuId)?.stockManaged !== false).map((r) => {
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
  const historical=date!==c.day(),saved=historical?savedInventory(store,date):null;
  const inventory=historical?(saved?structuredClone(saved.snapshot.inventory):[]):inventoryNow;
  const inventoryStatus=historical?(saved?'saved':'unavailable'):'current';
  const inventoryAsOf=historical?(saved?.snapshot.inventoryAsOf||saved?.snapshot.asOf||saved?.submittedAt||null):c.now();
  const inventoryNote=historical?(saved?'库存使用该日提交时保存的快照，后续库存变化不会改写。':'该日没有已保存的扎账库存快照，不能用当前库存冒充历史库存；此处不表示库存为零。'):'当前库存截至查询时；提交扎账时保存为快照。';
  const previousDate = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const lastLocked = (store.dailyCloseouts || []).find((r) => r.status === "已锁定" && r.date === previousDate);
  const supplierTotals = require("./suppliers").list(store, { roleCode: "owner" }).totals;
  return {
    date, asOf: c.now(), fingerprint: fingerprint(store, date), coreFingerprint: fingerprintCore(store, date),
    settlementScope:"named-fund-accounts-v1", fundAccounts:require("./named-fund-accounts").build(store,date), legacyAggregateReadOnly:true, aggregatePayments:metricAuto(store,date).aggregatePayments, wallet:require('./wallet-daily').summary(store,date), transactions, mobile: mobileRows(store, date),mobileCoinClaims:require("./mobile-coin-claims").atDate(store,date),
    salesCount: sales.length, salesAmount: sum(sales, "amount"),testSalesCount:sales.filter(x=>testIds.has(x.id)).length,formalSalesCount:sales.filter(x=>!testIds.has(x.id)).length,sourceAnnotations,confirmedReturnRemainder:round(sourceAnnotations.reduce((n,x)=>n+x.remainder,0)),
    returnCount: returns.length, returnAmount: returnFaceAmount, actualRefundAmount, declaredRefundAmount, cancelledUnreceivedReturnAmount, refundUnrecordedAmount, refundDifferenceAmount, refundDifferenceNote:"原成交额冲减销售；实际退款只按退款资金流水，未收款撤单不算实退；登记应退与成交差额另核。",
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
    accountTotals,paymentAccountTotals:Object.values(paymentAccountTotals), ...cashBasis,
    salePaymentRows: paymentAudit.rows, salePaymentRecordedAmount: paymentAudit.recordedAmount,
    salePaymentOutstandingAmount: paymentAudit.outstandingAmount, salePaymentUnsettledCount: paymentAudit.unsettledCount,
    salePaymentUnknownCount: paymentAudit.unknownCount, salePaymentUnverifiedRecordedAmount: paymentAudit.unverifiedRecordedAmount,
    cashHandoverConfirmed: cashHandover.confirmed, cashHandoverPending: cashHandover.pending.map((r) => ({ id: r.id, amount: r.amount, recipient: r.recipient })), cashHandoverDisputed: cashHandover.disputed.map((r) => ({ id: r.id, amount: r.amount, countedAmount: r.countedAmount })),
    stockMovementCount: movements.length, inventory, inventoryBasis: inventoryBasis(store,date), inventoryStatus, inventoryAsOf, inventoryCloseoutId:saved?.id||null, inventoryNote, supplierTotals, customerReceivables: null,
    openingCashSuggested: cashBasis.openingCashSuggested,
    mobileServiceCount: (store.carrierServices || []).filter((r) => r.serviceDate === date).length,
  };
}
function hideSnapshot(shot, user) {
  if (!shot) return;
  const caps = c.capabilities(user);
  delete shot.inventoryBasis; // Server-only fingerprint evidence includes valuation; never expose it in a DTO.
  if(user.roleCode!=="owner"&&shot.mobileCoinClaims)shot.mobileCoinClaims=shot.mobileCoinClaims.filter(r=>require("./mobile-coin-claims").visible(r,user));
  if(user.roleCode!=='owner'){delete shot.sourceAnnotations;delete shot.confirmedReturnRemainder;}
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
  const copy = structuredClone(row);copy.needsAccountCorrection=copy.snapshot.fundAccounts?.policy!==require("./named-fund-accounts").POLICY;copy.needsCashBasisCorrection=row.snapshot.cashBasisPolicy!==require('./cash-basis').POLICY;
  hideSnapshot(copy.snapshot, user);
  for (const revision of copy.revisions || []) hideSnapshot(revision.snapshot, user);
  for (const original of copy.withdrawnSubmissions || []) hideSnapshot(original.snapshot, user);
  Object.assign(copy,require('./daily-close-withdrawal').meta(row,user));
  return copy;
}
function preview(store, user, date) {
  c.permit(user, "sell");
  const shot = snapshot(store, date);
  hideSnapshot(shot, user);
  return shot;
}
function list(store, user, options={}) {
  const visible=(store.dailyCloseouts || []).filter((r) => user.roleCode === "owner" || r.cashierId === user.id || r.reviewerId === user.id).reverse();
  const selected=options.id?visible.filter(r=>r.id===options.id):options.limit?visible.slice(0,options.limit):visible;
  return selected.map((r) => publicRow(r, user));
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
  if(date!==c.day())throw new c.HttpError(409,"即时扎账只办理北京时间今天，请刷新；历史记录请到当日扎账查询");
  if (!require("./named-fund-accounts").applies(date)||date>c.day()) throw new c.HttpError(400,"新扎账方式从2026-10-22开始，已处理好的更早历史账保留查询；请选择起点以后且不晚于今天的营业日");
  if ((store.dailyCloseouts || []).some((r) => r.date === date && r.status === "已锁定"))
    throw new c.HttpError(409, "该营业日已锁定，需先由老板解锁");
  const reviewer = active(store, payload.reviewerId);
  if (!reviewer || reviewer.id === user.id || reviewer.roleCode === "owner" || !c.capabilities(reviewer).sell)
    throw new c.HttpError(400, "请选择另一名有开单权限的在职营业员复核");
  if(payload.recordType!=null&&!["temporary","formal"].includes(payload.recordType))throw new c.HttpError(400,"请选择临时或正式扎账");
  const manual = validateManual(payload.manual || {});
  const shot = snapshot(store, date);
  shot.mobile = mobileRows(store, date, manual);
  const walletMovementReview=require('./wallet-daily').reviewMovement(shot.wallet,payload,user);
  const walletCheck=require('./wallet-daily').confirm(shot.wallet,payload);
  const accountChecks=require("./named-fund-accounts").checks(shot.fundAccounts,payload.accountChecks||{});
  if (payload.actualCash == null || payload.actualCash === "") throw new c.HttpError(400, "请手工填写抽屉实点现金");
  if (shot.openingCashSuggested == null && (payload.openingCash == null || payload.openingCash === "")) throw new c.HttpError(400, "首次或断档扎账须手工填写现金期初");
  const actualCash = c.money(payload.actualCash, "抽屉实点现金");
  const openingCash = shot.openingCashSuggested == null ? c.money(payload.openingCash, "现金期初") : shot.openingCashSuggested;
  const expectedCash = require('./cash-basis').expected(openingCash,shot);
  const cashDifference = round(actualCash - expectedCash);
  const note = String(payload.note || "").trim().slice(0, 1000);
  if (shot.openingCashSuggested == null && !note) throw new c.HttpError(400, "首次或断档扎账请说明现金期初核对依据");
  if (cashDifference && !note) throw new c.HttpError(400, "现金有差异，请填写原因");
  if (walletCheck.difference && !note) throw new c.HttpError(400, "门店微信余额有差异，请填写原因");
  const previous=(store.dailyCloseouts||[]).filter(r=>r.date===date);
  const sequence=previous.length+1,prior=previous.at(-1);
  const row = { id: c.id("DC"), displayNo:"ZZ-"+date.replace(/-/g,"")+"-"+String(sequence).padStart(3,"0"), sequence, recordType:payload.recordType==="formal"?"formal":"temporary",isFormal:payload.recordType==="formal",supersedesId:prior?.id||null, date, status: "待领取复核", cashierId: user.id, cashier: user.name,
    reviewerId: reviewer.id, reviewer: reviewer.name, submittedAt: c.now(), snapshot: shot, manual,accountChecks,walletMovementReview,walletActualBalance:walletCheck.actual,walletDifference:walletCheck.difference,walletCheckedBy:user.id,
    openingCash, actualCash, expectedCash, cashDifference, note, revisions: [], events: [{ type: "提交", by: user.id, at: c.now() }] };
  store.dailyCloseouts ||= [];
  for(const earlier of previous.filter(r=>!["已锁定","已解锁","已驳回","已被后次替代","已撤回"].includes(r.status))){earlier.status="已被后次替代";earlier.supersededBy=row.id;earlier.events||=[];earlier.events.push({type:"被后次扎账替代",by:user.id,at:row.submittedAt});}
  store.dailyCloseouts.push(row);
  c.audit(store, user, "daily-close:submit", row.id);
  notice(store,"daily-close:"+row.id,"即时扎账待复核",{id:row.id,summary:user.name+" 提交 "+date+" · "+row.displayNo+"；门店现金应点 "+expectedCash+" / 实点 "+actualCash+"；"+shot.fundAccounts.rows.map(a=>a.name+"：收 "+a.received+" / 付 "+a.paid+" / 净变动 "+a.net+" / 待确认 "+a.pending).join("；")+"；待 "+reviewer.name+" 复核。账户核对及扎账签认不表示个人收到款项。"});
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
  const requiredChecks = ["sales", "stock", "serials", "cash", "mobile", "suppliers", "wallet"];
  if (decision === "待老板签认" && !requiredChecks.every((key) => payload.checks?.[key] === true)) throw new c.HttpError(400, "须逐栏勾选交易、库存、串码、现金、空充及具体资金账户和往来核对");
  if (decision === "待老板签认" && row.snapshot.fingerprint !== fingerprint(store, row.date)) throw new c.HttpError(409, "原单或收款状态已变化，请驳回后重新生成扎账快照");
  if(decision==='待老板签认'&&(row.snapshot.cashBasisPolicy!==require('./cash-basis').POLICY||row.snapshot.cashBasisFingerprint!==require('./cash-basis').snapshot(store,row.date).cashBasisFingerprint))throw new c.HttpError(409,'现金计算口径或来源已变化，请退回重核');
  if (decision === '待老板签认') { require('./wallet-book-balance').assertFresh(store,row); if(require('./named-fund-accounts').applies(row.date))require('./named-fund-accounts').assertFresh(store,row);if(require('./named-fund-accounts').applies(row.date)&&row.walletMovementReview?.policy!=="store-wallet-daily-movement-v1")throw new c.HttpError(409,'请退回补核门店微信当日增加和减少'); if(require("./named-fund-accounts").applies(row.date)&&(row.accountChecks||[]).some(a=>a.requiresCheck&&a.actual==null))throw new c.HttpError(400,'请退回营业员逐账户填写本日实际净变动，不能使用合并总数核对'); }
  const differences = row.snapshot.mobile.filter((r) => r.status === "有差异" || r.status === "我方缺基础数据");
  if ((decision === "已驳回" || row.cashDifference || row.walletDifference || differences.length) && !note)
    throw new c.HttpError(400, "存在疑义或差异，请填写复核说明");
  row.status = decision;
  row.reviewNote = note;
  row.checks = decision === "待老板签认" ? Object.fromEntries(requiredChecks.map((key) => [key, true])) : {};
  row.reviewedAt = c.now();
  row.events.push({ type: payload.decision, by: user.id, at: row.reviewedAt, note });
  c.audit(store, user, "daily-close:review", row.id + " " + decision);
  notice(store, "daily-close-review:" + row.id + ":" + row.events.length, "即时扎账复核结果", { id: row.id, summary: row.date + " · " + decision + (note ? " · " + note : "") });
  return publicRow(row, user);
}
function resubmit(store, user, payload) {
  const row = find(store, payload.id);
  if(!require("./named-fund-accounts").applies(row.date))throw new c.HttpError(409,"更早的已处理历史账保持不动，本次新流程从2026-10-22开始");
  if (row.cashierId !== user.id || !["已驳回","已撤回"].includes(row.status)) throw new c.HttpError(403, "只能补正本人被驳回的扎账单");
  if((store.dailyCloseouts||[]).some(x=>x.date===row.date&&Date.parse(x.submittedAt)>Date.parse(row.submittedAt)&&!["已驳回","已撤回","已被后次替代"].includes(x.status)))throw new c.HttpError(409,"这天已有更新的扎账单，请按最新单核对");
  row.revisions.push({ snapshot: row.snapshot, manual: row.manual, actualCash: row.actualCash, walletActualBalance:row.walletActualBalance,walletDifference:row.walletDifference,walletMovementReview:row.walletMovementReview,accountChecks:row.accountChecks,note: row.note, at: c.now() });
  const manual = validateManual(payload.manual || row.manual);
  row.snapshot = snapshot(store, row.date);
  row.accountChecks=require("./named-fund-accounts").checks(row.snapshot.fundAccounts,payload.accountChecks||{});
  row.walletMovementReview=require('./wallet-daily').reviewMovement(row.snapshot.wallet,payload,user);const walletCheck=require('./wallet-daily').confirm(row.snapshot.wallet,payload);row.walletActualBalance=walletCheck.actual;row.walletDifference=walletCheck.difference;row.walletCheckedBy=user.id;
  row.snapshot.fingerprint = fingerprint(store, row.date);
  const cashHandover = cashHandoverTotals(store, row.date);
  row.snapshot.cashHandoverConfirmed = cashHandover.confirmed;
  row.snapshot.cashHandoverPending = cashHandover.pending.map((r) => ({ id: r.id, amount: r.amount, recipient: r.recipient }));
  row.snapshot.cashHandoverDisputed = cashHandover.disputed.map((r) => ({ id: r.id, amount: r.amount, countedAmount: r.countedAmount }));
  row.snapshot.mobile = mobileRows(store, row.date, manual);
  row.manual = manual;
  if (payload.actualCash == null || payload.actualCash === "") throw new c.HttpError(400, "补正时请重新手工填写实点现金");
  if (payload.openingCash == null || payload.openingCash === "") throw new c.HttpError(400, "补正时请核对并填写现金期初");
  row.actualCash = c.money(payload.actualCash, "抽屉实点现金");
  row.openingCash = row.snapshot.openingCashSuggested==null?c.money(payload.openingCash, "现金期初"):row.snapshot.openingCashSuggested;
  row.expectedCash = require('./cash-basis').expected(row.openingCash,row.snapshot);
  row.cashDifference = round(row.actualCash - row.expectedCash);
  row.note = String(payload.note || "").trim().slice(0, 1000);
  if (row.snapshot.openingCashSuggested == null && !row.note) throw new c.HttpError(400, "首次或断档扎账请说明现金期初核对依据");
  if (row.cashDifference && !row.note) throw new c.HttpError(400, "现金差异须填写原因");
  if (row.walletDifference && !row.note) throw new c.HttpError(400, "门店微信余额有差异，请填写原因");
  row.status = "待领取复核";
  row.submittedAt=c.now();
  row.events.push({ type: "补正再提交", by: user.id, at: c.now() });
  c.audit(store, user, "daily-close:resubmit", row.id);
  notice(store, 'daily-close-resubmit:' + row.id + ':' + row.events.length, '即时扎账补正待复核', { id: row.id, summary: row.date + ' · ' + row.reviewer + ' 请重新领取复核' });
  return publicRow(row, user);
}
function lock(store, user, payload) {
  if (user.roleCode !== "owner") throw new c.HttpError(403, "只有老板可以签认锁定");
  const row = find(store, payload.id);
  if (row.status !== "待老板签认") throw new c.HttpError(409, "须先由另一名营业员复核通过");
  if (row.date >= c.day()) throw new c.HttpError(409, "当日仍可能继续营业，请次日签认锁定");
  if((store.dailyCloseouts||[]).some(x=>x.date===row.date&&x.id!==row.id&&x.status==="已锁定"))throw new c.HttpError(409,"该营业日已有已锁定的最终扎账单");
  if((store.dailyCloseouts||[]).some(x=>x.date===row.date&&Date.parse(x.submittedAt)>Date.parse(row.submittedAt)&&!["已驳回","已撤回","已被后次替代"].includes(x.status)))throw new c.HttpError(409,"已有更新的扎账单，只能签认最新的一张");
  if(row.snapshot.cashBasisPolicy!==require('./cash-basis').POLICY)throw new c.HttpError(409,'请先重算现金口径后再签认');
  if(row.snapshot.cashBasisFingerprint!==require('./cash-basis').snapshot(store,row.date).cashBasisFingerprint)throw new c.HttpError(409,'现金来源已变化，请退回重核');
  const handovers = cashHandoverTotals(store, row.date);
  if (handovers.pending.length || handovers.disputed.length) throw new c.HttpError(409, "当天还有未确认或有异议的现金交接，暂不能锁账");
  if (row.snapshot.fingerprint !== fingerprint(store, row.date)) throw new c.HttpError(409, "该日有新业务或流水，须重新生成扎账快照");
  const note = String(payload.note || "").trim().slice(0, 1000);
  if(require("./named-fund-accounts").applies(row.date)){require("./named-fund-accounts").assertFresh(store,row);if(row.walletMovementReview?.policy!=="store-wallet-daily-movement-v1"||row.walletMovementReview.inChecked!==true||row.walletMovementReview.outChecked!==true)throw new c.HttpError(409,"门店微信当日增加和减少未分别核对，请退回重核");}
  if(require("./named-fund-accounts").applies(row.date)&&(row.accountChecks||[]).some(a=>a.requiresCheck&&a.actual==null))throw new c.HttpError(409,"具体账户尚未填报，不能签认旧合并结果");
  if(require("./named-fund-accounts").applies(row.date)&&row.snapshot.fundAccounts.rows.some(a=>a.requiresCheck&&a.identityStatus!=="identified"))throw new c.HttpError(409,"仍有具体账户待核，请先核实原流水所属账户，不能将渠道当作账户锁账");
  const unresolved = row.snapshot.mobile.filter((m) => m.status !== "一致");
  if(require('./named-fund-accounts').applies(row.date)&&unresolved.length)throw new c.HttpError(409,"空充或移动BOSS仍有待抄录、差异或缺少基础数据，请先补录或查清差异，再退回重核后签认");
  const walletSettlement=require('./wallet-book-balance').settlement(store,row,user,payload);
  // The original closeout and reviewer evidence remain visible; the owner's note is optional.
  row.status = "已锁定"; row.lockedAt = c.now(); row.lockedBy = user.id; row.lockNote = note;
  row.walletSettlement=walletSettlement;
  row.walletBookClosingBalance=walletSettlement.bookClosingBalance;
  row.walletDifference=walletSettlement.bookClosingBalance==null?null:round(row.walletActualBalance-walletSettlement.bookClosingBalance);
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
  if (kind === "opening") {
    if (user.roleCode !== "owner") throw new c.HttpError(403, "空充期初须老板登记");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0,10) !== date || date > c.day())
      throw new c.HttpError(400, "期初日期须为今天或之前的有效日期");
    if ((store.airRechargeEvents || []).length) throw new c.HttpError(409, "空充台账已有流水，不能重复或倒插期初");
    if ((store.dailyCloseouts || []).some((r) => r.date >= date && ["已锁定", "已复核", "待老板签认"].includes(r.status)))
      throw new c.HttpError(409, "起始日期之后已有确认的扎账，请使用后续调整处理");
  } else if (date !== c.day()) throw new c.HttpError(400, "空充余额只登记今天；历史差异请走审批补录");
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
  const bankRef = require("./air-accounts").optionalRef(payload.bankRef); // 空充流水号选填 v74
  const platformRef = require("./air-accounts").optionalRef(payload.platformRef);
  if ((store.airRechargeEvents || []).some((r) => (platformRef && r.reference === platformRef) || (bankRef && r.bankRef === bankRef)))
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
      " 元；手续费按登记费率核对" });
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
  const platformRef = require("./air-accounts").optionalRef(payload.platformRef);
  if (platformRef && (store.airRechargeEvents || []).some((r) => r.reference === platformRef))
    throw new c.HttpError(409, "移动BOSS流水号已登记");
  const balance = round((store.airRechargeEvents || []).reduce((n, r) => n + Number(r.amount || 0), 0) - debitAmount);
  if (balance < 0) throw new c.HttpError(409, "平台可用余额不足");
  const cashCustody=require("./cash-custody").place(store,user,payload);
  const row = { id:c.id("AIR"), kind:"customer_recharge", amount:-debitAmount,
    debitAmount, cashReceived, balance, reference:platformRef,cashDestination:cashCustody.cashDestination,
    customerPhone:phone, customerMask:phone.slice(0,3)+"****"+phone.slice(-4),
    businessDate:date, createdAt:c.now(), operatorId:user.id, operator:user.name,
    note:String(payload.note||"").trim().slice(0,500) };
  store.airRechargeEvents ||= [];
  store.airRechargeEvents.push(row);
  store.receipts.push({id:c.id("RC"),kind:"cash_recharge",sourceId:row.id,
    amount:cashReceived,account:"现金",...cashCustody,transactionDate:date,operatorId:user.id,
    createdAt:row.createdAt});
  require('./payroll').accrueBusiness(store,row.id);
  store.customers ||= [];
  let client=store.customers.find(r=>r.phone===phone);
  if(!client){client={id:c.id('CU'),phone,name:'',createdAt:c.now()};store.customers.unshift(client);}
  row.customerId=client.id;
  row.receptionPolicy='reception-suspended-v1';
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




