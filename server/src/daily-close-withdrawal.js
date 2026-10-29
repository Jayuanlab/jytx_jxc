'use strict';
const c=require('./common'),master=require('./master-data'),{createHash}=require('node:crypto');
const STATUS='已撤回',allowed=['待领取复核','复核中','待老板签认','已驳回','已解锁'];
function version(row){return createHash('sha256').update(JSON.stringify([row.id,row.status,row.submittedAt,row.manual,row.actualCash,row.openingCash,row.snapshot?.fingerprint,(row.events||[]).length])).digest('hex');}
function meta(row,user){return {canWithdraw:allowed.includes(row.status)&&(user.roleCode==='owner'||row.cashierId===user.id),withdrawalVersion:version(row)};}
function withdraw(store,user,payload){
 const who=master.actor(store,user),row=(store.dailyCloseouts||[]).find(r=>r.id===payload.id);if(!row)throw new c.HttpError(404,'结账单不存在');
 if(who.roleCode!=='owner'&&row.cashierId!==who.id)throw new c.HttpError(403,'只能撤回本人结账单，或由老板办理');
 if(row.status==='已锁定')throw new c.HttpError(409,'已锁定结账单须先由老板解锁');
 if(!allowed.includes(row.status))throw new c.HttpError(409,'结账单已处理或已撤回，请刷新');
 if(payload.version!==version(row))throw new c.HttpError(409,'结账单状态已变化，请刷新后再撤回');
 if(payload.confirmed!==true)throw new c.HttpError(400,'请确认撤回本次提交，原提交证据会保留');
 const at=c.now(),evidence=structuredClone({submissionVersion:(row.withdrawnSubmissions||[]).length+1,status:row.status,submittedAt:row.submittedAt,cashierId:row.cashierId,cashier:row.cashier,reviewerId:row.reviewerId,reviewer:row.reviewer,date:row.date,openingCash:row.openingCash,actualCash:row.actualCash,expectedCash:row.expectedCash,cashDifference:row.cashDifference,manual:row.manual,snapshot:row.snapshot,note:row.note,checks:row.checks,reviewNote:row.reviewNote,reviewedAt:row.reviewedAt,events:row.events||[]});
 row.withdrawnSubmissions||=[];row.withdrawnSubmissions.push({...evidence,withdrawnAt:at,withdrawnBy:who.id,withdrawnByName:who.name,withdrawalNote:String(payload.note||'撤回后重新核对填写').trim().slice(0,500)});
 row.status=STATUS;row.withdrawnAt=at;row.withdrawnBy=who.id;row.withdrawnByName=who.name;row.events||=[];row.events.push({type:'撤回提交（原提交保留）',by:who.id,name:who.name,at,note:String(payload.note||'').trim().slice(0,500)});
 for(const key of ['feishuNotices','localCatalogNotices'])for(const n of store[key]||[])if(n.orderId===row.id||n.key===('daily-close:'+row.id)||n.key?.startsWith('daily-close-resubmit:'+row.id+':')){n.readAt||=at;n.resolution='结账提交已撤回，原消息及提交证据保留';}
 c.audit(store,who,'daily-close:withdraw',{id:row.id,date:row.date,submissionVersion:row.withdrawnSubmissions.length,originalCashierId:row.cashierId});
 return {id:row.id,status:row.status,originalSubmissionRetained:true,businessFlowsChanged:false,message:'已撤回，原提交保留；可补正后重新提交'};
}
module.exports={STATUS,allowed,version,meta,withdraw};
