const c = require('./common');
const suppliers = require('./suppliers');
const receptions = require('./receptions');
const cashHandovers = require('./cash-handovers');
const workbench = require('./workbench');
const money = value => `¥${c.round(value).toFixed(2)}`;
const result = (answer, sources = [], metrics = {}, action) => ({ answer, sources, metrics, ...(action ? { action } : {}) });
const source = (label, href, id = label) => ({ label, href, id: String(id) });
const view = (answer, label, href, metrics = {}, rows = [], detail = false) => result(answer,
  [source(label, href), ...(detail ? rows.slice(0, 8).map(row => source(row.label || label, href, row.id)) : [])], metrics,
  { type: 'navigate', label: `查看${label}`, href });
const todayWord = date => date === c.day() ? '今天' : date === c.day(Date.now() - 86400000) ? '昨天' : date;
const itemOwner = row => row.employeeId || row.operatorId;
function datedReceipts(events, question, date) {
  const daily = /今天|今日|昨天|昨日|前天|20\d{2}[年\-/](?:0?[1-9]|1[0-2])[月\-/](?:0?[1-9]|[12]\d|3[01])/.test(question);
  const monthly = !daily && /本月|这个月|上月|上个月|下月|下个月|20\d{2}[年\-/](?:0?[1-9]|1[0-2])月?/.test(question);
  if (!daily && !monthly) return null;
  const month = monthFor(question, date);
  const matching = events.filter(event => event.createdAt && !Number.isNaN(Date.parse(event.createdAt)) && (daily ? c.day(event.createdAt) === date : c.day(event.createdAt).startsWith(month)));
  return { amount: c.round(matching.reduce((sum, event) => sum + Number(event.amount || 0), 0)), count: matching.length, label: daily ? todayWord(date) : month === c.month() ? '本月' : month };
}
const noWriteWords = /(新建|创建|建立|帮.{0,4}(?:开|填|记)|确认收到|批准|审批通过|付款给|支付给)/;
const pendingLabels = Object.freeze({
  assistantReports: '情况报告', reception: '接待结案', assist: '协助判定', wechat: '加微信核实',
  conversion: '成交贡献', learning: '学习单', workJournal: '工作日志积分核定', closeout: '交班核对', closeoutRevision: '交班补正',
  dailyClose: '日结签认', dailyReview: '日结复核', cashHandover: '现金交接', fundTransfer: '转款确认',
  fundTransferDispute: '转款异议', cashDispute: '现金异议', procurement: '未收齐订货',
  procurementPaymentReview: '订货付款审核', expenseRed: '费用红冲', productPrice: '商品调价',
  serialStocktake: '串号盘点差异', salePayments: '销售收款核对', salePaymentDisputes: '销售收款异议', giftApprovals: '赠品审批',
});

function supplierQuestion(store, user, question, detail) {
  if (!c.capabilities(user).supplierView) return result('当前岗位没有供应商往来查看权限。');
  // The supplier API upgrades legacy rows; isolate those rows so an assistant read never migrates the main ledger.
  const ledger = c.initialize(structuredClone({
    suppliers: store.suppliers || [], supplierEntries: store.supplierEntries || [],
    supplierSettlements: store.supplierSettlements || [], supplierCash: store.supplierCash || [],
    purchases: store.purchases || [], procurementPlans: store.procurementPlans || [], supplierModelVersion: store.supplierModelVersion,
  }));
  const data = suppliers.list(ledger, user);
  let selected = data.rows.filter(row => [row.name, row.shortName, ...(row.aliases || [])]
    .some(word => String(word || '').length >= 2 && question.includes(String(word))));
  const longest = Math.max(0, ...selected.map(row => String(row.name || '').length));
  selected = selected.filter(row => String(row.name || '').length === longest);
  const named = question.match(/(?:供应商|供货商)\s*[“"「]?([^，,。？?\s]{2,24}?)(?=的|还有|还欠|应付|预付|往来|欠|多少|[”"」]|$)/)?.[1];
  if (!selected.length && named && !/^(还欠|欠|应付|未付|待付|预付|往来|合计|全部|总共|一共|总额|账款|货款|余额|当前|现在|多少)/.test(named)) {
    selected = data.rows.filter(row => row.name.includes(named));
    if (!selected.length) return view(`没有查到供应商“${named}”的往来记录。`, '供应商往来', '/app?tab=suppliers', { matched: false });
  }
  if (selected.length > 1) return view(`匹配到 ${selected.length} 家供应商，请在往来档案中选择具体单位。`, '供应商往来', '/app?tab=suppliers', { ambiguous: true }, selected.map(row => ({ ...row, label: row.name + (row.contact ? '（' + row.contact + '）' : '') })), true);
  const rows = selected.length ? selected : data.rows;
  const totals = rows.reduce((sum, row) => {
    for (const field of ['payable', 'advance', 'cash', 'credit']) sum[field] = c.round(sum[field] + Number(row[field] || 0));
    return sum;
  }, { payable: 0, advance: 0, cash: 0, credit: 0 });
  const advanceOnly = /预付/.test(question) && !/应付|欠|往来/.test(question);
  const payableOnly = /应付|未付|待付|欠/.test(question) && !/预付|往来/.test(question);
  const values = [!advanceOnly && totals.payable && `应付 ${money(totals.payable)}`,
    !payableOnly && totals.advance && `预付货款 ${money(totals.advance)}`,
    !advanceOnly && !payableOnly && totals.cash && `对方应退 ${money(totals.cash)}`,
    !advanceOnly && !payableOnly && totals.credit && `可抵货款 ${money(totals.credit)}`].filter(Boolean);
  const label = selected.length ? selected[0].name : '供应商';
  let text = values.length ? `${label}：${values.join('，')}。` : `${label}没有${advanceOnly ? '预付款' : payableOnly ? '未付货款' : '未结往来'}记录。`;
  if (detail && !selected.length && values.length) text += rows.filter(row => row.payable || row.advance || row.cash || row.credit).slice(0, 8)
    .map(row => [row.name, row.payable && `应付 ${money(row.payable)}`, row.advance && `预付 ${money(row.advance)}`].filter(Boolean).join('，')).join('；') + '。';
  return view(text, '供应商往来', '/app?tab=suppliers', { ...totals, supplierId: selected[0]?.id || null, supplierCount: rows.length }, rows, detail);
}
function monthFor(question, date) {
  const specified = question.match(/(20\d{2})[年\-/](0?[1-9]|1[0-2])月?/);
  if (specified) return `${specified[1]}-${specified[2].padStart(2, '0')}`;
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  if (/上个月|上月/.test(question)) return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  if (/下个月|下月/.test(question)) return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  return date.slice(0, 7);
}
function carrierQuestion(store, user, question, date, detail) {
  const caps = c.capabilities(user);
  if (!caps.sell && !caps.finance && !caps.allSales) return result('当前岗位没有移动业务查看权限。');
  const month = monthFor(question, date);
  const explicitMonth = /(本月|这个月|上月|上个月|下月|下个月|20\d{2}[年\-/](?:0?[1-9]|1[0-2])月?)/.test(question);
  const allMonths = /全部|所有|累计|总共/.test(question) && !explicitMonth;
  const rows = (store.carrierServices || []).filter(row => caps.finance || caps.allSales || itemOwner(row) === user.id);
  const parts = rows.flatMap(row => (row.schedule || []).filter(part => allMonths || part.month === month).map(part => ({ row, part })));
  const confirmedDue = c.round(parts.filter(({ part }) => part.confirmed != null).reduce((sum, { part }) => sum + Math.max(0, Number(part.confirmed) - Number(part.received || 0)), 0));
  const expectedUnconfirmed = c.round(parts.filter(({ part }) => part.confirmed == null).reduce((sum, { part }) => sum + Number(part.expected || 0), 0));
  const received = c.round(parts.reduce((sum, { part }) => sum + Number(part.received || 0), 0));
  const label = allMonths ? '累计移动酬金' : (month === c.month() ? '本月' : month) + '移动酬金';
  const numbers = [confirmedDue && `已确认待到账 ${money(confirmedDue)}`, expectedUnconfirmed && `预计待确认 ${money(expectedUnconfirmed)}`].filter(Boolean);
  const wantsReceived = /到账|收到|收了|实收/.test(question) && !/未到账|没到账|待到账|没收到|未收到/.test(question);
  let text = !parts.length ? `${label}没有结算记录。` : wantsReceived ? `${label}已登记到账 ${money(received)}${numbers.length ? '，' + numbers.join('，') : ''}。` : numbers.length ? `${label}：${numbers.join('，')}。` : `${label}没有未结金额。`;
  if (detail && parts.length) {
    const lines = parts.filter(({ part }) => part.confirmed == null || Number(part.confirmed) > Number(part.received || 0)).slice(0, 8)
      .map(({ row, part }) => `${row.typeName || '移动业务'} ${row.externalOrderNo || row.id}：${part.confirmed == null ? '预计待确认 ' + money(part.expected) : '已确认待到账 ' + money(Math.max(0, Number(part.confirmed) - Number(part.received || 0)))}`);
    if (lines.length) text += lines.join('；') + '。';
  }
  if (wantsReceived) {
    const dated = datedReceipts(rows.flatMap(row => (row.schedule || []).flatMap(part => part.events || [])), question, date);
    if (dated) {
      const undated = rows.flatMap(row => row.schedule || []).filter(part => Number(part.received || 0) > (part.events || []).filter(event => event.createdAt && !Number.isNaN(Date.parse(event.createdAt))).reduce((sum, event) => sum + Number(event.amount || 0), 0)).length;
      return view(dated.count ? `${dated.label}移动酬金已登记到账 ${money(dated.amount)}。` + (undated ? '另有到账记录缺日期，未计入。' : '') : undated ? '有移动酬金到账记录缺少日期，暂不能如实按此日期统计。' : `${dated.label}没有移动酬金到账记录。`, '移动酬金', '/carrier', { received: dated.amount, eventCount: dated.count, date, incomplete: !!undated });
    }
  }
  return view(text, '移动酬金', '/carrier', { month: allMonths ? null : month, confirmedDue, expectedUnconfirmed, received, serviceCount: new Set(parts.map(({ row }) => row.id)).size }, parts.map(({ row }) => row), detail);
}
function subsidyQuestion(store, user, question, date, detail) {
  if (!c.capabilities(user).finance) return result('当前岗位没有国补结算查看权限。');
  const rows = (store.govSubsidyClaims || []).filter(row => !row.returnId);
  const confirmedDue = c.round(rows.filter(row => row.confirmed != null).reduce((sum, row) => sum + Math.max(0, Number(row.confirmed) - Number(row.received || 0)), 0));
  const expectedUnconfirmed = c.round(rows.filter(row => row.confirmed == null).reduce((sum, row) => sum + Number(row.subsidyAmount || 0), 0));
  const received = c.round(rows.reduce((sum, row) => sum + Number(row.received || 0), 0));
  const refundDue = c.round((store.govSubsidyClaims || []).filter(row => row.returnId).reduce((sum, row) => sum + Math.max(0, Number(row.received || 0) - Number(row.refunded || 0)), 0));
  const values = [confirmedDue && `已确认待到账 ${money(confirmedDue)}`, expectedUnconfirmed && `预计待平台确认 ${money(expectedUnconfirmed)}`, refundDue && `退货补贴待退 ${money(refundDue)}`].filter(Boolean);
  const wantsReceived = /到账|收到|收了|实收/.test(question) && !/未到账|没到账|待到账|没收到|未收到/.test(question);
  let text = !(store.govSubsidyClaims || []).length ? '没有国补结算记录。' : wantsReceived ? `国补已登记到账 ${money(received)}${values.length ? '，' + values.join('，') : ''}。` : values.length ? `国补：${values.join('，')}。` : '国补没有未结金额。';
  if (detail && values.length) {
    const lines = rows.filter(row => row.confirmed == null || Number(row.confirmed) > Number(row.received || 0)).slice(0, 8)
      .map(row => `${row.platformOrderNo || row.orderId}：${row.confirmed == null ? '预计待确认 ' + money(row.subsidyAmount) : '已确认待到账 ' + money(Math.max(0, Number(row.confirmed) - Number(row.received || 0)))}`);
    if (lines.length) text += lines.join('；') + '。';
  }
  if (wantsReceived) {
    const dated = datedReceipts((store.govSubsidyClaims || []).flatMap(row => (row.events || []).filter(event => event.type === 'receive')), question, date);
    if (dated) {
      const undated = (store.govSubsidyClaims || []).filter(row => Number(row.received || 0) > (row.events || []).filter(event => event.type === 'receive' && event.createdAt && !Number.isNaN(Date.parse(event.createdAt))).reduce((sum, event) => sum + Number(event.amount || 0), 0)).length;
      return view(dated.count ? `${dated.label}国补已登记到账 ${money(dated.amount)}。` + (undated ? '另有到账记录缺日期，未计入。' : '') : undated ? '有国补到账记录缺少日期，暂不能如实按此日期统计。' : `${dated.label}没有国补到账记录。`, '国补结算', '/subsidy', { received: dated.amount, eventCount: dated.count, date, incomplete: !!undated });
    }
  }
  return view(text, '国补结算', '/subsidy', { confirmedDue, expectedUnconfirmed, received, refundDue, count: rows.length }, rows, detail);
}
function procurementQuestion(store, user, question, detail) {
  const caps = c.capabilities(user);
  if (!caps.purchase && !caps.supplierView) return result('当前岗位没有订货验收查看权限。');
  const all = user.roleCode === 'owner' || caps.supplierView;
  let rows = (store.procurementPlans || []).filter(row => row.status === 'open' && (all || (row.receiverId || row.operatorId) === user.id));
  if (/我的|我来|我验|指派给我/.test(question)) rows = rows.filter(row => (row.receiverId || row.operatorId) === user.id);
  const lines = rows.flatMap(row => (row.items || []).filter(item => Number(item.quantity) > Number(item.received || 0)).map(item => ({ row, item, missing: Number(item.quantity) - Number(item.received || 0) })));
  const pendingCount = new Set(lines.map(({ row }) => row.id)).size;
  const pendingUnits = lines.reduce((sum, { missing }) => sum + missing, 0);
  const assigned = rows.filter(row => (row.receiverId || row.operatorId) === user.id).length;
  let text = pendingCount ? `有 ${pendingCount} 张订货单未收齐，还差 ${pendingUnits} 件。` : '当前可见范围没有未收齐的订货单。';
  if (detail && lines.length) text += lines.slice(0, 8).map(({ row, item, missing }) => `${row.supplier || '供应商'}，${item.name || '商品'}待收 ${missing} 件，验收人 ${row.receiver || row.operator || '待指派'}`).join('；') + '。';
  return view(text, '订货验收', '/app?tab=purchase', { pendingCount, pendingUnits, assigned }, rows, detail);
}
function receptionQuestion(store, user, question, date, detail) {
  if (!c.capabilities(user).sell) return result('当前岗位没有接待工单查看权限。');
  const phone = question.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0];
  let rows = receptions.list(store, user).rows.filter(row => !row.publicAssist);
  if (phone) rows = rows.filter(row => row.customerPhone === phone);
  const followups = /回访|跟进|跟单|联系/.test(question);
  if (followups) {
    rows = rows.filter(row => row.status === '待回访' && row.followUpAt);
    if (!/全部|所有|未结|以后|后续/.test(question)) {
      const cutoff = Date.parse(date + 'T23:59:59+08:00');
      rows = rows.filter(row => Date.parse(row.followUpAt) <= cutoff);
    }
  } else if (/今天|今日|昨天|昨日|20\d{2}[-年/.]/.test(question) && !phone) rows = rows.filter(row => c.day(row.createdAt) === date);
  const label = followups ? '待回访' : '接待记录';
  let text = rows.length ? `${phone ? '这位顾客有' : '当前可见范围有'} ${rows.length} 条${label}。` : `没有查到你有权限查看的${label}。`;
  if (rows.length && (detail || phone)) text += rows.slice(0, detail ? 8 : 2).map(row => `${row.ownerName || '接待人'}，${row.purpose || '接待'}，${row.status}`).join('；') + '。';
  return view(text, '接待跟单', '/receptions', { count: rows.length, followups, phoneMatched: !!phone }, rows, detail);
}
function cashQuestion(store, user, question, detail) {
  let rows = cashHandovers.list(store, user);
  const all = /全部|所有|记录|明细|历史/.test(question) && !/未确认|待确认|没确认|还没/.test(question);
  if (!all) rows = rows.filter(row => ['待接收人确认', '金额有异议'].includes(row.status));
  if (/我.*(?:确认|接收)|给我|交给我/.test(question)) rows = rows.filter(row => row.recipientId === user.id);
  const pending = rows.filter(row => row.status === '待接收人确认');
  const disputed = rows.filter(row => row.status === '金额有异议');
  const pendingAmount = c.round(pending.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  let text = !rows.length ? (all ? '当前可见范围没有现金交接记录。' : '当前可见范围没有待确认或有异议的现金交接单。') : all ? `当前可见现金交接 ${rows.length} 笔。` : [pending.length && `现金交接待确认 ${pending.length} 笔、${money(pendingAmount)}`, disputed.length && `金额有异议 ${disputed.length} 笔`].filter(Boolean).join('；') + '。';
  if (detail && rows.length) text += rows.slice(0, 8).map(row => `${row.sender}交给${row.recipient}，${money(row.amount)}，${row.status}`).join('；') + '。';
  return view(text, '现金交接', '/cash-handover', { count: rows.length, pendingCount: pending.length, pendingAmount, disputedCount: disputed.length }, rows, detail);
}
function closeQuestion(store, user, question, date, detail) {
  const rows = (store.dailyCloseouts || []).filter(row => row.date === date && (user.roleCode === 'owner' || row.cashierId === user.id || row.reviewerId === user.id));
  const row = rows.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  let text = row ? `${todayWord(date)}日结：${row.status}。` : `${todayWord(date)}当前可见范围没有日结单。`;
  if (detail && row) {
    const lines = [row.cashier && `提交人 ${row.cashier}`, row.reviewer && `复核人 ${row.reviewer}`, row.reviewNote && `复核说明 ${row.reviewNote}`].filter(Boolean);
    if (lines.length) text += lines.join('，') + '。';
  }
  return view(text, '每日扎账', '/daily-close', { date, status: row?.status || null, id: row?.id || null }, rows, detail);
}
function pendingQuestion(store, user, detail) {
  const data = workbench.summary(store, user);
  const entries = data.owner ? Object.entries(data.reviews).filter(([, count]) => count).map(([key, count]) => [pendingLabels[key] || '待核实事项', count]) : [
    ['到期回访', data.followups], ['现金接收确认', data.cashToConfirm], ['转款确认', data.transferToConfirm],
    ['销售收款核对', data.salePaymentsToConfirm], ['本人收款异议', data.ownPaymentDisputes],
    ['指派验收', data.assignedPlans], ['学习单待审核', data.unreviewedLearning], ['工作日志待核定', data.unreviewedWork], ['赠品审批', data.giftApprovalsToReview],
  ].filter(([, count]) => count);
  const text = data.pendingCount ? `待处理 ${data.pendingCount} 项：${entries.slice(0, detail ? entries.length : 4).map(([label, count]) => label + ' ' + count + ' 项').join('，')}${!detail && entries.length > 4 ? '，其余见待办' : ''}。` : '当前没有待处理事项。';
  return view(text, '我的待办', '/m#pending', { pendingCount: data.pendingCount, counts: Object.fromEntries(entries) });
}
function query(store, user, question, { date = c.day(), detail = false } = {}) {
  if (typeof question !== 'string' || !question.trim() || noWriteWords.test(question)) return null;
  if (/(现金|现款).{0,12}(交接|交款|交钱|上交|交了|未交|没交|接收|确认|缴存)|(?:交接|交款|交钱|未交|没交).{0,12}(现金|现款)/.test(question)) return cashQuestion(store, user, question, detail);
  if (/日结|扎账|轧账|扎帐|轧帐/.test(question)) return closeQuestion(store, user, question, date, detail);
  if (/(国补|补贴).{0,15}(结算|到账|未收|没收|待收|应收|返款|还欠|多少钱|多少)|(?:结算|到账|应收|返款).{0,12}(国补|补贴)/.test(question)) return subsidyQuestion(store, user, question, date, detail);
  if (/(移动|运营商).{0,15}(酬金|佣金|结算|返款|应收|到账|租金)|(?:酬金|佣金|租金).{0,12}(移动|运营商)/.test(question)) return carrierQuestion(store, user, question, date, detail);
  if (/(订货|采购|货物|进货).{0,12}(未收|没收|未齐|没齐|验收|到齐|收齐|待收|还差)|(?:哪些|多少|指派|待).{0,8}(验收|收货)|(?:未收齐|未收完|未验收|没收齐|还没收货).{0,10}(?:订货|采购|货)|有没有.{0,8}未收齐|(?:还有|哪些|多少).{0,8}货.{0,8}(?:没收齐|未收齐|未收完|没到齐)/.test(question)) return procurementQuestion(store, user, question, detail);
  const hasPhone = /(?<!\d)1[3-9]\d{9}(?!\d)/.test(question);
  if (/回访|接待记录|接待情况|客户档案|顾客档案|接待工单|跟单情况/.test(question) || hasPhone && /查|找|调|客户|顾客|接待|工单|联系/.test(question)) return receptionQuestion(store, user, question, date, detail);
  const namedSupplier = (store.suppliers || []).some(row => String(row.name || '').length >= 2 && question.includes(row.name));
  if (/(供应商|供货商).{0,15}(应付|预付|往来|欠|货款|余额)|(?:应付|预付|往来|欠).{0,15}(供应商|供货商)|预付货款|供应商往来|供货商往来/.test(question) || namedSupplier && /应付|预付|欠|往来|未付/.test(question)) return supplierQuestion(store, user, question, detail);
  if (/待办|待审核|待确认|要处理|该做什么|该做啥|要做啥/.test(question)) return pendingQuestion(store, user, detail);
  return null;
}
module.exports = { query, pendingLabels };
