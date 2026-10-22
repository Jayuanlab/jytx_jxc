const c = require("./common");
function owner(user) { return user.roleCode === "owner"; }
function active(store, id) { return store.users.find((u) => u.id === id && u.status === "active"); }
function cashier(store, user, id) {
  const target = id ? active(store, id) : user;
  if (!target) throw new c.HttpError(404, "营业员不存在");
  if (!owner(user) && target.id !== user.id) throw new c.HttpError(403, "只能查看自己的交班账");
  return target;
}
function closeouts(store, user) {
  store.closeouts ||= [];
  return store.closeouts.filter((r) => owner(user) || r.cashierId === user.id || r.receiverId === user.id).slice().reverse();
}
function snapshot(store, user, cashierId) {
  c.permit(user, "sell");
  const person = cashier(store, user, cashierId);
  const prior = (store.closeouts || []).filter((r) => r.cashierId === person.id);
  const last = prior.at(-1);
  const startAt = last ? last.endAt : "";
  const endAt = c.now();
  const used = (key) => new Set(prior.flatMap((r) => r[key] || []));
  const inPeriod = (ids) => (row) => row.operatorId === person.id && !ids.has(row.id) && row.createdAt <= endAt;
  const receipts = store.receipts.filter(inPeriod(used("receiptIds")));
  const sales = store.sales.filter(inPeriod(used("saleIds")));
  const returns = store.saleReturns.filter(inPeriod(used("returnIds")));
  const accounts = {};
  for (const row of receipts) accounts[row.account] = c.round((accounts[row.account] || 0) + row.amount);
  return {
    cashierId: person.id, cashier: person.name, startAt, endAt,
    openingCash: last ? last.actualCash : 0,
    accounts, salesCount: sales.length, returnCount: returns.length,
    salesAmount: c.round(sales.reduce((n, x) => n + x.amount, 0)),
    refundAmount: c.round(returns.reduce((n, x) => n + x.amount, 0)),
    receiptIds: receipts.map((x) => x.id), saleIds: sales.map((x) => x.id), returnIds: returns.map((x) => x.id),
    expectedCash: c.round((last ? last.actualCash : 0) + (accounts["现金"] || 0)),
  };
}
function submit(store, user, payload) {
  const shot = snapshot(store, user, user.id);
  const actualCash = c.money(payload.actualCash, "实点现金");
  const note = String(payload.note || "").trim().slice(0, 500);
  const difference = c.round(actualCash - shot.expectedCash);
  if (difference && !note) throw new c.HttpError(400, "现金有差异，请填写原因");
  const receiver = active(store, payload.receiverId);
  if (!receiver || receiver.id === user.id) throw new c.HttpError(400, "请选择另一位在职交接人");
  const row = {
    id: c.id("CL"), ...shot, actualCash, difference, note,
    receiverId: receiver.id, receiver: receiver.name,
    status: "待核对", submittedAt: c.now(), confirmedAt: null, confirmedBy: null,
  };
  store.closeouts ||= [];
  store.closeouts.push(row);
  c.audit(store, user, "closeout:submit", row.id + " 现金差异 " + difference);
  const { notice } = require("./feishu-notices");
  notice(store, "closeout:" + row.id, "交班待确认", {
    id: row.id,
    summary: row.cashier + " → " + row.receiver + "；销售 " + row.salesCount + " 单；实点现金 " + actualCash + " 元；差异 " + difference + " 元",
  });
  return row;
}
function confirm(store, user, payload) {
  if (!owner(user)) throw new c.HttpError(403, "只有老板可以确认交班");
  const row = (store.closeouts || []).find((r) => r.id === payload.id);
  if (!row) throw new c.HttpError(404, "交班记录不存在");
  if (row.status !== "待核对") throw new c.HttpError(409, "该交班记录已处理");
  const decision = payload.decision === "确认" ? "已确认" : payload.decision === "退回" ? "待复核" : "";
  if (!decision) throw new c.HttpError(400, "请选择确认或退回");
  const note = String(payload.note || "").trim().slice(0, 500);
  if (decision === "待复核" && !note) throw new c.HttpError(400, "退回必须说明原因");
  row.status = decision;
  row.confirmedAt = c.now();
  row.confirmedBy = user.id;
  row.reviewNote = note;
  c.audit(store, user, "closeout:review", row.id + " " + decision);
  return row;
}
function revise(store, user, payload) {
  const row = (store.closeouts || []).find((r) => r.id === payload.id);
  if (!row) throw new c.HttpError(404, "交班记录不存在");
  if (row.cashierId !== user.id || row.status !== "待复核")
    throw new c.HttpError(403, "只能补正本人被退回的交班记录");
  if ((store.closeouts || []).some((r) => r.cashierId === user.id && r.submittedAt > row.submittedAt)) throw new c.HttpError(409, "后续交班已提交，请由老板登记调整");
  const actualCash = c.money(payload.actualCash, "实点现金");
  const note = String(payload.note || "").trim().slice(0, 500);
  const difference = c.round(actualCash - row.expectedCash);
  if (difference && !note) throw new c.HttpError(400, "现金有差异，请填写原因");
  row.revisions ||= [];
  row.revisions.push({ actualCash: row.actualCash, note: row.note, at: c.now() });
  row.actualCash = actualCash;
  row.difference = difference;
  row.note = note;
  row.status = "待核对";
  row.confirmedAt = null;
  row.confirmedBy = null;
  c.audit(store, user, "closeout:revise", row.id);
  const { notice } = require("./feishu-notices");
  notice(store, "closeout-revise:" + row.id + ":" + row.revisions.length, "交班待确认", {
    id: row.id, summary: row.cashier + " 已补正交班；实点现金 " + actualCash + " 元；差异 " + difference + " 元",
  });
  return row;
}
module.exports = { snapshot, closeouts, submit, confirm, revise };