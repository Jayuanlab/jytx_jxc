const c=require('./common');
const {notice}=require('./feishu-notices');
const text=v=>String(v||'').trim().slice(0,500);
const all=store=>store.conversionClaims||[];
function reception(store,id){const row=(store.receptions||[]).find(x=>x.id===id);if(!row)throw new c.HttpError(404,'接待单不存在');return row;}
function candidates(store,user,id){
 const source=reception(store,id);
 if(source.ownerId!==user.id&&user.roleCode!=='owner')throw new c.HttpError(403,'只能申请本人原接待的转化贡献');
 if(!source.customerId)throw new c.HttpError(409,'原接待未留手机号，不能申报同一顾客转化贡献');
 return (store.receptions||[]).filter(target=>target.customerId===source.customerId&&target.id!==source.id&&target.ownerId!==source.ownerId&&target.createdAt>source.createdAt).flatMap(target=>target.links.filter(x=>x.kind==='销售单').map(link=>({receptionId:target.id,orderId:link.id,employeeName:target.ownerName,createdAt:target.createdAt,customerMask:target.customerMask})));
}
function assessment(source,target){
 const evidence=[];
 if(source.needs?.trim())evidence.push('原接待记有顾客需求');
 if(source.recommendation?.trim())evidence.push('原接待记有推荐与顾虑');
 if(source.followUpAt)evidence.push('原接待设过回访');
 if(source.review?.trim())evidence.push('原接待有复盘');
 evidence.push('同一手机号顾客档案');
 evidence.push('甲接待早于乙成交');
 return {evidence,advice:evidence.length>=4?'记录较完整，建议老板结合实际沟通核定贡献':'现有记录较少，建议老板核实甲的跟进事实'};
}
function list(store,user){return all(store).filter(x=>user.roleCode==='owner'||x.proposerId===user.id||x.targetEmployeeId===user.id).slice().reverse();}
function submit(store,user,payload){
 const source=reception(store,payload.sourceReceptionId);
 if(source.ownerId!==user.id)throw new c.HttpError(403,'只能申报本人先前的接待');
 if(source.links.some(x=>x.kind==='销售单'))throw new c.HttpError(409,'已有销售成交的接待不能作为未成交的前次接待申报');
 const target=reception(store,payload.targetReceptionId);
 const option=candidates(store,user,source.id).find(x=>x.receptionId===target.id&&x.orderId===payload.orderId);
 if(!option)throw new c.HttpError(409,'请从同一顾客较晚的成交单中选择');
 if(all(store).some(x=>x.sourceReceptionId===source.id&&x.orderId===option.orderId))throw new c.HttpError(409,'该原接待对这笔成交已申报');
 if(all(store).some(x=>x.orderId===option.orderId&&x.status==='已认可'))throw new c.HttpError(409,'该成交单已有认可的转化贡献');
 const contribution=c.text(payload.contribution,'转化贡献说明').slice(0,500);
 if(contribution.length<10)throw new c.HttpError(400,'请至少用10字说明原接待如何促成后续成交');
 const ai=assessment(source,target);
 const row={id:c.id('CV'),sourceReceptionId:source.id,targetReceptionId:target.id,orderId:option.orderId,customerId:source.customerId,customerMask:source.customerMask,proposerId:user.id,proposerName:user.name,targetEmployeeId:target.ownerId,targetEmployeeName:target.ownerName,contribution,assessment:ai,status:'待老板判断',points:null,createdAt:c.now(),reviewedAt:null};
 store.conversionClaims ||= [];store.conversionClaims.push(row);
 source.timeline.push({at:c.now(),by:user.id,action:'申请转化贡献 '+row.id});
 c.audit(store,user,'conversion:submit',row.id+' '+option.orderId);
 notice(store,'conversion:'+row.id,'转化贡献待判断',{id:row.id,summary:source.customerMask+' · '+user.name+' 早期接待 → '+target.ownerName+' 后续成交 · '+option.orderId+' · '+ai.advice});
 return row;
}
function review(store,user,payload){
 if(user.roleCode!=='owner')throw new c.HttpError(403,'仅老板可判断转化贡献');
 const row=all(store).find(x=>x.id===payload.id);
 if(!row)throw new c.HttpError(404,'转化贡献申请不存在');
 if(row.status!=='待老板判断')throw new c.HttpError(409,'此申请已判断');
 const approve=payload.approve===true,note=text(payload.note);
 if(!approve&&!note)throw new c.HttpError(400,'不认可时请说明原因');
 if(approve&&all(store).some(x=>x.id!==row.id&&x.orderId===row.orderId&&x.status==='已认可'))throw new c.HttpError(409,'该成交单已认可另一笔转化贡献');
 const points=approve?c.number(payload.points??0,'转化贡献积分',0):0;
 if(!Number.isSafeInteger(points))throw new c.HttpError(400,'积分必须为整数');
 row.status=approve?'已认可':'未认可';row.points=points;row.reviewNote=note;row.reviewedAt=c.now();row.reviewedBy=user.id;
 const source=reception(store,row.sourceReceptionId),target=reception(store,row.targetReceptionId);
 if(approve){
  const assist={id:c.id('AS'),type:'复访转化贡献',fromId:source.ownerId,fromName:source.ownerName,toId:target.ownerId,toName:target.ownerName,detail:row.contribution,status:'有效',createdBy:source.ownerId,createdAt:row.createdAt,confirmedAt:row.reviewedAt,confirmedBy:user.id,conversionClaimId:row.id};
  target.assists.push(assist);row.assistId=assist.id;
  target.timeline.push({at:c.now(),by:user.id,action:'认可前次接待转化贡献 '+row.id});
  if(points)source.points.push({id:c.id('PT'),kind:'转化贡献',employeeId:source.ownerId,employeeName:source.ownerName,amount:points,confirmedBy:user.id,at:c.now(),claimId:row.id});
 }
 source.timeline.push({at:c.now(),by:user.id,action:'老板判断转化贡献 '+row.status});
 c.audit(store,user,'conversion:review',row.id+' '+row.status+' '+points);
 notice(store,'conversion-reviewed:'+row.id,'转化贡献已判断',{id:row.id,summary:source.customerMask+' · '+row.status+' · '+points+' 积分 · '+row.orderId});
 return row;
}
module.exports={candidates,list,submit,review,assessment};

module.exports.submit=require('./reception-availability').assertEnabled;module.exports.review=require('./reception-availability').assertEnabled;module.exports.list=()=>[];
