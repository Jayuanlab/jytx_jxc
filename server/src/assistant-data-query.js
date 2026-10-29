'use strict';

// The model sees this directory, never the store or its raw collections.
// Every reader below runs with the authenticated ERP user and projects only
// fields that are needed for an answer.
const c = require('./common');
const erp = require('./erp');
const search = require('./search');
const personnel = require('./personnel');
const business = require('./assistant-business-read');
const receptions = require('./receptions');
const carrier = require('./carrier-rentals');

const catalog = Object.freeze([
  {id:'finance.mine',label:'我的财务',description:'只读当前登录本人的未清挂账、经手门店款、本人账户收付登记、交接与红包；默认金额及条数只含2026-10-28起的原记录；明确问全部累计时传scope=all查询全部历史。拒绝指定其他人；老板发放登记不等于员工独立确认收到。'},
  {id:'finance.store-wallet',label:'门店微信备用金余额',description:'只读查询当日门店微信账面余额、增加减少、已确认余额基准；不读取个人账户，不代替实际扎账核对。'},
  {id:'finance.business-change',label:'业务变更退款与和包闭环',description:'按原单查询老板批准、顾客实际退款、现金流水、移动代扣税、和包净应收和到账、扎账差额线索；只读，不代办资金或实点现金。'},
  {id:'sales.performance',label:'销售业绩',description:'按营业日查看订单、销售额、退货、净销售、收款和有权限时的销售毛利；可分析今天到当前时刻的营业厅业绩。'},
  {id:'sales.staff',label:'员工销售贡献',description:'按营业日查看每位可见营业员的订单和净销售；毛利只在具备毛利权限时提供。'},
  {id:'sales.items',label:'销售商品明细',description:'按营业日查看可见销售单的商品分类、商品名称、售出和退货数量；可核实系统内是否登记了手机销售。'},
  {id:'sales.cash-pending',label:'销售现金待交提醒',description:'查看当前账号有权处理或老板有权查看的待交销售现金：返回 SK 收款单展示号、关联 SO 销售单号、金额、处理人和下一步。两种编号不能混称；提醒已读不代表现金交接完成。'},
  {id:'carrier.services',label:'移动业务与酬金',description:'按办理日查看可见普通移动业务与新办卡组合单；分别列出酬金计划、顾客实收、收款待对账及红包申请状态，不把顾客实收算作移动酬金。'},
  {id:'staff.directory',label:'在职员工',description:'查看当前账号有权限查看的在职人员名单。'},
  {id:'staff.attendance',label:'考勤和请休假',description:'按日期和人员查看原始签到、签退及已批准的请休假；未签到不能推断缺勤。'},
  {id:'inventory.search',label:'库存与商品',description:'用商品名、型号、编码或串号检索商品及可见库存。需要具体关键词。'},
  {id:'inventory.recommend',label:'手机整机推荐',description:'按真实整机分类、品牌、预算、零售价和可售库存筛选手机，先筛整机再截取；用于推荐华为等手机，不混维修配件。不包含硬件配置或实测续航证据。'},
  {id:'inventory.warehouses',label:'仓库列表',description:'查看库存模块实际使用的仓库基础资料。无需关键词；不代表各仓当前有库存。'},
  
  {id:'finance.accounts',label:'资金账户',description:'按日期查询资金账户、空充和门店微信的可核实账面事实，需要财务权限。'},
  {id:'documents.search',label:'业务单据',description:'按单号、串号或具体关键词检索可见销售、采购、供应商、库存和收支记录。'},
  {id:'platform.catalog',label:'平台数据目录',description:'列出平台的数据领域和当前已接入智能体的查询能力；目录不是业务记录。'},
]);
const supported = new Set(catalog.map(x=>x.id));
const pendingDomains=[
  ['payroll','工资、提成与绩效'],['procurement','采购、采购退货与供应商往来'],
  ['carrier-other','移动业务以外的号卡与国补'],['settlement','日结、交班与对账'],
  ['funds','收付款、账户与现金交接'],['work','工作日志、学习与知识'],
  ['communication','门店公告、通知与沟通'],['governance','系统治理与审计'],
  ['customer','顾客档案、回访与转化'],['catalog','商品主数据、品类与调价'],
  ['warehouse-operations','盘点与调拨'],['air-recharge','空充与充值']
];
function directory(){return [...catalog.map(x=>({...x,status:'queryable'})),...pendingDomains.map(([id,label])=>({id,label,status:'pending-authorized-reader'}))];}
function dateArg(value){
  const date=String(value||c.day());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>c.day())throw new c.HttpError(400,'查询日期不正确');
  return date;
}
const source=(label,href)=>({label,href});
function salesPerformance(store,user,date){
  const r=erp.report(store,user,date),s=r.summary;
  const percent=(part,whole,digits=1)=>whole>0?Number((100*part/whole).toFixed(digits)):null;
  return {date,asOf:c.now(),scope:c.capabilities(user).allSales?'当前门店全店':'当前账号本人',
    facts:{orderCount:s.orderCount,salesAmount:s.salesAmount,returnAmount:s.returnAmount,netSales:s.netSales,receivedAmount:s.receivedAmount,refundAmount:s.refundAmount,
      ...(s.salesAmount>0?{registeredReceiptVsSalesPercent:percent(s.receivedAmount,s.salesAmount)}:{}),
      ...(r.canViewProfit?{adjustedGrossProfit:s.adjustedGrossProfit,giftCost:s.giftCost,costAdjustmentProfit:s.costAdjustmentProfit,...(s.netSales>0?{grossMarginPercent:percent(s.adjustedGrossProfit,s.netSales)}:{})}:{})},
    categoryStats:r.categoryStats.map(x=>({category:x.category,quantity:x.quantity,salesAmount:x.salesAmount,
      ...(s.salesAmount>0?{salesSharePercent:percent(x.salesAmount,s.salesAmount),salesSharePercentRounded:percent(x.salesAmount,s.salesAmount,0)}:{}),
      ...(r.canViewProfit?{grossProfit:x.grossProfit}:{})})),
    definitions:{netSales:'销售额减退货金额',adjustedGrossProfit:'销售毛利已扣赠品成本及成本调整；未扣工资、房租等期间费用',receivedAmount:'已登记的销售收款，发生日可能与销售日不同，不能用差额认定未收款',registeredReceiptVsSalesPercent:'当日已登记销售收款÷当日销售额，仅作两个日报数的比值，不等于实际回款率'},
    sources:[source('ERP 每日销售报表','/app?tab=dashboard')]};
}
function salesItems(store,user,date){
  const caps=c.capabilities(user),visible=row=>caps.allSales||(row.salespersonId||row.operatorId)===user.id;
  const sales=(store.sales||[]).filter(row=>visible(row)&&c.day(row.createdAt)===date);
  const returns=(store.saleReturns||[]).filter(row=>visible(row)&&c.day(row.createdAt)===date);
  const products=new Map((store.products||[]).map(x=>[x.skuId,x]));
  const grouped=new Map();
  for(const [orders,field] of [[sales,'sold'],[returns,'returned']])for(const order of orders)for(const item of order.items||[]){
    const quantity=Number(item.quantity||0);
    if(!Number.isFinite(quantity)||quantity<=0)continue;
    const product=products.get(item.skuId),name=String(item.name||product?.name||'未命名商品').slice(0,60);
    const category=String(item.type||product?.type||'未分类').slice(0,40);
    const key=String(item.skuId||category+'|'+name);
    const row=grouped.get(key)||{name,category,sold:0,returned:0};
    row[field]=c.round(row[field]+quantity);grouped.set(key,row);
  }
  const items=[...grouped.values()].sort((a,b)=>b.sold-a.sold||a.name.localeCompare(b.name,'zh-CN'));
  return {date,asOf:c.now(),scope:caps.allSales?'当前门店全店':'当前账号本人',saleOrderCount:sales.length,returnOrderCount:returns.length,
    itemGroupCount:items.length,items:items.slice(0,50),truncated:items.length>50,
    note:'仅统计 ERP 中该营业日已登记且当前账号可见的销售和退货；没有登记不能证明现实中没有成交。',
    sources:[source('ERP 销售单','/app?tab=orders')]};
}
function carrierServices(store,user,date){
  const caps=c.capabilities(user);
  if(!caps.sell&&!caps.finance&&!caps.allSales)return {restricted:true,reason:'当前账号没有移动业务查看权限。'};
  const rows=carrier.list(store,user).filter(row=>row.serviceDate===date);
  const bundles=require('./mobile-card-bundles').list(store,user).rows.filter(row=>row.serviceDate===date);
  const parts=rows.flatMap(row=>row.schedule||[]);
  const sum=(list,key)=>c.round(list.reduce((total,row)=>total+Number(row[key]||0),0));
  const confirmed=parts.filter(x=>x.confirmed!=null);
  return {date,asOf:c.now(),scope:caps.finance||caps.allSales?'当前门店全店':'当前账号本人',serviceCount:rows.length+bundles.length,ordinaryServiceCount:rows.length,newCardBundleCount:bundles.length,
    newCardCustomerIncome:c.round(bundles.filter(row=>row.incomeCounted).reduce((sum,row)=>sum+Number(row.customerPay||0),0)),
    bundles:bundles.slice(0,30).map(row=>({id:row.id,tier:row.tier,openedMask:row.openedMask,customerPay:row.customerPay,receiptAccount:row.receiptAccount,receiptHolder:row.receiptHolder,receiptReference:row.receiptReference,incomeStatus:row.incomeStatus,redPacketId:row.redPacketId,redPacketStatus:row.redPacketStatus,requestedRedPacket:row.requestedRedPacket,employeeCompensation:row.employeeCompensation,employeeCommissionAmount:row.employeeCommissionAmount})),
    withoutCommissionPlan:rows.filter(row=>!(row.schedule||[]).length).length,plannedServiceCount:rows.filter(row=>(row.schedule||[]).length).length,
    ...(parts.length?{expectedAmount:sum(parts,'expected'),receivedAmount:sum(parts,'received')}:{amountStatus:'该办理日的业务未配置酬金计划，金额暂无法核实'}),
    ...(confirmed.length?{confirmedAmount:sum(confirmed,'confirmed')}:{}),
    services:rows.slice(0,30).map(row=>({id:row.id,displayNo:row.originalDocument?.displayNo||row.displayNo||row.id,businessName:row.originalDocument?.businessName||row.typeName||'移动业务',typeName:row.typeName||row.type||'移动业务',subTypeName:row.originalDocument?.carrier?.subTypeName||row.subTypeName||'',serviceDate:row.serviceDate,employeeName:row.employeeName||'',customerMask:row.customerMask||'',externalOrderNo:row.externalOrderNo||'',reference:row.reference||'',note:row.note||'',sourceHref:'/carrier?service='+encodeURIComponent(row.id),commissionProductName:row.commissionProductSnapshot?.name||'',expectedCommissionTotal:row.commissionProductSnapshot?.expectedTotal??((row.schedule||[]).length?c.round(row.schedule.reduce((n,p)=>n+Number(p.expected||0),0)):null),commissionSchedule:(row.schedule||[]).map(p=>({month:p.month,expected:p.expected,confirmed:p.confirmed,received:p.received})),commissionSource:row.commissionProductSnapshot?{name:row.commissionProductSnapshot.sourceName,range:row.commissionProductSnapshot.sourceRange,revision:row.commissionProductSnapshot.policyRevision}:null,commissionPlanStatus:(row.schedule||[]).length?'已登记计划':row.commissionProductSnapshot?'基础酬金已知，返期待核实':'未配置计划'})),
    truncated:rows.length>30||bundles.length>30,note:'普通移动业务酬金与新办卡顾客实收分开统计。已登记收款、持有人核实到账、红包申请、老板微信实际付款分别是不同状态；系统记录不能证明外部平台最终结算。',
    sources:[source('移动业务与酬金台账','/carrier'),source('新办卡组合办理单','/mobile-card-bundles')]};
}
function staffSales(store,user,date){
  const caps=c.capabilities(user),r=erp.report(store,user,date);
  const profit=new Map();
  if(caps.profit){
    const owner=row=>row.salespersonId||row.operatorId;
    const visible=row=>caps.allSales||owner(row)===user.id;
    const add=(id,amount)=>{if(id)profit.set(id,c.round((profit.get(id)||0)+amount));};
    for(const row of store.sales||[])if(visible(row)){
      if(c.day(row.createdAt)===date)add(owner(row),Number(row.profit||0));
      for(const gift of row.giftOrders||[])if(c.day(gift.createdAt)===date)add(owner(row),-Number(gift.cost||0));
    }
    for(const row of store.saleReturns||[])if(visible(row)&&c.day(row.createdAt)===date){
      const cost=Array.isArray(row.items)?row.items.reduce((n,item)=>n+Number(item.cost||0),0):Number(row.cost||0);
      add(owner(row),-(Number(row.amount??row.originalAmount??0)-cost));
    }
    const orders=new Map((store.sales||[]).filter(visible).map(row=>[row.id,row]));
    for(const row of store.costAdjustments||[])if(row.orderId&&orders.has(row.orderId)&&c.day(row.createdAt)===date)
      add(owner(orders.get(row.orderId)),-Number(row.costDelta||0));
  }
  const people=r.staffStats.filter(x=>x.orderCount||x.salesAmount||profit.has(x.id)).map(x=>({id:x.id,name:x.name,orderCount:x.orderCount,netSales:x.salesAmount,
    ...(caps.profit?{adjustedGrossProfit:c.round(profit.get(x.id)||0)}:{})}));
  const unattributedOrders=Math.max(0,r.summary.orderCount-people.reduce((n,x)=>n+x.orderCount,0));
  return {date,asOf:c.now(),scope:caps.allSales?'当前门店全店':'当前账号本人',people,
    ...(unattributedOrders?{unattributedOrders,note:'有销售单未归属可见营业员，逐人合计不能代表全店总额。'}:{}),
    profitStatus:caps.profit?'按销售单责任营业员归因；销售、退货、赠品和成本调整按各自发生日计入。属于销售毛利，未扣工资、房租等费用。':'当前账号无毛利查看权限。',
    sources:[source('ERP 每日销售报表','/app?tab=dashboard')]};
}
function query(store,user,args={}){
  const domain=String(args.domain||'');
  if(domain==='reception.list')require('./reception-availability').assertEnabled();
  if(!supported.has(domain))throw new c.HttpError(400,'不支持的数据领域');
  const date=dateArg(args.date);
  const keyword=String(args.keyword||'').trim().slice(0,80);
  let result;
  if(domain==='platform.catalog')result={domains:directory(),note:'仅列出可用查询能力；未列出原始记录和私人数据。'};
  else if(domain==='finance.mine'){const text=String(args.question||keyword),allHistory=args.scope==='all'||/全部累计|全部历史|历史累计|累计|总共/.test(text),match=text.match(/\b(?:HB|BY|SR|SO|SK|FY)-[a-z0-9-]+/i),category=/红包/.test(text)?'redPackets':/交接|转款/.test(text)?'transfers':'all';result={...require('./my-finance').report(store,user,new URLSearchParams({scope:allHistory?'all':'day',from:allHistory?'1970-01-01':date,to:date,category,q:match?.[0]||''})),sources:[source('我的财务 · 本人原单与红包','/my-finance')]};}
  else if(domain==='finance.store-wallet'){const live=c.userById(store,user.id);if(live.roleCode!==user.roleCode||live.status!=='active'||live.assistantCustomerOnly)throw new c.HttpError(403,'请使用本人有效账号');c.permit(live,'sell');const w=require('./wallet-daily').summary(store,date);result={date,asOf:c.now(),accountName:'门店微信（备用金）',expectedBalance:w.expectedBalance??null,todayIn:w.todayIn??null,todayOut:w.todayOut??null,basisStatus:w.basisStatus||'missing',reason:w.reason||'',baselineAt:w.baselineAt||null,meaning:'已确认基准加已登记收支的账面余额，未直连微信；真实扎账仍按实数核对。',sources:[source('门店微信与当日扎账','/simple-daily-close')]};}
  else if(domain==='finance.business-change')result=require('./business-change-flow').query(store,user,args);
  else if(domain==='inventory.recommend')result=require('./assistant-phone-recommend').query(store,user,args);
  else if(domain==='sales.performance')result=salesPerformance(store,user,date);
  else if(domain==='sales.staff')result=staffSales(store,user,date);
  else if(domain==='sales.items')result=salesItems(store,user,date);
  else if(domain==='sales.cash-pending'){
    c.permit(user,'learn');
    const live=c.userById(store,user.id);
    if(live.status!=='active'||live.roleCode!==user.roleCode)throw new c.HttpError(403,'请使用本人有效账号');
    const rows=require('./assistant-cash-reminders').list(store,live);
    result={asOf:c.now(),scope:live.roleCode==='owner'?'本店待交销售现金':'本人经办的待交销售现金',count:rows.length,rows:rows.map(({orderId,partId,receiptNos,amount,handler,status,receivedAt,href})=>({orderId,partId,receiptNos,amount,handler,status,receivedAt,href,nextStep:'核对实际现金去向，按收款单登记交入门店现金或差异'})),note:'SK 是收款单展示号，SO 是关联销售单原编号，不能互换。“已收顾客现金”是开单人登记事实；尚未确认交入门店现金。查看提醒不改变现金、账务或状态。',sources:[source('销售收款核对','/sale-payments')]};
  }
  else if(domain==='carrier.services')result=carrierServices(store,user,date);
  else if(domain==='staff.directory'){
    const data=personnel.list(store,user);
    result=data.staffing?{asOf:c.now(),names:data.roster.map(x=>x.name).filter(Boolean),sources:[source('在职员工档案','/personnel')]}:
      {restricted:true,reason:'当前账号没有查看全店在职员工名单的权限。'};
  }else if(domain==='staff.attendance'){
    const reply=business.attendance(store,user,{question:String(args.question||'签到').slice(0,1000)},
      {date,personName:String(args.personName||'').slice(0,60),scope:args.scope==='all'?'all':args.scope==='self'?'self':undefined});
    result={asOf:reply.asOf,answer:reply.answer,...(reply.facts?{facts:reply.facts}:{}),restricted:reply.metrics?.restricted===true,sources:reply.sources};
  }else if(domain==='inventory.warehouses'){
    c.permit(user,'learn');
    const warehouses=require('./warehouse-directory').list(store);
    result={asOf:c.now(),count:warehouses.length,warehouses:warehouses.map(({id,code,name,scope})=>({id,code,name,scope})),
      note:'这是库存模块配置的仓库基础资料；是否有库存须另查库存记录。',sources:[source('库存仓库基础资料','/app?tab=inventory')]};
  }else if(domain==='reception.list'){
    const all=receptions.list(store,user).rows.filter(x=>c.day(x.createdAt)===date),rows=all.slice(0,50);
    result={date,count:all.length,truncated:all.length>50,rows:rows.map(x=>({id:x.id,status:x.status,ownerName:x.ownerName,purpose:x.purpose,createdAt:x.createdAt,customerMask:x.customerMask})),sources:[source('顾客接待记录','/receptions')]};
  }else if(domain==='finance.accounts'){
    if(!c.capabilities(user).finance)result={restricted:true,reason:'当前账号没有资金查询权限。'};
    else if(/门店微信|信号机微信|备用金/.test(keyword+' '+String(args.question||''))){const w=require('./wallet-daily').summary(store,date);result={date,asOf:c.now(),wallet:w,answer:w.expectedBalance==null?(w.reason||'门店微信账面基准待建立'):'门店微信（备用金）账面余额 '+w.expectedBalance.toFixed(2)+' 元；当日增加 '+w.todayIn.toFixed(2)+' 元，减少 '+w.todayOut.toFixed(2)+' 元。余额由已确认基准和已登记流水计算，未直连微信。',sources:[source('门店微信与当日扎账','/simple-daily-close')]};}
    else {const reply=business.read(store,user,{mode:'store',question:(keyword||'资金账户')+' '+date+' 余额'});
      result=reply?{asOf:reply.asOf,answer:reply.answer,sources:reply.sources}:{unsupported:true,reason:'该账户暂未接入只读查询，请使用资金账户页面。'};}
  }else {
    if(keyword.length<2)result={needsKeyword:true,reason:'请提供商品名称、型号、单号或串号。'};
    else {const params=new URLSearchParams({q:keyword,scope:domain==='inventory.search'?'inventory':'all'});
      if(domain==='documents.search'&&args.date){params.set('from',date);params.set('to',date);}
      const found=search.search(store,user,params);
      const applications=domain==='documents.search'?require('./wallet-funding-read').search(store,user,keyword,args.date?date:null):[];
      result={query:found.query,counts:{...found.counts,...(domain==='documents.search'?{storeWalletFundingRequests:applications.length}:{})},topHits:found.topHits.slice(0,8),results:{...Object.fromEntries(Object.entries(found.results).map(([kind,rows])=>[kind,rows.slice(0,5)])),...(domain==='documents.search'?{storeWalletFundingRequests:applications.slice(0,5)}:{})},sources:[source('综合查询','/search?q='+encodeURIComponent(keyword))]};}
  }
  return {domain,result};
}
module.exports={catalog:directory,query};

