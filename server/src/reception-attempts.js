const c = require('./common');

function list(store, user) {
  const all = store.receptionAttempts || [];
  return all.filter((row) => user.roleCode === 'owner' || row.userId === user.id).slice(0, 100);
}
function failed(store, user, body, requestKey, error) {
  store.receptionAttempts ||= [];
  const phone = String(body?.phone || '').trim();
  const row = {
    id: c.id('REFAIL'),
    requestKey: String(requestKey || '').slice(0, 160),
    userId: user.id,
    userName: user.name,
    customerMask: /^1[3-9]\d{9}$/.test(phone) ? phone.slice(0, 3) + '****' + phone.slice(-4) : (phone ? '手机号格式不符' : '未填手机号'),
    purpose: String(body?.purpose || '').trim().slice(0, 40),
    reason: error.statusCode ? error.message : '服务器处理失败，请稍后重试',
    statusCode: error.statusCode || 500,
    createdAt: c.now(),
  };
  store.receptionAttempts.unshift(row);
  return row;
}
module.exports = { list, failed };
