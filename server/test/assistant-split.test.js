'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:original.call(this,name,...args);};
const c=require('../src/common'),roles=require('../src/assistant-roles'),personal=require('../src/companion'),chat=require('../src/companion-chat'),hub=require('../src/learning-hub'),learning=require('../src/learning'),kitty=require('../src/assistant-kitty'),live=require('../src/assistant-live'),{createClient}=require('../src/companion-model');
const owner={id:'a',name:'甲老板',roleCode:'owner'},other={id:'b',name:'乙老板',roleCode:'owner'},staff={id:'s',name:'店员',roleCode:'employee'},kiosk={id:'k',name:'顾客',roleCode:'customer-assistant'};
const store=()=>c.initialize({users:[owner,other,staff,kiosk],products:[],inventory:[],sales:[]});
test('角色入口与私有数据权限，顾客不能靠 owner 标记进入',()=>{
 assert.equal(roles.catalog(staff).personal,false);assert.equal(roles.catalog(kiosk).work,false);assert.equal(roles.catalog(owner).personal,true);
 for(const user of [staff,kiosk,{...owner,assistantCustomerOnly:true}])assert.throws(()=>personal.snapshot(store(),user),{statusCode:403});
});
test('两位老板的资料、记忆、人情账和提醒互相隔离，ID 也不能越权修改',()=>{
 const s=store();personal.saveProfile(s,owner,{nickname:'甲',city:'云阳'});const m=personal.memory(s,owner,{content:'喜欢散步',category:'爱好'});
 personal.favor(s,owner,{date:'2026-10-11',person:'测试朋友',occasion:'生日',direction:'送出',amount:100});
 const reminder=personal.reminder(s,owner,{title:'走一走',dueAt:'2026-10-11T20:00:00+08:00'});
 assert.deepEqual(personal.snapshot(s,other).memories,[]);assert.deepEqual(personal.snapshot(s,other).favors,[]);assert.deepEqual(personal.snapshot(s,other).reminders,[]);
 assert.throws(()=>personal.memory(s,other,{id:m.id,content:'改掉'}),{statusCode:404});
 assert.throws(()=>personal.removeMemory(s,other,{id:m.id}),{statusCode:404});
 assert.throws(()=>personal.completeReminder(s,other,{id:reminder.id}),{statusCode:404});
 assert.ok(!JSON.stringify(s.operationLogs).includes('喜欢散步'));
});
test('记忆去重、修改和删除，同时清理旧聊天里对应的私人事实',()=>{
 const s=store(),m=personal.memory(s,owner,{content:'每天七点起床'});assert.equal(personal.memory(s,owner,{content:'每天七点起床'}).id,m.id);
 personal.append(s,owner,'记住：每天七点起床',{answer:'记住每天七点起床'},'a');personal.append(s,other,'每天七点起床',{answer:'别人的事实'},'b');
 personal.memory(s,owner,{id:m.id,version:m.version,content:'每天八点起床'});assert.equal(personal.own(s,'companionMessages',owner).length,0);assert.equal(personal.own(s,'companionMessages',other).length,1);
 personal.append(s,owner,'每天八点起床',{answer:'已记住'},'c');personal.removeMemory(s,owner,{id:m.id});
 assert.equal(personal.own(s,'companionMessages',owner).length,0);assert.equal(personal.snapshot(s,owner).memories.length,0);
});
test('清聊天保留长期记忆，120 条上限按本人计算',()=>{
 const s=store();personal.memory(s,owner,{content:'喜欢清茶'});
 personal.append(s,other,'别人的聊天',{answer:'保留'},'b');
 for(let n=0;n<125;n++)personal.append(s,owner,'消息'+n,{answer:'回复'+n},String(n));
 assert.equal(personal.snapshot(s,owner).messages.length,120);assert.equal(personal.snapshot(s,owner).messages[0].question,'消息5');
 personal.clearHistory(s,owner);assert.equal(personal.snapshot(s,owner).messages.length,0);assert.equal(personal.snapshot(s,owner).memories.length,1);assert.equal(personal.snapshot(s,other).messages.length,1);
});
test('日期和个人往来金额校验，不写营业厅账目',()=>{
 const s=store();
 for(const date of ['2026-02-30','2026-99-99'])assert.throws(()=>personal.favor(s,owner,{date,person:'甲',occasion:'生日',direction:'送出',amount:10}),{statusCode:400});
 assert.throws(()=>personal.favor(s,owner,{date:'2026-10-11',person:'甲',occasion:'生日',direction:'送出',amount:-1}),{statusCode:400});
 assert.deepEqual(s.sales,[]);assert.deepEqual(s.receipts||[],[]);assert.deepEqual(s.payments||[],[]);
});
test('个人聊天的记住命令和幂等提交，只保存同一组问答一次',async()=>{
 const s=store(),result=await chat.prepare(s,owner,{question:'记住：我喜欢散步'});
 chat.commit(s,owner,'记住：我喜欢散步',result,'one');chat.commit(s,owner,'记住：我喜欢散步',result,'one');
 assert.equal(s.companionMemories.length,1);assert.equal(s.companionMessages.length,1);
 assert.throws(()=>chat.commit(s,owner,'另一句话',result,'one'),{statusCode:409});
});
test('个人记忆授权默认关闭，打开后才能发给通用模型',async()=>{
 const s=store(),calls=[];personal.memory(s,owner,{content:'喜欢清茶'});
 const model={configured:()=>true,request:async(q,options)=>{calls.push(options);return '今天有什么想聊的？';}},options={companionModelClient:model,liveQuery:async()=>null};
 await chat.prepare(s,owner,{question:'今天心情好'},options);assert.deepEqual(calls[0].memories,[]);assert.deepEqual(calls[0].messages,[]);
 personal.saveProfile(s,owner,{nickname:'甲',shareWithModel:true});personal.append(s,owner,'昨天的生活',{answer:'聊一聊',channel:'life'},'life');
 await chat.prepare(s,owner,{question:'接着说昨天的事'},options);assert.equal(calls[1].memories[0].content,'喜欢清茶');assert.equal(calls[1].messages.length,1);
});
test('询问家人姓名时只用已确认记忆，没有依据不让模型猜',async()=>{
 const s=store();let modelCalls=0;
 const options={companionModelClient:{configured:()=>true,request:async()=>{modelCalls++;return '你儿子叫小王。';}},liveQuery:async()=>null};
 const missing=await chat.prepare(s,owner,{question:'我儿子叫什么名字？'},options);
 assert.match(missing.answer,/已确认的记忆里还没找到/);assert.equal(modelCalls,0);
 personal.memory(s,owner,{content:'我儿子叫小张',category:'家人'});
 const found=await chat.prepare(s,owner,{question:'我儿子叫什么名字？'},options);
 assert.match(found.answer,/我儿子叫小张/);assert.equal(modelCalls,0);
});
test('营业厅待办优先查营业厅，不误用生活提醒，不发给生活模型',async()=>{
 const s=store();personal.reminder(s,owner,{title:'私人散步',dueAt:'2026-10-11T20:00:00+08:00'});let calls=0;
 const result=await chat.prepare(s,owner,{question:'今天店里待办有哪些'},{companionModelClient:{configured:()=>true,request:async()=>{calls++;return 'bad';}}});
 assert.equal(result.channel,'work');assert.equal(calls,0);assert.ok(!result.answer.includes('私人散步'));
});
test('通用接口按说明传 history，过滤营业厅对话，独立上游 session',async()=>{
 const calls=[],client=createClient({env:{COMPANION_CHAT_URL:'https://example.test/api/companion/chat',COMPANION_CHAT_API_KEY:'server-secret'},fetchImpl:async(url,options)=>{calls.push({url:String(url),options,body:JSON.parse(options.body)});return new Response(JSON.stringify({success:true,reply:'你好'}));}});
 const payload={profile:{nickname:'甲'},memories:[{content:'喜欢清茶',confirmed:true}],messages:[{question:'营业厅底价',answer:'成本数据',channel:'work'},{question:'今天天气不错',answer:'去散步吧',channel:'life'}]};
 assert.equal(await client.request('继续聊',payload),'你好');await client.request('再聊',payload);
 assert.deepEqual(Object.keys(calls[0].body).sort(),['history','message','sessionId','stream']);assert.equal(calls[0].body.stream,false);
 assert.match(JSON.stringify(calls[0].body.history),/喜欢清茶/);assert.ok(!JSON.stringify(calls[0].body).includes('营业厅底价'));assert.notEqual(calls[0].body.sessionId,calls[1].body.sessionId);
 assert.equal(calls[0].options.headers.Authorization,'Bearer server-secret');
});
test('通用模型未上线、错 key、返回 HTML 或异常时稳妥回退',async()=>{
 for(const fetchImpl of [async()=>new Response('not found',{status:404}),async()=>new Response('unauthorized',{status:401}),async()=>new Response('<html>bad</html>'),async()=>{throw Error('offline');}])assert.equal(await createClient({env:{COMPANION_CHAT_URL:'https://example.test/chat',COMPANION_CHAT_API_KEY:'key'},fetchImpl}).request('你好'),null);
 const disabled=createClient({env:{COMPANION_CHAT_ENABLED:'false',COMPANION_CHAT_URL:'https://example.test/chat',COMPANION_CHAT_API_KEY:'key'},fetchImpl:()=>{throw Error('must not call');}});assert.equal(disabled.configured(),false);assert.equal(await disabled.request('你好'),null);
});
test('通用模型同时最多四个请求，完成后释放名额',async()=>{
 let finish;const wait=new Promise(r=>finish=r),client=createClient({env:{COMPANION_CHAT_URL:'https://example.test/chat',COMPANION_CHAT_API_KEY:'key'},fetchImpl:async()=>{await wait;return new Response(JSON.stringify({success:true,reply:'好了'}));}});
 const requests=Array.from({length:4},()=>client.request('你好'));assert.equal(await client.request('第五个'),null);finish();assert.deepEqual(await Promise.all(requests),['好了','好了','好了','好了']);assert.equal(await client.request('继续'),'好了');
});
test('小猫咪闲聊第三轮自然回到业务，顾客绝不进入私有记忆',async()=>{
 const local={mode:'customer',metrics:{}},scope={tenantId:'t',branchId:'b'},model={request:async()=> '简短陪你聊一会。'};
 let response=await kitty.respond(local,kiosk,{question:'陪我聊聊'},{scope,companionModelClient:model,liveQuery:async()=>null});
 response=await kitty.respond(local,kiosk,{question:'无聊',context:response.context},{scope,companionModelClient:model,liveQuery:async()=>null});
 response=await kitty.respond(local,kiosk,{question:'再陪我聊聊',context:response.context},{scope,companionModelClient:model,liveQuery:async()=>null});
 assert.equal(response.metrics.chatLimit,true);assert.match(response.answer,/移动业务/);
 assert.equal(await kitty.respond({mode:'store'},staff,{question:'闲聊'}),null);
});
test('小猫咪闲聊模型不能给未经知识检索的套餐报价',async()=>{
 const response=await kitty.respond({mode:'customer',metrics:{}},kiosk,{question:'闲聊'},{companionModelClient:{request:async()=> '套餐只要99元每月'},liveQuery:async()=>null});
 assert.ok(!response.answer.includes('99'));assert.equal(response.metrics.modelConnected,false);
});
test('学习练习防重复刷分，审核后才计入自己的积分',()=>{
 const s=store(),body={scenario:'usage',answer:'先了解顾客现在的套餐和实际使用情况，再查询现行政策。',reflection:'下次先听顾客需求，报价和办理条件都要核实。'};
 const a=hub.practice(s,staff,body),b=hub.practice(s,staff,body);assert.equal(a.duplicate,false);assert.equal(b.duplicate,true);assert.equal(s.learningRecords.length,1);assert.equal(hub.stats(s,staff).points,0);
 learning.review(s,owner,{id:a.record.id,approve:true,points:6});assert.equal(hub.stats(s,staff).points,6);assert.equal(hub.stats(s,other).points,0);
 assert.throws(()=>hub.practice(s,kiosk,body),{statusCode:403});
});
test('问答贡献积分只老板核定、审核后可发、仅能核定一次',()=>{
 const s=store();s.assistantAnswerFeedback=[{id:'f',submittedById:staff.id,submittedBy:staff.name,status:'待审核'}];
 assert.throws(()=>hub.award(s,owner,{id:'f',points:10,note:'贡献'}),{statusCode:400});s.assistantAnswerFeedback[0].status='已生效';
 assert.throws(()=>hub.award(s,staff,{id:'f',points:10,note:'贡献'}),{statusCode:403});
 hub.award(s,owner,{id:'f',points:10,note:'补充了正确的问答'});assert.equal(hub.stats(s,staff).contributionPoints,10);
 assert.throws(()=>hub.award(s,owner,{id:'f',points:10,note:'重复'}),{statusCode:409});
});
test('实时天气要地点和当天来源，不把旧预报当今天',async()=>{
 live.clearCache();assert.equal((await live.query('今天天气')).metrics.needsCity,true);
 const now=Date.parse('2026-10-11T12:00:00+08:00');let calls=0;
 const fetchImpl=async url=>{calls++;return new Response(JSON.stringify(String(url).includes('geocoding')?{results:[{country_code:'CN',latitude:30,longitude:108,name:'云阳',admin1:'重庆'}]}:{daily:{time:['2026-10-11','2026-10-12','2026-10-13'],weather_code:[2,3,61],temperature_2m_min:[15,14,12],temperature_2m_max:[25,22,20]},current:{temperature_2m:21}}));};
 const today=await live.query('云阳天气',{fetchImpl,now});assert.match(today.answer,/15～25/);assert.equal(today.sources.length,1);
 const tomorrow=await live.query('云阳明天天气',{fetchImpl,now});assert.match(tomorrow.answer,/14～22/);assert.equal(calls,2);
 const stale=await live.query('云阳天气',{fetchImpl,now:now+86400000});assert.equal(stale.metrics.unavailable,true);
});
test('实时新闻仅保留近期官方来源、标题和链接，不采用恶意链接',async()=>{
 live.clearCache();const now=Date.parse('2026-10-11T12:00:00+08:00'),date=new Date(now-3600000).toUTCString();
 const xml='<rss><channel><item><title><![CDATA[公开报道标题]]></title><link>https://www.chinanews.com.cn/test.shtml</link><pubDate>'+date+'</pubDate></item><item><title>恶意链接</title><link>javascript:alert(1)</link><pubDate>'+date+'</pubDate></item><item><title>过期报道</title><link>https://www.chinanews.com.cn/old.shtml</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item></channel></rss>';
 const result=await live.query('最近新闻',{now,fetchImpl:async()=>new Response(xml)});assert.match(result.answer,/公开报道标题/);assert.ok(!result.answer.includes('恶意链接'));assert.ok(!result.answer.includes('过期报道'));assert.equal(result.sources.length,1);
});


test('工作助理遇到明确生活聊天转个人入口，不调用移动业务或生活模型',async()=>{
 const work=require('../src/assistant-chat'),s=store();let calls=0;
 const client={configured:()=>true,hasContext:()=>false,request:async()=>{calls++;return {};}}
 for(const user of [owner,staff])for(const question of ['今天天热得很，聊两句嘛','陪我聊聊退休生活','记住：我喜欢散步']){const result=await work.ask(s,user,{question,mode:'store'},{client});assert.equal(result.metrics.kind,'work-scope');if(user===staff)assert.equal(result.action,null);else assert.equal(result.action.href,'/companion');}
 assert.equal(calls,0);
});

test('微信通知在后续闲聊中不会随资料或历史发给生活模型',async()=>{
 const s=store(),wechat=require('../src/companion-wechat'),calls=[];
 personal.saveProfile(s,owner,{nickname:'甲',shareWithModel:true});
 wechat.save(s,owner,{enabled:true,categories:['community'],keywords:''});
 wechat.ingest(s,owner,{deviceId:'private-device-20261011',phase:'receiving',notifications:[{appId:'Weixin',appName:'微信',notificationId:'1',notificationAt:new Date().toISOString(),title:'私有小区通知',body:'模拟私有停水内容，不准外发'}]});
 const result=await chat.prepare(s,owner,{question:'微信里有什么消息'},{liveQuery:async()=>null});
 chat.commit(s,owner,'微信里有什么消息',result,'wechat-only');
 await chat.prepare(s,owner,{question:'随便聊聊'},{liveQuery:async()=>null,companionModelClient:{configured:()=>true,request:async(q,options)=>{calls.push(options);return '你好';}}});
 assert.equal(calls.length,1);assert.ok(!JSON.stringify(calls[0]).includes('私有停水'));assert.ok(!JSON.stringify(calls[0].profile).includes('wechatInbox'));assert.equal(calls[0].messages.length,0);
});
