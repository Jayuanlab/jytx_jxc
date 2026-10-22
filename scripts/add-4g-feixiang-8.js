'use strict';
const c=require('../server/src/common'),knowledge=require('../server/src/employee-knowledge'),tariffs=require('../server/src/assistant-tariff-query');
const statement='4G飞享套餐8元档，0分钟0流量，分钟数超出是0.19每分钟，流量用超出是10元1GB';
function add(store,user){
 c.permit(user,'manageUsers');
 const existing=(store.employeeKnowledge||[]).find(row=>row.ownerSourceStatement===statement);
 if(existing)return {id:existing.id,duplicate:true};
 const blocks=[
  {id:'t1',kind:'table',rows:[['月费','通话分钟','通用流量'],['8','0','0']],text:'月费 | 通话分钟 | 通用流量\n8 | 0 | 0'},
  {id:'p1',kind:'paragraph',text:'套餐外通话：0.19元/分钟。'},
  {id:'p2',kind:'paragraph',text:'套餐外流量：10元/GB。'},
 ];
 const saved=knowledge.save(store,user,{title:'4G飞享套餐8元档：老板新增资费',category:'套餐资费',summary:'月费8元，含0分钟、0流量；套餐外通话0.19元/分钟，套餐外流量10元/GB。',body:blocks.map(b=>b.text).join('\n'),tags:['4G飞享','飞享','8元档','套餐外','低月租'],policyStatus:'current',enabled:true});
 const row=store.employeeKnowledge.find(r=>r.id===saved.id);
 Object.assign(row,{sourceTier:'store_policy',sourceLabel:'老板新增资费',ownerSourceStatement:statement,sourceBlocks:blocks,tables:[{headers:blocks[0].rows[0],rows:blocks[0].rows.slice(1)}],sourceRefs:blocks.map(b=>({file:'老板新增资费说明',blockId:b.id,label:'老板提供 · '+c.day()})),sourceNotes:'数据由老板在对话中新增；未提供的办理资格、计费进位规则、附加条件和生效日期未作推断。',asOf:c.day(),sourceDocumentDate:c.day()});
 c.audit(store,user,'knowledge:owner-supplement',JSON.stringify({sourceStatement:statement,article:row}));
 return {id:row.id,duplicate:false};
}
if(require.main===module){
 const assert=require('node:assert/strict'),repo=require('../server/src/repository'),exporter=require('../web/assistant-tariff-export');
 const result=repo.transaction(store=>{
  const owner=store.users.find(u=>u.roleCode==='owner'&&u.status==='active');assert.ok(owner);
  const before=JSON.stringify(Object.fromEntries(Object.entries(store).filter(([key])=>!['employeeKnowledge','operationLogs'].includes(key))));
  const saved=add(store,owner),plan=tariffs.catalog(store,owner).rows.find(r=>r.articleId===saved.id);
  assert.ok(plan);assert.equal(plan.baseMonthlyFee,8);assert.equal(plan.minutes,0);assert.equal(plan.domesticGB,0);assert.match(plan.feeNote,/0.19元\/分钟/);assert.match(plan.feeNote,/10元\/GB/);assert.doesNotMatch(plan.feeNote,/必叠加移动云盘/);
  const text=exporter.text([plan]);assert.match(text,/通话：0分钟\/月/);assert.match(text,/全国\/通用流量：0GB\/月/);assert.match(text,/0.19元\/分钟/);assert.match(text,/10元\/GB/);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(store).filter(([key])=>!['employeeKnowledge','operationLogs'].includes(key)))),before);
  return {...saved,monthFee:8,minutes:0,flowGB:0,voiceOverage:0.19,dataOveragePerGB:10,noBusinessLedgerChanges:true};
 });
 console.log(JSON.stringify(result));
}
module.exports={add};

