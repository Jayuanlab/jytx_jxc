'use strict';
const crypto=require('node:crypto'),c=require('./common'),accounts=require('./payment-accounts');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rangesTotal=r=>r.reduce((n,x)=>n+x.toCents-x.fromCents,0);
function isStoreSource(store,row){const ownership=require('./account-ownership'),order=(store.sales||[]).find(x=>x.id===row.orderId),part=order?.paymentParts?.find(x=>x.id===row.partId)||{account:order?.paymentMethod,accountOwnerId:order?.accountOwnerId,paymentAccountId:order?.paymentAccountId};return ownership.isStoreAccount(store,part)||ownership.isStoreAccount(store,{...row,account:row.channel})||(store.receipts||[]).some(r=>r.kind==='sale'&&r.sourceId===row.orderId&&(r.partId||'legacy')===row.partId&&ownership.isStoreAccount(store,r));}
function context(store,user,payload){const funds=require('./sale-fund-responsibility'),who=funds.owner(store,user),row=funds.project(store).find(r=>r.orderId===payload.orderId&&r.partId===(payload.partId||'legacy'));if(!row)throw new c.HttpError(404,'原销售分笔不存在');if(isStoreSource(store,row))throw new c.HttpError(409,'门店账户收款归门店，不能直接记为老板个人实收；交给老板请开内部交接单，并由接收人本人确认');if(row.sourceWarning||!(row.pendingAmount>0))throw new c.HttpError(409,'原单已清或存在退货红冲，请刷新核对');if(payload.version!==row.confirmationVersion)throw new c.HttpError(409,'挂账已变化，请刷新');return {funds,who,row};}
function preview(store,user,payload){
 const {funds,who,row}=context(store,user,payload),n=accounts.cents(payload.actualAmount,'本次老板实收金额'),limit=accounts.cents(row.amount);
 if(!n||n>accounts.cents(row.pendingAmount))throw new c.HttpError(409,'本次实收金额须大于零且不超过本笔待挂金额');
 const evidence=require('./master-data').clean(payload.evidence,'补充说明',500,true),record=(store.saleFundResponsibilityConfirmations||[]).find(r=>r.orderId===row.orderId&&r.partId===row.partId);
 if(record&&record.ownerId!==who.id)throw new c.HttpError(409,'已有其他老板实收记录，请核对原单');
 const addedRanges=funds.reserveRanges(row.coverageRanges,limit,n),prior=record?.coverageRanges||(!row.cash&&record?.actualAmount>0?[{fromCents:0,toCents:accounts.cents(record.actualAmount)}]:[]),coverageRanges=funds.mergeRanges([...prior,...addedRanges],limit);
 const newReceiptAmount=c.round(Math.max(0,row.ownerConfirmedAmount+n/100-row.ledgerRegisteredAmount)),normalized={orderId:row.orderId,partId:row.partId,version:row.confirmationVersion,receiptKind:'owner_settlement',actualAmount:n/100,evidence};
 return {...normalized,coverageRanges,ownerId:who.id,onBehalfOf:row.operatorId,operator:row.operator,originalAccountOwnerId:row.targetHolderId,oldPendingAmount:row.pendingAmount,pendingAfter:c.round(row.pendingAmount-n/100),newReceiptAmount,previewToken:hash(['owner-actual-settlement-v1',who.id,row,record||null,normalized]),noNewPayment:true};
}
function confirm(store,user,payload){
 if(payload.confirmed!==true)throw new c.HttpError(400,'请确认老板本人已经实际收到这笔钱');
 const p=preview(store,user,payload);if(payload.previewToken!==p.previewToken)throw new c.HttpError(409,'原单或挂账状态已变化，请重试');
 const funds=require('./sale-fund-responsibility'),who=funds.owner(store,user),order=store.sales.find(r=>r.id===p.orderId),original=Array.isArray(order.paymentParts)?order.paymentParts.find(r=>r.id===p.partId):null,channel=original?.account||order.paymentMethod,at=c.now(),newReceipts=[];
 if(p.newReceiptAmount>0){const ownership=require('./account-ownership'),candidates=(store.paymentAccounts||[]).filter(a=>a.active!==false&&a.channel===channel&&ownership.isPersonallyHeld(store,a,who.id));if(candidates.length!==1)throw new c.HttpError(409,'请先明确唯一的老板个人收款账户；门店账户只能通过内部交接转交个人');const destination=accounts.resolve(store,{paymentAccountId:candidates[0].id});if(!ownership.isPersonallyHeld(store,destination,who.id))throw new c.HttpError(409,'收款账户不属于老板个人实际持有');newReceipts.push(...accounts.record(store,who,'sale',order.id,[{id:p.partId,amount:p.newReceiptAmount,...destination}],1,{...(p.partId==='legacy'?{partId:undefined}:{}),onBehalfOf:p.onBehalfOf,actualOwnerConfirmedAt:at,actualOwnerConfirmedBy:who.id,ownerSettlement:true,holderVerification:{verifiedByHolder:true,by:who.id,at}}));}
 // Keep the original business day separate from the time of owner confirmation.
 for(const receipt of newReceipts){receipt.transactionDate=order.transactionDate||order.businessDate||c.day(order.createdAt);}
 store.saleFundResponsibilityConfirmations||=[];let record=store.saleFundResponsibilityConfirmations.find(r=>r.orderId===p.orderId&&r.partId===p.partId);
 if(!record){record={id:'SFC-'+hash([p.orderId,p.partId]).slice(0,28),orderId:p.orderId,partId:p.partId,ownerId:who.id,operatorId:p.onBehalfOf,version:0,events:[]};store.saleFundResponsibilityConfirmations.push(record);}
 record.version++;record.coverageRanges=p.coverageRanges;record.actualAmount=rangesTotal(p.coverageRanges)/100;record.updatedAt=at;record.events.push({type:'老板本人实收，代原经办消挂',receiptKind:'owner_settlement',by:who.id,name:who.name,at,onBehalfOf:p.onBehalfOf,originalAccountOwnerId:p.originalAccountOwnerId,thisAmount:p.actualAmount,actualAmount:record.actualAmount,evidence:p.evidence,newReceiptIds:newReceipts.map(r=>r.id)});
 const review=original?.paymentReview||order.paymentReview;if(review){review.ownerActualReceipt={by:who.id,name:who.name,at,onBehalfOf:p.onBehalfOf,confirmationId:record.id,amount:record.actualAmount};}
 if(channel==='现金')require('./cash-custody').receiveSale(store,who,order.id,p.partId,p.actualAmount,'sale:'+record.id+':'+record.version);
 if(Array.isArray(order.paymentParts))require('./sale-payment-parts').summary(store,order);else {order.receivedAmount=(store.receipts||[]).filter(r=>r.kind==='sale'&&r.sourceId===order.id&&!r.isReversal).reduce((n,r)=>n+Number(r.amount||0),0);order.pendingAmount=c.round(Number(order.amount)-order.receivedAmount);}
 c.audit(store,who,'sale-fund-responsibility:owner-actual-settlement',{orderId:p.orderId,partId:p.partId,onBehalfOf:p.onBehalfOf,originalAccountOwnerId:p.originalAccountOwnerId,thisAmount:p.actualAmount,newReceiptAmount:p.newReceiptAmount,confirmationId:record.id,version:record.version});
 return {row:funds.project(store).find(r=>r.orderId===p.orderId&&r.partId===p.partId),confirmation:record,noNewPayment:true,newReceiptIds:newReceipts.map(r=>r.id)};
}
module.exports={preview,confirm};
