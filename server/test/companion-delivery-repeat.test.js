const {test}=require('node:test');
const assert=require('node:assert/strict');
const delivery=require('../src/companion-delivery');

const user={id:'owner',name:'老板',roleCode:'owner'};

test('普通对话即使回答文字相同，也继续回答当前问题',()=>{
  const answer='我会按你当前的问题重新核对，不能把旧回答当成新问题的结论。';
  const store={companionMessages:[{id:'old',userId:user.id,question:'先前的问题',answer,channel:'life',createdAt:'2026-10-18T00:00:00Z'}]};
  const response={answer,channel:'life',modelConnected:true};
  assert.deepEqual(delivery.sanitize(store,user,'现在这个问题呢？',response),response);
});

test('重复笑话仍可换成尚未讲过的笑话',()=>{
  const answer='朋友问我：“你每天走一万步，怎么没见瘦？”我说：“因为我走得最多的一条路，是去厨房的路。”';
  const store={companionMessages:[{id:'old',userId:user.id,question:'讲个笑话',answer,channel:'life',createdAt:'2026-10-18T00:00:00Z'}]};
  const result=delivery.sanitize(store,user,'再讲个笑话',{answer,channel:'life',modelConnected:true,metrics:{kind:'personal-entertainment',contentKind:'joke'}});
  assert.notEqual(result.answer,answer);
  assert.equal(result.metrics.repeatBlocked,true);
});
