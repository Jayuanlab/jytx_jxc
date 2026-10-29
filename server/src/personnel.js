'use strict';
const c=require('./common');
const TYPES=new Set(['请假','休假']);
const FUNCTIONS=new Set(['sales','finance','personnel']);
const real=u=>u&&u.status==='active'&&(u.roleCode==='owner'||!String(u.id||'').startsWith('demo-'))&&!u.assistantCustomerOnly&&!['customer-assistant','personal-assistant'].includes(u.roleCode);
const staff=s=>(s.users||[]).filter(u=>real(u)&&u.roleCode!=='owner');
const config=s=>s.personnelConfig||{managerId:null,personnelIds:[],finalApproverIds:[]};
const find=(s,id)=>{const u=(s.users||[]).find(x=>x.id===id);if(!real(u))throw new c.HttpError(404,'在职人员不存在');return u};
const owner=u=>u.roleCode==='owner';
const manager=(s,u)=>config(s).managerId===u.id;
const personnel=(s,u)=>owner(u)||(config(s).personnelIds||[]).includes(u.id);
const final=(s,u)=>owner(u)||(config(s).finalApproverIds||[]).includes(u.id);
function requireOwner(u){if(!owner(u))throw new c.HttpError(403,'只有老板可以任命和调整职能')}
function assignment(store,user,body){
 requireOwner(user);const cfg=store.personnelConfig||={managerId:null,personnelIds:[],finalApproverIds:[]};
 const target=find(store,body.userId);if(target.roleCode==='owner')throw new c.HttpError(400,'老板账号已有全部管理权限');
 if(body.action==='manager'){
  if(!staff(store).some(x=>x.id===target.id))throw new c.HttpError(400,'请选择本店在职员工');
  cfg.managerId=target.id;c.audit(store,user,'personnel:appoint-manager',target.name);return {message:'已任命 '+target.name+' 为当前店长，新申请由其初审'};
 }
 if(body.action==='functions'){
  if(!Array.isArray(body.functions)||body.functions.some(x=>!FUNCTIONS.has(x)))throw new c.HttpError(400,'职能选项不正确');
  const chosen=new Set(body.functions),codes=new Set(target.permissions||[]),overrides={...(target.capabilityOverrides||{})};
  for(const [name,cap,code] of [['sales','sell','sale:create'],['finance','finance','finance:view']]){
   if(chosen.has(name))codes.add(code);else codes.delete(code);overrides[cap]=chosen.has(name);
  }
  target.permissions=[...codes];target.capabilityOverrides=overrides;
  cfg.personnelIds=chosen.has('personnel')?[...new Set([...(cfg.personnelIds||[]),target.id])]:(cfg.personnelIds||[]).filter(id=>id!==target.id);
  target.permissionRevision=(target.permissionRevision||0)+1;
  c.audit(store,user,'personnel:assign-functions',target.name+' · '+[...chosen].join('、'));
  return {message:'兼职职能已保存',functions:[...chosen]};
 }
 if(body.action==='finalApprover'){
  cfg.finalApproverIds=body.enabled===true?[...new Set([...(cfg.finalApproverIds||[]),target.id])]:(cfg.finalApproverIds||[]).filter(id=>id!==target.id);
  c.audit(store,user,'personnel:final-approver',target.name+' · '+(body.enabled===true?'授权':'取消'));
  return {message:body.enabled===true?'已授权请休假终审':'已取消请休假终审'};
 }
 throw new c.HttpError(400,'请选择任命或职能调整');
}
function parseTime(value,label){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value))throw new c.HttpError(400,label+'格式不正确');const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new c.HttpError(400,label+'格式不正确');return date.toISOString()}
function submit(store,user,body){
 if(!real(user)||owner(user))throw new c.HttpError(403,'请用员工账号提交请休假申请');
 const type=String(body.type||'');if(!TYPES.has(type))throw new c.HttpError(400,'请选择请假或休假');
 const startAt=parseTime(body.startAt,'开始时间'),endAt=parseTime(body.endAt,'结束时间'),start=Date.parse(startAt),end=Date.parse(endAt);
 if(end<=start||end-start>366*86400000)throw new c.HttpError(400,'结束时间须晚于开始时间，最长366天');
 const reason=c.text(body.reason,'申请事由');if(reason.length>500)throw new c.HttpError(400,'申请事由过长');
 const overlap=(store.leaveRequests||[]).some(x=>x.applicantId===user.id&&!['店长驳回','终审驳回','已撤销'].includes(x.status)&&Date.parse(x.startAt)<end&&Date.parse(x.endAt)>start);
 if(overlap)throw new c.HttpError(409,'这段时间已有未撤销的请休假申请');
 const cfg=config(store),chief=(store.users||[]).find(u=>u.id===cfg.managerId&&real(u));
 if(!chief)throw new c.HttpError(409,'尚未任命有效店长，请联系老板');
 const bypass=chief.id===user.id;
 const day=c.day(),seq=(store.leaveRequests||[]).filter(x=>x.displayNo?.startsWith('QX-'+day.replace(/-/g,'')+'-')).length+1;
 const row={id:c.id('LVE'),displayNo:'QX-'+day.replace(/-/g,'')+'-'+String(seq).padStart(3,'0'),version:1,applicantId:user.id,applicantName:user.name,type,startAt,endAt,reason,managerId:chief.id,managerName:chief.name,status:bypass?'待老板终审':'待店长初审',createdAt:c.now(),history:[{at:c.now(),actorId:user.id,actorName:user.name,action:'提交申请'}]};
 store.leaveRequests||=[];store.leaveRequests.push(row);c.audit(store,user,'personnel:leave-submit',row.displayNo+' · '+type);
 return {row,message:bypass?'店长本人申请，已转老板终审':'申请已发给店长 '+chief.name+' 初审'};
}
function decide(store,user,body){
 const row=(store.leaveRequests||[]).find(x=>x.id===body.id);if(!row)throw new c.HttpError(404,'申请单不存在');
 if(row.version!==body.version)throw new c.HttpError(409,'申请已被他人处理，请刷新');
 const decision=String(body.decision||''),note=String(body.note||'').trim();if(note.length>500)throw new c.HttpError(400,'备注过长');
 const isManager=row.status==='待店长初审'&&row.managerId===user.id;
 const isFinal=['待终审','待老板终审','转老板终审'].includes(row.status)&&final(store,user)&&row.applicantId!==user.id&&(row.status==='待终审'||owner(user));
 if(!isManager&&!isFinal)throw new c.HttpError(403,'这张申请当前不由您审批');
 if(isManager){if(row.applicantId===user.id)throw new c.HttpError(403,'不能初审本人申请');if(!['approve','reject'].includes(decision))throw new c.HttpError(400,'请选择通过或驳回');row.status=decision==='approve'?'待终审':'店长驳回';row.managerDecisionAt=c.now();row.managerDecisionBy=user.id;}
 else if(decision==='transfer'&&!owner(user)){row.status='转老板终审';row.transferredBy=user.id;row.transferredAt=c.now();}
 else if(['approve','reject'].includes(decision)){row.status=decision==='approve'?'已批准':'终审驳回';row.finalDecisionAt=c.now();row.finalDecisionBy=user.id;}
 else throw new c.HttpError(400,'请选择通过、驳回或转老板');
 row.version++;row.history||=[];row.history.push({at:c.now(),actorId:user.id,actorName:user.name,action:decision==='approve'?'通过':decision==='reject'?'驳回':'转老板',note});
 c.audit(store,user,'personnel:leave-review',row.displayNo+' · '+row.status+' · '+note);return {row,message:row.displayNo+' '+row.status};
}
function day(value){try{return c.day(value)}catch{return ''}}
function staffing(store){
 const date=c.day(),now=Date.now(),people=[...staff(store),...(store.users||[]).filter(u=>owner(u)&&u.status==='active'&&(store.attendance||[]).some(a=>a.userId===u.id&&day(a.checkInAt)===date))],active=[];const present=[];const field=[];const leave=[];const conflict=[];
 for(const u of people){
  const shifts=(store.attendance||[]).filter(x=>x.userId===u.id&&day(x.checkInAt)===date).sort((a,b)=>Date.parse(b.checkInAt)-Date.parse(a.checkInAt));
  const current=shifts.find(x=>!x.checkOutAt),outside=(store.attendanceFieldwork||[]).some(x=>x.userId===u.id&&!x.endAt);
  const approved=(store.leaveRequests||[]).find(x=>x.applicantId===u.id&&x.status==='已批准'&&Date.parse(x.startAt)<=now&&Date.parse(x.endAt)>now);
  if(shifts.length)present.push(u.name);
  if(approved){leave.push({name:u.name,type:approved.type,until:approved.endAt});if(current)conflict.push(u.name)}
  if(current){if(outside)field.push(u.name);else active.push(u.name)}
 }
 return {date,asOf:c.now(),scheduled:people.length,presentCount:present.length,present,workingCount:active.length,working:active,fieldworkCount:field.length,fieldwork:field,leaveCount:leave.length,onLeave:leave,conflict};
}
function list(store,user){
 if(!real(user))throw new c.HttpError(403,'此账号不能查看人事资料');
 const cfg=config(store),hr=personnel(store,user),chief=manager(store,user),approver=final(store,user);
 const rows=(store.leaveRequests||[]).filter(x=>hr||chief&&x.managerId===user.id||approver&&['待终审','待老板终审','转老板终审'].includes(x.status)||x.applicantId===user.id).slice().reverse();
 const pending=rows.filter(x=>x.status==='待店长初审'&&x.managerId===user.id||['待终审','待老板终审','转老板终审'].includes(x.status)&&approver&&x.applicantId!==user.id&&(x.status==='待终审'||owner(user)));
 const roster=hr||chief||approver?staff(store).map(u=>({id:u.id,name:u.name,roleCode:u.roleCode,functions:[...(c.capabilities(u).sell?['sales']:[]),...(c.capabilities(u).finance?['finance']:[]),...((cfg.personnelIds||[]).includes(u.id)?['personnel']:[]),...(cfg.managerId===u.id?['manager']:[])],finalApprover:(cfg.finalApproverIds||[]).includes(u.id)})):[];
 return {me:{id:user.id,name:user.name,owner:owner(user),manager:chief,personnel:hr,finalApprover:approver},manager:roster.find(u=>u.id===cfg.managerId)||null,roster,leaves:rows,pendingCount:pending.length,staffing:hr||chief||approver?staffing(store):null};
}
module.exports={list,submit,decide,assignment,staffing};
