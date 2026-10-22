/* Owner-only metadata. No business records, dump contents or credentials are read. */
'use strict';
const fs=require('node:fs/promises'),constants=require('node:fs').constants;
const {permit}=require('./ops-faults');
const SNAPSHOT='/opt/store-erp/ops-summary/monitor.json',MAX_AGE=15*60*1000;
const MESSAGES=Object.freeze({APPLICATION_HEALTH_FAILED:'服务未通过响应检查，请管理员核查',RECOVERY_POINT_STALE:'程序与数据库配套恢复点尚未确认或已超过36小时',RECOVERY_POINT_FAILED:'最近配套恢复点生成失败，请管理员核查',RESTORE_DRILL_FAILED:'最近隔离恢复演练失败，请管理员核查',RESTORE_DRILL_STALE:'隔离恢复演练尚未确认或已超过8天',APPLICATION_NOT_RUNNING:'服务任务未确认运行，请管理员核查',BACKUP_TASK_UNAVAILABLE:'无法核实备份任务',BACKUP_TASK_FAILED:'最近自动备份失败，旧备份仍保留',BACKUP_TIMER_DISABLED:'自动备份计划未正常启用',NO_COMPLETED_ARCHIVE:'没有确认完整备份文件',BACKUP_MANIFEST_UNVERIFIED:'备份可读取，但逐份校验清单尚未确认',BACKUP_STALE:'最近完整备份已超过3小时',BACKUP_RECORDED_FAILURE:'备份记录提示最近任务失败，旧备份仍保留',DISK_SPACE_CRITICAL:'备份磁盘空间不足，需管理员处理',DISK_SPACE_WARNING:'备份磁盘剩余空间较少',RETENTION_REVIEW:'已有超过720份备份，建议确认异地保存后人工整理；未自动删除',OFFSITE_NOT_CONFIGURED:'异地备份未配置，本机故障仍可能影响备份',COMMAND_TIMEOUT:'最新备份校验超时，请管理员核查',COMMAND_FAILED:'最新备份校验未通过，请管理员核查',COMMAND_UNAVAILABLE:'备份校验工具暂不可用',EMPTY_ARCHIVE:'最新备份为空，需管理员核查',ARCHIVE_CHANGED:'最新备份在验证时发生变化，请管理员核查',UNSAFE_ARCHIVE:'最新备份路径未通过安全检查',OPERATIONS_PROBE_FAILED:'运行监测任务未完成，请管理员核查'});
function date(value){const n=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(n)?new Date(n).toISOString():null;}
function integer(value){return Number.isSafeInteger(value)&&value>=0?value:null;}
function state(value){return ['healthy','warning','failed','unavailable'].includes(value)?value:'unavailable';}
async function readSnapshot(){let handle;try{handle=await fs.open(SNAPSHOT,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const st=await handle.stat();if(!st.isFile()||st.size>65536||st.uid!==0||(st.mode&0o022))throw Error('UnsafeSnapshot');return JSON.parse(await handle.readFile('utf8'));}finally{await handle?.close();}}
function unavailable(at,reason){return {checkedAt:new Date(at).toISOString(),state:'unavailable',application:{state:'unavailable'},automatic:{state:'unavailable',taskVerified:false,fileVerified:false,manifestVerified:false,lastSuccessfulTaskAt:null,nextRunAt:null,lastBackupAt:null,latestBytes:null,completedBackupCount:null},disk:{state:'unavailable',totalBytes:null,freeBytes:null,usedPercent:null},retention:{mode:'keep-all',automaticDeletion:false,completedCopies:null,totalBytes:null,reviewRecommended:false},restore:{state:'unverified',at:null,passed:false,cleanupVerified:false,scope:'本机临时数据库恢复验证；不代表整机或异地灾难恢复'},offsite:{state:'unverified',configured:null,lastVerifiedAt:null},issues:[{code:reason,severity:'warning',message:reason==='MONITOR_STALE'?'运行监测摘要已过期，当前备份状态无法确认':'运行监测摘要尚未可用，当前备份状态无法确认'}],notes:['缺少或过期证据不表示正常。','不读取备份内容、经营记录或凭据，不执行恢复或删除。']};}
function project(raw,at){
 const checkedAt=date(raw?.checkedAt),stamp=checkedAt?Date.parse(checkedAt):NaN;
 if(!raw||raw.schemaVersion!==1||!checkedAt||stamp>at+120000)return unavailable(at,'MONITOR_UNAVAILABLE');
 if(at-stamp>MAX_AGE)return unavailable(at,'MONITOR_STALE');
 const a=raw.automatic||{},d=raw.disk||{},r=raw.restore||{},ret=raw.retention||{};
 const issues=(Array.isArray(raw.issues)?raw.issues:[]).filter(x=>x&&MESSAGES[x.code]&&['warning','error'].includes(x.severity)).slice(0,30).map(x=>({code:x.code,severity:x.severity,message:MESSAGES[x.code]}));
 const automatic={state:state(a.state),taskVerified:a.taskVerified===true,fileVerified:a.fileVerified===true,manifestVerified:a.manifestVerified===true,lastSuccessfulTaskAt:date(a.lastSuccessfulTaskAt),nextRunAt:date(a.nextRunAt),lastBackupAt:date(a.lastBackupAt),latestBytes:integer(a.latestBytes),completedBackupCount:integer(a.completedBackupCount),schedule:'每小时30分（北京时间）'};
 if(automatic.state==='healthy'&&(!automatic.taskVerified||!automatic.fileVerified||!automatic.manifestVerified||!automatic.lastBackupAt||!automatic.lastSuccessfulTaskAt||automatic.latestBytes===null||automatic.completedBackupCount===null))automatic.state='unavailable';
 const disk={state:state(d.state),totalBytes:integer(d.totalBytes),freeBytes:integer(d.freeBytes),usedPercent:integer(d.usedPercent)};
 if(disk.state==='healthy'&&(!disk.totalBytes||disk.freeBytes===null||disk.freeBytes>disk.totalBytes||disk.usedPercent===null||disk.usedPercent>100))disk.state='unavailable';
 const restoreAt=date(r.at),restoreVerified=r.state==='verified'&&r.passed===true&&r.cleanupVerified===true&&!!restoreAt&&!issues.some(x=>x.code==='RESTORE_DRILL_FAILED'||x.code==='RESTORE_DRILL_STALE');
 const offsite={state:'unconfigured',configured:false,lastVerifiedAt:null,requirements:['异地对象存储的服务商、区域、桶和目录，或独立主机地址','仅服务端使用的最小权限凭据和加密方式','保留天数、预算及远端读回校验']};
 if(!issues.some(x=>x.code==='OFFSITE_NOT_CONFIGURED'))issues.push({code:'OFFSITE_NOT_CONFIGURED',severity:'warning',message:MESSAGES.OFFSITE_NOT_CONFIGURED});
 const application={state:state(raw.application?.state)},overall=[automatic.state,disk.state,application.state];
 const overallState=overall.includes('failed')||issues.some(x=>x.severity==='error')?'failed':overall.includes('unavailable')?'unavailable':'warning';
 return {checkedAt,state:overallState,application,automatic,disk,retention:{mode:'keep-all',automaticDeletion:false,completedCopies:integer(ret.completedCopies),totalBytes:integer(ret.totalBytes),reviewRecommended:ret.reviewRecommended===true},restore:{state:restoreVerified?'verified':'unverified',at:restoreVerified?restoreAt:null,passed:restoreVerified,cleanupVerified:restoreVerified,scope:'本机临时数据库恢复验证；不代表整机或异地灾难恢复'},offsite,issues,notes:['只记录技术摘要，不含备份内容、经营数据或凭据。','所有已完成备份保留；只有本次失败的独占临时文件可清理。','同机数据库恢复通过，不等于异地或整机灾难恢复。']};
}
function createInspector({read=readSnapshot,now=()=>Date.now()}={}){let cached=null,expires=0,pending=null;async function inspect(){const at=now();if(cached&&at<expires)return cached;if(pending)return pending;pending=(async()=>{try{cached=project(await read(),at);}catch{cached=unavailable(at,'MONITOR_UNAVAILABLE');}expires=at+30000;return cached;})();try{return await pending;}finally{pending=null;}}return {inspect};}
const inspector=createInspector();async function status(user){permit(user);return inspector.inspect();}
module.exports={status,createInspector,project};
