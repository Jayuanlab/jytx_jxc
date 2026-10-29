const c=require('./common'),delegation=require('./review-delegation'),ownership=require('./task-ownership'),personnel=require('./personnel');
function summary(store,user){
 const owner=user.roleCode==='owner';
 const now=Date.now();
 const ownReceipts=[]; // Suspended: no active reception tasks; original records stay in store.
 const openPlans=(store.procurementPlans||[]).filter(x=>x.status==='open');
 const cashPending=(store.cashHandovers||[]).filter(x=>x.status==='待接收人确认');
 const assignment=owner?ownership.collect(store,user):null;
 const redPacketTodos=require('./order-red-packet-todos');
 const reviews=owner?{
  receiptReconciliation:require('./receipt-reconciliation').pending(store).length,
  orderRedPacketReview:redPacketTodos.rows(store,'orderRedPacketReview').length,
  orderRedPacketPayment:redPacketTodos.rows(store,'orderRedPacketPayment').length,
  personnelLeaves:(store.leaveRequests||[]).filter(x=>['待终审','转老板终审','待老板终审'].includes(x.status)).length,
  assistantFeedback:0, // 问答纠错暂缓，原记录保留在知识审核页。
  openingImportDrafts:(store.openingImportDrafts||[]).filter(x=>x.status==='待确认').length,
  airOpeningDrafts:(store.airOpeningDrafts||[]).filter(x=>x.status==='待确认').length,
  assistantReports:(store.assistantReports||[]).filter(x=>x.status==='待老板核实').length,
  reception:0,
  assist:0,
  wechat:0,
  conversion:0,
  learning:(store.learningRecords||[]).filter(x=>x.status==='待审核').length,
  workJournal:(store.workJournals||[]).filter(x=>x.status==='待核定').length,
  closeout:(store.closeouts||[]).filter(x=>x.status==='待核对').length,
  closeoutRevision:0,
  dailyClose:(store.dailyCloseouts||[]).filter(x=>x.status==='待老板签认').length,
  simpleDailyClose:(store.dailyCloseouts||[]).filter(require('./simple-daily-close').needsOwnerReview).length,
  dailyReview:(store.dailyCloseouts||[]).filter(x=>['待领取复核','复核中','已驳回'].includes(x.status)&&(x.status==='已驳回'?x.cashierId:x.reviewerId)===user.id).length,
  cashHandover:assignment.ownerCashHandover,
  fundTransfer:assignment.ownerFundTransfer,
  fundTransferDispute:(store.fundTransfers||[]).filter(x=>x.status==="到账有异议").length,
  cashDispute:(store.cashHandovers||[]).filter(x=>x.status==='金额有异议'&&x.senderId===user.id).length,
  procurement:0,
  procurementPaymentReview:openPlans.filter(x=>["pending","deferred"].includes(x.paymentReview?.status)).length,
  saleReturn:(store.saleReturnRequests||[]).filter(x=>x.status==='待老板审核').length,
  purchaseReturn:(store.purchaseReturnRequests||[]).filter(x=>x.status==='待老板审核').length,
  catalogAddition:(store.catalogAdditionReviews||[]).filter(x=>['待老板核对','需完善'].includes(x.status)).length,
  expenseRed:(store.redReversals||[]).filter(x=>x.status==="待老板审核").length,
  productPrice:(store.productPriceChanges||[]).filter(x=>x.status==="待老板审核").length,
  salePayments:0,
  salePaymentAssignments:0,
  salePaymentDisputes:0,
  serialStocktake:(store.stocktakes||[]).filter(x=>['serial','blind'].includes(x.kind)&&x.status==='差异待核实').length,
  giftApprovals:(store.giftApprovals||[]).filter(x=>x.status==='待审批').length
 }:{};
 const followups=ownReceipts.filter(x=>x.status==='待回访'&&x.followUpAt&&Date.parse(x.followUpAt)<=now).length;
 const open=ownReceipts.filter(x=>x.status!=='已结案').length;
 const cashToConfirm=cashPending.filter(x=>x.recipientId===user.id).length;
 const cashToResubmit=(store.cashHandovers||[]).filter(x=>x.senderId===user.id&&x.status==='金额有异议').length;
 const transferToConfirm=(store.fundTransfers||[]).filter(x=>x.toId===user.id&&x.status==="待收款人确认").length;
 const salePaymentsToConfirm=require('./sale-payments').list(store,user).filter(r=>r.mineToReview).length;
 const ownPaymentDisputes=0; // 退回核实已计入经办营业员的销售款待处理，避免重复。
 const assignedPlans=openPlans.filter(x=>x.receiverId===user.id).length;
 const giftApprovalsToReview=c.capabilities(user).giftApprove?(store.giftApprovals||[]).filter(x=>x.status==='待审批').length:0;
 const simpleToCheck=(store.dailyCloseouts||[]).filter(x=>require('./simple-daily-close').canCheck(store,user,x)).length;
 const unreviewedWork=(store.workJournals||[]).filter(x=>x.employeeId===user.id&&x.status==='待核定').length;
 const unreviewedLearning=(store.learningRecords||[]).filter(x=>x.employeeId===user.id&&x.status==='待审核').length;
 const leaveToReview=owner||user.assistantCustomerOnly||['customer-assistant','personal-assistant'].includes(user.roleCode)||String(user.id||'').startsWith('demo-')?0:personnel.list(store,user).pendingCount;
 const feedbackToReview=0; // 暂缓纠错，不催员工处理。
 const learningToReview=owner?0:(store.learningRecords||[]).filter(r=>r.status==='待审核'&&delegation.allowed(store,user,'learning',r)).length;
 const redToReview=0; // 红冲审核不转交，必须老板本人批准。
 return {capabilities:c.capabilities(user),leaveToReview,feedbackToReview,learningToReview,redToReview,simpleToCheck,asOf:c.now(),role:user.roleCode,name:user.name,owner,reviews,waitingOnOthers:assignment?.waitingOnOthers||[],waitingOnOthersCount:assignment?.waitingOnOthersCount||0,pendingCount:owner?Object.values(reviews).reduce((n,x)=>n+x,0):leaveToReview+feedbackToReview+learningToReview+redToReview+simpleToCheck+followups+cashToConfirm+cashToResubmit+transferToConfirm+salePaymentsToConfirm+ownPaymentDisputes+assignedPlans+unreviewedLearning+unreviewedWork+giftApprovalsToReview,unreviewedWork,followups,openReceptions:open,unreviewedLearning,cashToConfirm,cashToResubmit,transferToConfirm,salePaymentsToConfirm,ownPaymentDisputes,assignedPlans,giftApprovalsToReview};
}
module.exports={summary};





module.exports.summary=require("./batch-dispatch").workbench(module.exports.summary);

const previousNormalSummary=module.exports.summary;module.exports.summary=(store,user)=>require('./normal-workflow').workbench(store,user,previousNormalSummary(store,user));

const priorReceiptCorrectionSummary=module.exports.summary;module.exports.summary=(s,u)=>{const result=priorReceiptCorrectionSummary(s,u),rows=require('./receipt-revisions').returned(s);result.receiptCorrectionsToRevise=rows.filter(r=>r.reconciliation.returnedToId===u.id).length;if(!result.owner)result.pendingCount+=result.receiptCorrectionsToRevise;else for(const r of rows){const rec=r.reconciliation;let g=(result.waitingOnOthers||[]).find(g=>g.personId===rec.returnedToId);if(!g){g={personId:rec.returnedToId,person:rec.returnedToName,count:0,rows:[]};(result.waitingOnOthers||=[]).push(g);}g.count++;g.rows.push({kind:'receiptCorrection',label:'收款单退回更正',documentId:r.id,documentNo:r.displayNo||r.id,status:rec.status,submittedAt:r.submittedAt||r.createdAt||null,businessDate:r.date||null,href:'/app?tab=receipts&sourceId='+encodeURIComponent(r.id)});result.waitingOnOthersCount=(result.waitingOnOthersCount||0)+1;}return result;};
const previousResponsibilitySummary=module.exports.summary;module.exports.summary=(store,user)=>require('./sale-fund-responsibility').decorateSummary(store,user,previousResponsibilitySummary(store,user));

const beforeWalletFunding=module.exports.summary;module.exports.summary=(s,u)=>{const result=beforeWalletFunding(s,u);return require('./wallet-funding-read').decorateWorkbench(s,u,result);};

const beforeBusinessChange=module.exports.summary;module.exports.summary=(s,u)=>require('./business-change-flow').decorateSummary(s,u,beforeBusinessChange(s,u));

const beforeSupplierOutbound=module.exports.summary;module.exports.summary=(s,u)=>{const result=beforeSupplierOutbound(s,u),rows=s.supplierOutboundTransfers||[];if(u.roleCode==='owner'){const review=rows.filter(x=>x.status==='待老板批准').length,open=rows.filter(x=>x.status==='已交货待结').length;(result.reviews||={}).supplierOutboundReview=review;result.reviews.supplierOutboundOpen=open;result.pendingCount=(result.pendingCount||0)+review+open;}else if(['employee','manager','warehouse'].includes(u.roleCode)){const own=rows.filter(x=>x.applicantId===u.id&&x.status==='已批准待交货').length;result.supplierOutboundReady=own;result.pendingCount=(result.pendingCount||0)+own;}return result;};

const beforeSimpleReportSummary=module.exports.summary;module.exports.summary=(store,user)=>{const result=beforeSimpleReportSummary(store,user);if(user.roleCode==='owner'){const rows=(store.dailyCloseouts||[]).filter(row=>row.simpleDailyClose===true&&row.date===c.day());result.reports={...(result.reports||{}),simpleDailyClose:{count:rows.filter(row=>row.ownerReportRead?.seenBy!==user.id||row.ownerReportRead?.version!==require('./simple-daily-close').reportVersion(row)).length,totalCount:rows.length,awaitingLocalCheck:rows.filter(row=>!row.checkedAt&&!row.reviewedAt).length,href:'/simple-daily-close?view=reports'}};}return result;};

const beforeAssistantCashReminder=module.exports.summary;module.exports.summary=(store,user)=>{const result=beforeAssistantCashReminder(store,user);result.assistantCashReminders=user.roleCode==='owner'?[]:require('./assistant-cash-reminders').list(store,user);return result;};

const beforeSupplierExchange=module.exports.summary;module.exports.summary=(s,u)=>{const result=beforeSupplierExchange(s,u),ex=require('./supplier-exchanges'),all=s.supplierExchanges||[],active=all.filter(r=>!['已驳回','已撤销'].includes(r.status));
 if(u.roleCode==='owner'){const review=active.filter(r=>r.status==='待老板批准'),open=active.filter(r=>(r.handedAt||r.status==='已批准待交货'&&r.applicantId===u.id)&&!ex.balance(s,r).closed);result.reviews.supplierExchangeReview=review.length;result.reviews.supplierExchangeOpen=open.length;result.pendingCount+=review.length+open.length;
  for(const r of active.filter(r=>r.status!=='待老板批准'&&!ex.balance(s,r).goodsComplete&&r.applicantId!==u.id)){let g=result.waitingOnOthers.find(g=>g.personId===r.applicantId);if(!g){g={personId:r.applicantId,person:r.applicantName,count:0,rows:[]};result.waitingOnOthers.push(g);}g.count++;result.waitingOnOthersCount++;g.rows.push({kind:'supplierExchange',label:'供货商换货待办理',documentId:r.id,documentNo:r.displayNo||r.id,status:ex.balance(s,r).status,submittedAt:r.createdAt,handler:r.applicantName,href:'/supplier-exchanges?id='+encodeURIComponent(r.id),pendingPreview:{object:r.supplierName,purpose:'供货商换货',description:r.agreement,amount:ex.balance(s,r).incomingCents/100}});}
 }else{result.supplierExchangeReady=active.filter(r=>r.applicantId===u.id&&r.status!=='待老板批准'&&!ex.balance(s,r).goodsComplete).length;result.pendingCount+=result.supplierExchangeReady;}return result;};
