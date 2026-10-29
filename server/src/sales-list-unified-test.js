process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const c=require('./common');
const salesList=require('./sales-list');
const owner={id:'test-owner',name:'老板',roleCode:'owner',status:'active'};
const employee={id:'test-staff',name:'店员',roleCode:'employee',status:'active'};
const day='2026-10-19',at=day+'T08:00:00.000Z';
const store=c.initialize({users:[owner,employee],products:[],sales:[
  {id:'SALE-1',createdAt:at,operatorId:employee.id,operator:employee.name,salespersonId:employee.id,salesperson:employee.name,items:[
    {id:'ITEM-1',skuId:'phone',name:'测试手机',type:'智能机',stockManaged:true,warehouseId:'wh-b',warehouseName:'B仓',quantity:1,salePrice:150,amount:150,cost:100},
    {id:'ITEM-2',skuId:'repair',name:'换屏工费',type:'维修',stockManaged:false,quantity:1,salePrice:80,amount:80,cost:0}
  ]}
],carrierServices:[
  {id:'MB-1',serviceDate:day,createdAt:at,employeeId:employee.id,employeeName:employee.name,type:'recharge',typeName:'话费充值',externalOrderNo:'CM-01',transactionAmount:100,schedule:[{expected:20,confirmed:null}]}
],airRechargeEvents:[
  {id:'AIR-1',kind:'customer_recharge',businessDate:day,createdAt:at,operatorId:employee.id,operator:employee.name,reference:'CM-01',debitAmount:100,cashReceived:100},
  {id:'AIR-2',kind:'customer_recharge',businessDate:day,createdAt:at,operatorId:employee.id,operator:employee.name,reference:'AIR-02',debitAmount:50,cashReceived:50}
]});
const query=salesList.filters(new URLSearchParams({from:day+'T00:00',to:day+'T23:59',limit:'30'}));
const report=salesList.report(store,owner,query);
assert.equal(report.rows.length,4);
assert.equal(report.rows.filter(row=>row.recordKind==='repair').length,1);
assert.equal(report.rows.filter(row=>row.recordKind==='mobile').length,2);
assert.equal(report.totals.goodsNetAmount,150);
assert.equal(report.totals.repairNetAmount,80);
assert.equal(report.totals.netAmount,230);
assert.equal(report.totals.mobileRechargeAmount,150);
assert.equal(report.totals.mobileExpectedCommission,20);
assert.equal(report.totals.mobileBusinessCount,2);
assert.equal(report.totals.goodsNetQuantity,1);
assert.equal(report.totals.repairNetQuantity,1);
assert.equal(salesList.report(store,employee,query).rows.length,4);
assert.equal(salesList.report(store,owner,{...query,warehouse:'wh-b'}).rows.length,1);
assert.equal(salesList.report(store,owner,{...query,kind:'repair'}).rows.length,1);
assert.equal(salesList.report(store,owner,{...query,kind:'mobile'}).rows.length,2);
assert.equal(salesList.report(store,owner,{...query,kind:'sale'}).rows.length,1);
assert.equal(salesList.report(store,owner,{...query,q:'话费充值'}).rows.length,1);
assert.equal(salesList.report(store,owner,{...query,q:'cm-01'}).rows.length,1);
const crossDay=structuredClone(store);
crossDay.airRechargeEvents[0].businessDate='2026-10-20';
assert.equal(salesList.report(crossDay,owner,query).totals.mobileRechargeAmount,150);
assert.equal(salesList.report(crossDay,owner,salesList.filters(new URLSearchParams({from:'2026-10-20',to:'2026-10-20'}))).totals.mobileRechargeAmount,100);
const previous=salesList.report(store,owner,salesList.filters(new URLSearchParams({from:'2026-10-18',to:'2026-10-18'})));
assert.equal(previous.rows.length,0);
const single=salesList.report(store,owner,salesList.filters(new URLSearchParams({from:day,to:day,limit:'1',page:'2'})));
assert.equal(single.rows.length,1);
assert.equal(single.totals.lineCount,4);
console.log(JSON.stringify({result:'passed',combinedRows:report.rows.length,saleAndRepairRevenue:report.totals.netAmount,mobileRechargeFaceValue:report.totals.mobileRechargeAmount,mobileExpectedCommission:report.totals.mobileExpectedCommission,liveDatabaseChanged:false}));
