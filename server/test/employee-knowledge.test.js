const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../src/common');
const knowledge=require('../src/employee-knowledge');
const owner={id:'owner',name:'老板',roleCode:'owner',status:'active'};
const staff={id:'employee',name:'营业员',roleCode:'employee',permissions:[],status:'active'};
const article={title:'店内路由器演示',category:'商品演示',summary:'先核实网络环境，再用样机演示连接流程。',body:'确认顾客网络类型，征得同意后使用样机演示。\n不要更改顾客私人资料。',tags:['路由器演示']};
function store(){return c.initialize({users:[owner,staff]});}
test('员工能读内置资料，阅读和查询不改变账套',()=>{const s=store(),before=JSON.stringify(s);const result=knowledge.catalog(s,staff);assert.equal(result.items.length,16);assert.equal(result.canManage,false);assert.equal(result.manageItems,undefined);assert.ok(result.items.every(row=>row.body&&row.summary&&row.version));assert.equal(knowledge.query(s,staff,'今天销售了几台手机'),null);assert.equal(knowledge.query(s,staff,'现在库存有多少'),null);assert.equal(JSON.stringify(s),before);result.items[0].tags.push('不得修改种子');assert.ok(!knowledge.catalog(s,staff).items[0].tags.includes('不得修改种子'));});
test('编辑和停用仅老板可做，失败不会写入记录',()=>{const s=store(),before=JSON.stringify(s);assert.throws(()=>knowledge.save(s,staff,article),error=>error.status===403||error.statusCode===403);assert.throws(()=>knowledge.remove(s,staff,{id:'knowledge-cash'}));assert.equal(JSON.stringify(s),before);assert.throws(()=>knowledge.save(s,owner,{...article,body:'',enabled:true}));assert.equal(JSON.stringify(s),before);});
test('老板修改内置规则保留版本与修改前后证据',()=>{const s=store();const original=knowledge.catalog(s,owner).items.find(row=>row.id==='knowledge-cash');const changed=knowledge.save(s,owner,{...original,summary:'交出现金后由实际收款人核对，不能替别人确认。'});assert.equal(changed.version,2);assert.equal(changed.updatedBy,owner.id);assert.equal(changed.builtIn,true);assert.equal(knowledge.query(s,staff,'现金交接怎么做').answer,changed.summary);assert.equal(s.operationLogs.length,1);const evidence=JSON.parse(s.operationLogs[0].detail);assert.equal(evidence.before.summary,original.summary);assert.equal(evidence.after.summary,changed.summary);});
test('停用知识保留管理记录，员工查询不再使用停用内容',()=>{const s=store();const row=knowledge.save(s,owner,article);knowledge.remove(s,owner,{id:row.id});assert.ok(!knowledge.catalog(s,staff).items.some(item=>item.id===row.id));const hidden=knowledge.catalog(s,owner).manageItems.find(item=>item.id===row.id);assert.equal(hidden.enabled,false);assert.equal(hidden.version,2);assert.ok(!knowledge.query(s,staff,'学习路由器演示技巧').sources.some(source=>source.href.includes(row.id)));knowledge.save(s,owner,{...hidden,enabled:true});assert.ok(knowledge.catalog(s,staff).items.some(item=>item.id===row.id));assert.equal(s.operationLogs.length,3);});
test('技巧回答有来源和建议标识，账目统计交给真实数据查询',()=>{const s=store();const reply=knowledge.query(s,staff,'帮我学习销售技巧');assert.match(reply.answer,/需求|用途|预算/);assert.equal(reply.metrics.kind,'training-guidance');assert.ok(reply.sources[0].href.startsWith('/knowledge#'));assert.match(knowledge.query(s,staff,'国补怎么退货').answer,/预估|通道/);assert.equal(knowledge.query(s,staff,'今天赚了多少'),null);assert.equal(knowledge.query(s,staff,'本月移动酬金多少钱'),null);assert.equal(knowledge.query(s,staff,'现金现在有多少'),null);});
test('可检索老板新增知识，通用入口不误当作接待记录',()=>{const s=store();const row=knowledge.save(s,owner,article);assert.equal(knowledge.query(s,staff,'学习路由器演示技巧').answer,article.summary);assert.equal(knowledge.query(s,staff,'详细说说'+article.title).metrics.articleId,row.id);assert.ok(knowledge.catalog(s,staff,'样机').items.some(item=>item.id===row.id));const entry=knowledge.query(s,staff,'打开知识库');assert.equal(entry.action.href,'/knowledge');assert.equal(entry.metrics,undefined);});

function conversationStore(){
  const row={...article,id:'customer-talk-20261009-card-proof',conversationTopic:'card-proof',sourceTier:'store_training',sourceLabel:'店内话术资料',policyStatus:'current',version:1,enabled:true,importBatch:'customer-talk-20261009',importFingerprint:'original-fingerprint',sourceNotes:'原文资料由老板提供。',sourceFiles:[{name:'顾客接话.docx',sha256:'a'.repeat(64)}],sourceRefs:[{file:'顾客接话.docx',blockId:'p1'}],sourceBlocks:[{id:'p1',kind:'paragraph',text:article.body}],customerQuestions:['办卡需要什么'],matchKeywords:[['办卡','开卡'],['身份证','证件']]};
  return c.initialize({users:[owner,staff],employeeKnowledge:[structuredClone(row)],sales:[{id:'sales-keep'}],inventory:[{id:'stock-keep'}]});
}
test('老板维护话术问法与关键词组合，保留原文、话题和修改前后记录',()=>{
  const s=conversationStore(),before=structuredClone(s.employeeKnowledge[0]),business=JSON.stringify([s.sales,s.inventory]);
  const row=knowledge.save(s,owner,{...before,customerQuestions:[' 办卡需要什么证件？ ','开卡要不要带身份证？','办卡需要什么证件？'],matchKeywords:[[' 办卡 ','开卡','办卡'],['身份证','证件']],conversationTopic:'forged-topic'});
  assert.deepEqual(row.customerQuestions,['办卡需要什么证件？','开卡要不要带身份证？']);assert.deepEqual(row.matchKeywords,[['办卡','开卡'],['身份证','证件']]);
  assert.equal(row.conversationTopic,before.conversationTopic);assert.equal(row.version,2);assert.equal(row.editedAfterImport,true);assert.deepEqual(row.tags,before.tags);assert.equal(row.body,before.body);assert.deepEqual(row.sourceBlocks,before.sourceBlocks);assert.deepEqual(row.sourceFiles,before.sourceFiles);assert.equal(row.importFingerprint,before.importFingerprint);assert.equal(JSON.stringify([s.sales,s.inventory]),business);
  const audit=JSON.parse(s.operationLogs[0].detail);assert.deepEqual(audit.before.customerQuestions,before.customerQuestions);assert.deepEqual(audit.after.matchKeywords,row.matchKeywords);
  assert.ok(knowledge.catalog(s,staff,'开卡要不要带身份证').items.some(item=>item.id===row.id));assert.ok(knowledge.catalog(s,staff,'证件').items.some(item=>item.id===row.id));
  row.matchKeywords[0].push('客户端不能改后台');assert.equal(s.employeeKnowledge[0].matchKeywords[0].length,2);
});
test('话术字段未传保留，显式空数组清除，过期版本不能覆盖',()=>{
  const s=conversationStore(),before=structuredClone(s.employeeKnowledge[0]);const payload={...before};delete payload.customerQuestions;delete payload.matchKeywords;
  const saved=knowledge.save(s,owner,payload);assert.deepEqual(saved.customerQuestions,before.customerQuestions);assert.deepEqual(saved.matchKeywords,before.matchKeywords);
  const snapshot=JSON.stringify(s);assert.throws(()=>knowledge.save(s,owner,{...saved,version:1,customerQuestions:[],matchKeywords:[]}),error=>(error.status??error.statusCode)===409);assert.equal(JSON.stringify(s),snapshot);
  const cleared=knowledge.save(s,owner,{...saved,customerQuestions:[],matchKeywords:[]});assert.deepEqual(cleared.customerQuestions,[]);assert.deepEqual(cleared.matchKeywords,[]);
});
test('话术输入拒绝空问题、空组、空词、错误结构和超限，失败不写入',()=>{
  const invalid=[{customerQuestions:'一句话'},{customerQuestions:null},{customerQuestions:['']},{customerQuestions:[{}]},{customerQuestions:['a'.repeat(241)]},{customerQuestions:Array(13).fill('问题')},{matchKeywords:'办卡|开卡'},{matchKeywords:null},{matchKeywords:[[]]},{matchKeywords:[[' ']]},{matchKeywords:[['办卡',null]]},{matchKeywords:[['a'.repeat(31)]]},{matchKeywords:[Array(13).fill('词')]},{matchKeywords:Array(9).fill(['词'])},{matchKeywords:['错误组']}];
  for(const fields of invalid){const s=conversationStore(),snapshot=JSON.stringify(s);assert.throws(()=>knowledge.save(s,owner,{...s.employeeKnowledge[0],...fields}),error=>(error.status??error.statusCode)===400);assert.equal(JSON.stringify(s),snapshot,JSON.stringify(fields));}
  const s=conversationStore(),snapshot=JSON.stringify(s);assert.throws(()=>knowledge.save(s,staff,{...s.employeeKnowledge[0],customerQuestions:['证件要带什么？']}),error=>(error.status??error.statusCode)===403);assert.equal(JSON.stringify(s),snapshot);
});
test('普通资料和新增文章不能通过话术字段自行变成接话卡片',()=>{
  for(const fields of [{customerQuestions:[]},{matchKeywords:[]},{customerQuestions:['办卡'],matchKeywords:[['办卡']],conversationTopic:'card-proof'}]){
    const s=store(),snapshot=JSON.stringify(s);assert.throws(()=>knowledge.save(s,owner,{...article,...fields}),error=>(error.status??error.statusCode)===400);assert.equal(JSON.stringify(s),snapshot);
    const original=knowledge.catalog(s,owner).items[0];assert.throws(()=>knowledge.save(s,owner,{...original,...fields}),error=>(error.status??error.statusCode)===400);assert.equal(JSON.stringify(s),snapshot);
  }
});
test('仅修改摘要保留来源正文并标明人工整理，重复修改不累加标记',()=>{
  const s=conversationStore(),before=structuredClone(s.employeeKnowledge[0]);const changed=knowledge.save(s,owner,{...before,summary:'办理需要哪些证件，我先帮您核对。'});
  assert.equal(changed.body,before.body);assert.deepEqual(changed.sourceBlocks,before.sourceBlocks);assert.deepEqual(changed.sourceRefs,before.sourceRefs);assert.match(changed.sourceNotes,/原文资料由老板提供/);assert.match(changed.sourceNotes,/摘要已由老板修订，不能当作原文逐字引用/);assert.equal(changed.sourceRevisionNote,undefined);
  const second=knowledge.save(s,owner,{...changed,summary:'您带了证件吗？我帮您查办理条件。'});assert.equal((second.sourceNotes.match(/摘要已由老板修订/g)||[]).length,1);
  const evidence=JSON.parse(s.operationLogs[0].detail);assert.equal(evidence.before.summary,changed.summary);assert.equal(evidence.after.summary,second.summary);assert.deepEqual(evidence.after.sourceBlocks,before.sourceBlocks);
});
