(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => '¥' + Number(value || 0).toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2});
  let options = null;
  let pendingKey = crypto.randomUUID();

  async function api(path, body) {
    const response = await fetch(path, {credentials:'same-origin',cache:'no-store',...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    if (response.status === 401) { location.assign('/login?next=' + encodeURIComponent(location.pathname)); throw Error('请先登录'); }
    const result = await response.json();
    if (!response.ok) throw Error(result.error?.message || '操作失败，请核对原单');
    return result;
  }
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error',error); }
  function select(id, rows, placeholder) {
    const field = $(id), chosen = field.value;
    field.innerHTML = '<option value="">' + esc(placeholder) + '</option>' + rows.map(row => '<option value="' + esc(row.id ?? row) + '">' + esc(row.name ?? row) + '</option>').join('');
    if ([...field.options].some(row => row.value === chosen)) field.value = chosen;
    else if (rows.length === 1) field.value = rows[0].id ?? rows[0];
  }
  function amount(value) { const text = String(value ?? '').trim(); if(!/^\d+(?:\.\d{1,2})?$/.test(text)) throw Error('金额须填写到分'); return text; }
  function payload() {
    const hasReturn = $('has-return').checked;
    return {
      businessName:$('business').value,serialNo:$('serial').value.trim(),hebaoAmount:amount($('gross').value),
      hebaoAccountId:$('hebao-account').value,topupAmount:hasReturn?amount($('return-amount').value):'0',
      topupSource:hasReturn?$('return-source').value:'none',customerPhone:$('phone').value.trim(),
      wechatAccountId:hasReturn&&$('return-source').value==='wechat'?$('wechat-account').value:'',
      ...(options?.canManage?{commissionRate:amount($('rate').value)}:{})
    };
  }
  function updateReturn() {
    $('return-fields').hidden = !$('has-return').checked;
    $('wechat-account-label').hidden = !$('has-return').checked || $('return-source').value !== 'wechat';
  }
  function calculation(data) {
    const rows = [
      ['办理业务',data.businessName],['领取手机',data.productName],['手机串码',data.serialNo],
      ['手机成交额／和包商户一笔收款',money(data.saleAmount)],
      ...(data.inventoryCost === undefined?[]:[['库存原成本','−'+money(data.inventoryCost)]]),
      ...(data.topupAmount?[['门店返用户金额','−'+money(data.topupAmount)]]:[]),
      ['活动税扣（和包全额 × 2.5%）','−'+money(data.activityTax)],
      ...(data.activityProfit === undefined?[]:[['本单提成毛利',money(data.activityProfit)]]),
      ['本单提成比例',data.commissionRate+'%'],
      ...(data.estimatedCommission === null?[]:[['营业员酬金',money(data.estimatedCommission)]])
    ];
    $('calculation').innerHTML = '<table class="table"><tbody>' + rows.map(([label,value]) => '<tr><td>'+esc(label)+'</td><td>'+esc(value)+'</td></tr>').join('') + '</tbody></table><p class="hint">内部销售单记全额，门店返用户金额和税扣在本单毛利中各扣一次。交给用户的领机凭证不显示金额。</p>';
  }
  async function loadOptions() {
    options = await api('/api/mobile-activity-sales/options');
    select('business',options.names,'请选择业务');
    $('add-business').hidden = !options.canAddBusiness;
    select('hebao-account',options.hebaoAccounts,'请选择门店和包商户钱包');
    select('wechat-account',options.wechatAccounts,'请选择门店微信钱包');
    $('setup-hebao').hidden = options.hebaoAccounts.length > 0 || !options.canConfirmHebao;
    $('rate-label').hidden = !options.canManage;
    if (options.canManage) $('rate').value = options.rate;
    status(options.hebaoAccounts.length ? '请选择业务和库存手机，先读取成本再生成新单。' : '门店和包商户钱包尚未配置，请老板先启用。');
  }
  async function loadRecords() {
    const q = $('query').value.trim();
    const result = await api('/api/mobile-activity-sales' + (q?'?q='+encodeURIComponent(q):''));
    $('records').innerHTML = result.rows.length ? result.rows.map(row => '<article class="record"><h3>'+esc(row.businessName)+' · '+esc(row.serialNo)+'</h3><p>销售单 '+esc(row.saleId)+' · 中国移动应收 '+money(row.receivableAmount)+'，收至门店和包商户 · '+esc(row.receivableStatus)+'</p><p>门店返用户 '+esc(row.topupStatus)+'；税扣 '+money(row.activityTax)+(row.topupAmount?'；返用户 '+money(row.topupAmount):'')+'</p>'+(row.activityProfit===undefined?'':'<p>本单提成毛利 '+money(row.activityProfit)+'；比例 '+esc(row.commissionRate)+'%；酬金 '+(row.commissionAmount==null?esc(row.commissionStatus):money(row.commissionAmount))+'</p>')+'<p><a href="/sale-receipt?orderId='+encodeURIComponent(row.saleId)+'">领机凭证</a><a href="/app?tab=orders&q='+encodeURIComponent(row.saleId)+'">内部销售单</a></p>'+(options?.canConfirmHebao&&!['已确认到账','已核对'].includes(row.hebaoStatus)?'<button type="button" class="secondary" data-hebao="'+esc(row.id)+'" data-amount="'+esc(row.hebaoAmount)+'">老板核对和包到账</button>':'')+(options?.canFinance&&row.topupStatus==='待支付确认'?'<button type="button" class="secondary" data-confirm="'+esc(row.id)+'" data-amount="'+esc(row.topupAmount)+'">核对返用户支出</button>':'')+'</article>').join('') : '<p class="hint">暂无可见的活动机单据。</p>';
  }
  $('has-return').addEventListener('change',updateReturn);
  $('return-source').addEventListener('change',updateReturn);
  $('setup-hebao').addEventListener('click',async () => {try {const row=await api('/api/mobile-activity-sales/setup-hebao',{});await loadOptions();status('门店和包商户钱包已启用：'+row.name);}catch(error){status(error.message,true);}});
  $('add-business').addEventListener('click',async () => {const name=prompt('请输入新的活动业务名称：');if(!name)return;try{const row=await api('/api/mobile-activity-sales/businesses',{name:name.trim()});await loadOptions();$('business').value=row.name;status('业务名称已加入下拉菜单：'+row.name);}catch(error){status(error.message,true);}});
  $('preview-button').addEventListener('click',async () => {try{const result=await api('/api/mobile-activity-sales/preview',payload());calculation(result);status('已读取这台库存手机的资料，请核对计算。');}catch(error){status(error.message,true);}});
  $('activity-form').addEventListener('submit',async event => {event.preventDefault();const button=$('submit-button');button.disabled=true;try{const result=await api('/api/mobile-activity-sales',{...payload(),requestKey:pendingKey});pendingKey=crypto.randomUUID();status('销售单与中国移动应收已建立，待老板凭和包流水核对到账：'+result.saleId);await loadRecords();}catch(error){status(error.message,true);}finally{button.disabled=false;}});
  $('search').addEventListener('click',() => loadRecords().catch(error=>status(error.message,true)));
  $('records').addEventListener('click',async event => {const button=event.target.closest('[data-confirm],[data-hebao]');if(!button)return;const hebao=!!button.dataset.hebao,reference=prompt(hebao?'请填写真实和包到账流水号：':'请填写已发生的门店付款或BOSS流水号：');if(!reference)return;button.disabled=true;try{await api(hebao?'/api/mobile-activity-sales/hebao-confirm':'/api/mobile-activity-sales/topup-confirm',{id:hebao?button.dataset.hebao:button.dataset.confirm,amount:button.dataset.amount,reference,actualReceived:hebao,actualPaid:!hebao});status(hebao?'和包到账已由老板核对。':'返用户支出已按真实流水确认。');await loadRecords();}catch(error){status(error.message,true);button.disabled=false;}});
  updateReturn();loadOptions().then(loadRecords).catch(error=>status(error.message,true));
})();
