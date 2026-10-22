const { test } = require('node:test');
const assert = require('node:assert/strict');
const social = require('../src/assistant-social');
const staff = { id: 'staff', name: '测试店员', roleCode: 'employee' };
const store = { users: [{ id: 'owner', name: '不能泄露的老板姓名', roleCode: 'owner' }], sales: [], inventory: [] };

test('招呼语自然回应，默认川渝话，保留普通话选择', () => {
  for (const question of ['你好', '您好！', '喂，你好', '喂', '嗨', 'hello', '早上好', '在吗？', '有人吗？']) {
    const result = social.query(store, staff, question);
    assert.equal(result.metrics.topic, 'greeting', question);
    assert.equal(result.metrics.replyStyle, 'sichuan');
    assert.match(result.answer, /你好.*啥子/);
    assert.deepEqual(result.sources, []);
  }
  const mandarin = social.query(store, staff, '你好', { customerReplyStyle: 'mandarin' });
  assert.equal(mandarin.metrics.replyStyle, 'mandarin');
  assert.match(mandarin.answer, /您好/);
  assert.doesNotMatch(mandarin.answer, /啥子/);
  assert.equal(social.query(store, staff, '你好', { customerReplyStyle: 'invalid' }).metrics.replyStyle, 'sichuan');
});

test('你好后跟工作或能力问题，回答实际问法', () => {
  for (const question of ['你好，你在干吗？', '你好，你在干嘛？', '你在干什么呀？', '你在忙啥子嘛？']) {
    const result = social.query(store, staff, question);
    assert.equal(result.metrics.topic, 'working', question);
    assert.match(result.answer, /查资料.*选商品/);
  }
  for (const question of ['你好，你能干什么？', '你能做什么啊？', '你会不会办业务呀？', '你能不能办业务？', '你有什么功能？']) {
    const result = social.query(store, staff, question);
    assert.equal(result.metrics.topic, 'capabilities', question);
    assert.match(result.answer, /库存.*资料/);
    assert.match(result.answer, /店员核对确认/);
    assert.equal(result.action, undefined);
    assert.equal(result.draft, undefined);
  }
});

test('籍贯、妹儿和南溪问题明确数字助理身份，不编造真人信息', () => {
  for (const question of ['你是哪里的人啊？', '你是哪儿人？', '你是不是重庆妹儿？', '你是不是云阳妹儿？', '你是不是南溪街上的？', '你是重庆人吗？', '你是谁？']) {
    const result = social.query(store, staff, question);
    assert.equal(result.metrics.topic, 'identity', question);
    assert.match(result.answer, /数字助理.*不是真人/);
    assert.doesNotMatch(result.answer, /我(?:是|住在|来自)(?:重庆|云阳|南溪)/);
  }
});

test('老板及服务对象不读取账户名单或假称知道姓名', () => {
  const unreadable = new Proxy({}, { get() { throw new Error('社交查询不应读取门店私有数据'); } });
  for (const question of ['你老板是谁呀？', '帮谁干啊？', '你帮哪个干？', '你给谁干活？', '你为谁服务？']) {
    const result = social.query(unreadable, staff, question);
    assert.equal(result.metrics.topic, 'employer', question);
    assert.match(result.answer, /这家门店/);
    assert.doesNotMatch(result.answer, /不能泄露的老板姓名|owner|staff/);
  }
});

test('泛指来办业务先询问业务类型，给出真实咨询的后续问句', () => {
  for (const question of ['我来办一个业务？', '你好，我来办一个业务', '我要办业务', '我想办理一项业务', '帮我办个业务', '办业务', '我来办业务可以吗？']) {
    const result = social.query(store, staff, question);
    assert.equal(result.metrics.topic, 'business-choice', question);
    assert.match(result.answer, /号卡.*充值.*宽带.*套餐.*维修/);
    assert.deepEqual(result.conversationHint, { topic: 'business-choice', choices: ['号卡', '充值', '宽带', '套餐', '购机', '维修'] });
    assert.ok(result.followups.some((row) => row.question === '我想办张手机卡'));
    assert.ok(result.followups.some((row) => row.question === '我想买手机，帮我了解选购建议'));
    assert.ok(!result.followups.some(row=>/选老人机|便宜的功能机有哪些/.test(row.label+' '+row.question)));
    assert.equal(result.action, undefined);
    assert.equal(result.draft, undefined);
  }
  const first = social.query(store, staff, '办业务');
  first.conversationHint.choices.push('不能写入下一次答复');
  first.followups[0].question = '不能写入下一次答复';
  assert.equal(social.query(store, staff, '办业务').conversationHint.choices.length, 6);
  assert.equal(social.query(store, staff, '办业务').followups[0].question, '我想办张手机卡');
});

test('明确充值或维修登记问题给实际页面入口，没有替人执行', () => {
  for (const question of ['我来办充值业务', '充值业务怎么登记', '你好，手机充值业务在哪里办理']) {
    const result = social.query(store, staff, question);
    assert.equal(result.metrics.topic, 'recharge-entry', question);
    assert.equal(result.action.type, 'navigate');
    assert.equal(result.action.href, '/carrier');
    assert.match(result.answer, /登记.*不等于已经充值或收款/);
  }
  for (const question of ['手机维修怎么登记', '我来办维修业务', '维修接待在哪里登记']) {
    const result = social.query(store, staff, question);
    assert.equal(result.metrics.topic, 'repair-entry', question);
    assert.equal(result.action.href, '/receptions');
    assert.equal(result.action.prefill.purpose, '维修');
    assert.match(result.answer, /店员检查后再确认维修/);
  }
});

test('招呼开头具体业务、库存、销量和单据指令留给真实业务模块', () => {
  for (const question of [
    '你好，帮我查华为手机库存', '你好，今天卖了多少台手机？',
    '你好，帮我开一张销售单', '你好，帮我查订单号SO-1',
    '你好，核算一下今天的毛利', '你在干吗，帮我查一下库存',
    '你能干什么，华为手机还有几台？', '你老板是谁，给我他的电话',
    '我来办一个业务，充值100元', '我来办宽带业务', '帮我办一张号卡',
    '我来办一个业务，套餐59元', '便宜的功能机有哪些？', '便宜的老人机有哪些？',
    '你是不是南溪街上的店还有华为手机', '你好，帮我查同义词设置',
    '你好，我要退货', '你好，我要补卡', '你不会办业务吗？', '你不要办理业务',
    '我想办张手机卡', '我想买一张手机卡', '帮我充值100元',
  ]) assert.equal(social.query(store, staff, question), null, question);
});

test('所有社交回答只读，过长、空白和非文本不匹配', () => {
  const before = JSON.stringify(store);
  for (const question of ['你好', '你好，你在干吗', '你能干什么', '你是不是云阳妹儿', '你老板是谁', '我来办业务', '我来办充值业务', '手机维修怎么登记']) {
    assert.equal(social.query(store, staff, question).metrics.kind, 'assistant-social');
  }
  assert.equal(JSON.stringify(store), before);
  for (const question of ['', '  ', null, undefined, {}, '你好'.repeat(121), '今天天气怎么样']) {
    assert.equal(social.query(store, staff, question), null);
  }
});


test('顾客到店指令先迎宾，可继续办业务，混合具体业务不会只剩问候', () => {
  for (const question of ['顾客到店', '有顾客到', '有顾客来了', '客户到了', '客人进店了', '来了个顾客', '来了一个客人', '有人来了', '迎宾', '开始接待']) {
    const reply = social.query(store, staff, question);
    assert.equal(reply.metrics.topic, 'greeting', question);
    assert.equal(reply.conversationHint.topic, 'business-choice');
    assert.deepEqual(reply.followups, []);
    assert.equal(reply.action, undefined);
  }
  for (const question of ['有顾客来了，帮我办张卡', '顾客到店，充值100元', '客户到期套餐查询', '顾客到店后的销售毛利']) {
    assert.equal(social.query(store, staff, question), null, question);
  }
});
