'use strict';
const assert=require('node:assert/strict'),repo=require('../server/src/repository'),assistant=require('../server/src/personal-assistant'),dialogue=require('../server/src/assistant-dialogue'),c=require('../server/src/common');
const store=repo.readStore(),owner=store.users.find(x=>x.status==='active'&&x.roleCode==='owner');assert.ok(owner);const before=JSON.stringify(store);
const items=dialogue.list(store,owner).items;assert.ok(items.length>=12);
for(const question of ['今天毛利多少','今天卖了多少台手机','员工情况','供应商应付','查库存串号','所有工资','开销售单']){
 const reply=assistant.ask(store,owner,{question,mode:'customer'});assert.equal(reply.mode,'customer');assert.equal(reply.sources.length,0);assert.equal(reply.action,undefined);assert.equal(reply.draft,undefined);assert.equal(reply.table,undefined);
}
let r=assistant.ask(store,owner,{question:'我来办一个业务',mode:'customer'});assert.equal(r.context.mode,'customer');
for(const question of ['号卡','不知道旧套餐，先推荐','最多一百元','流量多','经常到外地'])r=assistant.ask(store,owner,{question,context:r.context,mode:'customer'});
assert.ok(r.table?.rows.length);assert.equal(r.sources.length,0);assert.ok(r.table.columns.every(x=>!['costPrice','warehouseId','quantity','skuId'].includes(x.key)));
const scratch=structuredClone(store),row=dialogue.list(scratch,owner).items.find(x=>x.id==='qa:id-brought');dialogue.save(scratch,owner,{...row,answer:'请交给营业员当面核验哈。'});
assert.equal(assistant.ask(scratch,owner,{question:row.questions[0],mode:'customer'}).answer,'请交给营业员当面核验哈。');
const locked=assistant.ask(store,{...owner,assistantCustomerOnly:true},{question:'今天工资',mode:'store'});assert.equal(locked.mode,'customer');assert.equal(c.capabilities({...owner,assistantCustomerOnly:true}).finance,false);
const customized=items.find(x=>x.id==='tariff:current-plan'&&x.version&&dialogue.answerOptions(x.answer).length>1);
if(customized)for(const mode of ['store','customer']){const preview=assistant.ask(store,owner,{question:'我想办一张卡',mode});assert.ok(dialogue.answerOptions(customized.answer).includes(preview.answer));assert.ok(preview.context.tariff);}

const welcome=items.find(x=>x.id==='social:greeting');assert.ok(welcome);
for(const mode of ['store','customer'])for(const question of ['你好','顾客到店','有顾客到']){
 const greeting=assistant.ask(store,owner,{question,mode});assert.ok(dialogue.answerOptions(welcome.answer).includes(greeting.answer));assert.equal(greeting.context.businessChoice,true);
 const next=assistant.ask(store,owner,{question:'号卡',mode,context:greeting.context});assert.ok(next.context.tariff);
}

const tariffExport=require('../web/assistant-tariff-export');let exportedPlans=0;
for(const mode of ['store','customer']){
 const list=assistant.ask(store,owner,{question:'整理所有卡资源',mode});assert.ok(list.table?.rows.length);const rows=list.table.rows;
 const text=tariffExport.text(rows,{groupByType:true});assert.equal((text.match(/【\d+】/g)||[]).length,rows.length);assert.equal(tariffExport.types(rows).reduce((sum,x)=>sum+x.count,0),rows.length);
 for(const row of rows){if(typeof row.minutes==='number')assert.ok(text.includes('通话：'+row.minutes+'分钟/月'));if(typeof row.domesticGB==='number')assert.ok(text.includes('全国/通用流量：'+row.domesticGB+'GB/月'));}
 if(mode==='customer')assert.doesNotMatch(text,/资料出处：|资料日期：|工资|成本|提成|酬金/);else exportedPlans=rows.length;
}
assert.equal(JSON.stringify(store),before);assert.equal(JSON.stringify(repo.readStore()),before);
console.log(JSON.stringify({editableDialogues:items.length,exportedTariffPlans:exportedPlans,labelledMinutesAndFlow:true,tariffTypeGroupsComplete:true,welcomeOptions:dialogue.answerOptions(welcome.answer).length,singleWelcomeReply:true,welcomeContinuesBusiness:true,publicOnlyCustomerMode:true,trueTariffConversation:true,editedAnswerEffective:true,selectedSingleSavedReply:true,lockedAccountCannotSwitch:true,businessRecordsUnchanged:true}));
