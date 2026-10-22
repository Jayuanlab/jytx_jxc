'use strict';
// Fixed read-only systemd metadata. Never opens dump files or changes their permissions.
const {execFile}=require('node:child_process');
const {permit}=require('./ops-faults');
const RESTORE_DRILL=Object.freeze({at:null,passed:false,cleanupVerified:false,scope:'恢复演练状态待核实'});
const PROPERTIES=['LoadState','UnitFileState','ActiveState','Result','ExecMainStatus','ExecMainExitTimestamp','LastTriggerUSec','NextElapseUSecRealtime'];
function command(args){return new Promise((resolve,reject)=>execFile('systemctl',args,{timeout:2000,maxBuffer:16384,env:{...process.env,LANG:'C',LC_ALL:'C'}},(error,stdout)=>error?reject(error):resolve(stdout)));}
function date(value){const m=String(value||'').match(/(?:^|\s)(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? (UTC|CST|[+-]\d{4})$/);if(!m)return null;const zone=m[3]==='CST'?'+08:00':m[3]==='UTC'?'Z':m[3].slice(0,3)+':'+m[3].slice(3);const n=Date.parse(m[1]+'T'+m[2]+zone);return Number.isFinite(n)?new Date(n).toISOString():null;}
function properties(text){return Object.fromEntries(String(text).split('\n').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));}
function createInspector({run=command,now=()=>Date.now()}={}){
 let cached=null,expires=0,pending=null;
 async function inspect(){
  if(cached&&now()<expires)return cached;if(pending)return pending;
  pending=(async()=>{
   const units=['store-erp-postgres-backup.timer','store-erp-postgres-backup.service'];
   const probes=await Promise.allSettled(units.map(unit=>run(['show',unit,'--property='+PROPERTIES.join(',')])));
   const timer=probes[0].status==='fulfilled'?properties(probes[0].value):{},service=probes[1].status==='fulfilled'?properties(probes[1].value):{};
   const known=probes.every(p=>p.status==='fulfilled')&&timer.LoadState==='loaded'&&service.LoadState==='loaded';
   const lastSuccessfulTaskAt=service.Result==='success'&&service.ExecMainStatus==='0'?date(service.ExecMainExitTimestamp):null;
   let state='healthy',message='最近备份任务成功';
   if(!known){state='unavailable';message='自动备份任务状态暂无法确认，请联系管理员核查';}
   else if(service.Result&&service.Result!=='success'||service.ExecMainStatus&&service.ExecMainStatus!=='0'){state='failed';message='最近一次自动备份任务失败，请尽快联系管理员；没有删除旧备份';}
   else if(service.ActiveState==='activating'||service.ActiveState==='active'){state='running';message='自动备份任务正在运行';}
   else if(timer.UnitFileState!=='enabled'||timer.ActiveState!=='active'){state='warning';message='自动备份计划未正常启用，请联系管理员';}
   else if(!lastSuccessfulTaskAt){state='warning';message='尚未确认成功的备份任务，请联系管理员';}
   else if(now()-Date.parse(lastSuccessfulTaskAt)>36*60*60*1000){state='warning';message='最近成功任务已超过36小时，请联系管理员核查';}
   cached={restoreDrill:RESTORE_DRILL,checkedAt:new Date(now()).toISOString(),automatic:{state,message,enabled:timer.UnitFileState==='enabled',taskVerified:known,fileVerified:false,lastRunAt:date(timer.LastTriggerUSec),lastSuccessfulTaskAt,nextRunAt:date(timer.NextElapseUSecRealtime),lastBackupAt:null,latestBytes:null,completedBackupCount:null,schedule:'每小时30分（北京时间）',scope:'本机 PostgreSQL 定时备份任务状态'},notes:['页面只读系统任务元数据，不读取或核验备份文件，不执行恢复、不删除备份。','手动下载的门店备份与服务器数据库自动备份分别管理。','本次没有配置异地传输；数据库恢复演练不等于包含应用文件、角色与密钥的整机灾难恢复。']};expires=now()+30000;return cached;
  })();try{return await pending}finally{pending=null;}
 }
 return {inspect};
}
const inspector=createInspector();async function status(user){permit(user);const [data,health]=await Promise.all([inspector.inspect(),require('./operational-health').status(user)]);return {...data,automatic:{...data.automatic,schedule:health.automatic.schedule||'每小时30分（北京时间）'},restoreDrill:{at:health.restore.at,passed:health.restore.passed,cleanupVerified:health.restore.cleanupVerified,scope:health.restore.scope}};}
module.exports={status,createInspector,date};
