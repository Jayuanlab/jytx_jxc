const test = require("node:test");
const assert = require("node:assert/strict");
const { inventoryRows, csv } = require("./feishu-inventory");
const { sync } = require("../../scripts/feishu-inventory");

const store = {
  products: [{ skuId: "p1", externalCode: "P1", name: "手机", type: "智能手机", subType: "测试", salePrice: 1999, costPrice: 1500, supplierId: "secret" }],
  inventory: [{ skuId: "p1", warehouseId: "wh-sale", quantity: 2, warehouseName: "销售仓", serials: [{ no: "IMEI-SECRET" }] }],
};

test("导出库存只含公开字段，保留稳定库存键", () => {
  const [row] = inventoryRows(store, "2026-09-28T00:00:00.000Z");
  assert.equal(row["库存键"], "p1:wh-sale");
  assert.equal(row["库存数量"], 2);
  assert.equal(row["分类"], "智能手机 / 测试");
  assert.doesNotMatch(JSON.stringify(row), /1500|IMEI-SECRET|supplierId/);
  assert.match(csv([row]), /p1:wh-sale/);
});

test("库存不一致时拒绝导出", () => {
  assert.throws(() => inventoryRows({ products: [], inventory: store.inventory }), /不存在/);
  assert.throws(() => inventoryRows({ ...store, inventory: [...store.inventory, ...store.inventory] }), /重复库存键/);
});

test("同步创建和更新库存，未变化的记录不重复写入", async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    const payload = String(url).includes("tenant_access_token")
      ? { code: 0, tenant_access_token: "test-token" }
      : options.method === "GET" || !options.method
        ? { code: 0, data: { items: [{ record_id: "rec-1", fields: { "库存键": "p1:wh-sale", "商品编号": "P1", "商品名称": "旧名称" } }] } }
        : { code: 0, data: {} };
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    const result = await sync(inventoryRows(store), { FEISHU_APP_ID: "id", FEISHU_APP_SECRET: "secret", FEISHU_BASE_APP_TOKEN: "app", FEISHU_BASE_TABLE_ID: "table" });
    assert.deepEqual(result, { created: 0, updated: 1, unchanged: 0, stale: 0 });
    assert.equal(calls.at(-1).method, "PUT");
    assert.match(calls.at(-1).url, /rec-1$/);
  } finally { global.fetch = previous; }
});

test("飞书返回数字文本和空白字段时，不重复更新", async () => {
  const previous = global.fetch;
  const row = inventoryRows(store)[0];
  const fields = { ...row, "库存数量": "2", "预设售价": "1999" };
  delete fields["规格型号"];
  let writes = 0;
  global.fetch = async (url, options = {}) => {
    if (options.method === "PUT" || options.method === "POST" && !String(url).includes("tenant_access_token")) writes++;
    const payload = String(url).includes("tenant_access_token")
      ? { code: 0, tenant_access_token: "test-token" }
      : { code: 0, data: { items: [{ record_id: "rec-1", fields }] } };
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    const result = await sync([row], { FEISHU_APP_ID: "id", FEISHU_APP_SECRET: "secret", FEISHU_BASE_APP_TOKEN: "app", FEISHU_BASE_TABLE_ID: "table" });
    assert.deepEqual(result, { created: 0, updated: 0, unchanged: 1, stale: 0 });
    assert.equal(writes, 0);
  } finally { global.fetch = previous; }
});
