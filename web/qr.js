const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
let current = null, products = [], user = null, people = [], stream = null, scanning = false, paymentAccounts=null, qrPaymentController=null, qrPaymentDraft=[],qrPaymentAssets;
const qrPaymentAttempts=new Map();let qrPendingPayment=null;
const labelDefaults = new Map();
const cart = [];
async function api(path, options = {}) {
  const response = await fetch(path, {credentials:'same-origin', ...options});
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401) throw new Error('LOGIN');
    const error=new Error(body?.error?.message||'请求失败');error.status=response.status;throw error;
  }
  return body;
}
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function money(value) { return '¥' + Number(value || 0).toFixed(2); }
async function resolveCode(code) {
  status('正在查询…');
  try {
    current = await api('/api/qr/resolve?code=' + encodeURIComponent(code));
    $('code').value = code;
    $('result').innerHTML = `<div class="product-result"><h3>${escapeHtml(current.name)}</h3><p>商品编号：${escapeHtml(current.code)}</p><p>销售仓可用：${escapeHtml(current.saleQuantity)} ${escapeHtml(current.unit)} · 预设售价：${money(current.salePrice)}</p><p>${current.warehouses.map((w) => escapeHtml(w.name) + ' ' + escapeHtml(w.quantity)).join(' · ')}</p><div class="scan-row"><input id="qty" type="number" min="1" step="1" value="1" aria-label="销售数量"><button type="button" id="add">加入本单</button></div></div><div class="cart" id="cart"></div>`;
    $('add').addEventListener('click', addItem);
    renderCart();
    status('商品已识别，请核对数量后加入本单。');
  } catch (error) {
    current = null; $('result').textContent = '';
    status(error.message === 'LOGIN' ? '请先用员工账号登录：/login?next=/qr' : error.message, true);
  }
}
function addItem() {
  const quantity = Number($('qty').value);
  const already = cart.filter((item) => item.skuId === current.skuId).reduce((n, item) => n + item.quantity, 0);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity + already > current.saleQuantity) return status('数量超过销售仓可用库存', true);
  const existing = cart.find((item) => item.skuId === current.skuId);
  if (existing) existing.quantity += quantity;
  else cart.push({skuId:current.skuId, name:current.name, quantity, salePrice:Number(current.salePrice)});
  renderCart(); status('已加入本单；可以继续扫码。');
}
function renderCart() {
  const target = $('cart'); if (!target) return;
  if (!cart.length) { qrPaymentController?.destroy();qrPaymentController=null;qrPaymentDraft=[];target.innerHTML = ''; return; }
  if(qrPaymentController){qrPaymentDraft=qrPaymentController.getParts();qrPaymentController.destroy();qrPaymentController=null;}
  target.innerHTML = `<h3>本单商品</h3><table><thead><tr><th>商品</th><th>数量</th><th>单价</th><th></th></tr></thead><tbody>${cart.map((item,index)=>`<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.quantity)}</td><td><input class="price" data-index="${index}" type="number" min="0" step="0.01" value="${item.salePrice.toFixed(2)}" aria-label="实际售价"></td><td><button type="button" class="remove" data-index="${index}">移除</button></td></tr>`).join('')}</tbody></table><div class="cart-summary"><strong id="total"></strong><section id="qr-payment-splits" aria-label="按账户分笔收款"></section><p><a href="/payment-accounts">收付款账户设置</a> · 微信、和包商户等可分笔收款；保存后仍须实际持有人核对。</p><button type="button" id="checkout">保存销售单</button></div>`;
  if(!window.PaymentSplits||!paymentAccounts){$('checkout').disabled=true;status('收款账户尚未加载，请刷新后再开单',true);return;}
  qrPaymentController=window.PaymentSplits.mount({container:$('qr-payment-splits'),accounts:paymentAccounts,totalCents:qrTotalCents,initialParts:qrPaymentDraft.length?qrPaymentDraft:undefined,legacy:{account:'微信'},people:people.filter(person=>person.status==='active'&&person.capabilities?.financeReceive),mode:'sale',requireReference:false,onChange:()=>{if(qrPaymentController)qrPaymentDraft=qrPaymentController.getParts()}});
  target.querySelectorAll('.price').forEach((input) => input.addEventListener('change', () => { const value=Number(input.value);if(!/^\d+(?:\.\d{1,2})?$/.test(input.value)||!Number.isFinite(value)||value<0) { input.value = cart[Number(input.dataset.index)].salePrice.toFixed(2); return status('售价须为非负金额，最多两位小数',true); } cart[Number(input.dataset.index)].salePrice = value; updateTotal(); }));
  target.querySelectorAll('.remove').forEach((button) => button.addEventListener('click', () => { cart.splice(Number(button.dataset.index),1); renderCart(); }));
  $('checkout').addEventListener('click', checkout); updateTotal();
}
function qrCents(value){const text=String(value??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error('售价与金额最多填写两位小数');const [whole,fraction='']=text.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(cents))throw new Error('金额超出范围');return cents;}
function qrTotalCents(){return cart.reduce((sum,item)=>{const next=sum+qrCents(item.salePrice)*item.quantity;if(!Number.isSafeInteger(next))throw new Error('金额超出范围');return next;},0);}
function updateTotal(){try{$('total').textContent='应收合计 '+money(qrTotalCents()/100);qrPaymentController?.refresh();}catch(error){status(error.message,true);}}
async function loadQRPayments(){if(!window.PaymentSplits){if(!qrPaymentAssets)qrPaymentAssets=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/payment-splits.js';script.onload=()=>window.PaymentSplits?resolve():reject(new Error('收款组件未加载'));script.onerror=()=>{qrPaymentAssets=null;script.remove();reject(new Error('分笔收款读取失败，请刷新'));};document.head.append(script);});await qrPaymentAssets;}await window.PaymentSplits.ready();paymentAccounts=await api('/api/payment-accounts');}

async function checkout() {
  if (!cart.length) return;
  let paymentCheck,amount;try{amount=qrTotalCents()/100;paymentCheck=qrPaymentController?.validate();}catch(error){status(error.message,true);return;}if(!paymentCheck?.ok)return status(paymentCheck?.error||'请先加载收款账户',true);
  if (!confirm(`保存应收 ${money(amount)} 的销售单，并提交后续收款核对？`)) return;
  const button = $('checkout'); button.disabled = true;
  try {
    const payload={payments:paymentCheck.parts,items:cart.map(({skuId,quantity,salePrice})=>({skuId,quantity,salePrice}))},body=JSON.stringify(payload);if(!qrPaymentAttempts.has(body))qrPaymentAttempts.set(body,crypto.randomUUID());if(qrPendingPayment&&qrPendingPayment!==body)throw new Error('上一笔结果待核对，请保持原商品和分笔金额重试，不要重复开单');qrPendingPayment=body;const result=await api('/api/sale-orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':qrPaymentAttempts.get(body)},body});qrPaymentAttempts.delete(body);qrPendingPayment=null;qrPaymentDraft=[];qrPaymentController?.destroy();qrPaymentController=null;
    cart.length = 0; renderCart(); if (current) await resolveCode(current.skuId);
    status('开单成功：' + documentNo(result) + '；' + (result.paymentReview?.status||'收款待核对'));
  } catch (error) {if(error.status&&error.status<500)qrPendingPayment=null;status(error.message, true); }
  finally { button.disabled = false; }
}
function stopCamera() {
  scanning = false; if (stream) stream.getTracks().forEach((track) => track.stop()); stream = null;
  $('preview').hidden = true; $('camera').textContent = '相机扫码';
}
async function startCamera() {
  if (scanning) { stopCamera(); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof window.jsQR !== 'function') return status('当前环境不支持相机识别，请使用扫码枪或输入商品编号。', true);
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    const video = $('preview'); video.srcObject = stream; video.hidden = false; await video.play();
    scanning = true; $('camera').textContent = '关闭相机'; status('将商品二维码放入取景框。');
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d', {willReadFrequently:true});
    let last = 0;
    const tick = async (time) => {
      if (!scanning) return;
      if (time - last > 180 && video.videoWidth) {
        last = time; canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        context.drawImage(video,0,0); const pixels = context.getImageData(0,0,canvas.width,canvas.height);
        const found = window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'});
        if (found?.data) { stopCamera(); await resolveCode(found.data); return; }
      }
      requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  } catch (error) { stopCamera(); status('无法打开相机；请检查权限，或手动输入商品编号。', true); }
}
function renderProducts() {
  const q = $('filter').value.trim().toLowerCase();
  const rows = products.filter((p) => !q || [p.name,p.code].some((x) => String(x).toLowerCase().includes(q)));
  $('products').innerHTML = `<div class="product-list">${rows.map((p) => `<label class="product-row"><input type="checkbox" value="${escapeHtml(p.skuId)}"${labelDefaults.has(p.skuId)?" checked":""}><span>${escapeHtml(p.name)}<small>${escapeHtml(p.code)} · 库存 ${escapeHtml(p.quantity)}</small></span><input type="number" min="1" max="100" value="${labelDefaults.get(p.skuId)||1}" aria-label="标签份数"></label>`).join('')}</div>`;
}
async function prepareLabels() {
  const selected = products.filter(p=>labelDefaults.has(p.skuId)).map(p=>({product:p,count:labelDefaults.get(p.skuId)}));
  if (!selected.length) return status('请先勾选要打印的商品。', true);
  const labels = [];
  let total = 0;
  for (const row of selected) {
    const count = row.count;
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) return status('每款标签份数需为 1–100。', true);
    total += count;
  }
  if (total > 300) return status('一次最多打印 300 张标签。', true);
  $('label-preview').hidden = true;
  $('print-sheet').replaceChildren();
  for (const row of selected) {
    const count = row.count;
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) return status('每款标签份数需为 1–100。', true);
    const p = row.product;
    for (let i=0; i<count; i++) labels.push(`<article class="qr-label"><header class="label-store">聚友通信城</header><div class="label-body"><img src="/api/qr/label.svg?skuId=${encodeURIComponent(p.skuId)}" alt="${escapeHtml(p.name)}二维码"><div class="label-info"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.code)}</span><small>单位：${escapeHtml(p.unit)}<br>同款一码 · 数量管理</small></div></div></article>`);
  }
  if (labels.length > 300) return status('一次最多打印 300 张标签。', true);
  $('print-sheet').innerHTML = labels.join('');
  try {
    await Promise.all([...$('print-sheet').querySelectorAll('img')].map((img) => img.decode()));
  } catch { $('print-sheet').replaceChildren(); return status('二维码未加载成功，请刷新后重试，暂不打印。', true); }
  $('label-preview').hidden = false;
  $('label-count').textContent = '60×40 毫米 · 共 '+labels.length+' 张';
  status('标签已准备好；补打沿用原二维码，不增加库存。');
  return true;
}
$('scan-form').addEventListener('submit', (event) => { event.preventDefault(); stopCamera(); resolveCode($('code').value); });
$('camera').addEventListener('click', startCamera);
const rememberLabelSelection=event=>{const row=event.target.closest('.product-row');if(!row)return;const check=row.querySelector('input[type=checkbox]');if(check.checked)labelDefaults.set(check.value,Number(row.querySelector('input[type=number]').value));else labelDefaults.delete(check.value);};
$('products').addEventListener('input',rememberLabelSelection);
$('products').addEventListener('change',rememberLabelSelection);
$('filter').addEventListener('input', renderProducts);
$('preview-labels').addEventListener('click', async()=>{if(await prepareLabels())$('label-preview').scrollIntoView({behavior:'smooth',block:'start'});});
$('print').addEventListener('click', async()=>{if(await prepareLabels())window.print();});
window.addEventListener('pagehide', stopCamera);
(async () => {
  try { user = await api('/api/me'); people = await api('/api/users'); await loadQRPayments(); if (user.capabilities?.manageProducts || user.capabilities?.purchase) {
      products = await api('/api/qr/products'); $('label-panel').hidden = false;
      const query = new URLSearchParams(location.search), skuId = query.get('skuId');
      if (products.some(p=>p.skuId===skuId)) labelDefaults.set(skuId,1);
      if (query.get('purchaseId') && user.capabilities?.purchase) {
        const orders = await api('/api/purchase-orders'), order = orders.find(o=>o.id===query.get('purchaseId'));
        if (!order) status('这张入库单不存在或你没有查看权限，请从商品列表选择。',true);
        else { for (const item of order.items) if (products.some(p=>p.skuId===item.skuId)) labelDefaults.set(item.skuId,Math.min(100,(labelDefaults.get(item.skuId)||0)+item.quantity)); status('已选中本次入库的无串号商品；核对标签份数后预览，每款每次最多100张。'); }
      }
      renderProducts();
      if(labelDefaults.size) await prepareLabels();
    } }
  catch (error) { if (error.message === 'LOGIN') $('status').innerHTML = '<a href="/login?next=/qr">请先用员工账号登录</a>'; else status(error.message,true); }
  const code = new URLSearchParams(location.search).get('code'); if (code) resolveCode(code);
})();