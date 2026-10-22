'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args);};
const c=require('../src/common'),importer=require('../src/employee-knowledge-import'),policy=require('../src/policy-knowledge-query'),chat=require('../src/assistant-chat'),customer=require('../src/assistant-customer');
const directory=path.join(__dirname,'../../data/knowledge-imports/mobile-promotions-20261010'),bundle=JSON.parse(fs.readFileSync(path.join(directory,'bundle.json'),'utf8'));
const owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'营业员',roleCode:'employee',status:'active'};
function fixture(){const s=c.initialize({users:[owner,staff],sales:[{id:'keep-sale'}],inventory:[{id:'keep-stock'}]});importer.apply(s,owner,bundle);return s;}
function query(s,q){return policy.query(s,staff,q,s.employeeKnowledge);}
test('三张资料提取、八张资料卡片及活动期间保持一致，重复导入不污染业务',()=>{
 const s=fixture();assert.equal(s.employeeKnowledge.length,8);assert.equal(s.employeeKnowledge.filter(row=>row.policyStatus==='needs_review').length,3);
 assert.equal(bundle.report.originalImagesRetained,false);assert.equal(bundle.report.sourceFiles.length,3);for(const row of s.employeeKnowledge){assert.equal(row.uploadSha256,undefined);assert.ok(row.sourceFiles.every(file=>!file.downloadHref));}
 for(const row of s.employeeKnowledge){assert.ok(row.validFrom<=row.validTo);assert.equal(row.body,row.sourceBlocks.map(b=>b.text).join('\n'));}
 const before=JSON.stringify(s);assert.equal(importer.apply(s,owner,bundle).unchanged,8);assert.equal(JSON.stringify(s),before);assert.deepEqual(s.sales,[{id:'keep-sale'}]);assert.deepEqual(s.inventory,[{id:'keep-stock'}]);
 assert.equal(importer.report(s,owner).batches[0].id,bundle.id);
});
test('促销截止日与36个月合约分别回答，月费和一次调测费不混算',t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture();
 const date=query(s,'AI守护礼活动什么时候结束');assert.match(date.answer,/2026-10-31/);assert.match(date.answer,/促销截止日与产品合约到期日分开计算/);
 const fee=query(s,'移动看家5元合约多久');assert.match(fee.answer,/5/);assert.match(fee.answer,/36个月/);assert.match(fee.answer,/100元调测费/);assert.match(fee.answer,/3年后依然5元/);
});
test('按第二列资费选择39元和25元对应产品，不用错误档位充数',t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture();
 const fee=query(s,'AI灵犀屏39元资费合约');assert.match(fee.answer,/39/);assert.match(fee.answer,/合约期（月）：36/);assert.doesNotMatch(fee.answer,/合约期（月）：48/);
 const absent=query(s,'AI灵犀屏99元资费');assert.equal(absent.metrics.needsClarification,true);assert.match(absent.answer,/没有找到 99/);
});
test('不清权益和原图2830疑点不作为确定政策，积分不换算现金',t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture(),unknown=query(s,'泛屏升级后权益：截图右侧截断待核');
 assert.equal(unknown.metrics.needsReview,true);const other=query(s,'异业购达量激励：宇光第二档待核');assert.equal(other.metrics.needsReview,true);assert.match(other.answer,/2830/);
 const pad=query(s,'移动爱家PAD达量激励标准');assert.match(pad.answer,/月目标（笔）：20/);assert.match(pad.answer,/30分/);assert.match(pad.answer,/T\+3月/);assert.match(pad.answer,/积分不等于元/);
});
test('促销开始前和到期后不报价，客户模式也不能绕过日期去外部再报旧优惠',async t=>{
 const s=fixture();let day='2026-09-30',calls=0;t.mock.method(c,'day',()=>day);
 const client={configured:()=>true,hasContext:()=>false,request:async()=>{calls++;throw Error('Must not send expired policy outside');}};
 for(day of ['2026-09-30','2026-11-01']){
  const a=await chat.ask(s,owner,{question:'AI守护礼5元合约多久',mode:'customer'},{client});
  assert.equal(a.metrics.needsReview,true);assert.doesNotMatch(a.answer,/产品内容：|36个月|100元调测/);
 }
 assert.equal(calls,0);
});
test('客户可以问公开促销，渠道激励和待核权益不向客户泄露',t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture();
 const a=customer.query(s,owner,{question:'AI守护礼5元合约多久',mode:'customer'});assert.match(a.answer,/36个月/);assert.ok(a.sources.length);
 const b=customer.query(s,owner,{question:'移动爱家PAD可获积分多少'});assert.equal(b.metrics.restricted,true);assert.doesNotMatch(b.answer,/30分|40分/);
});
test('导入包也验证真实日期和结束先后，失败时知识及业务均保持原状',()=>{
 const s=fixture(),before=JSON.stringify(s);
 for(const change of [{validFrom:'2026-02-31'},{validFrom:'2026-12-31',validTo:'2026-10-01'}]){
  const damaged=structuredClone(bundle);Object.assign(damaged.articles[0],change);delete damaged.fingerprint;damaged.fingerprint=importer.fingerprint(damaged);
  assert.throws(()=>importer.apply(s,owner,damaged));assert.equal(JSON.stringify(s),before);
 }
});

test('顾客只取得公开收费资料，完整回答也不带内部办理路径、折扣口径或原图下载',t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture();
 const a=customer.query(s,owner,{question:'AI守护礼5元详细全文'});
 assert.match(a.answer,/36个月/);assert.match(a.answer,/100元调测费/);
 assert.doesNotMatch(JSON.stringify(a),/生态产品订购|H折扣|knowledge\/file|截图|\.jpg|办理路径/);
 const b=customer.query(s,owner,{question:'AI灵犀屏39元资费合约'});
 assert.match(b.answer,/39/);assert.doesNotMatch(b.answer,/合约期（月）：48/);
 for(const question of ['营业厅达量标准','宇光是什么代理商','AI守护礼办理路径','H折扣优惠包怎么选']){
  const result=customer.query(s,owner,{question});assert.equal(result.metrics.restricted,true);
 }
 assert.match(s.employeeKnowledge.find(row=>row.id.endsWith('-pad-incentive')).body,/宇光是本县最大的代理商/);
});
test('客户的外部回答含厅店内部政策时拦截，错误可见标记不能开放激励卡',async t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture();
 s.employeeKnowledge.find(row=>row.id.endsWith('-pad-incentive')).customerVisible=true;
 const restricted=customer.query(s,owner,{question:'移动爱家PAD政策'});
 assert.doesNotMatch(JSON.stringify(restricted),/30分|40分|宇光|T\+3/);
 const client={configured:()=>true,hasContext:()=>false,request:async()=>({status:'ok',intent:'biz',reply:'宇光代理商每月达量可获渠道积分',hits:[{std:'办理业务',score:0.95}]})};
 const external=await chat.ask(s,owner,{question:'单独加个流量包多少钱',mode:'customer'},{client});
 assert.equal(external.externalChat.reason,'private-answer');assert.doesNotMatch(external.answer,/宇光|代理商|积分/);
});

test('店内明确产品资费优先查资料，不进入手机卡通用需求问答',async t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture();let calls=0;
 const client={configured:()=>true,hasContext:()=>false,request:async()=>{calls++;throw Error('Local dated tariffs must not go outside');}};
 for(const user of [owner,staff]){
  const a=await chat.ask(s,user,{question:'AI灵犀屏39元资费合约'},{client});
  assert.match(a.answer,/39/);assert.match(a.answer,/合约期（月）：36/);assert.doesNotMatch(a.answer,/流量用得多|通话用得多|合约期（月）：48/);
 }
 assert.equal(calls,0);
});

test('用户核定39元后不继续按39.9元报价',t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture(),row=s.employeeKnowledge.find(row=>row.id.endsWith('-screen-fees'));
 assert.equal(row.confirmedCorrections[0].value,39);
 const result=customer.query(s,owner,{question:'AI灵犀屏39元资费合约'});
 assert.match(result.answer,/每月39元/);assert.doesNotMatch(result.answer,/39\.9/);
 const wrong=customer.query(s,owner,{question:'AI灵犀屏39.9元资费'});
 assert.equal(wrong.metrics.needsClarification,true);assert.doesNotMatch(wrong.answer,/资费（元\/月）：39\.9/);
});

test('顾客资费用自然文字接话，待核资料也给参考内容',t=>{
 t.mock.method(c,'day',()=> '2026-10-10');const s=fixture();
 const a=customer.query(s,owner,{question:'AI灵犀屏39元资费合约'});
 assert.match(a.answer,/每月39元/);assert.match(a.answer,/合约36个月/);assert.match(a.answer,/营业员帮你核对/);
 assert.doesNotMatch(a.answer,/资费（元\/月）：|可获积分|宇光|39\.9/);
 const b=customer.query(s,owner,{question:'移动看家5元合约多久'});
 assert.match(b.answer,/每月5元/);assert.match(b.answer,/100元调测费/);assert.match(b.answer,/指定全光产品/);
 const pending=query(s,'异业购达量激励：宇光第二档待核');assert.match(pending.answer,/资料参考/);assert.match(pending.answer,/25\/35\/50分/);assert.match(pending.answer,/待核实/);
});

test('口语金额、全角数字和摄像头叫法都查同一条有效促销',async t=>{
 t.mock.method(c,'day',()=> '2026-10-11');const s=fixture();let calls=0;
 const client={configured:()=>true,hasContext:()=>false,request:async()=>{calls++;throw Error('Known promotion must be local');}};
 for(const question of ['五块钱看家的活动还有没有','那个5块钱摄像头要签几年','５元监控可以看几天录像']){
  for(const mode of ['store','customer']){
   const a=await chat.ask(s,owner,{question,mode},{client});
   assert.equal(a.metrics.articleId,'mobile-promotions-20261010-ai-care');
   assert.doesNotMatch(a.answer,/没识别|你是想买商品/);
   assert.match(a.answer,/2026-10-31|36个月|3天/);
  }
 }
 assert.equal(calls,0);
});

test('按灵犀屏名称和口语月费回答，比较档位不夹带同价OTV',t=>{
 t.mock.method(c,'day',()=> '2026-10-11');const s=fixture();
 for(const question of ['灵犀屏39块一个月包含啥','灵犀屏三十九块钱有啥']){
  const a=customer.query(s,owner,{question});assert.match(a.answer,/每月39元/);assert.match(a.answer,/合约36个月/);
  assert.doesNotMatch(a.answer,/请先选定|25元|璨彩|。。/);
 }
 const comparison=customer.query(s,owner,{question:'灵犀屏25元和39元有啥区别'});
 assert.match(comparison.answer,/每月25元/);assert.match(comparison.answer,/每月39元/);assert.doesNotMatch(comparison.answer,/璨彩|OTV|。。/);
 const otv=customer.query(s,owner,{question:'OTV25块钱合约多久'});assert.match(otv.answer,/璨彩/);assert.doesNotMatch(otv.answer,/AI灵犀屏-影视版/);
});

test('泛屏免费升级与基础资费分清，口语问法到期后也不报价',async t=>{
 let date='2026-10-11';t.mock.method(c,'day',()=>date);const s=fixture();
 const upgrade=customer.query(s,owner,{question:'泛屏升级还要加钱吗'});
 assert.equal(upgrade.metrics.articleId,'mobile-promotions-20261010-screen-upgrade');assert.match(upgrade.answer,/免费/);assert.doesNotMatch(upgrade.answer,/请先选定/);
 date='2026-11-01';let calls=0;
 const client={configured:()=>true,hasContext:()=>false,request:async()=>{calls++;throw Error('Expired must stay local');}};
 const a=await chat.ask(s,owner,{question:'五块钱看家还有没有',mode:'customer'},{client});
 assert.equal(a.metrics.needsReview,true);assert.doesNotMatch(a.answer,/每月5元|合约36个月/);assert.equal(calls,0);
});
