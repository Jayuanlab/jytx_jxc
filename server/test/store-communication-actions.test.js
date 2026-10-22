'use strict';
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),test=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),load=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:load.call(this,n,...args)};
const c=require('../src/common'),comm=require('../src/store-communication');
const actors=[{id:'boss',name:'测试老板',roleCode:'owner',status:'active'},{id:'a',name:'测试甲',roleCode:'employee',status:'active'},{id:'b',name:'测试乙',roleCode:'employee',status:'active'},{id:'third',name:'旁人',roleCode:'employee',status:'active'},{id:'guest',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'},{id:'inactive',roleCode:'employee',status:'inactive'}];
const fixture=()=>c.initialize({users:structuredClone(actors)}),user=(s,id)=>s.users.find(u=>u.id===id),send=(s,from,to,content)=>comm.send(s,user(s,from),{recipientId:to,content});
test('撤回仅发送者可操作，保留原文证据，消息接口隐藏原文，撤回不再计未读',()=>{
 const s=fixture(),row=send(s,'a','b','原始私聊证据');assert.equal(comm.summary(s,user(s,'b')).unread,1);
 for(const id of ['b','boss','third','guest','inactive'])assert.throws(()=>comm.withdraw(s,user(s,id),{id:row.id}),e=>e.statusCode===403);
 assert.equal(row.withdrawnAt,undefined);const changed=comm.withdraw(s,user(s,'a'),{id:row.id});assert.equal(changed.withdrawn,true);assert.equal(changed.content,'');assert.equal(s.staffMessages[0].content,'原始私聊证据');
 assert.equal(comm.summary(s,user(s,'b')).unread,0);assert.deepEqual(comm.summary(s,user(s,'b')).previews,[]);assert.doesNotMatch(JSON.stringify(comm.list(s,user(s,'b'),'a')),/原始私聊证据/);
 const count=s.operationLogs.length;comm.withdraw(s,user(s,'a'),{id:row.id});assert.equal(s.operationLogs.length,count);assert.equal(comm.list(s,user(s,'third'),'a').rows.length,0);
});
test('清屏按员工和会话隔离，历史可查，新消息仍未读，不跨过并发新消息',()=>{
 const s=fixture(),old=send(s,'a','b','旧私信');send(s,'a','all','全店旧消息');const fresh=send(s,'a','b','并发新消息');
 comm.clearThread(s,user(s,'b'),{peerId:'a',throughSequence:old.sequence});
 assert.deepEqual(comm.list(s,user(s,'b'),'a').rows.map(r=>r.id),[fresh.id]);assert.equal(comm.list(s,user(s,'b'),'a').hasClearedMessages,true);
 assert.equal(comm.list(s,user(s,'a'),'b').rows.length,2);assert.equal(comm.list(s,user(s,'b')).rows.length,1);assert.equal(comm.list(s,user(s,'b'),'a','',true).rows.length,2);
 assert.equal(comm.summary(s,user(s,'b')).unreadByPeer.a,1);assert.equal(comm.summary(s,user(s,'b')).previews[0].content,'并发新消息');
 comm.read(s,user(s,'b'),{peerId:'a',throughSequence:fresh.sequence});assert.equal(comm.list(s,user(s,'b'),'a').rows.length,1);assert.equal(s.staffMessageReads.find(r=>r.userId==='b'&&r.peerId==='a').hiddenThroughSequence,old.sequence);
 const count=s.operationLogs.length;comm.clearThread(s,user(s,'b'),{peerId:'a',throughSequence:old.sequence});assert.equal(s.operationLogs.length,count);assert.equal(s.staffMessages.length,3);
});
test('清屏验证会话和游标，旧消息分页可以恢复，撤回在历史中也不泄漏原文',()=>{
 const s=fixture();for(let i=1;i<=65;i++)send(s,'a','all','全店'+i);
 const last=s.staffMessages.at(-1);comm.clearThread(s,user(s,'b'),{peerId:'all',throughSequence:last.sequence});
 assert.equal(comm.list(s,user(s,'b')).rows.length,0);assert.deepEqual(comm.summary(s,user(s,'b')).previews,[]);assert.equal(comm.summary(s,user(s,'b')).unread,0);
 const history=comm.list(s,user(s,'b'),'all','',true);assert.equal(history.rows.length,50);assert.equal(history.hasMore,true);assert.equal(comm.list(s,user(s,'b'),'all',history.rows[0].sequence,true).rows.length,15);
 comm.withdraw(s,user(s,'a'),{id:last.id});assert.doesNotMatch(JSON.stringify(comm.list(s,user(s,'b'),'all','',true)),/全店65/);
 const privateRow=send(s,'a','third','不是乙的消息');
 for(const value of [true,-1,1.5,999,privateRow.sequence])assert.throws(()=>comm.clearThread(s,user(s,'b'),{peerId:'all',throughSequence:value}),e=>e.statusCode===400);
 for(const id of ['guest','inactive'])assert.throws(()=>comm.clearThread(s,user(s,id),{peerId:'all',throughSequence:1}),e=>e.statusCode===403);
});
test('撤回实时事件只通知参与双方，清屏实时事件只通知操作人',()=>{
 const {EventEmitter}=require('node:events'),events=require('../src/store-communication-events');
 const clients=['a','b','third'].map(id=>{const req=new EventEmitter(),res=new EventEmitter();res.frames=[];res.writeHead=()=>{};res.flushHeaders=()=>{};res.write=t=>{res.frames.push(t);return true};res.end=()=>res.emit('close');events.subscribe(req,res,id,()=>true);return {req,res};});
 try{events.changed('/api/store-communication/withdraw',{senderId:'a',recipientId:'b'},'a');assert.ok(clients[0].res.frames.some(f=>f.includes('changed')));assert.ok(clients[1].res.frames.some(f=>f.includes('changed')));assert.ok(!clients[2].res.frames.some(f=>f.includes('changed')));
  clients.forEach(x=>x.res.frames=[]);events.changed('/api/store-communication/clear',{},'b');assert.ok(!clients[0].res.frames.length);assert.ok(clients[1].res.frames.some(f=>f.includes('changed')));assert.ok(!clients[2].res.frames.length);
 }finally{clients.forEach(x=>x.req.emit('aborted'))}
});
test('真实 HTTP 撤回、清屏、查记录和丢失响应重试，后台消息不删除',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'message-actions-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(fixture()));
 const repo=require('../src/repository'),sessions=require('../src/auth-sessions'),{createServer}=require('../src/application');repo.resetStore(fixture());const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,cookies=Object.fromEntries(['a','b','boss','guest'].map(id=>[id,'erp_session='+sessions.issue(id)]));
 const post=(who,route,body,key=crypto.randomUUID())=>fetch(origin+'/api/store-communication/'+route,{method:'POST',headers:{Cookie:cookies[who],'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
 const get=(who,query)=>fetch(origin+'/api/store-communication'+query,{headers:{Cookie:cookies[who]}});
 try{
  const msg=await (await post('a','send',{recipientId:'b',content:'HTTP撤回原文'})).json();
  for(const id of ['b','boss','guest'])assert.equal((await post(id,'withdraw',{id:msg.id})).status,403);
  const key=crypto.randomUUID(),first=await post('a','withdraw',{id:msg.id},key),retry=await post('a','withdraw',{id:msg.id},key);assert.equal(first.status,200);assert.equal(retry.status,200);assert.deepEqual(await first.json(),await retry.json());
  const shown=await (await get('b','?peer=a')).json();assert.equal(shown.rows[0].content,'');assert.equal(shown.rows[0].withdrawn,true);
  const msg2=await (await post('a','send',{recipientId:'b',content:'HTTP清屏记录'})).json();const clearKey=crypto.randomUUID();
  assert.equal((await post('b','clear',{peerId:'a',throughSequence:msg2.sequence},clearKey)).status,200);assert.equal((await post('b','clear',{peerId:'a',throughSequence:msg2.sequence},clearKey)).status,200);
  assert.equal((await (await get('b','?peer=a')).json()).rows.length,0);assert.equal((await (await get('b','?peer=a&history=1')).json()).rows.length,2);
  const stored=repo.readStore();assert.equal(stored.staffMessages.length,2);assert.equal(stored.staffMessages[0].content,'HTTP撤回原文');assert.equal(stored.operationLogs.filter(r=>r.action==='message:withdraw').length,1);assert.equal(stored.operationLogs.filter(r=>r.action==='message:clear').length,1);
  for(const name of ['sales','purchases','inventory','receipts'])assert.equal(stored[name].length,0);
 }finally{await new Promise(r=>server.close(r));sessions.close();fs.rmSync(folder,{recursive:true,force:true})}
});

test('撤回更新包括较早分页，不泄漏其他私聊，游标不会遗漏同轮多次撤回',()=>{
 const s=fixture();for(let i=0;i<65;i++)send(s,'a','all','早消息'+i);
 const first=s.staffMessages[0],second=s.staffMessages[1],privateRow=send(s,'a','third','不应泄漏');
 comm.withdraw(s,user(s,'a'),{id:first.id});const one=comm.list(s,user(s,'b'),'all');assert.ok(!one.rows.some(r=>r.id===first.id));assert.deepEqual(one.withdrawnRows.map(r=>r.id),[first.id]);
 comm.withdraw(s,user(s,'a'),{id:second.id});comm.withdraw(s,user(s,'a'),{id:privateRow.id});
 const delta=comm.list(s,user(s,'b'),'all','',false,one.withdrawRevision);assert.deepEqual(delta.withdrawnRows.map(r=>r.id),[second.id]);assert.equal(delta.withdrawRevision,3);assert.ok(delta.withdrawnRows.every(r=>r.content===''));
});
