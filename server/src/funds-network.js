const c = require("./common");
const { notice } = require("./feishu-notices");

function people(store) {
  return store.users.filter((u) => u.status === "active" && c.capabilities(u).finance)
    .map((u) => ({ id: u.id, name: u.name, roleCode: u.roleCode }));
}
function listTransfers(store, user) {
  c.permit(user, "finance");
  return (store.fundTransfers || []).filter((r) =>
    user.roleCode === "owner" || r.fromId === user.id || r.toId === user.id).slice().reverse();
}
function createTransfer(store, user, payload) {
  c.permit(user, "finance");
  const to = c.userById(store, payload.toId);
  if (!c.capabilities(to).finance) throw new c.HttpError(400, "接收人须有财务权限");
  if (to.id === user.id) throw new c.HttpError(400, "不能转给自己");
  const amount = c.money(payload.amount, "转款金额");
  if (amount <= 0) throw new c.HttpError(400, "转款金额须大于零");
  const method = c.text(payload.method, "转款方式");
  if (!["微信", "银行卡", "支付宝"].includes(method)) throw new c.HttpError(400, "请选择实际转款方式");
  const reference = c.text(payload.reference, "转出流水号").slice(0, 80);
  if ((store.fundTransfers || []).some((r) => r.reference === reference))
    throw new c.HttpError(409, "这笔转出流水已经登记");
  const row = { id: c.id("FT"), fromId: user.id, from: user.name,
    toId: to.id, to: to.name, amount, method, reference,
    purpose: String(payload.purpose || "门店经营周转").trim().slice(0, 200),
    relatedOrderId: String(payload.relatedOrderId || "").trim().slice(0, 100),
    status: "待收款人确认", createdAt: c.now(),
    events: [{ type: "登记转出", by: user.id, at: c.now(), amount, reference }] };
  store.fundTransfers ||= [];
  store.fundTransfers.unshift(row);
  c.audit(store, user, "fund-transfer:create", row.id + " " + amount);
  notice(store, "fund-transfer:" + row.id, "门店转款待确认", {
    id: row.id, summary: row.from + " → " + row.to + " · " + amount + " 元；收款人须核对到账" });
  return row;
}
function processTransfer(store, user, payload, accepted) {
  const row = (store.fundTransfers || []).find((r) => r.id === payload.id);
  if (!row) throw new c.HttpError(404, "转款单不存在");
  if (row.toId !== user.id || row.fromId === user.id)
    throw new c.HttpError(403, "只有指定收款人本人可以确认");
  if (row.status !== "待收款人确认") throw new c.HttpError(409, "转款单已经处理");
  const actual = c.money(payload.actualAmount, "实际到账金额");
  if (accepted && actual !== row.amount)
    throw new c.HttpError(409, "到账金额不同，请选择金额有异议");
  const note = String(payload.note || "").trim().slice(0, 500);
  if (!accepted && !note) throw new c.HttpError(400, "请填写未收到或金额差异的原因");
  row.status = accepted ? "已确认到账" : "到账有异议";
  row.actualAmount = actual;
  row.processedAt = c.now();
  row.processedBy = user.id;
  row.note = note;
  row.events.push({ type: row.status, by: user.id, at: row.processedAt, actualAmount: actual, note });
  c.audit(store, user, accepted ? "fund-transfer:confirm" : "fund-transfer:reject", row.id);
  notice(store, "fund-transfer-result:" + row.id, row.status, {
    id: row.id, summary: row.from + " → " + row.to + " · 转出 " + row.amount +
      " 元，实收 " + actual + " 元" + (note ? "；" + note : "") });
  return row;
}
function confirmTransfer(store, user, payload) { return processTransfer(store, user, payload, true); }
function rejectTransfer(store, user, payload) { return processTransfer(store, user, payload, false); }

const kindNames = {
  sale:"销售收款", refund:"销售退款", purchase:"采购付款",
  supplier_payment:"供应商付款", supplier_refund:"供应商退款",
  expense:"门店费用", expense_red:"费用红冲（账务更正）", air_funding:"空充平台充值实付", cash_recharge:"顾客现金充值", carrier:"移动酬金到账", carrier_rental:"移动酬金到账",
  carrier_clawback:"移动酬金扣回", gov_subsidy:"国补返款",
  gov_subsidy_refund:"国补退款", payroll:"工资发放"
};
function network(store, user) {
  c.permit(user, "finance");
  const supplierNames = new Map((store.suppliers || []).map((s) => [s.id, s.name]));
  const userNames = new Map((store.users || []).map((u) => [u.id, u.name]));
  const rows = [];
  for (const r of store.receipts || []) {
    const amount = Number(r.amount || 0);
    if (!amount) continue;
    const owner = r.accountOwnerId ? userNames.get(r.accountOwnerId) : null;
    const account = r.account === "现金" ? "门店现金" : owner ? (r.accountName||owner) + " · " + (r.account || "账户") : "账户归属待核 · " + (r.account || "未填渠道");
    const supplier = supplierNames.get(r.supplierId) || "供应商";
    let from = "业务对方", to = account;
    if (["sale","cash_recharge"].includes(r.kind)) from = "顾客";
    else if (["carrier","carrier_rental","carrier_clawback"].includes(r.kind)) from = "中国移动";
    else if (["gov_subsidy","gov_subsidy_refund"].includes(r.kind)) from = "国补平台";
    else if (["supplier_payment","supplier_refund","purchase"].includes(r.kind)) from = supplier;
    else if (r.kind === "air_funding") from = "移动空充平台";
    else if (r.kind === "expense") from = "门店费用收款方";
    else if (r.kind === "expense_red") from = "账务红冲（非实际收款）";
    else if (r.kind === "payroll") from = "营业员";
    else if (r.kind === "refund") from = "顾客";
    if (amount < 0) [from, to] = [to, from];
    rows.push({ id:r.id, at:r.transactionDate || r.createdAt, kind:r.kind,
      label:kindNames[r.kind] || r.kind, from, to, amount:Math.abs(amount),
      account:r.account || "", ownerKnown:!!owner||r.account==="现金", sourceId:r.sourceId || "",
      state:owner ? "已标账户归属" : "账户归属待核", type:r.kind === "expense_red" ? "账务冲正" : "资金流水" });
  }
  for (const r of store.fundTransfers || []) {
    rows.push({ id:r.id, at:r.createdAt, kind:"internal_transfer", label:"店内转款",
      from:r.from, to:r.to, amount:r.amount, account:r.method,
      ownerKnown:true, sourceId:r.relatedOrderId || "", state:r.status, type:"内部划转" });
  }
  for (const r of store.cashHandovers || []) {
    rows.push({ id:r.id, at:r.createdAt, kind:"cash_handover", label:r.kindName || "现金交接",
      from:r.sender, to:r.recipient, amount:r.amount, account:"现金",
      ownerKnown:true, sourceId:r.id, state:r.status, type:"现金交接" });
  }
  for (const r of store.airRechargeEvents || []) {
    rows.push({ id:r.id, at:r.createdAt, kind:"air_balance", label:"移动空充余额变动",
      from:Number(r.amount) > 0 ? (r.payer || "资金来源待关联") : "移动空充平台",
      to:Number(r.amount) > 0 ? "移动空充平台" : r.kind==="customer_recharge" ? "顾客 "+r.customerMask : "充值用途待关联",
      amount:Math.abs(Number(r.amount || 0)), account:"移动BOSS",
      ownerKnown:!!r.payer || r.kind==="customer_recharge", sourceId:r.reference || "", state:r.kind==="funding" ? "平台入账 "+r.amount+" 元；实付 "+r.paidAmount+" 元；差额 "+r.difference+" 元待核" : r.kind==="customer_recharge" ? "已关联顾客现金充值单" : "资金来源／业务用途待关联",
      type:"平台余额" });
  }
  const supplierTotals = c.capabilities(user).supplierView ? require("./suppliers").list(store,user).totals : null;
  const carrierParts = (store.carrierServices || []).flatMap((r)=>r.schedule || []);
  const mobileConfirmedDue = c.round(carrierParts.filter((p)=>p.confirmed != null).reduce((n,p)=>n+Math.max(0,Number(p.confirmed)-Number(p.received||0)),0));
  const mobileExpectedUnconfirmed = c.round(carrierParts.filter((p)=>p.confirmed == null).reduce((n,p)=>n+Number(p.expected||0),0));
  const subsidyDue = c.round((store.govSubsidyClaims||[]).filter((r)=>!r.returnId).reduce((n,r)=>n+Math.max(0,Number(r.confirmed??r.subsidyAmount)-Number(r.received||0)),0));
  const airBalance = c.round((store.airRechargeEvents||[]).reduce((n,r)=>n+Number(r.amount||0),0));
  rows.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  return { asOf:c.now(), people:people(store), rows:rows.slice(0,500),
    positions:{ supplierPayable:supplierTotals?.payable??null, supplierAdvance:supplierTotals?.advance??null,
      mobileConfirmedDue,mobileExpectedUnconfirmed,subsidyDue,airBalance },
    counts:{ flows:rows.length, unknownAccounts:rows.filter((r)=>r.type==="资金流水"&&!r.ownerKnown).length,
      transfersPending:(store.fundTransfers||[]).filter((r)=>r.status==="待收款人确认").length,
      cashPending:(store.cashHandovers||[]).filter((r)=>r.status==="待接收人确认").length },
    transfers:listTransfers(store,user) };
}
module.exports={network,createTransfer,confirmTransfer,rejectTransfer,listTransfers};






