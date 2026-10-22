const c = require('./common');
const erp = require('./erp');
const vocabulary = require('./search-vocabulary');
const warehouses = require('./warehouses');

const category = /^(?:功能机|按键机|老人机|老年机|老人手机|老年手机)$/;
const elderly = /^(?:老人机|老年机|老人手机|老年手机|老人专用|老年人专用|适老手机)$/;
const phoneRequest = /老人机|老年机|按键机|功能机|老人手机|老年手机/;
const selection = /哪些|哪几|哪款|哪种|推荐|选(?:一|个|哪)|挑|看看|最便宜|便宜|实惠|预算|以内|以下|不超过|不高于|最多|至多|最高|有没得|有没有|还有|有哪些|有几款|有几种|有啥|有些什么|卖吗|多少钱|好多钱|什么(?:型号|款式|品牌)/;
const unrelated = /销量|卖了|卖出|售出|销售单|接待单|开单|成交|调价|成本|毛利|利润|入库|退货|红冲|停用|删除|下架|为什么|为何|不能|不会|怎么(?:开|修|充|用|办)|维修|售后|坏了|打不开|话术|知识|政策|办理|合同|合约|套餐|赠品/;
const unavailable = /^(?:inactive|disabled|deleted|off|停用|已停用|禁用|已删除|下架|已下架)$/i;
const stockStatuses = /^(?:active|available|可售|正常|在库|未激活)$/i;
const brandAliases = [
  ['诺基亚', 'Nokia'], ['飞利浦', 'Philips'], ['小米'], ['红米'], ['华为'], ['荣耀'],
  ['OPPO'], ['vivo'], ['苹果', 'iPhone'], ['三星', 'Samsung'], ['中兴', 'ZTE'],
  ['天语', 'K-Touch'], ['金立', 'Gionee'], ['多亲', 'Qin'], ['AGM'], ['TCL'], ['海信', 'Hisense'],
];
const present = value => String(value ?? '').trim();
const normalized = value => present(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
const usable = row => row.active !== false && row.enabled !== false && !row.deleted && !row.deletedAt && !unavailable.test(present(row.status));
function price(value) {
  if (typeof value === 'boolean' || value == null || !present(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  const amount = c.round(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
const money = value => `¥${value.toFixed(2)}`;
function words(product) {
  return [product.type, product.subType, product.thirdType, ...(Array.isArray(product.tags) ? product.tags : []), ...(Array.isArray(product.aliases) ? product.aliases : [])].map(present);
}
function matchesType(product, featureOnly) {
  if (product.stockManaged === false) return false;
  const declared = words(product);
  // A smartphone's name alone cannot establish that it is suitable for elderly customers.
  if (/智能机|智能手机/.test(present(product.type))) return !featureOnly && declared.some(word => elderly.test(word));
  if (/配件|维修|服务|号卡|移动业务/.test(present(product.type))) return false;
  return declared.some(word => category.test(word));
}
// Parse only amounts next to an explicit budget or upper-bound phrase. Model numbers
// without that context are never money; approximate budgets are not strict limits.
function spokenMoney(token) {
  if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
  const digits = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const units = { '十': 10, '百': 100, '千': 1000, '万': 10000 };
  const [whole, fraction, extra] = token.split('点');
  if (extra !== undefined || !whole || whole.length > 12 || (fraction !== undefined && (!fraction || fraction.length > 2 || ![...fraction].every(char => digits[char] !== undefined)))) return null;
  let value;
  if ([...whole].every(char => digits[char] !== undefined)) value = Number([...whole].map(char => digits[char]).join(''));
  else {
    let total = 0, pending = null, lastUnit = Infinity, explicitZero = false;
    for (const char of whole) {
      if (digits[char] !== undefined) {
        if (pending !== null && pending !== 0) return null;
        pending = digits[char];
        if (pending === 0) explicitZero = true;
      } else {
        const unit = units[char];
        if (!unit || unit >= lastUnit || pending === 0 || (pending === null && !(unit === 10 && total === 0))) return null;
        total += (pending ?? 1) * unit;
        pending = null;
        lastUnit = unit;
        explicitZero = false;
      }
    }
    // Colloquial “一百五” can mean 105 or 150. Require “一百五十” or “一百零五”.
    if (pending && lastUnit >= 100 && !explicitZero) return null;
    value = total + (pending || 0);
  }
  if (fraction) value += Number('0.' + [...fraction].map(char => digits[char]).join(''));
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function budgetOf(question) {
  const token = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]{1,12}(?:点[零〇一二两三四五六七八九]{1,2})?)';
  const boundary = '(?![零〇一二两三四五六七八九十百千万点\\d.])';
  const patterns = [
    new RegExp('预算(?:是|为|在|大概|约)?\\s*(' + token + ')' + boundary + '\\s*(?:元|块)?(?:钱)?', 'g'),
    new RegExp('(' + token + ')' + boundary + '\\s*(?:元|块)?(?:钱)?(?:以内|以下|封顶)', 'g'),
    new RegExp('(?:不超过|不高于|最多|至多|最高)\\s*(' + token + ')' + boundary + '\\s*(?:元|块)?(?:钱)?', 'g'),
  ];
  const amounts = patterns.flatMap(pattern => [...question.matchAll(pattern)]).filter(match => {
    const after = question.slice(match.index + match[0].length).trimStart();
    const before = question.slice(Math.max(0, match.index - 4), match.index);
    return !/^(?:左右|上下|出头|大概|约莫)/.test(after) && !/(?:大概|大约|约莫)$/.test(before) && !/^预算(?:是|为|在)?(?:大概|约)/.test(match[0]);
  }).map(match => spokenMoney(match[1])).filter(value => value !== null && Number.isFinite(value) && value >= 0);
  return amounts.length ? Math.min(...amounts) : null;
}
function brandOf(question, products) {
  const needle = normalized(question);
  const standard = brandAliases.find(group => group.some(word => needle.includes(normalized(word))));
  if (standard) return { label: standard[0], terms: standard };
  const candidates = [...new Set(products.flatMap(product => [product.brand, product.subType]).map(present))]
    .filter(word => word.length >= 2 && !category.test(word) && !elderly.test(word) && !/手机|数码|配件|仓|服务/.test(word))
    .sort((a, b) => b.length - a.length);
  const found = candidates.find(word => needle.includes(normalized(word)));
  return found ? { label: found, terms: [found] } : null;
}
function warehouseOf(question, options) {
  const named = question.match(/(?<![a-z])([a-z])\s*仓/i);
  const requested = options.warehouseId || (named ? warehouses.WAREHOUSES.find(row => row.code === named[1].toUpperCase())?.id : '');
  return { id: present(requested), invalid: !!named && !warehouses.WAREHOUSES.some(row => row.code === named[1].toUpperCase()) };
}
function availability(product, rows) {
  const warehouseId = product.warehouseId || 'wh-sale';
  const matched = rows.filter(row => row.skuId === product.skuId && row.warehouseId === warehouseId);
  // Duplicate locations must be checked instead of adding potentially duplicated stock.
  if (matched.length !== 1) return null;
  const row = matched[0];
  const quantity = Number(row.quantity);
  if (!usable(row) || (row.status && !stockStatuses.test(present(row.status))) || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
  let available = quantity;
  if (product.trackSerial) {
    const serials = new Set((row.serials || []).filter(serial => ['可售', '未激活'].includes(serial.status) && present(serial.no)).map(serial => present(serial.no)));
    available = Math.min(quantity, serials.size);
  }
  return available > 0 ? { quantity: available, warehouseId, warehouseName: row.warehouseName || warehouses.byId(warehouseId)?.name || '销售仓' } : null;
}
function query(store, user, question, options = {}) {
  const q = present(question).normalize('NFKC');
  if (!phoneRequest.test(q) || !selection.test(q) || unrelated.test(q) || /(?:不买|不要|不想买|不需要).{0,5}(?:老人|功能|按键|老年)/.test(q)) return null;
  const replyStyle = options.customerReplyStyle === 'mandarin' ? 'mandarin' : 'sichuan';
  const metrics = { kind: 'product-recommendations', replyStyle };
  const response = (answer, extra = {}) => ({ answer, asOf: c.now(), scope: '当前岗位库存授权范围', sources: [], metrics, ...extra });
  if (!user || (user.status && user.status !== 'active')) return response('请先用在职账号登录，再查门店商品。', { metrics: { ...metrics, denied: true } });
  const caps = c.capabilities(user);
  if (!caps.sell && !caps.purchase && !caps.stocktake && !caps.manageProducts) return response('当前岗位没有库存查询权限。', { metrics: { ...metrics, denied: true } });
  const warehouse = warehouseOf(q, options);
  if (warehouse.invalid) return response('请选 A仓、B仓或C仓，我再帮你查。', { metrics: { ...metrics, invalidWarehouse: true } });
  const catalog = erp.listProducts(store, user).filter(product => present(product.name) && usable(product) && matchesType(product, /功能机|按键机/.test(q) && !/老人|老年/.test(q)));
  const brand = brandOf(q, catalog);
  const budget = budgetOf(q);
  // ERP inventory projects fields according to the current account. Orphan stock is never recommended.
  const known = new Set((store.products || []).map(product => product.skuId));
  const stock = erp.inventory({ ...store, inventory: (store.inventory || []).filter(row => known.has(row.skuId)) }, user);
  const candidates = catalog.filter(product => !brand || brand.terms.some(term => vocabulary.matches(store, [...vocabulary.productFields(product), product.brand], term)))
    .map(product => ({ product, availability: availability(product, stock), price: price(product.salePrice) }))
    .filter(item => item.availability && (!warehouse.id || item.availability.warehouseId === warehouse.id));
  const unpriced = candidates.filter(item => item.price === null);
  const priced = candidates.filter(item => item.price !== null && (budget === null || item.price <= budget))
    .sort((a, b) => a.price - b.price || a.product.name.localeCompare(b.product.name, 'zh-CN'));
  const cheapest = /最便宜|最低价/.test(q);
  const limit = /全部|所有|详细|明细/.test(q) ? 15 : 3;
  const selected = (cheapest && priced.length ? priced.filter(item => item.price === priced[0].price) : priced).slice(0, limit);
  const label = `${brand?.label || ''}${/功能机|按键机/.test(q) && !/老人|老年/.test(q) ? '功能机' : '老人机/功能机'}`;
  const explanation = budget === null ? '' : `${money(budget)}以内的`;
  const sources = []; // Retail recommendations do not link to internal cost-bearing inventory pages.
  Object.assign(metrics, { brand: brand?.label || null, warehouseId: warehouse.id || null, budget, matchedCount: priced.length, unpricedCount: unpriced.length, minPrice: priced[0]?.price ?? null,
    recommendations: selected.map(item => ({ skuId: item.product.skuId, name: item.product.name, salePrice: item.price, availableQuantity: item.availability.quantity, warehouseId: item.availability.warehouseId, warehouseName: item.availability.warehouseName })) });
  if (!selected.length) {
    const text = unpriced.length ? `有 ${unpriced.length} 款在库，零售价还没设好，先请店员核价${budget === null ? '。' : `，再看是否在 ${money(budget)} 预算内。`}` : replyStyle === 'mandarin' ? `当前没有查到${explanation}${label}可售库存。` : `现在没查到${explanation}${label}现货，你想看别的价位不？`;
    return response(text, { sources });
  }
  const details = selected.map(item => `${item.product.name} ${money(item.price)}（可售 ${item.availability.quantity} 台）`).join('；');
  let text = replyStyle === 'mandarin' ? `${explanation}${label}，按零售价从低到高：${details}。` : `${explanation}${label}，便宜的有：${details}。你想看哪款嘛？`;
  if (unpriced.length) text += `另有 ${unpriced.length} 款未设零售价，需店员核价。`;
  return response(text, { sources, table: { title: '在库商品零售价', columns: [{ key: 'name', label: '商品' }, { key: 'salePrice', label: '零售价' }, { key: 'availableQuantity', label: '可售台数' }, { key: 'warehouseName', label: '仓库' }], rows: metrics.recommendations.map(item => ({ name: item.name, salePrice: money(item.salePrice), availableQuantity: item.availableQuantity, warehouseName: item.warehouseName })) } });
}
module.exports = { query };
