process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("./common");
const suppliers = require("./suppliers");
const workbench = require("./workbench");

const owner = { id: "owner", name: "老板", roleCode: "owner", status: "active" };
const clerk = { id: "clerk", name: "店员", roleCode: "warehouse", status: "active", permissions: ["purchase:create"] };

function fixture() {
  return c.initialize({
    users: [owner, clerk],
    products: [{ skuId: "part", name: "测试配件", type: "配件", stockManaged: true, trackSerial: false }],
    inventory: [{ skuId: "part", quantity: 0, costPrice: 0, stockValue: 0, serials: [] }],
  });
}

function order(store) {
  return suppliers.plan(store, clerk, {
    supplier: "测试供货商",
    items: [{ skuId: "part", quantity: 10, costPrice: 100 }],
  });
}

function pay(store, plan, amount, reference) {
  return suppliers.payment(store, owner, {
    supplierId: plan.supplierId, planId: plan.id, amount,
    account: "银行卡", accountOwnerId: owner.id, reference,
  });
}

test("店员订货进入老板待审核，审核不产生现金或库存", () => {
  const store = fixture();
  const plan = order(store);
  assert.equal(plan.paymentReview.status, "pending");
  assert.equal(workbench.summary(store, owner).reviews.procurementPaymentReview, 1);
  assert.equal(store.supplierCash.length, 0);
  assert.equal(store.inventory[0].quantity, 0);
  assert.ok(store.feishuNotices.some((n) => n.key === "supplier-plan:" + plan.id));
  assert.throws(() => suppliers.plan(store, clerk, {
    supplierId: plan.supplierId, paidAmount: 50,
    items: [{ skuId: "part", quantity: 1, costPrice: 100 }],
  }), /老板批准/);
  assert.throws(() => pay(store, plan, 100, "PAY-0"), /尚未获老板批准/);
  assert.throws(() => suppliers.reviewPlanPayment(store, clerk, {
    id: plan.id, decision: "approve", approvedAmount: 300,
  }), /只有老板/);
  suppliers.reviewPlanPayment(store, owner, {
    id: plan.id, decision: "approve", approvedAmount: 300,
  });
  const view = suppliers.planRows(store, owner)[0];
  assert.equal(view.approvedRemaining, 300);
  assert.equal(workbench.summary(store, owner).reviews.procurementPaymentReview, 0);
  assert.equal(store.supplierCash.length, 0);
  assert.equal(store.inventory[0].quantity, 0);
});

test("分次实付不超过累计批准额，暂缓后禁止新付款并保留痕迹", () => {
  const store = fixture();
  const plan = order(store);
  suppliers.reviewPlanPayment(store, owner, {
    id: plan.id, decision: "approve", approvedAmount: 300,
  });
  pay(store, plan, 200, "PAY-1");
  assert.equal(suppliers.planRows(store, owner)[0].approvedRemaining, 100);
  assert.throws(() => pay(store, plan, 101, "PAY-2"), /超过老板批准额度/);
  assert.equal(store.supplierCash.length, 1);
  assert.throws(() => suppliers.reviewPlanPayment(store, owner, {
    id: plan.id, decision: "approve", approvedAmount: 199,
  }), /不能低于已付/);
  assert.throws(() => suppliers.reviewPlanPayment(store, owner, {
    id: plan.id, decision: "defer",
  }), /暂缓原因/);
  suppliers.reviewPlanPayment(store, owner, {
    id: plan.id, decision: "defer", reason: "等待供应商确认发货",
  });
  assert.throws(() => pay(store, plan, 100, "PAY-3"), /尚未获老板批准/);
  suppliers.reviewPlanPayment(store, owner, {
    id: plan.id, decision: "approve", approvedAmount: 300,
  });
  pay(store, plan, 100, "PAY-4");
  assert.equal(suppliers.planRows(store, owner)[0].approvedRemaining, 0);
  assert.equal(store.supplierCash.length, 2);
  assert.equal(store.inventory[0].quantity, 0);
  assert.ok(plan.events.some((e) => e.type === "老板暂缓付款"));
  assert.ok(plan.events.some((e) => e.type === "关联付款"));
});