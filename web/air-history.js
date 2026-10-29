const $ = id => document.getElementById(id);
let previewToken = '', lastPayload = null, lastPreview = null, hasOpening = false, users = [], hasObservation = false, pendingSettlements = [], currentMe = null, draftRows = [], appointedManager = null;
const dateInChina = (timestamp = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
const yesterday = dateInChina(Date.now() - 86400000);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function invalidate() { previewToken = ''; lastPayload = null; lastPreview = null; $('commit').disabled = true; $('result').replaceChildren(); }
async function api(path, body) {
  const options = body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } } : {};
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (response.status === 401) throw new Error('LOGIN');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.message || '请求失败');
  return data;
}
function addRow(kind) {
  const fragment = $('row-template').content.cloneNode(true);
  const row = fragment.querySelector('.entry');
  row.dataset.kind = kind;
  row.querySelector('.kind-title').textContent = kind === 'cash_sale' ? '顾客现金充值' : '给 BOSS 平台充值入金';
  row.querySelector('.sale-fields').hidden = kind !== 'cash_sale';
  row.querySelector('.funding-fields').hidden = kind !== 'funding';
  row.querySelector('.business-date').value = yesterday;
  const options = users.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
  row.querySelector('.handled-by').insertAdjacentHTML('beforeend', options);
  row.querySelector('.received-by').insertAdjacentHTML('beforeend', options);
  row.querySelector('.paid-by').insertAdjacentHTML('beforeend', options);
  row.querySelector('.remove').addEventListener('click', () => { row.remove(); invalidate(); });
  row.querySelector('.capture-button').addEventListener('click', () => row.querySelector('.capture-file').click());
  row.querySelector('.album-button').addEventListener('click', () => row.querySelector('.album-file').click());
  const putPhotoRow = (target, item, value) => {
    const serial = String(value || item?.value || '').trim();
    target.querySelector('.boss-serial').value = serial;
    target.querySelector('.serial-type').value = item?.serialType === 'tail5' || /^[0-9]{5}$/.test(serial) ? 'tail5' : 'full';
    target.querySelector('.business-date').value = item?.businessDate || '';
    target.querySelector('.occurred-at').value = item?.businessDate && item?.occurredAt ? item.businessDate + 'T' + item.occurredAt : '';
    if (target.dataset.kind === 'cash_sale' && item?.amount != null) target.querySelector('.amount').value = String(item.amount);
    if (target.dataset.kind === 'cash_sale' && item?.customerPhone) target.querySelector('.customer-phone').value = item.customerPhone;
    target.querySelector('.note').value = '照片识别候选；请对照BOSS原图逐项核对后再入账';
  };
  const recognize = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const label = row.querySelector('.capture-status');
    if (!window.BossSerialCapture?.pick) { label.textContent = '当前拍照识别尚未接通，请手填流水号'; return; }
    label.textContent = '正在识别，请稍候…';
    try {
      const result = await window.BossSerialCapture.pick({ file, context: 'air-history' });
      const photoRows = Array.isArray(result?.rows) ? result.rows.filter(item => item && (item.value || item.amount != null || item.customerPhone)) : [];
      if (photoRows.length > 1) {
        if (!confirm('照片识别出 ' + photoRows.length + ' 笔候选。将逐笔填入表格供核对；不会自动入账。继续吗？')) return;
        const useCurrent = !val(row, '.boss-serial') && !val(row, '.amount') && !val(row, '.customer-phone');
        photoRows.forEach((item, index) => {
          const target = index === 0 && useCurrent ? row : addRow(row.dataset.kind);
          putPhotoRow(target, item);
        });
        invalidate();
        status('已填入 ' + photoRows.length + ' 笔照片识别候选。完整号、金额、时间和手机号请逐笔对照原图；现金实收及经办/收款人仍须人工核实。');
        return;
      }
      if (!result?.value && !photoRows.length) { label.textContent = '没有识别出清晰流水号，请查看照片后手填'; return; }
      const item = photoRows[0] || {};
      putPhotoRow(row, item, result.value);
      label.textContent = result.value ? '已填入识别候选，请逐项对照原图核对' : '只辨认出部分字段，流水号请手填并核对';
      invalidate();
    } catch (error) { label.textContent = '识别失败：' + (error.message || '请手填'); }
    finally { event.target.value = ''; }
  };  row.querySelector('.capture-file').addEventListener('change', recognize);
  row.querySelector('.album-file').addEventListener('change', recognize);
  $('rows').append(row);
  invalidate();
  return row;
}
function loadKnownRows() {
  if ($('rows').children.length && !confirm('当前已填有单据。确定追加三笔10月15日待核对记录？请避免重复载入。')) return;
  const known = [['12:31:05', '50', '04289'], ['13:13:15', '30', '33742'], ['13:58:35', '130', '79121']];
  for (const [time, amount, tail] of known) {
    const row = addRow('cash_sale');
    row.querySelector('.business-date').value = '2026-10-15';
    row.querySelector('.occurred-at').value = `2026-10-15T${time}`;
    row.querySelector('.serial-type').value = 'tail5';
    row.querySelector('.boss-serial').value = tail;
    row.querySelector('.amount').value = amount;
    row.querySelector('.cash-received').value = '';
    row.querySelector('.note').value = '依据2026-10-15 BOSS截图，待核对实际经办人、手机号和现金交接';
  }
  status('三笔截图记录已预填，仍缺经办人、现金收款人、手机号和现金实收确认；核实前可按待归属草稿提交；店长和老板批准后才入账。');
}
function val(row, selector) { return row.querySelector(selector)?.value?.trim() || ''; }
function readRow(row) {
  const kind = row.dataset.kind;
  const date = val(row, '.business-date');
  const local = val(row, '.occurred-at');
  const common = { kind, businessDate: date, occurredAt: local ? local + (local.length === 16 ? ':00+08:00' : '+08:00') : '',
    bossSerial: val(row, '.boss-serial'), serialType: val(row, '.serial-type'), note: val(row, '.note') };
  if (kind === 'cash_sale') return { ...common, amount: val(row, '.amount'), cashReceived: val(row, '.cash-received'),
    customerPhone: val(row, '.customer-phone'), handledByUserId: val(row, '.handled-by'),
    cashReceivedByUserId: val(row, '.received-by'), cashConfirmed: row.querySelector('.cash-confirmed').checked };
  return { ...common, paidAmount: val(row, '.paid-amount'), creditedAmount: val(row, '.credited-amount'),
    method: val(row, '.method'), bankRef: val(row, '.bank-ref'), paidByUserId: val(row, '.paid-by') };
}
function payload() {
  const data = { rows: [...document.querySelectorAll('#rows .entry')].map(readRow) };
  if (!hasOpening) data.opening = { businessDate: $('opening-date').value, amount: $('opening-amount').value, sourceNote: $('opening-source').value.trim() };
  if (!hasObservation && $('balance-amount').value.trim()) data.observation = { businessDate: $('balance-date').value,
    balance: $('balance-amount').value, sourceNote: $('balance-source').value.trim() };
  return data;
}
function renderPreview(result) {
  const rows = result.rows || [];
  const ok = !result.hasMismatch;
  $('result').innerHTML = `<div class="summary ${ok ? '' : 'mismatch'}">账面期末 ¥${Number(result.bookBalance).toFixed(2)} · BOSS显示 ${result.observedBalance == null ? '未填写' : '¥' + Number(result.observedBalance).toFixed(2)}${result.difference == null ? '' : ` · 差额 ¥${Number(result.difference).toFixed(2)}`}<p>${esc(result.note)}</p></div><ol class="result-list">${rows.map(row => `<li>${esc(row.businessDate)} ${esc(row.occurredAt ? new Date(row.occurredAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '')} · ${esc(row.kind === 'opening' ? '期初' : row.kind === 'customer_recharge' ? '顾客充值' : row.kind === 'funding' ? '平台入金' : '余额观察')} · ${row.serialTail5 ? esc(row.serialType === 'full' ? '完整号 ' + row.platformRef : '尾5位 ' + row.serialTail5) + ' · ' : ''}${row.operator ? '经办 ' + esc(row.operator) + ' · ' : ''}${row.cashReceiver ? '现金收款 ' + esc(row.cashReceiver) + ' · ' : ''}${Number(row.amount || 0) >= 0 ? '+' : ''}¥${Number(row.amount || 0).toFixed(2)} · 余额 ¥${Number(row.balance || 0).toFixed(2)}</li>`).join('')}</ol>`;
  const pendingCount = rows.filter(row => row.settlementStatus === '待归属待收款核对').length;
  if (pendingCount) $('result').insertAdjacentHTML('afterbegin', '<p class="evidence">其中 ' + pendingCount + ' 笔为待归属、待现金核对：只影响BOSS余额，暂不记现金到账；稍后在本页补核原单。</p>');
}
async function preview() {
  invalidate();
  try {
    const data = payload();
    status('正在核对历史流水和现有台账…');
    const result = await api('/api/air-recharge/history', { ...data, action: 'preview' });
    previewToken = result.token; lastPayload = data; lastPreview = result;
    renderPreview(result);
    $('commit').disabled = false;
    status(result.hasMismatch ? '预览完成：存在差额，请核对遗漏或重复的真实单据。' : '预览完成：请核对每笔与余额后确认。', result.hasMismatch);
  } catch (error) { status(error.message === 'LOGIN' ? '请先登录工作账号。' : error.message, true); }
}
async function commit() {
  if (!previewToken || !lastPayload || !lastPreview) return;
  if (currentMe?.roleCode === 'owner') { status('请由营业员或店长提交补单，您在待审批区终审。', true); return; }
  if (lastPreview.hasMismatch && !lastPreview.observationOnly) { status('账面与BOSS余额不一致，请先核对真实单据。', true); return; }
  const count = (lastPayload.rows || []).length;
  const pending = (lastPreview.rows || []).filter(row => row.settlementStatus === '待归属待收款核对').length;
  const next = currentMe?.id === appointedManager?.id ? '老板终审' : '店长初审，再由老板终审';
  if (!confirm('提交 ' + count + ' 笔历史交易及期初/余额资料给' + next + '？审批前不影响BOSS平台余额或现金账。' + (pending ? '其中 ' + pending + ' 笔现金和人员待核。' : ''))) return;
  $('commit').disabled = true;
  try {
    const result = await api('/api/air-recharge/history', { ...lastPayload, action: 'submit', previewToken });
    status(result.message || '补单已提交审批，尚未入账。');
    $('result').insertAdjacentHTML('afterbegin', '<p class="summary">已提交审批；在老板终审前，今天的充值单仍须等待期初入账。</p>');
    invalidate();
    await loadOpening();
  } catch (error) { status(error.message === 'LOGIN' ? '请先登录工作账号。' : error.message, true); }
}
async function saveObservation() {
  if (hasObservation) return;
  const observation = { businessDate: $('balance-date').value, balance: $('balance-amount').value,
    sourceNote: $('balance-source').value.trim() };
  if (!observation.balance || !observation.sourceNote) { status('请填写BOSS显示余额和核对依据。', true); return; }
  if (!confirm(`提交 ${observation.businessDate} BOSS显示余额观察资料 ¥${Number(observation.balance).toFixed(2)}；店长和老板审批前不入账。确认提交？`)) return;
  $('save-observation').disabled = true;
  try {
    const data = { rows: [], observation };
    const first = await api('/api/air-recharge/history', { ...data, action: 'preview' });
    if (!first.observationOnly) throw new Error('余额观察流程不正确');
    await api('/api/air-recharge/history', { ...data, action: 'submit', previewToken: first.token });
    invalidate();
    await loadOpening();
    status('BOSS余额观察资料已提交审批，未生成财务交易。');
  } catch (error) { status(error.message === 'LOGIN' ? '请先登录工作账号。' : error.message, true); $('save-observation').disabled = false; }
}
function renderPendingSettlements(history) {
  pendingSettlements = history.filter(row => row.settlementStatus === '待归属待收款核对');
  $('pending-settlements').innerHTML = pendingSettlements.length
    ? pendingSettlements.map(row => {
        const amount = Number(row.cashExpected ?? Math.abs(Number(row.amount || 0)));
        const serial = row.reference || row.platformRef || row.serialTail5 || '';
        const label = row.serialType === 'tail5' ? '尾5位 ' : '流水 ';
        return '<article class="pending-row"><strong>' + esc(row.businessDate) + ' · BOSS扣款 ¥' + amount.toFixed(2) + '</strong><small>' + esc(label + serial) + ' · 尚未核实现金收款与经办人</small><button type="button" data-settle-id="' + esc(row.id) + '">补人员与现金核对</button></article>';
      }).join('')
    : '<p>目前没有待补人员或现金核对的历史单。</p>';
}
function openSettlement(row) {
  const dialog = $('settle-dialog'), form = $('settle-form');
  form.reset();
  dialog.dataset.id = row.id;
  const amount = Number(row.cashExpected ?? Math.abs(Number(row.amount || 0)));
  $('settle-info').textContent = row.businessDate + ' · BOSS扣款 ¥' + amount.toFixed(2) + ' · 原单 ' + (row.reference || row.platformRef || row.serialTail5 || row.id);
  const options = users.map(user => '<option value="' + esc(user.id) + '">' + esc(user.name) + '</option>').join('');
  for (const name of ['handledByUserId', 'cashReceivedByUserId']) form.elements[name].innerHTML = '<option value="">请选择真实人员</option>' + options;
  form.elements.cashReceived.value = amount.toFixed(2);
  $('settle-error').textContent = '';
  dialog.showModal();
}
function renderDrafts(result) {
  appointedManager = result.manager;
  draftRows = result.drafts || [];
  $('manager-label').textContent = appointedManager ? '现任店长：' + appointedManager.name + '。营业员补单由店长初审、老板终审；店长本人补单直接送老板。' : '尚未任命有效店长，请先在人事管理任命。';
  const params = new URLSearchParams(location.search);
  const focusedId = params.get('draft'), pendingOnly = params.get('mine') === 'pending';
  const visibleRows = focusedId ? draftRows.filter(row => row.id === focusedId) :
    pendingOnly ? draftRows.filter(row => currentMe.roleCode === 'owner' ? row.status === '待老板终审' :
      row.status === '待店长初审' && row.managerId === currentMe.id) : draftRows;
  const focusHeader = focusedId || pendingOnly ? '<p><a href="/air-history">‹ 查看全部历史补单</a></p>' : '';
  $('approval-list').innerHTML = focusHeader + (visibleRows.length ? visibleRows.map(row => {
    const canManager = currentMe.id === appointedManager?.id && row.managerId === currentMe.id && row.status === '待店长初审' && row.submittedById !== currentMe.id;
    const canOwnerApprove = currentMe.roleCode === 'owner' && row.status === '待老板终审';
    const canOwnerReject = currentMe.roleCode === 'owner' && row.status === '待店长初审';
    const detail = (row.rows || []).map(item => {
      const kind = item.kind === 'opening' ? '期初' : item.kind === 'customer_recharge' ? '顾客充值' : item.kind === 'funding' ? '平台入金' : '余额观察';
      const lines = [esc(item.businessDate) + ' · ' + kind + ' · ¥' + Number(item.amount || 0).toFixed(2)];
      if (item.serialTail5) lines.push(esc(item.serialType === 'full' ? '完整流水号 ' + item.platformRef : '流水尾5位 ' + item.serialTail5));
      if (item.kind === 'customer_recharge') {
        lines.push(esc(item.settlementStatus || '待核对'));
        lines.push('应收现金 ¥' + Number(item.cashExpected || 0).toFixed(2));
        lines.push(item.cashReceived == null ? '现金实收待核，不入现金账' : '确认现金实收 ¥' + Number(item.cashReceived).toFixed(2));
        if (item.operator) lines.push('经办 ' + esc(item.operator));
        if (item.cashReceiver) lines.push('现金收款 ' + esc(item.cashReceiver));
        if (item.customerMask) lines.push('顾客 ' + esc(item.customerMask));
      }
      if (item.kind === 'funding') {
        lines.push('实际转出 ¥' + Number(item.paidAmount || 0).toFixed(2));
        if (item.method) lines.push('方式 ' + esc(item.method));
        if (item.bankRef) lines.push('转出凭证 ' + esc(item.bankRef));
        if (item.payer) lines.push('付款人 ' + esc(item.payer));
      }
      if (item.note || item.sourceNote) lines.push('依据 ' + esc(item.note || item.sourceNote));
      return '<li>' + lines.join(' · ') + '</li>';
    }).join('');
    const actions = canManager || canOwnerApprove ? '<button class="confirm" data-review="approve" data-id="' + esc(row.id) + '">审核通过</button>' : '';
    const reject = canManager || canOwnerApprove || canOwnerReject ? '<button class="remove" data-review="reject" data-id="' + esc(row.id) + '">驳回</button>' : '';
    return '<article class="approval-row"><strong>' + esc(row.status) + ' · ' + esc(row.submittedBy) + '</strong><small>提交 ' + esc(row.submittedAt) + ' · 店长 ' + esc(row.managerName) + ' · 预览账面 ¥' + Number(row.bookBalance).toFixed(2) + ' · 终审现金净变动 ¥' + Number(row.receiptChange || 0).toFixed(2) + '</small>' +
      (row.status === '待店长初审' && appointedManager?.id !== row.managerId ? '<p class="error">任命店长已变化，此申请不能由旧店长审批。请老板驳回后让营业员重新提交。</p>' : '') +
      (row.managerBypassed ? '<p>店长本人提交，跳过本人初审，由老板终审。</p>' : row.managerApproval ? '<p>店长已初审：' + esc(row.managerApproval.by) + '</p>' : '') +
      (row.rejectReason ? '<p>驳回原因：' + esc(row.rejectReason) + '</p>' : '') +
      '<details><summary>查看本单逐笔依据</summary><ol>' + detail + '</ol><p>期初依据：' + esc(row.openingSource || '无') + '；BOSS余额依据：' + esc(row.observationSource || '无') + '</p></details><div class="actions">' + actions + reject + '</div></article>';
  }).join('') : focusedId ? '<p>未找到这张补单，可能已撤回或您没有查看权限。</p>' : pendingOnly ? '<p>目前没有待您审批的历史补单。</p>' : '<p>目前没有历史补单草稿。</p>');
}
async function loadOpening() {
  currentMe = await api('/api/me');
  const balance = await api('/api/air-recharge/balance');
  hasOpening = balance.hasOpening;
  $('opening-section').hidden = hasOpening;
  users = await api('/api/users');
  renderDrafts(await api('/api/air-recharge/history/drafts'));
  $('commit').hidden = currentMe.roleCode === 'owner';
  $('save-observation').hidden = currentMe.roleCode === 'owner';
  $('commit').textContent = currentMe.id === appointedManager?.id ? '提交老板终审' : '提交店长初审';
  const history = await api('/api/air-recharge/history');
  $('pending-section').hidden = currentMe.roleCode !== 'owner';
  if (currentMe.roleCode === 'owner') renderPendingSettlements(history);
  const observed = history.find(row => row.kind === 'observed_balance' && row.businessDate === $('balance-date').value);
  hasObservation = Boolean(observed);
  $('balance-section').hidden = hasObservation;
  $('recorded-observation').hidden = !hasObservation;
  if (observed) $('recorded-observation').textContent = `${observed.businessDate} BOSS显示余额已记录 ¥${Number(observed.observedBalance).toFixed(2)}；请结合正式账面核对。`;
}
$('approval-list').addEventListener('click', async event => {
  const button = event.target.closest('button[data-review]');
  if (!button) return;
  const row = draftRows.find(item => item.id === button.dataset.id);
  if (!row) { status('这张补单已变化，请刷新。', true); return; }
  const decision = button.dataset.review;
  let note = '';
  if (decision === 'reject') {
    note = prompt('请填写驳回原因，营业员会看到：') ?? '';
    if (!note.trim()) { status('驳回需要说明原因。', true); return; }
  } else if (!confirm('确认通过这张历史补单？' + (currentMe.roleCode === 'owner' ? '老板终审通过后才会正式影响BOSS平台余额与已核实现金。' : '初审通过后转老板终审，暂不入账。'))) return;
  button.disabled = true;
  try {
    const result = await api('/api/air-recharge/history', {action:'review',id:row.id,version:row.version,decision,note});
    await loadOpening();
    status(result.message || '审批已处理。');
  } catch (error) { status(error.message === 'LOGIN' ? '请先登录工作账号。' : error.message, true); }
  finally { button.disabled = false; }
});
$('pending-settlements').addEventListener('click', event => {
  const button = event.target.closest('button[data-settle-id]');
  if (!button) return;
  const row = pendingSettlements.find(item => item.id === button.dataset.settleId);
  if (row) openSettlement(row);
});
$('settle-cancel').addEventListener('click', () => $('settle-dialog').close());
$('settle-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button[type=submit]');
  if (!form.reportValidity()) return;
  const row = pendingSettlements.find(item => item.id === $('settle-dialog').dataset.id);
  if (!row) { $('settle-error').textContent = '原单已变化，请刷新后重试。'; return; }
  const data = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try {
    const result = await api('/api/air-recharge/history', { action: 'settle', id: row.id,
      handledByUserId: data.handledByUserId, cashReceivedByUserId: data.cashReceivedByUserId,
      customerPhone: String(data.customerPhone || '').trim(), cashReceived: Number(data.cashReceived),
      cashConfirmed: form.elements.cashConfirmed.checked, note: String(data.note || '').trim() });
    $('settle-dialog').close();
    await loadOpening();
    status('原单已补核：经办 ' + (result.operator || '') + '，现金收款 ' + (result.cashReceiver || '') + ' ¥' + Number(result.cashReceived).toFixed(2) + '；未重复扣减BOSS余额。');
  } catch (error) { $('settle-error').textContent = error.message === 'LOGIN' ? '请先登录工作账号。' : error.message; }
  finally { button.disabled = false; }
});document.addEventListener('input', event => { if (event.target.closest('input,select')) invalidate(); });
document.addEventListener('change', event => { if (event.target.closest('input,select')) invalidate(); });
$('add-sale').addEventListener('click', () => addRow('cash_sale'));
$('load-known').addEventListener('click', loadKnownRows);
$('add-funding').addEventListener('click', () => addRow('funding'));
$('preview').addEventListener('click', preview);
$('commit').addEventListener('click', commit);
$('save-observation').addEventListener('click', saveObservation);
$('opening-date').value = yesterday;
$('balance-date').value = yesterday;
if (yesterday === '2026-10-15') {
  $('balance-amount').value = '628';
  $('balance-source').value = '老板确认2026-10-15移动BOSS显示余额628元；原始余额凭证待核对';
}
loadOpening().then(() => status('已读取台账。请录入真实业务记录后预览。')).catch(error => status(error.message === 'LOGIN' ? '请先从登录页用老板账号登录。' : error.message, true));
