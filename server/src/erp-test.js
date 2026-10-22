process.env.NODE_ENV = "test";
process.env.STORE_DB_PATH = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("./common");
const erp = require("./erp");
// General sale fixtures represent verified cash receipts; payment-state tests use erp.sale directly.
const saleFixture = (store,user,payload) => {
  const result=erp.sale(store,user,{account:"现金",cashDrawerConfirmed:true,...payload});
  const order=store.sales.find(row=>row.id===result.id);
  if(order.paymentReview.status==='待老板核对'&&order.paymentReview.cashDrawerConfirmed)
    require('./sale-payments').confirm(store,store.users.find(row=>row.roleCode==='owner'&&row.status==='active'),{orderId:order.id,actualAmount:order.paymentReview.amount});
  return result;
};
const pay = require("./payroll");
const repository = require("./repository");
const { createServer } = require("./application");
function fixture() {
  const base = JSON.parse(JSON.stringify(require("../data/store.json")));
  // The bundled demo ledger uses demo-* user IDs; these tests need stable actors.
  base.users = [
    { id: "u1", name: "测试老板", role: "老板", roleCode: "owner", status: "active", permissions: ["opening_balance:import"] },
    { id: "u2", name: "测试员工甲", role: "店员", roleCode: "employee", status: "active", permissions: ["sale:create", "sale:return"] },
    { id: "u3", name: "测试员工乙", role: "店员", roleCode: "employee", status: "active", permissions: ["sale:create", "sale:return"] },
    { id: "u5", name: "测试仓管", role: "仓管", roleCode: "warehouse", status: "active", permissions: ["purchase:create", "stock:adjust"] },
  ];
  base.users.push({
    id: "manager-test",
    name: "测试店长",
    role: "店长",
    roleCode: "manager",
    status: "active",
    permissions: [],
  });
  Object.assign(base, {
    products: [
      {
        skuId: "phone",
        externalCode: "P1",
        name: "测试手机",
        type: "智能手机",
        stockManaged: true,
        trackSerial: true,
        costPrice: 100,
        salePrice: 200,
        unit: "台",
      },
      {
        skuId: "cable",
        externalCode: "C1",
        name: "数据线",
        type: "配件",
        stockManaged: true,
        costPrice: 10,
        salePrice: 30,
        unit: "条",
      },
      {
        skuId: "screen",
        externalCode: "M1",
        name: "屏幕材料",
        type: "维修",
        stockManaged: true,
        costPrice: 185,
        salePrice: 300,
        unit: "块",
      },
      {
        skuId: "repair",
        externalCode: "R1",
        name: "更换屏幕",
        type: "维修",
        stockManaged: false,
        costPrice: 999,
        salePrice: 380,
        unit: "项",
      },
      {
        skuId: "card",
        externalCode: "K1",
        name: "套餐号卡",
        type: "号卡",
        stockManaged: true,
        costPrice: 1,
        salePrice: 50,
        unit: "张",
      },
    ],
    inventory: [
      {
        skuId: "phone",
        quantity: 1,
        costPrice: 100,
        serials: [{ no: "IMEI-1", status: "可售", costPrice: 100 }],
      },
      { skuId: "cable", quantity: 10, costPrice: 10, serials: [] },
      { skuId: "screen", quantity: 3, costPrice: 185, serials: [] },
      { skuId: "card", quantity: 2, costPrice: 1, serials: [] },
    ],
    sales: [],
    purchases: [],
    receipts: [],
    saleReturns: [],
    movements: [],
    expenses: [],
    commissionRules: [],
    salaryRates: [],
    commissionEntries: [],
    payrollStatements: [],
    cardBusinesses: [],
    cardEvents: [],
    requestRecords: [],
  });
  return c.initialize(base);
}
function actors(s) {
  return ["u1", "u2", "u5", "manager-test"].map((id) => c.userById(s, id));
}

test("期初预览不写库存，禁止无效数字、未映射地点及有业务后重建", () => {
  const s = fixture();
  const [owner] = actors(s);
  const row = {
    externalCode: "OPEN1",
    name: "期初商品",
    type: "配件",
    quantity: 3,
    costPrice: 5,
    salePrice: 10,
  };
  const original = JSON.stringify(s);
  assert.equal(erp.openingPreview(s, owner, [row]).totalQuantity, 3);
  assert.equal(JSON.stringify(s), original);
  for (const invalid of [
    { quantity: " " },
    { quantity: 1.5 },
    { costPrice: Infinity },
    { salePrice: -1 },
    { warehouseName: "未映射地点" },
    { warehouseName: "服务项目" },
  ]) {
    assert.throws(() => erp.openingPreview(s, owner, [{ ...row, ...invalid }]));
  }
  assert.throws(
    () => erp.openingPreview(s, owner, [{ ...row, trackSerial: true }]),
    /串码/,
  );
  assert.equal(
    erp.openingPreview(s, owner, [{ ...row, trackSerial: true, quantity: 0 }])
      .totalQuantity,
    0,
  );
  erp.expense(s, owner, { type: "门店费用", amount: 10 });
  assert.equal(erp.openingLocked(s), true);
  assert.throws(
    () => erp.openingCommit(s, owner, { rows: [row], confirmed: true }),
    /业务单据/,
  );
});
test("按件、毛利、实际耗材成本、归属人和规则快照", () => {
  const s = fixture();
  const [owner, employee, , manager] = actors(s);
  pay.saveRule(s, manager, { skuId: "phone", mode: "piece", value: 30 });
  pay.saveRule(s, manager, { skuId: "repair", mode: "profit", value: 20 });
  const order = saleFixture(s, owner, {
    salespersonId: employee.id,
    items: [
      {
        skuId: "phone",
        quantity: 1,
        salePrice: 200,
        serialNo: "IMEI-1",
        costPrice: 0,
      },
      {
        skuId: "repair",
        quantity: 1,
        salePrice: 380,
        materials: [{ skuId: "screen", quantity: 1 }],
      },
    ],
  });
  assert.equal(order.profit, 295);
  assert.equal(s.commissionEntries[0].amount, 30);
  assert.equal(s.commissionEntries[1].amount, 39);
  assert.equal(s.inventory.find((i) => i.skuId === "screen").quantity, 2);
  assert.equal(s.commissionEntries[0].employeeId, employee.id);
  pay.saveRule(s, owner, { skuId: "phone", mode: "piece", value: 99 });
  assert.equal(s.commissionEntries[0].amount, 30);
});
test("采购实际进价进入库存均价，销售不接受客户端成本", () => {
  const s = fixture();
  const [owner, employee, warehouse] = actors(s);
  erp.purchase(s, warehouse, {
    supplier: "测试渠道",
    items: [{ skuId: "cable", quantity: 10, costPrice: 20 }],
  });
  const order = saleFixture(s, employee, {
    items: [{ skuId: "cable", quantity: 1, salePrice: 30, costPrice: 1 }],
  });
  assert.equal(s.sales[0].items[0].costPrice, 15);
  assert.equal(order.profit, undefined);
  assert.equal(erp.orders(s, employee)[0].items[0].costPrice, undefined);
  assert.equal(
    erp.inventory(s, employee).find((x) => x.skuId === "phone").serials[0]
      .costPrice,
    undefined,
  );
  assert.throws(() => erp.purchase(s, employee, {}), /权限/);
  assert.throws(() => saleFixture(s, warehouse, {}), /权限/);
  assert.ok(
    erp.inventory(s, owner).find((x) => x.skuId === "cable").costPrice > 0,
  );
});
test("跨月部分退货保留原规则，已确认工资锁定，所有店长可维护底薪", () => {
  const s = fixture();
  const [owner, employee, , manager] = actors(s);
  pay.saveRule(s, manager, { skuId: "cable", mode: "piece", value: 0.03 });
  saleFixture(s, employee, {
    items: [{ skuId: "cable", quantity: 3, salePrice: 30 }],
  });
  const order = s.sales[0];
  const entry = s.commissionEntries[0];
  const previous = "2025-09";
  entry.month = previous;
  pay.saveSalary(s, manager, {
    employeeId: employee.id,
    effectiveMonth: previous,
    amount: 3000,
  });
  const statement = pay.confirm(s, owner, {
    employeeId: employee.id,
    month: previous,
  });
  assert.equal(statement.total, 3000.09);
  assert.throws(
    () =>
      pay.saveSalary(s, manager, {
        employeeId: employee.id,
        effectiveMonth: previous,
        amount: 5000,
      }),
    /已确认/,
  );
  for (let i = 0; i < 3; i++)
    erp.returnSale(s, owner, {
      orderId: order.id,
      reason: "退货",
      items: [{ itemId: order.items[0].id, quantity: 1 }],
    });
  assert.equal(
    c.round(
      s.commissionEntries
        .filter((e) => e.kind === "return")
        .reduce((n, e) => n + e.amount, 0),
    ),
    -0.09,
  );
  assert.ok(
    s.commissionEntries
      .filter((e) => e.kind === "return")
      .every((e) => e.month === c.month()),
  );
  assert.equal(
    pay.getPayroll(s, owner, previous, employee.id).rows[0].total,
    3000.09,
  );
  assert.throws(
    () =>
      erp.returnSale(s, owner, {
        orderId: order.id,
        reason: "重复",
        items: [{ itemId: order.items[0].id, quantity: 1 }],
      }),
    /超过/,
  );
  assert.throws(() => pay.getPayroll(s, employee, previous, "u3"), /本人/);
});
test("未设底薪和规则不冒充零工资，补录同时解决关联退货", () => {
  const s = fixture();
  const [owner, employee] = actors(s);
  saleFixture(s, employee, {
    items: [{ skuId: "cable", quantity: 2, salePrice: 30 }],
  });
  const order = s.sales[0];
  erp.returnSale(s, owner, {
    orderId: order.id,
    reason: "退一条",
    items: [{ itemId: order.items[0].id, quantity: 1 }],
  });
  assert.equal(pay.getPayroll(s, employee, c.month()).rows[0].total, null);
  pay.resolveEntry(s, owner, s.commissionEntries[0].id, {
    mode: "piece",
    value: 5,
  });
  pay.saveSalary(s, owner, {
    employeeId: employee.id,
    effectiveMonth: c.month(),
    amount: 3000,
  });
  assert.equal(pay.getPayroll(s, employee, c.month()).rows[0].total, 3005);
});
test("号卡预计、确认、分次到账和扣回与销售分离", () => {
  const s = fixture();
  const [owner, employee] = actors(s);
  saleFixture(s, employee, {
    items: [
      { skuId: "card", quantity: 1, salePrice: 50, card: { expected: 100 } },
    ],
  });
  const business = s.cardBusinesses[0];
  erp.cardEvent(s, owner, {
    businessId: business.id,
    type: "confirm",
    amount: 100,
  });
  erp.cardEvent(s, owner, {
    businessId: business.id,
    type: "receive",
    amount: 40,
  });
  erp.cardEvent(s, owner, {
    businessId: business.id,
    type: "receive",
    amount: 60,
  });
  erp.cardEvent(s, owner, {
    businessId: business.id,
    type: "clawback",
    amount: 20,
  });
  assert.equal(s.sales.length, 1);
  assert.equal(business.received, 80);
  const report = erp.report(s, owner);
  assert.equal(report.summary.salesAmount, 50);
  assert.equal(report.summary.receivedAmount, 50);
  assert.equal(report.summary.carrierReceived, 80);
});
test("HTTP身份隔离、幂等、并发最后一台、事务失败回滚", async () => {
  repository.resetStore(fixture());
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  async function request(path, data, token, key) {
    const res = await fetch(base + path, {
      method: data ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: res.status, body: await res.json() };
  }
  try {
    assert.equal((await request("/api/payroll")).status, 401);
    const token = (await request("/api/auth/login", { userId: "u2" })).body
      .token;
    const token2 = (await request("/api/auth/login", { userId: "u3" })).body
      .token;
    assert.equal(
      (await request("/api/payroll?employeeId=u3&userId=u1", null, token))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/payroll/rules",
          { operatorId: "u1", skuId: "phone", mode: "piece", value: 30 },
          token,
          "forged",
        )
      ).status,
      403,
    );
    const payload = {
      items: [
        { skuId: "phone", quantity: 1, salePrice: 200, serialNo: "IMEI-1" },
      ],
    };
    const results = await Promise.all([
      request("/api/sale-orders", payload, token, "race-a"),
      request("/api/sale-orders", payload, token2, "race-b"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const winner =
      results[0].status === 200 ? [token, "race-a"] : [token2, "race-b"];
    const replay = await request("/api/sale-orders", payload, ...winner);
    assert.equal(replay.status, 200);
    assert.equal(repository.readStore().sales.length, 1);
    const before = repository
      .readStore()
      .inventory.find((i) => i.skuId === "cable").quantity;
    const bad = await request(
      "/api/sale-orders",
      {
        items: [
          { skuId: "cable", quantity: 1, salePrice: 10 },
          { skuId: "phone", quantity: 1, salePrice: 200, serialNo: "IMEI-1" },
        ],
      },
      token,
      "rollback",
    );
    assert.equal(bad.status, 409);
    assert.equal(
      repository.readStore().inventory.find((i) => i.skuId === "cable")
        .quantity,
      before,
    );
    const ownerToken=(await request("/api/auth/login",{userId:"u1"})).body.token;
    const queue=await request("/api/sale-payments",null,ownerToken);
    assert.equal(queue.status,200);
    assert.equal(queue.body.length,1);
    assert.equal(queue.body[0].paymentReview.status,"待收款人确认");
    const assign=await request("/api/sale-payments/assign",{orderId:queue.body[0].orderId,accountOwnerId:"u1"},ownerToken,"payment-assign");
    assert.equal(assign.status,200);
    const confirmed=await request("/api/sale-payments/confirm",{orderId:queue.body[0].orderId,actualAmount:200,reference:"TEST-WX-001"},ownerToken,"payment-confirm");
    assert.equal(confirmed.status,200);
    assert.equal(repository.readStore().receipts.filter((row)=>row.kind==="sale").length,1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("分次退货成本不丢分币，员工日报包含本人退款", () => {
  const s = fixture();
  const [owner, employee] = actors(s);
  const stock = s.inventory.find((i) => i.skuId === "cable");
  stock.quantity = 3;
  stock.costPrice = 13.333333;
  saleFixture(s, employee, {
    items: [{ skuId: "cable", quantity: 3, salePrice: 30 }],
  });
  const order = s.sales[0];
  for (let i = 0; i < 3; i++)
    erp.returnSale(s, owner, {
      orderId: order.id,
      reason: "分次退款",
      items: [{ itemId: order.items[0].id, quantity: 1 }],
    });
  assert.equal(stock.stockValue, 40);
  assert.equal(
    c.round(s.saleReturns.reduce((sum, row) => sum + row.items[0].cost, 0)),
    order.items[0].cost,
  );
  assert.equal(erp.report(s, employee).summary.refundAmount, 90);
  assert.equal(erp.report(s, owner).summary.grossProfit, 0);
});

test("工资发放只记一次，店长无权查看全员工资、员工无权改规则", () => {
  const s = fixture();
  const [owner, employee, warehouse, manager] = actors(s);
  pay.saveSalary(s, manager, {
    employeeId: warehouse.id,
    effectiveMonth: "2025-09",
    amount: 2800,
  });
  const row = pay.confirm(s, owner, {
    employeeId: warehouse.id,
    month: "2025-09",
  });
  assert.equal(row.total, 2800);
  pay.markPaid(s, owner, { statementId: row.id, account: "银行卡" });
  pay.markPaid(s, owner, { statementId: row.id, account: "银行卡" });
  assert.equal(s.receipts.filter((r) => r.kind === "payroll").length, 1);
  assert.throws(
    () => pay.getPayroll(s, manager, "2025-09", warehouse.id),
    /本人/,
  );
  assert.throws(
    () =>
      pay.saveRule(s, employee, { skuId: "cable", mode: "piece", value: 10 }),
    /权限/,
  );
  assert.throws(
    () =>
      pay.confirm(s, manager, { employeeId: warehouse.id, month: "2025-08" }),
    /权限/,
  );
  assert.throws(
    () =>
      pay.saveRule(s, owner, { skuId: "cable", mode: "profit", value: 101 }),
    /100/,
  );
  for (const bad of [" ", [], {}, true, "Infinity", -1])
    assert.throws(() => c.money(bad));
});

test("接待单转销售单自动带入顾客并固定记录实际开单人", () => {
  const s = fixture();
  const employee = c.userById(s, "u2");
  const reception = require("./receptions").create(s, employee, {
    phone: "13800138000",
    name: "测试顾客",
    purpose: "了解数据线",
  });
  assert.throws(() => saleFixture(s, employee, {
    receptionId: reception.id,
    customerPhone: "13900139000",
    account: "现金",
    items: [{ skuId: "cable", quantity: 1, salePrice: 30 }],
  }), /与接待单不一致/);
  assert.equal(s.sales.length, 0);
  const order = saleFixture(s, employee, {
    receptionId: reception.id,
    account: "现金",
    items: [{ skuId: "cable", quantity: 1, salePrice: 30 }],
  });
  assert.equal(order.operatorId, employee.id);
  assert.equal(order.salespersonId, employee.id);
  assert.equal(order.customerName, "测试顾客");
  assert.equal(order.customerMask, "138****8000");
  assert.equal(order.receptionId, reception.id);
  assert.equal(reception.links[0].id, order.id);
});
test("随单赠品和后补赠品扣库、受累计毛利及单件成本限额约束", () => {
  const s = fixture();
  const [owner, employee] = actors(s);
  const order = saleFixture(s, employee, {
    items: [{skuId:"phone",quantity:1,salePrice:200,serialNo:"IMEI-1"}],
    gifts: [{skuId:"cable",quantity:1}],
    giftReason:"随单赠送数据线",
  });
  assert.equal(order.amount, 200);
  assert.equal(order.giftCost, 10);
  assert.equal(order.giftOrders[0].cost, 10);
  assert.equal(s.sales[0].giftCost, 10);
  assert.equal(s.inventory.find((row)=>row.skuId==="cable").quantity, 9);
  const extra = erp.supplementGift(s, employee, {
    orderId:order.id,items:[{skuId:"cable",quantity:1}],reason:"顾客后补领取",
  });
  assert.equal(extra.kind, "补赠");
  assert.equal(s.sales[0].giftCost, 20);
  assert.equal(erp.orders(s, owner)[0].netProfit, 80);
  assert.equal(erp.report(s, owner).summary.giftCost, 20);
  assert.equal(erp.report(s, owner).summary.grossProfit, 80);
  assert.ok(s.movements.some((row)=>row.sourceId===extra.id&&row.type==="赠品出库"));
  const found = require("./search").search(s, owner, new URLSearchParams({q:extra.id,scope:"all"}));
  assert.equal(found.results.sales[0].id, order.id);
  assert.equal(found.trace[0].gifts.length, 2);
  const closing = require("./daily-close").snapshot(s, c.day());
  assert.equal(closing.giftCost, 20);
  assert.equal(closing.grossProfit, 80);
  assert.ok(closing.transactions.some((row)=>row.giftId===extra.id&&row.cost===10));
  assert.throws(()=>erp.supplementGift(fixture(), employee, {orderId:order.id,items:[{skuId:"cable",quantity:1}],reason:"再次赠送"}), /不存在/);
  assert.throws(()=>erp.supplementGift(s, c.userById(s,"u3"), {orderId:order.id,items:[{skuId:"cable",quantity:1}],reason:"代领"}), /只能为本人销售单/);
  const cap = fixture();
  const overCap = saleFixture(cap, employee, {
    items:[{skuId:"phone",quantity:1,salePrice:200,serialNo:"IMEI-1"}],
    gifts:[{skuId:"cable",quantity:3}],
  });
  assert.equal(overCap.giftCost, 0);
  assert.equal(cap.giftApprovals[0].status, "待审批");
  assert.equal(cap.inventory.find((row)=>row.skuId==="cable").quantity, 10);
  const unit = fixture();
  const overUnit = saleFixture(unit, employee, {
    items:[{skuId:"phone",quantity:1,salePrice:200,serialNo:"IMEI-1"}],
    gifts:[{skuId:"screen",quantity:1}],
  });
  assert.equal(overUnit.giftCost, 0);
  assert.match(unit.giftApprovals[0].limitReasons.join("；"), /单件成本/);
  assert.deepEqual(erp.saveGiftRules(s, owner, {maxProfitPercent:15,maxUnitCost:25}), {maxProfitPercent:15,maxUnitCost:25});
});


test("赠品实际成本抵减毛利提成，后补赠品继续调整且不重复入账", () => {
  const s=fixture();
  const [owner,employee]=actors(s);
  pay.saveRule(s,owner,{skuId:"phone",mode:"profit",value:10});
  const order=saleFixture(s,employee,{
    items:[{skuId:"phone",quantity:1,salePrice:200,serialNo:"IMEI-1"}],
    gifts:[{skuId:"cable",quantity:1}],
  });
  const first=s.commissionEntries.filter((entry)=>entry.orderId===order.id);
  assert.equal(first.find((entry)=>entry.kind==="sale").amount,10);
  assert.equal(first.find((entry)=>entry.kind==="gift").amount,-1);
  const extra=erp.supplementGift(s,employee,{orderId:order.id,items:[{skuId:"cable",quantity:1}],reason:"后补"});
  assert.equal(s.commissionEntries.filter((entry)=>entry.kind==="gift"&&entry.giftId===extra.id).length,1);
  assert.equal(s.commissionEntries.filter((entry)=>entry.orderId===order.id).reduce((sum,entry)=>sum+Number(entry.amount||0),0),8);
});


test("销售开单不等扫码款确认，只有账户本人能确认到账", () => {
  const s=fixture(),[owner,employee,,manager]=actors(s);
  const payment=require('./sale-payments');
  const viewOnly=c.userById(s,'u3'); viewOnly.permissions.push('finance:view');
  const unassigned=erp.sale(s,employee,{account:'微信',accountOwnerId:viewOnly.id,items:[{skuId:'cable',quantity:1,salePrice:30}]});
  assert.equal(unassigned.paymentReview.accountOwnerUnspecified,true);
  assert.equal(unassigned.paymentReview.recipientId,owner.id);
  const order=erp.sale(s,employee,{account:'微信',accountOwnerId:owner.id,items:[{skuId:'cable',quantity:1,salePrice:30}]});
  assert.equal(order.paymentReview.status,'待收款人确认');
  assert.equal(order.receivedAmount,0);
  assert.equal(s.receipts.filter(x=>x.kind==='sale').length,0);
  assert.throws(()=>payment.confirm(s,manager,{orderId:order.id,actualAmount:30,reference:'WX-1'}),/必须由实际收款/);
  assert.equal(payment.list(s,owner)[0].mineToReview,true);
  payment.confirm(s,owner,{orderId:order.id,actualAmount:30,reference:'WX-1'});
  assert.equal(s.sales[0].receivedAmount,30);
  assert.equal(s.receipts.filter(x=>x.sourceId===order.id&&x.kind==='sale').length,1);
  assert.throws(()=>payment.confirm(s,owner,{orderId:order.id,actualAmount:30,reference:'WX-1'}),/已经核对/);
});

test("现金未确认放入抽屉也能开单，老板核对与异议全留痕", () => {
  const s=fixture(),[owner,employee]=actors(s);
  const payment=require('./sale-payments');
  const order=erp.sale(s,employee,{account:'现金',items:[{skuId:'cable',quantity:1,salePrice:30}]});
  assert.equal(order.paymentReview.cashDrawerConfirmed,false);
  assert.equal(order.paymentReview.status,'待老板核对');
  assert.equal(s.receipts.filter(x=>x.sourceId===order.id).length,0);
  assert.throws(()=>payment.declareCash(s,owner,{orderId:order.id,declaration:'drawer'}),/只有原开单人/);
  payment.declareCash(s,employee,{orderId:order.id,declaration:'drawer',note:'放入抽屉'});
  assert.equal(s.sales[0].paymentReview.cashDrawerConfirmed,true);
  assert.equal(s.receipts.filter(x=>x.sourceId===order.id).length,1);
  assert.throws(()=>payment.confirm(s,employee,{orderId:order.id,actualAmount:30}),/必须由实际收款/);
  payment.dispute(s,owner,{orderId:order.id,reason:'抽屉尚未核清',actualAmount:20});
  assert.equal(s.sales[0].paymentReview.status,'有异议');
  payment.confirm(s,owner,{orderId:order.id,actualAmount:30});
  assert.equal(s.sales[0].paymentReview.status,'已核对');
  assert.equal(s.sales[0].paymentReview.events.length,4);
  assert.equal(s.receipts.filter(x=>x.sourceId===order.id).length,1);
});

test("未指定账户也可开单，老板指定后转交实际收款人", () => {
  const s=fixture(),[owner,employee,,manager]=actors(s);
  const payment=require('./sale-payments');
  const order=erp.sale(s,employee,{account:'支付宝',items:[{skuId:'cable',quantity:1,salePrice:30}]});
  assert.equal(order.paymentReview.accountOwnerUnspecified,true);
  assert.throws(()=>payment.assign(s,employee,{orderId:order.id,accountOwnerId:manager.id}),/权限/);
  payment.assign(s,owner,{orderId:order.id,accountOwnerId:manager.id});
  assert.equal(s.sales[0].accountOwnerId,manager.id);
  assert.throws(()=>payment.confirm(s,owner,{orderId:order.id,actualAmount:30,reference:'ALI-1'}),/必须由实际收款/);
  payment.confirm(s,manager,{orderId:order.id,actualAmount:30,reference:'ALI-1'});
  assert.equal(s.receipts.at(-1).accountOwnerId,manager.id);
});

test("新销售单按日期生成短编号，历史单号保持原样且收款继续关联", () => {
  const s = fixture();
  const employee = c.userById(s, "u2");
  const legacyId = "SO-123e4567-e89b-12d3-a456-426614174000";
  s.sales.push({ id: legacyId });
  const first = saleFixture(s, employee, {
    items: [{ skuId: "cable", quantity: 1, salePrice: 30 }],
  });
  const second = saleFixture(s, employee, {
    items: [{ skuId: "cable", quantity: 1, salePrice: 30 }],
  });
  const prefix = `SO-${c.day().slice(2).replace(/-/g, "")}-`;
  assert.equal(first.id, `${prefix}0001`);
  assert.equal(second.id, `${prefix}0002`);
  assert.ok(s.sales.some((row) => row.id === legacyId));
  assert.ok(s.receipts.some((row) => row.sourceId === first.id));
  assert.ok(s.receipts.some((row) => row.sourceId === second.id));
});

test("超限赠品不阻断开单，只有老板或获授权人能审批后扣库", () => {
  const s=fixture(),[owner,employee,,manager]=actors(s);
  const beforeQuote=JSON.stringify(s);
  const quote=erp.quoteSaleGift(s,employee,{items:[{skuId:"phone",quantity:1,salePrice:200,serialNo:"IMEI-1"}],gifts:[{skuId:"cable",quantity:3}]});
  assert.equal(JSON.stringify(s),beforeQuote);
  assert.equal(quote.cost,30);
  assert.equal(quote.approvalRequired,true);
  const order=saleFixture(s,employee,{items:[{skuId:"phone",quantity:1,salePrice:200,serialNo:"IMEI-1"}],gifts:[{skuId:"cable",quantity:3}],giftReason:"活动赠品"});
  assert.equal(s.sales[0].giftCost,undefined);
  assert.equal(s.inventory.find(x=>x.skuId==="cable").quantity,10);
  const request=s.giftApprovals[0];
  assert.equal(request.quotedItems[0].name,"数据线");
  assert.equal(erp.giftApprovals(s,employee)[0].id,request.id);
  assert.throws(()=>erp.reviewGiftApproval(s,manager,{id:request.id,approve:true}),/权限/);
  assert.throws(()=>erp.reviewGiftApproval(s,owner,{id:request.id,approve:false}),/原因/);
  assert.equal(request.status,"待审批");
  manager.permissions.push("gift:approve");
  const approved=erp.reviewGiftApproval(s,manager,{id:request.id,approve:true,note:"已核对"});
  assert.equal(approved.status,"已批准");
  assert.equal(approved.actualCost,30);
  assert.equal(s.sales[0].giftCost,30);
  assert.equal(s.inventory.find(x=>x.skuId==="cable").quantity,7);
  assert.equal(s.sales[0].giftOrders[0].approvalId,request.id);
  assert.throws(()=>erp.reviewGiftApproval(s,owner,{id:request.id,approve:true}),/已处理/);
  assert.ok(s.operationLogs.some(x=>x.action==="gift:review"&&x.detail.includes(request.id)));
  assert.equal(order.id,s.sales[0].id);
});


test("接待单失败有可查询原因，成功保存且重试不重单", async () => {
  repository.resetStore(fixture());
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  async function call(path, data, token, key) {
    const response = await fetch(base + path, {
      method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    const employee = (await call("/api/auth/login", { userId: "u2" })).body.token;
    const other = (await call("/api/auth/login", { userId: "u3" })).body.token;
    const owner = (await call("/api/auth/login", { userId: "u1" })).body.token;
    // 无手机号允许保存底根；使用格式错误的号码验证失败记录。
    const invalid = await call("/api/receptions", { phone: "123", purpose: "咨询手机" }, employee, "reception-bad-1");
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error.message, /11位/);
    assert.ok(invalid.body.error.attemptId);
    assert.equal(repository.readStore().receptions.length, 0);
    const ownAttempts = (await call("/api/receptions/attempts", null, employee)).body;
    assert.equal(ownAttempts.length, 1);
    assert.equal(ownAttempts[0].id, invalid.body.error.attemptId);
    assert.equal(ownAttempts[0].customerMask, "手机号格式不符");
    assert.equal((await call("/api/receptions/attempts", null, other)).body.length, 0);
    assert.equal((await call("/api/receptions/attempts", null, owner)).body.length, 1);
    const valid = { phone: "13800001111", purpose: "咨询手机", source: "到店" };
    const saved = await call("/api/receptions", valid, employee, "reception-good-1");
    assert.equal(saved.status, 200);
    assert.equal(saved.body.customerMask, "138****1111");
    assert.equal((await call("/api/receptions", valid, employee, "reception-good-1")).body.id, saved.body.id);
    assert.equal(repository.readStore().receptions.length, 1);
    assert.equal((await call("/api/receptions", null, employee)).body.rows.some((row) => row.id === saved.body.id), true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
