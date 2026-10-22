"use strict";
process.env.NODE_ENV = "test";
process.env.STORE_DB_PATH = ":memory:";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const c = require("../src/common"), daily = require("../src/daily-close"), erp = require("../src/erp");
const corrections = require("../src/purchase-price-corrections");
const today = c.day();
const yesterday = c.day(Date.parse(today + "T12:00:00+08:00") - 86400000);
const at = (date) => date + "T12:00:00+08:00";
const owner = {id:"owner", name:"老板", status:"active", roleCode:"owner"};
const staff = {id:"staff", name:"营业员甲", status:"active", roleCode:"employee", permissions:["sale:create"]};
const reviewer = {...staff, id:"reviewer", name:"营业员乙"};
function fixture(date = yesterday) {
  return c.initialize({users:structuredClone([owner,staff,reviewer]), products:[{skuId:"phone",name:"测试手机",type:"智能手机",stockManaged:true,trackSerial:true,warehouseId:"wh-sale",salePrice:600}],
    suppliers:[{id:"supplier",name:"测试往来单位"}], supplierModelVersion:2,
    purchases:[{id:"PO",supplierId:"supplier",supplier:"测试往来单位",supplierEntryId:"DUE",amount:500,createdAt:at(date),items:[{id:"PI",skuId:"phone",name:"测试手机",quantity:1,costPrice:500,serials:["IMEI-1"]}]}],
    supplierEntries:[{id:"DUE",supplierId:"supplier",kind:"payable",sourceType:"purchase",sourceId:"PO",cents:50000,createdAt:at(date)}],
    inventory:[{skuId:"phone",warehouseId:"wh-sale",quantity:0,costPrice:0,stockValue:0,serials:[{no:"IMEI-1",status:"已售",costPrice:500,purchaseId:"PO",purchaseItemId:"PI"}]}],
    sales:[{id:"SO",amount:600,profit:100,paymentMethod:"现金",createdAt:at(date),operatorId:staff.id,operator:staff.name,salespersonId:staff.id,salesperson:staff.name,
      items:[{id:"SI",skuId:"phone",name:"测试手机",type:"智能手机",stockManaged:true,quantity:1,salePrice:600,amount:600,cost:500,costPrice:500,profit:100,serialNo:"IMEI-1",returnedQuantity:0}]}],
    receipts:[{id:"RC",sourceId:"SO",kind:"sale",amount:600,account:"现金",createdAt:at(date)}]});
}
function correct(store) {
  const body={supplierId:"supplier",purchaseId:"PO",itemId:"PI",newUnitPrice:400,reference:"CORRECT-1",reason:"核对原始发票录错进价"};
  const preview=corrections.preview(store,owner,body);
  return corrections.confirm(store,owner,{...body,previewToken:preview.previewToken});
}
function legacySources(store,date) {
  const same=(value)=>value&&c.day(value)===date;
  return [
    store.sales.filter(r=>same(r.createdAt)).map(r=>[r.id,r.amount,r.profit,(r.items||[]).map(i=>[i.id,i.quantity,i.amount,i.cost,i.profit,i.serialNo])]),
    store.saleReturns.filter(r=>same(r.createdAt)).map(r=>[r.id,r.amount,r.profit,(r.items||[]).map(i=>[i.itemId,i.quantity,i.amount,i.cost,i.profit])]),
    store.purchases.filter(r=>same(r.createdAt)).map(r=>[r.id,r.amount,r.supplierId,(r.items||[]).map(i=>[i.skuId,i.quantity,i.cost,i.amount])]),
    store.movements.filter(r=>same(r.createdAt)).map(r=>[r.id,r.skuId,r.warehouseId,r.quantity,r.cost]),
    store.receipts.filter(r=>(r.transactionDate||c.day(r.createdAt))===date).map(r=>[r.id,r.amount,r.account,r.kind,r.sourceId]),
    (store.carrierServices||[]).filter(r=>r.serviceDate===date).map(r=>[r.id,r.type,r.subType,r.transactionAmount]),
    (store.airRechargeEvents||[]).filter(r=>r.businessDate===date).map(r=>[r.id,r.kind,r.amount]),
    (store.carrierServices||[]).flatMap(r=>r.schedule||[]).filter(p=>same(p.confirmedAt)).map(p=>[p.month,p.confirmed,p.statementNo]),
    (store.carrierServices||[]).flatMap(r=>r.schedule||[]).flatMap(p=>p.events||[]).filter(e=>same(e.createdAt)).map(e=>[e.id,e.amount,e.bankRef]),
    (store.cashHandovers||[]).filter(r=>same(r.createdAt)).map(r=>[r.id,r.amount,r.status,r.actualAmount,r.bankRef])
  ];
}
const hash=(source)=>createHash("sha256").update(JSON.stringify(source)).digest("hex");
function closingRow(store,date=yesterday) {
  const shot=daily.snapshot(store,date);
  const row={id:"DC",date,status:"待老板签认",cashierId:staff.id,reviewerId:reviewer.id,snapshot:shot,manual:{},actualCash:0,openingCash:0,cashDifference:0,revisions:[],events:[]};
  store.dailyCloseouts.push(row);return row;
}
test("没有新增成本事件的旧日结指纹、核心指纹和签认保持兼容",()=>{
  const store=fixture(),shot=daily.snapshot(store,yesterday),sources=legacySources(store,yesterday);
  assert.equal(shot.fingerprint,hash(sources));assert.equal(shot.coreFingerprint,hash(sources.slice(0,5)));
  const row=closingRow(store);assert.equal(daily.lock(store,owner,{id:row.id,note:"逐项复核确认无误"}).status,"已锁定");
});
test("全部已售更正没有库存流水，仍改变双指纹并与当日成本毛利一致",()=>{
  const store=fixture(),previous=structuredClone(store.sales),oldPurchase=structuredClone(store.purchases),before=daily.snapshot(store,today),oldDay=daily.snapshot(store,yesterday);
  const row=correct(store),shot=daily.snapshot(store,today),report=erp.report(store,owner,today);
  assert.equal(row.inventoryDelta,0);assert.equal(store.movements.length,0);assert.notEqual(shot.fingerprint,before.fingerprint);assert.notEqual(shot.coreFingerprint,before.coreFingerprint);
  assert.equal(shot.originalCost,0);assert.equal(shot.salesCostAdjustmentAmount,-100);assert.equal(shot.cost,-100);
  assert.equal(shot.originalGrossProfit,0);assert.equal(shot.costAdjustmentProfit,100);assert.equal(shot.grossProfit,100);assert.equal(shot.adjustedGrossProfit,report.summary.adjustedGrossProfit);
  assert.equal(shot.transactions.length,1);const tx=shot.transactions[0];assert.equal(tx.kind,"costadjust");assert.equal(tx.quantity,0);assert.equal(tx.amount,0);assert.equal(tx.cost,-100);assert.equal(tx.profit,100);assert.equal(tx.account,"无收付款");
  assert.equal(shot.purchaseAmount,0);assert.equal(shot.purchaseCorrectionAmount,-100);assert.equal(shot.netPurchaseActivityAmount,-100);assert.match(shot.purchaseCorrectionNote,/不表示现金收付/);
  assert.deepEqual(shot.accountTotals,{});assert.equal(shot.cashChange,0);assert.equal(shot.stockMovementCount,0);
  assert.deepEqual(store.sales,previous);assert.deepEqual(store.purchases,oldPurchase);
  const originalDay=daily.snapshot(store,yesterday);assert.equal(originalDay.cost,oldDay.cost);assert.equal(originalDay.grossProfit,oldDay.grossProfit);assert.equal(originalDay.purchaseAmount,500);assert.equal(originalDay.purchaseCorrectionAmount,0);assert.equal(originalDay.fingerprint,oldDay.fingerprint);
});
test("日结销售退货赠品与成本反向调整合计，不把库存差额误计为已售成本",()=>{
  const store=fixture(today);store.sales[0].giftCost=10;store.sales[0].giftOrders=[{id:"GIFT",createdAt:at(today),cost:10,items:[{name:"数据线",quantity:1,cost:10}]}];
  store.saleReturns.push({id:"RETURN",orderId:"SO",createdAt:at(today),amount:100,cost:80,profit:20,items:[]});
  store.costAdjustments.push({id:"CA1",orderId:"SO",itemId:"SI",costDelta:-60,createdAt:at(today)},{id:"CA2",orderId:"SO",itemId:"SI",kind:"sale_return",costDelta:15,createdAt:at(today)},{id:"CA3",kind:"inventory",costDelta:-25,createdAt:at(today)});
  const shot=daily.snapshot(store,today);assert.equal(shot.originalCost,430);assert.equal(shot.cost,385);assert.equal(shot.originalGrossProfit,70);assert.equal(shot.grossProfit,115);assert.equal(shot.costAdjustmentProfit,45);
  assert.equal(shot.grossProfit,erp.report(store,owner,today).summary.adjustedGrossProfit);assert.equal(shot.transactions.filter(x=>x.kind==="costadjust").length,2);assert.equal(shot.salesAmount,600);assert.equal(shot.salesCount,1);assert.equal(shot.returnAmount,100);
});
test("更正账务 entry 与自动核销变更即使无库存流水也改变日结指纹",()=>{
  const store=fixture();const row=correct(store);const first=daily.snapshot(store,today);
  store.supplierEntries.find(e=>e.id===row.entryId).cents+=1;const second=daily.snapshot(store,today);assert.notEqual(second.fingerprint,first.fingerprint);assert.notEqual(second.coreFingerprint,first.coreFingerprint);
  store.supplierSettlements.find(e=>e.id===row.settlementId).cents-=1;const third=daily.snapshot(store,today);assert.notEqual(third.fingerprint,second.fingerprint);assert.notEqual(third.coreFingerprint,second.coreFingerprint);
  store.supplierEntries.find(e=>e.id==="DUE").cents+=1;assert.notEqual(daily.snapshot(store,today).coreFingerprint,third.coreFingerprint);
});
test("仅更正往来账有事件也进入指纹，历史原采购金额不覆写",()=>{
  const store=fixture(today),before=daily.snapshot(store,today);
  store.supplierAdjustments.push({id:"PPC",type:"purchase_price_correction",purchaseId:"PO",priceDelta:50,createdAt:at(today),entryId:"EXTRA"});
  store.supplierEntries.push({id:"EXTRA",supplierId:"supplier",kind:"payable",sourceType:"purchase_price_correction",sourceId:"PPC",cents:5000,createdAt:at(today)});
  const shot=daily.snapshot(store,today);assert.notEqual(shot.fingerprint,before.fingerprint);assert.notEqual(shot.coreFingerprint,before.coreFingerprint);assert.equal(shot.purchaseAmount,500);assert.equal(shot.purchaseCorrectionAmount,50);assert.equal(shot.netPurchaseActivityAmount,550);assert.equal(shot.grossProfit,100);
});
test("成本和毛利分别授权，当前与历史补正快照均隐藏未获授权字段",()=>{
  const store=fixture();correct(store);const shot=daily.snapshot(store,today),row={id:"DC",date:today,cashierId:staff.id,reviewerId:reviewer.id,snapshot:shot,revisions:[{snapshot:structuredClone(shot)}]};store.dailyCloseouts.push(row);
  const denied=daily.preview(store,staff,today);for(const key of ["cost","originalCost","giftCost","salesCostAdjustmentAmount","purchaseCorrectionAmount","netPurchaseActivityAmount","purchaseCorrections","grossProfit","originalGrossProfit","costAdjustmentProfit","adjustedGrossProfit","supplierTotals"])assert.equal(denied[key],undefined,key);
  assert.equal(denied.transactions[0].cost,undefined);assert.equal(denied.transactions[0].profit,undefined);
  const visible=daily.list(store,staff)[0];assert.equal(visible.snapshot.cost,undefined);assert.equal(visible.revisions[0].snapshot.purchaseCorrections,undefined);assert.equal(visible.revisions[0].snapshot.grossProfit,undefined);assert.equal(row.snapshot.grossProfit,100);
  const costOnly={...staff,permissions:["sale:create","cost:view"]};const costs=daily.preview(store,costOnly,today);assert.equal(costs.cost,-100);assert.equal(costs.purchaseCorrectionAmount,-100);assert.equal(costs.grossProfit,undefined);assert.equal(costs.transactions[0].profit,undefined);
  const profitOnly={...staff,permissions:["sale:create","finance:view_profit"]};const profits=daily.preview(store,profitOnly,today);assert.equal(profits.grossProfit,100);assert.equal(profits.cost,undefined);assert.equal(profits.purchaseCorrections,undefined);assert.equal(profits.transactions[0].cost,undefined);
});
test("签认前新增全部已售成本更正须重新生成日结快照后才能锁定",()=>{
  const store=fixture(),row=closingRow(store);const original=row.snapshot.fingerprint;
  store.costAdjustments.push({id:"LATE",kind:"sale",orderId:"SO",itemId:"SI",costDelta:-50,createdAt:at(yesterday)});
  assert.throws(()=>daily.lock(store,owner,{id:row.id,note:"核实后签认"}),/重新生成扎账快照/);assert.equal(row.status,"待老板签认");assert.equal(row.snapshot.fingerprint,original);
  row.snapshot=daily.snapshot(store,yesterday);assert.equal(row.snapshot.grossProfit,150);assert.equal(daily.lock(store,owner,{id:row.id,note:"刷新快照核实后签认"}).status,"已锁定");
});
test("历史补正核心指纹包含已售成本事件，不能复用陈旧的历史快照",()=>{
  const store=fixture(),row=closingRow(store);row.status="已驳回";
  store.costAdjustments.push({id:"LATE",kind:"sale",orderId:"SO",itemId:"SI",costDelta:-50,createdAt:at(yesterday)});
  assert.throws(()=>daily.resubmit(store,staff,{id:row.id,actualCash:0,openingCash:0}),/历史交易、库存或资金流水已变化/);assert.equal(row.status,"已驳回");
});
