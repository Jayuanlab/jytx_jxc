process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../src/common'),repository=require('../src/repository'),{createServer}=require('../src/application');
test('串号盘库HTTP权限、幂等、差异审核和失败事务保留原账',async()=>{
 const first='860000000001234',second='860000000009999';
 repository.resetStore(c.initialize({users:[{id:'boss',name:'老板',roleCode:'owner',status:'active'},{id:'staff',name:'店员',roleCode:'employee',status:'active',permissions:['sale:create']},{id:'keeper',name:'仓管',roleCode:'warehouse',status:'active',permissions:['stock:adjust']}],products:[{skuId:'phone',name:'测试手机',externalCode:'P1',type:'智能手机',stockManaged:true,trackSerial:true,warehouseId:'wh-a',salePrice:1999}],inventory:[{skuId:'phone',warehouseId:'wh-a',warehouseName:'A仓',quantity:2,costPrice:1000,stockValue:2000,serials:[{no:first,status:'可售',costPrice:1000},{no:second,status:'可售',costPrice:1000}]}]}));
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,body,token,key)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 try{
  assert.equal((await request('/api/serial-stocktakes')).status,401);
  const boss=(await request('/api/auth/login',{userId:'boss'})).body.token,staff=(await request('/api/auth/login',{userId:'staff'})).body.token,keeper=(await request('/api/auth/login',{userId:'keeper'})).body.token;
  assert.equal((await request('/api/serial-stocktakes',null,staff)).status,403);
  const payload={skuId:'phone',warehouseId:'wh-a',expectedQuantity:2,expectedSerials:[first,second],serials:[first],reason:'现场漏了一台，等待交叉核实'};
  const before=JSON.stringify(repository.readStore().inventory);
  assert.equal((await request('/api/serial-stocktakes',payload,staff,'deny-count')).status,403);
  const result=await request('/api/serial-stocktakes',payload,keeper,'count-one');assert.equal(result.status,200);assert.equal(result.body.status,'差异待核实');
  const repeat=await request('/api/serial-stocktakes',payload,keeper,'count-one');assert.equal(repeat.body.id,result.body.id);assert.equal(repository.readStore().stocktakes.length,1);
  assert.equal((await request('/api/workbench',null,boss)).body.reviews.serialStocktake,1);
  assert.equal((await request('/api/serial-stocktakes/review',{id:result.body.id,note:'已核对'},keeper,'deny-review')).status,403);
  assert.equal((await request('/api/serial-stocktakes/review',{id:result.body.id,note:'已找到，重新盘库'},boss,'review-one')).status,200);
  assert.equal((await request('/api/serial-stocktakes',null,keeper)).body[0].status,'已核实');
  assert.equal((await request('/api/serial-stocktakes',{...payload,expectedQuantity:3},keeper,'stale-count')).status,409);
  assert.equal((await request('/api/inventory/bind-serials',{...payload,serials:['860000000003333'],reason:'尝试超过缺号数量'},keeper,'bad-bind')).status,409);
  assert.equal(repository.readStore().stocktakes.length,1);assert.equal(JSON.stringify(repository.readStore().inventory),before);
 }finally{await new Promise(r=>server.close(r));}
});
