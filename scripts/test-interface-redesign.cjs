'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Module=require('node:module');const load=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:load.call(this,n,...args)};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'interface-ui-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),comm=require('../server/src/store-communication'),owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active'},guest={id:'guest',name:'顾客',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const seed=c.initialize({users:[owner,staff,guest],products:[{skuId:'phone',name:'华为 Mate60 128GB',type:'智能手机',subType:'华为',trackSerial:true,warehouseId:'wh-a',warehouseName:'A仓·手机数码',salePrice:2399,costPrice:9999,active:true,stockManaged:true}],inventory:[{skuId:'phone',warehouseId:'wh-a',warehouseName:'A仓·手机数码',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]}],suppliers:[{id:'sup',name:'测试供货商'}],purchases:[{id:'JH-UI-1',supplierId:'sup',createdAt:'2026-10-09T20:30:00.000Z',status:'已入库',items:[{id:'PI-1',skuId:'phone',quantity:1,costPrice:1800,serials:['869000000001234']}]}]});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),out=path.resolve('artifacts/interface-redesign-20261010/ui');fs.mkdirSync(out,{recursive:true});
const beforeHTML=fs.readFileSync('artifacts/interface-redesign-20261010/before/web/feishu-mobile.html','utf8'),destinations=[...beforeHTML.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
let browser;const checks=[],errors=[],overflow=[],assetErrors=[],writes=[];const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log('PASS',name)}catch(e){checks.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message)}};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 async function open(actor,width,size='double',route='/m'){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<=700,hasTouch:width<=700});context.setDefaultTimeout(7000);await context.addCookies([{name:'erp_session',value:sessions.issue(actor.id),url:origin}]);
  await context.addInitScript(size=>localStorage.setItem('store-mobile-text-size',size),size);
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();if(r.request().method()==='POST'&&!['/api/assistant/ask','/api/copilot/sales-review'].includes(u.pathname)){writes.push(u.pathname);return r.abort()}return r.continue()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))assetErrors.push(r.url())});await page.goto(origin+route,{waitUntil:'networkidle'});return{page,context};
 }
 for(const [width,size]of [[320,'double'],[390,'double'],[390,'large'],[700,'double'],[1280,'desktop']]){
  const {page,context}=await open(owner,width,size);
  try{
   await check(width+' '+size+' home, original destinations and theme',async()=>{
    await page.waitForFunction(()=>document.querySelector('#identity').textContent.includes('测试老板'));
    assert.equal(await page.locator('[data-module]').count(),8);
    const actual=await page.locator('main a[href]').evaluateAll(els=>els.map(el=>el.getAttribute('href')));
    assert.ok(destinations.every(href=>actual.includes(href)),JSON.stringify(destinations.filter(h=>!actual.includes(h))));
    assert.equal(await page.locator('link[href^="/store-theme.css"]').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    assert.equal(await page.locator('#store-electronic-board').evaluate(el=>el.parentElement.id),'home-board-slot');
    const actions=await page.locator('.hero-actions>a').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right}}));assert.equal(actions[0].y,actions[1].y);assert.ok(actions[0].right<actions[1].x);
    if(width<=700)assert.ok(await page.locator('.module-label').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=24));
    await page.screenshot({path:path.join(out,'home-'+width+'-'+size+'.png'),fullPage:true});
   });
   await check(width+' '+size+' all modules preserve content and return path',async()=>{
    const modules=await page.locator('[data-module]').evaluateAll(els=>els.map(e=>e.id));
    for(const id of modules){
     const expected=await page.locator('#'+id+' .card').count();await page.locator('#'+id+'>summary').click();
     if(width<=700){assert.equal(await page.locator('#module-dialog').evaluate(e=>e.open),true);assert.equal(await page.locator('#module-dialog .card').count(),expected);
      assert.equal(await page.locator('#module-dialog').evaluate(e=>e.scrollWidth>e.clientWidth+2),false);
      if(width===390&&size==='double'&&id==='module-sales')await page.screenshot({path:path.join(out,'sales-menu.png')});
      await page.locator('#module-dialog-close').click();await page.waitForFunction(()=>!document.querySelector('#module-dialog').open);await page.waitForFunction(()=>!history.state?.homeModule);
     }else{assert.equal(await page.locator('#'+id).evaluate(e=>e.open),true);await page.locator('#'+id+'>summary').click()}
     assert.equal(await page.locator('#'+id+' .card').count(),expected);
    }
   });
   await check(width+' '+size+' usage instructions and help',async()=>{
    await page.getByRole('button',{name:'使用说明',exact:true}).click();await page.locator('.page-help-dialog').waitFor();assert.ok((await page.locator('.page-help-content').innerText()).includes('开销售单：'));await page.locator('.page-help-close').click();
   });
   await check(width+' '+size+' compact messages and original composer',async()=>{
    await page.locator('#comms-launcher.is-collapsed').waitFor();const r=await page.locator('#comms-launcher').boundingBox();assert.ok(r.height<=100);
    const launch=await page.locator('.assistant-float').boundingBox();assert.ok(r.x+r.width<=launch.x,'message strip and assistant overlap');
    await page.locator('#comms-mini-toggle').click();await page.locator('#comms-content').fill('改版后的消息草稿');await page.locator('#comms-mini-toggle').click();assert.equal(await page.locator('#comms-content').inputValue(),'改版后的消息草稿');
    await page.locator('#comms-preview-open').click();assert.equal(await page.locator('#comms-content').isEditable(),true);assert.equal(await page.locator('#comms-content').inputValue(),'改版后的消息草稿');
    await page.locator('#comms-size').click();assert.equal(await page.locator('#comms-content').inputValue(),'改版后的消息草稿');await page.locator('#comms-close').click();
   });
   if(width===390&&size==='double')await check('home search opens real serial tracking results',async()=>{
    await page.locator('#home-search-input').fill('1234');await page.locator('.home-search button').click();await page.waitForURL('**/search?q=1234');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('找到'));
    assert.equal(await page.locator('#query [name=q]').inputValue(),'1234');await page.getByText('869000000001234',{exact:false}).first().waitFor();await page.screenshot({path:path.join(out,'search.png'),fullPage:false});
   });
  }finally{await context.close()}
 }
 await check('staff menus retain procurement and payroll details; owner entries stay hidden',async()=>{
  const {page,context}=await open(staff,390);
  try{await page.waitForFunction(()=>document.getElementById('identity').textContent.includes('测试营业员'));await page.locator('#module-purchase>summary').click();assert.equal(await page.locator('#module-dialog a[href="/app?tab=purchase"]').isVisible(),true);await page.locator('#module-dialog-close').click();await page.waitForFunction(()=>!history.state?.homeModule);await page.locator('#module-payroll>summary').click();assert.equal(await page.locator('#module-dialog a[href*="view=manage"]').isVisible(),false);assert.equal(await page.locator('#module-dialog a[href*="view=details"]').isVisible(),true)}finally{await context.close()}
 });
 await check('customer assistant stays free of internal messages and costs',async()=>{
  const {page,context}=await open(guest,390,'double','/assistant?mode=customer');
  try{assert.equal(await page.locator('#comms-launcher').count(),0);assert.equal(await page.locator('link[href^="/store-theme.css"]').count(),1);assert.equal(await page.locator('#mode-store').isVisible(),false)}finally{await context.close()}
 });
 await check('application forms and key pages use the shared theme without overflow',async()=>{
  const {page,context}=await open(owner,390);try{
   const routes=['/app?tab=sales','/app?tab=purchase','/app?tab=inventory','/app?tab=products','/app?tab=suppliers','/app?tab=finance','/app?tab=payroll&view=manage','/app?tab=payroll&view=details','/app?tab=logs','/receptions','/assistant?mode=store','/search','/carrier','/subsidy','/close','/daily-close','/funds','/cash-handover','/sale-payments','/knowledge','/knowledge-review','/learning','/work-journal','/brain','/notices','/qr'];
   for(const route of routes){await page.goto(origin+route,{waitUntil:'networkidle'});assert.equal(await page.locator('link[href^="/store-theme.css"]').count(),1,route);
    const over=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);if(over)overflow.push(route);
    if(['/app?tab=sales','/app?tab=inventory','/receptions','/assistant?mode=store'].includes(route))await page.screenshot({path:path.join(out,route.replace(/[^a-z0-9]/gi,'_')+'.png'),fullPage:false});
   }
   assert.deepEqual(overflow,[]);
  }finally{await context.close()}
 });

 await check('inventory rows preserve serial, original source, filters and operations',async()=>{
  const {page,context}=await open(owner,320,'double','/app?tab=inventory');
  try{
   const card=page.locator('.inventory-phone-unit');assert.equal(await card.count(),1);
   assert.equal(await card.locator('.inventory-phone-serial').innerText(),'869000000001234');
   assert.equal(await card.locator('.inventory-phone-warehouse').innerText(),'A');
   assert.ok((await card.locator('.inventory-phone-origin').innerText()).includes('测试供货商'));
   assert.ok((await card.locator('.inventory-phone-origin').innerText()).includes('2026/10/10'),'purchase date uses Shanghai timezone');
   assert.ok((await card.locator('.inventory-phone-cost').innerText()).includes('1800.00'),'actual device cost, never catalog cost');
   assert.equal(await card.locator('.inventory-phone-serial').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'full serial fits 320px');
   assert.equal(await page.locator('input[type=date]').count(),0,'inventory has no purchase-date search requirement');
   assert.equal(await page.locator('#inventory-category').isVisible(),false);
   await page.locator('.inventory-extra-filters>summary').click();assert.equal(await page.locator('#inventory-category').isVisible(),true);
   await page.locator('#inventory-category').selectOption('智能机');assert.equal(await card.count(),1);
   await page.locator('#inventory-supplier').selectOption('sup');assert.equal(await card.count(),1);
   await page.locator('#inventory-warehouse').selectOption('wh-a');assert.equal(await card.count(),1);
   await page.locator('#inventory-query').fill('1234');assert.equal(await card.count(),1);
   await page.locator('#inventory-query').fill('no-such-device');assert.equal(await card.count(),0);
   await page.locator('#inventory-clear').click();assert.equal(await card.count(),1);
   await card.locator('.inventory-more>summary').click();
   assert.equal(await card.locator('[data-action=stocktake]').isVisible(),true);
   assert.equal(await card.locator('[data-action=price-request]').isVisible(),true);
   assert.equal(await card.locator('a[href*="scope=serials"]').getAttribute('href'),'/search?scope=serials&q=869000000001234');
   await card.locator('[data-action=stocktake]').click();await page.locator('#inventory-count-dialog[open]').waitFor();
   assert.equal(await page.locator('#inventory-count-input').isEditable(),true);await page.locator('#inventory-count-cancel').click();
   await card.locator('.inventory-more>summary').click();await card.scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,'inventory-320.png'),fullPage:false});
   await page.setViewportSize({width:390,height:1000});await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'inventory-390.png'),fullPage:false});
  }finally{await context.close()}
 });
 await check('sales scanner first; manual selection and optional fields retain values',async()=>{
  const {page,context}=await open(owner,390,'double','/app?tab=sales');
  try{
   assert.equal(await page.locator('#sale-picker-serial').getAttribute('aria-selected'),'true');
   assert.equal(await page.locator('#sale-camera-button').isVisible(),true);assert.equal(await page.locator('#sale-photo-button').isVisible(),true);
   assert.equal(await page.locator('#sale-product-select').isVisible(),false);
   assert.equal(await page.locator('#sale-item-feedback').isVisible(),false,'empty form has no premature red error');
   const camera=await page.locator('#sale-camera-button').boundingBox();assert.ok(camera.y+camera.height<1000);
   await page.locator('#sale-picker-product').click();assert.equal(await page.locator('#sale-product-select').isVisible(),true);
   await page.locator('#sale-product-select').selectOption('phone');await page.locator('#modal-form').waitFor();
   assert.equal(await page.locator('#modal-form [name=salePrice]').inputValue(),'2399.00');
   await page.locator('#modal-serial-input').fill('869000000001234');await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});
   await page.locator('#sale-picker-serial').click();assert.equal(await page.locator('#sale-product-select').isVisible(),false);
   const details=page.locator('#sale-step-customer');assert.equal(await details.evaluate(el=>el.open),false);
   await details.locator('summary').click();await page.locator('#sale-checkout [name=customerName]').fill('界面验收顾客');
   await details.locator('summary').click();assert.equal(await page.locator('#sale-checkout [name=customerName]').inputValue(),'界面验收顾客');
   assert.equal(await page.locator('#sale-checkout [name=saleMode]').isVisible(),true);
   await page.locator('#sale-checkout [name=saleMode]').selectOption('guobu');assert.equal(await page.locator('#gov-fields').isVisible(),true);
   await page.locator('#sale-checkout [name=saleMode]').selectOption('ordinary');assert.equal(await page.locator('#gov-fields').isVisible(),false);
   await details.locator('summary').click();await page.locator('#sale-checkout [name=customerPhone]').fill('123');await details.locator('summary').click();
   await page.evaluate(()=>document.getElementById('sale-checkout').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));
   assert.equal(await details.evaluate(el=>el.open),true,'submission expands the field needing correction');assert.equal(await page.locator('#sale-submit-feedback').isVisible(),true);
   await page.locator('#sale-checkout [name=customerPhone]').fill('');await details.locator('summary').click();
   await page.goto(origin+'/app?tab=sales',{waitUntil:'networkidle'});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'sales-start-390.png'),fullPage:false});
  }finally{await context.close()}
 });

 assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);assert.deepEqual(writes,[]);
}finally{
 const result={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,failed:result.failed,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length}));if(result.failed||errors.length||overflow.length||assetErrors.length||writes.length)process.exitCode=1;
 await browser?.close();await new Promise(r=>server.close(r));repo.closeStore?.();sessions.close?.();
}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
