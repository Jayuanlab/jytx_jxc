'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./common');
const {create} = require('./assistant-data-snapshot');

test('Pi sales snapshot keeps existing per-user report scope and hides profit', async () => {
  const date = c.day(), at = new Date().toISOString();
  const staff = {id:'u1',roleCode:'employee',permissions:[],status:'active'};
  const other = {id:'u2',roleCode:'employee',permissions:[],status:'active'};
  const store = c.initialize({users:[staff,other],sales:[
    {id:'s1',createdAt:at,salespersonId:'u1',amount:100,profit:30,items:[]},
    {id:'s2',createdAt:at,salespersonId:'u2',amount:900,profit:400,items:[]}
  ],saleReturns:[{id:'r1',createdAt:at,salespersonId:'u1',amount:20,profit:4,items:[]}]});
  const snapshot = await create(store,staff);
  const today = snapshot.tools.sales_summary.days.find(row=>row.date===date);
  assert.equal(today.salesAmount,100);
  assert.equal(today.returnAmount,20);
  assert.equal(today.netSales,80);
  assert.equal(today.orderCount,1);
  assert.equal('adjustedGrossProfit' in today,false);
  assert.equal(snapshot.tools.runtime_health,undefined);
  assert.equal(snapshot.tools.operations_summary,undefined);
});

test('Pi snapshot includes a payment day even without a new sale', async () => {
  const manager={id:'manager',roleCode:'manager',permissions:[],status:'active'};
  const yesterday=new Date(Date.now()-86400000).toISOString();
  const date=c.day(yesterday);
  const store=c.initialize({users:[manager],receipts:[{id:'payment',kind:'sale',transactionDate:date,amount:50}]});
  const snapshot=await create(store,manager);
  assert.equal(snapshot.tools.sales_summary.days.find(row=>row.date===date)?.receivedAmount,50);
});

test('Pi sales items snapshot aggregates visible products without leaking other staff or cost fields', async () => {
  const date=c.day(),at=new Date().toISOString();
  const staff={id:'u1',roleCode:'employee',permissions:[],status:'active'};
  const other={id:'u2',roleCode:'employee',permissions:[],status:'active'};
  const item=(skuId,name,quantity)=>({skuId,name,quantity,type:'智能机',costPrice:999,serialNo:'private-serial'});
  const store=c.initialize({users:[staff,other],sales:[
    {id:'s1',createdAt:at,salespersonId:'u1',amount:100,items:[item('p1','苹果手机',1)]},
    {id:'s2',createdAt:at,salespersonId:'u1',amount:100,items:[item('p1','苹果手机',2)]},
    {id:'s3',createdAt:at,salespersonId:'u2',amount:100,items:[item('p2','其他人商品',1)]}
  ],saleReturns:[{id:'r1',createdAt:at,salespersonId:'u1',amount:50,items:[item('p1','苹果手机',1)]}]});
  const snapshot=await create(store,staff);
  const day=snapshot.tools.sales_items.days.find(row=>row.date===date);
  assert.deepEqual(day.items,[{name:'苹果手机',category:'智能机',sold:3,returned:1}]);
  assert.equal(day.omitted,0);
  assert.equal(JSON.stringify(snapshot).includes('其他人商品'),false);
  assert.equal(JSON.stringify(snapshot).includes('private-serial'),false);
  assert.equal(JSON.stringify(snapshot).includes('costPrice'),false);
});
