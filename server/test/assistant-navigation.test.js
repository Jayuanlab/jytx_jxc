'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const c=require('../src/common'),assistant=require('../src/personal-assistant'),directory=require('../src/assistant-capabilities');
const owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'店员',roleCode:'employee',status:'active',permissions:['sale:create']},kiosk={id:'kiosk',roleCode:'customer-assistant',status:'active'};
function fixture(){return c.initialize({users:[owner,staff,kiosk],products:[{skuId:'hw',name:'华为测试机',type:'智能手机',active:true,stockManaged:true,trackSerial:true,warehouseId:'wh-a'}],inventory:[{skuId:'hw',quantity:1,warehouseId:'wh-a',warehouseName:'A仓·手机数码',serials:[{no:'869000000001234',status:'可售'}]}],sales:[{id:'SO-1',createdAt:c.now(),operatorId:'staff',salespersonId:'staff',amount:1999,profit:99,items:[{skuId:'hw',type:'智能手机',name:'华为测试机',quantity:1,amount:1999}]}]});}
test('普通工作说法按实际目录找到入口，所有问答只读',()=>{
 const s=fixture(),before=JSON.stringify(s);
 const cases=[['我要上传学习资料','/knowledge#upload-section'],['我在哪里放学习资料','/knowledge#upload-section'],['学习资料怎么传上去，入口在哪','/knowledge#upload-section'],['我要交接班','/close'],['帮我进入每日扎账','/daily-close'],['打开串号追踪','/search'],['发票单号查询在哪里','/search'],['打开供应商往来','/app?tab=suppliers'],['打开商品调价','/app?tab=products'],['带我去库存页面','/app?tab=inventory'],['打开赠品审批','/gift-approvals'],['我要给顾客现金充值','/air-recharge'],['进入销售收款核对','/sale-payments'],['我要开学习单','/learning'],['打开数字大脑','/brain']];
 for(const [question,href]of cases){const result=assistant.ask(s,owner,{question});assert.equal(result.action?.href,href,question);assert.equal(result.metrics.kind,'function-entry',question);assert.ok(result.sources.some(row=>row.href===href));assert.equal(JSON.stringify(s),before);}
});
test('目录与入口权限一致，顾客模式和机器人不能进入店内功能',()=>{
 const s=fixture();for(const question of ['我要上传学习资料','打开资金收支','打开赠品审批','打开商品调价','打开数字大脑']){const reply=assistant.ask(s,staff,{question});assert.equal(reply.metrics.allowed,false,question);assert.equal(reply.action,undefined);}
 assert.equal(assistant.ask(s,staff,{question:'我要交接班'}).action.href,'/close');
 assert.ok(!directory.catalog(s,staff).items.some(row=>row.id==='upload'));
 for(const user of [owner,kiosk]){const reply=assistant.ask(s,user,{question:'打开资金收支',mode:user===kiosk?'store':'customer'});assert.equal(reply.mode,'customer');assert.equal(reply.action,undefined);assert.equal(reply.metrics.restricted,true);}
});
test('导航不吞销量库存、办理草稿、真实资料、或拒绝打开',()=>{
 const s=fixture();const stock=assistant.ask(s,owner,{question:'查一下华为库存，我要串号'});assert.match(stock.answer,/华为测试机/);assert.match(stock.answer,/869000000001234/);assert.notEqual(stock.metrics?.kind,'function-entry');const where=assistant.ask(s,owner,{question:'华为手机库存在哪个仓'});assert.match(where.answer,/A仓/);assert.match(where.answer,/华为测试机/);assert.notEqual(where.metrics?.kind,'function-entry');
 for(const question of ['今天卖了多少台手机','统计一下今天的销量'])assert.equal(assistant.ask(s,owner,{question}).metrics.netUnits,1);
 assert.equal(assistant.ask(s,staff,{question:'售出一台华为手机，帮我开一下单'}).saleFlow.type,'phone');
 assert.ok(assistant.ask(s,staff,{question:'现金交接怎么核对'}).metrics.knowledge);
 assert.notEqual(assistant.ask(s,owner,{question:'不要打开库存'}).metrics?.kind,'function-entry');
});
test('正式手机类别和旧叫法统计一致，配件不混入手机销量',()=>{
 const s=fixture();for(const type of ['智能手机','智能机','二手手机','二手机','老人机','功能机']){s.sales[0].items[0].type=type;assert.equal(assistant.ask(s,owner,{question:'今天卖了多少台手机'}).metrics.netUnits,1,type);}
 s.sales[0].items[0].type='配件';assert.equal(assistant.ask(s,owner,{question:'今天卖了多少台手机'}).metrics.netUnits,0);
});

test('销售收款核对功能直接导航，近期已查过串号也不错误继承',()=>{
 const s=fixture(),before=JSON.stringify(s),context={userId:staff.id,at:Date.now(),serialToken:'869000000001234',question:'查串号1234是否已经销售',mode:'store'};
 for(const question of ['进入销售收款核对','打开销售收款确认','销售收款核对在哪里']){
  const reply=assistant.ask(s,staff,{question,context});assert.equal(reply.action?.href,'/sale-payments',question);assert.equal(reply.metrics.kind,'function-entry',question);assert.equal(reply.metrics.featureId,'payment');assert.equal(reply.saleFlow,undefined);assert.equal(JSON.stringify(s),before);
 }
 const denied=assistant.ask(s,{id:'viewer',roleCode:'employee',status:'active',permissions:[]},{question:'进入销售收款核对'});assert.equal(denied.action,undefined);assert.equal(denied.metrics.allowed,false);
});
test('具体串号核对和这台手机追问仍返回销售状态，不退化为收款菜单',()=>{
 const s=fixture();s.inventory[0].quantity=0;s.inventory[0].serials[0].status='已售';s.sales[0].items[0].serialNo='869000000001234';const before=JSON.stringify(s),context={userId:staff.id,at:Date.now(),serialToken:'869000000001234',question:'查串号1234是否已经销售',mode:'store'};
 for(const question of ['查一下串号1234是不是已经销售了','串号869000000001234销售了没有','这台是不是已经销售了','进入销售收款核对，串号1234是否已经销售']){
  const reply=assistant.ask(s,staff,{question,context});assert.equal(reply.metrics.kind,'serial-status',question);assert.equal(reply.metrics.status,'sold',question);assert.equal(reply.metrics.serialNo,'869000000001234');assert.equal(reply.action,undefined);assert.equal(reply.saleFlow,undefined);assert.equal(JSON.stringify(s),before);
 }
});
