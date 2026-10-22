const c=require('./common'),delegation=require('./review-delegation'),duties=require('./staff-duties'),usedPhones=require('./used-phones'),journal=require('./work-journal');
function summary(store,user){
 const owner=user.roleCode==='owner';
 const now=Date.now();
 const ownReceipts=(store.receptions||[]).filter(x=>x.ownerId===user.id);
 const openPlans=(store.procurementPlans||[]).filter(x=>x.status==='open');
 const cashPending=(store.cashHandovers||[]).filter(x=>x.status==='待接收人确认');
 const reviews=owner?{
  assistantFeedback:(store.assistantAnswerFeedback||[]).filter(x=>x.status==='待审核').length,
  assistantReports:(store.assistantReports||[]).filter(x=>x.status==='待老板核实').length,
  reception:(store.receptions||[]).filter(x=>x.status==='待结案确认').length,
  assist:(store.receptions||[]).reduce((n,x)=>n+(x.assists||[]).filter(a=>a.status==='待确认').length,0),
  wechat:(store.receptions||[]).filter(x=>x.wechat?.claimed&&!x.wechat.confirmed).length,
  conversion:(store.conversionClaims||[]).filter(x=>x.status==='待老板判断').length,
  learning:(store.learningRecords||[]).filter(x=>x.status==='待审核').length,
  dutyReview:(store.dutyAssignments||[]).filter(x=>x.status==='待审核'&&duties.canReview(store,user,x)).length,
  usedPhoneReview:(store.usedPhoneAssessments||[]).filter(x=>x.status==='待复核'&&usedPhones.canReview(store,user,x)).length,
  workJournal:(store.workJournals||[]).filter(x=>x.status==='待核定').length,
  closeout:(store.closeouts||[]).filter(x=>x.status==='待核对').length,
  closeoutRevision:(store.closeouts||[]).filter(x=>x.status==='待复核').length,
  dailyClose:(store.dailyCloseouts||[]).filter(x=>x.status==='待老板签认').length,
  dailyReview:(store.dailyCloseouts||[]).filter(x=>['待领取复核','复核中','已驳回'].includes(x.status)).length,
  cashHandover:cashPending.length,
  fundTransfer:(store.fundTransfers||[]).filter(x=>x.status==="待收款人确认").length,
  fundTransferDispute:(store.fundTransfers||[]).filter(x=>x.status==="到账有异议").length,
  cashDispute:(store.cashHandovers||[]).filter(x=>x.status==='金额有异议').length,
  procurement:openPlans.filter(x=>!x.paymentReview||x.paymentReview.status==="approved").length,
  procurementPaymentReview:openPlans.filter(x=>["pending","deferred"].includes(x.paymentReview?.status)).length,
  saleReturn:(store.saleReturnRequests||[]).filter(x=>x.status==='待老板审核').length,
  purchaseReturn:(store.purchaseReturnRequests||[]).filter(x=>x.status==='待老板审核').length,
  catalogAddition:(store.catalogAdditionReviews||[]).filter(x=>['待老板核对','需完善'].includes(x.status)).length,
  expenseRed:(store.redReversals||[]).filter(x=>x.status==="待老板审核").length,
  productPrice:(store.productPriceChanges||[]).filter(x=>x.status==="待老板审核").length,
  salePayments:(store.sales||[]).filter(x=>['待老板核对','待收款人确认'].includes(x.paymentReview?.status)).length,
  salePaymentDisputes:(store.sales||[]).filter(x=>x.paymentReview?.status==='有异议').length,
  serialStocktake:(store.stocktakes||[]).filter(x=>['serial','blind'].includes(x.kind)&&x.status==='差异待核实').length,
  giftApprovals:(store.giftApprovals||[]).filter(x=>x.status==='待审批').length
 }:{};
 const followups=ownReceipts.filter(x=>x.status==='待回访'&&x.followUpAt&&Date.parse(x.followUpAt)<=now).length;
 const open=ownReceipts.filter(x=>x.status!=='已结案').length;
 const cashToConfirm=cashPending.filter(x=>x.recipientId===user.id).length;
 const transferToConfirm=(store.fundTransfers||[]).filter(x=>x.toId===user.id&&x.status==="待收款人确认").length;
 const salePaymentsToConfirm=(store.sales||[]).filter(x=>(x.paymentParts?x.paymentParts.some(p=>p.paymentReview?.recipientId===user.id&&['待老板核对','待收款人确认','有异议'].includes(p.paymentReview.status)):x.paymentReview?.recipientId===user.id&&['待老板核对','待收款人确认','有异议'].includes(x.paymentReview.status))).length;
 const ownPaymentDisputes=(store.sales||[]).filter(x=>x.operatorId===user.id&&x.paymentReview?.status==='有异议').length;
 const assignedPlans=openPlans.filter(x=>x.receiverId===user.id).length;
 const giftApprovalsToReview=c.capabilities(user).giftApprove?(store.giftApprovals||[]).filter(x=>x.status==='待审批').length:0;
 const unreviewedWork=(store.workJournals||[]).filter(x=>x.employeeId===user.id&&x.status==='待核定').length;
 const unreviewedLearning=(store.learningRecords||[]).filter(x=>x.employeeId===user.id&&x.status==='待审核').length;
 const feedbackToReview=owner?0:(store.assistantAnswerFeedback||[]).filter(r=>r.status==='待审核'&&delegation.allowed(store,user,'feedback',r)).length;
 const learningToReview=owner?0:(store.learningRecords||[]).filter(r=>r.status==='待审核'&&delegation.allowed(store,user,'learning',r)).length;
 const redToReview=0; // 红冲审核不转交，必须老板本人批准。
 const dutyToReview=owner?0:(store.dutyAssignments||[]).filter(x=>x.status==='待审核'&&duties.canReview(store,user,x)).length,usedPhoneToReview=owner?0:(store.usedPhoneAssessments||[]).filter(x=>x.status==='待复核'&&usedPhones.canReview(store,user,x)).length,workToReview=owner?0:(store.workJournals||[]).filter(x=>x.status==='待核定'&&journal.canReview(store,user,x)).length;
 return {dutyToReview,usedPhoneToReview,workToReview,capabilities:c.capabilities(user),feedbackToReview,learningToReview,redToReview,asOf:c.now(),role:user.roleCode,name:user.name,owner,reviews,pendingCount:owner?Object.values(reviews).reduce((n,x)=>n+x,0):dutyToReview+usedPhoneToReview+workToReview+feedbackToReview+learningToReview+redToReview+followups+cashToConfirm+transferToConfirm+salePaymentsToConfirm+ownPaymentDisputes+assignedPlans+unreviewedLearning+unreviewedWork+giftApprovalsToReview,unreviewedWork,followups,openReceptions:open,unreviewedLearning,cashToConfirm,transferToConfirm,salePaymentsToConfirm,ownPaymentDisputes,assignedPlans,giftApprovalsToReview};
}
module.exports={summary};



