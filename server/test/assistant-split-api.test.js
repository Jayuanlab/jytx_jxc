'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:original.call(this,name,...args);};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'assistant-split-api-'));process.env.STORE_SEED_PATH=path.join(temporary,'seed.json');
const c=require('../src/common'),users=[{id:'owner',name:'甲老板',roleCode:'owner',status:'active'},{id:'other',name:'乙老板',roleCode:'owner',status:'active'},{id:'staff',name:'店员',roleCode:'employee',status:'active'},{id:'kiosk',name:'顾客',roleCode:'customer-assistant',status:'active'}];
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users,products:[],sales:[],inventory:[]})));
const repository=require('../src/repository'),sessions=require('../src/auth-sessions'),{createServer}=require('../src/application');
test('HTTP 第一版：身份隔离、长期记忆、独立人情账、学习审核、幂等与工作范围',async()=>{
 repository.resetStore(c.initialize({users,products:[],sales:[],inventory:[],assistantAnswerFeedback:[{id:'feedback-ok',submittedById:'staff',submittedBy:'店员',question:'补充问答',status:'已生效'}]}));
 const business=()=>JSON.stringify(Object.fromEntries(['products','sales','inventory','purchases','returns','payments','receipts','learningContributionAwards'].slice(0,-1).map(k=>[k,repository.readStore()[k]]))),before=business(),calls=[];
 const model={configured:()=>true,request:async(q,options)=>{calls.push({q,options});return '我们继续说说今天的事。';}};
 const server=createServer({companionModelClient:model,liveQuery:async()=>null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,tokens=users.map(u=>sessions.issue(u.id));
 const request=async(index,url,body,key)=>{const response=await fetch(origin+url,{method:body?'POST':'GET',headers:{...(index===null?{}:{Authorization:'Bearer '+tokens[index]}),...(body?{'Content-Type':'application/json','Idempotency-Key':key||crypto.randomUUID()}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 try{
  assert.equal((await request(null,'/api/companion')).status,401);
  for(const i of [2,3]){assert.equal((await request(i,'/api/companion')).status,403);assert.equal((await request(i,'/api/companion/chat',{question:'你好'})).status,403);assert.equal((await request(i,'/api/companion/memory',{content:'我喜欢散步'})).status,403);}
  const roles=await request(2,'/api/assistant/roles');assert.equal(roles.data.personal,false);
  assert.equal((await request(0,'/api/companion/profile',{nickname:'测试甲',city:'云阳',shareWithModel:true})).status,200);
  const remember=await request(0,'/api/companion/chat',{question:'记住：每天散步半小时'},'remember-one');assert.equal(remember.status,200);
  assert.equal((await request(0,'/api/companion/chat',{question:'记住：每天散步半小时'},'remember-one')).status,200);
  assert.equal((await request(0,'/api/companion/chat',{question:'改成另一句话'},'remember-one')).status,409);
  let snap=(await request(0,'/api/companion')).data;assert.equal(snap.memories.length,1);assert.equal(snap.messages.length,1);
  assert.deepEqual((await request(1,'/api/companion')).data.memories,[]);
  assert.equal((await request(1,'/api/companion/memory/remove',{id:snap.memories[0].id})).status,404);
  assert.equal((await request(0,'/api/companion/chat',{question:'聊聊今天的事'})).status,200);assert.equal(calls.length,1);assert.equal(calls[0].options.memories[0].content,'每天散步半小时');
  const m=snap.memories[0];assert.equal((await request(0,'/api/companion/memory/remove',{id:m.id})).status,200);
  await request(0,'/api/companion/chat',{question:'继续说说'});assert.equal(calls.length,2);assert.deepEqual(calls[1].options.memories,[]);assert.ok(!JSON.stringify(calls[1].options.messages).includes('每天散步半小时'));
  assert.equal((await request(0,'/api/companion/favor',{person:'测试朋友',occasion:'生日',date:'2026-10-11',direction:'送出',amount:100})).status,200);
  assert.deepEqual((await request(1,'/api/companion')).data.favors,[]);
  const result=await request(2,'/api/learning/practice',{scenario:'usage',answer:'先了解当前套餐和需求，再核实业务办理条件。',reflection:'客户需要的是适合自己的方案，不能随口承诺优惠。'});
  assert.equal(result.status,200);const row=result.data.record;
  assert.equal((await request(2,'/api/learning/hub')).data.points,0);
  assert.equal((await request(0,'/api/learning/review',{id:row.id,approve:true,points:5})).status,200);
  assert.equal((await request(2,'/api/learning/hub')).data.points,5);
  assert.equal((await request(2,'/api/learning/contribution-award',{id:'feedback-ok',points:8,note:'补充问答'})).status,403);
  assert.equal((await request(0,'/api/learning/contribution-award',{id:'feedback-ok',points:8,note:'补充有效问答'})).status,200);
  assert.equal((await request(2,'/api/learning/hub')).data.points,13);
  const rejected=await request(2,'/api/assistant/ask',{question:'记住我喜欢散步',mode:'store'});assert.equal(rejected.status,200);assert.equal(rejected.data.metrics.kind,'work-scope');assert.equal(calls.length,2);
  const publicLocked=await request(3,'/api/assistant/ask',{question:'店内毛利多少',mode:'store'});assert.equal(publicLocked.data.metrics.restricted,true);
  assert.equal(business(),before);assert.ok(!JSON.stringify(repository.readStore().operationLogs).includes('每天散步半小时'));
 }finally{tokens.forEach(token=>sessions.revoke(token));await new Promise(resolve=>server.close(resolve));sessions.close();fs.rmSync(temporary,{recursive:true,force:true});}
});
