const $ = (id) => document.getElementById(id);
const nextValue = new URLSearchParams(location.search).get('next') || '/m';
function safeNext(value) {
  if (!value.startsWith('/') || value.startsWith('//') || /[\x00-\x20\x7f\\]/.test(value)) return '/m';
  try { const target = new URL(value, location.origin); return target.origin === location.origin ? target.pathname + target.search + target.hash : '/m'; }
  catch { return '/m'; }
}
const next = safeNext(nextValue);
async function api(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || '操作失败，请重试'); error.status = response.status; throw error; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('服务器返回不完整，请重试');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接超时，请检查网络后重试');
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timer); }
}
function message(id, value, ok = false) { $(id).textContent = value; $(id).classList.toggle('ok', ok); }
const requestedEmployee = new URLSearchParams(location.search).get('employee') || '';
let accountData;
let loadVersion = 0;
let adminPending = false;
let accountTransition = false;
let accountGeneration = 0;
let pageHidden = false;
function clearIssued() { $('issued').hidden = true; $('issued-username').textContent = ''; $('issued-password').textContent = ''; }
function clearPasswords() {
  for (const formId of ['login-form','self-form']) for (const field of $(formId).querySelectorAll('input[data-password-field]')) field.value = '';
  for (const button of document.querySelectorAll('[data-password-toggle]')) { $(button.dataset.passwordToggle).type='password'; button.textContent='显示'; button.setAttribute('aria-pressed','false'); }
}
function resetWarning() {
  const selected = $('admin-form').elements.userId.selectedOptions[0];
  const existing = selected?.dataset.hasCredential === 'true';
  $('reset-warning').hidden = !existing; $('confirm-reset').required = existing; $('confirm-reset').checked = false;
  $('admin-form').querySelector('button[type="submit"]').textContent = existing ? '重置员工密码' : '创建员工账号';
}

async function load() {
  if (adminPending || pageHidden) return false;
  const version = ++loadVersion;
  try {
    const data = await api('/api/auth/local/status');
    if (version !== loadVersion) return false;
    if (!data.user || typeof data.user.id !== 'string' || typeof data.user.name !== 'string') throw new Error('账号信息不完整，请重试');
    if (accountData && accountData.user.id !== data.user.id) ++accountGeneration;
    accountData = data;
    $('session-panel').hidden = false;
    message('status-message','');
    $('login-panel').hidden = true;
    $('account-panel').hidden = false;
    $('signed-in').textContent = accountData.user.name + ' · ' + (accountData.user.roleCode === 'owner' ? '最高管理者' : accountData.user.role);
    $('self-form').elements.username.value = accountData.credential?.username || '';
    $('old-password-label').hidden = !accountData.credential;
    $('self-form').elements.currentPassword.required = Boolean(accountData.credential);
    $('admin-panel').hidden = !Array.isArray(accountData.users);
    if (Array.isArray(accountData.users)) {
      const select = $('admin-form').elements.userId;
      const preferred = select.value || requestedEmployee;
      select.replaceChildren();
      for (const row of accountData.users.filter((u) => u.status === 'active' && u.id !== accountData.user.id)) {
        const option = document.createElement('option');
        option.value = row.id;
        option.textContent = row.name + (row.username ? '（' + row.username + '）' : '（未开通）');
        option.dataset.username = row.username || row.name;
        option.dataset.hasCredential = String(Boolean(row.username));
        select.append(option);
      }
      if (Array.from(select.options).some((option) => option.value === preferred)) select.value = preferred;
      if (select.options.length) select.dispatchEvent(new Event('change'));
      $('admin-form').querySelector('button[type="submit"]').disabled = !select.options.length;
      if (!select.options.length) message('admin-message', '还没有可设置账号的员工，请先新增并启用员工。');
      if (requestedEmployee && !Array.from(select.options).some((option) => option.value === requestedEmployee)) message('admin-message', '该员工未在当前可用名单中，请回员工管理核对状态。');
      if (location.hash === '#admin-panel' || requestedEmployee) $('admin-panel').scrollIntoView({block:'start'});
    }
    return true;
  } catch (error) {
    if (version !== loadVersion) return false;
    if (error.status === 401 || error.status === 403) {
      const hadSession = Boolean(accountData); if (hadSession) ++accountGeneration; accountData = undefined;
      $('login-panel').hidden = false; $('account-panel').hidden = true; $('admin-panel').hidden = true; $('session-panel').hidden = true;
      clearIssued(); clearPasswords(); message('status-message','');
      if (hadSession) message('login-message','登录已失效，请重新输入账号和密码');
    } else { message('status-message',error.message); }
    return false;
  }
}
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const signedIn=await api('/api/auth/local/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    clearPasswords();
    location.href = signedIn.user?.personalAssistantOnly ? '/companion' : next;
  } catch (error) {
    message('login-message', error.message);
    button.disabled = false;
  }
});
$('self-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (adminPending || accountTransition) return message('self-message','账号操作正在进行，请稍后再修改');
  const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.repeat) return message('self-message', '两次输入的新密码不一致');
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true; accountTransition = true;
  try {
    const result = await api('/api/auth/local/self-set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    message('self-message', '已保存。下次可用“' + result.username + '”和新密码登录。', true);
    form.elements.currentPassword.value = '';
    form.elements.password.value = '';
    form.elements.repeat.value = '';
    await load();
  } catch (error) { message('self-message', error.message); }
  finally { accountTransition = false; button.disabled = false; }
});
$('admin-form').elements.userId.addEventListener('change', (event) => {
  if (adminPending) return;
  const selected = event.target.selectedOptions[0];
  $('admin-form').elements.username.value = selected?.dataset.username || '';
  clearIssued(); resetWarning(); message('admin-message','');
});
$('admin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (accountTransition) return message('admin-message','账号操作正在进行，请稍后再设置');
  const selected = form.elements.userId.selectedOptions[0];
  if (!selected) return message('admin-message','请先选择员工');
  if (selected.dataset.hasCredential === 'true' && !$('confirm-reset').checked) { message('admin-message','重置会使原密码失效，请先确认再操作'); $('confirm-reset').focus(); return; }
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled || adminPending) return;
  const values = Object.fromEntries(new FormData(form));
  const generation = accountGeneration;
  const ownerId = accountData?.user.id;
  adminPending = true; ++loadVersion;
  for (const element of [form.elements.userId, form.elements.username, $('refresh-staff'), $('retry-status'), $('logout'), $('self-form').querySelector('button[type="submit"]')]) element.disabled = true;
  button.disabled = true;
  clearIssued();
  try {
    const result = await api('/api/auth/local/admin-set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (pageHidden || generation !== accountGeneration || accountData?.user.id !== ownerId) return;
    if (typeof result.username !== 'string' || typeof result.password !== 'string') throw new Error('密码返回不完整，请刷新名单后重新设置');
    $('issued-username').textContent = result.username;
    $('issued-password').textContent = result.password;
    $('issued').hidden = false;
    form.elements.userId.value = values.userId;
    selected.dataset.username=result.username; selected.dataset.hasCredential='true';
    const row=accountData?.users?.find((u)=>u.id===selected.value);
    if(row) { row.username=result.username; selected.textContent=row.name+'（'+result.username+'）'; }
    form.elements.username.value=result.username; resetWarning();
    message('admin-message', '账号已设置，密码只显示这一次，请先复制保存。', true);
    $('issued').scrollIntoView({block:'nearest'});
  } catch (error) { if (!pageHidden && generation === accountGeneration) message('admin-message', error.message); }
  finally {
    adminPending = false; button.disabled = false;
    for (const element of [form.elements.userId, form.elements.username, $('refresh-staff'), $('retry-status'), $('logout'), $('self-form').querySelector('button[type="submit"]')]) element.disabled = false;
    if (!pageHidden && generation !== accountGeneration) { const ok = await load(); if (ok && accountData?.user.id === ownerId) message('admin-message','刚才的账号设置可能已完成；离开页面后密码不会再次显示。如需取得新密码，请确认后重新设置。'); }
  }
});
$('copy-issued').addEventListener('click', async () => {
  const username=$('issued-username').textContent, password=$('issued-password').textContent;
  if(!username || !password) return;
  try { if(!navigator.clipboard?.writeText) throw new Error('clipboard unavailable'); await navigator.clipboard.writeText('账号：'+username+'\n密码：'+password); message('admin-message','已复制，请私下交给员工。',true); }
  catch { message('admin-message','浏览器未允许复制，请长按下方账号和密码手动复制。'); }
});
$('hide-issued').addEventListener('click',()=>{clearIssued();message('admin-message','密码已收起；忘记密码时需要重新设置。',true);});
$('logout').addEventListener('click', async () => {
  const button=$('logout'); if(button.disabled || adminPending || accountTransition) return; button.disabled=true; accountTransition=true;
  try { await api('/api/auth/logout',{method:'POST'});clearIssued();clearPasswords();if(typeof window.StoreSessionControls?.completeLogout==='function')window.StoreSessionControls.completeLogout();else location.replace('/login'); }
  catch(error) {message('status-message',error.message);}
  finally {accountTransition=false;button.disabled=false;}
});
$('refresh-staff').addEventListener('click', async () => {
  if (adminPending) return;
  const button = $('refresh-staff'); button.disabled = true;
  message('admin-message', '正在刷新员工名单…');
  try { const ok=await load(); if (ok && accountData?.users) message('admin-message', '员工名单已刷新。', true); else if(accountData) message('admin-message','名单未刷新，请检查上方提示后重试'); }
  finally { button.disabled = false; }
});
$('retry-status').addEventListener('click',async()=>{if(adminPending)return;const button=$('retry-status');button.disabled=true;try{await load();}finally{button.disabled=false;}});
for (const button of document.querySelectorAll('[data-password-toggle]')) button.addEventListener('click',()=>{const input=$(button.dataset.passwordToggle);const visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'隐藏':'显示';button.setAttribute('aria-pressed',String(visible));});
addEventListener('pagehide',()=>{pageHidden=true;++accountGeneration;++loadVersion;clearIssued();clearPasswords();for(const id of ['account-panel','admin-panel','session-panel'])$(id).hidden=true;});
addEventListener('pageshow', (event) => { pageHidden=false; if (event.persisted) {clearIssued();clearPasswords();message('status-message','正在核对登录状态…');load();} });
load();
