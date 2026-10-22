'use strict';
const assert=require('node:assert/strict'),repo=require('../server/src/repository'),assistant=require('../server/src/personal-assistant'),tariffs=require('../server/src/assistant-tariff-query'),exporter=require('../web/assistant-tariff-export');
const s=repo.readStore(),before=JSON.stringify(s),owner=s.users.find(u=>u.roleCode==='owner'&&u.status==='active');assert.ok(owner);
const plan=tariffs.catalog(s,owner).rows.find(r=>r.family==='4g-feixiang'&&r.baseMonthlyFee===8);assert.ok(plan);assert.equal(plan.minutes,0);assert.equal(plan.domesticGB,0);
for(const mode of ['store','customer']){
 const r=assistant.ask(s,owner,{question:'4G飞享8元档套餐外收费多少',mode});assert.match(r.answer,/0.19元\/分钟/);assert.match(r.answer,/10元\/GB/);
 if(mode==='customer'){assert.equal(r.sources.length,0);assert.equal(r.action,undefined);assert.equal(r.draft,undefined);}
}
const copy=exporter.text([plan]);assert.match(copy,/通话：0分钟\/月/);assert.match(copy,/0GB\/月/);assert.match(copy,/0.19元\/分钟/);assert.match(copy,/10元\/GB/);
assert.equal(repo.readKnowledgeFile('a'.repeat(64)),null);assert.equal(JSON.stringify(repo.readStore()),before);
console.log(JSON.stringify({new4GFee:8,minutes:0,includedFlowGB:0,voiceOverageYuanPerMinute:0.19,dataOverageYuanPerGB:10,bothAssistantModesCorrect:true,copyRetainsOverage:true,knowledgeOriginalStoreReady:true,noBusinessLedgerChanges:true,articleId:plan.articleId}));

