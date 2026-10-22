const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, ...args) { if (request === 'xlsx') return {}; return originalLoad.call(this, request, ...args); };
const c = require('../src/common');
const recommendations = require('../src/assistant-product-query');
const owner = { id: 'owner', name: '老板', roleCode: 'owner', status: 'active' };
const staff = { id: 'staff', name: '店员', roleCode: 'employee', status: 'active', permissions: ['sale:create'] };
const learner = { id: 'learner', name: '学习员', roleCode: 'employee', status: 'active', permissions: [] };
function fixture() {
  const products = [
    { skuId: 'cheap', name: '天语 K1', externalCode: 'F001', type: '功能机', subType: '天语', active: true, stockManaged: true, trackSerial: false, warehouseId: 'wh-a', salePrice: 99, costPrice: 66 },
    { skuId: 'serial', name: '诺基亚 105', type: '功能机', subType: '诺基亚', active: true, stockManaged: true, trackSerial: true, warehouseId: 'wh-a', salePrice: 199, costPrice: 160 },
    { skuId: 'expensive', name: '飞利浦 E', type: '功能机', subType: '飞利浦', active: true, stockManaged: true, warehouseId: 'wh-a', salePrice: 299 },
  ];
  return c.initialize({ users: [owner, staff, learner], products, inventory: [
    { skuId: 'cheap', quantity: 2, warehouseId: 'wh-a', warehouseName: 'A仓·手机数码', costPrice: 66, stockValue: 132, serials: [{no:'444444444444444',status:'可售',costPrice:66},{no:'555555555555555',status:'可售',costPrice:66}] },
    { skuId: 'serial', quantity: 3, warehouseId: 'wh-a', warehouseName: 'A仓·手机数码', costPrice: 160, stockValue: 480, serials: [{ no: '111111111111111', status: '可售', costPrice: 155 }, { no: '222222222222222', status: '未激活', costPrice: 160 }, { no: '333333333333333', status: '已售', costPrice: 166 }] },
    { skuId: 'expensive', quantity: 1, warehouseId: 'wh-a', warehouseName: 'A仓·手机数码', serials: [{no:'666666666666666',status:'可售'}] },
  ] });
}
function add(store, product, stock = {}) {
  store.products.push({ active: true, stockManaged: true, warehouseId: 'wh-a', type: '功能机', ...product });
  store.inventory.push({ skuId: product.skuId, quantity: 1, warehouseId: 'wh-a', warehouseName: 'A仓·手机数码', serials: [{no:String(store.products.length).padStart(15,'0'),status:'可售'}], ...stock });
}
test('cheap elderly phones use actual positive retail prices, real availability and evidence without cost', () => {
  const store = fixture(), before = JSON.stringify(store);
  const result = recommendations.query(store, staff, '便宜的功能机/老人机有哪些？');
  assert.equal(result.metrics.kind, 'product-recommendations');
  assert.equal(result.metrics.replyStyle, 'sichuan');
  assert.deepEqual(result.metrics.recommendations.map(row => [row.skuId, row.salePrice, row.availableQuantity]), [['cheap', 99, 2], ['serial', 199, 2], ['expensive', 299, 1]]);
  assert.match(result.answer, /天语 K1 ¥99.00/);
  assert.match(result.answer, /哪款嘛/);
  assert.doesNotMatch(JSON.stringify(result), /costPrice|stockValue|毛利|成本/);
  assert.deepEqual(result.sources, []);
  assert.equal(result.table.rows[1].availableQuantity, 2);
  assert.equal(result.action, undefined);
  assert.equal(result.draft, undefined);
  assert.equal(JSON.stringify(store), before);
});
test('mandarin, a greeting prefix and elderly synonyms preserve the same real options', () => {
  const store = fixture();
  for (const question of ['你好，便宜的老人机有哪些', '老年机推荐一下', '按键机哪款最便宜', '老人手机有没有实惠的', '老人机多少钱', '老人机有几款']) {
    const result = recommendations.query(store, staff, question, { customerReplyStyle: 'mandarin' });
    assert.equal(result.metrics.replyStyle, 'mandarin', question);
    assert.match(result.answer, /零售价从低到高/, question);
    assert.doesNotMatch(result.answer, /嘛/, question);
    assert.equal(result.metrics.recommendations[0].skuId, 'cheap', question);
  }
});
test('budgets never include more expensive goods and cheapest does not mean an unset zero price', () => {
  const store = fixture();
  add(store, { skuId: 'unset', name: '未设价功能机', salePrice: 0 });
  add(store, { skuId: 'invalid', name: '坏价格功能机', salePrice: 'NaN' });
  for (const question of ['老人机预算200以内', '推荐200元以下的老人机', '老人机不超过200元有哪些']) {
    const result = recommendations.query(store, owner, question);
    assert.equal(result.metrics.budget, 200, question);
    assert.deepEqual(result.metrics.recommendations.map(row => row.salePrice), [99, 199], question);
    assert.equal(result.metrics.unpricedCount, 2);
    assert.match(result.answer, /未设零售价/);
    assert.doesNotMatch(result.answer, /¥0.00/);
  }
  const cheapest = recommendations.query(store, owner, '功能机哪款最便宜');
  assert.equal(cheapest.metrics.recommendations.length, 1);
  assert.equal(cheapest.metrics.minPrice, 99);
  assert.doesNotMatch(cheapest.answer, /诺基亚/);
});
test('disabled, deleted, service and wrong type goods cannot become cheap recommendations', () => {
  const store = fixture();
  add(store, { skuId: 'inactive', name: '停用功能机', active: false, salePrice: 1 });
  add(store, { skuId: 'disabled', name: '禁用功能机', status: 'disabled', salePrice: 1 });
  add(store, { skuId: 'deleted', name: '删除功能机', deletedAt: c.now(), salePrice: 1 });
  add(store, { skuId: 'service', name: '老人机维修', stockManaged: false, salePrice: 1 });
  add(store, { skuId: 'accessory', name: '老人机套', type: '配件', aliases: ['老人机'], salePrice: 1 });
  add(store, { skuId: 'smartname', name: '智能老人机', type: '智能机', salePrice: 1 });
  add(store, { skuId: 'smarttag', name: '适老版智能手机', type: '智能机', aliases: ['老人机'], salePrice: 900 });
  const result = recommendations.query(store, owner, '老人机有哪些？全部列出来');
  assert.deepEqual(result.metrics.recommendations.map(row => row.skuId), ['cheap', 'serial', 'expensive', 'smarttag']);
  const features = recommendations.query(store, owner, '功能机有哪些？全部列出来');
  assert.ok(!features.metrics.recommendations.some(row => row.skuId === 'smarttag'));
});
test('serial availability requires both a positive stock quantity and distinct sellable serials', () => {
  const store = fixture();
  store.inventory[1].quantity = 1;
  store.inventory[1].serials.push({ no: '111111111111111', status: '可售' });
  let result = recommendations.query(store, owner, '诺基亚老人机有哪些');
  assert.equal(result.metrics.recommendations[0].availableQuantity, 1);
  store.inventory[1].quantity = 0;
  result = recommendations.query(store, owner, '诺基亚老人机有哪些');
  assert.equal(result.metrics.recommendations.length, 0);
  store.inventory[1].quantity = 3;
  store.inventory[1].serials.forEach(row => row.status = '已售');
  result = recommendations.query(store, owner, '诺基亚老人机有哪些');
  assert.equal(result.metrics.recommendations.length, 0);
});
test('requested brand and warehouse filter actual stock, including product default sale warehouse', () => {
  const store = fixture();
  add(store, { skuId: 'cphone', name: '诺基亚活动机', subType: '诺基亚', warehouseId: 'wh-c', salePrice: 149 }, { warehouseId: 'wh-c', warehouseName: 'C仓·移动业务' });
  add(store, { skuId: 'wronglocation', name: '诺基亚错仓', subType: '诺基亚', warehouseId: 'wh-a', salePrice: 49 }, { warehouseId: 'wh-c', warehouseName: 'C仓·移动业务' });
  const a = recommendations.query(store, owner, 'A仓便宜的诺基亚老人机有哪些');
  assert.deepEqual(a.metrics.recommendations.map(row => row.skuId), ['serial']);
  const b = recommendations.query(store, owner, 'B仓便宜的老人机有哪些');
  assert.equal(b.metrics.recommendations.length, 0);
  const z = recommendations.query(store, owner, 'D仓便宜的老人机有哪些');
  assert.equal(z.metrics.invalidWarehouse, true);
  const selected = recommendations.query(store, owner, '便宜的老人机有哪些', { warehouseId: 'wh-c' });
  assert.deepEqual(selected.metrics.recommendations.map(row => row.skuId), ['cphone']);
  assert.equal(selected.metrics.recommendations[0].warehouseName, 'C仓·移动业务');
  const nokia = recommendations.query(store, owner, 'Nokia功能机有哪些');
  assert.deepEqual(nokia.metrics.recommendations.map(row => row.skuId), ['cphone', 'serial']);
});
test('no inventory permission or disabled account denies without exposing stock', () => {
  const store = fixture();
  for (const user of [learner, { ...owner, status: 'disabled' }, null]) {
    const result = recommendations.query(store, user, '便宜的老人机有哪些');
    assert.equal(result.metrics.denied, true);
    assert.equal(result.sources.length, 0);
    assert.doesNotMatch(result.answer, /天语|99|诺基亚/);
  }
  for (const user of [{ ...learner, permissions: ['purchase:create'] }, { ...learner, permissions: ['stock:adjust'] }]) {
    assert.equal(recommendations.query(store, user, '便宜的老人机有哪些').metrics.recommendations.length, 3);
  }
});
test('no price and no sellable stock say so instead of inventing an offer', () => {
  const store = fixture();
  store.products.forEach(row => row.salePrice = null);
  const missing = recommendations.query(store, owner, '便宜的老人机有哪些');
  assert.equal(missing.metrics.recommendations.length, 0);
  assert.equal(missing.metrics.unpricedCount, 3);
  assert.match(missing.answer, /零售价还没设好/);
  assert.doesNotMatch(missing.answer, /¥0.00|便宜的有/);
  store.inventory.forEach(row => row.quantity = 0);
  const absent = recommendations.query(store, owner, '便宜的老人机有哪些');
  assert.match(absent.answer, /没查到.*现货/);
  assert.equal(absent.metrics.unpricedCount, 0);
});
test('a duplicate or invalid inventory location never inflates sellable quantity', () => {
  const store = fixture();
  store.inventory.push({ ...store.inventory[0] });
  store.inventory[1].quantity = -1;
  store.inventory[2].status = '待验收';
  const result = recommendations.query(store, owner, '便宜的老人机有哪些');
  assert.equal(result.metrics.recommendations.length, 0);
});
test('unrelated greetings, business commands, historical sales and policy questions are not swallowed', () => {
  const store = fixture();
  for (const question of ['你好', '你好你在干吗', '你好，你能干什么', '我来办一个业务', '帮我开老人机销售单', '便宜的老人机今天卖了几台', '老人机有哪些套餐政策', '老人机有什么功能', '功能机和智能机区别是什么', '便宜的老人机为什么不能充电', '我不买便宜的老人机']) {
    assert.equal(recommendations.query(store, owner, question), null, question);
  }
});
test('recommendation queries preserve products, financial ledgers, audits and inventory', () => {
  const store = fixture();
  store.operationLogs.push({ id: 'LOG-old', detail: 'old' });
  store.sales.push({ id: 'SO-old', amount: 300 });
  store.inventory.push({ skuId: 'orphan', quantity: 99, warehouseId: 'wh-a' });
  const before = JSON.stringify(store);
  for (const question of ['便宜的功能机/老人机有哪些？', '老人机预算200以内', 'A仓诺基亚老人机推荐一下']) recommendations.query(store, owner, question);
  assert.equal(JSON.stringify(store), before);
});

test('retail prices require an actual positive amount after rounding, never a boolean or overflowing number', () => {
  const store = fixture();
  store.products[0].salePrice = '99.50';
  add(store, {skuId:'subcent', name:'价格未核功能机', salePrice:0.004});
  add(store, {skuId:'overflow', name:'错误价功能机', salePrice:1e308});
  add(store, {skuId:'boolean', name:'布尔价功能机', salePrice:true});
  const result = recommendations.query(store, owner, '便宜的老人机有哪些');
  assert.equal(result.metrics.recommendations[0].salePrice,99.50);
  assert.equal(result.metrics.unpricedCount,3);
  assert.doesNotMatch(result.answer,/¥0.00|Infinity/);
});

test('spoken Chinese upper-bound budgets filter real prices just like digit budgets', () => {
  const store = fixture();
  for (const [question, budget, expected] of [
    ['便宜的老人机两百以内有哪些', 200, [99, 199]],
    ['二百块以下的功能机推荐一下', 200, [99, 199]],
    ['老人机最多一百五十元', 150, [99]],
    ['老人机预算二百块', 200, [99, 199]],
    ['便宜的功能机不超过两百零五元', 205, [99, 199]],
    ['推荐一百九十九元以下的老人机', 199, [99, 199]],
    ['便宜的功能机不高于一千二百三十四元', 1234, [99, 199, 299]],
    ['功能机预算二百点五元', 200.5, [99, 199]],
  ]) {
    const result = recommendations.query(store, owner, question);
    assert.equal(result.metrics.budget, budget, question);
    assert.deepEqual(result.metrics.recommendations.map(row => row.salePrice), expected, question);
  }
});
test('model numbers and approximate spoken budgets are not strict price upper bounds', () => {
  const store = fixture();
  for (const question of ['诺基亚105老人机有哪些', '老人机预算两百左右', '老人机预算200元左右', '推荐两百左右的老人机', '老人机预算大概两百元', '老人机预算一百五']) {
    const result = recommendations.query(store, owner, question);
    assert.equal(result.metrics.budget, null, question);
    assert.ok(result.metrics.recommendations.length > 0, question);
  }
  const model = recommendations.query(store, owner, '诺基亚105老人机有哪些，预算两百以内');
  assert.equal(model.metrics.budget, 200);
  assert.deepEqual(model.metrics.recommendations.map(row => row.skuId), ['serial']);
  const exact = recommendations.query(store, owner, '老人机预算两百左右，最多两百五十元');
  assert.equal(exact.metrics.budget, 250);
  assert.deepEqual(exact.metrics.recommendations.map(row => row.salePrice), [99, 199]);
});

test('旧手机只记数量而未绑定串号，不推荐为可售现货',()=>{const s=fixture();s.inventory[0].serials=[];const reply=recommendations.query(s,owner,'功能机有哪些');assert.ok(!reply.metrics.recommendations.some(p=>p.skuId==='cheap'));assert.equal(reply.metrics.recommendations.length,2);});
