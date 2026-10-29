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
 if(order.mobileActivityId)throw new c.HttpError(409,'活动机销售需先核对移动公司和包退款与门店返用户支出，暂不能按普通顾客付款办理退换货');
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
function baseNormalized(kind,order,payload){
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
function baseExecute(store,user,kind,payload){
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
 if(kind==='exchange')clean.salespersonId=order.salespersonId||actual.id;
 const checked=preview(store,kind,clean);
 const inputs=kind==='exchange'?clean.returns:clean.items;
 const items=inputs.map(input=>{const item=order.items.find(row=>row.id===input.itemId);return {itemId:input.itemId,skuId:item.skuId,name:item.name,quantity:input.quantity,serialNo:item.serialNo||'',amount:c.round(item.salePrice*input.quantity)};});
 const row={id:c.id('SRA'),kind,orderId:order.id,amount:kind==='exchange'?checked.result.returnAmount:checked.result.amount,refundAmount:checked.refundAmount,...(kind==='exchange'?{saleAmount:checked.result.saleAmount,difference:checked.result.difference,exchangeItems:checked.exchangeItems}:{}),items,payload:clean,reason:clean.reason,account:clean.account,status:PENDING,businessApplied:false,requesterId:actual.id,requester:actual.name,requesterName:actual.name,createdAt:c.now(),sourceFingerprint:fingerprint(store,order),message:(kind==='exchange'?'换货':'退货')+'申请已提交，等待老板本人同意；尚未变更库存或登记退款。'};
 row.originalReturnAmount=returnNominal(order,inputs);row.requestedReturnValue=clean.returnValue;row.retainedAmount=c.round(row.originalReturnAmount-clean.returnValue);row.returnWarehouseId=clean.returnWarehouseId;row.returnWarehouseName=require('./warehouses').byId(clean.returnWarehouseId).name;row.paymentMode='老板支付';
 row.sourceSalespersonId=order.salespersonId||order.operatorId;row.sourceSalespersonName=store.users.find(x=>x.id===row.sourceSalespersonId)?.name||'';row.onBehalfOf=actual.id!==row.sourceSalespersonId?row.sourceSalespersonId:null;
 row.pendingNoticeKey='sale-return-request:'+row.id;
 (store.localCatalogNotices||=[]).push({key:row.pendingNoticeKey,kind:kind==='exchange'?'销售换货待审核':'销售退货待审核',orderId:row.id,summary:actual.name+(row.onBehalfOf?' 代 '+row.sourceSalespersonName:'')+' 提交 · 原单 '+order.id+' · '+(kind==='exchange'?'退回作价':'申请退款')+' '+clean.returnValue.toFixed(2)+' 元 · 退货扣款 '+row.retainedAmount.toFixed(2)+' 元 · 退回 '+row.returnWarehouseName+' · 等待老板确认',amount:checked.refundAmount,createdAt:row.createdAt,readAt:null,localOnly:true});
 store.saleReturnRequests ||= [];store.saleReturnRequests.push(row);
 c.audit(store,actual,'sale:'+kind+'-request',row.id+' · 原单 '+order.id+' · '+row.amount+' 元 · '+row.reason);
 return publicRequest(row,actual);
}
function request(store,user,payload){return create(store,user,payload,'return');}
function requestExchange(store,user,payload){return create(store,user,payload,'exchange');}
function ensureDateOpen(store,date){if((store.dailyCloseouts||[]).some(row=>row.date===date&&row.status==='已锁定'))throw new c.HttpError(409,'相关营业日已锁定，须先完成日结更正流程');}
function baseReview(store,user,payload){
 const actual=assertOwner(store,user),row=(store.saleReturnRequests||[]).find(item=>item.id===payload.id);
 if(!row)throw new c.HttpError(404,'退换货申请不存在');
 if(row.status!==PENDING)throw new c.HttpError(409,'该申请已经处理');
 if(!['approve','reject'].includes(payload.decision))throw new c.HttpError(400,'审核结果不正确');
 const note=String(payload.note||'').trim();if(note.length>500)throw new c.HttpError(400,'备注不能超过500字');
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

function returnNominal(order,items){return c.round(items.reduce((n,x)=>{const i=order.items.find(y=>y.id===x.itemId);if(!i)throw new c.HttpError(404,'原单商品不存在');return n+i.salePrice*x.quantity;},0));}
function normalized(kind,order,payload){
 const clean=baseNormalized(kind,order,{...payload,reason:payload.reason||(kind==='exchange'?'销售换货':'销售退货')});
 const inputs=kind==='exchange'?clean.returns:clean.items,nominal=returnNominal(order,inputs);
 const value=payload.returnValue??payload.refundAmount??nominal,actual=require('./payment-accounts').cents(value,'退货作价或退款金额')/100;
 if(actual>nominal)throw new c.HttpError(400,'退款或退货作价不能超过原单商品金额');
 if(order.saleMode==='guobu'&&actual!==nominal)throw new c.HttpError(409,'国补退货金额须按原平台规则办理');
 const source=order.items.find(x=>x.id===inputs[0].itemId),warehouseId=String(payload.returnWarehouseId||source?.warehouseId||'wh-sale');
 const warehouse=require('./warehouses').byId(warehouseId);if(!warehouse||warehouse.active===false)throw new c.HttpError(400,'请选择在用的退回仓库');
 clean.returnWarehouseId=warehouseId;clean.returnValue=actual;clean.paymentMode='老板支付';if(kind==='exchange'&&payload.salespersonId)clean.salespersonId=payload.salespersonId;
 if(kind==='return')clean.refundAmount=actual;
 return clean;
}
function bossRefundParts(store,user,order,amount){
 const proof=require('./payment-accounts').refundParts(store,order,amount);
 return proof.map(p=>({id:c.id('PP'),amount:p.amount,account:'老板支付',accountName:'老板支付',accountOwnerId:user.id,accountOwnerName:user.name,originalReceiptId:p.originalReceiptId,...(p.originalPartId?{originalPartId:p.originalPartId}:{})}));
}
function execute(store,user,kind,payload){
 if(kind==='exchange')return require('./sale-exchanges').exchange(store,user,{...payload,bossPayment:true});
 const order=store.sales.find(x=>x.id===payload.orderId);
 if(order?.saleMode==='guobu')return require('./erp').returnSale(store,user,payload,{returnWarehouseId:payload.returnWarehouseId});
 const amount=payload.refundAmount??returnNominal(order,payload.items),parts=bossRefundParts(store,user,order,amount);
 return require('./erp').returnSale(store,user,payload,{customerReturnAmount:amount,refundAmount:amount,validatedRefundParts:parts,returnWarehouseId:payload.returnWarehouseId});
}
function review(store,user,payload){
 const actual=assertOwner(store,user),clone=structuredClone(store),row=clone.saleReturnRequests.find(x=>x.id===payload.id);
 if(!row)throw new c.HttpError(404,'退换货申请不存在');
 if(row.status!==PENDING)throw new c.HttpError(409,'该申请已处理');
 if(payload.decision==='approve'){
  if(payload.confirmed!==true)throw new c.HttpError(400,'请确认退回实物、退款或补款事项后再确认');
  const order=source(clone,actual,row.orderId);
  if(row.sourceFingerprint!==fingerprint(clone,order))throw new c.HttpError(409,'原销售单或收款已变化，请重新核对申请');
  const clean=normalized(row.kind,order,{...row.payload,...(payload.refundAmount!=null?{refundAmount:payload.refundAmount,returnValue:payload.refundAmount}:{}),...(payload.returnValue!=null?{returnValue:payload.returnValue,refundAmount:payload.returnValue}:{}),...(payload.returnWarehouseId?{returnWarehouseId:payload.returnWarehouseId}:{})});
  const checked=preview(clone,row.kind,clean);
  row.approvedReturnValue=clean.returnValue;row.approvedRefundAmount=checked.refundAmount;row.approvedWarehouseId=clean.returnWarehouseId;row.retainedAmount=c.round(row.originalReturnAmount-clean.returnValue);row.returnWarehouseName=require('./warehouses').byId(clean.returnWarehouseId).name;
  row.payload=clean;row.refundAmount=checked.refundAmount;row.amount=row.kind==='exchange'?checked.result.returnAmount:checked.result.amount;
  if(row.kind==='exchange'){row.difference=checked.result.difference;row.saleAmount=checked.result.saleAmount;}
 }
 const result=baseReview(clone,actual,{...payload,refundConfirmed:true,note:payload.note||''});
 const saved=clone.saleReturnRequests.find(x=>x.id===row.id);
 if(saved.businessApplied){saved.paymentMode='老板支付';saved.message=(saved.kind==='exchange'?'换货':'退货')+'已完成，退货入库单已生成；库存已更新，'+(saved.refundAmount>0?'老板支付退款 '+saved.refundAmount.toFixed(2)+' 元已记账。':saved.difference>0?'补款按实际收款账户核对。':'无需退款。');result.message=saved.message;}
 Object.assign(store,clone);return {...result,...(saved.businessApplied?{message:saved.message}:{})};
}
module.exports={assertOwner,list,request,requestExchange,review,bossRefundParts};
