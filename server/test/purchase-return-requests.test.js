const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("../src/common");
const costs = require("../src/supplier-costs");
const requests = require("../src/purchase-return-requests");

const owner = { id: "B", name: "老板", roleCode: "owner", status: "active" };
const staff = { id: "W", name: "营业员", roleCode: "employee", status: "active", permissions: ["purchase:create"] };
const other = { ...staff, id: "W2", name: "另一营业员" };
const delegated = { id: "D", name: "授权营业员", roleCode: "employee", status: "active", permissions: ["purchase:create", "supplier:adjust", "red:review", "sale:return"], capabilityOverrides: { supplierAdjust: true, redReview: true, returnSale: true } };
const manager = { id: "M", name: "店长", roleCode: "manager", status: "active" };
const noPurchase = { id: "N", name: "未授权", roleCode: "employee", status: "active", permissions: ["supplier:adjust"] };
const first = "860000000001234", second = "860000000009999";
function fixture() {
  return c.initialize({
    users: structuredClone([owner, staff, other, delegated, manager, noPurchase]),
    supplierModelVersion: 2,
    suppliers: [{ id: "S", name: "甲供货商" }],
    products: [
      { skuId: "phone", name: "测试手机", type: "智能机", stockManaged: true, trackSerial: true, warehouseId: "wh-sale" },
      { skuId: "cable", name: "测试数据线", type: "配件", stockManaged: true, trackSerial: false, warehouseId: "wh-sale" },
    ],
    inventory: [
      { skuId: "phone", warehouseId: "wh-sale", quantity: 2, stockValue: 2000, costPrice: 1000, serials: [
        { no: first, status: "可售", purchaseId: "PO", purchaseItemId: "PI", costPrice: 1000 },
        { no: second, status: "未激活", purchaseId: "PO", purchaseItemId: "PI", costPrice: 1000 },
      ] },
      { skuId: "cable", warehouseId: "wh-sale", quantity: 3, stockValue: 30, costPrice: 10, serials: [], costSources: [{ sourceId: "PI-C", quantity: 3 }] },
    ],
    purchases: [
      { id: "PO", supplierId: "S", supplier: "甲供货商", supplierEntryId: "SE", amount: 2000, items: [{ id: "PI", skuId: "phone", name: "测试手机", quantity: 2, costPrice: 1000, serials: [first, second] }] },
      { id: "PO-C", supplierId: "S", supplier: "甲供货商", supplierEntryId: "SE-C", amount: 30, items: [{ id: "PI-C", skuId: "cable", name: "测试数据线", quantity: 3, costPrice: 10, serials: [] }] },
    ],
    supplierEntries: [{ id: "SE", supplierId: "S", kind: "payable", cents: 200000 }, { id: "SE-C", supplierId: "S", kind: "payable", cents: 3000 }],
  });
}
function payload(overrides = {}) {
  return { supplierId: "S", purchaseId: "PO", itemId: "PI", quantity: 1, unitPrice: 800, kind: "cash", reference: "RET-1", note: "供应商同意按实物退回本台手机", serialNos: [first], confirmed: true, ...overrides };
}
function business(store) {
  const snapshot = structuredClone(store);
  delete snapshot.purchaseReturnRequests;
  delete snapshot.operationLogs;
  return snapshot;
}
const status = code => error => error.statusCode === code;
const approve = (store, row, extra = {}) => requests.review(store, owner, { id: row.id, decision: "approve", note: "本人核对后同意退货", ...extra });

test("仅采购权限可预览和申请：无库存、往来、资金变化，申请字段不能冒充批准", () => {
  const store = fixture(), before = business(store), input = payload({ status: "已批准", requesterId: owner.id, resultId: "FAKE" });
  const preview = costs.previewReturn(store, staff, input);
  assert.equal(preview.amount, 800);
  assert.deepEqual(business(store), before);
  assert.equal(costs.candidates(store, staff, "S").length, 2);
  const row = requests.request(store, staff, input);
  assert.equal(row.status, "待老板审核");
  assert.equal(row.kind, "purchase_return");
  assert.equal(row.requesterId, staff.id);
  assert.equal(row.supplier, "甲供货商");
  assert.equal(row.payload.status, undefined);
  assert.equal(row.payload.requesterId, undefined);
  input.serialNos.push(second);
  assert.deepEqual(row.payload.serialNos, [first]);
  assert.deepEqual(business(store), before);
});

test("旧执行函数无权限旁路：店长、授权补差/红冲人及第四参数均不能直接退货", () => {
  for (const user of [staff, delegated, manager, noPurchase, { ...owner, assistantCustomerOnly: true }]) {
    const store = fixture(), before = structuredClone(store);
    for (const previewOnly of [false, true]) assert.throws(() => costs.returnPurchase(store, user, payload(), previewOnly), status(403));
    assert.deepEqual(store, before);
  }
});

test("仅老板本人可审核，独立的补差/红冲/退货授权不能代审", () => {
  const store = fixture(), row = requests.request(store, staff, payload()), before = structuredClone(store);
  for (const user of [staff, delegated, manager, { ...owner, assistantCustomerOnly: true }])
    for (const decision of ["approve", "reject"])
      assert.throws(() => requests.review(store, user, { id: row.id, decision, note: "尝试越权审核" }), status(403));
  assert.deepEqual(store, before);
});

test("老板批准才一次执行：准确串号、原成本出库、往来应退款，不虚记现金", () => {
  const store = fixture(), row = requests.request(store, staff, payload());
  const result = approve(store, row, { quantity: 2, unitPrice: 1, serialNos: [second], payload: payload({ unitPrice: 1 }) });
  assert.equal(result.status, "已批准");
  assert.equal(store.inventory[0].quantity, 1);
  assert.equal(store.inventory[0].stockValue, 1000);
  assert.equal(store.inventory[0].serials[0].status, "已退供应商");
  assert.equal(store.inventory[0].serials[1].status, "未激活");
  assert.equal(store.purchaseReturns.length, 1);
  assert.equal(store.purchaseReturns[0].amount, 800);
  assert.equal(store.purchaseReturns[0].cost, 1000);
  assert.equal(store.purchaseReturns[0].operatorId, owner.id);
  assert.equal(store.purchaseReturns[0].requestId, row.id);
  assert.equal(store.purchaseReturns[0].requesterId, staff.id);
  assert.equal(row.reviewerId, owner.id);
  assert.equal(row.resultId, store.purchaseReturns[0].id);
  assert.equal(store.supplierEntries.length, 3);
  assert.equal(store.supplierEntries[2].kind, "cash");
  assert.equal(store.supplierEntries[2].cents, 80000);
  assert.equal(store.receipts.length, 0);
  assert.equal(store.supplierCash.length, 0);
  const after = structuredClone(store);
  assert.throws(() => approve(store, row), status(409));
  assert.throws(() => requests.review(store, owner, { id: row.id, decision: "reject", note: "再尝试重复审核" }), status(409));
  assert.deepEqual(store, after);
});

test("驳回不执行业务且保留审核记录；原申请可重新提交", () => {
  const store = fixture(), row = requests.request(store, staff, payload()), before = business(store);
  requests.review(store, owner, { id: row.id, decision: "reject", note: "供应商约定需要重新确认" });
  assert.equal(row.status, "已驳回");
  assert.equal(row.reviewerId, owner.id);
  assert.deepEqual(business(store), before);
  assert.equal(requests.request(store, staff, payload()).status, "待老板审核");
});

test("员工只查看本人申请，老板查看全部；无采购权限不得申请/查看", () => {
  const store = fixture(), mine = requests.request(store, staff, payload());
  const theirs = requests.request(store, other, payload({ purchaseId: "PO-C", itemId: "PI-C", quantity: 1, unitPrice: 8, serialNos: [], reference: "RET-C" }));
  assert.deepEqual(requests.list(store, staff).map(row => row.id), [mine.id]);
  assert.deepEqual(requests.list(store, other).map(row => row.id), [theirs.id]);
  assert.equal(requests.list(store, manager).length, 0);
  assert.equal(requests.list(store, owner).length, 2);
  assert.throws(() => requests.list(store, noPurchase), status(403));
  assert.throws(() => requests.request(store, noPurchase, payload()), status(403));
});

test("待审同原明细或供应商确认编号防重复，错误资料不创建申请或改变业务", () => {
  const cases = [
    { confirmed: false }, { quantity: 0 }, { quantity: 3 }, { unitPrice: 0 }, { unitPrice: -1 },
    { serialNos: [] }, { serialNos: [first, first], quantity: 2 }, { serialNos: ["WRONG"] },
    { supplierId: "OTHER" }, { purchaseId: "MISSING" }, { itemId: "MISSING" }, { kind: "payable" }, { note: "" },
  ];
  for (const fields of cases) {
    const store = fixture(), before = structuredClone(store);
    assert.throws(() => requests.request(store, staff, payload(fields)));
    assert.deepEqual(store, before);
  }
  const store = fixture();
  requests.request(store, staff, payload());
  const before = structuredClone(store);
  assert.throws(() => requests.request(store, other, payload({ reference: "RET-2", serialNos: [second] })), status(409));
  assert.throws(() => requests.request(store, other, payload({ purchaseId: "PO-C", itemId: "PI-C", quantity: 1, unitPrice: 8, serialNos: [] })), status(409));
  assert.deepEqual(store, before);
});

test("审批时重验：所选手机已售不可退，未审申请和业务保持原状", () => {
  const store = fixture(), row = requests.request(store, staff, payload());
  store.inventory[0].serials[0].status = "已售";
  store.inventory[0].quantity = 1;
  store.inventory[0].stockValue = 1000;
  const before = structuredClone(store);
  assert.throws(() => approve(store, row), status(409));
  assert.deepEqual(store, before);
  assert.equal(row.status, "待老板审核");
});

test("审批时成本变化不可悄悄接受；老板仍可驳回过时申请", () => {
  const store = fixture(), row = requests.request(store, staff, payload());
  store.inventory[0].serials[0].costPrice = 900;
  store.inventory[0].stockValue = 1900;
  store.inventory[0].costPrice = 950;
  const before = structuredClone(store);
  assert.throws(() => approve(store, row), /已有变化/);
  assert.deepEqual(store, before);
  store.inventory = [];
  const businessBefore = business(store);
  requests.review(store, owner, { id: row.id, decision: "reject", note: "库存变化重新申请" });
  assert.equal(row.status, "已驳回");
  assert.deepEqual(business(store), businessBefore);
});

test("配件采购退货按原成本与来源执行，抵货款留账，不物理删原入库", () => {
  const store = fixture(), purchasesBefore = structuredClone(store.purchases);
  const row = requests.request(store, staff, payload({ purchaseId: "PO-C", itemId: "PI-C", quantity: 2, unitPrice: 8, serialNos: [], reference: "RET-C", kind: "credit" }));
  assert.equal(store.inventory[1].quantity, 3);
  approve(store, row);
  assert.equal(row.amount, 16);
  assert.equal(store.inventory[1].quantity, 1);
  assert.equal(store.inventory[1].stockValue, 10);
  assert.equal(store.purchaseReturns[0].cost, 20);
  assert.deepEqual(store.purchaseReturns[0].costSources, [{ sourceId: "PI-C", quantity: 2 }]);
  assert.equal(store.supplierEntries.at(-1).kind, "credit");
  assert.deepEqual(store.purchases, purchasesBefore);
});

test("历史采购迁移只在预览克隆执行，员工申请不补写业务原账", () => {
  const store = fixture();
  delete store.supplierModelVersion;
  delete store.purchases[0].supplierEntryId;
  delete store.purchases[1].supplierEntryId;
  store.supplierEntries = [];
  const before = business(store);
  requests.request(store, staff, payload());
  assert.deepEqual(business(store), before);
  assert.equal(store.supplierEntries.length, 0);
});

test("老板原内部退货函数仍须正确预览令牌且按旧结果执行", () => {
  const store = fixture(), input = payload(), before = structuredClone(store);
  assert.throws(() => costs.returnPurchase(store, owner, { ...input, previewToken: "WRONG" }), status(409));
  assert.deepEqual(store, before);
  const preview = costs.previewReturn(store, owner, input);
  const result = costs.returnPurchase(store, owner, { ...input, previewToken: preview.previewToken });
  assert.equal(result.amount, 800);
  assert.equal(store.inventory[0].quantity, 1);
});

test("无效审核结果、短意见和未知申请不改变业务或申请", () => {
  const store = fixture(), row = requests.request(store, staff, payload()), before = structuredClone(store);
  for (const fields of [{ decision: "anything" }, { note: "是" }, { id: "MISSING" }])
    assert.throws(() => approve(store, row, fields));
  assert.deepEqual(store, before);
});

test("采购退货底层须核对当前有效老板，停用、失效角色和伪造老板对象均拒绝", () => {
  const cases = [
    store => ({ ...owner, status: "inactive" }),
    store => ({ ...owner, id: "not-registered" }),
    store => { store.users[0].status = "inactive"; return owner; },
    store => { store.users[0].roleCode = "employee"; store.users[0].capabilityOverrides = { manageUsers: true }; return owner; },
    store => { store.users[0].assistantCustomerOnly = true; return owner; },
  ];
  for (const actor of cases) {
    const store = fixture(), row = requests.request(store, staff, payload());
    const quote = costs.previewReturn(store, owner, payload()), user = actor(store), before = structuredClone(store);
    assert.throws(() => requests.review(store, user, { id: row.id, decision: "approve", note: "核对实物申请同意退货" }), status(403));
    assert.throws(() => requests.review(store, user, { id: row.id, decision: "reject", note: "核对后驳回本申请" }), status(403));
    assert.throws(() => costs.returnPurchase(store, user, { ...payload(), previewToken: quote.previewToken }), status(403));
    assert.deepEqual(store, before);
  }
});

test("原采购营业日或当日锁定时批准及旧底层调用均拒绝，仍可预览和驳回", () => {
  for (const lockedDate of [c.day(), "2026-10-08"]) {
    const store = fixture();store.purchases[0].date = "2026-10-08";
    const row = requests.request(store, staff, payload());
    store.dailyCloseouts.push({ date: lockedDate, status: "已锁定" });
    const quote = costs.previewReturn(store, owner, payload()), before = structuredClone(store);
    assert.throws(() => approve(store, row), error => error.statusCode === 409 && /营业日已锁定/.test(error.message));
    assert.throws(() => costs.returnPurchase(store, owner, { ...payload(), previewToken: quote.previewToken }), error => error.statusCode === 409 && /营业日已锁定/.test(error.message));
    assert.deepEqual(store, before);
    const original = business(store);
    requests.review(store, owner, { id: row.id, decision: "reject", note: "锁定日先核实后重新申请" });
    assert.equal(row.status, "已驳回");assert.deepEqual(business(store), original);
  }
  const store = fixture();store.dailyCloseouts.push({ date: c.day(), status: "待老板签认" });
  const row = requests.request(store, staff, payload());assert.equal(approve(store, row).status, "已批准");
});