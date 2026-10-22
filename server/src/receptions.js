const c = require('./common');
const intake = require('./reception-intake');
const { notice } = require('./feishu-notices');
const clean = (v, n=300) => String(v || '').trim().slice(0,n);
const manager = u => ['owner','manager'].includes(u.roleCode);
const requireManager = u => { if (u.roleCode!=='owner') throw new c.HttpError(403,'仅老板可确认接待与积分'); };
const masked = phone => phone.slice(0,3)+'****'+phone.slice(-4);
function settings(store) { return {basic:50,wechat:null,assist:null,...store.receptionPointRules}; }
function customer(store,phone) { return (store.customers||[]).find(x=>x.phone===phone); }
function byId(store,id) { const row=(store.receptions||[]).find(x=>x.id===id); if(!row)throw new c.HttpError(404,'接待单不存在'); return row; }
function readable(row,user) { return manager(user)||row.ownerId===user.id||(row.assists||[]).some(x=>x.fromId===user.id||x.toId===user.id); }
function own(row,user) { if(!manager(user)&&row.ownerId!==user.id)throw new c.HttpError(403,'仅接待人可修改本单'); }
function list(store,user) { return {rules:settings(store),rows:(store.receptions||[]).filter(x=>readable(x,user)||x.status==='接待中'||x.status==='待回访'||x.status==='已转业务').map(x=>readable(x,user)?({...x,mobileAppLoggedIn:typeof x.mobileAppLoggedIn==='boolean'?x.mobileAppLoggedIn:null,customerPhone:(store.customers||[]).find(y=>y.id===x.customerId)?.phone||'',customerName:(store.customers||[]).find(y=>y.id===x.customerId)?.name||'',allocations:user.roleCode==='owner'?(store.assistCommissionAllocations||[]).filter(a=>a.receptionId===x.id):[]}):({id:x.id,customerMask:x.customerMask,ownerId:x.ownerId,ownerName:x.ownerName,purpose:x.purpose,status:x.status,validity:x.validity,createdAt:x.createdAt,needs:'',assists:[],links:[],points:[],wechat:{claimed:false},publicAssist:true}))}; }
function create(store,user,payload) {
 const phone=clean(payload.phone,20); if(phone&&!/^1[3-9]\d{9}$/.test(phone))throw new c.HttpError(400,'顾客手机号须为11位；没有手机号可留空，按无效接待核定基础积分');
 const purpose=c.text(payload.purpose,'来意').slice(0,200);
 const details=intake.build(store,{...payload,purpose});
 store.customers ||= [];store.receptions ||= [];
 let client=phone?customer(store,phone):null;
 if(phone&&!client){client={id:c.id('CU'),phone,name:clean(payload.name,40),createdAt:c.now()};store.customers.unshift(client);}
 else if(client&&!client.name&&payload.name)client.name=clean(payload.name,40);
 const row={id:c.id('RE'),customerId:client?.id||null,customerMask:phone?masked(phone):'未留手机号',ownerId:user.id,ownerName:user.name,source:clean(payload.source,40)||'到店',purpose,...details,recommendation:clean(payload.recommendation,500),review:'',status:'接待中',validity:phone?'待确认':'无手机号待核定',points:[],assists:[],links:[],wechat:{claimed:false,confirmed:false},timeline:[{at:c.now(),by:user.id,action:'接待建档',changes:intake.fields.map(field=>({field,before:null,after:details[field]??null}))}],createdAt:c.now()};
 if(row.followUpNeed==='yes')row.status='待回访';
 store.receptions.unshift(row);c.audit(store,user,'reception:create',row.id+' '+masked(phone));row.timeline.at(-1).auditLogId=store.operationLogs[0].id;return row;
}
function update(store,user,payload) {
 const row=byId(store,payload.id);own(row,user);
 if(row.status==='已结案')throw new c.HttpError(409,'已结案接待请使用补充顾客资料');
 const patch=intake.build(store,payload,row);
 let legacyFollow;
 if(payload.status==='待回访'&&payload.followUpNeed===undefined){
  const at=clean(payload.followUpAt,40);if(!at||Number.isNaN(Date.parse(at)))throw new c.HttpError(400,'请填写回访时间');
  legacyFollow={followUpAt:patch.followUpAt,noSaleReason:c.text(payload.noSaleReason,'未成交原因').slice(0,200),status:'待回访'};
 }
 const changes=intake.apply(row,patch,user);
 for(const key of ['recommendation','review'])if(payload[key]!==undefined)row[key]=clean(payload[key],1000);
 if(legacyFollow)Object.assign(row,legacyFollow);
 else if(payload.followUpNeed!==undefined&&row.status!=='待结案确认'){
  if(patch.followUpNeed==='yes'&&row.status!=='已转业务')row.status='待回访';
  else if(patch.followUpNeed==='no'&&row.status==='待回访')row.status=row.links.length?'已转业务':'接待中';
 }
 row.timeline.push({at:c.now(),by:user.id,action:'更新接待/复盘',changes});c.audit(store,user,'reception:update',row.id);row.timeline.at(-1).auditLogId=store.operationLogs[0].id;return row;
}
function supplement(store,user,payload){
 const row=byId(store,payload.id);own(row,user);
 const mobileOnly=Object.hasOwn(payload,'mobileAppLoggedIn')&&Object.keys(payload).every(key=>['id','mobileAppLoggedIn','userId','pin'].includes(key));
 const patch=mobileOnly?{mobileAppLoggedIn:intake.mobileAppLogin(payload.mobileAppLoggedIn)}:intake.build(store,payload,row),changes=intake.apply(row,patch,user);
 row.timeline.push({at:c.now(),by:user.id,action:'补充顾客资料',changes});
 c.audit(store,user,'reception:supplement',row.id+' · '+changes.map(change=>change.field).join('、'));row.timeline.at(-1).auditLogId=store.operationLogs[0].id;return row;
}
function claimWechat(store,user,payload) {
 const row=byId(store,payload.id);own(row,user);
 if(!row.customerId)throw new c.HttpError(409,'无手机号接待不能申报加微信积分');
 if(row.wechat.claimed)throw new c.HttpError(409,'本接待单已经申报加微信');
 if((store.receptions||[]).some(x=>x.customerId===row.customerId&&x.wechat.confirmed))throw new c.HttpError(409,'该顾客加微信积分已领取');
 row.wechat={claimed:true,confirmed:false,evidence:c.text(payload.evidence,'加微信核验说明').slice(0,200),claimedAt:c.now(),claimedBy:user.id};
 row.timeline.push({at:c.now(),by:user.id,action:'申报加微信'});
 return row;
}
function confirmWechat(store,user,payload) {
 requireManager(user);const row=byId(store,payload.id);
 if(!row.wechat.claimed||row.wechat.confirmed)throw new c.HttpError(409,'没有待确认的加微信记录');
 if((store.receptions||[]).some(x=>x.id!==row.id&&x.customerId===row.customerId&&x.wechat.confirmed))throw new c.HttpError(409,'该顾客已领取加微信积分');
 row.wechat.confirmed=true;row.wechat.confirmedAt=c.now();row.wechat.confirmedBy=user.id;
 const points=c.number(payload.points,'加微信积分',1);if(!Number.isSafeInteger(points))throw new c.HttpError(400,'积分必须为整数');row.points.push({id:c.id('PT'),kind:'加微信',employeeId:row.ownerId,employeeName:row.ownerName,amount:points,confirmedBy:user.id,at:c.now()});
 row.timeline.push({at:c.now(),by:user.id,action:'加微信确认并计 '+points+' 积分'});c.audit(store,user,'reception:wechat',row.id);return row;
}
function addAssist(store,user,payload) {
 const row=byId(store,payload.id);if(!readable(row,user)&&row.status==='已结案')throw new c.HttpError(403,'不能在已结案接待单申报协助');
 if(row.status==='已结案')throw new c.HttpError(409,'接待单已结案');
 const from=c.userById(store,payload.fromId||row.ownerId),to=c.userById(store,payload.toId);
 if(from.id===to.id)throw new c.HttpError(400,'转介人与协助人不能相同');
 if(user.id!==from.id&&user.id!==to.id&&!manager(user))throw new c.HttpError(403,'只能申报本人参与的协助');
 const type=['转介','协助销售','协助办理业务','其他协助'].includes(payload.type)?payload.type:null;
 if(!type)throw new c.HttpError(400,'请选择协助类型');
 const detail=c.text(payload.detail,'协助内容').slice(0,500);
 if(row.assists.some(x=>x.type===type&&x.fromId===from.id&&x.toId===to.id&&x.detail===detail))throw new c.HttpError(409,'相同的协助内容已登记，请勿重复申报');
 const entry={id:c.id('AS'),type,fromId:from.id,fromName:from.name,toId:to.id,toName:to.name,detail,status:'待确认',createdBy:user.id,createdAt:c.now()};
 row.assists.push(entry);row.timeline.push({at:c.now(),by:user.id,action:'申报'+type});return row;
}
function confirmAssist(store,user,payload) {
 requireManager(user);const row=byId(store,payload.id);const entry=row.assists.find(x=>x.id===payload.assistId);
 if(!entry||entry.status!=='待确认')throw new c.HttpError(409,'协助单不存在或已确认');
 const approve=payload.approve===true;
 entry.status=approve?'有效':'无效';entry.confirmedAt=c.now();entry.confirmedBy=user.id;
 if(approve){const fromPoints=c.number(payload.fromPoints??0,'转介积分',0),toPoints=c.number(payload.toPoints??0,'协助积分',0);if(!Number.isSafeInteger(fromPoints)||!Number.isSafeInteger(toPoints))throw new c.HttpError(400,'积分必须为整数');entry.fromPoints=fromPoints;entry.toPoints=toPoints;for(const [employeeId,employeeName,points] of [[entry.fromId,entry.fromName,fromPoints],[entry.toId,entry.toName,toPoints]])if(points)row.points.push({id:c.id('PT'),kind:'协助',employeeId,employeeName,amount:points,confirmedBy:user.id,at:c.now(),assistId:entry.id});}
 row.timeline.push({at:c.now(),by:user.id,action:'协助单判定'+entry.status});c.audit(store,user,'reception:assist-confirm',row.id+' '+entry.id);return row;
}
function link(store,user,payload,kind,source) {
 const row=byId(store,payload.receptionId);if(!readable(row,user))throw new c.HttpError(403,'不能关联其他人的接待单');
 if(row.status==='已结案')throw new c.HttpError(409,'接待单已结案');
 const phone=(store.customers||[]).find(x=>x.id===row.customerId)?.phone;
 if(!phone)throw new c.HttpError(409,'接待单缺少顾客手机号，不能关联业务');
 const sourcePhone=(store.customers||[]).find(x=>x.id===source.customerId)?.phone||source.customerPhone;
 if(!sourcePhone)throw new c.HttpError(409,'业务单未留顾客手机号，暂不能按手机号关联');
 if(sourcePhone!==phone)throw new c.HttpError(409,'业务单与接待单的顾客手机号不一致，不能关联');
 if(row.links.some(x=>x.kind===kind&&x.id===source.id))throw new c.HttpError(409,'该业务已关联');
 row.links.push({kind,id:source.id,at:c.now(),operatorId:user.id});row.status='已转业务';row.timeline.push({at:c.now(),by:user.id,action:'转'+kind+' '+source.id});
 return row;
}
function linkExisting(store,user,payload) {
 const kind=payload.kind;
 const collection=kind==='销售单'?store.sales:kind==='移动业务单'?store.carrierServices:null;
 if(!collection)throw new c.HttpError(400,'业务类型不支持');
 const source=collection.find(x=>x.id===payload.sourceId);if(!source)throw new c.HttpError(404,'业务单不存在');
 if(!manager(user)&&source.operatorId!==user.id&&source.employeeId!==user.id)throw new c.HttpError(403,'只能关联本人办理的业务');
 const already=(store.receptions||[]).some(x=>x.links.some(y=>y.kind===kind&&y.id===source.id));if(already)throw new c.HttpError(409,'业务单已关联其他接待');
 return link(store,user,payload,kind,source);
}
function linkCandidates(store,user,receptionId,queryPhone) {
 const row=byId(store,receptionId);if(!readable(row,user))throw new c.HttpError(403,'不能查询其他人的接待单');
 const phone=clean(queryPhone,20);
 if(!/^1[3-9]\d{9}$/.test(phone))throw new c.HttpError(400,'请输入顾客的完整11位手机号搜索');
 const actual=(store.customers||[]).find(x=>x.id===row.customerId)?.phone;
 if(!actual||phone!==actual)throw new c.HttpError(409,'搜索手机号与本接待单不一致，请核对');
 const linked=new Set((store.receptions||[]).flatMap(x=>(x.links||[]).map(y=>y.kind+'|'+y.id)));
 const eligible=(source,kind)=>source.customerId===row.customerId&&
   (manager(user)||source.operatorId===user.id||source.employeeId===user.id)&&
   !linked.has(kind+'|'+source.id);
 return [
  ...(store.sales||[]).filter(x=>eligible(x,'销售单')).map(x=>({kind:'销售单',id:x.id,label:'销售单 '+x.id+' · ¥'+x.amount+' · '+String(x.createdAt||'').slice(0,10)})),
  ...(store.carrierServices||[]).filter(x=>eligible(x,'移动业务单')).map(x=>({kind:'移动业务单',id:x.id,label:'移动业务单 '+x.typeName+' · '+x.externalOrderNo+' · '+x.serviceDate})),
 ];
}
function close(store,user,payload) {
 const row=byId(store,payload.id);own(row,user);
 if(row.status==='已结案')throw new c.HttpError(409,'接待单已结案');
 if(row.assists.some(x=>x.status==='待确认'))throw new c.HttpError(409,'仍有待确认的协助单');
 const result=payload.result==='成交'?'成交':'未成交';
 if(result==='成交'&&!row.customerId)throw new c.HttpError(409,'无手机号接待不能标记成交；请先建立有手机号的接待单');
 if(result==='成交'&&!row.links.length)throw new c.HttpError(409,'请先关联已开出的业务单');
 if(result==='未成交'&&!clean(payload.noSaleReason))throw new c.HttpError(400,'请填写未成交原因');
 row.status='待结案确认';row.result=result;row.noSaleReason=result==='未成交'?clean(payload.noSaleReason,200):'';
 row.review=clean(payload.review,1000)||row.review;row.closeSubmittedAt=c.now();row.timeline.push({at:c.now(),by:user.id,action:'提交结案'});
 notice(store,'reception-close:'+row.id,'接待待确认',{id:row.id,summary:row.customerMask+' · '+result+' · 接待人 '+row.ownerName});
 return row;
}
function confirmClose(store,user,payload) {
 requireManager(user);const row=byId(store,payload.id);
 if(row.status!=='待结案确认')throw new c.HttpError(409,'接待单尚未提交结案');
 const validity=payload.validity;
 if(!['有效','无效'].includes(validity))throw new c.HttpError(400,'请选择有效或无效');
 if(!row.customerId&&validity!=='无效')throw new c.HttpError(409,'无手机号接待只能核定为无效单，仍可领取基础积分');
 const minimum=settings(store).basic;
 const points=c.number(payload.points??minimum,'接待积分',minimum);
 if(!Number.isSafeInteger(points))throw new c.HttpError(400,'积分必须为整数');
 row.validity=validity;row.status='已结案';row.closedAt=c.now();row.confirmedBy=user.id;
 row.points.push({id:c.id('PT'),kind:'接待'+validity,employeeId:row.ownerId,employeeName:row.ownerName,amount:points,confirmedBy:user.id,at:c.now()});
 row.timeline.push({at:c.now(),by:user.id,action:'结案确认 '+validity+' '+points+' 积分'});
 c.audit(store,user,'reception:close-confirm',row.id+' '+validity+' '+points);
 notice(store,'reception-confirm:'+row.id,'接待已结案',{id:row.id,summary:row.customerMask+' · '+row.result+' · '+validity+' · '+points+' 积分'});
 return row;
}
function saveRules(store,user,payload){if(user.roleCode!=='owner')throw new c.HttpError(403,'仅老板可设置积分');const result={};for(const key of ['basic','wechat','assist']){const n=c.number(payload[key],key,0);if(!Number.isSafeInteger(n))throw new c.HttpError(400,'积分必须为整数');result[key]=n;}if(result.basic<50)throw new c.HttpError(400,'无效接待基本积分不能低于50');store.receptionPointRules=result;c.audit(store,user,'reception:rules',JSON.stringify(result));return result;}
function commissionOptions(store,user,id){
 requireManager(user);const row=byId(store,id);
 return row.links.filter(x=>x.kind==='销售单').map(link=>{
  const order=(store.sales||[]).find(x=>x.id===link.id);
  const entries=(store.commissionEntries||[]).filter(x=>x.orderId===link.id&&x.kind==='sale');
  const unresolved=entries.some(x=>x.amount==null);
  const original=c.round(entries.reduce((n,x)=>n+Number(x.amount||0),0));
  const returns=c.round((store.commissionEntries||[]).filter(x=>x.orderId===link.id&&['return','gift'].includes(x.kind)).reduce((n,x)=>n+Number(x.amount||0),0));
  const allocated=c.round((store.assistCommissionAllocations||[]).filter(x=>x.orderId===link.id).reduce((n,x)=>n+x.amount-Number(x.reversedAmount||0),0));
  const returnProfit=c.round((store.saleReturns||[]).filter(x=>x.orderId===link.id).reduce((n,x)=>n+Number(x.profit||0),0));
  const netProfit=c.round(Math.max(0,Number(order?.profit||0)-returnProfit-Number(order?.giftCost||0)));
  return {orderId:link.id,original,net:c.round(Math.max(0,original+returns)),netProfit,allocated,available:unresolved?null:c.round(Math.max(0,original+returns-allocated)),sellerId:order?.salespersonId,sellerName:order?.salesperson,unresolved};
 });
}
function addCommissionEntry(store,{orderId,assistId,employeeId,amount,month,kind,originalId}){
 store.commissionEntries.push({id:c.id('COM'),kind:'assist_transfer',mode:'manual',orderId,assistId,employeeId,amount,month,createdAt:c.now(),originalId:originalId||null,reason:kind});
}
function allocateCommission(store,user,payload){
 requireManager(user);const row=byId(store,payload.id);
 const assist=row.assists.find(x=>x.id===payload.assistId&&x.status==='有效');
 if(!assist)throw new c.HttpError(409,'协助单尚未判定有效');
 const option=commissionOptions(store,user,row.id).find(x=>x.orderId===payload.orderId);
 if(!option)throw new c.HttpError(404,'接待单未关联该销售单');
 if(option.unresolved)throw new c.HttpError(409,'销售提成尚未核定，不能分配');
 const seller=c.userById(store,option.sellerId),beneficiary=c.userById(store,payload.beneficiaryId);
 if(![assist.fromId,assist.toId].includes(beneficiary.id)||beneficiary.id===seller.id)throw new c.HttpError(400,'只能分配给协助单中非原销售人的店员');
 if((store.assistCommissionAllocations||[]).some(x=>x.assistId===assist.id&&x.orderId===option.orderId))throw new c.HttpError(409,'此协助单对该销售单已分配提成');
 const rate=c.number(payload.rate,'协助提成比例',1);
 if(rate>3)throw new c.HttpError(400,'协助提成比例请选择毛利的 1% 至 3%');
 const amount=c.round(option.netProfit*rate/100);
 if(amount<=0||amount>option.available)throw new c.HttpError(409,'按该比例计算的协助提成超过原销售人可分提成，请先核对提成规则');
 const month=c.month();
 if((store.payrollStatements||[]).some(x=>[seller.id,beneficiary.id].includes(x.employeeId)&&x.month===month))throw new c.HttpError(409,'本月工资已确认，不能补记本月分配');
 const allocation={id:c.id('ASCOM'),receptionId:row.id,assistId:assist.id,orderId:option.orderId,sellerId:seller.id,beneficiaryId:beneficiary.id,amount,rate,profitBase:option.netProfit,reversedAmount:0,approvedBy:user.id,approvedAt:c.now(),reason:clean(payload.reason,300)};
 store.assistCommissionAllocations ||= [];store.assistCommissionAllocations.push(allocation);
 addCommissionEntry(store,{orderId:option.orderId,assistId:assist.id,employeeId:seller.id,amount:-amount,month,kind:'分出协助提成'});
 addCommissionEntry(store,{orderId:option.orderId,assistId:assist.id,employeeId:beneficiary.id,amount,month,kind:'分得协助提成'});
 row.timeline.push({at:c.now(),by:user.id,action:'协助提成 '+amount+' 元分给 '+beneficiary.name+'，原销售人 '+seller.name});
 c.audit(store,user,'reception:commission',row.id+' '+option.orderId+' '+amount);
 notice(store,'assist-commission:'+allocation.id,'协助提成核定',{id:allocation.id,summary:row.id+' · 销售单 '+option.orderId+' · '+beneficiary.name+' 分得 '+amount+' 元'});
 return allocation;
}
function reverseCommission(store,user,order,reason="退货冲回协助分成"){
 const allocations=(store.assistCommissionAllocations||[]).filter(x=>x.orderId===order.id);
 if(!allocations.length)return;
 const returnProfit=c.round((store.saleReturns||[]).filter(x=>x.orderId===order.id).reduce((n,x)=>n+Number(x.profit||0),0));
 const currentProfit=c.round(Math.max(0,Number(order.profit||0)-returnProfit-Number(order.giftCost||0)));
 const month=c.month();
 for(const allocation of allocations){
  const ratio=Math.max(0,Math.min(1,currentProfit/allocation.profitBase));
  const targetReversed=c.round(allocation.amount-c.round(allocation.amount*ratio));
  const delta=c.round(targetReversed-allocation.reversedAmount);
  if(delta<=0)continue;
  allocation.reversedAmount=c.round(allocation.reversedAmount+delta);
  addCommissionEntry(store,{orderId:order.id,assistId:allocation.assistId,employeeId:allocation.sellerId,amount:delta,month,kind:reason,originalId:allocation.id});
  addCommissionEntry(store,{orderId:order.id,assistId:allocation.assistId,employeeId:allocation.beneficiaryId,amount:-delta,month,kind:reason,originalId:allocation.id});
  c.audit(store,user,'reception:commission-reverse',allocation.id+' '+delta);
 }
}
function journey(store,user,customerId){
 const client=(store.customers||[]).find(x=>x.id===customerId);
 if(!client)throw new c.HttpError(404,'顾客档案不存在');
 const visits=(store.receptions||[]).filter(x=>x.customerId===client.id);
 if(user.roleCode!=='owner'&&!visits.some(x=>readable(x,user)))throw new c.HttpError(403,'无权查看该顾客历程');
 const events=visits.flatMap(row=>[
  {at:row.createdAt,kind:'接待建档',receptionId:row.id,operator:row.ownerName,summary:row.purpose},
  ...(row.timeline||[]).map(t=>({at:t.at,kind:t.action,receptionId:row.id,operator:(store.users||[]).find(u=>u.id===t.by)?.name||'',summary:''}))
 ]);
 const claims=(store.conversionClaims||[]).filter(x=>x.customerId===client.id);
 for(const claim of claims){events.push({at:claim.createdAt,kind:'申请转化贡献',receptionId:claim.sourceReceptionId,operator:claim.proposerName,summary:claim.orderId});if(claim.reviewedAt)events.push({at:claim.reviewedAt,kind:'转化贡献'+claim.status,receptionId:claim.sourceReceptionId,operator:'老板',summary:claim.orderId});}
 events.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
 return {customer:{id:client.id,name:client.name||'',phone:user.roleCode==='owner'||visits.some(x=>x.ownerId===user.id)?client.phone:masked(client.phone)},visits:visits.map(x=>readable(x,user)?{id:x.id,ownerName:x.ownerName,createdAt:x.createdAt,status:x.status,result:x.result||'',purpose:x.purpose,customerProfile:x.customerProfile||{},viewedProducts:x.viewedProducts||[],budgetBand:x.budgetBand||"unknown",budgetMin:x.budgetMin??null,budgetMax:x.budgetMax??null,followUpNeed:x.followUpNeed||"unknown",supplementPending:x.supplementPending??!x.needs,needs:x.needs,mobileAppLoggedIn:typeof x.mobileAppLoggedIn==='boolean'?x.mobileAppLoggedIn:null,recommendation:x.recommendation,review:x.review,links:x.links,assistCount:x.assists.length}:{id:x.id,ownerName:x.ownerName,createdAt:x.createdAt,status:x.status,result:x.result||'',purpose:x.purpose,links:x.links,assistCount:x.assists.length}),events};
}
module.exports={list,create,update,supplement,claimWechat,confirmWechat,addAssist,confirmAssist,link,linkExisting,linkCandidates,close,confirmClose,saveRules,commissionOptions,allocateCommission,reverseCommission,journey};
