process.env.NODE_ENV='test';
process.env.STORE_DB_PATH=':memory:';
process.env.STORE_AUTH_DB_PATH=':memory:';
process.env.STORE_CREDENTIALS_DB_PATH=':memory:';
process.env.STORE_SEED_PATH=require('node:path').join(__dirname,'..','..','examples','test-store.json');
process.env.APP_PUBLIC_ORIGIN='http://127.0.0.1';
process.env.HIDE_FEISHU='1';
process.env.FEISHU_APP_ID='cli_test';
process.env.FEISHU_APP_SECRET='secret_for_test';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('./application');
const {readStore,transaction}=require('./repository');
const credentials=require('./local-credentials');
const sessions=require('./auth-sessions');
const {notice}=require('./feishu-notices');
test('阿里云独立模式：本地登录、业务消息留痕与已阅',async()=>{
  const owner=readStore().users.find(u=>u.roleCode==='owner');
  credentials.set(owner.id,'老板','OwnerPass987654');
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
  try {
    assert.equal((await fetch(base+'/api/auth/feishu/start',{redirect:'manual'})).status,503);
    const signed=await post('/api/auth/local/login',{username:'老板',password:'OwnerPass987654'});
    assert.equal(signed.status,200);
    const cookie=signed.headers.get('set-cookie').split(';')[0];
    transaction(store=>notice(store,'test:sale:1','销售开单',{id:'SO-1',summary:'测试员工提交销售单',amount:39}));
    const listing=await (await fetch(base+'/api/local-notices',{headers:{Cookie:cookie}})).json();
    assert.equal(listing.unread,1);
    assert.equal(listing.rows[0].orderId,'SO-1');
    const read=await post('/api/local-notices/read',{key:'test:sale:1'},cookie);
    assert.equal(read.status,200);
    assert.equal((await (await fetch(base+'/api/local-notices',{headers:{Cookie:cookie}})).json()).unread,0);
    assert.ok(readStore().operationLogs.some(row=>row.action==='notice:read'));
    assert.equal((await fetch(base+'/api/local-notices')).status,401);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    credentials.close();
    sessions.close();
  }
});

