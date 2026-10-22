'use strict';
const {createHash}=require('crypto');
const c=require('./common');
const PENDING='待老板审核';
const ACCOUNTS=new Set(require('./payment-accounts').channels);

function currentUser(store,user){
 const actual=(store.users||[]).find(row=>row.id===user?.id&&row.status==='active');
 if(!actual||user.status!=='active'||actual.roleCode!==user.roleCode||actual.assistantCustomerOnly===true||user.assistantCustomerOnly===true||actual.roleCode==='customer-assistant')throw new c.HttpError(403,'账号不存在、已停用或没有门店操作权限');
 return actual;
}
function assertOwner(store,user){
 const actual=currentUser(store,user);
 if(actual.roleCode!=='owner')throw new c.HttpError(403,'退货、换货和红冲须由老板本人审核同意后生效，请先提交申请');
 return actual;
}
function list(store,user){
 const actual=currentUser(store,user);c.permit(actual,'returnSale');
 return (store.saleReturnRequests||[]).filter(row=>actual.roleCode==='owner'||row.requesterId===actual.id).slice().reverse().map(row=>publicRequest(row,actual));
}
function publicRequest(row,user){
 const visible=structuredClone(row);delete visible.sourceFingerprint;
 visible.canReview=user.roleCode==='owner'&&row.status===PENDING;
 return visible;
}
function source(store,user,orderId){
 const order=(store.sales||[]).find(row=>row.id===orderId);
 if(!order)throw new c.HttpError(404,'原销售单不存在');
 if(!c.capabilities(user).allSales&&(order.salespersonId||order.operatorId)!==user.id)throw new c.HttpError(403,'只能申请本人销售单的退换货');
 if(order.redReversedBy)throw new c.HttpError(409,'原销售单已经红冲');
 return order;
}
function fingerprint(store,order){
 return createHash('sha256').update(JSON.stringify({order,receipts:(store.receipts||[]).filter(row=>row.kind==='sale'&&row.sourceId===order.id),subsidy:(store.govSubsidyClaims||[]).filter(row=>row.orderId===order.id)})).digest('hex');
}
function normalizeItems(items,label,sale=false){
 if(!Array.isArray(items)||!items.length||items.length>100)throw new c.HttpError(400,'请选择'+label+'明细（最多100项）');
 return items.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw new c.HttpError(400,label+'明细不正确');
  if(!sale)return {itemId:c.text(item.itemId,'原单商品'),quantity:c.quantity(item.quantity)};
  const row={skuId:c.text(item.skuId,'换出商品'),quantity:c.quantity(item.quantity),salePrice:c.money(item.salePrice,'成交价')};
  for(const key of ['serialNo','warehouseId','note'])if(item[key]!=null)row[key]=String(item[key]).trim().slice(0,key==='note'?500:100);
  if(item.noMaterials===true)row.noMaterials=true;
  if(Array.isArray(item.materials))row.materials=item.materials.map(material=>({skuId:c.text(material.skuId,'耗材'),quantity:c.quantity(material.quantity),...(material.serialNo?{serialNo:String(material.serialNo).trim().slice(0,100)}:{})}));
  if(item.card&&typeof item.card==='object')row.card={carrier:String(item.card.carrier||'').slice(0,100),packageName:String(item.card.packageName||'').slice(0,100),cardNo:String(item.card.cardNo||'').slice(0,100),expected:c.money(item.card.expected||0,'预计佣金')};
  return row;
 });
}
function normalized(kind,order,payload){
 const reason=c.text(payload.reason,kind==='exchange'?'换货原因':'退货原因');
 if(reason.length>500)throw new c.HttpError(400,'退换货原因不能超过500字');
 const account=String(payload.account||order.paymentMethod);
 if(!order.paymentParts&&!ACCOUNTS.has(account))throw new c.HttpError(400,'请选择收退款账户');
 const clean={orderId:order.id,reason,account};
 if(payload.refundPayments!=null)clean.refundPayments=structuredClone(payload.refundPayments);
 if(payload.payments!=null)clean.payments=structuredClone(payload.payments);
 if(payload.paymentAccountId)clean.paymentAccountId=String(payload.paymentAccountId);
 if(kind==='exchange'){
  clean.returns=normalizeItems(payload.returns,'退回商品');clean.items=normalizeItems(payload.items,'换出商品',true);
  if(payload.accountOwnerId)clean.accountOwnerId=String(payload.accountOwnerId).trim().slice(0,100);
  clean.cashDrawerConfirmed=payload.cashDrawerConfirmed===true;
 }else{
  clean.items=normalizeItems(payload.items,'退货');
  if(payload.platformRefundRef)clean.platformRefundRef=String(payload.platformRefundRef).trim().slice(0,100);
 }
 return clean;
}
function execute(store,user,kind,payload){
 return kind==='exchange'?require('./sale-exchanges').exchange(store,user,payload):require('./erp').returnSale(store,user,payload);
}
function preview(store,kind,payload){
 // Validate the existing business operation only on a disposable clone. A request
 // must not restore stock, create refunds, or accrue/reverse staff commissions.
 const clone=structuredClone(store),owner=(clone.users||[]).find(row=>row.status==='active'&&row.roleCode==='owner'&&row.assistantCustomerOnly!==true);
 if(!owner)throw new c.HttpError(409,'门店没有可处理退换货审核的老板账号');
 const result=execute(clone,owner,kind,{...payload,...(kind==='exchange'?{refundConfirmed:true}:{})});
 const returnId=kind==='exchange'?result.returnId:result.id;
 const refundAmount=c.round(-(clone.receipts||[]).filter(row=>row.kind==='refund'&&row.sourceId===returnId).reduce((sum,row)=>sum+row.amount,0));
 return {result,refundAmount,exchangeItems:kind==='exchange'?(clone.sales.find(row=>row.id===result.newOrderId)?.items||[]).map(row=>({skuId:row.skuId,name:row.name,quantity:row.quantity,serialNo:row.serialNo||'',amount:row.amount})):[]};
}
function create(store,user,payload,kind){
 const actual=currentUser(store,user);c.permit(actual,'returnSale');if(kind==='exchange')c.permit(actual,'sell');
 const order=source(store,actual,payload.orderId);
 if((store.saleReturnRequests||[]).some(row=>row.orderId===order.id&&row.status===PENDING)||(store.redReversals||[]).some(row=>row.kind==='sale'&&(row.sourceId||row.expenseId)===order.id&&row.status===PENDING))throw new c.HttpError(409,'该销售单已有待老板审核的退换货或红冲申请');
 const clean=normalized(kind,order,payload);
 if(kind==='exchange')clean.salespersonId=actual.id;
 const checked=preview(store,kind,clean);
 const inputs=kind==='exchange'?clean.returns:clean.items;
 const items=inputs.map(input=>{const item=order.items.find(row=>row.id===input.itemId);return {itemId:input.itemId,skuId:item.skuId,name:item.name,quantity:input.quantity,serialNo:item.serialNo||'',amount:c.round(item.salePrice*input.quantity)};});
 const row={id:c.id('SRA'),kind,orderId:order.id,amount:kind==='exchange'?checked.result.returnAmount:checked.result.amount,refundAmount:checked.refundAmount,...(kind==='exchange'?{saleAmount:checked.result.saleAmount,difference:checked.result.difference,exchangeItems:checked.exchangeItems}:{}),items,payload:clean,reason:clean.reason,account:clean.account,status:PENDING,businessApplied:false,requesterId:actual.id,requester:actual.name,requesterName:actual.name,createdAt:c.now(),sourceFingerprint:fingerprint(store,order),message:(kind==='exchange'?'换货':'退货')+'申请已提交，等待老板本人同意；尚未变更库存或登记退款。'};
 store.saleReturnRequests ||= [];store.saleReturnRequests.push(row);
 c.audit(store,actual,'sale:'+kind+'-request',row.id+' · 原单 '+order.id+' · '+row.amount+' 元 · '+row.reason);
 return publicRequest(row,actual);
}
function request(store,user,payload){return create(store,user,payload,'return');}
function requestExchange(store,user,payload){return create(store,user,payload,'exchange');}
function ensureDateOpen(store,date){if((store.dailyCloseouts||[]).some(row=>row.date===date&&row.status==='已锁定'))throw new c.HttpError(409,'相关营业日已锁定，须先完成日结更正流程');}
function review(store,user,payload){
 const actual=assertOwner(store,user),row=(store.saleReturnRequests||[]).find(item=>item.id===payload.id);
 if(!row)throw new c.HttpError(404,'退换货申请不存在');
 if(row.status!==PENDING)throw new c.HttpError(409,'该申请已经处理');
 if(!['approve','reject'].includes(payload.decision))throw new c.HttpError(400,'审核结果不正确');
 const note=c.text(payload.note,'审核意见');if(note.length<4||note.length>500)throw new c.HttpError(400,'审核意见须为4至500字');
 if(payload.decision==='reject'){
  row.status='已驳回';row.message='老板已驳回申请，库存和账款未变更。';
 }else{
  const order=source(store,actual,row.orderId);
  if(row.sourceFingerprint!==fingerprint(store,order))throw new c.HttpError(409,'原销售单或收款已变化，请核对后驳回旧申请并重新提交');
  ensureDateOpen(store,order.date||c.day(order.createdAt));ensureDateOpen(store,c.day());
  if(row.kind==='exchange'&&row.difference<0&&payload.refundConfirmed!==true)throw new c.HttpError(400,'老板须确认换货差额已退给顾客后才能批准');
  const clean={...row.payload,...(row.kind==='exchange'?{refundConfirmed:payload.refundConfirmed===true}:{})};
  const checked=preview(store,row.kind,clean);
  if(checked.refundAmount!==row.refundAmount)throw new c.HttpError(409,'退款金额已变化，请重新提交申请');
  const result=execute(store,actual,row.kind,clean);
  row.returnId=row.kind==='exchange'?result.returnId:result.id;
  if(row.kind==='exchange'){row.exchangeId=result.id;row.newOrderId=result.newOrderId;}
  const returned=(store.saleReturns||[]).find(item=>item.id===row.returnId);if(returned){returned.requestId=row.id;returned.requesterId=row.requesterId;}
  if(row.kind==='exchange'){const exchanged=(store.saleExchanges||[]).find(item=>item.id===row.exchangeId);if(exchanged)exchanged.requestId=row.id;}
  row.status=row.kind==='exchange'?'已换货':'已退货';row.businessApplied=true;
  row.message='老板本人已同意，'+(row.kind==='exchange'?'换货':'退货')+'已生效。';
 }
 row.reviewedAt=c.now();row.reviewerId=actual.id;row.reviewer=actual.name;row.reviewerName=actual.name;row.reviewNote=note;
 c.audit(store,actual,'sale:'+row.kind+'-review',row.id+' · '+row.status+' · 原单 '+row.orderId+' · '+note);
 return publicRequest(row,actual);
}
module.exports={assertOwner,list,request,requestExchange,review};