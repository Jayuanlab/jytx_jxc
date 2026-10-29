'use strict';

// Pure rules for a supplier's transfer of our stock to another shop. This
// module does not post stock or money: the application commits all changes in
// one repository transaction only after these rules pass.
const MAX_LINES = 100;
const toCents = (value, label = '金额') => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error(`${label}须为非负金额，最多两位小数`);
  const [whole, fraction = ''] = String(value).split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n < 0 || n > 100000000000) throw new Error(`${label}超出范围`);
  return n;
};
const fromCents = n => n / 100;

const isTracked = product => product.stockManaged !== false && (product.trackSerial === true || [product.type, product.subType, product.thirdType].some(value => /智能手机|智能机|功能机|老人机|老年机|按键机|二手机|二手手机|^手机$/i.test(value || '')));
function linesFromCatalog(items, products, inventory) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_LINES) throw new Error('请填写一至一百行实际调出的商品');
  const selected = new Map();
  const selectedSerials = new Set();
  return items.map((input, index) => {
    const product = products.find(p => p.skuId === input.skuId && p.stockManaged !== false && p.active !== false);
    if (!product) throw new Error(`第${index + 1}行不是当前库存中的在用商品`);
    const stock = inventory.find(s => s.skuId === product.skuId && s.warehouseId === input.warehouseId);
    if (!stock || inventory.filter(s => s.skuId === product.skuId && s.warehouseId === input.warehouseId).length !== 1) throw new Error(`第${index + 1}行原仓库存不存在或重复`);
    const quantity = Number(input.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error(`第${index + 1}行数量不正确`);
    const key = `${input.warehouseId}/${product.skuId}`;
    selected.set(key, (selected.get(key) || 0) + quantity);
    if (selected.get(key) > stock.quantity) throw new Error(`第${index + 1}行合计超出当前实存`);
    const serialNos = input.serialNos || [];
    const tracked = isTracked(product);
    if (tracked) {
      if (!Array.isArray(serialNos) || serialNos.length !== quantity || new Set(serialNos).size !== quantity || serialNos.some(no => !stock.serials?.some(s => s.no === no && ['可售', '未激活'].includes(s.status)))) throw new Error(`第${index + 1}行须逐台选择唯一在库串号`);
      for (const no of serialNos) { if (selectedSerials.has(no)) throw new Error(`第${index + 1}行串号已在本单另一行选用`); selectedSerials.add(no); }
    } else if (serialNos.length) throw new Error(`第${index + 1}行数量商品不能填写串号`);
    const unitPriceCents = toCents(input.agreedUnitPrice, `第${index + 1}行约定单价`);
    if (unitPriceCents < 1) throw new Error(`第${index + 1}行约定单价须大于零`);
    return { skuId: product.skuId, productName: product.name, warehouseId: stock.warehouseId, warehouseName: stock.warehouseName, quantity, unitPriceCents, valueCents: quantity * unitPriceCents, serialNos: [...serialNos] };
  });
}

function compute(row) {
  const due = row.lines.reduce((n, line) => n + line.valueCents, 0);
  const cash = (row.cashReceipts || []).reduce((n, e) => n + e.valueCents, 0);
  const goods = (row.goodsReceipts || []).reduce((n, e) => n + e.offsetCents, 0);
  const balance = due - cash - goods;
  if (![due, cash, goods, balance].every(Number.isSafeInteger) || balance < 0) throw new Error('本单核销金额超出约定货款');
  return { dueCents: due, cashCents: cash, goodsCents: goods, balanceCents: balance, due: fromCents(due), cash: fromCents(cash), goods: fromCents(goods), balance: fromCents(balance) };
}

function settlement(row, kind, cents) {
  if (row.status !== '已交货待结') throw new Error('只有实际交货后才能结算');
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('本次实际结算金额须大于零');
  const before = compute(row);
  if (cents > before.balanceCents) throw new Error('本次结算不能超过本单未结金额；超额另立差额事项');
  if (kind !== 'cash' && kind !== 'goods') throw new Error('结算方式不正确');
  return { before, afterCents: before.balanceCents - cents, closes: before.balanceCents === cents };
}

function urgency(row, now = new Date()) {
  const figures = compute(row);
  if (row.status !== '已交货待结' || figures.balanceCents === 0) return 'closed';
  const at = row.confirmedDueAt ? Date.parse(row.confirmedDueAt) : NaN;
  if (!Number.isFinite(at)) return '需确认约定时间';
  const hours = (at - now.getTime()) / 3600000;
  return hours < 0 ? '已逾期' : hours <= 24 ? '即将到期' : '重点跟踪';
}

module.exports = { toCents, fromCents, isTracked, linesFromCatalog, compute, settlement, urgency };
