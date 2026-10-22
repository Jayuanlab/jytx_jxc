'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...args) { if (request === 'xlsx') return {}; return originalLoad.call(this, request, ...args); };
const c = require('../src/common');
const importer = require('../src/employee-knowledge-import');
const assistant = require('../src/personal-assistant');
const batches = ['mobile-20261009', 'customer-talk-20261009'].map(batch => JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/knowledge-imports', batch, 'bundle.json'), 'utf8')));
const owner = { id: 'owner', name: '仅账号内的老板名字', roleCode: 'owner', status: 'active' };
const staff = { id: 'staff', name: '营业员甲', roleCode: 'employee', status: 'active', permissions: ['sale:create'] };
const other = { id: 'other', name: '营业员乙', roleCode: 'employee', status: 'active', permissions: ['sale:create'] };
function businessData(store) { return Object.fromEntries(Object.entries(store).filter(([key]) => !['employeeKnowledge', 'knowledgeImports', 'operationLogs'].includes(key))); }
function fixture() {
  const store = c.initialize({ users: [owner, staff, other], products: [
    { skuId: 'elderly-cheap', name: '天语 K1', externalCode: 'F001', type: '功能机', subType: '天语', active: true, stockManaged: true, salePrice: 99, costPrice: 66, warehouseId: 'wh-a', trackSerial: true },
    { skuId: 'elderly-nokia', name: '诺基亚 105', externalCode: 'F002', type: '功能机', subType: '诺基亚', active: true, stockManaged: true, salePrice: 199, costPrice: 155, warehouseId: 'wh-a', trackSerial: true },
    { skuId: 'huawei', name: '华为 Mate 70', type: '智能机', subType: '华为', active: true, stockManaged: true, salePrice: 5999, costPrice: 5500, warehouseId: 'wh-a', trackSerial: true },
  ], inventory: [
    { skuId: 'elderly-cheap', quantity: 2, serials: [{no:'869000000000001',status:'可售'},{no:'869000000000002',status:'可售'}], warehouseId: 'wh-a', warehouseName: 'A仓·手机数码', costPrice: 66, stockValue: 132 },
    { skuId: 'elderly-nokia', quantity: 2, serials: [{ no: '111111111111111', status: '可售' }, { no: '222222222222222', status: '已售' }], warehouseId: 'wh-a', warehouseName: 'A仓·手机数码', costPrice: 155, stockValue: 310 },
    { skuId: 'huawei', quantity: 1, serials: [{ no: '869123456789012', status: '可售' }], warehouseId: 'wh-a', warehouseName: 'A仓·手机数码', costPrice: 5500, stockValue: 5500 },
  ], sales: [{ id: 'SO-recorded', salespersonId: staff.id, operatorId: staff.id, status: 'completed', createdAt: c.now(), amount: 5999, profit: 499, items: [{ id: 'SI-recorded', skuId: 'huawei', name: '华为 Mate 70', type: '智能机', quantity: 1, amount: 5999, salePrice: 5999, costPrice: 5500, profit: 499 }] }], receipts: [{ id: 'RC-existing', sourceId: 'SO-recorded', kind: '销售收款', amount: 5999, account: '微信', createdAt: c.now() }] });
  const original = JSON.stringify(businessData(store));
  for (const bundle of batches) importer.apply(store, owner, bundle);
  assert.equal(JSON.stringify(businessData(store)), original);
  return store;
}
function ask(store, user, question, options = {}) {
  const before = JSON.stringify(store);
  const result = assistant.ask(store, user, { question, ...options });
  assert.equal(JSON.stringify(store), before, '数字助理问答不得修改账套：' + question);
  return result;
}
function cardConversation(store, user = staff, region = '经常去外地') {
  const business = ask(store, user, '我来办一个业务');
  const card = ask(store, user, '号卡', { context: business.context });
  const newCard = ask(store, user, '新办卡', { context: card.context });
  const budget = ask(store, user, '最多一百元', { context: newCard.context });
  const usage = ask(store, user, '打电话多', { context: budget.context });
  const recommendation = ask(store, user, region, { context: usage.context });
  return { business, card, newCard, budget, usage, recommendation };
}
function assertSourceRows(store, result) {
  assert.ok(result.tariffOptions.length > 0);
  for (const option of result.tariffOptions) {
    const [articleId, blockId, index] = option.id.split(':');
    const article = store.employeeKnowledge.find(row => row.id === articleId);
    const block = article?.sourceBlocks.find(row => row.id === blockId);
    assert.equal(option.articleId, article.id);
    assert.equal(article.policyStatus, 'current');
    assert.equal(option.status, 'current');
    assert.equal(block.kind, 'table');
    const headers = block.rows[0], sourceRow = block.rows[Number(index)];
    assert.ok(sourceRow);
    const value = pattern => sourceRow[headers.findIndex(header => pattern.test(header))];
    assert.equal(Number(String(value(/^月费$/)).match(/^\d+/)[0]), option.baseMonthlyFee);
    assert.equal(Number(value(/^(语音|通话)/)), option.voiceMinutes);
    if (option.universalGB !== null) assert.equal(Number(value(/^通用流量/)), option.universalGB);
    if (option.nationalGB !== null) assert.equal(Number(value(/^全国流量/)), option.nationalGB);
    assert.equal(option.totalMonthlyFee, null, '未核总费用不能使用基础费假充');
    assert.ok(result.sources.some(source => source.id === articleId + ':' + blockId && source.href.includes('/knowledge#')));
  }
}

test('导入两批真实资料，顾客招呼和身份回答真实且默认方言', () => {
  const store = fixture();
  assert.equal(store.knowledgeImports.length, 2);
  assert.equal(store.employeeKnowledge.length, batches.reduce((sum, bundle) => sum + bundle.articles.length, 0));
  for (const question of ['你好', '你好，你在干吗？', '你好，你能干什么？', '你会不会办业务呀？']) {
    const result = ask(store, staff, question);
    assert.equal(result.metrics.kind, 'assistant-social', question);
    assert.equal(result.metrics.replyStyle, 'sichuan', question);
    assert.equal(result.draft, undefined);
    assert.equal(result.saleFlow, undefined);
    assert.doesNotMatch(result.answer, /已办理|已提交|已经成交/);
  }
  for (const question of ['你是哪里的人啊？', '你是不是重庆妹儿？', '你是不是云阳妹儿？', '你是不是南溪街上的？']) {
    const result = ask(store, staff, question);
    assert.equal(result.metrics.topic, 'identity');
    assert.match(result.answer, /数字助理.*不是真人/);
    assert.doesNotMatch(result.answer, /我是(?:重庆|云阳|南溪)(?:人|妹)/);
  }
  for (const question of ['你老板是谁呀？', '帮谁干啊？']) assert.doesNotMatch(ask(store, staff, question).answer, /仅账号内的老板名字|owner|营业员甲/);
  const standard = ask(store, staff, '你好，你能干什么？', { customerReplyStyle: 'mandarin' });
  assert.equal(standard.metrics.replyStyle, 'mandarin');
  assert.doesNotMatch(standard.answer, /啥子|嘛|哈！/);
});

test('泛业务逐步号卡、预算、通话、外地，短回答持续对应真实资费源行', () => {
  const store = fixture();
  const flow = cardConversation(store);
  assert.equal(flow.business.context.businessChoice, true);
  assert.equal(flow.card.context.tariff.awaiting, 'current-plan');
  assert.equal(flow.newCard.context.tariff.awaiting, 'budget');
  assert.equal(flow.budget.context.tariff.awaiting, 'usage');
  assert.equal(flow.budget.context.tariff.profile.budgetMax, 100);
  assert.equal(flow.budget.context.tariff.profile.skipPrevious, true);
  assert.equal(flow.usage.context.tariff.awaiting, 'region');
  assert.equal(flow.usage.context.tariff.profile.usage, 'calls');
  const result = flow.recommendation;
  assert.equal(result.metrics.kind, 'tariff-recommendations');
  assert.equal(result.context.tariff.profile.region, 'travel');
  assert.equal(result.metrics.baseFeesOnly, true);
  assert.equal(result.context.tariff.awaiting, null);
  assert.ok(result.tariffOptions.every(row => row.baseMonthlyFee <= 100 && row.domesticGB !== null && row.family !== 'bayu' && row.family !== 'campus'));
  assert.match(result.answer, /基础费.*总支出还未核准/);
  assertSourceRows(store, result);
  assert.equal(result.draft, undefined);
  assert.equal(result.saleFlow, undefined);
});

test('相同流程可口答本地，未核重庆优惠和定向不得充全国流量', () => {
  const store = fixture(), result = cardConversation(store, staff, '主要在重庆用').recommendation;
  assert.equal(result.context.tariff.profile.region, 'local');
  assert.ok(result.tariffOptions.every(row => row.status === 'current'));
  assert.ok(result.tariffOptions.every(row => row.domesticGB === (row.nationalGB ?? row.universalGB)), '重庆/定向不能混算为全国通用');
  assert.match(result.answer, /仅基础费.*总支出还未核准/);
  assertSourceRows(store, result);
});

test('旧实际月支出只能当需求线索，不能推断旧套餐名称或基础费', () => {
  const store = fixture(), start = ask(store, staff, '我想办张手机卡');
  const previous = ask(store, staff, '原来一个月花六十元，上网不够用', { context: start.context });
  assert.equal(previous.context.tariff.profile.currentMonthlySpend, 60);
  assert.equal(previous.context.tariff.profile.budgetTarget, 60);
  assert.equal(previous.context.tariff.profile.budgetSource, 'previousSpend');
  assert.equal(previous.context.tariff.profile.previousPlanName, undefined);
  assert.equal(previous.context.tariff.profile.baselineBaseFee, undefined);
  const result = ask(store, staff, '经常去外地', { context: previous.context });
  assertSourceRows(store, result);
  assert.match(result.metrics.budgetComparison, /不能据此认定原套餐或总费/);
  const detailed = ask(store, staff, '再看详细条件', {context:result.context});
  assert.match(detailed.answer, /不能据此认定原套餐或总费/);
  assert.equal(result.context.tariff.profile.previousPlanName, undefined);
  assert.equal(result.context.tariff.profile.baselineBaseFee, undefined);
  assert.doesNotMatch(result.answer, /原套餐(?:是|就是).*卡/);
});

test('跨账号、过期或未来的上下文不继承业务选择、预算和资费需求', () => {
  const store = fixture(), flow = cardConversation(store);
  for (const [user, context] of [
    [other, flow.usage.context],
    [staff, { ...flow.usage.context, at: Date.now() - 31 * 60 * 1000 }],
    [staff, { ...flow.usage.context, at: Date.now() + 10000 }],
  ]) {
    const response = ask(store, user, '经常去外地', { context });
    assert.notEqual(response.metrics?.kind, 'tariff-recommendations');
    assert.equal(response.context.tariff, undefined);
    assert.equal(response.tariffOptions, undefined);
  }
  const wrong = ask(store, other, '号卡', { context: flow.business.context });
  assert.equal(wrong.context.businessChoice, undefined);
  assert.notEqual(wrong.context.tariff?.awaiting, 'budget');
});

test('确切校园青春卡59查询从权威原表回答，不能被资费推荐上下文吞掉', () => {
  const store = fixture(), context = cardConversation(store).usage.context;
  for (const question of ['校园青春卡59元档资费是多少', '校园青春卡59有多少分钟和流量']) {
    for (const supplied of [{}, { context }]) {
      const result = ask(store, staff, question, supplied);
      assert.equal(result.metrics.kind, 'store-policy', question);
      assert.equal(result.metrics.articleId, 'mobile-20261009-campus', question);
      assert.equal(result.metrics.sourceTier, 'store_policy');
      assert.match(result.answer, /通话\(分钟\)：300/);
      assert.match(result.answer, /通用流量\(GB\)：20/);
      assert.match(result.answer, /定向流量\(GB\)：30/);
      assert.match(result.answer, /承诺期：3年/);
      assert.doesNotMatch(result.answer, /每月.*预算|打电话多.*上网多|19元档/);
      assert.ok(result.sources.some(row => row.id === 'mobile-20261009-campus:t4'));
    }
  }
});

test('卡咨询中切换实际库存、销量、到账或销售草稿，业务路由保持岗位范围', () => {
  const store = fixture(), context = cardConversation(store).recommendation.context;
  const stock = ask(store, staff, '你好，帮我查华为手机库存', { context });
  assert.notEqual(stock.metrics?.kind, 'tariff-recommendations');
  assert.match(stock.answer, /华为 Mate 70/);
  assert.doesNotMatch(stock.answer, /诺基亚|基础费/);
  const sales = ask(store, owner, '今天手机销量', { context });
  assert.equal(sales.metrics.netUnits, 1);
  assert.equal(sales.metrics.kind, undefined);
  assert.equal(ask(store, other, '今天手机销量', { context }).metrics.netUnits, 0);
  const carrier = ask(store, owner, '今天移动酬金到账多少', { context });
  assert.notEqual(carrier.metrics?.kind, 'tariff-recommendations');
  const sale = ask(store, staff, '你好，帮我开一张销售单', { context });
  assert.equal(sale.action.href, '/app?tab=sales');
  assert.notEqual(sale.metrics?.kind, 'tariff-recommendations');
});

test('老人机推荐只带真实零售价和可售台数，没有成本或提成', () => {
  const store = fixture(), context = cardConversation(store).recommendation.context;
  for (const [question, expected] of [['便宜的功能机/老人机有哪些', [99, 199]], ['老人机预算两百以内', [99, 199]], ['诺基亚105老人机推荐一下', [199]]]) {
    const result = ask(store, staff, question, { context });
    assert.equal(result.metrics.kind, 'product-recommendations', question);
    assert.deepEqual(result.metrics.recommendations.map(row => row.salePrice), expected, question);
    assert.ok(result.metrics.recommendations.every(row => row.availableQuantity > 0));
    assert.doesNotMatch(JSON.stringify(result), /costPrice|stockValue|利润|成本|提成|佣金/);
    assert.equal(result.draft, undefined);
    assert.equal(result.saleFlow, undefined);
    assert.deepEqual(result.sources, []);
    assert.equal(result.action, undefined);
  }
  const standard = ask(store, staff, '便宜的老人机有哪些', { customerReplyStyle: 'mandarin' });
  assert.equal(standard.metrics.replyStyle, 'mandarin');
  assert.doesNotMatch(standard.answer, /哪款嘛/);
});

test('推荐数据是独立投影，顾客不能经答复改商品价格或账目', () => {
  const store = fixture(), before = JSON.stringify(store);
  const product = ask(store, staff, '老人机有哪些');
  product.metrics.recommendations[0].salePrice = 1;
  product.table.rows[0].name = '不能写回商品档案';
  const tariffs = cardConversation(store).recommendation;
  tariffs.context.tariff.profile.budgetMax = 1;
  tariffs.tariffOptions[0].baseMonthlyFee = 1;
  tariffs.tariffOptions[0].conditions.push('不能写回政策');
  assert.equal(JSON.stringify(store), before);
});
