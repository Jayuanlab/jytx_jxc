const c = require("./common");
const POLICY="store-cash-checkpoint-v2";
function owner(user) { return user.roleCode === "owner"; }
function active(store, id) { return store.users.find((u) => u.id === id && u.status === "active"); }
function cashier(store, user, id) {
  const target = id ? active(store, id) : user;
  if (!target) throw new c.HttpError(404, "营业员不存在");
  if (!owner(user) && target.id !== user.id) throw new c.HttpError(403, "只能查看自己的中途扎账");
  return target;
}
function closeouts(store, user, query) {
  const get=k=>query?.get?.(k)||query?.[k]||'',from=get('from'),to=get('to');
  if((from&&!Number.isFinite(Date.parse(from)))||(to&&!Number.isFinite(Date.parse(to)))||(from&&to&&Date.parse(from)>Date.parse(to)))throw new c.HttpError(400,'查询时间段不正确');
  return (store.closeouts||[]).filter(r=>(owner(user)||r.cashierId===user.id||r.receiverId===user.id)&&(!from||Date.parse(r.countedAt||r.endAt)>=Date.parse(from))&&(!to||Date.parse(r.countedAt||r.endAt)<=Date.parse(to))).slice().sort((a,b)=>String(b.countedAt||b.endAt).localeCompare(String(a.countedAt||a.endAt)));
}
function snapshot(store, user, cashierId, excludeId) {
  c.permit(user, "sell");
  const person = cashier(store, user, cashierId);
  const endAt=c.now(),date=c.day(endAt),startAt=date+'T00:00:00+08:00';
  const inToday=row=>c.day(row.transactionDate||row.businessDate||row.date||row.createdAt)===date&&(!row.createdAt||row.createdAt<=endAt);
  const receipts=store.receipts.filter(inToday),sales=store.sales.filter(inToday),returns=store.saleReturns.filter(inToday);
  const accounts = {};
  for (const row of receipts) accounts[row.account] = c.round((accounts[row.account] || 0) + row.amount);
  const basis=require('./cash-basis').rollingSnapshot(store,date);if(basis.openingCashSuggested==null)throw new c.HttpError(409,'门店现金期初未核实，请老板先保存现金核对依据');
  return {
    ...basis,cashDate:date,checkpointPolicy:POLICY,kind:'cash_checkpoint',recordType:'temporary',isFormal:false,countedAt:endAt,
    periodStartAt:startAt,summaryScope:'business_day_cumulative',
    noFundsTransfer:true,
    cashierId: person.id, cashier: person.name, startAt, endAt,
    openingCash: basis.openingCashSuggested,
    accounts, salesCount: sales.length, returnCount: returns.length,
    salesAmount: c.round(sales.reduce((n, x) => n + x.amount, 0)),
    refundAmount: c.round(returns.reduce((n, x) => n + x.amount, 0)),
    receiptIds: receipts.map((x) => x.id), saleIds: sales.map((x) => x.id), returnIds: returns.map((x) => x.id),
    expectedCash: require('./cash-basis').expected(basis.openingCashSuggested,basis),
  };
}
function submit(store, user, payload) {
  const shot = snapshot(store, user, user.id);
  const recordType=payload.recordType==='morning_cash_count'?'morning_cash_count':payload.recordType==null||payload.recordType==='temporary'?'temporary':'';
  if(!recordType)throw new c.HttpError(400,'现金清点类型不正确');
  if(!payload.cashBasisFingerprint||payload.cashBasisFingerprint!==shot.cashBasisFingerprint)throw new c.HttpError(409,'门店现金流水或计算规则已更新，请刷新页面后重新核对实点');
  const actualCash = c.money(payload.actualCash, "实点现金");
  const note = String(payload.note || "").trim().slice(0, 500);
  const difference = c.round(actualCash - shot.expectedCash);
  if (difference && !note) throw new c.HttpError(400, "现金有差异，请填写原因");
  const receiver = active(store, payload.reviewerId||payload.receiverId);
  if (!receiver || receiver.id === user.id || !c.capabilities(receiver).sell) throw new c.HttpError(400, "请选择另一位在职复核人");
  const row = {
    id: c.id("CL"), ...shot,recordType,kind:recordType==='morning_cash_count'?'morning_cash_count':'cash_checkpoint', actualCash, difference, note,
    receiverId: receiver.id, receiver: receiver.name,reviewerId:receiver.id,reviewer:receiver.name,
    status: "待核对", submittedAt: c.now(), confirmedAt: null, confirmedBy: null,
  };
  store.closeouts ||= [];
  store.closeouts.push(row);
  c.audit(store, user, "closeout:submit", row.id + " "+(recordType==='morning_cash_count'?'开门现金清点':'中途现金清点')+" 现金差异 " + difference);
  const { notice } = require("./feishu-notices");
  notice(store, "closeout:" + row.id, "现金清点待复核", {
    id: row.id,
    summary: row.cashier + (recordType==='morning_cash_count'?' 开门现金清点':' 中途现金清点')+"；复核人 " + row.receiver + "；实点现金 " + actualCash + " 元；差异 " + difference + " 元",
  });
  return row;
}
function confirm(store, user, payload) {
  const row = (store.closeouts || []).find((r) => r.id === payload.id);
  if (!row) throw new c.HttpError(404, "中途扎账记录不存在");
  if(row.checkpointPolicy!==POLICY)throw new c.HttpError(409,'旧中途扎账记录仅作历史查询，请重新清点现金登记');
  if(row.cashierId===user.id||(!owner(user)&&row.reviewerId!==user.id))throw new c.HttpError(403,'须由另一位指定复核人或老板本人复核');
  if (row.status !== "待核对") throw new c.HttpError(409, "该中途扎账记录已处理");
  if(payload.decision==='确认'&&row.cashBasisPolicy!==require('./cash-basis').POLICY)throw new c.HttpError(409,'旧交班单按个人现金计算，请退回后按门店现金口径重新提交');
  const decision = payload.decision === "确认" ? "已确认" : payload.decision === "退回" ? "待复核" : "";
  if (!decision) throw new c.HttpError(400, "请选择确认或退回");
  const note = String(payload.note || "").trim().slice(0, 500);
  if (decision === "待复核" && !note) throw new c.HttpError(400, "退回必须说明原因");
  row.status = decision;
  row.confirmedAt = c.now();
  row.confirmedBy = user.id;row.confirmedByName=user.name;
  row.reviewNote = note;
  c.audit(store, user, "closeout:review", row.id + " " + decision);
  return row;
}
function revise(store, user, payload) {
  const row = (store.closeouts || []).find((r) => r.id === payload.id);
  if (!row) throw new c.HttpError(404, "中途扎账记录不存在");
  if(row.checkpointPolicy!==POLICY)throw new c.HttpError(409,'旧中途扎账记录仅作历史查询');
  if (row.cashierId !== user.id || row.status !== "待复核")
    throw new c.HttpError(403, "只能补正本人被退回的中途扎账记录");
  if ((store.closeouts || []).some((r) => r.cashierId === user.id && r.submittedAt > row.submittedAt)) throw new c.HttpError(409, "后续中途扎账已提交，请由老板登记调整");
  const actualCash = c.money(payload.actualCash, "实点现金");
  const note = String(payload.note || "").trim().slice(0, 500);
  if((row.cashDate||c.day(row.endAt))!==c.day())throw new c.HttpError(409,'历史中途扎账须按原营业日核对，不能用今天的现金覆盖');
  const fresh=snapshot(store,user,user.id,row.id);
  const difference = c.round(actualCash - fresh.expectedCash);
  if (difference && !note) throw new c.HttpError(400, "现金有差异，请填写原因");
  row.revisions ||= [];
  row.revisions.push({ snapshot:structuredClone(Object.fromEntries(Object.entries(row).filter(([k])=>k!=='revisions'))), actualCash: row.actualCash, note: row.note, at: c.now() });
  Object.assign(row,fresh);
  row.recordType=row.revisions.at(-1).snapshot.recordType||'temporary';
  row.kind=row.recordType==='morning_cash_count'?'morning_cash_count':'cash_checkpoint';
  row.actualCash = actualCash;
  row.difference = difference;
  row.note = note;
  row.status = "待核对";
  row.confirmedAt = null;
  row.confirmedBy = null;
  c.audit(store, user, "closeout:revise", row.id);
  const { notice } = require("./feishu-notices");
  notice(store, "closeout-revise:" + row.id + ":" + row.revisions.length, "现金清点待复核", {
    id: row.id, summary: row.cashier + " 已补正中途扎账；实点现金 " + actualCash + " 元；差异 " + difference + " 元",
  });
  return row;
}
module.exports = { POLICY,snapshot, closeouts, submit, confirm, revise };
