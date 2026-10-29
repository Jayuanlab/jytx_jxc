'use strict';
const c=require('./common');
const RULE='daily-21-shanghai-v1',EFFECTIVE_DATE='2026-10-17';
function dueAt(at){const n=Date.parse(at),date=Number.isFinite(n)?c.day(at):'';return {date,due:Date.parse(date+'T21:00:00+08:00'),now:n};}
function runAutoCheckout(store,{at=c.now(),effectiveDate=EFFECTIVE_DATE}={}){
 const {date,due,now}=dueAt(at),result={date,changed:false,closed:0,skipped:[]};
 if(!Number.isFinite(now)||date<effectiveDate||now<due)return result;
 const stamp=new Date(due).toISOString(),recordedAt=new Date(now).toISOString(),actor={id:'system-attendance',name:'系统自动签退'};
 const active=new Set((store.users||[]).filter(u=>u.status==='active'&&u.roleCode!=='owner'&&!u.assistantCustomerOnly&&!['personal-assistant','customer-assistant'].includes(u.roleCode)).map(u=>u.id));
 const groups=new Map();for(const row of store.attendance||[]){if(row.date!==date||row.checkOutAt||!active.has(row.userId))continue;const start=Date.parse(row.checkInAt);if(!Number.isFinite(start)||c.day(row.checkInAt)!==date){result.skipped.push({id:row.id,reason:'invalid-checkin'});continue;}if(start>due)continue;if(!groups.has(row.userId))groups.set(row.userId,[]);groups.get(row.userId).push(row);}
 for(const rows of groups.values()){
  if(rows.length!==1){result.skipped.push(...rows.map(r=>({id:r.id,reason:'overlapping-open-shifts'})));continue;}
  const row=rows[0],fieldworks=(store.attendanceFieldwork||[]).filter(w=>w.attendanceId===row.id&&w.userId===row.userId&&!w.endAt);
  if(fieldworks.some(w=>!Number.isFinite(Date.parse(w.startAt))||Date.parse(w.startAt)>due)){result.skipped.push({id:row.id,reason:'invalid-fieldwork'});continue;}
  const evidence={rule:RULE,timeZone:'Asia/Shanghai',scheduledAt:stamp,recordedAt,reason:'每日21:00尚未手动签退'};
  row.checkOutAt=stamp;row.checkOutSource='auto-21';row.autoCheckout=evidence;require('./attendance-session-cutoff').record(store,row.userId,recordedAt);
  row.checkOutLocation={status:'待老板核对',context:fieldworks.length?'fieldwork':'store',source:'system-auto-checkout',at:stamp,reason:'系统定时签退，未采集定位',automatic:true};
  for(const work of fieldworks){work.endAt=stamp;work.endReason='auto-checkout-21';work.autoCheckout={...evidence};work.endLocation={...row.checkOutLocation,context:'fieldwork'};}
  for(const request of store.attendanceLocationRequests||[])if(request.attendanceId===row.id&&request.userId===row.userId&&request.status==='pending'){request.status='cancelled';request.cancelledAt=recordedAt;request.cancelReason='auto-checkout-21';}
  (store.attendanceAutoCheckoutLogs||=[]).unshift({id:'AUTO21-'+row.id,attendanceId:row.id,userId:row.userId,name:row.name,date,...evidence});
  c.audit(store,actor,'attendance:auto-checkout',row.id+' · '+date+' 21:00 · 系统自动签退');result.closed++;result.changed=true;
 }
 return result;
}
function startAttendanceAutoCheckoutWorker(options={}){
 const env=options.env||process.env,tenantId=String(env.STORE_TENANT_ID||''),branchId=String(env.STORE_BRANCH_ID||''),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(env.STORE_ENGINE!=='postgres'||!uuid.test(tenantId)||!uuid.test(branchId)||env.ATTENDANCE_AUTO_CHECKOUT_ENABLED==='0')return {configured:false,runOnce:async()=>({skipped:'unconfigured'}),stop:async()=>{}};
 const repo=options.repository||require('./repository'),ctx=options.context||require('./capacity/context'),clock=options.clock||c.now,schedule=options.setInterval||setInterval,cancel=options.clearInterval||clearInterval,logger=options.logger||console;
 let stopped=false,inFlight=null,finished='';const scope={tenantId,branchId,path:'attendance:auto-checkout-21',userId:'system-attendance'};
 function runOnce(){if(stopped)return Promise.resolve({skipped:'stopped'});if(inFlight)return inFlight;const at=clock(),d=dueAt(at);if(!Number.isFinite(d.now)||d.date<EFFECTIVE_DATE||d.now<d.due||finished===d.date)return Promise.resolve({skipped:'not-due'});
  const work=Promise.resolve().then(()=>ctx.run(scope,()=>repo.transaction(store=>runAutoCheckout(store,{at})))).then(result=>{finished=d.date;return result;}).catch(()=>{logger.error('Attendance automatic checkout failed; retry on next tick.');return {failed:true};});inFlight=work;work.finally(()=>{if(inFlight===work)inFlight=null;});return work;}
 const timer=schedule(()=>{void runOnce();},15000);timer?.unref?.();void runOnce();return {configured:true,runOnce,stop:async()=>{stopped=true;cancel(timer);if(inFlight)await inFlight;}};
}
module.exports={runAutoCheckout,startAttendanceAutoCheckoutWorker,RULE,EFFECTIVE_DATE};
