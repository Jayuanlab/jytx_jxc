'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'feedback-ui-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),workflow=require('../server/src/staff-workflow');
const owner={id:'owner',name:'测试老板',roleCode:'owner',status:'active'},employee={id:'employee',name:'测试营业员',roleCode:'employee',status:'active',permissions:['sale:create','sale:return']},guest={id:'guest',name:'顾客接待',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const seed=c.initialize({users:[owner,employee,guest]});workflow.enable(seed,owner);fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),passed=[],errors=[];let browser;
const output=path.resolve('artifacts/assistant-adjacent-answer');fs.mkdirSync(output,{recursive:true});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  async function open(user,url='/assistant'){
   const context=await browser.newContext({viewport:{width:390,height:1000},isMobile:true,hasTouch:true});context.setDefaultTimeout(10000);
   await context.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+url);await page.waitForLoadState('networkidle');return {context,page};
  }
  async function post(context,url,data){const res=await context.request.post(origin+url,{headers:{'Idempotency-Key':require('node:crypto').randomUUID()},data});return {status:res.status(),data:await res.json()}}
  const staff=await open(employee);
  try{
   await staff.page.locator('#auto-voice').uncheck();assert.equal(await staff.page.locator('#ask .primary').textContent(),'↑');assert.equal(await staff.page.locator('#ask .voice-setting').innerText(),'自动');
   await staff.page.locator('#question').fill('你好，请问陈文琼在不在');await staff.page.locator('#ask .primary').click();await staff.page.locator('#report-answer').waitFor();assert.equal(await staff.page.locator('#edit-answer').isVisible(),true);
   await staff.page.locator('#report-answer').click();await staff.page.locator('#feedback-reason').fill('没有接上顾客的话');await staff.page.locator('#feedback-suggestion').fill('稍等，我帮你问一下。');await staff.page.locator('#feedback-submit').click();await staff.page.locator('#feedback-status').filter({hasText:'已提交'}).waitFor();
   assert.equal(repo.readStore().assistantAnswerFeedback.length,1);assert.equal(repo.readStore().assistantDialogues.length,0);passed.push('员工从答案提交纠错，未经审核不改变回答');
   const boss=await open(owner,'/knowledge-review#answer-feedback');
   try{
    await boss.page.locator('.feedback-item').waitFor();await boss.page.locator('.feedback-item>summary').click();const form=boss.page.locator('.feedback-item form');
    assert.equal(await form.locator('[name=answer]').inputValue(),'稍等，我帮你问一下。');await form.locator('[name=answer]').fill('请稍等，我帮你确认一下。');
    await form.locator('[name=note]').fill('按实际接待情况纠正');await form.locator('button[type=submit]').click();await boss.page.locator('#feedback-review-status').filter({hasText:'提交成功'}).waitFor();
    assert.equal(repo.readStore().assistantAnswerFeedback[0].status,'已生效');await boss.page.locator('#feedback-filter').selectOption('已生效');await boss.page.locator('.feedback-item').waitFor();await boss.page.locator('.feedback-item>summary').click();
    assert.ok((await boss.page.locator('.feedback-item').innerText()).includes('请稍等，我帮你确认一下。'));await boss.page.screenshot({path:path.join(output,'owner-feedback-review-mobile.png'),fullPage:true});
    passed.push('老板集中修改、生效，处理人和历史记录可查看');
   }finally{await boss.context.close()}
   await staff.page.locator('#question').fill('你好，请问陈文琼在不在');await staff.page.locator('#ask .primary').click();await staff.page.waitForFunction(()=>document.getElementById('answer').value==='请稍等，我帮你确认一下。');passed.push('审核后员工再次提问使用正确回答');
   await staff.page.locator('#mode-customer').click();assert.equal(await staff.page.locator('#report-answer').isVisible(),false);
   assert.equal((await post(staff.context,'/api/assistant/feedback/review',{id:repo.readStore().assistantAnswerFeedback[0].id})).status,403);
   const product=await post(staff.context,'/api/products',{externalCode:'TEST-001',name:'华为测试手机',type:'智能手机',subType:'华为',warehouseId:'wh-a',salePrice:1500,trackSerial:true});assert.equal(product.status,200);
   const supplier=await post(staff.context,'/api/suppliers',{name:'测试供应商'});assert.equal(supplier.status,200);
   const plan=await post(staff.context,'/api/procurement-plans',{supplierId:supplier.data.id,items:[{skuId:product.data.skuId,quantity:1,costPrice:1000}]});assert.equal(plan.status,200);
   const planResponse=await staff.context.request.get(origin+'/api/procurement-plans');const planRows=await planResponse.json();const receiptToken=planRows.find(x=>x.id===plan.data.id).receiptToken;
   const received=await post(staff.context,'/api/purchase-orders',{supplierId:supplier.data.id,planId:plan.data.id,receiptToken,items:[{skuId:product.data.skuId,planItemId:plan.data.items[0].id,quantity:1,costPrice:1000,serials:['860000000001234']}]});assert.equal(received.status,200,JSON.stringify(received.data));
   const inventory=await staff.context.request.get(origin+'/api/inventory');const rows=await inventory.json();assert.equal(rows[0].costPrice,1000);
   assert.equal((await post(staff.context,'/api/procurement-plans',{supplierId:supplier.data.id,paidAmount:1,items:[{skuId:product.data.skuId,quantity:1,costPrice:1000}]})).status,403);
   assert.equal((await post(staff.context,'/api/users',{name:'非法建账号',roleCode:'employee'})).status,403);
   passed.push('营业员可建商品、供应商、订货和串号入库，进价可查；付款和管理审批不能越权');
  }finally{await staff.context.close()}
  const kiosk=await open(guest);try{assert.equal((await kiosk.context.request.get(origin+'/api/assistant/feedback')).status(),403);assert.equal((await post(kiosk.context,'/api/assistant/feedback',{question:'你好',originalAnswer:'你好',reason:'错误'})).status,403)}finally{await kiosk.context.close()}
  passed.push('顾客接待账号无法访问店内纠错');assert.deepEqual(errors,[]);
  const result={passed:passed.length,failed:0,checks:passed};fs.writeFileSync(path.join(output,'feedback-ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
