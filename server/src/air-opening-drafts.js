const c = require('./common');
const dailyClose = require('./daily-close');
const { notice } = require('./feishu-notices');
function dateOf(value) {
 const date=c.text(value,'期初起始日期');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>c.day())throw new c.HttpError(400,'期初日期须为今天或之前的有效日期');
 return date;
}
function values(payload){
 const amount=c.money(payload.amount,'期初起始余额');if(amount<=0)throw new c.HttpError(400,'期初余额须大于零');
 const evidence=c.text(payload.evidence,'期初核对依据').slice(0,500);if(evidence.length<4)throw new c.HttpError(400,'请写明期初余额的核对依据');
 return {amount,evidence,businessDate:dateOf(payload.businessDate)};
}
function list(store,user){c.permit(user,'sell');const opening=(store.airRechargeEvents||[]).find(r=>r.kind==='opening');return {rows:(store.airOpeningDrafts||[]).filter(r=>user.roleCode==='owner'||r.staffId===user.id).slice().reverse(),hasOpening:!!opening,opening:opening?{amount:opening.amount,businessDate:opening.businessDate}:null};}
function submit(store,user,payload){
 c.permit(user,'sell');if(user.roleCode==='owner')throw new c.HttpError(400,'老板请直接确认期初');
 if((store.airRechargeEvents||[]).some(r=>r.kind==='opening'))throw new c.HttpError(409,'期初已确认，请刷新后开充值单');
 const input=values(payload);store.airOpeningDrafts||=[];
 if(store.airOpeningDrafts.some(r=>r.staffId===user.id&&r.status==='待确认'))throw new c.HttpError(409,'你已提交期初资料，请等老板确认；可点刷新查看');
 const row={id:c.id('AOD'),...input,status:'待确认',staffId:user.id,staffName:user.name,submittedAt:c.now()};store.airOpeningDrafts.push(row);
 c.audit(store,user,'air-opening:submit',row.id+' '+row.amount+' '+row.businessDate);
 notice(store,'air-opening:'+row.id,'空充期初待老板核对',{id:row.id,summary:user.name+'提交 '+row.businessDate+' 起始余额 '+row.amount+' 元；请确认'});return row;
}
function ownerOnly(user){if(user.roleCode!=='owner')throw new c.HttpError(403,'只有老板能确认期初入账');}
function settleOtherDrafts(store,user,entryId,exceptId){for(const row of store.airOpeningDrafts||[])if(row.status==='待确认'&&row.id!==exceptId){row.status='已结束';row.entryId=entryId;row.decidedAt=c.now();row.decidedBy=user.id;row.decisionNote='老板已确认本账套期初，无需重复登记';c.audit(store,user,'air-opening:superseded',row.id+' '+entryId);}}
function register(store,user,payload){
 ownerOnly(user);const input=values(payload);
 if((store.airOpeningDrafts||[]).some(r=>r.status==='待确认'))throw new c.HttpError(409,'已有营业员提交的期初资料，请在下方核对并确认或退回');
 const entry=dailyClose.airEntry(store,user,{kind:'opening',...input,reference:'期初核对-'+c.id('AOD'),note:'老板核对期初；'+input.evidence});return {...entry,status:'已入账'};
}
function decide(store,user,payload){
 ownerOnly(user);const row=(store.airOpeningDrafts||[]).find(r=>r.id===payload.id);
 if(!row)throw new c.HttpError(404,'期初资料不存在');if(row.status!=='待确认')throw new c.HttpError(409,'此资料已处理，请刷新查看');if(typeof payload.approve!=='boolean')throw new c.HttpError(400,'须明确确认或退回');
 const note=String(payload.note||'').trim().slice(0,500);
 if(payload.approve){const entry=dailyClose.airEntry(store,user,{kind:'opening',amount:row.amount,businessDate:dateOf(row.businessDate||c.day()),reference:'期初核对-'+row.id,note:'营业员 '+row.staffName+' 提交；'+row.evidence+(note?'；老板核对：'+note:'')});row.entryId=entry.id;row.status='已入账';settleOtherDrafts(store,user,entry.id,row.id);}else row.status='已驳回';
 row.decidedAt=c.now();row.decidedBy=user.id;row.decisionNote=note;c.audit(store,user,'air-opening:decide',row.id+' '+row.status);return row;
}
function action(store,user,payload){if(payload.action==='submit')return submit(store,user,payload);if(payload.action==='register')return register(store,user,payload);if(payload.action==='decide')return decide(store,user,payload);throw new c.HttpError(400,'期初操作不正确');}
module.exports={list,submit,decide,register,action};
