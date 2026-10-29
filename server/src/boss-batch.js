'use strict';
const c=require('./common'),journal=require('./work-journal'),receptions=require('./receptions'),catalog=require('./catalog-reviews'),crypto=require('crypto');
function owner(user){if(user.roleCode!=='owner')throw new c.HttpError(403,'仅老板可批量核对');}
function prelim(store,r,kind){
 if(kind==='receptionDuplicate'){
  const original=(store.receptions||[]).find(x=>x.id===r.duplicateOf);
  return original?{decision:'建议判无效，零积分',level:'ready',reason:'系统标记同一时段原单 '+original.id+'；老板请核对手机号和接待时间。'}:{decision:'需单独审核',level:'manual',reason:'找不到重复来源原单，不能直接批量核定。'};
 }
 const reasons=[];
 if(!String(r.event||'').trim()||!String(r.result||'').trim())reasons.push('事项或结果缺失');
 if(!String(r.evidenceNote||'').trim()&&!r.linked&&!r.parcelNo)reasons.push('缺少依据说明、关联原单或快递单号');
 if(r.type==='商品入库'&&(!r.linked||r.linked.kind!=='purchase'||!(store.purchases||[]).some(x=>x.id===r.linked.id)))reasons.push('关联入库原单不存在');
 if(r.type==='拿快递'&&!r.parcelNo)reasons.push('未见快递单号');
 return reasons.length?{decision:'需单独审核',level:'manual',reason:reasons.join('；')+'。'}:{decision:'建议批量核定',level:'ready',reason:'事项、结果和依据已登记；真实性与积分由老板核对后拍板。'};
}
function signature(rows){return crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>[r.id,r.version||1,r.status,r.duplicateOf||'',r.event||'',r.result||'',r.evidenceNote||'',r.linked?.id||'',r.parcelNo||'',r.kind||'',r.sourceId||'',r.name||'',r.current||null]))).digest('hex');}
function catalogPrelim(row){if(row.status!=='待老板核对')return {decision:'需单独审核',level:'manual',reason:'此前已退回待完善，请单独核对修改结果。'};if(!row.current)return {decision:'需单独审核',level:'manual',reason:'原始档案已找不到，不能批量确认。'};if(String(row.current.name||'').trim()!==String(row.name||'').trim())return {decision:'需单独审核',level:'manual',reason:'现档名称与申请时不同，请单独核对。'};return {decision:'建议批量确认',level:'ready',reason:'原档仍存在，名称一致；请老板核对明细后拍板。'};}
function list(store,user){
 owner(user);const groups=new Map();
 for(const r of store.workJournals||[])if(r.status==='待核定'){
  const key='journal:'+r.type;
  if(!groups.has(key))groups.set(key,{key,kind:'journal',label:'工作日志 · '+r.type,priority:2,rows:[]});
  groups.get(key).rows.push({id:r.id,employee:r.employeeName,at:r.occurredAt||r.createdAt,detail:[r.event,r.result,r.evidenceNote].filter(Boolean).join('；'),type:r.type,prelim:prelim(store,r,'journal'),version:r.version||1,event:r.event,result:r.result,evidenceNote:r.evidenceNote,linked:r.linked,parcelNo:r.parcelNo,status:r.status});
 }
 const kinds={supplier:'往来单位',product:'商品',paymentAccount:'收付款账户',businessOption:'业务选项'};
 for(const r of catalog.list(store,user))if(['待老板核对','需完善'].includes(r.status)){const key='catalog:'+r.kind;if(!groups.has(key))groups.set(key,{key,kind:'catalog',label:'新增档案 · '+(kinds[r.kind]||r.kind),priority:1,rows:[]});groups.get(key).rows.push({id:r.id,employee:r.requester||'',at:r.createdAt,detail:[r.name,r.sourceId,r.current?'现档仍存在':'现档缺失'].filter(Boolean).join('；'),kind:r.kind,sourceId:r.sourceId,name:r.name,status:r.status,current:r.current,prelim:catalogPrelim(r)});}
 const dup=[]; // Reception module suspended; do not present archived claims as tasks.
 if(dup.length)groups.set('reception:duplicate',{key:'reception:duplicate',kind:'receptionDuplicate',label:'疑似重复接待 · 无效零积分',priority:0,rows:dup.map(r=>({id:r.id,employee:r.ownerName,at:r.createdAt,detail:[r.customerMask,r.purpose,'原单 '+r.duplicateOf].filter(Boolean).join('；'),prelim:prelim(store,r,'receptionDuplicate'),version:r.version||1,duplicateOf:r.duplicateOf,status:r.status}))});
 return {groups:[...groups.values()].map(g=>({...g,prelimSubmittedAt:c.now(),prelimToken:signature(g.rows)})).sort((a,b)=>a.priority-b.priority||b.rows.length-a.rows.length),asOf:c.now()};
}
function decide(store,user,payload){
 owner(user);const current=list(store,user).groups.find(g=>g.key===payload.key);
 if(!current)throw new c.HttpError(409,'同类待办已变化，请刷新');
 if(typeof payload.prelimToken!=='string'||payload.prelimToken!==current.prelimToken)throw new c.HttpError(409,'工作助理初审或原单已变化，请刷新并重新核对');
 const ids=payload.ids;
 const limit=current.kind==='catalog'?100:30;if(!Array.isArray(ids)||!ids.length||ids.length>limit||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw new c.HttpError(400,'请选择1至'+limit+'张不重复的单据');
 const selected=ids.map(id=>current.rows.find(r=>r.id===id));if(selected.some(r=>!r))throw new c.HttpError(409,'选中单据已变化，请刷新');
 if(selected.some(r=>r.prelim.level!=='ready'))throw new c.HttpError(409,'所选单据有初审疑点，请先在原单逐项处理');
 const note=String(payload.note||'').trim().slice(0,1000);
 if(current.kind==='receptionDuplicate'){
  if(payload.approve!==false)throw new c.HttpError(400,'疑似重复接待只能按无效零积分核定');
  return {kind:current.kind,ids:ids.map(id=>receptions.confirmClose(store,user,{id,validity:'无效',points:0}).id),status:'已判无效'};
 }
 if(typeof payload.approve!=='boolean')throw new c.HttpError(400,'请选择核定结果');
 if(current.kind==='catalog')return {kind:current.kind,ids:ids.map(id=>catalog.review(store,user,{id,decision:payload.approve?'confirm':'needs_changes',note}).id),status:payload.approve?'已确认':'需完善'};
 const points=payload.approve?Number(payload.points):0;
 if(!Number.isSafeInteger(points)||points<0)throw new c.HttpError(400,'核定积分必须为非负整数');
 return {kind:current.kind,ids:ids.map(id=>journal.review(store,user,{id,approve:payload.approve,points,note}).id),status:payload.approve?'已核定':'未通过'};
}
module.exports={list,decide};
