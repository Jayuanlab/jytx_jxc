'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve('web'),out=path.resolve('artifacts/capacity/ui');fs.mkdirSync(out,{recursive:true});
let current='branch-a';const branches=[{id:'branch-a',code:'001',name:'聚友通信城',status:'active'},{id:'branch-b',code:'002',name:'模拟第二店',status:'active'}],writes=[],errors=[],passes=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(p.startsWith('/api/')){res.setHeader('Content-Type','application/json');let body={};if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;body=JSON.parse(text||'{}');writes.push({path:p,branch:req.headers['x-store-branch'],body});if(req.headers['x-store-branch']&&req.headers['x-store-branch']!==current){res.statusCode=409;return res.end(JSON.stringify({error:{message:'门店已切换，请重新打开此页面'}}));}}
  let result;
  if(p==='/api/organization')result={enabled:true,tenant:{code:'JYTX',name:'聚友通信'},currentBranchId:current,branches,canManage:true};
  else if(p==='/api/users')result=[{id:'boss',name:'老板',roleCode:'owner',status:'active'},{id:'employee',name:'测试员工',roleCode:'employee',status:'active'}];
  else if(p==='/api/organization/branches'){result={...body,id:'branch-'+branches.length,status:'active'};branches.push(result);}
  else if(p==='/api/organization/grants')result={ok:true};
  else if(p==='/api/organization/report')result={branches:[{code:'001',name:'聚友通信城',saleCount:2,returnCount:0,netAmount:4000,salesGrossProfit:1000}],totals:{saleCount:2,netAmount:4000}};
  else if(p==='/api/organization/select'){current=body.branchId;result={ok:true};}
  else result={};
  return res.end(JSON.stringify(result));
 }
 const name=p==='/organization'?'organization.html':p.slice(1),filename=path.resolve(root,name);
 if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)){res.statusCode=404;return res.end('missing');}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));
});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 for(const width of [320,390,1280]){
  current='branch-a';const context=await browser.newContext({viewport:{width,height:900},isMobile:width<700,hasTouch:width<700}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/organization');await page.waitForFunction(()=>document.getElementById('org-status').textContent.includes('当前门店'));assert.equal(await page.locator('#branch-context').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow '+width);
  assert.equal(await page.locator('#create-form').isVisible(),false);assert.equal(await page.locator('#grant-form').isVisible(),false);assert.equal(await page.locator('#report-form').isVisible(),false);
  await page.locator('#create-section>summary').click();await page.locator('[name=code]').fill('0'+width);await page.locator('[name=name]').fill('测试新店'+width);await page.locator('#create-form button').click();await page.waitForFunction(()=>document.getElementById('org-status').textContent.includes('已建立門店')||document.getElementById('org-status').textContent.includes('已建立门店'));assert.equal(writes.at(-1).branch,'branch-a');
  await page.locator('#grant-section>summary').click();await page.locator('#grant-user').selectOption('employee');await page.locator('#grant-branches').selectOption(['branch-a','branch-b']);await page.locator('#grant-form button').click();await page.waitForFunction(()=>document.getElementById('grant-status').textContent.includes('授权已保存'));assert.deepEqual(writes.at(-1).body.branchIds,['branch-a','branch-b']);
  await page.locator('#report-section>summary').click();await page.locator('#report-form button').click();await page.waitForFunction(()=>document.getElementById('report-status').textContent.includes('4000.00'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width===390)await page.screenshot({path:path.join(out,'organization-mobile.png'),fullPage:true});
  current='branch-b';await page.locator('#grant-form button').click();await page.waitForFunction(()=>document.getElementById('grant-status').textContent.includes('门店已切换'));
  passes.push(width+'px: collapse, create, grant, report, stale-page guard, no overflow');await context.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passes,errors,simulatedUi:true},null,2));console.log(JSON.stringify({passes,errors},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
