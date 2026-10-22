const c=require('../server/src/common');
const erp=require('../server/src/erp');
const warehouses=require('../server/src/warehouses');
const {readStore,transaction}=require('../server/src/repository');
function setup(store){
  const owner=store.users.find(u=>u.roleCode==='owner'&&u.status==='active');
  if(!owner)throw Error('三仓建账需要在职老板账号');
  const migrated=warehouses.migrate(store,owner);
  const fixtures=[
    {code:'TEST-WH-B-POWER-20261009',name:'【测试】移动电源10000mAh',warehouseId:'wh-b',quantity:3,cost:30,salePrice:69},
    {code:'TEST-WH-C-POWER-20261009',name:'【测试】移动电源10000mAh',warehouseId:'wh-c',quantity:2,cost:26,salePrice:59},
    {code:'TEST-WH-C-ACTIVITY-20261009',name:'【测试】移动活动礼品袋',warehouseId:'wh-c',quantity:5,cost:6,salePrice:0}
  ];
  let seeded=0;
  if(!store.warehouseTestSeedVersion){
    for(const f of fixtures){
      if(store.products.some(p=>p.externalCode===f.code))throw Error('测试商品编号已占用：'+f.code);
      const p=erp.saveProduct(store,owner,{externalCode:f.code,name:f.name,type:'配件',subType:f.warehouseId==='wh-c'?'移动业务物品':'移动电源',unit:'件',kind:'physical',trackSerial:false,warehouseId:f.warehouseId,salePrice:f.salePrice});
      const row=store.inventory.find(x=>x.skuId===p.skuId&&x.warehouseId===f.warehouseId);
      row.quantity=f.quantity;row.costPrice=f.cost;row.stockValue=c.round(f.quantity*f.cost);row.costSources=[{sourceId:'TEST-WH-SEED-20261009',quantity:f.quantity}];
      store.movements.unshift({id:c.id('MV'),skuId:p.skuId,product:p.name,warehouseId:row.warehouseId,warehouseName:row.warehouseName,quantity:f.quantity,cost:row.stockValue,type:'三仓模拟期初',sourceId:'TEST-WH-SEED-20261009',operatorId:owner.id,operator:owner.name,createdAt:c.now()});
      seeded++;
    }
    store.warehouseTestSeedVersion=1;
    c.audit(store,owner,'warehouse:test-seed','三仓测试商品 '+seeded+' 种，均标注【测试】');
  }
  return {migrated,seeded,warehouses:warehouses.WAREHOUSES.map(w=>({name:w.name,products:store.products.filter(p=>p.warehouseId===w.id).length,units:store.inventory.filter(x=>x.warehouseId===w.id).reduce((sum,x)=>sum+Number(x.quantity||0),0)}))};
}
const result=process.argv.includes('--apply')?transaction(setup):setup(structuredClone(readStore()));
console.log(JSON.stringify({mode:process.argv.includes('--apply')?'applied':'dry-run',...result},null,2));
