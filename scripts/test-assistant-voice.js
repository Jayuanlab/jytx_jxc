const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const timers = require('node:timers/promises');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, hidden: ['result','draft','action','phrase-panel'].includes(id), textContent: '', value: '', disabled: false,
    checked: id === 'auto-voice', children: [], classList: { add() {}, toggle() {} }, setAttribute() {}, style: {},
    replaceChildren() { this.children = []; this.textContent=''; }, append(...children) { this.children.push(...children); },
    focus() {}, scrollIntoView() {}, reset() {},
    elements: { id: { value: '' }, phrase: { value: '', focus() {} }, target: { value: '' } },
  });
  return elements.get(id);
}
const document = { getElementById: element, createElement: () => ({ textContent: '', href: '', target: '', type: '', onclick: null, append() {}, className: '' }), documentElement: { classList: { add() {}, toggle() {} } } };
let lastRequest = '', lastContext = null, lastReplyStyle='', lastMode='', askCount=0;
let deviceVoices=[], spoken=[];
const windowEvents = new Map();
class FakeRecognition {
  static instances = [];
  constructor() { FakeRecognition.instances.push(this); }
  start() { setTimeout(() => this.onstart?.(), 0); }
  stop() { setTimeout(() => this.onend?.(), 0); }
  final(text) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
}
class FakeUtterance { constructor(text) { this.text = text; } }
const synth = { cancel() {}, getVoices() { return deviceVoices; }, speak(utterance) { spoken.push(utterance);setTimeout(() => utterance.onend?.(), 0); } };
const location = { search: '', hash: '', href: '', origin: 'https://store.test' };
const sessionStorage = { values: new Map(), setItem(key, value) { this.values.set(key, value); } };
const localStorage = { values: new Map(), getItem(key) { return this.values.get(key)??null; }, setItem(key, value) { this.values.set(key,value); } };
const window = { localStorage, SpeechRecognition: FakeRecognition, SpeechSynthesisUtterance: FakeUtterance, speechSynthesis: synth, top: null, addEventListener(type, handler) { windowEvents.set(type, handler); } };
window.top = window;
const fetch = async (url, options = {}) => {
  let data = {};
  if (url === '/api/me') data = { id: 'boss', name: '老板', role: '老板', roleCode: 'owner' };
  else if (url === '/api/assistant/attendance') data = { rows: [], privileged: false };
  else if (url === '/api/assistant/reports' || url === '/api/assistant/phrases') data = [];
  else if (url === '/api/assistant/dialogues') data={items:[{id:'qa:test',title:'办卡测试',questions:['买张卡'],answer:'请说需求',version:0,enabled:true,customerVisible:true}]};
  else if (url === '/api/assistant/dialogues/save') data={...JSON.parse(options.body),id:'qa:test',version:1};
  else if (url === '/api/assistant/capabilities') data = { items: [{ id:'inventory',label:'查库存',description:'按品牌查库存',example:'查一下华为手机库存',href:'/app?tab=inventory',mode:'query' }] };
  else if (url === '/api/assistant/ask') {
    const body=JSON.parse(options.body);lastRequest=body.question;lastContext=body.context;lastReplyStyle=body.customerReplyStyle;lastMode=body.mode;askCount++;
    data = { answer: body.question==='顾客副卡过户怎么说'?'接话参考：副卡现在登记在谁的名下？办理前请营业员核对移动 BOSS 的条件。':'已按账套查到库存。', metrics: {kind:(body.question.includes('顾客办卡')||body.question==='顾客副卡过户怎么说')?'customer-talk-guidance':['你好你在干吗','顾客到店','有顾客到','客人来了'].includes(body.question)?'assistant-social':body.question==='我想办张手机卡'?'tariff-recommendations':body.question==='便宜的功能机有哪些'?'product-recommendations':'inventory-query'}, asOf: new Date().toISOString(), scope: '全店授权范围', sources: [], context: { intent:'inventory', brand:'华为' }, followups: [{ label:'详细一点',question:'详细一点' }] };
  }
  return { ok: true, status: 200, async json() { return data; } };
};
const context = vm.createContext({ window, document, location, sessionStorage, fetch, crypto: { randomUUID: () => 'test-id' }, URLSearchParams, SpeechSynthesisUtterance: FakeUtterance, setTimeout: (fn, ms) => setTimeout(fn, ms >= 2800 ? 30 : ms >= 350 ? 5 : ms), clearTimeout, console, confirm: () => true, prompt: () => '' });
vm.runInContext(fs.readFileSync('web/assistant-tariff-export.js','utf8'),context);
vm.runInContext(fs.readFileSync('web/assistant-sale-input.js','utf8'),context);
vm.runInContext(fs.readFileSync('web/assistant.js', 'utf8'), context);
(async () => {
  assert.equal(element('customer-reply-style').value,'sichuan','未保存偏好时默认川渝话');
  element('voice-start').onclick();
  assert.equal(FakeRecognition.instances[0].continuous, true);assert.equal(FakeRecognition.instances[0].lang,'zh-CN','识别仍用标准中文标签');
  FakeRecognition.instances[0].final('你好，');
  FakeRecognition.instances[0].final('查华为手机库存');
  await timers.setTimeout(100);
  assert.match(lastRequest, /你好.*查华为手机库存/);
  assert.ok(FakeRecognition.instances.length >= 2, '回答播报后应继续监听');
  const latest = FakeRecognition.instances.at(-1);
  latest.final('结束对话 ');
  await timers.setTimeout(100);
  assert.match(element('voice-start').textContent, /点这里直接说话/);
  vm.runInContext("saleFlow={stage:'gift',request:'测试',salePrice:1000,customerName:'',customerPhone:''};advanceSale('正品')", context);
  assert.equal(vm.runInContext('saleFlow.stage', context), 'giftName');
  assert.match(element('answer').textContent, /附件是什么/);
  assert.doesNotMatch(element('answer').textContent, /赠品/);
  vm.runInContext("saleFlow={stage:'gift',request:'测试',salePrice:1000,customerName:'',customerPhone:''};advanceSale('没有附件')", context);
  assert.equal(vm.runInContext('saleFlow.stage', context), 'payment');
  assert.equal(vm.runInContext("spokenDigits('幺二三四')", context), '1234');
  vm.runInContext("saleFlow={stage:'review',request:'测试'};draft={skuId:'p1',serialNo:'1234'};ask('去核对')", context);
  assert.equal(location.href, '/app?tab=sales');
  assert.ok(sessionStorage.values.has('assistant-sale-draft'));
  await timers.setTimeout(20);
  await vm.runInContext("ask('查一下华为手机库存')", context);
  await vm.runInContext("ask('详细一点')", context);
  assert.equal(lastRequest,'详细一点');
  assert.equal(lastContext.brand,'华为','连续追问应带上先前查询条件');
  assert.equal(element('followups').children[0].textContent,'详细一点');
  assert.ok(element('capability-list').children.length,'应加载岗位能力目录');
  vm.runInContext("saleFlow={stage:'customerName',request:'卖一台华为手机',product:{skuId:'p1',name:'华为手机'},serialNo:'1234'}", context);
  const saleBefore=vm.runInContext('JSON.stringify(saleFlow)',context);
  await vm.runInContext("ask('查一下华为手机库存')", context);
  assert.equal(vm.runInContext('saleFlow',context),null,'查询应暂停填单');
  assert.equal(vm.runInContext('JSON.stringify(pausedSaleFlow)',context),saleBefore,'查询不能改写顾客姓名或草稿字段');
  assert.equal(element('resume-sale').hidden,false);
  element('resume-sale').onclick();
  assert.equal(vm.runInContext('saleFlow.stage',context),'customerName','继续填单应恢复原步骤');
  assert.match(element('answer').textContent,/顾客姓名/);
  await vm.runInContext("ask('换个话题')",context);
  assert.equal(vm.runInContext('conversationContext',context),null);
  assert.equal(vm.runInContext('saleFlow',context),null);
  assert.equal(vm.runInContext('pausedSaleFlow',context),null);
  element('voice-start').onclick();
  windowEvents.get('message')({origin:'https://other.test',data:{type:'assistant:close'}});
  assert.equal(vm.runInContext('voiceSession',context),true,'其他来源不得控制语音');
  windowEvents.get('message')({origin:location.origin,data:{type:'assistant:close'}});
  assert.equal(vm.runInContext('voiceSession',context),false,'收起浮窗后应停止麦克风');

  const mandarinVoice={name:'普通中文',lang:'zh-CN'},dialectVoice={name:'重庆话 Chongqing',lang:'zh-CN-Sichuan'};deviceVoices=[mandarinVoice,dialectVoice];
  const countBeforeSwitch=askCount;element('customer-reply-style').value='mandarin';element('customer-reply-style').onchange();assert.equal(askCount,countBeforeSwitch,'切换回答方式不自动执行查询');assert.equal(localStorage.values.get('erp-assistant-customer-reply-style-v1'),'mandarin');
  spoken=[];await vm.runInContext("ask('顾客办卡要什么证件')",context);assert.equal(lastReplyStyle,'mandarin');assert.equal(spoken[0].voice,mandarinVoice);
  element('customer-reply-style').value='sichuan';element('customer-reply-style').onchange();assert.equal(localStorage.values.get('erp-assistant-customer-reply-style-v1'),'sichuan');spoken=[];
  await vm.runInContext("ask('顾客办卡怎么说')",context);assert.equal(lastReplyStyle,'sichuan');assert.equal(spoken[0].voice,dialectVoice,'设备有川渝声线时顾客接话优先使用');
  for(const q of ['你好你在干吗','我想办张手机卡','便宜的功能机有哪些','顾客到店','有顾客到','客人来了']){
    vm.runInContext("saleFlow={stage:'customerName',request:'卖一台华为手机',product:{skuId:'p1',name:'华为手机'},serialNo:'1234'}",context);
    const before=vm.runInContext('JSON.stringify(saleFlow)',context);spoken=[];
    await vm.runInContext('ask('+JSON.stringify(q)+')',context);
    assert.equal(vm.runInContext('saleFlow',context),null,q+' 应暂停填单');
    assert.equal(vm.runInContext('JSON.stringify(pausedSaleFlow)',context),before,q+' 不得写成顾客姓名');
    assert.equal(spoken[0].voice,dialectVoice,q+' 使用顾客回答声线');
    element('resume-sale').onclick();assert.equal(vm.runInContext('saleFlow.stage',context),'customerName');
  }
  vm.runInContext("saleFlow={stage:'giftName',request:'卖一台华为手机'}",context);
  await vm.runInContext("ask('你老板是谁')",context);assert.equal(vm.runInContext('pausedSaleFlow.stage',context),'giftName');assert.equal(vm.runInContext('pausedSaleFlow.giftRequested',context),undefined);
  for(const q of ['你是重庆妹儿吗','你是不是云阳妹子','你是不是南溪街上的'])assert.equal(vm.runInContext('isConversationTopic('+JSON.stringify(q)+')',context),true,q+' 应识别新话题');
  vm.runInContext('saleFlow=null;pausedSaleFlow=null',context);
  await vm.runInContext("ask('顾客办卡怎么说')",context);
  element('customer-reply-style').value='mandarin';element('customer-reply-style').onchange();spoken=[];element('read-answer').onclick();assert.equal(spoken[0].voice,dialectVoice,'重听保留上次回答方式，切换只影响下一次提问');
  element('customer-reply-style').value='sichuan';element('customer-reply-style').onchange();spoken=[];await vm.runInContext("ask('查一下华为手机库存')",context);assert.equal(lastReplyStyle,'sichuan');assert.equal(spoken[0].voice,mandarinVoice,'老板查账和库存回答仍用原中文声线');
  deviceVoices=[{name:'English',lang:'en-US'},mandarinVoice];spoken=[];await vm.runInContext("ask('顾客办卡怎么说')",context);assert.equal(spoken[0].voice,mandarinVoice,'设备无川渝声线时回退中文');
  deviceVoices=[];spoken=[];await vm.runInContext("ask('顾客办卡怎么说')",context);assert.equal(spoken[0].voice,undefined);assert.equal(spoken[0].lang,'zh-CN','暂未加载声线仍可用设备中文朗读');
  spoken=[];await vm.runInContext("ask('顾客副卡过户怎么说')",context);await timers.setTimeout(20);
  assert.match(element('answer').textContent,/^接话参考：/,'文字回答仍保留参考标签');
  const customerSpoken='副卡现在登记在谁的名下？办理前请营业员核对移动 BOSS 的条件。';
  assert.equal(spoken.map(x=>x.text).join(''),customerSpoken,'自动播报不朗读参考标签，保留实际回答和条件核对提示');
  spoken=[];element('read-answer').onclick();await timers.setTimeout(20);assert.equal(spoken.map(x=>x.text).join(''),customerSpoken,'重听同样不读参考标签');
  spoken=[];vm.runInContext("readAnswer('接话参考: 19元套餐包含30GB全国流量，请营业员核对资格。')",context);await timers.setTimeout(20);
  assert.equal(spoken.map(x=>x.text).join(''),'19元套餐包含30GB全国流量，请营业员核对资格。','去掉标签不改变价格、流量和核对提示');
  spoken=[];vm.runInContext("readAnswer('这句接话参考需要先核对。')",context);await timers.setTimeout(20);assert.equal(spoken.map(x=>x.text).join(''),'这句接话参考需要先核对。','实际句子中的词语不应误删');
  vm.runInContext("renderEvidence({metrics:{catalog:true,classifications:[{label:'通话多',basis:'按分钟比较',rowIds:['voice']}]},table:{title:'全部资费',columns:[{key:'statusLabel',label:'资料状态'}],rows:[{id:'voice',statusLabel:'现行参考'},{id:'pending',statusLabel:'待核实'}]}})",context);
  assert.equal(element('data-groups').hidden,false);assert.deepEqual(element('data-groups').children.map(row=>row.textContent),['全部资费','通话多']);
  element('data-groups').children[1].onclick();assert.equal(element('data-table').hidden,false);

  await vm.runInContext('loadDialogues()',context);assert.equal(element('dialogue-panel').hidden,false);
  element('dialogue-title').value='办卡测试';element('dialogue-questions').value='买张卡\n办张卡';element('dialogue-answer').value='营业员核对后办理哈。';element('dialogue-mandarin').value='请核对。';element('dialogue-enabled').checked=true;element('dialogue-public').checked=true;
  await element('dialogue-form').onsubmit({preventDefault(){}});assert.match(element('dialogue-status').textContent,/保存成功/);assert.equal(element('dialogue-save').disabled,false);
  vm.runInContext("saleFlow={stage:'payment',request:'测试'};draft={costPrice:88};conversationContext={brand:'华为'}",context);element('answer').textContent='内部毛利信息';
  element('mode-customer').onclick();assert.equal(vm.runInContext('assistantMode',context),'customer');assert.equal(element('answer').textContent,'');assert.equal(vm.runInContext('saleFlow',context),null);assert.equal(vm.runInContext('conversationContext',context),null);assert.equal(element('dialogue-panel').hidden,true);assert.equal(element('report-panel').hidden,true);assert.equal(vm.runInContext('voiceSession',context),false);
  await vm.runInContext("ask('你好')",context);assert.equal(lastMode,'customer');assert.equal(lastContext,null);assert.equal(element('teach-this').hidden,true);
  vm.runInContext('customerLocked=true',context);element('mode-store').onclick();assert.equal(vm.runInContext('assistantMode',context),'customer','接待锁定时不能切回店内');
  vm.runInContext('customerLocked=false',context);element('mode-store').onclick();assert.equal(vm.runInContext('assistantMode',context),'store');assert.equal(element('dialogue-panel').hidden,false);

  const isolated=(storage,throwsOnAccess=false)=>{
    const localNodes=new Map(),get=id=>{if(!localNodes.has(id))localNodes.set(id,{...element(id),value:'',children:[],elements:{id:{value:''},phrase:{value:'',focus(){}},target:{value:''}}});return localNodes.get(id);};
    const localWindow={speechSynthesis:synth,SpeechSynthesisUtterance:FakeUtterance,top:null,addEventListener(){}};localWindow.top=localWindow;
    if(throwsOnAccess)Object.defineProperty(localWindow,'localStorage',{get(){throw Error('storage access denied')}});else localWindow.localStorage=storage;
    const ctx=vm.createContext({window:localWindow,document:{...document,getElementById:get},location:{...location,href:''},sessionStorage,fetch,crypto:{randomUUID:()=> 'test-id'},URLSearchParams,SpeechSynthesisUtterance:FakeUtterance,setTimeout,clearTimeout,console,confirm:()=>true,prompt:()=>''});
    vm.runInContext(fs.readFileSync('web/assistant-tariff-export.js','utf8'),ctx);vm.runInContext(fs.readFileSync('web/assistant-sale-input.js','utf8'),ctx);vm.runInContext(fs.readFileSync('web/assistant.js','utf8'),ctx);return {ctx,get};
  };
  const remembered=isolated({getItem:()=> 'mandarin',setItem(){}});assert.equal(remembered.get('customer-reply-style').value,'mandarin','刷新后恢复已保存选择');
  const invalidStored=isolated({getItem:()=> 'unknown-dialect',setItem(){}});assert.equal(invalidStored.get('customer-reply-style').value,'sichuan');
  const blocked=isolated(null,true);assert.equal(blocked.get('customer-reply-style').value,'sichuan');blocked.get('customer-reply-style').value='mandarin';assert.doesNotThrow(()=>blocked.get('customer-reply-style').onchange());await vm.runInContext("ask('查一下华为手机库存')",blocked.ctx);assert.equal(lastReplyStyle,'mandarin','存储受限时本次选择仍用于提问');
  const writeBlocked=isolated({getItem:()=> null,setItem(){throw Error('quota exceeded')}});writeBlocked.get('customer-reply-style').value='mandarin';assert.doesNotThrow(()=>writeBlocked.get('customer-reply-style').onchange());assert.equal(vm.runInContext('customerReplyStyle',writeBlocked.ctx),'mandarin');
  console.log('voice, query context, draft flow, reply style persistence, blocked storage and dialect voice fallback: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
