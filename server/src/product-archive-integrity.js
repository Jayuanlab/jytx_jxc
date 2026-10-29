const { HttpError } = require('./common');

// Product identity belongs to the running ledger, including inactive products
// and repair services. A fresh, empty ledger has no prior identities to retain.
function assertProductArchivePreserved(before, after) {
  const previous = before.products || [];
  const current = after.products || [];
  const bySku = new Map();
  const codes = new Set();
  for (const product of current) {
    const sku = String(product.skuId || '');
    const code = String(product.externalCode || '');
    if (!sku || !code || bySku.has(sku) || codes.has(code))
      throw new HttpError(409, '商品档案编号为空或重复，请核对后重试');
    bySku.set(sku, product);
    codes.add(code);
  }
  for (const product of previous) {
    const existing = bySku.get(String(product.skuId || ''));
    if (!existing || existing.externalCode !== product.externalCode)
      throw new HttpError(409, '已建商品档案和编码必须保留，不能删除或覆盖');
  }
}

module.exports = { assertProductArchivePreserved };
