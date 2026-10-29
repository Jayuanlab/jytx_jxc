"use strict";
const c=require('./common');
const daily=require('./daily-close');
const round=c.round;
const stages=new Map([['morning','早上扎账'],['instant','即时扎账'],['handover','中午交接班扎账'],['evening','晚上正式扎账']]);
function reportOnlyStage(row){return row.simpleDailyClose===true&&['instant','evening'].includes(row.simpleStage);}
function needsOwnerReview(row){return row.simpleDailyClose===true&&!reportOnlyStage(row)&&!row.reviewedAt&&!row.ownerReportOnly?.confirmedAt;}
function reportVersion(row){const original=[row.id,row.submittedAt,row.expectedCash,row.actualCash,row.cashDifference,row.walletActualBalance,row.walletDifference,row.simpleNoncashActual,row.simpleNoncashDifference,row.note,row.checkedAt,row.checkDecision,row.checkNote,row.reviewedAt,row.reviewNote,row.ownerReportOnly?.confirmedAt,(row.events||[]).length];if(row.simpleAirActualBalance!=null)original.push(row.simpleAirSystem,row.simpleAirActualBalance,row.simpleAirDifference);return require('node:crypto').createHash('sha256').update(JSON.stringify(original)).digest('hex');}
function markSeen(store,user,payload={}){const who=c.userById(store,user.id);if(who.roleCode!=='owner'||who.status!=='active'||user.roleCode!=='owner')throw new c.HttpError(403,'仅老板可记录本人已查看报告');const input=payload.rows;if(!Array.isArray(input)||!input.length||input.length>100||new Set(input.map(row=>row.id)).size!==input.length)throw new c.HttpError(400,'请选择已展示的报告');const rows=input.map(item=>{const row=(store.dailyCloseouts||[]).find(row=>row.simpleDailyClose===true&&row.id===item.id);if(!row||item.version!==reportVersion(row))throw new c.HttpError(409,'报告内容已变化，请刷新后查看');return row;});const at=c.now();let count=0;for(const row of rows){const version=reportVersion(row);if(row.ownerReportRead?.version===version&&row.ownerReportRead?.seenBy===who.id)continue;row.ownerReportRead={version,seenBy:who.id,seenAt:at};count++;}if(count)c.audit(store,who,'daily-close:simple-report-seen',{ids:rows.map(row=>row.id),count});return {count,seenAt:at};}
function onDuty(store,at){const when=Date.parse(at),date=c.day(at),active=new Set((store.users||[]).filter(user=>user.status==='active'&&c.capabilities(user).sell).map(user=>user.id));return [...new Set((store.attendance||[]).filter(row=>row.checkInAt&&active.has(row.userId)&&c.day(row.checkInAt)===date&&Date.parse(row.checkInAt)<=when&&(!row.checkOutAt||Date.parse(row.checkOutAt)>when)).map(row=>row.userId))];}
function canCheck(store,user,row){
  if(!row||row.simpleDailyClose!==true||row.checkedAt||row.reviewedAt||user.roleCode==='owner'||!c.capabilities(user).sell)return false;
  const duty=onDuty(store,row.submittedAt);
  if(reportOnlyStage(row))return user.id===(row.ownerRecorded?row.actualCounterId:row.cashierId);
  return row.cashierId!==user.id||duty.length===0||(duty.length===1&&duty[0]===user.id);
}
function money(value,label){
  if(value==null||value==='')throw new c.HttpError(400,'请填写'+label+'实际数字');
  const amount=c.money(value,label);
  if(amount<0)throw new c.HttpError(400,label+'不能小于零');
  return amount;
}
function noncashRows(store,date){
  const excluded=new Set(['fund_transfer','transfer_in','transfer_out','cash_bank_deposit','bank_deposit','expense_red','other_income_red']);
  return require('./serial-source-corrections').receiptRows(store).filter(row=>
    (row.transactionDate||(row.createdAt&&c.day(row.createdAt)))===date&&
    Number(row.amount)>0&&['微信','支付宝','聚合支付'].includes(row.account)&&
    !excluded.has(row.kind)&&!row.isReversal
  );
}
function systemView(store,date){
  const formalShot=daily.snapshot(store,date);
  const cashBasis=require('./cash-basis');
  const rolling=cashBasis.rollingSnapshot(store,date);
  const shot={...formalShot,openingCashSuggested:rolling.openingCashSuggested,
    cashBasisFingerprint:rolling.cashBasisFingerprint,cashBasisSource:rolling.openingCashSource,
    cashBasisAnchorDate:rolling.openingCashAnchorDate,
    fingerprint:require('node:crypto').createHash('sha256').update(JSON.stringify([formalShot.fingerprint,rolling.cashBasisFingerprint])).digest('hex')};
  const cashExpected=shot.openingCashSuggested==null?null:cashBasis.expected(shot.openingCashSuggested,shot);
  const scanRows=noncashRows(store,date);
  const noncashExpected=round(scanRows.reduce((total,row)=>total+Number(row.amount),0));
  return {shot,cashExpected,noncashExpected,scanRows};
}
function preview(store,user){
  const live=c.userById(store,user.id);if(live.roleCode!==user.roleCode||live.status!=='active'||live.assistantCustomerOnly)throw new c.HttpError(403,'请使用本人有效账号');c.permit(live,'sell');const date=c.day(),{shot,cashExpected,noncashExpected,scanRows}=systemView(store,date);
  return {canRecordForOthers:user.roleCode==='owner',reporters:user.roleCode==='owner'?(store.users||[]).filter(x=>x.status==='active'&&!x.assistantCustomerOnly&&c.capabilities(x).sell).map(x=>({id:x.id,name:x.name})):[],date,asOf:shot.asOf,openingCash:shot.openingCashSuggested,cashExpected,cashChange:shot.cashChange,
    cashBankDeposits:shot.cashBankDeposits,cashAdjustment:shot.cashAdjustment,
    walletExpected:shot.wallet?.expectedBalance??null,walletBaselineAt:shot.wallet?.baselineAt||null,walletBasisStatus:shot.wallet?.basisStatus||null,walletBasisReason:shot.wallet?.reason||'',walletTodayIn:shot.wallet?.todayIn??0,walletTodayOut:shot.wallet?.todayOut??0,
    airExpected:(shot.mobile||[]).find(item=>item.key==='airClosing')?.own??null,
    noncashExpected,noncashDetails:scanRows.map(row=>({id:row.id,sourceId:row.sourceId,amount:row.amount,account:row.account,kind:row.kind})),
    walletDetails:(shot.wallet?.entries||[]).map(row=>({id:row.id,sourceId:row.sourceId,amount:row.amount,kind:row.kind})),
    existing:(store.dailyCloseouts||[]).filter(row=>row.date===date&&row.simpleDailyClose===true).map(row=>publicRow(row,store)),
    noNewDataByStage:Object.fromEntries([...stages.keys()].map(stage=>{const last=(store.dailyCloseouts||[]).filter(row=>row.date===date&&row.simpleDailyClose===true&&row.simpleStage===stage).at(-1);return [stage,Boolean(last&&last.snapshot?.fingerprint===shot.fingerprint)];})),onDutyCount:onDuty(store,c.now()).length};
}
function publicRow(row,store){return {id:row.id,displayNo:(store.documentNumbers||[]).find(item=>item.collection==='dailyCloseouts'&&item.sourceId===row.id)?.displayNo||row.displayNo,date:row.date,stage:row.simpleStage,stageName:stages.get(row.simpleStage),sourceFormVersion:row.sourceFormVersion||null,status:reportOnlyStage(row)&&!row.reviewedAt?(row.checkedAt?(row.checkDecision==='有异议'?'店内核对有异议':row.cashDifference||row.walletDifference||row.simpleAirDifference||row.simpleNoncashDifference?'店内已核对·差额待查':'店内已核对'):(row.simpleStage==='evening'&&(row.cashDifference||row.walletDifference||row.simpleAirDifference||row.simpleNoncashDifference)?'店内待核对·差额待查':'店内待核对')):row.status,needsOwnerReview:needsOwnerReview(row),
  submittedAt:row.submittedAt,cashierId:row.cashierId,cashier:row.cashier,recordedBy:row.recordedBy||null,recordedByName:row.recordedByName||null,actualCounterId:row.actualCounterId||null,actualCounterName:row.actualCounterName||null,ownerRecorded:row.ownerRecorded===true,ownerReportOnly:row.ownerReportOnly||null,reportVersion:reportVersion(row),reportViewed:row.ownerReportRead?.version===reportVersion(row),reportViewedAt:row.ownerReportRead?.seenAt||null,
  cashSystem:row.expectedCash,cashActual:row.actualCash,cashDifference:row.cashDifference,
  walletSystem:row.simpleWalletSystem,walletActual:row.walletActualBalance,walletDifference:row.walletDifference,
  airSystem:row.simpleAirSystem??null,airActual:row.simpleAirActualBalance??null,airDifference:row.simpleAirDifference??null,
  noncashSystem:row.simpleNoncashSystem,noncashActual:row.simpleNoncashActual,noncashDifference:row.simpleNoncashDifference,
  note:row.note,asOf:row.snapshot?.asOf,events:row.events||[],checkedAt:row.checkedAt||null,checkerId:row.checkerId||null,checker:row.checker||null,checkDecision:row.checkDecision||null,checkNote:row.checkNote||'',selfChecked:row.selfChecked===true,onDutyCountAtCheck:row.onDutyUserIdsAtCheck?.length??null,reviewedAt:row.reviewedAt||null,reviewer:row.reviewer||null,reviewNote:row.reviewNote||''};}
function list(store,user,query={}){
  c.permit(user,'sell');const date=String(query.date||c.day());
  return (store.dailyCloseouts||[]).filter(row=>row.simpleDailyClose===true&&row.date===date).map(row=>({...publicRow(row,store),canCheck:canCheck(store,user,row),canSelfCheck:(()=>{const duty=onDuty(store,row.submittedAt);return duty.length===0||(duty.length===1&&duty[0]===row.cashierId);})()})).reverse();
}
function submit(store,user,payload={}){
  const live=c.userById(store,user.id);if(live.roleCode!==user.roleCode||live.status!=='active'||live.assistantCustomerOnly)throw new c.HttpError(403,'请使用本人有效账号');c.permit(live,'sell');
  const owner=live.roleCode==='owner';let counter=live;
  if(owner){counter=(store.users||[]).find(x=>x.id===payload.actualCounterId&&x.status==='active'&&!x.assistantCustomerOnly&&c.capabilities(x).sell);if(!counter||payload.actualCountConfirmed!==true)throw new c.HttpError(400,'请选择实际清点报数人，并核实本次实点数字');}
  else if(payload.actualCounterId&&payload.actualCounterId!==live.id)throw new c.HttpError(403,'营业员不能代他人报数');
  const date=c.day(),stage=String(payload.stage||'');
  if(!stages.has(stage))throw new c.HttpError(400,'请选择清点时段');
  const {shot,cashExpected,noncashExpected}=systemView(store,date);
  const actualCash=money(payload.actualCash,'门店现金');
  const walletActual=money(payload.walletActual,'门店微信余额');
  const airActual=money(payload.airActual,'空充BOSS期末余额');
  const noncashActual=money(payload.noncashActual,'非现金收款');
  const cashDifference=cashExpected==null?null:round(actualCash-cashExpected);
  const walletSystem=shot.wallet?.expectedBalance??null;
  const walletDifference=walletSystem!=null?round(walletActual-walletSystem):null;
  const airSystem=(shot.mobile||[]).find(item=>item.key==='airClosing')?.own??null;
  const airDifference=airSystem!=null?round(airActual-airSystem):null;
  const noncashDifference=round(noncashActual-noncashExpected);
  const note=String(payload.note||'').trim().slice(0,500);
  const last=(store.dailyCloseouts||[]).filter(row=>row.simpleDailyClose===true&&row.date===date&&row.simpleStage===stage).at(-1);
  if(last&&last.snapshot?.fingerprint===shot.fingerprint&&(!note||note===last.note))
    throw new c.HttpError(409,'系统业务数据没有新增；上次清点已提交。只有填写新的备注才能再次提交。');
  const prior=(store.dailyCloseouts||[]).filter(row=>row.date===date),sequence=prior.length+1,submittedAt=c.now();
  const pending=[cashDifference,walletDifference,airDifference,noncashDifference].some(value=>value!=null&&value!==0)||cashExpected==null||walletSystem==null||airSystem==null;
  const row={id:c.id('DC'),displayNo:'ZZ-'+date.replace(/-/g,'')+'-'+String(sequence).padStart(3,'0'),sequence,
    simpleDailyClose:true,simpleStage:stage,sourceFormVersion:'simple-four-items-v1',recordType:stage==='evening'?'formal':'temporary',isFormal:stage==='evening',
    date,status:stage==='instant'?'店内待核对':stage==='evening'?(pending?'店内待核对·差额待查':'店内待核对'):pending?'待核对·差额待查':'待核对',cashierId:user.id,cashier:user.name,reviewerId:null,reviewer:null,submittedAt,
    snapshot:shot,recordedBy:live.id,recordedByName:live.name,actualCounterId:counter.id,actualCounterName:counter.name,ownerRecorded:owner,actualCountConfirmed:owner?payload.actualCountConfirmed===true:true,manual:{},accountChecks:[],openingCash:shot.openingCashSuggested,actualCash,expectedCash:cashExpected,cashDifference,
    walletActualBalance:walletActual,walletDifference,simpleWalletSystem:walletSystem,
    simpleAirSystem:airSystem,simpleAirActualBalance:airActual,simpleAirDifference:airDifference,
    simpleNoncashSystem:noncashExpected,simpleNoncashActual:noncashActual,simpleNoncashDifference:noncashDifference,
    note,events:[{type:owner?'老板代录实点报数':'实际数字提交',by:live.id,actualCounterId:counter.id,at:submittedAt,note}],revisions:[]};
  (store.dailyCloseouts||=([])).push(row);
  c.audit(store,user,'daily-close:simple-submit',row.id);
  return publicRow(row,store);
}
function check(store,user,payload={}){
  c.permit(user,'sell');
  const row=(store.dailyCloseouts||[]).find(item=>item.id===payload.id&&item.simpleDailyClose===true);
  if(!row)throw new c.HttpError(404,'扎账单不存在');
  if(reportOnlyStage(row)&&user.roleCode==='owner')throw new c.HttpError(403,'即时清点和晚上扎账由店内人员现场核对，老板只查看报告');
  if(reportOnlyStage(row)&&!canCheck(store,user,row))throw new c.HttpError(403,'请由本次实际提交清点的人核对');
  if(row.ownerRecorded&&row.recordedBy===user.id)throw new c.HttpError(409,'老板代录的报数须由店内人员核对，不能由本人同时核对');
  const duty=onDuty(store,row.submittedAt),selfCheck=row.cashierId===user.id;
  if(!reportOnlyStage(row)&&selfCheck&&(duty.length>1||(duty.length===1&&duty[0]!==user.id)))throw new c.HttpError(409,'当前值班记录显示还有其他同事，请由另一人核对');
  if(row.checkedAt)throw new c.HttpError(409,'这张扎账单已有核对人');
  if(row.reviewedAt)throw new c.HttpError(409,'这张扎账单已由老板处理');
  const decision=String(payload.decision||'');
  if(!['核对一致','有异议'].includes(decision))throw new c.HttpError(400,'请选择核对结果');
  const note=String(payload.note||'').trim().slice(0,500);
  if(decision==='有异议'&&!note)throw new c.HttpError(400,'有异议请填写说明');
  row.checkedAt=c.now();row.checkerId=user.id;row.checker=user.name;row.checkDecision=decision;row.checkNote=note;row.selfChecked=reportOnlyStage(row)?true:selfCheck;row.onDutyUserIdsAtCheck=reportOnlyStage(row)?null:duty;
  row.status=row.ownerReportOnly||reportOnlyStage(row)?(decision==='有异议'?'店内核对有异议':row.cashDifference||row.walletDifference||row.simpleAirDifference||row.simpleNoncashDifference?'店内已核对·差额待查':'店内已核对'):(decision==='有异议'?'待老板审核·有异议':'待老板审核');
  row.events||=[];row.events.push({type:(reportOnlyStage(row)?'实际提交人核对：':selfCheck?'按值班记录自核：':'核对人核对：')+decision,by:user.id,at:row.checkedAt,note});
  c.audit(store,user,'daily-close:simple-check',row.id+' '+decision);
  return publicRow(row,store);
}
function review(store,user,payload={}){
  if(user.roleCode!=='owner')throw new c.HttpError(403,'只有老板可以审核扎账单');
  const row=(store.dailyCloseouts||[]).find(item=>item.id===payload.id&&item.simpleDailyClose===true);
  if(!row)throw new c.HttpError(404,'扎账单不存在');
  if(row.reviewedAt)throw new c.HttpError(409,'这张扎账单已经审核');
  if(reportOnlyStage(row))throw new c.HttpError(409,'即时清点和晚上扎账只供老板查看报告，由店内人员现场核对，无需老板审核');
  if(row.ownerReportOnly)throw new c.HttpError(409,'本单已由老板转为查看报告；请由店内人员完成实际核对');
  const decision=String(payload.decision||'');
  if(!['核对完成','待查','重复记录'].includes(decision))throw new c.HttpError(400,'请选择审核结果');
  if(decision==='核对完成'&&(!row.checkedAt||row.checkDecision!=='核对一致'))throw new c.HttpError(409,'须有核对人核对一致后，老板才能确认完成');
  const note=String(payload.note||'').trim().slice(0,500);
  if(decision!=='核对完成'&&!note)throw new c.HttpError(400,'请填写审核说明');
  row.reviewedAt=c.now();row.reviewerId=user.id;row.reviewer=user.name;row.reviewNote=note;
  row.status=decision==='核对完成'?(row.cashDifference||row.walletDifference||row.simpleAirDifference||row.simpleNoncashDifference?'已审核·差额待查':'已审核'):decision==='待查'?'已审核·待查':'已标记重复';
  row.events||=[];row.events.push({type:'老板审核：'+decision,by:user.id,at:row.reviewedAt,note});
  c.audit(store,user,'daily-close:simple-review',row.id+' '+decision);
  return publicRow(row,store);
}
module.exports={preview,list,submit,check,review,noncashRows,onDuty,canCheck,reportVersion,markSeen,needsOwnerReview,reportOnlyStage};
