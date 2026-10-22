process.env.STORE_DB_PATH = ":memory:";
process.env.STORE_SEED_PATH = require("node:path").resolve(__dirname, "..", "examples", "test-store.json");
process.env.NODE_ENV = "development";
const assert = require("node:assert/strict");
const { createServer } = require("../server/src/application");
const mutations = [];
const server = createServer({ onMutation: (path) => mutations.push(path) });
server.listen(0, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/demo`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /快速开单/);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "demo-owner" }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.ok(token);
    const headers = { Authorization: `Bearer ${token}` };
    const before = await (await fetch(`${base}/api/inventory`, { headers })).json();
    assert.equal(before.find((item) => item.skuId === "demo-cable-001").quantity, 20);
    const saleHeaders = { ...headers, "Content-Type": "application/json", "Idempotency-Key": "smoke-cable-sale" };
    const saleBody = JSON.stringify({ account: "微信", items: [{ skuId: "demo-cable-001", quantity: 1, salePrice: 39 }] });
    const sale = await fetch(`${base}/api/sale-orders`, { method: "POST", headers: saleHeaders, body: saleBody });
    const order = await sale.json();
    assert.equal(sale.status, 200, JSON.stringify(order));
    const replay = await fetch(`${base}/api/sale-orders`, { method: "POST", headers: saleHeaders, body: saleBody });
    assert.equal((await replay.json()).id, order.id);
    const after = await (await fetch(`${base}/api/inventory`, { headers })).json();
    assert.equal(after.find((item) => item.skuId === "demo-cable-001").quantity, 19);
    const orders = await (await fetch(`${base}/api/sale-orders`, { headers })).json();
    assert.equal(orders.length, 1);
    assert.ok(mutations.includes("/api/sale-orders"));
    console.log("本机页面、登录、库存、开单、重复提交保护验证通过");
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.close(); }
});
