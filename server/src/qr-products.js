const c = require('./common');
const PREFIX = 'JY1:';
const tracked = require('./inventory-details').tracked;
function canPrint(user) { const caps = c.capabilities(user); return caps.manageProducts || caps.purchase; }
function permitPrint(user) { if (!canPrint(user)) throw new c.HttpError(403, '当前账号没有商品标签权限'); }
function eligible(product) {
  return product && product.active !== false && product.stockManaged !== false && !tracked(product);
}
function encode(product) {
  if (!eligible(product)) throw new c.HttpError(400, '只有按数量管理的在售商品才能生成商品二维码');
  return PREFIX + product.skuId;
}
function list(store) {
  return store.products.filter(eligible).map((product) => ({
    skuId: product.skuId,
    code: product.externalCode,
    name: product.name,
    unit: product.unit || '件',
    salePrice: product.salePrice,
    quantity: store.inventory.filter((row) => row.skuId === product.skuId).reduce((sum, row) => sum + Number(row.quantity || 0), 0),
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
function resolve(store, raw) {
  const code = String(raw || '').trim();
  if (!code || code.length > 120) throw new c.HttpError(400, '请扫描商品二维码或输入商品编号');
  const skuId = code.startsWith(PREFIX) ? code.slice(PREFIX.length) : code;
  const product = store.products.find((row) => eligible(row) && (row.skuId === skuId || row.externalCode === skuId));
  if (!product) throw new c.HttpError(404, '未找到按数量管理的商品；手机请使用原串码流程');
  return {
    skuId: product.skuId, code: product.externalCode, name: product.name,
    unit: product.unit || '件', salePrice: product.salePrice,
    quantity: store.inventory.filter((row) => row.skuId === product.skuId).reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    saleQuantity: store.inventory.filter((row) => row.skuId === product.skuId && (row.warehouseId || 'wh-sale') === (product.warehouseId || 'wh-sale')).reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    warehouses: store.inventory.filter((row) => row.skuId === product.skuId).map((row) => ({ name: row.warehouseName || '销售仓', quantity: row.quantity })),
  };
}
async function svg(product) {
  const QRCode = require('qrcode');
  return QRCode.toString(encode(product), { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 240 });
}
module.exports = { canPrint, permitPrint, PREFIX, eligible, encode, list, resolve, svg };