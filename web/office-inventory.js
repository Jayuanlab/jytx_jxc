(() => {
  const initialInventoryFilters=new URLSearchParams(location.search);
  const filters={warehouse:initialInventoryFilters.get('warehouse')||'',supplier:initialInventoryFilters.get('supplier')||'',category:'',subcategory:'',q:initialInventoryFilters.get('inventoryQ')||'',status:'stock'}, pageSize=30;
  let page=1, stream=null, cameraRun=0;
  const available=s=>s.inStock===true||['可售','未激活'].includes(s.status);
  const supplierKey=s=>s.supplierId|| (s.supplier?'name:'+s.supplier:'__unknown__');
  const sources=p=>p.stockSources?.length?p.stockSources:[{supplier:'',supplierId:'',purchaseDate:''}];
  const day=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}):'待补';
  const actions=(p,s)=>(state.user.capabilities.manageProducts?button('商品调价','price-request',p.skuId):'')+(state.user.capabilities.purchase&&state.user.capabilities.stocktake&&['wh-a','wh-b','wh-c','wh-other'].includes(p.warehouseId)&&p.stockManaged!==false&&Number(p.quantity)>0&&(!p.trackSerial||(s?available(s):(p.serials||[]).some(available)))?button('仓库调拨','transfer-c',JSON.stringify({stockKey:p.stockKey,serialNo:s?.no||''})): '');
  function stop(){cameraRun++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;}
  function close(){stop();document.getElementById('inventory-count-dialog')?.remove();}
  function lookup(p,q){const text=[p.name,p.shortName,p.externalCode,p.type,p.subType,p.thirdType,...(p.aliases||[])].join(' ').toLowerCase();return q.split(/\s+/).filter(Boolean).every(term=>{const group=state.searchSynonyms.find(g=>g.terms?.some(w=>w.toLowerCase()===term));return(group?.terms||[term]).some(w=>text.includes(w.toLowerCase()));});}
  const deviceCategories=['智能机','功能机','二手机','儿童手表','笔记本','其他数码'];
  const categoryDefaults={'wh-a':deviceCategories,'wh-b':['配件','维修材料'],'wh-c':deviceCategories};
  function category(p){
    const raw=String(p.type||'未分类').trim(),aliases={'智能手机':'智能机','二手手机':'二手机','老人机':'功能机','老年机':'功能机','按键机':'功能机','老人手机':'功能机','老年手机':'功能机','维修':'维修材料'};
    return aliases[raw]||raw;
  }
  const categoryLabel=value=>value==='手表'?'手表（待细分）':value;
  function goods(warehouse=filters.warehouse){return [...new Map(state.inventory.filter(p=>p.stockManaged!==false&&(!warehouse||p.warehouseId===warehouse)).map(p=>[p.skuId,p])).values()];}
  function categoryNames(warehouse=filters.warehouse){return [...new Set([...(warehouse?categoryDefaults[warehouse]||[]:Object.values(categoryDefaults).flat()),...goods(warehouse).map(category)])];}
  function updateCategoryFilters(){
    const names=categoryNames(),products=goods();
    if(filters.category&&!names.includes(filters.category)){filters.category='';filters.subcategory='';}
    $('inventory-category').innerHTML=option('','全部商品类别')+names.map(name=>option(name,categoryLabel(name)+'（'+products.filter(p=>category(p)===name).length+'款）',filters.category===name)).join('');
    const branches=[...new Set(products.filter(p=>!filters.category||category(p)===filters.category).map(p=>p.subType).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    if(filters.subcategory&&!branches.includes(filters.subcategory))filters.subcategory='';
    $('inventory-subcategory').innerHTML=option('','全部品牌或配件类别')+branches.map(name=>option(name,name,filters.subcategory===name)).join('');
  }
  function classificationOverview(){
    const groups=[];
    for(const warehouse of state.warehouses){
      const products=[...new Map(state.products.filter(p=>p.stockManaged!==false&&p.warehouseId===warehouse.id).map(p=>[p.skuId,p])).values()];
      const names=[...new Set([...(categoryDefaults[warehouse.id]||[]),...products.map(category)])];
      groups.push(`<section class="inventory-category-group"><h3>${E(warehouse.name)}</h3>${names.map(name=>{const rows=products.filter(p=>category(p)===name),branches=new Map();for(const row of rows){if(row.subType)branches.set(row.subType,(branches.get(row.subType)||0)+1);}return `<article class="inventory-category-row"><strong>${E(categoryLabel(name))} · ${rows.length}款</strong>${branches.size?`<p>${[...branches].map(([sub,n])=>E(sub)+' '+n+'款').join('、')}</p>`:'<p>暂无下一级分类</p>'}<button type="button" data-inv-category="${E(name)}" data-inv-category-warehouse="${E(warehouse.id)}">查看这类库存</button></article>`;}).join('')}</section>`);
    }
    const services=state.products.filter(p=>p.stockManaged===false),review=state.products.filter(p=>p.type==='手表'||p.type==='配件'&&['复印','SKK','麦斯威尔'].includes(p.subType));
    return `<details id="inventory-classification" class="inventory-classification"><summary>查看商品分类（按型号统计）</summary><p class="inventory-fixed" data-page-explanation>仓库 → 商品类别 → 品牌或配件类别 → 商品型号 → 单台串号。A仓和C仓共用商品分类方式，C仓商品名称加YD。下列“款数”统计商品档案。</p><div class="inventory-category-groups">${groups.join('')}</div>${services.length?`<section class="inventory-category-group"><h3>不入仓的收费项目</h3>${[...new Set(services.map(p=>p.type||'服务'))].map(type=>`<article class="inventory-category-row"><strong>${E(type)} · ${services.filter(p=>p.type===type).length}项</strong><p>${services.filter(p=>p.type===type).map(p=>E(p.subType||p.name)).join('、')}</p></article>`).join('')}</section>`:''}${review.length?`<details class="inventory-category-review"><summary>待核对的分类档案（${review.length}款）</summary><p class="inventory-warning">手表还需区分儿童手表等类别；部分品牌名被用作配件类别。请按实际商品核对。</p>${review.map(p=>`<article class="inventory-category-row"><strong>${E(p.name)}</strong><p>现有分类：${E([p.type,p.subType,p.thirdType].filter(Boolean).join(' / '))}</p>${state.user.capabilities.manageProducts?button('修改分类','edit-product',p.skuId):''}</article>`).join('')}</details>`:''}</details>`;
  }
  function entries(){
    const result=[],q=filters.q.trim().toLowerCase();
    for(const p of state.inventory.filter(p=>p.stockManaged!==false)){
      if(filters.warehouse&&p.warehouseId!==filters.warehouse||filters.category&&category(p)!==filters.category||filters.subcategory&&p.subType!==filters.subcategory)continue;
      if(p.trackSerial){
        for(const s of p.serials||[]){
          if(filters.status==='stock'&&!available(s)||filters.supplier&&supplierKey(s)!==filters.supplier)continue;
          if(q&&!lookup(p,q)&&!(q.length===4?s.no.toLowerCase().endsWith(q):s.no.toLowerCase().includes(q)))continue;
          result.push({p,s,quantity:available(s)?1:0});
        }
        const missing=Number(p.serialDifference??Number(p.quantity)-(p.serials||[]).filter(available).length);
        if(missing>0&&(!filters.supplier||filters.supplier==='__unknown__')&&(!q||lookup(p,q)))result.push({p,missing,quantity:missing});
      }else{
        if(filters.status==='stock'&&Number(p.quantity)<=0||filters.supplier&&!sources(p).some(s=>supplierKey(s)===filters.supplier)||q&&!lookup(p,q))continue;
        result.push({p,quantity:Number(p.quantity)});
      }
    }
    return result;
  }
  function card({p,s,missing}){
    if(s){
      const warehouse=String(p.warehouseName||'未分仓'),badge=warehouse.match(/^[ABC]/i)?.[0]||warehouse;
      const cost=s.costPrice==null||!Number.isFinite(Number(s.costPrice))?'待补':M(s.costPrice);
      return `<article class="inventory-unit inventory-phone-unit" data-stock-key="${E(p.stockKey)}" data-serial="${E(s.no)}"><div class="inventory-phone-head"><code class="inventory-phone-serial">${E(s.no)}</code><span class="inventory-phone-warehouse" aria-label="${E(warehouse)}" title="${E(warehouse)}">${E(badge)}</span></div><h2 class="inventory-phone-model">${E(p.name)}</h2><p class="inventory-phone-origin"><span>供货商 ${E(s.supplier||'待补')}</span><span>进货 ${E(day(s.purchaseDate))}</span></p><p class="inventory-phone-values"><span>进价 <b class="inventory-phone-cost">${E(cost)}</b></span><span>零售价 <b>${M(p.salePrice)}</b></span>${s.status!=='可售'?`<span class="inventory-phone-state">${E(s.status)}</span>`:''}</p>${p.serialDifference<0?'<p class="inventory-warning">串号数量多于账面数量，请盘库核实。</p>':''}<details class="inventory-more"><summary>详情与操作</summary><p>仓库：${E(warehouse)} · 状态：${E(s.status)}</p><p>商品编号：${E(p.externalCode||p.skuId)}</p><p>分类：${E([p.type,p.subType,p.thirdType].filter(Boolean).join(' / '))}</p><p>原入库单：${E(documentRef(s,"purchaseId")||'待补')}</p><div class="inventory-unit-actions">${actions(p,s)}<a href="/search?scope=serials&amp;q=${encodeURIComponent(s.no)}">追踪这台手机</a></div></details></article>`;
    }

    const metadata=`<span class="inventory-chip">${E(p.warehouseName)}</span><span class="inventory-chip">${E(s?s.status:p.trackSerial?'串号待补':p.type||'实物商品')}</span>`;
    const serial=s?`<div class="inventory-serial"><span>串号</span><code>${E(s.no)}</code></div>`:missing?`<p class="inventory-warning">账面有 ${E(missing)} 台还缺串号，请逐台补录。</p>`:'';
    const origin=s?`<div><dt>供货商</dt><dd>${E(s.supplier||'待补')}</dd></div><div><dt>进货日期</dt><dd>${E(day(s.purchaseDate))}</dd></div>`:p.trackSerial?'':`<div><dt>供货商</dt><dd>${E([...new Set(sources(p).map(s=>s.supplier||'待补'))].join('、'))}</dd></div>`;
    const quantity=s?'':`<div><dt>${missing?'待补串号数量':filters.supplier&&sources(p).length>1?'商品总库存':'库存数量'}</dt><dd>${E(missing||p.quantity)} ${E(p.trackSerial?'台':p.unit||'件')}</dd></div>`;
    const warning=p.serialDifference<0?'<p class="inventory-warning">串号数量多于账面数量，请盘库核实。</p>':'';
    const extra=missing&&state.user.capabilities.stocktake?`<button type="button" data-inv-bind="${E(p.stockKey)}">补录串号</button>`:'';
    return `<article class="inventory-unit" data-stock-key="${E(p.stockKey)}"${s?` data-serial="${E(s.no)}"`:''}><h2>${E(p.name)}</h2><div class="inventory-chips">${metadata}</div>${serial}<dl class="inventory-facts">${origin}${quantity}<div><dt>零售价</dt><dd class="inventory-price">${M(p.salePrice)}</dd></div></dl>${warning}<details class="inventory-more"><summary>更多商品资料</summary><p>商品编号：${E(p.externalCode||p.skuId)}</p><p>分类：${E([p.type,p.subType,p.thirdType].filter(Boolean).join(' / '))}</p>${s?`<p>原入库单：${E(documentRef(s,"purchaseId")||'待补')}</p>`:''}${filters.supplier&&!p.trackSerial&&sources(p).length>1?'<p>此商品含多家供货来源，这里显示该商品总库存。</p>':''}</details><div class="inventory-unit-actions">${extra}${actions(p,s)}${s?`<a href="/search?scope=serials&amp;q=${encodeURIComponent(s.no)}">追踪这台手机</a>`:''}</div></article>`;
  }
  function desktopTable(rows){
    const hasCost=state.user.capabilities.cost;
    const body=rows.map(({p,s,missing,quantity})=>{
      const supplier=s?[s.supplier||'待补']:[...new Set(sources(p).map(x=>x.supplier||'待补'))];
      const dates=s?[day(s.purchaseDate)]:[...new Set(sources(p).map(x=>day(x.purchaseDate)))];
      const cost=s?s.costPrice:p.costPrice;
      const serial=s?.no||(missing?'串号待补':'—'),status=s?s.status:missing?'待补串号':quantity>0?'在库':'零库存';
      const operations=actions(p,s)+(missing&&state.user.capabilities.stocktake?'<button type="button" data-inv-bind="'+E(p.stockKey)+'">补录串号</button>':'')+(s?'<a href="/search?scope=serials&amp;q='+encodeURIComponent(s.no)+'">串号追踪</a>':'');
      return '<tr><td class="inventory-desktop-product"><strong>'+E(p.name)+'</strong><small>'+E(p.externalCode||p.skuId)+'</small></td><td><code>'+E(serial)+'</code></td><td>'+E(p.warehouseName||'待补')+'</td><td>'+supplier.map(E).join('<br>')+'</td><td>'+dates.map(E).join('<br>')+'</td><td>'+E(quantity)+(filters.supplier&&!s&&sources(p).length>1?'（商品总数）':'')+'</td>'+(hasCost?'<td>'+(cost==null?'待补':M(cost))+'</td>':'')+'<td>'+M(p.salePrice)+'</td><td>'+E(status)+'</td><td><div class="inventory-desktop-actions">'+operations+'</div></td></tr>';
    }).join('');
    return '<div class="inventory-desktop-results"><table class="inventory-desktop-table"><thead><tr>'+['商品','串号','仓库','供货商','进货日期','数量',...(hasCost?['进价']:[]),'零售价','状态','操作'].map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  }
  function draw(){
    const all=entries(),totalPages=Math.max(1,Math.ceil(all.length/pageSize));page=Math.min(page,totalPages);
    $('inventory-result-summary').textContent=`找到 ${all.length} 条记录，当前在库 ${all.reduce((n,r)=>n+r.quantity,0)} 件。`;
    $('inventory-list').innerHTML=all.length?desktopTable(all.slice((page-1)*pageSize,page*pageSize))+all.slice((page-1)*pageSize,page*pageSize).map(card).join(''):'<div class="inventory-empty">没有符合条件的库存。可以清空筛选后再查。</div>';
    $('inventory-pagination').innerHTML=totalPages>1?`<button data-inv-page="-1"${page===1?' disabled':''}>上一页</button><span>${page} / ${totalPages}</span><button data-inv-page="1"${page===totalPages?' disabled':''}>下一页</button>`:'';
  }
  async function render(){
    close();
    const stock=state.inventory.filter(p=>p.stockManaged!==false),supplierOptions=new Map();
    for(const p of stock)for(const s of [...sources(p),...(p.serials||[])])supplierOptions.set(supplierKey(s),s.supplier||'供货来源待补');
    const warehouseButtons=state.warehouses.map(w=>`<button type="button" class="inventory-warehouse${filters.warehouse===w.id?' active':''}" data-inv-warehouse="${E(w.id)}"><span>${E(w.name)}</span><strong>${E(stock.filter(p=>p.warehouseId===w.id).reduce((n,p)=>n+Number(p.quantity||0),0))} 件</strong></button>`).join('');
    $('main').innerHTML=heading('库存查询','先选商品类别，再选品牌或配件类别；型号、串号用搜索框查找。',button('刷新','refresh'))+
      `<div class="inventory-warehouse-grid">${warehouseButtons}</div><section class="inventory-filter-panel"><label class="inventory-search-label">输入商品或串号<input id="inventory-query" type="search" value="${E(filters.q)}" placeholder="名称、编号或串号后4位"></label><div class="inventory-filter-grid"><label>仓库<select id="inventory-warehouse">${option('','全部仓库')}${state.warehouses.map(w=>option(w.id,w.name,filters.warehouse===w.id)).join('')}</select></label><label>按供货商<select id="inventory-supplier">${option('','全部供货商')}${[...supplierOptions].map(([id,name])=>option(id,name,filters.supplier===id)).join('')}</select></label></div><details class="inventory-extra-filters"><summary>更多筛选</summary><div class="inventory-filter-grid"><label>商品类别<select id="inventory-category"></select></label><label>品牌或配件类别<select id="inventory-subcategory"></select></label><label>库存状态<select id="inventory-status">${option('stock','只看在库',filters.status==='stock')}${option('all','含已售串号与零库存',filters.status==='all')}</select></label></div></details><div class="inventory-filter-actions"><button type="button" id="inventory-clear">清空筛选</button>${state.user.capabilities.manageProducts?'<button type="button" data-tab="products">商品调价记录</button>':''}</div></section>${classificationOverview()}<p id="inventory-result-summary" class="inventory-result-summary" role="status"></p><section id="inventory-list" class="inventory-unit-grid"></section><div id="inventory-pagination" class="inventory-pagination"></div>`;
    updateCategoryFilters();
    for(const key of ['warehouse','supplier','category','subcategory','status'])$('inventory-'+key).addEventListener('change',e=>{filters[key]=e.target.value;if(key==='category')filters.subcategory='';if(key==='warehouse'||key==='category')updateCategoryFilters();page=1;draw();document.querySelectorAll('[data-inv-warehouse]').forEach(b=>b.classList.toggle('active',b.dataset.invWarehouse===filters.warehouse));});
    $('inventory-query').addEventListener('input',e=>{filters.q=e.target.value;page=1;draw();});
    $('inventory-clear').addEventListener('click',()=>{Object.assign(filters,{warehouse:'',supplier:'',category:'',subcategory:'',q:'',status:'stock'});page=1;render();});
    draw();

  }
  function count(p,bind=false){
    if(!bind){location.assign("/stocktake");return;}
    close();let saving=false;const expected=(p.serials||[]).filter(available).map(s=>s.no),selected=new Set();
    const root=document.createElement('dialog');root.id='inventory-count-dialog';root.className='inventory-count-dialog';
    root.innerHTML=`<h2>${bind?'补录串号':'逐台串号盘库'}</h2><p>${E(p.name)} · ${E(p.warehouseName)}</p><p class="inventory-fixed">账面 ${E(p.quantity)} 台，已有 ${expected.length} 个在库串号。</p>${bind?'<p class="inventory-warning">只补录实物上的完整串号，按原库存剩余成本分摊。原供货资料缺失的显示待补。</p>':''}<form id="inventory-count-form" novalidate><label>扫描或输入串号<input id="inventory-count-input" autocomplete="off" placeholder="完整串号，查已有手机可用后4位"></label><div class="inventory-count-actions"><button type="button" id="inventory-count-add">加入实点</button><button type="button" id="inventory-count-camera">扫码</button><button type="button" id="inventory-count-photo">拍照识码</button></div><input id="inventory-count-file" type="file" accept="image/*" capture="environment" hidden><video id="inventory-count-video" playsinline muted hidden></video><p id="inventory-count-hint" role="status"></p><div id="inventory-count-choices"></div><p id="inventory-count-total" class="inventory-fixed">已实点 0 台</p><div id="inventory-count-selected"></div>${!bind?`<details><summary>账面串号，逐台点清</summary>${expected.map(no=>`<button type="button" class="inventory-count-known" data-count-known="${E(no)}">${E(no)} · 点清这台</button>`).join('')||'<p>尚未绑定串号</p>'}</details>`:''}<label id="inventory-count-reason-label">${bind?'补录依据（必填）':'盘点说明（有差异必填）'}<textarea id="inventory-count-reason" maxlength="1000"></textarea></label><p id="inventory-count-error" class="inventory-warning" role="alert" hidden></p><div class="inventory-count-submit"><button type="submit">${bind?'确认绑定串号':'提交盘库结果'}</button><button type="button" id="inventory-count-cancel">取消</button></div></form>`;
    document.body.append(root);root.showModal();
    root.addEventListener('close',stop);root.addEventListener('cancel',e=>{if(saving)e.preventDefault();else close();});$('inventory-count-cancel').onclick=()=>{if(!saving)close();};
    const hint=(text,error=false)=>{const node=$('inventory-count-hint');if(!root.isConnected||!node)return;node.textContent=text;node.className=error?'inventory-warning':'inventory-count-good';};
    const drawSelected=()=>{$('inventory-count-total').textContent=`已实点 ${selected.size} 台`;$('inventory-count-selected').innerHTML=[...selected].map(no=>`<div class="inventory-count-selected"><code>${E(no)}</code><button type="button" data-count-remove="${E(no)}">移除</button></div>`).join('');};
    const add=no=>{if(!root.isConnected)return;if(selected.has(no)){hint('这个串号已点过，请不要重复添加。',true);return;}selected.add(no);drawSelected();hint(bind||expected.includes(no)?'已加入实点。':'该串号不在本商品账面清单，提交时须说明差异。',!bind&&!expected.includes(no));$('inventory-count-input').value='';$('inventory-count-choices').innerHTML='';};
    const enter=value=>{const raw=String(value||'').trim().replace(/^(?:IMEI|SN|串号)[：:\s]+/i,'');if(!raw){hint('请先扫码或输入串号。',true);return;}
      if(/^\d{4}$/.test(raw)&&!bind){const matches=expected.filter(no=>no.endsWith(raw));if(matches.length===1){add(matches[0]);return;}if(matches.length>1){hint('有相同后4位，请选完整串号。',true);$('inventory-count-choices').innerHTML=matches.map(no=>`<button type="button" data-count-known="${E(no)}">${E(no)}</button>`).join('');return;}hint('没有找到这个后4位，请输入完整串号核对。',true);return;}
      if(!/^[a-z0-9-]{5,40}$/i.test(raw)){hint('请填写完整串号；后4位只能查找账面已有手机。',true);return;}add(raw);
    };
    $('inventory-count-add').onclick=()=>enter($('inventory-count-input').value);
    $('inventory-count-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();enter(e.target.value);}});
    root.addEventListener('click',e=>{const known=e.target.closest('[data-count-known]'),remove=e.target.closest('[data-count-remove]');if(known)add(known.dataset.countKnown);if(remove){selected.delete(remove.dataset.countRemove);drawSelected();}});
    $('inventory-count-photo').onclick=()=>$('inventory-count-file').click();
    $('inventory-count-file').onchange=async e=>{stop();const file=e.target.files[0];if(!file)return;let image;try{image=await createImageBitmap(file);const no=await window.SaleCapture.decode(image);if(no)enter(no);else hint('照片没有识别到条码，请输入串号。',true);}catch{hint('照片识别失败，请输入串号。',true);}finally{image?.close();e.target.value='';}};
    $('inventory-count-camera').onclick=async()=>{if(stream){stop();$('inventory-count-video').hidden=true;hint('已停止扫码。');return;}if(!navigator.mediaDevices?.getUserMedia){hint('浏览器不支持相机，请拍照或输入串号。',true);return;}const run=++cameraRun;try{const captured=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(run!==cameraRun||!root.isConnected){captured.getTracks().forEach(t=>t.stop());return;}stream=captured;const video=$('inventory-count-video');video.srcObject=stream;video.hidden=false;await video.play();hint('对准串号条码，识别后会加入实点。');const frame=async()=>{if(run!==cameraRun||!stream)return;try{if(video.videoWidth){const no=await window.SaleCapture.decode(video);if(run!==cameraRun)return;if(no){stop();video.hidden=true;enter(no);return;}}}catch{}if(run===cameraRun)setTimeout(frame,350);};frame();}catch{stop();hint('相机未打开，请允许相机权限或输入串号。',true);}};
    $('inventory-count-form').onsubmit=async e=>{e.preventDefault();if(saving)return;const serials=[...selected],reason=$('inventory-count-reason').value.trim(),different=serials.length!==Number(p.quantity)||expected.some(no=>!selected.has(no))||serials.some(no=>!expected.includes(no));const error=$('inventory-count-error');if(bind&&(!serials.length||serials.length!==Number(p.quantity)-expected.length)||!reason&&(bind||different)){error.hidden=false;error.textContent=bind?'请补齐缺少的完整串号并填写补录依据。':'有盘点差异，请填写差异说明。';$('inventory-count-reason').focus();return;}error.hidden=true;const submit=e.target.querySelector('[type=submit]');submit.disabled=true;saving=true;$('inventory-count-cancel').disabled=true;stop();try{const result=await post(bind?'/api/inventory/bind-serials':'/api/serial-stocktakes',{skuId:p.skuId,warehouseId:p.warehouseId,expectedQuantity:p.quantity,expectedSerials:expected,serials,reason});close();let refreshMessage='';try{await loadBasics();await render();}catch{refreshMessage='列表刷新失败，请点刷新核对。';}const done=document.createElement('dialog');done.className='inventory-count-dialog inventory-count-success';done.innerHTML=`<h2>✓ ${bind?'串号绑定成功':'盘库提交成功'}</h2><p>${E(result.message||'已保存')}</p>${refreshMessage?`<p>${E(refreshMessage)}</p>`:''}<button type="button">知道了</button>`;document.body.append(done);done.showModal();done.querySelector('button').onclick=()=>done.remove();window.speakSubmitSuccess?.();}catch(err){saving=false;if(!root.isConnected){toast(err.message,true);return;}error.hidden=false;error.textContent=err.message;error.scrollIntoView({block:'center'});submit.disabled=false;$('inventory-count-cancel').disabled=false;}};
  }
  document.addEventListener('click',e=>{
    const warehouse=e.target.closest('[data-inv-warehouse]');if(warehouse){filters.warehouse=filters.warehouse===warehouse.dataset.invWarehouse?'':warehouse.dataset.invWarehouse;page=1;$('inventory-warehouse').value=filters.warehouse;updateCategoryFilters();draw();document.querySelectorAll('[data-inv-warehouse]').forEach(b=>b.classList.toggle('active',b.dataset.invWarehouse===filters.warehouse));}
    const group=e.target.closest('[data-inv-category]');if(group){filters.warehouse=group.dataset.invCategoryWarehouse;filters.category=group.dataset.invCategory;filters.subcategory='';filters.q='';page=1;$('inventory-warehouse').value=filters.warehouse;$('inventory-query').value='';updateCategoryFilters();draw();$('inventory-classification').open=false;$('inventory-result-summary').scrollIntoView({block:'start'});document.querySelectorAll('[data-inv-warehouse]').forEach(b=>b.classList.toggle('active',b.dataset.invWarehouse===filters.warehouse));}
    const pager=e.target.closest('[data-inv-page]');if(pager&&!pager.disabled){page+=Number(pager.dataset.invPage);draw();$('inventory-result-summary').scrollIntoView({block:'start'});}
    const bind=e.target.closest('[data-inv-bind]');if(bind){const p=state.inventory.find(p=>p.stockKey===bind.dataset.invBind);if(p)count(p,true);}

  });
  document.addEventListener('click',e=>{if(e.target.closest('[data-tab]')?.dataset.tab!=='inventory'&&e.target.closest('[data-tab]'))close();});
  window.addEventListener('pagehide',stop);window.InventoryOffice={render,count};
})();
