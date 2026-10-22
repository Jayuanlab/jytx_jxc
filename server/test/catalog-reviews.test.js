process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
// These fixtures never import spreadsheets; the optional XLSX dependency is
// unused by the actual supplier, product, purchase and sale functions below.
const Module = require("module"), load = Module._load;
Module._load = function(name, ...args) { return name === "xlsx" ? {} : load.call(this, name, ...args); };
const c = require("../src/common");
const suppliers = require("../src/suppliers");
const erp = require("../src/erp");
const catalog = require("../src/catalog-reviews");
const notices = require("../src/local-notices");
const owner = { id: "B", name: "老板", roleCode: "owner", status: "active" };
const staff = { id: "W", name: "营业员", roleCode: "employee", status: "active", permissions: ["purchase:create", "sale:create", "product:update"] };
const manager = { id: "M", name: "店长", roleCode: "manager", status: "active" };
const status = code => error => error.statusCode === code;
function fixture() {
  return c.initialize({ users: [structuredClone(owner), structuredClone(staff), structuredClone(manager)], supplierModelVersion: 2,
    products: [{ skuId: "CABLE", externalCode: "C1", name: "测试数据线", type: "配件", stockManaged: true, trackSerial: false, warehouseId: "wh-b", salePrice: 30, costPrice: 0, active: true }],
    inventory: [{ skuId: "CABLE", warehouseId: "wh-b", warehouseName: "B仓·配件", quantity: 0, costPrice: 0, stockValue: 0, serials: [] }],
  });
}
function business(store) {
  const snapshot = structuredClone(store);
  delete snapshot.catalogAdditionReviews;
  delete snapshot.localCatalogNotices;
  delete snapshot.operationLogs;
  return snapshot;
}
function newSupplier(store) { return suppliers.save(store, staff, { name: "测试新往来单位", contact: "测试联系人", note: "首次供货资料待补齐" }); }
function review(store, row, decision, note = "本人核对资料完整") { return catalog.review(store, owner, { id: row.id, decision, note }); }

test("员工新增往来单位和商品立即能入库销售；仅后核对不阻断业务", () => {
  const store = fixture(), supplier = newSupplier(store);
  const product = erp.saveProduct(store, staff, { externalCode: "C2", name: "测试充电线", type: "配件", kind: "physical", warehouseId: "wh-b", salePrice: 30, trackSerial: false });
  assert.equal(store.catalogAdditionReviews.length, 2);
  assert.ok(store.catalogAdditionReviews.every(row => row.status === "待老板核对"));
  assert.equal(store.localCatalogNotices.length, 2);
  assert.equal((store.feishuNotices || []).length, 0);
  assert.equal(store.staffMessages.length, 0);
  assert.ok(store.localCatalogNotices.every(row => row.localOnly === true));
  assert.match(store.localCatalogNotices[0].kind, /往来单位/);
  assert.ok(!store.localCatalogNotices[0].summary.includes("供货商"));
  const order = erp.purchase(store, staff, { supplierId: supplier.id, items: [{ skuId: product.skuId, quantity: 2, costPrice: 10, serials: [] }] });
  assert.equal(order.amount, 20);
  const sale = erp.sale(store, staff, { account: "现金", items: [{ skuId: product.skuId, quantity: 1, salePrice: 30 }] });
  assert.equal(sale.amount, 30);
  assert.equal(store.inventory.find(row => row.skuId === product.skuId).quantity, 1);
  assert.ok(store.catalogAdditionReviews.every(row => row.status === "待老板核对"));
  assert.equal(catalog.list(store, owner).length, 2);
  assert.throws(() => catalog.list(store, staff), status(403));
});

test("直接入库与订货自动新建都保存supplierContact，并不覆盖已有同名联系方式", () => {
  const store = fixture();
  const purchase = erp.purchase(store, staff, { supplier: "当次入库新单位", supplierContact: "入库联系人", items: [{ skuId: "CABLE", quantity: 1, costPrice: 10, serials: [] }] });
  const supplier = store.suppliers.find(row => row.id === purchase.supplierId);
  assert.equal(supplier.contact, "入库联系人");
  assert.equal(store.catalogAdditionReviews[0].detail.contact, "入库联系人");
  const plan = suppliers.plan(store, staff, { supplier: "当次订货新单位", supplierContact: "订货联系人", items: [{ skuId: "CABLE", quantity: 2, costPrice: 10 }] });
  assert.equal(store.suppliers.find(row => row.id === plan.supplierId).contact, "订货联系人");
  assert.equal(plan.paymentReview.status, "pending");
  const oldLength = store.catalogAdditionReviews.length;
  const reused = suppliers.resolve(store, staff, { supplier: supplier.name, supplierContact: "不得覆盖旧信息" });
  assert.equal(reused.id, supplier.id);
  assert.equal(reused.contact, "入库联系人");
  assert.equal(store.catalogAdditionReviews.length, oldLength);
  assert.ok((store.feishuNotices || []).every(row => !row.key.startsWith("catalog-addition:")));
});

test("后核对只留意见及历史，需完善不撤销原档案或业务，完善后仍可确认", () => {
  const store = fixture(), supplier = newSupplier(store), row = store.catalogAdditionReviews[0];
  erp.purchase(store, staff, { supplierId: supplier.id, items: [{ skuId: "CABLE", quantity: 2, costPrice: 10, serials: [] }] });
  erp.sale(store, staff, { account: "现金", items: [{ skuId: "CABLE", quantity: 1, salePrice: 30 }] });
  const before = business(store), originalDetail = structuredClone(row.detail);
  review(store, row, "needs_changes", "请补充真实联系人资料");
  assert.equal(row.status, "需完善");
  assert.equal(row.reviewerId, owner.id);
  assert.deepEqual(business(store), before);
  assert.deepEqual(row.detail, originalDetail);
  assert.equal(store.localCatalogNotices[0].readAt, row.reviewedAt);
  assert.equal(row.events.length, 2);
  const catalogCount = store.catalogAdditionReviews.length;
  suppliers.save(store, staff, { id: supplier.id, name: supplier.name, contact: "已补充联系人", note: "已核实单位资料" });
  assert.equal(store.catalogAdditionReviews.length, catalogCount);
  assert.equal(catalog.list(store, owner)[0].current.contact, "已补充联系人");
  assert.equal(row.detail.contact, "测试联系人");
  review(store, row, "confirm", "资料已完善本人确认");
  assert.equal(row.status, "已确认");
  assert.equal(row.events.length, 3);
  assert.equal(row.events[2].current.contact, "已补充联系人");
  const after = structuredClone(store);
  assert.throws(() => review(store, row, "confirm"), status(409));
  assert.deepEqual(store, after);
});

test("强老板权限检查：店长、营业员、伪角色、停用及客户专用身份不能查看或审核", () => {
  const store = fixture(); newSupplier(store); const row = store.catalogAdditionReviews[0];
  for (const user of [staff, manager, { ...staff, roleCode: "owner" }, { ...owner, status: "inactive" }, { ...owner, assistantCustomerOnly: true }, { ...owner, id: "MISSING" }]) {
    const before = structuredClone(store);
    assert.throws(() => catalog.list(store, user), status(403));
    assert.throws(() => catalog.review(store, user, { id: row.id, decision: "confirm", note: "尝试越权审核" }), status(403));
    assert.deepEqual(store, before);
  }
  store.users[0].status = "inactive";
  assert.throws(() => catalog.list(store, owner), status(403));
  store.users[0].status = "active"; store.users[0].assistantCustomerOnly = true;
  assert.throws(() => review(store, row, "needs_changes"), status(403));
});

test("本地老板消息合并已阅功能，新增通知不进入飞书/微信外发队列", () => {
  const store = fixture();
  store.feishuNotices = [{ key: "old", kind: "旧单据", orderId: "OLD", summary: "既有通知", createdAt: "2020-01-01T00:00:00Z", readAt: null }];
  const oldNotice = structuredClone(store.feishuNotices);
  newSupplier(store);
  assert.deepEqual(store.feishuNotices, oldNotice);
  const listed = notices.list(store, owner);
  assert.equal(listed.unread, 2);
  assert.equal(listed.rows[0].key, store.localCatalogNotices[0].key);
  assert.throws(() => notices.list(store, staff), status(403));
  assert.equal(notices.read(store, owner, { key: store.localCatalogNotices[0].key }).updated, 1);
  assert.equal(notices.list(store, owner).unread, 1);
  assert.equal(notices.read(store, owner, { all: true }).updated, 1);
  assert.equal(notices.list(store, owner).unread, 0);
  assert.equal(store.catalogAdditionReviews[0].status, "待老板核对");
});

test("hook幂等与原创建资料独立快照，编辑旧商品不重复发新增通知", () => {
  const store = fixture(), supplier = newSupplier(store), row = store.catalogAdditionReviews[0];
  const before = structuredClone(store);
  assert.equal(catalog.recordAddition(store, staff, { kind: "supplier", sourceId: supplier.id, name: supplier.name }), row);
  assert.deepEqual(store, before);
  const detail = { note: "独立测试快照" };
  const productRow = catalog.recordAddition(store, staff, { kind: "product", sourceId: "CABLE", name: "测试数据线", detail });
  detail.note = "不得污染已存原资料";
  assert.equal(productRow.detail.note, "独立测试快照");
  const count = store.catalogAdditionReviews.length;
  erp.saveProduct(store, staff, { skuId: "CABLE", externalCode: "C1", name: "测试数据线", type: "配件", kind: "physical", warehouseId: "wh-b", salePrice: 30, trackSerial: false, aliases: ["更新别名"] });
  assert.equal(store.catalogAdditionReviews.length, count);
});

test("错误核对参数、短意见和不存在事项不改变资料；不新增任何操作权限", () => {
  const store = fixture(); newSupplier(store); const row = store.catalogAdditionReviews[0];
  const before = structuredClone(store), rights = structuredClone(staff.permissions);
  for (const fields of [{ decision: "reject" }, { decision: "needs_fix" }, { note: "好" }, { id: "MISSING" }])
    assert.throws(() => catalog.review(store, owner, { id: row.id, decision: "confirm", note: "核对资料无误", ...fields }));
  assert.deepEqual(store, before);
  assert.deepEqual(staff.permissions, rights);
  const noCreate = { ...staff, permissions: ["sale:create"] };
  assert.throws(() => suppliers.save(store, noCreate, { name: "越权单位" }), status(403));
  assert.throws(() => erp.saveProduct(store, noCreate, { externalCode: "BAD", name: "越权商品", type: "配件", salePrice: 1 }), status(403));
  assert.equal(store.catalogAdditionReviews.length, 1);
});
