'use strict';
(()=>{
const $=id=>document.getElementById(id),form=$('document-query'),E=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const types={sales:'销售单',procurementPlans:'订货单',purchases:'进货入库单',saleReturnRequests:'退换货申请',saleReturns:'销售退货单',saleExchanges:'换货单',purchaseReturnRequests:'采购退货申请',purchaseReturns:'采购退货单',receiptsIn:'收款单',receiptsOut:'付款流水',expenses:'费用付款单',otherIncome:'其他收款单',dailyCloseouts:'日结账单',closeouts:'当日中途扎账单',cashHandovers:'现金交接／存银行',stockTransfers:'调拨单',stocktakes:'盘点单',receptions:'接待单',airRechargeEvents:'空充BOSS充值单',supplierCash:'往来收付款',giftOrders:'赠品单',redReversals:'红冲单'};
delete types.receptions;
Object.assign(types,{supplierExchanges:'供货商换货单',businessChangeRequests:'业务变更退换申请单',supplierOutboundTransfers:'供货商调货跟踪'});
$('document-type').insertAdjacentHTML('beforeend',Object.entries(types).map(([key,label])=>`<option value="${key}">${label}</option>`).join(''));
let generation=0,controller=null,next=null,lastParams=null;
const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录时间';
const statuses={open:'待收货',received:'已收齐',completed:'已完成',returned:'已退货','partially-returned':'部分退货',pending:'待处理',approved:'已批准',rejected:'已驳回',cancelled:'已撤销',closed:'已结束'};
function card(row){return `<article class="query-document"><div class="document-heading"><h2>${E(row.displayNo)}</h2><span class="document-kind">${E(row.typeName)}</span></div><div class="document-facts"><p>${E(time(row.createdAt))}</p>${row.status?`<p>${E(statuses[row.status]||row.status)}</p>`:''}${row.counterparty?`<p>往来：${E(row.counterparty)}</p>`:''}${row.employee?`<p>经办：${E(row.employee)}</p>`:''}${row.amount!=null?`<p class="document-money">单据金额：¥${E(Number(row.amount).toFixed(2))}</p>`:''}</div>${row.items?.length?`<div class="document-items">${row.items.map(item=>`<div class="document-item"><strong>${E(item.name)}</strong>${item.quantity!=null?` × ${E(item.quantity)}`:''}${item.code?`<span class="serial">商品编码：${E(item.code)}</span>`:''}${item.serialNo||item.serials?.length?`<span class="serial">串号：${[item.serialNo,...(item.serials||[])].filter(Boolean).map(E).join('、')}</span>`:''}</div>`).join('')}</div>`:''}<a href="${E(row.href)}">查看原单</a></article>`;}
function resetResults(){generation++;controller?.abort();controller=null;next=null;lastParams=null;$('query-results').replaceChildren();$('load-more').hidden=true;$('query-submit').disabled=false;$('load-more').disabled=false;$('query-status').className='';$('query-status').textContent='选好条件后点“查询”。多个条件同时生效。';}
async function run(more=false){
 const params=more?new URLSearchParams(lastParams):new URLSearchParams(new FormData(form));
 if(more&&next!=null)params.set('offset',next);
 const from=params.get('from'),to=params.get('to');if(from&&to&&from>to){$('query-status').textContent='开始日期不能晚于结束日期';return;}
 controller?.abort();controller=new AbortController();const signal=controller.signal,revision=++generation;
 if(!more){$('query-results').replaceChildren();next=null;lastParams=params.toString();}
 $('query-submit').disabled=true;$('load-more').disabled=true;$('query-status').className='';$('query-status').textContent='正在查询…';
 const requestController=controller,timeout=setTimeout(()=>requestController.abort(),20000);
 try{
  const response=await fetch('/api/document-query?'+params,{credentials:'same-origin',cache:'no-store',signal});
  if(response.status===401)throw new Error('登录已失效，请返回工作台重新登录');
  let data;try{data=await response.json();}catch{throw new Error('服务器未返回查询结果，请稍后重试');}if(!response.ok)throw new Error(data.error?.message||'查询未成功，请重试');
  if(revision!==generation)return;
  if(!more&&!data.rows.length)$('query-results').innerHTML='<p class="empty">没有符合这些条件的单据，可减少条件后重新查询。</p>';
  else $('query-results').insertAdjacentHTML('beforeend',data.rows.map(card).join(''));
  next=data.nextOffset;$('load-more').hidden=next==null;
  $('query-status').textContent=`找到 ${data.total} 张单据，已显示 ${$('query-results').querySelectorAll('article').length} 张。`;
 }catch(error){if(revision!==generation)return;$('query-status').className='error';$('query-status').textContent=error.name==='AbortError'?'查询超时，请缩小时间范围后重试':error.message;}
 finally{clearTimeout(timeout);if(revision===generation){$('query-submit').disabled=false;$('load-more').disabled=false;}}
}
form.addEventListener('submit',event=>{event.preventDefault();run();});
form.addEventListener('input',resetResults);form.addEventListener('change',resetResults);form.addEventListener('reset',resetResults);
$('load-more').onclick=()=>run(true);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('today').onclick=()=>{form.elements.from.value=today();form.elements.to.value=today();resetResults();};
$('month').onclick=()=>{form.elements.from.value=today().slice(0,7)+'-01';form.elements.to.value=today();resetResults();};
$('all-dates').onclick=()=>{form.elements.from.value='';form.elements.to.value='';resetResults();};
const incoming=new URLSearchParams(location.search);for(const name of ['type','number','product','counterparty','employee','from','to'])if(incoming.has(name))form.elements[name].value=incoming.get(name);
})();
