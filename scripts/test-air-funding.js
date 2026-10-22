const assert=require("node:assert/strict");
const c=require("../server/src/common");
const daily=require("../server/src/daily-close");
const owner={id:"o",name:"老板",roleCode:"owner",status:"active",permissions:[]};
const clerk={id:"s",name:"店员",roleCode:"employee",status:"active",permissions:["sale:create"]};
const store=c.initialize({users:[owner,clerk]});
daily.airEntry(store,owner,{kind:"opening",amount:10,reference:"OPEN-10",businessDate:c.day()});
const row=daily.airFunding(store,owner,{paidAmount:2000,creditedAmount:1996,method:"银行卡",bankRef:"BANK-2000",platformRef:"BOSS-1996"});
assert.equal(row.amount,1996);
assert.equal(row.paidAmount,2000);
assert.equal(row.difference,4);
assert.equal(row.balance,2006);
assert.equal(store.receipts.length,1);
assert.equal(store.receipts[0].amount,-2000);
assert.equal(store.receipts[0].accountOwnerId,"o");
assert.equal(store.expenses.length,0,"2000 元平台入金不能直接当作门店费用");
assert.equal(daily.metricAuto(store,c.day()).airClosing,2006);
assert.throws(()=>daily.airFunding(store,owner,{paidAmount:2000,creditedAmount:1996,method:"银行卡",bankRef:"BANK-2000",platformRef:"BOSS-OTHER"}),/已登记/);
assert.throws(()=>daily.airFunding(store,owner,{paidAmount:100,creditedAmount:101,method:"银行卡",bankRef:"OTHER",platformRef:"BOSS-OTHER"}),/不正确/);
const sale=daily.airCashSale(store,clerk,{customerPhone:"13800138000",cashReceived:100,debitAmount:100,platformRef:"TOPUP-100",cashConfirmed:true});
assert.equal(sale.balance,1906);
assert.equal(store.customers.length,1);
assert.equal(store.receptions.length,1);
assert.equal(store.receptions[0].links[0].id,sale.id);
assert.equal(sale.customerMask,"138****8000");
assert.equal(store.receipts.length,2);
assert.equal(store.receipts[1].account,"现金");
assert.equal(store.receipts[1].amount,100);
assert.equal(daily.metricAuto(store,c.day()).rechargeCount,1);
assert.equal(daily.metricAuto(store,c.day()).rechargeAmount,100);
assert.equal(daily.airCashSales(store,clerk).length,1);
assert.throws(()=>daily.airCashSale(store,clerk,{customerPhone:"13800138000",cashReceived:100,debitAmount:99,platformRef:"TOPUP-99",cashConfirmed:true}),/不同/);
assert.throws(()=>daily.airCashSale(store,clerk,{customerPhone:"13800138000",cashReceived:100,debitAmount:100,platformRef:"TOPUP-100",cashConfirmed:true}),/已登记/);
assert.throws(()=>daily.airCashSale(store,clerk,{customerPhone:"13800138000",cashReceived:1,debitAmount:1,platformRef:"TOPUP-NOCASH",cashConfirmed:false}),/实收顾客现金/);
console.log("air funding and cash recharge separation passed");




