'use strict';
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../src/common'),erp=require('../src/erp'),exchange=require('../src/sale-exchanges'),cash=require('../src/sale-payments'),docs=require('../src/financial-documents'),red=require('../src/red-reversals');
const boss={id:'boss',name:'测试老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active',permissions:['sale:create','sale:return']};
function seed(price=200){
 const s=c.initialize({users:[structuredClone(boss),structuredClone(staff)],products:[{skuId:'old',name:'原手机',type:'智能手机',warehouseId:'wh-a',trackSerial:true,stockManaged:true,salePrice:200},{skuId:'next',name:'新手机',type:'智能手机',warehouseId:'wh-a',trackSerial:true,stockManaged:true,salePrice:300}],inventory:[{skuId:'old',warehouseId:'wh-a',quantity:0,stockValue:0,serials:[]},{skuId:'next',warehouseId:'wh-a',quantity:0,stockValue:0,serials:[]}],suppliers:[{id:'sup',name:'供应商'}]});
 erp.purchase(s,boss,{supplierId:'sup',items:[{skuId:'old',quantity:1,costPrice:100,serials:['869000000001111']},{skuId:'next',quantity:1,costPrice:150,serials:['869000000002222']}]});
 const sale=erp.sale(s,staff,{items:[{skuId:'old',quantity:1,serialNo:'869000000001111',salePrice:price}],account:'现金',cashDrawerConfirmed:true});cash.confirm(s,boss,{orderId:sale.id,actualAmount:price});return {s,sale:s.sales.find(x=>x.id===sale.id)};
}
function body(sale,price=300,more={}){return {orderId:sale.id,returns:[{itemId:sale.items[0].id,quantity:1}],items:[{skuId:'next',serialNo:'869000000002222',quantity:1,salePrice:price}],account:'现金',reason:'顾客选择更换另一款手机',cashDrawerConfirmed:true,...more};}
function approvedExchange(s,user,payload){const queue=require('../src/sale-return-requests'),row=queue.requestExchange(s,user,payload);return queue.review(s,boss,{id:row.id,decision:'approve',note:'老板核对实物与差额同意换货',refundConfirmed:payload.refundConfirmed===true});}
test('换货补差：库存串号、原单新单、抵款和实际资金关联',()=>{
 const {s,sale}=seed();const row=approvedExchange(s,staff,body(sale));assert.equal(row.difference,100);assert.equal(s.saleExchanges.length,1);
 assert.equal(s.inventory[0].serials[0].status,'可售');assert.equal(s.inventory[1].serials[0].status,'已售');
 const next=s.sales.find(x=>x.id===row.newOrderId);assert.equal(next.paymentCredit,200);assert.equal(next.paymentReview.amount,100);assert.equal(next.receivedAmount,300);
 assert.equal(s.receipts.filter(x=>x.sourceId===row.returnId).length,0);assert.equal(s.receipts.find(x=>x.sourceId===next.id).amount,100);assert.equal(next.exchangeOriginalId,sale.id);
 assert.equal(s.receipts.filter(x=>['sale','refund'].includes(x.kind)).reduce((n,x)=>n+x.amount,0),300);
 assert.equal(erp.report(s,boss).summary.netSales,300);
});
test('换货等价无需收款，降价只登记实际退差额',()=>{
 for(const price of [200,100]){const {s,sale}=seed();const row=approvedExchange(s,staff,body(sale,price,{refundConfirmed:true}));const next=s.sales.find(x=>x.id===row.newOrderId);
 assert.equal(next.receivedAmount,price);assert.equal(next.paymentReview.status,'无需收款');assert.equal(s.receipts.filter(x=>x.sourceId===next.id).length,0);
 assert.equal(s.receipts.find(x=>x.sourceId===row.returnId)?.amount||0,price-200);
 }
});
test('电子支付只核对换货差额到账，抵款不会被重复计入资金',()=>{
 const {s,sale}=seed(),row=approvedExchange(s,staff,body(sale,300,{account:'微信',accountOwnerId:'boss'})),next=s.sales.find(x=>x.id===row.newOrderId);
 assert.equal(next.receivedAmount,200);assert.equal(next.paymentReview.amount,100);cash.confirm(s,boss,{orderId:next.id,actualAmount:100,reference:'CHANGE-1'});
 assert.equal(next.receivedAmount,300);assert.equal(s.receipts.find(x=>x.sourceId===next.id).amount,100);
});
test('换货拒绝未确认退款、未核实原收款、重复退回和他人单据',()=>{
 const {s,sale}=seed();for(const data of [body(sale,100),{...body(sale),returns:[...body(sale).returns,...body(sale).returns]}])assert.throws(()=>exchange.exchange(s,boss,data),e=>[400,409].includes(e.statusCode));
 const other={...staff,id:'other'};assert.throws(()=>exchange.exchange(s,other,body(sale)),e=>e.statusCode===403);
 sale.paymentReview.status='待老板核对';assert.throws(()=>exchange.exchange(s,boss,body(sale)),e=>e.statusCode===409);assert.equal(s.saleReturns.length,0);assert.equal(s.saleExchanges.length,0);
});
test('收付款单独立登记、关联原业务、查询日期及重复凭证校验',()=>{
 const {s}=seed();const one=docs.create(s,boss,{direction:'receive',counterparty:'活动主办方',amount:50,account:'微信',date:c.day(),note:'活动补助',reference:'IN-1',confirmed:true});
 const two=docs.create(s,boss,{direction:'pay',counterparty:'电力公司',amount:20,account:'现金',note:'门店电费',confirmed:true});
 assert.equal(s.otherIncome[0].amount,50);assert.equal(s.expenses[0].amount,20);
 const receive=docs.list(s,boss,new URLSearchParams({direction:'receive',q:'活动主办方',from:c.day(),to:c.day()}));assert.equal(receive.rows.length,1);assert.equal(receive.rows[0].id,one.id);assert.equal(receive.total,50);
 assert.equal(docs.list(s,boss,new URLSearchParams({direction:'pay',q:two.id})).total,20);
 assert.throws(()=>docs.create(s,boss,{direction:'receive',counterparty:'甲',amount:1,account:'微信',note:'重复',reference:'IN-1',confirmed:true}),e=>e.statusCode===409);
 assert.throws(()=>docs.create(s,staff,{}),e=>e.statusCode===403);assert.throws(()=>docs.list(s,boss,new URLSearchParams({from:'2026-11-01',to:'2026-10-01'})),e=>e.statusCode===400);
});
test('红冲销售恢复库存和提成，未到账单不产生虚假退款且停止催收',()=>{
 for(const confirmed of [true,false]){const {s,sale}=seed();if(!confirmed){s.receipts=s.receipts.filter(x=>x.sourceId!==sale.id);sale.receivedAmount=0;sale.paymentReview.status='待老板核对';}
 const req=red.request(s,boss,{kind:'sale',sourceId:sale.id,reason:'测试开单误录，实际没有销售'});
 red.review(s,boss,{id:req.id,decision:'approve',note:'核实没有发生交易'});
 assert.ok(sale.redReversedBy);assert.equal(s.inventory[0].serials[0].status,'可售');assert.equal(sale.paymentReview.status,'已红冲');assert.equal(s.receipts.filter(x=>['sale','refund'].includes(x.kind)).reduce((n,x)=>n+x.amount,0),0);
 assert.throws(()=>red.review(s,boss,{id:req.id,decision:'approve',note:'重复审核'}),e=>e.statusCode===409);
 }
});
test('其他收入及费用付款红冲保留原单，显示已红冲，不混为实际收退款',()=>{
 const {s}=seed();for(const direction of ['receive','pay']){const result=docs.create(s,boss,{direction,counterparty:'测试对象',amount:40,account:'现金',note:'测试误记',confirmed:true});const kind=direction==='receive'?'other_income':'expense',req=red.request(s,boss,{kind,sourceId:result.sourceId,reason:'测试录错单据，实际没有收付'});
 red.review(s,boss,{id:req.id,decision:'approve',note:'核实原单属于误记'});const data=docs.list(s,boss,new URLSearchParams({direction,q:result.id}));assert.equal(data.rows.length,1);assert.equal(data.rows[0].status,'已红冲');assert.equal(data.total,0);
 }assert.equal(erp.report(s,boss).summary.otherIncome,0);assert.equal(erp.report(s,boss).summary.expenseAmount,0);
});
test('红冲维持财务申请和老板审核权限，锁定日、已退换货拒绝',()=>{
 const {s,sale}=seed();assert.throws(()=>red.request(s,staff,{kind:'sale',sourceId:sale.id,reason:'测试误录没有实际成交'}),e=>e.statusCode===403);
 const req=red.request(s,boss,{kind:'sale',sourceId:sale.id,reason:'测试误录没有实际成交'});
 assert.throws(()=>red.review(s,staff,{id:req.id,decision:'approve',note:'员工无权审核'}),e=>e.statusCode===403);
 s.dailyCloseouts=[{date:c.day(),status:'已锁定'}];assert.throws(()=>red.review(s,boss,{id:req.id,decision:'approve',note:'核实误录单据'}),e=>e.statusCode===409);assert.equal(s.inventory[0].serials[0].status,'已售');
});

test('换货抵款的新单不能直接红冲，正常退货按整单退价，资金库存和毛利均归零',()=>{
 for(const price of [300,200,100]){
  const {s,sale}=seed();const x=approvedExchange(s,staff,body(sale,price,{refundConfirmed:true}));
  const next=s.sales.find(row=>row.id===x.newOrderId);if(next.paymentReview.amount)cash.confirm(s,boss,{orderId:next.id,actualAmount:next.paymentReview.amount});
  const before=JSON.stringify(s);assert.throws(()=>red.request(s,boss,{kind:'sale',sourceId:next.id,reason:'检查换货新单不能绕过抵款处理'}),e=>e.statusCode===409&&/抵款/.test(e.message));assert.equal(JSON.stringify(s),before);
  erp.returnSale(s,boss,{orderId:next.id,items:next.items.map(i=>({itemId:i.id,quantity:i.quantity})),reason:'顾客实际退回换出的手机',account:'现金'});
  assert.equal(s.receipts.filter(r=>['sale','refund'].includes(r.kind)).reduce((n,r)=>n+r.amount,0),0);
  assert.equal(s.inventory.reduce((n,r)=>n+r.quantity,0),2);
  const report=erp.report(s,boss).summary;assert.equal(report.netSales,0);assert.equal(report.grossProfit,0);
 }
});
test('其他员工不能通过原单号直接退货，拒绝前不改库存、收款和单据',()=>{
 const {s,sale}=seed(),other={...staff,id:'another-staff'};s.users.push(other);const before=JSON.stringify(s);
 assert.throws(()=>erp.returnSale(s,other,{orderId:sale.id,items:[{itemId:sale.items[0].id,quantity:1}],reason:'无权办理别人的退货'}),e=>e.statusCode===403);
 assert.equal(JSON.stringify(s),before);
});


test('未核实到账和有异议的销售单拒绝退货，库存资金及单据保持原状',()=>{
 for(const account of ['现金','微信']){
  const {s}=seed();const original=s.sales[0];
  erp.returnSale(s,boss,{orderId:original.id,items:[{itemId:original.items[0].id,quantity:1}],reason:'先退回模拟原单',account:'现金'});
  const result=erp.sale(s,boss,{items:[{skuId:'old',quantity:1,serialNo:'869000000001111',salePrice:200}],account,accountOwnerId:'boss',cashDrawerConfirmed:false});
  const sale=s.sales.find(x=>x.id===result.id);
  for(const status of [sale.paymentReview.status,'有异议']){
   sale.paymentReview.status=status;const before=JSON.stringify(s);
   assert.throws(()=>erp.returnSale(s,boss,{orderId:sale.id,items:[{itemId:sale.items[0].id,quantity:1}],reason:'模拟没有确认到账就退货',account}),e=>e.statusCode===409&&/核实原单收款/.test(e.message));
   assert.equal(JSON.stringify(s),before);
  }
  sale.paymentReview.status=account==='现金'?'待老板核对':'待收款人确认';cash.confirm(s,boss,{orderId:sale.id,actualAmount:200,...(account==='微信'?{reference:'QA-RETURN-WX'}:{})});
  const returned=erp.returnSale(s,boss,{orderId:sale.id,items:[{itemId:sale.items[0].id,quantity:1}],reason:'核实到账后真实退货',account});assert.equal(returned.amount,200);
 }
});
