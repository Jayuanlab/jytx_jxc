'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:original.call(this,name,...args);};
const c=require('../src/common'),clock=require('../src/assistant-clock'),work=require('../src/assistant-chat'),personal=require('../src/companion-chat'),memory=require('../src/companion');
const owner={id:'clock-owner',name:'模拟老板',roleCode:'owner'},staff={id:'clock-staff',name:'模拟营业员',roleCode:'employee'},guest={id:'clock-guest',name:'模拟顾客',roleCode:'customer-assistant'};
const fixed=Date.parse('2026-10-10T16:05:00Z');
test('北京时间已过零点时，星期和日期一致，常见口语问法都返回本地日历',()=>{
 for(const q of ['今天星期几','今天是星期几？','周几了','礼拜几呀','你知道今天星期几吗','帮我看一下今天是几月几号','今天几号星期几']){
  const result=clock.query(q,{now:fixed});assert.equal(result.metrics.date,'2026-10-11',q);assert.equal(result.metrics.weekday,'星期日',q);assert.match(result.answer,/2026年10月11日，星期日/);
 }
 assert.match(clock.query('现在几点了',{now:fixed}).answer,/00:05/);
 assert.match(clock.query('现在是什么时间',{now:fixed})?.answer||'',/00:05/);
});
test('跨月跨年、闰年和相对日期不会用模型猜',()=>{
 const now=Date.parse('2026-12-31T12:00:00Z'),context=clock.query('今天周几',{now}).metrics.clockContext;
 assert.equal(clock.query('明天呢',{now,context}).metrics.date,'2027-01-01');
 assert.equal(clock.query('后天星期几',{now}).metrics.weekday,'星期六');
 assert.equal(clock.query('昨天几号',{now:Date.parse('2024-03-01T01:00:00Z')}).metrics.date,'2024-02-29');
 assert.equal(clock.query('前天礼拜几',{now:fixed}).metrics.date,'2026-10-09');
});
test('日历只接自己的明确话题，不把统计、上班、薪资、天气的问题改为日期',()=>{
 for(const q of ['今天销售多少','今天星期几发工资','明天几点上班','明天天气怎么样','新套餐什么日期生效','今天员工谁上班','10元有多少流量'])assert.equal(clock.query(q,{now:fixed}),null,q);
 assert.equal(clock.query('明天呢',{now:fixed}),null);
 assert.equal(clock.query('明天呢',{now:fixed,context:{at:fixed-31*60000}}),null);
 assert.equal(clock.query('明天呢',{now:fixed,context:{at:fixed+1}}),null);
});
test('工作助理、员工与小猫咪均直接回答星期，绕开外部模型和固定旧答案',async t=>{
 t.mock.method(Date,'now',()=>fixed);
 const s=c.initialize({users:[owner,staff,guest],assistantDialogues:[{id:'bad-date',questions:['今天星期几'],answer:'我不知道',enabled:true,customerVisible:true}],sales:[],inventory:[],products:[]});
 const before=JSON.stringify(s);let calls=0;
 const options={client:{configured:()=>true,hasContext:()=>false,request:async()=>{calls++;throw Error('date must be local');}}};
 for(const user of [owner,staff,guest]){
  const first=await work.ask(s,user,{question:'今天星期几',mode:'store'},options);assert.equal(first.metrics.kind,'live-clock');assert.match(first.answer,/星期日/);assert.equal(first.mode,user===guest?'customer':'store');
  assert.equal((await work.ask(s,user,{question:'明天呢',mode:first.mode,context:first.context},options)).metrics.date,'2026-10-12');
 }
 const first=await work.ask(s,owner,{question:'今天星期几'},options);
 const other=await work.ask(s,staff,{question:'明天呢',context:first.context},options);assert.notEqual(other.metrics.kind,'live-clock');
 assert.equal(calls,0);assert.equal(JSON.stringify(s),before);
});
test('个人助理日期追问只沿用本人最近聊天，仍保留个人权限和记忆授权',async t=>{
 t.mock.method(Date,'now',()=>fixed);const other={...owner,id:'other'};
 const s=c.initialize({users:[owner,other,staff],sales:[],inventory:[],products:[]});let calls=0;
 const options={liveQuery:async()=>null,companionModelClient:{configured:()=>true,request:async()=>{calls++;return '这是其他话题';}}};
 const first=await personal.prepare(s,owner,{question:'今天星期几'},options);personal.commit(s,owner,'今天星期几',first,'clock-one');
 assert.match(first.answer,/星期日/);assert.equal(first.modelConnected,false);
 assert.equal((await personal.prepare(s,owner,{question:'明天呢'},options)).metrics.date,'2026-10-12');
 assert.equal((await personal.prepare(s,other,{question:'明天呢'},options)).metrics,undefined);
 const food=await personal.prepare(s,owner,{question:'晚饭想吃什么'},options);personal.commit(s,owner,'晚饭想吃什么',food,'clock-food');
 assert.equal((await personal.prepare(s,owner,{question:'明天呢'},options)).metrics,undefined);
 await assert.rejects(personal.prepare(s,staff,{question:'星期几'},options),e=>e.statusCode===403);
 assert.equal(calls,3);assert.equal(memory.profile(s,owner).shareWithModel,false);
});
