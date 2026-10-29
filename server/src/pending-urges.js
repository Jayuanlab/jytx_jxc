'use strict';
const c=require('./common');
const messages=require('./store-communication');
const requests=require('./master-data-requests');
const VALID=new Set(['owner','manager','employee','warehouse']);
function list(store,user){
 if(!user||user.status!=='active'||!VALID.has(user.roleCode)||user.assistantCustomerOnly)return [];
 const branch=require('./capacity/context').current().branchId;
 const people=new Map((store.users||[]).filter(row=>row.status==='active'&&!row.assistantCustomerOnly&&!row.customerOnly&&row.roleCode!=='customer-assistant'&&(!branch||row.roleCode==='owner'||!Array.isArray(row.branchIds)||row.branchIds.includes(branch))).map(row=>[row.id,row]));
 const boss=(store.users||[]).find(row=>row.roleCode==='owner'&&row.status==='active');
 const rows=[];
 const add=(kind,label,row,creatorId,handlerId,href)=>{
  if(creatorId!==user.id||!row?.id||!handlerId||handlerId===user.id||!people.has(handlerId))return;
  rows.push({kind,id:String(row.id),label,documentNo:String(row.displayNo||row.number||row.id),status:String(row.status||'待处理'),submittedAt:row.createdAt||row.submittedAt||null,handlerId,handler:people.get(handlerId).name,href});
 };
 for(const row of store.workJournals||[])if(row.status==='待核定')add('workJournal','工作日志待核定',row,row.employeeId,boss?.id,'/work-journal');
 for(const row of store.supplierExchanges||[])if(row.status==='待老板批准'||row.handedAt&&require('./supplier-exchanges').balance(store,row).goodsComplete&&!require('./supplier-exchanges').balance(store,row).closed)add('supplierExchange',row.status==='待老板批准'?'供货商换货待批准':'供货商换货差价待核实',{...row,submittedAt:row.createdAt},row.applicantId,boss?.id,'/supplier-exchanges?id='+encodeURIComponent(row.id));
 for(const row of store.businessChangeRequests||[]){if(row.status==='待老板批准')add('businessChange','业务变更退换申请待批准',row,row.operatorId,boss?.id,'/business-change-returns?id='+encodeURIComponent(row.id));else if(require('./business-change-flow').awaitingWithholding(row))add('businessChangeWithholding','业务变更和包代扣税待核实',row,row.operatorId,boss?.id,'/business-change-returns?id='+encodeURIComponent(row.id));else if(require('./business-change-flow').active(row)&&row.hebaoStatus!=='已收')add('businessChangeReceive','业务变更和包待核实到账',row,row.operatorId,boss?.id,'/business-change-returns?id='+encodeURIComponent(row.id));}
 for(const row of store.learningRecords||[])if(row.status==='待审核')add('learning','学习单待审核',row,row.employeeId,row.assignedReviewerId||boss?.id,'/learning?record='+encodeURIComponent(row.id));
 for(const row of store.dailyCloseouts||[]){const target=row.status==='待老板签认'?boss?.id:['待领取复核','复核中'].includes(row.status)?row.reviewerId:null;if(target)add('dailyClose','每日扎账待处理',row,row.cashierId,target,'/daily-close?closeout='+encodeURIComponent(row.id));}
 for(const row of store.leaveRequests||[])if(['待店长初审','待终审','待老板终审','转老板终审'].includes(row.status))add('leave','请休假待审核',row,row.applicantId,row.status==='待店长初审'?row.managerId:boss?.id,'/personnel?leave='+encodeURIComponent(row.id));
 for(const row of store.fundTransfers||[])if(row.status==='待收款人确认')add('fundTransfer','店内转款待确认',row,row.operatorId||row.fromId||row.senderId,row.toId,'/funds?transfer='+encodeURIComponent(row.id));
 for(const row of store.cashHandovers||[])if(row.status==='待接收人确认')add('cashHandover','现金交接待确认',row,row.senderId,row.recipientId,'/cash-handover?handover='+encodeURIComponent(row.id));
 for(const row of store.masterDataRequests||[])if(row.status==='待审核'){const target=requests.target(store,row);add('masterData','新增资料待审核',row,row.requesterId,target?.id||boss?.id,'/boss-batch?request='+encodeURIComponent(row.id));}
 return rows.sort((a,b)=>String(b.submittedAt||'').localeCompare(String(a.submittedAt||''))).slice(0,100);
}
function urge(store,user,body){
 if(!body||typeof body.kind!=='string'||typeof body.id!=='string'||body.kind.length>40||body.id.length>160||Object.keys(body).some(key=>!['kind','id'].includes(key)))throw new c.HttpError(400,'请选择原待办单据');
 const row=list(store,user).find(item=>item.kind===body.kind&&item.id===body.id);
 if(!row)throw new c.HttpError(409,'这张单据已处理、处理人已变化，或不属于本人，请刷新待办');
 const content=`催办｜${row.label} ${row.documentNo}，提交人：${user.name}。请打开原单核对并尽快处理。`;
 const message=messages.send(store,user,{recipientId:row.handlerId,content,kind:'work',important:true});
 c.audit(store,user,'pending:urge',{kind:row.kind,sourceId:row.id,handlerId:row.handlerId,messageId:message.id});
 return {kind:row.kind,id:row.id,documentNo:row.documentNo,handler:row.handler,at:message.createdAt,messageId:message.id,senderId:user.id,recipientId:row.handlerId};
}
module.exports={list,urge};
