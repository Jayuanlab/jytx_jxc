const c = require('./common');
const TYPES = Object.freeze(['整理柜台','商品陈列','清洁','客户回访','学习培训','市场拓展','设备检查','其他']);
const privileged = user => ['owner','manager'].includes(user.roleCode);
function checkedText(value,label,max,required=false){
  if(!required && (value==null || value===''))return '';
  const text=c.text(value,label);if(text.length>max)throw new c.HttpError(400,label+'不能超过'+max+'字');return text;
}
function reference(store,user,kind,id){
  if(!kind&&!id)return null;
  if(kind==='reception')require('./reception-availability').assertEnabled();
  if(!['reception','sale'].includes(kind)||typeof id!=='string'||!id.trim())throw new c.HttpError(400,'请选择关联单据，或改为不关联');
  const rows=kind==='reception'?(store.receptions||[]):(store.sales||[]);
  const row=rows.find(item=>item.id===id);if(!row)throw new c.HttpError(404,'关联单据不存在');
  const visible=kind==='reception' ? privileged(user)||row.ownerId===user.id||(row.assists||[]).some(item=>item.fromId===user.id||item.toId===user.id) : c.capabilities(user).allSales||(row.salespersonId||row.operatorId)===user.id;
  if(!visible)throw new c.HttpError(403,'无权关联这张单据');
  return {kind,id:row.id};
}
function list(store,user){
  return (store.workJournals||[]).filter(row=>privileged(user)||row.employeeId===user.id).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(row=>({...row,linked:row.linked?{...row.linked}:null}));
}
function create(store,user,payload){
  if(!TYPES.includes(payload.type))throw new c.HttpError(400,'请选择工作事项');
  const event=checkedText(payload.event,'做了什么',1000,true);
  const result=checkedText(payload.result,'处理结果',1000,true);
  if(event.length<5)throw new c.HttpError(400,'请至少用5个字说明做了什么');
  if(result.length<2)throw new c.HttpError(400,'请说明处理结果');
  const evidenceNote=checkedText(payload.evidenceNote,'依据说明',1000);
  const linked=reference(store,user,payload.referenceKind,payload.referenceId);
  const createdAt=c.now();let occurredAt=createdAt;
  if(payload.occurredAt){
    if(typeof payload.occurredAt!=='string'||!Number.isFinite(Date.parse(payload.occurredAt)))throw new c.HttpError(400,'发生时间不正确');
    occurredAt=new Date(payload.occurredAt).toISOString();if(Date.parse(occurredAt)>Date.parse(createdAt))throw new c.HttpError(400,'发生时间不能晚于当前时间');
  }
  const date=c.day(createdAt);const sequence=(store.workJournals||[]).filter(row=>c.day(row.createdAt)===date).length+1;
  const row={id:c.id('WJ'),displayNo:'GZ'+date.replace(/-/g,'').slice(2)+String(sequence).padStart(5,'0'),employeeId:user.id,employeeName:user.name,type:payload.type,event,result,evidenceNote,linked,occurredAt,createdAt,status:'待核定',points:null,reviewedAt:null,reviewedBy:null,reviewNote:''};
  store.workJournals ||= [];store.workJournals.push(row);store.operationLogs ||= [];
  c.audit(store,user,'work-journal:create',row.id+' '+row.type);
  return {...row,linked:row.linked?{...row.linked}:null};
}
function review(store,user,payload){
  if(user.roleCode!=='owner')throw new c.HttpError(403,'仅老板可核定工作日志积分');
  const row=(store.workJournals||[]).find(item=>item.id===payload.id);if(!row)throw new c.HttpError(404,'工作日志不存在');
  if(row.status!=='待核定')throw new c.HttpError(409,'本单已经核定，不能重复计分');
  if(typeof payload.approve!=='boolean')throw new c.HttpError(400,'请选择核定结果');
  const note=checkedText(payload.note,'核定意见',1000);
  const points=payload.approve?c.number(payload.points,'核定积分',0):0;
  if(!Number.isSafeInteger(points))throw new c.HttpError(400,'积分必须为非负整数');
  row.status=payload.approve?'已核定':'未通过';row.points=points;row.reviewNote=note;row.reviewedAt=c.now();row.reviewedBy=user.id;row.reviewerName=user.name;
  store.operationLogs ||= [];c.audit(store,user,'work-journal:review',row.id+' '+row.status+' '+points+'积分');
  return {...row,linked:row.linked?{...row.linked}:null};
}
module.exports={TYPES,list,create,review};
