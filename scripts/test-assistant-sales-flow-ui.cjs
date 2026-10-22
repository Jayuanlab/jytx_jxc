// Uses an isolated SQLite ledger and synthetic sessions. No production data or browser profile.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'assistant-sales-flow-'));process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'};
const product=(skuId,name,thirdType)=>({skuId,name,thirdType,type:'智能手机',subType:name.split(' ')[0],trackSerial:true,active:true,stockManaged:true,warehouseId:'wh-sale',warehouseName:'销售仓',salePrice:2399,costPrice:1800});
const products=[product('h60','华为 Mate 60 128GB','Mate 60'),product('h70','华为 Mate 70 256GB','Mate 70'),product('oppo','OPPO Reno 13 256GB','Reno 13')];
const stock=(skuId,no)=>({skuId,warehouseId:'wh-sale',warehouseName:'销售仓',quantity:1,serials:[{no,status:'可售',costPrice:1800}],costSources:[]});
const inventory=[stock('h60','869000000001234'),stock('h70','869000000011234'),stock('oppo','869000000002345')];
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner],products,inventory,sales:[],searchSynonyms:[{id:'s1',terms:['Mate 60','小华机']}]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),{createServer}=require('../server/src/application');
(async()=>{let browser;const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;const before=JSON.stringify(repo.readStore()),out=path.resolve('artifacts/assistant-sales-flow');fs.mkdirSync(out,{recursive:true});
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const open=async(width=390,size='double')=>{const ctx=await browser.newContext({viewport:{width,height:1000},isMobile:width<800,hasTouch:width<800});await ctx.addCookies([{name:'erp_session',value:sessions.issue(owner.id),url:origin}]);await ctx.addInitScript(size=>localStorage.setItem('store-mobile-text-size',size),size);const page=await ctx.newPage();await page.goto(origin+'/assistant?mode=store');await page.waitForFunction(()=>me?.id==='boss');await page.locator('#auto-voice').uncheck();return {ctx,page};};
 const say=(page,q)=>page.evaluate(q=>ask(q),q);
 for(const [width,size]of [[320,'double'],[390,'double'],[390,'large'],[700,'double'],[1280,'desktop']]){
  const {ctx,page}=await open(width,size),errors=[];page.on('pageerror',e=>errors.push(e.message));let saleWrites=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/sale-orders'))saleWrites++;});
  // Stated model limits serial lookup; reusing an ineligible model's serial must fail.
  await say(page,'卖出一台华为 Mate60 手机，帮我开单');assert.equal(await page.evaluate(()=>saleFlow.stage),'serial');
  await say(page,'869000000011234');assert.equal(await page.evaluate(()=>saleFlow.stage),'serial');assert.match(await page.locator('#answer').innerText(),/没有找到/);
  await say(page,'串号是869000000001234');assert.equal(await page.evaluate(()=>saleFlow.stage),'price');assert.match(await page.locator('#answer').innerText(),/2399/);
  await say(page,'1999.50元');assert.equal(await page.evaluate(()=>saleFlow.salePrice),1999.5);await say(page,'顾客叫张三');await say(page,'13800138000');await say(page,'没有附件');await say(page,'不是现金，是微信');
  assert.equal(await page.evaluate(()=>saleFlow.stage),'review');assert.equal(await page.evaluate(()=>draft.account),'微信');assert.equal(await page.evaluate(()=>draft.customerName),'张三');assert.equal(await page.evaluate(()=>draft.customerPhone),'13800138000');assert.equal(await page.evaluate(()=>draft.serialNo),'869000000001234');
  assert.doesNotMatch(await page.locator('#answer').innerText(),/869000|138001|查询时间/,'spoken summary concise');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'review layout '+width);
  if(width===390&&size==='double')await page.locator('#result').screenshot({path:path.join(out,'mobile-sale-review.png')});
  await say(page,'去核对');await page.waitForURL(origin+'/app?tab=sales');await page.locator('#modal-form').waitFor();
  assert.equal(await page.locator('#modal-form [name=salePrice]').inputValue(),'1999.50');assert.equal(await page.locator('#modal-form [name=serialNo]').inputValue(),'869000000001234');assert.equal(await page.locator('#sale-checkout [name=customerName]').inputValue(),'张三');assert.equal(await page.locator('#sale-checkout [name=account]').inputValue(),'微信');
  if(width===390&&size==='double')await page.screenshot({path:path.join(out,'mobile-price-handoff.png')});
  // A different selected product uses its own current catalog price, not the earlier suggestion.
  await page.locator('#modal-sale-select').selectOption('h70');assert.equal(await page.locator('#modal-form [name=salePrice]').inputValue(),'2399.00');
  assert.equal(saleWrites,0,'assistant cannot submit a sale');assert.deepEqual(errors,[]);await ctx.close();console.log('PASS',width,size,'exact model, full serial, negotiated price, human review and catalog-price reset');
 }
 const {ctx,page}=await open();
 await say(page,'卖一台华为手机，帮我开单');await say(page,'后四位幺二三四');assert.equal(await page.evaluate(()=>saleFlow.stage),'choose');assert.equal(await page.locator('#flow-choices button').count(),2);
 await say(page,'1234');assert.equal(await page.evaluate(()=>saleFlow.stage),'choose','duplicate tail cannot select arbitrarily');await say(page,'第二台');assert.equal(await page.evaluate(()=>saleFlow.product.skuId),'h70');assert.equal(await page.evaluate(()=>saleFlow.stage),'price');
 await page.locator('#new-topic').click();
 await say(page,'卖一台华为Mate60手机，串号后四位1234，售价1999元，顾客叫张三，手机号13800138000，微信支付，没有附件，帮我开单');
 assert.equal(await page.evaluate(()=>saleFlow.stage),'review','explicit known fields need not be asked again');assert.equal(await page.evaluate(()=>draft.salePrice),1999);await page.locator('#new-topic').click();
 await say(page,'帮我卖小华机一台');assert.equal(await page.evaluate(()=>saleFlow.rows.length),1);assert.equal(await page.evaluate(()=>saleFlow.rows[0].skuId),'h60');await say(page,'串号1234');await say(page,'一千九百九十九元');assert.equal(await page.evaluate(()=>saleFlow.salePrice),1999);await page.locator('#new-topic').click();
 await say(page,'卖一台华为 Mate80 手机，帮我开单');assert.equal(await page.evaluate(()=>saleFlow),null);assert.match(await page.locator('#answer').innerText(),/没有找到可售库存/);await ctx.close();
 // Late inventory must neither show internal stock in customer mode nor overwrite a new conversation.
 for(const action of ['customer','new-topic','new-question']){
  const opened=await open();let release,requested;const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>requested=resolve);let held=false;
  await opened.page.route('**/api/inventory',async route=>{if(!held){held=true;requested();await gate;}await route.continue();});
  const pending=say(opened.page,'卖一台华为手机，帮我开单');await seen;
  if(action==='customer')await opened.page.locator('#mode-customer').click();
  else if(action==='new-topic')await opened.page.locator('#new-topic').click();
  else await say(opened.page,'你好');
  release();await pending;assert.equal(await opened.page.evaluate(()=>saleFlow),null,action);assert.equal(await opened.page.locator('#draft').isVisible(),false);
  if(action==='customer'||action==='new-topic')assert.equal(await opened.page.locator('#result').isVisible(),false,action);else assert.match(await opened.page.locator('#answer').innerText(),/你好|您好|欢迎/);
  await opened.ctx.close();console.log('PASS late inventory isolation:',action);
 }
 assert.equal(JSON.stringify(repo.readStore()),before,'guided draft did not change ledger, stock, prices or audit');console.log('PASS duplicate tails, prefilled fields, missing model and read-only business state');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(folder);}})().catch(e=>{console.error(e);process.exitCode=1});
