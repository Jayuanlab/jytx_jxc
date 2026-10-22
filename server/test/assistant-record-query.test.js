'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const Module=require('node:module'),old=Module._load;Module._load=function(n,...args){return n==='xlsx'?{}:old.call(this,n,...args);};
const c=require('../src/common'),assistant=require('../src/personal-assistant'),records=require('../src/assistant-record-query'),model=require('../src/sales-list'),tariffs=require('../src/assistant-tariff-query');
const mobile=require('../../data/knowledge-imports/mobile-20261009/bundle.json');
function fixture(){
 const store=c.initialize({users:[{id:'demo-owner',name:'测试老板',roleCode:'owner',status:'active'},{id:'demo-clerk',name:'测试营业员',roleCode:'employee',status:'active',permissions:['sale:create','cost:view']},{id:'restricted',name:'受限营业员',roleCode:'employee',status:'active',permissions:['sale:create']}],operationLogs:[]});
 require('../../artifacts/sales-list-20261010/fresh-data-model.cjs')(store,path.resolve(__dirname,'../src')+path.sep);
 store.employeeKnowledge=structuredClone(mobile.articles);return store;
}
function ask(s,q,user=s.users[0],context){return assistant.ask(s,user,{question:q,...(context?{context}:{})});}
test('型号库存、仓库及供货商查询只读取账套，不猜测总数',()=>{
 const s=fixture(),before=JSON.stringify(s);
 for(const [q,n] of [['查一下华为畅享70还有几台',10],['OPPO A3还有没有',5],['A仓有几台手机',15],['B仓还剩什么配件',77],['手机甲供的货还剩多少',10]])assert.equal(ask(s,q).metrics.quantity,n,q);
 assert.equal(JSON.stringify(s),before);
 assert.match(ask(s,'畅享70多少钱').answer,/1099\.00/);
});
test('品牌及营业员销售总价和毛利对应原单，不混入全店',()=>{
 const s=fixture();
 for(const [q,total,profit] of [['今天华为卖了多少钱，毛利多少',2198,598],['测试营业员今天卖了多少钱，毛利多少',2997,757],['今天销售清单，总价和毛利多少',5595,1455]]){
 const a=ask(s,q);assert.equal(a.metrics.netAmount,total,q);assert.equal(a.metrics.netProfit,profit,q);}
 const a=ask(s,'今天华为销售清单');assert.ok(a.sources.some(x=>x.href.includes('/sales-list?')&&x.href.includes('q=')));
 assert.equal(ask(s,'哪个供货商卖得最好').metrics.rank[0].netAmount,3298);
});
test('顾客购物包含手机和配件，串号销售追踪不进入开单',()=>{
 const s=fixture(),before=JSON.stringify(s);const a=ask(s,'演示顾客甲买了什么');
 assert.equal(a.metrics.netAmount,1148);assert.match(a.answer,/充电器/);
 const trace=ask(s,'串号1235卖给谁');assert.equal(trace.saleFlow,undefined);assert.match(trace.answer,/演示顾客甲/);assert.match(trace.answer,/1099\.00/);
 const inbound=ask(s,'手机1234进货日期是哪天');assert.equal(inbound.action,undefined);assert.match(inbound.answer,/进货/);
 assert.equal(JSON.stringify(s),before);
});
test('串号追问保持同一台手机；其他人或过期上下文不能继承',()=>{
 const s=fixture(),a=ask(s,'1234是哪台手机');assert.match(a.answer,/991010100001234/);
 const next=ask(s,'进货日期呢',s.users[0],a.context);assert.match(next.answer,/进货/);assert.match(next.answer,/991010100001234/);
 const ctx=require('../src/assistant-context');assert.equal(ctx.resolve('进货日期呢',a.context,s.users[1]).inherited,false);
 assert.equal(ctx.resolve('进货日期呢',{...a.context,at:Date.now()-31*60000},s.users[0]).inherited,false);
});
test('尾号重号要求完整串号，不随便选择第一台',()=>{
 const s=fixture();s.inventory[1].serials.push({no:'990000000001234',status:'可售'});s.inventory[1].quantity++;
 const a=ask(s,'1234是哪台手机');assert.equal(a.metrics.ambiguous,true);assert.equal(a.saleFlow,undefined);assert.match(a.answer,/完整串号/);
});
test('未知品牌、未知型号和没有指向的这台手机不能返回全店统计',()=>{
 const s=fixture();
 for(const q of ['今天三星卖了多少钱','三星还有几台手机','今天华为Mate99卖了多少钱','华为Mate99还有几台']){
 const a=ask(s,q);assert.equal(a.metrics.unknownProduct,true,q);assert.match(a.answer,/没有查到/);}
 assert.match(ask(s,'这台手机毛利多少').answer,/型号或串号/);
});
test('按最近七天及完整年份查询；历史年份不误用今年',()=>{
 const s=fixture(),today=c.day();assert.equal(ask(s,'最近7天销售清单').metrics.netAmount,5595);
 assert.equal(ask(s,'今年'+Number(today.slice(5,7))+'月'+Number(today.slice(8))+'日华为卖了多少钱').metrics.netAmount,2198);
 const history=ask(s,'2025年10月10日华为卖了多少钱');assert.equal(history.metrics.from,'2025-10-10');assert.equal(history.metrics.netAmount,0);
});
test('岗位范围、成本及毛利权限仍由系统决定',()=>{
 const s=fixture(),u=s.users[2];
 assert.match(ask(s,'今天华为毛利多少',u).answer,/没有毛利/);
 assert.match(ask(s,'串号1234进价多少',u).answer,/没有成本/);
 assert.match(ask(s,'测试营业员今天卖了多少钱',u).answer,/没有查看其他营业员/);
 assert.equal(ask(s,'今天销售清单',u).metrics.netAmount,0);
});
test('同型号赠品成本仍按完整订单分摊；来源清单可复核',()=>{
 const s=fixture(),a=ask(s,'今天华为卖了多少钱，毛利多少'),ps=s.products.filter(p=>p.subType==='华为');
 const f=model.filters(new URLSearchParams({from:c.day(),to:c.day()}));f.productIds=new Set(ps.map(p=>p.skuId));
 const report=model.report(s,s.users[0],f);assert.equal(a.metrics.netAmount,report.totals.netAmount);assert.equal(a.metrics.netProfit,report.totals.netProfit);
});
test('裸串号继续进入待确认销售流程，明确查询不会生成单据',()=>{
 const s=fixture(),before=JSON.stringify(s);assert.equal(ask(s,'串号1234').saleFlow.type,'phone');
 assert.equal(ask(s,'查串号1234').saleFlow,undefined);assert.equal(JSON.stringify(s),before);
});
test('移动业务裸推荐、顾客抱怨、装宽带可以直接开始并继承已说的需求',()=>{
 const s=fixture();
 for(const q of ['推荐移动业务','顾客话费太贵，想省钱','顾客流量不够用','家里想装宽带']){
 const a=ask(s,q);assert.equal(a.metrics.kind,'tariff-recommendations',q);assert.ok(a.conversationHint,q);}
 const a=ask(s,'顾客流量不够用');
 const b=ask(s,'预算100元以内，主要重庆用',s.users[0],a.context);
 assert.equal(b.metrics.profile.usage,'data');assert.equal(b.metrics.profile.budgetMax,100);assert.equal(b.metrics.profile.region,'local');assert.ok(b.tariffOptions.length);
 assert.ok(b.tariffOptions.every(p=>p.status==='current'));assert.match(b.answer,/基础费/);
 const broad=ask(s,'家里想装宽带');assert.equal(broad.metrics.profile.broadband,true);
 assert.equal(tariffs.query(s,s.users[0],'移动酬金今天多少钱'),null);
});
