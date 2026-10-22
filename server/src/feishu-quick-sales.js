const { readStore, transaction } = require("./repository");
const { text, links, actor } = require("./feishu-base-workflows");
const { notice } = require("./feishu-notices");
const erp = require("./erp");
const TABLE = "tblQg0SHspyDhNrD";
const PRODUCTS = "tblA1T3SxRQgAR9o";

async function processQuickSales(client, read = readStore, transact = transaction) {
  const [sales, productRows] = await Promise.all([
    client.list(TABLE), client.list(PRODUCTS),
  ]);
  const catalog = new Map(productRows.map((row) => [row.record_id, row]));
  let processed = 0, failed = 0;
  for (const row of sales) {
    const status = text(row.fields["处理状态"]);
    if (status === "已完成" || (status === "失败" && row.fields["重新处理"] !== true))
      continue;
    try {
      const store = read();
      const user = actor(store, row, "sell");
      const choice = text(row.fields["商品选择"]).trim();
      const selected = links(row.fields["商品"]);
      let code = "";
      if (choice) {
        code = choice.split("｜")[0].trim();
        if (!productRows.some((item) => text(item.fields["商品编号"]).trim() === code))
          throw new Error("所选商品不在商品档案中");
      } else {
        if (selected.length !== 1) throw new Error("请选择一件商品");
        code = text(catalog.get(selected[0])?.fields["商品编号"]).trim();
      }
      const product = store.products.find((p) =>
        p.externalCode === code && p.active !== false);
      if (!product) throw new Error("所选商品不存在或已停用");
      const quantity = Number(row.fields["数量"]);
      if (!Number.isSafeInteger(quantity) || quantity < 1)
        throw new Error("数量必须是正整数");
      const salePrice = Number(row.fields["成交单价"]);
      if (row.fields["成交单价"] == null || !Number.isFinite(salePrice) || salePrice < 0)
        throw new Error("成交单价不正确");
      const serialNo = text(row.fields["手机串码"]).trim();
      if (product.trackSerial && (quantity !== 1 || !serialNo))
        throw new Error("手机每行只能卖 1 台且必须填唯一串码");
      if (!product.trackSerial && serialNo)
        throw new Error("普通商品不需要填写串码");
      const account = text(row.fields["收款渠道"]).trim();
      if (!account) throw new Error("请选择收款渠道");
      const result = transact((current) => {
        current.feishuJobs ||= [];
        const key = "quick-sale:" + row.record_id;
        let job = current.feishuJobs.find((item) => item.key === key);
        if (!job) {
          const order = erp.sale(current, user, {
            salespersonId: user.id, account,
            customerName: text(row.fields["顾客姓名"]).trim(),
            customerPhone: text(row.fields["顾客手机号"]).trim(),
            orderNote: text(row.fields["备注"]).trim(),
            items: [{
              skuId: product.skuId, quantity, salePrice, serialNo,
              noMaterials: row.fields["确认无耗材"] === true,
              note: text(row.fields["备注"]),
            }],
          });
          job = { key, result: order, at: new Date().toISOString() };
          current.feishuJobs.push(job);
        }
        notice(current, key, "销售", job.result);
        return job.result;
      });
      await client.update(TABLE, row.record_id, {
        "销售单号": text(row.fields["销售单号"]).trim() || "快捷-" + result.id,
        "处理状态": "已完成", "处理说明": "已扣库存并入账",
        "原系统单号": result.id, "重新处理": false,
      });
      processed++;
    } catch (error) {
      await client.update(TABLE, row.record_id, {
        "处理状态": "失败", "处理说明": String(error.message || error).slice(0, 500),
        "重新处理": false,
      });
      failed++;
    }
  }
  return { processed, failed };
}
module.exports = { TABLE, processQuickSales };
