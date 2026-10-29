'use strict';
const c=require('./common');
const accounts=require('./payment-accounts');
const packets=require('./order-red-packets');
const sources=require('./order-red-packet-sources');

const VERSION='bayu-sit-deduct-20261028-v1';
const TIERS=Object.freeze({
  '19':Object.freeze({monthlyFee:19,customerPay:70,redPacket:20}),
  '29':Object.freeze({monthlyFee:29,customerPay:80,redPacket:20}),
  '39':Object.freeze({monthlyFee:39,customerPay:110,redPacket:28}),
  '59':Object.freeze({monthlyFee:59,customerPay:140,redPacket:35})
});
const LINES=Object.freeze([
  Object.freeze({key:'new_card',name:'新办巴渝卡',quantity:1,unit:'张'}),
  Object.freeze({key:'commitment_package',name:'承诺套餐',quantity:1,unit:'笔'}),
  Object.freeze({key:'huibayu_one',name:'惠巴渝1元档',quantity:1,unit:'笔'}),
  Object.freeze({key:'terminal_coupon',name:'终端优惠券',quantity:1,unit:'笔'})
]);
const FIELDS=new Set(['tier','openedNumber','externalOrderNo','cardSerial','serviceDate','paymentAccountId','receiptReference','employeeId','completedLines']);
function text(value,label,max=100,required=true){
 if(typeof value!=='string'||(required&&!value.trim())||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw new c.HttpError(400,label+'不正确');
 return value.trim();
}
function actor(store,user){const who=sources.actual(store,user);c.permit(who,'sell');return who;}
function current(store,user){
 const who=actor(store,user),caps=c.capabilities(who);
 return {who,all:who.roleCode==='owner'||caps.finance||caps.allSales};
}
function tierFor(value){
 const key=String(value||'').trim(),row=TIERS[key];
 if(!row)throw new c.HttpError(400,'请选择19、29、39或59元档');
 return {...row,mode:'坐扣模式',cardName:'巴渝卡',ruleVersion:VERSION};
}
function receiptAccounts(store,user){
 return accounts.list(store,user).rows.filter(row=>row.active!==false&&(row.channel==='现金'&&row.accountScope==='store'||row.channel==='微信'&&row.accountScope!=='store'));
}
function accountFor(store,user,id){
 const row=receiptAccounts(store,user).find(a=>a.id===id);
 if(!row)throw new c.HttpError(409,'请选择实际收款的微信扫码账户或门店现金，不能用信号机微信代收');
 return row;
}
function create(store,user,payload){
 const who=actor(store,user);c.permit(who,'receiptRegister');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!FIELDS.has(k)))throw new c.HttpError(400,'组合办理内容不正确');
 if(!Array.isArray(payload.completedLines)||payload.completedLines.length!==LINES.length||new Set(payload.completedLines).size!==LINES.length||LINES.some(line=>!payload.completedLines.includes(line.key)))throw new c.HttpError(400,'号卡及三项随卡业务须逐项核对办成后才能提交');
 const tier=tierFor(payload.tier),openedNumber=text(payload.openedNumber,'新办号码',11),externalOrderNo=text(payload.externalOrderNo,'移动业务编号',80),cardSerial=text(payload.cardSerial||'','号卡卡号',100,false);
 if(!/^1[3-9]\d{9}$/.test(openedNumber))throw new c.HttpError(400,'新办号码须为11位手机号');
 if((store.mobileCardBundles||[]).some(row=>row.externalOrderNo===externalOrderNo||row.openedNumber===openedNumber||cardSerial&&row.cardSerial===cardSerial))throw new c.HttpError(409,'这张卡、号码或移动业务编号已经登记，请先核对原单');
 if((store.carrierServices||[]).some(row=>row.externalOrderNo===externalOrderNo))throw new c.HttpError(409,'移动业务编号已在普通移动业务中登记，请核对原单');
 const serviceDate=text(payload.serviceDate,'办理日期',10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)||serviceDate>c.day()||c.day(serviceDate+'T04:00:00.000Z')!==serviceDate)throw new c.HttpError(400,'办理日期不正确');
 if((store.dailyCloseouts||[]).some(row=>row.date===serviceDate&&row.status==='已锁定'))throw new c.HttpError(409,'该营业日已锁定，请按日结更正流程处理');
 const receiptReference=text(payload.receiptReference,'实际收款流水或现金收讫说明',100);
 if(receiptReference.length<4)throw new c.HttpError(400,'实际收款凭据至少4字');
 const account=accountFor(store,who,text(payload.paymentAccountId,'收款账户',100));
 const targetId=who.roleCode==='owner'?text(payload.employeeId,'红包领取营业员',100):who.id;
 const target=c.userById(store,targetId);
 if(target.roleCode!=='employee'||target.status!=='active'||target.assistantCustomerOnly)throw new c.HttpError(400,'红包领取人须为在职营业员');
 const at=c.now(),row={id:c.id('MCB'),title:'巴渝卡坐扣 '+tier.monthlyFee+'元档',businessCategory:'移动业务',businessType:'新办卡组合办理',operator:'中国移动',cardName:'巴渝卡',mode:'坐扣模式',tier:String(tier.monthlyFee),ruleSnapshot:tier,employeeCompensation:'红包代替提成',employeeCommissionAmount:0,lines:LINES.map(item=>({...item,status:'员工登记已办理'})),openedNumber,openedMask:openedNumber.slice(0,3)+'****'+openedNumber.slice(-4),externalOrderNo,cardSerial,cardInventoryState:'未关联号卡商品档案，不自动扣减库存',customerPay:tier.customerPay,requestedRedPacket:tier.redPacket,employeeId:target.id,employeeName:target.name,operatorId:who.id,operatorName:who.name,serviceDate,createdAt:at,status:'员工登记已办成',events:[{type:'员工逐项登记已办成',by:who.id,at,externalOrderNo,completedLines:[...payload.completedLines]}]};
 (store.mobileCardBundles||=[]).unshift(row);
 const income=require('./financial-documents').createMobileCardBundleReceipt(store,who,{bundleId:row.id,amount:tier.customerPay,paymentAccountId:account.id,account:account.channel,reference:receiptReference,date:serviceDate});
 row.incomeId=income.sourceId;row.receiptIds=income.receiptIds;row.events.push({type:'员工登记门店实收',by:who.id,at:c.now(),incomeId:row.incomeId,receiptIds:[...row.receiptIds],amount:tier.customerPay,accountId:account.id});
 const packet=packets.request(store,who,{collection:'mobileCardBundles',sourceId:row.id,requestedAmount:tier.redPacket,employeeId:target.id,reason:'巴渝卡坐扣模式 '+tier.monthlyFee+'元档新办卡组合办理'});
 row.redPacketId=packet.id;row.events.push({type:'自动生成营业员红包申请',by:who.id,at:c.now(),redPacketId:packet.id,amount:tier.redPacket});
 c.audit(store,who,'mobile-card-bundle:create',{id:row.id,incomeId:row.incomeId,receiptIds:row.receiptIds,redPacketId:row.redPacketId,customerPay:tier.customerPay,requestedRedPacket:tier.redPacket,ruleVersion:VERSION});
 return project(store,row);
}
function project(store,row){
 const income=(store.otherIncome||[]).find(item=>item.id===row.incomeId),receipts=(store.receipts||[]).filter(item=>row.receiptIds?.includes(item.id)),packet=(store.orderRedPackets||[]).find(item=>item.id===row.redPacketId);
 const validIncome=!!income&&!income.redReversedBy&&receipts.length===row.receiptIds?.length&&receipts.reduce((sum,item)=>sum+accounts.cents(Math.max(0,Number(item.amount)||0)),0)===accounts.cents(row.customerPay);
 return {...structuredClone(row),openedNumber:row.openedMask,receiptAccount:receipts[0]?.accountName||receipts[0]?.account||'',receiptHolder:receipts[0]?.accountOwnerName||'',receiptReference:receipts[0]?.reference||income?.reference||'',incomeStatus:!income?'收款原单缺失，须核查':income.redReversedBy?'已红冲，须核查':validIncome?(income.reconciliation?.status||'已登记待对账'):'收款流水不完整，须核查',incomeCounted:validIncome,redPacketStatus:packet?.status||'红包申请缺失，须核查',redPacketApprovedAmount:packet?.approvedAmount??null,redPacketPaidAmount:packet?.status==='已支付'?packet.approvedAmount:null};
}
function list(store,user){
 const {who,all}=current(store,user),rows=(store.mobileCardBundles||[]).filter(row=>all||row.employeeId===who.id||row.operatorId===who.id).map(row=>project(store,row));
 const summary=Object.values(TIERS).map(tier=>{const matching=rows.filter(row=>Number(row.tier)===tier.monthlyFee&&row.incomeCounted);return {tier:tier.monthlyFee,orders:matching.length,customerIncome:matching.reduce((n,row)=>n+accounts.cents(row.customerPay),0)/100,redPacketRequested:matching.reduce((n,row)=>n+accounts.cents(row.requestedRedPacket),0)/100,redPacketPaid:matching.reduce((n,row)=>n+accounts.cents(row.redPacketPaidAmount||0),0)/100};});
 return {rows,summary,ruleVersion:VERSION,tiers:Object.values(TIERS),accounts:receiptAccounts(store,who).map(a=>({id:a.id,name:a.displayName||a.name,channel:a.channel,accountScope:a.accountScope,ownerName:a.ownerName})),employees:who.roleCode==='owner'?(store.users||[]).filter(row=>row.roleCode==='employee'&&row.status==='active'&&!row.assistantCustomerOnly).map(row=>({id:row.id,name:row.name})):[],canCreate:c.capabilities(who).receiptRegister===true,all};
}
module.exports={VERSION,TIERS,LINES,create,list,project};
