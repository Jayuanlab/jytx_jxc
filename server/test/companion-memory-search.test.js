 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),search=require('../src/companion-memory-search'),personal=require('../src/companion'),chat=require('../src/companion-chat'),{createClient}=require('../src/companion-model');
const owner={id:'own',name:'本人',roleCode:'owner'},other={id:'other',roleCode:'owner'};
const store=()=>({companionProfiles:[],companionMessages:[],companionMemories:[],operationLogs:[]});
const remember=(s,content,category='习惯',user=owner)=>personal.memory(s,user,{content,category});
test('早期记忆不会被最近20条挤掉，换说法依然找回并保留否定',()=>{
 const s=store(),old=remember(s,'我不吃辣椒，做菜喜欢清淡');for(let i=0;i<45;i++)remember(s,'模拟收藏故事'+i,'生活');
 assert.equal(search.rank(s.companionMemories,owner.id,'我能吃辣不')[0].id,old.id);
 assert.match(personal.recall(s,owner,'我的口味是什么'),/不吃辣椒/);
 assert.ok(!personal.recall(s,owner,'我的口味是什么').includes('模拟收藏故事'));
});
test('起床、入睡与亲友兴趣按问题检索；一般问自己不混入亲友',()=>{
 const s=store(),wake=remember(s,'我每天早上七点起床'),sleep=remember(s,'我晚上九点半睡觉'),kid=remember(s,'女儿喜欢喝绿茶','亲友');remember(s,'我喜欢钓鱼','爱好');
 assert.equal(search.rank(s.companionMemories,owner.id,'我几点醒来')[0].id,wake.id);
 assert.equal(search.rank(s.companionMemories,owner.id,'我几点入睡')[0].id,sleep.id);
 assert.deepEqual(search.rank(s.companionMemories,owner.id,'闺女爱喝什么茶').map(r=>r.id),[kid.id]);
 assert.ok(!search.rank(s.companionMemories,owner.id,'我喝茶吗').some(r=>r.id===kid.id));
});
test('相关性检索按本人，未确认/失效记忆不使用；无资料不猜',()=>{
 const s=store();remember(s,'我每天五点起床','习惯',other);s.companionMemories.push({id:'draft',userId:owner.id,content:'六点起床',confirmed:false},{id:'expired',userId:owner.id,content:'七点起床',confirmed:true,expiresAt:'2000-01-01T00:00:00Z'});
 assert.deepEqual(search.rank(s.companionMemories,owner.id,'我几点起床'),[]);assert.match(personal.recall(s,owner,'我几点起床'),/还没找到/);
});
test('默认摘要入口找回本人已确认习惯；检索最多12条且有文字预算',()=>{
 const s=store();for(let i=0;i<30;i++)remember(s,'我喜欢钓鱼地点'+i,'爱好');
 assert.match(personal.recall(s,owner,'你记得我的习惯吗'),/钓鱼/);
 const selected=search.rank(s.companionMemories,owner.id,'钓鱼',{limit:100,budget:100});assert.ok(selected.length<=12);assert.ok(selected.reduce((n,r)=>n+r.content.length,0)<=100);
});
test('修改记忆需要当前版本，保留旧版本但不再检索；清屏仍保留当前记忆',()=>{
 const s=store(),r=remember(s,'每天七点起床'),v=r.version;personal.append(s,owner,'记住：每天七点起床',{answer:'好，七点起床',channel:'life'},'one');
 assert.throws(()=>personal.memory(s,owner,{id:r.id,content:'八点起床'}),{statusCode:409});
 personal.memory(s,owner,{id:r.id,version:v,content:'每天八点起床'});assert.equal(r.history[0].content,'每天七点起床');
 assert.throws(()=>personal.memory(s,owner,{id:r.id,version:v,content:'九点起床'}),{statusCode:409});
 personal.clearScreen(s,owner);personal.clearHistory(s,owner);const answer=personal.recall(s,owner,'我几点起床');assert.match(answer,/八点/);assert.ok(!answer.includes('七点'));assert.equal(s.companionMessages.length,0);
});
test('模型只收到相关记忆，授权关闭不外发；无关健康/亲友不给闲聊模型',async()=>{
 const s=store(),old=remember(s,'我每天遛弯半小时');remember(s,'我的朋友有某种疾病','健康');for(let i=0;i<25;i++)remember(s,'模拟诗词记录'+i,'生活');const calls=[],client={configured:()=>true,request:async(q,options)=>{calls.push(options);return '去走一走吧';}};
 await chat.prepare(s,owner,{question:'散步怎么安排'},{companionModelClient:client,liveQuery:async()=>null});assert.deepEqual(calls[0].memories,[]);
 personal.saveProfile(s,owner,{nickname:'本人',shareWithModel:true});await chat.prepare(s,owner,{question:'散步怎么安排'},{companionModelClient:client,liveQuery:async()=>null});assert.deepEqual(calls[1].memories.map(r=>r.id),[old.id]);
 await chat.prepare(s,owner,{question:'聊聊今天'},{companionModelClient:client,liveQuery:async()=>null});assert.ok(!JSON.stringify(calls[2]).includes('疾病'));
});
test('上游收到当前事实与时间，不包含已修改的历史内容',async()=>{
 let sent;const client=createClient({env:{COMPANION_CHAT_URL:'https://example.test/chat',COMPANION_CHAT_API_KEY:'synthetic-key'},fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({success:true,reply:'早上八点'}));}});
 await client.request('作息建议',{memories:[{content:'每天八点起床',confirmed:true,updatedAt:'2026-10-11T01:00:00Z',history:[{content:'每天七点起床'}]}]});const body=JSON.stringify(sent);assert.ok(body.includes('八点'));assert.ok(body.includes('confirmedAt'));assert.ok(!body.includes('七点'));
});
