// Isolated memory ledger + synthetic employee session. Failure GET fixtures never create a business record.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Module=require('node:module'),originalLoad=Module._load;
Module._load=function(name,...args){return name==='xlsx'?{}:originalLoad.call(this,name,...args);};
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const revision='20261010-failure-fold',html=fs.readFileSync(path.resolve('web/receptions.html'),'utf8');
assert.ok(html.includes('/receptions.js?v='+revision),'wait for reception failure-fold script version before running');
assert.ok(html.includes('/receptions.css?v='+revision),'wait for reception failure-fold CSS version before running');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'reception-failure-fold-'));
process.env.STORE_SEED_PATH=path.join(folder,'seed.json');
const c=require('../server/src/common'),employee={id:'staff-a',name:'测试营业员',role:'营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[employee],products:[],inventory:[],sales:[],receptions:[],receptionAttempts:[]})));
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),{createServer}=require('../server/src/application');
const attemptsKey='erp-reception-attempts-v1';
const shared={id:'RA-SERVER-SHARED-20261009-abcdef0123456789',requestKey:'request-shared',reason:'旧失败：顾客预算尚未补齐',createdAt:'2026-10-09T03:01:00Z',purpose:'咨询手机',customerMask:'138****8000',userName:employee.name};
const localA={id:'本机-OLD-A',reason:'本机旧失败：手机号格式不符',createdAt:'2026-10-09T04:02:00Z',purpose:'购买手机',customerMask:'手机号格式不符',userName:employee.name};
const localB={id:'本机-OLD-B',reason:'本机旧失败：顾客需求未填写',createdAt:'2026-10-09T05:03:00Z',purpose:'咨询一般业务',customerMask:'未填手机号',userName:employee.name};
const serverOnly={id:'RA-SERVER-ONLY-20261009-0123456789abcdef',requestKey:'request-server-only',reason:'服务器旧失败：资料内容需要补充',createdAt:'2026-10-09T06:04:00Z',purpose:'购买手机',customerMask:'139****0000',userName:employee.name};
const oldLocal=[shared,{...shared,requestKey:'legacy-duplicate-key'},localA,localB],serverFixtures=[shared,serverOnly],expected=[shared,localA,localB,serverOnly];
const initialStorage=JSON.stringify(oldLocal),output=path.resolve('artifacts/clean-layout');
const failures=[],passes=[],runtimeErrors=[],writes=[],assets=[],geometry=[];
let browser,server,origin;
const attempt=async(label,run)=>{try{await run();passes.push(label);console.log('PASS',label);}catch(error){failures.push({label,message:error.message});console.error('FAIL',label,error.message);}};
const snapshot=()=>[...document.querySelectorAll('#new-form input,#new-form select,#new-form textarea')].filter(n=>n.type!=='file').map(n=>({name:n.name,type:n.type,value:n.value,checked:n.checked,required:n.required,disabled:n.disabled}));
async function quiet(page){await page.waitForLoadState('networkidle',{timeout:12000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function layout(page,label){
  const g=await page.evaluate(()=>{
    const shown=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
    const overflow=document.documentElement.scrollWidth>innerWidth+1;
    return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow,offenders:overflow?[...document.body.querySelectorAll('*')].filter(shown).filter(n=>n.getBoundingClientRect().right>innerWidth+1||n.getBoundingClientRect().left<-1).slice(0,8).map(n=>({tag:n.tagName,id:n.id,class:n.className,right:n.getBoundingClientRect().right})):[]};
  });geometry.push({label,...g});assert.equal(g.overflow,false,label+' horizontal overflow '+JSON.stringify(g.offenders));
}
async function storageUnchanged(page,label){assert.equal(await page.evaluate(key=>localStorage.getItem(key),attemptsKey),initialStorage,label+' must preserve every raw old local record');}
async function recordEvidence(page,label){
  const cards=page.locator('#failed-attempts .failed-attempt');
  assert.equal(await cards.count(),expected.length,label+' deduplicated record count');
  for(const row of expected){
    const card=cards.filter({hasText:row.id});assert.equal(await card.count(),1,label+' exactly one rendered record for '+row.id);
    const text=await card.innerText(),time=await page.evaluate(value=>new Date(value).toLocaleString('zh-CN'),row.createdAt);
    assert.ok(text.includes(row.reason),label+' retains reason '+row.id);
    assert.ok(text.includes('编号：'+row.id),label+' retains full reference '+row.id);
    assert.ok(text.includes(time),label+' retains submission time '+row.id);
    assert.ok(text.includes(row.userName),label+' retains submitting employee '+row.id);
    assert.equal(await card.isVisible(),true,label+' evidence readable when expanded');
  }
}
async function runCase(width,size){
  const ctx=await browser.newContext({viewport:{width,height:1000},isMobile:width<=700,hasTouch:width<=700});
  ctx.setDefaultTimeout(7000);
  await ctx.addCookies([{name:'erp_session',value:sessions.issue(employee.id),url:origin}]);
  await ctx.addInitScript(({size,key,raw})=>{
    localStorage.setItem('store-mobile-text-size',size);
    // Initialize once per browser tab, so a reload cannot mask record loss by re-seeding.
    if(!sessionStorage.getItem('failure-fold-test-seeded')){
      localStorage.setItem(key,raw);sessionStorage.setItem('failure-fold-test-seeded','1');
    }
  },{size,key:attemptsKey,raw:initialStorage});
  let reads=0;
  await ctx.route('**/api/**',async route=>{
    const request=route.request(),pathname=new URL(request.url()).pathname;
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){
      writes.push({method:request.method(),pathname});
      await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{message:'Failure-fold test blocks business writes'}})});return;
    }
    if(pathname==='/api/receptions/attempts'&&request.method()==='GET'){
      reads++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(serverFixtures)});return;
    }
    await route.continue();
  });
  const page=await ctx.newPage(),label=width+'/'+size;
  page.on('pageerror',error=>runtimeErrors.push({label,message:error.message}));
  page.on('response',response=>{if(response.status()>=400&&/\.(?:css|js)(?:\?|$)/.test(response.url()))assets.push({label,url:response.url(),status:response.status()});});
  try{
    await page.goto(origin+'/receptions');await quiet(page);
    await page.waitForFunction(()=>document.getElementById('reception-operator').textContent.includes('测试营业员'));
    const fold=page.locator('details:has(#failed-attempts)'),summary=fold.locator(':scope > summary'),list=page.locator('#failed-attempts');
    assert.equal(await fold.count(),1,label+' failure records use one native details');
    assert.equal(await fold.evaluate(n=>n instanceof HTMLDetailsElement),true);
    assert.equal(await fold.evaluate(n=>n.open),false,label+' starts closed with old records');
    assert.match(await summary.innerText(),/^查看失败记录\s*4条$/); assert.equal(await page.locator('#failure-count').innerText(),'4条');
    assert.equal(await summary.isVisible(),true,label+' check entry remains visible');
    assert.equal(await list.isVisible(),false,label+' reasons stay hidden by default');
    assert.equal(await page.locator('#refresh-attempts').isVisible(),false,label+' refresh stays inside folded records');
    assert.equal(await list.locator('.failed-attempt').count(),4,label+' hidden evidence remains in DOM');
    await storageUnchanged(page,label+' default');await layout(page,label+' closed');
    const form=page.locator('#new-form');
    await form.locator('[name=phone]').fill('13800138000');
    await form.locator('[name=name]').fill('已录顾客称呼');
    await form.locator('[name=purpose]').selectOption('咨询手机');
    await form.locator('[name=needs]').fill('本人已录需求：比较华为与荣耀的续航和价格');
    await form.locator('[name=budgetBand]').selectOption('2000to2999');
    const typed=await page.evaluate(snapshot),operator=await page.locator('#reception-operator').innerText();
    await summary.click();await page.waitForFunction(()=>document.getElementById('failed-attempts').closest('details').open);
    await recordEvidence(page,label+' expanded');assert.deepEqual(await page.evaluate(snapshot),typed,label+' opening keeps entered fields');
    assert.equal(await page.locator('#reception-operator').innerText(),operator);
    await storageUnchanged(page,label+' expanded');await layout(page,label+' expanded');
    if(width===390&&size==='double')await fold.screenshot({path:path.join(output,'reception-failures-open.png')});
    const firstReadCount=reads;
    await page.locator('#refresh-attempts').click();await quiet(page);
    assert.ok(reads>firstReadCount,label+' refresh rereads failed server records');
    assert.equal(await fold.evaluate(n=>n.open),true,label+' refresh preserves expanded state');
    await recordEvidence(page,label+' refreshed');
    assert.match(await summary.innerText(),/^查看失败记录\s*4条$/); assert.equal(await page.locator('#failure-count').innerText(),'4条');
    assert.deepEqual(await page.evaluate(snapshot),typed,label+' refreshing keeps every filled field');
    assert.equal(await page.locator('#reception-operator').innerText(),operator);
    await storageUnchanged(page,label+' refreshed');
    await summary.click();assert.equal(await fold.evaluate(n=>n.open),false);
    assert.equal(await list.isVisible(),false);assert.deepEqual(await page.evaluate(snapshot),typed,label+' folding keeps fields');
    await summary.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.getElementById('failed-attempts').closest('details').open);
    await recordEvidence(page,label+' keyboard expanded');
    await summary.focus();await page.keyboard.press('Space');
    await page.waitForFunction(()=>!document.getElementById('failed-attempts').closest('details').open);
    assert.equal(await list.isVisible(),false,label+' keyboard folds evidence');
    assert.deepEqual(await page.evaluate(snapshot),typed,label+' keyboard controls keep filled fields');
    await storageUnchanged(page,label+' keyboard');await layout(page,label+' keyboard folded');
    if(width===390&&size==='double')await fold.screenshot({path:path.join(output,'reception-failures-folded.png')});
    await page.reload();await quiet(page);
    assert.equal(await fold.evaluate(n=>n.open),false,label+' reload starts folded');
    assert.match(await summary.innerText(),/^查看失败记录\s*4条$/); assert.equal(await page.locator('#failure-count').innerText(),'4条');
    await storageUnchanged(page,label+' reload');
    assert.equal(await list.locator('.failed-attempt').count(),4,label+' reload preserves all distinct historical failures');
    await summary.click();await recordEvidence(page,label+' reload expanded');await layout(page,label+' reload expanded');
    await summary.click();await storageUnchanged(page,label+' final folded');
  }finally{await ctx.close();}
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const before=JSON.stringify(repo.readStore());
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    for(const[width,size]of [[320,'double'],[320,'large'],[390,'double'],[390,'large'],[1280,'desktop']])await attempt(width+' '+size+' failed-history folding, deduplication and preservation',()=>runCase(width,size));
    await attempt('no browser runtime errors',()=>assert.deepEqual(runtimeErrors,[]));
    await attempt('versioned reception assets loaded',()=>assert.deepEqual(assets,[]));
    await attempt('no business write attempts',()=>assert.deepEqual(writes,[]));
    await attempt('complete isolated business ledger unchanged',()=>assert.equal(JSON.stringify(repo.readStore()),before));
    const report={revision,passed:passes.length,failed:failures.length,passes,failures,runtimeErrors,assets,writes,geometry,rawLocalRecordCount:oldLocal.length,deduplicatedRecordCount:expected.length};
    const reportPath=path.join(output,'reception-failure-fold-ui-report.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
    console.log('Failure-fold acceptance:',passes.length,'passed,',failures.length,'failed; report:',reportPath);
    assert.deepEqual(failures,[],'failure-fold acceptance failed');
  }finally{
    if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(folder);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
