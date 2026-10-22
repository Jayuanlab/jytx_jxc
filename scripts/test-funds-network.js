const assert = require("node:assert/strict");
const c = require("../server/src/common");
const funds = require("../server/src/funds-network");
const owner={id:"o",name:"老板",roleCode:"owner",status:"active",permissions:[],feishuOpenId:"ou-owner"};
const wife={id:"w",name:"采购经手人",roleCode:"employee",status:"active",permissions:["finance:view"],feishuOpenId:"ou-wife"};
const clerk={id:"s",name:"营业员",roleCode:"employee",status:"active",permissions:["sale:create"]};
const store=c.initialize({users:[owner,wife,clerk],suppliers:[{id:"sp",name:"测试供应商"}],
 receipts:[
  {id:"r1",kind:"sale",sourceId:"SO-1",amount:100,account:"微信",createdAt:c.now()},
  {id:"r2",kind:"supplier_payment",supplierId:"sp",sourceId:"SC-1",amount:-60,account:"银行卡",createdAt:c.now()},
  {id:"r3",kind:"carrier_rental",sourceId:"M-1",amount:20,account:"银行卡",accountOwnerId:"o",createdAt:c.now()}
 ]});
assert.throws(()=>funds.network(store,clerk),/权限/);
const first=funds.network(store,owner);
assert.equal(first.counts.unknownAccounts,2);
assert.equal(first.rows.find(x=>x.id==="r2").to,"测试供应商");
assert.equal(first.rows.find(x=>x.id==="r3").from,"中国移动");
const row=funds.createTransfer(store,owner,{toId:"w",amount:2500,method:"银行卡",reference:"BANK-2500",purpose:"进货周转"});
assert.equal(row.status,"待收款人确认");
assert.equal(store.receipts.length,3,"内部转款不得重复计营业收入或费用");
assert.throws(()=>funds.confirmTransfer(store,owner,{id:row.id,actualAmount:2500}),/指定收款人/);
assert.throws(()=>funds.confirmTransfer(store,wife,{id:row.id,actualAmount:2400}),/金额不同/);
funds.rejectTransfer(store,wife,{id:row.id,actualAmount:2400,note:"实际只到账 2400"});
assert.equal(row.status,"到账有异议");
assert.throws(()=>funds.confirmTransfer(store,wife,{id:row.id,actualAmount:2500}),/已经处理/);
const second=funds.createTransfer(store,owner,{toId:"w",amount:100,method:"微信",reference:"WX-100"});
funds.confirmTransfer(store,wife,{id:second.id,actualAmount:100});
assert.equal(second.status,"已确认到账");
assert.equal(store.receipts.length,3);
assert.equal(funds.network(store,owner).counts.transfersPending,0);
assert.throws(()=>funds.createTransfer(store,owner,{toId:"w",amount:100,method:"微信",reference:"WX-100"}),/已经登记/);
console.log("funds relationship and confirmation passed");

