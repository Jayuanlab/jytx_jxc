const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
test('登录会话跨进程可用，退出后立即失效，有效期仍为八小时',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'erp-auth-session-test-'));
 const filename=path.join(dir,'sessions.sqlite');
 process.env.STORE_AUTH_DB_PATH=filename;
 const auth=require('./auth-sessions');
 try{
  const token=auth.issue('employee-test');
  assert.equal(auth.get(token).userId,'employee-test');
  assert.ok(auth.get(token).expiresAt-Date.now()<=8*60*60*1000);
  assert.equal(fs.readFileSync(filename).includes(Buffer.from(token)),false);
  const child=spawnSync(process.execPath,['-e','const a=require(process.argv[1]); process.stdout.write(a.get(process.argv[2])?.userId||"none")',path.join(__dirname,'auth-sessions.js'),token],{env:{...process.env,STORE_AUTH_DB_PATH:filename},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.equal(child.stdout,'employee-test');
  auth.revoke(token);
  assert.equal(auth.get(token),null);
  const after=spawnSync(process.execPath,['-e','const a=require(process.argv[1]); process.stdout.write(a.get(process.argv[2])?.userId||"none")',path.join(__dirname,'auth-sessions.js'),token],{env:{...process.env,STORE_AUTH_DB_PATH:filename},encoding:'utf8'});
  assert.equal(after.status,0,after.stderr);
  assert.equal(after.stdout,'none');
 }finally{
  auth.close();
  const parent=fs.realpathSync(os.tmpdir());
  if(fs.realpathSync(path.dirname(dir))===parent&&path.basename(dir).startsWith('erp-auth-session-test-'))fs.rmSync(dir,{recursive:true,force:true});
 }
});
