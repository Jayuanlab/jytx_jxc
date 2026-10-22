'use strict';
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict'),list=require('../src/sales-list');
const owner={id:'boss',name:'老板',roleCode:'owner'},clerk={id:'e1',name:'营业员甲',roleCode:'employee',permissions:['sale:create']};
const base={users:[owner,clerk,{id:'e2',name:'营业员乙'}],products:[{skuId:'phone',name:'手机'},{skuId:'cable',name:'数据线'}],suppliers:[{id:'s1',name:'华南供应商'},{id:'s2',name:'西南供应商'}],purchases:[
{id:'p1',supplierId:'s1',supplier:'华南供应商',createdAt:'2026-10-01T00:00:00.000Z',items:[{id:'pi1',skuId:'phone',warehouseId:'wh-a',serials:['350000000001234']},{id:'ci1',skuId:'cable'}]},
{id:'p2',supplierId:'s2',supplier:'西南供应商',createdAt:'2026-10-01T00:00:00.000Z',items:[{id:'ci2',skuId:'cable'}]}],
sales:[
{id:'SO-1',createdAt:'2026-10-10T02:00:30.000Z',salespersonId:'e1',salesperson:'营业员甲',items:[{id:'si1',skuId:'phone',name:'测试手机',stockManaged:true,serialNo:'350000000001234',warehouseId:'wh-a',warehouseName:'A仓',quantity:1,salePrice:2599,amount:2599,returnedQuantity:0}]},
{id:'SO-2',createdAt:'2026-10-10T03:00:00.000Z',salespersonId:'e2',salesperson:'营业员乙',items:[{id:'si2',skuId:'cable',name:'数据线',stockManaged:true,warehouseId:'wh-b',warehouseName:'B仓',quantity:4,salePrice:10,amount:40,returnedQuantity:1,costSources:[{sourceId:'ci1',quantity:1},{sourceId:'ci2',quantity:3}]}]},
{id:'SO-3',createdAt:'2026-10-09T00:00:00.000Z',salespersonId:'e1',salesperson:'营业员甲',redReversedBy:'R1',items:[{id:'si3',skuId:'phone',name:'已红冲手机',stockManaged:true,warehouseId:'wh-a',quantity:1,salePrice:2000,amount:2000,returnedQuantity:1,serialNo:'unknown'}]}]};
const report=(query='',user=owner,store=base)=>list.report(structuredClone(store),user,list.filters(new URLSearchParams(query)));
test('日期和时间按北京时间、结束分钟包含整分钟；错误日期需明确拒绝',()=>{
 assert.equal(report('from=2026-10-10T10:00&to=2026-10-10T10:00').totals.orderCount,1);
 assert.equal(report('from=2026-10-09&to=2026-10-09').totals.orderCount,1);
 for(const q of ['from=2026-02-30','from=2026-99-99','from=2026-10-10T25:00','from=2026-10-11&to=2026-10-10','page=-1'])assert.throws(()=>report(q),e=>e.statusCode===400);
});
test('仓库、营业员、商品、供货商和串号可同时筛选，来源取原入库单',()=>{
 const r=report('warehouse=wh-a&salesperson=e1&product=phone&supplier=s1&q=1234');
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].orderId,'SO-1');assert.equal(r.rows[0].suppliers[0].name,'华南供应商');assert.equal(r.totals.netAmount,2599);
 assert.equal(report('warehouse=wh-b&supplier=s1&product=phone').rows.length,0);
});
test('供货来源混合商品按出库比例分摊，数量和金额不重复累加',()=>{
 const r=report('from=2026-10-10&to=2026-10-10&product=cable');
 assert.equal(r.totals.netAmount,30);assert.equal(r.totals.netQuantity,3);
 assert.equal(r.supplierSummary.reduce((n,s)=>n+s.netAmount,0),30);
 const s1=report('product=cable&supplier=s1');assert.equal(s1.totals.netQuantity,.75);assert.equal(s1.totals.netAmount,7.5);assert.equal(s1.rows[0].allocation,true);
});
test('累计退货和红冲扣减；汇总包含所有页，销售状态保留',()=>{
 const r=report('limit=1');assert.equal(r.rows.length,1);assert.equal(r.totals.orderCount,3);assert.equal(r.totals.netAmount,2629);assert.equal(r.totals.returnedAmount,2010);assert.equal(r.pages,3);
 assert.equal(report('q=SO-3').rows[0].status,'已红冲');assert.equal(report('q=SO-3').totals.netQuantity,0);
});
test('员工只见本人销售；不能用筛选参数读取其他营业员，返回不含成本',()=>{
 const r=report('',clerk);assert.equal(r.totals.orderCount,2);assert.ok(r.rows.every(x=>x.salespersonId==='e1'));assert.throws(()=>report('salesperson=e2',clerk),e=>e.statusCode===403);
 assert.ok(!JSON.stringify(r).includes('costPrice'));assert.ok(!r.options.salespeople.some(x=>x.id==='e2'));
});
test('供应来源不清楚时不能猜，后来的入库单不改变历史来源',()=>{
 const s=structuredClone(base);s.purchases.push({...structuredClone(base.purchases[0]),id:'future',supplierId:'s2',supplier:'西南供应商',createdAt:'2026-10-11T00:00:00.000Z'});
 assert.equal(report('q=SO-1',owner,s).rows[0].suppliers[0].id,'s1');
 s.purchases.push({...structuredClone(base.purchases[0]),id:'duplicate'});assert.equal(report('q=SO-1',owner,s).rows[0].suppliers[0].id,'__unknown__');
});
test('销售清单真实 HTTP 接口接入；匿名访问不能读销售，静态页和首页有入口',{skip:process.env.SALES_LIST_MODEL_ONLY==='1'},async()=>{
 const {createServer}=require('../src/application');const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(url+'/api/sales-list')).status,401);
  const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'demo-owner'})});
  assert.equal(login.status,200);const auth=await login.json();
  const r=await fetch(url+'/api/sales-list',{headers:{Authorization:'Bearer '+auth.token}});assert.equal(r.status,200);const data=await r.json();assert.ok(Array.isArray(data.rows));assert.ok(Array.isArray(data.supplierSummary));
  assert.match(await(await fetch(url+'/sales-list')).text(),/sales-filter/);assert.match(await(await fetch(url+'/m')).text(),/href="\/sales-list"/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
