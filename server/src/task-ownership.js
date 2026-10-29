'use strict';
const pending=new Set(['待老板核对','待收款人确认','有异议']);
const number=row=>String(row?.displayNo||row?.number||row?.id||'未编号');
// Older cash sales could be declared in the drawer by their operator and
// reviewed under the former workflow. These closed orders have no action the
// operator can repeat. Omit only their stale reminder; keep finance untouched.
function oldDrawerNotice(store,row){
 if(!row.cash||!row.cashDrawerDeclared||row.pendingAmount<=0||row.sourceWarning)return false;
 const order=(store.sales||[]).find(x=>x.id===row.orderId),part=(order?.paymentParts||[]).find(x=>x.id===row.partId),review=part?.paymentReview;
 if(!part||part.account!=='现金'||part.cashDrawerConfirmed!==true||review?.status!=='已核对'||review.cashDrawerConfirmed!==true||!review.confirmedBy||!review.confirmedAt||review.confirmedBy===row.operatorId)return false;
 const events=review.events||[],declared=events.find(e=>e.type==='开单人声明现金入抽屉'&&e.by===row.operatorId&&e.at),checked=events.find(e=>e.type==='已核对'&&e.by===review.confirmedBy&&e.at===review.confirmedAt);
 if(!declared||!checked||!Number.isFinite(Date.parse(declared.at))||!Number.isFinite(Date.parse(checked.at))||Date.parse(declared.at)>Date.parse(checked.at))return false;
 const receipts=(store.receipts||[]).filter(r=>r.kind==='sale'&&r.sourceId===row.orderId&&r.partId===row.partId&&!r.isReversal&&r.account==='现金');
 return receipts.length===1&&Number(receipts[0].amount)===Number(row.amount)&&receipts[0].cashDestination==null&&!receipts[0].accountOwnerId&&!receipts[0].paymentAccountId;
}
function collect(store,boss){
 const people=new Map((store.users||[]).map(u=>[u.id,u]));
 const assigned=[],saleOwner=[],saleUnassigned=[];
 const add=(id,kind,label,row,href,amount=null,status='',partId=null)=>{if(!id||id===boss.id)return;const person=people.get(id);const routes={cashHandover:'/cash-handover?handover=',fundTransfer:'/funds?transfer=',dailyReview:'/daily-close?closeout=',closeoutRevision:'/close?closeout=',procurement:'/app?tab=purchase&focusPlan=',followup:'/receptions?pendingFollowup=1&highlight='};if(kind==='salePayments')href='/sale-payments?order='+encodeURIComponent(row.id)+(partId?'&part='+encodeURIComponent(partId):'');else if(routes[kind])href=routes[kind]+encodeURIComponent(row.id);assigned.push({personId:id,person:person?.name||'人员已停用/待核对',kind,label,documentNo:number(row),amount:amount==null?null:Number.isFinite(Number(amount))?Number(amount):null,status,href,documentId:String(row?.id||''),partId:partId==null?null:String(partId),submittedAt:row?.submittedAt||row?.registeredAt||row?.createdAt||null,businessDate:row?.date||row?.serviceDate||row?.occurredAt||null});};
 for(const order of store.sales||[]){
  const parts=Array.isArray(order.paymentParts)?order.paymentParts:[{id:null,account:order.paymentMethod,amount:order.paymentReview?.amount,paymentReview:order.paymentReview}];
  for(const part of parts){const review=part.paymentReview||{};if(!pending.has(review.status))continue;
   const amount=part.amount??review.amount,label=(part.account||order.paymentMethod||'未标明方式')+'销售收款核对';
   if(part.account==='现金'||order.paymentMethod==='现金'&&!part.id){if(review.recipientId===boss.id)saleOwner.push({order,part});else add(review.recipientId,'salePayments',label,order,'/sale-payments',amount,review.status,part.id);continue;}
   if(review.accountOwnerUnspecified&&review.customerPaidDeclaredAt)saleUnassigned.push({order,part});
   if(!review.customerPaidDeclaredAt){add(order.operatorId,'salePayments','销售款待经办人核实'+(review.status==='有异议'?'（收款人退回）':''),order,'/sale-payments',amount,review.status,part.id);continue;}
   if(review.accountOwnerUnspecified)continue;
   if(review.recipientId===boss.id)saleOwner.push({order,part});
   else add(review.recipientId,'salePayments',label,order,'/sale-payments',amount,review.status,part.id);
  }
 }
 let ownerCashHandover=0,ownerFundTransfer=0;
 for(const row of store.cashHandovers||[]){if(row.status==='金额有异议'){add(row.senderId,'cashHandover','现金交接被退回待核实',row,'/cash-handover',row.amount,row.status);continue;}if(row.status!=='待接收人确认')continue;if(row.recipientId===boss.id)ownerCashHandover++;else add(row.recipientId,'cashHandover','现金交接待接收',row,'/cash-handover',row.amount,row.status);}
 for(const row of store.fundTransfers||[]){if(row.status!=='待收款人确认')continue;if(row.toId===boss.id)ownerFundTransfer++;else add(row.toId,'fundTransfer','店内转款待确认',row,'/funds',row.amount,row.status);}
 for(const row of store.dailyCloseouts||[]){const id=row.status==='已驳回'?row.cashierId:['待领取复核','复核中'].includes(row.status)?row.reviewerId:null;if(id)add(id,'dailyReview',row.status==='已驳回'?'每日扎账待补正':'每日扎账待复核',row,'/daily-close',null,row.status);}
 for(const row of store.closeouts||[]){if(row.status==='待复核')add(row.cashierId,'closeoutRevision','交班单待修订',row,'/close',null,row.status);}
 for(const row of store.procurementPlans||[]){if(row.status==='open'&&row.receiverId)add(row.receiverId,'procurement','进行中订货与收货',row,'/app?tab=purchase',row.amount,row.status);}
 for(const row of []){if(row.status==='待回访'&&row.ownerId&&row.followUpAt&&Date.parse(row.followUpAt)<=Date.now())add(row.ownerId,'followup','到期回访',row,'/receptions',null,row.status);}
 for(const row of store.storeWalletFundingRequests||[])if(row.status==='待到账确认'&&row.receiverId!==boss.id)add(row.receiverId,'walletFundingConfirm','门店微信待本人确认到账',row,'/store-wallet-funding?request='+encodeURIComponent(row.id),row.paidAmount,row.status);
 const responsibilities=require('./sale-fund-responsibility').project(store);const same=(a,r)=>a.documentId===r.orderId&&(a.partId||'legacy')===r.partId;for(let i=assigned.length-1;i>=0;i--)if(assigned[i].kind==='salePayments'&&responsibilities.some(r=>same(assigned[i],r)))assigned.splice(i,1);for(const r of responsibilities)if(r.pendingAmount>0&&r.operatorId&&r.operatorId!==boss.id&&!oldDrawerNotice(store,r))add(r.operatorId,'saleFundResponsibility',r.cash?'已收顾客现金，尚未确认交入门店':'营业员核对支付反馈并确认到账',store.sales.find(s=>s.id===r.orderId),r.sourceHref,r.pendingAmount,r.statusLabel,r.partId);for(let i=saleOwner.length-1;i>=0;i--){const item=saleOwner[i],r=responsibilities.find(r=>r.orderId===item.order.id&&r.partId===(item.part.id||'legacy'));if(r&&(r.pendingAmount===0||r.operatorId!==boss.id))saleOwner.splice(i,1);}const groups=new Map();for(const row of assigned){if(!groups.has(row.personId))groups.set(row.personId,{personId:row.personId,person:row.person,count:0,rows:[]});const group=groups.get(row.personId);group.count++;group.rows.push(row);}
 return {ownerSalePayments:saleOwner.length,salePaymentAssignments:saleUnassigned.length,ownerCashHandover,ownerFundTransfer,waitingOnOthers:[...groups.values()].sort((a,b)=>b.count-a.count||a.person.localeCompare(b.person,'zh-CN')),waitingOnOthersCount:assigned.length};
}
module.exports={collect};
