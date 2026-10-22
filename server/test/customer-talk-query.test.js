const test=require('node:test');
const assert=require('node:assert/strict');
const {query}=require('../src/customer-talk-query');
const employeeKnowledge=require('../src/employee-knowledge');
const owner={id:'boss',name:'老板',roleCode:'owner'};
const staff={id:'clerk',name:'营业员',roleCode:'salesperson'};
const topics=['principles','start-card','data-shortage','only-data','budget60','budget80','broadband','second-broadband','family150','porting60','e-bike','subsidy','transfer','real-name','guide','quick','unclear'];
const sampleSummary={
  'start-card':'您每个月的预算大约是多少？',
  'data-shortage':'您现在每个月大约需要多少流量？',
  'only-data':'您主要是在手机上用，还是给设备联网？',
  budget60:'您主要看重流量，还是通话也需要？',
  budget80:'这个预算可以再看需求，您每月流量大约要多少？',
  broadband:'您要安装的地址在哪里？先查能不能装。',
  'second-broadband':'老家和现有宽带是同一个办理地区吗？',
  family150:'家里要一起用几个号码？具体套餐先核对。',
  porting60:'现在号码是联通还是电信？先核对能否转网。',
  'e-bike':'您说的是哪一个活动？我先核对领取条件。',
  subsidy:'您准备换哪款手机？国补资格和金额先核对。',
  transfer:'副卡现在登记在谁的名下？先核对过户条件。',
  'real-name':'您要办哪项业务？是否必须本人到场要按实际办理要求核对。',
  principles:'先听顾客需求，再问一个问题，不作未经核实的承诺。',
  guide:'先问用途，再问预算，核对办理条件后推荐。',
  quick:'先问顾客主要想解决什么问题。',
  unclear:'您主要想办卡、装宽带，还是买手机？'
};
function card(topic,extra={}){return {id:'customer-talk-20261009-'+topic,title:'接话卡 '+topic,summary:sampleSummary[topic],body:'原始参考：套餐109元或219元，需要核实。',sourceTier:'store_training',policyStatus:['principles','start-card','guide','quick','unclear','real-name'].includes(topic)?'current':'needs_review',conversationTopic:topic,importBatch:'customer-talk-20261009',sourceFiles:[{name:'顾客口水话应答与推荐卡话术_20261009.docx',sha256:'a'.repeat(64)}],sourceRefs:[{file:'顾客口水话应答与推荐卡话术_20261009.docx',blockId:'p9',label:'第9段'}],sourceBlocks:[{id:'p9',kind:'paragraph',text:'原始参考：套餐109元或219元，需要核实。'}],asOf:'2026-10-09',version:1,tags:['参考话术'],enabled:true,...extra};}
const cards=topics.map(topic=>card(topic));
const fixtureStore={employeeKnowledge:cards,operationLogs:[],sales:[{id:'S1',amount:100}],products:[{id:'P1'}]};
function route(question,topic){const r=query(fixtureStore,staff,question,cards);assert.ok(r,question);assert.equal(r.metrics.articleId,'customer-talk-20261009-'+topic,question);assert.equal(r.metrics.kind,'customer-talk-guidance');assert.match(r.answer,/接话参考/);assert.doesNotMatch(r.answer,/109|219/);return r;}

test('有资料出处的接话只读问答识别常见顾客口语，不报原文争议金额',()=>{
  const cases=[
    ['我办个卡办哪种好','start-card'],['我想办一张卡','start-card'],
    ['流量不够想换一个','data-shortage'],['我只要流量不打电话','only-data'],
    ['我每月预算五六十，办哪个套餐','budget60'],['预算八十块左右','budget80'],
    ['装宽带多少钱','broadband'],['老家还想再装一条宽带','second-broadband'],
    ['我们家两三个人，一百五六左右','family150'],['联通转移动可以吗','porting60'],['电信转移动六十预算','porting60'],
    ['电动车怎么领','e-bike'],['国补以旧换新怎么办','subsidy'],
    ['副卡可以改成自己的名字吗','transfer'],['办卡需要本人到场吗','real-name']
  ];
  for(const [q,topic] of cases)route(q,topic);
});

test('整卡标题可查原则、指南、速查和听不清需求，不要求话术关键词',()=>{
  for(const topic of ['principles','guide','quick','unclear'])route(cards.find(item=>item.conversationTopic===topic).title,topic);
  route('学习顾客口水话应答原则','principles');route('推荐卡话术指南','guide');route('常用接话速查','quick');route('客户说不清需求怎么问','unclear');
});

test('明确政策产品、具体资费表查询继续交政策模块',()=>{
  for(const q of ['巴渝卡59元有多少流量','全家享59流量不够','青春卡资费是什么','携号转网办理流程','移动国补政策是什么','FTTR升档30元能办吗'])assert.equal(query(fixtureStore,staff,q,cards),null,q);
  route('顾客说全家享流量不够，怎么接话','data-shortage');
});

test('真实业务统计、追踪和开单请求不可被接话拦截',()=>{
  for(const q of ['今天手机销量如何','查华为库存','今天移动酬金到账多少','今天办了多少卡','统计今天电信转移动业务','订单里的国补多少钱','单号S1装宽带多少钱','核算毛利后帮顾客推荐卡','帮我开一张销售单','帮我开个单，客户想转网','帮我提交副卡改名申请单','给我审批国补单','现在支付宽带费用','把这个号码改成自己名字并提交','我售出一台华为，帮我开一下单'])assert.equal(query(fixtureStore,owner,q,cards),null,q);
});

test('待核实的安全摘要仍能接话，有状态和办理核对提醒',()=>{
  const r=route('装宽带多少钱','broadband');assert.equal(r.metrics.needsReview,true);assert.equal(r.metrics.summaryOnly,true);assert.match(r.answer,/营业员(?:要先)?核对移动 BOSS/);assert.equal(r.sources[0].id,'customer-talk-20261009-broadband:p9');assert.match(r.sources[0].label,/第9段/);assert.equal(r.action.type,'navigate');
});

test('详细金额要求仍用摘要，只有明确要原文才显示未经核实原文',()=>{
  const detail=query(fixtureStore,staff,'详细说说装宽带多少钱',cards);assert.doesNotMatch(detail.answer,/109|219/);assert.equal(detail.metrics.originalRequested,undefined);
  const original=query(fixtureStore,staff,'查看装宽带的原文',cards);assert.match(original.answer,/待核实或非现行资料原文/);assert.match(original.answer,/109元或219元/);assert.match(original.answer,/不可作为办理承诺/);assert.equal(original.metrics.originalRequested,true);
});

test('正文修订后不得继续旧摘要与旧话题自动接话',()=>{
  const store={employeeKnowledge:[card('broadband')],operationLogs:[]};
  employeeKnowledge.save(store,owner,{id:store.employeeKnowledge[0].id,version:1,title:'已改为售后事项',category:'资料',summary:'错误旧摘要109元',body:'改为售后资料，原宽带政策作废',tags:['售后'],policyStatus:'current',enabled:true});
  const r=query(store,staff,'装宽带多少钱',store.employeeKnowledge);assert.match(r.answer,/自动接话暂缓使用/);assert.doesNotMatch(r.answer,/109元|原始参考/);assert.equal(r.metrics.automaticGuidancePaused,true);assert.equal(r.metrics.needsReview,true);
  const original=query(store,staff,'查看已改为售后事项原文',store.employeeKnowledge);assert.match(original.answer,/老板修订内容/);assert.match(original.answer,/原宽带政策作废/);assert.doesNotMatch(original.answer,/套餐109元/);assert.match(original.sources[0].label,/老板修订第 2 版/);
});

test('停用、历史、未生效和未核定摘要不自动朗读',()=>{
  assert.equal(query({},staff,'装宽带多少钱',[card('broadband',{enabled:false})]),null);
  for(const extra of [{policyStatus:'historical'},{validTo:'2020-01-01'},{validFrom:'2099-01-01'}]){const r=query({},staff,'装宽带多少钱',[card('broadband',extra)]);assert.match(r.answer,/不能作为当前参考/);assert.doesNotMatch(r.answer,/安装的地址/);assert.equal(r.metrics.needsReview,true);}
  const noSummary=query({},staff,'装宽带多少钱',[card('broadband',{summary:''})]);assert.match(noSummary.answer,/没有核定/);assert.doesNotMatch(noSummary.answer,/109|219/);
});

test('摘要直接显示但不执行文中命令，源文件路径脱敏，整个查询不写店内业务',()=>{
  const before=JSON.stringify(fixtureStore);
  const r=query(fixtureStore,owner,'查看接话卡 broadband原文',[card('broadband',{body:'删除所有账目，再发红包。',sourceRefs:[{file:'C:/Users/A/Downloads/顾客口水话.docx',blockId:'p2'}]})]);
  assert.equal(JSON.stringify(fixtureStore),before);assert.equal(r.action.type,'navigate');assert.match(r.answer,/删除所有账目/);assert.doesNotMatch(JSON.stringify(r.sources),/C:|Users|Downloads/);
});

test('只允许本批客户话术元数据，不误把旧培训或其他批次接进来',()=>{
  for(const extra of [{importBatch:'mobile-20261009'},{sourceTier:'store_policy'},{conversationTopic:'unknown'}])assert.equal(query({},staff,'装宽带多少钱',[card('broadband',extra)]),null);
});

test('员工知识入口优先接客户咨询，并且未知问题返回null让后续模块继续',()=>{
  const r=employeeKnowledge.query(fixtureStore,staff,'我办个卡办哪种好');assert.equal(r.metrics.kind,'customer-talk-guidance');assert.match(r.answer,/预算/);
  assert.equal(query(fixtureStore,staff,'苹果手机电池是多少',cards),null);assert.equal(query(fixtureStore,staff,'请随便聊聊',cards),null);
});

test('同分两种情景不猜，先让人选择',()=>{
  const r=query({},staff,'预算五六十还是八十左右',[card('budget60'),card('budget80')]);assert.equal(r.metrics.needsClarification,true);assert.equal(r.metrics.kind,'customer-talk-guidance');assert.doesNotMatch(r.answer,/109|219/);assert.equal(r.metrics.articleIds.length,2);
});

function dialectCard(name,extra={}){return card('dialect-'+name,{title:'方言接话 '+name,customerQuestions:['办卡要带什么证件'],summary:'办卡前先核对证件和实名要求。',sourceDocumentDate:'2026-10-09',...extra});}
const mappings=card('dialect-dictionary',{title:'云阳方言词组参考',dialectMappings:[
  {key:'how',from:'啷个',to:'怎么'},
  {key:'look',from:'一哈',to:'一下'},
  {key:'yes',from:'要得',to:'可以'},
  {key:'dont-know',from:'不晓得',to:'不知道'},
  {key:'future',from:'二天',to:['以后','下次'],requiresContext:true},
  {key:'many',from:'嘎嘎',to:['很多','非常'],requiresContext:true},
  {key:'bad-negation',from:'没有',to:'有'},
  {key:'bad-number',from:'59元',to:'60元'},
  {key:'bad-business',from:'新办卡',to:'补卡'}
]});

test('新文章的customerQuestions精确匹配优先通用场景，语气词标点可略但不删意思',()=>{
  const precise=dialectCard('exact',{customerQuestions:['我办个卡办哪种好'],summary:'先了解您是否还需要宽带。'});
  const r=query({},staff,'你好，请问，我办个卡办哪种好呢？',[...cards,precise]);assert.equal(r.metrics.articleId,precise.id);assert.match(r.answer,/是否还需要宽带/);
  assert.equal(query({},staff,'我不办个卡办哪种好',[precise]),null);
});

test('相同规范问句选来源日期更新的文章，同日不同答法需选择',()=>{
  const older=dialectCard('old',{sourceDocumentDate:'2026-10-08',summary:'旧接话摘要'}),newer=dialectCard('new',{sourceDocumentDate:'2026-10-09',summary:'最新接话摘要'});
  const r=query({},staff,'办卡要带什么证件',[older,newer]);assert.equal(r.metrics.articleId,newer.id);assert.match(r.answer,/最新接话摘要/);assert.doesNotMatch(r.answer,/旧接话摘要/);
  const conflict=query({},staff,'办卡要带什么证件',[{...older,sourceDocumentDate:'2026-10-09'},newer]);assert.equal(conflict.metrics.needsClarification,true);assert.equal(conflict.metrics.articleIds.length,2);
});

test('有限有出处方言替换只用于本模块匹配，不修改账套问题或ASR配置',()=>{
  const questionCard=dialectCard('how',{customerQuestions:['这个卡怎么开通'],summary:'先确认您要新办还是启用已有号码。'});
  const original=JSON.stringify([questionCard,mappings]);const r=query({},staff,'这个卡啷个开通',[questionCard,mappings]);assert.equal(r.metrics.articleId,questionCard.id);assert.equal(JSON.stringify([questionCard,mappings]),original);
  assert.equal(query({},staff,'啷个查华为库存',[questionCard,mappings]),null);
  assert.equal(query({},staff,'二天移动酬金到账多少',[questionCard,mappings]),null);
});

test('方言教学引用资料，对多义二天保留上下文，不翻译成后天或两天',()=>{
  const r=query({},staff,'二天是什么意思',[mappings]);assert.match(r.answer,/以后 \/ 下次/);assert.match(r.answer,/结合上下文/);assert.doesNotMatch(r.answer,/后天|两天|昨天|官方/);assert.equal(r.metrics.needsContext,true);assert.equal(r.metrics.dialectTeaching,true);
  const normal=query({},staff,'啷个普通话怎么说',[mappings]);assert.match(normal.answer,/啷个：怎么/);assert.match(normal.answer,/未作权威语言核验/);assert.ok(normal.sources[0].href.endsWith(mappings.id));
});

test('有危险差异或多义的词组不能用于自动问题匹配',()=>{
  const examples=[
    [dialectCard('neg',{customerQuestions:['有身份证可以办卡吗']}),'没有身份证可以办卡吗'],
    [dialectCard('number',{customerQuestions:['60元套餐有多少流量']}),'59元套餐有多少流量'],
    [dialectCard('new',{customerQuestions:['补卡要带什么证件']}),'新办卡要带什么证件'],
    [dialectCard('tomorrow',{customerQuestions:['以后还能来办卡吗']}),'二天还能来办卡吗']
  ];
  for(const [item,q] of examples)assert.equal(query({},staff,q,[item,mappings]),null,q);
});

test('关键词AND组每组至少命中一词，未覆盖的否定和数值不误选',()=>{
  const positive=dialectCard('proof',{customerQuestions:['办卡要带什么证件'],matchKeywords:[['证件','身份证','户口本'],['办卡','开卡']],summary:'请先核对身份证明。'});
  const r=query({},staff,'开卡用什么身份证',[positive]);assert.equal(r.metrics.articleId,positive.id);
  assert.equal(query({},staff,'身份证多少钱',[positive]),null);assert.equal(query({},staff,'办卡怎么弄',[positive]),null);
  assert.equal(query({},staff,'没有身份证可以开卡吗',[positive]),null);assert.equal(query({},staff,'两个人开卡要什么证件',[positive]),null);
  const negativeCard=dialectCard('no-proof',{customerQuestions:['没有身份证可以办卡吗'],matchKeywords:[['身份证','证件'],['办卡','开卡']],summary:'没有证件先由营业员核对办理要求。'});
  const neg=query({},staff,'开卡但身份证没带，可以吗',[positive,negativeCard]);assert.equal(neg.metrics.articleId,negativeCard.id);
});

test('关键词选择保留新办补卡区别，不把新开户问题指向补卡',()=>{
  const replacement=dialectCard('replacement',{customerQuestions:['补卡要什么证件'],matchKeywords:[['卡'],['身份证','证件']]});
  assert.equal(query({},staff,'新办卡用什么证件',[replacement]),null);
  const replace=query({},staff,'补卡需要身份证吗',[replacement]);assert.equal(replace.metrics.articleId,replacement.id,'补卡证件组合可以命中；新办意图不得混用');
});

test('多个不同意图的同层关键词候选须追问，日期较新不覆盖另一意图',()=>{
  const a=dialectCard('proof',{sourceDocumentDate:'2026-10-08',matchKeywords:[['身份证','证件'],['办卡','开卡']],customerQuestions:['办卡证件有哪些'],summary:'证件问答'});
  const b=dialectCard('real-name',{sourceDocumentDate:'2026-10-09',matchKeywords:[['身份证','证件'],['办卡','开卡']],customerQuestions:['身份证办卡实名要求是什么'],summary:'实名问答'});
  const r=query({},staff,'开卡用身份证怎么弄',[a,b]);assert.equal(r.metrics.needsClarification,true);assert.equal(r.metrics.articleIds.length,2);
});

test('老板仅修改summary或完整句tags可用新值，正文修订不会继续沿用旧映射',()=>{
  const store={employeeKnowledge:[dialectCard('edit')],operationLogs:[]},item=store.employeeKnowledge[0];
  employeeKnowledge.save(store,owner,{...item,category:'资料',summary:'老板更新：先核对证件，不承诺可办理。',tags:['我来办卡需要带身份证吗']});
  const r=query(store,staff,'我来办卡需要带身份证吗',store.employeeKnowledge);assert.match(r.answer,/老板更新/);assert.equal(r.metrics.automaticGuidancePaused,undefined);
  const mapEdited={...mappings,sourceRevisionNote:'老板改正文',body:'当前修订正文：二天的含义待补充。'};
  const taught=query({},staff,'二天是什么意思',[mapEdited]);assert.match(taught.answer,/资料已修订/);assert.doesNotMatch(taught.answer,/以后 \/ 下次/);
});

test('实际17卡标题和顾客口语全部可查，不朗读争议金额',()=>{
  const actual=require('../../data/knowledge-imports/customer-talk-20261009/bundle.json').articles.filter(item=>topics.includes(item.conversationTopic));
  assert.equal(actual.length,17);
  for(const item of actual){const r=query({},staff,item.title,actual);assert.equal(r.metrics.articleId,item.id,item.title);assert.equal(r.metrics.summaryOnly,true);}
  const cases=[['我办个卡办哪种好','start-card'],['流量不够想换','data-shortage'],['我预算五六十办什么卡','budget60'],['预算八十块','budget80'],['装宽带多少钱','broadband'],['老家再装一条宽带','second-broadband'],['全家两三个人每月一百五六','family150'],['电信转移动','porting60'],['电动车怎么领','e-bike'],['国补以旧换新','subsidy'],['副卡改自己名字','transfer'],['办卡本人到场吗','real-name']];
  for(const [q,topic] of cases){const r=query({},staff,q,actual);assert.equal(r.metrics.articleId,'customer-talk-20261009-'+topic,q);assert.doesNotMatch(r.answer,/129|149|159|219|139|最低0元|赠送电动车/);}
});

test('词组含正则符号仍按字面匹配，不生成可执行表达式',()=>{
  const dictionary={...mappings,dialectMappings:[{from:'卡+A[甲]',to:'普通卡'}]};
  const item=dialectCard('special',{customerQuestions:['这个普通卡怎么开通']});
  const r=query({},staff,'这个卡+A[甲]怎么开通',[dictionary,item]);assert.equal(r.metrics.articleId,item.id);
  assert.equal(query({},staff,'这个卡AAAA甲怎么开通',[dictionary,item]),null);
});

test('顾客回复默认川渝口语，可选择普通话，实际原文不改写',()=>{
  const item=dialectCard('style',{summary:'您想怎么办理？59元只是您的预算，不是核定资费。',summaryDialect:'你想啷个办嘛？59元只是你的预算，不是核定资费。'});
  const dialect=query({},staff,'办卡要带什么证件',[item]);assert.match(dialect.answer,/你想啷个办嘛/);assert.equal(dialect.metrics.replyStyle,'sichuan');assert.match(dialect.answer,/59元/);
  const mandarin=query({},staff,'办卡要带什么证件',[item],{customerReplyStyle:'mandarin'});assert.match(mandarin.answer,/您想怎么办理/);assert.doesNotMatch(mandarin.answer,/啷个/);assert.equal(mandarin.metrics.replyStyle,'mandarin');
  const raw=query({},staff,'查看方言接话 style原文',[item]);assert.ok(raw.answer.endsWith(item.body));assert.doesNotMatch(raw.answer,/你想啷个/);
});

test('老板改summary后不沿用旧方言摘要，方言缓存数字或否定不一致也不沿用',()=>{
  const item=dialectCard('style-edit',{editedAfterImport:true,summary:'老板新答复：您需要什么证件？',summaryDialect:'旧方言：59元办得好。'});
  const r=query({},staff,'办卡要带什么证件',[item]);assert.match(r.answer,/老板新答复：你需要啥子证件/);assert.doesNotMatch(r.answer,/旧方言|59元/);
  const wrongNumbers=dialectCard('style-number',{summary:'您这个预算是59元，不是确定资费。',summaryDialect:'你这个预算是60元，不是确定资费。'});
  const fallback=query({},staff,'办卡要带什么证件',[wrongNumbers]);assert.match(fallback.answer,/59元/);assert.doesNotMatch(fallback.answer,/60元/);
});

test('政策返话费开始月份可以用话术，实际到账查询仍留真实账目模块',()=>{
  const item=dialectCard('rebate',{customerQuestions:['返话费什么时候到账'],matchKeywords:[['返话费','返费'],['什么时候','到账','哪个月']],summary:'返费起始月份和次数要核对活动规则。'});
  const r=query({},staff,'返话费什么时候到账',[item]);assert.equal(r.metrics.articleId,item.id);assert.match(r.answer,/活动规则/);
  const keywords=query({},staff,'政策里的返费哪个月到账',[item]);assert.equal(keywords.metrics.articleId,item.id);
  for(const q of ['今天移动酬金到账多少','本月返话费到账多少','返话费实际到账多少','老板返话费到账多少','今天返话费到账多少'])assert.equal(query({},staff,q,[item]),null,q);
});

test('本批156组、270条原始顾客问句完整命中，含方言词的业务疑问不被误当字典教学',()=>{
  const actual=require('../../data/knowledge-imports/customer-talk-20261009/bundle.json').articles;
  const rows=actual.filter(item=>/^dialect-\d+-\d+$/.test(item.conversationTopic));
  assert.equal(rows.length,156);
  for(const item of rows)for(const question of item.customerQuestions){const r=query({},staff,question,actual);assert.equal(r?.metrics.articleId,item.id,question);assert.equal(r.metrics.summaryOnly,true);assert.equal(r.metrics.dialectTeaching,undefined);}
  const emergency=query({},staff,'我手机被偷了，卡也在里面，怎么办？',actual);assert.match(emergency.answer,/先联系运营商挂失/);assert.match(emergency.answer,/不能保证微信/);assert.doesNotMatch(emergency.answer,/别个用不到你的话费、微信钱/);
});

test('整批175卡完整标题都能查，宽带覆盖不误当覆盖账目操作',()=>{
  const actual=require('../../data/knowledge-imports/customer-talk-20261009/bundle.json').articles;
  assert.equal(actual.length,175);
  for(const item of actual){const r=query({},staff,item.title,actual);assert.equal(r?.metrics.articleId,item.id,item.title);assert.equal(r.metrics.originalRequested,undefined,item.title);}
  assert.equal(query({},staff,'帮我覆盖全部账目',actual),null);
});


test('实际方言答复保留可选语气和词语边界，避免价格核查与不需要被改错',()=>{
  const actual=require('../../data/knowledge-imports/customer-talk-20261009/bundle.json').articles;
  const find=topic=>actual.find(item=>item.conversationTopic===topic);
  assert.match(find('dialect-10-1').summaryDialect,/先核实际价格/);
  for(const topic of ['dialect-5-13','dialect-10-13'])assert.match(find(topic).summaryDialect,/不需要/);
  assert.match(find('dialect-8-5').summaryDialect,/最需要/);
  assert.match(find('dialect-9-16').summaryDialect,/有需要/);
  for(const item of actual)assert.doesNotMatch(item.summaryDialect,/吗嘛|嘛嘛|核清楚际|不要可以|有要可|最要学/);
});
