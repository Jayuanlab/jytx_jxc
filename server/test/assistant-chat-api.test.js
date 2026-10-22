'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:original.call(this,name,...args);};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'assistant-chat-api-'));
process.env.STORE_SEED_PATH=path.join(temporary,'seed.json');
const c=require('../src/common'),users=[{id:'owner',name:'老板',roleCode:'owner',status:'active'},{id:'staff',name:'店员',roleCode:'employee',status:'active',permissions:['sale:create']},{id:'kiosk',name:'接待助理',roleCode:'customer-assistant',status:'active'}];
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users,products:[],sales:[],inventory:[]})));
const repository=require('../src/repository'),sessions=require('../src/auth-sessions'),{createServer}=require('../src/application'),{createClient}=require('../src/assistant-external-chat');
test('启用对话接口后的真实 HTTP 路由：异步回答、鉴权、会话隔离及账套无写入',async()=>{
 repository.resetStore(c.initialize({users,products:[],sales:[],inventory:[]}));const before=JSON.stringify(repository.readStore()),calls=[];
 const client=createClient({env:{ASSISTANT_CHAT_ENABLED:'true',ASSISTANT_CHAT_URL:'https://chat.example.test/chat',ASSISTANT_CHAT_API_KEY:'test-server-only-secret'},fetchImpl:async(_url,options)=>{
  await new Promise(resolve=>setTimeout(resolve,10));const body=JSON.parse(options.body);calls.push(body);
  return new Response(JSON.stringify({success:true,sessionId:body.sessionId,intent:'biz',reply:'按本店资料，15块钱的有10个G通用加10个G定向；20块钱的是15个G通用加10个G定向；30块钱的是20个G通用加20个G定向。',hits:[{std:'单独加流量包好多钱',score:0.763}]}),{headers:{'content-type':'application/json'}});
 }});
 const server=createServer({assistantChatClient:client});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const tokens=users.map(user=>sessions.issue(user.id));
 const post=async(index,payload)=>{const response=await fetch(origin+'/api/assistant/ask',{method:'POST',headers:{'Content-Type':'application/json',...(index===null?{}:{Authorization:'Bearer '+tokens[index]})},body:JSON.stringify(payload)});return {status:response.status,data:await response.json()};};
 try{
  assert.equal((await post(null,{question:'你好'})).status,401);assert.equal(calls.length,0);
  const a=await post(0,{question:'单独加个流量包好多钱'});assert.equal(a.status,200);assert.equal(a.data.externalChat.status,'connected');assert.equal(a.data.metrics.kind,'external-chat');assert.match(a.data.answer,/20块钱/);
  const follow=await post(0,{question:'那20块的有多少流量',context:a.data.context});assert.match(follow.data.answer,/15个G通用加10个G定向/);assert.equal(calls.length,1);
  const b=await post(1,{question:'你好',context:a.data.context});assert.notEqual(b.data.context.externalChat.sessionId,a.data.context.externalChat.sessionId);
  const customer=await post(0,{question:'你好',context:a.data.context,mode:'customer'});assert.equal(customer.data.mode,'customer');assert.notEqual(customer.data.context.externalChat.sessionId,a.data.context.externalChat.sessionId);
  const beforeInternal=calls.length;
  for(const question of ['查库存','今天华为毛利多少','串号1234','帮我开销售单','客户手机号15923432599'])assert.equal((await post(0,{question,context:a.data.context})).status,200);
  const locked=await post(2,{question:'今天营业额多少',mode:'store',context:a.data.context});assert.equal(locked.data.metrics.restricted,true);assert.equal(locked.data.mode,'customer');assert.equal(calls.length,beforeInternal);
  assert.ok(calls.every(call=>Object.keys(call).sort().join(',')==='message,sessionId,stream'));
  assert.ok(!JSON.stringify(a.data).includes('test-server-only-secret'));
  assert.equal(JSON.stringify(repository.readStore()),before);
 }finally{
  tokens.forEach(token=>sessions.revoke(token));await new Promise(resolve=>server.close(resolve));sessions.close();fs.rmSync(temporary,{recursive:true,force:true});
 }
});
