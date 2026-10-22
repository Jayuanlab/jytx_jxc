'use strict';
// Read-only serial reconciliation. The caller must pass its currently scoped store.
const c = require('./common');
const details = require('./inventory-details');
const capacityContext = require('./capacity/context');
const normal = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
const cleanQuestion = value => String(value ?? '').normalize('NFKC').trim().slice(0, 500);
const statusWords = /(?:是不是|是否|有没有|有没|已经|已|还|曾经).{0,8}(?:卖|销售|售出|出库|在库)|(?:卖|销售|售出|出库).{0,8}(?:没有|了吗|了没|记录|查|核对|状态)|销售记录|已售(?:出|了)?|还在库|仍在库|串(?:号|码).{0,45}(?:状态|在哪|去向)|(?:查|查询|核对|追踪|查一下|看一下).{0,12}(?:串号|串码|IMEI)/i;
const questions = /查|看|核对|追踪|是不是|是否|有没有|有没|吗|没有|了没|记录|状态|在哪|去向|[?？]/i;
const writeOnly = /(?:开|建|做|填|出).{0,5}(?:销售)?单|录单|下单|生成销售草稿|帮我卖|我要卖|卖一台|卖一件/;
const saleStates = new Set(['已售', '已售出', '已销售']);
const canceledStates = new Set(['cancelled', 'canceled', '已取消', '取消', 'void', 'voided', '作废', '已作废']);
function extractTokens(question) {
  const q = cleanQuestion(question), found = [];
  for (const match of q.matchAll(/(?:串号|串码|IMEI|后四位|后4位|后四码|尾号)\s*(?:是|为|[:：])?\s*([a-z0-9](?:[a-z0-9-]{2,38}[a-z0-9]))(?![a-z0-9-])/gi)) found.push(normal(match[1]));
  for (const match of q.matchAll(/(?<![a-z0-9])([0-9]{14,18}|[0-9]{4})(?![a-z0-9年/月日元块台件])/gi)) found.push(normal(match[1]));
  return [...new Set(found)].filter(token => /^[A-Z0-9-]{4,40}$/.test(token));
}
function sameScope(row, scope) {
  if (!row || typeof row !== 'object') return false;
  return (!row.tenantId || scope.tenantId && row.tenantId === scope.tenantId) && (!row.branchId || scope.branchId && row.branchId === scope.branchId);
}
function contextTokens(context, user, scope) {
  if (!context || !user || context.userId !== user.id || !Number.isFinite(context.at) || Date.now() - context.at < 0 || Date.now() - context.at >= 30 * 60 * 1000 || !sameScope(context, scope)) return [];
  // Only one distinct serial is inherited. A prior list must never pick its first phone.
  const remembered = context.serialToken || context.serialNo;
  if (remembered && /^[A-Z0-9-]{4,40}$/.test(normal(remembered))) return [normal(remembered)];
  return extractTokens([context.recordSubject, context.question].filter(value => typeof value === 'string').join(' '));
}
function detectIntent(question, context, user) {
  const q = cleanQuestion(question);
  if (!q || !statusWords.test(q) || !questions.test(q)) return null;
  const specificDetail = /进货日期|入库日期|进货|供货商|供应商|售价|零售价|卖价|进价|成本|毛利|利润|卖给谁|卖给|顾客|客户/.test(q);
  const explicitStatus = /(?:是不是|是否|有没有|有没|已经|已|还|曾经).{0,8}(?:卖|销售|售出|出库|在库)|(?:卖|销售|售出|出库).{0,8}(?:没有|了吗|了没)|已售|状态|去向|还在库|仍在库/.test(q);
  if (specificDetail && !explicitStatus) return null;
  if (writeOnly.test(q) && !/查|查询|核对|是不是|是否|有没有|有没|已售|已卖|记录|状态|在库/.test(q)) return null;
  const explicit = extractTokens(q);
  if (!explicit.length) {
    const singlePhone = /这(?:一)?台|这部|那(?:一)?台|那部|它|上面这台|刚才那台/.test(q);
    const listOrSummary = /清单|明细|列表|统计|汇总|哪些|多少|几台|所有|全部|什么手机|销量|销售额|营业额/.test(q);
    const datedSales = /今天|今日|昨天|昨日|本月|本周|最近|今年|20\d{2}[-年/.]/.test(q) && /卖|销售|售出|成交/.test(q);
    const brandedStock = /华为|荣耀|OPPO|vivo|苹果|iPhone|小米|红米|三星|一加|realme|魅族|中兴|努比亚/i.test(q);
    const stockList = /库存|在库|可售|还有|剩余|销售记录/.test(q) && !singlePhone && !explicitStatus;
    if (listOrSummary || datedSales && !singlePhone || brandedStock && !singlePhone || stockList) return null;
  }
  const tokens = explicit.length ? explicit : contextTokens(context, user, capacityContext.current());
  return { token: tokens.length === 1 ? tokens[0] : null, tokens, tail: tokens.length === 1 && tokens[0].length === 4, needsSerial: !tokens.length, ambiguousInput: tokens.length > 1 };
}
function source(label, id, href) { return { label, id: String(id), href }; }
function result(text, metrics = {}, {sources = [], rows = [], subject} = {}) {
  return { answer: text, sources, metrics: {kind: 'serial-status', ...metrics}, ...(subject ? {conversationHint: {topic: 'record-query', subject}} : {}), ...(rows.length ? {table: {title: '串号状态核对', columns: [{key: 'name', label: '商品'}, {key: 'serialNo', label: '串号'}, {key: 'warehouse', label: '仓库'}, {key: 'status', label: '状态'}], rows}} : {}) };
}
function date(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(value));
}
function historyState(order, item, gift) {
  if (order.redReversedBy || order.redOf) return '已红冲';
  if (canceledStates.has(String(order.status || '').toLowerCase()) || gift && canceledStates.has(String(gift.status || '').toLowerCase())) return '已取消';
  const quantity = Number(item.quantity || 1), returned = Number(item.returnedQuantity || 0);
  if (returned >= quantity || order.status === 'returned' || order.status === '已退货') return '已退货';
  if (gift && gift.status && gift.status !== 'issued') return '赠品状态待核对';
  return gift ? '赠品出库' : '有效销售';
}
function query(store, user, question, context) {
  const intent = detectIntent(question, context, user);
  if (!intent) return null;
  const caps = c.capabilities(user), scope = capacityContext.current();
  const customer = user.assistantCustomerOnly === true || user.roleCode === 'customer-assistant';
  if (customer || !caps.sell && !caps.purchase && !caps.stocktake && !caps.manageProducts) return result('当前岗位没有库存和串号查询权限。', {denied: true});
  if (!sameScope(store, scope) || user.roleCode !== 'owner' && scope.branchId && Array.isArray(user.branchIds) && user.branchIds.length && !user.branchIds.includes(scope.branchId)) return result('当前账号不能查询这个门店，请切换到已授权门店。', {denied: true});
  if (intent.ambiguousInput) return result('这句话里有多个串号或尾号，请先说要核对哪一台的完整串号。', {ambiguous: true, needsClarification: true});
  if (intent.needsSerial) return result('可以核对是否已销售。请告诉我这台手机的完整串号，或串号后四位；如果尾号相同，我会请你选准确的一台。', {needsClarification: true});
  const token = intent.token, matches = no => intent.tail ? normal(no).endsWith(token) : normal(no) === token;
  const products = new Map((store.products || []).filter(row => sameScope(row, scope)).map(row => [row.skuId, row]));
  const entries = new Map();
  const entry = no => { const key = normal(no); if (!entries.has(key)) entries.set(key, {serialNo: String(no), stocks: [], sales: [], history: []}); return entries.get(key); };
  for (const stock of store.inventory || []) {
    if (!sameScope(stock, scope)) continue;
    const product = products.get(stock.skuId);
    if (!product || !details.tracked(product)) continue;
    for (const serial of stock.serials || []) if (sameScope(serial, scope) && matches(serial.no)) entry(serial.no).stocks.push({name: product.name || '未记录商品', warehouse: stock.warehouseName || '销售仓', status: String(serial.status || '')});
  }
  for (const order of store.sales || []) {
    if (!sameScope(order, scope)) continue;
    const visible = caps.allSales || (order.salespersonId || order.operatorId) === user.id;
    const lines = (order.items || []).map(item => ({item, gift: null})).concat((order.giftOrders || []).filter(gift => sameScope(gift, scope)).flatMap(gift => (gift.items || []).map(item => ({item, gift}))));
    for (const {item, gift} of lines) if (sameScope(item, scope) && item.serialNo && matches(item.serialNo)) {
      const matched = entry(item.serialNo), state = historyState(order, item, gift);
      // User authorized stock reconciliation across this branch, not other staff's sales details.
      // Keep hidden original fields internal and return only its product/state.
      matched.history.push({name: item.name || '未记录商品', state, at: order.createdAt});
      if (visible) matched.sales.push({orderId: order.id, createdAt: order.createdAt, name: item.name || '未记录商品', warehouse: item.warehouseName || '未记录仓库', state});
    }
  }
  const found = [...entries.values()];
  const traceSource = source('串号追踪', token, '/search?scope=serials&q=' + encodeURIComponent(token));
  if (!found.length) return result('当前门店、岗位可见记录中没有查到串号 ' + token + '。这不等于确认未销售；请核对完整串号，或请有权限者核对原销售单。', {matchedCount: 0, status: 'missing'}, {sources: [traceSource]});
  if (found.length > 1 || found.some(row => row.stocks.length > 1)) {
    const rows = found.flatMap(row => row.stocks.length ? row.stocks.map(stock => ({name: stock.name, serialNo: row.serialNo, warehouse: stock.warehouse, status: ['可售','未激活',...saleStates].includes(stock.status) ? stock.status : '待核对'})) : [{name: row.sales[0]?.name || row.history[0]?.name || '未记录商品', serialNo: row.serialNo, warehouse: row.sales[0]?.warehouse || '未记录仓库', status: '历史记录'}]);
    return result((intent.tail ? '尾号 ' + token + ' 匹配多台手机' : '完整串号 ' + token + ' 出现在多条库存记录') + '：' + rows.slice(0, 6).map(row => row.name + '，串号 ' + row.serialNo + '，' + row.warehouse).join('；') + '。' + (intent.tail ? '请说完整串号，不能只凭尾号选第一台。' : '库存记录需要核对，我不会替你选择或重复销售。'), {matchedCount: found.length, ambiguous: true, status: 'ambiguous'}, {sources: [traceSource], rows: rows.slice(0, 10)});
  }
  const record = found[0], stock = record.stocks[0];
  const history = record.sales.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.orderId || '').localeCompare(String(a.orderId || '')));
  const allHistory = record.history.slice().sort((a,b) => String(b.at || '').localeCompare(String(a.at || '')));
  const recent = history[0], lastState = allHistory[0]?.state, active = allHistory.filter(row => row.state === '有效销售' || row.state === '赠品出库');
  let status, message;
  if (stock && details.inStock(stock)) {
    status = active.length ? 'inconsistent' : 'instock';
    message = stock.name + '，串号 ' + record.serialNo + '，' + stock.warehouse + '，当前库存记录为' + stock.status + '。';
    message += active.length ? '但可见历史中仍有未退货或红冲的销售/出库记录，状态需要核对，请先不要重复开单。' : '这是当前在库状态；是否正式开单仍需核对实物及销售页面，不会在查询时扣库存。';
  } else if (stock && saleStates.has(stock.status)) {
    const retiredLatest = ['已退货', '已红冲', '已取消'].includes(lastState) && !active.length;
    status = retiredLatest ? 'inconsistent' : 'sold';
    message = stock.name + '，串号 ' + record.serialNo + '，' + stock.warehouse + '，库存记录已售出，不能作为可售串号再次开单。';
    if (retiredLatest) message += '但最近可见原单已退货、红冲或取消，库存与原单状态需要人工核对，不能仅凭历史销售确定现在仍已售出。';
  } else if (stock) {
    status = 'unavailable'; message = stock.name + '，串号 ' + record.serialNo + '，' + stock.warehouse + '，当前不是可售状态，需要核对库存记录。';
  } else {
    status = 'history-only'; message = (allHistory[0]?.name || '手机') + '，串号 ' + record.serialNo + ' 有历史销售记录，最近流转为' + (lastState || '待核对') + '，但当前库存中没有这台手机。历史销售不等于当前一定已售出，请核对原单和实物状态。';
  }
  if (history.length) message += '\n可见原单：' + history.slice(0, 5).map(row => row.orderId + '，' + date(row.createdAt) + '，' + row.name + '，' + row.state).join('；') + (history.length > 5 ? '；更多请打开串号追踪。' : '。');
  else if (status === 'sold' || record.history.length) message += '对应原单需有权限者核对；当前岗位没有可见的原销售单详情。';
  const sources = [source('串号追踪', record.serialNo, '/search?scope=serials&q=' + encodeURIComponent(record.serialNo)), ...history.slice(0, 5).map(row => source('原销售单', row.orderId, '/app?tab=orders&q=' + encodeURIComponent(row.orderId)))];
  const rows = [{name: stock?.name || recent?.name || allHistory[0]?.name || '未记录商品', serialNo: record.serialNo, warehouse: stock?.warehouse || recent?.warehouse || '未记录仓库', status: status === 'sold' ? '库存记录已售出' : status === 'instock' ? '在库可售' : status === 'inconsistent' ? '状态待核对' : status === 'history-only' ? '仅历史记录' : '当前不可售'}];
  return result(message, {matchedCount: 1, status, serialNo: record.serialNo, visibleSaleCount: history.length, sales: history.slice(0, 5).map(({orderId, createdAt, name, state}) => ({orderId, createdAt, name, state}))}, {sources, rows, subject: '串号 ' + record.serialNo});
}
module.exports = {detectIntent, query};

