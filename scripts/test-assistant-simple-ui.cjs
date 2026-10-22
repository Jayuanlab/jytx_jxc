// Assistant layout verification: isolated ledger, synthetic accounts, no real microphone or production writes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'assistant-simple-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),owner={id:'owner',name:'测试老板',role:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试店员',roleCode:'employee',status:'active',permissions:['sale:create']},kiosk={id:'customer',name:'顾客接待',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff,kiosk]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),{createServer}=require('../server/src/application');
const output=path.resolve('artifacts/payroll-management'),passes=[],errors=[],writes=[],external=[],sizes=[];
let browser;const server=createServer();
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,before=JSON.stringify(repo.readStore());
try{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});fs.mkdirSync(output,{recursive:true});
async function open(user,width=390,size='double',hash=''){
 const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<700,hasTouch:width<700});context.setDefaultTimeout(7000);await context.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);await context.addInitScript(size=>localStorage.setItem('store-mobile-text-size',size),size);
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(req.url());return route.abort();}if(req.method()==='POST'&&url.pathname!=='/api/assistant/ask'){writes.push(url.pathname);return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/assistant'+hash);await page.waitForFunction(()=>me!==null);await page.waitForLoadState('networkidle');return {context,page};
}
for(const[width,size]of[[320,'double'],[320,'large'],[390,'double'],[390,'large'],[1280,'desktop']]){
 const{context,page}=await open(owner,width,size);try{
 assert.equal(await page.locator('#assistant-tools').evaluate(n=>n.open),false);assert.equal(await page.locator('#quick').isVisible(),false);assert.equal(await page.locator('#capability-directory').isVisible(),false);assert.equal(await page.locator('#attendance-panel').isVisible(),false);assert.equal(await page.locator('#phrase-panel').isVisible(),false);
 assert.equal(await page.locator('#voice-start').isVisible(),true);assert.equal(await page.locator('#question').isVisible(),true);assert.equal(await page.locator('#ask .primary').isVisible(),true);
 assert.equal(await page.locator('#assistant-reply-options').evaluate(n=>n.open),false);assert.equal(await page.locator('#customer-reply-style').isVisible(),false);
 await page.locator('#question').fill('待输入的业务问题');const micTop=await page.locator('#voice-start').evaluate(n=>n.getBoundingClientRect().top);assert.ok(micTop<500,'microphone appears first');
 await page.locator('h2 [data-help-all]').click();await page.locator('#page-help-dialog').waitFor();assert.match(await page.locator('#page-help-dialog').innerText(),/常用功能与设置|直接说话/);await page.locator('#page-help-dialog button').filter({hasText:'关闭'}).first().click();assert.equal(await page.locator('#question').inputValue(),'待输入的业务问题');
 await page.locator('#assistant-tools>summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#quick').isVisible(),true);assert.equal(await page.locator('#dialogue-shortcut').isVisible(),true);await page.locator('#dialogue-shortcut').click();assert.equal(await page.locator('#dialogue-panel').isVisible(),true);
 await page.locator('#assistant-tools>summary').click();assert.equal(await page.locator('#question').inputValue(),'待输入的业务问题');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);sizes.push({width,size,microphoneTop:micTop,overflow:false});if(width===390&&size==='double'){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'assistant-simple-mobile.png')});}
 passes.push(width+' '+size+' conversation first, shortcuts collapsed, help and edits preserved');
 }finally{await context.close();}
}
for(const hash of['#dialogue-panel','#phrase-panel']){const{context,page}=await open(owner,390,'double',hash);assert.equal(await page.locator('#assistant-tools').evaluate(n=>n.open),true);assert.equal(await page.locator(hash).isVisible(),true);await context.close();}passes.push('direct editing links reveal folded tools');
const same=await open(owner);for(const hash of['#dialogue-panel','#phrase-panel']){
 await same.page.evaluate(hash=>location.hash=hash,hash);await same.page.waitForFunction(()=>document.querySelector('#assistant-tools').open);assert.equal(await same.page.locator(hash).isVisible(),true);await same.page.locator('#assistant-tools>summary').click();
 await same.page.evaluate(hash=>{const a=document.createElement('a');a.href=location.pathname+location.search+hash;document.body.append(a);a.click();a.remove();},hash);assert.equal(await same.page.locator('#assistant-tools').evaluate(n=>n.open),true);await same.page.locator('#assistant-tools>summary').click();
}await same.context.close();passes.push('same-page hash navigation and repeated source links reveal folded editors');
const own=await open(owner);await own.page.locator('#auto-voice').uncheck();await own.page.locator('#assistant-tools>summary').click();await own.page.locator('#quick [data-q="系统现在能做什么"]').click();await own.page.locator('#answer').waitFor();assert.ok((await own.page.locator('#answer').innerText()).length>0);await own.page.locator('#mode-customer').click();assert.equal(await own.page.locator('#result').isVisible(),false);assert.equal(await own.page.locator('#answer').innerText(),'');assert.equal(await own.page.locator('#capability-panel').isVisible(),false);assert.equal(await own.page.locator('#quick [data-q="系统现在能做什么"]').isVisible(),false);await own.context.close();passes.push('shortcut queries still work and customer mode clears internal data');
for(const user of[staff,kiosk]){const{context,page}=await open(user);await page.locator('#assistant-tools>summary').click();assert.equal(await page.locator('#dialogue-shortcut').isVisible(),false);assert.equal(await page.locator('#dialogue-panel').isVisible(),false);if(user===kiosk){assert.equal(await page.locator('#mode-store').isVisible(),false);assert.equal(await page.locator('#capability-panel').isVisible(),false);}await context.close();}passes.push('staff editing permissions and fixed customer mode preserved');
assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);assert.equal(JSON.stringify(repo.readStore()),before);passes.push('zero browser errors, external requests or business writes');
fs.writeFileSync(path.join(output,'assistant-simple-report.json'),JSON.stringify({passed:passes.length,failed:0,passes,sizes,errors,writes,external,ledgerUnchanged:true},null,2));console.log('Assistant cleanup:',passes.length,'passed, 0 failed');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(folder)}})().catch(error=>{console.error(error);process.exitCode=1});
