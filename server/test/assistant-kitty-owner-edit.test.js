'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),load=Module._load;
Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const c=require('../src/common'),chat=require('../src/assistant-chat'),dialogue=require('../src/assistant-dialogue');
const owner={id:'boss',name:'模拟老板',roleCode:'owner',status:'active'},guest={id:'guest',name:'模拟顾客',roleCode:'customer-assistant',status:'active'};
const make=()=>c.initialize({users:[owner,guest],products:[],sales:[],inventory:[]});
const options=()=>{const calls=[];return {calls,client:{configured:()=>true,hasContext:()=>false,request:async()=>{calls.push('business');return {status:'ok',reply:'不敢给你报数字，请到前台核对。',intent:'biz',hits:[]}}},companionModelClient:{request:async()=>{calls.push('life');return '模型闲聊。'}},liveQuery:async()=>null};};
test('顾客问在干嘛得到正确接话，身份与能力不被移动报价兜底覆盖',async()=>{
 const s=make(),o=options(),before=JSON.stringify(s);
 for(const question of ['你在干嘛呢','你现在在干什么','你是谁','你给谁干活','你能做什么']){
  const r=await chat.ask(s,guest,{question,mode:'customer'},o);assert.equal(r.metrics.kind,'assistant-social');assert.doesNotMatch(r.answer,/报数字|前台核对/);assert.equal(r.mode,'customer');
 }
 assert.match((await chat.ask(s,guest,{question:'你在干嘛呢',mode:'customer'},o)).answer,/等你|等您/);assert.deepEqual(o.calls,[]);assert.equal(JSON.stringify(s),before);
});
test('老板发布的小猫咪生活问答优先于生活模型，普通话与方言及修改版本立即生效',async()=>{
 const s=make(),o=options(),q='闲聊一下你平时喜欢什么';
 const a=dialogue.save(s,owner,{title:'模拟问答',questions:[q],answer:'我喜欢陪你聊聊呀。',answerMandarin:'我喜欢陪您聊聊。',customerVisible:true,enabled:true,version:0});
 let r=await chat.ask(s,guest,{question:q,mode:'customer'},o);assert.equal(r.answer,a.answer);assert.equal(r.metrics.dialogueId,a.id);
 const b=dialogue.save(s,owner,{...a,questions:[q,q+'呢'],answer:'我在这里陪你呀。',answerMandarin:'我在这里陪您。'});
 r=await chat.ask(s,guest,{question:q+'呢',mode:'customer',customerReplyStyle:'mandarin'},o);assert.equal(r.answer,b.answerMandarin);assert.equal(r.metrics.version,2);assert.deepEqual(o.calls,[]);
});
test('顾客模式迎宾维护保留已有节点，保存后不另造重复记录',async()=>{
 const s=make(),o=options(),r=await chat.ask(s,owner,{question:'你好',mode:'customer'},o);assert.equal(r.metrics.dialogueId,'social:greeting');o.calls.length=0;
 const row=dialogue.list(s,owner).items.find(x=>x.id===r.metrics.dialogueId),saved=dialogue.save(s,owner,{...row,answer:'你好，欢迎来找小猫咪。',answerMandarin:'您好，欢迎来找小猫咪。'});
 const next=await chat.ask(s,guest,{question:'你好',mode:'customer'},o);assert.equal(next.answer,saved.answer);assert.equal(next.metrics.dialogueId,row.id);assert.equal(next.metrics.dialogueVersion,1);assert.deepEqual(o.calls,[]);
});
test('仅店内或已停用的生活问答不会向小猫咪发布',async()=>{
 const s=make(),o=options(),q='陪我闲聊一下';
 const row=dialogue.save(s,owner,{title:'模拟私有问答',questions:[q],answer:'私有测试口语',answerMandarin:'私有测试口语',customerVisible:false,enabled:true,version:0});
 assert.notEqual((await chat.ask(s,guest,{question:q,mode:'customer'},o)).answer,row.answer);
 dialogue.save(s,owner,{...row,customerVisible:true,enabled:false});
 assert.notEqual((await chat.ask(s,guest,{question:q,mode:'customer'},o)).answer,row.answer);
 assert.deepEqual(o.calls,['life','life']);
});
test('老板顾客预览仍不能取得经营信息，顾客账号包括锁定老板不能发布问答',async()=>{
 const s=make(),o=options(),body={title:'模拟条目',questions:['聊一下'],answer:'你好',enabled:true,customerVisible:true,version:0};
 for(const question of ['成本是多少','今天营业额','所有员工工资']){
  const r=await chat.ask(s,owner,{question,mode:'customer'},o);assert.equal(r.metrics.restricted,true);assert.equal(r.table,undefined);
 }
 assert.throws(()=>dialogue.save(s,guest,body),{statusCode:403});assert.throws(()=>dialogue.save(s,{...owner,assistantCustomerOnly:true},body),{statusCode:403});assert.deepEqual(o.calls,[]);
 assert.throws(()=>dialogue.save(s,owner,{...body,answer:'内部成本100元'}),/店内信息/);
});
