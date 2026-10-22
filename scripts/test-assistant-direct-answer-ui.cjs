'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),Module=require('node:module');
const load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'direct-answer-'));process.env.STORE_SEED_PATH=path.join(temp,'seed.json');
const c=require('../server/src/common'),owner={id:'owner',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),passed=[],errors=[];let browser;
const output=path.resolve('artifacts/assistant-single-save/direct');fs.mkdirSync(output,{recursive:true});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 async function open(user,width=390,query=''){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});context.setDefaultTimeout(10000);
  await context.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/assistant'+query);await page.waitForFunction(()=>me!=null);await page.waitForLoadState('networkidle');await page.locator('#auto-voice').uncheck();return {context,page};
 }
 async function ask(page,q){
  await page.locator('#question').fill(q);const response=page.waitForResponse(r=>r.url().endsWith('/api/assistant/ask')&&r.request().method()==='POST');
  await page.locator('#ask .primary').click();const res=await response;assert.equal(res.status(),200);const data=await res.json();
  await page.waitForFunction(value=>document.getElementById('answer').value===value,data.answer);return data;
 }
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const session=await open(owner),{context,page}=session;
  try{
   const initial='你好，请问陈文琼在不在',questionWays=[initial,'我找陈文琼','陈文琼在不在'],answers=['请稍等，我帮你问一下。','你好，你找他有什么事？'];
   await ask(page,initial);const answerBox=page.locator('#answer');
   assert.equal(await answerBox.evaluate(el=>el.tagName),'TEXTAREA');assert.equal(await answerBox.isEditable(),true);assert.equal(await page.locator('#answer-edit-form').isVisible(),true);
   let release,requested;const gate=new Promise(resolve=>release=resolve),received=new Promise(resolve=>requested=resolve);
   const delayed=async route=>{requested();await gate;await route.continue()};
   await page.route('**/api/assistant/dialogues',delayed);
   await answerBox.tap();await received;
   assert.equal(await page.evaluate(()=>document.activeElement.id),'answer');
   await answerBox.fill(answers.join(' / '));await page.locator('#question').fill(questionWays.join(' / '));
   release();await page.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);await page.unroute('**/api/assistant/dialogues',delayed);
   assert.equal(await answerBox.inputValue(),answers.join(' / '));assert.equal(await page.locator('#question').inputValue(),questionWays.join(' / '));
   assert.equal(await page.locator('#answer').count(),1);assert.equal(await page.locator('#answer-edit-text').count(),0);
   await answerBox.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'direct-answer-mobile.png')});
   await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();
   const row=repo.readStore().assistantDialogues[0];assert.deepEqual(row.questions,questionWays);assert.equal(row.answerMandarin,answers.join(' / '));assert.ok(answers.includes(await answerBox.inputValue()));
   passed.push('手机直接点显示的回答就能输入，不需要先点修改按钮；只使用一个回答框');
   passed.push('载入期间快速输入的问法和答法均保留，保存同时生效');
   await ask(page,'我找陈文琼');assert.ok(answers.includes(await answerBox.inputValue()));await answerBox.tap();await page.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);
   assert.equal(await answerBox.inputValue(),answers.join(' / '));await answerBox.fill('这句取消不保存');await page.locator('#answer-edit-cancel').click();
   assert.ok(answers.includes(await answerBox.inputValue()));assert.equal(repo.readStore().assistantDialogues[0].version,1);
   passed.push('再次点击可编辑全部答法，取消会恢复已保存的回答');
   await answerBox.tap();await page.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);await answerBox.fill('新的正确答复。');await page.locator('#answer-edit-save').click();
   await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();assert.equal(await answerBox.inputValue(),'新的正确答复。');
   await answerBox.fill('连续修改后的答复。');await page.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();
   assert.equal(repo.readStore().assistantDialogues[0].answer,'连续修改后的答复。');assert.equal(repo.readStore().assistantDialogues[0].version,3);
   passed.push('保存后仍能在同一框连续修改，只用下方一个按钮保存，版本历史保留');
   await page.reload();await page.waitForFunction(()=>me!=null);await page.locator('#auto-voice').uncheck();await ask(page,'陈文琼在不在');assert.equal(await answerBox.inputValue(),'连续修改后的答复。');
   await ask(page,'今天营业额多少');assert.equal(await answerBox.isEditable(),true);await answerBox.tap();assert.equal(await page.locator('#answer-edit-form').isVisible(),true);
   await page.locator('#answer-edit-cancel').click();await page.locator('#new-topic').click();await ask(page,'帮我办一张卡');assert.equal(await answerBox.isEditable(),true);const original=await answerBox.inputValue();await answerBox.tap();await page.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);
   await answerBox.fill('你想用啥子卡？');await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();
   const preset=repo.readStore().assistantDialogues.find(row=>row.id==='tariff:current-plan');assert.ok(preset);assert.notEqual(preset.answer,original);assert.equal(preset.answerMandarin,'您原来使用什么套餐，每月大概支出多少？新办卡也可以直接说明。');
   passed.push('自定义和办卡问答均可原位修改，另一种语言保留；真实财务建议只提交纠错，原金额不变');
   await page.locator('#mode-customer').click();await ask(page,'你好');assert.equal(await answerBox.isEditable(),false);assert.equal(await page.locator('#answer-edit-form').isVisible(),false);
  }finally{await context.close()}
  const small=await open(owner,320,'?embedded=1&mode=store');try{
   await ask(small.page,'我找陈文琼');assert.equal(await small.page.locator('#answer').isEditable(),true);await small.page.locator('#answer').tap();await small.page.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);
   assert.equal(await small.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await small.page.locator('#answer').fill('测试窄屏可以直接编辑。');
   await small.page.locator('#answer').scrollIntoViewIfNeeded();await small.page.screenshot({path:path.join(output,'direct-answer-embedded-320.png')});
   await small.page.locator('#answer-edit-cancel').click();
  }finally{await small.context.close()}
  const worker=await open(staff);try{
   await ask(worker.page,'我找陈文琼');assert.equal(await worker.page.locator('#answer').isEditable(),true);assert.equal(await worker.page.locator('#answer-edit-save').innerText(),'提交审核');
   const denied=await worker.context.request.post(origin+'/api/assistant/dialogues/save',{headers:{'Idempotency-Key':randomUUID()},data:{title:'非法',questions:['非法'],answer:'非法',version:0,enabled:true,customerVisible:false}});assert.equal(denied.status(),403);
  }finally{await worker.context.close()}
  passed.push('320px嵌入式手机助理也可直接编辑，无横向溢出；员工纠错和顾客权限保持');
  assert.deepEqual(errors,[]);assert.equal(repo.readStore().sales.length,0);assert.equal(repo.readStore().purchases.length,0);
  const result={passed:passed.length,failed:0,checks:passed,financialWrites:0};fs.writeFileSync(path.join(output,'ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(temp)}
})().catch(error=>{console.error(error);process.exitCode=1});
