const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(){return '';}
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
(()=>{'use strict';
const $=id=>document.getElementById(id),form=$('sales-filter'),params=new URLSearchParams(location.search),token=sessionStorage.getItem('officeLocalToken')||'';
const E=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const W=r=>({'wh-a':'A仓','wh-b':'B仓','wh-c':'C仓'}[r.warehouseId]||r.warehouseName);
const M=value=>'¥'+Number(value||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),Q=value=>Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:3});
const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',year:'numeric'});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
let viewer=null,page=1,pages=1,mobilePage=1,mobilePages=1,request=0,view='lines',filters={},mobileExpanded=false,optionsReady=false;
for(const key of ['from','to','kind','saleState','warehouse','salesperson','supplier','category','brand','q'])form.elements[key].value=params.get(key)||'';
if(!params.has('from')&&!params.has('to')){form.elements.from.value=today()+'T00:00';form.elements.to.value=today()+'T23:59';}
for(const key of ['warehouse','salesperson','supplier','category','brand'])if(params.get(key))form.elements[key].add(new Option('正在加载…',params.get(key),true,true));
async function api(path){const res=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{}});const data=await res.json();if(!res.ok){const err=new Error(data?.error?.message||'查询失败（'+res.status+'）');err.status=res.status;throw err;}return data;}
function status(text,error=false){$('sales-status').textContent=text;$('sales-status').classList.toggle('error',error);}
let categoryPaths=[];
function updateBrands(selected=''){const category=form.elements.category.value,brands=[...new Set(categoryPaths.filter(r=>r.path.length>=2&&(!category||r.path[0]===category)).map(r=>r.path[1]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));form.elements.brand.innerHTML='<option value="">全部品牌／二级分类</option>'+brands.map(v=>'<option value="'+E(v)+'">'+E(v)+'</option>').join('');form.elements.brand.value=brands.includes(selected)?selected:'';}
function selectOptions(data){
 categoryPaths=data.categoryPaths||[];const selectedCategory=filters.category||form.elements.category.value,selectedBrand=filters.brand||form.elements.brand.value;form.elements.category.innerHTML='<option value="">全部分类</option>'+[...new Set(categoryPaths.map(r=>r.path[0]))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(v=>'<option value="'+E(v)+'">'+E(v)+'</option>').join('');form.elements.category.value=selectedCategory;updateBrands(selectedBrand);
 for(const [key,collection,label] of [['warehouse','warehouses','仓库'],['salesperson','salespeople','营业员'],['supplier','suppliers','供货商']]){
  const control=form.elements[key],selected=filters[key]||'';
  control.innerHTML='<option value="">全部'+label+'</option>'+data[collection].map(row=>'<option value="'+E(row.id)+'">'+E(row.name)+'</option>').join('');
  if(selected&&!data[collection].some(row=>row.id===selected))control.add(new Option('当前筛选项',selected));
  control.value=selected;
  if(key==='salesperson'&&!viewer.capabilities.allSales){control.value=viewer.id;control.disabled=true;}
 }
}
function afterSaleEntry(r){return viewer?.capabilities.returnSale&&r.orderId&&r.recordKind!=='mobile'?'<a class="sales-aftersale-entry" href="/app?tab=returns&amp;q='+encodeURIComponent(r.orderId)+'">申请退换货</a>':'';}
function showAfterSaleEntry(){if(!viewer?.capabilities.returnSale)return;const bar=document.createElement('nav');bar.className='sales-filter-actions';bar.setAttribute('aria-label','退换货办理');const button=document.createElement('button');button.type='button';button.textContent='退货 / 换货';button.onclick=()=>location.assign('/app?tab=returns');bar.append(button);form.before(bar);}
function mobileReference(r){return r.businessAmount!=null?'充值 '+M(r.businessAmount):r.mobileKind==='carrier'?(r.expectedCommission==null?'酬金待配置':'预计酬金 '+M(r.expectedCommission)):r.cashReceived!=null?'登记现金 '+M(r.cashReceived):'—';}
function card(r){
 if(r.recordKind==='mobile')return '<article class="sales-line sales-mobile-business"><div class="sales-line-top"><strong class="sales-product-code">移动业务</strong><span class="sales-warehouse">业务日期 '+E(r.businessDate)+'</span></div><h2>'+E(r.name)+(r.detail?' · '+E(r.detail):'')+'</h2><div class="sales-line-meta"><span>营业员 <b>'+E(r.salesperson)+'</b></span><span>'+E(r.customerMask||'未留顾客号码')+'</span><span>移动业务编号 '+E(r.reference||r.sourceId)+'</span></div><div class="sales-business-facts">'+'<span style="white-space:nowrap">'+mobileReference(r)+'</span>'+'</div><div class="sales-line-origin"><span>移动业务 · '+E(r.status)+'</span><a href="'+E(r.sourceUrl)+'">查看原业务单 ↗</a></div></article>';
 const suppliers=r.suppliers.map(s=>s.name).join(' / '),returnInfo=r.returnedQuantity?'<span>退货 '+Q(r.returnedQuantity)+' 件 · '+M(r.returnedAmount)+'</span>':'';
 return '<article class="sales-line"><div class="sales-line-top">'+(r.serialNo?'<code class="sales-serial">'+E(r.serialNo)+'</code>':'<strong class="sales-product-code">'+E(r.externalCode||'商品销售')+'</strong>')+'<span class="sales-warehouse">'+E(r.recordKind==='repair'?(r.repairReclassified?'维修耗材 · '+r.warehouseName:'维修服务'):r.warehouseName)+'</span></div><h2>'+E(r.name)+'</h2><div class="sales-line-meta"><span>'+E(stamp(r.createdAt))+'</span><span>营业员 <b>'+E(r.salesperson)+'</b></span><span>'+E(r.customerName)+(r.customerMask?' · '+E(r.customerMask):'')+'</span></div><div class="sales-line-price"><span>数量 <b>'+Q(r.quantity)+'</b></span><span>成交单价 <b>'+M(r.salePrice)+'</b></span><strong>'+M(r.netAmount)+'</strong></div><div class="sales-line-origin"><span>'+E(r.recordKind==='repair'?(r.repairReclassified?'维修使用实物 · 供货商 '+suppliers:'维修项目'):'供货商 '+suppliers)+(r.allocation?' · 来源分摊':'')+'</span><span class="sales-state '+(r.returnedQuantity?'returned':'')+'">'+E(r.status)+'</span></div>'+(returnInfo?'<div class="sales-return-info">'+returnInfo+'<span>净销量 '+Q(r.netQuantity)+(r.recordKind==='repair'?' 次':' 件')+'</span></div>':'')+'<div class="sales-line-footer"><span>'+E(documentRef(r,'orderId'))+'</span><a href="/app?tab=orders&amp;q='+encodeURIComponent(r.orderId)+'">查看原单 ↗</a>'+afterSaleEntry(r)+redPacketEntry('sales',{id:r.orderId})+'</div></article>';
}
function desktopTable(rows,canProfit,totals){
 const cells=rows.map(r=>r.recordKind==='mobile'?'<tr class="sales-mobile-business"><td>'+E(r.businessDate)+'（业务日）</td><td class="sales-table-product"><strong>移动业务 · '+E(r.name)+'</strong></td><td>—</td><td>不适用</td><td>'+E(r.salesperson)+'</td><td>'+E(r.customerMask||'未留号码')+'</td><td>—</td><td>1 笔</td><td>—</td><td class="sales-table-amount sales-business-amount">'+'<span style="white-space:nowrap">'+mobileReference(r)+'</span></td>'+(canProfit?'<td>—</td>':'')+'<td>'+E(r.status)+'</td><td><a href="'+E(r.sourceUrl)+'">'+E(r.reference||r.sourceId)+'</a></td></tr>':'<tr><td>'+E(stamp(r.createdAt))+'</td><td class="sales-table-product" title="'+E(r.externalCode||'')+'"><strong>'+E(r.name)+'</strong>'+(r.recordKind==='repair'?'<small>'+E(r.repairReclassified?'维修 · 原单实物出库':'维修服务')+'</small>':'')+'</td><td><code>'+E(r.serialNo||'—')+'</code></td><td class="sales-table-warehouse" title="'+E(r.warehouseName)+'">'+E(r.recordKind==='repair'?(r.repairReclassified?'维修耗材 · '+W(r):'维修服务'):W(r))+'</td><td>'+E(r.salesperson)+'</td><td>'+E(r.customerName)+'</td><td class="sales-table-supplier">'+r.suppliers.map(s=>E(s.name)).join('<br>')+'</td><td class="sales-table-number" title="原售 '+Q(r.quantity)+' · 退 / 冲 '+Q(r.returnedQuantity)+'">'+Q(r.netQuantity)+'</td><td class="sales-table-number">'+M(r.salePrice)+'</td><td class="sales-table-number sales-table-amount" title="退 / 冲 '+M(r.returnedAmount)+'"><strong>'+M(r.netAmount)+'</strong></td>'+(canProfit?'<td class="sales-table-number sales-table-profit '+(r.netProfit<0?'loss':'')+'">'+(r.netProfit==null?'—':M(r.netProfit))+'</td>':'')+'<td><span class="sales-state '+(r.returnedQuantity?'returned':'')+'">'+E(r.status)+'</span></td><td class="sales-table-order"><a title="查看原单" href="/app?tab=orders&amp;q='+encodeURIComponent(r.orderId)+'">'+E(documentRef(r,'orderId'))+'</a>'+afterSaleEntry(r)+redPacketEntry('sales',{id:r.orderId})+'</td></tr>').join('');
 return '<div class="sales-desktop-results"><table class="sales-desktop-table sales-lines-table"><thead><tr>'+['日期时间','商品／业务','串号','仓库','营业员','顾客','供货商','净数量','成交单价','销售金额／移动参考额',...(canProfit?['毛利']:[]),'状态','单号 / 原单'].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+cells+'</tbody><tfoot><tr><th colspan="7" scope="row">销售／维修 '+Q(totals.saleLineCount)+' 条 · 移动业务 '+Q(totals.mobileBusinessCount)+' 笔</th><td class="sales-table-number">'+Q(totals.netQuantity)+'</td><td class="sales-table-number">—</td><td class="sales-table-number sales-table-amount">销售收入 '+M(totals.netAmount)+'</td>'+(canProfit?'<td class="sales-table-number sales-table-profit '+(totals.netProfit<0?'loss':'')+'">'+(totals.netProfit==null?'待核对':M(totals.netProfit))+'</td>':'')+'<td></td><td class="sales-table-number">'+Q(totals.orderCount)+' 销售单</td></tr></tfoot></table></div>';
}

function desktopSuppliers(rows){
 return '<div class="sales-desktop-results"><table class="sales-desktop-table sales-supplier-table"><thead><tr>'+['排名','供货商','净销量','净销售额','累计退货 / 红冲','销售单数','查看'].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map((s,i)=>'<tr><td>'+(i+1)+'</td><td><strong>'+E(s.name)+'</strong>'+(s.allocated?'<small>含来源分摊</small>':'')+'</td><td class="sales-table-number">'+Q(s.netQuantity)+'</td><td class="sales-table-number sales-table-amount">'+M(s.netAmount)+'</td><td class="sales-table-number">'+M(s.returnedAmount)+'</td><td>'+s.orderCount+'</td><td><div class="sales-table-actions"><button type="button" data-supplier="'+E(s.id)+'">销售明细</button>'+(s.id==='__service__'?'':'<a href="/app?tab=inventory&amp;supplier='+encodeURIComponent(s.id)+'">查库存</a>')+'</div></td></tr>').join('')+'</tbody></table></div>';
}

function giftBlock(row,canProfit){
 const gifts=row.gifts||{},issued=gifts.items||[],pending=gifts.pending||[],all=[...issued,...pending];if(!all.length)return '';
 const preview=all.slice(0,2).map(g=>g.name+' × '+Q(g.quantity)+(g.unit?' '+g.unit:'')).join('、')+(all.length>2?' 等 '+Q(all.length)+' 项':'');
 const detail=g=>'<div class="sales-gift-item"><strong>'+E(g.name)+' × '+Q(g.quantity)+' '+E(g.unit||'')+'</strong><span>'+E(g.kind)+' · '+E(g.status)+(g.warehouseId?' · '+E(g.warehouseName||g.warehouseId):'')+'</span>'+(g.serialNo?'<code>'+E(g.serialNo)+'</code>':'')+(canProfit&&g.status==='已赠送'?'<span>实际成本 '+(g.cost==null?'待核对':M(g.cost))+'</span>':'')+'</div>';
 const cost=canProfit&&issued.length?'<p class="sales-gift-cost">'+(issued.some(g=>!g.costIncludedInMaterial)?'随单／补赠成本 '+(gifts.issuedCost==null?'待核对':M(gifts.issuedCost)+'，已扣毛利')+'。':'')+(issued.some(g=>g.costIncludedInMaterial)?'维修赠料成本 '+(gifts.materialCost==null?'待核对':M(gifts.materialCost)+'，已包含在耗材成本中')+'。':'')+'</p>':'';
 return '<details class="sales-gifts"><summary><b>本单赠品</b><span>'+E(preview)+'</span></summary><div class="sales-gift-content">'+all.map(detail).join('')+cost+(pending.length?'<p>待审批或已驳回的申请未作为已赠出库。</p>':'')+(gifts.redReversed?'<p>原单已红冲，赠品处置请核对原单。</p>':'')+'<small>整单赠品；多条销售明细可能展示同一份记录。</small></div></details>';
}
function showGifts(data){
 const table=$('sales-lines').querySelector('.sales-lines-table');
 if(table){
  const th=document.createElement('th');th.scope='col';th.textContent='赠品';table.querySelector('thead tr').children[6].after(th);
  [...table.querySelectorAll('tbody tr')].forEach((tr,index)=>{const cell=document.createElement('td');cell.className='sales-table-gifts';cell.innerHTML=giftBlock(data.rows[index],data.canProfit)||'—';tr.children[6].after(cell);});
  const footer=table.querySelector('tfoot th[colspan]');if(footer)footer.colSpan++;
 }
 const cards=$('sales-lines').querySelector('.sales-mobile-cards');
 if(cards)[...cards.children].forEach((card,index)=>{const row=data.rows[index],html=giftBlock(row,data.canProfit);if(!html)return;const host=document.createElement('section');host.className='sales-line-gifts';host.innerHTML=html+(data.canProfit&&row.netProfit!=null?'<p class="sales-gift-margin">本行毛利 '+M(row.netProfit)+'</p>':'');(card.querySelector('.sales-line-footer')||card.lastElementChild).before(host);});
}
function foldMobileRows(data){
 const desktop=$('sales-lines').querySelector('.sales-lines-table tbody');
 const tableRows=desktop?[...desktop.querySelectorAll('tr.sales-mobile-business')]:[];
 const cards=$('sales-lines').querySelector('.sales-mobile-cards');
 const mobileCards=cards?[...cards.querySelectorAll('article.sales-mobile-business')]:[];
 if(!tableRows.length&&!mobileCards.length)return;
 const label='移动业务：本页 '+mobileCards.length+' 笔，查询结果共 '+Q(data.totals.mobileBusinessCount)+' 笔';
 const button=()=>{const node=document.createElement('button');node.type='button';node.className='sales-mobile-toggle';node.dataset.mobileToggle='';node.setAttribute('aria-expanded',String(mobileExpanded));node.textContent=label+' · '+(mobileExpanded?'收起':'展开');return node;};
 if(desktop&&tableRows.length){
  const group=document.createElement('tr');group.className='sales-mobile-fold';
  const cell=document.createElement('td');cell.colSpan=desktop.closest('table').querySelectorAll('thead th').length;cell.append(button());group.append(cell);desktop.append(group);
  tableRows.forEach(row=>{row.dataset.mobileEntry='';row.hidden=!mobileExpanded;desktop.append(row);});
 }
 if(cards&&mobileCards.length){
  const toggle=button();toggle.classList.add('sales-mobile-card-toggle');cards.append(toggle);
  mobileCards.forEach(row=>{row.dataset.mobileEntry='';row.hidden=!mobileExpanded;cards.append(row);});
 }
}

function render(data){
 mobilePage=data.mobilePage||1;mobilePages=data.mobilePages||1;const separate=data.separateMobile===true&&data.totals.mobileBusinessCount>0;$('sales-mobile-section').hidden=!separate;if(separate){$('sales-mobile-heading').textContent='移动业务 '+Q(data.totals.mobileBusinessCount)+' 笔 · 第 '+mobilePage+' / '+mobilePages+' 页';$('sales-mobile-lines').innerHTML=desktopTable(data.mobileRows,data.canProfit,{...data.totals,saleLineCount:0,mobileBusinessCount:data.totals.mobileBusinessCount,netQuantity:0,netAmount:0,netProfit:0,orderCount:0})+'<div class="sales-mobile-cards">'+data.mobileRows.map(card).join('')+'</div>';$('sales-mobile-pager').innerHTML=mobilePages>1?'<button type="button" data-mobile-page="-1"'+(mobilePage===1?' disabled':'')+'>上一页</button><span>'+mobilePage+' / '+mobilePages+'</span><button type="button" data-mobile-page="1"'+(mobilePage===mobilePages?' disabled':'')+'>下一页</button>':'';}else{$('sales-mobile-lines').innerHTML='';$('sales-mobile-pager').innerHTML='';}
 page=data.page;pages=data.pages;selectOptions(data.options);
 const t=data.totals;const selectedLabels=['kind','saleState','warehouse','salesperson','category','brand','supplier'].map(key=>{const control=form.elements[key];return control?.value?control.options[control.selectedIndex]?.textContent||'':'';}).filter(Boolean),scopeText=(filters.from||'不限开始')+' 至 '+(filters.to||'不限结束')+(selectedLabels.length?' · '+selectedLabels.join(' / '):' · 全部分类／品牌／供货商');$('sales-scope-note').textContent='本次统计范围：'+scopeText+'。下列数量、金额均按当前条件统计。';
 $('sales-summary').hidden=false;$('sales-summary').classList.toggle('has-profit',Boolean(data.canProfit));
 $('sales-summary').innerHTML=[['销售单',Q(t.orderCount)+' 单'],['实物净销量',Q(t.goodsNetQuantity)+' 件'],['实物销售额',M(t.goodsNetAmount)],['维修服务',Q(t.repairCount)+' 条 · '+M(t.repairNetAmount)],['销售收入合计',M(t.netAmount)],['移动业务',Q(t.mobileBusinessCount)+' 笔'],['移动充值面额',M(t.mobileRechargeAmount)],['移动预计酬金',t.mobileCommissionUnknownCount?(t.mobileExpectedCommission?'已配置 '+M(t.mobileExpectedCommission)+' · '+t.mobileCommissionUnknownCount+' 笔待配置':t.mobileCommissionUnknownCount+' 笔酬金待配置'):M(t.mobileExpectedCommission)],['累计退货 / 红冲',M(t.returnedAmount)],...(data.canProfit?[['销售毛利',t.netProfit==null?'待核对':M(t.netProfit)]]:[])].map(([name,value])=>'<div><span>'+name+'</span><strong>'+value+'</strong></div>').join('');
 $('sales-lines').innerHTML=data.rows.length?desktopTable(data.rows,data.canProfit,data.totals)+'<div class="sales-mobile-cards">'+data.rows.map(card).join('')+'</div>':'<div class="sales-empty">没有符合条件的销售记录</div>';
 showGifts(data);
 // Query details are always expanded; pagination is explicit.
 $('sales-pager').innerHTML=pages>1?'<button type="button" data-page="-1"'+(page===1?' disabled':'')+'>上一页</button><span>'+page+' / '+pages+'</span><button type="button" data-page="1"'+(page===pages?' disabled':'')+'>下一页</button>':'';
 const goods=data.supplierSummary;
 $('sales-suppliers').innerHTML=goods.length?desktopSuppliers(goods)+'<div class="sales-mobile-cards">'+goods.map((s,i)=>'<article class="sales-supplier"><div class="sales-supplier-title"><span class="sales-rank">'+(i+1)+'</span><h2>'+E(s.name)+'</h2></div><div class="sales-supplier-metrics"><span>净销量 <b>'+Q(s.netQuantity)+' 件</b></span><strong>'+M(s.netAmount)+'</strong></div><div class="sales-supplier-meta"><span>'+s.orderCount+' 单</span><span>累计退货 / 红冲 '+M(s.returnedAmount)+'</span>'+(s.allocated?'<span>含来源分摊</span>':'')+'</div><div class="sales-supplier-actions"><button type="button" data-supplier="'+E(s.id)+'">销售明细</button>'+(s.id==='__service__'?'':'<a href="/app?tab=inventory&amp;supplier='+encodeURIComponent(s.id)+'">查这家库存 ↗</a>')+'</div></article>').join('')+'</div>':'<div class="sales-empty">没有符合条件的供货商销售记录</div>';
 status(data.scope+' · '+t.saleLineCount+' 条销售／维修明细（第 '+page+' / '+pages+' 页）、'+t.mobileBusinessCount+' 笔移动业务；明细全部展开，移动金额与销售收入分开统计');setView(view);
}
function setView(next){view=next;$('sales-mobile-section').hidden=next!=='lines'||!$('sales-mobile-lines').innerHTML;document.body.dataset.salesView=next;$('sales-lines').hidden=next!=='lines';$('sales-pager').hidden=next!=='lines';$('sales-suppliers').hidden=next!=='suppliers';$('sales-lines-tab').setAttribute('aria-pressed',String(next==='lines'));$('sales-suppliers-tab').setAttribute('aria-pressed',String(next==='suppliers'));}
async function load(next=1,readForm=true){
 const version=++request;
 if(readForm){mobilePage=1;filters=Object.fromEntries(new FormData(form));if(viewer&&!viewer.capabilities.allSales)filters.salesperson=viewer.id;mobileExpanded=filters.kind==='mobile'||Boolean(filters.q?.trim());}
 status('正在查询…');form.querySelector('button[type=submit]').disabled=true;
 const query=new URLSearchParams({...filters,page:String(next),limit:'30',separateMobile:'1',mobilePage:String(mobilePage)});
 try{const data=await api('/api/sales-list?'+query);if(version!==request)return;render(data);}
 catch(error){if(version!==request)return;$('sales-summary').hidden=true;$('sales-lines').innerHTML='';$('sales-suppliers').innerHTML='';$('sales-pager').innerHTML='';status(error.message,true);if(error.status===401)$('sales-lines').innerHTML='<a class="sales-login" href="/login?next='+encodeURIComponent('/sales-list')+'">重新登录</a>';}
 finally{if(version===request)form.querySelector('button[type=submit]').disabled=false;}
}
form.addEventListener('submit',e=>{e.preventDefault();if(!optionsReady){status('查询选项尚未加载，请稍后或点击重试',true);return;}page=1;load();});
form.elements.category.onchange=()=>{updateBrands();status('筛选已修改 · 点击查询');};
form.elements.kind.addEventListener('change',()=>{if(form.elements.kind.value==='mobile')for(const key of ['warehouse','supplier','category','brand','saleState'])form.elements[key].value='';page=1;status('筛选已修改 · 点击查询');});
$('sales-reset').onclick=()=>{form.reset();for(const key of ['from','to','kind','saleState','q','warehouse','salesperson','supplier','category','brand'])form.elements[key].value='';status('筛选已修改 · 点击查询');};
form.addEventListener('click',e=>{
 const period=e.target.closest('[data-period]');if(!period)return;
 const kind=period.dataset.period,date=today(),start=kind==='yesterday'?shift(date,-1):kind==='week'?shift(date,-6):kind==='month'?date.slice(0,8)+'01':date,end=kind==='yesterday'?start:date;
 form.elements.from.value=kind==='all'?'':start+'T00:00';form.elements.to.value=kind==='all'?'':end+'T23:59';
 form.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b===period));status('筛选已修改 · 点击查询');
});
$('sales-mobile-pager').onclick=e=>{const b=e.target.closest('[data-mobile-page]');if(b&&!b.disabled){mobilePage+=Number(b.dataset.mobilePage);load(page,false);}};
$('sales-pager').onclick=e=>{const b=e.target.closest('[data-page]');if(b&&!b.disabled)load(page+Number(b.dataset.page),false).then(()=>$('sales-status').scrollIntoView({block:'start',behavior:'smooth'}));};
$('sales-lines-tab').onclick=()=>setView('lines');$('sales-suppliers-tab').onclick=()=>setView('suppliers');
$('sales-lines').addEventListener('click',event=>{if(!event.target.closest('[data-mobile-toggle]'))return;mobileExpanded=!mobileExpanded;for(const row of $('sales-lines').querySelectorAll('[data-mobile-entry]'))row.hidden=!mobileExpanded;for(const button of $('sales-lines').querySelectorAll('[data-mobile-toggle]')){button.setAttribute('aria-expanded',String(mobileExpanded));button.textContent=button.textContent.replace(/ · (?:展开|收起)$/,' · '+(mobileExpanded?'收起':'展开'));}});
$('sales-suppliers').onclick=e=>{const b=e.target.closest('[data-supplier]');if(b){form.elements.supplier.value=b.dataset.supplier;setView('lines');load().then(()=>$('sales-status').scrollIntoView({block:'start',behavior:'smooth'}));}};
const optionKeys=['warehouse','salesperson','supplier','category','brand'],submit=form.querySelector('button[type=submit]');
const optionRetry=document.createElement('button');optionRetry.type='button';optionRetry.textContent='重新加载查询选项';optionRetry.hidden=true;form.append(optionRetry);
async function initializeOptions(){
 optionsReady=false;submit.disabled=true;optionRetry.hidden=true;
 const selected={...filters,...Object.fromEntries(new FormData(form))};filters=selected;
 for(const key of optionKeys){form.elements[key].disabled=true;form.elements[key].setAttribute('aria-busy','true');}
 status('正在加载查询选项…');
 try{
  viewer=viewer||await api('/api/me');
  if(!document.querySelector('[aria-label="退换货办理"]'))showAfterSaleEntry();
  const data=await api('/api/sales-list?optionsOnly=1');
  filters=selected;
  for(const key of optionKeys)form.elements[key].disabled=false;
  selectOptions(data.options);optionsReady=true;status('请选择条件后查询');
 }catch(error){status('查询选项加载失败：'+error.message,true);optionRetry.hidden=false;if(error.status===401)$('sales-lines').innerHTML='<a class="sales-login" href="/login?next=/sales-list">员工登录</a>';}
 finally{for(const key of optionKeys)form.elements[key].removeAttribute('aria-busy');submit.disabled=!optionsReady;}
}
optionRetry.addEventListener('click',initializeOptions);initializeOptions();
})();
