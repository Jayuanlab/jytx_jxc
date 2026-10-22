'use strict';
const assert=require('node:assert/strict'),c=require('../server/src/common'),erp=require('../server/src/erp'),sup=require('../server/src/suppliers'),rec=require('../server/src/receptions'),pay=require('../server/src/payroll'),payments=require('../server/src/sale-payments'),assistant=require('../server/src/personal-assistant'),details=require('../server/src/inventory-details'),pricing=require('../server/src/product-pricing'),journal=require('../server/src/work-journal'),shift=require('../server/src/closeouts'),cash=require('../server/src/cash-handovers'),carrier=require('../server/src/carrier-rentals'),daily=require('../server/src/daily-close'),search=require('../server/src/search').search;
const batchId='simulation-20261010-v1';
const catalog=[
 ['HW60','华为 Mate 60 128GB','智能手机','华为','Mate 60','wh-a',4,1800,2399,true],
 ['HW70','华为 Mate 70 256GB','智能手机','华为','Mate 70','wh-a',4,3200,3999,true],
 ['HONOR','荣耀 200 256GB','智能手机','荣耀','荣耀 200','wh-a',3,1400,1999,true],
 ['OPPO','OPPO Reno 13 256GB','智能手机','OPPO','Reno 13','wh-a',3,2000,2699,true],
 ['VIVO','vivo Y200 128GB','智能手机','vivo','Y200','wh-a',2,1000,1399,true],
 ['USED','二手苹果 iPhone 13 128GB','二手机','苹果','iPhone 13','wh-a',2,1800,2399,true],
 ['ELDER','诺基亚按键手机','功能机','诺基亚','105','wh-a',2,90,139,true],
 ['WATCH','儿童电话手表','儿童手表','小天才','Z6','wh-a',2,350,499,true],
 ['CABLE','Type-C 数据线','配件和维修','数据线','1米','wh-b',20,10,29,false],
 ['CASE','手机保护壳','配件和维修','保护壳','通用','wh-b',20,15,39,false],
 ['FILM','钢化膜','配件和维修','保护膜','通用','wh-b',20,5,19,false],
 ['CHARGE','快充充电器','配件和维修','充电器','65W','wh-b',10,69,99,false],
 ['ROUTER','移动路由器','移动物资','路由器','千兆','wh-c',5,120,169,false],
 ['CAMERA','移动摄像头','移动物资','摄像头','室内','wh-c',5,100,159,false],
 ['SERVICE','资料迁移服务','其他收入','服务','资料迁移','',0,0,20,false]
];
function build(store){
 if((store.simulationBatches||[]).some(x=>x.id===batchId))return {...store.simulationBatches.find(x=>x.id===batchId).summary,alreadyImported:true};
 const owner=store.users.find(x=>x.id==='demo-owner'&&x.roleCode==='owner'&&x.status==='active');
 const clerk=store.users.find(x=>x.id==='demo-clerk'&&x.status==='active');
 const manager=store.users.find(x=>x.id==='demo-manager'&&x.status==='active');
 assert.ok(owner&&clerk&&manager,'Required existing simulation accounts missing');
 const protectedBefore=JSON.stringify(Object.fromEntries(['users','employeeKnowledge','assistantDialogues','assistantPhrases','searchSynonyms','knowledgeImports','knowledgeUploads'].map(k=>[k,store[k]||[]])));
 const beforeIds=new Map(Object.entries(store).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,new Set(v.map(x=>x?.id||x?.skuId||JSON.stringify(x)))]));
 const originalNotices=structuredClone(store.feishuNotices||[]);
 const checks=[],refs={},products={};const pass=(name,work)=>{work();checks.push(name)};
 const suppliers=['模拟手机供货商','模拟配件供货商','模拟移动物资商'].map(name=>sup.save(store,clerk,{name,contact:'模拟联系人，不联系',note:'仅用于功能测试'}));
 let serialSequence=1234;
 for(const [key,name,type,brand,model,warehouse,quantity,cost,price,track] of catalog){
  const p=erp.saveProduct(store,clerk,{externalCode:'SIM26-'+key,name:name+'（模拟）',shortName:name,type,subType:brand,thirdType:model,kind:warehouse?'physical':'service',unit:track?'台':warehouse?'件':'项',warehouseId:warehouse,trackSerial:track,salePrice:price});
  Object.assign(p,{testData:true,testDataBatch:batchId});products[key]=p;
  if(warehouse){
   p.mockSerials=track?Array.from({length:quantity},()=> '99000000000'+String(serialSequence++).padStart(4,'0')):[];
   const supplier=suppliers[warehouse==='wh-a'?0:warehouse==='wh-b'?1:2];
   const po=erp.purchase(store,clerk,{supplierId:supplier.id,invoiceNo:'SIM-INV-'+key,items:[{skuId:p.skuId,quantity,costPrice:cost,serials:p.mockSerials}]});
   if(key==='HW60')refs.firstPurchase=po.id;
  }
  pay.saveRule(store,owner,{skuId:p.skuId,mode:track?'piece':'profit',value:track?30:10});
 }
 // Keep catalog records compact; simulation serials belong to inventory.
 const serial=(key,index=0)=>store.inventory.find(x=>x.skuId===products[key].skuId).serials[index].no;
 const receptionist=(phone,purpose,extra={})=>rec.create(store,clerk,{phone,name:'模拟顾客'+phone.slice(-2),purpose,source:'到店',intakeVersion:2,needs:'模拟：'+purpose,budgetBand:'2000to2999',followUpNeed:'no',...extra});
 const r1=receptionist('13900001001','购买华为手机',{gender:'男',ageBand:'25—34岁',occupation:'模拟自由职业',residenceType:'村里',town:'南溪镇',village:'模拟村',viewedProducts:[{skuId:products.HW60.skuId,price:2399}]});
 const r2=receptionist('13900001002','购买荣耀手机');
 const r3=receptionist('13900001003','购买OPPO手机');
 const follow=receptionist('13900001004','咨询宽带',{budgetBand:'none',followUpNeed:'yes',followUpAt:c.day()+'T23:00'});
 const cardRec=receptionist('13900001005','办理号卡',{budgetBand:'under500'});
 const noPhone=receptionist('','咨询配件',{name:'模拟未留号码顾客',budgetBand:'under500'});
 rec.close(store,clerk,{id:noPhone.id,result:'未成交',noSaleReason:'顾客未留手机号码',review:'模拟留底记录'});
 rec.confirmClose(store,owner,{id:noPhone.id,validity:'无效',points:50});
 refs.reception=r1.id;refs.followup=follow.id;
 const item=(key,index=0,price=products[key].salePrice,quantity=1)=>({skuId:products[key].skuId,quantity,salePrice:price,...(products[key].trackSerial?{serialNo:serial(key,index)}:{})});
 const s1=erp.sale(store,clerk,{account:'现金',cashDrawerConfirmed:true,receptionId:r1.id,items:[item('HW60',1)],gifts:[{skuId:products.CASE.skuId,quantity:1}],giftReason:'模拟随单赠送',invoiceNo:'SIM-SALE-INV-001',orderNote:'模拟销售，非实际经营'});
 const s2=erp.sale(store,clerk,{account:'微信',accountOwnerId:owner.id,receptionId:r2.id,items:[item('HONOR')],orderNote:'模拟销售，扫码款待核对'});
 const s3=erp.sale(store,clerk,{account:'微信',accountOwnerId:owner.id,receptionId:r3.id,items:[item('OPPO')],orderNote:'模拟销售退货流程'});
 payments.confirm(store,owner,{orderId:s3.id,actualAmount:s3.amount,reference:'SIM-WX-RETURN-001'});
 const returned=erp.returnSale(store,clerk,{orderId:s3.id,reason:'模拟退货测试',account:'微信',items:s3.items.map(x=>({itemId:x.id,quantity:1}))});
 const s4=erp.sale(store,clerk,{account:'支付宝',accountOwnerId:owner.id,customerName:'模拟配件顾客',items:[item('CABLE',0,29,2),item('SERVICE')],orderNote:'模拟配件及其他收入'});
 erp.supplementGift(store,clerk,{orderId:s1.id,items:[{skuId:products.FILM.skuId,quantity:1}],reason:'模拟顾客后补附件'});
 erp.supplementGift(store,clerk,{orderId:s2.id,items:[{skuId:products.CHARGE.skuId,quantity:1}],reason:'模拟超出单件成本上限，需要老板审核'});
 refs.sales=[s1.id,s2.id,s3.id,s4.id];refs.returned=returned.id;refs.pendingGift=store.giftApprovals[0].id;
 const plan=sup.plan(store,clerk,{supplierId:suppliers[0].id,items:[{skuId:products.HW70.skuId,quantity:2,costPrice:3200}],note:'模拟待收货订货，方便验收测试'});refs.plan=plan.id;
 const service=carrier.create(store,clerk,{type:'card',subType:'new',serviceDate:c.day(),externalOrderNo:'SIM-MOBILE-001',receptionId:cardRec.id,monthlyAmounts:[35,10,0],note:'模拟号卡业务，预计酬金尚未到账'});
 refs.carrier=service.id;
 if(!store.salaryRates.some(x=>x.employeeId===clerk.id&&x.effectiveMonth<=c.month()))pay.saveSalary(store,owner,{employeeId:clerk.id,effectiveMonth:c.month(),amount:3000});
 pay.saveAdjustment(store,owner,{employeeId:clerk.id,month:c.month(),direction:'add',amount:35,reason:'模拟业务奖励，只记奖励、不抵扣工资',sourceOrderId:s2.id});
 const work1=journal.create(store,clerk,{type:'客户回访',event:'模拟：回访咨询宽带的顾客',result:'顾客表示周末再到店',referenceKind:'reception',referenceId:follow.id});
 journal.review(store,owner,{id:work1.id,approve:true,points:20,note:'模拟审核通过'});
 journal.create(store,clerk,{type:'整理柜台',event:'模拟：整理手机展示柜台',result:'展示柜已整理，待老板核定积分'});
 if(!store.attendance.some(x=>x.userId===clerk.id&&x.date===c.day()))assistant.attendance(store,clerk,{action:'checkin'});
 if(!store.attendance.some(x=>x.userId===manager.id&&x.date===c.day()))assistant.attendance(store,manager,{action:'checkin'});
 const price=pricing.request(store,clerk,{skuId:products.CABLE.skuId,newPrice:25,reason:'模拟促销调价申请'});refs.priceChange=price.id;
 const inv=store.inventory.find(x=>x.skuId===products.HW60.skuId),current=inv.serials.filter(x=>x.status==='可售').map(x=>x.no);
 details.count(store,clerk,{skuId:inv.skuId,warehouseId:inv.warehouseId,expectedSerials:current,expectedQuantity:inv.quantity,serials:current,reason:'模拟手机逐台盘库'});
 erp.stocktake(store,clerk,{skuId:products.CABLE.skuId,warehouseId:'wh-b',expected:18,actual:18,reason:'模拟配件盘库数量相符'});
 erp.expense(store,owner,{type:'模拟门店清洁用品',amount:12,account:'微信'});
 cash.create(store,clerk,{kind:'person',recipientId:owner.id,amount:100,note:'模拟现金交接，待接收人确认'});
 const shot=shift.snapshot(store,clerk);shift.submit(store,clerk,{actualCash:shot.expectedCash,receiverId:owner.id,note:'模拟交接班，待老板核对'});
 const dc=daily.snapshot(store);daily.submit(store,clerk,{date:c.day(),reviewerId:manager.id,openingCash:0,actualCash:dc.cashChange,note:'模拟日结待复核'});
 refs.practiceSerial=serial('HW60');refs.practiceSerialTail=refs.practiceSerial.slice(-4);
 pass('入库每台手机有串号、供应商、进货日期',()=>{
  const stock=erp.inventory(store,clerk).find(x=>x.skuId===products.HW60.skuId);assert.equal(stock.quantity,3);const unit=stock.serials.find(x=>x.no===refs.practiceSerial);assert.ok(unit.supplier&&unit.purchaseDate);
 });
 pass('销售及退货按串号扣回原库存',()=>{const inv=store.inventory.find(x=>x.skuId===products.OPPO.skuId);assert.equal(inv.quantity,3);assert.equal(inv.serials.find(x=>x.no===s3.items[0].serialNo).status,'可售');assert.equal(store.inventory.find(x=>x.skuId===products.HONOR.skuId).quantity,2)});
 pass('随单、补赠成本与限额审批分别留痕',()=>{const o=store.sales.find(x=>x.id===s1.id);assert.equal(o.giftCost,20);assert.equal(o.giftOrders.length,2);assert.equal(store.giftApprovals.find(x=>x.id===refs.pendingGift).status,'待审批');assert.equal(store.inventory.find(x=>x.skuId===products.CHARGE.skuId).quantity,10)});
 pass('现金声明不阻断开单，扫码款未确认不冒充到账',()=>{assert.equal(store.sales.find(x=>x.id===s1.id).paymentReview.status,'待老板核对');assert.equal(store.sales.find(x=>x.id===s2.id).receivedAmount,0)});
 pass('手机净售2台，销售额4476，毛利1236，费用另计',()=>{const r=erp.report(store,owner);assert.equal(r.summary.netSales,4476);assert.equal(r.summary.adjustedGrossProfit,1236);assert.equal(r.summary.expenseAmount,12);const a=assistant.ask(store,owner,{question:'今天卖了多少台手机'});assert.equal(a.metrics.soldUnits,3);assert.equal(a.metrics.returnedUnits,1);assert.equal(a.metrics.netUnits,2)});
 pass('接待按手机号关联，无码留底基本50积分',()=>{assert.equal(store.sales.find(x=>x.id===s1.id).receptionId,r1.id);assert.equal(noPhone.points[0].amount,50)});
 pass('助理华为查询有指向性且返回真实串号',()=>{const a=assistant.ask(store,owner,{question:'查一下华为的库存，我要串号'});assert.match(a.answer,/华为/);assert.doesNotMatch(a.answer,/OPPO|荣耀/);assert.ok(JSON.stringify(a).includes(refs.practiceSerial))});
 pass('串号与发票单号串联原入库、销售及退货记录',()=>{const t=search(store,owner,new URLSearchParams({scope:'serials',q:s3.items[0].serialNo}));assert.equal(t.serialTraces[0].sales[0].returns.length,1);const i=search(store,owner,new URLSearchParams({scope:'invoices',q:'SIM-SALE-INV-001'}));assert.ok(i.results.sales.some(x=>x.id===s1.id))});
 pass('工资逐笔提成核对、红包奖励增加35、积分独立',()=>{const p=pay.getPayroll(store,clerk,c.month());assert.equal(p.rows[0].manualAdjustment,35);assert.ok(p.businessChecks.every(x=>x.status==='accrued'));assert.ok(p.points.some(x=>x.points===50));assert.equal(p.rows[0].total,c.round(p.rows[0].baseSalary+p.rows[0].commission+35))});
 pass('A/B/C分仓，C仓YD标注；其他收入不占库存',()=>{assert.match(products.ROUTER.name,/YD/);assert.equal(products.HW60.warehouseId,'wh-a');assert.equal(products.CABLE.warehouseId,'wh-b');assert.equal(products.ROUTER.warehouseId,'wh-c');assert.ok(!store.inventory.some(x=>x.skuId===products.SERVICE.skuId))});
 pass('调价、订货、赠品、现金、工作积分、日结待办可供老板审核',()=>{assert.equal(price.status,'待老板审核');assert.equal(plan.status,'open');assert.ok(store.cashHandovers.some(x=>x.status==='待接收人确认'));assert.ok(store.workJournals.some(x=>x.status==='待核定'));assert.ok(store.dailyCloseouts.some(x=>x.status==='待领取复核'))});
 // Simulated commands can create notice queue rows; keep them out of external dispatch.
 store.feishuNotices=originalNotices;
 for(const [key,rows]of Object.entries(store))if(Array.isArray(rows)&&!['users','employeeKnowledge','assistantDialogues','assistantPhrases','searchSynonyms','knowledgeImports','knowledgeUploads','feishuNotices','operationLogs'].includes(key)){
  const seen=beforeIds.get(key)||new Set();for(const row of rows)if(!seen.has(row?.id||row?.skuId||JSON.stringify(row))){row.testData=true;row.testDataBatch=batchId;}
 }
 for(const p of Object.values(products))delete p.mockSerials;
 assert.equal(JSON.stringify(Object.fromEntries(['users','employeeKnowledge','assistantDialogues','assistantPhrases','searchSynonyms','knowledgeImports','knowledgeUploads'].map(k=>[k,store[k]||[]]))),protectedBefore,'Existing accounts and knowledge must be unchanged');
 const summary={batchId,createdAt:c.now(),alreadyImported:false,products:catalog.length,stockUnits:store.inventory.filter(x=>x.testDataBatch===batchId).reduce((n,x)=>n+x.quantity,0),serials:store.inventory.filter(x=>x.testDataBatch===batchId).reduce((n,x)=>n+x.serials.length,0),purchases:catalog.filter(x=>x[5]).length,sales:4,saleReturns:1,receptions:6,netPhoneUnits:2,netSales:4476,grossProfit:1236,checks,refs};
 store.simulationBatches ||= [];store.simulationBatches.push({id:batchId,testData:true,summary,createdAt:c.now()});
 c.audit(store,owner,'simulation:import',batchId+' · 全功能模拟数据 · '+catalog.length+'种商品 · 不发送外部通知');
 return summary;
}
function fixture(){return sup.upgrade(c.initialize({users:[{id:'demo-owner',name:'测试老板',roleCode:'owner',status:'active'},{id:'demo-manager',name:'测试店长',roleCode:'manager',status:'active',permissions:[]},{id:'demo-clerk',name:'测试店员',roleCode:'employee',status:'active',permissions:['sale:create','sale:return','purchase:create','product:update','cost:view','supplier:view','stock:adjust']},{id:'demo-warehouse',name:'测试仓管',roleCode:'warehouse',status:'active',permissions:['purchase:create','stock:adjust','product:update','cost:view','supplier:view']}]}));}
module.exports={batchId,build,fixture};
if(require.main===module){const fs=require('node:fs'),path=require('node:path'),s=fixture(),r=build(s),before=JSON.stringify(s);assert.equal(build(s).alreadyImported,true);assert.equal(JSON.stringify(s),before);const out=path.resolve('artifacts/simulation-20261010');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'seed.json'),JSON.stringify(s,null,2));fs.writeFileSync(path.join(out,'scenario.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));}
