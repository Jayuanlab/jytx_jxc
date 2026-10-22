'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Module=require('node:module');const load=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:load.call(this,n,...args)};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'interface-ui-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),comm=require('../server/src/store-communication'),owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active'},guest={id:'guest',name:'顾客',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const seed=c.initialize({users:[owner,staff,guest],products:[{skuId:'phone',name:'华为 Mate60 128GB',type:'智能手机',subType:'华为',trackSerial:true,warehouseId:'wh-a',warehouseName:'A仓·手机数码',salePrice:2399,costPrice:9999,active:true,stockManaged:true}],inventory:[{skuId:'phone',warehouseId:'wh-a',warehouseName:'A仓·手机数码',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]}],suppliers:[{id:'sup',name:'测试供货商'}],purchases:[{id:'JH-UI-1',supplierId:'sup',createdAt:'2026-10-09T20:30:00.000Z',status:'已入库',items:[{id:'PI-1',skuId:'phone',quantity:1,costPrice:1800,serials:['869000000001234']}]}]});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),out=path.resolve('artifacts/system-management-20261010/home');fs.mkdirSync(out,{recursive:true});
const beforeHTML=fs.readFileSync('artifacts/interface-redesign-20261010/before/web/feishu-mobile.html','utf8'),destinations=[...beforeHTML.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
let browser;const checks=[],errors=[],overflow=[],assetErrors=[],writes=[];const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log('PASS',name)}catch(e){checks.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message)}};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 async function open(actor,width,size='double',route='/m',count=19,branchName='聚友通信城'){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<=700,hasTouch:width<=700});context.setDefaultTimeout(7000);await context.addCookies([{name:'erp_session',value:sessions.issue(actor.id),url:origin}]);
  await context.addInitScript(size=>localStorage.setItem('store-mobile-text-size',size),size);
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();
   if(u.pathname==='/api/organization')return r.fulfill({json:{enabled:true,currentBranchId:'branch-one',branches:[{id:'branch-one',code:'001',name:branchName}],canManage:actor.roleCode==='owner'}});
   if(u.pathname==='/api/workbench')return r.fetch().then(async response=>{const data=await response.json();return r.fulfill({response,json:{...data,pendingCount:count,followups:0}})});
   if(u.pathname==='/api/ui-branch-probe')return r.fulfill({json:{branch:r.request().headers()['x-store-branch']}});
   if(r.request().method()==='POST'&&!['/api/assistant/ask','/api/copilot/sales-review'].includes(u.pathname)){writes.push(u.pathname);return r.abort()}return r.continue()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))assetErrors.push(r.url())});await page.goto(origin+route,{waitUntil:'networkidle'});await page.addScriptTag({url:origin+'/branch-context.js'});await page.waitForFunction(()=>document.querySelector('[data-home-branch]')?.dataset.branchId==='branch-one'||document.querySelector('#branch-context'));return{page,context};
 }

 for(const [width,size,actor] of [[320,'double',owner],[360,'double',owner],[390,'double',owner],[430,'double',owner],[640,'double',owner],[700,'double',owner],[1280,'desktop',owner],[390,'large',staff]]){
  const {page,context}=await open(actor,width,size);
  try{
   await page.waitForFunction(actor=>document.querySelector('#identity').textContent===actor.name,actor);
   await check(width+' '+size+' single header and retained controls',async()=>{
    assert.equal(await page.locator('#branch-context').count(),0);
    assert.equal(await page.locator('.home-title').count(),0);
    assert.equal(await page.locator('main h1').count(),1);
    assert.equal(await page.locator('[data-home-branch-name]').innerText(),'聚友通信城');
    assert.equal(await page.locator('[data-home-branch]').getAttribute('href'),'/organization');
    assert.ok((await page.locator('[data-home-branch]').getAttribute('aria-label')).includes('001 聚友通信城'));
    assert.ok((await page.locator('#identity').getAttribute('aria-label')).includes(actor.roleCode==='owner'?'老板':'员工'));
    const parts=await page.locator('.home-header .hero-top>*').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return{top:b.top,bottom:b.bottom,left:b.left,right:b.right}}));
    for(let i=1;i<parts.length;i++){assert.ok(parts[i].left>=parts[i-1].right+5);assert.ok(Math.min(parts[i].bottom,parts[0].bottom)>Math.max(parts[i].top,parts[0].top));}
    assert.ok((await page.locator('.home-header').boundingBox()).height<=56);
    await page.locator('.home-help').click();assert.equal(await page.locator('#page-help-dialog').evaluate(el=>el.open),true);await page.locator('#page-help-dialog .page-help-close').click();
   });
   await check(width+' '+size+' shorter assistant and separated summary tiles',async()=>{
    const widths=await page.locator('main.wrap').evaluate(main=>({inner:main.clientWidth-parseFloat(getComputedStyle(main).paddingLeft)-parseFloat(getComputedStyle(main).paddingRight),assistant:main.querySelector('.assistant-entry').getBoundingClientRect().width,gap:parseFloat(getComputedStyle(main.querySelector('.dashboard')).columnGap)}));
    assert.ok(widths.assistant<=widths.inner*.51,JSON.stringify(widths));assert.ok(widths.gap>=56);
    assert.equal(await page.locator('#pending-count').innerText(),'19');
    assert.equal(await page.locator('.dashboard .stat:visible').count(),actor.roleCode==='owner'?4:3);
    const cells=await page.locator('.dashboard .stat:visible').evaluateAll(els=>els.map(el=>{
     const b=el.getBoundingClientRect(),label=el.querySelector('span'),number=el.querySelector('strong'),r=label.getBoundingClientRect(),n=number.getBoundingClientRect();
     return {font:parseFloat(getComputedStyle(label).fontSize),overflow:el.scrollWidth>el.clientWidth+1,inside:r.left>=b.left&&r.right<=b.right&&r.bottom<=b.bottom&&r.top>=b.top,overlap:getComputedStyle(number).display!=='none'&&r.right>n.left-1};
    }));
    for(const cell of cells){assert.ok(cell.font>=28,JSON.stringify(cell));assert.equal(cell.overflow,false,JSON.stringify(cell));assert.equal(cell.inside,true,JSON.stringify(cell));assert.equal(cell.overlap,false,JSON.stringify(cell));}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    assert.equal(await page.locator('.assistant-entry').getAttribute('href'),'/assistant');
    const actual=await page.locator('main a[href]').evaluateAll(els=>els.map(el=>el.getAttribute('href')));assert.ok(destinations.filter(h=>h!=='/m').every(h=>actual.includes(h)));
    const primary=await page.locator('.home-module>summary').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect(),l=el.querySelector('.module-label'),r=l.getBoundingClientRect();return{font:parseFloat(getComputedStyle(l).fontSize),icon:el.querySelector('svg').getBoundingClientRect().width,inside:r.left>=b.left&&r.right<=b.right-3&&r.top>=b.top&&r.bottom<=b.bottom-3,clipped:l.scrollWidth>l.clientWidth+1,fitsCard:b.right<=el.parentElement.getBoundingClientRect().right&&b.left>=el.parentElement.getBoundingClientRect().left}}));
    for(const tile of primary){assert.ok(tile.font>=30);assert.ok(tile.icon>=48);assert.equal(tile.inside,true,JSON.stringify(tile));assert.equal(tile.clipped,false,JSON.stringify(tile));assert.equal(tile.fitsCard,true,JSON.stringify(tile));}
    await page.screenshot({path:path.join(out,'home-'+width+'-'+size+'-'+actor.id+'.png'),fullPage:true});
    await page.locator('#pending-shortcut').click();assert.equal(await page.locator('#pending-details').evaluate(el=>el.open),true);
    await page.locator('#module-sales>summary').click();
    if(width<=700){assert.equal(await page.locator('#module-dialog').evaluate(el=>el.open),true);await page.locator('#module-dialog-close').click();await page.waitForFunction(()=>!history.state?.homeModule)}
    const branch=await page.evaluate(async()=>{const res=await fetch('/api/ui-branch-probe',{method:'POST',body:'{}'});return(await res.json()).branch});assert.equal(branch,'branch-one');
   });
  }finally{await context.close()}
 }
 await check('long store name and larger pending count remain contained',async()=>{
  const {page,context}=await open(owner,390,'double','/m',1234,'聚友通信城南溪新场镇特许经营店');
  try{
   await page.waitForFunction(()=>document.querySelector('#identity').textContent==='测试老板');
   assert.ok((await page.locator('[data-home-branch]').getAttribute('aria-label')).includes('聚友通信城南溪新场镇特许经营店'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(await page.locator('#pending-count').innerText(),'1234');
   assert.equal(await page.locator('#pending-shortcut').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   assert.equal(await page.locator('#pending-shortcut').evaluate(el=>el.classList.contains('wide-count')),true);
   assert.ok(await page.locator('#pending-label').evaluate(el=>el.getBoundingClientRect().width>=parseFloat(getComputedStyle(el).fontSize)*2));

   await page.screenshot({path:path.join(out,'home-long-name.png'),fullPage:true});
  }finally{await context.close()}
 });
 await check('branch selector remains unchanged on other pages',async()=>{
  const {page,context}=await open(owner,390,'double','/search');
  try{
   assert.equal(await page.locator('#branch-context').count(),1);
   assert.ok((await page.locator('#branch-context').innerText()).includes('当前门店：001 聚友通信城'));
   assert.equal(await page.locator('#branch-context a').getAttribute('href'),'/organization');
  }finally{await context.close()}
 });
 assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);assert.deepEqual(writes,[]);
}finally{
 const result={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,failed:result.failed,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length}));if(result.failed||errors.length||overflow.length||assetErrors.length||writes.length)process.exitCode=1;
 await browser?.close();await new Promise(r=>server.close(r));repo.closeStore?.();sessions.close?.();
}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
