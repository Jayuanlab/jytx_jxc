const { readStore } = require("../server/src/repository");
const { inventoryRows } = require("../server/src/feishu-inventory");
const { Bitable, TABLES, text } = require("../server/src/feishu-base-workflows");
const client = new Bitable();
const path = client.path(TABLES.inventory);
function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function retry(work, label) {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      if (attempt >= 4 || !/429|125429|1254607|too many|频繁|并发/.test(error.message)) throw new Error(label + ": " + error.message);
      await pause(1500 * (attempt + 1));
    }
  }
}
async function main() {
  const expected = inventoryRows(readStore());
  const byKey = new Map();
  for (const row of await client.list(TABLES.inventory)) {
    const key = text(row.fields && row.fields["库存键"]).trim();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  const duplicates = [...byKey.values()].flatMap((rows) => rows.slice(1).map((row) => row.record_id));
  console.log(JSON.stringify({ stage: "before", expected: expected.length, uniqueKeys: byKey.size, duplicateRows: duplicates.length }));
  for (let i = 0; i < duplicates.length; i += 100) {
    const records = duplicates.slice(i, i + 100);
    await retry(() => client.request(path + "/batch_delete", "POST", { records }), "删除重复库存镜像");
    console.log(JSON.stringify({ stage: "dedupe", deleted: Math.min(i + 100, duplicates.length) }));
  }
  const missing = expected.filter((fields) => !byKey.has(fields["库存键"]));
  for (let i = 0; i < missing.length; i += 50) {
    const records = missing.slice(i, i + 50).map((fields) => ({ fields }));
    const result = await retry(() => client.request(path + "/batch_create", "POST", { records }), "创建缺失库存镜像");
    if ((result.data && result.data.records || []).length !== records.length) throw new Error("批量创建数量不符");
    console.log(JSON.stringify({ stage: "create", created: Math.min(i + 50, missing.length), target: missing.length }));
  }
  const after = await client.list(TABLES.inventory);
  const final = new Map();
  for (const row of after) {
    const key = text(row.fields && row.fields["库存键"]).trim();
    final.set(key, (final.get(key) || 0) + 1);
  }
  const mismatched = expected.filter((fields) => {
    const row = after.find((r) => text(r.fields && r.fields["库存键"]).trim() === fields["库存键"]);
    return !row || Number(row.fields["库存数量"]) !== fields["库存数量"] || text(row.fields["商品编号"]).trim() !== fields["商品编号"];
  });
  if (mismatched.length || final.size !== expected.length || [...final.values()].some((n) => n !== 1))
    throw new Error("库存镜像核对失败：预期 " + expected.length + "，实际唯一 " + final.size + "，重复 " + (after.length - final.size) + "，数量不符 " + mismatched.length);
  console.log(JSON.stringify({ stage: "verified", rows: after.length, uniqueKeys: final.size, units: expected.reduce((n, row) => n + row["库存数量"], 0), duplicates: 0 }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });