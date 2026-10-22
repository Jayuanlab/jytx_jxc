const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Module=require('module'),original=Module._load;Module._load=function(name,...args){if(name==='xlsx')return {};return original.call(this,name,...args)};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'assistant-api-'));
const seedPath=path.join(temporary,'seed.json');process.env.STORE_SEED_PATH=seedPath;
const c=require('../src/common');const owner={id:'boss',name:'老板',role:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'店员',role:'店员',roleCode:'employee',status:'active',permissions:['sale:create']};
fs.writeFileSync(seedPath,JSON.stringify(c.initialize({users:[owner,staff],products:[],inventory:[],sales:[]})));
const repository=require('../src/repository'),sessions=require('../src/auth-sessions'),{createServer}=require('../src/application');
test('新增入口 HTTP 联调：权限、重复提交、待办与存储恢复',async()=>{
  repository.resetStore(c.initialize({users:[owner,staff],products:[],inventory:[],sales:[]}));
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const ownerToken=sessions.issue(owner.id),staffToken=sessions.issue(staff.id);
  const call=async(url,token,body,key)=>{const r=await fetch(origin+url,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json','Idempotency-Key':key||require('node:crypto').randomUUID()}: {})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
  try{
    assert.equal((await call('/api/assistant/knowledge')).status,401);
    const caps=await call('/api/assistant/capabilities',staffToken);assert.equal(caps.status,200);assert.ok(caps.data.items.some(x=>x.id==='knowledge'));assert.ok(!caps.data.items.some(x=>x.id==='guardian'));
    const known=await call('/api/assistant/knowledge',staffToken);assert.equal(known.status,200);assert.equal(known.data.items.length,16);assert.equal(known.data.canManage,false);
    assert.equal((await call('/api/assistant/knowledge/remove',staffToken,{id:'knowledge-needs'})).status,403);
    const payload={type:'清洁',event:'整理商品陈列并擦拭柜台',result:'已完成'},key='journal-one-transaction';
    const first=await call('/api/work-journal',staffToken,payload,key);assert.equal(first.status,200);
    const duplicate=await call('/api/work-journal',staffToken,payload,key);assert.equal(duplicate.data.id,first.data.id);assert.equal(repository.readStore().workJournals.length,1);
    assert.equal((await call('/api/workbench',ownerToken)).data.reviews.workJournal,1);
    assert.equal((await call('/api/work-journal/review',staffToken,{id:first.data.id,approve:true,points:50})).status,403);
    assert.equal((await call('/api/work-journal/review',ownerToken,{id:first.data.id,approve:true,points:50})).status,200);
    const pulse=await call('/api/assistant/supervision',ownerToken);assert.equal(pulse.data.points,50);assert.equal(pulse.data.pendingPoints,0);
    const reply=await call('/api/assistant/ask',staffToken,{question:'今天员工获得多少积分'});assert.equal(reply.status,200);assert.equal(reply.data.metrics.points,50);assert.ok(reply.data.context);
    const learning=await call('/api/assistant/ask',staffToken,{question:'怎样向顾客推荐手机'});assert.equal(learning.data.metrics.knowledge,true);
    for(const route of ['/knowledge','/knowledge.js','/knowledge.css','/work-journal','/work-journal.js','/work-journal.css']){const r=await fetch(origin+route);assert.equal(r.status,200,route);assert.ok((await r.text()).length>100,route)}
    const bundle=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../data/knowledge-imports/mobile-20261009/bundle.json'),'utf8'));
    repository.transaction(store=>require('../src/employee-knowledge-import').apply(store,owner,bundle));
    assert.equal((await call('/api/assistant/knowledge-review')).status,401);
    assert.equal((await call('/api/assistant/knowledge-review',staffToken)).status,403);
    const audit=await call('/api/assistant/knowledge-review',ownerToken);assert.equal(audit.status,200);assert.equal(audit.data.report.inputFiles,19);
    const policy=await call('/api/assistant/ask',staffToken,{question:'校园青春卡59元档有多少流量'});assert.equal(policy.status,200);assert.equal(policy.data.metrics.sourceTier,'store_policy');assert.ok(policy.data.sources.some(ref=>ref.label.includes('04_校园青春卡资费')));
    const checked=await call('/api/assistant/knowledge',staffToken);assert.equal(checked.data.items.length,83);assert.equal(checked.data.manageItems,undefined);
    for(const route of ['/knowledge-review','/knowledge-review.js'])assert.equal((await fetch(origin+route)).status,200);
    const customerBundle=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../data/knowledge-imports/customer-talk-20261009/bundle.json'),'utf8'));
    const beforeBusiness=JSON.stringify(Object.fromEntries(Object.entries(repository.readStore()).filter(([key])=>!['employeeKnowledge','knowledgeImports','operationLogs'].includes(key))));
    const customerImport=repository.transaction(store=>require('../src/employee-knowledge-import').apply(store,owner,customerBundle));
    assert.equal(customerImport.inserted,175);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(repository.readStore()).filter(([key])=>!['employeeKnowledge','knowledgeImports','operationLogs'].includes(key)))),beforeBusiness);
    const combined=await call('/api/assistant/knowledge-review',ownerToken);
    assert.equal(combined.data.batches.length,2);assert.equal(combined.data.report.inputFiles,19);
    const conversationReport=combined.data.batches.find(row=>row.id==='customer-talk-20261009').report;
    assert.equal(conversationReport.inputFiles,5);assert.equal(conversationReport.dialectTraining.actualCount,156);assert.equal(conversationReport.dialectTraining.anyReviewCount,42);
    assert.equal((await call('/api/assistant/knowledge',staffToken)).data.items.length,258);
    const beforeQueries=JSON.stringify(repository.readStore());
    const dialect=await call('/api/assistant/ask',staffToken,{question:'我办个卡办哪种好'});
    const mandarin=await call('/api/assistant/ask',staffToken,{question:'我办个卡办哪种好',customerReplyStyle:'mandarin'});
    assert.equal(dialect.status,200);assert.equal(mandarin.status,200);
    assert.equal(dialect.data.metrics.kind,'tariff-recommendations');assert.equal(dialect.data.metrics.replyStyle,'sichuan');assert.equal(mandarin.data.metrics.replyStyle,'mandarin');
    assert.notEqual(dialect.data.answer,mandarin.data.answer);assert.ok(dialect.data.context.tariff);assert.ok(dialect.data.followups.length);
    const budget=await call('/api/assistant/ask',staffToken,{question:'最多60元',context:dialect.data.context});assert.equal(budget.data.metrics.profile.budgetMax,60);assert.equal(budget.data.context.tariff.awaiting,'usage');
    for(const question of ['今天华为手机库存','今天手机销量','今天移动酬金到账多少']){
      const result=await call('/api/assistant/ask',staffToken,{question});assert.equal(result.status,200);assert.notEqual(result.data.metrics?.kind,'customer-talk-guidance');
    }
    const fttr=await call('/api/assistant/ask',staffToken,{question:'升档30元可以9元办理全光吗'});assert.match(fttr.data.answer,/30元及以上.*9元/);assert.match(fttr.data.answer,/不能推定为9元\/月/);
    assert.equal(JSON.stringify(repository.readStore()),beforeQueries);


    const dialogueList=await call('/api/assistant/dialogues',ownerToken);assert.equal(dialogueList.status,200);assert.ok(dialogueList.data.items.length>12);
    assert.equal((await call('/api/assistant/dialogues',staffToken)).status,403);
    const newAnswer={title:'办卡测试回答',questions:['我要问这个测试业务'],answer:'营业员核对后再办理哈。',answerMandarin:'请营业员核对后办理。',enabled:true,customerVisible:true,version:0};
    assert.equal((await call('/api/assistant/dialogues/save',staffToken,newAnswer)).status,403);
    const saved=await call('/api/assistant/dialogues/save',ownerToken,newAnswer,'dialogue-repeat');assert.equal(saved.status,200);
    const repeat=await call('/api/assistant/dialogues/save',ownerToken,newAnswer,'dialogue-repeat');assert.equal(repeat.data.id,saved.data.id);assert.equal(repository.readStore().assistantDialogues.length,1);
    const customer=await call('/api/assistant/ask',ownerToken,{question:newAnswer.questions[0],mode:'customer'});assert.equal(customer.data.answer,newAnswer.answer);assert.equal(customer.data.sources.length,0);
    const changed=await call('/api/assistant/dialogues/save',ownerToken,{...newAnswer,id:saved.data.id,version:1,answer:'这是修订后的接待回答哈。'});assert.equal(changed.status,200);assert.equal(changed.data.history.length,1);
    assert.equal((await call('/api/assistant/dialogues/save',ownerToken,{...newAnswer,id:saved.data.id,version:1})).status,409);
    repository.transaction(store=>store.users.push({id:'kiosk',name:'接待机器人',roleCode:'customer-assistant',status:'active'}));
    const kioskToken=sessions.issue('kiosk');
    for(const route of ['/api/inventory','/api/users','/api/assistant/reports','/api/assistant/knowledge','/api/assistant/dialogues'])assert.equal((await call(route,kioskToken)).status,403,route);
    assert.equal((await call('/api/assistant/reports',kioskToken,{text:'不应写入'})).status,403);
    const locked=await call('/api/assistant/ask',kioskToken,{question:'今天营业额多少',mode:'store'});assert.equal(locked.status,200);assert.equal(locked.data.mode,'customer');assert.equal(locked.data.metrics.restricted,true);
    const who=await call('/api/me',kioskToken);assert.equal(who.data.assistantCustomerOnly,true);assert.equal(who.data.capabilities.sell,false);

    const restored=c.initialize(JSON.parse(JSON.stringify(repository.readStore())));assert.equal(restored.workJournals[0].points,50);assert.equal(restored.receipts.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(seedPath);fs.rmdirSync(temporary)}
});
