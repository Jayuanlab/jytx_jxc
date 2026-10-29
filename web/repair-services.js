(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => '¥' + Number(value || 0).toFixed(2);
  const state = {user:null, products:[], inventory:[], categoryPaths:[], materials:[], payments:null, review:null, attempt:null, projectAttempt:null,receptionId:null};
  const key = row => JSON.stringify([row.skuId, row.warehouseId || '']);
  function status(message, error=false) { $('entry-status').textContent=message; $('entry-status').classList.toggle('error',error); }
  function lockInputs(locked) { $('repair-form').querySelectorAll('input,select,textarea,#add-material,#preview,[data-remove]').forEach(node=>node.disabled=locked); }
  function cents(value) { return window.PaymentSplits?.cents(value); }
  async function api(path, options={}) {
    const token=sessionStorage.getItem('officeLocalToken') || '';
    const headers={...(token?{Authorization:'Bearer '+token}:{}),...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
    let response, result;
    try { response=await fetch(path,{credentials:'same-origin',...options,headers}); result=await response.json(); }
    catch { const error=new Error('未收到完整结果，请核对原单后再重试'); error.uncertain=!!options.body; throw error; }
    if(!response.ok) { const error=new Error(result.error?.message || '操作失败'); error.uncertain=!!options.body && response.status>=500; throw error; }
    return result;
  }
  function service() { return state.products.find(row=>row.skuId===$('service').value && row.stockManaged===false && row.type==='维修'); }
  function materialRow(material) { return state.inventory.find(row=>row.skuId===material.skuId && (row.warehouseId||'')===material.warehouseId); }
  function renderMaterials() {
    $('materials').innerHTML=state.materials.length?state.materials.map((m,i)=>{
      const row=materialRow(m);
      return `<div class="material-row"><span>${m.usage==='gift'?'赠品':'维修耗材'} · ${esc(row?.name||m.skuId)} · ${esc(row?.warehouseName||m.warehouseId)} × ${m.quantity}</span><button type="button" data-remove="${i}">移除</button></div>`;
    }).join(''):'<p class="empty">尚未选择耗材</p>';
  }
  function renderMaterialOptions() {
    const query=$('material-search').value.trim().toLocaleLowerCase('zh-CN');
    const old=$('material').value;
    const stocked=state.inventory.filter(row=>row.active!==false&&row.stockManaged!==false&&!row.trackSerial&&Number(row.quantity)>0);
    const rows=stocked.filter(row=>!query||[row.name,row.externalCode,row.skuId,row.warehouseName,row.warehouseId].some(value=>String(value||'').toLocaleLowerCase('zh-CN').includes(query))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    $('material').innerHTML='<option value="">'+(rows.length?'请选择实际耗材与仓库':'没有匹配的在库耗材')+'</option>'+rows.map(row=>`<option value="${esc(key(row))}">${esc(row.name)}${row.externalCode?' · '+esc(row.externalCode):''} · ${esc(row.warehouseName||row.warehouseId)} · 可用 ${Number(row.quantity)}</option>`).join('');
    if(rows.some(row=>key(row)===old))$('material').value=old;
    $('material-search-status').textContent=query?'找到 '+rows.length+' 条在库耗材':stocked.length+' 条在库耗材可选';
  }
  function invalidate() { state.review=null; $('review').hidden=true; $('submit').disabled=true; if(state.attempt?.uncertain)status('上次提交结果待核对，请保留原内容按原请求重试。',true); }
  function renderSelectors() {
    const services=state.products.filter(row=>row.active!==false && row.stockManaged===false && row.type==='维修').sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    const old=$('service').value;
    $('service').innerHTML='<option value="">'+(services.length?'请选择维修服务项目':'暂无项目，请先新增维修服务项目')+'</option>'+services.map(row=>`<option value="${esc(row.skuId)}">${esc(row.name)}${row.salePrice>0?' · 参考 '+money(row.salePrice):''}</option>`).join('');
    if(services.some(row=>row.skuId===old))$('service').value=old;
    $('empty-service').hidden=services.length>0;
    $('empty-service-message').textContent=state.user?.capabilities?.catalogAdd?'服务项目只建一次档案，系统会生成编码；每次维修另填实际收费与耗材。':'请让有商品档案权限的人员先新增维修服务项目。';
    $('open-service-project').hidden=!state.user?.capabilities?.catalogAdd;
    renderMaterialOptions();
    if(!services.length)status('尚无维修服务项目。请点上方“新增服务项目”建档，系统会生成商品编码。',true);
  }
  function renderProjectCategories() {
    const paths=state.categoryPaths.filter(path=>path[0]==='维修');
    const leaves=paths.filter(path=>!paths.some(other=>other.length>path.length&&path.every((part,index)=>other[index]===part)));
    $('project-category').innerHTML=leaves.length?'<option value="">请选择维修分类</option>'+leaves.map(path=>`<option value="${esc(JSON.stringify(path))}">${esc(path.join(' / '))}</option>`).join(''):'<option value="__new_root__">建立“维修”大类</option>';
  }
  async function openProjectForm() {
    if(!$('project-form').hidden){$('project-form').hidden=true;return;}
    try{
      const result=await api('/api/product-category-paths');
      state.categoryPaths=(result.paths||[]).map(row=>row.path).filter(Array.isArray);
      renderProjectCategories();$('project-form').hidden=false;
      $('project-form').elements.name.focus();
    }catch(error){$('project-status').textContent=error.message;$('project-form').hidden=false;}
  }
  async function saveProject(event) {
    event.preventDefault();
    const form=$('project-form'),button=form.querySelector('[type="submit"]');
    const name=form.elements.name.value.trim(),unit=form.elements.unit.value.trim(),price=form.elements.salePrice.value.trim();
    let path;
    try{path=$('project-category').value==='__new_root__'?['维修']:JSON.parse($('project-category').value);}catch{}
    if(!name||!unit||!Array.isArray(path)||path[0]!=='维修')return $('project-status').textContent='请填写项目名称、单位并选择维修分类。';
    if(state.products.some(row=>row.active!==false&&row.stockManaged===false&&row.type==='维修'&&row.name===name))return $('project-status').textContent='已有同名维修服务项目，请直接从下方选择。';
    if(price!==''&&(!Number.isFinite(Number(price))||Number(price)<0||!/^(?:\d+)(?:\.\d{1,2})?$/.test(price)))return $('project-status').textContent='预设售价须为非负金额，最多两位小数。';
    const payload={name,type:path[0],subType:path[1]||'',thirdType:path[2]||'',unit,kind:'service',...(price!==''?{salePrice:Number(price)}:{})};
    const fingerprint=JSON.stringify(payload);
    if(state.projectAttempt?.fingerprint!==fingerprint)state.projectAttempt={fingerprint,categoryKey:crypto.randomUUID(),productKey:crypto.randomUUID(),categoryCreated:false,created:null};
    const attempt=state.projectAttempt;
    button.disabled=true;$('project-status').textContent='正在建档…';
    try{
      if($('project-category').value==='__new_root__'&&!attempt.categoryCreated){const category=await api('/api/product-category-paths',{method:'POST',headers:{'Idempotency-Key':attempt.categoryKey},body:JSON.stringify({parentPath:[],name:'维修'})});if(category.pendingApproval){$('project-status').textContent='“维修”分类已提交审核，通过后再建服务项目。';return;}attempt.categoryCreated=true;state.categoryPaths.push(['维修']);}
      const result=attempt.created||await api('/api/products',{method:'POST',headers:{'Idempotency-Key':attempt.productKey},body:JSON.stringify(payload)});
      attempt.created=result;
      state.products=await api('/api/products');renderSelectors();$('service').value=result.skuId;
      form.reset();form.hidden=true;state.projectAttempt=null;
      status(`维修服务项目已建档：${result.name}，编码 ${result.externalCode}；下一个预计 ${result.nextCodePreview||'待系统生成'}。请继续登记本次维修。`);
    }catch(error){$('project-status').textContent=error.uncertain?'结果未确认。请保留当前内容重试；系统会使用相同请求编号，避免重复建档。':error.message;}
    finally{button.disabled=false;}
  }
  function addMaterial() {
    if(state.attempt?.uncertain)return status('上次提交结果待核对，暂不能修改本单。',true);
    let pair;try{pair=JSON.parse($('material').value);}catch{}
    const row=Array.isArray(pair)?state.inventory.find(x=>x.skuId===pair[0]&&(x.warehouseId||'')===pair[1]):null;
    const qty=Number($('material-quantity').value),usage=$('material-usage').value;
    if(!row||!Number.isSafeInteger(qty)||qty<1)return status('请选择实际耗材、仓库和正整数数量。',true);
    if(!['repair','gift'].includes(usage))return status('请选择材料用途。',true);
    const existing=state.materials.find(m=>m.skuId===row.skuId&&m.warehouseId===(row.warehouseId||'')&&m.usage===usage);
    const reserved=state.materials.filter(m=>m.skuId===row.skuId&&m.warehouseId===(row.warehouseId||'')).reduce((sum,m)=>sum+m.quantity,0);
    if(reserved+qty>Number(row.quantity))return status('该商品各用途合计数量超过所选仓库的可用库存。',true);
    if(existing)existing.quantity+=qty;else state.materials.push({skuId:row.skuId,warehouseId:row.warehouseId||'',quantity:qty,usage});
    $('no-materials').checked=false;renderMaterials();invalidate();status('已加入本次维修材料，提交后按实际成本扣库存。');
  }
  function buildReview() {
    const project=service(),feeCents=cents($('fee').value),form=$('repair-form');
    if(!project)throw new Error('请选择维修服务项目；服务本身不计库存。');
    if(feeCents===null)throw new Error('本次收费须为最多两位小数的非负金额。');
    const name=form.elements.customerName.value.trim(),phone=form.elements.customerPhone.value.trim(),note=form.elements.note.value.trim();
    if(phone&&!/^1[3-9]\d{9}$/.test(phone))throw new Error('顾客手机号须为11位，不提供可留空。');
    if(feeCents===0&&note.length<4)throw new Error('零元维修请填写至少4字的实际原因。');
    if(!state.materials.length&&!$('no-materials').checked)throw new Error('请选择实际耗材或赠品，或确认本次无实物。');
    if(state.materials.length&&$('no-materials').checked)throw new Error('已有维修材料，不能同时确认无实物。');
    for(const material of state.materials){const row=materialRow(material),reserved=state.materials.filter(m=>m.skuId===material.skuId&&m.warehouseId===material.warehouseId).reduce((sum,m)=>sum+m.quantity,0);if(!row||Number(row.quantity)<reserved)throw new Error('维修材料库存已变化，请刷新后重新核对。');}
    const check=state.payments?.validate();if(!check?.ok)throw new Error(check?.error||'收款账户尚未准备好。');
    const item={skuId:project.skuId,quantity:1,salePrice:feeCents/100,materials:state.materials.map(m=>({...m})),noMaterials:state.materials.length===0,note};
    const payload={customerName:name,customerPhone:phone,orderNote:note,account:check.parts[0]?.account||'',payments:check.parts,items:[item],...(state.receptionId?{receptionId:state.receptionId}:{})};
    const materialText=state.materials.length?state.materials.map(m=>{const row=materialRow(m);return `${m.usage==='gift'?'赠品':'维修耗材'} · ${row?.name||m.skuId} · ${row?.warehouseName||m.warehouseId} × ${m.quantity}`;}).join('；'):'无材料，不扣库存';
    const html=`<strong>提交前核对</strong><p>维修项目：${esc(project.name)} · 1 次</p><p>本次收费：${money(feeCents/100)}</p><p>实物耗用：${esc(materialText)}</p><p>顾客：${esc(name||'未填写')}${phone?' · '+esc(phone):''}</p><p>收款安排：${esc(check.parts.length?check.parts.map(p=>p.account+' '+money(p.amount)).join('；'):'零元，无收款分笔')}</p><p>保存后生成销售单；非现金由实际收款人核对到账。</p>`;
    return {payload,html};
  }
  async function submit(event) {
    event.preventDefault();
    if(!state.review||state.attempt?.submitting)return;
    let current;try{current=buildReview();}catch(error){return status(error.message,true);}
    const body=JSON.stringify(current.payload);
    if(body!==JSON.stringify(state.review.payload))return status('内容已变化，请重新核对本单。',true);
    if(state.attempt?.uncertain&&state.attempt.body!==body)return status('上次提交结果待核对，请保留原内容重试。',true);
    if(!state.attempt||state.attempt.body!==body)state.attempt={body,idempotencyKey:crypto.randomUUID(),uncertain:false};
    state.attempt.submitting=true;$('submit').disabled=true;
    try{
      const order=await api('/api/sale-orders',{method:'POST',headers:{'Idempotency-Key':state.attempt.idempotencyKey},body});
      state.attempt=null;state.review=null;state.materials=[];lockInputs(false);
      if(state.receptionId){state.receptionId=null;history.replaceState(null,'','/repair-services');}
      $('repair-form').reset();$('review').hidden=true;renderMaterials();state.payments?.destroy();state.payments=null;
      status('维修单已保存：'+String(order.displayNo||order.id)+'。请继续按实际收款账户核对。'+(order.repairGiftPolicyWarnings?.length?' '+order.repairGiftPolicyWarnings.join('；')+'。':''),Boolean(order.repairGiftPolicyWarnings?.length));
      try{await load();}catch(error){status('维修单已保存，但列表暂未刷新：'+error.message+'。请按原单号查询，不要重复提交。',true);}
    }catch(error){state.attempt.submitting=false;state.attempt.uncertain=error.uncertain===true;lockInputs(state.attempt.uncertain);$('submit').disabled=false;status(error.message+(state.attempt.uncertain?' 原内容和请求号已保留，可按原请求重试。':''),true);}
  }
  function renderRecords(orders) {
    const repairs=orders.filter(order=>order.repairContext?.kind==='repair'||(order.items||[]).some(item=>item.type==='维修'&&item.stockManaged===false)).slice(0,50);
    $('records').innerHTML=repairs.length?repairs.map(order=>{
      const fromOriginal=order.repairContext?.kind==='repair';
      const items=fromOriginal?order.items:order.items.filter(item=>item.type==='维修'&&item.stockManaged===false);
      const materials=fromOriginal?items.filter(item=>item.stockManaged!==false):items.flatMap(item=>item.materials||[]);
      const itemCost=items.reduce((sum,item)=>sum+Number(item.cost||0),0),separateGiftCost=Number(order.giftCost||0);
      const giftMaterialCost=items.flatMap(item=>item.materials||[]).filter(material=>material.usage==='gift').reduce((sum,material)=>sum+Number(material.cost||0),0);
      const totalCost=itemCost+separateGiftCost,giftCost=giftMaterialCost+separateGiftCost;
      return `<article class="record"><div class="record-head"><span>${esc(order.displayNo||order.id)}</span><span>${money(items.reduce((sum,item)=>sum+Number(item.amount||0),0))}</span></div><small>${esc(new Date(order.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))} · ${esc(order.customerName||'未留姓名')} · ${esc(order.paymentReview?.status||'待核对')}</small><p>${esc(items.map(item=>item.name).join('、'))} · ${materials.length?`材料 ${materials.length} 项`:'无材料'}${state.user?.capabilities?.profit?' · 本单实际成本 '+money(totalCost)+(giftCost?'（其中赠品 '+money(giftCost)+'）':''):''}</p>${fromOriginal?`<p class="hint">原销售单改归维修；实物已按原单出库，原收款不变。${order.repairContext.commissionPercent==null?'提成待核定。':`提成按毛利 ${esc(order.repairContext.commissionPercent)}% 核定。`}</p>`:''}<a href="/app?tab=orders&amp;q=${encodeURIComponent(order.displayNo||order.id)}">查看原销售单与反向操作 ›</a></article>`;
    }).join(''):'<p class="empty">暂无维修服务单。</p>';
  }
  async function load() {
    const [user,products,inventory,accounts,orders,categories]=await Promise.all([
      api('/api/me'),api('/api/products?view=picker'),api('/api/inventory?view=materials'),window.PaymentSplits.loadAccounts(true),api('/api/sale-orders?view=repair'),api('/api/product-category-paths')
    ]);
    state.user=user;state.products=products;state.inventory=inventory;state.categoryPaths=(categories.paths||[]).map(row=>row.path).filter(Array.isArray);
    renderSelectors();renderMaterials();renderRecords(orders);
    $('project-panel').hidden=!user.capabilities?.catalogAdd;
    if(!user.capabilities?.sell){$('entry-panel').hidden=true;return;}
    state.payments?.destroy();
    state.payments=window.PaymentSplits.mount({container:$('payment-parts'),accounts,totalCents:()=>cents($('fee').value),mode:'sale'});
    const receptionId=null;
    if(receptionId){const receptions=await api('/api/receptions');const row=(receptions.rows||[]).find(item=>item.id===receptionId&&!item.publicAssist);if(!row||row.status==='已结案')throw new Error('关联接待单不可用或已结案；请返回接待单核对。');state.receptionId=row.id;$('repair-form').elements.customerPhone.value=row.customerPhone||'';$('repair-form').elements.customerName.value=row.customerName||'';status('将从接待单 '+(row.displayNo||row.id)+' 登记维修；未留手机号也可提交，业务单按接待单号关联。');}
  }
  $('service').addEventListener('change',()=>{if(state.attempt?.uncertain)return;const row=service();if(row?.salePrice>0&&!$('fee').value)$('fee').value=Number(row.salePrice).toFixed(2);state.payments?.refresh();invalidate();});
  $('fee').addEventListener('input',()=>{state.payments?.refresh();invalidate();});
  $('repair-form').addEventListener('input',event=>{if(event.target.id!=='fee')invalidate();});
  $('repair-form').addEventListener('change',invalidate);
  $('add-material').addEventListener('click',addMaterial);
  $('material-search').addEventListener('input',renderMaterialOptions);
  $('materials').addEventListener('click',event=>{const button=event.target.closest('[data-remove]');if(!button||state.attempt?.uncertain)return;state.materials.splice(Number(button.dataset.remove),1);renderMaterials();invalidate();});
  $('no-materials').addEventListener('change',()=>{if($('no-materials').checked){state.materials=[];renderMaterials();}invalidate();});
  $('preview').addEventListener('click',()=>{try{const review=buildReview();state.review=review;$('review').innerHTML=review.html;$('review').hidden=false;$('submit').disabled=false;status('请核对后提交；此时尚未保存或扣库存。');}catch(error){status(error.message,true);}});
  $('repair-form').addEventListener('submit',submit);
  $('new-project').addEventListener('click',openProjectForm);
  $('open-service-project').addEventListener('click',()=>{if($('project-form').hidden)openProjectForm().then(()=>$('project-form').scrollIntoView({behavior:'smooth',block:'start'}));else $('project-form').scrollIntoView({behavior:'smooth',block:'start'});});
  $('cancel-project').addEventListener('click',()=>{$('project-form').hidden=true;});
  $('project-form').addEventListener('submit',saveProject);
  $('refresh').addEventListener('click',()=>load().catch(error=>status(error.message,true)));
  load().catch(error=>{status(error.message,true);$('records').textContent='读取失败，请刷新重试。';});
})();
