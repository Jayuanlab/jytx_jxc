'use strict';
const c=require('./common');
const real=u=>u&&u.status==='active'&&(u.roleCode==='owner'||!String(u.id||'').startsWith('demo-'))&&!u.assistantCustomerOnly&&!['customer-assistant','personal-assistant'].includes(u.roleCode);
const staff=s=>(s.users||[]).filter(u=>real(u)&&u.roleCode!=='owner');
const canManage=(s,u)=>u.roleCode==='owner'||(s.personnelConfig?.managerId===u.id&&real(u));
function dateOf(value){const d=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00+08:00'))||c.day(d+'T00:00:00+08:00')!==d)throw new c.HttpError(400,'排班日期不正确');return d;}
function timeOf(value,label){const t=String(value||'');if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))throw new c.HttpError(400,label+'请按24小时制填写，例如 09:00');return t;}
const rows=(s,date)=>(s.staffSchedules||[]).filter(r=>r.date===date);
function view(s,u,date=c.day(),at=c.now()){
 if(!real(u))throw new c.HttpError(403,'只有门店账号可查看排班');date=dateOf(date);
 const manager=canManage(s,u),people=staff(s),names=new Map((s.users||[]).filter(real).map(x=>[x.id,x.name]));
 const entries=rows(s,date).map(r=>({id:r.id,date:r.date,userId:r.userId,name:names.get(r.userId)||r.name||'原员工',status:r.status,post:r.post||'',cashCustodian:r.status==='work'&&r.post==='frontdesk',closeoutSubmitter:r.closeoutSubmitter===true&&r.status==='work',startTime:r.startTime||'',endTime:r.endTime||'',note:r.note||'',version:r.version||1,updatedAt:r.updatedAt||r.createdAt||null,updatedByName:r.updatedByName||''})).sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.name.localeCompare(b.name,'zh-CN'));
 const today=c.day(at),clock=new Date(at).toLocaleTimeString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}).slice(0,5);
 const plannedNow=rows(s,today).filter(r=>r.status==='work'&&r.startTime<=clock&&clock<r.endTime).map(r=>({userId:r.userId,name:names.get(r.userId)||r.name||'原员工',post:r.post||'',cashCustodian:r.post==='frontdesk',startTime:r.startTime,endTime:r.endTime})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const active=(s.attendance||[]).filter(r=>r.date===today&&!r.checkOutAt);
 const liveToday=[...new Map(active.map(r=>[r.userId,r])).values()].map(r=>{const outside=(s.attendanceFieldwork||[]).find(w=>w.userId===r.userId&&w.attendanceId===r.id&&!w.endAt);return {userId:r.userId,name:names.get(r.userId)||r.name||'原员工',checkInAt:r.checkInAt,place:outside?'fieldwork':'store',fieldworkLocation:outside?.location||''};}).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 return {date,today,asOf:at,canManage:manager,staff:manager?people.map(x=>({id:x.id,name:x.name,roleCode:x.roleCode})):[],entries,plannedNow,liveToday,
  closeoutSubmitter:rows(s,today).find(r=>r.status==='work'&&r.closeoutSubmitter===true)?.userId||null,
  note:'前台现金保管和扎账提交人为排班责任安排；实际现金交接、扎账仍须按原单据完成。未签到不能据此认定缺勤。'};
}
function save(s,u,body={}){
 if(!real(u)||!canManage(s,u))throw new c.HttpError(403,'只有老板或当前店长可以安排班次');
 const date=dateOf(body.date);if(date!==c.day())throw new c.HttpError(400,'这里只安排当日值班，请回到今天后再保存');
 const person=staff(s).find(x=>x.id===body.userId);if(!person)throw new c.HttpError(404,'请选择本店在职营业员');
 const status=String(body.status||'');if(!['work','cancelled'].includes(status))throw new c.HttpError(400,'请选择值班或撤销安排');
 const startTime=status==='work'?timeOf(body.startTime,'计划上班时间'):'',endTime=status==='work'?timeOf(body.endTime,'计划下班时间'):'';
 if(status==='work'&&startTime>=endTime)throw new c.HttpError(400,'计划下班时间须晚于上班时间；跨日班次请另行安排');
 const post=status==='work'?String(body.post||''):'';if(status==='work'&&!['frontdesk','mobile'].includes(post))throw new c.HttpError(400,'请选择营业前台或手机柜台');
 const closeoutSubmitter=status==='work'&&body.closeoutSubmitter===true;
 const note=String(body.note||'').trim();if(note.length>200)throw new c.HttpError(400,'排班备注最多200字');
 const matches=rows(s,date).filter(r=>r.userId===person.id);if(matches.length>1)throw new c.HttpError(409,'此人此日有重复排班，请先核对原记录');
 const existing=matches[0]||null,version=existing?.version||0;
 if(!Number.isInteger(body.expectedVersion)||body.expectedVersion!==version)throw new c.HttpError(409,'排班已由其他人更新，请刷新后再保存');
 if(!existing&&status==='cancelled')return {message:'此人此日原本未安排班次',schedule:view(s,u,date)};
 if(status==='work'&&post==='frontdesk'&&rows(s,date).some(r=>r.userId!==person.id&&r.status==='work'&&r.post==='frontdesk'&&startTime<r.endTime&&endTime>r.startTime))throw new c.HttpError(409,'营业前台值班时间重叠，请调整时段以明确现金保管责任人');
 const before=existing?{status:existing.status,post:existing.post||'',closeoutSubmitter:existing.closeoutSubmitter===true,startTime:existing.startTime||'',endTime:existing.endTime||'',note:existing.note||''}:null,after={status,post,closeoutSubmitter,startTime,endTime,note};
 if(existing&&JSON.stringify(before)===JSON.stringify(after))return {message:'排班内容未变化',schedule:view(s,u,date)};
 const at=c.now(),row=existing||{id:c.id('SCH'),date,userId:person.id,name:person.name,createdAt:at,createdBy:u.id,history:[]};
 if(closeoutSubmitter)for(const prior of rows(s,date).filter(r=>r.userId!==person.id&&r.status==='work'&&r.closeoutSubmitter===true)){
  const old={status:prior.status,post:prior.post||'',closeoutSubmitter:true,startTime:prior.startTime||'',endTime:prior.endTime||'',note:prior.note||''};
  prior.closeoutSubmitter=false;prior.version=(prior.version||1)+1;prior.updatedAt=at;prior.updatedBy=u.id;prior.updatedByName=u.name;
  (prior.history||=[]).push({at,actorId:u.id,actorName:u.name,before:old,after:{...old,closeoutSubmitter:false}});
  c.audit(s,u,'staff-schedule:closeout-reassign',`${date} · ${prior.name} → ${person.name}`);
 }
 Object.assign(row,after,{version:version+1,updatedAt:at,updatedBy:u.id,updatedByName:u.name});row.history.push({at,actorId:u.id,actorName:u.name,before,after});
 if(!existing)(s.staffSchedules||=[]).push(row);
 c.audit(s,u,'staff-schedule:save',`${date} · ${person.name} · ${status} · v${row.version}`);
 return {message:status==='cancelled'?'已撤销本次排班，修改记录保留':'排班已保存',schedule:view(s,u,date)};
}
module.exports={view,save};
