const {randomUUID}=require('node:crypto');
const c=require('../common'),pg=require('./postgres'),context=require('./context');
async function summary(user){
 return pg.scoped(async(client,scope)=>{
  const tenant=(await client.query('SELECT code,name FROM erp_tenants WHERE id=$1',[scope.tenantId])).rows[0];
  const owner=user.roleCode==='owner';
  const branches=(await client.query("SELECT id,code,name,status FROM erp_branches WHERE tenant_id=$1"+(owner?'':' AND id=ANY($2::uuid[])')+' ORDER BY code',owner?[scope.tenantId]:[scope.tenantId,user.branchIds||[]])).rows;
  return {enabled:true,storage:'postgresql',tenant,currentBranchId:scope.branchId,branches,canManage:owner,capacityTarget:{branches:300,employeesPerBranch:100},phase:'branch-isolated-compatibility'};
 });
}
async function createBranch(user,body){
 c.permit(user,'manageUsers');
 const name=c.text(body.name,'门店名称'),code=c.text(body.code,'门店编号').toUpperCase();
 if(name.length>80||!/^[A-Z0-9_-]{2,20}$/.test(code))throw new c.HttpError(400,'门店编号用2至20位字母、数字或_-，名称最多80字');
 const id=randomUUID();
 return pg.scoped(async(client,scope)=>{
  await client.query('INSERT INTO erp_branches(tenant_id,id,code,name) VALUES($1,$2,$3,$4)',[scope.tenantId,id,code,name]);
  const template=(await client.query('SELECT key,data FROM erp_metadata WHERE tenant_id=$1 AND branch_id=$2',[scope.tenantId,scope.branchId])).rows;
  await client.query("SELECT set_config('app.branch_id',$1,true)",[id]);
  // Only explicit reusable workflow defaults; never copy balances, location, notices or personal settings.
  const reusable=new Set(['staffWorkflowSettings']);
  for(const row of template)if(reusable.has(row.key))
   await client.query('INSERT INTO erp_metadata VALUES($1,$2,$3,$4)',[scope.tenantId,id,row.key,JSON.stringify(row.data)]);
  await client.query("INSERT INTO erp_metadata VALUES($1,$2,'supplierModelVersion','2') ON CONFLICT DO NOTHING",[scope.tenantId,id]);
  const log={id:c.id('LOG'),operatorId:user.id,operator:user.name,action:'branch:create',detail:code+' '+name,createdAt:c.now()};
  await client.query("INSERT INTO erp_records VALUES($1,$2,'operationLogs',$3,0,$4,now())",[scope.tenantId,id,log.id,JSON.stringify(log)]);
  return {id,code,name,status:'active'};
 },{sharedWrite:true});
}
async function grant(user,body){
 c.permit(user,'manageUsers');
 if(!Array.isArray(body.branchIds)||!body.branchIds.length||body.branchIds.length>300)throw new c.HttpError(400,'请选择授权门店');
 const ids=[...new Set(body.branchIds)];
 if(ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))throw new c.HttpError(400,'门店编号不正确');
 return pg.scoped(async(client,scope)=>{
  const branches=await client.query("SELECT id FROM erp_branches WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='active'",[scope.tenantId,ids]);
  if(branches.rowCount!==ids.length)throw new c.HttpError(400,'授权门店不存在');
  const row=(await client.query("SELECT data FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND record_key=$2 FOR UPDATE",[scope.tenantId,body.userId])).rows[0];
  if(!row||row.data.roleCode==='owner')throw new c.HttpError(400,'请选择非老板员工');
  row.data.branchIds=ids;
  await client.query("UPDATE erp_shared_records SET data=$3 WHERE tenant_id=$1 AND collection='users' AND record_key=$2",[scope.tenantId,body.userId,JSON.stringify(row.data)]);
  await client.query('DELETE FROM erp_sessions WHERE tenant_id=$1 AND user_id=$2',[scope.tenantId,body.userId]);
  const log={id:c.id('LOG'),operatorId:user.id,operator:user.name,action:'branch:grant',detail:row.data.name+' 授权门店 '+ids.join(','),createdAt:c.now()};
  const rank=Number((await client.query("SELECT COALESCE(min(rank),0)-1000000 AS rank FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='operationLogs'",[scope.tenantId,scope.branchId])).rows[0].rank);
  await client.query("INSERT INTO erp_records VALUES($1,$2,'operationLogs',$3,$4,$5,now())",[scope.tenantId,scope.branchId,log.id,rank,JSON.stringify(log)]);
  return {userId:body.userId,branchIds:ids};
 },{sharedWrite:true});
}
module.exports={summary,createBranch,grant};
