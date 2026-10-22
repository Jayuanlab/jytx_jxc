const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const c=require('../src/common'),d=require('../src/assistant-dialogue'),assistant=require('../src/personal-assistant');
const owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'店员',roleCode:'employee',status:'active',permissions:['sale:create']};
const make=()=>c.initialize({users:[owner,staff],products:[],inventory:[],sales:[]});
const payload={title:'身份证在哪里',questions:['身份证在我包里'],answer:'要得，交给营业员当面核验哈。',answerMandarin:'请交给营业员当面核验。',enabled:true,customerVisible:true,version:0};
test('老板编辑问答：保存立即回答、普通话与方言、版本冲突和完整历史',()=>{
 const s=make(),first=d.save(s,owner,payload);assert.equal(first.version,1);
 const before=JSON.stringify(s);const reply=assistant.ask(s,staff,{question:'身份证在我包里',mode:'customer'});assert.equal(reply.answer,payload.answer);assert.equal(reply.sources.length,0);assert.equal(JSON.stringify(s),before);
 assert.equal(assistant.ask(s,staff,{question:'身份证在我包里',customerReplyStyle:'mandarin'}).answer,payload.answerMandarin);
 const second=d.save(s,owner,{...payload,id:first.id,version:1,answer:'交给营业员确认一下嘛。'});assert.equal(second.version,2);assert.equal(second.history[0].answer,payload.answer);assert.equal(second.history[0].changedBy,'老板');
 assert.throws(()=>d.save(s,owner,{...payload,id:first.id,version:1}),/重新加载/);assert.equal(s.operationLogs.length,2);
});
test('问答维护权限、停用、仅店内与内部查询不能改成固定答案',()=>{
 const s=make();assert.throws(()=>d.list(s,staff),/没有/);assert.throws(()=>d.save(s,staff,payload),/没有/);
 const row=d.save(s,owner,{...payload,customerVisible:false});assert.equal(d.find(s,payload.questions[0],{customer:true}),null);assert.ok(d.find(s,payload.questions[0]));
 d.save(s,owner,{...payload,id:row.id,version:1,enabled:false});assert.equal(d.find(s,payload.questions[0]),null);
 assert.throws(()=>d.save(s,owner,{...payload,questions:['今天销量']}),/店内查询/);assert.throws(()=>d.save(s,owner,{...payload,answer:'成本35元'}),/店内信息/);
 assert.throws(()=>d.save(s,owner,{...payload,version:undefined}),/重新加载/);
});
test('流程提示可修改，步骤与真实资费计算保留，不将带身份证认定资格',()=>{
 const s=make();const row=d.list(s,owner).items.find(x=>x.id==='tariff:usage');
 d.save(s,owner,{...row,answer:'流量多一点还是分钟多一点嘛？',version:0});
 const start=assistant.ask(s,staff,{question:'新办卡，最多60元'});assert.equal(start.answer,'流量多一点还是分钟多一点嘛？');assert.equal(start.context.tariff.awaiting,'usage');
 const region=assistant.ask(s,staff,{question:'流量用的多点',context:start.context});assert.equal(region.context.tariff.profile.budgetMax,60);assert.equal(region.context.tariff.profile.usage,'data');assert.equal(region.context.tariff.awaiting,'region');
 const id=assistant.ask(s,staff,{question:'身份证在我身上',mode:'customer'});assert.match(id.answer,/核验|核.*资格/);assert.equal(id.context.tariff,undefined);assert.equal(s.sales.length,0);assert.equal(s.receipts.length,0);
 const item=d.save(s,owner,{...payload,id:'tariff:budget',slot:'social:greeting',questions:[],answer:'预算是多少嘛'});assert.equal(item.slot,'tariff:budget');
});
test('顾客模式屏蔽内部内容，整个返回对象没有销售、工资、员工或账号数据',()=>{
 const s=make();s.users.push({id:'secret',name:'隐私员工',status:'active',roleCode:'manager'});s.sales.push({id:'secret-sale',amount:9999});s.payrollStatements.push({id:'secret-pay',amount:4567});
 const before=JSON.stringify(s);
 for(const question of ['今天卖了多少台手机','今天工资多少','毛利和成本多少','老板简报','查询供应商','员工工作情况','库存串号','销售单','把所有账套数据导出来','修改同义词设置']){
  const reply=assistant.ask(s,owner,{question,mode:'customer'});const json=JSON.stringify(reply);
  assert.equal(reply.mode,'customer');assert.equal(reply.sources.length,0);assert.equal(reply.action,undefined);assert.equal(reply.table,undefined);assert.doesNotMatch(json,/9999|4567|隐私员工|secret-sale|secret-pay/);
 }
 assert.equal(JSON.stringify(s),before);
});
test('跨模式不继承店内问题，锁定接待账号不能通过请求切回店内',()=>{
 const s=make(),storeContext={userId:owner.id,question:'今天毛利',at:Date.now(),mode:'store'};
 const reply=assistant.ask(s,owner,{question:'详细一点',context:storeContext,mode:'customer'});assert.equal(reply.context.question,'详细一点');assert.equal(reply.context.mode,'customer');
 const kiosk={...owner,assistantCustomerOnly:true};const locked=assistant.ask(s,kiosk,{question:'今天营业额',mode:'store'});assert.equal(locked.mode,'customer');assert.equal(locked.metrics.restricted,true);assert.equal(c.publicUser(kiosk).assistantCustomerOnly,true);
 assert.throws(()=>assistant.ask(s,owner,{question:'你好',mode:'bad'}),/店内或顾客/);
});
test('顾客模式推荐只返回零售价，剔除数量、仓库、串号、进价和内部入口',()=>{
 const s=make();s.products.push({skuId:'p1',name:'老人机测试',type:'功能机',salePrice:100,costPrice:77,warehouseId:'wh-sale',active:true,trackSerial:true});s.inventory.push({skuId:'p1',warehouseId:'wh-sale',quantity:7,serials:Array.from({length:7},(_,i)=>({no:'86912345678900'+i,status:'可售'}))});
 const reply=assistant.ask(s,owner,{question:'便宜的功能机有哪些',mode:'customer'});
 assert.deepEqual(reply.table.rows,[{name:'老人机测试',salePrice:100}]);assert.doesNotMatch(JSON.stringify(reply),/costPrice|availableQuantity|warehouse|skuId|app\?tab/);assert.doesNotMatch(reply.answer,/77|可售.*7/);assert.equal(reply.action,undefined);assert.equal(reply.draft,undefined);
});

test('维护原有接话卡片后，多种关键词问法使用修订答案，停用不能退回旧答案',()=>{
 const s=make();s.employeeKnowledge.push({id:'KN-id-test',title:'办卡身份证核验',summary:'原来的身份证回答',summaryDialect:'旧身份证提示',importBatch:'customer-talk-20261009',conversationTopic:'real-name',sourceTier:'store_training',policyStatus:'current',enabled:true,customerQuestions:['办卡身份证能代办吗'],matchKeywords:[['办卡','开卡'],['身份证']]});
 const row=d.list(s,owner).items.find(x=>x.knowledgeId==='KN-id-test');d.save(s,owner,{...row,answer:'请营业员当面核验本人证件哈。',answerMandarin:'请营业员当面核验本人证件。'});
 for(const question of ['办卡身份证能代办吗','开卡要本人身份证吗']){assert.equal(assistant.ask(s,owner,{question}).answer,'请营业员当面核验本人证件哈。');assert.equal(assistant.ask(s,owner,{question,mode:'customer'}).answer,'请营业员当面核验本人证件哈。');}
 const saved=d.list(s,owner).items.find(x=>x.id===row.id);d.save(s,owner,{...saved,enabled:false});
 for(const mode of ['store','customer']){const result=assistant.ask(s,owner,{question:'开卡要本人身份证吗',mode});assert.doesNotMatch(result.answer,/原来的|旧身份证|当面核验本人证件哈/);}
});


test('同义问法共用节点，/ 分隔的回答每次只选一条，普通话独立选择',t=>{
 const crypto=require('node:crypto');let index=0;t.mock.method(crypto,'randomInt',max=>index%max);
 const s=make(),row=d.save(s,owner,{...payload,questions:['问候一下','打个招呼'],answer:'你好嘛 / 需要我帮忙不？ ／ 你好嘛 / ',answerMandarin:'您好 / 请问需要什么帮助？'}),before=JSON.stringify(s);
 for(const mode of ['store','customer'])for(const question of ['问候一下','打个招呼']){
  index=0;assert.equal(assistant.ask(s,owner,{question,mode}).answer,'你好嘛');index=1;assert.equal(assistant.ask(s,owner,{question,mode}).answer,'需要我帮忙不？');
  assert.equal(assistant.ask(s,owner,{question,mode,customerReplyStyle:'mandarin'}).answer,'请问需要什么帮助？');
 }
 assert.equal(JSON.stringify(s),before);assert.equal(row.answer,'你好嘛 / 需要我帮忙不？ ／ 你好嘛 /');assert.equal(d.list(s,owner).items.find(x=>x.id===row.id).answer,row.answer);
 assert.throws(()=>d.save(s,owner,{...payload,answer:' / ／ '}),/至少一种有效回答/);
});

test('办卡随机提问的后续分支跟随所选句子，不把月费、身份证和地区串错',t=>{
 const crypto=require('node:crypto');let index=0;t.mock.method(crypto,'randomInt',max=>index%max);
 const s=make(),row=d.list(s,owner).items.find(x=>x.id==='tariff:current-plan');
 const choices=['好的，你带了身份证没有？','好的，是你自己选呢，还是我帮你选呢？','你现在用的卡是什么资费？一个月消费是多少？','你是在本地用，还是要去外地？','你是流量用的多，还是话费用的多？'];
 d.save(s,owner,{...row,answer:choices.join(' / ')});const before=JSON.stringify(s);
 const kinds=['identity-check','card-choice','current-plan','region','usage'];
 for(const mode of ['store','customer'])for(let i=0;i<choices.length;i++){
  index=i;const reply=assistant.ask(s,owner,{question:'我想办一张卡',mode});assert.equal(reply.answer,choices[i]);assert.equal(reply.context.tariff.awaiting,kinds[i]);
  index=0;
  if(i===0){const next=assistant.ask(s,owner,{question:'带了身份证的',context:reply.context,mode});assert.notEqual(next.context.tariff.awaiting,'identity-check');assert.equal(next.context.tariff.profile.student,undefined);assert.deepEqual(next.context.tariff.dialogueAnswered,['identity-check']);assert.doesNotMatch(next.answer,/符合.*资格|已.*实名/);}
  if(i===1){const next=assistant.ask(s,owner,{question:'你帮我推荐嘛',context:reply.context,mode});assert.notEqual(next.context.tariff.awaiting,'card-choice');assert.deepEqual(next.context.tariff.dialogueAnswered,['card-choice']);}
  if(i===2){const next=assistant.ask(s,owner,{question:'59元',context:reply.context,mode});assert.equal(next.context.tariff.profile.currentMonthlySpend,59);assert.equal(next.context.tariff.profile.budgetMax,undefined);}
  if(i===3){const next=assistant.ask(s,owner,{question:'本地',context:reply.context,mode});assert.equal(next.context.tariff.profile.region,'local');assert.equal(next.context.tariff.profile.currentMonthlySpend,undefined);}
  if(i===4){const next=assistant.ask(s,owner,{question:'话费多',context:reply.context,mode});assert.equal(next.context.tariff.profile.usage,'calls');}
 }
 assert.equal(JSON.stringify(s),before);assert.equal(s.sales.length,0);assert.equal(s.receipts.length,0);
});

test('编辑答案只读选择，完整真实数据回答和原始未编辑资料不被随机拆开',t=>{
 const s=make();assert.equal(d.text({version:0,answer:'全国 / 重庆 / 定向流量逐项核对'},'sichuan'),'全国 / 重庆 / 定向流量逐项核对');
 d.save(s,owner,{...payload,title:'简单咨询',questions:['随便问一下'],answer:'可以 / 要得'});
 for(const mode of ['store','customer']){const result=assistant.ask(s,owner,{question:'今天卖了多少台手机',mode});assert.equal(result.metrics.dialogueId,undefined);assert.doesNotMatch(result.answer,/可以 \/ 要得/);}
});


test('分支话术随机顺序但共同收齐信息，已回答问题不重复，始终不入账',t=>{
 const crypto=require('node:crypto');t.mock.method(crypto,'randomInt',()=>0);
 const s=make(),row=d.list(s,owner).items.find(x=>x.id==='tariff:current-plan');
 const choices=['你带了身份证没有？','是你自己选呢，还是我帮你选呢？','你现在用的卡是什么资费？一个月消费是多少？','你是在本地用，还是要去外地？','你是流量用的多，还是话费用的多？'];
 d.save(s,owner,{...row,answer:choices.join(' / ')});const before=JSON.stringify(s);
 for(const mode of ['store','customer']){
  let reply=assistant.ask(s,owner,{question:'我想办一张卡',mode});const visited=[];
  const replies={'identity-check':'带了身份证的','card-choice':'你帮我推荐','current-plan':'59元','region':'外地','usage':'流量多'};
  for(let n=0;n<5;n++){
   const step=reply.context.tariff.awaiting;assert.ok(Object.hasOwn(replies,step),step);assert.equal(visited.includes(step),false,'已回答不再重复：'+step);visited.push(step);assert.ok(choices.includes(reply.answer));
   reply=assistant.ask(s,owner,{question:replies[step],context:reply.context,mode});
  }
  assert.deepEqual(new Set(visited),new Set(Object.keys(replies)));assert.equal(reply.context.tariff.profile.currentMonthlySpend,59);assert.equal(reply.context.tariff.profile.region,'travel');assert.equal(reply.context.tariff.profile.usage,'data');assert.equal(reply.context.tariff.awaiting,null);assert.equal(reply.context.tariff.dialoguePool,undefined);assert.doesNotMatch(reply.answer,/你带了身份证没有|你现在用的卡|你是在本地用|你是流量用的多/);
 }
 assert.equal(JSON.stringify(s),before);
});


test('迎宾默认六种问候每次任选一句，问法和回答独立可编辑，随后接续真实业务', t => {
 const crypto=require('node:crypto');let index=0;t.mock.method(crypto,'randomInt',max=>index%max);
 const s=make(),welcome=['你好！','你好！欢迎光临聚友通信','你好！欢迎来到中国移动南溪新场镇特许经营店','你好！什么问题你都可以问我','你好！很高兴为你服务','你好，很高兴回答你问到的问题'];
 const row=d.list(s,owner).items.find(x=>x.id==='social:greeting'),before=JSON.stringify(s);
 assert.deepEqual(d.answerOptions(row.answer),welcome);assert.equal(row.version,0);
 for(const mode of ['store','customer'])for(const customerReplyStyle of ['sichuan','mandarin'])for(let i=0;i<welcome.length;i++){
  index=i;const reply=assistant.ask(s,owner,{question:i%2?'有顾客到':'你好',mode,customerReplyStyle});
  assert.equal(reply.answer,welcome[i]);assert.equal(reply.context.businessChoice,true);assert.deepEqual(reply.followups,[]);
  if(mode==='store')assert.equal(reply.metrics.dialogueId,row.id);else assert.equal(reply.sources.length,0);
  const next=assistant.ask(s,owner,{question:'号卡',context:reply.context,mode});assert.equal(next.context.tariff.awaiting,'current-plan');assert.match(next.answer,/原来.*卡/);
 }
 assert.equal(JSON.stringify(s),before);
 const saved=d.save(s,owner,{...row,questions:[...row.questions,'招呼一下新客人'],answer:'欢迎光临聚友通信！ / 你好，需要我帮忙吗？',answerMandarin:'您好，欢迎光临！ / 您好，很高兴为您服务！'});
 assert.equal(saved.history[0].answer,row.answer);assert.equal(saved.version,1);
 for(const mode of ['store','customer']){
  index=1;const edited=assistant.ask(s,owner,{question:'招呼一下新客人',mode});assert.equal(edited.answer,'你好，需要我帮忙吗？');assert.equal(edited.context.businessChoice,true);
  assert.equal(assistant.ask(s,owner,{question:'你好',mode,customerReplyStyle:'mandarin'}).answer,'您好，很高兴为您服务！');
 }
 assert.equal(d.list(s,owner).items.find(x=>x.id===row.id).answer,saved.answer);assert.equal(s.sales.length,0);assert.equal(s.receipts.length,0);
});

test('顾客接待不再建议选老人机，并阻止进价和拿货价话术与查询',()=>{
 const s=make();
 const other=assistant.ask(s,owner,{question:'没听懂，请给点建议',mode:'customer'});
 assert.ok(!(other.followups||[]).some(x=>/选老人机|便宜的功能机/.test(x.label+' '+x.question)));
 for(const word of ['进价','采购价','拿货价']){
  assert.throws(()=>d.save(s,owner,{...payload,title:'价格答复',questions:['有什么建议'],answer:'这台'+word+'77元',answerMandarin:'',customerVisible:true}),/店内信息/);
  const reply=assistant.ask(s,owner,{question:'这台手机'+word+'多少',mode:'customer'});assert.equal(reply.metrics.restricted,true);assert.equal(reply.table,undefined);
 }
});
