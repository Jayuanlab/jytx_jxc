'use strict';
const assert=require('node:assert/strict'),{Pool}=require('pg'),{randomUUID}=require('node:crypto');
if(!process.env.STORE_PG_URL?.endsWith('/store_erp_capacity_test'))throw Error('Isolated verification database required');
process.env.STORE_ENGINE='postgres';process.env.HIDE_FEISHU='1';process.env.NODE_ENV='production';
const admin=new Pool({host:'/var/run/postgresql',user:'postgres',database:'store_erp_capacity_test',max:1});
const pg=require('../../server/src/capacity/postgres'),ctx=require('../../server/src/capacity/context'),auth=require('../../server/src/capacity/auth'),c=require('../../server/src/common');
const tenant=randomUUID(),branch=randomUUID(),branch2=randomUUID(),passed=[];
const owner={id:'owner',name:'验证老板',roleCode:'owner',status:'active',branchIds:[branch,branch2]},staff={id:'staff',name:'验证员工',roleCode:'employee',status:'active',permissions:['sale:create'],branchIds:[branch]};
const run=(fn,path='/api/assistant/feedback',id=branch)=>ctx.run({tenantId:tenant,branchId:id,path,userId:owner.id},fn);
let server,ownerToken,staffToken;
(async()=>{
 await admin.query('INSERT INTO erp_tenants VALUES($1,$2,$3,$4)',[tenant,'FEEDBACK_'+tenant.slice(0,8),'问答验证','active']);
 for(const [id,code]of[[branch,'001'],[branch2,'002']])await admin.query('INSERT INTO erp_branches VALUES($1,$2,$3,$4,$5)',[tenant,id,code,'验证店'+code,'active']);
 for(const user of[owner,staff])await admin.query("INSERT INTO erp_shared_records VALUES($1,'users',$2,0,$3)",[tenant,user.id,JSON.stringify(user)]);
 server=require('../../server/src/application').createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 ownerToken=await run(()=>auth.issue(owner.id));staffToken=await run(()=>auth.issue(staff.id));
 async function request(token,path,body,key=randomUUID()){
  const res=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};
 }
 const q='请问云阳妹儿在不在',body={question:q,originalAnswer:'还没有理解',reason:'请补充迎宾回答',suggestion:'你好，我来帮你。'};
 const key=randomUUID(),submitted=await request(staffToken,'/api/assistant/feedback',body,key);assert.equal(submitted.status,200);assert.equal((await request(staffToken,'/api/assistant/feedback',body,key)).data.id,submitted.data.id);
 let rows=(await request(ownerToken,'/api/assistant/feedback')).data.rows;assert.equal(rows.length,1);assert.equal((await run(()=>pg.readStore())).assistantAnswerFeedback.length,1);passed.push('PostgreSQL员工纠错持久保存和幂等重试');
 assert.equal((await request(staffToken,'/api/assistant/feedback/review',{id:rows[0].id})).status,403);
 const row=rows[0],review={id:row.id,version:row.version,targetId:row.targetId,targetVersion:row.targetVersion,decision:'apply',note:'已经核对',answer:'你好，我来帮你。',questions:[q,'云阳妹儿在吗'],customerVisible:false};
 const concurrent=await Promise.all([request(ownerToken,'/api/assistant/feedback/review',review),request(ownerToken,'/api/assistant/feedback/review',review)]);assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
 const state=await run(()=>pg.readStore());assert.equal(state.assistantAnswerFeedback[0].status,'已生效');assert.equal(state.assistantDialogues.length,1);assert.equal(state.sales.length,0);passed.push('老板审核原子生效，重复审批拒绝且不产生财务业务');
 const another=await run(()=>pg.readStore(),'/api/assistant/feedback',branch2);assert.equal(another.assistantAnswerFeedback.length,0);assert.equal(another.assistantDialogues.length,1);passed.push('分店纠错独立、审核后的知识企业共用');
 const business=await request(staffToken,'/api/assistant/feedback',{question:'今天营业额多少',originalAnswer:'需要核对',reason:'请核查数据'});assert.equal(business.status,200);
 rows=(await request(ownerToken,'/api/assistant/feedback')).data.rows;assert.equal(rows[0].canApply,false);
 await run(()=>pg.transaction(s=>require('../../server/src/staff-workflow').enable(s,owner)),'/api/users');
 const me=await request(staffToken,'/api/me');for(const cap of['purchase','cost','manageProducts','stocktake','supplierView'])assert.equal(me.data.capabilities[cap],true);assert.equal(me.data.capabilities.manageUsers,false);assert.equal(me.data.capabilities.supplierSettle,false);
 assert.equal((await request(staffToken,'/api/procurement-plans')).status,200);assert.equal((await request(staffToken,'/api/suppliers/directory')).status,200);passed.push('员工现有会话立即获得本店采购和进价权限，审批权限仍受控');
 console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{if(ownerToken)await auth.revoke(ownerToken);if(staffToken)await auth.revoke(staffToken);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}await pg.close();await admin.end()});
