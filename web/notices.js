const $ = (id) => document.getElementById(id);
const E = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
async function api(path, body) {
  const response = await fetch(path, { method:body?'POST':'GET', credentials:'same-origin', cache:'no-store',
    headers:body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:undefined,
    body:body?JSON.stringify(body):undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status===401?'请先登录':data.error?.message||'加载失败');
  return data;
}
async function load() {
  try {
    const data = await api('/api/local-notices');
    $('unread').textContent = '未读 ' + data.unread + ' 条';
    $('rows').innerHTML = data.rows.length ? data.rows.map((row) =>
      '<article class="item '+(row.readAt?'':'unread')+'"><h2>'+E(row.kind||'业务消息')+'</h2><p>'+E(row.summary||'')+'</p>'+
      '<small>单号：'+E(row.orderId||'—')+' · '+E(row.createdAt?new Date(row.createdAt).toLocaleString('zh-CN'):'历史记录')+'</small>'+
      (row.readAt?'':'<div><button data-key="'+E(row.key)+'">标为已阅</button></div>')+'</article>').join('') : '<p>暂无消息。</p>';
    $('status').textContent = '';
  } catch (error) {
    $('status').innerHTML = error.message==='请先登录'?'<a href="/login?next=/notices">请先用员工账号登录</a>':E(error.message);
  }
}
$('rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-key]');
  if (!button) return;
  button.disabled = true;
  try { await api('/api/local-notices/read',{key:button.dataset.key}); await load(); }
  catch (error) { $('status').textContent = error.message; button.disabled = false; }
});
$('mark-all').addEventListener('click',async()=>{
  $('mark-all').disabled=true;
  try { await api('/api/local-notices/read',{all:true}); await load(); }
  catch(error){ $('status').textContent=error.message; }
  finally { $('mark-all').disabled=false; }
});
$('refresh').addEventListener('click',load);
load();
setInterval(load,30000);

