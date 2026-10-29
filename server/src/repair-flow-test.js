process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const c=require('./common');
const erp=require('./erp');
const categories=require('./product-categories');

const owner={id:'repair-test-owner',name:'测试老板',roleCode:'owner',status:'active'};
const store=c.initialize({users:[owner],products:[
  {skuId:'screen',name:'测试屏幕',type:'配件',unit:'块',stockManaged:true,warehouseId:'wh-b',costPrice:100,salePrice:150,active:true},
  {skuId:'screen-service',name:'换屏服务',type:'维修',unit:'次',stockManaged:false,salePrice:200,active:true},
  {skuId:'flash-service',name:'刷机服务',type:'维修',unit:'次',stockManaged:false,salePrice:80,active:true},
],inventory:[
  {skuId:'screen',warehouseId:'wh-b',warehouseName:'B仓',quantity:2,costPrice:100,stockValue:200,serials:[]},
  {skuId:'screen',warehouseId:'wh-c',warehouseName:'C仓',quantity:1,costPrice:70,stockValue:70,serials:[]},
]});
const cash=amount=>[{account:'现金',amount,cashDrawerConfirmed:false}];
const screen=erp.sale(store,owner,{payments:cash(200),items:[{
  skuId:'screen-service',quantity:1,salePrice:200,
  materials:[{skuId:'screen',warehouseId:'wh-c',quantity:1}],
}]});
assert.equal(screen.items[0].cost,70);
assert.equal(screen.items[0].profit,130);
assert.equal(store.inventory.find(x=>x.skuId==='screen'&&x.warehouseId==='wh-c').quantity,0);
assert.equal(store.inventory.find(x=>x.skuId==='screen'&&x.warehouseId==='wh-b').quantity,2);
assert.equal(store.receipts.length,0);

const flashing=erp.sale(store,owner,{payments:cash(80),items:[{
  skuId:'flash-service',quantity:1,salePrice:80,noMaterials:true,
}]});
assert.equal(flashing.items[0].cost,0);
assert.equal(flashing.items[0].profit,80);
assert.equal(flashing.items[0].materials.length,0);
assert.equal(store.inventory.find(x=>x.skuId==='screen'&&x.warehouseId==='wh-b').quantity,2);
assert.equal(store.receipts.length,0);
const project=erp.saveProduct(store,owner,{name:'测试维修工费',type:'维修',unit:'次',kind:'service'});
assert.equal(project.stockManaged,false);
assert.equal(project.pricePending,true);
assert.match(project.externalCode,/^JY\d{4,12}$/);
categories.add(store,owner,{parentPath:['配件'],name:'手机屏'});
const screens=[];
for(let i=1;i<=101;i++)screens.push(erp.saveProduct(store,owner,{name:'测试屏幕型号'+i,type:'配件',subType:'手机屏',unit:'块'}));
assert.equal(new Set(screens.map(row=>row.externalCode)).size,101);
assert.equal(screens.at(-1).stockManaged,true);
assert.equal(screens.at(-1).warehouseId,undefined);
console.log(JSON.stringify({result:'passed',screenCost:70,flashCost:0,serviceCode:project.externalCode,screenModelCount:screens.length,receiptsBeforeConfirmation:0,liveDatabaseChanged:false}));
