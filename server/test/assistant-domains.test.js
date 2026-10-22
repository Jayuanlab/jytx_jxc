const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const loadModule = Module._load;
Module._load = function(request, ...args) { if (request === 'xlsx') return {}; return loadModule.call(this, request, ...args); };
const c = require('../src/common');
const domains = require('../src/assistant-domains');
const carrier = require('../src/carrier-rentals');
const owner = { id: 'boss', name: '老板', roleCode: 'owner', status: 'active' };
const worker = { id: 'a', name: '张三', roleCode: 'employee', permissions: ['sale:create', 'purchase:create'], status: 'active' };
const other = { id: 'b', name: '李四', roleCode: 'employee', permissions: ['sale:create', 'purchase:create'], status: 'active' };
const query = (s, u, q, detail = false) => domains.query(s, u, q, { date: c.day(), detail });
function fixture() {
  const s = c.initialize({ users: [owner, worker, other], supplierModelVersion: 2 });
  s.suppliers = [{ id: 'sup1', name: '华强', contact: '' }, { id: 'sup2', name: '联盛', contact: '' }];
  s.supplierEntries = [{ id: 'due1', supplierId: 'sup1', kind: 'payable', cents: 10000 }, { id: 'adv1', supplierId: 'sup1', kind: 'advance', cents: 3000 }, { id: 'due2', supplierId: 'sup2', kind: 'payable', cents: 7000 }];
  s.supplierSettlements = [{ id: 'offset1', sourceId: 'adv1', targetId: 'due1', cents: 1000 }];
  s.carrierServices = [
    { id: 'MB-1', employeeId: worker.id, employeeName: worker.name, typeName: '号卡', externalOrderNo: 'BOSS-1', schedule: [{ month: c.month(), expected: 80, confirmed: 70, received: 20, events: [] }, { month: c.month(), expected: 60, confirmed: null, received: 0, events: [] }] },
    { id: 'MB-2', operatorId: other.id, typeName: '宽带', externalOrderNo: 'BOSS-2', schedule: [{ month: c.month(), expected: 200, confirmed: 100, received: 100, events: [] }] },
  ];
  s.govSubsidyClaims = [
    { id: 'GB-1', orderId: 'S-1', platformOrderNo: 'G-1', subsidyAmount: 500, confirmed: 450, received: 100, events: [] },
    { id: 'GB-2', orderId: 'S-2', platformOrderNo: 'G-2', subsidyAmount: 300, confirmed: null, received: 0, events: [] },
    { id: 'GB-R', orderId: 'S-3', returnId: 'R-1', subsidyAmount: 200, confirmed: 200, received: 200, refunded: 50, events: [] },
  ];
  s.procurementPlans = [
    { id: 'PLAN-1', status: 'open', supplier: '华强', receiverId: worker.id, receiver: worker.name, operatorId: other.id, createdAt: c.now(), items: [{ name: '华为手机', quantity: 5, received: 2, costPrice: 100 }] },
    { id: 'PLAN-2', status: 'open', supplier: '联盛', receiverId: other.id, receiver: other.name, operatorId: other.id, createdAt: c.now(), items: [{ name: '充电器', quantity: 4, received: 1, costPrice: 10 }] },
    { id: 'PLAN-3', status: 'received', receiverId: worker.id, items: [{ name: '手机', quantity: 1, received: 1 }] },
  ];
  s.customers = [{ id: 'CU-1', phone: '13800138000', name: '测试顾客' }];
  s.receptions = [
    { id: 'RE-1', customerId: 'CU-1', customerMask: '138****8000', ownerId: worker.id, ownerName: worker.name, purpose: '买手机', status: '待回访', followUpAt: c.day() + 'T12:00:00+08:00', createdAt: c.now(), needs: '机密需求', assists: [], links: [], points: [], wechat: { claimed: false } },
    { id: 'RE-2', customerId: 'CU-1', customerMask: '138****8000', ownerId: other.id, ownerName: other.name, purpose: '查套餐', status: '接待中', createdAt: c.now(), needs: '其他员工机密', assists: [], links: [], points: [], wechat: { claimed: false } },
  ];
  s.cashHandovers = [
    { id: 'CH-1', senderId: worker.id, sender: worker.name, recipientId: owner.id, recipient: owner.name, amount: 100, status: '待接收人确认', createdAt: c.now() },
    { id: 'CH-2', senderId: other.id, sender: other.name, recipientId: owner.id, recipient: owner.name, amount: 200, status: '金额有异议', createdAt: c.now() },
  ];
  s.dailyCloseouts = [{ id: 'DC-1', date: c.day(), status: '待老板签认', cashierId: worker.id, cashier: worker.name, reviewerId: other.id, reviewer: other.name, createdAt: c.now() }];
  return s;
}
test('供应商往来按单位计算未结余额，预付不抵消应付展示且问答不迁移主账', () => {
  const s = fixture();
  s.purchases.push({ id: 'PO-legacy', supplier: '历史供货商', amount: 50, paidAmount: 20, createdAt: c.now() });
  const before = JSON.stringify(s);
  const r = query(s, owner, '查华强供应商往来');
  assert.equal(r.metrics.payable, 90); assert.equal(r.metrics.advance, 20);
  assert.match(r.answer, /应付 ¥90.00，预付货款 ¥20.00/);
  assert.equal(query(s, owner, '华强预付货款多少').metrics.advance, 20);
  assert.equal(query(s, owner, '还欠供应商多少钱').metrics.payable, 190);
  assert.equal(query(s, owner, '供应商未付货款多少').metrics.payable, 190);
  assert.equal(query(s, owner, '查供应商失联公司的应付').metrics.matched, false);
  assert.match(query(s, worker, '供货商应付多少钱').answer, /没有供应商往来查看权限/);
  assert.equal(JSON.stringify(s), before);
});
test('同名供应商询问不能合并猜测，要求明确单位', () => {
  const s = fixture(); s.suppliers.push({ id: 'sup3', name: '华强', contact: '分店' });
  const r = query(s, owner, '欠华强多少钱');
  assert.equal(r.metrics.ambiguous, true); assert.equal(r.metrics.payable, undefined);
  assert.match(r.answer, /具体单位/);
});
test('移动酬金区分已确认未到账和预计待确认，普通员工只能查本人并兼容历史字段', () => {
  const s = fixture(); const before = JSON.stringify(s);
  const r = query(s, worker, '本月移动酬金未到账多少');
  assert.equal(r.metrics.confirmedDue, 50); assert.equal(r.metrics.expectedUnconfirmed, 60); assert.equal(r.metrics.received, 20);
  assert.match(r.answer, /已确认待到账 ¥50.00，预计待确认 ¥60.00/);
  assert.equal(query(s, other, '本月移动酬金结算').metrics.confirmedDue, 0);
  assert.equal(carrier.list(s, worker).length, 1); assert.equal(carrier.list(s, other).length, 1);
  const next = new Date(Date.UTC(Number(c.month().slice(0, 4)), Number(c.month().slice(5)), 1)).toISOString().slice(0, 7);
  s.carrierServices[0].schedule.push({ month: next, expected: 40, confirmed: null, received: 0, events: [] });
  assert.equal(query(s, worker, '下个月移动酬金多少').metrics.expectedUnconfirmed, 40);
  s.carrierServices[0].schedule.pop(); assert.equal(JSON.stringify(s), before);
});
test('国补未确认部分单列，退货单不再列入应收并核对补贴应退', () => {
  const s = fixture(); const r = query(s, owner, '国补结算还有多少钱未到账');
  assert.equal(r.metrics.confirmedDue, 350); assert.equal(r.metrics.expectedUnconfirmed, 300); assert.equal(r.metrics.refundDue, 150);
  assert.match(r.answer, /已确认待到账 ¥350.00/); assert.match(r.answer, /预计待平台确认 ¥300.00/);
  const restricted = query(s, worker, '国补结算多少钱'); assert.match(restricted.answer, /没有国补结算查看权限/); assert.deepEqual(restricted.metrics, {});
});
test('部分收货只统计剩余且普通员工只查指派验收的订单', () => {
  const s = fixture();
  const ownerResult = query(s, owner, '哪些订货单还没收齐');
  assert.equal(ownerResult.metrics.pendingCount, 2); assert.equal(ownerResult.metrics.pendingUnits, 6);
  const own = query(s, worker, '我有哪些待验收订货'); assert.equal(own.metrics.pendingCount, 1); assert.equal(own.metrics.pendingUnits, 3);
  const detail = query(s, worker, '我的订货未收齐明细', true); assert.match(detail.answer, /华为手机待收 3 件/); assert.doesNotMatch(detail.answer, /充电器/);
});
test('顾客手机号接待查询只使用当前账号可读行，不借公共协助列表泄露客户资料', () => {
  const s = fixture(); const r = query(s, worker, '查顾客13800138000的接待工单');
  assert.equal(r.metrics.count, 1); assert.match(r.answer, /张三/); assert.doesNotMatch(r.answer, /李四|机密/);
  const boss = query(s, owner, '查13800138000的客户档案'); assert.equal(boss.metrics.count, 2);
  assert.equal(query(s, other, '今天有哪些客户要回访').metrics.count, 0);
  assert.equal(query(s, worker, '今天哪些客户要回访').metrics.count, 1);
});
test('现金交接限定本人或老板可见，未报交接不推断没人欠款', () => {
  const s = fixture(); const r = query(s, worker, '现金交接还有哪些没确认');
  assert.equal(r.metrics.pendingAmount, 100); assert.equal(r.metrics.count, 1); assert.equal(r.metrics.disputedCount, 0);
  const boss = query(s, owner, '现金交接待确认'); assert.equal(boss.metrics.disputedCount, 1);
  const detailed = query(s, worker, '现金交接明细', true); assert.doesNotMatch(detailed.answer, /李四/);
});
test('日结状态显示本人参与单据，未参与不能获知他人复核信息', () => {
  const s = fixture(); assert.match(query(s, owner, '今天扎账了没有').answer, /待老板签认/);
  const outsider = { ...other, id: 'outsider' }; const r = query(s, outsider, '今天日结状态');
  assert.equal(r.metrics.status, null); assert.match(r.answer, /当前可见范围没有日结单/);
});
test('待办使用中文标签，专用领域待确认不被普通待办路由吞掉', () => {
  const s = fixture(); const r = query(s, owner, '详细说说待审核项目', true);
  assert.match(r.answer, /日结签认|现金交接/); assert.doesNotMatch(r.answer, /dailyClose|cashHandover|procurement/);
  assert.equal(query(s, owner, '本月移动酬金待确认').metrics.expectedUnconfirmed, 60);
});
test('所有领域问答纯读、只给导航动作，主动写账指令交给受控动作模块', () => {
  const s = fixture(), before = JSON.stringify(s);
  for (const q of ['供货商应付多少', '移动酬金未到账多少', '国补结算多少', '未收齐订货', '顾客13800138000接待工单', '有哪些客户要回访', '现金交接未确认', '日结情况', '我的待办']) {
    const r = query(s, owner, q, true); assert.ok(r, q); assert.equal(r.action.type, 'navigate', q);
  }
  assert.equal(JSON.stringify(s), before);
  for (const q of ['帮我开订货单', '批准给供应商付款', '确认收到现金']) assert.equal(query(s, owner, q), null);
  assert.equal(query(s, owner, '今天卖了多少台手机'), null);
});
test('移动和国补到账按真实事件发生日统计，不把结算所属月当成到账月', () => {
  const s = fixture();
  const oldMonth = new Date(Date.UTC(Number(c.month().slice(0, 4)), Number(c.month().slice(5)) - 2, 1)).toISOString().slice(0, 7);
  s.carrierServices[0].schedule[0].month = oldMonth;
  s.carrierServices[0].schedule[0].received = 20;
  s.carrierServices[0].schedule[0].events = [{ amount: 20, createdAt: c.now(), bankRef: 'REAL-MB' }];
  s.carrierServices[1].schedule[0].events = [{ amount: 100, createdAt: c.day(Date.now() - 86400000) + 'T12:00:00+08:00', bankRef: 'YEST-MB' }];
  assert.equal(query(s, worker, '今天移动酬金到账多少').metrics.received, 20);
  assert.equal(query(s, worker, '本月移动酬金到账多少').metrics.received, 20);
  const otherToday = query(s, other, '今天移动酬金到账多少'); assert.equal(otherToday.metrics.received, 0); assert.match(otherToday.answer, /没有移动酬金到账记录/);
  s.govSubsidyClaims[0].events = [{ type: 'receive', amount: 100, createdAt: c.now(), reference: 'REAL-GB' }];
  s.govSubsidyClaims[2].events = [{ type: 'receive', amount: 200, createdAt: c.day(Date.now() - 86400000) + 'T12:00:00+08:00', reference: 'YEST-GB' }];
  assert.equal(query(s, owner, '今天国补到账多少').metrics.received, 100);
  const yesterday = domains.query(s, owner, '昨天国补到账多少', { date: c.day(Date.now() - 86400000) });
  assert.equal(yesterday.metrics.received, 200);
});
test('到账记录缺日期时不以零代替未知', () => {
  const s = fixture(); const r = query(s, owner, '今天国补到账多少');
  assert.equal(r.metrics.incomplete, true); assert.match(r.answer, /缺少日期/); assert.doesNotMatch(r.answer, /到账 ¥0.00/);
});
