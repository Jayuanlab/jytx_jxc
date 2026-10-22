'use strict';
require('./simulation-preload.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.STORE_SEED_PATH=path.resolve('artifacts/simulation-20261010/seed.json');
const repo=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),server=require('../server/src/application').createServer();
const out=path.resolve('artifacts/quality-check-20261010/assistant');fs.mkdirSync(out,{recursive:true});let browser;const checks=[],errors=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  async function open(width=390,route='/assistant?mode=store'){
   const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});
   await context.addCookies([{name:'erp_session',value:sessions.issue('demo-clerk'),url:origin}]);await context.addInitScript(()=>{
    localStorage.setItem('store-mobile-text-size','double');
    window.__spoken=0;Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},speak(){window.__spoken++},getVoices(){return[]}}});
    class Recognition{start(){window.__recognizer=this;this.onstart?.()}abort(){this.onend?.()}stop(){this.onend?.()}}
    window.SpeechRecognition=Recognition;
   });
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+route,{waitUntil:'networkidle'});await page.waitForFunction(()=>me!=null);return{page,context};
  }
  async function say(page,q){await page.locator('#question').fill(q);await page.locator('#ask .primary').click();await page.waitForFunction(()=>!voiceBusy&&!document.getElementById('result').hidden)}
  const token=sessions.issue('demo-clerk');const beforeApi=JSON.stringify(repo.readStore());
  for(const question of ['开个单刘德华1234。','串号1234。','手机1234。','手机串号']){
   const response=await fetch(origin+'/api/assistant/ask',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({mode:'store',question})});
   assert.equal(response.status,200);assert.equal((await response.json()).saleFlow?.type,'phone',question);
  }
  assert.equal(JSON.stringify(repo.readStore()),beforeApi);checks.push('真实服务接口同样识别四种简写，查询阶段不写入单据');
  for(const width of [390,320]){
   const {page,context}=await open(width);const before=JSON.stringify(repo.readStore());let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/sale-orders'))writes++});
   await say(page,'串号1234');await page.locator('#assistant-reply-text').waitFor({state:'visible'});
   assert.equal(await page.locator('#assistant-reply-text').isEditable(),true);
   const geometry=await page.locator('#assistant-reply').evaluate(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,font:parseFloat(getComputedStyle(document.getElementById('assistant-reply-text')).fontSize),below:el.getBoundingClientRect().top>=document.getElementById('answer').getBoundingClientRect().bottom}));
   assert.ok(geometry.below&&geometry.left>=0&&geometry.right<=width+2,JSON.stringify(geometry));assert.ok(geometry.font>=24,JSON.stringify(geometry));
   await page.locator('#assistant-reply-text').fill('2599');await page.locator('#assistant-reply-send').click();
   assert.equal(await page.evaluate(()=>saleFlow.salePrice),2599);assert.equal(await page.locator('#sale-edit-price').inputValue(),'2599');
   await page.locator('#sale-edit-price').fill('2199');await page.locator('#sale-edit-price').locator('..').getByRole('button',{name:'应用',exact:true}).click();
   assert.equal(await page.evaluate(()=>saleFlow.salePrice),2199);
   await page.locator('#sale-edit-account').selectOption('微信');assert.equal(await page.evaluate(()=>saleFlow.account),'微信');
   await page.locator('#sale-workspace details>summary').click();
   await page.locator('#sale-edit-customerName').fill('刘德华');await page.locator('#sale-edit-customerName').locator('..').getByRole('button',{name:'应用',exact:true}).click();
   await page.locator('#sale-edit-customerPhone').fill('15923432599');await page.locator('#sale-edit-customerPhone').locator('..').getByRole('button',{name:'应用',exact:true}).click();
   assert.equal(await page.evaluate(()=>saleFlow.customerName),'刘德华');assert.equal(await page.evaluate(()=>saleFlow.customerPhone),'15923432599');assert.equal(writes,0);
   await page.locator('#assistant-reply-text').fill('售价2399元，现金');await page.locator('#assistant-reply-send').click();
   assert.equal(await page.evaluate(()=>saleFlow.salePrice),2399);assert.equal(await page.evaluate(()=>saleFlow.account),'现金');
   await page.screenshot({path:path.join(out,'reply-box-'+width+'.png')});
   checks.push(width+'px：追问下方回复框可连续填写，草稿字段直接编辑同一单，核对前零入账');
   await page.locator('#new-topic').click();
   for(const q of ['开个单刘德华1234。','串号1234。','手机1234。','手机串号1234']){
    await say(page,q);assert.equal(await page.evaluate(()=>saleFlow?.stage),'price',q);assert.equal(await page.evaluate(()=>saleFlow?.serialNo),'990000000001234',q);
    assert.equal(await page.evaluate(()=>saleFlow?.customerName),q.includes('刘德华')?'刘德华':undefined,q);
    assert.equal(writes,0);assert.equal(JSON.stringify(repo.readStore()),before);await page.locator('#new-topic').click();
   }
   await say(page,'手机串号');assert.equal(await page.evaluate(()=>saleFlow?.stage),'serial');await page.locator('#new-topic').click();
   await say(page,'开单刘德华9876');assert.match(await page.locator('#answer').inputValue(),/没有找到串号 9876/);assert.equal(await page.evaluate(()=>saleFlow.product),null);await page.locator('#new-topic').click();
   checks.push(width+'px：姓名加尾号、只说串号或手机尾号均查询可售库存并进入草稿，缺售价只补售价，缺货不造单');
   await say(page,'帮我开一个单。陈文琼。15923432599，手机1234，售价2599');
   const colloquial=await page.evaluate(()=>({stage:saleFlow?.stage,serial:saleFlow?.serialNo,price:saleFlow?.salePrice,name:saleFlow?.customerName,phone:saleFlow?.customerPhone}));
   assert.deepEqual(colloquial,{stage:'review',serial:'990000000001234',price:2599,name:'陈文琼',phone:'15923432599'});
   assert.match(await page.locator('#answer').inputValue(),/草稿已齐/);assert.equal(writes,0);assert.equal(JSON.stringify(repo.readStore()),before);
   await page.getByRole('button',{name:'核对并提交',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('sale-confirm-submit').disabled);
   const text=await page.locator('#sale-review-body').innerText();assert.match(text,/陈文琼/);assert.match(text,/15923432599/);assert.match(text,/2599/);
   assert.equal(await page.locator('#sale-payment-select').inputValue(),'');assert.equal(writes,0);
   await page.locator('#sale-review-dialog').screenshot({path:path.join(out,'colloquial-review-'+width+'.png')});
   await page.locator('#sale-review-close').click();await page.locator('#new-topic').click();
   await say(page,'帮我开一个单。陈文琼。15923432599，手机9876，售价2599');
   assert.match(await page.locator('#answer').inputValue(),/没有找到串号 9876/);assert.equal(await page.evaluate(()=>saleFlow.product),null);assert.equal(writes,0);
   await page.locator('#new-topic').click();await say(page,'查一下手机1234，售价2599');
   assert.equal(await page.evaluate(()=>saleFlow),null,'库存查询不能被价格和尾号触发成销售单');assert.equal(writes,0);
   checks.push(width+'px：截图原话识别全部字段，按可售串号定位，人工核对姓名电话价格，不存在的尾号不生成商品，查询不误开单');
   await page.locator('#new-topic').click();
   await say(page,'卖一台华为Mate60手机，后四位1234，售价2399元，顾客张三，手机号13900001099，送手机壳一个和钢化膜一张，微信付款，帮我开单');
   const values=await page.evaluate(()=>({stage:saleFlow?.stage,serial:saleFlow?.serialNo,price:saleFlow?.salePrice,name:saleFlow?.customerName,phone:saleFlow?.customerPhone,account:saleFlow?.account,gifts:saleFlow?.gifts.map(g=>g.product.name)}));
   assert.equal(values.stage,'review');assert.equal(values.serial,'990000000001234');assert.equal(values.price,2399);assert.equal(values.name,'张三');assert.equal(values.phone,'13900001099');assert.equal(values.account,'微信');assert.equal(values.gifts.length,2);
   assert.equal(writes,0);assert.equal(JSON.stringify(repo.readStore()),before);assert.equal(await page.evaluate(()=>window.__spoken),0);
   await say(page,'售价改为2299元，付款改成现金');assert.equal(await page.evaluate(()=>saleFlow.salePrice),2299);assert.equal(await page.evaluate(()=>saleFlow.account),'现金');assert.equal(await page.evaluate(()=>saleFlow.customerName),'张三');
   await say(page,'去核对');await page.locator('#sale-review-dialog').waitFor({state:'visible'});assert.match(await page.locator('#sale-review-body').innerText(),/串号.*990000000001234/s);assert.match(await page.locator('#sale-review-body').innerText(),/成本/);
   assert.equal(await page.locator('#sale-cash-confirmed').isChecked(),false);assert.equal(writes,0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.locator('#sale-review-dialog').screenshot({path:path.join(out,'review-'+width+'.png')});
   await page.locator('#sale-review-close').click();await page.locator('#new-topic').click();
   await say(page,'售出一台华为手机，帮我开单');assert.equal(await page.evaluate(()=>saleFlow.stage),'serial');
   await say(page,'售价2399元，微信付款');assert.equal(await page.evaluate(()=>saleFlow.stage),'serial');assert.equal(await page.evaluate(()=>saleFlow.customerName),undefined);
   await say(page,'后四位1234');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');assert.match(await page.locator('#answer').inputValue(),/草稿已齐/);
   await page.locator('#new-topic').click();await say(page,'1234，2399');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');assert.equal(await page.evaluate(()=>saleFlow.account),undefined);assert.equal(await page.evaluate(()=>saleFlow.serialNo),'990000000001234');
   await say(page,'售价100元');await page.locator('#flow-choices').getByRole('button',{name:'核对并提交',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('sale-confirm-submit').disabled);assert.match(await page.locator('#sale-review-body').innerText(),/低于.*进货成本/);assert.equal(await page.locator('#sale-price-confirmed').isVisible(),true);await page.locator('#sale-payment-select').selectOption('现金');await page.locator('#sale-confirm-submit').click();assert.equal(writes,0);assert.equal(await page.locator('#sale-review-dialog').isVisible(),true);await page.locator('#sale-price-confirmed').check();assert.equal(writes,0);await page.locator('#sale-review-close').click();await say(page,'售价2399元，微信');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');
   await page.locator('#new-topic').click();await say(page,'卖一台华为手机，开单');await page.getByRole('button',{name:'先跳过',exact:true}).click();assert.equal(await page.evaluate(()=>saleFlow.stage),'price');await say(page,'2000元');await say(page,'微信');assert.equal(await page.evaluate(()=>saleFlow.stage),'pending');await say(page,'后四位1234');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');
   await say(page,'售价1999元，售价1899元');assert.equal(await page.evaluate(()=>saleFlow.stage),'price');assert.match(await page.locator('#answer').inputValue(),/多个售价/);await say(page,'售价改为2099元');assert.equal(await page.evaluate(()=>saleFlow.salePrice),2099);assert.equal(await page.evaluate(()=>saleFlow.stage),'review');
   await say(page,'手机号12345');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');assert.equal(await page.evaluate(()=>saleFlow.customerPhone),'');
   await say(page,'附件不存在的商品一个');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');assert.ok(await page.evaluate(()=>saleFlow.supplement.some(x=>x.startsWith('待补赠附件：'))));
   await say(page,'没有附件');assert.equal(await page.evaluate(()=>saleFlow.supplement.some(x=>x.startsWith('待补赠附件：'))),false);
   await say(page,'送充电器一个');await page.locator('#flow-choices').getByRole('button',{name:'核对并提交',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('sale-confirm-submit').disabled);assert.match(await page.locator('#sale-review-body').innerText(),/超限.*审批/s);assert.match(await page.locator('#sale-review-body').innerText(),/69/);await page.locator('#sale-review-close').click();await say(page,'没有附件');
   await page.locator('#result').screenshot({path:path.join(out,'draft-'+width+'.png')});
   // Voice dictation never sends a query and never enables speech playback.
   await page.locator('#new-topic').click();await page.locator('#question').fill('');await page.locator('#voice-start').click();
   await page.evaluate(()=>window.__recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:'华为手机，后四位1234，售价2399元'}],{isFinal:true})]}));
   await page.waitForTimeout(3200);assert.equal(await page.locator('#result').isVisible(),false);assert.match(await page.locator('#question').inputValue(),/2399/);
   await page.evaluate(()=>window.__recognizer.onend());await page.waitForTimeout(400);
   await page.evaluate(()=>window.__recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:'微信付款，帮我开单'}],{isFinal:true})]}));
   await page.locator('#voice-start').click();assert.equal(await page.locator('#result').isVisible(),false);assert.equal(await page.evaluate(()=>voiceSession),false);
   await page.locator('#ask .primary').click();await page.waitForFunction(()=>saleFlow?.stage==='review');assert.equal(await page.evaluate(()=>window.__spoken),0);assert.equal(writes,0);
   await page.locator('#read-answer').click();assert.equal(await page.evaluate(()=>window.__spoken),1);
   checks.push(width+'px：整段提取、2项附件、随时改价改收款、无选填追问、先跳过后补齐、冲突确认、语音人工发送、静音默认、原位核对未写单');await context.close();
  }
  const {page,context}=await open();await say(page,'华为Mate60手机，后四位1234，卖2399元，现金');assert.equal(await page.evaluate(()=>saleFlow.stage),'review');
  await page.locator('#flow-choices').getByRole('button',{name:'核对并提交',exact:true}).click();await page.locator('#sale-confirm-submit').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('sale-confirm-submit').disabled);
  const beforeSales=repo.readStore().sales.length,beforeGift=repo.readStore().giftOrders?.length||0;const posts=[];
  // Lose the first successful response. The second click must replay the same POST key and body.
  await page.route('**/api/sale-orders',async route=>{const request=route.request();posts.push({key:request.headers()['idempotency-key'],body:request.postData()});if(posts.length===1){await route.fetch();await route.abort('failed')}else await route.continue()});
  await page.locator('#sale-cash-confirmed').check();await page.locator('#sale-confirm-submit').click();
  await page.waitForFunction(()=>document.getElementById('sale-submit-status').textContent.includes('提交结果尚未确认'));
  assert.equal(repo.readStore().sales.length,beforeSales+1);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>saleFlow?.submission);await page.getByRole('button',{name:'重试确认结果',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('sale-confirm-submit').disabled);await page.locator('#sale-confirm-submit').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('提交成功'));
  assert.equal(repo.readStore().sales.length,beforeSales+1);assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(repo.readStore().giftOrders?.length||0,beforeGift);
  const latest=repo.readStore().sales[0];assert.equal(latest.items[0].serialNo,'990000000001234');assert.equal(latest.amount,2399);assert.equal(latest.receivedAmount,2399);assert.equal(latest.salespersonId,'demo-clerk');const state=repo.readStore();assert.equal(state.inventory.flatMap(x=>x.serials||[]).find(x=>x.no===latest.items[0].serialNo).status,'已售');assert.equal(state.commissionEntries.filter(x=>x.orderId===latest.id&&x.kind==='sale').length,1);
  checks.push('原生开单成功：库存、串号、现金、员工提成；丢失响应后刷新重试只生成一单');
  await context.close();
  const customer=await open(390,'/assistant?mode=customer&locked=1');await say(customer.page,'华为手机后四位1234售价2399元，帮我开单');assert.equal(await customer.page.evaluate(()=>saleFlow),null);assert.equal(await customer.page.locator('#sale-workspace').isVisible(),false);assert.equal(await customer.page.locator('#sale-review-dialog').isVisible(),false);checks.push('固定顾客模式没有店内草稿、提交和成本');
  await customer.context.close();assert.deepEqual(errors,[]);
  const result={checkedAt:new Date().toISOString(),checks,pageErrors:errors,passed:checks.length};fs.writeFileSync(path.join(out,'ui-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));sessions.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
