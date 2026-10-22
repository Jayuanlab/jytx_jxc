'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Module=require('node:module');const load=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:load.call(this,n,...args)};
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'interface-ui-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),comm=require('../server/src/store-communication'),owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active'},guest={id:'guest',name:'顾客',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const seed=c.initialize({users:[owner,staff,guest],products:[{skuId:'phone',name:'华为 Mate60 128GB',type:'智能手机',subType:'华为',trackSerial:true,warehouseId:'wh-a',warehouseName:'A仓·手机数码',salePrice:2399,costPrice:9999,active:true,stockManaged:true}],inventory:[{skuId:'phone',warehouseId:'wh-a',warehouseName:'A仓·手机数码',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]}],suppliers:[{id:'sup',name:'测试供货商'}],purchases:[{id:'JH-UI-1',supplierId:'sup',createdAt:'2026-10-09T20:30:00.000Z',status:'已入库',items:[{id:'PI-1',skuId:'phone',quantity:1,costPrice:1800,serials:['869000000001234']}]}]});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer(),out=path.resolve('artifacts/interface-cards-20261010/ui');fs.mkdirSync(out,{recursive:true});
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

 for(const width of [320,360,390,430,700,820,1280]){
  const {page,context}=await open(owner,width,width<=700?'double':'desktop');
  try{
   await page.waitForFunction(()=>document.querySelector('#identity').textContent.includes('测试老板'));
   await check(width+' wide tiles and larger readable artwork',async()=>{
    const geometry=await page.locator('.home-module>summary').evaluateAll(els=>els.map(el=>{
     const b=el.getBoundingClientRect(),label=el.querySelector('.module-label'),icon=el.querySelector('.module-icon svg'),t=label.getBoundingClientRect(),i=icon.getBoundingClientRect();
     return {ratio:b.width/b.height,width:b.width,height:b.height,font:parseFloat(getComputedStyle(label).fontSize),icon:i.width,clipped:label.scrollWidth>label.clientWidth+1||t.left<b.left||t.right>b.right-5||t.top<b.top||t.bottom>b.bottom-5,radius:getComputedStyle(el.parentElement).borderRadius};
    }));
    assert.equal(geometry.length,8);
    for(const item of geometry){
     assert.ok(item.ratio>=1.35&&item.ratio<=1.83,JSON.stringify(item));
     assert.ok(item.font>=28,JSON.stringify(item));
     assert.ok(item.icon>=44,JSON.stringify(item));
     assert.equal(item.clipped,false,JSON.stringify(item));assert.equal(item.radius,'12px');
    }
    const gap=await page.locator('.home-modules').evaluate(el=>parseFloat(getComputedStyle(el).columnGap));assert.ok(gap>=18);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    const actual=await page.locator('main a[href]').evaluateAll(els=>els.map(el=>el.getAttribute('href')));assert.ok(destinations.every(h=>actual.includes(h)));
    const actions=await page.locator('.hero-actions>a').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,height:b.height,width:b.width}}));assert.equal(actions[0].y,actions[1].y);assert.ok(actions[1].x-actions[0].right>=17.5,JSON.stringify(actions));
    await page.screenshot({path:path.join(out,'home-'+width+'.png'),fullPage:true});
    await page.locator('.home-modules').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'modules-'+width+'.png')});
   });
   await check(width+' all menu destinations remain usable',async()=>{
    for(const id of await page.locator('[data-module]').evaluateAll(els=>els.map(e=>e.id))){
     await page.locator('#'+id+'>summary').click();
     if(width<=700){
      assert.equal(await page.locator('#module-dialog').evaluate(el=>el.open),true);
      assert.equal(await page.locator('#module-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
      const font=await page.locator('#module-dialog .card strong').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(font>=36);
      const icon=await page.locator('#module-dialog .card .symbol svg').first().boundingBox();assert.ok(icon.width>=60);
      const cards=await page.locator('#module-dialog .card').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {ratio:b.width/b.height,overflow:el.scrollWidth>el.clientWidth+1}}));for(const item of cards){assert.ok(item.ratio<=1.84,JSON.stringify(item));assert.equal(item.overflow,false,JSON.stringify(item));}
      if(width===390&&id==='module-sales')await page.screenshot({path:path.join(out,'sales-menu-390.png')});
      await page.locator('#module-dialog-close').click();await page.waitForFunction(()=>!history.state?.homeModule);
     }else await page.locator('#'+id+'>summary').click();
    }
   });
  }finally{await context.close()}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);assert.deepEqual(writes,[]);
}finally{
 const result={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,failed:result.failed,pageErrors:errors,overflow,assetErrors,businessWrites:writes.length}));if(result.failed||errors.length||overflow.length||assetErrors.length||writes.length)process.exitCode=1;
 await browser?.close();await new Promise(r=>server.close(r));repo.closeStore?.();sessions.close?.();
}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
