'use strict';

// A derived assistant reminder. Reading this view never changes cash, messages, or accounting records.
function list(store,user){
 if(!user||user.status!=='active'||!['employee','manager','warehouse','owner'].includes(user.roleCode))return [];
 const mine=user.roleCode!=='owner';
 const result=[];
 for(const order of store.sales||[]){
  if(order.redReversedBy||order.cancelledAt||order.voidedAt||order.paymentReview?.status==='已红冲')continue;
  const parts=Array.isArray(order.paymentParts)?order.paymentParts:[{id:'legacy',account:order.paymentMethod,amount:order.paymentReview?.amount,paymentReview:order.paymentReview}];
  for(const part of parts){
   const review=part.paymentReview;
   if(part.account!=='现金'||review?.status!=='待现金入库'||review.cashReceivedConfirmed!==true||review.cashDrawerConfirmed===true||part.cashDrawerConfirmed===true)continue;
   if(mine&&order.operatorId!==user.id)continue;
   const handler=(store.users||[]).find(x=>x.id===order.operatorId);
   if(!handler||handler.status!=='active')continue;
   const receipts=(store.receipts||[]).filter(row=>row.kind==='sale'&&row.sourceId===order.id&&(part.id==='legacy'||row.partId===part.id)&&Number(row.amount)>0&&!row.isReversal);
   const receiptNos=receipts.map(row=>(store.documentNumbers||[]).find(entry=>entry.collection==='receipts'&&entry.sourceId===row.id)?.displayNo).filter(Boolean);
   result.push({key:'sale-cash:'+order.id+':'+part.id,orderId:order.id,partId:part.id,receiptNos,amount:Number(part.amount||0),handlerId:handler.id,handler:handler.name,status:review.status,receivedAt:review.cashReceivedAt||review.declaredAt||order.createdAt||null,href:'/sale-payments?order='+encodeURIComponent(order.id)+(part.id==='legacy'?'':'&part='+encodeURIComponent(part.id))});
  }
 }
 return result.sort((a,b)=>String(b.receivedAt||'').localeCompare(String(a.receivedAt||''))).slice(0,100);
}

module.exports={list};
