const fs = require("node:fs");
const path = require("node:path");
const { Bitable, TABLES, text } = require("../server/src/feishu-base-workflows");
const QUICK_SALES = "tblQg0SHspyDhNrD";
const CHOICE_FIELD = "fldWV8k8q0";
const batch = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] || "data/imports/test-stock-2026-10-07.json"), "utf8"));
if (batch.testData !== true || !Array.isArray(batch.products)) throw new Error("只接受测试批次");
const client = new Bitable();
function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function retry(work, label) {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      if (attempt >= 3 || !/429|125429|1254607|too many|频繁|并发/.test(error.message)) throw new Error(label + ": " + error.message);
      await pause(1200 * (attempt + 1));
    }
  }
}
async function main() {
  const rows = await client.list(TABLES.products);
  const existing = new Map(rows.map((row) => [text(row.fields && row.fields["商品编号"]).trim(), row]));
  const wanted = batch.products.filter((item) => !existing.has(item.externalCode));
  let created = 0;
  for (let index = 0; index < wanted.length; index += 50) {
    const chunk = wanted.slice(index, index + 50);
    const records = chunk.map((item) => ({ fields: {
      "商品编号": item.externalCode,
      "商品名称": item.name,
      "分类": item.type,
      "库存方式": item.trackSerial ? "串码" : "数量",
      "单位": item.unit,
      "预设售价": item.salePrice,
      "启用": true,
      "说明": "测试批次 " + batch.batchId + (item.testPriceGenerated ? "；售价为测试生成" : "") + "；请勿作为正式库存",
      "处理状态": "已完成",
      "处理说明": "测试数据同步；后台已导入",
    } }));
    const response = await retry(() => client.request(client.path(TABLES.products) + "/batch_create", "POST", { records }), "商品档案批量创建");
    const count = response.data && response.data.records && response.data.records.length;
    if (count !== chunk.length) throw new Error("飞书批量创建返回数量不符");
    created += count;
    console.log(JSON.stringify({ stage: "products", created, target: wanted.length }));
  }
  const fieldsPath = "/bitable/v1/apps/" + encodeURIComponent(client.app) + "/tables/" + QUICK_SALES + "/fields";
  const listed = await client.request(fieldsPath + "?page_size=500");
  const field = (listed.data && listed.data.items || []).find((item) => item.field_id === CHOICE_FIELD);
  if (!field || field.type !== 3) throw new Error("快捷开单商品选择字段不存在或类型不符");
  const oldOptions = field.property && field.property.options || [];
  const names = new Set(oldOptions.map((option) => option.name));
  const options = oldOptions.map(({ id, name, color }) => ({ id, name, ...(color == null ? {} : { color }) }));
  for (const item of batch.products) {
    const name = item.externalCode + "｜" + item.name;
    if (!names.has(name)) { options.push({ name }); names.add(name); }
  }
  if (options.length !== oldOptions.length) {
    await retry(() => client.request(fieldsPath + "/" + CHOICE_FIELD, "PUT", {
      field_name: field.field_name, type: field.type, property: { options },
    }), "快捷开单商品下拉选项更新");
  }
  const again = await client.request(fieldsPath + "?page_size=500");
  const verified = (again.data && again.data.items || []).find((item) => item.field_id === CHOICE_FIELD);
  const finalOptions = verified && verified.property && verified.property.options || [];
  const finalNames = new Set(finalOptions.map((item) => item.name));
  const missing = batch.products.filter((item) => !finalNames.has(item.externalCode + "｜" + item.name));
  if (missing.length) throw new Error("有 " + missing.length + " 个商品未进入快捷开单下拉选项");
  console.log(JSON.stringify({ stage: "complete", catalogCreated: created, dropdownOptions: finalOptions.length, testProducts: batch.products.length }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });