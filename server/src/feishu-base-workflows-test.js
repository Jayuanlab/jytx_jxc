process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const { initialize } = require("./common");
const { TABLES, processSales } = require("./feishu-base-workflows");
const { processPurchases } = require("./feishu-purchases");
const { notice, sendNotices } = require("./feishu-notices");

function fixture() {
  return initialize({
    users: [{ id: "owner", name: "老板", roleCode: "owner", status: "active",
      feishuOpenId: "ou-owner", permissions: [] }],
    products: [
      { skuId: "phone", externalCode: "P1", name: "测试手机", type: "手机",
        stockManaged: true, trackSerial: true, active: true, salePrice: 500 },
      { skuId: "cable", externalCode: "C1", name: "测试数据线", type: "配件",
        stockManaged: true, trackSerial: false, active: true, salePrice: 30 },
    ],
    inventory: [
      { skuId: "phone", warehouseId: "wh-sale", warehouseName: "销售仓",
        quantity: 1, stockValue: 200, costPrice: 200,
        serials: [{ no: "IMEI-001", status: "可售", costPrice: 200 }] },
      { skuId: "cable", warehouseId: "wh-sale", warehouseName: "销售仓",
        quantity: 5, stockValue: 50, costPrice: 10, serials: [] },
    ],
  });
}
const by = { id: "ou-owner" };
function row(id, fields) {
  return { record_id: id, fields, created_by: by, last_modified_by: by };
}
function client(tables) {
  return {
    tables, messages: [],
    async list(table) { return tables[table] || []; },
    async update(table, id, fields) {
      Object.assign(tables[table].find((r) => r.record_id === id).fields, fields);
    },
    async create(table, fields) { (tables[table] ||= []).push(row("new-" + table + "-" + tables[table].length, fields)); },
    async request(path, method, body) { this.messages.push({ path, method, body }); },
  };
}
function db(store) {
  return {
    read: () => store,
    transact: (fn) => fn(store),
  };
}
test("数量商品销售不需要串号且重复提交不重复扣库", async () => {
  const store = fixture();
  const tables = {
    [TABLES.products]: [row("product", { 商品编号: "C1" })],
    [TABLES.sales]: [row("sale", { 提交处理: true, 处理状态: "待处理",
      收款方式: "微信" })],
    [TABLES.saleItems]: [row("line", { 所属销售单: { link_record_ids: ["sale"] },
      商品: { link_record_ids: ["product"] }, 数量: 2, 实际售价: 30 })],
  };
  const api = client(tables), storage = db(store);
  assert.deepEqual(await processSales(api, storage.read, storage.transact),
    { processed: 1, failed: 0 });
  assert.equal(store.inventory[1].quantity, 3);
  tables[TABLES.sales][0].fields.提交处理 = true;
  assert.deepEqual(await processSales(api, storage.read, storage.transact),
    { processed: 0, failed: 0 });
  assert.equal(store.sales.length, 1);
});
test("手机一机一串号，缺失或重复串号不会扣库", async () => {
  const store = fixture();
  const tables = {
    [TABLES.products]: [row("product", { 商品编号: "P1" })],
    [TABLES.sales]: [row("sale", { 提交处理: true, 处理状态: "待处理" })],
    [TABLES.saleItems]: [row("line", { 所属销售单: { link_record_ids: ["sale"] },
      商品: { link_record_ids: ["product"] }, 数量: 1, 实际售价: 500 })],
  };
  const api = client(tables), storage = db(store);
  assert.deepEqual(await processSales(api, storage.read, storage.transact),
    { processed: 0, failed: 1 });
  assert.equal(store.inventory[0].quantity, 1);
  assert.match(tables[TABLES.sales][0].fields.处理说明, /串码/);
  tables[TABLES.saleItems][0].fields.串码 = "IMEI-001";
  tables[TABLES.sales][0].fields.提交处理 = true;
  assert.deepEqual(await processSales(api, storage.read, storage.transact),
    { processed: 1, failed: 0 });
  assert.equal(store.inventory[0].quantity, 0);
});
test("采购入库拒绝重复手机串号", async () => {
  const store = fixture();
  const tables = {
    [TABLES.products]: [row("product", { 商品编号: "P1" })],
    [TABLES.suppliers]: [row("supplier", { 供应商名称: "演示供应商" })],
    [TABLES.purchases]: [row("purchase", { 提交处理: true, 处理状态: "待处理",
      供应商: { link_record_ids: ["supplier"] }, 本次付款: 0 })],
    [TABLES.purchaseItems]: [row("line", {
      所属入库单: { link_record_ids: ["purchase"] },
      商品选择: "C1｜测试配件", 数量: 1, 单件进价: 230,
      串码清单: "IMEI-001", 入库仓库: "销售仓",
    })],
  };
  const api = client(tables), storage = db(store);
  assert.deepEqual(await processPurchases(api, storage.read, storage.transact),
    { processed: 0, failed: 1 });
  assert.equal(store.inventory[0].quantity, 1);
});
test("每张已入账单据只通知老板一次", async () => {
  const store = fixture();
  notice(store, "sale:s1", "销售", {
    id: "SO-1", amount: 60, items: [{ name: "数据线", quantity: 2 }],
  });
  notice(store, "sale:s1", "销售", {
    id: "SO-1", amount: 60, items: [{ name: "数据线", quantity: 2 }],
  });
  const api = client({}), storage = db(store);
  assert.deepEqual(await sendNotices(api, storage.read, storage.transact),
    { sent: 1, failed: 0 });
  assert.deepEqual(await sendNotices(api, storage.read, storage.transact),
    { sent: 0, failed: 0 });
  assert.equal(api.messages.length, 1);
  assert.equal(api.messages[0].body.receive_id, "ou-owner");
});


test("三级分类限制手机必须按串号管理", async () => {
  const { processProducts } = require("./feishu-products");
  const store = fixture();
  const tables = {
    [TABLES.products]: [row("product", {
      商品编号: "P2", 商品名称: "华为演示机", 预设售价: 900,
      库存方式: "数量", 三级分类: { link_record_ids: ["category"] },
      提交处理: true,
    })],
    ["tblTqpzX7hhQZR8V"]: [row("category", {
      商品大项: "智能机", 品牌: "华为", 系列: "Mate", 启用: true,
    })],
  };
  const api = client(tables), storage = db(store);
  assert.deepEqual(await processProducts(api, storage.read, storage.transact),
    { processed: 0, failed: 1 });
  assert.equal(store.products.length, 2);
  assert.match(tables[TABLES.products][0].fields.处理说明, /唯一串码/);
});
test("日结自动生成逐笔收款和现金差异", async () => {
  const { syncDaily } = require("./feishu-daily");
  const { day } = require("./common");
  const store = fixture();
  store.sales.push({
    id: "SO-test", createdAt: new Date().toISOString(),
    paymentMethod: "现金", status: "completed",
    items: [{ id: "SI-test", name: "测试数据线", type: "配件",
      quantity: 2, amount: 60, note: "" }],
  });
  const api = client({});
  assert.deepEqual(await syncDaily(api, store), { days: 1, lines: 1 });
  const daily = api.tables["tblbWh2ST5Iwoeem"][0];
  assert.equal(daily.fields.日期, day());
  assert.equal(daily.fields.现金销售, 60);
  assert.equal(daily.fields.应有现金, 60);
  assert.equal(api.tables["tblmmiIHkmniPCrB"][0].fields.现金, 60);
  assert.deepEqual(await syncDaily(api, store), { days: 0, lines: 0 });
});


test("快捷开单以飞书身份销售一件普通商品", async () => {
  const { TABLE, processQuickSales } = require("./feishu-quick-sales");
  const store = fixture();
  const tables = {
    [TABLES.products]: [row("product", { 商品编号: "C1" })],
    [TABLE]: [row("quick", {
      商品: {},
      商品选择: "C1｜测试配件",
      数量: 2, 成交单价: 35, 收款渠道: "微信",
      顾客姓名: "测试顾客", 顾客手机号: "13800138000",
      备注: "联调测试",
    })],
  };
  const api = client(tables), storage = db(store);
  assert.deepEqual(await processQuickSales(api, storage.read, storage.transact),
    { processed: 1, failed: 0 });
  assert.equal(store.inventory[1].quantity, 3);
  assert.equal(store.feishuNotices.length, 1);
  assert.equal(store.sales[0].customerName, "测试顾客");
  assert.equal(store.sales[0].note, "联调测试");
  assert.equal(store.sales[0].customerMask, "138****8000");
  assert.equal(store.customers.find((item) => item.id === store.sales[0].customerId).phone, "13800138000");
  assert.equal(tables[TABLE][0].fields.处理状态, "已完成");
  assert.deepEqual(await processQuickSales(api, storage.read, storage.transact),
    { processed: 0, failed: 0 });
});

