'use strict';
const c=require('./common'),master=require('./master-data');
const POLICY='store-custody-handover-v1';
const inVault=r=>r.cashDestination!=='employee';
const custodianId=r=>r.custodianId||(r.cashDestination==='employee'?(r.accountOwnerId||r.operatorId):'')||'';
function place(s,u,p={}){
 const actor=master.actor(s,u),destination=p.cashDestination??'vault';
 if(!['vault','employee'].includes(destination))throw new c.HttpError(400,'现金去向请选择门店抽屉或营业员暂存');
 const vault=require('./cash-vault').account(s);if(!vault)throw new c.HttpError(409,'门店现金账户尚未设置');
 return {accountScope:'store',cashDestination:destination,cashCustodyDeclaredBy:actor.id,cashCustodyDeclaredAt:c.now(),accountOwnerId:'',accountOwnerName:'门店',accountName:vault.name,paymentAccountId:vault.id,custodianId:destination==='employee'?actor.id:'',custodianName:destination==='employee'?actor.name:'门店抽屉',custodyLocation:destination==='employee'?'employee':'vault',...(vault.verifierId?{verifierId:vault.verifierId,verifierName:vault.verifierName||''}:{})};
}
function moved(s,id){return c.round((s.cashVaultTransfers||[]).filter(x=>x.receiptId===id).reduce((n,x)=>n+Number(x.amount),0));}
function receive(s,u,receipt,amount,key){
 const actor=master.actor(s,u);if(actor.id!==receipt.operatorId&&actor.roleCode!=='owner')throw new c.HttpError(403,'须由原经办营业员确认入门店抽屉，转交个人须走内部交接单');
 if(receipt.account!=='现金'||inVault(receipt)||receipt.amount<=0||receipt.sourceClaimId)return 0;
 const n=require('./payment-accounts').cents(amount)/100,left=c.round(receipt.amount-moved(s,receipt.id)),value=c.round(Math.min(n,left));if(value<=0)return 0;
 const row={id:c.id('CVT'),receiptId:receipt.id,sourceId:receipt.sourceId,partId:receipt.partId||'legacy',fromId:custodianId(receipt)||receipt.operatorId,amount:value,date:c.day(),at:c.now(),by:actor.id,name:actor.name,confirmationKey:key,accountScope:'store',sourceLocation:'employee',destinationLocation:'vault',noNewIncome:true};
 (s.cashVaultTransfers||=[]).push(row);c.audit(s,actor,'cash-vault:receive-held-cash',row);return value;
}
function receiveSale(s,u,orderId,partId,amount,key){let left=amount;for(const r of s.receipts||[])if(left>0&&r.kind==='sale'&&r.sourceId===orderId&&(r.partId||'legacy')===partId&&!r.isReversal)left=c.round(left-receive(s,u,r,left,key));}
function saleSourceLocation(s,allocations){
 if(!allocations?.length)return 'vault';const locations=new Set();
 for(const a of allocations){const rows=(s.receipts||[]).filter(r=>r.kind==='sale'&&r.sourceId===a.orderId&&(r.partId||'legacy')===a.partId&&r.account==='现金'&&r.amount>0&&!r.isReversal);if(!rows.length)throw new c.HttpError(409,'原销售现金尚未登记，不能先交接');for(const r of rows){if(r.cashDestination==='vault'||r.cashDestination==='employee'&&moved(s,r.id)>=r.amount)locations.add('vault');else if(r.cashDestination==='employee'&&!moved(s,r.id))locations.add('employee');else throw new c.HttpError(409,'原销售现金来源尚未明确或仅部分已入抽屉，请核清后分别开内部交接单');}}
 if(locations.size!==1)throw new c.HttpError(409,'门店抽屉与营业员暂存现金须分别开内部交接单');return [...locations][0];
}
function source(s,u,payload={}){const vault=require('./cash-vault').account(s);if(!vault)throw new c.HttpError(409,'门店现金账户尚未设置');return {ownershipPolicy:POLICY,sourceAccountScope:'store',sourceAccountId:vault.id,sourceAccountName:'门店现金',sourceLocation:saleSourceLocation(s,payload.saleAllocations),sourceCustodianId:u.id,sourceCustodianName:u.name};}
function compatiblePendingSource(s,h){
 const fail=()=>{throw new c.HttpError(409,'旧交接单尚未明确门店资金来源，请先退回，由交出人核对来源后重新提交');};
 const sender=(s.users||[]).find(u=>u.id===h.senderId),links=h.saleAllocations;
 if(!sender||h.kind!=='person'||!Array.isArray(links)||!links.length||!(h.events||[]).some(e=>e.type==='提交交接'&&e.by===h.senderId&&Number(e.amount)===Number(h.amount)))return fail();
 const seen=new Set(),receiptIds=[];let total=0;
 for(const a of links){const key=a.orderId+'/'+a.partId,n=Math.round(Number(a.amount)*100),order=(s.sales||[]).find(r=>r.id===a.orderId);if(seen.has(key)||!Number.isSafeInteger(n)||n<=0||Math.abs(Number(a.amount)*100-n)>0.00001||!order||(order.operatorId||order.salespersonId)!==h.senderId||order.redReversedBy||order.status==='returned'||(s.saleReturns||[]).some(r=>r.orderId===order.id))return fail();seen.add(key);total+=n;const rows=(s.receipts||[]).filter(r=>r.kind==='sale'&&r.sourceId===a.orderId&&(r.partId||'legacy')===a.partId&&r.account==='现金'&&Number(r.amount)>0&&!r.isReversal);if(!rows.length||rows.reduce((sum,r)=>sum+Math.round(Number(r.amount)*100),0)<n||rows.some(r=>(s.receipts||[]).some(x=>x.originalReceiptId===r.id&&(x.isReversal||/_red$/.test(x.kind||'')))))return fail();receiptIds.push(...rows.map(r=>r.id));}
 if(total!==Math.round(Number(h.amount)*100)||new Set(receiptIds).size!==receiptIds.length)return fail();
 let result;try{result=source(s,sender,{saleAllocations:links});}catch{return fail();}
 return {...result,sourceEvidence:{type:'original-sender-submission-and-sale-receipts',senderId:h.senderId,receiptIds,allocations:structuredClone(links),originalSubmittedAt:h.createdAt}};
}
function handover(s,u,h){
 // Custody moves directly; an internal handover creates no operating receipt.
 if(h.ownershipPolicy!==POLICY)return;
 if(h.status!=='已确认收到'||h.confirmedBy!==h.recipientId||u.id!==h.recipientId)throw new c.HttpError(409,'内部交接须由指定接收人本人确认');
 h.destinationAccountScope='personal';if(h.kind==='bank'){h.destinationAccountId=require('./named-fund-accounts').bankId(h.recipientId);h.destinationAccountName='老板银行卡';}h.receivedOwnerId=h.recipientId;h.receivedOwnerName=h.recipient;
 h.custodyMovement={policy:POLICY,fromScope:'store',fromAccountId:h.sourceAccountId,fromLocation:h.sourceLocation,toScope:h.destinationAccountScope,toOwnerId:h.recipientId,amount:h.actualAmount,at:h.confirmedAt,confirmedBy:h.confirmedBy,noNewIncome:true,noNewExpense:true};
}
function historicalSource(s,h){
 const links=h.saleAllocations;if(!Array.isArray(links)||!links.length)return null;
 const total=links.reduce((n,a)=>n+Math.round(Number(a.amount)*100),0);if(!Number.isSafeInteger(total)||total!==Math.round(Number(h.actualAmount)*100))return null;
 const locations=new Set();
 for(const a of links){const rows=(s.receipts||[]).filter(r=>r.kind==='sale'&&r.sourceId===a.orderId&&(r.partId||'legacy')===a.partId&&r.account==='现金'&&r.amount>0&&!r.isReversal);if(!rows.length)return null;for(const r of rows){if(r.cashDestination==='vault')locations.add('vault');else if(r.cashDestination==='employee'){const deposited=(s.cashVaultTransfers||[]).filter(t=>t.receiptId===r.id&&t.at&&t.at<=h.confirmedAt).reduce((n,t)=>n+Number(t.amount),0);if(deposited>=Number(r.amount))locations.add('vault');else if(!deposited)locations.add('employee');else return null;}else return null;}}
 if(locations.size!==1)return null;const vault=require('./cash-vault').account(s);return {sourceAccountScope:'store',sourceAccountId:vault?.id||'',sourceLocation:[...locations][0],ownershipSourceEvidence:'linked-original-cash-receipts'};
}
function confirmedStoreOutgoing(s,date){const seen=new Set(),out=[];for(const original of s.cashHandovers||[]){
 if(original.kind!=='person'||original.status!=='已确认收到'||original.sourceCorrection||original.confirmedBy!==original.recipientId||original.senderId===original.recipientId||!original.confirmedAt)continue;
 const h=original.ownershipPolicy===POLICY?original:{...original,...historicalSource(s,original)};
 if(h.sourceAccountScope!=='store'||h.sourceLocation!=='vault'||!h.sourceAccountId)continue;
 const amount=Number(h.actualAmount);if(!Number.isFinite(amount)||amount<=0||amount!==Number(h.amount))throw new c.HttpError(409,'门店现金交接金额异常，请核对原交接单');
 if(!(h.events||[]).some(e=>e.type==='接收人确认'&&e.by===h.recipientId&&Number(e.amount)===amount))continue;
 if(date&&(h.transactionDate||c.day(h.confirmedAt))!==date)continue;if(!h.id||seen.has(h.id))throw new c.HttpError(409,'门店现金交接编号重复或缺失');seen.add(h.id);out.push(h);
}return out;}
module.exports={POLICY,place,inVault,custodianId,moved,receive,receiveSale,source,compatiblePendingSource,handover,confirmedStoreOutgoing};
