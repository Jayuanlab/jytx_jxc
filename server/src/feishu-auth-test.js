process.env.NODE_ENV = "test";
process.env.STORE_DB_PATH = ":memory:";
process.env.STORE_SEED_PATH = require("node:path").join(__dirname, "..", "..", "examples", "test-store.json");
process.env.FEISHU_APP_ID = "cli_test";
process.env.FEISHU_APP_SECRET = "secret_for_unit_test";
process.env.FEISHU_PUBLIC_ORIGIN = "http://127.0.0.1";
process.env.FEISHU_BOOTSTRAP_TOKEN = "bootstrap_for_unit_test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("./application");
const originalFetch = global.fetch;
let openId = "ou_test_owner";
global.fetch = (url, options) => {
  const target = String(url);
  if (!target.startsWith("https://open.feishu.cn/open-apis/")) return originalFetch(url, options);
  if (target.endsWith("/app_access_token/internal")) return Promise.resolve(Response.json({ code: 0, app_access_token: "app_token" }));
  if (target.endsWith("/authen/v1/access_token")) return Promise.resolve(Response.json({ code: 0, data: { access_token: "user_token" } }));
  if (target.endsWith("/authen/v1/user_info")) return Promise.resolve(Response.json({ code: 0, data: { open_id: openId, name: "飞书测试员工" } }));
  throw new Error("Unexpected Feishu URL: " + target);
};

test("飞书验证后绑定老板，员工邀请只能绑定指定账号", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function completeLogin(query) {
    const start = await originalFetch(`${base}/api/auth/feishu/start${query}`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const redirect = new URL(start.headers.get("location"));
    const state = redirect.searchParams.get("state");
    assert.ok(state);
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const callback = await originalFetch(`${base}/api/auth/feishu/callback?code=unit-code&state=${state}`, { redirect: "manual", headers: { Cookie: cookie } });
    return callback;
  }
  try {
    const missing = await completeLogin("");
    assert.equal(missing.status, 403);
    const owner = await completeLogin("?setup=bootstrap_for_unit_test");
    assert.equal(owner.status, 302);
    const ownerCookie = owner.headers.get("set-cookie").split(";")[0];
    const ownerMe = await (await originalFetch(base + "/api/me", { headers: { Cookie: ownerCookie } })).json();
    assert.equal(ownerMe.roleCode, "owner");
    const repeat = await completeLogin("?setup=bootstrap_for_unit_test");
    assert.equal(repeat.status, 302); // The same verified owner may log in again.

    process.env.FEISHU_BASE_APP_TOKEN = "test_base_token";
    const mobileStart = await originalFetch(base + "/api/auth/feishu/start?mobile=1", { redirect: "manual", headers: { "User-Agent": "iPhone" } });
    assert.equal(mobileStart.status, 302);
    const mobileRedirect = new URL(mobileStart.headers.get("location"));
    assert.equal(mobileRedirect.hostname, "open.feishu.cn");
    const mobileState = mobileRedirect.searchParams.get("state");
    const mobileCookie = mobileStart.headers.get("set-cookie").split(";")[0];
    const mobileCallback = await originalFetch(base + "/api/auth/feishu/callback?code=unit-code&state=" + mobileState, { redirect: "manual", headers: { Cookie: mobileCookie } });
    assert.equal(mobileCallback.status, 302);
    assert.equal(mobileCallback.headers.get("location"), "/m");
    const defaultStart = await originalFetch(base + "/api/auth/feishu/start", { redirect: "manual", headers: { "User-Agent": "iPhone" } });
    assert.equal(new URL(defaultStart.headers.get("location")).hostname, "open.feishu.cn");
    const defaultState = new URL(defaultStart.headers.get("location")).searchParams.get("state");
    const defaultCookie = defaultStart.headers.get("set-cookie").split(";")[0];
    const defaultCallback = await originalFetch(base + "/api/auth/feishu/callback?code=unit-code&state=" + defaultState, { redirect: "manual", headers: { Cookie: defaultCookie } });
    assert.equal(defaultCallback.headers.get("location"), "/m");
    const salesStart = await originalFetch(base + "/api/auth/feishu/start?sales=1", { redirect: "manual" });
    const salesState = new URL(salesStart.headers.get("location")).searchParams.get("state");
    const salesCookie = salesStart.headers.get("set-cookie").split(";")[0];
    const salesCallback = await originalFetch(base + "/api/auth/feishu/callback?code=unit-code&state=" + salesState, { redirect: "manual", headers: { Cookie: salesCookie } });
    assert.equal(salesCallback.headers.get("location"), "/app?tab=sales");    delete process.env.FEISHU_BASE_APP_TOKEN;

    const inviteResponse = await originalFetch(base + "/api/users/invite", { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "demo-clerk" }) });
    assert.equal(inviteResponse.status, 200);
    const invite = await inviteResponse.json();
    openId = "ou_test_clerk";
    const clerk = await completeLogin(new URL(invite.url).search);
    assert.equal(clerk.status, 302);
    const clerkCookie = clerk.headers.get("set-cookie").split(";")[0];
    const clerkMe = await (await originalFetch(base + "/api/me", { headers: { Cookie: clerkCookie } })).json();
    assert.equal(clerkMe.roleCode, "employee");
    const reused = await originalFetch(base + "/api/auth/feishu/start" + new URL(invite.url).search, { redirect: "manual" });
    assert.equal(reused.status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); global.fetch = originalFetch; }
});
