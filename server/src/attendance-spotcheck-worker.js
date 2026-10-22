'use strict';
// The server schedules in-system requests; it does not collect background GPS or send phone push.
function startAttendanceSpotCheckWorker(options={}){
 const env=options.env||process.env,engine=env.STORE_ENGINE;
 const tenantId=String(env.STORE_TENANT_ID||'').trim(),branchId=String(env.STORE_BRANCH_ID||'').trim();
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const ready=engine==='postgres'&&uuid.test(tenantId)&&uuid.test(branchId);
 if(!ready)return {configured:false,runOnce:async()=>({skipped:'unconfigured'}),stop:async()=>{}};
 const repository=options.repository||require('./repository'),context=options.context||require('./capacity/context');
 const readSettings=options.readSettings||(()=>{
  const pg=options.postgres||require('./capacity/postgres');
  return pg.scoped(async(client,currentScope)=>{
   const result=await client.query('SELECT data FROM erp_metadata WHERE tenant_id=$1 AND branch_id=$2 AND key=$3',[currentScope.tenantId,currentScope.branchId,'attendanceSpotCheckSettings']);
   return result.rows[0]?.data||null;
  });
 });
 const tick=options.tickAttendanceSpotChecks||require('./personal-assistant').tickAttendanceSpotChecks;
 const clock=options.clock||require('./common').now,rng=options.rng||Math.random;
 const schedule=options.setInterval||setInterval,cancel=options.clearInterval||clearInterval,logger=options.logger||console;
 const scope=Object.freeze({tenantId,branchId,path:'attendance:spotcheck-background'});
 let stopped=false,inFlight=null;
 function safeError(error){
  const code=error&&['40001','40P01','57014','57P01','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(error.code)?error.code:'unknown';
  try{logger.error('Attendance spot-check worker failed ['+code+']; retry occurs on the next server tick.');}catch{}
 }
 function runOnce(){
  if(stopped)return Promise.resolve({skipped:'stopped'});
  if(inFlight)return inFlight;
  const pending=Promise.resolve().then(()=>context.run(scope,async()=>{
   const settings=await readSettings();
   if(stopped)return {skipped:'stopped'};
   // Disabled by default. The read path must not create arrays, schedules, audits or writes.
   if(settings?.enabled!==true)return {enabled:false,changed:false,created:0,expired:0,cancelled:0,planned:0};
   return repository.transaction(store=>{
    const result=tick(store,{at:clock(),rng});
    if(result&&typeof result.then==='function')throw Error('Spot-check callback must be synchronous');
    return result;
   });
  })).catch(error=>{safeError(error);return {failed:true};});
  inFlight=pending;
  pending.finally(()=>{if(inFlight===pending)inFlight=null;});
  return pending;
 }
 const timer=schedule(()=>{void runOnce();},60000);
 if(timer&&typeof timer.unref==='function')timer.unref();
 void runOnce();
 async function stop(){if(!stopped){stopped=true;cancel(timer);}if(inFlight)await inFlight;}
 return {configured:true,runOnce,stop};
}
module.exports={startAttendanceSpotCheckWorker};