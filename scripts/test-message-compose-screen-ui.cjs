'use strict';
require('./simulation-preload.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.STORE_SEED_PATH=path.resolve('artifacts/simulation-20261010/seed.json');
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer();
(async()=>{let browser;const errors=[],checks=[],out='artifacts/message-compose-fix';try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 async function open(user,width){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});context.setDefaultTimeout(10000);
  await context.addCookies([{name:'erp_session',value:sessions.issue(user),url:origin}]);await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/m?panel=electronic-screen');await page.locator('#store-messages').waitFor();return {page,context};
 }
 const businessBefore=JSON.stringify(Object.fromEntries(['sales','purchases','inventory','receipts','payrollStatements'].map(k=>[k,repo.readStore()[k]])));
 for(const width of [390,320]){
  const {page,context}=await open('demo-owner',width);
  await page.locator('#comms-publish-section').waitFor();assert.equal(await page.locator('#comms-publish-section').evaluate(e=>e.open),true);
  const form=page.locator('#comms-publish');await form.locator('[name="title"]').fill('全天测试'+width);await form.locator('[name="content"]').fill('模拟全天内容');await page.locator('#comms-display-mode').selectOption('fixed');await page.locator('#comms-display-seconds').fill('7');await page.locator('#comms-publish-button').click();
  await page.waitForFunction(()=>document.getElementById('comms-status').textContent.includes('已保存'));
  await page.waitForFunction(()=>document.getElementById('comms-board-track').textContent.includes('模拟全天内容'));
  const row=page.locator('#comms-managed .comms-notice').filter({hasText:'全天测试'+width});await row.getByText(/固定 · 7秒/).waitFor();assert.equal(await page.locator('#store-electronic-board').evaluate(e=>e.classList.contains('board-mode-fixed')),true);await row.getByRole('button',{name:'修改',exact:true}).click();
  await page.locator('#comms-time-preset').selectOption('morning');assert.equal(await page.locator('#comms-time-start').inputValue(),'06:00');
  await page.locator('#comms-time-start').fill('08:30');await page.locator('#comms-time-end').fill('11:45');assert.equal(await page.locator('#comms-time-preset').inputValue(),'custom');
  await page.locator('#comms-publish-button').click();await page.waitForFunction(()=>document.getElementById('comms-status').textContent.includes('已保存'));
  await row.getByText(/08:30–11:45/).waitFor();assert.equal(repo.readStore().storeAnnouncements.find(r=>r.title==='全天测试'+width).schedule.start,'08:30');
  await row.getByRole('button',{name:'修改',exact:true}).click();await page.locator('#comms-display-mode').selectOption('fade');await page.locator('#comms-display-seconds').fill('9');await page.locator('#comms-time-start').fill('21:30');await page.locator('#comms-time-end').fill('06:45');await page.locator('#comms-publish-button').click();
  await page.waitForFunction(()=>document.getElementById('comms-status').textContent.includes('已保存'));await row.getByText(/跨夜/).waitFor();assert.equal(repo.readStore().storeAnnouncements.find(r=>r.title==='全天测试'+width).display.mode,'fade');
  await row.getByRole('button',{name:'修改',exact:true}).click();await page.locator('#comms-time-end').fill('21:30');await page.locator('#comms-publish-button').click();
  await page.waitForFunction(()=>document.getElementById('comms-status').textContent.includes('开始与结束时间不能相同'));assert.equal(await page.locator('#comms-time-end').inputValue(),'21:30');
  await page.locator('#comms-publish-cancel').click();await row.getByRole('button',{name:'修改',exact:true}).click();await page.locator('#comms-time-preset').selectOption('all');
  await page.locator('#comms-publish-button').click();await page.waitForFunction(()=>document.getElementById('comms-status').textContent.includes('已保存'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('#comms-publish-section').evaluate(e=>e.open=true);await page.locator('#comms-time-preset').selectOption('custom');await page.locator('#comms-publish').screenshot({path:path.join(out,'screen-editor-'+width+'.png')});
  await page.locator('#comms-publish').evaluate(e=>e.reset());await row.getByRole('button',{name:'收起',exact:true}).click();await page.waitForFunction(()=>document.getElementById('comms-status').textContent.includes('内容已收起'));
  await context.close();checks.push(width+'px：入口直达编辑、全天、预设可修改、任意时段、跨夜、错误保留原表单、取消与收起');
 }
 const playback=await open('demo-owner',390),pp=playback.page,pf=pp.locator('#comms-publish');
 for(const [title,content]of [['第一条','第一条固定内容'],['第二条','第二条固定内容']]){
 await pf.locator('[name="title"]').fill(title);await pf.locator('[name="content"]').fill(content);await pp.locator('#comms-display-mode').selectOption('fixed');await pp.locator('#comms-display-seconds').fill('3');await pp.locator('#comms-publish-button').click();await pp.waitForFunction(()=>document.getElementById('comms-status').textContent.includes('已保存'));
 }
 await pp.waitForFunction(()=>document.getElementById('comms-board-track').textContent.includes('第二条固定内容'));
 await pp.locator('#comms-close').click();await pp.locator('#comms-board-pause').click();await pp.waitForTimeout(3400);assert.match(await pp.locator('#comms-board-track').textContent(),/第二条固定内容/);
 await pp.locator('#comms-board-pause').click();await pp.waitForFunction(()=>document.getElementById('comms-board-track').textContent.includes('第一条固定内容'),null,{timeout:7000});checks.push('固定显示按秒轮播，暂停保留当前内容与剩余时间');await playback.context.close();
 const staff=await open('demo-clerk',390);assert.equal(await staff.page.locator('#comms-publish-section').isVisible(),false);assert.equal(await staff.page.locator('#comms-managed-section').isVisible(),false);
 const forbidden=await staff.page.request.post(origin+'/api/store-communication/update',{headers:{'Idempotency-Key':crypto.randomUUID()},data:{id:'x',revision:0,title:'不能修改',content:'内容',level:'normal'}});assert.equal(forbidden.status(),403);await staff.context.close();
 assert.equal(JSON.stringify(Object.fromEntries(['sales','purchases','inventory','receipts','payrollStatements'].map(k=>[k,repo.readStore()[k]]))),businessBefore);assert.deepEqual(errors,[]);
 checks.push('员工只能看播放内容，编辑由老板授权；财务与库存没有变化');
 const result={checkedAt:new Date().toISOString(),passed:checks.length,checks,pageErrors:errors,businessWrites:0};
 fs.writeFileSync(path.join(out,'screen-ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));sessions.close()}})().catch(e=>{console.error(e);process.exitCode=1});
