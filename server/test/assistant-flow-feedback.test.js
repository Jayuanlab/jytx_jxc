'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),c=require('../src/common'),feedback=require('../src/assistant-feedback'),dialogue=require('../src/assistant-dialogue');
const owner={id:'o',name:'老板',roleCode:'owner'},employee={id:'e',name:'营业员',roleCode:'employee'},guest={id:'g',roleCode:'customer-assistant',assistantCustomerOnly:true};
const setup=()=>c.initialize({users:[owner,employee,guest]});
const pair={question:'顾客买了一台手机，帮我开一下单',originalAnswer:'这款商品没有找到可售库存',reason:'业务回答纠错，提交核对',pairEdit:true,correctionOnly:true,dialogueVersion:0,suggestedQuestions:['卖出一台手机，帮我开单','顾客买了一台手机，帮我开一下单'],suggestion:'请先核对型号和串号。',suggestionMandarin:'请先核对型号和串号。',sourceKind:'assistant-sale-flow',flowStage:'inventory-check'};
test('开单提示可以一次提交完整问答纠错，老板和员工均可，保留来源和原回答',()=>{
 for(const user of [owner,employee]){
  const s=setup(),row=feedback.submit(s,user,pair);assert.deepEqual(row.suggestedQuestions,pair.suggestedQuestions);assert.equal(row.correctionOnly,true);assert.equal(row.sourceKind,'assistant-sale-flow');assert.equal(row.flowStage,'inventory-check');assert.equal(row.originalAnswer,pair.originalAnswer);assert.equal(row.status,'待审核');assert.equal(s.sales.length,0);assert.equal(s.assistantDialogues.length,0);
 }
});
test('业务和实时数字纠错不允许审批为固定答案，普通词问法也不能绕过纠错类型',()=>{
 for(const question of [pair.question,'今天营业额多少','你好']){
  const s=setup(),raw=feedback.submit(s,employee,{...pair,question}),row=feedback.list(s,owner).rows[0];assert.equal(row.canApply,false);
  assert.throws(()=>feedback.review(s,owner,{id:row.id,version:row.version,decision:'apply',note:'核对',targetId:row.targetId,targetVersion:row.targetVersion,questions:['你好'],answer:'营业额100元',customerVisible:false}),e=>e.statusCode===400);
  assert.equal(raw.status,'待审核');assert.equal(s.assistantDialogues.length,0);
 }
});
test('核对处理保留两框建议与处理说明，不改变开单、库存和金额',()=>{
 const s=setup(),before=JSON.stringify({inventory:s.inventory,sales:s.sales}),row=feedback.submit(s,employee,pair);
 assert.throws(()=>feedback.review(s,employee,{id:row.id}),e=>e.statusCode===403);
 const reviewed=feedback.review(s,owner,{id:row.id,version:row.version,decision:'resolve',note:'已登记，核对业务流程'});
 assert.equal(reviewed.status,'已处理');assert.deepEqual(reviewed.suggestedQuestions,pair.suggestedQuestions);assert.equal(reviewed.suggestion,pair.suggestion);assert.equal(JSON.stringify({inventory:s.inventory,sales:s.sales}),before);
 assert.throws(()=>feedback.review(s,owner,{id:row.id,version:1,decision:'resolve',note:'重复'}),e=>e.statusCode===409);
 assert.throws(()=>feedback.submit(s,guest,pair),e=>e.statusCode===403);
});
