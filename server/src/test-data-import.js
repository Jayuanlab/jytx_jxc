const fs = require("node:fs");
const { readStore, transaction } = require("./repository");
const c = require("./common");

function validateBatch(store, batch) {
  if (!batch || batch.testData !== true || !/^test-stock-\d{4}-\d{2}-\d{2}$/.test(batch.batchId || ""))
    throw new Error("只允许导入明确标记的测试库存批次");
  if (!Array.isArray(batch.products) || !batch.products.length)
    throw new Error("测试库存批次为空");
  const prior = (store.testDataImports || []).find((x) => x.batchId === batch.batchId);
  if (prior) {
    if (prior.contentHash !== batch.contentHash) throw new Error("批次编号已使用，但内容发生变化");
    return { ...prior.result, alreadyImported: true };
  }
  const codes = new Set(store.products.map((x) => x.externalCode));
  const ids = new Set(store.products.map((x) => x.skuId));
  const serials = new Set(store.inventory.flatMap((x) => (x.serials || []).map((s) => s.no)));
  let serialCount = 0;
  for (const item of batch.products) {
    if (!item || !item.skuId || !item.externalCode || !item.name || !item.type || !item.unit)
      throw new Error("测试商品缺少必填资料");
    if (codes.has(item.externalCode) || ids.has(item.skuId))
      throw new Error("测试商品编号或 SKU 已存在：" + item.externalCode);
    codes.add(item.externalCode); ids.add(item.skuId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
        !Number.isFinite(item.costPrice) || item.costPrice <= 0 ||
        !Number.isFinite(item.salePrice) || item.salePrice <= 0)
      throw new Error("测试商品数量、成本或售价无效：" + item.externalCode);
    if (!Array.isArray(item.serials) || item.trackSerial !== (item.serials.length > 0))
      throw new Error("库存管理方式与串码不一致：" + item.externalCode);
    if (item.trackSerial && item.serials.length !== item.quantity)
      throw new Error("串码数量与库存数量不一致：" + item.externalCode);
    if (["智能机", "功能机", "二手机"].includes(item.type) && !item.trackSerial)
      throw new Error("手机必须逐件管理串码：" + item.externalCode);
    for (const no of item.serials) {
      if (typeof no !== "string" || !no.trim() || serials.has(no))
        throw new Error("串码为空或重复：" + item.externalCode);
      serials.add(no); serialCount++;
    }
  }
  return {
    alreadyImported: false,
    products: batch.products.length,
    serializedProducts: batch.products.filter((x) => x.trackSerial).length,
    accessoryProducts: batch.products.filter((x) => !x.trackSerial).length,
    serials: serialCount,
    units: batch.products.reduce((n, x) => n + x.quantity, 0),
  };
}

function applyTestBatch(store, batch) {
  const preview = validateBatch(store, batch);
  if (preview.alreadyImported) return preview;
  const owner = store.users.find((u) => u.roleCode === "owner" && u.status === "active");
  if (!owner) throw new Error("测试库存导入需要在职老板账号记入审计");
  store.testDataImports ||= [];
  store.categories ||= [];
  store.subcategories ||= {};
  const now = c.now();
  for (const item of batch.products) {
    store.products.push({
      skuId: item.skuId, externalCode: item.externalCode,
      name: item.name, shortName: item.shortName || item.name,
      type: item.type, subType: item.subType || "", thirdType: item.thirdType || "",
      sourceCategory3: item.sourceCategory3 || "", spec: item.spec || "", unit: item.unit,
      costPrice: item.costPrice, salePrice: item.salePrice,
      trackSerial: item.trackSerial, stockManaged: true, active: true,
      testData: true, testDataBatch: batch.batchId,
      testPriceGenerated: !!item.testPriceGenerated, priceSource: item.priceSource || "",
    });
    store.inventory.push({
      skuId: item.skuId, externalCode: item.externalCode,
      warehouseId: "wh-sale", warehouseName: "销售仓",
      quantity: item.quantity, costPrice: item.costPrice,
      stockValue: c.round(item.quantity * item.costPrice),
      serials: item.serials.map((no) => ({ no, status: "可售", costPrice: item.costPrice })),
      costSources: item.trackSerial ? [] : [{ sourceId: batch.batchId, quantity: item.quantity }],
    });
    store.movements.unshift({
      id: c.id("MV"), skuId: item.skuId, product: item.name,
      warehouseId: "wh-sale", warehouseName: "销售仓",
      quantity: item.quantity, cost: c.round(item.quantity * item.costPrice),
      type: "测试库存导入", sourceType: "test_data", sourceId: batch.batchId,
      operatorId: owner.id, operator: owner.name, createdAt: now,
    });
    if (!store.categories.includes(item.type)) store.categories.push(item.type);
    store.subcategories[item.type] ||= [];
    if (item.subType && !store.subcategories[item.type].includes(item.subType))
      store.subcategories[item.type].push(item.subType);
  }
  c.audit(store, owner, "test-data:import", `${batch.batchId} 导入 ${preview.products} 种商品、${preview.units} 件测试库存`);
  store.testDataImports.push({ batchId: batch.batchId, contentHash: batch.contentHash, at: now, result: preview });
  return preview;
}

function importFile(filename, options = {}) {
  const batch = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (options.preview) return validateBatch(readStore(), batch);
  return transaction((store) => applyTestBatch(store, batch));
}

module.exports = { validateBatch, applyTestBatch, importFile };