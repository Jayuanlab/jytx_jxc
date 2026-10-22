'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const tariffs=require('../src/assistant-tariff-query');
const mobile=require('../../data/knowledge-imports/mobile-20261009/bundle.json');
const talk=require('../../data/knowledge-imports/customer-talk-20261009/bundle.json');
const owner={id:'owner',name:'老板',roleCode:'owner'};
const staff={id:'staff',name:'营业员',roleCode:'employee'};
function store(){return {employeeKnowledge:structuredClone([...mobile.articles,...talk.articles]),sales:[{id:'S1',amount:100}],products:[{skuId:'p1'}],operationLogs:[]};}
const ask=(s,q,options={})=>tariffs.query(s,staff,q,options);
const fullProfile={budgetMax:100,usage:'calls',region:'travel'};

test('真实六个资费源表解析44档，数字逐行保留出处，副卡不乘共享量',()=>{
  const s=store(),before=JSON.stringify(s),data=tariffs.catalog(s,owner);assert.deepEqual(data.counts,{plans:44,current:26,needsReview:18});
  const fy=data.rows.find(row=>row.family==='feixiang'&&row.baseMonthlyFee===58);assert.equal(fy.voiceMinutes,500);assert.equal(fy.universalGB,20);assert.equal(fy.nationalGB,null);assert.equal(fy.totalMonthlyFee,null);assert.match(fy.feeNote,/必叠加/);assert.match(fy.sources[0].label,/表格 t6/);
  const family=data.rows.find(row=>row.family==='family'&&row.baseMonthlyFee===139);assert.equal(family.minutes,700);assert.equal(family.unspecifiedGB,50);assert.equal(family.domesticGB,null);assert.equal(family.subcards,4);
  const by=data.rows.find(row=>row.family==='bayu'&&row.baseMonthlyFee===59);assert.equal(by.nationalGB,40);assert.equal(by.chongqingGB,80);assert.equal(by.directedGB,null);assert.equal(by.domesticGB,40);assert.equal(by.status,'needs_review');
  const campus=data.rows.find(row=>row.family==='campus'&&row.baseMonthlyFee===19);assert.equal(campus.universalGB,5);assert.equal(campus.directedGB,30);assert.equal(campus.domesticGB,5);assert.equal(campus.commitment,'3年');
  assert.equal(data.rows.filter(row=>row.family==='digital-family'&&row.baseMonthlyFee===169).length,3);assert.equal(JSON.stringify(s),before);
});

test('分类依据明确本地全国定向，待核净价不拼装',()=>{
  const data=tariffs.catalog(store(),owner);assert.deepEqual(data.classifications.map(x=>x.key),['calls','data','local','travel']);
  for(const id of data.classifications.find(x=>x.key==='travel').rowIds){const row=data.rows.find(x=>x.id===id);assert.equal(row.status,'current');assert.ok(row.domesticGB!==null);assert.notEqual(row.family,'bayu');}
  assert.ok(data.pending.some(x=>x.id==='customer-talk-20261009-budget60'));assert.equal(data.rows.some(x=>x.baseMonthlyFee===60),false);assert.match(data.domesticNote,/不含港澳台/);
});

test('买卡办卡开卡同意图，缺资料逐个追问且不下单',()=>{
  const s=store(),before=JSON.stringify(s);for(const q of ['买一张卡','我想买张卡','办一张卡','我想办一张手机卡','开个卡','我想办理号卡','买号码']){const r=ask(s,q);assert.equal(r.metrics.kind,'tariff-recommendations',q);assert.equal(r.conversationHint.awaiting,'current-plan',q);assert.match(r.answer,/好多钱|预算|支出/,q);assert.equal(r.draft,undefined,q);}assert.equal(JSON.stringify(s),before);
  const b=ask(s,'60',{awaiting:'budget',profile:{}});assert.equal(b.conversationHint.profile.budgetTarget,60);assert.equal(b.conversationHint.awaiting,'usage');
  const u=ask(s,'打电话多',{awaiting:'usage',profile:b.conversationHint.profile});assert.equal(u.conversationHint.awaiting,'region');
  const r=ask(s,'经常外地',{awaiting:'region',profile:u.conversationHint.profile});assert.ok(r.tariffOptions.length);assert.equal(r.conversationHint.awaiting,null);
});

test('硬预算和大概预算不同，近邻参考不声称实际支出满足预算',()=>{
  assert.deepEqual(tariffs.parseProfile('上限60元'),{budgetMax:60});assert.deepEqual(tariffs.parseProfile('五六十块左右'),{budgetTarget:60,budgetApprox:true});assert.deepEqual(tariffs.parseProfile('大概80元'),{budgetTarget:80,budgetApprox:true});
  const s=store(),hard=ask(s,'推荐卡，最多60元，通话多，经常去外地'),approx=ask(s,'推荐卡，大概60元，通话多，经常去外地');assert.ok(hard.tariffOptions.every(x=>x.baseMonthlyFee<=60));assert.ok(approx.tariffOptions.some(x=>x.baseMonthlyFee>60));assert.match(hard.answer,/总支出还未核准/);assert.match(approx.metrics.budgetComparison,/不把它当硬上限/);
});

test('通话流量分方向排序，逐个口头报告分钟与有凭据流量',()=>{
  const s=store(),r=ask(s,'详细推荐一张卡，最多100元，通话多，经常去外地');assert.equal(r.tariffOptions[0].baseMonthlyFee,98);assert.equal(r.tariffOptions[0].minutes,700);assert.match(r.answer,/700分钟、60GB通用流量/);assert.match(r.answer,/500分钟、40GB通用流量/);assert.match(r.answer,/500分钟、20GB通用流量/);
  const d=ask(s,'详细推荐卡，最多100元，上网多，经常外地');assert.deepEqual(d.tariffOptions.map(x=>x.universalGB),[60,40,20]);assert.match(d.answer,/按可核对流量优先/);
  const local=ask(s,'推荐卡，大概100元，打电话多，本地用，要宽带');assert.ok(local.tariffOptions.length);assert.match(local.answer,/范围待核/);assert.ok(local.tariffOptions.every(x=>x.domesticGB===null));
});

test('外地仅用已写全国或通用，港澳台国外先核专门漫游',()=>{
  const s=store(),r=ask(s,'推荐卡，最多100元，上网多，经常外地');assert.ok(r.tariffOptions.every(x=>x.domesticGB!==null&&x.status==='current'));assert.ok(r.tariffOptions.every(x=>x.family!=='bayu'&&x.family!=='family'));
  for(const q of ['去香港用什么卡','去澳门用什么卡','去台湾推荐卡','经常出国用什么卡']){const a=ask(s,q);assert.equal(a.metrics.international,true,q);assert.match(a.answer,/不.*国内通用|不能.*国内通用/,q);assert.equal(a.tariffOptions,undefined,q);}
});

test('套餐身份资格未核不承诺校园卡，定向和校园不合并成全国',()=>{
  const s=store(),r=ask(s,'推荐卡，最多20元，上网多，经常外地');assert.ok(r.tariffOptions.every(x=>x.family!=='campus'));const student=ask(s,'我是学生，推荐卡，最多20元，上网多，经常外地');assert.ok(student.tariffOptions.some(x=>x.family==='campus'));const row=student.tariffOptions.find(x=>x.family==='campus');assert.equal(row.domesticGB,5);assert.equal(row.directedGB,30);assert.equal(row.totalMonthlyFee,null);assert.match(row.conditions.join(' '),/学生身份.*核对/);
});

test('老套餐每月支出只作线索，不能推断具体套餐或基础费',()=>{
  const p=tariffs.parseProfile('原来一个月花60元，上网不够用');assert.equal(p.currentMonthlySpend,60);assert.equal(p.baselineBaseFee,undefined);const merged=tariffs.mergeProfile({},p);assert.equal(merged.budgetTarget,60);assert.equal(merged.budgetSource,'previousSpend');assert.equal(merged.previousPlanName,undefined);
  const s=store(),r=ask(s,'原来一个月花60元，上网不够用',{profile:{usage:'data',region:'travel'}});assert.ok(r.tariffOptions.length);assert.match(r.metrics.budgetComparison,/不能据此认定原套餐或总费/);assert.equal(r.tariffOptions.some(x=>x.family==='bayu'),false);
  assert.equal(tariffs.parseProfile('现在用巴渝卡，每月60元').previousPlanName,'巴渝卡');assert.equal(tariffs.parseProfile('原套餐月租58元').baselineBaseFee,58);
});

test('只有话费贵先询问超套附加和优惠到期，不直接升档承诺省钱',()=>{
  const s=store(),r=ask(s,'话费太贵了',{profile:fullProfile});assert.equal(r.conversationHint.awaiting,'billing-concern');assert.equal(r.metrics.billingCauseRequired,true);assert.match(r.answer,/用超|附加业务|优惠到期/);assert.equal(r.tariffOptions,undefined);
  const over=ask(s,'流量用超了',{profile:{...fullProfile,billingConcern:['expensive']},awaiting:'billing-concern'});assert.ok(over.tariffOptions.length);assert.equal(over.conversationHint.profile.overage,true);assert.doesNotMatch(over.answer,/保证省|一定更省|升档会省/);
});

test('明确权益闲置且原基础费已知才筛低档，不用实际账单冒充基础费',()=>{
  const s=store(),r=ask(s,'用量很少，用不完，原套餐月租98元，话费太贵了',{profile:{budgetTarget:100,usage:'calls',region:'travel'}});assert.ok(r.tariffOptions.every(row=>row.baseMonthlyFee<98));
  const unknown=ask(s,'原来每月花98元，用不完，话费太贵了',{profile:{usage:'calls',region:'travel'}});assert.equal(unknown.conversationHint.profile.baselineBaseFee,undefined);assert.ok(unknown.tariffOptions.some(x=>x.baseMonthlyFee===98));
});

test('完整关键条件已知不反复索要旧卡，可直接先推荐',()=>{
  const s=store(),r=ask(s,'不知道旧卡，先推荐',{profile:fullProfile});assert.equal(r.conversationHint.profile.skipPrevious,true);assert.ok(r.tariffOptions.length);assert.equal(r.conversationHint.awaiting,null);assert.equal(tariffs.nextQuestion(fullProfile).awaiting,null);
});

test('调用纯查询不写金融业务，业务统计及操作指令不被吞',()=>{
  const s=store(),before=JSON.stringify(s);for(const q of ['今天开了多少张卡','今天移动酬金到账多少','查华为库存','便宜的老人机有哪些','给我发红包办卡奖励','帮我提交卡业务单','补卡需要什么证件','手机号过户怎么办','今天毛利多少'])assert.equal(ask(s,q,{profile:fullProfile}),null,q);ask(s,'整理全部卡资源');ask(s,'推荐卡，最多100元，通话多，外地用');assert.equal(JSON.stringify(s),before);
});

test('空白推荐先问旧卡消费，够不够和超套逐句接收，完整关键条件不强问旧卡',()=>{
  assert.equal(tariffs.nextQuestion({}).awaiting,'current-plan');assert.equal(tariffs.nextQuestion({skipPrevious:true}).awaiting,'budget');
  const old=tariffs.mergeProfile({},tariffs.parseProfile('原来每月交60元','current-plan'));assert.equal(tariffs.nextQuestion(old).awaiting,'use-check');
  const enough=tariffs.mergeProfile(old,tariffs.parseProfile('够用但想省钱','use-check'));assert.equal(enough.enough,true);assert.ok(enough.billingConcern.includes('expensive'));assert.equal(tariffs.nextQuestion(enough).awaiting,'usage');
  const unknown=tariffs.mergeProfile({},tariffs.parseProfile('不知道旧套餐，先推荐','current-plan'));assert.equal(tariffs.nextQuestion(unknown).awaiting,'budget');assert.equal(tariffs.nextQuestion(fullProfile).awaiting,null);
});

test('同版同档按最新完整行，不能拼不同来源的价格权益；同日冲突暂不推荐',()=>{
  const s=store(),original=s.employeeKnowledge.find(x=>x.id==='mobile-20261009-feixiang'),newer=structuredClone(original);newer.id='new-feixiang';newer.sourceDocumentDate='2026-10-10';newer.sourceBlocks=[{id:'new-table',kind:'table',rows:[['月费','语音(分钟)','通用流量(GB)'],['58','600','25']]}];s.employeeKnowledge.push(newer);const row=tariffs.catalog(s,owner).rows.find(x=>x.family==='feixiang'&&x.baseMonthlyFee===58);assert.equal(row.minutes,600);assert.equal(row.universalGB,25);assert.equal(row.articleId,'new-feixiang');
  const conflict=structuredClone(newer);conflict.id='same-date-conflict';conflict.sourceBlocks[0].rows[1]=['58','650','26'];s.employeeKnowledge.push(conflict);const conflicts=tariffs.catalog(s,owner).rows.filter(x=>x.family==='feixiang'&&x.baseMonthlyFee===58);assert.equal(conflicts.length,2);assert.ok(conflicts.every(x=>x.status==='needs_review'));assert.ok(ask(s,'推荐卡，最多60元，通话多，经常外地').tariffOptions.every(x=>x.baseMonthlyFee!==58));
});

test('停用过期未来和正文修订的旧表不继续当现行表推荐',()=>{
  for(const patch of [{enabled:false},{policyStatus:'historical'},{validTo:'2020-01-01'},{validFrom:'2099-01-01'},{sourceRevisionNote:'正文改为售后，旧表不适用'}]){const s=store();Object.assign(s.employeeKnowledge.find(x=>x.id==='mobile-20261009-feixiang'),patch);assert.ok(tariffs.catalog(s,owner).rows.every(x=>x.family!=='feixiang'));}
});

test('默认方言与普通话切换，列表只输出顾客权益而无内部提成',()=>{
  const s=store(),r=ask(s,'整理全部卡资源');assert.equal(r.metrics.catalog,true);assert.equal(r.sections[0].rows.length,44);assert.doesNotMatch(JSON.stringify(r),/酬金|返店激励|渠道获|工资|销售毛利|渠道酬金/);assert.equal(r.metrics.replyStyle,'sichuan');
  const mandarin=ask(s,'我想办张卡',{customerReplyStyle:'mandarin'});assert.equal(mandarin.metrics.replyStyle,'mandarin');assert.match(mandarin.answer,/每月大概支出/);assert.doesNotMatch(mandarin.answer,/好多钱/);
});

test('银行卡信用卡充值卡和卡住故障不被裸卡意图吞掉',()=>{
  const s=store();for(const q of ['银行卡有哪些','信用卡有哪些','充值卡有哪些','这张老人机卡住了有哪些维修办法','我不想办卡'])assert.equal(ask(s,q,{profile:fullProfile}),null,q);
  assert.equal(tariffs.parseProfile('不知道','current-plan').skipPrevious,true);assert.equal(tariffs.parseProfile('没有','current-plan').skipPrevious,true);
});

test('确切套餐资费查询让权威政策处理，current-plan裸数字是旧月支出而非预算',()=>{
  const s=store();for(const q of ['校园青春卡59元档资费是多少','巴渝卡59元有多少流量','飞享58元多少分钟'])assert.equal(ask(s,q),null,q);
  for(const q of ['80','八十','80块','不知道啥套餐，平时大约八十']){const p=tariffs.parseProfile(q,'current-plan');assert.equal(p.currentMonthlySpend,80,q);assert.equal(p.budgetTarget,undefined,q);assert.equal(p.previousPlanName,undefined,q);}
  assert.deepEqual(tariffs.parseProfile('最多60元','current-plan'),{budgetMax:60});assert.equal(tariffs.parseProfile('原来每月最多80元','current-plan').currentMonthlySpend,80);assert.equal(tariffs.parseProfile('原来每月最多80元','current-plan').budgetMax,undefined);
  const r=ask(s,'推荐卡，预算最多100元，本地用，电话和流量都不用');assert.equal(r.conversationHint.profile.minutesNeeded,0);assert.equal(r.conversationHint.profile.dataGBNeeded,0);assert.equal(r.tariffOptions[0].baseMonthlyFee,18);
  const brief=ask(s,'推荐卡，最多100元，通话多，外地用');assert.equal(brief.tariffOptions.length,2);const detail=ask(s,'再看详细条件',{profile:fullProfile});assert.equal(detail.tariffOptions.length,3);assert.equal(detail.metrics.catalog,undefined);
});

test('升降或加包只作建议，否定超套不延续旧concern，含糊金额不猜',()=>{
  const s=store(),up=ask(s,'流量不够用',{profile:fullProfile});assert.equal(up.metrics.direction,'compare-upgrade-or-addon');assert.match(up.adjustmentAdvice,/升档或.*加包/);
  const down=ask(s,'用不完',{profile:fullProfile});assert.equal(down.metrics.direction,'compare-downgrade');assert.match(down.adjustmentAdvice,/原合约/);
  for(const q of ['没用超','没有用超','未超套']){const p=tariffs.parseProfile(q,'use-check');assert.equal(p.overage,false,q);assert.equal(p.billingConcern.includes('overage'),false,q);assert.equal(tariffs.mergeProfile({overage:true,billingConcern:['overage']},p).billingConcern.includes('overage'),false,q);}
  for(const q of ['一百五','一千二']){const p=tariffs.parseProfile(q,'budget');assert.equal(p.budgetTarget,undefined,q);assert.equal(tariffs.parseProfile(q,'current-plan').currentMonthlySpend,undefined,q);}
});

test('profile边界拒绝任意字段与无限金额，预算修改替换旧约束',()=>{
  assert.deepEqual(tariffs.mergeProfile({budgetMax:60,admin:true},{budgetTarget:80,budgetApprox:true}),{budgetTarget:80,budgetApprox:true});assert.deepEqual(tariffs.mergeProfile({budgetTarget:80,budgetApprox:true},{budgetMax:50}),{budgetMax:50});assert.deepEqual(tariffs.mergeProfile({}, {budgetMax:Infinity,usage:'administrator',region:'anywhere',people:1000,student:'yes'}),{});
});

test('可见资费表逐档标明现行或待核状态，不把待核当现行报价',()=>{const r=ask(store(),'整理全部卡资源');assert.ok(r.table.columns.some(row=>row.key==='statusLabel'));assert.equal(r.table.rows.filter(row=>row.statusLabel==='待核实').length,18);assert.equal(r.table.rows.filter(row=>row.statusLabel.startsWith('现行参考')).length,26);});

test('老板新增4G飞享8元档单独分类，真实0与套餐外单价保留，不套旧飞享叠加条件',()=>{
 const c=require('../src/common'),{add}=require('../../scripts/add-4g-feixiang-8'),knowledge=require('../src/employee-knowledge'),exporter=require('../../web/assistant-tariff-export');
 const s=c.initialize({users:[owner],employeeKnowledge:structuredClone(mobile.articles)}),first=add(s,owner),row=tariffs.catalog(s,owner).rows.find(r=>r.articleId===first.id);
 assert.equal(row.family,'4g-feixiang');assert.equal(row.baseMonthlyFee,8);assert.equal(row.minutes,0);assert.equal(row.domesticGB,0);assert.equal(row.eligibleForNewCard,null);
 assert.match(row.feeNote,/0.19元\/分钟/);assert.match(row.feeNote,/10元\/GB/);assert.doesNotMatch(row.feeNote,/必叠加移动云盘/);
 const copy=exporter.text([row]);assert.match(copy,/套餐类型：4G飞享套餐/);assert.match(copy,/0分钟\/月/);assert.match(copy,/0GB\/月/);assert.match(copy,/10元\/GB/);
 const answer=knowledge.query(s,owner,'4G飞享8元档套餐外收费多少');assert.ok(answer);assert.match(answer.answer,/0.19/);assert.match(answer.answer,/10/);
 assert.equal(add(s,owner).duplicate,true);assert.equal(tariffs.catalog(s,owner).rows.filter(r=>r.articleId===first.id).length,1);
});


test('孩子上学的口语需求进入学生办卡推荐，不把明确非学生当成学生',()=>{
 const s=store(),r=ask(s,'孩子上学需要办什么卡');
 assert.equal(r.metrics.kind,'tariff-recommendations');assert.equal(r.conversationHint.profile.student,true);assert.equal(r.metrics.needsClarification,true);
 assert.equal(tariffs.parseProfile('孩子不上学了，办什么卡').student,false);
 assert.equal(tariffs.parseProfile('不是学生，办什么卡').student,false);
});
