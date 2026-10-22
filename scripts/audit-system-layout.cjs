// Layout acceptance uses an isolated memory ledger, synthetic sessions and a fresh Edge profile.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Module=require('node:module'),originalLoad=Module._load;
Module._load=function(name,...args){return name==='xlsx'?{}:originalLoad.call(this,name,...args);};
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const revision='20261010-clean-layout',out=path.resolve('artifacts/system-audit-20261010/layout');
const salesOnly=process.env.TEST_CLEAN_LAYOUT_SALES_ONLY==='1';
const files=['feishu-mobile','office','receptions','search','assistant','air-recharge','cash-handover','funds','daily-close','close','carrier','subsidy','gift-approvals','sale-payments','knowledge','knowledge-review','learning','work-journal','brain','notices','qr','login'];
for(const file of files){
  const source=fs.readFileSync(path.resolve('web',file+'.html'),'utf8');
  assert.ok(source.includes('/page-help.js?v='+revision),file+' must include the current shared help script before testing');
  assert.ok(source.includes('/page-help.css?v='+revision),file+' must include the current shared help CSS before testing');
}
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clean-layout-'));
process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common');
const owner={id:'boss',name:'测试老板',role:'老板',roleCode:'owner',status:'active'};
const staff={id:'staff-a',name:'测试营业员',role:'营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
const staffB={id:'staff-b',name:'另一营业员',role:'营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
const customer={id:'customer',name:'顾客咨询',role:'顾客咨询',roleCode:'customer-assistant',assistantCustomerOnly:true,status:'active'};
const phone=(skuId,name)=>({skuId,name,type:'智能手机',subType:'华为',thirdType:name.includes('60')?'Mate 60':'Mate 70',trackSerial:true,stockManaged:true,active:true,warehouseId:'wh-sale',warehouseName:'销售仓',externalCode:'LAYOUT-'+skuId,salePrice:2399,costPrice:1800});
const products=[phone('h60','华为 Mate 60 128GB'),phone('h70','华为 Mate 70 256GB'),{skuId:'case',name:'透明手机壳',type:'配件',subType:'保护壳',trackSerial:false,stockManaged:true,active:true,warehouseId:'wh-sale',warehouseName:'销售仓',salePrice:39,costPrice:12}];
const inventory=[{skuId:'h60',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:2,serials:[{no:'869000000001234',status:'可售',costPrice:1800},{no:'869000000101234',status:'可售',costPrice:1800}],costSources:[]},{skuId:'h70',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:1,serials:[{no:'869000000011234',status:'可售',costPrice:1800}],costSources:[]},{skuId:'case',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:8,serials:[],costSources:[]}];
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff,staffB,customer],products,inventory,sales:[],warehouses:[{id:'wh-sale',name:'销售仓',active:true}]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),{createServer}=require('../server/src/application');
const routes=['/m','/receptions','/search','/assistant?mode=store','/air-recharge','/cash-handover','/funds','/daily-close','/close','/carrier','/subsidy','/gift-approvals','/sale-payments','/knowledge','/knowledge-review','/learning','/work-journal','/brain','/notices','/qr','/login'];
const tabs=['dashboard','sales','orders','inventory','purchase','suppliers','finance','products','cards','payroll','reports','staff','opening','logs'];
const primary=['/m','/app?tab=sales','/receptions','/assistant?mode=store','/air-recharge','/close'];
const dimensions=[[320,'double'],[390,'large'],[700,'double'],[1280,'desktop']];
const failures=[],passes=[],runtimeErrors=[],blockedWrites=[],assetErrors=[],geometry=[];
const allowPost=new Set(['/api/assistant/ask','/api/copilot/sales-review']);
let browser,server,origin;
const attempt=async(name,run)=>{try{await run();passes.push(name);console.log('PASS',name);}catch(error){failures.push({name,message:error.message});console.error('FAIL',name,error.message);}};
function snapshotScript(){
  return [...document.querySelectorAll('input,select,textarea')].filter(n=>!n.closest('dialog.page-help-dialog')&&n.type!=='file').map(n=>({id:n.id,name:n.name,type:n.type,value:n.value,checked:n.checked,disabled:n.disabled,required:n.required}));
}
async function quiet(page){
  await page.waitForLoadState('networkidle',{timeout:15000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function open(user=owner,width=390,size='double'){
  const ctx=await browser.newContext({viewport:{width,height:1000},isMobile:width<=700,hasTouch:width<=700});
  ctx.setDefaultTimeout(7000);
  if(user)await ctx.addCookies([{name:'erp_session',value:sessions.issue(user.id),url:origin}]);
  await ctx.addInitScript(size=>{
    localStorage.setItem('store-mobile-text-size',size);
    class FakeRecognition{start(){this.onstart?.();}stop(){this.onend?.();}}
    Object.defineProperty(window,'SpeechRecognition',{configurable:true,value:FakeRecognition});
    // Feed a synthetic scanner result through the actual camera/decode/picker path.
    // No camera or microphone permission is requested.
    class FixtureDetector{async detect(){const value=window.__layoutScanValue;return value?[{rawValue:value}]:[];}}
    Object.defineProperty(window,'BarcodeDetector',{configurable:true,value:FixtureDetector});
    if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
      canvas.getContext('2d').fillRect(0,0,64,64);return canvas.captureStream(1);
    }});
    HTMLMediaElement.prototype.play=async function(){};
  },size);
  await ctx.route('**/api/**',async route=>{
    const request=route.request(),pathname=new URL(request.url()).pathname;
    if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!allowPost.has(pathname)){
      blockedWrites.push({url:pathname,method:request.method()});
      await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{message:'Layout acceptance blocks business writes'}})});return;
    }
    await route.continue();
  });
  const page=await ctx.newPage();
  page.on('pageerror',error=>runtimeErrors.push({url:page.url(),message:error.message}));
  page.on('response',response=>{if(response.status()>=400&&/\.(?:css|js)(?:\?|$)/.test(response.url()))assetErrors.push({url:response.url(),status:response.status()});});
  return {ctx,page};
}
async function goto(page,route){
  await page.goto(origin+route,{waitUntil:'domcontentloaded'});
  await quiet(page);await page.waitForFunction(()=>!!window.PageHelp);
  if(new URL(page.url()).pathname==='/app'){
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.user?.id==='boss'&&!!document.querySelector('#main h1'));
  }
}
async function bounds(page,label){
  const g=await page.evaluate(()=>{
    const shown=n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
    const visible=[...document.querySelectorAll('h1,h2,header strong,main button,main a,main input,main select,main textarea')].filter(shown);
    const overflow=document.documentElement.scrollWidth>innerWidth+1;
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow,visibleTitleOrControl:visible.some(n=>n.textContent.trim()||['INPUT','SELECT','TEXTAREA'].includes(n.tagName)),offenders:overflow?[...document.body.querySelectorAll('*')].filter(shown).filter(n=>n.getBoundingClientRect().right>innerWidth+1||n.getBoundingClientRect().left<-1).slice(0,8).map(n=>({tag:n.tagName,id:n.id,class:n.className,right:Math.round(n.getBoundingClientRect().right),left:Math.round(n.getBoundingClientRect().left)})):[]};
  });
  geometry.push({label,...g});assert.equal(g.visibleTitleOrControl,true,label+' needs a visible title or operation');assert.equal(g.overflow,false,label+' horizontal overflow: '+JSON.stringify(g.offenders));
}
async function structure(page,label){
  const result=await page.evaluate(()=>{
    const templates=[...document.querySelectorAll('template[data-page-help-template]')];
    const ids=[...document.querySelectorAll('[id]')].map(n=>n.id),duplicateIds=ids.filter((id,i)=>ids.indexOf(id)!==i);
    const invalidTargets=[...document.querySelectorAll('[data-help-target]')].map(n=>n.dataset.helpTarget).filter(id=>!id||!document.getElementById(id));
    const visibleTemplates=templates.filter(n=>n.getBoundingClientRect().width||n.getBoundingClientRect().height).map(n=>n.id);
    const visibleExplanations=[...document.querySelectorAll('[data-page-explanation]')].filter(n=>!n.matches('[role="alert"],[role="status"],[aria-live]')&&!n.querySelector('input,select,textarea,form,button,[role="alert"],[role="status"],[aria-live]')).filter(n=>getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().height>0).map(n=>n.id||n.textContent.slice(0,80));
    const title=document.querySelector('main h1');
    return {duplicateIds,invalidTargets,visibleTemplates,visibleExplanations,templateCount:templates.length,helpCount:document.querySelectorAll('[data-help-target],[data-help-all]').length,titleHelpCount:title?.parentElement.querySelectorAll(':scope > [data-help-target],:scope > [data-help-all]').length,knowledgePage:['/knowledge','/knowledge-review'].includes(location.pathname)};
  });
  assert.deepEqual(result.duplicateIds,[],label+' duplicate page IDs');
  assert.deepEqual(result.invalidTargets,[],label+' invalid help targets');
  assert.deepEqual(result.visibleTemplates,[],label+' explanations must start hidden');
  assert.deepEqual(result.visibleExplanations,[],label+' marked explanations must start hidden');
  assert.ok(result.helpCount,label+' needs a help entry');
  if(result.knowledgePage)assert.equal(result.titleHelpCount,1,label+' title must have exactly one help button');
}
async function helpCycle(page,label,{screenshot=false,all=false,selector=''}={}){
  const buttons=page.locator(selector||(all?'[data-help-all]':'[data-help-target],[data-help-all]'));
  let trigger;
  for(let i=0;i<await buttons.count();i++){const candidate=buttons.nth(i);if(await candidate.isVisible()){trigger=candidate;break;}}
  assert.ok(trigger,label+' visible help entry');
  const before=await page.evaluate(snapshotScript);
  await trigger.click();await page.locator('#page-help-dialog[open]').waitFor();
  const state=await page.evaluate(()=>{
    const d=document.getElementById('page-help-dialog'),ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
    const heading=d.querySelector('#page-help-title'),titleStyle=getComputedStyle(heading);
    return {native:d instanceof HTMLDialogElement,modal:d.matches(':modal'),text:d.innerText,controls:d.querySelectorAll('input,select,textarea,form').length,duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),right:d.getBoundingClientRect().right,viewport:innerWidth,overflow:d.scrollWidth>d.clientWidth+1,title:heading.textContent,titleHeight:heading.getBoundingClientRect().height,titleWidth:heading.getBoundingClientRect().width,titleFont:parseFloat(titleStyle.fontSize),closeWidth:d.querySelector('.page-help-close').getBoundingClientRect().width,titleLineHeight:parseFloat(titleStyle.lineHeight)};
  });
  assert.equal(state.native,true,label+' help uses native dialog');assert.equal(state.modal,true,label+' help is modal');
  assert.ok(state.text.trim().length>6,label+' help contains instructions');assert.equal(state.controls,0,label+' help must not duplicate business controls');assert.deepEqual(state.duplicateIds,[],label+' help must not duplicate IDs');
  assert.ok(state.right<=state.viewport+1,label+' help fits viewport');assert.equal(state.overflow,false,label+' help content overflow');
  if(state.title==='页面帮助'&&state.viewport<=700)assert.ok(state.titleHeight<=state.titleLineHeight*1.2,label+' short global help title should fit one line: '+JSON.stringify({font:state.titleFont,width:state.titleWidth,height:state.titleHeight,lineHeight:state.titleLineHeight,closeWidth:state.closeWidth}));
  if(screenshot)await page.screenshot({path:path.join(out,'mobile-sales-help.png')});
  await page.getByRole('button',{name:'关闭帮助',exact:true}).click();await page.locator('#page-help-dialog').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(snapshotScript),before,label+' close preserves form values and validation');
  assert.equal(await trigger.evaluate(n=>document.activeElement===n),true,label+' close returns focus to help entry');
  await trigger.click();await page.keyboard.press('Escape');await page.locator('#page-help-dialog').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(snapshotScript),before,label+' Escape preserves form values and validation');
  assert.equal(await trigger.evaluate(n=>document.activeElement===n),true,label+' Escape returns focus');
}
async function pageChecks(page,label){
  await bounds(page,label);await structure(page,label);await helpCycle(page,label);if(await page.locator('[data-help-all]').count())await helpCycle(page,label+' all',{all:true});
}
async function salesFill(page,width,size){
  await goto(page,'/app?tab=sales');await page.evaluate(()=>scrollTo(0,0));
  const scanPosition=await page.locator('#sale-camera-button').evaluate(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};});
  assert.ok(scanPosition.top>=0&&scanPosition.bottom<=scanPosition.height,'sale scan entry is available in the first viewport '+width+'/'+size+': '+JSON.stringify(scanPosition));
  await page.locator('[data-action="add-sale-item"]').click();await page.locator('#modal-form').waitFor();
  const addButton=page.locator('#modal-form button[type=submit]');
  if(!await addButton.isDisabled()){await addButton.click();assert.match(await page.locator('#modal-error').innerText(),/必填|标红/);}
  assert.equal(await page.evaluate(()=>state.salesCart.length),0,'empty product cannot be added');
  await page.locator('#modal-sale-select').selectOption('h60');
  const price=page.locator('#modal-form [name=salePrice]'),serial=page.locator('#modal-form [name=serialNo]');
  assert.equal(await price.inputValue(),'2399.00','catalog retail price prefilled');assert.equal(await price.isEditable(),true,'sale price editable');
  if(!await addButton.isDisabled())await addButton.click();assert.equal(await page.evaluate(()=>state.salesCart.length),0,'missing phone serial cannot be added');
  assert.equal(await serial.getAttribute('required'),'','phone serial remains required');
  await page.locator('#modal-serial-input').fill('1234');assert.equal(await serial.inputValue(),'','duplicate serial tails require selection');
  assert.match(await page.locator('#modal-serial-feedback').innerText(),/同尾号/);
  await page.locator('#modal-serial-input').fill('869000000001234');assert.equal(await serial.inputValue(),'869000000001234','manual full serial matches');
  await price.fill('1999.50');
  assert.equal(await page.evaluate(()=>state.products.find(p=>p.skuId==='h60').salePrice),2399,'local negotiated price does not alter catalog');
  const inputSnapshot=await page.evaluate(snapshotScript);
  await helpCycle(page,'sale item modal '+width+'/'+size,{selector:'#modal-root [data-modal-help]'});
  await page.evaluate(()=>PageHelp.open(null,document.getElementById('modal-serial-input')));
  await page.locator('#page-help-dialog[open]').waitFor();await page.keyboard.press('Escape');await page.locator('#page-help-dialog').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(snapshotScript),inputSnapshot,'sales help preserves entered price and serial');
  assert.equal(await page.locator('#modal-serial-input').evaluate(n=>document.activeElement===n),true,'Escape resumes the input');
  await bounds(page,'sale item modal '+width+'/'+size);await structure(page,'sale item modal '+width+'/'+size);
  await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>state.salesCart.map(r=>({skuId:r.skuId,serialNo:r.serialNo,salePrice:r.salePrice}))),[{skuId:'h60',serialNo:'869000000001234',salePrice:1999.5}]);
  await page.locator('[data-action="add-sale-item"]').click();await page.locator('#modal-sale-select').selectOption('h70');
  await page.evaluate(()=>window.__layoutScanValue='869000000011234');await page.locator('#modal-serial-scan').click();
  await page.waitForFunction(()=>document.querySelector('#modal-form [name=serialNo]').value==='869000000011234');
  assert.equal(await page.locator('#modal-form [name=skuId]').inputValue(),'h70','scan resolves correct product');
  assert.match(await page.locator('#modal-serial-feedback').innerText(),/869000000011234/);
  await page.locator('#modal-form button[type=submit]').click();await page.locator('#modal-root').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>state.salesCart[1].serialNo),'869000000011234','scanner adds same full serial as fixture');
  await page.locator('#sale-checkout [name=customerName]').fill('验收顾客');
  await page.locator('#sale-checkout [name=customerPhone]').fill('13800138000');
  await page.locator('#sale-checkout [name=account]').selectOption('现金');
  const cash=page.locator('#sale-checkout [name=cashDrawerConfirmed]');
  assert.equal(await cash.isVisible(),true,'cash actual receipt confirmation remains visible');
  assert.equal(await cash.getAttribute('type'),'checkbox');await cash.check();
  await quiet(page);await bounds(page,'filled sales '+width+'/'+size);await structure(page,'filled sales '+width+'/'+size);
  if(width===390&&size==='double'){await page.locator('#toast.show').waitFor({state:'hidden',timeout:6000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'mobile-sales-full.png'),fullPage:true});await page.screenshot({path:path.join(out,'mobile-sales.png')});}
  await helpCycle(page,'filled sales '+width+'/'+size,{all:true,screenshot:width===390&&size==='double'});
  assert.equal(await page.locator('#sale-checkout [name=customerName]').inputValue(),'验收顾客');
  assert.equal(await cash.isChecked(),true,'help preserves cash receipt declaration');
}
async function requiredFields(page){
  await goto(page,'/receptions');
  const needs=page.locator('#new-form [name=needs]'),budget=page.locator('#new-form [name=budgetBand]');
  assert.equal(await needs.isVisible(),true);assert.equal(await needs.getAttribute('required'),'');assert.equal(await budget.isVisible(),true);assert.equal(await budget.getAttribute('required'),'');
  assert.match(await needs.locator('..').innerText(),/必填/);assert.match(await budget.locator('..').innerText(),/必填/);
  await page.locator('#new-form button[type=submit]').first().click();
  assert.equal(await needs.getAttribute('aria-invalid'),'true');assert.equal(await budget.getAttribute('aria-invalid'),'true');
  await needs.fill('顾客想比较华为手机的价格和续航');await budget.selectOption('unknown');
  await helpCycle(page,'reception typed draft');assert.equal(await needs.inputValue(),'顾客想比较华为手机的价格和续航');assert.equal(await budget.inputValue(),'unknown');
  await goto(page,'/air-recharge');await page.waitForFunction(()=>document.getElementById('balance').textContent.includes('尚未登记'));
  assert.match(await page.locator('#balance').innerText(),/尚未登记平台期初余额/);assert.equal(await page.locator('#balance').isVisible(),true);
  const f=page.locator('#form');await f.locator('[name=customerPhone]').fill('13800138000');await f.locator('[name=cashReceived]').fill('100');await f.locator('[name=debitAmount]').fill('99');await f.locator('[name=platformRef]').fill('LAYOUT-REF');
  await f.locator('button[type=submit]').click();assert.match(await f.locator('.entry-errors').innerText(),/现金|勾选|确认/);
  const confirm=f.locator('[name=cashConfirmed]');assert.equal(await confirm.isVisible(),true);assert.equal(await confirm.getAttribute('required'),'');await confirm.check();
  await f.locator('button[type=submit]').click();assert.match(await f.locator('.entry-errors').innerText(),/不一致/);
  assert.equal(await page.locator('#amount-feedback').isVisible(),true);assert.match(await page.locator('#amount-feedback').innerText(),/不一致/);
  await f.locator('[name=debitAmount]').fill('100');assert.match(await page.locator('#amount-feedback').innerText(),/一致/);await helpCycle(page,'cash recharge filled draft');assert.equal(await confirm.isChecked(),true);
  await goto(page,'/close');await page.locator('#actualCash').fill('1');assert.equal(await page.locator('#note-required').isVisible(),true);assert.equal(await page.locator('#close-note').getAttribute('required'),'');assert.match(await page.locator('#cash-difference').innerText(),/差异/);
  await page.locator('#close-form button[type=submit]').click();assert.match(await page.locator('#close-errors').innerText(),/差异原因|交接人/);
}
async function permissionHelp(){
  for(const user of [owner,staff,customer]){
    const {ctx,page}=await open(user);try{
      const mode=user===customer?'customer&locked=1':'store';await goto(page,'/assistant?mode='+mode);
      await page.waitForFunction(id=>typeof me!=='undefined'&&me?.id===id,user.id);
      await page.locator('#auto-voice').uncheck();await page.locator('#question').fill('这是一条尚未发送的咨询');
      await page.evaluate(()=>PageHelp.open());await page.locator('#page-help-dialog[open]').waitFor();
      const text=await page.locator('#page-help-dialog').innerText();
      if(user===owner)assert.match(text,/维护顾客问答|修改助理问答/,'owner can read owner instructions');
      else assert.doesNotMatch(text,/维护顾客问答|教助理理解说法/,'employee/customer must not see owner maintenance instructions');
      if(user===staff){assert.match(text,/提交审核/,'employee may edit the paired answer and submit it for owner approval');}
      if(user===customer)assert.doesNotMatch(text,/修改助理问答|提交审核/,'customer cannot edit internal answers');
      if(user===customer)assert.doesNotMatch(text,/我要交接班|学习资料传到哪里|本账号权限|店内可直接/,'customer help excludes store instructions');
      else assert.match(text,/我要交接班|学习资料传到哪里/,'store user has store operations help');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#question').inputValue(),'这是一条尚未发送的咨询');
      await bounds(page,'assistant help permission '+user.roleCode);
    }finally{await ctx.close();}
  }
  for(const user of [owner,staff]){
    const {ctx,page}=await open(user);try{
      await goto(page,'/m');await page.evaluate(()=>PageHelp.open());await page.locator('#page-help-dialog[open]').waitFor();const text=await page.locator('#page-help-dialog').innerText();
      if(user===owner)assert.match(text,/知识与问答编辑|完整管理台/,'home owner instructions available');
      else assert.doesNotMatch(text,/知识与问答编辑|完整管理台/,'home hides owner instructions from staff');
      await page.keyboard.press('Escape');
    }finally{await ctx.close();}
  }
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const before=JSON.stringify(repo.readStore());
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const base=await open();
    try{
      if(!salesOnly){
      for(const route of routes)await attempt('390 double '+route,async()=>{await goto(base.page,route);await pageChecks(base.page,route);});
      await goto(base.page,'/app');
      assert.equal(await base.page.locator('#nav [data-tab]').count(),14,'owner has all 14 app tabs');
      for(const tab of tabs)await attempt('390 double app/'+tab,async()=>{
        await base.page.locator('#nav [data-tab="'+tab+'"]').click();
        await base.page.waitForFunction(tab=>state.tab===tab&&!!document.querySelector('#main h1'),tab);await quiet(base.page);await pageChecks(base.page,'app/'+tab);
      });
      }
      await attempt('390 double sales field entry/scanner/help preservation',()=>salesFill(base.page,390,'double'));
      if(!salesOnly)await attempt('reception/cash recharge/close required fields',()=>requiredFields(base.page));
    }finally{await base.ctx.close();}
    for(const [width,size]of dimensions){
      const opened=await open(owner,width,size);try{
        if(!salesOnly)for(const route of primary)await attempt(width+' '+size+' '+route,async()=>{await goto(opened.page,route);await pageChecks(opened.page,width+'/'+size+' '+route);});
        await attempt(width+' '+size+' sales field entry/scanner',()=>salesFill(opened.page,width,size));
      }finally{await opened.ctx.close();}
    }
    await attempt('boss/employee/customer help permissions and draft preservation',permissionHelp);
    if(!salesOnly){
    const anonymous=await open(null);try{
      await attempt('expired login and platform state stay visible',async()=>{await goto(anonymous.page,'/air-recharge');assert.match(await anonymous.page.locator('#status').innerText(),/登录|未成功/);assert.equal(await anonymous.page.locator('#status').isVisible(),true);await helpCycle(anonymous.page,'anonymous air recharge');});
    }finally{await anonymous.ctx.close();}
    }
    await attempt('browser runtime errors',()=>assert.deepEqual(runtimeErrors,[]));
    await attempt('shared assets return successful responses',()=>assert.deepEqual(assetErrors,[]));
    await attempt('zero business write attempts',()=>assert.deepEqual(blockedWrites,[]));
    await attempt('entire isolated business ledger unchanged',()=>assert.equal(JSON.stringify(repo.readStore()),before));
    const report={revision,origin,passed:passes.length,failed:failures.length,passes,failures,runtimeErrors,assetErrors,blockedWrites,geometry,screenshots:['mobile-sales.png','mobile-sales-help.png','mobile-sales-full.png']};
    const reportName=salesOnly?'ui-sales-report.json':'ui-report.json';
    fs.writeFileSync(path.join(out,reportName),JSON.stringify(report,null,2));
    console.log('Layout acceptance:',passes.length,'passed,',failures.length,'failed; report:',path.join(out,reportName));
    assert.deepEqual(failures,[],'layout acceptance failures (see ui-report.json)');
  }finally{
    if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(folder);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

