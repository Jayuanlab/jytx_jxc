'use strict';
const c = require('./common');
const history = require('./air-history-service');
const { notice } = require('./feishu-notices');
const PENDING = new Set(['待店长初审', '待老板终审']);
const isActive = user => user && user.status === 'active' && user.roleCode !== 'owner' &&
  !String(user.id || '').startsWith('demo-') && !user.assistantCustomerOnly &&
  !['customer-assistant', 'personal-assistant'].includes(user.roleCode);
function permitActor(store,user,submit=false) {
  if(user.roleCode==='owner') return;
  if(!isActive((store.users||[]).find(item=>item.id===user.id))) throw new c.HttpError(403,'请使用在职员工账号');
  if(submit && user.id!==store.personnelConfig?.managerId) c.permit(user,'sell');
}
function currentManager(store) {
  const user = (store.users || []).find(item => item.id === store.personnelConfig?.managerId);
  if (!isActive(user)) throw new c.HttpError(409, '尚未任命有效店长，请先到人事管理任命');
  return user;
}
function notifyOwner(store,row) {
  try {
    const delivered=notice(store,'air-history-owner-review:'+row.id,'移动业务·历史空充补单待老板终审',{
      id:row.id,summary:row.submittedBy+'提交；店长'+row.managerName+'初审；'+row.previewRows.length+'项资料，预览BOSS余额¥'+row.bookBalance+'；请到 /air-history?draft='+encodeURIComponent(row.id)+' 核对原单',
    });
    if (delivered && typeof delivered.catch === 'function') delivered.catch(()=>{});
  } catch (_) { /* notification failure must not discard a valid review */ }
}
function view(row) {
  return {id:row.id,version:row.version,status:row.status,submittedById:row.submittedById,
    submittedBy:row.submittedBy,submittedAt:row.submittedAt,managerId:row.managerId,
    managerName:row.managerName,managerApproval:row.managerApproval || null,
    managerBypassed:row.managerBypassed === true,ownerApproval:row.ownerApproval || null,
    rejectedBy:row.rejectedBy || null,rejectedAt:row.rejectedAt || null,
    rejectReason:row.rejectReason || null,bookBalance:row.bookBalance,
    observedBalance:row.observedBalance,pendingCount:row.pendingCount,
    receiptChange:row.receiptChange,openingSource:row.payload.opening?.sourceNote || null,
    observationSource:row.payload.observation?.sourceNote || null,
    rows:row.previewRows,insertedIds:row.insertedIds || []};
}
function list(store,user) {
  permitActor(store,user);
  let manager = null;
  try {const u=currentManager(store); manager={id:u.id,name:u.name};}
  catch(error) {if(error.status !== 409) throw error;}
  return {manager,drafts:(store.airHistoryDrafts || []).filter(row =>
    user.roleCode === 'owner' || row.submittedById === user.id || row.managerId === user.id)
    .slice().reverse().map(view)};
}
function submit(store,user,payload) {
  permitActor(store,user,true);
  if (user.roleCode === 'owner') throw new c.HttpError(403,'请由营业员或店长提交，老板负责终审');
  if (!isActive((store.users || []).find(item => item.id === user.id)))
    throw new c.HttpError(403,'请使用在职员工账号提交');
  const manager=currentManager(store);
  if ((store.airHistoryDrafts || []).some(row => PENDING.has(row.status)))
    throw new c.HttpError(409,'已有历史空充补单正在审核，请先处理原申请');
  const expected=c.text(payload.previewToken,'预览校验码');
  const result=history.preview(store,user,payload);
  if (result.token !== expected) throw new c.HttpError(409,'表格或台账已变化，请重新预览');
  if (result.hasMismatch && !result.observationOnly)
    throw new c.HttpError(409,'账面与BOSS余额不一致，请核对真实单据');
  const clean=JSON.parse(JSON.stringify({opening:payload.opening || null,
    rows:Array.isArray(payload.rows)?payload.rows:[],observation:payload.observation || null}));
  const ownManager=manager.id === user.id;
  const row={id:c.id('AHD'),version:1,status:ownManager?'待老板终审':'待店长初审',
    submittedById:user.id,submittedBy:user.name,submittedAt:c.now(),
    managerId:manager.id,managerName:manager.name,managerBypassed:ownManager,
    payload:clean,previewToken:result.token,bookBalance:result.bookBalance,
    observedBalance:result.observedBalance,pendingCount:result.pendingCount,
    receiptChange:result.receiptChange,previewRows:result.rows};
  store.airHistoryDrafts ||= [];
  store.airHistoryDrafts.push(row);
  c.audit(store,user,'air-recharge:history-submit',row.id+' '+row.status+' 账面'+row.bookBalance);
  if (ownManager) notifyOwner(store,row);
  return {draft:view(row),message:ownManager?'店长本人补单，已送老板终审':'已送店长 '+manager.name+' 初审；审批前不入账'};
}
function review(store,user,payload) {
  permitActor(store,user);
  const row=(store.airHistoryDrafts || []).find(item => item.id === c.text(payload.id,'历史补单'));
  if (!row) throw new c.HttpError(404,'历史补单不存在');
  if (row.version !== payload.version) throw new c.HttpError(409,'补单已变化，请刷新后重审');
  const decision=String(payload.decision || ''),note=String(payload.note || '').trim().slice(0,500);
  if (!['approve','reject'].includes(decision)) throw new c.HttpError(400,'请选择通过或驳回');
  if (decision === 'reject' && !note) throw new c.HttpError(400,'驳回请说明原因');
  if (user.roleCode !== 'owner') {
    if (row.status !== '待店长初审' || row.managerId !== user.id || currentManager(store).id !== user.id)
      throw new c.HttpError(403,'这张补单当前不由您初审');
    if (row.submittedById === user.id) throw new c.HttpError(403,'店长不能初审本人补单');
    row.status=decision === 'approve'?'待老板终审':'店长驳回';
    if (decision === 'approve') { row.managerApproval={byId:user.id,by:user.name,at:c.now(),note}; notifyOwner(store,row); }
  } else {
    if (decision === 'approve' && row.status !== '待老板终审')
      throw new c.HttpError(409,'请先由店长初审；店长本人补单可直接终审');
    if (decision === 'reject' && !PENDING.has(row.status)) throw new c.HttpError(409,'补单已处理');
    if (row.submittedById === user.id) throw new c.HttpError(403,'不能终审本人补单');
    if (decision === 'approve') {
      if (!row.managerBypassed && (!row.managerApproval || row.managerApproval.byId === row.submittedById || row.managerApproval.byId === user.id))
        throw new c.HttpError(409,'缺少独立店长初审');
      const checked=history.preview(store,user,row.payload);
      if (checked.token !== row.previewToken) throw new c.HttpError(409,'正式台账或扎账状态已变化，请驳回并重新提交');
      if (checked.hasMismatch && !checked.observationOnly) throw new c.HttpError(409,'余额差异尚未解决');
      const saved=history.commit(store,user,{...row.payload,previewToken:checked.token});
      row.insertedIds=saved.insertedIds;
      row.ownerApproval={byId:user.id,by:user.name,at:c.now(),note};
      row.status='已批准入账';
      for (const item of store.airRechargeEvents || []) if (row.insertedIds.includes(item.id)) {
        item.approvedDraftId=row.id;
        item.managerApprovedById=row.managerApproval?.byId || null;
        item.ownerApprovedById=user.id;
      }
    } else row.status='老板驳回';
  }
  if (decision === 'reject') {row.rejectedBy=user.name;row.rejectedAt=c.now();row.rejectReason=note;}
  row.version++;
  c.audit(store,user,'air-recharge:history-review',row.id+' '+row.status+' '+note);
  return {draft:view(row),message:row.status === '已批准入账'?
    '老板终审通过，历史空充已入账；请刷新后办理今日充值':row.status};
}
module.exports={list,submit,review};