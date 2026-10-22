const {test}=require('node:test');
const assert=require('node:assert/strict');
const companion=require('../src/companion');

const user={id:'owner',name:'老板',roleCode:'owner'};
const store={companionReminders:[{userId:'owner',title:'检查库存',dueAt:'2026-10-19T04:00:00Z',done:false}]};

test('感谢提醒不被误判为查询提醒列表',()=>{
  assert.equal(companion.recall(store,user,'谢谢提醒'),null);
  assert.equal(companion.recall(store,user,'多谢你的提醒'),null);
});

test('明确查询提醒仍返回列表',()=>{
  assert.match(companion.recall(store,user,'我的提醒有哪些？'),/检查库存/);
});
