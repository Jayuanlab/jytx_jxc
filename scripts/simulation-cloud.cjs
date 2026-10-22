'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto'),assert=require('node:assert/strict'),https=require('node:https');
const app='/opt/store-erp/app',stage='/opt/store-erp/staging/simulation-20261010-v1';
const manifest=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json')));
const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert.equal(process.env.STORE_ENGINE,'postgres');assert.ok(process.env.STORE_PG_URL.endsWith('/store_erp_capacity_v2'));
for(const [file,hash]of Object.entries(manifest.sources))assert.equal(digest(path.join(app,file)),hash,'Business code differs: '+file);
assert.equal(digest(path.join(stage,'simulation-scenarios.cjs')),manifest.scenarioHash);
const gate=JSON.parse(fs.readFileSync(path.join(stage,'regression.json')));assert.equal(gate.passed,342);assert.equal(gate.failed,0);
const ui=JSON.parse(fs.readFileSync(path.join(stage,'ui-report.json')));assert.ok(ui.passed>=9);assert.equal(ui.pageErrors.length,0);assert.equal(ui.views.filter(x=>x.overflow).length,0);
const loaded=new Module(path.join(app,'scripts/simulation-scenarios.cjs'));loaded.filename=path.join(app,'scripts/simulation-scenarios.cjs');loaded.paths=Module._nodeModulePaths(path.join(app,'scripts'));loaded._compile(fs.readFileSync(path.join(stage,'simulation-scenarios.cjs'),'utf8'),loaded.filename);
const sim=loaded.exports,pg=require(app+'/server/src/capacity/postgres'),context=require(app+'/server/src/capacity/context'),auth=require(app+'/server/src/capacity/auth');
assert.equal(context.current().tenantId,'5eceb77a-8bdf-4da5-a4ee-cac7a9a6c496');assert.equal(context.current().branchId,'16bd1aeb-5192-413b-b15c-7ee2fe2cf6c1');
function request(route,token,body){return new Promise((resolve,reject)=>{const req=https.request('https://123.57.238.244'+route,{method:body?'POST':'GET',rejectUnauthorized:false,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},timeout:15000},res=>{let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>{let data;try{data=JSON.parse(text)}catch{}if(res.statusCode!==200)return reject(Error(route+': HTTP '+res.statusCode+' '+text.slice(0,120)));resolve(data)});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Timeout')));if(body)req.write(JSON.stringify(body));req.end();});}
async function main(){
 let backupFile='/opt/store-erp/rollback/simulation-20261010-v1/data-before.json';const before=await pg.readStore();const preview=sim.build(structuredClone(before));
 if(!process.argv.includes('--commit')){console.log(JSON.stringify({mode:'preview',businessDataChanged:false,preview}));return}
 const result=await context.run({...context.current(),path:'simulation:import',userId:'demo-owner'},()=>pg.transaction(store=>{
  if((store.simulationBatches||[]).some(x=>x.id===sim.batchId))return sim.build(store);
  for(const k of ['products','inventory','purchases','sales','saleReturns'])assert.equal((store[k]||[]).length,0,'Only seed the existing empty simulation account: '+k);
  const folder='/opt/store-erp/rollback/simulation-20261010-v1';fs.mkdirSync(folder,{recursive:true,mode:0o700});if(fs.existsSync(backupFile))backupFile=folder+'/data-before-'+Date.now()+'.json';fs.writeFileSync(backupFile,JSON.stringify(store),{mode:0o600,flag:'wx'});
  return sim.build(store);
 }));
 const state=await pg.readStore();assert.equal(state.users.length,before.users.length);assert.equal(state.employeeKnowledge.length,before.employeeKnowledge.length);assert.equal(state.assistantDialogues.length,before.assistantDialogues.length);assert.equal((state.feishuNotices||[]).length,(before.feishuNotices||[]).length);
 const apiChecks=[];const token=await auth.issue('demo-owner');
 try{
  const inv=await request('/api/inventory',token);assert.equal(inv.length,15);assert.equal(inv.filter(x=>x.stockManaged!==false).reduce((n,x)=>n+x.quantity,0),96);apiChecks.push('线上15种商品、96件库存');
  const serial=await request('/api/serials/lookup?q=1234',token);assert.equal(serial.rows.length,1);assert.equal(serial.rows[0].serialNo,result.refs.practiceSerial);assert.equal(serial.ambiguous,false);apiChecks.push('线上后四位1234准确定位华为');
  const sales=await request('/api/sale-orders/page',token);assert.equal(sales.rows.length,4);apiChecks.push('线上销售分页返回4张模拟单');
  const report=await request('/api/reports',token);assert.equal(report.summary.netSales,4476);assert.equal(report.summary.adjustedGrossProfit,1236);apiChecks.push('线上销售净额4476、毛利1236');
  const org=await request('/api/organization/report',token);assert.equal(org.totals.netAmount,4476);assert.equal(org.totals.salesGrossProfit,1236);apiChecks.push('总部与门店汇总一致');
  const ask=(q,mode='store')=>request('/api/assistant/ask',token,{question:q,mode});
  const volume=await ask('今天卖了多少台手机');assert.equal(volume.metrics.netUnits,2);apiChecks.push('助理回答净售2台，与退货单一致');
  const stock=await ask('查华为库存，我要串号');assert.match(stock.answer,/1234/);assert.doesNotMatch(stock.answer,/OPPO|荣耀/);apiChecks.push('助理华为库存和串号指向准确');
  const customer=await ask('今天毛利多少','customer');assert.doesNotMatch(customer.answer,/1236|1800|4476/);apiChecks.push('顾客模式不泄露内部经营数据');
  const trace=await request('/api/search?scope=serials&q='+result.refs.practiceSerial,token);assert.ok(trace.serialTraces[0].purchase);apiChecks.push('串号可追原入库单');
  const invoices=await request('/api/search?scope=invoices&q=SIM-SALE-INV-001',token);assert.ok(invoices.results.sales.some(x=>x.id===result.refs.sales[0]));apiChecks.push('发票号码找到原销售单');
  const payroll=await request('/api/payroll?employeeId=demo-clerk',token);assert.equal(payroll.rows[0].manualAdjustment,35);assert.ok(payroll.businessChecks.every(x=>x.status==='accrued'));apiChecks.push('工资逐笔提成及35元奖励可查询');
  for(const route of ['/api/workbench','/api/receptions','/api/gift-approvals','/api/sale-payments','/api/daily-closeouts','/api/closeouts','/api/carrier-services','/api/work-journal','/api/product-price-changes']){await request(route,token);apiChecks.push(route)}
 }finally{await auth.revoke(token)}
 const publication={checkedAt:new Date().toISOString(),mode:'committed',businessDataChanged:true,simulationOnly:true,result,apiChecks,regression:{passed:gate.passed,failed:gate.failed},ui:{passed:ui.passed,views:ui.views.length,pageErrors:ui.pageErrors.length},preserved:{users:state.users.length,knowledge:state.employeeKnowledge.length,dialogues:state.assistantDialogues.length},externalNoticesAdded:0,backup:backupFile};
 fs.writeFileSync('/opt/store-erp/rollback/simulation-20261010-v1/published.json',JSON.stringify(publication,null,2),{mode:0o600});console.log(JSON.stringify(publication));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pg.close());
