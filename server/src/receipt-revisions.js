'use strict';
const c=require('./common'),master=require('./master-data');
const RETURNED='待营业员更正';
function original(store,id){
 const row=(store.otherIncome||[]).find(r=>r.id===id),receipts=(store.receipts||[]).filter(r=>r.sourceId===id&&r.kind==='other_income'&&!r.isReversal);
 if(!row||!row.reconciliation||!receipts.length)throw new c.HttpError(404,'没有找到可更正的原收款单');
 if(row.redReversedBy||receipts.some(r=>(store.receipts||[]).some(x=>x.originalReceiptId===r.id&&(x.isReversal||x.kind==='other_income_red'))))throw new c.HttpError(409,'原单已红冲，请核对原单状态');
 const dates=new Set([row.date||c.day(row.createdAt),c.day()]);if((store.dailyCloseouts||[]).some(r=>dates.has(r.date)&&r.status==='已锁定'))throw new c.HttpError(409,'相关营业日已锁定，请先办理日结更正');
 return {row,receipts};
}
function sync(row,receipts,next){row.reconciliation=next;for(const r of receipts)r.reconciliation=structuredClone(next);}
function returnReceipt(store,user,payload){
 const who=require('./sale-return-requests').assertOwner(store,user),{row,receipts}=original(store,payload.id),current=row.reconciliation;
 if(payload.version!==current.version||!['待老板核对','有差异','已核对'].includes(current.status))throw new c.HttpError(409,'单据状态已变化，请刷新');
 const operatorId=row.registeredById||current.registeredById||row.operatorId,target=(store.users||[]).find(r=>r.id===operatorId&&r.status==='active');
 if(!target||target.id===who.id||target.assistantCustomerOnly)throw new c.HttpError(409,'原经办人无法接收更正，请由老板核实原单');
 const note=master.clean(payload.note||'请核对单据资料，更正后重新提交。','更正要求',500,true),at=c.now();
 const next={...structuredClone(current),status:RETURNED,version:current.version+1,returnedToId:target.id,returnedToName:target.name,returnedAt:at,returnedById:who.id,returnedByName:who.name,note};
 next.events||=[];next.events.push({action:'退回更正',by:who.id,name:who.name,at,note,beforeName:row.counterparty,beforeStatus:current.status});
 require('./store-communication').send(store,who,{recipientId:target.id,content:'收款单 '+(row.displayNo||row.id)+'（'+row.amount+'元）已退回更正：'+note+' 请进入收款单，点击“更正名称”后重新提交。',kind:'work',important:true});
 sync(row,receipts,next);for(const n of store.localCatalogNotices||[])if(n.key?.startsWith('receipt-reconciliation:'+row.id+':')){n.readAt||=at;n.resolution='已退回原营业员更正，原消息保留';}c.audit(store,who,'receipt:return-for-correction',{sourceId:row.id,operatorId:target.id,note,amount:row.amount});
 return {id:row.id,reconciliation:structuredClone(next),noAdditionalReceipt:true,message:'已退回'+target.name+'更正，原收款流水保留'};
}
function revise(store,user,payload){
 const who=master.actor(store,user);c.permit(who,'receiptRegister');
 if(Object.keys(payload).some(k=>!['id','version','name'].includes(k)))throw new c.HttpError(400,'名称更正不能修改金额、账户、日期或流水');
 const {row,receipts}=original(store,payload.id),current=row.reconciliation;
 if(current.status!==RETURNED||payload.version!==current.version)throw new c.HttpError(409,'本单未退回或状态已变化，请刷新');
 if(who.roleCode!=='owner'&&who.id!==current.returnedToId)throw new c.HttpError(403,'只能更正退回给本人的单据');
 const name=master.clean(payload.name,'名称',100),beforeName=row.counterparty;if(name===beforeName)throw new c.HttpError(400,'请按更正要求修改名称后重提');
 const at=c.now(),next={...structuredClone(current),status:'待老板核对',version:current.version+1,actualCheckedAmount:null,checkedAt:null,checkedById:null,checkedByName:null,note:'名称已更正：'+beforeName+' → '+name};
 next.events||=[];next.events.push({action:'名称更正后重新提交',by:who.id,name:who.name,at,beforeName,afterName:name,submittedForId:current.returnedToId});
 row.counterparty=name;row.counterpartyNameSnapshot=name;for(const receipt of receipts){receipt.counterparty=name;receipt.counterpartyNameSnapshot=name;}
 sync(row,receipts,next);require('./receipt-reconciliation').addNotice(store,row);
 c.audit(store,who,'receipt:revise-name',{sourceId:row.id,beforeName,afterName:name,amount:row.amount,operatorId:row.operatorId});
 return {id:row.id,reconciliation:structuredClone(next),noAdditionalReceipt:true,message:'名称已更正并重新提交老板核对'};
}
function returned(store){return (store.otherIncome||[]).filter(r=>!r.redReversedBy&&r.reconciliation?.status===RETURNED);}
module.exports={returnReceipt,revise,returned,RETURNED};
