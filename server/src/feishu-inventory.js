// Public inventory projection for a read-only Feishu Base mirror.
// Keep costs, serial numbers, supplier balances and payroll out of this table.
const COLUMNS = [
  "库存键", "商品编号", "商品名称", "分类", "规格型号", "仓库", "库存数量", "预设售价", "同步时间",
];

function inventoryRows(store, syncedAt = new Date().toISOString()) {
  if (!store || !Array.isArray(store.products) || !Array.isArray(store.inventory))
    throw new Error("库存数据缺少 products 或 inventory");
  const products = new Map(store.products.map((item) => [item.skuId, item]));
  const keys = new Set();
  const rows = store.inventory.map((stock) => {
    const product = products.get(stock.skuId);
    if (!product) throw new Error(`库存引用了不存在的商品：${stock.skuId}`);
    const key = `${stock.skuId}:${stock.warehouseId || "wh-sale"}`;
    if (keys.has(key)) throw new Error(`重复库存键：${key}`);
    keys.add(key);
    const count = Number(stock.quantity);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error(`库存数量无效：${key}`);
    const price = Number(product.salePrice || 0);
    if (!Number.isFinite(price) || price < 0)
      throw new Error(`预设售价无效：${key}`);
    return {
      "库存键": key,
      "商品编号": String(product.externalCode || ""),
      "商品名称": String(product.name || ""),
      "分类": [product.type, product.subType, product.thirdType].filter(Boolean).join(" / "),
      "规格型号": String(product.specification || product.spec || ""),
      "仓库": String(stock.warehouseName || "销售仓"),
      "库存数量": count,
      "预设售价": price,
      "同步时间": syncedAt,
    };
  });
  return rows.sort((a, b) => a["库存键"].localeCompare(b["库存键"]));
}

function csv(rows) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return "\uFEFF" + [COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((name) => quote(row[name])).join(","))].join("\r\n") + "\r\n";
}

module.exports = { COLUMNS, inventoryRows, csv };
