// Historical Mobile BOSS ledger backfill. Staff can preview; only owner final approval calls commit. All writes run inside the
// caller's repository transaction; preview performs the same checks without writes.
const { createHash } = require('node:crypto');
const c = require('./common');

const validDate = (value, label = '业务日期') => {
  const date = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date || date >= c.day())
    throw new c.HttpError(400, label + '须为真实的历史日期');
  return date;
};
function permitHistory(store, user) {
  if (user.roleCode === 'owner' || (user.id === store.personnelConfig?.managerId &&
      (store.users || []).some(item => item.id === user.id && item.status === 'active'))) return;
  c.permit(user, 'sell');
}
function owner(user) {
  if (user.roleCode !== 'owner') throw new c.HttpError(403, '历史空充补录仅限老板');
}
function money(value, label) {
  const result = c.money(value, label);
  if (result <= 0) throw new c.HttpError(400, label + '须大于零');
  return result;
}
function serial(input, date, kind) {
  const serialType = String(input.serialType || '').trim();
  const raw = String(input.bossSerial || input.platformRef || '').trim();
  if (!['full', 'tail5'].includes(serialType)) throw new c.HttpError(400, '请选择完整流水号或尾5位');
  if (serialType === 'tail5' && !/^\d{5}$/.test(raw))
    throw new c.HttpError(400, '流水尾号须是5位数字，含前导零');
  if (serialType === 'full' && !/^[A-Za-z0-9_-]{6,80}$/.test(raw))
    throw new c.HttpError(400, '请核对完整BOSS流水号');
  return {
    serialType, platformRef: serialType === 'full' ? raw : null,
    serialTail5: raw.slice(-5),
    reference: serialType === 'full' ? raw : `TAIL5:${date}:${kind}:${raw}`,
  };
}
function occurredAt(value, date) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\+08:00|Z)$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) || c.day(raw) !== date)
    throw new c.HttpError(400, '请填写业务实际发生时间，含秒');
  return new Date(raw).toISOString();
}
function existingSerial(row) {
  const raw = String(row.platformRef || row.reference || '').trim();
  const tail = row.serialTail5 || (/\d{5}$/.test(raw) ? raw.slice(-5) : '');
  return { full: row.platformRef || (row.serialType !== 'tail5' && !raw.startsWith('TAIL5:') ? raw : null), tail };
}
function assertUnique(existing, proposed) {
  for (const row of existing) {
    const old = existingSerial(row);
    if (row.reference === proposed.reference || (old.full && proposed.platformRef && old.full === proposed.platformRef) ||
        (row.businessDate === proposed.businessDate && row.kind === proposed.kind && old.tail && old.tail === proposed.serialTail5))
      throw new c.HttpError(409, `${proposed.businessDate} ${proposed.serialTail5} 已有同类BOSS流水，请核对原单`);
  }
}
function normalize(store, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new c.HttpError(400, '补录内容不正确');
  const existing = store.airRechargeEvents || [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length > 100) throw new c.HttpError(400, '一次最多补录100笔');
  const prepared = [];
  const openingInput = payload.opening;
  if (openingInput) {
    if (existing.some(row => row.kind === 'opening')) throw new c.HttpError(409, '空充期初已经存在');
    const businessDate = validDate(openingInput.businessDate, '期初日期');
    const amount = money(openingInput.amount, '期初余额');
    const sourceNote = c.text(openingInput.sourceNote, '期初来源说明').slice(0, 500);
    prepared.push({ kind: 'opening', businessDate, amount, sourceNote,
      reference: `HISTORICAL-OPENING:${businessDate}`, historical: true,
      effectiveAt: new Date(businessDate + 'T00:00:00+08:00').toISOString() });
  }
  const openings = existing.filter(row => row.kind === 'opening').concat(prepared.filter(row => row.kind === 'opening'));
  if (rows.length && openings.length !== 1) throw new c.HttpError(409, '须先确认一笔可信期初余额');
  const firstOpening = openings[0] || null;
  for (const input of rows) {
    const kind = input.kind === 'cash_sale' ? 'customer_recharge' : input.kind;
    if (!['customer_recharge', 'funding'].includes(kind)) throw new c.HttpError(400, '历史单据类型不正确');
    const businessDate = validDate(input.businessDate);
    if (businessDate < firstOpening.businessDate) throw new c.HttpError(409, '交易日期不得早于期初日期');
    const at = occurredAt(input.occurredAt, businessDate);
    const ids = serial(input, businessDate, kind);
    const base = { ...ids, kind, businessDate, occurredAt: at, historical: true,
      note: String(input.note || '').trim().slice(0, 500) };
    if (kind === 'customer_recharge') {
      const amount = money(input.amount ?? input.debitAmount, '平台扣减金额');
      const suppliedCash = input.cashReceived === '' || input.cashReceived == null ? null : money(input.cashReceived, '顾客实收现金');
      const phone = String(input.customerPhone || '').trim();
      if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw new c.HttpError(400, '顾客手机号不正确');
      const handler = input.handledByUserId ? (store.users || []).find(user => user.id === input.handledByUserId) : null;
      const receiver = input.cashReceivedByUserId ? (store.users || []).find(user => user.id === input.cashReceivedByUserId) : null;
      if (input.handledByUserId && !handler) throw new c.HttpError(400, '经办营业员不存在');
      if (input.cashReceivedByUserId && !receiver) throw new c.HttpError(400, '现金收款人不存在');
      if (input.cashConfirmed === true && suppliedCash != null && suppliedCash !== amount)
        throw new c.HttpError(409, '现金与平台扣减不一致，请单独核实');
      const settled = input.cashConfirmed === true && suppliedCash === amount && !!phone && !!handler && !!receiver;
      if (!settled && !base.note) throw new c.HttpError(400, '待核对单须填写BOSS凭证来源');
      // Pending rows represent a proved BOSS debit only. They carry no cash receipt,
      // named operator or employee commission until the owner resolves attribution.
      prepared.push({ ...base, amount: -amount, debitAmount: amount, cashExpected: amount,
        cashReceived: settled ? amount : null, settlementStatus: settled ? '已核实' : '待归属待收款核对',
        customerPhone: settled ? phone : null,
        customerMask: settled ? phone.slice(0, 3) + '****' + phone.slice(-4) : '',
        ...(settled ? { operatorId: handler.id, operator: handler.name,
          cashReceiverId: receiver.id, cashReceiver: receiver.name } : {}) });
    } else {
      const paidAmount = money(input.paidAmount, '实际转出金额');
      const creditedAmount = money(input.creditedAmount, '平台实际入账金额');
      if (creditedAmount > paidAmount) throw new c.HttpError(400, '平台入账不得大于实际转出');
      const method = c.text(input.method, '转出方式');
      if (!['微信', '银行卡', '支付宝'].includes(method)) throw new c.HttpError(400, '转出方式不正确');
      const bankRef = c.text(input.bankRef, '转出流水号').slice(0, 80);
      const payer = (store.users || []).find(user => user.id === input.paidByUserId);
      if (!payer) throw new c.HttpError(400, '请选择该笔真实付款人');
      if (existing.concat(prepared).some(row => row.bankRef && row.bankRef === bankRef))
        throw new c.HttpError(409, '转出流水号已登记');
      prepared.push({ ...base, amount: creditedAmount, paidAmount, creditedAmount,
        difference: c.round(paidAmount - creditedAmount), method, bankRef,
        operatorId: payer.id, operator: payer.name, payerId: payer.id, payer: payer.name });
    }
    assertUnique(existing.concat(prepared.slice(0, -1)), prepared[prepared.length - 1]);
  }
  let observation = null;
  if (payload.observation) {
    const businessDate = validDate(payload.observation.businessDate, '余额日期');
    const observedBalance = c.money(payload.observation.balance, 'BOSS显示余额');
    const sourceNote = c.text(payload.observation.sourceNote, '余额依据').slice(0, 500);
    observation = { kind: 'observed_balance', businessDate, observedBalance, amount: 0,
      sourceNote, historical: true, reference: `OBSERVED:${businessDate}`,
      effectiveAt: new Date(businessDate + 'T23:59:59+08:00').toISOString() };
    if (existing.some(row => row.kind === 'observed_balance' && row.businessDate === businessDate))
      throw new c.HttpError(409, '该日期BOSS余额已登记，需核对原记录');
    if (firstOpening && businessDate < firstOpening.businessDate) throw new c.HttpError(409, '余额日期不得早于期初日期');
    prepared.push(observation);
  }
  if (!prepared.length) throw new c.HttpError(400, '请填写至少一项补录内容');
  const earliest = prepared.reduce((date, row) => row.businessDate < date ? row.businessDate : date, '9999-99-99');
  const locked = (store.dailyCloseouts || []).find(row => row.date >= earliest && row.status === '已锁定');
  if (locked) throw new c.HttpError(409, `${locked.date} 扎账已锁定，需按规定解锁后补录`);
  const openClose = (store.dailyCloseouts || []).find(row => row.date >= earliest && !['已锁定', '已解锁', '已驳回', '已撤回'].includes(row.status));
  if (openClose) throw new c.HttpError(409, `${openClose.date} 扎账单待处理，先完成或作废再补录`);
  return { prepared, observation, earliest };
}
function eventTime(row) {
  if (row.effectiveAt) return Date.parse(row.effectiveAt);
  if (row.occurredAt) return Date.parse(row.occurredAt);
  const original = row.createdAt && c.day(row.createdAt) === row.businessDate ? Date.parse(row.createdAt) : NaN;
  return Number.isFinite(original) ? original : Date.parse(row.businessDate + 'T12:00:00+08:00');
}
function calculate(existing, prepared) {
  const all = existing.concat(prepared).map((row, index) => ({ row, index }));
  all.sort((a, b) => a.row.businessDate.localeCompare(b.row.businessDate) || eventTime(a.row) - eventTime(b.row) || a.index - b.index);
  let balance = 0;
  const results = [];
  for (const { row } of all) {
    balance = c.round(balance + Number(row.amount || 0));
    if (balance < 0) throw new c.HttpError(409, `${row.businessDate} ${row.serialTail5 || ''} 后平台余额为负，请核对遗漏的入金单`);
    results.push({ row, balance });
  }
  return results;
}
function token(store, payload) {
  return createHash('sha256').update(JSON.stringify({
    payload: { opening: payload.opening || null, rows: payload.rows || [], observation: payload.observation || null },
    events: store.airRechargeEvents || [], dailyCloseouts: (store.dailyCloseouts || []).map(row => [row.id, row.date, row.status]),
  })).digest('hex');
}
function preview(store, user, payload) {
  permitHistory(store, user);
  const { prepared, observation, earliest } = normalize(store, payload);
  const results = calculate(store.airRechargeEvents || [], prepared);
  const checks = (store.airRechargeEvents || []).filter(row => row.kind === 'observed_balance' && row.businessDate >= earliest)
    .concat(observation ? [observation] : [])
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .map(row => {
      const atDay = results.filter(result => result.row.businessDate <= row.businessDate);
      const bookBalance = atDay.length ? atDay[atDay.length - 1].balance : 0;
      return { businessDate: row.businessDate, observedBalance: row.observedBalance,
        bookBalance, difference: c.round(bookBalance - row.observedBalance) };
    });
  const comparison = checks[checks.length - 1] || null;
  const bookBalance = comparison ? comparison.bookBalance : results[results.length - 1].balance;
  const difference = comparison ? comparison.difference : null;
  const hasMismatch = checks.some(check => check.difference !== 0);
  const observationOnly = prepared.length === 1 && prepared[0].kind === 'observed_balance';
  const pendingCount = prepared.filter(row => row.settlementStatus === '待归属待收款核对').length;
  return { token: token(store, payload), earliest, rows: prepared.map(row => ({
    kind: row.kind, businessDate: row.businessDate, occurredAt: row.occurredAt,
    serialType: row.serialType, serialTail5: row.serialTail5, platformRef: row.platformRef,
    amount: row.amount, paidAmount: row.paidAmount, cashExpected: row.cashExpected,
    cashReceived: row.cashReceived, settlementStatus: row.settlementStatus, note: row.note, sourceNote: row.sourceNote, method: row.method, bankRef: row.bankRef, payer: row.payer,
    customerMask: row.customerMask, operator: row.operator, cashReceiver: row.cashReceiver,
    balance: results.find(result => result.row === row)?.balance,
  })), bookBalance, observedBalance: comparison?.observedBalance ?? null, difference, checks, hasMismatch, observationOnly,
  matches: checks.length > 0 && !hasMismatch, pendingCount,
  receiptChange: c.round(prepared.reduce((sum, row) => sum +
    (row.kind === 'customer_recharge' && row.settlementStatus === '已核实' ? row.cashReceived : row.kind === 'funding' ? -row.paidAmount : 0), 0)),
  note: observationOnly ? '仅保存BOSS余额观察值，正式账面和人员归属仍待核对' :
    pendingCount ? `已核实BOSS平台扣款；${pendingCount}笔现金和经办人待核，不计现金到账或员工酬金` :
    !checks.length ? '尚无BOSS余额观察值，请核对原始单据后确认' :
    !hasMismatch ? '账面与BOSS显示余额一致' : '有差异，请核实遗漏或重复单据；系统不会自动制造平账交易' };
}
function commit(store, user, payload) {
  owner(user);
  const expected = c.text(payload.previewToken, '预览校验码');
  const seen = preview(store, user, payload);
  if (seen.token !== expected) throw new c.HttpError(409, '台账已变化，请重新预览再提交');
  if (seen.hasMismatch && !seen.observationOnly)
    throw new c.HttpError(409, '账面与BOSS观察值不一致，不能以不明交易强行平账');
  const { prepared } = normalize(store, payload);
  const now = c.now();
  for (const row of prepared) {
    row.id = c.id('AIR'); row.createdAt = now; row.enteredById = user.id; row.enteredBy = user.name;
  }
  const balances = calculate(store.airRechargeEvents || [], prepared);
  for (const result of balances) result.row.balance = result.balance;
  store.airRechargeEvents ||= [];
  store.airRechargeEvents.push(...prepared);
  store.receipts ||= [];
  for (const row of prepared) {
    if (row.kind === 'customer_recharge' && row.settlementStatus === '已核实') store.receipts.push({ id: c.id('RC'), kind: 'cash_recharge',
      sourceId: row.id, amount: row.cashReceived, account: '现金', transactionDate: row.businessDate,
      occurredAt: row.occurredAt, createdAt: now, operatorId: row.cashReceiverId,
      handledByUserId: row.operatorId, enteredById: user.id, historical: true });
    if (row.kind === 'funding') store.receipts.push({ id: c.id('RC'), kind: 'air_funding',
      sourceId: row.id, amount: -row.paidAmount, account: row.method, accountOwnerId: row.payerId,
      transactionDate: row.businessDate, occurredAt: row.occurredAt, createdAt: now,
      operatorId: row.operatorId, enteredById: user.id, historical: true });
  }
  c.audit(store, user, 'air-recharge:historical-backfill', `${prepared.map(row => row.id).join(',')}；账面${seen.bookBalance}；BOSS观察${seen.observedBalance ?? '未填'}`);
  return { ...seen, insertedIds: prepared.map(row => row.id), recordedAt: now };
}
function balance(store,user) {
  permitHistory(store,user);
  const rows=store.airRechargeEvents||[];
  return {hasOpening:rows.some(row=>row.kind==='opening'),
    balance:c.round(rows.reduce((sum,row)=>sum+Number(row.amount||0),0))};
}
function list(store, user) {
  permitHistory(store, user);
  return (store.airRechargeEvents || []).filter(row => row.historical === true &&
    (user.roleCode === "owner" || ["opening", "observed_balance"].includes(row.kind))).map(row => ({
    id: row.id, kind: row.kind, businessDate: row.businessDate, occurredAt: row.occurredAt,
    serialType: row.serialType, serialTail5: row.serialTail5, platformRef: row.platformRef,
    amount: row.amount, cashExpected: row.cashExpected, cashReceived: row.cashReceived,
    settlementStatus: row.settlementStatus, operator: row.operator, cashReceiver: row.cashReceiver,
    customerMask: row.customerMask, observedBalance: row.observedBalance, balance: row.balance,
    sourceNote: row.sourceNote, createdAt: row.createdAt,
  }));
}
function settle(store, user, payload) {
  owner(user);
  const id = c.text(payload.id, '待核对充值单');
  const row = (store.airRechargeEvents || []).find(item => item.id === id && item.historical === true && item.kind === 'customer_recharge');
  if (!row) throw new c.HttpError(404, '未找到这笔历史充值单');
  if (row.settlementStatus !== '待归属待收款核对') throw new c.HttpError(409, '该笔现金和经办归属已经核实，请查看原单');
  const locked = (store.dailyCloseouts || []).find(item => item.date >= row.businessDate && item.status === '已锁定');
  if (locked) throw new c.HttpError(409, locked.date + ' 扎账已锁定，须按规定解锁后补核');
  const openClose = (store.dailyCloseouts || []).find(item => item.date >= row.businessDate && !['已锁定', '已解锁', '已驳回', '已撤回'].includes(item.status));
  if (openClose) throw new c.HttpError(409, openClose.date + ' 扎账单待处理，先完成或作废再补核');
  if (payload.cashConfirmed !== true) throw new c.HttpError(400, '请确认顾客现金实际收到');
  const amount = money(payload.cashReceived, '顾客实收现金');
  if (amount !== row.debitAmount) throw new c.HttpError(409, '现金实收与平台扣减不同，请单独核实');
  const phone = c.text(payload.customerPhone, '顾客手机号');
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new c.HttpError(400, '顾客手机号不正确');
  const handler = (store.users || []).find(item => item.id === payload.handledByUserId);
  const receiver = (store.users || []).find(item => item.id === payload.cashReceivedByUserId);
  if (!handler) throw new c.HttpError(400, '请选择真实经办营业员');
  if (!receiver) throw new c.HttpError(400, '请选择真实现金收款人');
  store.receipts ||= [];
  if (store.receipts.some(item => item.sourceId === row.id && item.kind === 'cash_recharge'))
    throw new c.HttpError(409, '该笔现金到账流水已存在，请核对原单');
  const receipt = { id: c.id('RC'), kind: 'cash_recharge', sourceId: row.id,
    amount, account: '现金', transactionDate: row.businessDate,
    occurredAt: row.occurredAt, createdAt: c.now(), operatorId: receiver.id,
    handledByUserId: handler.id, enteredById: user.id, historical: true };
  row.cashReceived = amount;
  row.customerPhone = phone;
  row.customerMask = phone.slice(0, 3) + '****' + phone.slice(-4);
  row.operatorId = handler.id; row.operator = handler.name;
  row.cashReceiverId = receiver.id; row.cashReceiver = receiver.name;
  row.settlementStatus = '已核实';
  row.attributionConfirmedAt = receipt.createdAt;
  row.attributionConfirmedBy = user.id;
  row.attributionNote = String(payload.note || '').trim().slice(0, 500);
  store.receipts.push(receipt);
  // The original BOSS debit, serial and platform balance are deliberately untouched.
  c.audit(store, user, 'air-recharge:historical-settle', row.id + ' 现金' + amount + '；平台扣款不重复');
  return { id: row.id, settlementStatus: row.settlementStatus, cashReceived: amount,
    operator: row.operator, cashReceiver: row.cashReceiver, customerMask: row.customerMask,
    receiptId: receipt.id, reference: row.reference, balance: row.balance };
}
module.exports = { preview, commit, balance, list, settle };



