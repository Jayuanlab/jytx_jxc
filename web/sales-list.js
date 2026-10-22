const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(collection,row){if(!row?.id)return '';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return '<span class="red-packet-slot" data-rp-collection="'+esc(collection)+'" data-rp-source="'+esc(row.id)+'" hidden><button type="button" class="red-packet-request" data-rp-open>申请红包</button><small data-rp-state></small></span>'; }
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
(()=>{'use strict';
const $=id=>document.getElementById(id),form=$('sales-filter'),params=new URLSearchParams(location.search),token=sessionStorage.getItem('officeLocalToken')||'';
const E=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const W=r=>({'wh-a':'A仓','wh-b':'B仓','wh-c':'C仓'}[r.warehouseId]||r.warehouseName);
const M=value=>'¥'+Number(value||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),Q=value=>Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:3});
const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',year:'numeric'});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
let viewer=null,page=1,pages=1,request=0,view='lines',filters={};
for(const key of ['from','to','warehouse','salesperson','product','supplier','q'])form.elements[key].value=params.get(key)||'';
if(!params.has('from')&&!params.has('to')){form.elements.from.value=today()+'T00:00';form.elements.to.value=today()+'T23:59';}
for(const key of ['warehouse','salesperson','product','supplier'])if(params.get(key))form.elements[key].add(new Option('正在加载…',params.get(key),true,true));
async function api(path){const res=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{}});const data=await res.json();if(!res.ok){const err=new Error(data?.error?.message||'查询失败（'+res.status+'）');err.status=res.status;throw err;}return data;}
function status(text,error=false){$('sales-status').textContent=text;$('sales-status').classList.toggle('error',error);}
function selectOptions(data){
 for(const [key,collection,label] of [['warehouse','warehouses','仓库'],['salesperson','salespeople','营业员'],['product','products','商品'],['supplier','suppliers','供货商']]){
  const control=form.elements[key],selected=filters[key]||'';
  control.innerHTML='<option value="">全部</option>'+data[collection].map(row=>'<option value="'+E(row.id)+'">'+E(row.name)+'</option>').join('');
  if(selected&&!data[collection].some(row=>row.id===selected))control.add(new Option('当前筛选项',selected));
  control.value=selected;
  if(key==='salesperson'&&!viewer.capabilities.allSales){control.value=viewer.id;control.disabled=true;}
 }
}
function card(r){
 const suppliers=r.suppliers.map(s=>s.name).join(' / '),returnInfo=r.returnedQuantity?'<span>退货 '+Q(r.returnedQuantity)+' 件 · '+M(r.returnedAmount)+'</span>':'';
 return '<article class="sales-line"><div class="sales-line-top">'+(r.serialNo?'<code class="sales-serial">'+E(r.serialNo)+'</code>':'<strong class="sales-product-code">'+E(r.externalCode||'商品销售')+'</strong>')+'<span class="sales-warehouse">'+E(r.warehouseName)+'</span></div><h2>'+E(r.name)+'</h2><div class="sales-line-meta"><span>'+E(stamp(r.createdAt))+'</span><span>营业员 <b>'+E(r.salesperson)+'</b></span><span>'+E(r.customerName)+(r.customerMask?' · '+E(r.customerMask):'')+'</span></div><div class="sales-line-price"><span>数量 <b>'+Q(r.quantity)+'</b></span><span>成交单价 <b>'+M(r.salePrice)+'</b></span><strong>'+M(r.netAmount)+'</strong></div><div class="sales-line-origin"><span>供货商 '+E(suppliers)+(r.allocation?' · 来源分摊':'')+'</span><span class="sales-state '+(r.returnedQuantity?'returned':'')+'">'+E(r.status)+'</span></div>'+(returnInfo?'<div class="sales-return-info">'+returnInfo+'<span>净销量 '+Q(r.netQuantity)+' 件</span></div>':'')+'<div class="sales-line-footer"><span>'+E(documentRef(r,'orderId'))+'</span><a href="/app?tab=orders&amp;q='+encodeURIComponent(r.orderId)+'">查看原单 ↗</a>'+redPacketEntry('sales',{id:r.orderId})+'</div></article>';
}
function desktopTable(rows,canProfit,totals){
 const cells=rows.map(r=>'<tr><td>'+E(stamp(r.createdAt))+'</td><td class="sales-table-product" title="'+E(r.externalCode||'')+'"><strong>'+E(r.name)+'</strong></td><td><code>'+E(r.serialNo||'—')+'</code></td><td class="sales-table-warehouse" title="'+E(r.warehouseName)+'">'+E(W(r))+'</td><td>'+E(r.salesperson)+'</td><td>'+E(r.customerName)+'</td><td class="sales-table-supplier">'+r.suppliers.map(s=>E(s.name)).join('<br>')+'</td><td class="sales-table-number" title="原售 '+Q(r.quantity)+' · 退 / 冲 '+Q(r.returnedQuantity)+'">'+Q(r.netQuantity)+'</td><td class="sales-table-number">'+M(r.salePrice)+'</td><td class="sales-table-number sales-table-amount" title="退 / 冲 '+M(r.returnedAmount)+'"><strong>'+M(r.netAmount)+'</strong></td>'+(canProfit?'<td class="sales-table-number sales-table-profit '+(r.netProfit<0?'loss':'')+'">'+(r.netProfit==null?'—':M(r.netProfit))+'</td>':'')+'<td><span class="sales-state '+(r.returnedQuantity?'returned':'')+'">'+E(r.status)+'</span></td><td class="sales-table-order"><a title="查看原单" href="/app?tab=orders&amp;q='+encodeURIComponent(r.orderId)+'">'+E(documentRef(r,'orderId'))+'</a>'+redPacketEntry('sales',{id:r.orderId})+'</td></tr>').join('');
 return '<div class="sales-desktop-results"><table class="sales-desktop-table sales-lines-table"><thead><tr>'+['日期时间','商品','串号','仓库','营业员','顾客','供货商','净数量','成交单价','总价',...(canProfit?['毛利']:[]),'状态','单号 / 原单'].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+cells+'</tbody><tfoot><tr><th colspan="7" scope="row">销售统计 · '+Q(totals.lineCount)+' 条明细</th><td class="sales-table-number">'+Q(totals.netQuantity)+'</td><td class="sales-table-number">—</td><td class="sales-table-number sales-table-amount">'+M(totals.netAmount)+'</td>'+(canProfit?'<td class="sales-table-number sales-table-profit '+(totals.netProfit<0?'loss':'')+'">'+(totals.netProfit==null?'待核对':M(totals.netProfit))+'</td>':'')+'<td></td><td class="sales-table-number">'+Q(totals.orderCount)+' 单</td></tr></tfoot></table></div>';
}

function desktopSuppliers(rows){
 return '<div class="sales-desktop-results"><table class="sales-desktop-table sales-supplier-table"><thead><tr>'+['排名','供货商','净销量','净销售额','累计退货 / 红冲','销售单数','查看'].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map((s,i)=>'<tr><td>'+(i+1)+'</td><td><strong>'+E(s.name)+'</strong>'+(s.allocated?'<small>含来源分摊</small>':'')+'</td><td class="sales-table-number">'+Q(s.netQuantity)+'</td><td class="sales-table-number sales-table-amount">'+M(s.netAmount)+'</td><td class="sales-table-number">'+M(s.returnedAmount)+'</td><td>'+s.orderCount+'</td><td><div class="sales-table-actions"><button type="button" data-supplier="'+E(s.id)+'">销售明细</button>'+(s.id==='__service__'?'':'<a href="/app?tab=inventory&amp;supplier='+encodeURIComponent(s.id)+'">查库存</a>')+'</div></td></tr>').join('')+'</tbody></table></div>';
}

function render(data){
 page=data.page;pages=data.pages;selectOptions(data.options);
 const t=data.totals;
 $('sales-summary').hidden=false;$('sales-summary').classList.toggle('has-profit',Boolean(data.canProfit));
 $('sales-summary').innerHTML=[['销售单',Q(t.orderCount)+' 单'],['净销量',Q(t.netQuantity)+' 件'],['总价',M(t.netAmount)],['累计退货 / 红冲',M(t.returnedAmount)],...(data.canProfit?[['毛利',t.netProfit==null?'待核对':M(t.netProfit)]]:[])].map(([name,value])=>'<div><span>'+name+'</span><strong>'+value+'</strong></div>').join('');
 $('sales-lines').innerHTML=data.rows.length?desktopTable(data.rows,data.canProfit,data.totals)+'<div class="sales-mobile-cards">'+data.rows.map(card).join('')+'</div>':'<div class="sales-empty">没有符合条件的销售记录</div>';
 $('sales-pager').innerHTML=pages>1?'<button type="button" data-page="-1"'+(page===1?' disabled':'')+'>上一页</button><span>'+page+' / '+pages+'</span><button type="button" data-page="1"'+(page===pages?' disabled':'')+'>下一页</button>':'';
 const goods=data.supplierSummary;
 $('sales-suppliers').innerHTML=goods.length?desktopSuppliers(goods)+'<div class="sales-mobile-cards">'+goods.map((s,i)=>'<article class="sales-supplier"><div class="sales-supplier-title"><span class="sales-rank">'+(i+1)+'</span><h2>'+E(s.name)+'</h2></div><div class="sales-supplier-metrics"><span>净销量 <b>'+Q(s.netQuantity)+' 件</b></span><strong>'+M(s.netAmount)+'</strong></div><div class="sales-supplier-meta"><span>'+s.orderCount+' 单</span><span>累计退货 / 红冲 '+M(s.returnedAmount)+'</span>'+(s.allocated?'<span>含来源分摊</span>':'')+'</div><div class="sales-supplier-actions"><button type="button" data-supplier="'+E(s.id)+'">销售明细</button>'+(s.id==='__service__'?'':'<a href="/app?tab=inventory&amp;supplier='+encodeURIComponent(s.id)+'">查这家库存 ↗</a>')+'</div></article>').join('')+'</div>':'<div class="sales-empty">没有符合条件的供货商销售记录</div>';
 status(data.scope+' · '+t.lineCount+' 条商品明细 · '+(data.from||data.to?'按开单时间':'全部日期'));setView(view);
}
function setView(next){view=next;document.body.dataset.salesView=next;$('sales-lines').hidden=next!=='lines';$('sales-pager').hidden=next!=='lines';$('sales-suppliers').hidden=next!=='suppliers';$('sales-lines-tab').setAttribute('aria-pressed',String(next==='lines'));$('sales-suppliers-tab').setAttribute('aria-pressed',String(next==='suppliers'));}
async function load(next=1,readForm=true){
 const version=++request;
 if(readForm){filters=Object.fromEntries(new FormData(form));if(viewer&&!viewer.capabilities.allSales)filters.salesperson=viewer.id;}
 status('正在查询…');form.querySelector('button[type=submit]').disabled=true;
 const query=new URLSearchParams({...filters,page:String(next),limit:'30'});
 try{const data=await api('/api/sales-list?'+query);if(version!==request)return;render(data);}
 catch(error){if(version!==request)return;$('sales-summary').hidden=true;$('sales-lines').innerHTML='';$('sales-suppliers').innerHTML='';$('sales-pager').innerHTML='';status(error.message,true);if(error.status===401)$('sales-lines').innerHTML='<a class="sales-login" href="/login?next='+encodeURIComponent('/sales-list')+'">重新登录</a>';}
 finally{if(version===request)form.querySelector('button[type=submit]').disabled=false;}
}
form.addEventListener('submit',e=>{e.preventDefault();page=1;load();});
$('sales-reset').onclick=()=>{form.reset();for(const key of ['from','to','q','warehouse','salesperson','product','supplier'])form.elements[key].value='';load();};
form.addEventListener('click',e=>{
 const period=e.target.closest('[data-period]');if(!period)return;
 const kind=period.dataset.period,date=today(),start=kind==='yesterday'?shift(date,-1):kind==='week'?shift(date,-6):kind==='month'?date.slice(0,8)+'01':date,end=kind==='yesterday'?start:date;
 form.elements.from.value=kind==='all'?'':start+'T00:00';form.elements.to.value=kind==='all'?'':end+'T23:59';
 form.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b===period));load();
});
$('sales-pager').onclick=e=>{const b=e.target.closest('[data-page]');if(b&&!b.disabled)load(page+Number(b.dataset.page),false).then(()=>$('sales-status').scrollIntoView({block:'start',behavior:'smooth'}));};
$('sales-lines-tab').onclick=()=>setView('lines');$('sales-suppliers-tab').onclick=()=>setView('suppliers');
$('sales-suppliers').onclick=e=>{const b=e.target.closest('[data-supplier]');if(b){form.elements.supplier.value=b.dataset.supplier;setView('lines');load().then(()=>$('sales-status').scrollIntoView({block:'start',behavior:'smooth'}));}};
(async()=>{try{viewer=await api('/api/me');await load();}catch(error){status(error.message,true);if(error.status===401)$('sales-lines').innerHTML='<a class="sales-login" href="/login?next=/sales-list">员工登录</a>';}})();
})();
