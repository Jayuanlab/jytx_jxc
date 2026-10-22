'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),c=require('../src/common'),feedback=require('../src/assistant-feedback'),dialogue=require('../src/assistant-dialogue');
const owner={id:'o',name:'老板',roleCode:'owner'},employee={id:'e',name:'营业员',roleCode:'employee'},guest={id:'g',roleCode:'customer-assistant',assistantCustomerOnly:true};
const setup=()=>c.initialize({users:[owner,employee,guest]});
const pair={question:'你好，请问有人在吗',originalAnswer:'没有理解',reason:'修改问答，提交老板确认',pairEdit:true,dialogueVersion:0,suggestedQuestions:['我想找小陈','小陈在不在'],suggestion:'请稍等 / 你好，你找他什么事',suggestionMandarin:'请稍等 / 您找他有什么事'};
test('员工只读载入一组问答的完整两框，不获取老板的完整维护目录',()=>{
 const s=setup(),data=feedback.list(s,employee,new URLSearchParams({draft:'1',question:'你好',dialogueId:'social:greeting'}));
 assert.equal(data.requiresReview,true);assert.equal(data.canManage,false);assert.equal(data.items.length,1);assert.deepEqual(data.items[0].questions,dialogue.list(s,owner).items[0].questions);
 assert.throws(()=>dialogue.list(s,employee),e=>e.statusCode===403);
 assert.throws(()=>feedback.list(s,employee,new URLSearchParams({draft:'1',question:'今天营业额多少'})),e=>e.statusCode===400);
 assert.throws(()=>feedback.list(s,guest,new URLSearchParams({draft:'1',question:'你好'})),e=>e.statusCode===403);
});
test('问法与多种答法一条记录待审核，老板一次确认整体生效，保留实际原问题',()=>{
 const s=setup(),pending=feedback.submit(s,employee,pair);
 assert.equal(s.assistantDialogues.length,0);assert.equal(pending.question,pair.question);assert.deepEqual(pending.suggestedQuestions,pair.suggestedQuestions);assert.equal(pending.suggestionMandarin,pair.suggestionMandarin);
 const row=feedback.list(s,owner).rows[0];const approved=feedback.review(s,owner,{id:row.id,version:row.version,decision:'apply',note:'核对通过',targetId:row.targetId,targetVersion:row.targetVersion,questions:row.suggestedQuestions,answer:row.suggestion,answerMandarin:row.suggestionMandarin,customerVisible:false});
 assert.equal(approved.status,'已生效');assert.deepEqual(approved.correctQuestions,pair.suggestedQuestions);
 for(const q of pair.suggestedQuestions)assert.equal(dialogue.find(s,q).answer,pair.suggestion);
 assert.equal(dialogue.find(s,pair.question),null);assert.equal(s.sales.length,0);
});
test('不允许员工把真实账目改为固定答案，也不允许不完整问答进入审核',()=>{
 for(const body of [{...pair,question:'今天卖了多少台手机'},{...pair,suggestedQuestions:['库存有多少']},{...pair,suggestedQuestions:[]},{...pair,suggestedQuestions:['长'.repeat(121)]},{...pair,suggestion:' / '} ]){
  const s=setup();assert.throws(()=>feedback.submit(s,employee,body),e=>e.statusCode===400);assert.equal(s.assistantAnswerFeedback.length,0);
 }
 assert.throws(()=>feedback.submit(setup(),guest,pair),e=>e.statusCode===403);
});
test('提交前原问答变化拒绝覆盖，审核前再次变化也拒绝旧版本',()=>{
 const s=setup(),base=dialogue.list(s,owner).items.find(x=>x.id==='social:greeting');
 dialogue.save(s,owner,{...base,answer:'新的问候'});
 assert.throws(()=>feedback.submit(s,employee,{...pair,question:'你好',dialogueId:base.id}),e=>e.statusCode===409);
 const pending=feedback.submit(s,employee,{...pair,question:'你好',dialogueId:base.id,dialogueVersion:1});
 const row=feedback.list(s,owner).rows[0],latest=dialogue.list(s,owner).items.find(x=>x.id===base.id);
 dialogue.save(s,owner,{...latest,answer:'再次更新的问候'});
 assert.throws(()=>feedback.review(s,owner,{id:pending.id,version:1,decision:'apply',note:'确认',targetId:row.targetId,targetVersion:row.targetVersion,questions:row.suggestedQuestions,answer:row.suggestion,customerVisible:false}),e=>e.statusCode===409);
 assert.equal(pending.status,'待审核');
});
