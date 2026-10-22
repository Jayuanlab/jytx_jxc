const assert = require("node:assert/strict");
const { reviewSale } = require("../server/src/copilot");
const store = {
  products: [
    { skuId: "p", name: "测试手机", type: "智能机", active: true, trackSerial: true, stockManaged: true, salePrice: 1999 },
    { skuId: "a", name: "测试充电线", active: true, trackSerial: false, stockManaged: true, salePrice: 39 },
    { skuId: "r", name: "维修服务", type: "维修", active: true, stockManaged: false, salePrice: 80 }
  ],
  inventory: [
    { skuId: "p", warehouseId: "wh-sale", quantity: 1, serials: [{ no: "SN001", status: "可售", costPrice: 1000 }] },
    { skuId: "a", warehouseId: "wh-sale", quantity: 3, serials: [] }
  ]
};
const employee = { id: "u", roleCode: "employee", permissions: ["sale:create"] };
const base = { account: "微信", saleMode: "ordinary", items: [{ skuId: "p", quantity: 1, serialNo: "SN001", salePrice: 1999 }] };
const ok = reviewSale(store, employee, base);
assert.equal(ok.ready, true);
assert.equal(ok.total, 1999);
assert.equal(JSON.stringify(ok).includes("costPrice"), false);
assert.equal(reviewSale(store, employee, { ...base, items: [{ ...base.items[0], serialNo: "NO" }] }).ready, false);
assert.equal(reviewSale(store, employee, { ...base, items: [{ skuId: "a", quantity: 4, salePrice: 39 }] }).ready, false);
assert.equal(reviewSale(store, employee, { ...base, saleMode: "guobu", items: [{ ...base.items[0] }] }).ready, false);
assert.equal(reviewSale(store, employee, { ...base, saleMode: "guobu", account: "云闪付", platformOrderNo: "G1", subsidyAmount: 200 }).ready, true);
assert.equal(reviewSale(store, employee, { ...base, saleMode: "guobu", account: "云闪付", platformOrderNo: "G1", subsidyAmount: 501 }).ready, false);
assert.equal(reviewSale(store, employee, { ...base, items: [{ skuId: "r", quantity: 1, salePrice: 80, materials: [{ skuId: "a", quantity: 4 }] }] }).ready, false);
assert.throws(() => reviewSale(store, { roleCode: "employee", permissions: [] }, base), /没有此操作权限/);
console.log("sales copilot rules passed");
