const {randomBytes,createHash,scrypt,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util');
const hash=promisify(scrypt);
const pg=require('./postgres'),context=require('./context');
const digest=token=>createHash('sha256').update(token).digest('hex');
const normalize=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
function username(value){const result=normalize(value);if(!/^[\p{L}\p{N}_.-]{2,32}$/u.test(result))throw Error('账号须为2至32位汉字、字母、数字或_.-');return result;}
async function getForUser(id){return pg.scoped(async(client,scope)=>{const row=(await client.query('SELECT username FROM erp_credentials WHERE tenant_id=$1 AND user_id=$2',[scope.tenantId,id])).rows[0];return row?{username:row.username}:null;});}
async function set(id,value,secret){
 const name=username(value);if(typeof secret!=='string'||secret.length<10||secret.length>128)throw Error('密码须为10至128位');
 const salt=randomBytes(32).toString('hex'),passwordHash=(await hash(secret,Buffer.from(salt,'hex'),64)).toString('hex');
 return pg.scoped(async(client,scope)=>{
  const user=(await client.query("SELECT data FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND record_key=$2",[scope.tenantId,id])).rows[0]?.data;
  if(!user)throw Error('员工不存在');
  await client.query('INSERT INTO erp_credentials(tenant_id,user_id,username,salt,password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,user_id) DO UPDATE SET username=EXCLUDED.username,salt=EXCLUDED.salt,password_hash=EXCLUDED.password_hash,failures=0,locked_until=0',[scope.tenantId,id,name,salt,passwordHash]);
  return {username:name};
 });
}
async function verify(value,secret){
 let name;try{name=username(value);}catch{return {ok:false};}
 if(typeof secret!=='string'||secret.length>128)return {ok:false};
 return pg.scoped(async(client,scope)=>{
  const row=(await client.query('SELECT * FROM erp_credentials WHERE tenant_id=$1 AND username=$2 FOR UPDATE',[scope.tenantId,name])).rows[0];
  if(!row){await hash(secret,Buffer.alloc(32),64);return {ok:false};}
  if(Number(row.locked_until)>Date.now())return {ok:false,locked:true};
  const candidate=await hash(secret,Buffer.from(row.salt,'hex'),64);
  if(!timingSafeEqual(candidate,Buffer.from(row.password_hash,'hex'))){
   const failures=Number(row.locked_until)&&Number(row.locked_until)<=Date.now()?1:row.failures+1;
   await client.query('UPDATE erp_credentials SET failures=$3,locked_until=$4 WHERE tenant_id=$1 AND user_id=$2',[scope.tenantId,row.user_id,failures,failures>=5?Date.now()+900000:0]);
   return {ok:false,locked:failures>=5};
  }
  const user=(await client.query("SELECT data FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND record_key=$2",[scope.tenantId,row.user_id])).rows[0]?.data;
  if(!user||user.status!=='active')return {ok:false};
  const allowed=user.roleCode==='owner'?[scope.branchId]:user.branchIds||[];
  const branches=await client.query("SELECT id FROM erp_branches WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='active' ORDER BY code LIMIT 1",[scope.tenantId,allowed]);
  if(!branches.rowCount)return {ok:false};
  await client.query('UPDATE erp_credentials SET failures=0,locked_until=0 WHERE tenant_id=$1 AND user_id=$2',[scope.tenantId,row.user_id]);
  return {ok:true,userId:row.user_id,branchId:branches.rows[0].id};
 });
}
async function verifyForUser(id,secret){const found=await getForUser(id);return found?(await verify(found.username,secret)).ok:false;}
async function issue(id){
 const scope=context.required(),token=randomBytes(32).toString('base64url');
 await pg.connection().query('INSERT INTO erp_sessions VALUES($1,$2,$3,$4,$5)',[digest(token),scope.tenantId,scope.branchId,id,Date.now()+28800000]);
 return token;
}
async function get(token){
 if(!token||token.length>160)return null;
 const row=(await pg.connection().query('SELECT tenant_id,branch_id,user_id,expires_at FROM erp_sessions WHERE token_hash=$1 AND expires_at>$2',[digest(token),Date.now()])).rows[0];
 if(!row)return null;
 return context.run({tenantId:row.tenant_id,branchId:row.branch_id},()=>pg.scoped(async(client,scope)=>{
  const user=(await client.query("SELECT u.data FROM erp_shared_records u JOIN erp_tenants t ON t.id=u.tenant_id AND t.status='active' WHERE u.tenant_id=$1 AND u.collection='users' AND u.record_key=$2",[scope.tenantId,row.user_id])).rows[0]?.data;
  if(!user||user.status!=='active'||(user.roleCode!=='owner'&&!(user.branchIds||[]).includes(scope.branchId)))return null;
  return {tenantId:scope.tenantId,branchId:scope.branchId,userId:user.id,user,expiresAt:Number(row.expires_at)};
 })).catch(error=>{if(error.statusCode===403)return null;throw error;});
}
async function revoke(token){if(token)await pg.connection().query('DELETE FROM erp_sessions WHERE token_hash=$1',[digest(token)]);}
async function revokeUser(id){const scope=context.required();await pg.connection().query('DELETE FROM erp_sessions WHERE tenant_id=$1 AND user_id=$2',[scope.tenantId,id]);}
async function switchBranch(token,branchId,user){
 if(typeof branchId!=='string'||!/^[a-f0-9-]{36}$/i.test(branchId))throw new (require('../common').HttpError)(400,'门店编号不正确');
 return pg.scoped(async(client,scope)=>{
  if(user.roleCode!=='owner'&&!(user.branchIds||[]).includes(branchId))throw new (require('../common').HttpError)(403,'没有此门店权限');
  const branch=(await client.query("SELECT id,name,code FROM erp_branches WHERE tenant_id=$1 AND id=$2 AND status='active'",[scope.tenantId,branchId])).rows[0];
  if(!branch)throw new (require('../common').HttpError)(403,'门店不存在或已停用');
  await client.query('UPDATE erp_sessions SET branch_id=$3 WHERE token_hash=$1 AND tenant_id=$2',[digest(token),scope.tenantId,branchId]);
  return branch;
 });
}
function token(req){return String(req.headers.authorization||'').replace(/^Bearer /,'')||String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('erp_session='))?.slice(12)||'';}
async function request(req,work){
 if(!new URL(req.url,'http://localhost').pathname.startsWith('/api/'))return context.run(context.current(),work);
 const session=await get(token(req));req.erpSession=session;
 return context.run({...(session||context.current()),path:new URL(req.url,'http://localhost').pathname,userId:session?.userId},work);
}
module.exports={getForUser,set,verify,verifyForUser,issue,get,revoke,revokeUser,switchBranch,request,token,generatePassword:()=>randomBytes(15).toString('base64url')};
