'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),Module=require('node:module');
const load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'question-ways-'));process.env.STORE_SEED_PATH=path.join(temp,'seed.json');
const c=require('../server/src/common'),owner={id:'owner',name:'测试老板',role:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer();
const output=path.resolve('artifacts/assistant-question-ways');fs.mkdirSync(output,{recursive:true});let browser;const passed=[],errors=[];
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 async function open(user,width=390){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<700,hasTouch:width<700});context.setDefaultTimeout(10000);
  await context.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/assistant');await page.waitForFunction(()=>me!=null);await page.waitForLoadState('networkidle');await page.locator('#auto-voice').uncheck();return {context,page};
 }
 async function ask(page,q){await page.locator('#question').fill(q);const wait=page.waitForResponse(r=>r.url().endsWith('/api/assistant/ask')&&r.request().method()==='POST');await page.locator('#ask .primary').click();const res=await wait;assert.equal(res.status(),200);const data=await res.json();await page.waitForFunction(value=>document.getElementById('answer').value===value,data.answer);return data}
 async function post(context,url,body){const res=await context.request.post(origin+url,{headers:{'Idempotency-Key':randomUUID()},data:body});return {status:res.status(),data:await res.json()}}
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const session=await open(owner),{context,page}=session;const queries=[];page.on('request',req=>{if(req.url().endsWith('/api/assistant/ask')&&req.method()==='POST')queries.push(req.postDataJSON().question)});
  try{
   const questions=['你好，我想找一下陈文琼','陈文琼在不在','你们这里有一个叫陈文琼的吗','我找陈文琼'],answers=['请稍等，我帮你问一下。','你好，你找他有什么事？','稍等，我帮你确认一下。'];
   await ask(page,questions[0]);const count=queries.length;
   await page.locator('#question').fill(questions.join('/'));await page.locator('#answer-edit-save').waitFor();assert.equal(await page.locator('#question').inputValue(),questions.join('/'));assert.equal(await page.locator('#ask .primary').textContent(),'✓');assert.equal(queries.length,count);
   await page.locator('#ask .primary').click();await page.locator('#answer-edit-status').filter({hasText:'先填写正确回答'}).waitFor();assert.equal(repo.readStore().assistantDialogues.length,0);
   await page.locator('#answer').fill(answers.join(' / '));await page.locator('#question').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'paired-question-answer-edit-mobile.png')});
   await page.locator('#ask .primary').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();
   const row=repo.readStore().assistantDialogues[0];assert.deepEqual(row.questions,questions);assert.equal(row.answer,answers.join(' / '));assert.equal(row.answer,row.answerMandarin);assert.equal(row.title,questions[0]);assert.ok(answers.includes(await page.locator('#answer').inputValue()));assert.equal(await page.locator('#ask .primary').textContent(),'↑');
   passed.push('用户截图的四种问法在原问题框编辑，三种答法在原回答位置保存；发送键不会查询整段同义词');
   passed.push('未改正确答案时阻止保存通用兜底回答');
   for(const q of questions){const result=await ask(page,q);assert.equal(result.metrics.dialogueId,row.id);assert.ok(answers.includes(result.answer));assert.ok(!result.answer.includes('/'))}
   passed.push('每一种问法均能识别，每次只回答一种答法');
   await page.reload();await page.waitForFunction(()=>me!=null);await page.locator('#auto-voice').uncheck();await ask(page,questions[3]);await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();
   assert.equal(await page.locator('#question').inputValue(),questions.join(' / '));assert.equal(await page.locator('#answer').inputValue(),answers.join(' / '));
   const revised=['陈文琼在不在','陈文琼来了没有'];await page.locator('#question').fill(revised.join(' ／ '));await page.locator('#answer').fill('我帮你问一下。 / 稍等一会儿。');
   await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();assert.deepEqual(repo.readStore().assistantDialogues[0].questions,revised);assert.equal(repo.readStore().assistantDialogues[0].history.length,1);
   await ask(page,'陈文琼来了没有');assert.equal((await ask(page,questions[0])).unresolved,true);passed.push('重开时完整显示两组选择，修改可增加或删除问法，全角斜杠同样支持');
   await ask(page,revised[0]);await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();const stale=repo.readStore().assistantDialogues[0];
   await page.locator('#question').fill('陈文琼来了没 / 陈文琼在店里没');await page.locator('#answer').fill('这次编辑的回答 / 这次编辑的另一句');
   assert.equal((await post(context,'/api/assistant/dialogues/save',{...stale,answer:'另一个人新保存的回答',answerMandarin:'另一个人新保存的回答'})).status,200);
   await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'问答已被修改'}).waitFor();assert.equal(await page.locator('#question').inputValue(),'陈文琼来了没 / 陈文琼在店里没');assert.equal(await page.locator('#answer').inputValue(),'这次编辑的回答 / 这次编辑的另一句');
   await page.locator('#answer-edit-cancel').click();assert.equal(await page.locator('#question').inputValue(),revised[0]);passed.push('并发修改不覆盖其他人的新版本，失败保留问法和答法，取消恢复原问题');
   await page.locator('#new-topic').click();const longWays=Array.from({length:8},(_,i)=>'新顾客的不同打招呼方式'+i+'这是为了说明整组同义问法可以超过原来单个问题的长度限制');
   const raw=longWays.join('/');assert.ok(raw.length>240);assert.equal(await page.locator('#question').getAttribute('maxlength'),'4800');await page.locator('#question').fill(raw);await page.locator('#answer-edit-save').waitFor();assert.equal(await page.locator('#answer').inputValue(),'');
   await page.locator('#answer').fill('你好，很高兴帮你。 / 你好，请问需要什么帮助？');await page.locator('#ask .primary').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();assert.deepEqual(repo.readStore().assistantDialogues[1].questions,longWays);passed.push('首次直接输入一组问法也能新建问答，超过240字的同义词组合不被截断');
   await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();await page.locator('#question').fill('今天卖了多少台手机 / 今天营业额多少');await page.locator('#answer').fill('错误的固定答案');
   await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'店内查询和操作'}).waitFor();assert.equal(await page.locator('#question').inputValue(),'今天卖了多少台手机 / 今天营业额多少');await page.locator('#mode-customer').click();assert.equal(await page.locator('#answer-edit-form').isVisible(),false);assert.equal(await page.locator('#question').inputValue(),'');passed.push('实时账目仍查询真实数据；顾客模式清除编辑内容');
  }finally{await context.close()}
  const fresh=await open(owner,320);try{
   await fresh.page.locator('#question').fill('欢迎的话怎么说 / 到店如何打招呼');await fresh.page.locator('#answer-edit-save').waitFor();await fresh.page.locator('#answer').fill('你好，欢迎光临。 / 你好，很高兴为你服务。');
   assert.equal(await fresh.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await fresh.page.locator('#question').scrollIntoViewIfNeeded();await fresh.page.screenshot({path:path.join(output,'paired-question-answer-320.png')});
   await fresh.page.locator('#answer-edit-save').click();await fresh.page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();
  }finally{await fresh.context.close()}
  const worker=await open(staff);try{await ask(worker.page,'欢迎的话怎么说 / 到店如何打招呼');assert.equal(await worker.page.locator('#answer-edit-form').isVisible(),false);assert.equal((await post(worker.context,'/api/assistant/dialogues/save',{title:'无权编辑',version:0,questions:['无权编辑'],answer:'错误',enabled:true,customerVisible:false})).status,403)}finally{await worker.context.close()}
  passed.push('320px手机无横向溢出；员工仍需提交纠错，不能直接发布答案');
  assert.deepEqual(errors,[]);assert.equal(repo.readStore().sales.length,0);assert.equal(repo.readStore().purchases.length,0);
  const result={passed:passed.length,failed:0,checks:passed,financialWrites:0};fs.writeFileSync(path.join(output,'ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(temp)}
})().catch(error=>{console.error(error);process.exitCode=1});
