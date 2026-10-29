const { readStore, transaction } = require("./repository");
const { TABLES, text, links } = require("./feishu-base-workflows");
const { permit } = require("./common");
const erp = require("./erp");

async function processProducts(client, read = readStore, transact = transaction) {
  const [rows, categories] = await Promise.all([
    client.list(TABLES.products), client.list("tblTqpzX7hhQZR8V"),
  ]);
  const taxonomy = new Map(categories.map((r) => [r.record_id, r]));
  let processed = 0, failed = 0;
  for (const row of rows) {
    if (row.fields["提交处理"] !== true) continue;
    try {
      const store = read();
      const editorId = row.last_modified_by?.id;
      const user = store.users.find((u) =>
        u.feishuOpenId === editorId && u.status === "active");
      if (!user) throw new Error("请由已绑定的在职管理员提交商品");
      permit(user, "manageProducts");
      const selected = links(row.fields["三级分类"]);
      if (selected.length !== 1) throw new Error("请选择三级分类");
      const category = taxonomy.get(selected[0]);
      if (!category || category.fields["启用"] !== true)
        throw new Error("所选分类不存在或已停用");
      const major = text(category.fields["商品大项"]).trim();
      const brand = text(category.fields["品牌"]).trim();
      const series = text(category.fields["系列"]).trim();
      const method = text(row.fields["库存方式"]).trim();
      if (!["数量", "串码", "服务"].includes(method))
        throw new Error("请选择库存方式");
      if (["智能机", "功能机", "二手机"].includes(major) && method !== "串码")
        throw new Error("手机必须按唯一串码管理");
      if (major === "维修" && method === "串码")
        throw new Error("维修服务和耗材不按手机串码管理");
      const code = text(row.fields["商品编号"]).trim();
      const name = text(row.fields["商品名称"]).trim();
      const price = Number(row.fields["预设售价"]);
      if (!code || !name || !Number.isFinite(price) || price < 0)
        throw new Error("请填写商品编号、商品名称和有效售价");
      const result = transact((current) => {
        current.feishuJobs ||= [];
        const key = "product:" + row.record_id + ":" + row.last_modified_time;
        let job = current.feishuJobs.find((item) => item.key === key);
        if (!job) {
          const existing = current.products.find((p) => p.externalCode === code);
          const product = erp.saveProduct(current, user, {
            skuId: existing?.skuId, externalCode: code, name,
            type: major, subType: brand, kind: method === "服务" ? "service" : "stock",
            trackSerial: method === "串码",
            unit: text(row.fields["单位"]).trim() || (method === "服务" ? "项" : "件"),
            salePrice: price, active: row.fields["启用"] !== false,
          },{internal:true});
          product.thirdType = series;
          job = { key, result: { skuId: product.skuId }, at: new Date().toISOString() };
          current.feishuJobs.push(job);
        }
        return job.result;
      });
      await client.update(TABLES.products, row.record_id, {
        "提交处理": false, "处理状态": "已完成",
        "处理说明": "已同步商品 " + result.skuId,
      });
      processed++;
    } catch (error) {
      await client.update(TABLES.products, row.record_id, {
        "提交处理": false, "处理状态": "失败",
        "处理说明": String(error.message || error).slice(0, 500),
      });
      failed++;
    }
  }
  return { processed, failed };
}
module.exports = { processProducts };
