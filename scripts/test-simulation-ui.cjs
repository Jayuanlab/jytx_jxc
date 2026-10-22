'use strict';
require('./simulation-preload.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.STORE_SEED_PATH=path.resolve('artifacts/simulation-20261010/seed.json');
const seed=JSON.parse(fs.readFileSync(process.env.STORE_SEED_PATH)),refs=seed.simulationBatches[0].summary.refs;
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer();
const out=path.resolve('artifacts/simulation-20261010/ui');fs.mkdirSync(out,{recursive:true});
const passed=[],views=[],errors=[];let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  async function open(user,width=390,route='/assistant?mode=store'){
   const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});context.setDefaultTimeout(10000);
   await context.addCookies([{name:'erp_session',value:sessions.issue(user),url:origin}]);await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push({url:page.url(),error:e.message}));
   await page.goto(origin+route,{waitUntil:'networkidle'});return{page,context};
  }
  async function say(page,q){await page.locator('#question').fill(q);await page.locator('#ask .primary').click();await page.waitForFunction(()=>typeof voiceBusy==='undefined'||(!voiceBusy&&!document.getElementById('result').hidden));}
  for(const width of [390,320]){
   const {page,context}=await open('demo-clerk',width);await page.waitForFunction(()=>me!=null);await page.locator('#auto-voice').uncheck();const before=JSON.stringify(repo.readStore());let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/sale-orders'))writes++});
   await say(page,'卖了一台华为手机，帮我开单。');assert.equal(await page.evaluate(()=>saleFlow.stage),'serial');assert.match(await page.locator('#answer').inputValue(),/后四位/);
   await say(page,'1234');assert.equal(await page.evaluate(()=>saleFlow.stage),'price');assert.equal(await page.evaluate(()=>saleFlow.product.subType),'华为');
   await say(page,'2399元');await say(page,'模拟顾客');await say(page,'13900001099');await say(page,'没有附件');await say(page,'现金');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');assert.equal(await page.evaluate(()=>draft.serialNo),refs.practiceSerial);
   await page.locator('#result').screenshot({path:path.join(out,'sale-flow-review-'+width+'.png')});assert.equal(writes,0);assert.equal(JSON.stringify(repo.readStore()),before);
   await say(page,'去核对');await page.waitForURL(origin+'/app?tab=sales');await page.locator('#modal-form').waitFor();
   assert.equal(await page.locator('#modal-form [name=serialNo]').inputValue(),refs.practiceSerial);
   assert.equal(await page.locator('#modal-form [name=salePrice]').inputValue(),'2399.00');assert.equal(await page.locator('#sale-checkout [name=customerPhone]').inputValue(),'13900001099');
   assert.equal(writes,0);passed.push(width+'px：简单开单句→串号1234→售价→顾客→附件→收款→原销售页面核对，不自动提交');await context.close();
  }
  const opened=await open('demo-owner');const page=opened.page;await page.locator('#auto-voice').uncheck();
  for(const [q,pattern]of [['今天卖了多少台手机',/卖出 3 台.*退货 1 台.*净售 2 台/],['今天的营业额是多少',/4476|7175/],['核算今天的销售毛利',/1236/],['查华为的库存，我要串号',/1234/]]){
   await page.locator('#new-topic').click();await say(page,q);assert.match(await page.locator('#answer').inputValue(),pattern,q);passed.push('数字助理：'+q+'，与真实模拟单据核对一致');
  }
  for(const url of ['/m','/app?tab=inventory','/app?tab=purchase','/app?tab=orders','/app?tab=suppliers','/app?tab=payroll','/app?tab=logs','/receptions','/sale-payments','/gift-approvals','/close','/daily-close','/search','/assistant?mode=customer']){
   await page.goto(origin+url,{waitUntil:'networkidle'});const info=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.querySelector('main')?.innerText.slice(0,90)||'',style:!!document.querySelector('link[href^="/readable-ui.css"]')}));
   views.push({url,...info});assert.ok(info.style,url+' font');assert.equal(info.overflow,false,url+' overflow');
   if(['/app?tab=inventory','/app?tab=suppliers','/app?tab=payroll','/receptions'].includes(url))await page.screenshot({path:path.join(out,url.replace(/[^a-z0-9]/gi,'_')+'.png')});
   if(url==='/app?tab=logs'){await page.locator('[data-log-id]').first().click();await page.locator('#audit-dialog .audit-meta').waitFor();assert.ok(await page.locator('#audit-dialog .audit-meta').innerText());await page.locator('#audit-dialog>button').click();passed.push('有真实模拟业务的操作日志详情可打开');}
   if(url==='/search'){
    await page.locator('[data-search-mode=serials]').click();await page.locator('#query [name=q]').fill(refs.practiceSerial);await page.locator('#search-submit').click();await page.locator('#serial-trace').filter({hasText:refs.practiceSerial}).waitFor();assert.match(await page.locator('#serial-trace').innerText(),/模拟手机供货商/);
    await page.locator('[data-search-mode=invoices]').click();await page.locator('#query [name=q]').fill('SIM-SALE-INV-001');await page.locator('#search-submit').click();await page.locator('#results').filter({hasText:refs.sales[0]}).waitFor();passed.push('综合查询在手机上能查到完整串号来源与发票原单');
   }
   if(url.includes('mode=customer')){await page.waitForFunction(()=>me!=null);await page.locator('#auto-voice').uncheck();await say(page,'今天销售毛利是多少');assert.doesNotMatch(await page.locator('#answer').inputValue(),/1236|1800|4476/);assert.equal(await page.locator('#answer').isEditable(),false);passed.push('顾客模式拒绝内部账务、成本及编辑入口');}
  }
  await opened.context.close();assert.deepEqual(errors,[]);
  const result={checkedAt:new Date().toISOString(),passed:passed.length,checks:passed,views,pageErrors:errors,financialWrites:0};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));sessions.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
