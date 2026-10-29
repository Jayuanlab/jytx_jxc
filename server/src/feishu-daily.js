const { readStore } = require("./repository");
const { text } = require("./feishu-base-workflows");
const { day, round } = require("./common");
const DAILY = "tblbWh2ST5Iwoeem";
const LINES = "tblmmiIHkmniPCrB";
const CHANNEL = {
  "现金": "现金", "微信": "聚合支付", "支付宝": "聚合支付",
  "聚合支付": "聚合支付", "银行卡": "银行卡", "国补": "国补",
  "金币+顺差": "金币顺差", "备用余额": "备用余额", "赊账": "赊账",
};
function value(row, name) {
  const n = Number(row?.fields?.[name]);
  return Number.isFinite(n) ? n : 0;
}
function same(prior, next) {
  return Object.entries(next).every(([name, desired]) =>
    name === "同步时间" ||
    (typeof desired === "number" ? Number(prior.fields[name] || 0) === desired
      : text(prior.fields[name]) === desired));
}
async function syncDaily(client, store = readStore()) {
  throw new (require("./common").HttpError)(409,"旧版按渠道合并的飞书日结同步已停用；请按具体资金账户核对，尚未迁移的外部表不再写入旧汇总。");
  const [dailyRows, lineRows] = await Promise.all([client.list(DAILY), client.list(LINES)]);
  const byDay = new Map(dailyRows.map((r) => [text(r.fields["日期"]), r]));
  const byLine = new Map(lineRows.map((r) => [text(r.fields["明细编号"]), r]));
  const grouped = new Map();
  const today = day();
  grouped.set(today, []);
  for (const sale of store.sales || []) {
    if (sale.status && sale.status !== "completed") continue;
    const date = day(sale.createdAt);
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(sale);
  }
  let days = 0, lines = 0;
  for (const [date, sales] of grouped) {
    const totals = {
      "现金销售": 0, "聚合支付收款": 0, "银行卡收款": 0,
      "国补收款": 0, "金币顺差收款": 0, "备用余额收款": 0,
      "销售额": 0, "手机销量": 0,
    };
    for (const sale of sales) {
      const channel = CHANNEL[sale.paymentMethod] || "赊账";
      for (const item of sale.items || []) {
        const amount = round(item.amount);
        totals["销售额"] = round(totals["销售额"] + amount);
        if (["智能机", "功能机", "二手机", "手机", "智能手机"].includes(item.type))
          totals["手机销量"] += item.quantity;
        const column = {
          "现金": "现金销售", "聚合支付": "聚合支付收款",
          "银行卡": "银行卡收款", "国补": "国补收款",
          "金币顺差": "金币顺差收款", "备用余额": "备用余额收款",
        }[channel];
        if (column) totals[column] = round(totals[column] + amount);
        const id = sale.id + ":" + item.id;
        const next = {
          "明细编号": id, "日期": date, "原系统单号": sale.id,
          "商品": item.name, "商品大项": item.type,
          "品牌": item.subType || "", "系列": item.thirdType || "",
          "串码": item.serialNo || "", "数量": item.quantity,
          "现金": channel === "现金" ? amount : 0,
          "聚合支付": channel === "聚合支付" ? amount : 0,
          "银行卡": channel === "银行卡" ? amount : 0,
          "国补": channel === "国补" ? amount : 0,
          "金币顺差": channel === "金币顺差" ? amount : 0,
          "备用余额": channel === "备用余额" ? amount : 0,
          "赊账": channel === "赊账" ? amount : 0,
          "备注": item.note || "",
        };
        const prior = byLine.get(id);
        if (!prior) { await client.create(LINES, next); lines++; }
        else if (!same(prior, next)) { await client.update(LINES, prior.record_id, next); lines++; }
      }
    }
    const prior = byDay.get(date);
    const opening = value(prior, "期初现金");
    const remitted = value(prior, "上缴老板现金");
    const banked = value(prior, "银行存款");
    const expected = round(opening + totals["现金销售"] - remitted - banked);
    const counted = prior?.fields?.["实际点到现金"];
    const next = {
      "日期": date, ...totals, "应有现金": expected,
      "现金差异": counted == null ? 0 : round(Number(counted) - expected),
      "同步时间": new Date().toISOString(),
    };
    if (!prior) {
      await client.create(DAILY, { ...next, "核对结果": "待核对" });
      days++;
    } else if (!same(prior, next)) {
      await client.update(DAILY, prior.record_id, next);
      days++;
    }
  }
  return { days, lines };
}
module.exports = { syncDaily, CHANNEL };
