// Isolated product naming and warehouse classification regression; no production writes.
'use strict';
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';
const Module=require('node:module'),originalLoad=Module._load;
Module._load=function(name,...args){return name==='xlsx'?{}:originalLoad.call(this,name,...args)};
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../server/src/common'),warehouses=require('../server/src/warehouses'),erp=require('../server/src/erp');
const owner={id:'owner',name:'测试老板',roleCode:'owner',status:'active'};
function fixture(){return c.initialize({users:[owner]})}
const fields={name:'华为测试手机',type:'智能手机',subType:'华为',thirdType:'测试型号',unit:'台',kind:'physical',salePrice:2399};
test('C warehouse name is marked YD once and preserves brand/model classification',()=>{
  const store=fixture();
  const a=erp.saveProduct(store,owner,{...fields,externalCode:'A-1',warehouseId:'wh-a'});
  const mobile=erp.saveProduct(store,owner,{...fields,externalCode:'C-1',warehouseId:'wh-c'});
  assert.equal(a.name,'华为测试手机');assert.equal(mobile.name,'华为测试手机（YD）');
  assert.equal(store.products.find(p=>p.skuId===mobile.skuId).name,mobile.name);
  assert.deepEqual([mobile.type,mobile.subType,mobile.thirdType],[a.type,a.subType,a.thirdType]);
  assert.equal(mobile.trackSerial,true);assert.equal(store.inventory.find(x=>x.skuId===mobile.skuId).warehouseId,'wh-c');
  assert.equal(store.movements.length,0);assert.ok(mobile.aliases.includes('华为测试手机'));
  const again=erp.saveProduct(store,owner,{...mobile,kind:'physical',name:'华为测试手机（YD）'});
  assert.equal(again.name,'华为测试手机（YD）');assert.equal(store.products.length,2);
  assert.equal(store.operationLogs[0].operatorId,owner.id);
});
test('unique mobile equipment is marked and does not rename other warehouses',()=>{
  const store=fixture();const b=erp.saveProduct(store,owner,{...fields,name:'路由器',type:'配件',subType:'路由器',thirdType:'型号一',externalCode:'B-1',warehouseId:'wh-b'});
  const mobile=erp.saveProduct(store,owner,{...fields,name:'活动设备',type:'其他数码',externalCode:'C-2',warehouseId:'wh-c'});
  assert.equal(mobile.name,'活动设备（YD）');assert.equal(b.name,'路由器');
  assert.equal(warehouses.productName('活动设备（YD） (yd)','wh-c'),'活动设备（YD）');
  assert.equal(warehouses.productName('普通设备','wh-a'),'普通设备');
});
test('YD distinguishes warehouse without forcing a category or inventory on services',()=>{
  const store=fixture();const service=erp.saveProduct(store,owner,{...fields,name:'业务服务',type:'其他收入',kind:'service',externalCode:'S-1',warehouseId:'wh-c'});
  assert.equal(service.warehouseId,'');assert.equal(service.name,'业务服务');assert.equal(store.inventory.length,0);
  assert.equal(warehouses.suggest({...fields,name:'华为测试手机（YD）',stockManaged:true}),'wh-c');
});
test('explicit normalization is idempotent and retains original aliases',()=>{
  const store=fixture();store.products.push({skuId:'legacy',name:'测试机',warehouseId:'wh-c',type:'智能手机',subType:'华为',thirdType:'型号'});
  assert.deepEqual(warehouses.distinguishNames(store),['legacy']);assert.deepEqual(warehouses.distinguishNames(store),[]);
  assert.deepEqual(store.products[0].aliases,['测试机']);assert.equal(store.products[0].type,'智能手机');
});
test('inventory C shares A category list and no longer remaps only C accessories',()=>{
  const source=require('node:fs').readFileSync(require('node:path').resolve('web/office-inventory.js'),'utf8');
  assert.ok(source.includes("'wh-a':deviceCategories"));assert.ok(source.includes("'wh-c':deviceCategories"));
  assert.ok(!source.includes("if(p.warehouseId==='wh-c'&&raw==='配件'"));
});

test('assistant directs owner and employee to the appropriate wage entry',()=>{
  const nav=require('../server/src/assistant-navigation'),catalog=require('../server/src/assistant-capabilities');
  const store=fixture(),staff={id:'staff',roleCode:'employee',status:'active',permissions:['sale:create']};
  assert.equal(nav.findEntry(store,owner,'工资管理在哪里').action.href,'/app?tab=payroll&view=manage');
  assert.equal(nav.findEntry(store,staff,'打开工资明细查询').action.href,'/app?tab=payroll&view=details');
  assert.equal(nav.findEntry(store,staff,'打开工资管理').metrics.allowed,false);
  assert.equal(catalog.catalog(store,{roleCode:'customer-assistant',assistantCustomerOnly:true}).items.some(x=>x.id.startsWith('payroll-')),false);
});
