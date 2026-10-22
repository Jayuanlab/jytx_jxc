process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict'),c=require('../src/common'),repository=require('../src/repository'),{createServer}=require('../src/application'),daily=require('../src/daily-close');
test('现金交接与现金充值：身份、幂等重试、实收核验、失败回滚及收支只记录一次',async()=>{
 const owner={id:'owner',name:'老板',roleCode:'owner',status:'active'},wife={id:'wife',name:'老板娘',roleCode:'employee',status:'active',permissions:['finance:view']},staff={id:'staff',name:'营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
 const initial=c.initialize({users:[owner,wife,staff]});daily.airEntry(initial,owner,{kind:'opening',amount:2000,reference:'OPEN',businessDate:c.day()});repository.resetStore(initial);
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function request(path,body,token,key){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
 try{
  const boss=(await request('/api/auth/login',{userId:'owner'})).body.token,clerk=(await request('/api/auth/login',{userId:'staff'})).body.token,w=(await request('/api/auth/login',{userId:'wife'})).body.token;
  const payload={kind:'person',recipientId:'wife',amount:285.4,note:'模拟晚班交接'};
  assert.equal((await request('/api/cash-handovers',payload,null,'no-auth')).status,401);
  const first=await request('/api/cash-handovers',payload,clerk,'cash-one');assert.equal(first.status,200);assert.equal(first.body.status,'待接收人确认');
  const repeat=await request('/api/cash-handovers',payload,clerk,'cash-one');assert.equal(repeat.body.id,first.body.id);assert.equal(repository.readStore().cashHandovers.length,1);assert.equal(repository.readStore().receipts.length,0);
  assert.equal((await request('/api/cash-handovers',{...payload,amount:300},clerk,'cash-one')).status,409);
  assert.equal((await request('/api/cash-handovers/confirm',{id:first.body.id,actualAmount:285.4},clerk,'deny-own')).status,403);
  const before=JSON.stringify(repository.readStore());assert.equal((await request('/api/cash-handovers/confirm',{id:first.body.id,actualAmount:280},w,'wrong-amount')).status,409);assert.equal(JSON.stringify(repository.readStore()),before);
  const confirmation={id:first.body.id,actualAmount:285.4};assert.equal((await request('/api/cash-handovers/confirm',confirmation,w,'confirmed-one')).status,200);assert.equal((await request('/api/cash-handovers/confirm',confirmation,w,'confirmed-one')).status,200);
  assert.equal(repository.readStore().cashHandovers[0].events.length,2);assert.equal(repository.readStore().receipts.length,0);assert.equal(daily.snapshot(repository.readStore(),c.day()).cashHandoverConfirmed,285.4);
  const recharge={customerPhone:'13800138000',cashReceived:100,debitAmount:100,platformRef:'SIM-BOSS-100',cashConfirmed:true};
  const cash=await request('/api/air-recharge/cash-sales',recharge,clerk,'recharge-one');assert.equal(cash.status,200);assert.equal(cash.body.balance,1900);assert.equal(cash.body.operatorId,'staff');
  const retried=await request('/api/air-recharge/cash-sales',recharge,clerk,'recharge-one');assert.equal(retried.body.id,cash.body.id);let s=repository.readStore();assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].amount,100);assert.equal(s.receptions.length,1);assert.equal(s.receptions[0].links.length,1);assert.equal(s.airRechargeEvents.length,2);
  const stable=JSON.stringify(s);for(const data of [{...recharge,platformRef:'SIM-BOSS-BAD',debitAmount:99},{...recharge,platformRef:'SIM-BOSS-NO-CASH',cashConfirmed:false},{...recharge,platformRef:'SIM-BOSS-PHONE',customerPhone:'123'}]){assert.ok((await request('/api/air-recharge/cash-sales',data,clerk,crypto.randomUUID())).status>=400);assert.equal(JSON.stringify(repository.readStore()),stable);}
  assert.equal((await request('/api/air-recharge/cash-sales',recharge,clerk,'different-key-same-boss-ref')).status,409);assert.equal(JSON.stringify(repository.readStore()),stable);
  assert.equal((await request('/api/workbench',null,boss)).body.reviews.cashHandover,0);
 }finally{await new Promise(r=>server.close(r));}
});
