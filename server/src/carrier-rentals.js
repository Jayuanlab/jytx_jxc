const c = require('./common');
const TYPES = {card:'号卡', recharge:'充值', broadband:'宽带', package:'套餐', contract:'设备绑合约'};
const SUBTYPES = {card:['new','replace','unknown'],recharge:['topup','unknown'],broadband:['fusion','other','unknown'],package:['up','down','other','unknown'],contract:['device','unknown']};
function monthAfter(date, offset) {
  const [year, month] = String(date).slice(0,7).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) throw new c.HttpError(400,'业务日期不正确');
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0,7);
}
function visible(row,store={}) {
  return {...row, originalDocument:require('./source-document-view').project(store,'carrierServices',row,{label:'移动业务登记单',recordedByName:row.employeeName}),mobileAppLoggedIn:typeof row.mobileAppLoggedIn==='boolean'?row.mobileAppLoggedIn:null,schedule: (row.schedule||[]).map((part) => ({...part, outstanding:c.round((part.confirmed ?? 0) - part.received)}))};
}
function list(store, user) {
  const all = c.capabilities(user).finance || c.capabilities(user).allSales;
  return (store.carrierServices || []).filter((row) => all || (row.employeeId || row.operatorId) === user.id).map(row=>visible(row,store));
}
function create(store, user, payload) {
  c.permit(user,'sell');
  const mobileAppLoggedIn=require('./reception-intake').mobileAppLogin(payload.mobileAppLoggedIn);
  const business = require('./business-options').resolve(store,payload);
  const serviceDate = c.text(payload.serviceDate,'业务日期');
  const subType = business.subType;
  const transactionAmount = business.type === 'recharge' && payload.transactionAmount != null && payload.transactionAmount !== '' ? c.money(payload.transactionAmount,'话费充值金额') : null;
  if(business.type === 'recharge' && transactionAmount != null && transactionAmount <= 0)throw new c.HttpError(400,'话费充值金额须大于零');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || Number.isNaN(Date.parse(serviceDate))) throw new c.HttpError(400,'业务日期不正确');
  if((store.dailyCloseouts||[]).some((r)=>r.date===serviceDate&&r.status==='已锁定'))throw new c.HttpError(409,'该营业日已锁定，请由老板解锁后补录');
  const externalOrderNo = c.text(payload.externalOrderNo,'移动系统业务编号');
  if (externalOrderNo.length > 80) throw new c.HttpError(400,'业务编号过长');
  if ((store.carrierServices || []).some((row) => row.externalOrderNo === externalOrderNo)) throw new c.HttpError(409,'移动系统业务编号已登记');
  if ((store.mobileCardBundles || []).some((row) => row.externalOrderNo === externalOrderNo)) throw new c.HttpError(409,'该业务编号已在新办卡组合办理单登记；红包代替营业员提成，不能重复开普通移动业务单');
  let customerPhone=String(payload.customerPhone||'').trim();
  let reception=null;
  if(payload.receptionId)require('./reception-availability').assertEnabled();
  if(payload.receptionId){
    reception=(store.receptions||[]).find(x=>x.id===payload.receptionId);
    if(!reception)throw new c.HttpError(404,'关联接待单不存在');
    const linked=(store.customers||[]).find(x=>x.id===reception.customerId);
    if(linked?.phone&&customerPhone&&customerPhone!==linked.phone)throw new c.HttpError(409,'移动业务与接待单的顾客手机号不一致');
    if(linked?.phone)customerPhone=linked.phone;
  }
  if(customerPhone&&!/^1[3-9]\d{9}$/.test(customerPhone))throw new c.HttpError(400,'顾客手机号须为11位');
  const policy=require('./carrier-commission-rules');
  const selectedProduct=require('./carrier-product-commission').plan(payload.commissionProductId,serviceDate,business);
  const matched=selectedProduct||policy.plan(store,payload.type,payload.subType||'unknown',serviceDate);
  const schedule=matched?.schedule||[];
  // 补卡和零酬金业务允许全部为零；预计额不是已确认收入。
  const row = {id:c.id('MB'),commissionRuleSnapshot:matched?.rule||null,commissionRuleStatus:matched?(matched.status||'已匹配'):'待配置',...(selectedProduct?{commissionProductId:selectedProduct.product.id,commissionProductSnapshot:selectedProduct.product}:{}),...(Array.isArray(payload.monthlyAmounts)?{legacySubmittedAmounts:structuredClone(payload.monthlyAmounts)}:{}),mobileAppLoggedIn,...business,subType,transactionAmount,operator:'中国移动',externalOrderNo,serviceDate,reference:String(payload.reference || '').trim().slice(0,80),employeeId:user.id,employeeName:user.name,createdAt:c.now(),schedule,note:String(payload.note || '').trim().slice(0,500)};
  if(customerPhone){
    store.customers ||= [];
    let client=store.customers.find(x=>x.phone===customerPhone);
    if(!client){client={id:c.id('CU'),phone:customerPhone,name:'',createdAt:c.now()};store.customers.unshift(client);}
    row.customerId=client.id;
    row.customerMask=customerPhone.slice(0,3)+'****'+customerPhone.slice(-4);
  }
  store.carrierServices ||= []; store.carrierServices.unshift(row);
  c.audit(store,user,'carrier:service',row.id+' '+row.typeName+' '+externalOrderNo);
  const {notice} = require('./feishu-notices');
  notice(store,'carrier-service:'+row.id,'移动业务登记',{id:row.id,summary:row.typeName+' · 移动业务编号 '+externalOrderNo+' · 分 '+schedule.length+' 月预计结算'});
  if(payload.receptionId){require('./receptions').link(store,user,{receptionId:payload.receptionId,direct:true},'移动业务单',row);row.receptionId=payload.receptionId;}
  return visible(row,store);
}
function confirm(store,user,payload) {
  c.permit(user,'finance');
  const row = (store.carrierServices || []).find((item) => item.id === payload.id);
  if (!row) throw new c.HttpError(404,'移动业务单不存在');
  const part = row.schedule.find((item) => item.month === payload.month);
  if (!part) throw new c.HttpError(404,'结算月份不存在');
  if (part.confirmed != null) throw new c.HttpError(409,'该月已确认；差异请通过补充结算单处理');
  const statementNo = c.text(payload.statementNo,'移动结算单号');
  if ((store.carrierServices || []).some((service) => service.schedule.some((item) => item.statementNo === statementNo && item.month === part.month))) throw new c.HttpError(409,'结算单号与月份重复');
  part.confirmed = c.money(payload.amount,'移动系统确认金额');
  part.statementNo = statementNo;
  part.confirmedAt = c.now(); part.confirmedBy = user.id;
  part.note = String(payload.note || '').trim().slice(0,500);
  c.audit(store,user,'carrier:confirm',row.id+' '+part.month+' '+part.confirmed);
  const {notice} = require('./feishu-notices');
  notice(store,'carrier-confirm:'+row.id+':'+part.month,'移动业务结算',{id:row.id,summary:part.month+' 预计 '+part.expected+' 元，移动确认 '+part.confirmed+' 元，差异 '+c.round(part.confirmed-part.expected)+' 元'});
  return visible(row,store);
}
function receive(store,user,payload) {
  c.permit(user,'finance');
  const row = (store.carrierServices || []).find((item) => item.id === payload.id);
  if (!row) throw new c.HttpError(404,'移动业务单不存在');
  const part = row.schedule.find((item) => item.month === payload.month);
  if (!part || part.confirmed == null) throw new c.HttpError(409,'请先按移动结算单确认本月金额');
  const amount = require('./payment-accounts').cents(payload.amount,'实际到账金额')/100;
  if (amount <= 0 || c.round(part.received + amount) > part.confirmed) throw new c.HttpError(409,'到账金额超过本月已确认金额');
  const bankRef = c.text(payload.bankRef,'到账流水号');require('./payment-accounts').reference(store,bankRef);
  if ((store.carrierServices || []).some((service) => service.schedule.some((item) => item.events.some((event) => event.bankRef === bankRef)))) throw new c.HttpError(409,'到账流水号已登记');
  const pa=require('./payment-accounts'),paymentParts=pa.normalize(store,payload,amount);const account=paymentParts.length===1?paymentParts[0].account:'多账户';
  const event = {id:c.id('MRC'),bankRef,amount,account,paymentParts,createdAt:c.now(),operatorId:user.id};
  part.events.push(event); part.received = c.round(part.received + amount);
  require('./payroll').accrueCarrierReceipt(store,row,part,event);
  pa.record(store,user,'carrier_rental',event.id,paymentParts.map(part=>({...require('./account-ownership').project(store,part),...(!part.reference&&paymentParts.length===1?{reference:bankRef}:{})})));
  c.audit(store,user,'carrier:receive',row.id+' '+part.month+' '+amount);
  const {notice} = require('./feishu-notices');
  notice(store,'carrier-receive:'+event.id,'移动业务到账',{id:row.id,summary:part.month+' 到账 '+amount+' 元，流水 '+bankRef,amount});
  return visible(row,store);
}
module.exports = {TYPES,SUBTYPES,monthAfter,list,create,confirm,receive};
