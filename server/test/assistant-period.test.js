'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'xlsx') return {};
  return originalLoad.call(this, name, ...args);
};
const c = require('../src/common');
const period = require('../src/assistant-period');
const assistant = require('../src/personal-assistant');

const owner = { id: 'boss', name: '老板', roleCode: 'owner', status: 'active' };
const staffA = { id: 'a', name: '店员甲', roleCode: 'employee', status: 'active', permissions: ['sale:create'] };
const staffB = { ...staffA, id: 'b', name: '店员乙' };
const manager = { id: 'manager', name: '店长', roleCode: 'manager', status: 'active' };
const today = c.day();
const shift = (date, days) => c.day(new Date(date + 'T12:00:00+08:00').getTime() + days * 86400000);
const at = (date) => date + 'T12:00:00+08:00';
const startDate = shift(today, -3), endDate = shift(today, -1);
const range = startDate + '到' + endDate;
function sale(id, date, employee, skuId, quantity, amount, profit) {
  const name = skuId === 'hw' ? '华为 Mate 手机' : 'OPPO Reno 手机';
  return { id, operatorId: employee.id, salespersonId: employee.id, createdAt: at(date), amount, profit,
    items: [{ id: id + '-item', skuId, name, type: '智能机', quantity, amount, profit, salePrice: amount / quantity, costPrice: (amount - profit) / quantity }] };
}
function fixture() {
  const old = sale('SO-old', shift(today, -15), staffA, 'hw', 1, 800, 80);
  old.giftCost = 55;
  old.giftOrders = [
    { id: 'GIFT-period', cost: 30, createdAt: at(startDate), items: [{ skuId: 'case', name: '手机壳', quantity: 1, cost: 30, unitCost: 30 }] },
    { id: 'GIFT-only', cost: 25, createdAt: at(shift(today, -7)), items: [{ skuId: 'case', name: '手机壳', quantity: 1, cost: 25, unitCost: 25 }] },
  ];
  return c.initialize({ users: [owner, staffA, staffB, manager],
    products: [{ skuId: 'hw', name: '华为 Mate 手机', type: '智能机', active: true }, { skuId: 'oppo', name: 'OPPO Reno 手机', type: '智能机', active: true }],
    sales: [old, sale('SO-start', startDate, staffA, 'hw', 2, 2000, 400), sale('SO-middle', shift(today, -2), staffA, 'oppo', 1, 1500, 300), sale('SO-end', endDate, staffB, 'hw', 3, 3000, 600), sale('SO-outside', today, staffB, 'hw', 5, 5000, 1000)],
    saleReturns: [{ ...sale('SR-in', endDate, staffA, 'hw', 1, 800, 80), orderId: old.id }, { ...sale('SR-outside', today, staffA, 'hw', 1, 1000, 200), orderId: 'SO-start' }],
    costAdjustments: [{ id: 'CA-in', orderId: old.id, itemId: old.items[0].id, skuId: 'hw', costDelta: 20, createdAt: at(shift(today, -2)) }, { id: 'CA-only', orderId: old.id, itemId: old.items[0].id, skuId: 'hw', costDelta: 5, createdAt: at(shift(today, -7)) }, { id: 'CA-outside', orderId: 'SO-outside', skuId: 'hw', costDelta: 90, createdAt: at(today) }],
  });
}
const ask = (store, user, question, extra = {}) => assistant.ask(store, user, { question, ...extra });
const expectRange = (actual, start, end) => {
  assert.ok(actual);
  assert.equal(actual.startDate, start);
  assert.equal(actual.endDate, end);
  assert.ok(actual.label);
};

test('期间解析按周一和自然月处理，支持跨年、闰月与完整日期', () => {
  expectRange(period.parse('本周华为手机销量', '2026-10-10'), '2026-10-05', '2026-10-10');
  expectRange(period.parse('上周营业额', '2026-10-10'), '2026-09-28', '2026-10-04');
  expectRange(period.parse('本月销量', '2026-10-10'), '2026-10-01', '2026-10-10');
  expectRange(period.parse('上个月销售额', '2027-01-01'), '2026-12-01', '2026-12-31');
  expectRange(period.parse('上月毛利', '2028-03-01'), '2028-02-01', '2028-02-29');
  expectRange(period.parse('最近7天销量', '2026-10-10'), '2026-10-04', '2026-10-10');
  expectRange(period.parse('2026-09-28到2026-10-04手机销量', '2026-10-10'), '2026-09-28', '2026-10-04');
  expectRange(period.parse('2026年9月营业额', '2026-10-10'), '2026-09-01', '2026-09-30');
  expectRange(period.parse('今年毛利', '2026-10-10'), '2026-01-01', '2026-10-10');
  expectRange(period.parse('去年毛利', '2026-10-10'), '2025-01-01', '2025-12-31');
  assert.equal(period.parse('今天手机销量', '2026-10-10'), null);
});

test('非法日期、逆序和超过366天的期间均拒绝', () => {
  for (const question of ['2026-02-31到2026-03-02销量', '2026-10-05到2026-10-04销量', '2025-01-01到2026-01-02销量']) {
    assert.throws(() => period.parse(question, '2026-10-10'), error => error instanceof c.HttpError, question);
  }
  expectRange(period.parse('2026-10-04到2026-10-04销量', '2026-10-10'), '2026-10-04', '2026-10-04');
});

test('多日汇总按发生日计退货、补赠与成本调整，查询不写账', () => {
  const store = fixture(), before = JSON.stringify(store);
  const result = ask(store, owner, range + '营业额');
  assert.equal(result.metrics.kind, 'sales-period');
  assert.equal(result.metrics.queryType, 'summary');
  assert.equal(result.metrics.startDate, startDate);
  assert.equal(result.metrics.endDate, endDate);
  assert.equal(result.metrics.soldUnits, 6);
  assert.equal(result.metrics.returnedUnits, 1);
  assert.equal(result.metrics.netUnits, 5);
  assert.equal(result.metrics.orderCount, 3);
  assert.equal(result.metrics.returnOrderCount, 1);
  assert.equal(result.metrics.salesAmount, 6500);
  assert.equal(result.metrics.returnAmount, 800);
  assert.equal(result.metrics.netSales, 5700);
  assert.equal(result.metrics.giftCost, 30);
  assert.equal(result.metrics.costAdjustmentProfit, -20);
  assert.equal(result.metrics.adjustedGrossProfit, 1170);
  assert.ok(!result.sources.some(row => row.id === 'SO-outside' || row.id === 'SR-outside'));
  const profit = ask(store, owner, '详细核算' + range + '销售毛利');
  assert.equal(profit.metrics.queryType, 'profit');
  assert.equal(profit.metrics.adjustedGrossProfit, 1170);
  assert.equal(JSON.stringify(store), before);
});

test('品牌和营业员共同筛选，明细只列匹配商品和授权单据', () => {
  const store = fixture();
  const volume = ask(store, owner, '详细统计' + range + '店员甲营业员华为手机销量');
  assert.equal(volume.metrics.queryType, 'volume');
  assert.equal(volume.metrics.brand, '华为');
  assert.equal(volume.metrics.staffId, 'a');
  assert.equal(volume.metrics.phonesOnly, true);
  assert.equal(volume.metrics.soldUnits, 2);
  assert.equal(volume.metrics.returnedUnits, 1);
  assert.equal(volume.metrics.netUnits, 1);
  assert.equal(volume.metrics.orderCount, 1);
  assert.ok(!volume.sources.some(row => row.id === 'SO-middle' || row.id === 'SO-end'));
  const items = ask(store, owner, range + '华为手机卖了什么');
  assert.equal(items.metrics.queryType, 'items');
  assert.match(items.answer, /华为/);
  assert.doesNotMatch(items.answer, /OPPO/);
  const summary = ask(store, owner, range + '店员甲销售额');
  assert.equal(summary.metrics.queryType, 'summary');
  assert.equal(summary.metrics.netSales, 2700);
});

test('上海时区午夜两端包含，紧邻范围外的UTC单据排除', () => {
  const store = c.initialize({ users: [owner, staffA], products: [{ skuId: 'hw', name: '华为手机', type: '智能机' }], sales: [] });
  const start = shift(today, -3), end = shift(today, -1);
  const startMs = new Date(start + 'T00:00:00+08:00').getTime();
  const endMs = new Date(end + 'T23:59:59.999+08:00').getTime();
  for (const [id, instant] of [['before', startMs - 1], ['first', startMs], ['last', endMs], ['after', endMs + 1]]) {
    store.sales.push({ ...sale(id, start, staffA, 'hw', 1, 100, 10), createdAt: new Date(instant).toISOString() });
  }
  const result = ask(store, owner, start + '到' + end + '手机销量');
  assert.equal(result.metrics.soldUnits, 2);
  assert.equal(result.metrics.netUnits, 2);
  assert.ok(result.sources.some(row => row.id === 'first'));
  assert.ok(result.sources.some(row => row.id === 'last'));
  assert.ok(!result.sources.some(row => row.id === 'before' || row.id === 'after'));
});

function assertNoCostValues(value, path = 'response') {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/profit|cost/i.test(key) && nested !== null && nested !== undefined) {
      assert.fail(path + '.' + key + ' contains an unauthorized cost/profit field');
    }
    assertNoCostValues(nested, path + '.' + key);
  }
}

test('员工本人金额、经理全店金额和顾客模式均不泄露成本毛利', () => {
  const store = fixture();
  const own = ask(store, staffA, '详细统计' + range + '营业额');
  assert.equal(own.metrics.netSales, 2700);
  assert.ok(!own.sources.some(row => row.id === 'SO-end'));
  assertNoCostValues({ metrics: own.metrics, table: own.table });
  assert.doesNotMatch(own.answer, /销售毛利|赠品成本|成本调整/);
  const all = ask(store, manager, '详细统计' + range + '营业额');
  assert.equal(all.metrics.netSales, 5700);
  assertNoCostValues({ metrics: all.metrics, table: all.table });
  for (const user of [staffA, manager]) {
    const denied = ask(store, user, range + '销售毛利');
    assert.match(denied.answer, /没有.*毛利.*权限/);
    assertNoCostValues({ metrics: denied.metrics, table: denied.table });
  }
  const other = ask(store, staffB, range + '店员甲营业员华为手机销量');
  assert.match(other.answer, /没有.*其他.*权限/);
  assert.equal(other.metrics?.netSales, undefined);
  const customer = ask(store, owner, range + '销售毛利', { mode: 'customer' });
  assert.equal(customer.metrics.restricted, true);
  assertNoCostValues({ metrics: customer.metrics, table: customer.table });
  assert.deepEqual(customer.sources, []);
});

test('详细一点和那上个月呢保留品牌及营业员，并重新读取账套', () => {
  const store = fixture(), currentStart = today.slice(0, 7) + '-01';
  const priorEnd = shift(currentStart, -1), priorStart = priorEnd.slice(0, 7) + '-01';
  store.sales = [sale('SO-month', currentStart, staffA, 'hw', 2, 2000, 400), sale('SO-previous', priorStart, staffA, 'hw', 3, 3000, 600), sale('SO-other-brand', priorStart, staffA, 'oppo', 9, 9000, 900), sale('SO-other-staff', priorStart, staffB, 'hw', 8, 8000, 800)];
  store.saleReturns = []; store.costAdjustments = [];
  const first = ask(store, owner, '本月店员甲营业员华为手机销量');
  assert.equal(first.metrics.netUnits, 2);
  store.sales.push(sale('SO-month-added', currentStart, staffA, 'hw', 1, 1000, 200));
  const detailed = ask(store, owner, '详细一点', { context: first.context });
  assert.equal(detailed.metrics.netUnits, 3);
  const previous = ask(store, owner, '那上个月呢', { context: detailed.context });
  assert.equal(previous.metrics.netUnits, 3);
  assert.equal(previous.metrics.startDate, priorStart);
  assert.equal(previous.metrics.endDate, priorEnd);
  for (const result of [first, detailed, previous]) {
    assert.equal(result.metrics.brand, '华为');
    assert.equal(result.metrics.staffId, 'a');
    assert.equal(result.metrics.phonesOnly, true);
  }
  const foreign = ask(store, staffB, '详细一点', { context: first.context });
  assert.equal(foreign.context.question, '详细一点');
  const expired = ask(store, owner, '那上个月呢', { context: { ...first.context, at: Date.now() - 31 * 60000 } });
  assert.equal(expired.context.question, '那上个月呢');
});

test('空期间和只有范围外原单补赠的期间均有明确金额与毛利', () => {
  const store = fixture(), before = JSON.stringify(store);
  const emptyDate = shift(today, -10);
  const empty = ask(store, owner, emptyDate + '到' + emptyDate + '营业额');
  assert.equal(empty.metrics.orderCount, 0);
  assert.equal(empty.metrics.netSales, 0);
  assert.equal(empty.metrics.adjustedGrossProfit, 0);
  const giftDate = shift(today, -7);
  const gifts = ask(store, owner, giftDate + '到' + giftDate + '销售毛利');
  assert.equal(gifts.metrics.orderCount, 0);
  assert.equal(gifts.metrics.salesAmount, 0);
  assert.equal(gifts.metrics.giftCost, 25);
  assert.equal(gifts.metrics.costAdjustmentProfit, -5);
  assert.equal(gifts.metrics.adjustedGrossProfit, -30);
  assert.doesNotMatch(gifts.answer, /暂无销售毛利/);
  assert.equal(JSON.stringify(store), before);
});


// Guards against the two accounting defects found while implementing periods.
test('有毛利权限但仅能看本人时，调价归属不串入其他营业员', () => {
  const store=fixture(),profitUser={...staffA,permissions:['sale:create','finance:view_profit']};
  store.costAdjustments.push({id:'CA-other',orderId:'SO-end',costDelta:888,createdAt:at(startDate)});
  const own=ask(store,profitUser,'详细'+range+'销售毛利');
  assert.equal(own.metrics.adjustedGrossProfit,570);
  assert.equal(own.metrics.costAdjustmentProfit,-20);
  assert.ok(!own.table.rows.some(row=>row.id==='CA-other'));
  const erp=require('../src/erp');
  assert.ok(erp.report(store,profitUser,startDate).summary.costAdjustmentProfit===0);
});
test('日统计补赠调价不误报无毛利，经手他人退货不扣本人销量', () => {
  const store=fixture(),giftDate=shift(today,-7);
  const gift=ask(store,owner,giftDate+'销售毛利');
  assert.match(gift.answer,/销售毛利 ¥-30.00/);
  store.saleReturns.push({...sale('SR-handled',today,staffB,'hw',1,100,10),operatorId:staffA.id});
  const own=ask(store,staffA,'今天手机销量');
  assert.equal(own.metrics.returnedUnits,1);
});
test('月份及多时段不猜测，非法单日不能静默当今天', () => {
  for(const q of ['2026年13月销量','2026-13-01销量','本月和上个月销量','2026-10-01到10-09销量','9月1日到9月9日销量','9月销量'])assert.throws(()=>ask(fixture(),owner,q),error=>error instanceof c.HttpError);
  assert.equal(ask(fixture(),owner,'本月营业额同比').unsupportedRange,true);
  expectRange(period.parse('过去七天销量','2026-10-10'),'2026-10-04','2026-10-10');
});
