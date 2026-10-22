'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),c=require('../src/common'),feedback=require('../src/assistant-feedback'),dialogue=require('../src/assistant-dialogue'),workflow=require('../src/staff-workflow');
const owner={id:'o',name:'老板',roleCode:'owner'},employee={id:'e',name:'营业员',roleCode:'employee',permissions:['sale:create']},other={id:'e2',name:'另一个员工',roleCode:'employee'},guest={id:'g',roleCode:'customer-assistant',assistantCustomerOnly:true};
const setup=()=>c.initialize({users:[structuredClone(owner),structuredClone(employee),structuredClone(other),structuredClone(guest)]});
function send(s,q='你好，请问有人吗',id){return feedback.submit(s,employee,{question:q,originalAnswer:'没有理解',reason:'回答不正确',suggestion:'你好，很高兴为你服务。',dialogueId:id})}
function approval(row,overrides={}){return {id:row.id,version:row.version,decision:'apply',note:'已核对',targetId:row.targetId,targetVersion:row.targetVersion,answer:'你好，请问需要什么帮助？',questions:[row.question,'有人吗'],customerVisible:false,...overrides}}
test('员工提交留人名，老板集中审核，其他员工看不到',()=>{
 const s=setup(),row=send(s);assert.equal(row.status,'待审核');assert.equal(row.submittedById,employee.id);assert.equal(feedback.list(s,owner).pendingCount,1);assert.equal(feedback.list(s,employee).rows.length,1);assert.equal(feedback.list(s,other).rows.length,0);
 assert.throws(()=>feedback.review(s,employee,{id:row.id}),e=>e.statusCode===403);
});
test('审核生效、同义问法、处理记录和重复审核保护',()=>{
 const s=setup();send(s);const row=feedback.list(s,owner).rows[0],saved=feedback.review(s,owner,approval(row));assert.equal(saved.status,'已生效');assert.equal(saved.reviewedById,owner.id);assert.equal(dialogue.find(s,'有人吗').answer,'你好，请问需要什么帮助？');assert.equal(feedback.list(s,owner).pendingCount,0);
 assert.throws(()=>feedback.review(s,owner,approval(row)),e=>e.statusCode===409);assert.equal(s.operationLogs.length,3);assert.equal(s.sales.length,0);
});
test('实时数据问题只处理原因，不能写成固定答案',()=>{
 const s=setup(),raw=send(s,'今天卖了多少台手机'),row=feedback.list(s,owner).rows[0];assert.equal(row.canApply,false);
 assert.throws(()=>feedback.review(s,owner,approval(row,{answer:'卖了三台'})),e=>e.statusCode===400);
 assert.equal(raw.status,'待审核');assert.equal(s.assistantDialogues.length,0);
 assert.equal(feedback.review(s,owner,{id:row.id,version:1,decision:'resolve',note:'已核对真实销售记录'}).status,'已处理');
});
test('顾客账号不能提交或查看纠错，公开回答不包含店内信息',()=>{
 const s=setup();assert.throws(()=>feedback.submit(s,guest,{question:'你好'}),e=>e.statusCode===403);assert.throws(()=>feedback.list(s,guest),e=>e.statusCode===403);
 send(s);const row=feedback.list(s,owner).rows[0];assert.throws(()=>feedback.review(s,owner,approval(row,{answer:'采购价100元',customerVisible:true})),e=>e.statusCode===400);
});
test('原回答并发修改后，审核不能覆盖新版本',()=>{
 const s=setup();send(s,'你好','social:greeting');const row=feedback.list(s,owner).rows[0],base=dialogue.list(s,owner).items.find(x=>x.id==='social:greeting');
 dialogue.save(s,owner,{...base,answer:'新的问候',answerMandarin:'新的问候'});
 assert.throws(()=>feedback.review(s,owner,approval(row)),e=>e.statusCode===409);assert.equal(s.assistantAnswerFeedback[0].status,'待审核');assert.equal(dialogue.find(s,'你好').answer,'新的问候');
});
test('本店营业员采购权限、进价可见，老板审核权限保留，其他账套默认不变',()=>{
 const s=setup();assert.equal(c.capabilities(s.users[1]).cost,false);workflow.enable(s,owner);const caps=c.capabilities(s.users[1]);
 for(const key of['sell','purchase','cost','manageProducts','supplierView','stocktake'])assert.equal(caps[key],true,key);
 for(const key of['manageUsers','finance','supplierSettle','supplierAdjust','giftApprove','confirmPay'])assert.equal(caps[key],false,key);
 assert.equal(c.capabilities(guest).cost,false);assert.ok(workflow.permissionsFor(s,'employee',['sale:create']).includes('purchase:create'));assert.deepEqual(workflow.permissionsFor(setup(),'employee',['sale:create']),['sale:create']);
});
