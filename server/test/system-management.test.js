'use strict';
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.STORE_BACKUP_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'store-backups-test-'));
const c=require('../src/common'),permissions=require('../src/staff-permissions'),fields=require('../src/staff-permission-catalog'),backups=require('../src/store-backups'),context=require('../src/capacity/context'),workflow=require('../src/staff-workflow');
const owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'营业员',roleCode:'employee',status:'active',permissions:['sale:create','sale:return']},guest={id:'guest',name:'顾客',roleCode:'customer-assistant',status:'active'};
function seed(){return c.initialize({users:structuredClone([owner,staff,guest]),products:[{skuId:'one',name:'测试手机',trackSerial:true}],inventory:[{skuId:'one',quantity:1,serials:[{no:'869000000001234',status:'可售'}]}],sales:[{id:'S-1',amount:1999}],purchases:[],assistantDialogues:[{id:'D-1',question:'学习'}]});}
function selection(s,id='staff'){const d=permissions.get(s,owner,id);return {userId:id,roleCode:d.user.roleCode,revision:d.revision,capabilities:Object.fromEntries(fields.map(x=>[x.key,d.user.capabilities[x.key]]))};}
test('权限增减立即生效，店长的默认权限也可收回，日志记录变更前后',()=>{
 const s=seed(),body=selection(s);body.capabilities.sell=false;body.capabilities.purchase=true;body.capabilities.cost=true;body.roleCode='manager';permissions.save(s,owner,body);
 const caps=c.capabilities(s.users[1]);assert.equal(caps.sell,false);assert.equal(caps.purchase,true);assert.equal(caps.cost,true);assert.equal(caps.finance,false);assert.equal(caps.manageUsers,false);assert.equal(caps.opening,false);
 assert.throws(()=>c.permit(s.users[1],'sell'),e=>e.statusCode===403);c.permit(s.users[1],'purchase');assert.ok(s.operationLogs[0].detail.before);assert.equal(s.operationLogs[0].detail.after.capabilities['销售开单'],false);
});
test('员工不能改权限、不能把自己升级老板，顾客与老板账号不能被修改',()=>{
 const s=seed(),body=selection(s);assert.throws(()=>permissions.save(s,staff,body),e=>e.statusCode===403);assert.throws(()=>permissions.save(s,owner,{...body,roleCode:'owner'}),e=>e.statusCode===400);
 for(const id of ['boss','guest'])assert.throws(()=>permissions.save(s,owner,{...body,userId:id}),e=>e.statusCode===400);
 assert.throws(()=>permissions.save(s,owner,{...body,capabilities:{...body.capabilities,manageUsers:true}}),e=>e.statusCode===400);
 assert.equal(s.operationLogs.length,0);
});
test('权限并发版本和输入验证保留现有权限，岗位默认保持本店采购进价可见',()=>{
 const s=seed();workflow.enable(s,owner);const body=selection(s),defaults=permissions.get(s,owner,'staff').defaults.employee;
 for(const key of ['sell','purchase','cost','manageProducts','stocktake','supplierView'])assert.equal(defaults[key],true);
 permissions.save(s,owner,body);const before=JSON.stringify(s.users);
 assert.throws(()=>permissions.save(s,owner,body),e=>e.statusCode===409);assert.equal(JSON.stringify(s.users),before);
 const invalid=selection(s);delete invalid.capabilities.sell;assert.throws(()=>permissions.save(s,owner,invalid),e=>e.statusCode===400);
});
test('备份恢复完整业务、自动保存恢复前版本、保留账号知识和操作历史',()=>{
 const s=seed(),created=backups.create(s,owner),envelope=JSON.parse(backups.download(s,owner,created.id));
 assert.equal(envelope.payload.users,undefined);assert.equal(envelope.payload.assistantDialogues,undefined);
 s.sales.push({id:'S-2',amount:888});s.products[0].name='改后的手机';const preview=backups.preview(s,owner,{backup:envelope}),users=structuredClone(s.users);
 const restored=backups.restore(s,owner,{backup:envelope,token:preview.token,confirmed:true});
 assert.equal(s.sales.length,1);assert.equal(s.products[0].name,'测试手机');assert.deepEqual(s.users,users);assert.equal(s.assistantDialogues.length,1);
 const safety=JSON.parse(backups.download(s,owner,restored.safetyBackupId));assert.equal(safety.payload.sales.length,2);assert.equal(safety.payload.products[0].name,'改后的手机');
 assert.ok(s.operationLogs.some(x=>x.action==='backup:restore'));assert.ok(backups.list(s,owner).rows.length>=2);
});
test('损坏文件、其他门店、员工访问、未确认和过期预览均拒绝且保留原账',()=>{
 const s=seed(),created=backups.create(s,owner),envelope=JSON.parse(backups.download(s,owner,created.id)),preview=backups.preview(s,owner,{backup:envelope});
 assert.throws(()=>backups.download(s,staff,created.id),e=>e.statusCode===403);
 const changed=structuredClone(envelope);changed.payload.sales=[];assert.throws(()=>backups.preview(s,owner,{backup:changed}),e=>e.statusCode===400);
 assert.throws(()=>context.run({tenantId:'other',branchId:'other'},()=>backups.preview(s,owner,{backup:envelope})),e=>e.statusCode===409);
 assert.throws(()=>backups.restore(s,owner,{backup:envelope,token:preview.token,confirmed:false}),e=>e.statusCode===400);
 assert.throws(()=>backups.restore(s,owner,{backup:envelope,token:{...preview.token,expiresAt:0},confirmed:true}),e=>e.statusCode===409);
 assert.throws(()=>backups.download(s,owner,'../data'),e=>e.statusCode===400);assert.equal(s.sales.length,1);
});
test('预览后又发生交易时拒绝覆盖，重新预览方可恢复',()=>{
 const s=seed(),created=backups.create(s,owner),backup=JSON.parse(backups.download(s,owner,created.id)),preview=backups.preview(s,owner,{backup});
 s.sales.push({id:'NEW'});const before=JSON.stringify(s);
 assert.throws(()=>backups.restore(s,owner,{backup,token:preview.token,confirmed:true}),e=>e.statusCode===409);assert.equal(JSON.stringify(s),before);
 const fresh=backups.preview(s,owner,{backup});backups.restore(s,owner,{backup,token:fresh.token,confirmed:true});assert.equal(s.sales.length,1);
});
test('权限和备份HTTP鉴权、幂等、恢复事务及现有会话权限刷新',async()=>{
 const repo=require('../src/repository'),{createServer}=require('../src/application'),sessions=require('../src/auth-sessions');repo.resetStore(seed());const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const tokens={boss:sessions.issue('boss'),staff:sessions.issue('staff'),guest:sessions.issue('guest')};
 async function request(p,body,who='boss',key='key-'+Math.random()){const r=await fetch(base+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(tokens[who]?{Authorization:'Bearer '+tokens[who]}:{}),'Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,headers:r.headers,body:await r.json()};}
 try{
  for(const p of ['/api/users/permissions?userId=staff','/api/system/backups']){assert.equal((await request(p,null,'none')).status,401);assert.equal((await request(p,null,'staff')).status,403);assert.equal((await request(p,null,'guest')).status,403);}
  const d=(await request('/api/users/permissions?userId=staff')).body,body={userId:'staff',roleCode:'employee',revision:d.revision,capabilities:Object.fromEntries(fields.map(x=>[x.key,d.user.capabilities[x.key]]))};body.capabilities.sell=false;
  assert.equal((await request('/api/users/permissions',body,'staff')).status,403);
  const saved=await request('/api/users/permissions',body,'boss','permissions-same');assert.equal(saved.status,200);assert.equal((await request('/api/users/permissions',body,'boss','permissions-same')).status,200);assert.equal(repo.readStore().users.find(x=>x.id==='staff').permissionRevision,1);
  assert.equal((await request('/api/me',null,'staff')).body.capabilities.sell,false);assert.equal((await request('/api/sale-orders',{items:[]},'staff')).status,403);
  const first=await request('/api/system/backups',{},'boss','backup-same');assert.equal(first.status,200);assert.equal((await request('/api/system/backups',{},'boss','backup-same')).body.id,first.body.id);
  const fetched=await request('/api/system/backups/download?id='+first.body.id);assert.match(fetched.headers.get('content-disposition'),/attachment/);assert.equal(fetched.body.format,'juyou-branch-backup');
  repo.transaction(s=>s.sales.push({id:'NEW-HTTP',amount:20}));
  const preview=(await request('/api/system/backups/preview',{backup:fetched.body})).body;
  const restore={backup:fetched.body,token:preview.token,confirmed:true};
  assert.equal((await request('/api/system/backups/restore',restore,'staff')).status,403);
  const result=await request('/api/system/backups/restore',restore,'boss','restore-same');assert.equal(result.status,200);assert.equal(repo.readStore().sales.length,1);
  const repeated=await request('/api/system/backups/restore',restore,'boss','restore-same');assert.equal(repeated.body.safetyBackupId,result.body.safetyBackupId);assert.equal(repo.readStore().users.find(x=>x.id==='staff').capabilityOverrides.sell,false);
 }finally{await new Promise(r=>server.close(r));}
});
