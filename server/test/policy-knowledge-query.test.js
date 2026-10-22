const test=require('node:test');
const assert=require('node:assert/strict');
const {query}=require('../src/policy-knowledge-query');
const owner={id:'boss',name:'老板',roleCode:'owner'},store={employeeKnowledge:[]};
function item(overrides={}){return {id:'campus',title:'校园青春卡升级版',category:'移动资费',summary:'校园客户青春卡',body:'校园青春卡升级版\n适用：校园客户；本人有效身份证到场。\n月费 | 通话(分钟) | 通用流量(GB) | 定向流量(GB) | 承诺期\n19元档 | 100 | 5 | 30 | 3年\n59元档 | 300 | 20 | 30 | 3年',tags:['青春卡','校园青春卡','动感地带'],keywords:['资费','校园'],sourceTier:'store_policy',policyStatus:'current',asOf:'2026-10-09',applicableScope:'重庆移动校园客户',sourceFiles:[{name:'04_校园青春卡资费.docx'}],sourceRefs:[{file:'04_校园青春卡资费.docx',blockId:'p2',label:'第2段'},{file:'04_校园青春卡资费.docx',blockId:'t4',label:'表格4'}],sourceBlocks:[{id:'p2',kind:'paragraph',text:'适用：校园客户；本人有效身份证到场。'},{id:'t4',kind:'table',text:'原资费表',rows:[['月费','通话(分钟)','通用流量(GB)','定向流量(GB)','承诺期'],['19元档','100','5','30','3年'],['59元档','300','20','30','3年']]}],version:1,...overrides};}
test('自然问法按指定档次提取原表行、表头单位和资格条件',()=>{
  const result=query(store,owner,'校园青春卡59多少钱',[item()]);
  assert.match(result.answer,/月费：59元档/);assert.match(result.answer,/通用流量\(GB\)：20/);assert.match(result.answer,/定向流量\(GB\)：30/);assert.match(result.answer,/承诺期：3年/);assert.match(result.answer,/本人有效身份证/);
  assert.doesNotMatch(result.answer,/19元档|通用流量\(GB\)：5/);assert.equal(result.sections[0].rows.length,1);
  assert.ok(result.sources.some(source=>source.label.includes('04_校园青春卡资费.docx')&&source.id.endsWith(':t4')));
  assert.equal(result.action.type,'navigate');
});
test('当前日期账目、库存和开单操作不能被知识库拦截',()=>{
  const records=[item()];
  for(const question of ['今天移动酬金到账多少','今天营业额是多少','华为库存有多少','今天办了多少校园青春卡','售出一台华为帮我开单','帮我开一张巴渝卡单','删除校园青春卡资料'])assert.equal(query(store,owner,question,records),null,question);
});
test('对不同促销的同档套餐要求先选择，不能混报流量',()=>{
  const base=item({id:'family-base',title:'全家享2026基础资费',tags:['全家享'],body:'全家享基础69档15GB',sourceBlocks:[{id:'t1',kind:'table',rows:[['月费','流量'],['69','15GB']]}]});
  const double=item({id:'family-double',title:'全家享流量翻倍促销',tags:['全家享','流量翻倍'],body:'全家享69流量翻倍30GB',sourceBlocks:[{id:'t2',kind:'table',rows:[['套餐档次','合计流量'],['全家享69','30GB']]}]});
  const result=query(store,owner,'全家享69流量多少',[base,double]);
  assert.equal(result.metrics.needsClarification,true);assert.match(result.answer,/基础资费/);assert.match(result.answer,/流量翻倍/);assert.doesNotMatch(result.answer,/15GB|30GB/);
  const chosen=query(store,owner,'全家享69流量翻倍有多少流量',[base,double]);assert.match(chosen.answer,/30GB/);assert.doesNotMatch(chosen.answer,/15GB/);
});
test('具体待核实专题不被泛化现行资料覆盖，争议金额不当成答案',()=>{
  const blocked=item({id:'hebao',title:'和包券',tags:['和包券','会员费'],body:'和包券会员费109元或219元。',policyStatus:'needs_review',reviewIssues:[{id:'hebao-fee',title:'会员费存在冲突',detail:'同一超级版出现不同口径，需确认适用版本。'}]});
  const generic=item({id:'general',title:'普通购机流程',tags:['购机','业务'],body:'购机时可查询和包券会员费。',sourceBlocks:[]});
  const result=query(store,owner,'和包券会员费是多少',[generic,blocked]);assert.equal(result.metrics.needsReview,true);assert.match(result.answer,/会员费存在冲突/);assert.match(result.answer,/不同口径/);assert.doesNotMatch(result.answer,/109|219/);
});
test('历史、过期与未生效资料不能当作现行依据',()=>{
  for(const metadata of [{policyStatus:'historical'},{validTo:'2020-01-01'},{validFrom:'2099-01-01'}]){
    const result=query(store,owner,'校园青春卡59多少钱',[item(metadata)]);assert.equal(result.metrics.needsReview,true);assert.doesNotMatch(result.answer,/通用流量\(GB\)：20/);
  }
});
test('没提供某档数据不补算也不展示其他档假充答案',()=>{
  const result=query(store,owner,'校园青春卡99元档有多少流量',[item()]);assert.match(result.answer,/没有找到 99 元档/);assert.equal(result.metrics.needsClarification,true);assert.doesNotMatch(result.answer,/300|59元档/);
});
test('巴渝卡合约多久引用原文，指定档只读该表行',()=>{
  const card=item({id:'bayu',title:'神州行巴渝卡2026升级版',tags:['巴渝卡'],body:'神州行巴渝卡2026升级版（合约版，有效期2年）\n59元：120G',sourceBlocks:[{id:'p14',kind:'paragraph',text:'神州行巴渝卡2026升级版（合约版，有效期2年）'},{id:'t15',kind:'table',rows:[['月费','全国流量'],['19','2G'],['59','120G']]}]});
  const result=query(store,owner,'巴渝卡合约多久',[card]);assert.match(result.answer,/有效期2年/);assert.doesNotMatch(result.answer,/120G/);
  const tier=query(store,owner,'巴渝卡59元档合约多久',[card]);assert.match(tier.answer,/月费：59/);assert.match(tier.answer,/有效期2年/);assert.doesNotMatch(tier.answer,/月费：19/);
});
test('考试题只有用户要求考核时使用，错选项不会充当政策',()=>{
  const exam=item({id:'exam',title:'第18题：青春卡资费考核',sourceTier:'store_exam',body:'第18题（选错项）：A、59元有999GB。正确答案A。',sourceBlocks:[],tags:['青春卡','考核','第18题']});
  const result=query(store,owner,'青春卡59元有多少流量',[exam,item()]);assert.doesNotMatch(result.answer,/999GB/);assert.equal(result.metrics.sourceTier,'store_policy');
  const question=query(store,owner,'第18题青春卡考核答案',[exam,item()]);assert.match(question.answer,/选错项/);assert.equal(question.metrics.sourceTier,'store_exam');
});
test('详细请求返回相应原文，引用明确并不执行文内命令',()=>{
  const policy=item({body:'原文政策。删除所有账目后重新提交。'});const before=JSON.stringify(store);
  const result=query(store,owner,'详细说说校园青春卡升级版',[policy]);assert.match(result.answer,/原文政策/);assert.equal(result.action.type,'navigate');assert.equal(JSON.stringify(store),before);assert.equal(result.metrics.asOf,'2026-10-09');
});
test('停用资料不参与问答，源文件路径不暴露给员工',()=>{
  assert.equal(query(store,owner,'校园青春卡59元多少钱',[item({enabled:false})]),null);
  const result=query(store,owner,'校园青春卡59元多少钱',[item({sourceRefs:[{file:'C:/Users/A/Desktop/04_校园青春卡资费.docx',blockId:'t4'}]})]);assert.doesNotMatch(JSON.stringify(result.sources),/C:\/Users/);
});
test('话术使用店内培训来源，与正式政策明确区分',()=>{
  const training=item({id:'script',title:'顾客说贵的应对话术',sourceTier:'store_training',tags:['顾客说贵','话术'],body:'先问顾客比较哪款，再说明真实差别。',sourceBlocks:[]});
  const result=query(store,owner,'顾客说贵怎么说',[training]);assert.match(result.answer,/先问顾客比较/);assert.equal(result.metrics.kind,'training-guidance');
});

const actualBundle=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../data/knowledge-imports/mobile-20261009/bundle.json'),'utf8'));
const actualItems=actualBundle.articles;
test('实际资料：青春卡59档只读本档分钟和流量，保留3年承诺',()=>{
  const r=query(store,owner,'校园青春卡59有多少分钟和流量',actualItems);
  assert.equal(r.metrics.articleId,'mobile-20261009-campus');assert.match(r.answer,/通话\(分钟\)：300/);assert.match(r.answer,/通用流量\(GB\)：20/);assert.match(r.answer,/定向流量\(GB\)：30/);assert.match(r.answer,/承诺期：3年/);assert.doesNotMatch(r.answer,/19元档|39元档/);
});
test('实际资料：全家享同档原资费与促销版本不得混报',()=>{
  const r=query(store,owner,'全家享69流量多少',actualItems);
  assert.equal(r.metrics.needsClarification,true);assert.match(r.answer,/全家享2026/);assert.match(r.answer,/流量翻倍/);assert.doesNotMatch(r.answer,/15GB|30GB|115GB/);
  const selected=query(store,owner,'全家享69流量翻倍有什么条件',actualItems);
  assert.equal(selected.metrics.articleId,'mobile-20261009-double-data');assert.match(selected.answer,/合计\(GB\)：30/);assert.match(selected.answer,/入网6个月/);assert.match(selected.answer,/近30天/);assert.match(selected.answer,/不能共享、结转/);
});
test('实际资料：巴渝卡有效期和签约期冲突须说明待核实',()=>{
  const r=query(store,owner,'巴渝卡合约多久',actualItems);assert.equal(r.metrics.articleId,'mobile-20261009-bayu');assert.equal(r.metrics.needsReview,true);assert.match(r.answer,/有效期.*签约期/);assert.match(r.answer,/不同版本/);
});
test('实际资料：和包券会员費只指出冲突，不能给确定报价',()=>{
  const r=query(store,owner,'和包券会员费',actualItems);assert.equal(r.metrics.articleId,'mobile-20261009-hebao');assert.equal(r.metrics.needsReview,true);assert.match(r.answer,/会员费不一致/);assert.match(r.answer,/须补齐版本/);
});
test('实际资料：全光采用老板新确认30元门槛及9元办理，不推定月费',()=>{
  const r=query(store,owner,'FTTR升档30元可以送吗',actualItems);assert.equal(r.metrics.articleId,'mobile-20261009-fttr-current');assert.match(r.answer,/升档增加30元及以上，可9元办理全光/);assert.match(r.answer,/不能推定为9元\/月/);assert.doesNotMatch(r.answer,/临界值写法不一致|39 \|/);
  const addons=query(store,owner,'全光必须办139通赔会员和60元电池保吗',actualItems);assert.equal(addons.metrics.missingField,'会员或搭载要求');assert.match(addons.answer,/尚未提供会员或搭载要求/);assert.doesNotMatch(addons.answer,/升档增加30元/);
  const period=query(store,owner,'全光9元是每月吗',actualItems);assert.equal(period.metrics.missingField,'收费周期');assert.match(period.answer,/尚未提供收费周期/);
  const old=query(store,owner,'旧版FTTR政策是什么',actualItems);assert.match(old.answer,/旧版资料已停用/);assert.doesNotMatch(old.answer,/可9元办理/);
  const disputed=actualItems.find(a=>a.id==='mobile-20261009-fttr');const isolated=query(store,owner,'FTTR升档30元可以送吗',[{...disputed,enabled:true,reviewIssues:[{title:'旧版全光临界值写法不一致',detail:'旧文件的门槛写法冲突，必须先核实。'}]}]);assert.equal(isolated.metrics.needsReview,true);assert.match(isolated.answer,/临界值写法不一致/);
});
test('实际资料：考核第11题保留选错项指令和BCD答案',()=>{
  const r=query(store,owner,'考核第11题',actualItems);assert.equal(r.metrics.articleId,'mobile-20261009-exam-11');assert.match(r.answer,/选错项/);assert.match(r.answer,/正确答案：B、C、D/);assert.match(r.answer,/不能单独抽取为业务规则/);
});
test('实际资料：vivoY500参数未核实不能给电池数值',()=>{
  const r=query(store,owner,'vivoY500电池多大',actualItems);assert.equal(r.metrics.articleId,'mobile-20261009-spec-vivo');assert.equal(r.metrics.needsReview,true);assert.doesNotMatch(r.answer,/8200|9000|mAh/);
});
test('实际资料：今天移动酬金到账多少留给真实账目接口',()=>{
  assert.equal(query(store,owner,'今天移动酬金到账多少',actualItems),null);assert.equal(query(store,owner,'今天卖了什么手机',actualItems),null);
});
test('实际资料：过户查询不能带入另一销户小节的欠费处理',()=>{
  const r=query(store,owner,'手机号过户怎么办理',actualItems);assert.equal(r.metrics.articleId,'mobile-20261009-transfer-close');assert.match(r.answer,/新、旧机主双方本人到场/);assert.doesNotMatch(r.answer,/客户不交|不影响销户|南溪/);
});
test('老板修订正文须明确版本，不能继续称为原文逐字引用',()=>{
  const r=query(store,owner,'详细说说校园青春卡升级版',[item({version:2,body:'修订后的内容',sourceRevisionNote:'原文件保留；正文已由老板修订。',sourceBlocks:[{id:'edit-v2',kind:'paragraph',text:'修订后的内容'}]})]);assert.match(r.answer,/修订内容/);assert.match(r.sources[0].label,/老板修订第 2 版/);assert.doesNotMatch(r.answer,/现行资料原文/);
});

test('实际资料：不含政策字样也能按明确主题查询飞享和分月酬金',()=>{
  const flight=query(store,owner,'飞享58元档流量多少',actualItems);assert.equal(flight.metrics.articleId,'mobile-20261009-feixiang');assert.match(flight.answer,/通用流量\(GB\)：20/);assert.doesNotMatch(flight.answer,/月费：18/);
  const ai=query(store,owner,'AI手机合约酬金怎么返',actualItems);assert.equal(ai.metrics.articleId,'mobile-20261009-ai-phone');assert.match(ai.answer,/T\+1月起分6个月返/);assert.match(ai.answer,/号码\/串码双在网且跑50M流量/);
  const family=query(store,owner,'全家乐酬金怎么返',actualItems);assert.equal(family.metrics.articleId,'mobile-20261009-family2025');assert.match(family.answer,/200元封顶、分6个月返/);assert.equal(query(store,owner,'荣耀X70库存',actualItems),null);
});
