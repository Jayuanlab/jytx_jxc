'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createClient,identity}=require('../src/assistant-external-chat');
const settings=()=>({ASSISTANT_CHAT_ENABLED:'true',ASSISTANT_CHAT_URL:'https://chat.example.test/api/public/chat',ASSISTANT_CHAT_API_KEY:'test-only-key'});
const who=(branch='b1',user='u1',mode='store',tenant='t1')=>identity({tenantId:tenant,branchId:branch},{id:user,roleCode:'employee'},mode);
function transport(handler){return async (url,options)=>{const request=JSON.parse(options.body);return handler(request,options,url);};}
const json=(req,extra={})=>new Response(JSON.stringify({success:true,sessionId:req.sessionId,intent:'biz',reply:'请按资料核对适用条件。',hits:[{std:'流量包怎么收费',score:0.8}],...extra}),{headers:{'content-type':'application/json'}});
test('未配置、占位地址和不安全地址均不外发请求',async()=>{
 for(const env of [{}, {...settings(),ASSISTANT_CHAT_ENABLED:'false'}, {...settings(),ASSISTANT_CHAT_URL:'https://<域名>/api/public/chat'}, {...settings(),ASSISTANT_CHAT_URL:'http://chat.example.test/chat'}, {...settings(),ASSISTANT_CHAT_URL:'https://user:password@chat.example.test/chat'}, {...settings(),ASSISTANT_CHAT_API_KEY:'bad\nkey'}]){
  let calls=0;const client=createClient({env,fetchImpl:async()=>{calls++;throw Error('unused');}});
  assert.equal(client.configured(),false);assert.equal((await client.request('你好',null,who())).status,'disabled');assert.equal(calls,0);
 }
});
test('按合同 POST，保留同一用户上下文，不把钥匙或额外字段返回浏览器',async()=>{
 const seen=[],env=settings(),client=createClient({env,fetchImpl:transport((req,options,url)=>{seen.push(req);assert.equal(url,env.ASSISTANT_CHAT_URL);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+env.ASSISTANT_CHAT_API_KEY);assert.equal(options.headers.Accept,'application/json');assert.deepEqual(Object.keys(req).sort(),['message','sessionId','stream']);return json(req,{privateField:env.ASSISTANT_CHAT_API_KEY});})});
 const a=await client.request('单独加个流量包好多钱',null,who()),b=await client.request('那20块的呢',a.context,who());
 assert.equal(a.status,'ok');assert.equal(b.status,'ok');assert.equal(seen[0].sessionId,seen[1].sessionId);
 assert.equal(JSON.stringify(a).includes(env.ASSISTANT_CHAT_API_KEY),false);assert.equal(a.privateField,undefined);
});
test('跨员工、跨门店、跨租户、店内和顾客模式不共用会话',async()=>{
 const client=createClient({env:settings(),fetchImpl:transport(req=>json(req))}),a=await client.request('你好',null,who());
 for(const id of [who('b2'),who('b1','u2'),who('b1','u1','customer'),who('b1','u1','store','t2')]){
  assert.equal(client.hasContext(a.context,id),false);assert.notEqual((await client.request('继续',a.context,id)).context.sessionId,a.context.sessionId);
 }
});
test('篡改、到期和未来时间的上下文不能冒用现有会话',async()=>{
 let time=1000000;const client=createClient({env:settings(),now:()=>time,fetchImpl:transport(req=>json(req))}),a=await client.request('你好',null,who());
 assert.equal(client.hasContext({...a.context,at:a.context.at+1},who()),false);
 assert.equal(client.hasContext({...a.context,sessionId:'00000000-0000-0000-0000-000000000000'},who()),false);
 time+=30*60*1000;assert.equal(client.hasContext(a.context,who()),false);
 time=1;assert.equal(client.hasContext(a.context,who()),false);
});
test('SSE 跨字节分块仍能组合完整汉字，并验证完成标志',async()=>{
 const client=createClient({env:settings(),fetchImpl:transport(req=>{
 const raw=Buffer.from('data: '+JSON.stringify({t:'按',intent:'biz'})+'\n\ndata: '+JSON.stringify({t:'本店资料',intent:'biz'})+'\n\ndata: '+JSON.stringify({done:true,sessionId:req.sessionId})+'\n\n');
 return new Response(new ReadableStream({start(c){for(let i=0;i<raw.length;i++)c.enqueue(raw.subarray(i,i+1));c.close();}}),{headers:{'content-type':'text/event-stream'}});
 })});const r=await client.request('你好',null,who());assert.equal(r.status,'ok');assert.equal(r.reply,'按本店资料');
});
test('404、登录页和损坏 JSON 返回可识别的失败，不把原始网页吐给用户',async()=>{
 for(const [response,reason] of [[new Response('not found',{status:404}),'http-404'],[new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),'unexpected-content-type'],[new Response('{bad',{headers:{'content-type':'application/json'}}),'invalid-json']]){
 const client=createClient({env:settings(),fetchImpl:async()=>response});const r=await client.request('你好',null,who());assert.equal(r.status,'unavailable');assert.equal(r.reason,reason);assert.equal(r.reply,undefined);
 }
});
test('返回另一会话或错误证据不能显示成有效回答',async()=>{
 for(const [extra,reason] of [[{sessionId:'other'},'session-mismatch'],[{hits:[{std:'未知',score:NaN}]},'invalid-hits'],[{success:false},'invalid-response'],[{reply:''},'invalid-response']]){
 const client=createClient({env:settings(),fetchImpl:transport(req=>json(req,extra))});assert.equal((await client.request('你好',null,who())).reason,reason);
 }
});
test('未完成的流式回答和完成后追加内容不能当作最终回答',async()=>{
 for(const suffix of ['', 'data: '+JSON.stringify({done:true,sessionId:'wrong'})+'\n\n']){
 const client=createClient({env:settings(),fetchImpl:transport(()=>new Response('data: {"t":"按","intent":"biz"}\n\n'+suffix,{headers:{'content-type':'text/event-stream'}}))});assert.equal((await client.request('你好',null,who())).status,'unavailable');
 }
 const client=createClient({env:settings(),fetchImpl:transport(req=>new Response('data: {"t":"按","intent":"biz"}\n\ndata: '+JSON.stringify({done:true,sessionId:req.sessionId})+'\n\ndata: {"t":"追加"}\n\n',{headers:{'content-type':'text/event-stream'}}))});
 assert.equal((await client.request('你好',null,who())).reason,'data-after-done');
});
test('过大的响应和超长回答受限制',async()=>{
 const big=createClient({env:settings(),fetchImpl:async()=>new Response('x'.repeat(128*1024+1),{headers:{'content-type':'application/json'}})});
 assert.equal((await big.request('你好',null,who())).reason,'response-too-large');
 const long=createClient({env:settings(),fetchImpl:transport(req=>json(req,{reply:'字'.repeat(8001)}))});
 assert.equal((await long.request('你好',null,who())).reason,'invalid-response');
});
test('并发达到上限时快速回退，释放后可以继续调用',async()=>{
 let release;const env={...settings(),ASSISTANT_CHAT_MAX_CONCURRENT:'1'},client=createClient({env,fetchImpl:transport(req=>new Promise(resolve=>{release=()=>resolve(json(req));}))});
 const first=client.request('你好',null,who());assert.equal((await client.request('你好',null,who('b2'))).reason,'busy');release();assert.equal((await first).status,'ok');
 const next=client.request('继续',null,who());release();assert.equal((await next).status,'ok');
});
test('超时结束调用，错误不会包含凭据',async()=>{
 const env={...settings(),ASSISTANT_CHAT_TIMEOUT_MS:'1000'},client=createClient({env,fetchImpl:(_url,opts)=>new Promise((_resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(Error('secret upstream text')),{once:true});})});
 const r=await client.request('你好',null,who());assert.equal(r.reason,'timeout');assert.equal(JSON.stringify(r).includes('secret'),false);
});

test('普通资费被错判成交时，从独立知识检索找已有答案',async()=>{
 const calls=[],client=createClient({env:settings(),fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  if(url.endsWith('/knowledge-search'))return new Response(JSON.stringify({success:true,entries:[{source:'mobile',std:'单独加流量包好多钱',answer:'20元档为15G全国通用加10G定向。',score:0.85}]}),{headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({success:true,sessionId:body.sessionId,intent:'deal',reply:'请到门店买手机',hits:[]}),{headers:{'content-type':'application/json'}});
 }});
 const result=await client.request('20元流量包里面有多少流量',null,'user1');
 assert.equal(result.status,'ok');assert.equal(result.intent,'biz');assert.match(result.reply,/15G/);assert.equal(result.hits[0].score,0.85);
 assert.equal(calls[1].body.source,'mobile');assert.equal(calls[1].body.q,'单独加个流量包好多钱');assert.equal(result.context.business.reply,result.reply);
});
test('检索失败、弱匹配或系统自测条目不能覆盖真实回答',async()=>{
 for(const entries of [[],[{source:'mobile',std:'流量包',answer:'不确定答案',score:0.4}],[{source:'mobile',std:'随机系统自测',answer:'答案A',score:1}]]){
  const client=createClient({env:settings(),fetchImpl:async(url,options)=>{
   if(url.endsWith('/knowledge-search'))return new Response(JSON.stringify({success:true,entries}),{headers:{'content-type':'application/json'}});
   const body=JSON.parse(options.body);return new Response(JSON.stringify({success:true,sessionId:body.sessionId,intent:'deal',reply:'请到门店',hits:[]}),{headers:{'content-type':'application/json'}});
  }});
  assert.equal((await client.request('20元流量包',null,'u1')).intent,'deal');
 }
});

test('普通业务无命中时也尝试独立检索，other 命中按业务证据处理',async()=>{
 let calls=0;const client=createClient({env:settings(),fetchImpl:async(url,options)=>{
  calls++;
  if(url.endsWith('/knowledge-search'))return new Response(JSON.stringify({success:true,entries:[{source:'mobile',std:'办卡带身份证吗',answer:'请携本人有效身份证。',score:0.9}]}),{headers:{'content-type':'application/json'}});
  const req=JSON.parse(options.body);return json(req,{intent:'other',reply:'请咨询老板或渠道经理。',hits:[]});
 }});
 const a=await client.request('办卡要带身份证吗',null,who());assert.equal(calls,2);assert.equal(a.intent,'biz');assert.equal(a.context.business.reply,a.reply);
 const other=createClient({env:settings(),fetchImpl:transport(req=>json(req,{intent:'other'}))});
 const b=await other.request('流量包怎么收费',null,who());assert.equal(b.intent,'biz');assert.ok(b.context.business);
});

test('有弱命中但已有正确标准答案时补查知识库，不降低证据门槛',async()=>{
 const calls=[],client=createClient({env:settings(),fetchImpl:async(url,options)=>{
  const req=JSON.parse(options.body);calls.push({url,body:req});
  if(url.endsWith('/knowledge-search'))return new Response(JSON.stringify({success:true,entries:[{source:'mobile',std:'单独加个流量包好多钱',answer:'15元10G全国通用+10G定向；20元15G全国通用+10G定向；30元20G全国通用+20G定向。',score:0.85}]}),{headers:{'content-type':'application/json'}});
  return json(req,{reply:'20元15G全国通用+10G定向。',hits:[{std:'单独加个流量包好多钱',score:0.493}]});
 }});
 const a=await client.request('20元流量包里面有多少流量',null,who());
 assert.equal(calls.length,2);assert.equal(calls[1].body.q,'单独加个流量包好多钱');
 assert.equal(a.status,'ok');assert.equal(a.hits[0].score,0.85);assert.match(a.reply,/20元15G/);
});
test('弱命中补查仍不准确时保留弱证据，由网站继续回退',async()=>{
 const client=createClient({env:settings(),fetchImpl:async(url,options)=>{
  if(url.endsWith('/knowledge-search'))return new Response(JSON.stringify({success:true,entries:[{source:'mobile',std:'流量包费用',answer:'争议价',score:0.6}]}),{headers:{'content-type':'application/json'}});
  return json(JSON.parse(options.body),{reply:'原回答',hits:[{std:'流量包费用',score:0.493}]});
 }});
 const a=await client.request('20元流量包里面有多少流量',null,who());
 assert.equal(a.reply,'原回答');assert.equal(a.hits[0].score,0.493);
});
