'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),list=require('../src/sales-list');
const owner={id:'boss',roleCode:'owner'},staff={id:'staff',roleCode:'employee',permissions:['sale:create','cost:view']};
const calculate=(store,query='',user=owner)=>list.report(store,user,list.filters(new URLSearchParams(query)));
const line=(id,extra={})=>({id,skuId:id,name:id,stockManaged:true,quantity:1,returnedQuantity:0,amount:100,salePrice:100,cost:60,...extra});
const store=items=>({sales:[{id:'SO-1',createdAt:'2026-10-10T10:00:00.000Z',salespersonId:'staff',items}],costAdjustments:[],products:[],purchases:[],suppliers:[],users:[owner,staff]});
test('毛利使用原出库成本，部分退货同步扣减成本且红冲归零',()=>{
 const s=store([line('one'),line('two',{quantity:4,returnedQuantity:1,amount:40,salePrice:10,cost:20})]);
 let r=calculate(s);assert.equal(r.rows[0].netProfit,40);assert.equal(r.rows[1].netProfit,15);assert.equal(r.totals.netProfit,55);
 s.sales[0].redReversedBy='RED';r=calculate(s);assert.equal(r.totals.netProfit,0);assert.ok(r.rows.every(x=>x.netProfit===0));
});
test('实际成本调整与赠品按原售价分摊，合计保留到分',()=>{
 const s=store([line('one'),line('two')]);s.sales[0].giftCost=.01;
 s.costAdjustments=[{orderId:'SO-1',itemId:'one',costDelta:10}];
 const r=calculate(s);assert.equal(r.rows[0].netProfit,29.99);assert.equal(r.rows[1].netProfit,40);assert.equal(r.totals.netProfit,69.99);
 assert.equal(r.rows.reduce((n,x)=>Math.round((n+x.netProfit)*100)/100,0),69.99);
});
test('维修退款不冲回已经消耗的材料成本，亏损保留负数',()=>{
 const s=store([line('repair',{stockManaged:false,returnedQuantity:1,cost:30})]);
 assert.equal(calculate(s).rows[0].netProfit,-30);
});
test('来源比例分摊后的毛利保留到分，供货商筛选合计守恒',()=>{
 const s=store([line('mixed',{quantity:3,amount:10,salePrice:10/3,cost:5,supplySources:[{supplierId:'a',supplier:'甲',quantity:1},{supplierId:'b',supplier:'乙',quantity:2}]})]);
 assert.equal(calculate(s,'supplier=a').totals.netProfit,1.67);
 assert.equal(calculate(s,'supplier=b').totals.netProfit,3.33);
 assert.equal(calculate(s).totals.netProfit,5);
});
test('缺少历史实际成本时不猜毛利；员工有进价权限仍不越过毛利权限',()=>{
 const s=store([line('missing')]);delete s.sales[0].items[0].cost;
 const ownerResult=calculate(s);assert.equal(ownerResult.rows[0].netProfit,null);assert.equal(ownerResult.totals.netProfit,null);assert.equal(ownerResult.totals.unknownProfitLines,1);
 const staffResult=calculate(s,'',staff);assert.equal(staffResult.canProfit,false);assert.equal('netProfit' in staffResult.rows[0],false);assert.equal('netProfit' in staffResult.totals,false);
 assert.ok(staffResult.rows[0].suppliers.every(x=>!('netProfit' in x)));
});
