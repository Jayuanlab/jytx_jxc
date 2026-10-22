const assert = require("node:assert/strict");
const c = require("../server/src/common");
const daily = require("../server/src/daily-close");
const date = c.day();
const boss = { id:"o",name:"老板",roleCode:"owner",status:"active",permissions:[] };
const cashier = { id:"a",name:"甲",roleCode:"employee",status:"active",permissions:["sale:create"] };
const checker = { id:"b",name:"乙",roleCode:"employee",status:"active",permissions:["sale:create","finance:view"] };
const store = c.initialize({
  users:[boss,cashier,checker],
  products:[{skuId:"p",name:"测试手机",type:"智能机",trackSerial:true,stockManaged:true}],
  inventory:[{skuId:"p",warehouseId:"wh-sale",warehouseName:"销售仓",quantity:1,serials:[{no:"S1",status:"可售"}]}],
  carrierServices:[{id:"m1",type:"card",subType:"new",serviceDate:date,schedule:[{expected:20,confirmed:null,received:0,events:[]}]}]
});
const shot = daily.preview(store,boss,date);
assert.equal(shot.mobile.find((r)=>r.key==="cardNew").own,1);
assert.equal(shot.mobile.find((r)=>r.key==="airClosing").own,null);
assert.equal(shot.inventory[0].serials[0],"S1");
const row = daily.submit(store,cashier,{date,reviewerId:"b",openingCash:100,actualCash:100,manual:{cardNew:1}});
assert.equal(row.status,"待领取复核");
assert.throws(()=>daily.submit(store,cashier,{date,reviewerId:"b",openingCash:100,actualCash:100,manual:{}}),/已有进行中/);
assert.throws(()=>daily.claim(store,cashier,{id:row.id}),/只有指定/);
daily.claim(store,checker,{id:row.id});
assert.throws(()=>daily.review(store,checker,{id:row.id,decision:"通过",note:"逐栏核对"}),/逐栏勾选/);
const checks=Object.fromEntries(["sales","stock","serials","cash","mobile","suppliers"].map((k)=>[k,true]));
daily.review(store,checker,{id:row.id,decision:"通过",note:"空充期初及未抄录项待老板核定",checks});
assert.equal(store.dailyCloseouts[0].status,"待老板签认");
assert.throws(()=>daily.lock(store,boss,{id:row.id,note:"差异待追"}),/次日/);
const airOpen=daily.airEntry(store,boss,{kind:"opening",businessDate:date,amount:300,reference:"A1"});
assert.equal(airOpen.balance,300);
const airOut=daily.airEntry(store,checker,{kind:"decrease",businessDate:date,amount:50,reference:"A2"});
assert.equal(airOut.balance,250);
assert.equal(daily.metricAuto(store,date).airClosing,250);
assert.throws(()=>daily.airEntry(store,checker,{kind:"decrease",businessDate:date,amount:300,reference:"A3"}),/余额不足/);
const originalDay=c.day;
const tomorrow=new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10);
c.day=(value)=>value===undefined?tomorrow:originalDay(value);
try {
  assert.throws(()=>daily.lock(store,boss,{id:row.id,note:"待核"}),/新业务或流水/);
  daily.review(store,checker,{id:row.id,decision:"驳回",note:"空充流水新增，退回重核"});
  daily.resubmit(store,cashier,{id:row.id,manual:row.manual,openingCash:100,actualCash:100,note:"空充已补录"});
  daily.claim(store,checker,{id:row.id});
  daily.review(store,checker,{id:row.id,decision:"通过",note:"空充已核对；其他缺项列入差异清单",checks});
  store.receipts.push({id:"late",amount:3,account:"现金",createdAt:date+"T08:00:00.000Z"});
  assert.throws(()=>daily.lock(store,boss,{id:row.id,note:"待核"}),/新业务或流水/);
  store.receipts.pop();
  daily.lock(store,boss,{id:row.id,note:"未抄录项列入差异清单"});
  assert.equal(store.dailyCloseouts[0].status,"已锁定");
  assert.throws(()=>daily.unlock(store,cashier,{id:row.id,note:"改账"}),/老板/);
  daily.unlock(store,boss,{id:row.id,note:"模拟补正"});
  assert.equal(store.dailyCloseouts[0].status,"已解锁");
} finally { c.day=originalDay; }
console.log("daily close rules passed");
