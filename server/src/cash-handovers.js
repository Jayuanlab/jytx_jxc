const c = require("./common");
const { notice } = require("./feishu-notices");

const KINDS = { person: "现金交接", bank: "现金缴存银行卡" };
function visible(store, user, row) {
  return user.roleCode === "owner" || row.senderId === user.id || row.recipientId === user.id;
}
function list(store, user) {
  c.permit(user, "learn");
  return (store.cashHandovers || []).filter((row) => visible(store, user, row)).slice().reverse();
}
function create(store, user, payload) {
  c.permit(user, "sell");
  const kind = String(payload.kind || "");
  if (!KINDS[kind]) throw new c.HttpError(400, "请选择现金交接或存入银行卡");
  const recipient = c.userById(store, payload.recipientId);
  if (recipient.id === user.id) throw new c.HttpError(400, "交出人不能确认自己交出的现金");
  if (!c.capabilities(recipient).finance) throw new c.HttpError(400, "接收人须有财务权限并用本人账号确认");
  if (kind === "bank" && recipient.roleCode !== "owner")
    throw new c.HttpError(400, "现金存入老板银行卡须由老板确认");
  const amount = c.money(payload.amount, "交接金额");
  if (amount <= 0) throw new c.HttpError(400, "交接金额须大于零");
  const note = String(payload.note || "").trim().slice(0, 500);
  const row = {
    id: c.id("CH"), kind, kindName: KINDS[kind],
    senderId: user.id, sender: user.name,
    recipientId: recipient.id, recipient: recipient.name,
    amount, status: "待接收人确认", note,
    createdAt: c.now(),
    events: [{ type: "提交交接", by: user.id, at: c.now(), amount }],
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
  const row = find(store, payload.id);
  if (row.recipientId !== user.id || row.senderId === user.id)
    throw new c.HttpError(403, "只有指定接收人本人可以确认");
  if (row.status !== "待接收人确认") throw new c.HttpError(409, "交接单已经处理");
  const actual = c.money(payload.actualAmount, "实收金额");
  if (actual !== row.amount)
    throw new c.HttpError(409, "实收金额与交出金额不同，请驳回并写明实收金额");
  const bankRef = String(payload.bankRef || "").trim().slice(0, 80);
  if (row.kind === "bank") {
    if (!bankRef) throw new c.HttpError(400, "请填写银行卡入账流水号");
    if ((store.cashHandovers || []).some((r) => r.id !== row.id && r.bankRef === bankRef))
      throw new c.HttpError(409, "银行卡入账流水号已使用");
  }
  row.status = "已确认收到";
  row.actualAmount = actual;
  row.bankRef = bankRef;
  row.confirmedAt = c.now();
  row.confirmedBy = user.id;
  row.events.push({ type: "接收人确认", by: user.id, at: row.confirmedAt, amount: actual, bankRef });
  c.audit(store, user, "cash-handover:confirm", row.id + " " + actual);
  notice(store, "cash-handover-confirm:" + row.id, "现金交接已确认", {
    id: row.id, summary: row.sender + " → " + row.recipient + " · " + actual + " 元" + (bankRef ? " · 银行流水 " + bankRef : ""),
  });
  return row;
}
function reject(store, user, payload) {
  const row = find(store, payload.id);
  if (row.recipientId !== user.id || row.senderId === user.id)
    throw new c.HttpError(403, "只有指定接收人本人可以驳回");
  if (row.status !== "待接收人确认") throw new c.HttpError(409, "交接单已经处理");
  const reason = c.text(payload.reason, "差异说明").slice(0, 500);
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
module.exports = { KINDS, list, create, confirm, reject };

