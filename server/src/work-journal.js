const c = require('./common'), delegation=require('./review-delegation');
const TYPES = Object.freeze(['拿快递','商品入库','二手机检查','整理柜台','商品陈列','清洁','客户回访','学习培训','市场拓展','设备检查','其他']);
const privileged = user => ['owner','manager'].includes(user.roleCode);
function checkedText(value,label,max,required=false){
  if(!required && (value==null || value===''))return '';
  const text=c.text(value,label);if(text.length>max)throw new c.HttpError(400,label+'不能超过'+max+'字');return text;
}
function reference(store,user,kind,id){
  if(!kind&&!id)return null;
  if(!['reception','sale','purchase'].includes(kind)||typeof id!=='string'||!id.trim())throw new c.HttpError(400,'请选择关联单据，或改为不关联');
  const rows=kind==='reception'?(store.receptions||[]):kind==='purchase'?(store.purchases||[]):(store.sales||[]);
  const row=rows.find(item=>item.id===id);if(!row)throw new c.HttpError(404,'关联单据不存在');
  const visible=kind==='purchase' ? c.capabilities(user).purchase||row.operatorId===user.id : kind==='reception' ? privileged(user)||row.ownerId===user.id||(row.assists||[]).some(item=>item.fromId===user.id||item.toId===user.id) : c.capabilities(user).allSales||(row.salespersonId||row.operatorId)===user.id;
  if(!visible)throw new c.HttpError(403,'无权关联这张单据');
  return {kind,id:row.id};
}
function list(store,user){
  return (store.workJournals||[]).filter(row=>privileged(user)||row.employeeId===user.id||canReview(store,user,row)).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(row=>({...row,canReview:row.status==='待核定'&&canReview(store,user,row),linked:row.linked?{...row.linked}:null}));
}
function create(store,user,payload){
  c.permit(user,'communicate');
  if(payload.type==='二手机检查')throw new c.HttpError(400,'二手机检查请在二手机评估中登记，复核后自动核定检查积分');
  if(!TYPES.includes(payload.type))throw new c.HttpError(400,'请选择工作事项');
  const event=checkedText(payload.event,'做了什么',1000,true);
  const result=checkedText(payload.result,'处理结果',1000,true);
  if(event.length<5)throw new c.HttpError(400,'请至少用5个字说明做了什么');
  if(result.length<2)throw new c.HttpError(400,'请说明处理结果');
  const evidenceNote=checkedText(payload.evidenceNote,'依据说明',1000);
  const linked=reference(store,user,payload.referenceKind,payload.referenceId);
  if(payload.type==='商品入库'&&linked?.kind!=='purchase')throw new c.HttpError(400,'商品入库积分请关联已完成的入库单');
  const parcelNo=payload.type==='拿快递'?checkedText(payload.parcelNo,'快递单号',80,true).toUpperCase().replace(/-/g,''):'';
  if(parcelNo&&!/^[A-Za-z0-9-]{5,80}$/.test(parcelNo))throw new c.HttpError(400,'请填写真实快递单号');
  if((store.workJournals||[]).some(r=>r.status!=='未通过'&&((parcelNo&&r.parcelNo===parcelNo)||(payload.type==='商品入库'&&r.type==='商品入库'&&r.linked?.id===linked.id))))throw new c.HttpError(409,'这项工作已提交积分，不能重复领取');
  let assignedReviewerId=null;
  if(payload.reviewerId){const reviewer=delegation.staff(store).find(u=>u.id===payload.reviewerId&&u.id!==user.id&&c.capabilities(u).workReview);if(!reviewer)throw new c.HttpError(400,'请选择有审核权限的其他员工');assignedReviewerId=reviewer.id;}
  const createdAt=c.now();let occurredAt=createdAt;
  if(payload.occurredAt){
    if(typeof payload.occurredAt!=='string'||!Number.isFinite(Date.parse(payload.occurredAt)))throw new c.HttpError(400,'发生时间不正确');
    occurredAt=new Date(payload.occurredAt).toISOString();if(Date.parse(occurredAt)>Date.parse(createdAt))throw new c.HttpError(400,'发生时间不能晚于当前时间');
  }
  const date=c.day(createdAt);const sequence=(store.workJournals||[]).filter(row=>c.day(row.createdAt)===date).length+1;
  const row={id:c.id('WJ'),displayNo:'GZ'+date.replace(/-/g,'').slice(2)+String(sequence).padStart(5,'0'),employeeId:user.id,employeeName:user.name,parcelNo,assignedReviewerId,version:1,type:payload.type,event,result,evidenceNote,linked,occurredAt,createdAt,status:'待核定',points:null,reviewedAt:null,reviewedBy:null,reviewNote:''};
  store.workJournals ||= [];store.workJournals.push(row);store.operationLogs ||= [];
  c.audit(store,user,'work-journal:create',row.id+' '+row.type);
  return {...row,linked:row.linked?{...row.linked}:null};
}
function review(store,user,payload){
  const row=(store.workJournals||[]).find(item=>item.id===payload.id);if(!row)throw new c.HttpError(404,'工作日志不存在');
  if(!canReview(store,user,row))throw new c.HttpError(403,'只能核定老板指定给你的工作积分');
  if(user.roleCode!=='owner'&&payload.version!==(row.version||1))throw new c.HttpError(409,'工作日志已变化，请刷新');
  if(row.status!=='待核定')throw new c.HttpError(409,'本单已经核定，不能重复计分');
  if(typeof payload.approve!=='boolean')throw new c.HttpError(400,'请选择核定结果');
  const note=checkedText(payload.note,'核定意见',1000);
  if(!payload.approve&&!note)throw new c.HttpError(400,'未通过请填写原因');
  const points=payload.approve?c.number(payload.points,'核定积分',0):0;
  if(!Number.isSafeInteger(points))throw new c.HttpError(400,'积分必须为非负整数');
  row.version=(row.version||1)+1;row.status=payload.approve?'已核定':'未通过';row.points=points;row.reviewNote=note;row.reviewedAt=c.now();row.reviewedBy=user.id;row.reviewerName=user.name;
  store.operationLogs ||= [];c.audit(store,user,'work-journal:review',row.id+' '+row.status+' '+points+'积分');
  return {...row,linked:row.linked?{...row.linked}:null};
}
function canReview(store,user,row){if(user.assistantCustomerOnly||user.roleCode==='customer-assistant')return false;if(user.roleCode==='owner')return true;return row.employeeId!==user.id&&delegation.staff(store).some(u=>u.id===user.id)&&c.capabilities(user).workReview&&(row.assignedReviewerId?row.assignedReviewerId===user.id:(user.reviewSubjectIds||[]).includes(row.employeeId));}
function reviewers(store,user){c.permit(user,'communicate');return delegation.staff(store).filter(u=>u.id!==user.id&&c.capabilities(u).workReview).map(u=>({id:u.id,name:u.name}));}
function assign(store,user,body){c.permit(user,'manageUsers');const row=(store.workJournals||[]).find(r=>r.id===body.id);if(!row)throw new c.HttpError(404,'日志不存在');if(row.status!=='待核定'||body.version!==(row.version||1))throw new c.HttpError(409,'日志已变化，请刷新');const id=body.reviewerId||null;if(id&&!reviewers(store,{...user,id:row.employeeId}).some(u=>u.id===id))throw new c.HttpError(400,'请选择有工作审核权限的其他员工');row.assignedReviewerId=id;row.version=(row.version||1)+1;c.audit(store,user,'work-journal:assign',row.id+' '+(id||'老板审核'));return {id:row.id,version:row.version};}
module.exports={TYPES,list,create,review,canReview,reviewers,assign};
