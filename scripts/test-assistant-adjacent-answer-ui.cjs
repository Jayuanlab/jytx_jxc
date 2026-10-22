'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'adjacent-answer-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),owner={id:'owner',name:'测试老板',role:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试店员',roleCode:'employee',status:'active',permissions:['sale:create']},kiosk={id:'customer',name:'顾客接待',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff,kiosk]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),{createServer}=require('../server/src/application');
const output=path.resolve('artifacts/assistant-adjacent-answer'),passes=[],errors=[],sizes=[];let browser;
const server=createServer();
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});fs.mkdirSync(output,{recursive:true});
  async function open(user,width=390,size='double'){
   const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<700,hasTouch:width<700});context.setDefaultTimeout(10000);
   await context.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);await context.addInitScript(size=>localStorage.setItem('store-mobile-text-size',size),size);
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/assistant');await page.waitForFunction(()=>me!=null);await page.waitForLoadState('networkidle');await page.locator('#auto-voice').uncheck();return {context,page};
  }
  async function ask(page,q){await page.locator('#question').fill(q);const response=page.waitForResponse(r=>r.url().endsWith('/api/assistant/ask')&&r.request().method()==='POST');await page.locator('#ask .primary').click();const res=await response;assert.equal(res.status(),200);const data=await res.json();await page.waitForFunction(answer=>document.getElementById('answer').value===answer,data.answer);return data}
  for(const [width,size]of[[320,'double'],[390,'double'],[1280,'desktop']]){
   const {context,page}=await open(owner,width,size);
   try{
    const data=await ask(page,'你好，请问陈文琼在不在');assert.equal(data.unresolved,true);assert.equal(await page.locator('#edit-answer').isVisible(),true);
    const bounds=await page.evaluate(()=>{const q=document.querySelector('.question-row').getBoundingClientRect(),a=document.querySelector('#result').getBoundingClientRect(),controls=document.querySelector('#ask').getBoundingClientRect();return {gap:a.top-q.bottom,answerTop:a.top,controlsTop:controls.top,overflow:document.documentElement.scrollWidth>innerWidth}});
    assert.ok(bounds.gap>=0&&bounds.gap<=12,JSON.stringify(bounds));assert.ok(bounds.controlsTop<bounds.answerTop);assert.equal(bounds.overflow,false);sizes.push({width,size,...bounds});
    await page.locator('#question').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'question-answer-'+width+'.png')});
    await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();assert.equal(await page.locator('#answer').isVisible(),true);assert.equal(await page.locator('#answer-edit-save').isVisible(),true);assert.equal(await page.locator('#answer-edit-more').evaluate(n=>n.open),false);
    const original=await page.locator('#answer').inputValue();await page.locator('#answer').fill('这次取消的内容');await page.locator('#answer-edit-cancel').click();assert.equal(await page.locator('#answer').inputValue(),original);
    passes.push(width+'px: adjacent question/answer, inline edit, cancel preserves answer, no overflow');
   }finally{await context.close()}
  }
  const {context,page}=await open(owner);
  try{
   await ask(page,'你好，请问陈文琼在不在');await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();
   await page.locator('#answer').fill('请稍等，我帮你确认一下。');await page.locator('#answer-edit-more>summary').click();assert.equal(await page.locator('#answer-edit-public').isChecked(),false);
   await page.locator('#question').fill('你好，请问陈文琼在不在 / 陈文琼在吗 / 我找陈文琼');
   await page.locator('#answer').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'inline-correct-answer-mobile.png')});
   await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();assert.equal(await page.locator('#answer').inputValue(),'请稍等，我帮你确认一下。');
   let row=repo.readStore().assistantDialogues.find(x=>x.questions.includes('陈文琼在吗'));assert.equal(row.version,1);assert.equal(row.customerVisible,false);assert.equal(row.answer,row.answerMandarin);assert.ok(row.questions.includes('你好，请问陈文琼在不在'));
   await page.reload();await page.waitForFunction(()=>me!=null);await page.locator('#auto-voice').uncheck();await ask(page,'我找陈文琼');assert.equal(await page.locator('#answer').inputValue(),'请稍等，我帮你确认一下。');
   await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();await page.locator('#answer').fill('这次修改不能覆盖别人。');
   const response=await context.request.post(origin+'/api/assistant/dialogues/save',{headers:{'Idempotency-Key':'external-edit'},data:{...row,answer:'稍等，我帮你问一下。',answerMandarin:'稍等，我帮你问一下。'}});assert.equal(response.status(),200);
   await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'问答已被修改'}).waitFor();assert.equal(await page.locator('#answer').inputValue(),'这次修改不能覆盖别人。');
   await page.locator('#answer-edit-cancel').click();await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();assert.equal(await page.locator('#answer').inputValue(),'稍等，我帮你问一下。');await page.locator('#answer-edit-more>summary').click();await page.locator('#answer-edit-public').check();await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();
   row=repo.readStore().assistantDialogues.find(x=>x.id===row.id);assert.equal(row.version,3);assert.equal(row.history.length,2);assert.equal(row.customerVisible,true);
   await page.locator('#mode-customer').click();await ask(page,'陈文琼在吗');assert.equal(await page.locator('#answer').inputValue(),'稍等，我帮你问一下。');assert.equal(await page.locator('#edit-answer').isVisible(),false);assert.equal(await page.locator('#answer-edit-form').isVisible(),false);
   await page.locator('#mode-store').click();await ask(page,'今天卖了多少台手机');assert.equal(await page.locator('#edit-answer').isVisible(),false);
   await page.locator('#new-topic').click();await ask(page,'帮我办一张卡');await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();await page.locator('#answer').fill('你原来用啥子卡？月费好多钱嘛？');
   await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'保存成功'}).waitFor();assert.equal(await page.locator('#answer').inputValue(),'你原来用啥子卡？月费好多钱嘛？');
   passes.push('unresolved correction saved, visible immediately, aliases and reload use saved answer');
   passes.push('version conflict preserves draft; revision history retained');
   passes.push('customer visibility opt-in; customer mode has no editor');
   passes.push('existing dialogue remains editable; live sales figures remain database queries');
   await page.locator('#new-topic').click();await ask(page,'请问你可不可以表演唱一首小曲');await page.locator('#edit-answer').click();await page.locator('#answer-edit-save').waitFor();await page.locator('#answer-edit-more>summary').click();await page.locator('#question').fill('今天营业额是多少');
   await page.locator('#answer').fill('错误的固定金额回答');await page.locator('#answer-edit-save').click();await page.locator('#answer-edit-status').filter({hasText:'店内查询和操作'}).waitFor();assert.equal(await page.locator('#answer').inputValue(),'错误的固定金额回答');
   passes.push('rejected fixed business-data correction displays reason and keeps typed content');
  }finally{await context.close()}
  for(const user of[staff,kiosk]){
   const {context,page}=await open(user);try{await ask(page,'你好，请问陈文琼在不在');assert.equal(await page.locator('#edit-answer').isVisible(),false);const denied=await context.request.post(origin+'/api/assistant/dialogues/save',{headers:{'Idempotency-Key':'denied-'+user.id},data:{title:'错误',questions:['错误'],answer:'错误',version:0,enabled:true,customerVisible:false}});assert.equal(denied.status(),403)}finally{await context.close()}
  }
  passes.push('staff and reception accounts cannot save corrections');
  assert.deepEqual(errors,[]);assert.equal(repo.readStore().sales.length,0);assert.equal(repo.readStore().receipts.length,0);passes.push('zero browser errors and zero financial writes');
  fs.writeFileSync(path.join(output,'ui-report.json'),JSON.stringify({passed:passes.length,failed:0,passes,sizes,errors},null,2));console.log(JSON.stringify({passed:passes.length,failed:0,passes,sizes},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(folder)}
})().catch(error=>{console.error(error);process.exitCode=1});
