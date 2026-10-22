const c = require('./common');
function allNotices(store) { return [...(store.feishuNotices || []), ...(store.localCatalogNotices || [])].sort((a, b) => Date.parse(a.createdAt || a.sentAt || 0) - Date.parse(b.createdAt || b.sentAt || 0)); }
function list(store, user) {
  c.permit(user, 'manageUsers');
  const rows = allNotices(store).reverse().slice(0, 500);
  return { unread: rows.filter((row) => !row.readAt).length,
    rows: rows.map(({ key, kind, orderId, summary, amount, createdAt, sentAt, readAt }) =>
      ({ key, kind, orderId, summary, amount, createdAt: createdAt || sentAt || null, readAt: readAt || null })) };
}
function read(store, user, payload) {
  c.permit(user, 'manageUsers');
  const all = payload.all === true;
  const key = String(payload.key || '');
  if (!all && !key) throw new c.HttpError(400, '请选择一条消息');
  let updated = 0;
  for (const row of allNotices(store)) {
    if ((all || row.key === key) && !row.readAt) { row.readAt = c.now(); updated++; }
  }
  if (!all && !allNotices(store).some((row) => row.key === key))
    throw new c.HttpError(404, '消息不存在');
  c.audit(store, user, 'notice:read', all ? '全部已阅 '+updated+' 条' : key);
  return { updated };
}
module.exports = { list, read };

