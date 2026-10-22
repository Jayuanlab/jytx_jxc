'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),c=require('../src/common'),s=require('../src/stocktake-sheets');
const boss={id:'boss',name:'老板',roleCode:'owner'},worker={id:'staff',name:'营业员',roleCode:'employee',permissions:['stock:adjust']};
const serial='350000000001234',other='350000000005678';
const startedAt=new Date(Date.now()-60000).toISOString();
const fixture=()=>c.initialize({products:[{skuId:'phone',name:'手机',type:'智能手机',warehouseId:'wh-a',trackSerial:true},{skuId:'cable',name:'数据线',type:'配件',warehouseId:'wh-b'},{skuId:'case',name:'保护壳',type:'配件',warehouseId:'wh-b'},{skuId:'service',name:'维修费',stockManaged:false}],inventory:[{skuId:'phone',warehouseId:'wh-a',quantity:1,stockValue:1500,serials:[{no:serial,status:'可售'},{no:other,status:'已售'}]},{skuId:'cable',warehouseId:'wh-b',quantity:8,stockValue:40,costSources:[{sourceId:'p1',quantity:8}],serials:[]},{skuId:'case',warehouseId:'wh-b',quantity:3,serials:[]}],movements:[]});
const count=(skuId,warehouseId,actual)=>({skuId,warehouseId,actual});
test('空表商品资料没有数量、价格或串号清单',()=>{
 const meta=s.catalog(fixture(),worker);assert.equal(meta.products.length,3);assert.ok(!JSON.stringify(meta).includes(serial));
 for(const p of meta.products)for(const field of ['quantity','serials','costPrice','salePrice','stockValue'])assert.equal(p[field],undefined);
});
test('盘后核对在服务端取账面，保存差异但不改变库存或成本来源',()=>{
 const store=fixture(),before=structuredClone(store.inventory);
 const row=s.compare(store,worker,{startedAt,rows:[{skuId:'phone',warehouseId:'wh-a',serials:[other],counted:true},count('cable','wh-b',6)]});
 assert.equal(row.status,'差异待核实');assert.equal(row.rows[0].expected,1);assert.equal(row.rows[0].delta,0);assert.deepEqual(row.rows[0].missingSerials,[serial]);assert.deepEqual(row.rows[0].extraSerials,[other]);assert.equal(row.rows[1].delta,-2);
 assert.deepEqual(row.uncounted.map(x=>x.skuId),['case']);assert.deepEqual(store.inventory,before);assert.equal(store.stocktakes.length,1);
});
test('明确实点零允许；未填、重复串号及短串号阻止整张表提交',()=>{
 for(const input of [count('cable','wh-b',''),count('cable','wh-b',-1),{skuId:'phone',warehouseId:'wh-a',serials:[],counted:false},{skuId:'phone',warehouseId:'wh-a',serials:['1234'],counted:true},{skuId:'phone',warehouseId:'wh-a',serials:[serial,serial],counted:true}]){
  const store=fixture();assert.throws(()=>s.compare(store,worker,{startedAt,rows:[input]}));assert.equal(store.stocktakes.length,0);
 }
 const row=s.compare(fixture(),worker,{startedAt,rows:[count('cable','wh-b',0)]});assert.equal(row.rows[0].actual,0);assert.equal(row.rows[0].delta,-8);
});
test('盘点期间出库必须标出，不能仅按核对时碰巧相同的数量判一致',()=>{
 const store=fixture();store.movements=[{skuId:'cable',warehouseId:'wh-b',type:'销售',quantity:-1,createdAt:c.now(),sourceId:'SO1'}];
 const row=s.compare(store,worker,{startedAt,rows:[count('cable','wh-b',8)]});assert.equal(row.rows[0].changedDuringCount,true);assert.equal(row.status,'差异待核实');
});
test('同仓同商品不重复；非库存服务不参加；无权限不能核对或审批',()=>{
 for(const rows of [[count('cable','wh-b',8),count('cable','wh-b',8)],[count('service','wh-b',1)],[count('cable','other',8)]])assert.throws(()=>s.compare(fixture(),worker,{startedAt,rows}));
 assert.throws(()=>s.catalog(fixture(),{roleCode:'employee'}),e=>e.statusCode===403||e.status===403);
 const store=fixture(),row=s.compare(store,worker,{startedAt,rows:[count('cable','wh-b',6)]}),before=structuredClone(store.inventory);
 assert.throws(()=>s.review(store,worker,{id:row.id,note:'核实'}));s.review(store,boss,{id:row.id,note:'已核实差异，按实物业务处理'});assert.equal(store.stocktakes[0].status,'已核实');assert.deepEqual(store.inventory,before);
});

test('提交完整串号时补齐原库存，数量和金额保持不变',()=>{
 const store=fixture(),stock=store.inventory[0];stock.quantity=2;stock.stockValue=3000;stock.serials=[{no:serial,status:'可售',costPrice:1500}];
 const row=s.compare(store,worker,{startedAt,rows:[{skuId:'phone',warehouseId:'wh-a',serials:[serial,other],counted:true}]});
 assert.equal(row.status,'账实一致');assert.equal(row.rows[0].status,'串号已补录，账实一致');assert.deepEqual(row.rows[0].boundSerials,[other]);
 assert.equal(row.differenceCount,0);assert.equal(stock.quantity,2);assert.equal(stock.stockValue,3000);
 assert.equal(stock.serials.find(x=>x.no===other).costPrice,1500);
 assert.equal(store.operationLogs.some(x=>x.action==='stock:bind-serials'),true);
});
test('实点有差异或盘点期间发生变动时不补录串号',()=>{
 for(const changed of [false,true]){
  const store=fixture(),stock=store.inventory[0];stock.serials=[];
  if(changed)store.movements=[{skuId:'phone',warehouseId:'wh-a',type:'销售',quantity:-1,createdAt:c.now(),sourceId:'SO1'}];
  const serials=changed?[serial]:[serial,other];
  const row=s.compare(store,worker,{startedAt,rows:[{skuId:'phone',warehouseId:'wh-a',serials,counted:true}]});
  assert.equal(row.status,'差异待核实');assert.equal(stock.serials.length,0);
 }
});

test('盘点期间仅补录串号且实点与账面相符时不误报出入库',()=>{
 const store=fixture(),stock=store.inventory[0];stock.serials=[{no:serial,status:'可售',costPrice:1500,boundAt:c.now()}];
 const row=s.compare(store,worker,{startedAt,rows:[{skuId:'phone',warehouseId:'wh-a',serials:[serial],counted:true}]});
 assert.equal(row.differenceCount,0);assert.equal(row.rows[0].changedDuringCount,false);assert.equal(row.rows[0].status,'一致');
});
