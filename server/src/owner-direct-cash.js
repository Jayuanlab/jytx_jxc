'use strict';
const crypto=require('node:crypto'),c=require('./common'),master=require('./master-data'),accounts=require('./payment-accounts');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'),funds=()=>require('./sale-fund-responsibility');
function current(store,user,payload){
 const who=funds().owner(store,user),row=funds().project(store).find(x=>x.orderId===payload.orderId&&x.partId===payload.partId);
 if(!row||!row.cash)throw new c.HttpError(404,'请选择明确的原销售现金分笔');
 const order=(store.sales||[]).find(x=>x.id===row.orderId),part=order?.paymentParts?.find(x=>x.id===row.partId)||{account:order?.paymentMethod,paymentAccountId:order?.paymentAccountId,accountOwnerId:order?.accountOwnerId},ownership=require('./account-ownership');
 if(ownership.isStoreAccount(store,part)||ownership.isStoreAccount(store,{...row,account:row.channel})||(store.receipts||[]).some(r=>r.kind==='sale'&&r.sourceId===row.orderId&&(r.partId||'legacy')===row.partId&&ownership.isStoreAccount(store,r)))throw new c.HttpError(409,'门店现金归门店，不能直接登记老板个人已收；请开内部交接单，由接收人本人确认后计个人实收');
 if(row.sourceWarning)throw new c.HttpError(409,'原销售存在退货或红冲，请先核对原单');
 if(row.targetHolderId!==who.id)throw new c.HttpError(403,'只能登记老板本人实际直接收到的现金，不能冒充其他持有人');
 if(row.notPostedAmount!==0)throw new c.HttpError(409,'原现金尚有未入账金额，请先按原单登记收款');
 return {who,row};
}
function preview(store,user,payload){
 const {who,row}=current(store,user,payload);
 if(payload.version!==row.confirmationVersion)throw new c.HttpError(409,'原单核收版本已变化，请刷新');
 const amountCents=accounts.cents(payload.actualAmount,'老板本次直接收到金额'),limit=accounts.cents(row.amount);
 if(!amountCents||amountCents>accounts.cents(row.pendingAmount))throw new c.HttpError(409,'本次核收金额须大于零且不超过本笔挂账');
 const evidence=master.clean(payload.evidence,'老板本人直接收款依据',500,true);
 const transactionDate=String(payload.transactionDate||''),date=new Date(transactionDate+'T04:00:00.000Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==transactionDate||transactionDate>c.day()||transactionDate<c.day(row.createdAt))throw new c.HttpError(400,'请填写原销售之后且不晚于今天的实际收款日期');
 const coverageRanges=funds().reserveRanges(row.coverageRanges,limit,amountCents),normalized={orderId:row.orderId,partId:row.partId,receiptKind:'owner_direct_cash',actualAmount:amountCents/100,version:row.confirmationVersion,transactionDate,evidence};
 return {...normalized,coverageRanges,previewToken:hash(['owner-direct-cash-v132',who.id,row,normalized]),onBehalfOf:row.operatorId,operator:row.operator,oldPendingAmount:row.pendingAmount,pendingAfter:c.round(row.pendingAmount-amountCents/100),newReceiptAmount:0,noNewReceipt:true,noNewPayment:true,noLedgerChange:true};
}
function writeConfirmation(store,who,p){
 store.saleFundResponsibilityConfirmations||=[];let record=store.saleFundResponsibilityConfirmations.find(x=>x.orderId===p.orderId&&x.partId===p.partId);
 if(record&&record.ownerId!==who.id)throw new c.HttpError(409,'原核收人不一致，请核对原证据');
 if(!record){record={id:'SFC-'+hash([p.orderId,p.partId]).slice(0,28),orderId:p.orderId,partId:p.partId,ownerId:who.id,operatorId:p.onBehalfOf,actualAmount:0,version:0,coverageRanges:[],events:[]};store.saleFundResponsibilityConfirmations.push(record);}
 record.coverageRanges=funds().mergeRanges([...(record.coverageRanges||[]),...p.coverageRanges]);record.actualAmount=c.round(record.coverageRanges.reduce((n,x)=>n+x.toCents-x.fromCents,0)/100);record.version++;record.updatedAt=c.now();
 record.events.push({type:'老板直接收到顾客现金，代经办核收',receiptKind:'owner_direct_cash',by:who.id,name:who.name,at:record.updatedAt,onBehalfOf:p.onBehalfOf,actualAmount:record.actualAmount,thisAmount:p.actualAmount,transactionDate:p.transactionDate,evidence:p.evidence,operatorHandledCash:false,employeeConfirmationRequired:false});
 c.audit(store,who,'sale-fund-responsibility:owner-direct-cash',{orderId:p.orderId,partId:p.partId,onBehalfOf:p.onBehalfOf,actualAmount:p.actualAmount,confirmationId:record.id,version:record.version});return record;
}
function confirm(store,user,payload){
 if(payload.confirmed!==true)throw new c.HttpError(400,'须由老板本人明确确认现金已经收到');
 const p=preview(store,user,payload);if(p.previewToken!==payload.previewToken)throw new c.HttpError(409,'原单或核收证据已变化，请重新预览');
 const who=funds().owner(store,user),confirmation=writeConfirmation(store,who,p);return {confirmation,row:funds().project(store).find(x=>x.orderId===p.orderId&&x.partId===p.partId),noNewReceipt:true,noNewPayment:true,noLedgerChange:true,newReceiptIds:[]};
}
function correctionPreview(store,user,payload){
 const {who,row}=current(store,user,payload),h=(store.cashHandovers||[]).find(x=>x.id===payload.handoverId);
 if(!h||h.policy!==funds().POLICY||h.receiptKind!=='cash_handover'||h.createdBy!==who.id||h.confirmedBy!==who.id||h.recipientId!==who.id||h.sourceOrderId!==row.orderId||h.sourcePartId!==row.partId||h.senderId!==row.operatorId||!funds().handoverProof(store,h))throw new c.HttpError(409,'只能更正老板本人代登记、明确关联本原单的现金交款来源');
 const allocations=(store.saleFundResponsibilityAllocations||[]).filter(x=>x.handoverId===h.id&&!x.revokedAt);
 if(allocations.length!==1||allocations[0].allocations?.length!==1)throw new c.HttpError(409,'本交接存在复杂分配，请逐笔核对');
 const allocation=allocations[0],part=allocation.allocations[0];if(part.orderId!==row.orderId||part.partId!==row.partId||part.amountCents!==accounts.cents(h.actualAmount)||funds().handoverUsed(store,h.id)!==part.amountCents)throw new c.HttpError(409,'交接金额与本原单分配不一致，不可直接更正');
 const evidence=master.clean(payload.evidence,'更正为老板直接收款的依据',500);if(evidence.length<4)throw new c.HttpError(400,'更正依据至少4字');
 const prior=(store.saleFundResponsibilityConfirmations||[]).find(x=>x.orderId===row.orderId&&x.partId===row.partId);if(prior&&prior.ownerId!==who.id)throw new c.HttpError(409,'已存在其他持有人核收，请先核对');
 return {orderId:row.orderId,partId:row.partId,handoverId:h.id,allocationId:allocation.id,actualAmount:h.actualAmount,transactionDate:h.transactionDate,evidence,onBehalfOf:row.operatorId,operator:row.operator,coverageRanges:structuredClone(part.coverageRanges),pendingBefore:row.pendingAmount,pendingAfter:row.pendingAmount,previewToken:hash(['direct-cash-source-correction-v132',who.id,row,h,allocation,prior||null,evidence]),noNewReceipt:true,noNewPayment:true,noLedgerChange:true};
}
function correct(store,user,payload){
 if(payload.confirmed!==true)throw new c.HttpError(400,'请由老板本人确认是直接收到顾客现金，营业员没有经手');
 const p=correctionPreview(store,user,payload);if(payload.previewToken!==p.previewToken)throw new c.HttpError(409,'来源记录已变化，请重新预览');
 const who=funds().owner(store,user),record=writeConfirmation(store,who,p),h=store.cashHandovers.find(x=>x.id===p.handoverId),allocation=store.saleFundResponsibilityAllocations.find(x=>x.id===p.allocationId),at=c.now();
 h.sourceCorrection={fromReceiptKind:h.receiptKind,fromStatus:h.status,by:who.id,at,evidence:p.evidence,confirmationId:record.id};h.status='已更正为老板直接收款';h.events.push({type:'来源更正：营业员未经手，老板直接收到顾客现金',by:who.id,at,evidence:p.evidence,confirmationId:record.id});
 allocation.revokedAt=at;allocation.revokedReason='来源更正为老板直接收到顾客现金；同额核收证据接续，不再次收款';allocation.replacedByConfirmationId=record.id;
 c.audit(store,who,'sale-fund-responsibility:correct-cash-source',{orderId:p.orderId,partId:p.partId,handoverId:h.id,allocationId:allocation.id,confirmationId:record.id,amount:p.actualAmount,evidence:p.evidence});
 return {row:funds().project(store).find(x=>x.orderId===p.orderId&&x.partId===p.partId),confirmation:record,sourceCorrection:h.sourceCorrection,noNewReceipt:true,noNewPayment:true,noLedgerChange:true};
}
function receiptState(store,receipt){
 if(receipt.kind!=='sale'||receipt.account!=='现金'||receipt.isReversal)return null;
 if(require('./account-ownership').isStoreAccount(store,receipt))return null;
 const row=funds().project(store).find(x=>x.cash&&x.orderId===receipt.sourceId&&x.partId===(receipt.partId||'legacy'));if(!row?.directCashCoverageRanges?.length)return null;
 const record=(store.saleFundResponsibilityConfirmations||[]).find(x=>x.orderId===row.orderId&&x.partId===row.partId),event=record?.events?.at(-1);if(!['owner_direct_cash','owner_settlement'].includes(event?.receiptKind))return null;
 const reversed=new Set((store.receipts||[]).filter(x=>x.originalReceiptId&&(x.isReversal||/_red$/.test(x.kind||''))).map(x=>x.originalReceiptId));if(reversed.has(receipt.id))return null;
 const selected=(store.receipts||[]).filter(x=>x.kind==='sale'&&x.sourceId===row.orderId&&(x.partId||'legacy')===row.partId&&!x.isReversal&&!reversed.has(x.id)&&Number(x.amount)>0),index=selected.findIndex(x=>x.id===receipt.id);if(index<0)return null;
 const start=selected.slice(0,index).reduce((n,x)=>n+accounts.cents(x.amount),0),end=start+accounts.cents(receipt.amount),covered=row.directCashCoverageRanges.reduce((n,x)=>n+Math.max(0,Math.min(end,x.toCents)-Math.max(start,x.fromCents)),0);if(!covered)return null;
 const previous=(store.moneyVerifications||[]).find(x=>x.receiptId===receipt.id);if(previous?.events?.at(-1)?.at>event.at)return null;
 const reportedAmount=c.round(Math.abs(Number(receipt.amount))),verifiedAmount=covered/100;
 return {receiptId:receipt.id,sourceId:receipt.sourceId,direction:'receive',account:receipt.account,accountName:receipt.accountName||receipt.account,accountOwnerId:record.ownerId,reportedAmount,verifiedAmount,unverifiedAmount:c.round(reportedAmount-verifiedAmount),version:previous?.version||0,status:verifiedAmount===reportedAmount?'verified':'partial',statusLabel:event.receiptKind==='owner_settlement'?(verifiedAmount===reportedAmount?'老板本人已实收（代经办消挂）':'老板本人部分实收（代经办消挂）'):verifiedAmount===reportedAmount?'老板已直接收到顾客现金（代经办核收）':'老板已部分直接核收现金',verifiedByHolder:verifiedAmount===reportedAmount,verification:null,derivedOwnerDirectReceipt:{confirmationId:record.id,at:event.at,by:event.by,onBehalfOf:row.operatorId,evidence:event.evidence},reference:receipt.reference||'',note:event.receiptKind==='owner_settlement'?'老板本人实收，保留原经办、原账户安排及确认轨迹，不重复收入。':'老板本人直接核收，保留原经办；营业员未实际经手现金，不要求营业员确认，不重复收入。'};
}
module.exports={preview,confirm,correctionPreview,correct,receiptState};
