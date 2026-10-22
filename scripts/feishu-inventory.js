// Export locally by default; --sync explicitly writes to a configured Feishu Base.
const fs = require("node:fs");
const path = require("node:path");
const { readStore } = require("../server/src/repository");
const { inventoryRows, csv } = require("../server/src/feishu-inventory");

const API = "https://open.feishu.cn/open-apis";
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0)
    throw new Error(`飞书接口失败 (${response.status}, ${body.code ?? "?"}): ${body.msg || "未知错误"}`);
  return body;
}

async function sync(rows, env = process.env) {
  const { FEISHU_APP_ID: id, FEISHU_APP_SECRET: secret, FEISHU_BASE_APP_TOKEN: app, FEISHU_BASE_TABLE_ID: table } = env;
  if (![id, secret, app, table].every(Boolean))
    throw new Error("同步需要 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_BASE_APP_TOKEN、FEISHU_BASE_TABLE_ID");
  const tokenResponse = await request(`${API}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: id, app_secret: secret }),
  });
  const headers = { Authorization: `Bearer ${tokenResponse.tenant_access_token}`, "Content-Type": "application/json" };
  const base = `${API}/bitable/v1/apps/${encodeURIComponent(app)}/tables/${encodeURIComponent(table)}/records`;
  const existing = new Map();
  let pageToken;
  do {
    const url = new URL(base);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const result = await request(url, { headers });
    for (const record of result.data?.items || []) {
      const key = record.fields?.["库存键"];
      if (!key) continue;
      if (existing.has(key)) throw new Error(`飞书表中库存键重复：${key}`);
      existing.set(key, record);
    }
    pageToken = result.data?.has_more ? result.data?.page_token : null;
    if (result.data?.has_more && !pageToken) throw new Error("飞书分页缺少 page_token");
  } while (pageToken);
  let created = 0, updated = 0, unchanged = 0;
  const numberFields = new Set(["库存数量", "预设售价"]);
  for (const fields of rows) {
    const old = existing.get(fields["库存键"]);
    // Ignore the timestamp for change detection, so an unchanged stock row is not rewritten.
    const changed = !old || Object.keys(fields).some((key) => {
      if (key === "同步时间") return false;
      const previous = old.fields?.[key];
      return numberFields.has(key)
        ? Number(previous) !== Number(fields[key])
        : String(previous ?? "") !== String(fields[key] ?? "");
    });
    if (!changed) { unchanged++; continue; }
    await request(old ? `${base}/${encodeURIComponent(old.record_id)}` : base, {
      method: old ? "PUT" : "POST", headers, body: JSON.stringify({ fields }),
    });
    if (old) updated++; else created++;
  }
  return { created, updated, unchanged, stale: existing.size - rows.filter((row) => existing.has(row["库存键"])).length };
}

async function main() {
  const args = process.argv.slice(2);
  const inputAt = args.indexOf("--input");
  const outputAt = args.indexOf("--output");
  const store = inputAt >= 0 ? JSON.parse(fs.readFileSync(args[inputAt + 1], "utf8")) : readStore();
  const rows = inventoryRows(store);
  if (args.includes("--sync")) {
    console.log(JSON.stringify(await sync(rows)));
  } else {
    const target = path.resolve(outputAt >= 0 ? args[outputAt + 1] : "feishu-inventory.csv");
    fs.writeFileSync(target, csv(rows));
    console.log(`已导出 ${rows.length} 条库存：${target}`);
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { sync };
