'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Module=require('node:module');const load=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:load.call(this,n,...args)};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'interface-ui-'));process.env.STORE_BACKUP_DIR=path.join(folder,'backups');process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),comm=require('../server/src/store-communication'),owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active'},guest={id:'guest',name:'顾客',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const seed=c.initialize({users:[owner,staff,guest],products:[{skuId:'phone',name:'华为 Mate60 128GB',type:'智能手机',subType:'华为',trackSerial:true,warehouseId:'wh-a',warehouseName:'A仓·手机数码',salePrice:2399,costPrice:9999,active:true,stockManaged:true}],inventory:[{skuId:'phone',warehouseId:'wh-a',warehouseName:'A仓·手机数码',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]}],suppliers:[{id:'sup',name:'测试供货商'}],purchases:[{id:'JH-UI-1',supplierId:'sup',createdAt:'2026-10-09T20:30:00.000Z',status:'已入库',items:[{id:'PI-1',skuId:'phone',quantity:1,costPrice:1800,serials:['869000000001234']}]}]});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const erp=require('../server/src/erp'),payments=require('../server/src/sale-payments');
seed.products.push({skuId:'replacement',name:'测试换出手机',type:'智能手机',warehouseId:'wh-a',trackSerial:true,salePrice:300,stockManaged:true});
seed.inventory.push({skuId:'replacement',warehouseId:'wh-a',quantity:1,stockValue:150,costPrice:150,serials:[{no:'869000000002222',status:'可售',costPrice:150}],costSources:[]});
const created=erp.sale(seed,owner,{items:[{skuId:'phone',serialNo:'869000000001234',quantity:1,salePrice:200}],account:'现金',cashDrawerConfirmed:true});payments.confirm(seed,owner,{orderId:created.id,actualAmount:200});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),out=path.resolve('artifacts/system-management-20261010/operations-ui');fs.mkdirSync(out,{recursive:true});
const beforeHTML=fs.readFileSync('artifacts/interface-redesign-20261010/before/web/feishu-mobile.html','utf8'),destinations=[...beforeHTML.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
let browser;const checks=[],errors=[],overflow=[],assetErrors=[],writes=[];const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log('PASS',name)}catch(e){checks.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message)}};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 async function open(actor,width,size='double',route='/m',count=19,branchName='聚友通信城'){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<=700,hasTouch:width<=700});context.setDefaultTimeout(7000);await context.addCookies([{name:'erp_session',value:sessions.issue(actor.id),url:origin}]);
  await context.addInitScript(size=>localStorage.setItem('store-mobile-text-size',size),size);
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();
   if(u.pathname==='/api/organization')return r.fulfill({json:{enabled:true,currentBranchId:'branch-one',tenant:{name:'测试企业'},branches:[{id:'branch-one',code:'001',name:branchName,status:'active'}],canManage:actor.roleCode==='owner'}});
   if(u.pathname==='/api/workbench')return r.fetch().then(async response=>{const data=await response.json();return r.fulfill({response,json:{...data,pendingCount:count,followups:0}})});
   if(u.pathname==='/api/ui-branch-probe')return r.fulfill({json:{branch:r.request().headers()['x-store-branch']}});
   if(r.request().method()==='POST'&&!['/api/assistant/ask','/api/copilot/sales-review','/api/users/permissions','/api/system/backups','/api/system/backups/preview','/api/system/backups/restore','/api/financial-documents','/api/sale-exchanges','/api/red-reversals','/api/red-reversals/review'].includes(u.pathname)){writes.push(u.pathname);return r.abort()}return r.continue()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))assetErrors.push(r.url())});await page.goto(origin+route,{waitUntil:'networkidle'});await page.addScriptTag({url:origin+'/branch-context.js'});if(new URL(page.url()).pathname!=='/login'&&actor.id!=='guest')await page.waitForFunction(()=>document.querySelector('[data-home-branch]')?.dataset.branchId==='branch-one'||document.querySelector('#branch-context'));return{page,context};
 }



 // Each mutation is confined to this process's temporary simulated account set.
 for(const width of [320,390]){
  await check(width+' 收付款查询、直接录入与明细弹窗',async()=>{
   const {page,context}=await open(owner,width,'double','/app?tab=receipts');
   try{
    await page.getByRole('button',{name:'登记其他收款',exact:true}).click();
    await page.locator('#modal-form [name=counterparty]').fill('测试活动方'+width);
    await page.locator('#modal-form [name=amount]').fill('50');
    await page.locator('#modal-form [name=note]').fill('模拟活动补助');
    await page.locator('#modal-form [name=confirmed]').check();
    await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});await page.locator('#main tbody tr').filter({hasText:'测试活动方'+width}).waitFor();
    await page.getByRole('button',{name:'今日',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#financial-filter [name=from]').value!=='');await page.locator('#financial-filter [name=q]').fill('测试活动方'+width);await page.locator('#financial-filter button[type=submit]').click();await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>document.querySelectorAll('#main tbody tr').length===1);await page.getByRole('button',{name:'查看明细',exact:true}).click();await page.locator('dialog[open] dd').filter({hasText:'测试活动方'+width}).waitFor();
    assert.ok(await page.locator('dialog[open]').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));await page.locator('dialog[open] button').click();
    await page.goto(origin+'/app?tab=payments',{waitUntil:'networkidle'});await page.getByRole('button',{name:'登记费用付款',exact:true}).click();
    await page.locator('#modal-form [name=counterparty]').fill('测试电力公司'+width);await page.locator('#modal-form [name=amount]').fill('20');await page.locator('#modal-form [name=note]').fill('模拟电费');await page.locator('#modal-form [name=confirmed]').check();await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});
    assert.equal(await page.locator('#main').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.screenshot({path:path.join(out,'payments-'+width+'.png'),fullPage:true});
   }finally{await context.close()}
  });
 }
 await check('老板权限勾选保存、员工旧会话立即执行新权限',async()=>{
  const {page,context}=await open(owner,390,'double','/app?tab=staff');
  try{
   await page.locator('[data-action=staff-permissions][data-value=staff]').click();await page.locator('#staff-permissions-dialog').waitFor();
   await page.locator('#staff-permissions-dialog [name=sell]').uncheck();await page.locator('#staff-permissions-dialog [name=purchase]').check();
   await page.locator('#staff-permissions-dialog button[type=submit]').click();await page.locator('#staff-permissions-dialog').waitFor({state:'detached'});
   const info=await page.evaluate(async()=>{const r=await fetch('/api/users/permissions?userId=staff');return r.json()});assert.equal(info.user.capabilities.sell,false);assert.equal(info.user.capabilities.purchase,true);
   const {page:employee,context:ec}=await open(staff,390,'double','/app?tab=sales');try{await employee.locator('#nav button[data-tab=dashboard].active').waitFor();await employee.locator('#nav button[data-tab=purchase]').waitFor();}finally{await ec.close()}
   await page.locator('[data-action=staff-permissions][data-value=staff]').click();await page.locator('#staff-permissions-dialog [name=sell]').check();await page.locator('#staff-permissions-dialog button[type=submit]').click();await page.locator('#staff-permissions-dialog').waitFor({state:'detached'});
  }finally{await context.close()}
 });
 await check('换货表单直接填写、差额提示、关联串号与新单',async()=>{
  const {page,context}=await open(owner,390,'double','/app?tab=returns');
  try{
   await page.locator('[data-action=exchange-sale]').first().click();await page.locator('#modal-form [name=skuId]').selectOption('replacement');
   await page.locator('#modal-form [name=serialNo]').fill('869000000002222');await page.locator('#modal-form [name=salePrice]').fill('300');
   await page.locator('#modal-form [name=reason]').fill('模拟顾客换机测试');await page.locator('#modal-form [name=account]').selectOption('现金');await page.locator('#modal-form [name=cashDrawerConfirmed]').check();
   assert.ok((await page.locator('#exchange-difference').innerText()).includes('需补收'));await page.screenshot({path:path.join(out,'exchange-390.png'),fullPage:true});
   await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});
   const data=repo.readStore();assert.equal(data.saleExchanges.length,1);assert.equal(data.inventory.find(x=>x.skuId==='phone').serials[0].status,'可售');assert.equal(data.inventory.find(x=>x.skuId==='replacement').serials[0].status,'已售');
  }finally{await context.close()}
 });
 await check('红冲原单申请和老板审核保留原费用',async()=>{
  const {page,context}=await open(owner,390,'double','/app?tab=red');
  try{
   const button=page.locator('[data-action=red-request]').filter({hasText:'申请红冲'}).first();await button.click();
   await page.locator('#modal-form [name=reason]').fill('模拟错误登记，实际没有发生收付款');await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});
   await page.locator('[data-action=red-approve]').first().click();await page.locator('#modal-form [name=note]').fill('已核实属于模拟误记');await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});assert.ok(repo.readStore().redReversals.some(x=>x.status==='已红冲'));
  }finally{await context.close()}
 });
 await check('备份下载上传预览、自动安全备份与恢复完成提示',async()=>{
  const {page,context}=await open(owner,320,'double','/app?tab=backup');
  try{
   const downloadPromise=page.waitForEvent('download');await page.locator('#backup-create').click();const download=await downloadPromise,file=path.join(out,'simulated-backup.json');await download.saveAs(file);
   assert.ok(fs.existsSync(file));const original=JSON.parse(fs.readFileSync(file));
   await page.evaluate(async()=>{await fetch('/api/financial-documents',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'after-backup-ui'},body:JSON.stringify({direction:'receive',counterparty:'恢复测试',amount:99,account:'现金',note:'备份之后模拟新增',confirmed:true})})});
   await page.locator('#backup-file').setInputFiles(file);await page.locator('#backup-preview').click();await page.locator('#backup-confirm').waitFor();
   assert.equal(await page.locator('#backup-restore').isDisabled(),true);await page.locator('#backup-confirm').check();await page.locator('#backup-restore').click();
   await page.locator('#restore-status').filter({hasText:'已恢复'}).waitFor();
   const restored=repo.readStore();assert.equal(restored.otherIncome.length,original.payload.otherIncome.length);assert.equal(restored.users.length,3);assert.ok(await page.locator('#backup-history').innerText().then(t=>t.includes('恢复前自动备份')));
   assert.equal(await page.locator('#main').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await page.screenshot({path:path.join(out,'backup-320.png'),fullPage:true});
  }finally{await context.close()}
 });
 assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);assert.deepEqual(writes,[]);
}finally{
 const result={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,failed:result.failed,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length}));if(result.failed||errors.length||overflow.length||assetErrors.length||writes.length)process.exitCode=1;
 await browser?.close();await new Promise(r=>server.close(r));repo.closeStore?.();sessions.close?.();
}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
