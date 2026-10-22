'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'readable-ui-'));process.env.STORE_SEED_PATH=path.join(temp,'seed.json');
const c=require('../server/src/common'),owner={id:'owner',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active'};
const seed=c.initialize({users:[owner,staff],products:[{skuId:'h60',name:'华为 Mate60',type:'智能手机',subType:'华为',thirdType:'Mate60',trackSerial:true,warehouseId:'wh-sale',salePrice:2399,costPrice:1800,active:true,stockManaged:true}],suppliers:[{id:'sup',name:'测试手机供货商'}],inventory:[{skuId:'h60',warehouseId:'wh-sale',quantity:1,serials:[{no:'869000000001234',status:'可售',costPrice:1800}],costSources:[]}],operationLogs:[{id:'log-ui',operator:'测试老板',operatorId:'owner',action:'product:save',detail:'检查商品资料的显示字号',createdAt:new Date().toISOString()}]});
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(seed));
const sessions=require('../server/src/auth-sessions'),repo=require('../server/src/repository'),server=require('../server/src/application').createServer();
const output=path.resolve('artifacts/system-audit-20261010/typography');fs.mkdirSync(output,{recursive:true});
const routes=[...fs.readFileSync('server/src/application.js','utf8').matchAll(/"([^"]+)": \["[^"]+\.html", "text\/html; charset=utf-8"\]/g)].map(x=>x[1]);
const tabs=['inventory','sales','orders','purchase','suppliers','finance','reports','products','logs','payroll'];
const reports=[],errors=[];let browser;
async function inspect(page,url,variant,width){
 return page.evaluate(({url,variant,width})=>{
  const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!!el.getClientRects().length};
  const small=[];
  for(const el of document.querySelectorAll('main *,dialog[open] *')){
   if(!visible(el)||el.matches('option,[type=checkbox],[type=radio],canvas,svg')||el.closest('script,style,template'))continue;
   const hasText=Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim());
   const control=el.matches('input:not([type=hidden]),select,textarea,button');
   if(!hasText&&!control)continue;
   const size=parseFloat(getComputedStyle(el).fontSize);
   if(size<24)small.push({tag:el.tagName,id:el.id,classes:el.className,font:size,text:(el.value||el.innerText||'').slice(0,65)});
  }
  return {url,variant,width,sharedStyle:!!document.querySelector('link[href^="/readable-ui.css"]'),rootClass:document.documentElement.className,overflow:document.documentElement.scrollWidth>innerWidth+2,small};
 },{url,variant,width});
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  for(const width of [390,320]){
   const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});context.setDefaultTimeout(6000);
   await context.addCookies([{name:'erp_session',value:sessions.issue(owner.id),url:origin}]);
   await context.addInitScript(()=>localStorage.setItem('store-mobile-text-size','double'));
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push({url:page.url(),message:e.message}));
   try{
    for(const url of [...routes,...tabs.map(tab=>'/app?tab='+tab)]){
     await page.goto(origin+url,{waitUntil:'networkidle'});
     await page.evaluate(()=>{for(const details of document.querySelectorAll('main details'))if(!details.hidden)details.open=true});
     reports.push(await inspect(page,url,'double',width));
     if(width===390&&['/knowledge','/knowledge-review','/assistant','/login','/app?tab=sales'].includes(url))await page.screenshot({path:path.join(output,url.replace(/[^a-z0-9]/gi,'_')+'-'+width+'.png'),fullPage:false});
     if(url==='/assistant'){
      await page.locator('#auto-voice').uncheck();await page.locator('#question').fill('我找陈文琼');
      await page.locator('#ask .primary').click();await page.waitForFunction(()=>!document.getElementById('result').hidden);
      await page.locator('#answer').tap();await page.waitForFunction(()=>inlineDialogue!=null&&!answerEditLoad);
      await page.locator('#answer-edit-more').evaluate(el=>el.open=true);
      reports.push(await inspect(page,url+'#original-editor','double',width));
      await page.screenshot({path:path.join(output,'original-editor-'+width+'.png')});
      await page.locator('#answer-edit-cancel').click();
     }
     if(url==='/app?tab=logs'&&await page.locator('[data-log-id]').count()){
      await page.locator('[data-log-id]').first().click();await page.locator('#audit-dialog .audit-meta').waitFor();
      reports.push(await inspect(page,url+'#detail','double',width));await page.locator('#audit-dialog>button').click();
     }
    }
    // The previously missed pages follow the existing size toggle as well.
    for(const url of ['/knowledge','/knowledge-review']){
     await page.goto(origin+url,{waitUntil:'networkidle'});await page.locator('.text-size-toggle').click();
     assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('mobile-text-large')),true);
     await page.evaluate(()=>{for(const details of document.querySelectorAll('main details'))if(!details.hidden)details.open=true});
     reports.push(await inspect(page,url,'large',width));
     await page.locator('.text-size-toggle').click();
    }
   }finally{await context.close()}
  }
  const result={servedPages:routes.length,views:reports.length,reports,pageErrors:errors,financialWrites:0};
  fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(result,null,2));
  const issues=reports.filter(x=>x.small.length||x.overflow||!x.sharedStyle);
  console.log(JSON.stringify({servedPages:routes.length,views:reports.length,pageErrors:errors,issues:issues.map(x=>({...x,small:x.small.slice(0,4),smallCount:x.small.length}))},null,2));
  assert.equal(issues.length,0,'A page still has small text or horizontal overflow');assert.equal(errors.length,0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(temp)}
})().catch(error=>{console.error(error);process.exitCode=1});

