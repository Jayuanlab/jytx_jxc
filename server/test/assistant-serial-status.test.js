'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
// Load the actual fresh production capability function without substituting its logic.
const commonFile = path.resolve(__dirname, '../src/common.js');
const beforeFile = path.resolve(__dirname, '../../artifacts/assistant-sold-lookup-20261012/before/server/src/common.js');
if (fs.existsSync(beforeFile)) {
  const fresh = new Module(commonFile, module);
  fresh.filename = commonFile;
  fresh.paths = Module._nodeModulePaths(path.dirname(commonFile));
  fresh._compile(fs.readFileSync(beforeFile, 'utf8'), commonFile);
  require.cache[commonFile] = fresh;
}
const c = require('../src/common');
const serials = require('../src/assistant-serial-status');
const scope = require('../src/capacity/context');
const owner = {id: 'boss', roleCode: 'owner', status: 'active'};
const clerk = {id: 'clerk', roleCode: 'employee', permissions: ['sale:create'], branchIds: ['b1'], status: 'active'};
const current = {tenantId: 't1', branchId: 'b1'};
const full = '991010100001234';
const other = '990000000001234';
const ask = (store, text, user = clerk, context) => scope.run(current, () => serials.query(store, user, text, context));
const detect = (text, context, user = clerk) => scope.run(current, () => serials.detectIntent(text, context, user));
function fixture(status = '已售') {
  return {products: [{skuId: 'phone', name: '测试华为手机', type: '智能机', trackSerial: true, costPrice: 999}], inventory: [{skuId: 'phone', warehouseId: 'wh-sale', warehouseName: 'A仓', quantity: status === '可售' ? 1 : 0, stockValue: 1234, serials: [{no: full, status, costPrice: 456}]}], sales: [{id: 'XS-OWN', createdAt: '2026-10-11T12:30:00.000Z', status: 'completed', salespersonId: clerk.id, operatorId: 'different-operator', salesperson: '营业员名字', customerName: '顾客私密名字', customerPhone: '13900006666', customerMask: '139****6666', customerId: 'PRIVATE-CUSTOMER', amount: 3333, cost: 2222, profit: 1111, paymentMethod: '私人收款账户', items: [{id: 'line1', skuId: 'phone', name: '测试华为手机', serialNo: full, warehouseName: 'A仓', quantity: 1, returnedQuantity: 0, salePrice: 3333, amount: 3333, costPrice: 2222, cost: 2222, profit: 1111}]}], purchases: [], saleReturns: [], redReversals: []};
}
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function sensitiveNotPresent(result) {
  const json = JSON.stringify(result);
  for (const text of ['顾客私密名字','13900006666','139****6666','PRIVATE-CUSTOMER','3333','2222','1111','456','999','1234.00','私人收款账户','营业员名字','salespersonId','operatorId','customerPhone','costPrice','stockValue','profit','amount','salePrice']) assert.ok(!json.includes(text), text);
}
test('是否已经销售的问句直接命中只读查询，不要求开单两个字', () => {
  for (const q of ['查一下串号1234是不是已经销售了','串号1234已售出了吗','1234这台手机卖了没有','这台是不是已经销售了','这台卖出去没有']) assert.ok(detect(q), q);
  for (const q of ['串号1234','给串号1234开单','我卖了一台手机1234，成交1800元','我已经卖了一台手机','我已经销售了串号1234这台手机','今天卖了几台手机','卖一台手机','讲一个笑话']) assert.equal(detect(q), null, q);
});
test('无指定串号的品牌库存列表、历史清单和销售统计交给既有处理器', () => {
  const context = {userId: clerk.id, at: Date.now(), serialToken: full};
  for (const q of ['查一下华为的库存，我要串号','查询华为库存串号','查一下库存串号','查一下手机销售记录','今天卖了什么手机','今天卖了多少台手机','荣耀手机今天卖了没有？','华为手机卖了没有','查看全部销售清单']) {
    assert.equal(detect(q), null, q); assert.equal(detect(q, context), null, q+'有最近串号上下文');
  }
  assert.ok(detect('查一下这台是不是已销售'));
  assert.equal(ask(fixture(), '查一下这台是不是已销售').metrics.needsClarification, true);
  assert.equal(ask(fixture(), '串号1234今天已经售出了吗').metrics.status, 'sold');
});
test('进货来源、价格、成本、客户等原查询不被状态核对抢走', () => {
  for (const q of ['查串号1234进货日期','查串号1234供货商是谁','查串号1234进价多少','查串号1234毛利多少','查串号1234卖给谁','查串号1234售价多少']) assert.equal(detect(q), null, q);
  assert.equal(ask(fixture(), '查串号1234是不是已经销售了，客户不重要').metrics.status, 'sold');
});
test('已售手机返回当前状态和本人原销售单、上海时间、商品', () => {
  const a = ask(fixture(), '查一下串号1234是不是已经销售了');
  assert.equal(a.metrics.status, 'sold'); assert.equal(a.metrics.serialNo, full); assert.match(a.answer, /库存记录已售出/); assert.match(a.answer, /不能.*再次开单/); assert.match(a.answer, /XS-OWN/); assert.match(a.answer, /20:30/); assert.equal(a.metrics.sales[0].state, '有效销售');
  assert.equal(a.saleFlow, undefined); assert.equal(a.draft, undefined); assert.equal(a.action, undefined); sensitiveNotPresent(a);
});
test('完整串号必须完全匹配，不能把相近串号当作已售', () => {
  const s = fixture(); assert.equal(ask(s, '串号991010100001235是否已售').metrics.status, 'missing'); assert.equal(ask(s, '查串号991010100001234').metrics.status, 'sold');
});
test('可售或未激活当前记录优先，已退货历史不判为售出', () => {
  for (const stockStatus of ['可售','未激活']) {
    const s = fixture(stockStatus); s.sales[0].items[0].returnedQuantity = 1; s.sales[0].status = 'returned';
    const a = ask(s, '串号1234是不是已经销售了'); assert.equal(a.metrics.status, 'instock'); assert.match(a.answer, /当前库存记录为/); assert.match(a.answer, /已退货/); assert.ok(!a.answer.includes('库存记录已售出'));
  }
});
test('红冲后可售保留历史依据，不能用原销售记录推断仍已售', () => {
  const s = fixture('可售'); s.sales[0].redReversedBy = 'SR-RED';
  const a = ask(s, '串号1234是否已售'); assert.equal(a.metrics.status, 'instock'); assert.equal(a.metrics.sales[0].state, '已红冲'); assert.match(a.answer, /已红冲/);
});
test('取消销售单不当作有效销售，不自动重开或修改库存', () => {
  for (const value of ['cancelled','canceled','已取消','voided']) {
    const s = fixture('可售'); s.sales[0].status = value; const before = JSON.stringify(s);
    const a = ask(s, '串号1234是否已经销售'); assert.equal(a.metrics.status, 'instock'); assert.equal(a.metrics.sales[0].state, '已取消'); assert.equal(JSON.stringify(s), before);
  }
});
test('历史曾销售但库存行不存在，明确仅历史记录并列原单状态', () => {
  const s = fixture(); s.inventory = []; s.sales[0].items[0].returnedQuantity = 1;
  const a = ask(s, '查串号1234是不是卖了'); assert.equal(a.metrics.status, 'history-only'); assert.match(a.answer, /有历史销售记录/); assert.match(a.answer, /历史销售不等于当前一定已售出/); assert.match(a.answer, /已退货/);
});
test('串号不存在不谎称未销售，不扩展到别的门店', () => {
  const a = ask(fixture(), '串号9876是否已经销售'); assert.equal(a.metrics.status, 'missing'); assert.match(a.answer, /不等于确认未销售/); assert.equal(a.metrics.sales, undefined);
});
test('四位尾号多个手机要求完整串号，不硬选第一台', () => {
  const s = fixture(); s.inventory.push({...s.inventory[0], warehouseName: 'B仓', serials: [{no: other, status: '可售'}]});
  const a = ask(s, '串号1234是不是已经售出'); assert.equal(a.metrics.status, 'ambiguous'); assert.equal(a.metrics.ambiguous, true); assert.match(a.answer, /请说完整串号/); assert.equal(a.conversationHint, undefined); assert.equal(a.table.rows.length, 2);
});
test('同一个完整串号出现在两个库存行也不硬猜', () => {
  const s = fixture(); s.inventory.push({...s.inventory[0], warehouseName: 'B仓'});
  const a = ask(s, '串号'+full+'是不是已经售出'); assert.equal(a.metrics.status, 'ambiguous'); assert.match(a.answer, /出现在多条库存记录/);
});
test('同句多个尾号必须澄清，多个销售历史不会误判多个手机', () => {
  assert.equal(ask(fixture(), '查串号1234和串号5678是否已售').metrics.ambiguous, true);
  const s = fixture(); const old = structuredClone(s.sales[0]); old.id = 'XS-OLD'; old.createdAt = '2026-10-01T00:00:00Z'; old.items[0].returnedQuantity = 1; s.sales.push(old);
  const a = ask(s, '串号1234是否已售'); assert.equal(a.metrics.status, 'sold'); assert.equal(a.metrics.matchedCount, 1); assert.equal(a.metrics.visibleSaleCount, 2);
});
test('员工能查其他员工已售库存状态，不返回对方单据、时间、客户或金额', () => {
  const s = fixture(); s.sales[0].salespersonId = 'another-clerk'; s.sales[0].id = 'PRIVATE-SALE-ID';
  const a = ask(s, '串号1234是不是已经售出'); assert.equal(c.capabilities(clerk).allSales, false); assert.equal(a.metrics.status, 'sold'); assert.equal(a.metrics.visibleSaleCount, 0); assert.match(a.answer, /对应原单需有权限者核对/);
  assert.ok(!JSON.stringify(a).includes('PRIVATE-SALE-ID')); assert.ok(!JSON.stringify(a).includes('2026-10-11')); assert.ok(!JSON.stringify(a).includes('20:30')); sensitiveNotPresent(a);
});
test('无库存行时也能核对其他员工曾售状态，但不暴露原单详情', () => {
  const s = fixture(); s.inventory = []; s.sales[0].salespersonId = 'another-clerk'; s.sales[0].id = 'PRIVATE-SALE-ID';
  const a = ask(s, '串号1234是否已经销售'); assert.equal(a.metrics.status, 'history-only'); assert.match(a.answer, /有历史销售记录/); assert.match(a.answer, /有效销售/); assert.equal(a.metrics.visibleSaleCount, 0); assert.ok(!JSON.stringify(a).includes('PRIVATE-SALE-ID')); assert.ok(!JSON.stringify(a).includes('2026-10-11')); sensitiveNotPresent(a);
});
test('已有allSales授权的员工可查原单；老板也只取得核对所需字段', () => {
  const s = fixture(); s.sales[0].salespersonId = 'another-clerk';
  for (const user of [owner,{...clerk, permissions: ['sale:create','report:view']}]) { const a = ask(s, '串号1234是否已经销售', user); assert.equal(a.metrics.visibleSaleCount, 1); assert.match(a.answer, /XS-OWN/); sensitiveNotPresent(a); }
});
test('当前可售但仍存在有效销售则提示状态矛盾，不给可重复开单结论', () => {
  const a = ask(fixture('可售'), '串号1234是不是已经售出'); assert.equal(a.metrics.status, 'inconsistent'); assert.match(a.answer, /状态需要核对/); assert.match(a.answer, /不要重复开单/);
});
test('当前已售但最近历史已红冲也提示不一致', () => {
  const s = fixture(); s.sales[0].redReversedBy = 'SR-RED';
  const a = ask(s, '串号1234是否已经售出'); assert.equal(a.metrics.status, 'inconsistent'); assert.match(a.answer, /库存与原单状态需要人工核对/);
});
test('无有效串号的追问请补充，近期同账号上下文可以继承serialToken', () => {
  assert.equal(ask(fixture(), '这台是不是已经销售了').metrics.needsClarification, true);
  const context = {userId: clerk.id, at: Date.now(), serialToken: full, question: '我卖了一台售价1800元的手机', tenantId: 't1', branchId: 'b1'};
  const a = ask(fixture(), '查一下这台是不是已经销售了', clerk, context); assert.equal(a.metrics.status, 'sold'); assert.equal(a.metrics.serialNo, full);
  assert.equal(detect('这台是不是已经销售了', {...context,userId: 'other'}).needsSerial, true); assert.equal(detect('这台是不是已经销售了', {...context,at: Date.now()-31*60000}).needsSerial, true); assert.equal(detect('这台是不是已经销售了', {...context,branchId: 'b2'}).needsSerial, true);
});
test('上下文列表多个串号不能继承第一台，明确的新串号覆盖旧串号', () => {
  const context = {userId: clerk.id, at: Date.now(), question: '查串号1234和串号5678'};
  assert.equal(detect('是不是已经销售了', context).ambiguousInput, true);
  assert.equal(detect('串号9876是不是已经销售了', {...context,serialToken: full}).token, '9876');
});
test('数据库已有门店隔离外再拒绝显式异店异租户记录，不能继承异店原单', () => {
  const s = fixture(); s.inventory[0].branchId = 'b2'; s.sales[0].branchId = 'b2';
  assert.equal(ask(s, '串号1234是否已经售出', owner).metrics.status, 'missing');
  s.inventory[0].branchId = 'b1'; s.inventory[0].tenantId = 't2'; s.sales[0].branchId = 'b1'; s.sales[0].tenantId = 't2';
  assert.equal(ask(s, '串号1234是否已经售出', owner).metrics.status, 'missing');
  assert.equal(ask(fixture(), '串号1234是否已经售出', {...clerk,branchIds: ['b2']}).metrics.denied, true);
  assert.equal(ask({...fixture(),branchId:'b2'}, '串号1234是否已经售出', owner).metrics.denied, true);
});
test('匿名顾客型账号不能查门店串号，即使注入销售权限', () => {
  const a = ask(fixture(), '串号1234是否已经售出', {...clerk, assistantCustomerOnly:true}); assert.equal(a.metrics.denied, true); assert.equal(a.metrics.serialNo, undefined);
});
test('未知串号状态和赠品历史不会被捏造成普通有效销售', () => {
  const s = fixture('维修中'); s.sales = [];
  assert.equal(ask(s, '串号1234是否已经售出').metrics.status, 'unavailable');
  const gift = fixture(); gift.sales[0].giftOrders = [{id: 'GIFT', status: 'issued', items: gift.sales[0].items}]; gift.sales[0].items = [];
  const a = ask(gift, '串号1234是否已经售出'); assert.equal(a.metrics.sales[0].state, '赠品出库'); assert.match(a.answer, /赠品出库/);
});
test('冻结所有业务数据后执行查询仍成功，没有模型调用或业务写入', () => {
  const s = deepFreeze(fixture()), before = JSON.stringify(s);
  const a = ask(s, '串号1234是不是已经售出'); assert.equal(a.metrics.status, 'sold'); assert.equal(JSON.stringify(s), before);
});
