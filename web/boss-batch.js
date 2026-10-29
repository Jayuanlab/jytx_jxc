const $ = id => document.getElementById(id);
const E = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const short = (value, max = 92) => { const text = String(value ?? '').trim(); return text.length > max ? text.slice(0, max) + '…' : text; };
async function api(path, options) {
  const headers = { ...options?.headers, ...(options?.method === 'POST' ? {'Idempotency-Key':crypto.randomUUID()} : {}) };
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || data.message || '请求失败');
  return data;
}
let latest = { groups:[] }, busy = false;
const focusCatalogId = new URLSearchParams(location.search).get('catalogReview');
const focusJournalId = new URLSearchParams(location.search).get('journal');
const selected = new Map();
const readyRows = group => group.rows.filter(row => row.prelim?.level === 'ready');
const readyTotal = () => latest.groups.reduce((n, group) => n + readyRows(group).length, 0);
function syncSelectionUI() {
  for (const input of $('groups').querySelectorAll('input[type=checkbox][data-key]')) {
    input.checked = !input.disabled && Boolean(selected.get(input.dataset.key)?.has(input.dataset.id));
    input.closest('.batch-row')?.classList.toggle('is-selected', input.checked);
  }
}
function showResult(title, message, tone) {
  const dialog = $('batch-result');
  $('batch-result-title').textContent = title;
  $('batch-result-message').textContent = message;
  dialog.dataset.tone = tone;
  $('batch-result-close').hidden = tone === 'working';
  if (!dialog.open) dialog.showModal();
}
const selectedIds = group => [...(selected.get(group.key) || [])].filter(id => readyRows(group).some(row => row.id === id));
function totalSelected() { return latest.groups.reduce((n, group) => n + selectedIds(group).length, 0); }
function updateCount() {
  const count = totalSelected();
  $('selected-count').textContent = '已勾选 ' + count + ' 条';
  $('bottom-selected-count').textContent = '已勾选 ' + count + ' 条';
  $('confirm-selected-bottom').disabled = busy || count === 0;
  $('confirm-selected').disabled = busy || count === 0;
  $('clear-selected').disabled = busy || count === 0;
  $('select-all-ready').disabled = busy || readyTotal() === 0;
  $('select-all-ready').textContent = '✔ 全选可批项（' + readyTotal() + '）';
  syncSelectionUI();
}
function sourceLink(group, row) {
  if (group.kind === 'journal') return '/work-journal?highlight=' + encodeURIComponent(row.id);
  if (group.kind === 'catalog') return '/app?tab=purchase&catalogReview=' + encodeURIComponent(row.id) + '#catalog-reviews';
  return '/receptions?highlight=' + encodeURIComponent(row.id);
}
function actionText(group) {
  return group.kind === 'catalog' ? '确认档案' : group.kind === 'receptionDuplicate' ? '判无效，0积分' : '核定工作日志积分';
}
function render(data) {
  const focusedKind = focusCatalogId ? 'catalog' : focusJournalId ? 'journal' : '';
  const focusedId = focusCatalogId || focusJournalId;
  if (focusedKind) data = {...data, groups:data.groups.filter(group => group.kind === focusedKind).map(group => ({...group, rows:group.rows.filter(row => row.id === focusedId)})).filter(group => group.rows.length)};
  latest = data;
  for (const group of data.groups) {
    const allowed = new Set(readyRows(group).map(row => row.id));
    const set = selected.get(group.key);
    if (set) for (const id of set) if (!allowed.has(id)) set.delete(id);
  }
  for (const key of selected.keys()) if (!data.groups.some(group => group.key === key)) selected.delete(key);
  $('groups').innerHTML = data.groups.length ? data.groups.map(group => {
    const ready = readyRows(group), manual = group.rows.length - ready.length;
    const rows = group.rows.map(row => {
      const allowed = row.prelim?.level === 'ready';
      const checked = allowed && (selected.get(group.key)?.has(row.id) || false);
      const summary = short(row.detail || row.name || row.event || '', 100);
      const when = String(row.at || '').slice(0, 16).replace('T', ' ');
      return '<div class="batch-row' + (allowed ? (checked ? ' is-selected' : '') : ' needs-review') + '">' +
        '<label class="batch-choice"><input type="checkbox" data-key="' + E(group.key) + '" data-id="' + E(row.id) + '"' + (checked ? ' checked' : '') + (allowed ? '' : ' disabled') + ' aria-label="选择 ' + E(row.id) + '">' +
        '<span class="tick" aria-hidden="true">✔</span></label>' +
        '<div class="batch-brief"><strong>' + E(short(row.employee || '待核对', 12)) + ' · ' + E(short(summary, 66)) + '</strong>' +
        '<small>' + E(row.id) + ' · ' + E(when) + ' · ' + E(row.prelim?.decision || '') + '</small>' +
        (allowed ? '' : '<small class="reason">需单独审核：' + E(short(row.prelim?.reason || '', 80)) + '</small>') + '</div>' +
        '<a href="' + sourceLink(group, row) + '" aria-label="打开 ' + E(row.id) + ' 原单">原单</a></div>';
    }).join('');
    return '<section data-key="' + E(group.key) + '"><div class="group-head"><h2>' + E(group.label) + '（' + group.rows.length + '）</h2>' +
      '<button type="button" class="select-group" data-select-group="' + E(group.key) + '"' + (ready.length ? '' : ' disabled') + '>全选本组可批 ' + ready.length + ' 条</button></div>' +
      '<p class="group-note">助理建议：' + E(actionText(group)) + '；可勾选 ' + ready.length + ' 条，需单独审核 ' + manual + ' 条。</p>' +
      (group.kind === 'journal' && ready.length ? '<label class="points">每张核定积分 <input type="number" min="0" step="1" data-points placeholder="填写积分"></label>' : '') +
      '<label class="note">备注（选填）<input data-note maxlength="1000" placeholder="可留空"></label>' +
      '<div class="batch-rows">' + rows + '</div></section>';
  }).join('') : (focusedId ? '<p>这条待办已处理或不在可批列表，请返回老板看台刷新。'+(focusJournalId ? ' <a href="/work-journal?highlight='+encodeURIComponent(focusJournalId)+'">查看工作日志原单</a>' : '')+'</p>' : '<p>暂无可批量处理的同类待办。</p>');
  updateCount();
}
async function load(preserve = true) {
  try {
    if (!preserve) selected.clear();
    render(await api('/api/boss-batch'));
  } catch (error) { $('status').textContent = error.message; }
}
$('groups').addEventListener('change', event => {
  const input = event.target.closest('input[type=checkbox][data-key]');
  if (!input || busy) return;
  const key = input.dataset.key, id = input.dataset.id;
  if (!selected.has(key)) selected.set(key, new Set());
  input.checked ? selected.get(key).add(id) : selected.get(key).delete(id);
  updateCount();
});
$('groups').addEventListener('click', event => {
  const button = event.target.closest('[data-select-group]');
  if (!button || busy) return;
  const group = latest.groups.find(item => item.key === button.dataset.selectGroup);
  if (!group) return;
  selected.set(group.key, new Set(readyRows(group).map(row => row.id)));
  updateCount();
});
$('select-all-ready').addEventListener('click', () => {
  if (busy) return;
  for (const group of latest.groups) selected.set(group.key, new Set(readyRows(group).map(row => row.id)));
  updateCount();
});
$('clear-selected').addEventListener('click', () => { if (busy) return; selected.clear(); updateCount(); });
$('batch-result-close').addEventListener('click', () => $('batch-result').close());
$('batch-result').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('refresh').addEventListener('click', () => load());
$('confirm-selected-bottom').addEventListener('click', () => $('confirm-selected').click());
$('confirm-selected').addEventListener('click', async () => {
  if (busy) return;
  const batches = latest.groups.map(group => ({group, ids:selectedIds(group)})).filter(batch => batch.ids.length);
  if (!batches.length) { $('status').textContent = '请先勾选要处理的单据。'; return; }
  for (const batch of batches) if (batch.group.kind === 'journal') {
    const input = [...$('groups').querySelectorAll('section')].find(section => section.dataset.key === batch.group.key)?.querySelector('[data-points]');
    if (!input || input.value === '' || !Number.isSafeInteger(Number(input.value)) || Number(input.value) < 0) {
      $('status').textContent = batch.group.label + '：请填写非负整数积分。'; input?.focus(); return;
    }
    batch.points = Number(input.value);
  }
  busy = true; updateCount();
  const total = batches.reduce((n, batch) => n + batch.ids.length, 0);
  showResult('正在批量处理', '已选 ' + total + ' 条，请稍候…', 'working');
  let done = 0;
  try {
    for (const batch of batches) {
      const section = [...$('groups').querySelectorAll('section')].find(item => item.dataset.key === batch.group.key);
      const note = section?.querySelector('[data-note]')?.value?.trim() || '';
      const limit = batch.group.kind === 'catalog' ? 100 : 30;
      for (let offset = 0; offset < batch.ids.length; offset += limit) {
        const ids = batch.ids.slice(offset, offset + limit);
        const fresh = (await api('/api/boss-batch')).groups.find(group => group.key === batch.group.key);
        if (!fresh || ids.some(id => !readyRows(fresh).some(row => row.id === id))) throw new Error('选中原单已变化，请刷新核对剩余单据');
        await api('/api/boss-batch/decide', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({key:batch.group.key, ids, prelimToken:fresh.prelimToken,
            approve:batch.group.kind !== 'receptionDuplicate', points:batch.points || 0, note})
        });
        done += ids.length;
        for (const id of ids) selected.get(batch.group.key)?.delete(id);
        $('status').textContent = '已处理 ' + done + ' / ' + total + ' 条…';
        showResult('正在批量处理', '已处理 ' + done + ' / ' + total + ' 条…', 'working');
      }
    }
    await load();
    $('status').textContent = '已处理勾选的 ' + done + ' 条，未勾选与有疑点的单据仍保留。';
    showResult('处理成功', '已完成 ' + done + ' 条。未勾选和有疑点的单据仍在下方待办列表。', 'success');
  } catch (error) {
    await load();
    $('status').textContent = '已处理 ' + done + ' 条；剩余未处理：' + error.message;
    showResult(done ? '部分已完成' : '处理未完成', '已完成 ' + done + ' / ' + total + ' 条；剩余请核对：' + error.message, 'error');
  } finally { busy = false; updateCount(); }
});
load();
