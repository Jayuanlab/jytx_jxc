'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Module=require('node:module');const load=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:load.call(this,n,...args)};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'interface-ui-'));process.env.STORE_BACKUP_DIR=path.join(folder,'backups');process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),comm=require('../server/src/store-communication'),owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active'},guest={id:'guest',name:'顾客',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const seed=c.initialize({users:[owner,staff,guest],products:[{skuId:'phone',name:'华为 Mate60 128GB',type:'智能手机',subType:'华为',trackSerial:true,warehouseId:'wh-a',warehouseName:'A仓·手机数码',salePrice:2399,costPrice:9999,active:true,stockManaged:true}],inventory:[{skuId:'phone',warehouseId:'wh-a',warehouseName:'A仓·手机数码',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]}],suppliers:[{id:'sup',name:'测试供货商'}],purchases:[{id:'JH-UI-1',supplierId:'sup',createdAt:'2026-10-09T20:30:00.000Z',status:'已入库',items:[{id:'PI-1',skuId:'phone',quantity:1,costPrice:1800,serials:['869000000001234']}]}]});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),out=path.resolve('artifacts/system-management-20261010/ui');fs.mkdirSync(out,{recursive:true});
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
   if(r.request().method()==='POST'&&!['/api/assistant/ask','/api/copilot/sales-review'].includes(u.pathname)){writes.push(u.pathname);return r.abort()}return r.continue()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))assetErrors.push(r.url())});await page.goto(origin+route,{waitUntil:'networkidle'});await page.addScriptTag({url:origin+'/branch-context.js'});if(new URL(page.url()).pathname!=='/login'&&actor.id!=='guest')await page.waitForFunction(()=>document.querySelector('[data-home-branch]')?.dataset.branchId==='branch-one'||document.querySelector('#branch-context'));return{page,context};
 }


 for(const [width,size,actor] of [[320,'double',owner],[390,'double',owner],[1280,'desktop',owner],[320,'double',staff],[390,'large',staff]]){
  const {page,context}=await open(actor,width,size);
  try{
   await page.waitForFunction(name=>document.querySelector('#identity').textContent===name,actor.name);
   await check(width+' '+actor.id+' management and payroll open together with correct permissions',async()=>{
    await page.locator('#module-payroll>summary').click();
    const content=width<=700?page.locator('#module-dialog-body'):page.locator('#module-payroll .module-content');
    if(width<=700)assert.equal(await page.locator('#module-dialog-title').innerText(),'管理中心');
    const visible=await content.locator('.card:visible strong').allTextContents();
    assert.deepEqual(visible,actor.id==='boss'?['工资管理','工资明细查询','员工与权限','账号与密码','门店管理','电子屏设置','门店消息','操作日志','备份与恢复','完整管理台']:['工资明细查询']);
    const geometry=await content.locator('.card:visible').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect(),l=el.querySelector('strong'),r=l.getBoundingClientRect(),i=el.querySelector('svg').getBoundingClientRect();return{font:parseFloat(getComputedStyle(l).fontSize),icon:i.width,inside:r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom,clipped:l.scrollWidth>l.clientWidth+1}}));
    for(const row of geometry){assert.ok(row.font>=28,JSON.stringify(row));assert.ok(row.icon>=44,JSON.stringify(row));assert.ok(row.inside,JSON.stringify(row));assert.equal(row.clipped,false,JSON.stringify(row));}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    if(width<=700){
     assert.ok(await page.locator('#module-dialog-body').evaluate(el=>el.scrollHeight>el.clientHeight)||actor.id!=='boss');
     await page.screenshot({path:path.join(out,'management-'+width+'-'+actor.id+'.png')});
     await page.goBack();await page.waitForFunction(()=>!document.querySelector('#module-dialog').open);
     await page.locator('#module-payroll>summary').click();
     await page.locator('#module-dialog-close').click();await page.waitForFunction(()=>!history.state?.homeModule);
    }else await page.locator('#module-payroll>summary').click();
   });
  }finally{await context.close()}
 }
 const destinationsToCheck=[
  ['工资管理','/app?tab=payroll&view=manage','#main h1','工资管理'],
  ['工资明细查询','/app?tab=payroll&view=details','#main h1','工资明细查询'],
  ['员工与权限','/app?tab=staff','#main h1','员工账号'],
  ['账号与密码','/login','#admin-panel h2','员工账号管理'],
  ['门店管理','/organization','#org-title','测试企业 · 门店管理'],
  ['电子屏设置','/m?panel=electronic-screen','#comms-title','电子屏'],
  ['门店消息','/notices','main h1','门店消息'],
  ['操作日志','/app?tab=logs','#main h1','操作日志'],
  ['备份与恢复','/app?tab=backup','#main h1','备份与恢复'],
  ['完整管理台','/app','#main h1','门店总览']
 ];
 for(const [label,href,selector,expected] of destinationsToCheck){
  await check('owner follows '+label+' and can use the destination controls',async()=>{
   const {page,context}=await open(owner,390);
   try{
    await page.waitForFunction(()=>document.querySelector('#identity').textContent==='测试老板');
    await page.locator('#module-payroll>summary').click();
    await page.locator('#module-dialog-body').getByRole('link',{name:label,exact:false}).click();
    await page.waitForURL(origin+href);await page.waitForLoadState('networkidle');
    await page.locator(selector).waitFor();assert.ok((await page.locator(selector).innerText()).includes(expected),await page.locator(selector).innerText());
    if(label==='员工与权限'){
     await page.getByRole('button',{name:'新增员工',exact:true}).click();
     await page.locator('#modal-root input[name=name]').fill('待新增员工草稿');
     assert.equal(await page.locator('#modal-root input[name=name]').inputValue(),'待新增员工草稿');
     await page.getByRole('button',{name:'取消',exact:true}).click();
    }
    if(label==='账号与密码'){await page.locator('#admin-form input[name=username]').fill('staff-demo');assert.equal(await page.locator('#admin-form input[name=username]').inputValue(),'staff-demo');}
    if(label==='门店管理'){assert.equal(await page.locator('#grant-section').isVisible(),true);assert.equal(await page.locator('#branch-select').inputValue(),'branch-one');}
    if(label==='电子屏设置'){
     await page.locator('#comms-publish [name=title]').fill('测试草稿');
     assert.equal(await page.locator('#comms-publish [name=title]').inputValue(),'测试草稿');
     await page.locator('#comms-time-preset').selectOption('custom');await page.locator('#comms-time-start').fill('09:30');await page.locator('#comms-time-end').fill('11:45');
     await page.locator('#comms-display-mode').selectOption('fixed');await page.locator('#comms-display-seconds').fill('30');
     assert.equal(await page.locator('#comms-time-start').inputValue(),'09:30');
     assert.equal(await page.locator('#comms-display-seconds').inputValue(),'30');
    }
   }finally{await context.close()}
  });
 }
 await check('employee sees own wages and cannot open boss management by direct links',async()=>{
  for(const [route,selector] of [['/app?tab=staff','#nav button[data-tab=dashboard].active'],['/app?tab=logs','#nav button[data-tab=dashboard].active'],['/app?tab=opening','#nav button[data-tab=dashboard].active'],['/app?tab=payroll&view=manage','#main h1'],['/login','#account-panel']]){
   const {page,context}=await open(staff,390,'double',route);
   try{
    await page.locator(selector).waitFor();
    if(route.includes('payroll')){
     assert.equal(await page.locator('#main h1').innerText(),'工资明细查询');
     assert.equal(await page.getByRole('button',{name:'底薪与提成规则',exact:true}).count(),0);
     const data=await page.evaluate(async()=>{const r=await fetch('/api/payroll?month=2026-10');return r.json()});
     assert.equal(data.canViewAll,false);assert.equal(data.canManage,false);
     assert.ok((data.rows||[]).every(row=>row.employeeId==='staff'));
    }
    if(route==='/login')assert.equal(await page.locator('#admin-panel').isVisible(),false);
   }finally{await context.close()}
  }
 });
 await check('known deep links select their pages and unknown tab remains on dashboard',async()=>{
  for(const [route,selector] of [['/app?tab=opening','#main h1'],['/app?tab=cards','#nav button[data-tab=cards].active'],['/app?tab=nonexistent','#nav button[data-tab=dashboard].active']]){
   const {page,context}=await open(owner,390,'double',route);
   try{await page.locator(selector).waitFor();if(route.includes('opening'))assert.equal(await page.locator(selector).innerText(),'期初导入')}finally{await context.close()}
  }
 });
 await check('guest account is redirected without staff or payroll management',async()=>{
  const {page,context}=await open(guest,390);
  try{await page.waitForURL('**/assistant**');const response=await page.request.get(origin+'/api/system/backups');assert.equal(response.status(),403);assert.equal(await page.locator('#module-payroll:visible').count(),0)}finally{await context.close()}
 });
 assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);assert.deepEqual(writes,[]);
}finally{
 const result={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,failed:result.failed,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length}));if(result.failed||errors.length||overflow.length||assetErrors.length||writes.length)process.exitCode=1;
 await browser?.close();await new Promise(r=>server.close(r));repo.closeStore?.();sessions.close?.();
}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
