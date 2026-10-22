'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Module=require('node:module');const load=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:load.call(this,n,...args)};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'interface-ui-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),comm=require('../server/src/store-communication'),owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active'},guest={id:'guest',name:'顾客',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const seed=c.initialize({users:[owner,staff,guest],products:[{skuId:'phone',name:'华为 Mate60 128GB',type:'智能手机',subType:'华为',trackSerial:true,warehouseId:'wh-a',warehouseName:'A仓·手机数码',salePrice:2399,costPrice:9999,active:true,stockManaged:true}],inventory:[{skuId:'phone',warehouseId:'wh-a',warehouseName:'A仓·手机数码',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]}],suppliers:[{id:'sup',name:'测试供货商'}],purchases:[{id:'JH-UI-1',supplierId:'sup',createdAt:'2026-10-09T20:30:00.000Z',status:'已入库',items:[{id:'PI-1',skuId:'phone',quantity:1,costPrice:1800,serials:['869000000001234']}]}]});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),out=path.resolve('artifacts/font-toggle-20261010/ui');fs.mkdirSync(out,{recursive:true});
const beforeHTML=fs.readFileSync('artifacts/interface-redesign-20261010/before/web/feishu-mobile.html','utf8'),destinations=[...beforeHTML.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
let browser;const checks=[],errors=[],overflow=[],assetErrors=[],writes=[];const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log('PASS',name)}catch(e){checks.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message)}};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 async function open(actor,width,size='double',route='/m',count=19,branchName='聚友通信城'){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<=700,hasTouch:width<=700});context.setDefaultTimeout(7000);await context.addCookies([{name:'erp_session',value:sessions.issue(actor.id),url:origin}]);
  await context.addInitScript(size=>{if(!localStorage.getItem('store-mobile-text-size'))localStorage.setItem('store-mobile-text-size',size)},size);
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();
   if(u.pathname==='/api/organization')return r.fulfill({json:{enabled:true,currentBranchId:'branch-one',branches:[{id:'branch-one',code:'001',name:branchName}],canManage:actor.roleCode==='owner'}});
   if(u.pathname==='/api/workbench')return r.fetch().then(async response=>{const data=await response.json();return r.fulfill({response,json:{...data,pendingCount:count,followups:0,reviews:{assistantFeedback:9,cashHandover:1,salePayments:3,procurementPaymentReview:1,productPrice:1,giftApprovals:1,dailyReview:1,workJournal:1,closeout:1}}})});
   if(u.pathname==='/api/ui-branch-probe')return r.fulfill({json:{branch:r.request().headers()['x-store-branch']}});
   if(r.request().method()==='POST'&&!['/api/assistant/ask','/api/copilot/sales-review'].includes(u.pathname)){writes.push(u.pathname);return r.abort()}return r.continue()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))assetErrors.push(r.url())});await page.goto(origin+route,{waitUntil:'networkidle'});await page.addScriptTag({url:origin+'/branch-context.js'});await page.waitForFunction(()=>document.querySelector('[data-home-branch]')?.dataset.branchId==='branch-one'||document.querySelector('#branch-context'));return{page,context};
 }


 for(const width of [320,390,700]){
  for(const [route,selector]of [['/m','.pending-item>span'],['/app?tab=inventory','.inventory-phone-model'],['/app?tab=sales','#sale-search'],['/assistant?mode=store','#question'],['/receptions','[name=purpose]']]){
   await check(width+' '+route+' actual font changes and preserves input',async()=>{
    const {page,context}=await open(owner,width,'large',route);
    try{
     if(route==='/m')await page.locator('#pending-details').evaluate(el=>el.open=true);
     const target=page.locator(selector).first();await target.waitFor();
     if(['INPUT','TEXTAREA'].includes(await target.evaluate(el=>el.tagName)))await target.fill('字号切换保留草稿');
     const before=await target.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
     await page.locator('.text-size-toggle').click();
     const after=await target.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
     assert.ok(after>=before*1.1,JSON.stringify({route,before,after}));
     if(route==='/m'){
      assert.ok(before>=32&&after>=38);
      for(const node of await page.locator('.pending-item:visible').all()){
       assert.equal(await node.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
      }
      await page.screenshot({path:path.join(out,'pending-'+width+'-double.png'),fullPage:true});
      await page.locator('#module-sales>summary').click();
      const control=page.locator('#module-dialog .card strong').first();
      const big=await control.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
      await page.locator('.text-size-toggle').evaluate(el=>el.click());
      const small=await control.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
      assert.ok(big>=small*1.1);
      await page.locator('#module-dialog-close').click();await page.waitForFunction(()=>!history.state?.homeModule);
      await page.locator('.text-size-toggle').click();
     }
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
     if(['INPUT','TEXTAREA'].includes(await target.evaluate(el=>el.tagName)))assert.equal(await target.inputValue(),'字号切换保留草稿');
     await page.reload({waitUntil:'networkidle'});
     if(route==='/m')await page.locator('#pending-details').evaluate(el=>el.open=true);
     const persisted=await page.locator(selector).first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
     assert.equal(persisted,after);
     await page.locator('.text-size-toggle').click();
     assert.equal(await page.locator(selector).first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),before);
    }finally{await context.close()}
   });
  }
 }
 await check('embedded assistant follows parent and another tab',async()=>{
  const {page,context}=await open(owner,390,'large');
  try{
   await page.locator('.assistant-float').click();
   const frame=page.frameLocator('.assistant-float-panel iframe');
   await frame.locator('#question').waitFor();
   const before=await frame.locator('#question').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
   await page.locator('.text-size-toggle').click();
   await frame.locator('html').evaluate(el=>new Promise(resolve=>{const wait=()=>el.classList.contains('mobile-text-double')?resolve():requestAnimationFrame(wait);wait()}));
   const after=await frame.locator('#question').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
   assert.ok(after>before);
   await page.locator('.assistant-float-panel .assistant-float-head button').click();
   const second=await context.newPage();await second.goto(origin+'/assistant',{waitUntil:'networkidle'});
   const small=await second.locator('#question').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
   await page.locator('.text-size-toggle').click();
   await second.waitForFunction(()=>document.documentElement.classList.contains('mobile-text-large'));
   assert.ok(await second.locator('#question').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))<small);
   assert.equal(await second.locator('.text-size-toggle').innerText(),'字大');
   await page.locator('.text-size-toggle').click();
   await second.waitForFunction(()=>document.documentElement.classList.contains('mobile-text-double'));
   assert.equal(await second.locator('#question').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),small);
   assert.equal(await second.locator('.text-size-toggle').innerText(),'字小');
  }finally{await context.close()}
 });
 await check('desktop font sizes stay unchanged',async()=>{
  const {page,context}=await open(owner,1280,'desktop');
  try{
   const before=await page.locator('.hero-action-label').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
   await page.locator('.text-size-toggle').evaluate(el=>el.click());
   assert.equal(await page.locator('.hero-action-label').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),before);
  }finally{await context.close()}
 });
 assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);assert.deepEqual(writes,[]);
}finally{
 const result={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks,pageErrors:errors,assetErrors,businessWrites:writes.length};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:result.passed,failed:result.failed,pageErrors:errors,assetErrors,businessWrites:writes.length}));
 if(result.failed||errors.length||assetErrors.length||writes.length)process.exitCode=1;
 await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));repo.closeStore?.();sessions.close?.();
}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
