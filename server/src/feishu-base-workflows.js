const { readStore, transaction } = require("./repository");
const { inventoryRows } = require("./feishu-inventory");
const { permit } = require("./common");
const erp = require("./erp");

const TABLES = Object.freeze({
  inventory: "tblKCyoERJgjNPGD",
  products: "tblA1T3SxRQgAR9o",
  taxonomy: "tblTqpzX7hhQZR8V",
  sales: "tbl7oh0eGifVLXA7",
  saleItems: "tblZqkEzG4Laf8xu",
  suppliers: "tblei1uZzICsZ4jK",
  purchases: "tblKLpTrj0EANMIb",
  purchaseItems: "tblg0YIc6YyRxubz",
  stocktakes: "tblY24v5AMR8h4Pq",
});
const text = (value) => Array.isArray(value)
  ? value.map((part) => part && part.text || "").join("")
  : String(value == null ? "" : value);
const links = (value) => value && value.link_record_ids || (Array.isArray(value) ? value : []);
function oneLink(value, label) {
  const ids = links(value);
  if (ids.length !== 1) throw new Error("请选择一个" + label);
  return ids[0];
}
function positiveInt(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("数量必须是正整数");
  return number;
}
function money(value, label) {
  const number = Number(value);
  if (value == null || value === "" || !Number.isFinite(number) || number < 0)
    throw new Error(label + "不正确");
  return number;
}
class Bitable {
  constructor(env = process.env, fetcher = fetch) {
    this.app = env.FEISHU_BASE_APP_TOKEN;
    this.id = env.APP_ID || env.FEISHU_APP_ID;
    this.secret = env.APP_SECRET || env.FEISHU_APP_SECRET;
    this.fetcher = fetcher;
    this.token = "";
    this.expires = 0;
    if (!this.app || !this.id || !this.secret) throw new Error("缺少飞书多维表格配置");
  }
  async request(path, method = "GET", payload, authenticated = true) {
    if (authenticated && (!this.token || Date.now() >= this.expires)) await this.authenticate();
    const response = await this.fetcher("https://open.feishu.cn/open-apis" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: "Bearer " + this.token } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.code !== 0)
      throw new Error("飞书接口失败 " + response.status + "/" + (body.code == null ? "?" : body.code) + ": " + (body.msg || "未知错误"));
    return body;
  }
  async authenticate() {
    const body = await this.request("/auth/v3/tenant_access_token/internal", "POST", {
      app_id: this.id, app_secret: this.secret,
    }, false);
    this.token = body.tenant_access_token;
    this.expires = Date.now() + Math.max(60, (body.expire || 7200) - 120) * 1000;
  }
  path(table) {
    return "/bitable/v1/apps/" + encodeURIComponent(this.app) + "/tables/" + encodeURIComponent(table) + "/records";
  }
  async list(table) {
    const result = [];
    let page;
    do {
      const query = new URLSearchParams({ page_size: "500", automatic_fields: "true" });
      if (page) query.set("page_token", page);
      const response = await this.request(this.path(table) + "?" + query);
      result.push(...(response.data && response.data.items || []));
      page = response.data && response.data.has_more ? response.data.page_token : null;
      if (response.data && response.data.has_more && !page) throw new Error("飞书分页缺少标记");
    } while (page);
    return result;
  }
  async update(table, recordId, fields) {
    return this.request(this.path(table) + "/" + encodeURIComponent(recordId), "PUT", { fields });
  }
  async create(table, fields) {
    return this.request(this.path(table), "POST", { fields });
  }
}
function actor(store, record, capability) {
  const creator = record.created_by && record.created_by.id;
  const editor = record.last_modified_by && record.last_modified_by.id;
  if (!creator || creator !== editor)
    throw new Error("请由本人创建并提交记录；代改的记录不能直接入账");
  const user = store.users.find((entry) => entry.feishuOpenId === creator && entry.status === "active");
  if (!user) throw new Error("飞书账号尚未绑定在职员工");
  permit(user, capability);
  return user;
}
function productByLink(row, field, catalog, store) {
  const record = catalog.get(oneLink(row.fields && row.fields[field], field));
  if (!record) throw new Error("所选商品档案不存在");
  const code = text(record.fields && record.fields["商品编号"]).trim();
  const product = store.products.find((entry) => entry.externalCode === code && entry.active !== false);
  if (!product) throw new Error("商品 " + code + " 已失效");
  return product;
}
function once(store, key, fn) {
  store.feishuJobs ||= [];
  const prior = store.feishuJobs.find((entry) => entry.key === key);
  if (prior) return prior.result;
  const result = fn();
  store.feishuJobs.push({ key, result, at: new Date().toISOString() });
  return result;
}
async function finish(client, table, record, fields) {
  await client.update(table, record.record_id, { "提交处理": false, ...fields });
}
async function fail(client, table, record, error) {
  await finish(client, table, record, {
    "处理状态": "失败", "处理说明": String(error.message || error).slice(0, 500),
  });
}
function requested(records) {
  return records.filter((record) => record.fields && record.fields["提交处理"] === true &&
    text(record.fields["处理状态"]) !== "已完成");
}
function ownLines(records, parentId, linkField, openId) {
  const lines = records.filter((record) => links(record.fields && record.fields[linkField]).includes(parentId));
  if (!lines.length) throw new Error("请先填写本单商品明细");
  if (lines.some((line) => !openId || line.created_by && line.created_by.id !== openId ||
      line.last_modified_by && line.last_modified_by.id !== openId))
    throw new Error("商品明细须由开单人本人填写");
  return lines;
}
function salePayload(header, lines, catalog, store, user) {
  const salespersonName = text(header.fields["销售人"]).trim();
  const salesperson = salespersonName
    ? store.users.find((entry) => entry.name === salespersonName && entry.status === "active")
    : user;
  if (!salesperson) throw new Error("销售人不是在职员工");
  return {
    salespersonId: salesperson.id,
    customerName: text(header.fields["顾客姓名"]).trim(),
    customerPhone: text(header.fields["顾客手机号"]).trim(),
    orderNote: text(header.fields["备注"]).trim(),
    invoiceType: text(header.fields["开票需求"]).trim(),
    account: text(header.fields["收款渠道"]).trim() || text(header.fields["收款方式"]).trim() || "微信",
    items: lines.map((line) => {
      const product = productByLink(line, "商品", catalog, store);
      const count = positiveInt(line.fields["数量"]);
      const serialNo = text(line.fields["串码"]).trim();
      if (product.trackSerial && (count !== 1 || !serialNo))
        throw new Error("串码商品每行只能填 1 件，且必须填写串码");
      if (!product.trackSerial && serialNo) throw new Error("普通商品不需要填写串码");
      return {
        skuId: product.skuId, quantity: count,
        salePrice: money(line.fields["实际售价"], "实际售价"),
        serialNo, noMaterials: line.fields["确认无耗材"] === true, note: text(line.fields["备注"]),
      };
    }),
  };
}
async function processSales(client, read = readStore, transact = transaction) {
  const [headers, rows, catalogRows] = await Promise.all([
    client.list(TABLES.sales), client.list(TABLES.saleItems), client.list(TABLES.products),
  ]);
  const catalog = new Map(catalogRows.map((entry) => [entry.record_id, entry]));
  let processed = 0, failed = 0;
  for (const header of requested(headers)) {
    try {
      const store = read();
      const user = actor(store, header, "sell");
      const lines = ownLines(rows, header.record_id, "所属销售单", user.feishuOpenId);
      const payload = salePayload(header, lines, catalog, store, user);
      const result = transact((current) => once(current, "sale:" + header.record_id,
        () => erp.sale(current, user, payload)));
      await finish(client, TABLES.sales, header, {
        "处理状态": "已完成", "原系统单号": result.id,
        "应收金额": result.amount, "处理说明": "已扣库存并记录收款",
      });
      processed++;
    } catch (error) {
      await fail(client, TABLES.sales, header, error);
      failed++;
    }
  }
  return { processed, failed };
}
async function processStocktakes(client, read = readStore, transact = transaction) {
  const [headers, catalogRows] = await Promise.all([
    client.list(TABLES.stocktakes), client.list(TABLES.products),
  ]);
  const catalog = new Map(catalogRows.map((entry) => [entry.record_id, entry]));
  let processed = 0, failed = 0;
  for (const header of requested(headers)) {
    try {
      const store = read();
      const user = actor(store, header, "stocktake");
      const product = productByLink(header, "商品", catalog, store);
      const warehouse = text(header.fields["仓库"]).trim();
      if (warehouse && warehouse !== "销售仓") throw new Error("当前仅支持销售仓盘点");
      const actual = Number(header.fields["实盘数量"]);
      const expected = Number(header.fields["账面数量"]);
      if (!Number.isSafeInteger(actual) || actual < 0 ||
          !Number.isSafeInteger(expected) || expected < 0)
        throw new Error("请填写有效的实盘数量和账面数量");
      const result = transact((current) => once(current, "stocktake:" + header.record_id,
        () => erp.stocktake(current, user, {
          skuId: product.skuId, actual, expected,
          reason: text(header.fields["差异原因"]),
        })));
      await finish(client, TABLES.stocktakes, header, {
        "处理状态": "已完成", "处理说明": "已入账：" + result.id,
      });
      processed++;
    } catch (error) {
      await fail(client, TABLES.stocktakes, header, error);
      failed++;
    }
  }
  return { processed, failed };
}
async function syncInventory(client, store = readStore()) {
  const existing = new Map((await client.list(TABLES.inventory))
    .map((row) => [text(row.fields && row.fields["库存键"]), row]));
  let changed = 0;
  for (const fields of inventoryRows(store)) {
    const prior = existing.get(fields["库存键"]);
    const same = prior && Object.entries(fields).every(([name, value]) =>
      name === "同步时间" || (typeof value === "number"
        ? Number(prior.fields[name]) === value : text(prior.fields[name]) === value));
    if (same) continue;
    if (prior) await client.update(TABLES.inventory, prior.record_id, fields);
    else await client.create(TABLES.inventory, fields);
    changed++;
  }
  return changed;
}
module.exports = {
  TABLES, Bitable, text, links, actor, salePayload, processSales, processStocktakes, syncInventory,
};




