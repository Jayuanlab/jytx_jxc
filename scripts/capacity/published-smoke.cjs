'use strict';
const assert=require('node:assert/strict'),https=require('node:https'),fs=require('node:fs');
if(process.env.STORE_ENGINE!=='postgres'||!process.env.STORE_PG_URL?.endsWith('/store_erp_capacity_v2'))throw Error('Verify the published empty account set only');
const pg=require('../../server/src/capacity/postgres'),ctx=require('../../server/src/capacity/context'),auth=require('../../server/src/capacity/auth');
function request(path,token){
 return new Promise((resolve,reject)=>{
  const req=https.get('https://123.57.238.244'+path,{rejectUnauthorized:false,headers:token?{Authorization:'Bearer '+token}:{},timeout:15000},res=>{
   let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>{let data;try{data=JSON.parse(text)}catch{}resolve({status:res.statusCode,text,data})});
  });req.on('timeout',()=>req.destroy(Error('Timed out')));req.on('error',reject);
 });
}
async function main(){
 await pg.health();
 const state=await ctx.run(ctx.current(),()=>pg.readStore());
 const owner=state.users.find(x=>x.roleCode==='owner'&&x.status==='active');assert.ok(owner);
 const empty=['products','sales','purchases','inventory','receptions','expenses','receipts','saleReturns','purchaseReturns','commissionEntries','payrollStatements','payrollAdjustments','staffMessages','staffMessageReads','customers','suppliers','cardBusinesses','cashHandovers','fundTransfers','airRechargeEvents'];
 for(const collection of empty)assert.equal((state[collection]||[]).length,0,collection+' must be empty');
 assert.equal(state.users.length,4);assert.equal(state.employeeKnowledge.length,246);assert.equal(state.assistantDialogues.length,1);
 const health=await request('/health');assert.equal(health.status,200);assert.equal(health.data.storage,'postgresql');
 const checks=['public-health-postgresql','empty-business-ledger','users-knowledge-dialogues-preserved'];
 for(const path of ['/organization','/organization.js','/organization.css','/branch-context.js','/m','/app?tab=sales','/assistant']){
  const res=await request(path);assert.equal(res.status,200,path);
  if(['/m','/app?tab=sales','/assistant'].includes(path))assert.ok(res.text.includes('branch-context.js'),path+' branch guard');
  checks.push('public'+path);
 }
 assert.equal((await request('/api/organization')).status,401);
 const token=await ctx.run(ctx.current(),()=>auth.issue(owner.id));
 try{
  const organization=await request('/api/organization',token);assert.equal(organization.status,200);assert.equal(organization.data.branches.length,1);assert.equal(organization.data.currentBranchId,ctx.current().branchId);
  const sales=await request('/api/sale-orders/page',token);assert.equal(sales.status,200);assert.equal(sales.data.rows.length,0);
  const report=await request('/api/organization/report',token);assert.equal(report.status,200);assert.equal(report.data.totals.saleCount,0);assert.equal(report.data.totals.netAmount,0);
  for(const path of ['/api/me','/api/assistant/capabilities','/api/assistant/knowledge','/api/inventory']){
   const res=await request(path,token);assert.equal(res.status,200,path);
  }
  checks.push('authenticated-organization','empty-sales-page','empty-branch-report','assistant-and-inventory-APIs');
 }finally{await auth.revoke(token)}
 const result={checkedAt:new Date().toISOString(),storage:'postgresql',preserved:{users:state.users.length,knowledge:state.employeeKnowledge.length,customDialogues:state.assistantDialogues.length},business:Object.fromEntries(empty.map(k=>[k,(state[k]||[]).length])),checks};
 const target=process.argv[2];if(target)fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>pg.close());
