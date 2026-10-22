const c=require('./common');
function detail(store,user,id){
 c.permit(user,'manageUsers');
 const log=(store.operationLogs||[]).find(x=>x.id===String(id||''));if(!log)throw new c.HttpError(404,'操作记录不存在');
 const key=String(log.detail||'').trim().split(/[\s·]/)[0],row=(store.receptions||[]).find(x=>x.id===key);
 const actions={'reception:create':'接待建档','reception:update':'更新接待/复盘','reception:supplement':'补充顾客资料'};
 let event=row?.timeline?.find(t=>t.auditLogId===log.id)||null;
 if(!event&&row&&actions[log.action]){
  const candidates=(row.timeline||[]).filter(t=>!t.auditLogId&&t.by===log.operatorId&&t.action===actions[log.action]&&Date.parse(t.at)<=Date.parse(log.createdAt)&&Date.parse(log.createdAt)-Date.parse(t.at)<=2000);
  if(candidates.length===1){const t=candidates[0];const logs=(store.operationLogs||[]).filter(x=>x.operatorId===log.operatorId&&x.action===log.action&&String(x.detail||'').trim().split(/[\s·]/)[0]===key&&Date.parse(t.at)<=Date.parse(x.createdAt)&&Date.parse(x.createdAt)-Date.parse(t.at)<=2000);if(logs.length===1)event=t;}
 }

 return {log:{id:log.id,operator:log.operator,operatorId:log.operatorId,action:log.action,detail:log.detail,createdAt:log.createdAt},changes:event?.changes||[],reception:row?{id:row.id,purpose:row.purpose,status:row.status,customerMask:row.customerMask}:null};
}
module.exports={detail};
