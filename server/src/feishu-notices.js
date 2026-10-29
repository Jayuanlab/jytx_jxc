const { readStore, transaction } = require("./repository");
const { TABLES, text, links, actor } = require("./feishu-base-workflows");
const { permit } = require("./common");
const erp = require("./erp");

function notice(store, key, kind, order) {
  store.feishuNotices ||= [];
  if (store.feishuNotices.some((row) => row.key === key)) return;
  const summary = order.summary || (kind === "盘点" ? order.product + " 实盘 " + order.actual + "，差异 " + order.delta
    : order.items.map((item) => item.name + " × " + item.quantity).join("，"));
  store.feishuNotices.push({
    key, kind, orderId: order.id, summary,
    ...(order.receiptId ? {receiptId:order.receiptId} : {}),
    ...(order.category ? {category:order.category} : {}),
    amount: kind === "盘点" || kind === "交班待确认" ? null : order.amount,
    createdAt: new Date().toISOString(), readAt: null,
    sentAt: null, attempts: 0,
  });
}
async function sendNotices(client, read = readStore, transact = transaction) {
  const store = read();
  const owner = store.users.find((user) =>
    user.roleCode === "owner" && user.status === "active" && user.feishuOpenId);
  if (!owner) throw new Error("未绑定老板飞书账号，无法发送单据通知");
  let sent = 0, failed = 0;
  for (const notice of store.feishuNotices || []) {
    if (notice.sentAt||require('./air-workflow-policy').noticeState(store,notice)||require('./reception-availability').notice(store,notice)) continue;
    try {
      const content = {
        text: (notice.kind === "交班待确认" ? "聚友通信城 交班待确认\n" : notice.kind === "系统预警" ? "聚友通信城 系统预警\n" : (notice.kind.startsWith("移动业务") || notice.kind.startsWith("国补")) ? "聚友通信城 " + notice.kind + "\n" : "聚友通信城 " + notice.kind + (/待|申请|异议|差异|预警|请求/.test(notice.kind)?"\n":" · 已登记\n")) +
          (notice.kind === "系统预警" ? "异常编号：" : notice.kind === "交班待确认" ? "交班单号：" : "单号：") + notice.orderId + "\n" +
          "明细：" + notice.summary +
          (notice.amount == null ? "" : "\n金额：" + notice.amount + " 元"),
      };
      await client.request("/im/v1/messages?receive_id_type=open_id", "POST", {
        receive_id: owner.feishuOpenId, msg_type: "text",
        content: JSON.stringify(content),
      });
      transact((current) => {
        const row = (current.feishuNotices || []).find((item) => item.key === notice.key);
        if (row) { row.sentAt = new Date().toISOString(); row.attempts++; row.lastError = null; }
      });
      sent++;
    } catch (error) {
      transact((current) => {
        const row = (current.feishuNotices || []).find((item) => item.key === notice.key);
        if (row) { row.attempts++; row.lastError = String(error.message || error).slice(0, 300); }
      });
      failed++;
    }
  }
  return { sent, failed };
}
module.exports = { notice, sendNotices };

