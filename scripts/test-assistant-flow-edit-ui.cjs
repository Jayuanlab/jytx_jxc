'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'flow-editor-'));process.env.STORE_SEED_PATH=path.join(temp,'seed.json');
const c=require('../server/src/common'),owner={id:'owner',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
const product={skuId:'h60',name:'华为 Mate 60 128GB',thirdType:'Mate 60',type:'智能手机',subType:'华为',trackSerial:true,active:true,stockManaged:true,warehouseId:'wh-sale',salePrice:2399,costPrice:1800};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff],products:[product],inventory:[],sales:[]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),passed=[],errors=[];let browser;
const output=path.resolve('artifacts/assistant-single-save/flow');fs.mkdirSync(output,{recursive:true});
const business=()=>JSON.stringify(Object.fromEntries(['products','inventory','sales','purchases'].map(key=>[key,repo.readStore()[key]])));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 async function open(user,width=390,url='/assistant?mode=store'){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});context.setDefaultTimeout(10000);
  await context.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+url);await page.waitForLoadState('networkidle');return {context,page};
 }
 async function send(frame,q){
  await frame.locator('#question').fill(q);await frame.locator('#ask .primary').click();
  await frame.waitForFunction(()=>!voiceBusy&&!document.getElementById('result').hidden);
 }
 async function submit(frame,questions,answer){
  await frame.locator('#answer').tap();await frame.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);
  assert.equal(await frame.locator('#answer-edit-save').isEnabled(),true);
  assert.equal(await frame.evaluate(()=>document.activeElement.id),'answer');
  await frame.locator('#question').fill(questions.join(' / '));await frame.locator('#answer').fill(answer);
  assert.equal(await frame.locator('#answer').isEditable(),true);assert.equal(await frame.locator('#answer-edit-public-setting').isVisible(),false);
  let writes=0;const listener=r=>{if(r.method()==='POST'&&r.url().endsWith('/api/assistant/feedback'))writes++};frame.page().on('request',listener);
  await frame.locator('#answer-edit-save').tap();await frame.locator('#answer-edit-status').filter({hasText:'已提交纠错'}).waitFor();frame.page().off('request',listener);assert.equal(writes,1);
  const row=repo.readStore().assistantAnswerFeedback[0];assert.deepEqual(row.suggestedQuestions,questions);assert.equal(row.suggestion,answer);assert.equal(row.correctionOnly,true);assert.equal(row.status,'待审核');return row;
 }
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  for(const user of [owner,staff]){
   const opened=await open(user);try{
    const frame=opened.page.mainFrame();await frame.waitForFunction(()=>me!=null);await frame.locator('#auto-voice').uncheck();
    const q='顾客买了一台手机，帮我开一下单',before=business();await send(frame,q);
    const original=await frame.locator('#answer').inputValue();assert.match(original,/没有找到可售库存/);
    assert.equal(await frame.locator('#edit-answer,#submit-answer,#report-answer').count(),0);assert.equal(await frame.locator('#answer-edit-save').isVisible(),true);assert.equal(await frame.locator('#answer').isEditable(),true);
    assert.equal(await frame.locator('#answer-edit-save').isEnabled(),true);
    await frame.locator('#answer-edit-save').scrollIntoViewIfNeeded();await opened.page.screenshot({path:path.join(output,user.id+'-stock-reply-edit-visible.png')});
    await frame.evaluate(()=>{window.originalQuestion=document.getElementById('question');window.originalAnswer=document.getElementById('answer')});
    const row=await submit(frame,[q,'卖了一台手机，帮我开单'],'请先告诉我手机型号和串号，我帮你核对库存。');
    assert.equal(row.question,q);assert.equal(row.sourceKind,'assistant-sale-flow');assert.equal(row.flowStage,'inventory-check');
    assert.equal(await frame.evaluate(()=>window.originalQuestion===document.getElementById('question')&&window.originalAnswer===document.getElementById('answer')),true);
    assert.equal(await frame.locator('#answer').inputValue(),original);assert.equal(business(),before);
    passed.push(user.name+'：截图中的同一句开单问题直接编辑且只有下方一个提交入口，原两框一次纠错留记录，真实库存和答案不变');
   }finally{await opened.context.close()}
  }
  const review=await open(owner,390,'/knowledge-review#answer-feedback');
  try{
   await review.page.locator('.feedback-item').first().waitFor();const item=review.page.locator('.feedback-item').first();await item.locator('summary').first().click();
   assert.match(await item.innerText(),/请先告诉我手机型号和串号/);assert.match(await item.innerText(),/卖了一台手机，帮我开单/);
   assert.equal(await item.locator('select[name=decision] option[value=apply]').count(),0);await item.locator('[name=note]').fill('已登记，需要核对开单流程');
   await item.locator('button[type=submit]').click();await review.page.locator('#feedback-review-status').filter({hasText:'提交成功'}).waitFor();
   assert.equal(repo.readStore().assistantDialogues.length,0);passed.push('知识审核能同时查看原问题、原答案、修改问法和建议回答；业务纠错可处理，不能覆盖真实数据为固定答案');
  }finally{await review.context.close()}
  // A live-data response retains the same edit / submit entry too.
  const live=await open(owner);try{
   const frame=live.page.mainFrame();await frame.waitForFunction(()=>me!=null);await frame.locator('#auto-voice').uncheck();const before=business();
   await send(frame,'今天营业额多少');assert.equal(await frame.locator('#answer').isEditable(),true);
   await submit(frame,['今天营业额多少','今天销售额多少'],'请核对今天的销售记录与退款，再汇总营业额。');assert.equal(business(),before);
   passed.push('实时销售汇总可原位提纠错，但未核实建议不替换实际营业额');
  }finally{await live.context.close()}
  await repo.transaction(store=>{store.inventory.push({skuId:'h60',warehouseId:'wh-sale',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]})});
  const embedded=await open(owner,320,'/m');
  try{
   await embedded.page.getByRole('button',{name:'打开个人数字助理',exact:true}).tap();const frame=await (await embedded.page.locator('.assistant-float-panel iframe').elementHandle()).contentFrame();await frame.waitForFunction(()=>me!=null);await frame.locator('#auto-voice').uncheck();
   const before=business();await send(frame,'卖出一台华为 Mate60 手机，帮我开单');assert.equal(await frame.evaluate(()=>saleFlow.stage),'serial');
   await frame.locator('#answer').tap();await frame.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);assert.equal(await frame.locator('#answer-edit-save').isEnabled(),true);
   await frame.locator('#answer').fill('请说完整串号或后四位。');await frame.locator('#answer-edit-cancel').tap();assert.equal(await frame.evaluate(()=>saleFlow.stage),'serial');
   await send(frame,'后四位1234');assert.equal(await frame.evaluate(()=>saleFlow.stage),'price');const state=await frame.evaluate(()=>JSON.stringify(saleFlow));
   await submit(frame,['后四位1234','串号最后四位1234'],'串号已找到，请核对本单售价。');
   assert.equal(await frame.evaluate(()=>JSON.stringify(saleFlow)),state);await send(frame,'1999元');assert.equal(await frame.evaluate(()=>saleFlow.salePrice),1999);assert.equal(await frame.evaluate(()=>saleFlow.stage),'customerName');
   assert.equal(business(),before);assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await frame.locator('#answer-edit-save').scrollIntoViewIfNeeded();await embedded.page.screenshot({path:path.join(output,'home-iframe-flow-320.png')});
   passed.push('320px首页悬浮助理在串号、售价、顾客步骤都可直接编辑并通过下方单按钮提交；取消及提交后仍按原开单流程继续，无销售提交或横向溢出');
   await frame.locator('#mode-customer').click(); // Embedded switch navigates top; validate the customer page after navigation.
   await embedded.page.waitForURL(/\/assistant\?mode=customer/);await embedded.page.waitForFunction(()=>me!=null);await embedded.page.locator('#auto-voice').uncheck();
   await send(embedded.page.mainFrame(),'你好');assert.equal(await embedded.page.locator('#edit-answer').count(),0);assert.equal(await embedded.page.locator('#submit-answer').isVisible(),false);
   passed.push('切换顾客模式清除原开单对话，顾客不能编辑且看不到内部纠错提交');
  }finally{await embedded.context.close()}
  assert.deepEqual(errors,[]);const result={passed:passed.length,failed:0,checks:passed,pageErrors:errors,saleWrites:0};fs.writeFileSync(path.join(output,'ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(temp)}
})().catch(error=>{console.error(error);process.exitCode=1});
