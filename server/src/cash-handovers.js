const c = require("./common");
const { notice } = require("./feishu-notices");

const KINDS = { person: "现金交接", bank: "现金转存老板银行" };
function visible(store, user, row) {
  return ["owner","employee","manager","warehouse"].includes(user.roleCode) || row.senderId === user.id || row.recipientId === user.id;
}
function list(store, user) {
  c.permit(user, "learn");
  return (store.cashHandovers || []).filter((row) => visible(store, user, row)).slice().reverse().map(r=>r.kind==='bank'?{...r,kindName:'现金转存老板银行'}:r);
}
function create(store, user, payload) {
  if(require('./internal-store-transfers').handles(payload.kind))return require('./internal-store-transfers').create(store,user,payload);
  c.permit(user, "sell");
  const kind = String(payload.kind || "");
  if (!KINDS[kind]) throw new c.HttpError(400, "请选择现金交接或存入银行卡");
  let recipientId=payload.recipientId;
  if(kind==='bank'&&!recipientId){const owners=(store.users||[]).filter(u=>u.roleCode==='owner'&&u.status==='active'&&!u.assistantCustomerOnly);if(owners.length!==1)throw new c.HttpError(409,'老板接收账户不唯一，请先明确接收人');recipientId=owners[0].id;}
  if(kind==='bank'&&payload.saleAllocations?.length)throw new c.HttpError(400,'现金转存按门店现金提交，不自动核销销售挂账');
  const recipient = c.userById(store, recipientId);
  if (recipient.id === user.id) throw new c.HttpError(400, "交出人不能确认自己交出的现金");
  if (!c.capabilities(recipient).finance && recipient.cashHandoverRecipient !== true) throw new c.HttpError(400, "接收人须已获现金接收权限并用本人账号确认");
  if (kind === "bank" && recipient.roleCode !== "owner")
    throw new c.HttpError(400, "现金转存老板银行须由老板确认");
  const amount = c.money(payload.amount, "交接金额");
  if (amount <= 0) throw new c.HttpError(400, "交接金额须大于零");
  const note = String(payload.note || "").trim().slice(0, 500);
  const source = require('./cash-custody').source(store,user,payload);
  const row = {
    ...source,
    id: c.id("CH"), kind, kindName: KINDS[kind],
    ...(kind==="bank"?{destinationAccountId:require("./named-fund-accounts").bankId(recipient.id),destinationAccountName:"老板银行卡",destinationAccountScope:"personal"}:{}),
    senderId: user.id, sender: user.name,
    recipientId: recipient.id, recipient: recipient.name,
    amount, status: "待接收人确认", note,
    createdAt: c.now(),
    events: [{ type: "提交交接", by: user.id, at: c.now(), amount, sourceAccountScope:source.sourceAccountScope,sourceAccountId:source.sourceAccountId,sourceLocation:source.sourceLocation }],
  };
  store.cashHandovers ||= [];
  store.cashHandovers.unshift(row);
  c.audit(store, user, "cash-handover:submit", row.id + " " + amount);
  notice(store, "cash-handover:" + row.id, "现金交接待确认", {
    id: row.id, summary: user.name + " → " + recipient.name + " · " + KINDS[kind] + " " + amount + " 元，须接收人本人确认",
  });
  return row;
}
function find(store, id) {
  const row = (store.cashHandovers || []).find((item) => item.id === id);
  if (!row) throw new c.HttpError(404, "交接单不存在");
  return row;
}
function confirm(store, user, payload) {
  if((store.cashHandovers||[]).some(r=>r.id===payload.id&&r.policy===require('./internal-store-transfers').POLICY))return require('./internal-store-transfers').confirm(store,user,payload);
  const row = find(store, payload.id);
  if (row.recipientId !== user.id || row.senderId === user.id)
    throw new c.HttpError(403, "只有指定接收人本人可以确认");
  if (row.status !== "待接收人确认") throw new c.HttpError(409, "交接单已经处理");
  const custody=require('./cash-custody'),sourceSupplement=row.ownershipPolicy===custody.POLICY&&row.sourceAccountScope==='store'&&row.sourceAccountId&&['vault','employee'].includes(row.sourceLocation)?null:custody.compatiblePendingSource(store,row);
  const actual = c.money(payload.actualAmount, "实收金额");
  if (actual !== row.amount)
    throw new c.HttpError(409, "实收金额与交出金额不同，请驳回并写明实收金额");
  const bankRef = String(payload.bankRef || "").trim().slice(0, 80);
  if (row.kind === "bank") {
    if (bankRef && (store.cashHandovers || []).some((r) => r.id !== row.id && r.bankRef === bankRef))
      throw new c.HttpError(409, "银行卡入账流水号已使用");
  }
  row.status = "已确认收到";
  row.actualAmount = actual;
  row.bankRef = bankRef;
  row.confirmedAt = c.now();
  row.confirmedBy = user.id;
  if(sourceSupplement){Object.assign(row,sourceSupplement);row.events.push({type:'按原交出人提交与原销售流水补充门店资金来源',by:user.id,at:row.confirmedAt,originalSenderId:row.senderId,sourceAccountScope:row.sourceAccountScope,sourceAccountId:row.sourceAccountId,sourceLocation:row.sourceLocation,evidence:structuredClone(row.sourceEvidence)});}
  row.events.push({ type: "接收人确认", by: user.id, at: row.confirmedAt, amount: actual, bankRef });
  require("./cash-custody").handover(store,user,row);
  c.audit(store, user, "cash-handover:confirm", row.id + " " + actual);
  notice(store, "cash-handover-confirm:" + row.id, "现金交接已确认", {
    id: row.id, summary: row.sender + " → " + row.recipient + " · " + actual + " 元" + (bankRef ? " · 银行流水 " + bankRef : ""),
  });
  return row;
}
function reject(store, user, payload) {
  if((store.cashHandovers||[]).some(r=>r.id===payload.id&&r.policy===require('./internal-store-transfers').POLICY))return require('./internal-store-transfers').reject(store,user,payload);
  const row = find(store, payload.id);
  if (row.recipientId !== user.id || row.senderId === user.id)
    throw new c.HttpError(403, "只有指定接收人本人可以驳回");
  if (row.status !== "待接收人确认") throw new c.HttpError(409, "交接单已经处理");
  const reason = String(payload.reason || "").trim().slice(0, 500) || "未收到";
  const countedAmount = payload.countedAmount == null || payload.countedAmount === "" ? null : c.money(payload.countedAmount, "实点金额");
  row.status = "金额有异议";
  row.rejectedAt = c.now();
  row.rejectedBy = user.id;
  row.rejectReason = reason;
  row.countedAmount = countedAmount;
  row.events.push({ type: "接收人驳回", by: user.id, at: row.rejectedAt, countedAmount, reason });
  c.audit(store, user, "cash-handover:reject", row.id + " " + reason);
  notice(store, "cash-handover-reject:" + row.id, "现金交接有异议", {
    id: row.id, summary: row.sender + " → " + row.recipient + " · 交出 " + row.amount + " 元 / 实点 " + (countedAmount ?? "待核") + " 元 · " + reason,
  });
  return row;
}
function recipients(store,user){c.permit(user,'learn');return (store.users||[]).filter(x=>['owner','employee','manager','warehouse','cash-recipient'].includes(x.roleCode)).filter(x=>user.roleCode==='owner'||x.status==='active'&&(x.cashHandoverRecipient===true||c.capabilities(x).finance)).map(x=>({id:x.id,name:x.name,role:x.role,status:x.status,cashRecipient:x.cashHandoverRecipient===true||c.capabilities(x).finance,explicitCashRecipient:x.cashHandoverRecipient===true,hasFinance:c.capabilities(x).finance}));}
function setRecipient(store,user,payload){c.permit(user,'manageUsers');const target=(store.users||[]).find(x=>x.id===payload.userId);if(!target||!['employee','manager','warehouse','cash-recipient'].includes(target.roleCode))throw new c.HttpError(404,'请选择现有营业员或家属接收人');if(typeof payload.active!=='boolean')throw new c.HttpError(400,'请选择是否允许接收现金');target.cashHandoverRecipient=payload.active;c.audit(store,user,'cash-handover:recipient',{userId:target.id,active:payload.active});return {id:target.id,name:target.name,cashRecipient:target.cashHandoverRecipient};}
function resubmit(store,user,payload){c.permit(user,'sell');const row=find(store,payload.id);if(row.senderId!==user.id)throw new c.HttpError(403,'只有原交出人能重新提交');if(row.status!=='金额有异议')throw new c.HttpError(409,'此交接单不在退回待核状态');const amount=c.money(payload.amount,'重新提交金额');if(amount<=0)throw new c.HttpError(400,'交接金额须大于零');const note=String(payload.note||'').trim().slice(0,500),source=require('./cash-custody').source(store,user,{saleAllocations:payload.saleAllocations||row.saleAllocations});Object.assign(row,source);row.amount=amount;row.status='待接收人确认';row.resubmittedAt=c.now();row.resubmittedBy=user.id;row.resubmitNote=note;row.events.push({type:'交出人核实后重新提交',by:user.id,at:row.resubmittedAt,amount,note,sourceAccountScope:source.sourceAccountScope,sourceAccountId:source.sourceAccountId,sourceLocation:source.sourceLocation});c.audit(store,user,'cash-handover:resubmit',row.id+' '+amount);notice(store,'cash-handover-resubmit:'+row.id+':'+row.events.length,'现金交接重新待确认',{id:row.id,summary:row.sender+' → '+row.recipient+' · '+amount+' 元，请接收人重新核对'});return row;}
function addRecipient(store,user,payload){c.permit(user,'manageUsers');const name=c.text(payload.name,'接收人姓名');if(name.length>40)throw new c.HttpError(400,'姓名不能超过40字');if((store.users||[]).some(x=>x.name===name))throw new c.HttpError(409,'此人员已在名单中，请直接开通现金接收权限');const row={id:c.id('USR'),name,role:'现金接收人',roleCode:'cash-recipient',status:'active',permissions:[],cashHandoverRecipient:true};store.users.push(row);c.audit(store,user,'cash-handover:recipient-add',{id:row.id,name});return {id:row.id,name:row.name,role:row.role,status:row.status,cashRecipient:true};}
module.exports = require("./sale-handover-link").decorate({ KINDS, list, create, confirm, reject, recipients, setRecipient, addRecipient, resubmit });

