const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('module');const orig=Module._load;Module._load=function(request,...args){if(request==='xlsx')return {};return orig.call(this,request,...args)};const c=require('../src/common');const assistant=require('../src/personal-assistant');
const owner={id:'boss',name:'老板',role:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'店员甲',role:'店员',roleCode:'employee',permissions:['sale:create'],status:'active'},other={id:'other',name:'店员乙',role:'店员',roleCode:'employee',permissions:['sale:create'],status:'active'};
function store(){return c.initialize({users:[owner,staff,other],products:[{skuId:'p1',name:'测试智能机',type:'智能机',active:true,trackSerial:true,stockManaged:true,salePrice:1000}],inventory:[{skuId:'p1',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:1,serials:[{no:'123456789012345',status:'可售'}]}],sales:[{id:'SO-1',operatorId:'staff',salespersonId:'staff',createdAt:c.now(),amount:1000,profit:200,items:[{id:'i1',skuId:'p1',type:'智能机',name:'测试智能机',quantity:1,salePrice:1000,amount:1000,profit:200,costPrice:800}]}],saleReturns:[],receipts:[]})}
test('岗位销售范围和毛利权限',()=>{const s=store();const a=assistant.ask(s,owner,{question:'今天卖了多少台手机'});assert.equal(a.metrics.netUnits,1);const b=assistant.ask(s,other,{question:'今天卖了多少台手机'});assert.equal(b.metrics.netUnits,0);assert.match(assistant.ask(s,staff,{question:'今天毛利多少'}).answer,/没有成本或毛利查看权限/);assert.equal(assistant.ask(s,owner,{question:'今天营业额多少'}).metrics.netSales,1000)});
test('未登记不算缺勤，签到签退可核查',()=>{const s=store();assert.match(assistant.ask(s,owner,{question:'今天出勤情况'}).answer,/未登记不等于缺勤/);assistant.attendance(s,staff,{action:'checkin'});assert.equal(assistant.getAttendance(s,owner).rows.length,1);assistant.attendance(s,staff,{action:'checkout'});assert.ok(assistant.getAttendance(s,staff).rows[0].checkOutAt);assert.equal(assistant.getAttendance(s,other).rows.length,0)});
test('开单建议只产生草稿，报告需老板核实',()=>{const s=store(),before=JSON.stringify(s);const d=assistant.ask(s,staff,{question:'帮我卖测试智能机一台'});assert.equal(d.saleFlow.type,'phone');assert.equal(JSON.stringify(s),before);const r=assistant.submitReport(s,staff,{text:'盘点有差异，待核实'});assert.equal(assistant.reports(s,other).length,0);assert.throws(()=>assistant.reviewReport(s,staff,{id:r.id,status:'已核实'}));assistant.reviewReport(s,owner,{id:r.id,status:'已核实',note:'已查验'});assert.equal(r.status,'已核实')});
test('功能清单按岗位给入口',()=>{const s=store();const a=assistant.ask(s,staff,{question:'系统现在能做什么'});assert.ok(a.sources.some(x=>x.href==='/app?tab=sales'));assert.ok(!a.sources.some(x=>x.href==='/funds'))});



test('单号自然语言检索返回来源',()=>{const s=store();const result=assistant.ask(s,owner,{question:'查询订单号 SO-1'});assert.ok(result.sources.length>0);assert.match(result.answer,/找到/)});
test('开销售单口语生成待确认入口，不误查历史单据',()=>{const s=store();const a=assistant.ask(s,owner,{question:'帮我开一张销售单'});assert.equal(a.action.href,'/app?tab=sales');assert.match(a.answer,/核对后再提交/)});
test('手机库存多少台按库存回答',()=>{const s=store();const a=assistant.ask(s,owner,{question:'手机库存还有多少台'});assert.match(a.answer,/账面库存共 1 件/);assert.doesNotMatch(a.answer,/手机销售/)});
test('老板可教操作说法，员工不能改词库',()=>{const s=store();const phrases=require('../src/assistant-phrases');const row=phrases.save(s,owner,{phrase:'来个销货单',target:'sale'});assert.equal(assistant.ask(s,staff,{question:'来个销货单'}).action.href,'/app?tab=sales');assert.throws(()=>phrases.save(s,staff,{phrase:'出货单',target:'sale'}));assert.equal(phrases.list(s,owner)[0].id,row.id);phrases.remove(s,owner,{id:row.id});assert.equal(phrases.list(s,owner).filter(x=>!x.builtIn).length,0)});
test('商品通用同义词可用于助理开单',()=>{const s=store();s.searchSynonyms=[{id:'SYN-1',terms:['测试智能机','试机']}];const a=assistant.ask(s,owner,{question:'帮我卖试机一台'});assert.equal(a.saleFlow.type,'phone');assert.deepEqual(a.saleFlow.candidateSkuIds,['p1'])});
test('接待指令只准备草稿，由员工最后提交',()=>{const s=store(),before=s.receptions.length;const a=assistant.ask(s,staff,{question:'建接待单，客户叫张三，号卡，手机号13800138000'});assert.equal(a.action.href,'/receptions');assert.equal(a.action.prefill.phone,'13800138000');assert.equal(a.action.prefill.name,'张三');assert.equal(a.action.prefill.purpose,'号卡');assert.equal(s.receptions.length,before)});
test('问同义词设置时直接给正确入口且遵守权限',()=>{const s=store();const ownerAnswer=assistant.ask(s,owner,{question:'帮我找出同义词设置'});assert.equal(ownerAnswer.action.href,'/search#vocabulary-panel');assert.ok(ownerAnswer.sources.some(x=>x.href==='/search#vocabulary-panel'));const staffAnswer=assistant.ask(s,staff,{question:'同义词设置在哪里'});assert.equal(staffAnswer.action,undefined);assert.match(staffAnswer.answer,/没有维护商品同义词的权限/)});
test('助理操作说法设置有独立入口',()=>{const s=store();assert.equal(assistant.ask(s,owner,{question:'助理听不懂，我要编辑'}).action.href,'/assistant#phrase-panel')});

test('华为手机开单进入串号后四位引导且不写单',()=>{const s=store();s.products[0].name='华为测试手机';const before=JSON.stringify(s);const a=assistant.ask(s,staff,{question:'销售了一台华为手机，帮我开一下单'});assert.equal(a.saleFlow.type,'phone');assert.match(a.answer,/后四位/);assert.equal(JSON.stringify(s),before)});
test('华为手机库存只列华为，不混入其他手机',()=>{const s=store();s.products[0].name='华为 Mate 70';s.products.push({skuId:'p2',name:'OPPO Reno',type:'智能机',active:true,trackSerial:true,stockManaged:true});s.inventory.push({skuId:'p2',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:2,serials:[]});const a=assistant.ask(s,owner,{question:'帮我把库存中的华为手机调出来'});assert.match(a.answer,/华为 Mate 70/);assert.doesNotMatch(a.answer,/OPPO Reno/);assert.match(a.answer,/1 台/)});

test('成交了一台华为手机开单也进入串号引导',()=>{const s=store();s.products[0].name='华为测试手机';const a=assistant.ask(s,staff,{question:'成交了一台华为手机。帮我开一下单'});assert.equal(a.saleFlow.type,'phone');assert.match(a.answer,/后四位/)});

test('按品牌查询在库手机并列出可售串号',()=>{const s=store();s.products[0].name='华为 Mate 70';s.inventory[0].serials[0].no='869123456789012';s.products.push({skuId:'p2',name:'OPPO Reno',type:'智能机',active:true,trackSerial:true,stockManaged:true});s.inventory.push({skuId:'p2',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:1,serials:[{no:'869123456789099',status:'可售'}]});const a=assistant.ask(s,owner,{question:'查一下华为的库存，我要串号'});assert.match(a.answer,/869123456789012/);assert.doesNotMatch(a.answer,/869123456789099/);assert.ok(a.sources.some(x=>x.href.includes('scope=inventory')))});

test('售出卖出成交及顾客想要等说法都进入待确认开单引导',()=>{const lines=['售出一台华为手机，帮我开一下单','卖出一台华为手机，帮我开一下单','成交一台华为手机，帮我开一下单','顾客要了一台华为手机，帮我开一下单','顾客要一台华为手机','顾客需要一台华为手机，帮我开一下单','顾客想要一台华为手机，帮我开一下单','刚售出一台华为手机'];for(const line of lines){const s=store();s.products[0].name='华为测试手机';const before=JSON.stringify(s);const a=assistant.ask(s,staff,{question:line});assert.equal(a.saleFlow?.type,'phone',line);assert.match(a.answer,/后四位/,line);assert.equal(JSON.stringify(s),before,line)}});
test('查询和否定说法不误触发开单',()=>{const s=store();s.products[0].name='华为测试手机';for(const line of ['今天售出多少台华为手机','查询华为手机库存','顾客不想要华为手机了']){const a=assistant.ask(s,owner,{question:line});assert.equal(a.saleFlow,undefined,line)}});

test('顾客选好和确定手机进入串号引导，预订先核实成交状态',()=>{const s=store();s.products[0].name='华为测试手机';for(const line of ['顾客选好了这台华为手机','顾客确定了这台华为手机','顾客选定了华为手机']){const a=assistant.ask(s,staff,{question:line});assert.equal(a.saleFlow?.type,'phone',line);assert.equal(a.saleFlow?.reservation,false,line)}for(const line of ['顾客订了这台华为手机','顾客定了这台华为手机','顾客定这台华为手机']){const a=assistant.ask(s,staff,{question:line});assert.equal(a.saleFlow?.type,'phone',line);assert.equal(a.saleFlow?.reservation,true,line);assert.match(a.answer,/预订/,line)}});
test('顾客定的半句话先追问商品',()=>{const s=store();for(const line of ['顾客定','顾客订了','顾客选好了']){const a=assistant.ask(s,staff,{question:line});assert.equal(a.saleFlow?.type,'product',line);assert.match(a.answer,/商品/,line)}});

test('查调找华为库存同义且只读；无手机限定时包含华为数码商品',()=>{const s=store();s.products[0].name='华为 Mate 手机';s.products.push({skuId:'tablet',name:'华为平板',type:'数码',active:true,trackSerial:false,stockManaged:true},{skuId:'oppo',name:'OPPO 手机',type:'智能机',active:true,trackSerial:true,stockManaged:true});s.inventory.push({skuId:'tablet',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:2,serials:[]},{skuId:'oppo',warehouseId:'wh-sale',warehouseName:'销售仓',quantity:1,serials:[{no:'999999999999999',status:'可售'}]});const before=JSON.stringify(s);for(const q of ['从仓库中调出华为的库存','请从仓库中调出华为的库存','查一下华为的库存','找华为','调华为']){const a=assistant.ask(s,owner,{question:q});assert.match(a.answer,/华为 Mate 手机/,q);assert.match(a.answer,/华为平板/,q);assert.match(a.answer,/3 件/,q);assert.doesNotMatch(a.answer,/OPPO 手机/,q);assert.equal(JSON.stringify(s),before,q)}const phone=assistant.ask(s,owner,{question:'找华为手机库存'});assert.match(phone.answer,/1 台/);assert.doesNotMatch(phone.answer,/华为平板/)});

test('组合关键意思理解新的库存问法并避免改账',()=>{const s=store();s.products[0].name='华为 Mate 手机';const before=JSON.stringify(s);for(const q of ['把华为手机拿出来看看','华为手机还剩几台','请列出华为手机','华为有多少货']){const a=assistant.ask(s,owner,{question:q});assert.match(a.answer,/华为 Mate 手机/,q);assert.match(a.answer,/1 台|1 件/,q);assert.equal(JSON.stringify(s),before,q)}const order=assistant.ask(s,owner,{question:'查华为手机销售订单'});assert.equal(order.saleFlow,undefined)});
test('招呼有自然应答且不吞掉业务问题',()=>{const s=store();for(const q of ['喂，你好','喂','你好','您好！','嗨','早上好','在吗？']){const a=assistant.ask(s,owner,{question:q});assert.equal(a.metrics.topic,'greeting',q);assert.equal(a.metrics.replyStyle,'sichuan',q);assert.equal(a.action,undefined,q)}s.products[0].name='华为测试手机';const stock=assistant.ask(s,owner,{question:'你好，帮我查华为手机库存'});assert.match(stock.answer,/华为测试手机/);assert.doesNotMatch(stock.answer,/我需要为您做什么/);const sale=assistant.ask(s,owner,{question:'你好，帮我开一张销售单'});assert.equal(sale.action.href,'/app?tab=sales')});test('当面口语可识别库存和开单，但不替人提交',()=>{const s=store();s.products[0].name='华为测试手机';const before=JSON.stringify(s);for(const q of ['喂，华为机子还有没得','那个，华为手机有没得','你好，华为手机还有没有']){const a=assistant.ask(s,owner,{question:q});assert.match(a.answer,/华为测试手机/,q);assert.equal(a.saleFlow,undefined,q)}for(const q of ['顾客看中了这台华为机子','顾客相中了这台华为手机','顾客看中这台华为手机','帮这位顾客把华为手机开个单']){const a=assistant.ask(s,staff,{question:q});assert.equal(a.saleFlow?.type,'phone',q);assert.match(a.answer,/后四位/,q)}assert.equal(JSON.stringify(s),before)});
test('常用门店说法预设覆盖六类操作且可由老板补充',()=>{const s=store();s.products[0].name='华为测试手机';const phrases=require('../src/assistant-phrases');const builtIn=phrases.list(s,owner).filter(x=>x.builtIn);assert.equal(builtIn.length,12);const reception=assistant.ask(s,staff,{question:'顾客来问一下华为手机'});assert.match(reception.answer,/接待单草稿/);assert.equal(reception.action.prefill.purpose,'咨询手机');assert.equal(assistant.ask(s,staff,{question:'这台手机顾客带走了'}).saleFlow?.type,'phone');assert.equal(assistant.ask(s,owner,{question:'店里要补点货'}).action?.href,'/app?tab=purchase');assert.match(assistant.ask(s,owner,{question:'店里还有没有货'}).answer,/账面库存/);assert.match(assistant.ask(s,owner,{question:'今天卖得怎么样'}).answer,/今天销售 1 单/);assert.match(assistant.ask(s,owner,{question:'今天谁在上班'}).answer,/未登记不等于缺勤/);assert.throws(()=>phrases.list(s,staff));const custom=phrases.save(s,owner,{phrase:'店里要补点货',target:'inventory'});assert.equal(assistant.ask(s,owner,{question:'店里要补点货'}).action,undefined);phrases.remove(s,owner,{id:custom.id})});
test('销量口语查询按真实销售明细和退货计算并区分品牌及岗位',()=>{
  const s=store();s.products[0].name='华为 Mate 手机';
  s.products.push({skuId:'p2',name:'Type-C 数据线',type:'配件',active:true},{skuId:'p3',name:'OPPO Reno 手机',type:'智能机',active:true});
  s.sales[0].items.push({id:'i2',skuId:'p2',type:'配件',name:'Type-C 数据线',quantity:2,amount:80});
  s.sales.push({id:'SO-2',operatorId:'other',salespersonId:'other',createdAt:c.now(),items:[{id:'i3',skuId:'p3',type:'智能机',name:'OPPO Reno 手机',quantity:1,amount:1500}]});
  s.saleReturns.push({id:'SR-1',orderId:'SO-1',operatorId:'staff',salespersonId:'staff',createdAt:c.now(),items:[{skuId:'p2',type:'配件',name:'Type-C 数据线',quantity:1,amount:40}]});
  const before=JSON.stringify(s);
  const all=assistant.ask(s,owner,{question:'统计一下今天的销量'});
  assert.equal(all.metrics.soldUnits,4);assert.equal(all.metrics.returnedUnits,1);assert.equal(all.metrics.netUnits,3);
  assert.equal(all.metrics.orderCount,2);assert.equal(all.metrics.returnOrderCount,1);
  assert.match(all.answer,/净售 3 件/);assert.ok(all.sources.some(x=>x.id==='SO-1'));
  const phones=assistant.ask(s,owner,{question:'今天手机销量'});
  assert.equal(phones.metrics.netUnits,2);assert.match(phones.answer,/手机卖出 2 台/);
  const huawei=assistant.ask(s,owner,{question:'今天华为手机销量'});
  assert.equal(huawei.metrics.netUnits,1);assert.equal(huawei.metrics.brand,'华为');
  const personal=assistant.ask(s,staff,{question:'统计今天销量'});
  assert.equal(personal.metrics.netUnits,2);assert.equal(personal.metrics.orderCount,1);
  assert.equal(JSON.stringify(s),before);
});
test('当天销售口语、指定营业员、毛利、进货和店况均取账套记录',()=>{
  const s=store();s.products[0].name='荣耀 X 手机';s.sales[0].items[0].name='荣耀 X 手机';
  s.purchases.push({id:'PO-1',operatorId:'staff',createdAt:c.now(),items:[{skuId:'p1',name:'荣耀 X 手机',quantity:2}]});
  s.procurementPlans.push({id:'PLAN-1',operatorId:'staff',status:'open',items:[{skuId:'p1',name:'荣耀 X 手机',quantity:1,received:0}]});
  const before=JSON.stringify(s);
  const sold=assistant.ask(s,owner,{question:'今天卖了什么手机'});
  assert.match(sold.answer,/荣耀 X 手机 1 台/);
  assert.equal(assistant.ask(s,owner,{question:'今天卖了多少台手机？'}).metrics.netUnits,1);
  assert.equal(assistant.ask(s,owner,{question:'今天手机销量怎么样？'}).metrics.netUnits,1);
  assert.match(assistant.ask(s,owner,{question:'荣耀手机今天卖了没有？'}).answer,/荣耀 X 手机 1 台/);
  const staffSales=assistant.ask(s,owner,{question:'统计一下今天店员甲营业员的销量'});
  assert.equal(staffSales.metrics.netUnits,1);assert.equal(staffSales.metrics.staffId,'staff');
  assert.match(assistant.ask(s,other,{question:'统计一下今天店员甲营业员的销量'}).answer,/没有查看其他营业员销量的权限/);
  assert.match(assistant.ask(s,owner,{question:'核算一下销售毛利'}).answer,/销售毛利 ¥200.00/);
  assert.match(assistant.ask(s,owner,{question:'看看今天的赚了多少'}).answer,/还没扣工资、房租等费用/);
  assert.match(assistant.ask(s,owner,{question:'今天赚了多少？'}).answer,/销售毛利 ¥200.00/);
  assert.match(assistant.ask(s,staff,{question:'今天赚了多少？'}).answer,/没有成本或毛利查看权限/);
  const purchases=assistant.ask(s,owner,{question:'今天进了什么货？'});
  assert.equal(purchases.metrics.receivedUnits,2);assert.match(purchases.answer,/荣耀 X 手机 2 件/);
  const briefing=assistant.ask(s,owner,{question:'汇报一下今天店里面的情况'});
  assert.match(briefing.answer,/今天店况/);assert.match(briefing.answer,/今日进货/);
  assert.equal(JSON.stringify(s),before);
});
test('默认一句话回答，明确要求明细才展开且不播报当天日期',()=>{
  const s=store();
  const brief=assistant.ask(s,owner,{question:'今天卖了多少台手机'});
  assert.match(brief.answer,/今天手机卖出 1 台/);
  assert.doesNotMatch(brief.answer,/20\d{2}-\d{2}-\d{2}|退货 0|销售单 1 笔/);
  const detail=assistant.ask(s,owner,{question:'详细说说今天的手机销量'});
  assert.match(detail.answer,/销售单 1 笔/);
  const profit=assistant.ask(s,owner,{question:'今天赚了多少'});
  assert.doesNotMatch(profit.answer,/赠品成本|销售额/);
  const profitDetail=assistant.ask(s,owner,{question:'今天销售毛利怎么算'});
  assert.match(profitDetail.answer,/销售额 ¥1000.00/);
  const noPurchase=assistant.ask(s,owner,{question:'今天进了什么货'});
  assert.equal(noPurchase.answer,'今天没有进货入库记录。');
  const shop=assistant.ask(s,owner,{question:'汇报一下今天店里面的情况'});
  assert.doesNotMatch(shop.answer,/20\d{2}-\d{2}-\d{2}|今日进货 0|员工报告待核实 0/);
  const shopDetail=assistant.ask(s,owner,{question:'详细汇报一下今天店里面的情况'});
  assert.ok(shopDetail.answer.length>=shop.answer.length);
});