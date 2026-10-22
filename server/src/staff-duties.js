 'use strict';
const c=require('./common'),delegation=require('./review-delegation');
const DEFAULT_SLOTS=Object.freeze([
 {id:'slot-1',name:'开门前',start:'08:30',end:'09:00'}, {id:'slot-2',name:'上午',start:'10:00',end:'10:30'},
 {id:'slot-3',name:'午前',start:'11:30',end:'12:00'}, {id:'slot-4',name:'午后',start:'14:00',end:'14:30'},
 {id:'slot-5',name:'下午',start:'16:00',end:'16:30'}, {id:'slot-6',name:'收工前',start:'18:00',end:'18:30'}
]);
function staffOnly(user){c.permit(user,'communicate');}
function text(v,label,max=120,required=true){if(!required&&(v==null||v===''))return '';const s=c.text(v,label);if(s.length>max)throw new c.HttpError(400,label+'过长');return s;}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00+08:00'))||c.day(value+'T12:00:00+08:00')!==value)throw new c.HttpError(400,'日期不正确');return value;}
function schedule(store){return structuredClone(store.dutySchedule||{revision:0,slots:DEFAULT_SLOTS,templates:[]});}
function employee(store,id){const u=delegation.staff(store).find(x=>x.id===id);if(!u)throw new c.HttpError(400,'请选择当前门店的在职员工');return u;}
function reviewer(store,id,subject){const u=employee(store,id);if(u.id===subject||!c.capabilities(u).workReview)throw new c.HttpError(400,'请选择有工作积分审核权限的其他员工');return u;}
function get(store,id){const r=(store.dutyAssignments||[]).find(x=>x.id===id);if(!r)throw new c.HttpError(404,'值日任务不存在');return r;}
function canReview(store,user,row){return row.employeeId!==user.id&&delegation.staff(store).some(u=>u.id===user.id)&&c.capabilities(user).workReview&&(user.roleCode==='owner'||row.reviewerId===user.id);}
function visible(store,user,row){return c.capabilities(user).dutyManage||row.employeeId===user.id||canReview(store,user,row);}
function permitVisible(store,user,row){staffOnly(user);if(!visible(store,user,row))throw new c.HttpError(403,'只能查看自己的任务或交给你审核的任务');}
function version(row,body){if(body.version!==row.version)throw new c.HttpError(409,'任务已变化，请刷新后操作');}
function saveSchedule(store,user,body){
 c.permit(user,'dutyManage');const old=schedule(store);if(body.revision!==old.revision)throw new c.HttpError(409,'时段设置已变化，请刷新');
 if(!Array.isArray(body.slots)||body.slots.length!==6)throw new c.HttpError(400,'每天必须设置六个时段');
 const slots=body.slots.map((s,i)=>{if(s.id!==DEFAULT_SLOTS[i].id)throw new c.HttpError(400,'时段编号不正确');const name=text(s.name,'时段名称',12);for(const v of [s.start,s.end])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v||''))throw new c.HttpError(400,'请输入正确的时段时间');if(s.start>=s.end)throw new c.HttpError(400,'结束时间须晚于开始时间');return {id:s.id,name,start:s.start,end:s.end};});
 if(!Array.isArray(body.templates)||body.templates.length>100)throw new c.HttpError(400,'分工模板最多100项');const seen=new Set();
 const templates=body.templates.map(t=>{if(!slots.some(s=>s.id===t.slotId))throw new c.HttpError(400,'请选择时段');const area=text(t.area,'值日区域',60),key=t.slotId+'|'+area.normalize('NFKC').toLowerCase();if(seen.has(key))throw new c.HttpError(400,'同一时段和区域不能重复安排');seen.add(key);const u=employee(store,t.employeeId),r=reviewer(store,t.reviewerId,u.id);return {slotId:t.slotId,area,employeeId:u.id,reviewerId:r.id,requirement:text(t.requirement,'完成要求',500,false)};});
 store.dutySchedule={revision:old.revision+1,slots,templates};c.audit(store,user,'duties:schedule','六时段与分工模板 '+templates.length+' 项');return schedule(store);
}
function arrange(store,user,body){
 c.permit(user,'dutyManage');const day=date(body.date),cfg=schedule(store);if(body.revision!==cfg.revision)throw new c.HttpError(409,'分工模板已变化，请刷新');
 if(!Array.isArray(body.slotIds)||!body.slotIds.length||body.slotIds.some(id=>!cfg.slots.some(s=>s.id===id)))throw new c.HttpError(400,'请选择要安排的时段');
 const templates=cfg.templates.filter(t=>body.slotIds.includes(t.slotId));if(!templates.length)throw new c.HttpError(400,'这些时段尚未设置员工和区域，请先设置分工');
 const prepared=templates.map(t=>({t,u:employee(store,t.employeeId),r:reviewer(store,t.reviewerId,t.employeeId)})),created=[];let skipped=0;
 for(const {t,u,r}of prepared){if((store.dutyAssignments||[]).some(x=>x.date===day&&x.slotId===t.slotId&&x.area===t.area)){skipped++;continue;}const slot=cfg.slots.find(s=>s.id===t.slotId),row={id:c.id('DUTY'),date:day,slotId:t.slotId,slot:structuredClone(slot),area:t.area,requirement:t.requirement,employeeId:u.id,employeeName:u.name,reviewerId:r.id,reviewerName:r.name,status:'待完成',version:1,createdAt:c.now(),createdBy:user.id,submissions:[],reviews:[],points:null};(store.dutyAssignments||=[]).push(row);created.push(row.id);}
 c.audit(store,user,'duties:arrange',day+' 新增 '+created.length+' 已有 '+skipped);return {created,skipped,message:'安排了 '+created.length+' 项，已有 '+skipped+' 项未重复安排'};
}
function snapshot(store,user,day=c.day(),visionConfigured=false){
 staffOnly(user);date(day);const cfg=schedule(store),manage=c.capabilities(user).dutyManage;
 return {date:day,slots:cfg.slots,revision:cfg.revision,templates:manage?cfg.templates:[],canManage:manage,visionConfigured,staff:manage?delegation.staff(store).map(u=>({id:u.id,name:u.name,canReview:c.capabilities(u).workReview})):[],rows:(store.dutyAssignments||[]).filter(r=>r.date===day&&visible(store,user,r)).map(r=>({...structuredClone(r),canSubmit:r.employeeId===user.id&&['待完成','需重做'].includes(r.status),canReview:canReview(store,user,r)&&r.status==='待审核',overdue:['待完成','需重做'].includes(r.status)&&Date.parse(r.date+'T'+r.slot.end+':00+08:00')<Date.now()}))};
}
function prepareSubmit(store,user,body){staffOnly(user);const row=get(store,body.id);if(row.employeeId!==user.id)throw new c.HttpError(403,'只能提交本人值日任务');version(row,body);if(!['待完成','需重做'].includes(row.status))throw new c.HttpError(409,'任务已提交或完成');if(row.date>c.day())throw new c.HttpError(400,'未来日期的值日不能提前提交');return {row,note:text(body.note,'完成说明',1000)};}
function submit(store,user,body,photo,analysis){
 const {row,note}=prepareSubmit(store,user,body);if(!photo||!/^[a-f0-9]{64}$/.test(photo.hash))throw new c.HttpError(400,'请拍照提交');
 const submission={id:c.id('DSP'),photoHash:photo.hash,mime:photo.mime,note,analysis:structuredClone(analysis),createdAt:c.now(),submittedBy:user.id};
 row.submissions.push(submission);row.status='待审核';row.version++;row.submittedAt=submission.createdAt;c.audit(store,user,'duties:submit',row.id+' 照片待人工复核');return {id:row.id,version:row.version,status:row.status,analysis:submission.analysis};
}
function photo(store,user,id,submissionId){const row=get(store,id);permitVisible(store,user,row);const sub=row.submissions.find(s=>s.id===submissionId);if(!sub)throw new c.HttpError(404,'照片记录不存在');return {hash:sub.photoHash,mime:sub.mime};}
function award(store,user,{sourceKind,sourceId,employeeId,employeeName,type,event,result,points,note}){
 if((store.workJournals||[]).some(x=>x.sourceKind===sourceKind&&x.sourceId===sourceId))throw new c.HttpError(409,'这项工作已核分');
 const at=c.now(),row={id:c.id('WJ'),employeeId,employeeName,type,event,result,evidenceNote:note,sourceKind,sourceId,linked:null,occurredAt:at,createdAt:at,status:'已核定',points,reviewedAt:at,reviewedBy:user.id,reviewerName:user.name,reviewNote:note};(store.workJournals||=[]).push(row);return row.id;
}
function review(store,user,body){
 staffOnly(user);const row=get(store,body.id);if(!canReview(store,user,row))throw new c.HttpError(403,'只能审核交给你的其他员工任务');version(row,body);if(row.status!=='待审核')throw new c.HttpError(409,'任务已审核或尚未提交');
 if(typeof body.approve!=='boolean')throw new c.HttpError(400,'请选择审核结果');const note=text(body.note,'审核说明',1000),points=body.approve?c.number(body.points,'积分',0):0;if(!Number.isSafeInteger(points)||points>1000)throw new c.HttpError(400,'积分须为0至1000的整数');
 const at=c.now(),journalId=body.approve?award(store,user,{sourceKind:'duty',sourceId:row.id,employeeId:row.employeeId,employeeName:row.employeeName,type:'清洁',event:row.date+' '+row.slot.name+' '+row.area+' 清洁值日',result:'负责人查看照片后确认完成',points,note}):null;
 row.reviews.push({approve:body.approve,points,note,by:user.id,byName:user.name,at,submissionId:row.submissions.at(-1).id});Object.assign(row,{status:body.approve?'已完成':'需重做',version:row.version+1,points:body.approve?points:null,journalId,reviewedAt:at});c.audit(store,user,'duties:review',row.id+' '+row.status+' '+points+'积分');return {id:row.id,status:row.status,version:row.version,journalId};
}
function reassign(store,user,body){c.permit(user,'dutyManage');const row=get(store,body.id);version(row,body);if(row.status==='已完成')throw new c.HttpError(409,'已完成任务不能改分工');const u=employee(store,body.employeeId),r=reviewer(store,body.reviewerId,u.id);if(row.submissions.length&&u.id!==row.employeeId)throw new c.HttpError(409,'已提交的任务只能转交审核人');row.assignmentHistory||=[];row.assignmentHistory.push({employeeId:row.employeeId,reviewerId:row.reviewerId,by:user.id,at:c.now()});Object.assign(row,{employeeId:u.id,employeeName:u.name,reviewerId:r.id,reviewerName:r.name,version:row.version+1});c.audit(store,user,'duties:reassign',row.id+' '+u.name+' 审核 '+r.name);return {id:row.id,version:row.version};}
module.exports={DEFAULT_SLOTS,schedule,saveSchedule,arrange,snapshot,prepareSubmit,submit,photo,review,reassign,canReview,award,staffOnly,text};
