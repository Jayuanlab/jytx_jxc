const { readStore, transaction } = require("./repository");
const { TABLES, text, links, actor } = require("./feishu-base-workflows");
const { notice } = require("./feishu-notices");
const erp = require("./erp");

function one(value, name) {
  const ids = links(value);
  if (ids.length !== 1) throw new Error("请选择一个" + name);
  return ids[0];
}
function amount(value, name) {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n) || n < 0)
    throw new Error(name + "不正确");
  return n;
}
function payload(header, lines, products, suppliers, store) {
  const source = suppliers.get(one(header.fields["供应商"], "供应商"));
  const supplier = source && text(source.fields["供应商名称"]).trim();
  if (!supplier) throw new Error("供应商档案不存在或名称为空");
  return {
    supplier,
    paidAmount: header.fields["本次付款"] == null ? 0 :
      amount(header.fields["本次付款"], "本次付款"),
    account: text(header.fields["付款账户"]).trim() || "微信",
    items: lines.map((line) => {
      const productRow = products.get(one(line.fields["商品"], "商品"));
      const code = productRow && text(productRow.fields["商品编号"]).trim();
      const product = store.products.find((p) =>
        p.externalCode === code && p.active !== false);
      if (!product) throw new Error("商品档案不存在或已停用：" + code);
      if (product.stockManaged === false) throw new Error("服务项目不能入库");
      const warehouse = text(line.fields["入库仓库"]).trim();
      if (warehouse && warehouse !== "销售仓")
        throw new Error("当前仅支持销售仓入库");
      const quantity = Number(line.fields["数量"]);
      if (!Number.isSafeInteger(quantity) || quantity < 1)
        throw new Error("数量必须是正整数");
      const serials = text(line.fields["串码清单"]).split(/[\s,，;；]+/)
        .map((s) => s.trim()).filter(Boolean);
      if (product.trackSerial && serials.length !== quantity)
        throw new Error("串码数量必须等于入库数量");
      if (!product.trackSerial && serials.length)
        throw new Error("普通商品不需要串码");
      return {
        skuId: product.skuId, quantity,
        costPrice: amount(line.fields["单件进价"], "单件进价"),
        serials,
      };
    }),
  };
}
async function processPurchases(client, read = readStore, transact = transaction) {
  const [headers, allLines, productRows, supplierRows] = await Promise.all([
    client.list(TABLES.purchases), client.list(TABLES.purchaseItems),
    client.list(TABLES.products), client.list(TABLES.suppliers),
  ]);
  const products = new Map(productRows.map((r) => [r.record_id, r]));
  const suppliers = new Map(supplierRows.map((r) => [r.record_id, r]));
  let processed = 0, failed = 0;
  for (const header of headers) {
    if (header.fields["提交处理"] !== true ||
        text(header.fields["处理状态"]) === "已完成") continue;
    try {
      const store = read();
      const user = actor(store, header, "purchase");
      const lines = allLines.filter((r) =>
        links(r.fields["所属入库单"]).includes(header.record_id));
      if (!lines.length) throw new Error("请先填写采购明细");
      if (lines.some((r) => r.created_by?.id !== user.feishuOpenId ||
          r.last_modified_by?.id !== user.feishuOpenId))
        throw new Error("采购明细须由开单人本人填写");
      const input = payload(header, lines, products, suppliers, store);
      const result = transact((current) => {
        current.feishuJobs ||= [];
        const key = "purchase:" + header.record_id;
        let job = current.feishuJobs.find((r) => r.key === key);
        if (!job) {
          job = { key, result: erp.purchase(current, user, input),
            at: new Date().toISOString() };
          current.feishuJobs.push(job);
        }
        notice(current, key, "采购", job.result);
        return job.result;
      });
      await client.update(TABLES.purchases, header.record_id, {
        "提交处理": false, "处理状态": "已完成",
        "原系统单号": result.id, "处理说明": "已入库，金额 " + result.amount,
      });
      processed++;
    } catch (error) {
      await client.update(TABLES.purchases, header.record_id, {
        "提交处理": false, "处理状态": "失败",
        "处理说明": String(error.message || error).slice(0, 500),
      });
      failed++;
    }
  }
  return { processed, failed };
}
module.exports = { payload, processPurchases };
