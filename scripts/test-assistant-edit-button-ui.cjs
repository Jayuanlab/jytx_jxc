'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),Module=require('node:module');
const load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'paired-editor-'));process.env.STORE_SEED_PATH=path.join(temp,'seed.json');
const c=require('../server/src/common'),owner={id:'owner',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active',permissions:['sale:create']},guest={id:'guest',name:'顾客接待',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff,guest]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),passed=[],errors=[];let browser;
const output=path.resolve('artifacts/assistant-single-save');fs.mkdirSync(output,{recursive:true});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 async function open(user,width=390,url='/assistant'){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});context.setDefaultTimeout(10000);
  await context.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+url);await page.waitForLoadState('networkidle');
  if(url==='/assistant'){await page.waitForFunction(()=>me!=null);await page.locator('#auto-voice').uncheck()}
  return {context,page};
 }
 async function ask(frame,q){
  await frame.locator('#question').fill(q);
  const data=await frame.evaluate(async()=>{
   const next=new Promise(resolve=>{const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0])==='/api/assistant/ask'){window.fetch=original;resolve(await r.clone().json())}return r}});
   document.querySelector('#ask .primary').click();return next;
  });
  await frame.waitForFunction(answer=>document.getElementById('answer').value===answer,data.answer);return data;
 }
 async function save(frame,context,endpoint='/api/assistant/dialogues/save'){
  const request=frame.page().waitForRequest(r=>r.url().endsWith(endpoint)&&r.method()==='POST');
  await frame.locator('#answer-edit-save').click();const req=await request;
  await frame.locator('#answer-edit-status').filter({hasText:endpoint.endsWith('/save')?'保存成功':'已提交审核'}).waitFor();return req.postDataJSON();
 }
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const boss=await open(owner);
  try{
   const frame=boss.page.mainFrame(),question='你好，请问陈文琼在不在',questions=[question,'我找陈文琼','陈文琼在不在'],answers=['请稍等，我帮你问一下。','你好，你找他有什么事？'];
   await ask(frame,question);
   await frame.evaluate(()=>{window.originalQuestion=document.getElementById('question');window.originalAnswer=document.getElementById('answer')});
   assert.equal(await frame.locator('#edit-answer,#submit-answer,#report-answer').count(),0);
   assert.equal(await frame.locator('#answer-edit-save').isVisible(),true);
   assert.equal(await frame.locator('#answer-edit-save').innerText(),'保存回答');
   assert.equal(await frame.locator('#answer').isEditable(),true);
   let release,requested;const gate=new Promise(resolve=>release=resolve),received=new Promise(resolve=>requested=resolve);
   const delayed=async route=>{requested();await gate;await route.continue()};await boss.page.route('**/api/assistant/dialogues',delayed);
   await frame.locator('#answer').tap();await received;
   assert.equal(await frame.evaluate(()=>document.activeElement.id),'answer');assert.equal(await frame.locator('#answer').isEditable(),true);
   await frame.locator('#answer').fill(answers.join(' / '));await frame.locator('#question').fill(questions.join(' / '));release();
   await frame.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);await boss.page.unroute('**/api/assistant/dialogues',delayed);
   assert.equal(await frame.locator('#answer').inputValue(),answers.join(' / '));assert.equal(await frame.locator('#question').inputValue(),questions.join(' / '));
   assert.equal(await frame.evaluate(()=>window.originalQuestion===document.getElementById('question')&&window.originalAnswer===document.getElementById('answer')),true);
   assert.equal(await frame.locator('#result [role=dialog]').count(),0);assert.equal(await frame.locator('#answer-edit-text').count(),0);
   await frame.locator('#answer').scrollIntoViewIfNeeded();await boss.page.screenshot({path:path.join(output,'owner-single-save-original-fields.png')});
   const writes=[];boss.page.on('request',r=>{if(r.url().endsWith('/api/assistant/dialogues/save')&&r.method()==='POST')writes.push(r.postDataJSON())});
   await frame.locator('#ask .primary').click();
   await frame.locator('#answer-edit-status').filter({hasText:'回答下面'}).waitFor();
   assert.equal(writes.length,0);assert.equal(await frame.locator('#ask .primary').innerText(),'↑');
   const saved=await save(frame,boss.context);assert.equal(writes.length,1);assert.deepEqual(saved.questions,questions);assert.equal(saved.answerMandarin,answers.join(' / '));
   for(const q of questions){await ask(frame,q);assert.ok(answers.includes(await frame.locator('#answer').inputValue()))}
   passed.push('390px手机直接编辑原回答；只有下方一个保存入口，慢网络输入保留，原问答两个节点未替换');
   passed.push('一次保存同时发送问法和答法，三种问法下次均识别，回复仅任选一句');
   await ask(frame,'今天营业额多少');assert.equal(await frame.locator('#answer').isEditable(),true);assert.equal(await frame.locator('#answer-edit-save').innerText(),'提交纠错');
  }finally{await boss.context.close()}
  const worker=await open(staff);
  const staffQuestion='请问林老师到店了吗',staffQuestions=[staffQuestion,'我想找林老师','林老师在这里吗'],staffAnswers=['稍等，我帮你问一下。','好的，你稍坐一下。'];let submittedId;
  try{
   const frame=worker.page.mainFrame(),original=await ask(frame,staffQuestion);assert.equal(await frame.locator('#answer').isEditable(),true);assert.equal(await frame.locator('#answer-edit-save').isVisible(),true);
   await frame.locator('#answer').tap();await frame.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);
   assert.equal(await frame.locator('#answer-edit-save').innerText(),'提交审核');assert.equal(await frame.locator('#answer-edit-public-setting').isVisible(),false);
   await frame.locator('#question').fill(staffQuestions.join(' / '));await frame.locator('#answer').fill(staffAnswers.join(' / '));
   const staffWrites=[];worker.page.on('request',r=>{if(r.method()==='POST'&&/\/api\/assistant\/(?:feedback|dialogues\/save)$/.test(r.url()))staffWrites.push(r)});
   // A failed submit must preserve the linked draft for retry.
   const fail=async route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'测试服务暂不可用'}})});
   await worker.page.route('**/api/assistant/feedback',fail);await frame.locator('#answer-edit-save').click();await frame.locator('#answer-edit-status').filter({hasText:'失败'}).waitFor();
   assert.equal(await frame.locator('#question').inputValue(),staffQuestions.join(' / '));assert.equal(await frame.locator('#answer').inputValue(),staffAnswers.join(' / '));
   await worker.page.unroute('**/api/assistant/feedback',fail);staffWrites.length=0;
   const payload=await save(frame,worker.context,'/api/assistant/feedback');assert.equal(staffWrites.length,1);assert.deepEqual(payload.suggestedQuestions,staffQuestions);assert.equal(payload.suggestionMandarin,staffAnswers.join(' / '));assert.equal(payload.pairEdit,true);
   const row=repo.readStore().assistantAnswerFeedback[0];submittedId=row.id;assert.equal(row.status,'待审核');assert.deepEqual(row.suggestedQuestions,staffQuestions);assert.equal(repo.readStore().assistantDialogues.length,1);
   assert.equal(await frame.locator('#answer').inputValue(),original.answer);assert.equal((await ask(frame,staffQuestions[1])).unresolved,true);
   const denied=await worker.context.request.post(origin+'/api/assistant/dialogues/save',{headers:{'Idempotency-Key':randomUUID()},data:{title:'非法',questions:['非法'],answer:'非法',version:0,enabled:true,customerVisible:false}});assert.equal(denied.status(),403);
   passed.push('员工在原两个框修改，一次提交一条关联审核记录；提交失败保留两框，未审核仍用原答案');
   const reviewer=await open(owner,390,'/knowledge-review#answer-feedback');
   try{
    const row=reviewer.page.locator('.feedback-item[data-id="'+submittedId+'"]');await row.waitFor();await row.locator('summary').first().click();const form=row.locator('form');
    assert.equal(await form.locator('[name=questions]').inputValue(),staffQuestions.join(' / '));assert.equal(await form.locator('[name=answerMandarin]').inputValue(),staffAnswers.join(' / '));
    const finalAnswers=['我帮你问一下，请稍等。','你稍坐，我去帮你找。'];await form.locator('[name=answer]').fill(finalAnswers.join(' / '));await form.locator('details').evaluate(el=>el.open=true);await form.locator('[name=answerMandarin]').fill(finalAnswers.join(' / '));
    await form.locator('[name=note]').fill('问和答已一起核对');let reviews=0;reviewer.page.on('request',r=>{if(r.url().endsWith('/api/assistant/feedback/review')&&r.method()==='POST')reviews++});
    await form.locator('button[type=submit]').click();await reviewer.page.locator('#feedback-review-status').filter({hasText:'提交成功'}).waitFor();assert.equal(reviews,1);
    assert.equal(repo.readStore().assistantAnswerFeedback[0].status,'已生效');const effective=repo.readStore().assistantDialogues.find(x=>x.questions.includes(staffQuestions[1]));assert.deepEqual(effective.questions,staffQuestions);
    for(const q of staffQuestions){const data=await ask(frame,q);assert.ok(finalAnswers.includes(data.answer))}
    passed.push('老板在知识审核同时核对两框，一次确认全部问法与答法生效，员工随后识别每种问法');
   }finally{await reviewer.context.close()}
  }finally{await worker.context.close()}
  for(const width of [390,320]){
   const embedded=await open(owner,width,'/m');
   try{
    await embedded.page.getByRole('button',{name:'打开个人数字助理',exact:true}).tap();const element=embedded.page.locator('.assistant-float-panel iframe');await element.waitFor();const frame=await (await element.elementHandle()).contentFrame();await frame.waitForFunction(()=>me!=null);await frame.locator('#auto-voice').uncheck();
    const initial='请问小林在不在'+width;await ask(frame,initial);await frame.locator('#answer').tap();await frame.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);
    assert.equal(await frame.evaluate(()=>document.activeElement.id),'answer');assert.equal(await frame.locator('#answer').isEditable(),true);
    await frame.locator('#question').fill(initial+' / 我找小林'+width);await frame.locator('#answer').fill('请稍等，我帮你问一下。');
    await save(frame,embedded.context);await ask(frame,'我找小林'+width);assert.equal(await frame.locator('#answer').inputValue(),'请稍等，我帮你问一下。');
    assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await embedded.page.screenshot({path:path.join(output,'actual-home-iframe-'+width+'.png')});
   }finally{await embedded.context.close()}
  }
  passed.push('从首页实际悬浮窗口打开助理，在390px与320px原iframe中编辑、关联保存和重新识别，无横向溢出');
  const kiosk=await open(guest);try{
   const response=await kiosk.context.request.get(origin+'/api/assistant/feedback?draft=1&question=你好');assert.equal(response.status(),403);
   await kiosk.page.waitForFunction(()=>me!=null);await ask(kiosk.page.mainFrame(),'你好');assert.equal(await kiosk.page.locator('#answer-edit-save').isVisible(),false);assert.equal(await kiosk.page.locator('#answer').isEditable(),false);
  }finally{await kiosk.context.close()}
  passed.push('员工不能自行生效，顾客账号不能进入编辑或审核；真实财务建议只交核对，顾客回答仍只读');
  assert.deepEqual(errors,[]);assert.equal(repo.readStore().sales.length,0);assert.equal(repo.readStore().purchases.length,0);
  const result={passed:passed.length,failed:0,checks:passed,pageErrors:errors,financialWrites:0};fs.writeFileSync(path.join(output,'ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(temp)}
})().catch(error=>{console.error(error);process.exitCode=1});
