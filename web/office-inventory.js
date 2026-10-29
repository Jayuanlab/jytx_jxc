/* Summaries read existing stock balances; product archives and sold serials do not add stock. */
(() => {
  function summarize(rows) {
    const seen=new Set(),kinds=new Set(),units=new Map();let valueCents=0,unknownCosts=0,invalidRows=0;
    for(const row of rows){
      if(row.stockManaged===false)continue;
      const key=JSON.stringify([row.warehouseId||'wh-sale',row.skuId]);
      if(seen.has(key))continue;seen.add(key);
      const quantity=row.quantity;
      if(typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<0){invalidRows++;continue;}
      if(quantity>0){kinds.add(row.skuId);const unit=String(row.unit|| (row.trackSerial?'台':'件'));units.set(unit,(units.get(unit)||0)+quantity);}
      const value=row.stockValue;
      if(quantity>0&&(row.costPriceKnown===false||row.costNeedsConfirmation===true)||typeof value!=='number'||!Number.isFinite(value)||value<0){if(quantity>0)unknownCosts++;else if(value!=null&&value!==0)invalidRows++;continue;}
      const cents=Math.round(value*100);
      if(!Number.isSafeInteger(cents)||!Number.isSafeInteger(valueCents+cents)){invalidRows++;continue;}
      valueCents+=cents;
    }
    return {kinds:kinds.size,units:[...units].map(([unit,quantity])=>({unit,quantity})),valueCents,unknownCosts,invalidRows};
  }
  const quantityText=summary=>summary.units.length?summary.units.map(row=>row.quantity.toLocaleString('zh-CN',{maximumFractionDigits:6})+' '+row.unit).join('、'):'0';
  window.InventoryStockSummary={summarize,quantityText};
})();
/* Additive category navigation: no API calls, write actions or permission changes. */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const key = parts => JSON.stringify(parts);
  const same = (a,b) => key(a)===key(b);
  function build(rows, pathOf, idOf = row => row.skuId, paths = [], warehouseId = '') {
    const root={name:'全部分类',path:[],children:new Map(),ids:new Set()};
    for(const row of rows){const parts=pathOf(row).slice(0,3).map(value=>String(value||'待归类').trim()||'待归类');let node=root;node.ids.add(idOf(row));
      for(const name of parts){if(!node.children.has(name))node.children.set(name,{name,path:[...node.path,name],children:new Map(),ids:new Set()});node=node.children.get(name);node.ids.add(idOf(row));}}
    for(const parts of paths){let node=root;for(const name of parts.slice(0,3)){if(!node.children.has(name))node.children.set(name,{name,path:[...node.path,name],children:new Map(),ids:new Set()});node=node.children.get(name);}}
    const quantities=new Map(),stockTotals=new Map();for(const stock of typeof state!=='undefined'?(state.inventory||[]):[]){if(warehouseId&&stock.warehouseId!==warehouseId)continue;stockTotals.set(stock.skuId,(stockTotals.get(stock.skuId)||0)+Number(stock.quantity||0));}for(const row of rows){const id=idOf(row);quantities.set(id,Number.isFinite(Number(row.quantity))?Number(row.quantity):stockTotals.get(id)||0);}
    const visit=node=>{node.stock=[...node.ids].reduce((n,id)=>n+(quantities.get(id)||0),0);node.newest=Math.max(0,...[...node.ids].map(id=>window.StoreDisplayOrder?.recent(id)||0),...(window.StoreDisplayOrder?.data.catalog?.paths||[]).filter(p=>(!warehouseId||p.warehouseId===warehouseId)&&node.path.every((v,i)=>p.path[i]===v)).map(p=>Date.parse(p.createdAt)||0));for(const child of node.children.values())visit(child);};visit(root);
    return root;
  }
  function mount({host,rows,pathOf,selected=[],onSelect,title='分类查询',empty='这类暂无商品',paths=[],onAddProduct,onAddCategory,warehouse=()=>''}) {
    const opened=new Set(),rootId=host.id||'category-nav';let root,selection=selected.slice(0,3),mobilePath=[],dialog,sortMode='custom',orderEdit=false;
    host.classList.add('store-category-nav');
    const find=parts=>{let node=root;for(const name of parts){node=node?.children.get(name);if(!node)return null;}return node;};
    const sort=nodes=>window.StoreDisplayOrder?window.StoreDisplayOrder.sort([...nodes.values()],{warehouseId:warehouse(),parentPath:[...nodes.values()][0]?.path.slice(0,-1)||[],mode:sortMode}):[...nodes.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
    const label=node=>'<span>'+esc(node.name)+'</span><small>'+node.ids.size+'</small>';
    function choose(parts){selection=parts.slice(0,3);for(let i=1;i<selection.length;i++)opened.add(key(selection.slice(0,i)));onSelect(selection.slice());render();}
    const controls=node=>'<span class="scn-node-actions">'+((node.path.length<3&&onAddCategory||node.path.length===3&&onAddProduct)?'<button type="button" data-add-node="'+encodeURIComponent(key(node.path))+'" aria-label="在'+esc(node.path.join(' / '))+'下新增'+(node.path.length<3?'分类':'商品')+'" title="'+(node.path.length<3?'新增下级分类':'新增商品')+'"><span aria-hidden="true">＋</span></button>':'')+'<button type="button" data-delete-node="'+encodeURIComponent(key(node.path))+'" aria-label="删除分类'+esc(node.path.join(' / '))+'" title="删除空分类"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg></button>'+(orderEdit&&window.StoreDisplayOrder?.data.catalog?.canAdjust?'<button type="button" data-move-node="'+encodeURIComponent(key(node.path))+'" data-dir="-1" aria-label="上移'+esc(node.name)+'">↑</button><button type="button" data-move-node="'+encodeURIComponent(key(node.path))+'" data-dir="1" aria-label="下移'+esc(node.name)+'">↓</button>':'')+'</span>';
    const tools=()=>'<div class="scn-sort"><select aria-label="分类排序" data-tree-sort><option value="custom"'+(sortMode==='custom'?' selected':'')+'>我的顺序 · 新增在前</option><option value="stock"'+(sortMode==='stock'?' selected':'')+'>现货数量优先</option><option value="name"'+(sortMode==='name'?' selected':'')+'>按名称</option></select><button type="button" data-order-edit>'+(orderEdit?'完成调序':'调整顺序')+'</button></div><small data-tree-feedback role="status"></small>';
    function bindTools(target){target.querySelectorAll('[data-delete-node]').forEach(b=>b.onclick=async()=>{const path=JSON.parse(decodeURIComponent(b.dataset.deleteNode));if(dialog)closeMobile();try{await window.DirectoryEdit.deleteCategory(warehouse(),path,()=>{selection=path.slice(0,-1);onSelect(selection.slice());window.StoreDisplayOrder.onDirectoryUpdated?.();},()=>choose(path));}catch(e){window.MasterDataUI.showError(e);}});target.querySelectorAll('[data-tree-sort]').forEach(b=>b.onchange=()=>{sortMode=b.value;render();if(dialog)showMobile();});target.querySelectorAll('[data-order-edit]').forEach(b=>b.onclick=()=>{orderEdit=!orderEdit;if(orderEdit)sortMode='custom';render();if(dialog)showMobile();});target.querySelectorAll('[data-add-node]').forEach(b=>b.onclick=()=>{const path=JSON.parse(decodeURIComponent(b.dataset.addNode));if(dialog)closeMobile();if(path.length<3)onAddCategory?.(path);else onAddProduct?.(path);});target.querySelectorAll('[data-move-node]').forEach(b=>b.onclick=async()=>{const path=JSON.parse(decodeURIComponent(b.dataset.moveNode)),parent=path.slice(0,-1),siblings=sort(find(parent).children),i=siblings.findIndex(n=>same(n.path,path)),j=i+Number(b.dataset.dir);if(j<0||j>=siblings.length){window.StoreDisplayOrder.message(j<0?'已经在同级最上面':'已经在同级最下面');return;}const names=siblings.map(n=>n.name);[names[i],names[j]]=[names[j],names[i]];b.disabled=true;try{await window.StoreDisplayOrder.saveTree(warehouse(),parent,names);render();if(dialog)showMobile();for(const f of host.querySelectorAll('[data-tree-feedback]'))f.textContent='✓ 顺序已保存';}catch(e){window.MasterDataUI?.showError(e);}finally{b.disabled=false;}});}
    function branch(node){const path=encodeURIComponent(key(node.path)),expanded=opened.has(key(node.path));
      return '<li><div class="scn-node'+(same(node.path,selection)?' selected':'')+'">'+(node.children.size?'<button type="button" class="scn-toggle" data-toggle="'+path+'" aria-label="'+(expanded?'收起':'展开')+esc(node.name)+'" aria-expanded="'+expanded+'">'+(expanded?'▾':'▸')+'</button>':'<span class="scn-leaf" aria-hidden="true">·</span>')+'<button type="button" class="scn-pick" data-pick="'+path+'" aria-pressed="'+same(node.path,selection)+'">'+label(node)+'</button>'+controls(node)+'</div>'+(node.children.size&&expanded?'<ul>'+sort(node.children).map(branch).join('')+'</ul>':'')+'</li>';}
    function render(){host.dataset.currentPath=JSON.stringify(selection);host.dataset.warehouse=warehouse();host.innerHTML=tools()+(onAddCategory||onAddProduct?'<div class="scn-tools">'+(onAddCategory?'<button type="button" data-add-category>＋ 新增分类</button>':'')+(onAddProduct?'<button type="button" data-add-product>＋ 新增商品</button>':'')+'</div>':'')+'<button type="button" class="scn-mobile-open" aria-haspopup="dialog">☰ 分级分类 <span>'+esc(selection.join(' / ')||'全部分类')+'</span></button><section class="scn-desktop" aria-label="'+esc(title)+'"><header><strong>'+esc(title)+'</strong><button type="button" data-collapse>收起</button></header><p class="scn-help">点箭头展开，点名称查询</p><div class="scn-all'+(!selection.length?' selected':'')+'"><button type="button" data-pick="%5B%5D">'+label(root)+'</button></div><ul class="scn-tree">'+(root.children.size?sort(root.children).map(branch).join(''):'<li class="scn-empty">暂无分类</li>')+'</ul></section>';
      bindTools(host);
      if(onAddCategory)host.querySelector('[data-add-category]').onclick=()=>onAddCategory(selection.slice());
      if(onAddProduct)host.querySelector('[data-add-product]').onclick=()=>onAddProduct(selection.slice());
      host.querySelector('.scn-mobile-open').addEventListener('click',()=>{mobilePath=selection.slice(0,-1);showMobile();});
      host.querySelector('[data-collapse]').addEventListener('click',()=>{opened.clear();render();});
      host.querySelectorAll('[data-toggle]').forEach(button=>button.addEventListener('click',()=>{const id=decodeURIComponent(button.dataset.toggle);if(opened.has(id))opened.delete(id);else opened.add(id);render();}));
      host.querySelectorAll('[data-pick]').forEach(button=>button.addEventListener('click',()=>choose(JSON.parse(decodeURIComponent(button.dataset.pick)))));
    }
    function closeMobile(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
    function showMobile(){if(!dialog){dialog=document.createElement('dialog');dialog.className='scn-dialog';dialog.id=rootId+'-dialog';document.body.append(dialog);dialog.addEventListener('close',()=>{dialog?.remove();dialog=null;});dialog.showModal();}const node=find(mobilePath)||root;
      dialog.innerHTML='<header><h2>选择分类</h2><button type="button" data-close aria-label="关闭分类">关闭</button></header><nav class="scn-crumb" aria-label="分类层级"><button type="button" data-level="0">全部</button>'+mobilePath.map((name,i)=>'<span>›</span><button type="button" data-level="'+(i+1)+'">'+esc(name)+'</button>').join('')+'</nav>'+(mobilePath.length?'<button type="button" class="scn-back" data-back>‹ 返回上一级</button>':'')+tools()+'<div class="scn-mobile-options">'+(node.children.size?sort(node.children).map(child=>'<div class="scn-mobile-row"><button type="button" data-next="'+encodeURIComponent(key(child.path))+'"><span>'+esc(child.name)+'</span><small>'+child.ids.size+'款</small><b>›</b></button>'+controls(child)+'</div>').join(''):'<p>'+esc(empty)+'</p>')+'</div><footer><button type="button" class="scn-confirm" data-use>查看'+esc(mobilePath.length?node.name:'全部商品')+'（'+node.ids.size+'款）</button></footer>';
      bindTools(dialog);
      dialog.querySelector('[data-close]').onclick=closeMobile;
      dialog.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>{mobilePath=mobilePath.slice(0,Number(b.dataset.level));showMobile();});
      if(dialog.querySelector('[data-back]'))dialog.querySelector('[data-back]').onclick=()=>{mobilePath.pop();showMobile();};
      dialog.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>{const parts=JSON.parse(decodeURIComponent(b.dataset.next)),next=find(parts);if(next?.children.size){mobilePath=parts;showMobile();}else{choose(parts);closeMobile();}});
      dialog.querySelector('[data-use]').onclick=()=>{choose(mobilePath);closeMobile();};
    }
    function update(nextRows,nextSelected=selection,nextPaths=paths){paths=nextPaths;root=build(nextRows,pathOf,undefined,paths,warehouse());selection=nextSelected.slice(0,3);for(let i=1;i<selection.length;i++)opened.add(key(selection.slice(0,i)));render();}
    update(rows,selection);
    return {update,destroy(){closeMobile();host.replaceChildren();}};
  }
  function wrap(main,selector,id){const first=main.querySelector(selector);if(!first)return null;const layout=document.createElement('div');layout.className='store-category-layout';const host=document.createElement('aside');host.id=id;const panel=document.createElement('div');panel.className='store-category-content';first.before(layout);let item=first;while(item){const next=item.nextSibling;panel.append(item);item=next;}layout.append(host,panel);return host;}
  window.StoreCategoryNavigator={build,mount,wrap};
})();

(() => {
  let renderHost=null;
  const $=id=>renderHost?(id==='main'?renderHost:renderHost.querySelector('#'+CSS.escape(id))||document.getElementById(id)):document.getElementById(id);
  const initialInventoryFilters=new URLSearchParams(location.search);
  const filters={warehouse:initialInventoryFilters.get('warehouse')||'',supplier:initialInventoryFilters.get('supplier')||'',productGroup:initialInventoryFilters.get('productGroup')||'',category:initialInventoryFilters.get('category')||'',subcategory:'',thirdcategory:'',productSkuId:'',brand:'',q:initialInventoryFilters.get('inventoryQ')||'',status:'stock'};
  let page=1, stream=null, cameraRun=0,categoryTree=null,focusedModel=null,focusedPhone=null,queried=Boolean(filters.warehouse||filters.supplier||filters.category||filters.productGroup||filters.q);
  const available=s=>s.inStock===true||['可售','未激活'].includes(s.status);
  const supplierKey=s=>s.supplierId|| (s.supplier?'name:'+s.supplier:'__unknown__');
  const supplierShortNames={
    '重庆终端公司':'重庆终端','重庆小米分公司':'小米渝分','重庆荣耀普柯派公司':'普柯派',
    '重庆天音移动公司':'天音移动','重庆品胜公司':'品胜公司','重庆万州朗丰公司':'万州朗丰',
    '终端公司':'终端公司','重庆公司':'重庆公司','小米公司':'小米公司',
    '重庆一起发公司':'一起发','验证用供货商1018':'验证供货','重庆业曼公司':'业曼公司',
    '重庆惠友公司':'惠友公司','重庆曹盛军':'曹盛军','重庆山鹰通信公司':'山鹰通信',
    '重庆VIVO公司':'VIVO','重庆小米公司':'重庆小米','万州张健':'万州张健',
    '淘宝':'淘宝供货','云阳张坤梅':'云阳坤梅','万州创维公司':'万州创维',
    '重庆移动云阳分公司':'云阳移动'
  };
  const supplierShort=name=>supplierShortNames[name]||name||'待补';
  const supplierLabel=name=>'<span class="inventory-supplier-short" title="'+E(name||'待补')+'" aria-label="'+E(name||'待补')+'">'+E(supplierShort(name))+'</span>';
  function resolveSupplierInput(){
    const input=$('inventory-supplier'),value=input.value.trim(),rows=state.inventoryFilterOptions?.suppliers||[];
    if(!value){filters.supplier='';return true;}
    const match=row=>[row.name,supplierShort(row.name)].some(text=>text.toLocaleLowerCase('zh-CN')===value.toLocaleLowerCase('zh-CN'));
    let found=rows.filter(match);
    if(!found.length)found=rows.filter(row=>[row.name,supplierShort(row.name)].some(text=>text.toLocaleLowerCase('zh-CN').includes(value.toLocaleLowerCase('zh-CN'))));
    if(found.length!==1){$('inventory-result-summary').textContent=found.length?'有多家相近供货商，请选择完整简称或全称。':'没有找到这个供货商，请核对简称或全称。';input.focus();return false;}
    filters.supplier=found[0].id;input.value=supplierShort(found[0].name);return true;
  }
  const sources=p=>p.stockSources?.length?p.stockSources:[{supplier:'',supplierId:'',purchaseDate:''}];
  const hasStock=p=>Number(p.quantity)>0||(p.serials||[]).some(available);
  const matchesSupplier=(p,key)=>!key||(p.trackSerial?(p.serials||[]).some(s=>available(s)&&supplierKey(s)===key)||(key==='__unknown__'&&Number(p.serialDifference)>0):sources(p).some(s=>supplierKey(s)===key));
  const productGroup=p=>p.inventoryProductGroup||String(p.subType||p.type||'其他商品').trim()||'其他商品';
  const productBranch=p=>String(p.thirdType||'其他型号').trim()||'其他型号';
  const day=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}):'待补';
  const sourceButton=(p,s)=>state.user?.roleCode==='owner'&&s?.no?'<button type="button" class="inventory-source-button" data-inv-source="'+E(s.no)+'" data-inv-source-stock="'+E(p.stockKey)+'">'+(!s.supplier||!s.purchaseDate?'补供货商 / 日期':'更正供货商 / 日期')+'</button>':'';
  const actions=p=>state.user.capabilities.manageProducts?button('商品调价','price-request',p.skuId):'';
  function stop(){cameraRun++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;}
  function close(){stop();document.getElementById('inventory-count-dialog')?.remove();for(const id of ['inventory-source-dialog','inventory-opening-dialog']){const source=document.getElementById(id);if(source?.dataset.saving!=='1')source?.remove();}}
  const originalCode=p=>String(p.sourceBarcode||p.barcode||'');
  const barcodeLine=p=>{if(p.trackSerial||p.stockManaged===false)return '';const code=originalCode(p),shared=code&&new Set(state.inventory.filter(x=>originalCode(x)===code).map(x=>x.skuId)).size>1;return '<small class="inventory-original-barcode">'+(/^69[0-9]+$/.test(code)?'原厂69码':'原始条码/编码')+'：<code>'+E(code||'未提供')+'</code>'+(shared?' · 共享码，请核对型号/仓库':'')+'</small>';};
  function lookup(p,q){const text=[p.name,p.shortName,p.externalCode,p.sourceBarcode,p.barcode,p.type,p.subType,p.thirdType,...(p.aliases||[])].join(' ').toLowerCase();return q.split(/\s+/).filter(Boolean).every(term=>{const group=state.searchSynonyms.find(g=>g.terms?.some(w=>w.toLowerCase()===term));return(group?.terms||[term]).some(w=>text.includes(w.toLowerCase()));});}
  const deviceCategories=['智能机','功能机','二手手机','儿童手表','数码产品'];
  const categoryDefaults={'wh-a':deviceCategories,'wh-b':['配件','维修材料'],'wh-c':deviceCategories};
  const queryPath=p=>window.StoreCatalogQuery.path(p);
  const category=p=>p.inventoryCategory||queryPath(p)[0]||'未分类';
  const savedPaths=(warehouse=filters.warehouse)=>window.StoreCatalogQuery.paths(state.productCategoryPaths||[],state.products,warehouse).map(row=>row.path);
  const categoryLabel=value=>value==='手表'?'手表（待细分）':value;
  function goods(warehouse=filters.warehouse){return [...new Map(state.inventory.filter(p=>p.stockManaged!==false&&(!warehouse||p.warehouseId===warehouse)&&(filters.status!=='stock'||Number(p.quantity)>0||(p.serials||[]).some(available))).map(p=>[p.skuId,p])).values()];}
  function categoryNames(warehouse=filters.warehouse){return [...new Set([...(warehouse?categoryDefaults[warehouse]||[]:Object.values(categoryDefaults).flat()),...goods(warehouse).map(category),...savedPaths(warehouse).map(path=>path[0])])];}
  function updateCategoryFilters(){
    const names=categoryNames(),products=goods();
    if(filters.category&&!names.includes(filters.category)){filters.category='';filters.subcategory='';}
    $('inventory-category').innerHTML=option('','全部商品类别')+names.map(name=>option(name,categoryLabel(name)+'（'+products.filter(p=>category(p)===name).length+'款）',filters.category===name)).join('');
    const branches=[...new Set([...products.filter(p=>!filters.category||category(p)===filters.category).map(p=>queryPath(p)[1]),...savedPaths().filter(path=>!filters.category||path[0]===filters.category).map(path=>path[1])].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
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
    return `<details id="inventory-classification" class="inventory-classification"><summary>查看商品分类（按型号统计）</summary><p class="inventory-fixed" data-page-explanation>仓库 → 商品类别 → 品牌或配件类别 → 商品型号 → 单台串号。A仓和C仓共用商品分类方式，商品名称保持一致，按所属仓库区分。下列“款数”统计商品档案。</p><div class="inventory-category-groups">${groups.join('')}</div>${services.length?`<section class="inventory-category-group"><h3>不入仓的收费项目</h3>${[...new Set(services.map(p=>p.type||'服务'))].map(type=>`<article class="inventory-category-row"><strong>${E(type)} · ${services.filter(p=>p.type===type).length}项</strong><p>${services.filter(p=>p.type===type).map(p=>E(p.subType||p.name)).join('、')}</p></article>`).join('')}</section>`:''}${review.length?`<details class="inventory-category-review"><summary>待核对的分类档案（${review.length}款）</summary><p class="inventory-warning">手表还需区分儿童手表等类别；部分品牌名被用作配件类别。请按实际商品核对。</p>${review.map(p=>`<article class="inventory-category-row"><strong>${E(p.name)}</strong><p>现有分类：${E([p.type,p.subType,p.thirdType].filter(Boolean).join(' / '))}</p>${state.user.capabilities.manageProducts?button('修改分类','edit-product',p.skuId):''}</article>`).join('')}</details>`:''}</details>`;
  }
  function entries(){
    const result=[],q=filters.q.trim().toLowerCase();
    for(const p of state.inventory.filter(p=>p.stockManaged!==false)){
      if(filters.category&&category(p)!==filters.category||filters.warehouse&&p.warehouseId!==filters.warehouse||filters.productGroup&&productGroup(p)!==filters.productGroup)continue;
      if(p.trackSerial){
        for(const s of p.serials||[]){
          if(!available(s)||filters.supplier&&supplierKey(s)!==filters.supplier)continue;
          if(q&&!lookup(p,q)&&!(q.length===4?s.no.toLowerCase().endsWith(q):s.no.toLowerCase().includes(q)))continue;
          result.push({p,s,quantity:available(s)?1:0});
        }
        const missing=Number(p.serialDifference??Number(p.quantity)-(p.serials||[]).filter(available).length);
        if(missing>0&&(!filters.supplier||filters.supplier==='__unknown__')&&(!q||lookup(p,q)))result.push({p,missing,quantity:missing});
      }else{
        if(Number(p.quantity)<=0||filters.supplier&&!sources(p).some(s=>supplierKey(s)===filters.supplier)||q&&!lookup(p,q))continue;
        const matched=filters.supplier?p.supplierMatchedQuantity:p.quantity;
        result.push({p,quantity:matched===null?0:Number(matched),quantityUnknown:matched===null});
      }
    }
    return result;
  }
  function card({p,s,missing,quantity,quantityUnknown}){
    if(s){
      const warehouse=String(p.warehouseName||'未分仓'),badge=warehouse.match(/^[ABC]/i)?.[0]||warehouse;
      const cost=s.costPrice==null||!Number.isFinite(Number(s.costPrice))?'待补':M(s.costPrice);
      return `<details class="inventory-phone-row" data-stock-key="${E(p.stockKey)}" data-serial="${E(s.no)}"><summary title="${E(p.name)} · ${E(s.no)} · ${E(warehouse)}"><strong class="inventory-phone-name">${E(p.name)}</strong><span class="inventory-phone-serial" aria-label="串号 ${E(s.no)}">${E(s.no)}</span><span class="inventory-phone-row-toggle" aria-hidden="true"></span></summary><div class="inventory-phone-row-detail"><dl><div><dt>商品</dt><dd>${E(p.name)}</dd></div><div><dt>串号</dt><dd><code>${E(s.no)}</code></dd></div><div><dt>供货商</dt><dd>${supplierLabel(s.supplier)}</dd></div><div><dt>进货日期</dt><dd>${E(day(s.purchaseDate))}</dd></div>${state.user.capabilities.cost?`<div><dt>进价</dt><dd class="inventory-phone-cost">${E(cost)}</dd></div>`:''}<div><dt>零售价</dt><dd>${M(p.salePrice)}</dd></div><div><dt>仓库／状态</dt><dd>${E(warehouse)}／${E(s.status)}</dd></div><div><dt>分类</dt><dd>${E([p.type,p.subType,p.thirdType].filter(Boolean).join(' / '))}</dd></div><div><dt>原入库单</dt><dd>${E(documentRef(s,"purchaseId")||'待补')}</dd></div></dl>${p.serialDifference<0?'<p class="inventory-warning">串号数量多于账面数量，请盘库核实。</p>':''}<div class="inventory-unit-actions">${sourceButton(p,s)}${actions(p)}</div></div></details>`;
    }

    const warehouse=String(p.warehouseName||'未分仓'),badge=warehouse.match(/^[ABC]/i)?.[0]||warehouse;
    const unit=window.StoreCatalogQuery.unit(p),count=quantityUnknown?'来源数量待核':`${E(quantity)} ${E(unit)}`;
    const summary=missing?`待补串号 ${E(missing)} 台`:count;
    const origin=p.trackSerial?'':`<div><dt>供货商</dt><dd>${[...new Set(sources(p).map(source=>source.supplier||'待补'))].map(supplierLabel).join('、')}</dd></div><div><dt>进货日期</dt><dd>${E([...new Set(sources(p).map(source=>day(source.purchaseDate)))].join('、'))}</dd></div>`;
    const warning=(missing?`<p class="inventory-warning">账面有 ${E(missing)} 台还缺串号，请逐台补录。</p>`:'')+(p.serialDifference<0?'<p class="inventory-warning">串号数量多于账面数量，请盘库核实。</p>':'')+(quantityUnknown?'<p class="inventory-warning">此商品含多家供货来源，数量归属待核；这里不会把整仓数量记作该供货商数量。</p>':'');
    const extra=missing&&state.user.capabilities.stocktake?`<button type="button" data-inv-bind="${E(p.stockKey)}">补录串号</button>`:'';
    return `<details class="inventory-phone-row" data-stock-key="${E(p.stockKey)}"><summary title="${E(p.name)} · ${E(summary)} · ${E(warehouse)}"><strong class="inventory-phone-name">${E(p.name)}</strong><span class="inventory-phone-serial">${summary}</span><span class="inventory-phone-row-toggle" aria-hidden="true"></span></summary><div class="inventory-phone-row-detail"><dl><div><dt>商品</dt><dd>${E(p.name)}</dd></div>${origin}<div><dt>${missing?'待补串号数量':filters.supplier?'该供货商库存':'库存数量'}</dt><dd>${count}</dd></div><div><dt>零售价</dt><dd>${M(p.salePrice)}</dd></div><div><dt>仓库</dt><dd>${E(warehouse)}</dd></div><div><dt>分类</dt><dd>${E([p.type,p.subType,p.thirdType].filter(Boolean).join(' / '))}</dd></div></dl>${barcodeLine(p)}${warning}<div class="inventory-unit-actions">${extra}${actions(p)}</div></div></details>`;
  }
  function desktopTable(rows){
    const hasCost=state.user.capabilities.cost;
    const body=rows.map(({p,s,missing,quantity,quantityUnknown})=>{
      const supplier=s?[s.supplier||'待补']:[...new Set(sources(p).map(x=>x.supplier||'待补'))];
      const dates=s?[day(s.purchaseDate)]:[...new Set(sources(p).map(x=>day(x.purchaseDate)))];
      const cost=s?s.costPrice:p.costPrice;
      const serial=s?.no||(missing?'串号待补':'—');
      const operations=sourceButton(p,s)+actions(p)+(missing&&state.user.capabilities.stocktake?'<button type="button" data-inv-bind="'+E(p.stockKey)+'">补录串号</button>':'');
      return '<tr><td class="inventory-desktop-code"><code class="inventory-product-code">'+E(p.externalCode||p.skuId)+'</code></td><td class="inventory-desktop-product"><strong>'+E(p.name)+'</strong></td><td><code>'+E(serial)+'</code></td><td>'+E(p.warehouseName||'待补')+'</td><td>'+supplier.map(supplierLabel).join('<br>')+'</td><td>'+dates.map(E).join('<br>')+'</td><td>'+(quantityUnknown?'来源数量待核':E(quantity))+'</td>'+(hasCost?'<td>'+(cost==null?'待补':M(cost))+'</td>':'')+'<td>'+M(p.salePrice)+'</td><td><div class="inventory-desktop-actions">'+operations+'</div></td></tr>';
    }).join('');
    return '<div class="inventory-desktop-results"><table class="inventory-desktop-table"><thead><tr>'+['编码','商品','串号','仓库','供货商','进货日期','数量',...(hasCost?['进价']:[]),'零售价','操作'].map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div><div class="inventory-mobile-results">'+rows.map(card).join('')+'</div>';
  }
  function treeRows(){return goods().filter(p=>filters.status!=='stock'||Number(p.quantity)>0||(p.serials||[]).some(available));}
  function treeSelection(){return [filters.category,filters.subcategory,filters.thirdcategory].filter(Boolean);}

  function groupedResults(rows){
    const groups=new Map();
    for(const row of rows){const name=productGroup(row.p),branch=productBranch(row.p);if(!groups.has(name))groups.set(name,new Map());const children=groups.get(name);if(!children.has(branch))children.set(branch,[]);children.get(branch).push(row);}
    const kinds=items=>new Set(items.map(item=>item.p.skuId)).size;
    const ordered=[...groups].sort((a,b)=>a[0].localeCompare(b[0],'zh-CN',{numeric:true}));
    return {groups:ordered,html:ordered.map(([name,children],index)=>{
      const groupRows=[...children.values()].flat();
      return `<details class="inventory-group" data-inventory-group="${index}"><summary><strong>${E(name)}</strong><span>${kinds(groupRows)} 款 · ${E(window.StoreCatalogQuery.stockText(groupRows))}</span></summary><div class="inventory-group-body"></div></details>`;
    }).join('')};
  }
  function selectedProductResults(rows){
    const groups=new Map();
    for(const row of rows){const key=row.p.stockKey||row.p.skuId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    const labels=['编码','商品','仓库','供货商','在库数量','单位','零售价','单台明细'];
    const items=[...groups.values()].sort((a,b)=>a[0].p.name.localeCompare(b[0].p.name,'zh-CN',{numeric:true}));
    return `<section class="inventory-model-results" aria-label="所选品牌或类别的在库商品"><div class="inventory-model-head">${labels.map(label=>`<span>${label}</span>`).join('')}</div>${items.map(group=>{
      const p=group[0].p,quantity=group.reduce((total,row)=>total+Number(row.quantity||0),0),quantityUnknown=group.some(row=>row.quantityUnknown);
      const suppliers=[...new Set(group.flatMap(row=>row.s?[row.s.supplier||'待补']:sources(row.p).map(source=>source.supplier||'待补')))];
      return `<details class="inventory-model-row" data-inventory-name="${E(p.name)}"><summary><code class="inventory-model-code">${E(p.externalCode||p.skuId)}</code><strong>${E(p.name)}</strong><span>${E(p.warehouseName||'待补')}</span><span>${suppliers.map(supplierLabel).join('、')}</span><b>${quantityUnknown?'来源待核':E(quantity)}</b><span>${E(window.StoreCatalogQuery.unit(p))}</span><span>${M(p.salePrice)}</span><span class="inventory-model-open"></span></summary><div class="inventory-model-body">${desktopTable(group)}</div></details>`;
    }).join('')}</section><div class="inventory-mobile-results inventory-selected-mobile" aria-label="所选品牌或类别的在库商品列表">${items.flatMap(group=>group).map(card).join('')}</div>`;
  }
  function leaveProductFocus(){
    if(!focusedModel)return;
    const {row,placeholder,panel,scrollY,onFocusToggle}=focusedModel;
    focusedModel=null;
    row.removeEventListener('toggle',onFocusToggle);
    placeholder.replaceWith(row);
    row.open=false;
    panel.remove();
    document.getElementById('main')?.classList.remove('inventory-product-focus');
    window.scrollTo({top:scrollY,behavior:'instant'});
  }
  function leavePhoneFocus(){
    if(!focusedPhone)return;
    const {row,placeholder,panel,scrollY,onFocusToggle}=focusedPhone;
    focusedPhone=null;row.removeEventListener('toggle',onFocusToggle);
    placeholder.replaceWith(row);row.open=false;panel.remove();
    document.getElementById('main')?.classList.remove('inventory-phone-focus');
    window.scrollTo({top:scrollY,behavior:'instant'});
  }
  function enterPhoneFocus(row){
    if(focusedPhone?.row===row)return;
    leavePhoneFocus();
    const main=document.getElementById('main');if(!main||!row.isConnected)return;
    const scrollY=window.scrollY,placeholder=document.createComment('inventory-phone-place'),panel=document.createElement('section');
    row.before(placeholder);panel.id='inventory-phone-focus-panel';panel.className='inventory-phone-focus-panel';
    const name=row.querySelector('.inventory-phone-name')?.textContent||'库存明细';
    panel.innerHTML='<div class="inventory-phone-focus-header"><button type="button" id="inventory-phone-focus-back">← 返回库存</button><h2>'+E(name)+'</h2></div>';
    panel.append(row);main.append(panel);main.classList.add('inventory-phone-focus');
    const onFocusToggle=()=>{if(!row.open)leavePhoneFocus();};row.addEventListener('toggle',onFocusToggle);
    focusedPhone={row,placeholder,panel,scrollY,onFocusToggle};
    panel.querySelector('#inventory-phone-focus-back').addEventListener('click',leavePhoneFocus);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function enterProductFocus(row){
    if(focusedModel?.row===row)return;
    leaveProductFocus();
    leavePhoneFocus();
    const main=document.getElementById('main'),placeholder=document.createComment('inventory-product-place'),panel=document.createElement('section');
    if(!main||!row.isConnected)return;
    const scrollY=window.scrollY;
    row.before(placeholder);
    panel.id='inventory-focus-panel';
    panel.className='inventory-focus-panel';
    panel.innerHTML='<div class="inventory-focus-header"><button type="button" id="inventory-focus-back">← 返回查询</button><h2>'+E(row.dataset.inventoryName||'商品明细')+'</h2></div>';
    panel.append(row);
    main.append(panel);
    main.classList.add('inventory-product-focus');
    const onFocusToggle=()=>{if(!row.open)leaveProductFocus();};
    row.addEventListener('toggle',onFocusToggle);
    focusedModel={row,placeholder,panel,scrollY,onFocusToggle};
    panel.querySelector('#inventory-focus-back').addEventListener('click',leaveProductFocus);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function draw(){
    $('inventory-result-summary').dataset.queried=queried?'1':'0';
    if(!queried){$('inventory-result-summary').textContent='点击“查询库存”查看全部有库存商品，也可先选择条件缩小范围。';$('inventory-list').replaceChildren();$('inventory-pagination').replaceChildren();return;}
    const all=entries();
    const info=(state.inventoryFilterOptions?.categoryInfo||[]).find(row=>row.category===filters.category),serviceOnly=info&&info.serviceProducts>0&&info.stockProducts===0;
    const unknown=all.filter(row=>row.quantityUnknown).length;
    const grouped=all.length&&!filters.productGroup?groupedResults(all):null;
    $('inventory-result-summary').textContent=serviceOnly?'该分类下当前登记的项目均不管理实物库存；原商品档案完整保留。':`本次找到 ${window.StoreCatalogQuery.summary(all).kinds} 款商品；${unknown?'已知库存 '+window.StoreCatalogQuery.stockText(all)+'，另有 '+unknown+' 款供货来源数量待核':'库存 '+window.StoreCatalogQuery.stockText(all)}；${filters.productGroup?'已直接显示所选品牌或类别的全部在库明细。':'全部品牌和类别已列出，点开查看该组明细。'}`;
    $('inventory-list').innerHTML=all.length?(filters.productGroup?selectedProductResults(all):grouped.html):serviceOnly?'<div class="inventory-empty">是否计库存按各商品档案判断；以后在此分类新增实物商品，有库存时会正常显示。</div>':'<div class="inventory-empty">没有符合条件的库存。可以清空筛选后再查。</div>';
    $('inventory-pagination').replaceChildren();
    if(grouped)$('inventory-list').querySelectorAll('[data-inventory-group]').forEach(details=>details.addEventListener('toggle',()=>{
      if(!details.open||details.dataset.loaded==='1')return;
      const children=grouped.groups[Number(details.dataset.inventoryGroup)]?.[1];
      if(!children)return;
      const rows=[...children.values()].flat();
      const content=rows.length<=30?selectedProductResults(rows):[...children].sort((a,b)=>a[0].localeCompare(b[0],'zh-CN',{numeric:true})).map(([branch,items])=>`<details class="inventory-subgroup"><summary><strong>${E(branch)}</strong><span>${new Set(items.map(item=>item.p.skuId)).size} 款 · ${E(window.StoreCatalogQuery.stockText(items))}</span></summary>${selectedProductResults(items)}</details>`).join('');
      details.querySelector('.inventory-group-body').innerHTML=content;
      details.dataset.loaded='1';
    }));
    if(state.inventoryQueryStarted){const started=state.inventoryQueryStarted,read=state.inventoryReadMs,node=$('inventory-result-summary');requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!node.isConnected||state.inventoryQueryStarted!==started)return;const elapsed=performance.now()-started;node.dataset.readMs=Math.round(read);node.dataset.queryMs=Math.round(elapsed);node.append(document.createTextNode(' 本次实测：读取 '+(read/1000).toFixed(2)+' 秒，结果显示 '+(elapsed/1000).toFixed(2)+' 秒。'));state.inventoryQueryStarted=null;}));}
  }
  function syncFilterOptions(updateCategory=true){
    const choices=state.inventoryFilterOptions||{suppliers:[],productGroups:[],categories:[],productGroupsByCategory:[]};
    const groups=filters.category?(choices.productGroupsByCategory||[]).find(row=>row.category===filters.category)?.productGroups||[]:choices.productGroups;
    if(filters.productGroup&&!groups.includes(filters.productGroup))filters.productGroup='';
    if(updateCategory)$('inventory-category').innerHTML=option('','全部一级分类')+(choices.categories||[]).map(name=>option(name,name,filters.category===name)).join('');
    $('inventory-supplier-options').innerHTML=choices.suppliers.map(row=>'<option value="'+E(supplierShort(row.name))+'" label="'+E(row.name)+'"></option>').join('');
    const selectedSupplier=choices.suppliers.find(row=>row.id===filters.supplier);
    $('inventory-supplier').value=selectedSupplier?supplierShort(selectedSupplier.name):'';
    $('inventory-product').innerHTML=option('','全部品牌／二级分类')+(filters.q&&!filters.productGroup?option('__current_keyword__','当前搜索：'+filters.q,true):'')+groups.map(name=>option(name,name,filters.productGroup===name)).join('');
  }
  async function render(){
    const current=officePageCurrent('inventory');
    if(!current())return;
    leaveProductFocus();
    close();
    filters.status='stock';state.inventoryIncludeHistory=false;
    const liveMain=document.getElementById('main'),prepared=liveMain.cloneNode(false);
    renderHost=prepared;
    try{
    const supplierChoice=state.inventoryFilterOptions?.suppliers?.find(row=>row.id===filters.supplier);
    const filterSummary=[state.warehouses.find(row=>row.id===filters.warehouse)?.name,filters.category,filters.productGroup,supplierChoice&&supplierShort(supplierChoice.name)].filter(Boolean).join(' / ')||'全部库存';
    $('main').innerHTML='<div class="inventory-page-heading"><a class="inventory-workbench-link" href="/m">← 返回工作台</a>'+heading('库存查询')+'</div>'+
      `<button type="button" id="inventory-phone-filter-toggle" class="inventory-phone-filter-toggle" aria-controls="inventory-filter-panel" aria-expanded="${queried?'false':'true'}">筛选：${E(filterSummary)} <span aria-hidden="true">⌄</span></button><section id="inventory-filter-panel" class="inventory-filter-panel inventory-simple-filter inventory-level1-filter" aria-label="库存查询条件"><div class="inventory-filter-grid"><label>仓库<select id="inventory-warehouse">${option('','全部仓库')}${state.warehouses.filter(w=>w.active!==false).map(w=>option(w.id,w.name,filters.warehouse===w.id)).join('')}</select></label><label>供货商<input id="inventory-supplier" type="search" list="inventory-supplier-options" autocomplete="off" placeholder="输入简称或全称"><datalist id="inventory-supplier-options"></datalist></label><label>一级分类<select id="inventory-category"></select></label><label>品牌／二级分类<select id="inventory-product"></select></label></div><div class="inventory-filter-actions"><button type="button" id="inventory-search" class="primary">查询库存</button><button type="button" id="inventory-clear">清空筛选</button></div></section><p id="inventory-result-summary" class="inventory-result-summary" role="status"></p><section id="inventory-list" class="inventory-unit-grid"></section><div id="inventory-pagination" class="inventory-pagination"></div>${state.user?.roleCode==='owner'?'<details class="inventory-opening-tool inventory-maintenance"><summary>库存维护</summary><p>期初漏录专用；日常进货请用“订货与入库”。</p><button type="button" data-inv-opening>＋ 补录期初手机</button><button type="button" data-inv-opening-quantity>＋ 补录期初商品</button></details>':''}`;
    syncFilterOptions();
    $('inventory-warehouse').addEventListener('change',e=>{filters.warehouse=e.target.value;queried=false;page=1;draw();});
    $('inventory-supplier').addEventListener('input',()=>{filters.supplier='';queried=false;page=1;draw();});
    $('inventory-supplier').addEventListener('change',()=>{if(resolveSupplierInput()){queried=false;page=1;draw();}});
    $('inventory-supplier').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('inventory-search').click();}});
    $('inventory-phone-filter-toggle').addEventListener('click',e=>{const collapsed=liveMain.classList.toggle('inventory-mobile-filters-collapsed');e.currentTarget.setAttribute('aria-expanded',collapsed?'false':'true');});
    $('inventory-category').addEventListener('change',e=>{filters.category=e.target.value;filters.q='';queried=false;page=1;syncFilterOptions(false);draw();});
    $('inventory-product').addEventListener('change',e=>{filters.productGroup=e.target.value==='__current_keyword__'?'':e.target.value;filters.q='';queried=false;page=1;draw();});
    $('inventory-search').addEventListener('click',async e=>{if(!resolveSupplierInput())return;const button=e.currentTarget;button.disabled=true;const before=queried;queried=true;page=1;$('inventory-result-summary').textContent='正在读取库存…';try{await loadBasics();if(current())await render();}catch(error){queried=before;if(current()){$('inventory-result-summary').textContent=error.message||'查询失败，请重试。';button.disabled=false;}}});
    $('inventory-clear').addEventListener('click',()=>{Object.assign(filters,{warehouse:'',supplier:'',productGroup:'',category:'',q:''});queried=false;page=1;render();});
    $('inventory-list').addEventListener('toggle',event=>{const row=event.target;if(row.classList?.contains('inventory-phone-row')){if(row.open)enterPhoneFocus(row);else if(focusedPhone?.row===row)leavePhoneFocus();return;}if(!row.classList?.contains('inventory-model-row'))return;if(row.open)enterProductFocus(row);else if(focusedModel?.row===row)leaveProductFocus();},true);
    draw();
    if(current()){liveMain.replaceChildren(...prepared.childNodes);liveMain.classList.toggle('inventory-mobile-filters-collapsed',queried);liveMain.dataset.inventoryCommits=String(Number(liveMain.dataset.inventoryCommits||0)+1);}
    }finally{renderHost=null;}
  }
  async function appendOpening(){
    if(state.user?.roleCode!=='owner')return;
    state.products=await api('/api/products?view=picker');
    if(document.getElementById('inventory-opening-dialog')?.dataset.saving==='1')return;
    close();const root=document.createElement('dialog');root.id='inventory-opening-dialog';root.className='inventory-count-dialog inventory-source-dialog inventory-opening-dialog';root.setAttribute('aria-labelledby','inventory-opening-title');
    root.innerHTML='<button type="button" data-opening-close class="inventory-source-close">关闭</button><h2 id="inventory-opening-title">补录期初手机</h2><p>一款手机可录多个完整串号；不同型号请分次填写。已有库存和单据保留。</p><form id="inventory-opening-form"><label>入库仓库<select name="warehouseId" required>'+state.warehouses.filter(w=>w.active!==false).map(w=>option(w.id,w.name,w.id===(filters.warehouse||'wh-a'))).join('')+'</select></label><label>商品档案<select name="skuId"><option value="">新建型号档案</option></select><small>已有型号请明确选择对应商品，按商品编号关联。</small></label><label>商品名称 / 型号<input name="name" required maxlength="120" placeholder="填写完整型号与规格"></label><label>二级分类 / 品牌<input name="subType" required maxlength="60" placeholder="例如：荣耀；功能机填写万州张健或重庆业曼"></label><label>三级分类（选填）<input name="thirdType" maxlength="60" placeholder="功能机填写品牌，例如：亿通、巨爱"></label><label>商品类别<select name="type">'+['智能机','功能机','二手手机'].map(type=>option(type,type,type==='智能机')).join('')+'</select></label><label>供货商<select name="supplierId" required disabled><option value="">正在读取供货商…</option></select></label><label>完整串号（每行一台）<textarea name="serialNos" required rows="4" placeholder="每行填写一个15位完整串号；功能机可填原始大写字母数字串号"></textarea></label><label>每台期初成本<input name="costPrice" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="按真实原始记录填写"></label><label>零售价（选填）<input name="salePrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="未知留空，后续可在商品档案设置"></label><label>实际进货日期（未知留空）<input name="actualPurchaseDate" type="date"></label><label>来源依据<input name="sourceRef" required maxlength="200" placeholder="例如：原始库存表名称、实物核对记录"></label><label>漏录原因与核对依据<textarea name="reason" required minlength="4" maxlength="500" placeholder="填写期初漏录原因，至少4个字"></textarea></label><details class="inventory-opening-evidence"><summary>原表证据（可选）</summary><p>有真实文件信息时填写；未知项目留空。</p><label>来源文件名<input name="sourceFile" maxlength="200"></label><label>文件 SHA-256<input name="sourceSha256" maxlength="64" spellcheck="false" autocomplete="off"></label><label>工作表名称<input name="sheet" maxlength="100"></label><label>原表行号（按上方串号顺序，每行一个）<textarea name="sourceRows" rows="3" placeholder="仅填写已核实的实际行号"></textarea></label></details><p id="inventory-opening-status" role="status">正在读取供货商…</p><p id="inventory-opening-error" class="inventory-warning" role="alert" hidden></p><section id="inventory-opening-preview" class="inventory-source-preview" aria-live="polite" hidden></section><div class="inventory-count-submit"><button type="submit" id="inventory-opening-prepare" disabled>预览追加内容</button><button type="button" id="inventory-opening-confirm" hidden>确认追加期初手机</button><button type="button" data-opening-close>取消</button></div></form>';
    document.body.append(root);root.showModal();const form=root.querySelector('form'),field=name=>form.elements[name],get=id=>root.querySelector('#'+id),prepare=get('inventory-opening-prepare'),confirm=get('inventory-opening-confirm'),preview=get('inventory-opening-preview'),error=get('inventory-opening-error'),status=get('inventory-opening-status');
    field('warehouseId').innerHTML=state.warehouses.filter(w=>w.id==='wh-a'&&w.active!==false).map(w=>option(w.id,w.name,true)).join('');
    let revision=0,prepared=null,preparedBody='',saving=false,uncertain=false,attempt={},supplierRows=[];
    const clearPreview=()=>{prepared=null;preparedBody='';confirm.hidden=true;preview.hidden=true;prepare.hidden=false;error.hidden=true;};
    const showError=err=>{error.hidden=false;error.textContent=err.message||String(err);error.scrollIntoView({block:'center'});};
    const lock=enabled=>{for(const element of root.querySelectorAll('input,select,textarea,button'))element.disabled=enabled;};
    const finish=()=>{if(!saving&&!uncertain)root.remove();};root.querySelectorAll('[data-opening-close]').forEach(button=>button.onclick=finish);root.addEventListener('cancel',event=>{event.preventDefault();finish();});root.addEventListener('close',()=>{if(!saving&&!uncertain)root.remove();});
    const existingProduct=()=>state.products.find(product=>product.skuId===field('skuId').value&&product.warehouseId===field('warehouseId').value);
    const syncProduct=()=>{const product=existingProduct();for(const name of ['name','subType','thirdType'])field(name).readOnly=!!product;field('type').disabled=!!product;if(product){field('name').value=product.name;field('subType').value=product.subType||'';field('thirdType').value=product.thirdType||'';const type=queryPath(product)[0];field('type').value=['智能机','功能机','二手手机'].includes(type)?type:'智能机';field('salePrice').value='';}revision++;clearPreview();};
    const rebuildProducts=()=>{field('skuId').innerHTML=option('','新建型号档案',true)+state.products.filter(product=>product.active!==false&&product.warehouseId===field('warehouseId').value&&['智能机','功能机','二手手机'].includes(queryPath(product)[0])).map(product=>option(product.skuId,product.name+' · '+(product.externalCode||product.skuId))).join('');syncProduct();};
    field('warehouseId').onchange=rebuildProducts;field('skuId').onchange=syncProduct;rebuildProducts();
    const payload=()=>{
      const type=field('type').value,serials=field('serialNos').value.trim().split(/[\s,，;；]+/).filter(Boolean),validSerial=no=>/^[0-9]{15}$/.test(no)||(type==='功能机'&&/^(?=.*[A-Z])[A-Z0-9]{15}$/.test(no));if(!serials.length||serials.some(no=>!validSerial(no)))throw Error(type==='功能机'?'功能机须填写原始15位数字或大写字母数字串号，每行一台；不要替换或截断。':'每台手机须填写15位完整数字串号，每行一台。');if(new Set(serials).size!==serials.length)throw Error('本次串号有重复，请逐台核对。');
      const cost=Number(field('costPrice').value),retail=field('salePrice').value.trim();if(field('costPrice').value.trim()===''||!Number.isFinite(cost)||cost<0)throw Error('请填写有效的每台期初成本。');if(retail!==''&&(!Number.isFinite(Number(retail))||Number(retail)<0))throw Error('零售价应为有效的非负金额，也可留空。');
      const name=field('name').value.trim(),brand=field('subType').value.trim(),supplierId=field('supplierId').value,reason=field('reason').value.trim(),sourceRef=field('sourceRef').value.trim();if(!name||!brand||!supplierRows.some(s=>s.id===supplierId))throw Error('请填写型号、二级分类并选择已有供货商。');if(reason.length<4||reason.length>500||!sourceRef)throw Error('请填写来源依据及4至500字的漏录原因。');
      const product=existingProduct(),rows=serials.map(serialNo=>({serialNo,name,type:field('type').value,subType:brand,thirdType:product?.thirdType||field('thirdType').value.trim(),unit:'台',quantity:1,costPrice:cost,...(retail!==''?{salePrice:Number(retail)}:{}),supplierId,actualPurchaseDate:field('actualPurchaseDate').value,...(product?{skuId:product.skuId}:{})})),value={sourceRef,reason,warehouseId:field('warehouseId').value,rows};
      const file=field('sourceFile').value.trim(),sha=field('sourceSha256').value.trim(),sheet=field('sheet').value.trim(),rowText=field('sourceRows').value.trim();if(file||sha){if(!file||!/^[a-f0-9]{64}$/i.test(sha))throw Error('原表文件证据须同时填写真实文件名与64位SHA-256；也可都留空。');value.sourceFile=file;value.sourceSha256=sha.toLowerCase();}
      if(sheet||rowText){const numbers=rowText.split(/[\s,，;；]+/).filter(Boolean);if(!sheet||numbers.length!==serials.length||numbers.some(number=>!/^\d+$/.test(number)||Number(number)<1))throw Error('原表行号须与串号逐行对应，并填写真实工作表名称；也可都留空。');value.rows.forEach((row,index)=>row.rowProvenance={sheet,row:Number(numbers[index])});}
      return value;
    };
    const drawPreview=result=>{const summary=result.summary||{},number=value=>value==null?'待核对':E(value);preview.innerHTML='<h3>请核对本次期初追加</h3><p>原有 '+number(summary.existingUnits)+' 台 ＋ 本次 '+number(summary.units)+' 台 ＝ 追加后 '+number(summary.totalUnitsAfter)+' 台</p><p>本次存货成本 '+M(summary.stockValue)+' · 新建档案 '+number(summary.newProducts)+' 个</p><p class="inventory-fixed">只追加期初存货，采购单、应付与实际收付款均不新增。</p>'+(result.warnings||[]).map(warning=>'<p class="inventory-warning">'+E(warning)+'</p>').join('')+'<div class="inventory-opening-preview-rows">'+(result.rows||[]).map(row=>'<article><strong>'+E(row.serialNo)+'</strong><p>'+E(row.name)+' · '+E([row.type,row.subType,row.thirdType].filter(Boolean).join(' / '))+'</p><p>仓库：'+E(row.warehouseName||state.warehouses.find(w=>w.id===(row.warehouseId||summary.warehouseId))?.name||row.warehouseId||summary.warehouseId)+'</p><p>供货商：'+E(row.supplier||row.supplierName||supplierRows.find(s=>s.id===row.supplierId)?.name||'待核对')+' · 实际进货日期：'+E(row.actualPurchaseDate||'待补')+'</p><p>每台成本 '+M(row.costPrice)+(row.salePrice!=null&&(field('salePrice').value.trim()!==''||row.skuId)?' · 零售价 '+M(row.salePrice):' · 零售价待补')+'</p></article>').join('')+'</div>';preview.hidden=false;};
    form.addEventListener('input',()=>{if(!saving&&!uncertain){revision++;clearPreview();}});
    form.onsubmit=async event=>{event.preventDefault();if(saving||uncertain)return;clearPreview();const version=revision;let body;try{body=payload();}catch(err){showError(err);return;}prepare.disabled=true;try{const result=await post('/api/inventory/opening-append/preview',body);if(!root.isConnected||version!==revision)return;if(!result.previewToken||result.noNewCash!==true||result.noNewPayable!==true)throw Error('预览尚未完成，请重新预览后确认。');prepared=result;preparedBody=JSON.stringify(body);drawPreview(result);confirm.hidden=false;prepare.hidden=true;preview.scrollIntoView({block:'start'});}catch(err){if(root.isConnected&&version===revision)showError(err);}finally{if(root.isConnected)prepare.disabled=false;}};
    confirm.onclick=async()=>{if(saving||!prepared?.previewToken)return;let body;try{body=payload();if(JSON.stringify(body)!==preparedBody)throw Error('内容已改变，请重新预览。');}catch(err){clearPreview();showError(err);return;}saving=true;root.dataset.saving='1';lock(true);try{const result=await post('/api/inventory/opening-append',{...body,previewToken:prepared.previewToken,confirmed:true},attempt);root.remove();try{await loadBasics();if(state.tab==='inventory')await render();}catch{toast('期初追加已保存，列表刷新失败，请点刷新核对。',true);return;}toast(result.message||'期初手机已追加，请按完整串号核对库存。');window.speakSubmitSuccess?.();}catch(err){saving=false;uncertain=err.uncertain===true;root.dataset.saving=uncertain?'1':'';confirm.disabled=false;if(uncertain){confirm.textContent='重试核对这次追加';showError(err);}else{lock(false);field('type').disabled=!!existingProduct();clearPreview();showError(err);}}};
    try{const result=await api('/api/suppliers/directory');if(!root.isConnected)return;supplierRows=(Array.isArray(result)?result:result.rows||[]).filter(s=>s.active!==false&&s.status!=='inactive');field('supplierId').innerHTML=option('','请选择已有供货商',true)+supplierRows.map(s=>option(s.id,s.name)).join('');field('supplierId').disabled=false;prepare.disabled=!supplierRows.length;status.textContent=supplierRows.length?'请按原始记录填写；未确认前库存不增加。':'尚无可用供货商，请先在基础资料中建档。';}catch(err){if(root.isConnected){status.textContent='供货商读取失败，请关闭后重新打开。';showError(err);}}
  }
  function sourceHistory(rows){
    return rows?.length?'<details class="inventory-source-history"><summary>来源更正记录（'+E(rows.length)+'）</summary>'+rows.map(row=>{const before=row.before||{},after=row.after||{},accounting=row.accounting||row.paymentAllocation;return '<article><p><strong>'+E(row.operatorName||row.operator||'老板')+'</strong> · '+E(displayTime(row.createdAt||row.at))+'</p><p>供货商：'+E(before.supplier||'待补')+' → '+E(after.supplier||'待补')+'</p><p>进货日期：'+E(before.purchaseDate||'待补')+' → '+E(after.purchaseDate||'待补')+'</p><p>依据：'+E(row.reason||'未提供')+'</p>'+(accounting?'<p>已付归属 '+M(accounting.paidAmount||0)+' · 应付归属 '+M(accounting.payableAmount||0)+'</p>':'')+'</article>';}).join('')+'</details>':'<p class="muted">暂无来源更正记录。</p>';
  }
  function sourcePreview(prepared){
    const before=prepared.before||{},after=prepared.after||{},pay=prepared.paymentAllocation||{};
    const finance=prepared.mode==='purchase'&&prepared.paymentAllocation?'<div class="inventory-source-finance"><h3>这台手机的货款归属</h3><p>原采购单：'+E(prepared.purchaseDisplayNo||prepared.purchaseId||'待核对')+'</p><p>该台成本 '+M(prepared.costAmount)+' · 已付归属 '+(pay.paidAmount==null?'待明确':M(pay.paidAmount))+' · 应付归属 '+(pay.payableAmount==null?'待明确':M(pay.payableAmount))+'</p>'+(pay.method?'<p>'+E(pay.method)+'</p>':'')+((pay.parts||[]).length?'<details><summary>关联付款依据</summary>'+(pay.parts||[]).map(part=>'<p>'+E(part.reference||part.cashId||part.settlementId)+' · '+(part.amount==null?'待分配（可用 '+M(part.availableAmount)+'）':M(part.amount))+'</p>').join('')+'</details>':'')+'</div>':'<p class="inventory-fixed">'+E(prepared.mode==='purchase'?'正式采购：本次仅更正实际进货日期。':prepared.mode==='opening'?'期初手机：保存来源与日期，原期初货款另按真实账目核对。':'历史手机：按现有来源证据更正。')+'</p>';
    return '<h3>请核对这台手机</h3><p class="inventory-source-serial"><code>'+E(prepared.serialNo)+'</code></p><p>'+E(prepared.name)+' · '+E(prepared.warehouseName||prepared.warehouseId)+'</p><dl class="inventory-source-changes"><div><dt>供货商</dt><dd>'+E(before.supplier||'待补')+' → <strong>'+E(after.supplier||'待补')+'</strong></dd></div><div><dt>实际进货日期</dt><dd>'+E(before.purchaseDate||'待补')+' → <strong>'+E(after.purchaseDate||'待补')+'</strong></dd></div></dl>'+finance+(prepared.message?'<p>'+E(prepared.message)+'</p>':'');
  }
  async function correctSource(p,selected){
    if(state.user?.roleCode!=='owner')return;
    const existing=document.getElementById('inventory-source-dialog');if(existing?.dataset.saving==='1')return;
    close();const root=document.createElement('dialog');root.id='inventory-source-dialog';root.className='inventory-count-dialog inventory-source-dialog';root.setAttribute('aria-labelledby','inventory-source-title');
    const serialOptions=[...new Map(state.inventory.filter(row=>row.skuId===p.skuId).flatMap(row=>(row.serials||[]).map(serial=>[serial.no,{...serial,warehouseName:row.warehouseName}]))).values()];
    root.innerHTML='<h2 id="inventory-source-title">补录 / 更正单台手机来源</h2><label>核对完整串号<select id="inventory-source-serial">'+serialOptions.map(serial=>option(serial.no,serial.no+' · '+(serial.warehouseName||'未分仓')+' · '+(serial.status||'待核对'),serial.no===selected.no)).join('')+'</select></label><p id="inventory-source-status" role="status">正在读取这台手机的来源…</p><div id="inventory-source-current"></div><form id="inventory-source-form" hidden><label>正确供货商<select name="supplierId" id="inventory-source-supplier"></select></label><label>实际进货日期<input name="purchaseDate" type="date"><small>日期未知可留空，保存后显示待补。</small></label><label>更正 / 补录依据（必填）<textarea name="reason" maxlength="1000" required placeholder="例如：核对原供货单后，发现本台误记到另一家公司。"></textarea></label><label id="inventory-source-allocation-label" hidden>本台已付款归属金额<input name="paidAllocationAmount" type="number" min="0" step="0.01" inputmode="decimal"><small id="inventory-source-allocation-hint"></small></label><p id="inventory-source-error" class="inventory-warning" role="alert" hidden></p><section id="inventory-source-preview" class="inventory-source-preview" aria-live="polite" hidden></section><div class="inventory-count-submit"><button type="submit" id="inventory-source-prepare">预览更正内容</button><button type="button" id="inventory-source-confirm" hidden>确认保存这一台</button><button type="button" id="inventory-source-cancel">取消</button></div></form>';
    document.body.append(root);root.showModal();const get=id=>root.querySelector('#'+id),form=get('inventory-source-form'),status=get('inventory-source-status'),error=get('inventory-source-error'),preview=get('inventory-source-preview'),prepare=get('inventory-source-prepare'),confirm=get('inventory-source-confirm'),cancel=get('inventory-source-cancel'),serialSelect=get('inventory-source-serial');
    const headClose=document.createElement('button');headClose.type='button';headClose.className='inventory-source-close';headClose.textContent='关闭';root.prepend(headClose);
    form.elements.reason.minLength=4;form.elements.reason.maxLength=500;
    let revision=0,context=null,prepared=null,preparedPayload='',saving=false,uncertain=false,attempt={};
    const showError=err=>{error.hidden=false;error.textContent=err?.message||String(err);error.scrollIntoView({block:'center'});};
    const clearPreview=()=>{prepared=null;preparedPayload='';confirm.hidden=true;preview.hidden=true;prepare.hidden=false;error.hidden=true;};
    const lock=enabled=>{for(const field of root.querySelectorAll('input,select,textarea'))field.disabled=enabled;cancel.disabled=enabled;headClose.disabled=enabled;prepare.disabled=enabled;};
    const finish=()=>{if(!saving&&!uncertain)root.remove();};cancel.onclick=finish;headClose.onclick=finish;root.addEventListener('cancel',event=>{event.preventDefault();finish();});root.addEventListener('close',()=>{if(!saving&&!uncertain)root.remove();});
    const currentSource=()=>context?.before||context?.source||{};
    const payload=()=>{const reason=form.elements.reason.value.trim();if(!reason)throw Error('请填写核对来源的依据。');const value={serialNo:serialSelect.value,purchaseDate:form.elements.purchaseDate.value,reason};if(form.elements.supplierId.value!=='__keep__')value.supplierId=form.elements.supplierId.value;const allocation=form.elements.paidAllocationAmount.value.trim();if(!get('inventory-source-allocation-label').hidden&&allocation!==''){const amount=Number(allocation);if(!Number.isFinite(amount)||amount<0)throw Error('请填写有效的本台已付款归属金额。');value.paidAllocationAmount=amount;}return value;};
    const load=async()=>{const version=++revision;context=null;clearPreview();form.hidden=true;status.textContent='正在读取这台手机的来源…';get('inventory-source-current').replaceChildren();try{const data=await api('/api/inventory/source-corrections?'+new URLSearchParams({serialNo:serialSelect.value}));if(version!==revision||!root.isConnected)return;context=data;const source=currentSource(),suppliers=data.supplierOptions||[];status.textContent=data.canCorrect===false?'这台手机当前不能更正，请按下方说明核对。':'已按完整串号定位。请核对原来源，再填写正确资料。';get('inventory-source-current').innerHTML='<p><strong>'+E(data.name||p.name)+'</strong> · '+E(data.warehouseName||p.warehouseName)+'</p><p>当前供货商：'+E(source.supplier||'待补')+' · 实际进货日期：'+E(source.purchaseDate||'待补')+'</p><p>原入库单：'+E(data.purchaseDisplayNo||data.purchaseId||'未关联采购单')+' · '+E(data.mode==='purchase'?'正式采购':data.mode==='opening'?'期初库存':'历史来源')+'</p>'+(data.message?'<p>'+E(data.message)+'</p>':'')+sourceHistory(data.history);form.elements.supplierId.innerHTML=option('__keep__','保持当前供货商（'+(source.supplier||'待补')+'）',true)+suppliers.filter(supplier=>supplier.active!==false).map(supplier=>option(supplier.id,supplier.name)).join('');form.elements.purchaseDate.value=/^\d{4}-\d{2}-\d{2}/.test(source.purchaseDate||'')?source.purchaseDate.slice(0,10):'';form.elements.reason.value='';form.elements.paidAllocationAmount.value='';get('inventory-source-allocation-label').hidden=true;form.hidden=data.canCorrect===false;cancel.disabled=false;}catch(err){if(version!==revision||!root.isConnected)return;status.textContent=err.message;form.hidden=false;for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=true;prepare.disabled=true;showError(err);}};
    serialSelect.onchange=()=>{if(!saving&&!uncertain){lock(false);load();}};form.addEventListener('input',()=>{if(!saving&&!uncertain){revision++;clearPreview();}});
    form.onsubmit=async event=>{
      event.preventDefault();if(saving||uncertain||!context)return;clearPreview();const version=revision;let value;try{value=payload();}catch(err){showError(err);return;}
      prepare.disabled=true;
      try{
        const result=await post('/api/inventory/source-corrections/preview',value);if(!root.isConnected||version!==revision)return;
        prepared=result;preparedPayload=JSON.stringify(value);preview.innerHTML=sourcePreview(result);preview.hidden=false;const pay=result.paymentAllocation||{};
        if(result.requiresPaidAllocation){get('inventory-source-allocation-label').hidden=false;const field=form.elements.paidAllocationAmount;field.min=String(pay.minPaidAmount??0);field.max=String(pay.maxPaidAmount??pay.availablePaidAmount??result.costAmount);get('inventory-source-allocation-hint').textContent='原单存在部分付款，请按真实付款归属明确填写本台已付金额；可填 '+M(pay.minPaidAmount||0)+' 至 '+M(pay.maxPaidAmount??pay.availablePaidAmount??result.costAmount)+'，再预览。';confirm.hidden=true;field.focus();}
        else if(result.previewToken){confirm.hidden=false;prepare.hidden=true;preview.scrollIntoView({block:'start'});}
        else throw Error('预览未完成，请重新预览后保存。');
      }catch(err){if(root.isConnected&&version===revision)showError(err);}finally{if(root.isConnected)prepare.disabled=false;}
    };
    confirm.onclick=async()=>{if(saving||!prepared?.previewToken)return;let value;try{value=payload();if(JSON.stringify(value)!==preparedPayload)throw Error('资料已改变，请重新预览。');}catch(err){clearPreview();showError(err);return;}saving=true;root.dataset.saving='1';lock(true);confirm.disabled=true;error.hidden=true;try{const result=await post('/api/inventory/source-corrections',{...value,previewToken:prepared.previewToken,confirmed:true},attempt);root.remove();try{await loadBasics();if(state.tab==='inventory')await render();}catch{toast('更正已保存，列表刷新失败，请点刷新核对。',true);return;}toast(result.message||'这台手机的来源资料已保存。');window.speakSubmitSuccess?.();}catch(err){saving=false;uncertain=err.uncertain===true;root.dataset.saving=uncertain?'1':'';confirm.disabled=false;if(uncertain){confirm.textContent='重试核对这次提交';showError(err);}else{lock(false);clearPreview();showError(err);}}};
    await load();
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
    const pager=e.target.closest('[data-inv-page]');if(pager&&!pager.disabled){page+=Number(pager.dataset.invPage);draw();$('inventory-result-summary').scrollIntoView({block:'start'});}
    const bind=e.target.closest('[data-inv-bind]');if(bind){const p=state.inventory.find(p=>p.stockKey===bind.dataset.invBind);if(p)count(p,true);}
    const source=e.target.closest('[data-inv-source]');if(source){const p=state.inventory.find(row=>row.stockKey===source.dataset.invSourceStock),serial=p?.serials?.find(row=>row.no===source.dataset.invSource);if(p&&serial)correctSource(p,serial).catch(showError);}
    if(e.target.closest('[data-inv-opening]'))appendOpening().catch(showError);
    if(e.target.closest('[data-inv-opening-quantity]')){if(window.InventoryOpeningQuantity)window.InventoryOpeningQuantity.open().catch(showError);else toast('期初商品工具尚未加载，请刷新后重试。',true);}

  });
  document.addEventListener('click',e=>{if(e.target.closest('[data-tab]')?.dataset.tab!=='inventory'&&e.target.closest('[data-tab]'))close();});
  window.addEventListener('pagehide',stop);window.InventoryOffice={render,count,snapshot:()=>({filters:{...filters},page,queried}),restore:saved=>{if(saved?.filters){Object.assign(filters,saved.filters);page=Number.isInteger(saved.page)&&saved.page>0?saved.page:1;queried=!!saved.queried;}},resetQuery:()=>{queried=false;},queryParams:()=>{const params=new URLSearchParams();if(!queried){params.set('options','1');return params;}if(filters.warehouse)params.set('warehouse',filters.warehouse);if(filters.supplier)params.set('supplier',filters.supplier);if(filters.productGroup)params.set('productGroup',filters.productGroup);if(filters.category)params.set('category',filters.category);return params;},applyQuery:({q='',warehouse=''})=>{Object.assign(filters,{q,warehouse,supplier:'',productGroup:'',category:'',subcategory:'',thirdcategory:'',productSkuId:'',brand:''});queried=true;page=1;}};
})();
