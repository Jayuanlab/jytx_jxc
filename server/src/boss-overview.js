'use strict';
const c=require('./common'),workbench=require('./workbench'),batch=require('./boss-batch');
const owner=r=>r.employeeId||r.ownerId||r.salespersonId||r.operatorId;
const today=(value,date)=>{try{return !!value&&c.day(value)===date}catch{return false}};
const sum=rows=>c.round(rows.reduce((n,r)=>n+Number(r.amount||0),0));
const reward=rows=>c.round(rows.reduce((n,r)=>n+(r.schedule||[]).reduce((x,p)=>x+Number(p.expected||0),0),0));
const confirmed=rows=>c.round(rows.reduce((n,r)=>n+(r.schedule||[]).reduce((x,p)=>x+Number(p.confirmed||0),0),0));
const valid=r=>r.duplicateOf||r.validity==='无效'?0:Math.max(0,Number(r.effectiveVisitorCount??r.visitorCount??1)||0);
const redPacketTodos=require('./order-red-packet-todos');
const NEXT={walletFundingPay:'登记本人已实际转出的款项',walletFundingConfirm:'本人核实门店微信实际到账',walletFundingException:'核实原付款与到账情况，禁止重复转款',orderRedPacketReview:'同意发放这一笔红包',orderRedPacketPayment:'确认发放这一笔红包',personnelLeaves:'终审这一张请休假申请',fundTransferDispute:'核对转款到账异议',cashDispute:'核对现金交接异议',salePaymentDisputes:'核对销售款异议',procurementPaymentReview:'决定本单付款额度',openingImportDrafts:'确认期初商品资料',airOpeningDrafts:'核对空充期初余额',expenseRed:'审核红冲原单',saleReturn:'审核退货原单',purchaseReturn:'审核采购退货',serialStocktake:'核实盘点差异',simpleDailyClose:'核对提交人、核对人、实数和差额后审核',dailyClose:'签认每日扎账',dailyReview:'核对每日扎账',salePaymentAssignments:'指定实际收款人',salePayments:'确认本人账户实际到账',assist:'核准这一笔协助',wechat:'核准这一笔加微信积分',learning:'审核学习记录',closeoutRevision:'核对退回的交班单',fundTransfer:'确认本人账户到账',cashHandover:'确认收到现金',giftApprovals:'审核赠品申请',assistantFeedback:'核对这一条助理纠错',assistantReports:'核实员工情况',reception:'核准这一张接待单结案',workJournal:'核定工作日志',conversion:'判断成交归属',procurement:'查看订货收货',productPrice:'批准或驳回本次调价',catalogAddition:'核对新增档案',closeout:'核对临时现金清点'};
const TASKS=[
 ['businessChange','业务变更退换申请待批准','/business-change-returns',0],
 ['businessChangePayment','业务变更待实际退款','/business-change-returns',0],
 ['businessChangeReceive','业务变更和包待核实到账','/business-change-returns',1],
 ['businessChangeAdvance','业务变更老板垫付待结算','/business-change-returns',1],
 ['businessChangeWithholding','业务变更和包代扣税待核实','/business-change-returns',1],
 ['walletFundingPay','门店微信待充值','/store-wallet-funding',0],['walletFundingConfirm','门店微信待本人确认到账','/store-wallet-funding',1],['walletFundingException','门店微信到账有异议','/store-wallet-funding',0],
 ['businessReconciliation','正常单据待老板对账','/business-reconciliation',0],
 ['inventoryLossCases','持续库存差异','/business-reconciliation?section=losses',0],
 ['holderPaymentRequests','待我实际办理支付','/business-reconciliation?section=payments',0],
 ['receiptReconciliation','收款单待对账','/app?tab=receipts',0],
 ['orderRedPacketReview','红包待发放','/order-red-packets?status='+encodeURIComponent('待老板核定'),0],
 ['orderRedPacketPayment','已核定红包待发放','/order-red-packets?status='+encodeURIComponent('已核定待支付'),0],
 ['personnelLeaves','请休假待老板终审','/personnel',1],
 ['fundTransferDispute','店内转款有异议','/funds',0],['cashDispute','现金交接有异议','/cash-handover',0],['salePaymentDisputes','销售收款有异议','/sale-payments',0],['procurementPaymentReview','订货待批额度（未出款）','/app?tab=purchase',0],['openingImportDrafts','商品期初待确认','/opening-drafts',0],['airOpeningDrafts','空充期初待确认','/air-recharge',0],['expenseRed','单据红冲待批准','/app?tab=red',0],
 ['saleReturn','退换货待批准','/app?tab=returns#sale-return-requests',1],['purchaseReturn','采购退货待批准','/app?tab=purchase#purchase-return-requests',1],['serialStocktake','盘点差异待核实','/stocktake',1],['simpleDailyClose','简易扎账单待核对与审核','/simple-daily-close#review',0],['dailyClose','每日扎账待签认','/daily-close',1],['dailyReview','日结待复核','/daily-close',1],['salePaymentAssignments','销售款待指定收款人','/sale-payments',0],['salePayments','销售款待我核对','/sale-payments',1],
 ['assist','协助单待确认','/receptions',2],['wechat','加微信待核分','/receptions',2],['learning','学习单待审核','/learning',2],['closeoutRevision','临时扎账退回待补正','/close',2],['fundTransfer','店内转款待收款人确认','/funds',1],['cashHandover','现金交接待接收人确认','/cash-handover',1],['giftApprovals','超限赠品待审批','/gift-approvals',1],['assistantFeedback','工作助理未解答与纠错','/knowledge-review#answer-feedback',2],['assistantReports','员工情况待核实','/assistant?mode=store#report-panel',2],['reception','接待单待结案','/receptions',2],['workJournal','工作日志待核定','/boss-batch',2],['conversion','成交归属待判断','/receptions',2],['procurement','进行中订货','/app?tab=purchase',2],['productPrice','商品调价待审核','/app?tab=products',2],['catalogAddition','新增档案待核对','/boss-batch',2],['closeout','临时扎账待复核','/close',2]
];

function detailRows(store,key){
 if(['businessChange','businessChangePayment','businessChangeReceive','businessChangeAdvance','businessChangeWithholding'].includes(key))return require('./business-change-flow').ownerDetails(store,key);
 if(key.startsWith('walletFunding'))return require('./wallet-funding-read').todoRows(store,key);
 if(redPacketTodos.isKey(key))return redPacketTodos.details(store,key);
 const item=(id,label,sub,href)=>({id:String(id||''),label:String(label||'待核对单据'),sub:String(sub||''),href});
 const rec=(store.receptions||[]), plans=(store.procurementPlans||[]);
 switch(key){
  case 'businessChange':return (store.businessChangeRequests||[]).filter(x=>x.status==='待老板批准').sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(x=>{const href='/business-change-returns?id='+encodeURIComponent(x.id),method={cash:'门店现金','store-wechat':'门店微信','boss-wechat':'老板微信'}[x.refundMethod]||'付款方式待核实',tax=Number(x.taxAmount||0),net=Number(x.hebaoAmount||0)-Number(x.refundAmount||0)-tax;return {...item(x.id,'业务变更退换申请 · '+(x.customerPhone||x.mobileBusinessNo),(x.operatorName||'经办人')+' · 待老板批准 · '+method,href),actionHref:href,submittedAt:x.createdAt,businessDate:null,documentNo:x.displayNo||x.id,pendingPreview:{complete:!!(x.customerPhone||x.mobileBusinessNo),object:'顾客 '+(x.customerPhone||'手机号未填')+(x.mobileBusinessNo?' · 移动业务编号 '+x.mobileBusinessNo:''),purpose:x.businessText||'涉及业务未填写',amount:Number(x.refundAmount),descriptionLabel:'按申请金额核算',description:'退顾客 ¥'+Number(x.refundAmount).toFixed(2)+'（'+method+'） · 移动付和包 ¥'+Number(x.hebaoAmount).toFixed(2)+' · 扣税 ¥'+tax.toFixed(2)+' · 本单净增 ¥'+net.toFixed(2)},nextStep:'核对涉及业务、退款金额和方式，再决定批准或退回；批准不代表已付款或到账'};});
  case 'simpleDailyClose':return (store.dailyCloseouts||[]).filter(require('./simple-daily-close').needsOwnerReview).map(x=>{const number=(store.documentNumbers||[]).find(n=>n.sourceId===x.id)?.displayNo||x.displayNo||x.id,at=x.submittedAt?new Date(x.submittedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间待核';return item(x.id,number,'提交人 '+x.cashier+' · '+(x.checkedAt?'核对人 '+x.checker:'待核对')+' · '+at,'/simple-daily-close?reviewDate='+encodeURIComponent(x.date)+'&record='+encodeURIComponent(x.id)+'#review');});
  case 'receiptReconciliation':return require('./receipt-reconciliation').pending(store).map(x=>({...item(x.id,(x.displayNo||x.id)+' · '+x.counterparty,x.operator+' · 账面登记¥'+Number(x.amount).toFixed(2)+' · '+x.reconciliation.status+' · 事由：'+(x.note||'待补充'),'/app?tab=receipts&sourceId='+encodeURIComponent(x.id)),nextStep:'填写实际核对金额并记录对账结果，不重复记账'}));
  case 'personnelLeaves':return (store.leaveRequests||[]).filter(x=>['待终审','待老板终审','转老板终审'].includes(x.status)).map(x=>item(x.id,(x.displayNo||x.id)+' · '+x.applicantName+' · '+x.type,x.startAt+' 至 '+x.endAt,'/personnel?leave='+encodeURIComponent(x.id)));
  case 'procurementPaymentReview':return plans.filter(x=>x.status==='open'&&['pending','deferred'].includes(x.paymentReview?.status)).map(x=>item(x.id,(x.items||[]).map(y=>y.name+' ×'+y.quantity).join('、')||x.supplier,x.supplier+' · '+x.operator+' · 订货¥'+(x.items||[]).reduce((n,y)=>n+Number(y.costPrice||0)*Number(y.quantity||0),0).toFixed(2)+' · '+(x.paymentReview.status==='pending'?'待批额度':'暂缓付款'),'/app?tab=purchase&q='+encodeURIComponent(x.id)+'&focusPlan='+encodeURIComponent(x.id)));
  case 'catalogAddition':return (store.catalogAdditionReviews||[]).filter(x=>['待老板核对','需完善'].includes(x.status)).map(x=>{const kind={supplier:'往来单位',product:'商品',paymentAccount:'支付账户',businessOption:'业务选项',fundParty:'往来单位/平台',category:'商品分类',warehouse:'仓库'}[x.kind]||'档案';return {...item(x.id,kind+' · '+x.name,(x.requester||'经办人')+' · '+x.status,'/master-data?review='+encodeURIComponent(x.id)),nextStep:'核对新增'+kind}});
  case 'assistantFeedback':return (store.assistantAnswerFeedback||[]).filter(x=>x.status==='待审核').map(x=>item(x.id,x.question||x.reason,x.submittedBy||'工作助理','/knowledge-review?feedback='+encodeURIComponent(x.id)+'#answer-feedback'));
  case 'assist':return rec.flatMap(x=>(x.assists||[]).filter(a=>a.status==='待确认').map(a=>item(a.id,(a.type||'协助')+' · '+(x.customerMask||x.id),a.fromName+' → '+a.toName+' · '+(a.detail||''),'/receptions?pendingAssist=1&highlight='+encodeURIComponent(x.id)+'&assist='+encodeURIComponent(a.id))));
  case 'wechat':return rec.filter(x=>x.wechat?.claimed&&!x.wechat.confirmed).map(x=>item(x.id,'加微信 · '+(x.customerMask||x.id),x.ownerName||'', '/receptions?pendingWechat=1&highlight='+encodeURIComponent(x.id))); 
  case 'productPrice':return (store.productPriceChanges||[]).filter(x=>x.status==='待老板审核').map(x=>item(x.id,x.productName,'原价 ¥'+Number(x.oldPrice||0).toFixed(2)+' → 新价 ¥'+Number(x.newPrice||0).toFixed(2)+' · '+x.requester,'/app?tab=products&focusPrice='+encodeURIComponent(x.id)));
  case 'reception':return rec.filter(x=>x.status==='待结案确认').map(x=>item(x.id,x.customerMask||x.id,(x.ownerName||'')+' · '+(x.needs||x.purpose||'接待单'),'/receptions?pendingCloseout=1&highlight='+encodeURIComponent(x.id)));
  case 'saleReturn':return (store.saleReturnRequests||[]).filter(x=>x.status==='待老板审核').map(x=>item(x.id,(x.displayNo||x.id)+' · '+(x.kind==='exchange'?'换货':'退货'),(x.requesterName||x.requester||'经办人')+' · ¥'+Number(x.amount||0).toFixed(2),'/app?tab=returns&focusSaleReturn='+encodeURIComponent(x.id)+'#sale-return-requests'));
  case 'purchaseReturn':return (store.purchaseReturnRequests||[]).filter(x=>x.status==='待老板审核').map(x=>item(x.id,(x.displayNo||x.id)+' · '+(x.productName||x.name||'采购退货'),(x.requesterName||x.requester||'经办人')+' · ¥'+Number(x.amount||0).toFixed(2),'/app?tab=purchase&focusPurchaseReturn='+encodeURIComponent(x.id)+'#purchase-return-requests'));
  case 'serialStocktake':return (store.stocktakes||[]).filter(x=>['serial','blind'].includes(x.kind)&&x.status==='差异待核实').map(x=>{const row=item(x.id,(x.displayNo||x.id)+' · '+(x.product||'盘点差异'),(x.operator||'经办人')+' · '+x.status,'/stocktake?review='+encodeURIComponent(x.id));return row;});
  case 'workJournal':return (store.workJournals||[]).filter(x=>x.status==='待核定').map(x=>item(x.id,(x.displayNo||x.id)+' · '+(x.title||x.content||'工作日志'),(x.employeeName||x.operator||'经办人')+' · '+x.status,'/boss-batch?journal='+encodeURIComponent(x.id)));
  case 'salePaymentAssignments':case 'salePayments':case 'salePaymentDisputes':{
   const boss=(store.users||[]).find(u=>u.roleCode==='owner'&&u.status==='active');
   const all=(store.sales||[]).flatMap(order=>(Array.isArray(order.paymentParts)?order.paymentParts:[{id:null,account:order.paymentMethod,amount:order.paymentReview?.amount,paymentReview:order.paymentReview}]).map(part=>({order,part,review:part.paymentReview||{}})));
   const pending=new Set(['待老板核对','待收款人确认','有异议']);
   const selected=all.filter(({order,part,review})=>{if(!pending.has(review.status))return false;const cash=part.account==='现金'||order.paymentMethod==='现金'&&!part.id;if(key==='salePaymentAssignments')return !cash&&review.accountOwnerUnspecified&&!!review.customerPaidDeclaredAt;if(key==='salePayments')return review.recipientId===boss?.id&&(cash||!!review.customerPaidDeclaredAt)&&!review.accountOwnerUnspecified;return review.status==='有异议'&&!!review.customerPaidDeclaredAt});
   const rows=key==='salePaymentDisputes'?[...new Map(selected.map(x=>[x.order.id,x])).values()]:selected;
   return rows.map(({order,part,review})=>{
    const partId=part.id?String(part.id):'';
    const focusId=partId?String(order.id)+'::'+partId:String(order.id);
    const href='/sale-payments?order='+encodeURIComponent(order.id)+(partId?'&part='+encodeURIComponent(partId):'');
    return item(focusId,order.id+' · '+(part.account||order.paymentMethod||'收款')+' · ¥'+Number(part.amount??review.amount??0).toFixed(2),(order.salesperson||order.operator||'经办人')+' · '+(key==='salePaymentAssignments'?'待老板指定实际收款账户':review.status),href);
   });
  }
  default:{
   const bossId=(store.users||[]).find(u=>u.roleCode==='owner'&&u.status==='active')?.id;
   const definitions={
    fundTransferDispute:['fundTransfers',x=>x.status==='到账有异议'],cashDispute:['cashHandovers',x=>x.status==='金额有异议'&&x.senderId===bossId],
    openingImportDrafts:['openingImportDrafts',x=>x.status==='待确认'],airOpeningDrafts:['airOpeningDrafts',x=>x.status==='待确认'],expenseRed:['redReversals',x=>x.status==='待老板审核'],
    saleReturn:['saleReturnRequests',x=>x.status==='待老板审核'],purchaseReturn:['purchaseReturnRequests',x=>x.status==='待老板审核'],serialStocktake:['stocktakes',x=>['serial','blind'].includes(x.kind)&&x.status==='差异待核实'],
    dailyClose:['dailyCloseouts',x=>x.status==='待老板签认'],dailyReview:['dailyCloseouts',x=>['待领取复核','复核中'].includes(x.status)&&x.reviewerId===bossId],closeoutRevision:['closeouts',x=>x.status==='待复核'&&x.cashierId===bossId],procurement:['procurementPlans',x=>x.status==='open'],learning:['learningRecords',x=>x.status==='待审核'],fundTransfer:['fundTransfers',x=>x.status==='待收款人确认'&&x.toId===bossId],
    cashHandover:['cashHandovers',x=>x.status==='待接收人确认'&&x.recipientId===bossId],giftApprovals:['giftApprovals',x=>x.status==='待审批'],assistantReports:['assistantReports',x=>x.status==='待老板核实'],
    workJournal:['workJournals',x=>x.status==='待核定'],conversion:['conversionClaims',x=>x.status==='待老板判断'],closeout:['closeouts',x=>x.status==='待核对']
   };
   const config=definitions[key];if(!config)return [];
   const route=TASKS.find(([name])=>name===key)?.[2]||'/m#pending';
   return (store[config[0]]||[]).filter(config[1]).map(x=>{
    const id=String(x.id||'');
    const details=[x.requester||x.operator||x.ownerName||x.employeeName||'',x.status||'待处理'];
    if(x.amount!=null&&Number.isFinite(Number(x.amount)))details.push('¥'+Number(x.amount).toFixed(2));
    const at=x.createdAt||x.submittedAt||x.updatedAt;
    if(at)details.push(String(at).replace('T',' ').slice(0,16));
    const exact={fundTransferDispute:'/funds?transfer=',fundTransfer:'/funds?transfer=',cashDispute:'/cash-handover?handover=',cashHandover:'/cash-handover?handover=',openingImportDrafts:'/opening-drafts?draft=',airOpeningDrafts:'/air-recharge?draft=',dailyClose:'/daily-close?closeout=',dailyReview:'/daily-close?closeout=',closeoutRevision:'/close?closeout=',closeout:'/close?closeout=',learning:'/learning?record=',giftApprovals:'/gift-approvals?request=',assistantReports:'/assistant?mode=store&report=',conversion:'/receptions?claim=',procurement:'/app?tab=purchase&focusPlan=',expenseRed:'/app?tab=red&focusRed='};
    const focusedHref=exact[key]?exact[key]+encodeURIComponent(id):'/boss-overview?task='+encodeURIComponent(key)+'&id='+encodeURIComponent(id);
    return {...item(id,x.name||x.productName||x.customerMask||x.question||x.title||id,details.filter(Boolean).join(' · '),focusedHref),actionHref:focusedHref};
   });
  }
 }
}


function attendanceSnapshot(store){
 const date=c.day(),asOf=c.now(),now=Date.parse(asOf);
 const staff=(store.users||[]).filter(u=>u&&u.status==='active'&&u.roleCode!=='owner'&&!String(u.id||'').startsWith('demo-')&&!u.assistantCustomerOnly&&!['customer-assistant','personal-assistant'].includes(u.roleCode));
 const owners=(store.users||[]).filter(u=>u&&u.roleCode==='owner'&&u.status==='active'&&(store.attendance||[]).some(a=>a.userId===u.id&&today(a.checkInAt,date)));
 const rows=[...staff,...owners].map(u=>{
  const shifts=(store.attendance||[]).filter(a=>a.userId===u.id&&today(a.checkInAt,date)).sort((a,b)=>Date.parse(b.checkInAt)-Date.parse(a.checkInAt));
  const open=shifts.find(a=>!a.checkOutAt);
  const outside=(store.attendanceFieldwork||[]).some(a=>a.userId===u.id&&!a.endAt);
  const leave=(store.leaveRequests||[]).find(a=>a.applicantId===u.id&&a.status==='已批准'&&Date.parse(a.startAt)<=now&&Date.parse(a.endAt)>now);
  const working=!!open&&!outside,fieldwork=!!open&&outside,present=shifts.length>0,onLeave=!!leave;
  const status=onLeave&&open?'打卡与假期重叠，待核对':fieldwork?'外勤中':working?'店内上班中':onLeave?'已批准'+leave.type:present?'今日已签退':'今日未见签到';
  return {id:u.id,name:u.name||'未命名员工',roleCode:u.roleCode,working,fieldwork,present,onLeave,status,activeSince:open?.checkInAt||null,leaveType:leave?.type||null,leaveStartAt:leave?.startAt||null,leaveEndAt:leave?.endAt||null,shifts:shifts.map(a=>({id:a.id,checkInAt:a.checkInAt,checkOutAt:a.checkOutAt||null}))};
 });
 const group=key=>rows.filter(row=>row[key]),names=items=>items.map(row=>row.name);
 const working=group('working'),fieldwork=group('fieldwork'),present=group('present'),leave=group('onLeave');
 return {date,asOf,scheduled:rows.length,presentCount:present.length,present:names(present),workingCount:working.length,working:names(working),fieldworkCount:fieldwork.length,fieldwork:names(fieldwork),leaveCount:leave.length,onLeave:leave.map(row=>({name:row.name,type:row.leaveType,until:row.leaveEndAt})),conflict:names(rows.filter(row=>row.onLeave&&(row.working||row.fieldwork))),details:{working,fieldwork,leave,present,all:rows}};
}

const DATE_SOURCES={receiptReconciliation:'otherIncome',personnelLeaves:'leaveRequests',procurementPaymentReview:'procurementPlans',catalogAddition:'catalogAdditionReviews',assistantFeedback:'assistantAnswerFeedback',assist:'receptions',wechat:'receptions',productPrice:'productPriceChanges',reception:'receptions',saleReturn:'saleReturnRequests',purchaseReturn:'purchaseReturnRequests',serialStocktake:'stocktakes',workJournal:'workJournals',salePaymentAssignments:'sales',salePayments:'sales',salePaymentDisputes:'sales',simpleDailyClose:'dailyCloseouts',fundTransferDispute:'fundTransfers',cashDispute:'cashHandovers',openingImportDrafts:'openingImportDrafts',airOpeningDrafts:'airOpeningDrafts',expenseRed:'redReversals',dailyClose:'dailyCloseouts',dailyReview:'dailyCloseouts',closeoutRevision:'closeouts',procurement:'procurementPlans',learning:'learningRecords',fundTransfer:'fundTransfers',cashHandover:'cashHandovers',giftApprovals:'giftApprovals',assistantReports:'assistantReports',conversion:'conversionClaims',closeout:'closeouts'};
function taskDates(store,key,id){const collection=DATE_SOURCES[key];if(!collection)return {};const base=String(id||'').split('::')[0],source=(store[collection]||[]).find(x=>String(x.id)===base);if(!source)return {};return {submittedAt:source.submittedAt||source.registeredAt||source.createdAt||source.requestedAt||null,businessDate:source.date||source.serviceDate||source.occurredAt||null};}

function summary(store,user){
 if(user.roleCode!=='owner')throw new c.HttpError(403,'老板看台仅老板可查看');
 const date=c.day(),state=workbench.summary(store,user),reviews=state.reviews||{},staffing=attendanceSnapshot(store);
 const moneyKeys={salePayments:['待老板核对','待收款人确认'],salePaymentDisputes:['有异议']};
 const taskAmount=key=>{if(redPacketTodos.isKey(key))return redPacketTodos.total(store,key);const states=moneyKeys[key];if(!states)return null;const parts=(store.sales||[]).flatMap(order=>Array.isArray(order.paymentParts)?order.paymentParts.map(part=>({order,part,review:part.paymentReview,account:part.account,amount:part.amount})):[{order,part:null,review:order.paymentReview,account:order.paymentMethod,amount:order.paymentReview?.amount}]);const rows=parts.filter(x=>states.includes(x.review?.status)&&x.review?.recipientId===user.id&&(x.account==='现金'||!!x.review.customerPaidDeclaredAt)&&!x.review.accountOwnerUnspecified);return rows.every(x=>x.amount!=null&&Number.isFinite(Number(x.amount)))?sum(rows):null};
 const category=key=>/businessChange|receiptReconciliation|orderRedPacket|fund|cash|Payment|expenseRed|dailyClose|dailyReview|simpleDailyClose|closeout/i.test(key)?'资金与扎账':/procurement|purchase|catalog|productPrice|serialStocktake/i.test(key)?'进货库存':/reception|assist|wechat|conversion|saleReturn|giftApprovals/i.test(key)?'客户与销售':'员工与系统';
 const numbers=new Map((store.documentNumbers||[]).map(row=>[row.sourceId,row.displayNo]));
 const tasks=TASKS.map(([key,label,href,priority])=>({key,label,href,priority,category:category(key),amount:taskAmount(key),count:Number(reviews[key]||0),items:detailRows(store,key).map(row=>({...taskDates(store,key,row.id),...row,documentNo:row.documentNo||numbers.get(row.id)||numbers.get(String(row.id||'').split('::')[0])||row.id,handler:'老板本人',nextStep:row.nextStep||NEXT[key]||'核对原单后处理'}))})).filter(x=>x.count>0).sort((a,b)=>a.priority-b.priority||(b.amount??-1)-(a.amount??-1)||b.count-a.count);
 const other=Object.entries(reviews).filter(([key,count])=>count>0&&!['supplierExchangeReview','supplierExchangeOpen','supplierOutboundReview','supplierOutboundOpen'].includes(key)&&!TASKS.some(([known])=>known===key));if(other.length)tasks.push({key:'other',label:'其他待办',href:'/m#pending',priority:3,category:'其他',amount:null,count:other.reduce((n,[,count])=>n+count,0)});
 const sales=(store.sales||[]).filter(r=>today(r.createdAt,date)),positive=sales.filter(r=>Number(r.amount)>0),returns=sales.filter(r=>Number(r.amount)<0);
 const receptions=(store.receptions||[]).filter(r=>today(r.createdAt,date)),mobile=(store.carrierServices||[]).filter(r=>today(r.serviceDate||r.createdAt,date)),journals=(store.workJournals||[]).filter(r=>today(r.occurredAt||r.createdAt,date));
 const people=(store.users||[]).filter(u=>u.status==='active'&&['employee','manager'].includes(u.roleCode)).map(u=>{const s=positive.filter(r=>owner(r)===u.id),r=receptions.filter(x=>owner(x)===u.id),m=mobile.filter(x=>owner(x)===u.id),j=journals.filter(x=>owner(x)===u.id),a=(store.attendance||[]).some(x=>x.userId===u.id&&today(x.checkInAt||x.createdAt,date));return {id:u.id,name:u.name||'未命名员工',role:u.roleCode,salesCount:s.length,salesAmount:sum(s),receptionCount:r.length,invalidReceptionCount:r.filter(x=>x.validity==='无效').length,validVisitors:r.reduce((n,x)=>n+valid(x),0),mobileCount:m.length,expectedReward:reward(m),workJournalCount:j.length,checkedIn:a}}).sort((a,b)=>b.salesAmount-a.salesAmount||b.mobileCount-a.mobileCount);
 return {date,asOf:c.now(),staffing,pendingCount:state.pendingCount,tasks,waitingOnOthers:state.waitingOnOthers,waitingOnOthersCount:state.waitingOnOthersCount,batchSuggestions:batch.list(store,user).groups.filter(g=>g.rows.length>1).map(g=>({label:g.label,count:g.rows.length,kind:g.kind,href:'/boss-batch'})),today:{saleCount:positive.length,netSalesAmount:sum(sales),returnCount:returns.length,receptionCount:receptions.length,invalidReceptionCount:receptions.filter(r=>r.validity==='无效').length,visitors:receptions.reduce((n,r)=>n+Math.max(1,Number(r.visitorCount)||1),0),validVisitors:receptions.reduce((n,r)=>n+valid(r),0),mobileCount:mobile.length,expectedReward:reward(mobile),confirmedReward:confirmed(mobile),missingRewardPlan:mobile.filter(r=>!Array.isArray(r.schedule)||!r.schedule.length).length,workJournalCount:journals.length},people,unassigned:{sales:positive.filter(r=>!owner(r)).length,receptions:receptions.filter(r=>!owner(r)).length,mobile:mobile.filter(r=>!owner(r)).length},notes:['销售金额为今日已登记单据净额，含负金额冲减，不等于实收现金或利润。','移动酬金区分单据预计额与移动公司已确认额，不含手机销售毛利。','未登记的工作或未打卡原因不能从台账推断。']};
}
module.exports={summary,attendanceSnapshot};


const originalBossSummary=module.exports.summary;module.exports.summary=function(store,user){const d=originalBossSummary(store,user);try{d.operations={summary:require("./erp").report(store,user,d.date).summary};}catch{d.operations={error:"经营汇总暂未读到，请到经营日报核对"};}try{const rows=require("./erp").inventory(store,user).filter(r=>r.stockManaged!==false),unknown=rows.filter(r=>!Number.isFinite(Number(r.quantity))).length;d.stock={quantity:unknown?null:rows.reduce((n,r)=>n+Number(r.quantity),0),products:rows.filter(r=>Number(r.quantity)>0).length,unknown};}catch{d.stock={quantity:null,products:null,error:"库存汇总暂未读到"};}return d;};

module.exports.summary=require("./batch-dispatch").overview(module.exports.summary);

const previousNormalOverview=module.exports.summary;module.exports.summary=(store,user)=>require('./normal-workflow').overview(store,user,previousNormalOverview(store,user));

const beforeSupplierOutboundOverview=module.exports.summary;module.exports.summary=(store,user)=>{const result=beforeSupplierOutboundOverview(store,user),rows=store.supplierOutboundTransfers||[],project=require('./supplier-outbound-tracking').project;for(const [key,label,selected,priority] of [['supplierOutboundReview','供货商调货待批准',rows.filter(x=>x.status==='待老板批准'),0],['supplierOutboundOpen','供货商调货未闭合',rows.filter(x=>x.status==='已交货待结'),-1]]){if(!selected.length)continue;result.tasks.unshift({key,label,href:'/supplier-outbound-tracking',priority,category:'进货库存',count:selected.length,items:selected.map(raw=>{const row=project(raw);return {id:row.id,label:row.supplierName+' → '+row.receivingStore,sub:key==='supplierOutboundOpen'?`未结 ${row.balance.balance.toFixed(2)} 元 · ${row.urgency}`:'申请待批准',href:row.href,actionHref:row.href,handler:'老板本人',submittedAt:row.deliveredAt||row.appliedAt,businessDate:row.deliveredAt||null,documentNo:row.id,pendingPreview:{complete:true,supplier:row.supplierName,receivingStore:row.receivingStore,items:row.lines.map(x=>`${x.productName} × ${x.quantity}`).join('、'),agreement:row.agreement,balance:row.balance.balance,dueAt:row.confirmedDueAt,lastFollowupAt:row.lastFollowupAt||null},nextStep:key==='supplierOutboundOpen'?'联系供货商；核实实收款或换回货，不以已读消除':'核对商品、去向和约定备注后决定是否批准'};} )});}return result;};

const previousResponsibilitySummary=module.exports.summary;module.exports.summary=(store,user)=>require('./sale-fund-responsibility').decorateSummary(store,user,previousResponsibilitySummary(store,user));

const beforeSupplierExchangeOverview=module.exports.summary;module.exports.summary=(s,u)=>{const result=beforeSupplierExchangeOverview(s,u),ex=require('./supplier-exchanges');for(const [key,label,filter] of [['supplierExchangeReview','供货商换货待批准',r=>r.status==='待老板批准'],['supplierExchangeOpen','供货商换货未完成',r=>(r.handedAt||r.status==='已批准待交货'&&r.applicantId===u.id)&&!ex.balance(s,r).closed]]){const selected=(s.supplierExchanges||[]).filter(filter);if(!selected.length)continue;result.tasks.unshift({key,label,href:'/supplier-exchanges',priority:1,category:'采购库存',count:selected.length,items:selected.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>({id:r.id,label:r.supplierName+' · 供货商换货',sub:r.applicantName+' · '+ex.balance(s,r).status,documentNo:r.displayNo||r.id,submittedAt:r.createdAt,businessDate:r.handedAt||null,href:'/supplier-exchanges?id='+encodeURIComponent(r.id),handler:'老板本人',pendingPreview:{complete:true,object:r.supplierName,purpose:'供货商换货',amount:ex.balance(s,r).incomingCents/100,description:'换出：'+r.outgoing.map(x=>x.productName+'×'+x.quantity).join('、')+'；换回：'+r.incoming.map(x=>x.productName+'×'+x.quantity+'（已收'+x.received+'）').join('、')+'；约定：'+r.agreement},nextStep:r.status==='待老板批准'?'核对换出、换回商品和约定差价后批准':'按真实交货、验收和差价核实继续办理'}))});}return result;};
