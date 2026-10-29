"use strict";
(()=>{
 const $=id=>document.getElementById(id),ui=window.OrderRedPackets,E=ui.escape,M=ui.money,query=new URLSearchParams(location.search);
 const focusId=query.get('request')||'',sourceKey=query.get('sourceKey')||'',initialStatus=query.get('status')||'';let data=null,sourceRevision=0;
 if(['待老板核定','已核定待支付','pending'].includes(initialStatus))$('red-packets-status').value='pending';else if([...$('red-packets-status').options].some(o=>o.value===initialStatus))$('red-packets-status').value=initialStatus;
 const date=value=>{const at=Date.parse(value);return Number.isFinite(at)?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at):'';};
 const error=e=>{$('red-packets-error').textContent=e?.message||'';};
 function render(){
  if(!data)return;const state=ui.getState(),owner=state.actor?.roleCode==='owner';$('red-packets-who').textContent=state.actor?.name||'';$('red-packets-apply').hidden=!state.canRequest||!!focusId;
  if(owner&&!initialStatus&&!sourceKey&&!focusId&&!$('red-packets-status').dataset.initialized){$('red-packets-status').value='pending';$('red-packets-status').dataset.initialized='1';}
  $('red-packets-title').textContent=focusId?'红包待办':owner?'红包申请与处理':'我的红包申请';
  if(focusId){$('red-packets-status').disabled=true;if(!$('red-packets-focus-back')){const back=document.createElement('a');back.id='red-packets-focus-back';back.href='/boss-batch';back.textContent='‹ 返回待办';$('red-packets-title').after(back);}}
  const status=$('red-packets-status').value,rows=(data.rows||[]).filter(r=>(!focusId||r.id===focusId||r.displayNo===focusId)&&(!sourceKey||focusId||r.sourceKey===sourceKey)&&(!status||focusId||(status==='pending'?['待老板核定','已核定待支付'].includes(r.status):r.status===status)));
  $('red-packets-rows').innerHTML=rows.length?rows.map(r=>{
   const source=r.sourceSnapshot||{},paid=r.status==='已支付',amount=paid||r.approvedAmount!=null?r.approvedAmount:r.requestedAmount;
   const label=paid?(r.paymentReversed?'已红冲待核对':r.paymentState==='recorded'?'已发放':'付款待核对'):ui.statusText(r.status);
   const action=(name,text)=>'<button type="button" data-rp-action="'+name+'" data-id="'+E(r.id)+'">'+text+'</button>';
   return '<article class="red-packets-row"><div class="red-packets-row-main"><div class="red-packets-identity"><strong>'+E(r.employeeName)+'</strong><span class="red-packets-badge">'+E(label)+'</span><small>'+E(source.displayNo||'原单待核对')+'</small><p>'+E(source.contentSummary||source.label||'')+'</p></div><div class="red-packets-amount"><strong>'+E(amount==null?'待核定':M(amount))+'</strong><small>'+E(paid?'发放金额':r.approvedAmount!=null?'核定金额':'申请金额')+'</small></div><div class="red-packets-actions">'+(r.canWithdraw&&!(owner&&r.canReview)?action('withdraw','撤回'):'')+(owner&&r.canReview?action('reject','不同意'):'')+(owner&&r.canPay?action('pay','同意发放'):'')+'</div></div><details class="red-packets-detail"><summary>详情 · '+E(r.displayNo)+'</summary>'+(r.reason?'<p>申请备注：'+E(r.reason)+'</p>':'')+(r.reviewNote?'<p>处理说明：'+E(r.reviewNote)+'</p>':'')+'<p>'+E(r.message||'')+'</p>'+(r.paymentReference?'<p>付款依据：'+E(r.paymentReference)+' · '+E(r.paymentDate)+'</p>':'')+'<div>'+((r.events||[]).map(e=>'<p>'+E(e.type)+' · '+E(date(e.at))+(e.reason||e.note?' · '+E(e.reason||e.note):'')+'</p>').join(''))+'</div></details></article>';
  }).join(''):'<p class="red-packets-empty">'+(focusId?'未找到这张申请或当前账号无权查看。':'暂无符合条件的申请。')+'</p>';
 }
 async function load(){try{data=await ui.refresh();render();error(null);}catch(e){error(e);}}
 async function search(){
  const q=$('red-packets-source-form').elements.q.value.trim(),revision=++sourceRevision,epoch=ui.getState().epoch;
  if(!q){$('red-packets-sources').replaceChildren();$('red-packets-source-count').textContent='请输入关联流水号或业务名称。';return;}
  const button=$('red-packets-source-form').querySelector('button');button.disabled=true;$('red-packets-source-count').textContent='正在查询…';
  try{const result=await ui.api('/api/order-red-packets/sources?'+new URLSearchParams({q}));if(revision!==sourceRevision||epoch!==ui.getState().epoch)return;
   $('red-packets-source-count').textContent=result.total?'找到 '+result.total+' 张单据'+(result.truncated?'，请补充流水号缩小范围。':'。'):'没有匹配单据，请核对流水号或业务名称。';
   $('red-packets-sources').innerHTML=(result.rows||[]).map(s=>'<article class="red-packets-source"><div><strong>'+E(s.displayNo)+'</strong><p>'+E(s.contentSummary||s.label)+'</p><small>'+E(s.label)+' · '+E(date(s.createdAt))+'</small></div><button type="button" data-apply-source="'+E(s.sourceId)+'" data-source-collection="'+E(s.collection)+'">申请红包</button></article>').join('');error(null);
  }catch(e){if(revision===sourceRevision){$('red-packets-source-count').textContent='查询未完成，请重试。';error(e);}}finally{if(revision===sourceRevision)button.disabled=false;}
 }
 $('red-packets-source-form').addEventListener('submit',e=>{e.preventDefault();search();});
 $('red-packets-sources').addEventListener('click',async e=>{const b=e.target.closest('[data-apply-source]');if(!b||b.disabled)return;b.disabled=true;try{await ui.request(b.dataset.sourceCollection,b.dataset.applySource);}catch(err){error(err);}finally{if(b.isConnected)b.disabled=false;}});
 $('red-packets-refresh').onclick=load;$('red-packets-status').onchange=render;
 $('red-packets-rows').addEventListener('click',async e=>{const b=e.target.closest('[data-rp-action]');if(!b||b.disabled)return;b.disabled=true;try{await ui.action(b.dataset.id,b.dataset.rpAction);}catch(err){error(err);}finally{if(b.isConnected)b.disabled=false;}});
 document.addEventListener('red-packet-context-cleared',()=>{sourceRevision++;data=null;$('red-packets-who').textContent='';$('red-packets-rows').replaceChildren();$('red-packets-sources').replaceChildren();$('red-packets-apply').hidden=true;error(new Error('账号或权限已变化，请重新进入。'));});
 document.addEventListener('red-packet-saved',load);load();
})();
