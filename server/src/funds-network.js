const c = require("./common"), ownership=require("./account-ownership"),businessPurpose=require("./business-purpose");
const { notice } = require("./feishu-notices");

function people(store){return require('./master-data').people(store).map(({id,name,roleCode})=>({id,name,roleCode}));}
function listTransfers(store, user) {
  c.permit(user, "learn");
  return (store.fundTransfers || []).filter((r) =>
    user.roleCode === "owner" || r.operatorId === user.id || r.fromId === user.id || r.toId === user.id).slice().reverse();
}
function createTransfer(store, user, payload) {
  c.permit(user, "paymentRegister");
  const to = c.userById(store, payload.toId);
  require("./master-data").actor(store,to);
  const sourceId=String(payload.sourceAccountId||'').trim(),scope=payload.sourceScope||'personal';
  if(!['personal','store'].includes(scope))throw new c.HttpError(400,'请选择转出账户范围');
  const source=scope==='store'?(store.paymentAccounts||[]).find(a=>a.id===sourceId&&a.active!==false):null;
  if(scope==='store'&&(!source||!ownership.isStoreAccount(store,source)||source.channel!=='微信'))throw new c.HttpError(400,'门店微信内部交接须明确选择启用的门店微信账户；现金请用现金交接单');
  if(scope==='personal'&&sourceId)throw new c.HttpError(400,'本人转款不能套用门店账户');
  if (scope==='personal'&&to.id === user.id) throw new c.HttpError(400, "不能转给自己");
  const amount = c.money(payload.amount, "转款金额");
  if (amount <= 0) throw new c.HttpError(400, "转款金额须大于零");
  const method = source?source.channel:c.text(payload.method, "转款方式");
  if (!["微信", "银行卡", "支付宝"].includes(method)) throw new c.HttpError(400, "请选择实际转款方式");
  const reference = c.text(payload.reference, "转出流水号").slice(0, 80);
  if ((store.fundTransfers || []).some((r) => r.reference === reference))
    throw new c.HttpError(409, "这笔转出流水已经登记");
  const sourceName=source?(source.name==='信号机微信'?'门店微信':source.name):user.name;
  const row = { id: c.id("FT"), sourceScope:scope,sourceAccountId:source?.id||'',sourceAccountName:sourceName,sourceChannel:method,operatorId:user.id,operator:user.name,fromId:source?'':user.id,from:sourceName,
    recipientId:to.id,toId: to.id, to: to.name, amount, method, reference,
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
  if (row.toId !== user.id || (row.recipientId&&row.recipientId!==user.id) || (row.sourceScope!=='store'&&row.fromId === user.id))
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
  if(accepted){row.recipientId=row.toId;row.confirmedBy=user.id;row.confirmedAt=row.processedAt;}
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
function confirmedStoreTransfers(store,date){const seen=new Set();return (store.fundTransfers||[]).filter(t=>{if(t.sourceScope!=='store'||!t.sourceAccountId||t.sourceChannel!=='微信'||t.status!=='已确认到账'||!t.recipientId||t.recipientId!==t.toId||t.confirmedBy!==t.recipientId||!t.confirmedAt)return false;const n=Number(t.actualAmount),expected=Number(t.amount);if(!Number.isFinite(n)||n<=0||Math.round(n*100)!==Math.round(expected*100))return false;if(!(t.events||[]).some(e=>e.type==='已确认到账'&&e.by===t.recipientId&&Math.round(Number(e.actualAmount)*100)===Math.round(n*100)))return false;if(seen.has(t.id))throw new c.HttpError(409,'内部交接编号重复，请核对');seen.add(t.id);return !date||c.day(t.confirmedAt)===date;});}

const kindNames = {
  sale:"销售收款", refund:"销售退款", purchase:"采购付款",
  supplier_payment:"供应商付款", supplier_refund:"供应商退款", supplier_outbound_receipt:"供货商调货实收款",
  expense:"门店费用", expense_red:"费用红冲（账务更正）", air_funding:"空充平台充值实付", cash_recharge:"顾客现金充值", carrier:"移动酬金到账", carrier_rental:"移动酬金到账",
  carrier_clawback:"移动酬金扣回", gov_subsidy:"国补返款",
  gov_subsidy_refund:"国补退款", payroll:"工资发放"
};
function network(store, user) {
  c.permit(user, "finance");
  const supplierNames = new Map((store.suppliers || []).map((s) => [s.id, s.name]));
  const userNames = new Map((store.users || []).map((u) => [u.id, u.name]));
  const rows = [];
  for (const r of require('./serial-source-corrections').receiptRows(store)) {
    const amount = Number(r.amount || 0);
    if (!amount) continue;
    const view={...r,...ownership.project(store,r)},storeAccount=ownership.isStoreAccount(store,r),passThrough=businessPurpose.isPassThrough(store,r);
    const owner = !storeAccount&&r.accountOwnerId ? userNames.get(r.accountOwnerId) : null;
    const account = storeAccount ? (view.displayName||view.accountName||r.account)+" · "+(view.custodyLabel||"门店") : owner ? (r.accountName||owner) + " · " + (r.account || "账户") : "账户归属待核 · " + (r.account || "未填渠道");
    const supplier = supplierNames.get(r.supplierId) || "供应商";
    let from = "业务对方", to = account;
    if (["sale","cash_recharge"].includes(r.kind)) from = "顾客";
    else if (["carrier","carrier_rental","carrier_clawback"].includes(r.kind)) from = "中国移动";
    else if (["gov_subsidy","gov_subsidy_refund"].includes(r.kind)) from = "国补平台";
    else if (["supplier_payment","supplier_refund","supplier_outbound_receipt","purchase"].includes(r.kind)) from = supplier;
    else if (r.kind === "air_funding") from = "移动空充平台";
    else if (r.kind === "expense") from = passThrough?"代充值收款方":"门店费用收款方";
    else if (r.kind === "expense_red") from = "账务红冲（非实际收款）";
    else if (r.kind === "payroll") from = "营业员";
    else if (r.kind === "refund") from = "顾客";
    if(require('./wallet-funding-read').isReceipt(r))from=r.kind==='store_wallet_funding_out'?'门店微信':(store.users||[]).find(x=>x.id===((store.storeWalletFundingRequests||[]).find(q=>q.id===r.sourceId)?.payerId))?.name||'老板个人账户';
    if (amount < 0) [from, to] = [to, from];
    const exchange=require('./wallet-cash-exchanges').forReceipt(store,r.id);
    if(exchange){from=r.id===exchange.walletReceiptId?exchange.accountName:'顾客现金';to=r.id===exchange.walletReceiptId?'顾客':'门店现金';}
    if(require('./store-transfer').isReceipt(r)){from=r.sourceAccountName;to=r.destinationAccountName;if(r.isReversal)[from,to]=[to,from];}
    rows.push({ id:r.id, supplierId:r.supplierId,attributionCorrected:r.attributionCorrected,originalReceiptId:r.originalReceiptId, at:r.transactionDate || r.createdAt, kind:r.kind,
      label:require('./store-transfer').isReceipt(r)?require('./store-transfer').label(r):require('./wallet-funding-read').isReceipt(r)?require('./wallet-funding-read').label(r):exchange?'门店微信换现 · '+(r.id===exchange.walletReceiptId?'微信转出':'收回现金'):passThrough?(r.isReversal||/_red$/.test(r.kind||'')?'代充值账务更正':amount>0?'代充值收款':'代充值付款'):kindNames[r.kind] || r.kind, businessPurpose:businessPurpose.purpose(store,r),economicClass:passThrough?'pass_through':'operating',from, to, amount:Math.abs(amount),
      account:r.account || "", accountName:view.displayName||view.accountName||r.account||"", accountScope:view.accountScope||"", accountOwnerId:view.accountOwnerId||"", custodyLabel:view.custodyLabel||"", ownerKnown:storeAccount||!!owner, sourceId:r.sourceId || "",
      state:exchange?'内部换现 · 关联 '+exchange.id:storeAccount?"门店账户":owner ? "已标账户归属" : "账户归属待核", type:require('./store-transfer').isReceipt(r)?'门店互转分录':exchange?'内部划转':r.kind === "expense_red" ? "账务冲正" : "资金流水" });
  }
  for (const r of store.fundTransfers || []) {
    rows.push({ id:r.id, at:r.createdAt, kind:"internal_transfer", label:"店内转款",
      from:r.from, to:r.to, amount:r.amount, account:r.method,
      sourceScope:r.sourceScope||"personal",sourceAccountId:r.sourceAccountId||"",operatorId:r.operatorId||r.fromId,ownerReceived:confirmedStoreTransfers(store).some(t=>t.id===r.id&&t.recipientId===user.id),ownerKnown:true, sourceId:r.relatedOrderId || "", state:r.status, type:"内部划转" });
  }
  for (const r of store.cashHandovers || []) {
    rows.push({ id:r.id, at:r.createdAt, kind:"cash_handover", label:r.kindName || "现金交接",
      from:r.sender, to:r.recipient, amount:r.amount, account:"现金", ownerReceived:ownership.confirmedCashHandover(r,user.id),
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
  return { asOf:c.now(), people:people(store), sourceAccounts:(store.paymentAccounts||[]).filter(a=>a.active!==false&&a.channel==='微信'&&ownership.isStoreAccount(store,a)).map(a=>({id:a.id,name:a.name==='信号机微信'?'门店微信':a.name,channel:a.channel,accountScope:'store'})),rows:rows.slice(0,500),
    positions:{ supplierPayable:supplierTotals?.payable??null, supplierAdvance:supplierTotals?.advance??null,
      mobileConfirmedDue,mobileExpectedUnconfirmed,subsidyDue,airBalance },
    counts:{ flows:rows.length, unknownAccounts:rows.filter((r)=>r.type==="资金流水"&&!r.ownerKnown).length,
      transfersPending:(store.fundTransfers||[]).filter((r)=>r.status==="待收款人确认").length,
      cashPending:(store.cashHandovers||[]).filter((r)=>r.status==="待接收人确认").length },
    transfers:listTransfers(store,user) };
}
module.exports={network,createTransfer,confirmTransfer,rejectTransfer,listTransfers,confirmedStoreTransfers};







module.exports=require("./master-data").decorateFunds(module.exports);
