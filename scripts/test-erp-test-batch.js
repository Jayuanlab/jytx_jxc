process.env.STORE_DB_PATH = ":memory:";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readStore } = require("../server/src/repository");
const { applyTestBatch } = require("../server/src/test-data-import");
const erp = require("../server/src/erp");
const batch = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/imports/test-stock-2026-10-07.json"), "utf8"));
const store = readStore();
const owner = store.users.find((u) => u.roleCode === "owner" && u.status === "active");
const result = applyTestBatch(store, batch);
assert.equal(result.products, 216);
assert.equal(result.serials, 144);
assert.equal(result.units, 2001);
assert.equal(applyTestBatch(store, batch).alreadyImported, true);
const phone = batch.products.find((p) => p.trackSerial && p.type === "智能机");
const accessory = batch.products.find((p) => !p.trackSerial && p.quantity >= 3);
assert.ok(phone && accessory);
const inventory = (item) => store.inventory.find((row) => row.skuId === item.skuId);
const beforePhone = inventory(phone).quantity;
const beforeAccessory = inventory(accessory).quantity;
const order = erp.sale(store, owner, { account: "微信", items: [
  { skuId: phone.skuId, quantity: 1, salePrice: phone.salePrice, serialNo: phone.serials[0] },
  { skuId: accessory.skuId, quantity: 2, salePrice: accessory.salePrice },
] });
assert.equal(inventory(phone).quantity, beforePhone - 1);
assert.equal(inventory(accessory).quantity, beforeAccessory - 2);
assert.equal(inventory(phone).serials.find((s) => s.no === phone.serials[0]).status, "已售");
assert.equal(order.amount, Math.round((phone.salePrice + 2 * accessory.salePrice) * 100) / 100);
assert.throws(() => erp.sale(store, owner, { items: [{ skuId: phone.skuId, quantity: 1, salePrice: phone.salePrice, serialNo: phone.serials[0] }] }), /串码|库存|已售/);
const returned = erp.returnSale(store, owner, { orderId: order.id, reason: "测试退货", account: "微信", items: order.items.map((item) => ({ itemId: item.id, quantity: item.quantity })) });
assert.equal(returned.items.length, 2);
assert.equal(inventory(phone).quantity, beforePhone);
assert.equal(inventory(accessory).quantity, beforeAccessory);
assert.equal(inventory(phone).serials.find((s) => s.no === phone.serials[0]).status, "可售");
console.log(JSON.stringify({ imported: result, saleAndReturn: "passed", duplicateSerialSale: "rejected" }));