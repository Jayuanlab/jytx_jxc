const c=require('./common');
function list(store,user){if(!c.capabilities(user).redRequest&&!c.capabilities(user).redReview)throw new c.HttpError(403,'当前账号没有红冲权限');return (store.redReversals||[]).filter(r=>c.capabilities(user).redReview||c.capabilities(user).finance||r.requesterId===user.id).slice().reverse();}
function sources(store,user){if(!c.capabilities(user).redRequest&&!c.capabilities(user).redReview)throw new c.HttpError(403,'当前账号没有红冲权限');const rows=[];const caps=c.capabilities(user);for(const kind of ['expense','sale','other_income'])for(const row of (kind==='sale'?store.sales:kind==='expense'?store.expenses:store.otherIncome)||[]){if(kind==='sale'&&!caps.allSales&&!caps.redReview&&(row.salespersonId||row.operatorId)!==user.id)continue;if(kind!=='sale'&&!caps.finance&&!caps.redReview)continue;try{original(store,{kind,sourceId:row.id});rows.push({id:row.id,kind,title:kind==='sale'?row.customerName||'销售单':row.type,amount:row.amount});}catch{}}return rows;}
function original(store,payload){
 const kind=payload.kind||'expense',sourceId=payload.sourceId||payload.expenseId;
 if(!['expense','sale','other_income'].includes(kind))throw new c.HttpError(400,'不支持该类单据红冲');
 const collection=kind==='sale'?store.sales:kind==='other_income'?(store.otherIncome||[]):store.expenses;
 const row=collection.find(x=>x.id===sourceId);
 if(!row||row.redOf||row.amount<=0)throw new c.HttpError(404,'可红冲的原单不存在');
 if(row.redReversedBy)throw new c.HttpError(409,'原单已经红冲');
 const payments=store.receipts.filter(x=>x.kind===kind&&x.sourceId===row.id);
 if(kind!=='sale'&&!payments.length)throw new c.HttpError(409,'原单缺少对应资金流水，暂不能自动红冲');
 if(kind==='sale'){
  if(row.saleMode==='guobu')throw new c.HttpError(409,'国补订单须通过原平台退货流程处理');
  if(row.exchangeId||row.exchangeOriginalId||row.paymentCredit)throw new c.HttpError(409,'换货新单含原单抵款，请从退换货办理退货，不能直接红冲');
  if(row.items.some(x=>(x.returnedQuantity||0)>0)||row.exchangeIds?.length)throw new c.HttpError(409,'原单已退换货，请通过对应原单业务处理');
  if(row.giftOrders?.some(g=>g.status==='issued')||row.items.some(x=>x.materials?.length))throw new c.HttpError(409,'原单含赠品或维修耗材，请先核实对应业务');
 }
 return {kind,row,payments};
}
function ensureDateOpen(store,date){if((store.dailyCloseouts||[]).some(x=>x.date===date&&x.status==='已锁定'))throw new c.HttpError(409,'相关营业日已锁定，须先完成日结更正流程');}
function request(store,user,payload){
 c.permit(user,'redRequest');const {kind,row}=original(store,payload);
 if(kind==='sale'){c.permit(user,'returnSale');if(!c.capabilities(user).allSales&&(row.salespersonId||row.operatorId)!==user.id)throw new c.HttpError(403,'只能申请本人销售单的红冲');}else c.permit(user,'finance');
 if(kind==='sale'&&(store.saleReturnRequests||[]).some(x=>x.orderId===row.id&&x.status==='待老板审核'))throw new c.HttpError(409,'该销售单已有待老板审核的退换货申请');
 if((store.redReversals||[]).some(x=>(x.sourceId||x.expenseId)===row.id&&x.status==='待老板审核'))throw new c.HttpError(409,'该单已有待审核红冲申请');
 const reason=c.text(payload.reason,'红冲原因');if(reason.length<8||reason.length>500)throw new c.HttpError(400,'请写明至少 8 字的误记原因');
 const item={id:c.id('RED'),kind,sourceId:row.id,...(kind==='expense'?{expenseId:row.id}:{}),amount:row.amount,reason,status:'待老板审核',requesterId:user.id,requester:user.name,createdAt:c.now()};
 store.redReversals ||= [];store.redReversals.push(item);
 c.audit(store,user,'expense:red-request',item.id+' · 原单 '+row.id+' · '+row.amount+' 元 · '+reason);
 require('./feishu-notices').notice(store,'expense-red-request:'+item.id,'单据红冲待审核',{id:item.id,summary:'原单 '+row.id+' · '+row.amount+' 元；原因：'+reason});return item;
}
function review(store,user,payload){
 require('./sale-return-requests').assertOwner(store,user);
 c.permit(user,'redReview');const item=(store.redReversals||[]).find(x=>x.id===payload.id);
 if(!item)throw new c.HttpError(404,'红冲申请不存在');if(item.status!=='待老板审核')throw new c.HttpError(409,'该申请已经处理');
 if(!['approve','reject'].includes(payload.decision))throw new c.HttpError(400,'审核结果不正确');
 const note=c.text(payload.note,'审核意见');if(note.length<4||note.length>500)throw new c.HttpError(400,'审核意见至少 4 字');
 if(payload.decision==='reject')item.status='已驳回';
 else{
  const {kind,row,payments}=original(store,item);
  ensureDateOpen(store,row.date||c.day(row.createdAt));ensureDateOpen(store,c.day());
  if(kind==='sale'){
   const refunded=c.round(payments.reduce((n,r)=>n+r.amount,0));
   if(refunded>row.amount)throw new c.HttpError(409,'原单收款异常，请先核实');
   const reversal=require('./erp').returnSale(store,user,{orderId:row.id,reason:'红冲：'+item.reason,items:row.items.map(x=>({itemId:x.id,quantity:x.quantity})),account:row.paymentMethod},{refundAmount:refunded,redReversal:true});
   reversal.redOf=row.id;reversal.requestId=item.id;row.redReversedBy=reversal.id;item.reversalId=reversal.id;
   const cashRows=store.receipts.filter(x=>x.sourceId===reversal.id);for(const cash of cashRows){cash.isReversal=true;cash.originalReceiptIds=cash.originalReceiptId?[cash.originalReceiptId]:payments.map(x=>x.id);}if(cashRows.length)item.reversalReceiptId=cashRows[0].id;item.reversalReceiptIds=cashRows.map(x=>x.id);
   for(const part of row.paymentParts||[]){part.paymentReview.status='已红冲';part.paymentReview.events.push({type:'原单红冲',by:user.id,at:c.now()});}
   if(row.paymentReview){row.paymentReview.status='已红冲';row.paymentReview.events.push({type:'原单红冲',by:user.id,at:c.now()});}
  }else{
   const reversal={id:c.id(kind==='expense'?'EXR':'SKR'),type:'红冲：'+row.type,amount:-row.amount,redOf:row.id,requestId:item.id,reason:item.reason,operatorId:user.id,operator:user.name,createdAt:c.now()};
   (kind==='expense'?store.expenses:store.otherIncome).push(reversal);
   if(Math.round(Math.abs(payments.reduce((sum,p)=>sum+p.amount,0))*100)!==Math.round(row.amount*100))throw new c.HttpError(409,'原单实际资金合计异常，请先核实');
   const cashRows=payments.map(p=>({id:c.id('RC'),kind:kind==='expense'?'expense_red':'other_income_red',sourceId:reversal.id,originalReceiptId:p.id,...require('./payment-accounts').snapshot(p),...(p.partId?{originalPartId:p.partId}:{}),amount:-p.amount,operatorId:user.id,createdAt:reversal.createdAt}));
   store.receipts.push(...cashRows);row.redReversedBy=reversal.id;item.reversalId=reversal.id;item.reversalReceiptId=cashRows[0].id;item.reversalReceiptIds=cashRows.map(x=>x.id);
  }
  item.status='已红冲';
 }
 item.reviewedAt=c.now();item.reviewerId=user.id;item.reviewNote=note;
 c.audit(store,user,'expense:red-review',item.id+' · '+item.status+' · 原单 '+(item.sourceId||item.expenseId)+' · '+item.amount+' 元 · '+note);
 require('./feishu-notices').notice(store,'expense-red-review:'+item.id,'单据红冲'+item.status,{id:item.id,summary:'原单 '+(item.sourceId||item.expenseId)+'；'+note});return item;
}
module.exports={list,sources,request,review};