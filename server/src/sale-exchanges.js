const c=require('./common');
const erp=require('./erp');
function quote(store,user,payload){
 c.permit(user,'returnSale');c.permit(user,'sell');
 const original=store.sales.find(row=>row.id===payload.orderId);
 if(!original)throw new c.HttpError(404,'原销售单不存在');
 if(!c.capabilities(user).allSales&&(original.salespersonId||original.operatorId)!==user.id)throw new c.HttpError(403,'只能办理本人销售单的换货');
 if(original.saleMode==='guobu')throw new c.HttpError(409,'国补订单请先完成原平台退货，再重新开销售单');
 if(original.redReversedBy)throw new c.HttpError(409,'原单已红冲');
 if(original.paymentReview&&!['已核对','已确认到账','无需收款'].includes(original.paymentReview.status))throw new c.HttpError(409,'请先核实原单收款，再办理换货');
 if(!Array.isArray(payload.returns)||!payload.returns.length||!Array.isArray(payload.items)||!payload.items.length)throw new c.HttpError(400,'请选择退回商品和换出商品');
 const seen=new Set();let returned=0;
 for(const input of payload.returns){
  const item=original.items.find(row=>row.id===input.itemId);if(!item)throw new c.HttpError(404,'退回商品不在原单');
  if(seen.has(item.id))throw new c.HttpError(400,'退回商品不能重复');seen.add(item.id);
  if(item.materials?.length)throw new c.HttpError(409,'维修耗材请通过原业务更正处理');
  const quantity=c.quantity(input.quantity);if(quantity>item.quantity-(item.returnedQuantity||0))throw new c.HttpError(409,'退回数量超过可退数量');
  returned=c.round(returned+item.salePrice*quantity);
 }
 const originalReturned=returned;if(payload.returnValue!=null){returned=require("./payment-accounts").cents(payload.returnValue,"退回商品作价")/100;if(returned>originalReturned)throw new c.HttpError(400,"退回作价不能超过原单商品金额");}
 const total=c.round(payload.items.reduce((sum,item)=>sum+c.quantity(item.quantity)*c.money(item.salePrice,'成交价'),0));
 const credit=Math.min(returned,total);
 return {original,originalReturned,returned,total,credit,difference:c.round(total-returned)};
}
function exchange(store,user,payload){
 const q=quote(store,user,payload),id=c.id('HX'),reason=c.text(payload.reason,'换货原因');
 const account=payload.account||q.original.paymentMethod;
 if(!q.original.paymentParts&&payload.payments==null&&!payload.paymentAccountId&&!require('./payment-accounts').channels.includes(account))throw new c.HttpError(400,'请选择收退款账户');
 if(q.difference<0&&payload.refundConfirmed!==true)throw new c.HttpError(400,'请确认差额已退给顾客');
 const returned=erp.returnSale(store,user,{orderId:q.original.id,items:payload.returns,reason,account,refundPayments:payload.refundPayments},{paymentCredit:q.credit,customerReturnAmount:q.returned,refundAmount:Math.max(0,-q.difference),returnWarehouseId:payload.returnWarehouseId,...(payload.bossPayment?{validatedRefundParts:require("./sale-return-requests").bossRefundParts(store,user,q.original,Math.max(0,-q.difference))}:{})});
 const customer=(store.customers||[]).find(row=>row.id===q.original.customerId);
 const created=erp.sale(store,user,{items:payload.items,salespersonId:payload.salespersonId,account,payments:payload.payments,paymentAccountId:payload.paymentAccountId,accountOwnerId:payload.accountOwnerId,cashDrawerConfirmed:payload.cashDrawerConfirmed===true,customerName:q.original.customerName||'',customerPhone:customer?.phone||'',orderNote:'换货 '+id+' · 原单 '+q.original.id},{paymentCredit:q.credit});
 const sold=store.sales.find(x=>x.id===created.id);
 const row={id,orderId:q.original.id,returnId:returned.id,newOrderId:sold.id,returnAmount:q.returned,saleAmount:q.total,paymentCredit:q.credit,difference:q.difference,account,reason,operatorId:user.id,operator:user.name,createdAt:c.now()};
 store.saleExchanges ||= [];store.saleExchanges.unshift(row);returned.exchangeId=id;sold.exchangeId=id;sold.exchangeOriginalId=q.original.id;
 q.original.exchangeIds ||= [];q.original.exchangeIds.push(id);
 c.audit(store,user,'sale:exchange',row);
 return {...row,message:'换货已完成；'+(q.difference<0?'已退款 '+(-q.difference)+' 元':q.difference>0?'补收 '+q.difference+' 元，请核对到账':'无需补退款')};
}
module.exports={quote,exchange};
