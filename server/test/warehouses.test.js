const {test}=require('node:test');const assert=require('node:assert/strict');
const Module=require('module');const original=Module._load;Module._load=function(name,...args){if(name==='xlsx')return {};return original.call(this,name,...args)};
const c=require('../src/common');const warehouses=require('../src/warehouses');const erp=require('../src/erp');const copilot=require('../src/copilot');
const owner={id:'owner',name:'测试老板',role:'老板',roleCode:'owner',status:'active'};
function fixture(){return c.initialize({users:[owner],products:[
  {skuId:'a',externalCode:'A1',name:'【测试】华为手机',type:'智能机',stockManaged:true,trackSerial:true,active:true,salePrice:1000},
  {skuId:'b',externalCode:'B1',name:'【测试】便携电源',type:'配件',warehouseId:'wh-b',stockManaged:true,trackSerial:false,active:true,salePrice:69},
  {skuId:'c',externalCode:'C1',name:'【测试】便携电源',type:'配件',warehouseId:'wh-c',stockManaged:true,trackSerial:false,active:true,salePrice:59},
  {skuId:'camera',externalCode:'C2',name:'【测试】移动摄像头',type:'配件',subType:'摄像头',stockManaged:true,trackSerial:false,active:true,salePrice:199}
],inventory:[
  {skuId:'a',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:1,costPrice:700,stockValue:700,serials:[{no:'123456789012345',status:'可售',costPrice:700}]},
  {skuId:'b',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:3,costPrice:30,stockValue:90,serials:[],costSources:[{sourceId:'test',quantity:3}]},
  {skuId:'c',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:2,costPrice:26,stockValue:52,serials:[],costSources:[{sourceId:'test',quantity:2}]},
  {skuId:'camera',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:1,costPrice:100,stockValue:100,serials:[],costSources:[{sourceId:'test',quantity:1}]}
]})}
test('三仓迁移保持数量成本串码并留成对流水',()=>{const s=fixture();const total=s.inventory.reduce((n,r)=>n+r.quantity,0),value=s.inventory.reduce((n,r)=>n+r.stockValue,0);const r=warehouses.migrate(s,owner);assert.equal(r.stockRows,4);assert.deepEqual(s.inventory.map(x=>x.warehouseId),['wh-a','wh-b','wh-c','wh-c']);assert.equal(s.inventory.reduce((n,r)=>n+r.quantity,0),total);assert.equal(s.inventory.reduce((n,r)=>n+r.stockValue,0),value);assert.equal(s.inventory[0].serials[0].no,'123456789012345');assert.equal(s.movements.length,8);assert.equal(s.products.find(p=>p.skuId==='c').name,'【测试】便携电源（YD）');assert.equal(warehouses.migrate(s,owner).changed,false)});
test('B C 同名分别扣本仓，销售单留仓位，副驾按所属仓核验',()=>{const s=fixture();warehouses.migrate(s,owner);const review=copilot.reviewSale(s,owner,{items:[{skuId:'c',quantity:1,salePrice:59}],account:'现金'});assert.equal(review.ready,true);const order=erp.sale(s,owner,{account:'现金',cashDrawerConfirmed:false,items:[{skuId:'c',quantity:1,salePrice:59}]});assert.equal(order.items[0].warehouseId,'wh-c');assert.equal(s.inventory.find(x=>x.skuId==='c').quantity,1);assert.equal(s.inventory.find(x=>x.skuId==='b').quantity,3);assert.ok(s.movements.some(x=>x.sourceId===order.id&&x.warehouseId==='wh-c'&&x.quantity===-1))});
test('有库存商品不能直接换仓；新商品可选仓并自动加YD',()=>{const s=fixture();warehouses.migrate(s,owner);assert.throws(()=>erp.saveProduct(s,owner,{skuId:'b',externalCode:'B1',name:'【测试】便携电源',type:'配件',kind:'physical',trackSerial:false,warehouseId:'wh-c',salePrice:69}));const added=erp.saveProduct(s,owner,{externalCode:'C3',name:'【测试】便携电源',type:'配件',kind:'physical',trackSerial:false,warehouseId:'wh-c',salePrice:69});assert.equal(added.name,'【测试】便携电源（YD）');assert.equal(s.inventory.find(x=>x.skuId===added.skuId).warehouseId,'wh-c')});
