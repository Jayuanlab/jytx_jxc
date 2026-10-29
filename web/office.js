/* Customer document: project allowed display fields before rendering. */
if(!window.StoreCustomerProductList)window.StoreCustomerProductList=(()=>{
 const text=v=>String(v??'').trim(),escape=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const price=p=>{const value=Number(p.salePrice);return p.pricePending!==true&&Number.isFinite(value)&&value>0&&p.importSource?.priceNeedsConfirmation!==true?'¥'+value.toFixed(2):'请咨询门店';};
 const project=products=>products.map(p=>({code:text(p.externalCode),name:text(p.name),sourceBarcode:text(p.sourceBarcode||p.barcode),brand:text(p.subType),unit:text(p.unit),price:price(p)}));
 function html(products,at=new Date()){
  const rows=project(products),date=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>商品清单</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#142336;background:#eef2f6;margin:0;font-size:14px}.toolbar{display:flex;gap:12px;justify-content:flex-end;max-width:960px;margin:18px auto;padding:0 20px}button{font:inherit;padding:10px 20px;border:1px solid #234b79;border-radius:6px;color:#234b79;background:white;cursor:pointer}button:first-child{background:#234b79;color:white}main{max-width:920px;margin:0 auto 32px;padding:28px 24px;background:white}h1{font-size:25px;margin:0 0 12px}.meta{color:#526173;margin:0 0 22px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:10px 8px;border-bottom:1px solid #d9e1e9;word-break:break-word;text-align:left}th{background:#edf2f8;color:#183e6a}th:nth-child(1){width:13%}th:nth-child(2){width:20%}th:nth-child(3){width:28%}th:nth-child(4){width:13%}th:nth-child(5){width:6%}th:nth-child(6){width:20%;text-align:right}td:last-child{text-align:right;font-variant-numeric:tabular-nums}thead{display:table-header-group}tr{break-inside:avoid}@page{size:A4 portrait;margin:15mm}@media print{body{background:white}.toolbar{display:none}main{max-width:none;margin:0;padding:0}th{background:#edf2f8!important;print-color-adjust:exact}}</style></head><body><div class="toolbar"><button type="button" id="customer-print">打印 / 保存PDF</button><button type="button" id="customer-close">关闭</button></div><main><h1>商品清单</h1><p class="meta">'+escape(date)+'</p><table><thead><tr><th>店内编号</th><th>原厂条码（69码）</th><th>商品名称 / 型号</th><th>品牌 / 类别</th><th>单位</th><th>零售价</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+escape(r.code)+'</td><td>'+escape(r.sourceBarcode)+'</td><td>'+escape(r.name)+'</td><td>'+escape(r.brand)+'</td><td>'+escape(r.unit)+'</td><td>'+escape(r.price)+'</td></tr>').join('')+'</tbody></table></main></body></html>';
 }
 function open(products){
  if(!products.length)throw new Error('当前没有匹配商品，请先调整筛选后再打印。');
  const previous=document.activeElement,host=document.createElement("section"),frame=document.createElement("iframe");
  host.setAttribute("role","dialog");host.setAttribute("aria-modal","true");host.setAttribute("aria-label","商品清单打印预览");host.tabIndex=-1;
  host.style.cssText="position:fixed;inset:0;z-index:2147483647;background:#eef2f6;display:flex;flex-direction:column;";
  const header=document.createElement("header"),title=document.createElement("strong"),close=document.createElement("button");
  header.style.cssText="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 18px;background:white;border-bottom:1px solid #d9e1e9;color:#183e6a;font-size:18px;";
  title.textContent="商品清单预览";close.type="button";close.textContent="返回商品档案";close.style.cssText="padding:9px 16px;border:1px solid #234b79;border-radius:6px;background:white;color:#234b79;font:inherit;cursor:pointer;";
  const dismiss=()=>{host.remove();previous?.focus?.();};close.onclick=dismiss;header.append(title,close);
  frame.title="顾客商品清单";frame.style.cssText="border:0;width:100%;flex:1;min-height:0;background:white;";
  frame.onload=()=>{const doc=frame.contentDocument;doc.getElementById("customer-print").onclick=()=>frame.contentWindow.print();doc.getElementById("customer-close").onclick=dismiss;};
  frame.srcdoc=html(products);host.append(header,frame);document.body.append(host);host.addEventListener("keydown",event=>{if(event.key==="Escape")dismiss();});close.focus();return host;
 }
 return {project,html,open};
})();

/* Read-only query projection. Product identity is SKU; stock identity also includes warehouse. */
if(!window.StoreCatalogQuery)window.StoreCatalogQuery=(()=>{
 const norm=v=>String(v??'').normalize('NFKC').trim();
 const type=(v,service=false)=>({'智能手机':'智能机','功能手机':'功能机','二手机':'二手手机','其他数码':'数码产品','老人机':'功能机','老年机':'功能机','按键机':'功能机','老人手机':'功能机','老年手机':'功能机'}[norm(v)]||(/^(配件和维修|配件\s*[/／]\s*维修)$/.test(norm(v))?(service?'维修':'配件'):norm(v)));
 const brand=v=>({oppo:'OPPO',vivo:'vivo',iqoo:'iQOO'})[norm(v).toLowerCase()]||norm(v);
 const path=p=>{const parts=[type(p.type,p.stockManaged===false),brand(p.subType),norm(p.thirdType)],gap=parts.findIndex(v=>!v||v==='待归类');return parts.slice(0,gap<0?3:gap);};
 const normalize=parts=>path({type:parts[0],subType:parts[1],thirdType:parts[2]});
 const same=(a,b)=>a.length===b.length&&a.every((v,i)=>norm(v).toLowerCase()===norm(b[i]).toLowerCase());
 const contains=(full,parent)=>parent.length<=full.length&&same(full.slice(0,parent.length),parent);
 function paths(explicit=[],products=[]){const out=[],seen=new Set();function add(parts){for(let n=1;n<=parts.length;n++){const part=parts.slice(0,n),key=JSON.stringify(part.map(v=>norm(v).toLowerCase()));if(!seen.has(key)){seen.add(key);out.push({path:part});}}}for(const r of explicit)add(normalize(r.path));for(const p of products)add(path(p));return out;}
 const warehouse=p=>p.warehouseId||'wh-sale';
 const stocks=(p,inventory=[])=>inventory.filter(r=>r.skuId===p.skuId&&r.stockManaged!==false);
 const quantity=(p,inventory=[])=>p.stockManaged===false?null:stocks(p,inventory).reduce((n,r)=>n+Number(r.quantity||0),0);
 const unit=p=>norm(p.unit)||(p.trackSerial?'台':'件');
 function summary(rows=[]){const ids=new Set(),units=new Map();let total=0;for(const r of rows){const p=r.p||r;if(p.stockManaged===false)continue;ids.add(p.skuId);const q=Number(r.quantity||0);if(!Number.isFinite(q))continue;total+=q;if(q)units.set(unit(p),(units.get(unit(p))||0)+q);}return {kinds:ids.size,total,units:[...units].sort(([a],[b])=>a.localeCompare(b,'zh-CN'))};}
 const stockText=rows=>summary(rows).units.map(([u,n])=>n+' '+u).join('、')||'0';
 return {norm,type,brand,path,normalize,same,contains,paths,warehouse,stocks,quantity,unit,summary,stockText};
})();

/* Canonical category choices: declared directory owns classification, products remain searchable. */
if(!window.StoreCatalogDirectory)window.StoreCatalogDirectory=(()=>{
const norm=v=>String(v||'').normalize('NFKC').trim(),type=v=>({'智能手机':'智能机','功能手机':'功能机','二手机':'二手手机','其他数码':'数码产品'}[norm(v)]||norm(v));
const raw=p=>{const parts=[type(p.type),norm(p.subType),norm(p.thirdType)],gap=parts.findIndex(v=>!v||v==='待归类');return parts.slice(0,gap<0?3:gap);};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>norm(v).toLowerCase()===norm(b[i]).toLowerCase());
function rows(explicit=[],products=[]){const declared=explicit.map(r=>({path:r.path.map((v,i)=>i===0?type(v):norm(v))}));const out=[],seen=new Set();for(const row of declared){const key=JSON.stringify(row.path.map(v=>v.toLowerCase()));if(!seen.has(key)){seen.add(key);out.push(row);}}if(out.length)return out;for(const p of products){const path=raw(p);for(let i=1;i<=path.length;i++){const part=path.slice(0,i),key=JSON.stringify(part.map(v=>v.toLowerCase()));if(!seen.has(key)){seen.add(key);out.push({path:part});}}}return out;}
function children(list,parent=[]){const out=[];for(const r of list)if(r.path.length>parent.length&&same(r.path.slice(0,parent.length),parent)&&!out.includes(r.path[parent.length]))out.push(r.path[parent.length]);return out;}
function project(list,path){if(!list.length)return path.filter(v=>v&&v!=='待归类');for(let n=path.length;n>0;n--){const found=list.find(r=>same(r.path,path.slice(0,n)));if(found)return found.path.slice();}return [];}
function productPath(p,explicit,products){return project(rows(explicit,products),raw(p));}
function validate(list,path){if(path.some(v=>v==='待归类'))throw Error('请选择正式商品分类');for(let n=0;n<3;n++){if(n&&path[n]&&!path[n-1])throw Error('请先选择上一级分类');if(!path[n]&&children(list,path.slice(0,n)).length)throw Error('请选择'+['一级','二级','三级'][n]+'分类');}return true;}
return{norm,type,raw,same,rows,children,project,productPath,validate};
})();

/* Additive category navigation: no API calls, write actions or permission changes. */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const key = parts => JSON.stringify(parts);
  const same = (a,b) => key(a)===key(b);
  function build(rows, pathOf, idOf = row => row.skuId, paths = [], warehouseId = '', includeStock = true) {
    const root={name:'全部分类',path:[],children:new Map(),ids:new Set()};
    for(const row of rows){const raw=pathOf(row).slice(0,3).map(value=>String(value||'').trim());const parts=raw.filter(v=>v&&v!=='待归类');let node=root;node.ids.add(idOf(row));
      for(const name of parts){if(!node.children.has(name))node.children.set(name,{name,path:[...node.path,name],children:new Map(),ids:new Set()});node=node.children.get(name);node.ids.add(idOf(row));}}
    for(const parts of paths){let node=root;for(const name of parts.slice(0,3)){if(!node.children.has(name))node.children.set(name,{name,path:[...node.path,name],children:new Map(),ids:new Set()});node=node.children.get(name);}}
    const items=new Map();if(includeStock)for(const row of rows){const id=idOf(row),bucket=items.get(id)||new Map();if(row.stockManaged!==false){const stocks=row.quantity!=null?[row]:typeof state!=='undefined'?window.StoreCatalogQuery.stocks(row,state.inventory||[]):[];for(const stock of stocks)bucket.set(JSON.stringify([id,stock.warehouseId||row.warehouseId||'wh-sale']),{...row,...stock});}items.set(id,bucket);}
    const visit=node=>{const stocks=[...node.ids].flatMap(id=>[...(items.get(id)?.values()||[])]);node.stock=window.StoreCatalogQuery.summary(stocks).total;node.stockText=window.StoreCatalogQuery.stockText(stocks);node.newest=Math.max(0,...[...node.ids].map(id=>window.StoreDisplayOrder?.recent(id)||0),...(window.StoreDisplayOrder?.data.catalog?.paths||[]).filter(p=>(!warehouseId||p.warehouseId===warehouseId)&&node.path.every((v,i)=>p.path[i]===v)).map(p=>Date.parse(p.createdAt)||0));for(const child of node.children.values())visit(child);};visit(root);
    return root;
  }
  function mount({host,rows,pathOf,selected=[],onSelect,title='分类查询',empty='这类暂无商品',paths=[],onAddProduct,onAddCategory,warehouse=()=>'',showStock=false,showCounts=true}) {
    const opened=new Set(),rootId=host.id||'category-nav';let root,selection=selected.slice(0,3),mobilePath=[],dialog,sortMode='custom',orderEdit=false;
    host.classList.add('store-category-nav');
    const find=parts=>{let node=root;for(const name of parts){node=node?.children.get(name);if(!node)return null;}return node;};
    const sort=nodes=>window.StoreDisplayOrder?window.StoreDisplayOrder.sort([...nodes.values()],{warehouseId:warehouse(),parentPath:[...nodes.values()][0]?.path.slice(0,-1)||[],mode:sortMode}):[...nodes.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
    const counts=node=>showCounts?node.ids.size+'款'+(showStock?' · 库存 '+node.stockText:''):'';
    const label=node=>'<span>'+esc(node.name)+'</span><small style="white-space:normal;line-height:1.4">'+esc(counts(node))+'</small>';
    function choose(parts){selection=parts.slice(0,3);for(let i=1;i<selection.length;i++)opened.add(key(selection.slice(0,i)));onSelect(selection.slice());render();}
    const controls=node=>'<span class="scn-node-actions">'+((node.path.length<3&&onAddCategory||node.path.length===3&&onAddProduct)?'<button type="button" data-add-node="'+encodeURIComponent(key(node.path))+'" aria-label="在'+esc(node.path.join(' / '))+'下新增'+(node.path.length<3?'分类':'商品')+'" title="'+(node.path.length<3?'新增下级分类':'新增商品')+'"><span aria-hidden="true">＋</span></button>':'')+'<button type="button" data-delete-node="'+encodeURIComponent(key(node.path))+'" aria-label="删除分类'+esc(node.path.join(' / '))+'" title="删除空分类"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg></button>'+(orderEdit&&window.StoreDisplayOrder?.data.catalog?.canAdjust?'<button type="button" data-move-node="'+encodeURIComponent(key(node.path))+'" data-dir="-1" aria-label="上移'+esc(node.name)+'">↑</button><button type="button" data-move-node="'+encodeURIComponent(key(node.path))+'" data-dir="1" aria-label="下移'+esc(node.name)+'">↓</button>':'')+'</span>';
    const tools=()=>'<div class="scn-sort"><select aria-label="分类排序" data-tree-sort><option value="custom"'+(sortMode==='custom'?' selected':'')+'>我的顺序 · 新增在前</option>'+(showStock?'<option value="stock"'+(sortMode==='stock'?' selected':'')+'>现货数量优先</option>':'')+'<option value="name"'+(sortMode==='name'?' selected':'')+'>按名称</option></select><button type="button" data-order-edit>'+(orderEdit?'完成调序':'调整顺序')+'</button></div><small data-tree-feedback role="status"></small>';
    function bindTools(target){target.querySelectorAll('[data-delete-node]').forEach(b=>b.onclick=async()=>{const path=JSON.parse(decodeURIComponent(b.dataset.deleteNode));if(dialog)closeMobile();try{await window.DirectoryEdit.deleteCategory(warehouse(),path,()=>{selection=path.slice(0,-1);onSelect(selection.slice());window.StoreDisplayOrder.onDirectoryUpdated?.();},()=>choose(path));}catch(e){window.MasterDataUI.showError(e);}});target.querySelectorAll('[data-tree-sort]').forEach(b=>b.onchange=()=>{sortMode=b.value;render();if(dialog)showMobile();});target.querySelectorAll('[data-order-edit]').forEach(b=>b.onclick=()=>{orderEdit=!orderEdit;if(orderEdit)sortMode='custom';render();if(dialog)showMobile();});target.querySelectorAll('[data-add-node]').forEach(b=>b.onclick=()=>{const path=JSON.parse(decodeURIComponent(b.dataset.addNode));if(dialog)closeMobile();if(path.length<3)onAddCategory?.(path);else onAddProduct?.(path);});target.querySelectorAll('[data-move-node]').forEach(b=>b.onclick=async()=>{const path=JSON.parse(decodeURIComponent(b.dataset.moveNode)),parent=path.slice(0,-1),siblings=sort(find(parent).children),i=siblings.findIndex(n=>same(n.path,path)),j=i+Number(b.dataset.dir);if(j<0||j>=siblings.length){window.StoreDisplayOrder.message(j<0?'已经在同级最上面':'已经在同级最下面');return;}const names=siblings.map(n=>n.name);[names[i],names[j]]=[names[j],names[i]];b.disabled=true;try{await window.StoreDisplayOrder.saveTree(warehouse(),parent,names);render();if(dialog)showMobile();for(const f of host.querySelectorAll('[data-tree-feedback]'))f.textContent='✓ 顺序已保存';}catch(e){window.MasterDataUI?.showError(e);}finally{b.disabled=false;}});}
    function branch(node){const path=encodeURIComponent(key(node.path)),expanded=opened.has(key(node.path));
      return '<li><div class="scn-node'+(same(node.path,selection)?' selected':'')+'">'+(node.children.size?'<button type="button" class="scn-toggle" data-toggle="'+path+'" aria-label="'+(expanded?'收起':'展开')+esc(node.name)+'" aria-expanded="'+expanded+'">'+(expanded?'▾':'▸')+'</button>':'<span class="scn-leaf" aria-hidden="true">·</span>')+'<button type="button" class="scn-pick" data-pick="'+path+'" aria-pressed="'+same(node.path,selection)+'">'+label(node)+'</button>'+controls(node)+'</div>'+(node.children.size&&expanded?'<ul>'+sort(node.children).map(branch).join('')+'</ul>':'')+'</li>';}
    function render(){host.dataset.currentPath=JSON.stringify(selection);host.dataset.warehouse=warehouse();host.innerHTML=tools()+(onAddCategory||onAddProduct?'<div class="scn-tools">'+(onAddCategory?'<button type="button" data-add-root-category>＋ 新增大类（一级分类）</button>'+(selection.length?'<button type="button" data-add-category>＋ '+(selection.length===3?'新增同级分类':'在当前分类下新增')+'</button>':''):'')+(onAddProduct?'<button type="button" data-add-product>＋ 新增商品</button>':'')+'</div>':'')+'<button type="button" class="scn-mobile-open" aria-haspopup="dialog">☰ 分级分类 <span>'+esc(selection.join(' / ')||'全部分类')+'</span></button><section class="scn-desktop" aria-label="'+esc(title)+'"><header><strong>'+esc(title)+'</strong><button type="button" data-collapse>收起</button></header><p class="scn-help">点箭头展开，点名称查询。'+(showCounts?'款数是商品种类'+(showStock?'，库存按实际单位统计':'')+'。':'')+'</p><div class="scn-all'+(!selection.length?' selected':'')+'"><button type="button" data-pick="%5B%5D">'+label(root)+'</button></div><ul class="scn-tree">'+(root.children.size?sort(root.children).map(branch).join(''):'<li class="scn-empty">暂无分类</li>')+'</ul></section>';
      bindTools(host);
      if(onAddCategory){host.querySelector('[data-add-root-category]').onclick=()=>onAddCategory([],true);const addBelow=host.querySelector('[data-add-category]');if(addBelow)addBelow.onclick=()=>onAddCategory(selection.slice());}
      if(onAddProduct)host.querySelector('[data-add-product]').onclick=()=>onAddProduct(selection.slice());
      host.querySelector('.scn-mobile-open').addEventListener('click',()=>{mobilePath=selection.slice(0,-1);showMobile();});
      host.querySelector('[data-collapse]').addEventListener('click',()=>{opened.clear();render();});
      host.querySelectorAll('[data-toggle]').forEach(button=>button.addEventListener('click',()=>{const id=decodeURIComponent(button.dataset.toggle);if(opened.has(id))opened.delete(id);else opened.add(id);render();}));
      host.querySelectorAll('[data-pick]').forEach(button=>button.addEventListener('click',()=>choose(JSON.parse(decodeURIComponent(button.dataset.pick)))));
    }
    function closeMobile(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
    function showMobile(){if(!dialog){dialog=document.createElement('dialog');dialog.className='scn-dialog';dialog.id=rootId+'-dialog';document.body.append(dialog);dialog.addEventListener('close',()=>{dialog?.remove();dialog=null;});dialog.showModal();}const node=find(mobilePath)||root;
      dialog.innerHTML='<header><h2>选择分类</h2><button type="button" data-close aria-label="关闭分类">关闭</button></header><nav class="scn-crumb" aria-label="分类层级"><button type="button" data-level="0">全部</button>'+mobilePath.map((name,i)=>'<span>›</span><button type="button" data-level="'+(i+1)+'">'+esc(name)+'</button>').join('')+'</nav>'+(mobilePath.length?'<button type="button" class="scn-back" data-back>‹ 返回上一级</button>':'')+tools()+'<div class="scn-mobile-options">'+(node.children.size?sort(node.children).map(child=>'<div class="scn-mobile-row"><button type="button" data-next="'+encodeURIComponent(key(child.path))+'"><span>'+esc(child.name)+'</span><small>'+esc(counts(child))+'</small><b>›</b></button>'+controls(child)+'</div>').join(''):'<p>'+esc(empty)+'</p>')+'</div><footer><button type="button" class="scn-confirm" data-use>查看'+esc(mobilePath.length?node.name:'全部商品')+(showCounts?'（'+esc(counts(node))+'）':'')+'</button></footer>';
      bindTools(dialog);
      dialog.querySelector('[data-close]').onclick=closeMobile;
      dialog.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>{mobilePath=mobilePath.slice(0,Number(b.dataset.level));showMobile();});
      if(dialog.querySelector('[data-back]'))dialog.querySelector('[data-back]').onclick=()=>{mobilePath.pop();showMobile();};
      dialog.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>{const parts=JSON.parse(decodeURIComponent(b.dataset.next)),next=find(parts);if(next?.children.size){mobilePath=parts;showMobile();}else{choose(parts);closeMobile();}});
      dialog.querySelector('[data-use]').onclick=()=>{choose(mobilePath);closeMobile();};
    }
    function update(nextRows,nextSelected=selection,nextPaths=paths){paths=nextPaths;root=build(nextRows,pathOf,undefined,paths,warehouse(),showStock);selection=nextSelected.slice(0,3);for(let i=1;i<selection.length;i++)opened.add(key(selection.slice(0,i)));render();}
    update(rows,selection);
    return {update,destroy(){closeMobile();host.replaceChildren();}};
  }
  function wrap(main,selector,id){const first=main.querySelector(selector);if(!first)return null;const layout=document.createElement('div');layout.className='store-category-layout';const host=document.createElement('aside');host.id=id;const panel=document.createElement('div');panel.className='store-category-content';first.before(layout);let item=first;while(item){const next=item.nextSibling;panel.append(item);item=next;}layout.append(host,panel);return host;}
  window.StoreCategoryNavigator={build,mount,wrap};
})();

const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(){return '';}
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $ = (id) => document.getElementById(id);
const E = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const M = (value) => `¥${Number(value || 0).toFixed(2)}`;
const shortInternalNo = (value) => String(value || "").replace(/^([A-Z]{2,5})-([0-9a-f]{8})-[0-9a-f-]{20,}$/i, "$1-$2");
const labels = {
  order: { completed: "已完成", returned: "已退货", "partially-returned": "部分退货", partial_return:"部分退货" },
  plan: { open: "待收货", closed: "已终止", received: "已收齐" },
  settlement: { payment: "付款核销", refund: "收到退款", offset: "货款抵扣", opening: "期初登记", reverse: "撤销核销" },
  receipt: { air_funding:"空充boss付款（含BOSS平台手续费）", sale: "销售收款", refund: "销售退款", purchase: "采购付款", supplier_payment: "往来单位付款", supplier_refund: "往来单位退款", expense: "门店费用", expense_red: "费用红冲（账务更正）", carrier: "佣金到账", carrier_clawback: "佣金扣回", carrier_rental: "移动业务结算到账", gov_subsidy: "国补平台返款", gov_subsidy_refund: "国补原路退回", payroll: "工资发放" },
  payroll: { draft: "待确认", confirmed: "已确认", paid: "已发放", incomplete: "待核算" },
  rule: { piece: "按件", profit: "按毛利比例", none: "不提成" },
  audit: { "api:write": "业务操作", "user:create": "新增员工", "user:status": "员工状态变更", "user:permissions":"员工权限修改", "backup:create":"生成门店备份", "backup:restore":"恢复门店备份", "user:bind": "绑定微信", "user:feishu-bootstrap": "绑定老板飞书", "user:feishu-bind": "绑定员工飞书", "product:save": "保存商品", "product:service-reclassify": "收费项目归类", "product:price-request": "申请商品调价", "product:price-review": "审核商品调价", "purchase:create": "采购入库", "sale:create": "销售开单", "sale:return": "销售退货", "sale:exchange":"销售换货", "receipt:create":"登记收款单", "payment:create":"登记付款单", "carrier:event": "号卡佣金", "stock:count": "库存盘点", "stock:transfer": "库存调拨", "stock:blind-compare": "实点表核对", "stock:blind-review": "核实盘点差异", "stock:serial-count": "串号盘库", "stock:bind-serials": "补录串号", "stock:serial-review": "核实盘库差异", "expense:create": "登记费用", "expense:red-request": "申请费用红冲", "expense:red-review": "审核费用红冲", "commission:rule": "设置提成规则", "commission:resolve": "补录提成", "salary:change": "设置底薪", "payroll:confirm": "确认工资", "payroll:paid": "发放工资", "payroll:adjustment": "工资增减", "supplier:save": "保存往来单位", "supplier:payment": "往来单位付款", "supplier:refund": "往来单位退款", "supplier:offset": "抵扣货款", "supplier:reverse-offset": "撤销抵扣", "supplier:opening": "往来单位期初", "supplier:adjustment": "往来调整", "supplier:plan-offset": "订货预付抵扣", "supplier:plan": "建立订货", "supplier:close-plan": "终止订货", "supplier:price": "调价补差", "supplier:return": "采购退货" },
};
const label = (group, value) => labels[group]?.[value] || value || "—";
function displayTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function registerSaleContinuity(){if(state.saleContinuityRegistered||!window.StoreWorkContinuity)return;state.saleContinuityRegistered=true;state.saleContinuityName='office-sale'+(requestedReceptionId?':'+requestedReceptionId:'');window.StoreWorkContinuity.register(state.saleContinuityName,{route:'/app?tab=sales'+(requestedReceptionId?'&reception='+encodeURIComponent(requestedReceptionId):''),label:'销售开单',read:()=>({cart:state.salesCart,gifts:state.giftCart||[],draft:state.saleDraft,attempt:state.saleAttempt,picker:state.salePickerMode}),restore:value=>{if(!value||!Array.isArray(value.cart))return;state.salesCart=value.cart;state.giftCart=Array.isArray(value.gifts)?value.gifts:[];state.saleDraft=value.draft||null;state.saleAttempt=value.attempt||null;state.salePickerMode=value.picker;},meaningful:value=>value.cart.length>0||!!value.draft?.customerName||!!value.draft?.customerPhone});}
const state = { user: null, token: sessionStorage.getItem("officeLocalToken") || "", tab: "dashboard", inventory: [], products: [], users: [], salesCart: [], saleDraft: null, supplierId: "", orders: [], receptions: [], searchSynonyms: [], warehouses: [] };
const accounts = ["微信", "支付宝", "现金", "银行卡", "云闪付"];

const officeEntryTiming=new URLSearchParams(location.search).get('entryTiming')==='1'?{started:performance.now(),requests:[]}:null;
function publishEntryTiming(){if(!officeEntryTiming)return;let out=document.getElementById('office-entry-timing');if(!out){out=document.createElement('output');out.id='office-entry-timing';out.hidden=true;document.body.append(out);}out.dataset.timing=JSON.stringify({readyMs:Math.round(performance.now()-officeEntryTiming.started),requests:officeEntryTiming.requests});}
async function api(path, options = {}) {
  const readStarted=officeEntryTiming?performance.now():0;
  const writing = options.method === "POST", controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    let response;
    try { response = await fetch(path, { credentials: "same-origin", ...options, signal: controller.signal, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(state.token ? { Authorization: "Bearer " + state.token } : {}), ...(options.headers || {}) } }); }
    catch { const error = new Error(writing ? "网络连接中断，提交结果待核对。请按原内容重试核对原单，勿另开一单。" : "网络连接失败，请稍后刷新。"); error.uncertain = writing; throw error; }
    const headersFinished=officeEntryTiming?performance.now():0;let transferFinished=headersFinished,parseMs=0;
    let body;
    try { const contentType = response.headers.get("content-type") || ""; if(officeEntryTiming){const raw=await response.text();transferFinished=performance.now();body=contentType.includes('json')?JSON.parse(raw):raw;parseMs=performance.now()-transferFinished;}else body = contentType.includes("json") ? await response.json() : await response.text(); }
    catch { const error = new Error(writing ? "未收到完整提交结果，请按原内容重试核对原单。" : "服务器返回内容无法识别，请稍后刷新。"); error.uncertain = writing; throw error; }
    if (!response.ok) { const error = new Error(response.status === 401 ? "登录已失效，请重新登录；本次填写内容仍保留。" : body?.error?.message || body?.message || "请求失败（" + response.status + "）"); error.status = response.status; error.uncertain = writing && response.status >= 500; throw error; }
    if (writing && (!body || typeof body !== "object" || Array.isArray(body) || (path === "/api/sale-orders" && (typeof body.id !== "string" || !body.id.trim())))) { const error = new Error("未收到可识别的提交结果，请按原内容重试核对原单。"); error.uncertain = true; throw error; }
    if(officeEntryTiming)officeEntryTiming.requests.push({path:new URL(path,location.origin).pathname,ms:Math.round(performance.now()-readStarted),headersMs:Math.round(headersFinished-readStarted),transferMs:Math.round(transferFinished-headersFinished),parseMs:Math.round(parseMs),bytes:Number(response.headers.get('content-length')||0),serverTiming:response.headers.get('server-timing')||''});
    return body;
  } finally { clearTimeout(timer); }
}
function requestId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const b=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(b);else for(let i=0;i<16;i++)b[i]=Math.random()*256;return "req-"+Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
function post(path, data, attempt = null) {
  const signature = JSON.stringify([path, data]);
  if (attempt?.uncertain && attempt.signature !== signature) {
    const error = new Error("上次提交结果尚未确认，请恢复原内容重试核对原单；确认后再修改资料。"); error.uncertain = true; return Promise.reject(error);
  }
  if (attempt && attempt.signature !== signature) { attempt.signature = signature; attempt.key = requestId(); }
  const key = attempt ? attempt.key : requestId();
  return api(path, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(data) }).then(
    result => { if (attempt) attempt.uncertain = false; return result; },
    error => { if (attempt) attempt.uncertain = error.uncertain === true; throw error; }
  );
}
function guardPendingExit(event) {
  const root = $("modal-root");
  if (!state.saleSubmitting && !state.saleAttempt?.uncertain && root?.dataset.submitting !== "1" && root?.dataset.uncertain !== "1") return;
  event.preventDefault(); event.returnValue = "";
}
window.addEventListener("beforeunload", guardPendingExit);
function toast(message, error = false) { const target = $("toast"); target.textContent = message; target.style.background = error ? "#a72c2c" : "#20314f"; target.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => target.classList.remove("show"), 5000); }
let pageHelpSequence=0;
function heading(title, subtitle = "", controls = "") { const id="office-help-"+(++pageHelpSequence); return `<div class="heading"><div class="page-title-with-help"><h1>${E(title)}</h1><button type="button" class="page-help-button" data-help-all>? 帮助</button></div><div class="actions">${controls}</div></div>${subtitle?`<template id="${id}" data-page-help-template="${E(title)}"><p>${E(subtitle)}</p></template>`:""}`; }
function button(label, action, value = "", cls = "secondary") { return `<button type="button" class="${cls}" data-action="${E(action)}" data-value="${E(value)}">${E(label)}</button>`; }
function table(headers, rows) { return `<div class="table-wrap"><table><thead><tr>${headers.map((v) => `<th>${E(v)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`; }
function option(value, label, selected = false) { return `<option value="${E(value)}"${selected ? " selected" : ""}>${E(label)}</option>`; }
function formField(f) {
  const val = E(f.value ?? "");
  const placeholder = f.placeholder ? ` placeholder="${E(f.placeholder)}"` : "";
  let control;
  if (f.options) control = `<select name="${E(f.name)}"${f.required ? " required" : ""}>${f.options.map((o) => option(o.value ?? o, o.label ?? o, String(o.value ?? o) === String(f.value ?? ""))).join("")}</select>`;
  else if (f.type === "textarea") control = `<textarea name="${E(f.name)}"${placeholder}${f.required ? " required" : ""}>${val}</textarea>`;
  else if (f.type === "checkbox") control = `<input name="${E(f.name)}" type="checkbox"${f.value ? " checked" : ""}>`;
  else control = `<input name="${E(f.name)}" type="${E(f.type || "text")}" value="${val}"${placeholder}${f.required ? " required" : ""}${f.min != null ? ` min="${E(f.min)}"` : ""}${f.step ? ` step="${E(f.step)}"` : ""}>`;
  const search=f.searchable!==false&&f.options?.length>8?`<input class="select-filter" type="search" aria-label="搜索${E(f.label)}" placeholder="输入名称、编号或关键词筛选" autocomplete="off">`:"";
  return `<div class="field${f.wide ? " wide" : ""}${f.required ? " required-field" : ""}"><label>${E(f.label)}${f.required ? ' <b class="required-tag">必填</b>' : ""}</label>${search}${control}${f.inlineHint ? `<small class="field-limit">${E(f.inlineHint)}</small>` : ""}${f.hint ? `<small class="operation-tip" data-page-explanation>${E(f.hint)}</small>` : ""}</div>`;
}
const originalSelectOptions=new WeakMap();
function exposeNewChoice(form,name,value,targetName){
 const select=form.elements[name];if(!select||select.disabled||(!state.user?.capabilities.manageProducts&&value==='__custom__'))return;
 if(!document.querySelector('link[data-business-options-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/business-options-ui.css';link.dataset.businessOptionsStyle='1';document.head.append(link);}
 const row=document.createElement('div');row.className='option-add-row';select.before(row);row.append(select);const add=document.createElement('button');add.type='button';add.className='secondary';add.textContent='＋新增';add.setAttribute('aria-label','新增'+({type:'一级分类',subType:'二级分类',thirdType:'三级分类',unit:'计量单位',supplierId:'往来单位'}[name]||'选项'));row.append(add);
 add.addEventListener('click',()=>{const root=form.closest('#modal-root');if(root?.dataset.submitting==='1'||root?.dataset.uncertain==='1')return;const search=select.closest('.field')?.querySelector('.select-filter');if(search){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));}if(![...select.options].some(x=>x.value===value)){toast('新增选项未载入，请清空搜索后重试',true);return;}if(select.value!==value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}form.elements[targetName]?.focus();});
}
document.addEventListener("input",(event)=>{
  if(!event.target.matches(".select-filter"))return;
  const select=event.target.closest(".field")?.querySelector("select");if(!select)return;
  if(!originalSelectOptions.has(select))originalSelectOptions.set(select,Array.from(select.options,option=>option.cloneNode(true)));
  const all=originalSelectOptions.get(select),term=event.target.value.trim().toLowerCase(),selected=select.value;
  const matches=term?all.filter(option=>(option.textContent+" "+option.value).toLowerCase().includes(term)):all;
  select.replaceChildren(...matches.map(option=>option.cloneNode(true)));
  if(!matches.some(option=>option.value===selected)){
    select.prepend(new Option(matches.length?"请选择匹配项":"没有匹配项，请清空搜索重选","",true,true));
    select.value="";
  }else select.value=selected;
});

function modalPaymentCents(value){const s=String(value??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)&&n<=10000000000?n:null;}
function mountModalPayments(root,form,options,errorBox){
 const host=document.createElement('div');host.className='field wide';host.setAttribute('data-modal-payments','');form.querySelector('.fields').append(host);
 const submitButton=form.querySelector('button[type=submit]'),actor=state.user?.id;let controller=null,loading=true,failed='',accountData=null,controllerMode='';
 const active=()=>options.when?options.when(form):true;
 const total=()=>typeof options.totalCents==='function'?options.totalCents(form):Number.isSafeInteger(options.totalCents)?options.totalCents:modalPaymentCents(form.elements.amount?.value);
 const current=()=>root.isConnected&&$('modal-root')===root&&state.user?.id===actor;
 const mode=()=>typeof options.mode==='function'?options.mode(form):options.mode||'pay';
 const create=(initialParts)=>{controller?.destroy();controllerMode=mode();controller=window.PaymentSplits.mount({container:host,accounts:accountData,totalCents:total,initialParts,legacy:options.legacy||{account:options.defaultAccount||'微信'},people:state.users.filter(u=>u.status==='active'&&(u.capabilities.financeReceive||u.capabilities.finance)).map(u=>({id:u.id,name:u.name})),mode:controllerMode,requireReference:options.requireReference===true,allowedAccountNames:options.allowedAccountNames,requireNamedAccount:options.requireNamedAccount===true});};
 const sync=()=>{host.hidden=!active();if(controller&&controllerMode!==mode())create(controller.getParts());if(controller)controller.refresh();if(!root.dataset.submitting)submitButton.disabled=loading&&active();};
 form.addEventListener('input',sync);form.addEventListener('change',sync);sync();
 (async()=>{try{
  if(!window.PaymentSplits)throw new Error('分笔收付款功能尚未加载，请刷新页面后重试。');
  const response=await window.PaymentSplits.loadAccounts(true);if(!current())return;
  accountData=response;create();
 }catch(error){if(current()){failed=error.message||'账户读取失败，请刷新后重试';host.textContent=failed;errorBox.textContent=failed;}}finally{loading=false;if(current())sync();}})();
 return {validate(){if(!active())return {ok:true,parts:null};if(loading)return {ok:false,error:'正在读取收付款账户，请稍候。'};if(failed||!controller)return {ok:false,error:failed||'收付款区域未准备好，请刷新后重试。'};if(!current())return {ok:false,error:'登录身份或表单已经变化，请重新打开。'};return controller.validate();},destroy(){form.removeEventListener('input',sync);form.removeEventListener('change',sync);controller?.destroy();}};
}
function receiptAccountLabel(row){const name=row.accountName||row.accountSnapshot?.name;return name?(name==='信号机微信'?'门店微信':name==='现金库'?'门店现金':name)+' · '+(row.account||row.accountSnapshot?.channel||''):row.account||'未记录账户';}

function modal(title, fields, submit, description = "", paymentOptions = null) {
  if(paymentOptions)fields=fields.filter(f=>!["account","accountOwnerId","reference"].includes(f.name));
  const existing = $("modal-root");
  if (existing?.dataset.submitting === "1" || existing?.dataset.uncertain === "1") throw new Error("本单正在提交或结果待核对，请先按原内容重试核对后再操作。");
  existing?.remove();
  const root = document.createElement("div"); root.id = "modal-root"; root.className = "modal";
  root.innerHTML = '<div class="modal-content"><div class="page-title-with-help"><h2>' + E(title) + '</h2><button type="button" class="page-help-button" data-help-all data-modal-help>? 帮助</button></div>' + (description ? '<p class="muted">' + E(description) + '</p>' : '') + '<form id="modal-form" novalidate><div class="fields">' + fields.map(formField).join("") + '</div><div class="form-actions"><button class="primary" type="submit">确认提交</button>' + button("取消", "close-modal") + '</div><p id="modal-error" class="error" role="alert"></p></form></div>';
  document.body.append(root);
  const form = root.querySelector("#modal-form"), errorBox = root.querySelector("#modal-error"), attempt = {};
  let redPacketSaved=null;
  const write = async(path,data)=>{const result=await post(path,data,attempt);const collection=({"/api/inventory/transfers":"stockTransfers","/api/financial-documents":"receipts","/api/expenses":"expenses","/api/card-events":"cardEvents","/api/supplier-payments":"supplierCash","/api/supplier-refunds":"supplierCash","/api/supplier-offsets":"supplierSettlements","/api/supplier-adjustments":"supplierAdjustments","/api/supplier-price-adjustments":"supplierAdjustments","/api/procurement-plans":"procurementPlans","/api/purchase-orders":"purchases","/api/sale-return-requests":"saleReturnRequests","/api/purchase-return-requests":"purchaseReturnRequests","/api/red-reversals":"redReversals"})[path];if(collection&&result?.id)redPacketSaved={collection,row:result};return result;};
  const paymentControl = paymentOptions ? mountModalPayments(root,form,paymentOptions,errorBox) : null;
  let busy = false, committed = false;
  for (const ev of ["input", "change"]) root.addEventListener(ev, e => { const el = e.target; if (el.matches("input,select,textarea") && el.checkValidity()) el.setAttribute("aria-invalid", "false"); });
  root.addEventListener("click", event => { if (event.target === root && !busy && !attempt.uncertain) root.remove(); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || committed) return;
    const invalid = [...form.querySelectorAll("input,select,textarea")].filter(el => !el.disabled && !el.closest("[hidden]") && !el.closest("[data-modal-payments]") && (!el.checkValidity() || (el.required && el.type !== "checkbox" && !el.value.trim())));
    if (invalid.length) { invalid.forEach(el => el.setAttribute("aria-invalid", "true")); const missing = [...new Set(invalid.map(el => fields.find(f => f.name === el.name)?.label || el.name))]; errorBox.textContent = "尚未提交，请填写或重新选择：" + missing.join("、") + "。"; invalid[0].scrollIntoView({ block: "center" }); invalid[0].focus({ preventScroll: true }); return; }
    const paymentResult=paymentControl?.validate();if(paymentResult&&!paymentResult.ok){errorBox.textContent=paymentResult.error;root.querySelector("[data-modal-payments]")?.scrollIntoView({block:"center"});return;}
    const data = Object.fromEntries(new FormData(form));
    if(paymentResult?.parts)data.payments=paymentResult.parts;
    for (const field of fields.filter(f => f.type === "checkbox")) data[field.name] = form.elements[field.name].checked;
    const controls = [...form.querySelectorAll("input,select,textarea,button")].map(el => [el, el.disabled]);
    const submitButton = form.querySelector("button[type=submit]"), caption = submitButton.textContent;
    busy = true; root.dataset.submitting = "1"; controls.forEach(([el]) => el.disabled = true); submitButton.textContent = "正在提交…"; errorBox.textContent = "";
    try {
      const result = await submit(data, write);
      if (result === false) return;
      committed = true; root.remove(); toast(result?.message || "操作已完成");
      try { if(result?.officeRefresh==='purchase-return-review')await window.TradeDocuments.refreshPurchaseReturnReview(result);else if(result?.officeRefresh==='catalog-review')await window.TradeDocuments.renderCatalogReviews(officePageCurrent());else if(result?.officeRefresh==='receipt-review')await window.TradeDocuments.renderFinancial('receive');else {await loadBasics(); await render();} if (result?.nextStep) $(result.nextStep)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
      catch { toast("已保存" + (result?.id ? "，单号 " + documentNo(result) : "") + "；列表刷新失败，请稍后刷新，无需重新提交。", true); }
      if(redPacketSaved)$("main").insertAdjacentHTML("afterbegin",`<section class="card red-packet-saved"><strong>本次已保存：${E(documentNo(redPacketSaved.row))}</strong>${redPacketEntry(redPacketSaved.collection,redPacketSaved.row)}</section>`);
    } catch (error) {
      if (root.isConnected && !committed) { const uncertain=error.uncertain||attempt.uncertain;root.dataset.uncertain = uncertain ? "1" : ""; errorBox.textContent = (uncertain ? "提交结果待核对：" : "") + error.message; errorBox.scrollIntoView({ block: "center" }); }
    } finally {
      busy = false; delete root.dataset.submitting;
      if (!committed) { controls.forEach(([el, disabled]) => el.disabled = disabled); submitButton.textContent = root.dataset.nextSubmitCaption || caption; }
    }
  });
}
const moneyField = (name, label, value = "") => ({ name, label, type: "number", min: 0, step: "0.01", value, required: true });
const qtyField = (name, label, value = 1) => ({ name, label, type: "number", min: 1, step: 1, value, required: true });
const accountField = { name: "account", label: "收付款账户", options: accounts };

const navItems = [
  ["dashboard", "首页"], ["sales", "开单"], ["sales-list", "销售清单"], ["orders", "销售单查询"], ["returns", "退换货"], ["inventory", "库存查询"], ["stocktake", "库存盘点"],
  ["purchase", "订货与入库"], ["purchase-query", "进货单查询"], ["suppliers", "往来单位往来"], ["finance", "资金收支流水"], ["receipts", "收款单查询"], ["payments", "付款单查询"], ["red", "单据红冲"],
  ["products", "商品管理"], ["cards", "号卡佣金"], ["payroll", "工资查询与管理"],
  ["reports", "日报"], ["staff", "员工管理与权限"], ["opening", "期初导入"], ["logs", "操作日志"], ["backup", "备份与恢复"],
];
const requiredCaps = { stocktake: "stocktake", sales: "sell", purchase: "purchase", "purchase-query": "purchase", suppliers: "supplierView", finance: "finance", receipts: "receiptRegister", payments: "paymentRegister", red: null, returns: "returnSale", products: "manageProducts", payroll: null, staff: "manageUsers", opening: "opening", logs: "manageUsers", backup: "manageUsers" };
const deepLinkTab=new URLSearchParams(location.search).get("tab");
const focusedPlanId=new URLSearchParams(location.search).get("focusPlan")||"";
let requestedReceptionId="";
if(navItems.some(([id])=>id===deepLinkTab))state.tab=deepLinkTab;
state.orderQuery=new URLSearchParams(location.search).get("q")||"";
state.documentQueries={[deepLinkTab||"orders"]:state.orderQuery};
state.payrollView=new URLSearchParams(location.search).get("view")==="manage"?"manage":"details";
state.payrollEmployeeId=new URLSearchParams(location.search).get("employeeId")||"";
const requestedPayrollMonth=new URLSearchParams(location.search).get("month")||"";
if(deepLinkTab==="payroll"&&/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPayrollMonth))state.month=requestedPayrollMonth;
function officeNavModel(user){
 const caps=user?.capabilities||{},allowed=id=>id==='red'?(caps.redRequest||caps.redReview):!requiredCaps[id]||caps[requiredCaps[id]];
 const names={products:'商品档案',purchase:'订货单',suppliers:'往来单位结算',staff:'员工与权限',finance:'资金流水'};
 const tab=id=>{const item=navItems.find(r=>r[0]===id);return item&&allowed(id)?{id,label:names[id]||item[1],tab:id}:null;};
 const link=(id,label,href,permitted,marker='')=>permitted?{id,label,href,marker}:null;
 return [
  {id:'sales',label:'销售业务',items:['sales','sales-list','orders','returns'].map(tab).concat(link('repair-services','维修服务','/repair-services',caps.sell))},
  {id:'inventory',label:'进货库存',items:[tab('inventory'),link('warehouse-transfer','仓库调拨','/app?tab=inventory&transfer=1',caps.purchase&&caps.stocktake),link('plans','订货单','/app?tab=purchase&section=plans',caps.purchase),link('inbound','进货单','/app?tab=purchase&section=inbound',caps.purchase),link('plans-query','订货单查询','/app?tab=purchase&section=plans&history=1',caps.purchase),tab('purchase-query'),link('purchase-returns','采购退货','/app?tab=purchase&section=purchase-returns',caps.purchase),tab('stocktake')]},
  {id:'finance',label:'财务中心',items:[link('document-classification','单据归类','/funds/documents',caps.learn),link('funds-overview','资金概览与内部交接','/funds',caps.learn),tab('suppliers'),tab('finance'),tab('reports')]},
  {id:'review',label:'查询分析',items:[link('all-documents','所有单据','/workbench-all?view=documents',true),link('document-search','单据查询','/document-query',true)]},
  {id:'catalog',label:'基础资料管理',items:[tab('products'),link('product-pricing','商品调价','/app?tab=products&view=pricing',caps.manageProducts),link('personnel-basics','人员基础信息','/master-data#personnel-management',caps.learn),link('party-basics','往来单位基础信息','/master-data#party-basics',caps.learn),link('master-data','全部基础资料','/master-data',caps.catalogAdd,'data-master-entry'),link('payment-accounts','收付款账户','/payment-accounts',user?.roleCode==='owner'||(!caps.catalogAdd&&caps.createPaymentAccounts))]},
  {id:'mobile',label:'移动业务',items:[tab('cards'),link('air-accounts','空充boss','/air-accounts',caps.sell,'data-air-account-entry')]},
  {id:'system',label:'人事与系统',items:[link('attendance','考勤打卡','/assistant?work-signin=1',true),link('payroll-details','工资明细查询','/app?tab=payroll&view=details',true),link('payroll-manage','工资管理','/app?tab=payroll&view=manage',user?.roleCode==='owner'),...['staff','opening','logs','backup'].map(tab)].concat(link('system-readiness','设备检查','/system-readiness',user?.roleCode==='owner'))}
 ].map(g=>({...g,items:g.items.filter(Boolean)})).filter(g=>g.items.length);
}
function renderNav(){
 const nav=$('nav'),groups=officeNavModel(state.user),mobile=matchMedia('(max-width:700px)').matches,key='juyou-nav-groups:'+state.user.id;let saved={};try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
 const modelSignature=JSON.stringify([state.user.id,groups,mobile,state.tab]);if(nav.dataset.modelSignature===modelSignature)return;nav.dataset.modelSignature=modelSignature;
 nav.classList.add('office-nav-organized');
 const itemHtml=item=>item.tab?'<button type="button" data-tab="'+E(item.tab)+'" class="'+(state.tab===item.tab?'active':'')+'"'+(state.tab===item.tab?' aria-current="page"':'')+'>'+E(item.label)+'</button>':'<a href="'+E(item.href)+'"'+(item.marker?' '+item.marker:'')+'>'+E(item.label)+'</a>';
 nav.innerHTML=itemHtml({tab:'dashboard',label:'首页'})+groups.map(group=>{const active=group.items.some(item=>item.tab===state.tab),open=mobile||active||(state.tab==='dashboard'&&group.id==='sales'&&saved[group.id]!==false)||saved[group.id]===true;return '<details class="office-nav-group'+(active?' has-current':'')+'" data-nav-group="'+group.id+'"'+(open?' open':'')+'><summary>'+E(group.label)+'</summary><div class="office-nav-items">'+group.items.map(itemHtml).join('')+'</div></details>';}).join('');
 if(!mobile)nav.querySelectorAll('[data-nav-group]').forEach(group=>group.addEventListener('toggle',()=>{saved[group.dataset.navGroup]=group.open;try{localStorage.setItem(key,JSON.stringify(saved));}catch{}}));
}

matchMedia('(max-width:700px)').addEventListener('change',()=>{if(state.user&&$('nav'))renderNav();});

let officeViewVersion=0,orderQueryVersion=0,giftRulesLoading=null;
function officePageCurrent(tab=state.tab) {
  const version=officeViewVersion,main=$("main");
  return ()=>version===officeViewVersion&&state.tab===tab&&$("main")===main&&main?.isConnected!==false;
}
async function officePageRead(current,read) {
  try { return await read(); } catch(error) { if(current())throw error; }
}
async function ensureGiftRules(){
  if(state.giftRules)return;
  if(!giftRulesLoading)giftRulesLoading=window.Gifts.loadRules();
  const pending=giftRulesLoading;try{await pending;}finally{if(giftRulesLoading===pending)giftRulesLoading=null;}
}
let officeBasicsVersion=0;
async function loadBasics() {
  const version=++officeBasicsVersion,token=state.token,userId=state.user?.id;
  const current=()=>version===officeBasicsVersion&&state.token===token&&state.user?.id===userId;
  if(['opening','backup','red','logs'].includes(state.tab))return;
  if(['staff','payroll','pay-settings'].includes(state.tab)){const users=await officePageRead(current,()=>api('/api/users'));if(current())state.users=users;return;}
  if(['orders','returns','reports','purchase-query'].includes(state.tab)){const rows=await officePageRead(current,()=>Promise.all([api('/api/users'),api('/api/warehouses')]));if(current()){state.users=rows[0];state.warehouses=rows[1];}return;}
  if(["receipts","payments","finance","logs","reports","suppliers"].includes(state.tab)){const data=await officePageRead(current,()=>Promise.all([api("/api/users"),api("/api/warehouses")]));if(current()){state.users=data[0];state.warehouses=data[1];}return;}
  if(state.tab==='purchase'){
    const data=await officePageRead(current,()=>Promise.all([api('/api/products?view=picker'),api('/api/users'),api('/api/warehouses')]));
    if(current()){state.products=data[0];state.users=data[1];state.warehouses=data[2];}return;
  }
  if(state.tab==="inventory"){
    if(new URLSearchParams(location.search).get('inventoryTiming')==='1')state.inventoryQueryStarted=performance.now();
    const params=window.InventoryOffice?.queryParams()||new URLSearchParams({options:'1'});
    const data=await officePageRead(current,()=>api('/api/inventory/bootstrap?'+params));
    if(current()){if(state.inventoryQueryStarted)state.inventoryReadMs=performance.now()-state.inventoryQueryStarted;state.inventory=data.inventory;state.products=data.products;state.warehouses=data.warehouses;state.inventoryFilterOptions=data.filterOptions;state.searchSynonyms=data.searchSynonyms||[];state.productCategoryPaths=data.categoryPaths||[];state.inventoryCategoryReady=true;state.inventoryHistoryLoaded=data.historyIncluded;state.inventoryAsOf=data.asOf;}return;
  }
  if(state.tab==="products"){
    const catalog=await officePageRead(current,()=>Promise.all([api("/api/products?view=catalog"),api("/api/warehouses")]));
    if(current()){state.products=catalog[0];state.warehouses=catalog[1];}return;
  }
  const data=await officePageRead(current,()=>state.tab==="sales"
    ? api("/api/sale-opening").then(bundle=>{state.saleSerialsReady=false;state.giftRules=bundle.giftRules;state.salePaymentAccounts=bundle.paymentAccounts;const products=new Map(bundle.products.map(p=>[p.skuId,p]));return [bundle.inventory.map(row=>({...products.get(row.skuId),...row})),bundle.products,bundle.users,bundle.receptions,bundle.searchMeta,bundle.warehouses];})
    : Promise.all([api("/api/inventory"), api("/api/products"), api("/api/users"), api("/api/receptions"), api("/api/search?scope=meta"), api("/api/warehouses")]));
  if(!current())return;
  const [inventory, products, users, receptions, searchMeta, warehouses]=data;
  state.inventory = inventory; state.products = products; state.users = users; state.receptions = receptions.rows || []; state.searchSynonyms = searchMeta.synonyms || []; state.warehouses=warehouses;
  if(state.saleDraft)state.saleDraft.receptionId="";
  const linkedReception="";
  if(state.tab==='sales'&&linkedReception)await loadSaleReception(linkedReception);
  if(requestedReceptionId){
    const reception=state.receptions.find((row)=>row.id===requestedReceptionId&&!row.publicAssist&&row.status!=="已结案");
    if(reception)state.saleDraft={...(state.saleDraft||{}),receptionId:reception.id,customerName:reception.customerName||"",customerPhone:reception.customerPhone||""};
    requestedReceptionId="";
    const url=new URL(location.href);url.searchParams.delete("reception");history.replaceState(null,"",url);
  }
}
async function renderDashboard() {
  const version=officeViewVersion,current=()=>version===officeViewVersion&&state.tab==="dashboard";
  let data;try{data=await api("/api/dashboard");}catch(error){if(!current())return;throw error;}
  if(!current())return;
  const inStock = state.inventory.filter((p) => p.stockManaged !== false);
  const summary = data.summary || {};
  const metric = (label, value) => `<div class="stat"><span>${E(label)}</span><strong>${M(value)}</strong></div>`;
  const quantityMetric = (label, value) => `<div class="stat"><span>${E(label)}</span><strong>${E(value)}</strong></div>`;
  const categoryRows = (data.categoryStats || []).map((row) => `<tr><td>${E(row.category)}</td><td>${E(row.quantity)}</td><td>${M(row.salesAmount)}</td>${data.canViewProfit ? `<td>${M(row.grossProfit)}</td>` : ""}</tr>`);
  const paymentRows = (data.paymentStats || []).map((row) => `<tr><td>${E(row.paymentMethod)}</td><td>${M(row.amount)}</td></tr>`);
  const staffRows = (data.staffStats || []).map((row) => `<tr><td>${E(row.name)}</td><td>${E(row.orderCount)}</td><td>${M(row.salesAmount)}</td></tr>`);
  const orderStatus = { completed: "已完成", returned: "已退货", "partially-returned": "部分退货" };
  const orderRows = (data.recentOrders || []).map((row) => `<tr><td>${E(documentNo(row))}<small>${E(row.createdAt)}</small></td><td>${E((row.items || []).map((item) => `${item.name} × ${item.quantity}`).join("、"))}</td><td>${M(row.amount)}</td><td>${E(orderStatus[row.status] || row.status || "已完成")}</td></tr>`);
  const section = (title, headers, rows) => `<section class="card"><h2>${E(title)}</h2>${rows.length ? table(headers, rows) : '<p class="empty">今天暂无记录</p>'}</section>`;
  $("main").innerHTML = heading("门店总览", "业务数据来自当前账套，测试商品编号以 DEMO 开头。", button("刷新", "refresh")) +
    `<div class="grid dashboard-stock">${quantityMetric("有库存商品", inStock.filter((p) => p.quantity > 0).length)}${quantityMetric("库存件数", inStock.reduce((n, p) => n + Number(p.quantity || 0), 0))}${quantityMetric("今日订单", summary.orderCount || 0)}</div>` +
    `<section class="card"><h2>今日经营 <small class="muted">${E(data.date)}</small></h2><div class="grid">${metric("销售额", summary.salesAmount)}${metric("退货额", summary.returnAmount)}${metric("净销售额", summary.netSales)}${metric("销售收款", summary.receivedAmount)}${metric("退款支出", summary.refundAmount)}${data.canViewProfit ? metric("调整后毛利", summary.adjustedGrossProfit) : ""}${state.user.capabilities.finance ? metric("门店费用", summary.expenseAmount) : ""}${state.user.capabilities.finance ? metric("运营商佣金到账", summary.carrierReceived) : ""}</div></section>` +
    `<div class="dashboard-panels">${section("按品类", ["分类", "净售数量", "净销售额", ...(data.canViewProfit ? ["毛利"] : [])], categoryRows)}${section("收款方式", ["方式", "净收款"], paymentRows)}${section("员工销售", ["员工", "订单数", "净销售额"], staffRows)}</div>` +
    section("今日销售单", ["单号", "商品", "金额", "状态"], orderRows);
}
function recordSummary(title,content) {
  const open=matchMedia('(max-width:700px)').matches?'':' open';
  return `<details class="record-summary"${open}><summary>${E(title)}</summary>${content}</details>`;
}
async function renderInventory() { const caps=state.user?.capabilities||{};if(new URLSearchParams(location.search).get('transfer')==='1'){$('main').innerHTML=heading('仓库调拨','先选原仓商品，再核对目标仓、数量和串号。',caps.purchase&&caps.stocktake?button('选择原仓商品','transfer-picker','','primary'):'')+'<p><a href="/app?tab=inventory">返回库存查询</a></p>'+(caps.purchase&&caps.stocktake?'<p class="muted">调拨前先预览；确认后才登记库存流水。</p>':'<p role="alert">当前账号没有仓库调拨权限。</p>');return;}await window.InventoryOffice.render();if(!caps.manageProducts&&(caps.sell||caps.purchase||caps.stocktake))$("main").querySelector(".heading .actions")?.insertAdjacentHTML("beforeend",button("维修·手机膜资料","repair-materials")); }

function filterRows() { const q = $("filter")?.value.trim().toLowerCase() || ""; $("list")?.querySelectorAll("tbody tr").forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(q); }); }
function stocktake() { location.assign("/stocktake"); }
function productCategoryEditor(_warehouseId,selected=[],onSaved,rootOnly=false) {
  const type=p=>p.type==='智能手机'?'智能机':p.type==='二手机'?'二手手机':p.type==='其他数码'?'数码产品':/^(配件和维修|配件\s*[/／]\s*维修)$/.test(p.type||'')?(p.stockManaged===false?'维修':'配件'):p.type;
  const parentOptions=()=>{
    const paths=new Map(),include=parts=>{for(let i=1;i<=Math.min(parts.length,2);i++)paths.set(JSON.stringify(parts.slice(0,i)),parts.slice(0,i));};
    for(const p of ((state.productCategoryPaths||[]).length?[]:state.products)){const parts=[type(p),p.subType,p.thirdType];const gap=parts.findIndex(v=>!v);include(gap<0?parts:parts.slice(0,gap));}
    for(const row of state.productCategoryPaths||[])include(row.path);
    return [{value:'[]',label:'一级分类（从顶层开始）'},...[...paths].sort((a,b)=>a[1].join('/').localeCompare(b[1].join('/'),'zh-CN')).map(([value,parts])=>({value,label:parts.join(' / ')+' 下'}))];
  };
  const parent=selected.slice(0,Math.min(selected.length,2));
  modal(rootOnly?'新增商品大类（一级分类）':'新增分类',[
    ...(!rootOnly?[{name:'parent',label:'添加位置',value:JSON.stringify(parent),required:true,options:parentOptions()}]:[]),
    {name:'name',label:rootOnly?'大类名称':'分类名称',required:true}
  ],async(data,write)=>{
    const result=await write('/api/product-category-paths',{parentPath:rootOnly?[]:JSON.parse(data.parent),name:data.name});
    await window.StoreDisplayOrder?.refresh();if(onSaved)onSaved(result);return result;
  },rootOnly?'只填写大类名称，提交后即可在该大类下继续建二级分类和商品。':'可从一级分类开始，最多三级。选中已有分类则在其下添加；分类保存后可继续新增商品。');
}

function productInventoryQuantity(product,inventory){return window.StoreCatalogQuery.quantity(product,inventory);}
async function renderProducts() {
  await window.StoreDisplayOrder?.ready;
  const current=officePageCurrent("products"),main=$("main");if(!current()||!main)return;
  const isPhone=matchMedia('(max-width:700px)').matches;
  if(new URLSearchParams(location.search).get("focusPrice")){
    main.innerHTML=heading("商品调价审核","只显示这张待审核调价单。核对商品、原价、新价和原因后再决定。")+'<p><a href="/app?tab=products">返回全部商品</a></p>';
    await officePageRead(current,()=>renderPricePanel());return;
  }
  if(new URLSearchParams(location.search).get('view')==='pricing'){
    main.innerHTML=heading('商品调价')+'<section class="card"><label>查找商品<input id="pricing-search" type="search" placeholder="名称或商品编号"></label><label>选择商品<select id="pricing-product"></select></label><button type="button" id="pricing-create" class="primary">填写调价单</button></section>';
    const search=$('pricing-search'),select=$('pricing-product'),button=$('pricing-create');
    const draw=()=>{const q=search.value.trim().toLowerCase();select.innerHTML=option('','请选择商品')+state.products.filter(p=>p.active!==false&&(!q||[p.name,p.externalCode,p.skuId].join(' ').toLowerCase().includes(q))).map(p=>option(p.skuId,p.name+' · 当前零售价 '+M(p.salePrice))).join('');button.disabled=!select.value;};
    search.oninput=draw;select.onchange=()=>{button.disabled=!select.value;};button.onclick=()=>{if(select.value)priceRequestEditor(select.value);};draw();await officePageRead(current,()=>renderPricePanel());return;
  }
  main.classList.add('product-catalog-page','product-tree-open');
  const categoryData=await api('/api/product-category-paths');if(!current())return;state.productCategoryPaths=categoryData.paths||[];
  const view=state.productCatalogView||(state.productCatalogView={query:"",categoryPath:"",page:1});
  if(view.catalogAllDefaultApplied!==true){view.status='';view.catalogAllDefaultApplied=true;}
  if(new URLSearchParams(location.search).get("catalogCode")==="69"&&view.onlyOriginal69==null)view.onlyOriginal69=true;
  const selectedStatus=view.statusTouched===true?view.status||'':'';
  const catalogProducts=state.products.filter(p=>selectedStatus==="inactive"?p.active===false:selectedStatus==="active"?p.active!==false:true);
  const brandName=value=>({oppo:'OPPO',vivo:'vivo',iqoo:'iQOO'})[String(value||'').toLowerCase()]||String(value||'');
  const normalized=(value)=>String(value??"").normalize("NFKC").toLowerCase();
  const catalogBarcodeHtml=p=>{const code=String(p.sourceBarcode||p.barcode||'');return code?'<small class="sale-original-barcode">'+(code.startsWith('69')?'原厂69码':'原厂条码')+'：<code>'+E(code)+'</code></small>':'';};
  const category=p=>window.StoreCatalogQuery.type(p.type,p.stockManaged===false);
  const queryPath=p=>window.StoreCatalogQuery.path(p);
  const queryPaths=()=>window.StoreCatalogQuery.paths(state.productCategoryPaths||[],catalogProducts);
  const categoryReviewReason=(p)=>{if(/公司/.test(p.thirdType||'')&&/智能机|智能手机/.test(p.type||''))return '三级误填供应商';if(p.stockManaged!==false&&p.type==='维修')return '维修服务/实物待确认';if(!p.type||!p.subType)return '分类不完整';if(['智能机','功能机','儿童手表','二手手机'].includes(category(p))&&!p.thirdType)return '具体型号待补';return '';};
  const needsCategoryReview=(p)=>Boolean(categoryReviewReason(p));
  const transferAction=state.user?.capabilities.purchase&&state.user?.capabilities.stocktake?button('仓库调拨','transfer-picker'):'';
  const commonActions=button("新增商品","edit-product","","primary")+'<button type="button" class="secondary" data-tab="products">刷新商品档案</button>'+transferAction+button("维修·手机膜资料","repair-materials");
  const desktopActions=commonActions+'<button type="button" id="product-catalog-tree-toggle" class="secondary">收起分类树</button>';
  const phoneActions=(state.user?.capabilities.catalogAdd?button('＋新增商品','edit-product','','primary'):'')+'<button type="button" id="product-catalog-tree-toggle" class="secondary">收起分类树</button><details class="product-catalog-manage"><summary>管理档案</summary><button type="button" class="secondary" data-tab="products">刷新商品档案</button>'+transferAction+button('维修·手机膜资料','repair-materials')+'<button type="button" id="product-catalog-download" class="secondary">下载商品档案</button><button type="button" id="product-catalog-print" class="secondary">打印商品清单</button></details>';
  const statusField=`<label>档案状态<select id="product-catalog-status">${option("","全部档案",!selectedStatus)}${option("active","在用商品",selectedStatus==="active")}${option("inactive","已停用 · 可恢复",selectedStatus==="inactive")}</select></label>`;
  const original69Field=`<label><input id="product-catalog-original69" type="checkbox" ${view.onlyOriginal69?"checked":""}>只看原厂69码配件</label>`;
  const searchField=`<label>搜索商品<input id="product-catalog-search" type="search" value="${E(view.query||"")}" placeholder="商品名称、型号或编号" autocomplete="off"></label>`;
  const brandField='<label>品牌／二级分类<select id="product-catalog-brand"></select></label>';
  const categoryField='<label>一级分类<select id="product-catalog-path"></select></label>';
  const phoneFilters='<section class="card product-catalog-filters">'+searchField+'<div class="product-catalog-pair">'+categoryField+brandField+'</div><details class="product-catalog-extra"><summary>更多筛选</summary>'+statusField+original69Field+'</details><div class="product-catalog-query-actions"><button type="button" id="product-catalog-query" class="primary">查询商品</button><button type="button" id="product-catalog-clear" class="secondary">清空条件</button></div><p id="product-catalog-count" role="status" aria-live="polite"></p></section>';
  const desktopFilters='<section class="card product-catalog-desktop-filters"><div class="fields">'+searchField+categoryField+brandField+statusField+'</div><div class="product-catalog-desktop-actions">'+original69Field+'<button type="button" id="product-catalog-query" class="primary">查询商品</button><button type="button" id="product-catalog-clear" class="secondary">清空条件</button><button type="button" id="product-catalog-download" class="secondary">下载商品档案</button><button type="button" id="product-catalog-print" class="secondary">打印商品清单</button></div><p id="product-catalog-count" role="status" aria-live="polite"></p></section>';
  main.innerHTML=heading("商品档案","档案包含实物商品和维修服务项目；维修工费不计库存，库存按仓库及供货来源另查。",isPhone?phoneActions:desktopActions)+(isPhone?phoneFilters:desktopFilters)+
    '<div id="product-catalog-results" class="card mobile-record-list"></div><div class="inventory-pagination" aria-label="商品分页"><button type="button" id="product-catalog-prev" class="secondary">上一页</button><span id="product-catalog-page"></span><button type="button" id="product-catalog-next" class="secondary">下一页</button></div>';
  const search=main.querySelector("#product-catalog-search"),categoryPath=main.querySelector("#product-catalog-path"),results=main.querySelector("#product-catalog-results"),count=main.querySelector("#product-catalog-count"),pageLabel=main.querySelector("#product-catalog-page"),prev=main.querySelector("#product-catalog-prev"),next=main.querySelector("#product-catalog-next"),pager=pageLabel.parentElement;
  const filterChanged=()=>{view.page=1;if(isPhone)view.mobileQueried=false;else view.desktopQueried=false;draw();};
  main.querySelector('#product-catalog-query')?.addEventListener('click',()=>{if(isPhone)view.mobileQueried=true;else view.desktopQueried=true;view.page=1;draw();if(!isPhone)results.scrollIntoView({block:'start',behavior:'smooth'});});
  main.querySelector('#product-catalog-clear')?.addEventListener('click',()=>{Object.assign(view,{query:'',categoryPath:'',brand:'',onlyOriginal69:false,status:'',statusTouched:false,page:1,mobileQueried:false,desktopQueried:false});renderProducts();});
  search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();main.querySelector('#product-catalog-query')?.click();}});
  main.querySelector('#product-catalog-tree-toggle')?.addEventListener('click',()=>{const open=main.classList.toggle('product-tree-open');main.querySelector('#product-catalog-tree-toggle').textContent=open?'收起分类树':'显示分类树';});
  let printableProducts=[];
  main.querySelector("#product-catalog-print").addEventListener("click",()=>{try{window.StoreCustomerProductList.open(printableProducts);}catch(error){toast(error.message||"打印预览未打开，请重试。",true);}});
  const pageCurrent=()=>current()&&main.contains(search)&&main.contains(results);
  main.querySelector('#product-catalog-download').addEventListener('click',()=>{
    const header=['店内编号','商品名称','一级分类','二级分类','三级分类','单位','零售价','原厂条码（69码）'];
    const rows=printableProducts.map(p=>[p.externalCode||'',p.name,...Array.from({length:3},(_,i)=>queryPath(p)[i]||''),p.unit||'',window.StoreCustomerProductList.project([p])[0].price,String(p.sourceBarcode||p.barcode||'')]);
    rows.sort((a,b)=>[a[2],a[3],a[4],a[1]].join('|').localeCompare([b[2],b[3],b[4],b[1]].join('|'),'zh-CN'));
    const cell=v=>{const value=String(v??'');const safe=/^[=+\-@]/.test(value)?"'"+value:value;return '"'+safe.replace(/"/g,'""')+'"';};
    const csv=String.fromCharCode(65279)+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='商品档案-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  main.querySelector('#product-catalog-original69').addEventListener('change',event=>{view.onlyOriginal69=event.target.checked;filterChanged();});
  const productTreeHost=window.StoreCategoryNavigator.wrap(main,'section.card','product-category-tree');
  const productTree=window.StoreCategoryNavigator.mount({host:productTreeHost,warehouse:()=>'',rows:[],pathOf:queryPath,onSelect:parts=>{view.categoryPath=parts.join(' / ');view.brand=parts[1]?brandName(parts[1]):'';view.productSkuId='';view.page=1;if(isPhone)view.mobileQueried=Boolean(parts.length);else view.desktopQueried=Boolean(parts.length);draw();},onAddProduct:state.user?.capabilities.catalogAdd?parts=>productEditor('',{type:parts[0]||'',subType:parts[1]||'',thirdType:parts[2]||''}):undefined,onAddCategory:state.user?.capabilities.catalogAdd?(parts,rootOnly)=>productCategoryEditor('',parts,result=>{view.categoryPath=result.path.join(' / ');view.productSkuId='';view.brand=result.path[1]||'';view.page=1;},rootOnly):undefined,title:'商品分类',showCounts:false});
  window.StoreDisplayOrder.onDirectoryUpdated=()=>{if(pageCurrent())draw();};
  const draw=()=>{
    if(!pageCurrent())return;
    const paths=new Set(queryPaths().map(r=>r.path.join(' / ')));paths.add('__review__');
    if(view.categoryPath&&!paths.has(view.categoryPath))view.categoryPath='';
    productTree.update(catalogProducts,view.categoryPath==='__review__'?[]:view.categoryPath.split(' / ').filter(Boolean),queryPaths().map(row=>row.path));
    categoryPath.innerHTML=option('','全部分类',!view.categoryPath)+[...paths].filter(v=>v==='__review__'||v===view.categoryPath||v.split(' / ').length<=1).sort((a,b)=>a.localeCompare(b,'zh-CN')).map(v=>option(v,v==='__review__'?'待整理商品':v,v===view.categoryPath)).join('');
    const primary=view.categoryPath!=='__review__'?view.categoryPath.split(' / ')[0]:'';
    const brands=[...new Set(queryPaths().filter(row=>!primary||row.path[0]===primary).map(row=>row.path[1]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    main.querySelector('#product-catalog-brand').innerHTML=option('','全部品牌',!view.brand)+brands.map(name=>option(name,name,view.brand===name)).join('');
    if((isPhone&&!view.mobileQueried)||(!isPhone&&!view.desktopQueried)){printableProducts=[];main.querySelector('#product-catalog-print').disabled=true;main.querySelector('#product-catalog-download').disabled=true;results.innerHTML='';count.textContent='点击“查询商品”查看全部档案，也可先选择条件缩小范围。';pager.hidden=true;pageLabel.textContent='';prev.disabled=true;next.disabled=true;return;}
    const terms=normalized(view.query).trim().split(/\s+/).filter(Boolean);
    const candidates=catalogProducts.filter((p)=>{
      if(view.onlyOriginal69&&(p.trackSerial||p.stockManaged===false||!/^69[0-9]+$/.test(String(p.sourceBarcode||p.barcode||""))))return false;
      if(view.brand&&!window.StoreCatalogQuery.same([queryPath(p)[1]||''],[view.brand]))return false;
      const fullPath=queryPath(p);
      if(view.categoryPath==='__review__'&&!needsCategoryReview(p))return false;
      if(view.categoryPath&&view.categoryPath!=='__review__'&&!window.StoreCatalogQuery.contains(fullPath,view.categoryPath.split(' / ')))return false;
      const haystack=normalized([p.name,p.externalCode,p.sourceBarcode,p.barcode,p.shortName,p.type,p.subType,p.thirdType,...(Array.isArray(p.aliases)?p.aliases:[p.aliases||""])].join(" "));
      return terms.every((term)=>haystack.includes(term));
    });
    const matched=candidates;
    printableProducts=matched.slice();main.querySelector('#product-catalog-print').disabled=!matched.length;main.querySelector('#product-catalog-download').disabled=!matched.length;
    const pages=Math.max(1,Math.ceil(matched.length/20));view.page=Math.min(pages,Math.max(1,Math.floor(Number(view.page)||1)));
    const start=(view.page-1)*20,shown=matched.slice(start,start+20);
    const rows=shown.map((p)=>{
      const source=p.importSource||{},unitPending=source.unitNeedsConfirmation===true||source.unitSource==="derived"||source.unitSource==="pending"||!p.unit;
      const price=Number(p.salePrice),pricePending=p.pricePending===true||source.priceNeedsConfirmation===true||!Number.isFinite(price)||price<=0;
      const priceText=Number.isFinite(price)&&price>0?M(price)+(pricePending?"（待核价）":""):"待核价";

      return `<tr data-sku="${E(p.skuId)}"><td data-label="商品编码"><span class="record-value">${E(p.externalCode||"")}</span></td><td data-label="商品" class="record-title"><strong>${E(p.name)}</strong>${catalogBarcodeHtml(p)}${needsCategoryReview(p)?'<small class="notice">待归类</small>':''}</td><td data-label="分类"><span class="record-value">${E(queryPath(p).join(" / ")||"未分类")}</span></td><td data-label="单位"><span class="record-value">${E(p.unit||"未设置")}${unitPending?' <strong class="notice">单位待核</strong>':""}</span></td><td data-label="零售价"><span class="record-value${pricePending?"":" money-value"}">${E(priceText)}</span>${pricePending?'<small>开单时请核实实际售价</small>':""}</td><td data-label="操作"><div class="actions">${button("编辑","edit-product",p.skuId)}${state.user?.roleCode==="owner"?button(p.active===false?"恢复":"停用","product-status",p.skuId,p.active===false?"secondary":"danger"):""}${p.qrCode?`<a class="staff-account-link" href="${E('/qr?skuId='+encodeURIComponent(p.skuId))}">二维码／补打</a>`:""}</div></td></tr>`;
    });
    if(isPhone){
      results.innerHTML=shown.length?shown.map(p=>{const source=p.importSource||{},price=Number(p.salePrice),pending=p.pricePending===true||source.priceNeedsConfirmation===true||!Number.isFinite(price)||price<=0,priceText=Number.isFinite(price)&&price>0?M(price)+(pending?'（待核价）':''):'待核价';return '<details class="product-catalog-item"><summary><strong>'+E(p.name)+'</strong><span class="product-catalog-price">'+E(priceText)+'</span><span class="product-catalog-open">详情 ›</span></summary><div class="product-catalog-item-detail"><p>商品编码：'+E(p.externalCode||'待补')+'</p><p>分类：'+E(queryPath(p).join(' / ')||'未分类')+'</p><p>单位：'+E(p.unit||'未设置')+'</p>'+catalogBarcodeHtml(p)+(needsCategoryReview(p)?'<p class="notice">待归类</p>':'')+(pending?'<p class="notice">开单时请核实实际售价</p>':'')+'<div class="product-catalog-item-actions">'+button('编辑','edit-product',p.skuId)+(state.user?.roleCode==='owner'?button(p.active===false?'恢复':'停用','product-status',p.skuId,p.active===false?'secondary':'danger'):'')+(p.qrCode?'<a class="secondary" href="'+E('/qr?skuId='+encodeURIComponent(p.skuId))+'">二维码／补打</a>':'')+'</div></div></details>';}).join(''):'<p class="empty">'+(catalogProducts.length?'没有匹配商品，请调整查询条件。':'暂无商品档案。')+'</p>';
    }else results.innerHTML=table(["商品编码","商品","分类","单位","零售价","操作"],rows.length?rows:['<tr><td colspan="6" class="empty">'+(catalogProducts.length?'没有匹配商品，请调整商品目录查询条件。':'暂无商品档案，请点击“新增商品”建立目录。')+'</td></tr>']);
    count.textContent=isPhone?(matched.length?'查到 '+matched.length+' 款商品 · 当前显示 '+(start+1)+'—'+(start+shown.length)+' 款':'没有匹配商品，请调整查询条件'):matched.length?'查到 '+matched.length+' 款商品 · 当前显示 '+(start+1)+'—'+(start+shown.length)+' 款':catalogProducts.length?'没有匹配商品，请调整查询条件':'尚未建立商品档案，新增商品会自动生成JY编码。';
    pager.hidden=isPhone&&matched.length<=20;
    pageLabel.textContent=`第 ${view.page} / ${pages} 页${matched.length?` · ${start+1}—${start+shown.length} 条`:""}`;
    prev.disabled=view.page<=1;next.disabled=view.page>=pages;
  };
  main.querySelector('#product-catalog-brand').addEventListener('change',e=>{view.brand=e.target.value;view.categoryPath=view.categoryPath!=='__review__'?view.categoryPath.split(' / ')[0]:'';view.productSkuId='';filterChanged();});
  search.addEventListener("input",()=>{if(!pageCurrent())return;view.query=search.value;filterChanged();});

  categoryPath.addEventListener('change',()=>{if(!pageCurrent())return;view.categoryPath=categoryPath.value;view.brand=brandName(view.categoryPath.split(' / ')[1]||'');view.productSkuId='';filterChanged();});
  prev.addEventListener("click",()=>{if(!pageCurrent()||prev.disabled)return;view.page--;draw();});
  next.addEventListener("click",()=>{if(!pageCurrent()||next.disabled)return;view.page++;draw();});
  main.querySelector("#product-catalog-status").addEventListener("change",async e=>{view.status=e.target.value;view.statusTouched=true;view.categoryPath="";view.brand="";view.productSkuId="";view.page=1;if(isPhone)view.mobileQueried=false;else view.desktopQueried=false;await renderProducts();});
  draw();

}
async function warehouseTransferPicker(){
  if(!state.user?.capabilities.purchase||!state.user?.capabilities.stocktake)throw new Error('仓库调拨需要采购入库和库存盘点权限，请联系管理员。');
  const latest=await api('/api/inventory/bootstrap?');
  state.inventory=latest.inventory;state.warehouses=latest.warehouses;
  const available=serial=>serial.inStock===true||['可售','未激活'].includes(serial.status);
  const rows=state.inventory.filter(row=>row.stockManaged!==false&&state.warehouses.some(warehouse=>warehouse.id===row.warehouseId)&&Number(row.quantity)>0&&(!row.trackSerial||(row.serials||[]).some(available))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  const dialog=document.createElement('dialog');dialog.className='inventory-count-dialog';
  dialog.innerHTML='<form method="dialog"><h2>仓库调拨</h2><p>先找原仓在库商品，再预览目标仓与数量。</p><label>查找商品或编号<input type="search" name="query" autocomplete="off" placeholder="商品名称、型号或编号"></label><label>原仓商品<select name="stockKey" required></select></label><p role="status" class="muted"></p><div class="inventory-count-submit"><button type="submit" value="continue">继续调拨</button><button type="submit" value="cancel">取消</button></div></form>';
  document.body.append(dialog);const form=dialog.querySelector('form'),select=form.elements.stockKey,status=dialog.querySelector('[role="status"]'),submit=form.querySelector('[value="continue"]');
  const draw=()=>{const query=form.elements.query.value.trim().toLowerCase(),matched=rows.filter(row=>!query||[row.name,row.externalCode,row.skuId,row.warehouseName].join(' ').toLowerCase().includes(query));select.innerHTML=option('','请选择原仓商品')+matched.map(row=>option(row.stockKey,row.name+' · '+(row.warehouseName||row.warehouseId)+' · '+row.quantity+' '+(row.unit||'件'))).join('');status.textContent='可调拨 '+matched.length+' 条在库记录';submit.disabled=!matched.length;};
  form.elements.query.addEventListener('input',draw);
  form.addEventListener('submit',event=>{if(event.submitter?.value!=='continue')return;event.preventDefault();const key=select.value;if(!key)return;dialog.close();dialog.remove();try{inventoryTransferC(JSON.stringify({stockKey:key}));}catch(error){toast(error.message||'无法打开仓库调拨',true);}});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});draw();dialog.showModal();
}
function inventoryTransferC(value) {
  const input=JSON.parse(value),source=state.inventory.find(row=>row.stockKey===input.stockKey);
  if(!source||source.stockManaged===false||!state.warehouses.some(w=>w.id===source.warehouseId)||Number(source.quantity)<=0)throw new Error("请选择原仓在库的实物商品。");
  const known=(source.serials||[]).filter(s=>s.inStock===true||["可售","未激活"].includes(s.status));
  if(source.trackSerial&&!known.length)throw new Error("这款手机还缺真实串号，请先补齐后再调拨。");
  let prepared=null,signature="";
  modal("仓库调拨 · "+source.name,[{name:"targetWarehouseId",label:"目标仓库",type:"select",value:state.warehouses.some(w=>w.id===input.targetWarehouseId)&&input.targetWarehouseId!==source.warehouseId?input.targetWarehouseId:"",required:true,options:[{value:"",label:"请选择目标仓库"},...state.warehouses.filter(w=>w.id!==source.warehouseId).map(w=>({value:w.id,label:w.name}))],inlineHint:"按目标仓库调拨；各仓商品名称保持一致。"},qtyField("quantity","调拨数量",1),...(source.trackSerial?[{name:"serialText",label:"调拨串号（每行一个）",type:"textarea",value:input.serialNo||known[0].no,required:true,wide:true,inlineHint:"只能调拨原仓可售的真实串号；待补串号不能转运。"}]:[]),{name:"reason",label:"调拨说明",value:"",required:true,wide:true}],async(data,write)=>{
    const payload={sourceSkuId:source.skuId,sourceWarehouseId:source.warehouseId,targetWarehouseId:String(data.targetWarehouseId||""),quantity:Number(data.quantity),serialNos:source.trackSerial?String(data.serialText||"").split(/[\s,，、;；]+/).filter(Boolean):[],reason:String(data.reason||"").trim()};
    const next=JSON.stringify(payload);
    if($("modal-root")?.dataset.uncertain==="1"&&next!==signature){const error=new Error("上次调拨结果尚未确认，请按原数量和串号重试核对，确认后再修改。");error.uncertain=true;throw error;}
    if(!prepared||next!==signature){
      try{prepared=await api("/api/inventory/transfers/preview",{method:"POST",body:JSON.stringify(payload)});}catch(error){error.uncertain=false;throw error;}
      signature=next;
      $("inventory-transfer-preview").innerHTML='<strong>请核对：'+E(prepared.sourceWarehouseName)+' → '+E(prepared.targetWarehouseName)+'</strong><p>'+E(prepared.targetName)+' · '+E(prepared.quantity)+' '+E(source.unit||"件")+'</p><p>原仓：'+E(prepared.sourceQuantityBefore)+' → '+E(prepared.sourceQuantityAfter)+'；目标仓：'+E(prepared.targetQuantityBefore)+' → '+E(prepared.targetQuantityAfter)+'</p>'+(prepared.amount!==undefined?'<p>随货成本：'+M(prepared.amount)+'；总成本保持不变。</p>':'')+((prepared.serialSources||[]).some(s=>s.sourceType==='historical-bound')?'<p>部分串号已核实补绑定记录，原供货来源仍待补；没有编造采购单。</p>':'')+'<p>'+E('转入'+(prepared.targetWarehouseId==='wh-other'?'其他仓':prepared.targetWarehouseName)+'，商品名称保持一致。')+'核对实物后，请点“确认调拨”。</p>';
      $("modal-root").dataset.nextSubmitCaption="确认调拨";return false;
    }
    try{return await write("/api/inventory/transfers",{...payload,confirmed:true,previewToken:prepared.previewToken});}
    catch(error){if(!error.uncertain){prepared=null;signature="";$("inventory-transfer-preview").textContent="请重新预览后确认调拨。";$("modal-root").dataset.nextSubmitCaption="预览调拨";}throw error;}
  },"选择目标仓后先预览，再确认调拨。商品名称保持一致；总数量和总成本不变。");
  const form=$("modal-form"),box=document.createElement("div");box.id="inventory-transfer-preview";box.className="notice";form.querySelector(".form-actions").before(box);
  for(const event of ["input","change"])form.addEventListener(event,()=>{if($("modal-root")?.dataset.uncertain==="1")return;prepared=null;signature="";box.textContent="";$("modal-root").dataset.nextSubmitCaption="预览调拨";form.querySelector('button[type="submit"]').textContent="预览调拨";});
  form.querySelector('button[type="submit"]').textContent="预览调拨";
}
function productWarehouseTransfer(id) {
  const editor=$("modal-root"),form=$("modal-form"),product=state.products.find(row=>row.skuId===id);
  if(!editor||form?.dataset.productSkuId!==id)throw new Error("请先打开需要调拨的商品。");
  if(editor.dataset.submitting==="1"||editor.dataset.uncertain==="1")throw new Error("本单结果待核对，请先按原内容重试核对。");
  if(!state.user?.capabilities.purchase||!state.user?.capabilities.stocktake)throw new Error("仓库调拨需要采购入库和库存盘点权限，请联系管理员。");
  const matches=state.inventory.filter(row=>row.skuId===id&&row.warehouseId===product?.warehouseId&&row.stockManaged!==false&&Number(row.quantity)>0);
  if(matches.length!==1)throw new Error("未找到唯一的原仓现货，请到库存查询核对后调拨。原编辑内容已保留。");
  const input={stockKey:matches[0].stockKey,targetWarehouseId:form.elements.warehouseId.value};
  editor.remove();
  try{inventoryTransferC(JSON.stringify(input));}catch(error){document.body.append(editor);throw error;}
  const transfer=$("modal-root"),cancel=transfer.querySelector('[data-action="close-modal"]');
  cancel.textContent="返回商品编辑";
  transfer.querySelector(".muted").textContent+=" 原编辑内容已保留，取消调拨可返回继续编辑。";
  transfer.addEventListener("click",event=>{
    const back=event.target.closest('[data-action="close-modal"]');
    if(!back&&event.target!==transfer)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(transfer.dataset.submitting==="1"||transfer.dataset.uncertain==="1"){toast("调拨正在提交或结果待核对，请按原内容重试后再返回。",true);return;}
    transfer.remove();document.body.append(editor);form.elements.warehouseId.focus({preventScroll:true});
  },true);
}
function mobileProductEditor(id) {
  const source=state.products.find((row)=>row.skuId===id);
  if(!source||source.stockManaged===false||source.warehouseId==="wh-c")throw new Error("请选择非C仓实物商品新建C仓同款。");
  const existing=state.products.find((row)=>row.warehouseId==="wh-c"&&row.mobileVariantOf===source.skuId);
  if(existing){toast("该型号C仓商品已有档案，正在打开现有商品。");productEditor(existing.skuId);return;}
  const values={};
  const form=$("modal-form");
  if(form?.dataset.productSkuId===id)for(const name of ["shortName","aliases","type","subType","thirdType","unit","salePrice"]){
    const value=form.elements[name]?.value;
    if(value!==undefined)values[name]=value==="__custom__"?String(form.elements[name+"Custom"]?.value||"").trim():value;
  }
  productEditor("",{sourceSkuId:id,...values,warehouseId:"wh-c"});
}

function productStatusEditor(id){
 const p=state.products.find(p=>p.skuId===id);if(!p)throw new Error('商品资料已变化，请刷新');const active=p.active===false;
 modal((active?'恢复商品：':'停用商品：')+p.name,[],(_,write)=>write('/api/products',{action:'setActive',skuId:p.skuId,active,expectedActive:p.active!==false,expectedName:p.name}),active?'恢复后可在商品查询、采购和开单中重新选用。':'停用后不再出现在常用商品列表和分类树。商品档案、期初流水及历史账目全部保留；可从“档案状态 → 已停用 · 可恢复”恢复。仍有库存或未收齐订货时会说明原因并阻止操作。');
 const submit=$('modal-form').querySelector('[type=submit]');submit.textContent=active?'确认恢复':'确认停用';
}

function productEditor(id,prefill={}) {
  if(id){
    const current=state.products.find(row=>row.skuId===id);
    if(!current)throw new Error('商品档案已变化，请刷新后重试');
    modal('修改商品名称 · '+(current.externalCode||''),[
      {name:'name',label:'商品名称',value:current.name,required:true}
    ],(data,write)=>write('/api/products',{skuId:id,name:String(data.name||'').trim()}),
    '已建档商品不可删除。编码、分类、单位和库存类型保持不变；调价、停用或恢复请使用独立流程。');
    return;
  }
  const mobileSource=!id&&prefill.sourceSkuId?state.products.find((row)=>row.skuId===prefill.sourceSkuId):null;
  if(prefill.sourceSkuId&&!mobileSource)throw new Error("原商品不存在，请刷新商品列表。");
  const original=state.products.find((row)=>row.skuId===id)||(mobileSource?{name:mobileSource.name,externalCode:mobileSource.externalCode,shortName:mobileSource.shortName,aliases:mobileSource.aliases,type:mobileSource.type,subType:mobileSource.subType,thirdType:mobileSource.thirdType,unit:mobileSource.unit,trackSerial:mobileSource.trackSerial,stockManaged:true,salePrice:mobileSource.salePrice,...prefill}:{name:String(prefill.name||"").trim().slice(0,200),type:prefill.type||"",subType:prefill.subType||"",thirdType:prefill.thirdType||"",warehouseId:prefill.warehouseId||""});
  if(mobileSource)original.aliases=typeof original.aliases==="string"?original.aliases.split(/[、,，]/).map((v)=>v.trim()).filter(Boolean):original.aliases;
  const category=(row)=>row.type==="智能手机"?"智能机":row.type==="二手机"?"二手手机":row.type==="其他数码"?"数码产品":/^(配件和维修|配件\s*[/／]\s*维修)$/.test(row.type||"")?(row.stockManaged===false?"维修":"配件"):row.type;
  const p={...original,type:category(original)};
  const names=(values)=>[...new Set(values.filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  const choices=(values,current,empty,label)=>[
    {value:"",label:empty},
    ...names([...values,current]).map((name)=>({value:name,label:name})),
    {value:"__custom__",label:"＋ 新增"+label}
  ];
  let categoryForm=null;
  const directory=()=>window.StoreCatalogDirectory.rows(state.productCategoryPaths||[],state.products);
  const types=window.StoreCatalogDirectory.children(directory(),[]);
  const subs=type=>window.StoreCatalogDirectory.children(directory(),[type]);
  const thirds=(type,subType)=>window.StoreCatalogDirectory.children(directory(),[type,subType]);
  const units=names(["件","台","个","套","张","米","次",...state.products.map((row)=>row.unit)]);
  const pick=(data,name)=>{
    if(data[name]!=="__custom__")return data[name]||"";
    const custom=String(data[name+"Custom"]||"").trim();
    if(!custom)throw new Error("请填写新增"+({type:"一级分类",subType:"二级分类",thirdType:"三级分类",unit:"计量单位"}[name]));
    return custom;
  };
  modal(id?"编辑商品":mobileSource?"新建C仓商品":"新增商品",[
    {name:"name",label:"商品名称",value:p.name,required:true},
    {name:"externalCode",label:"商品编码",value:p.externalCode,inlineHint:id?"已固定，修改商品名称不会改变编码。":"确认提交并通过校验后自动生成；保存结果会显示本件编码和下一个预计编码。"},
    {name:"shortName",label:"简称",value:p.shortName},
    {name:"aliases",label:"搜索别名（逗号分隔）",value:(p.aliases||[]).join("、"),hint:"例如：Mate 60、华为60。保存后可在查询和开单时搜索这些叫法。",wide:true},
    {name:"type",label:"一级分类（商品类别）",value:p.type,options:choices(types,p.type,"请选择商品类别","一级分类"),required:true,inlineHint:"这里选智能机、配件等商品类别；终端公司等往来单位在采购入库时选择。"},
    {name:"typeCustom",label:"新增一级分类"},
    {name:"subType",label:"二级分类",value:p.subType,options:choices(subs(p.type),p.subType,"不选二级分类","二级分类")},
    {name:"subTypeCustom",label:"新增二级分类"},
    {name:"thirdType",label:"三级分类（系列或品牌）",value:p.thirdType,options:choices(thirds(p.type,p.subType),p.thirdType,"不选三级分类","三级分类")},
    {name:"thirdTypeCustom",label:"新增三级分类"},
    {name:"unit",label:"计量单位",searchable:false,value:p.unit||(p.stockManaged===false?"次":"件"),options:choices(units,p.unit,"请选择计量单位","计量单位"),required:true,inlineHint:"手机选“台”，配件选“件/个”；没有合适的可选“＋ 新增计量单位”。"},
    {name:"unitCustom",label:"新增计量单位"},
    {name:"salePrice",label:"预设售价（可后补）",type:"number",min:0,step:"0.01",value:p.skuId&&!p.pricePending?p.salePrice??0:""},
    {name:"kind",label:"库存类型",value:p.stockManaged===false?"service":p.trackSerial?"serial":"quantity",options:[{value:"quantity",label:"数量库存"},{value:"serial",label:"串码库存"},{value:"service",label:"服务／其他收入（不计库存）"}]}
  ],(data,write)=>{
    if(data.type==="其他收入")data.kind="service";
    const normalized={...p,...data,type:pick(data,"type"),subType:pick(data,"subType"),thirdType:pick(data,"thirdType"),unit:pick(data,"unit"),kind:data.kind==="service"?"service":"physical",trackSerial:data.kind==="serial",salePrice:String(data.salePrice??"").trim()===""?null:Number(data.salePrice)};
    delete normalized.warehouseId;
    window.StoreCatalogDirectory.validate(directory(),[normalized.type,normalized.subType,normalized.thirdType]);
    for(const name of ["typeCustom","subTypeCustom","thirdTypeCustom","unitCustom"])delete normalized[name];
    return write("/api/products",normalized);
  },"商品档案填写名称、分类和单位；仓库在进货入库时选择。预设售价可后补。");
  const form=$("modal-form");categoryForm=form;
  form.dataset.productSkuId=id||"";form.elements.externalCode.readOnly=true;
  if(!id)form.elements.externalCode.placeholder="提交成功后自动生成";
  if(mobileSource){form.elements.name.readOnly=true;form.elements.externalCode.readOnly=true;form.elements.kind.disabled=true;}
  const syncCustom=(name)=>{
    const custom=form.elements[name+"Custom"];
    const show=form.elements[name].value==="__custom__";
    custom.closest(".field").hidden=!show;
    custom.required=show;
    if(!show)custom.value="";
  };
  const fill=(name,values,current,empty,label)=>{
    const select=form.elements[name];
    select.innerHTML=choices(values,current,empty,label).map((item)=>option(item.value,item.label,item.value===current)).join("");
    select.value=current||"";
    originalSelectOptions.delete(select);
    syncCustom(name);
  };
  const syncService=()=>{const income=form.elements.type.value==="其他收入";if(income)form.elements.kind.value="service";form.elements.kind.disabled=income;};
  form.elements.kind.addEventListener("change",syncService);
  form.elements.type.addEventListener("change",syncService);
  syncService();
  for(const name of ["type","subType","thirdType","unit"]) {
    syncCustom(name);
    exposeNewChoice(form,name,"__custom__",name+"Custom");
    form.elements[name].addEventListener("change",()=>{
      syncCustom(name);
      if(name==="type"){
        const type=form.elements.type.value;
        fill("subType",subs(type),"","不选二级分类","二级分类");
        fill("thirdType",[],"","不选三级分类","三级分类");
      }else if(name==="subType"){
        fill("thirdType",thirds(form.elements.type.value,form.elements.subType.value),"","不选三级分类","三级分类");
      }
    });
  }
  if(id){const price=form.elements.salePrice;price.readOnly=true;price.title="已建档商品请使用调价单修改零售价";price.style.background="#f2f5fa";}
}
let saleCopilotTimer = 0;
let saleCopilotVersion = 0;
function refreshSaleCopilot(delay = 180) {
  clearTimeout(saleCopilotTimer);
  const panel = $("sale-copilot");
  const form = $("sale-checkout");
  if (!panel || !form) return;
  const version = ++saleCopilotVersion;
  panel.querySelector(".copilot-result").textContent = "正在核对本单…";
  saleCopilotTimer = setTimeout(async () => {
    if (version !== saleCopilotVersion || !$("sale-copilot")) return;
    const draft = {
      items: state.salesCart.map(({name,...item}) => item),
      account: form.elements.account.value,
      saleMode: form.elements.saleMode.value,
      receptionId: form.elements.receptionId.value,
      platformOrderNo: form.elements.platformOrderNo.value,
      subsidyAmount: Number(form.elements.subsidyAmount.value || 0)
    };
    try {
      const result = await api("/api/copilot/sales-review", {method:"POST",body:JSON.stringify(draft)});
      if (version !== saleCopilotVersion || !$("sale-copilot")) return;
      const title = result.ready ? "本单预检通过" : "开单前请处理以下事项";
      const summary = "应收 " + M(result.total) + (draft.saleMode === "guobu" ? " · 顾客实付 " + M(result.customerDue) : "");
      const rows = result.findings.map((item) => '<li class="copilot-' + E(item.level) + '">' + E(item.message) + '</li>').join("");
      panel.querySelector(".copilot-result").innerHTML = '<strong>' + E(title) + '</strong><span>' + E(summary) + '</span>' + (rows ? '<ul>' + rows + '</ul>' : '<p>未发现当前规则覆盖的缺项。</p>') + '<small>' + E(result.note) + '</small>';
    } catch (error) {
      if (version === saleCopilotVersion && $("sale-copilot")) panel.querySelector(".copilot-result").textContent = "副驾暂时无法核对：" + error.message;
    }
  }, delay);
}
let saleSerialsLoading;
async function ensureSaleSerials(){
 if(state.saleSerialsReady)return;
 const version=officeBasicsVersion,userId=state.user?.id;
 if(!saleSerialsLoading||saleSerialsLoading.version!==version){
  const pending={version};pending.promise=api('/api/sale-opening?part=serials').then(data=>{
   if(version!==officeBasicsVersion||state.user?.id!==userId||state.tab!=='sales')return;
   const rows=new Map(data.rows.map(row=>[saleStockKey(row),row]));
   for(const stock of state.inventory){const row=rows.get(saleStockKey(stock));if(row){stock.quantity=row.quantity;stock.serials=row.serials;}else if(stock.trackSerial){stock.serials=[];}}
   state.saleSerialsReady=true;
  }).finally(()=>{if(saleSerialsLoading===pending)saleSerialsLoading=null;});saleSerialsLoading=pending;
 }
 await saleSerialsLoading.promise;
 if(!state.saleSerialsReady)throw new Error('商品资料已变化，请重新打开商品选择');
}
async function loadSaleReception(id){
 if(!id)return;const version=officeBasicsVersion,userId=state.user?.id;
 const data=await api('/api/sale-opening?part=reception&id='+encodeURIComponent(id));
 if(version!==officeBasicsVersion||state.user?.id!==userId||state.tab!=='sales')return;
 const index=state.receptions.findIndex(row=>row.id===id);if(index>=0)state.receptions[index]=data.row;else state.receptions.push(data.row);
}
let salePaymentAssetsLoading;
async function ensureSalePaymentSplits(){
 if(!window.PaymentSplits){if(!salePaymentAssetsLoading)salePaymentAssetsLoading=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="/payment-splits.js?v=20261018-v125";script.onload=()=>window.PaymentSplits?resolve():reject(new Error("分笔收款组件未加载，请刷新"));script.onerror=()=>{salePaymentAssetsLoading=null;script.remove();reject(new Error("分笔收款组件读取失败，请刷新后再开单"));};document.head.append(script);});await salePaymentAssetsLoading;}
 await window.PaymentSplits.ready();if(!state.salePaymentAccounts)state.salePaymentAccounts=await api("/api/payment-accounts");
}
function saleAmountCents(value){const text=String(value??"").trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error("售价与金额最多填写两位小数");const [whole,fraction=""]=text.split("."),cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));if(!Number.isSafeInteger(cents))throw new Error("金额超出范围");return cents;}
function saleCartTotalCents(){return state.salesCart.reduce((sum,item)=>{const cents=saleAmountCents(item.salePrice),quantity=Number(item.quantity);if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(sum+cents*quantity))throw new Error("请核对商品数量和金额");return sum+cents*quantity;},0);}
function saleStockKey(p){return JSON.stringify([p.skuId,p.warehouseId||'']);}
function saleCartWarehouse(item){return item.warehouseId||state.products.find(p=>p.skuId===item.skuId)?.warehouseId||'';}
function openSaleStock(raw){let pair;try{pair=JSON.parse(raw);}catch{}if(Array.isArray(pair)&&pair.length===3)return saleItemEditor(-1,pair[0],pair[2],undefined,pair[1],true);if(Array.isArray(pair)&&pair.length===2)return saleItemEditor(-1,pair[0],'',undefined,pair[1]);return saleItemEditor(-1,raw||'');}
function saleBarcodeHtml(item){const p=state.products.find(p=>p.skuId===item.skuId)||state.inventory.find(p=>p.skuId===item.skuId)||{},saved=Object.prototype.hasOwnProperty.call(item,'sourceBarcode'),code=String(saved?item.sourceBarcode:item.barcode||p.sourceBarcode||p.barcode||'');if(!code)return '';const shared=new Set(state.inventory.filter(p=>String(p.sourceBarcode||p.barcode||'')===code).map(p=>p.skuId)).size>1;return '<small class="sale-original-barcode">'+(code.startsWith('69')?'原厂69码':'原厂条码')+'：<code>'+E(code)+'</code>'+(!saved?'（原单未留码，现档案参考）':'')+(shared?' · 共享码，核对本行型号/仓库':'')+'</small>';}
function renderSales() {
  window.SaleCapture?.stop();
  let assistantDraft = null;
  try { const raw = sessionStorage.getItem("assistant-sale-draft"); if (raw) { sessionStorage.removeItem("assistant-sale-draft"); const draft = JSON.parse(raw); if (Date.now() - draft.createdAt < 600000 && state.products.some((p) => p.skuId === draft.skuId)) assistantDraft = draft; } } catch {}
  const rows = state.salesCart.map((item,i) => {
    const product = state.inventory.find((entry) => entry.skuId === item.skuId && (!item.warehouseId||entry.warehouseId===item.warehouseId)) || {};
    return `<tr><td data-label="序号">${i+1}</td><td data-label="商品编号">${E(product.externalCode || item.skuId)}</td><td data-label="商品名称"><strong>${E(item.name)}</strong>${saleBarcodeHtml(item)}<small>${E(product.warehouseName||"服务项目")}${item.supplier?' · 供货商 '+E(item.supplier):''}</small>${item.materials?.length?`<small>耗材 ${item.materials.length} 项</small>`:""}</td><td data-label="规格/系列">${E([product.subType,product.thirdType].filter(Boolean).join(" / ") || "—")}</td><td data-label="单位">${E(product.unit || "件")}</td><td data-label="数量">${E(item.quantity)}</td><td data-label="串码">${E(item.serialNo || "—")}</td><td data-label="单价">${M(item.salePrice)}</td><td data-label="金额">${M(item.quantity * item.salePrice)}</td><td data-label="操作"><div class="actions">${button("修改", "edit-cart", i)}${button("移除", "remove-cart", i,"danger")}</div></td></tr>`;
  });
  const payable=state.salesCart.reduce((n,i)=>n+i.quantity*i.salePrice,0);
  const listed=state.salesCart.reduce((n,i)=>n+i.quantity*Number(state.products.find((p)=>p.skuId===i.skuId)?.salePrice||i.salePrice),0);
  const discount=Math.max(0,Math.round((listed-payable)*100)/100);
  if (assistantDraft) state.saleDraft={...(state.saleDraft||{}),customerName:assistantDraft.customerName||"",customerPhone:assistantDraft.customerPhone||"",account:assistantDraft.account||"",orderNote:assistantDraft.giftRequested?"助理提示拟送赠品："+assistantDraft.giftRequested+"；请在赠品栏选择实物并核对限制。":""};
  const draft=state.saleDraft||{};
  state.salePaymentController?.destroy();state.salePaymentController=null;
  state.giftCart ||= [];
  $("main").innerHTML = heading("销售开单", "先核对出库仓库、供货商与数量，再核对售价和收款；顾客与单据资料可按需展开补充，单号在提交后生成。").replace('class="heading"','class="heading sale-page-heading"') +
    `<section class="card sale-sheet"><form id="sale-checkout">
      <div class="sale-opening-staff">开单：<strong>${E(state.user.name)}</strong></div>
      <div class="sale-sheet-items" id="sale-step-items"><div class="sale-step"><span class="sale-step-number">1</span><div><h2>商品与串号</h2><p data-page-explanation>搜索或扫码加入商品。串号可扫码、手输或下拉选择；手机逐台加入，配件填写数量。</p></div></div><div class="sale-picker-tabs" role="tablist" aria-label="选择商品方式"><button type="button" id="sale-picker-serial" role="tab" aria-selected="true">扫串号</button><button type="button" id="sale-picker-product" role="tab" aria-selected="false">选商品</button></div><div class="sale-picker-entry"><label for="sale-search">扫描 / 输入串号</label><input id="sale-search" class="search" type="search" autocomplete="off" placeholder="输入商品、编号或串号后4位"><div class="sale-lookup-actions"><button type="button" id="sale-camera-button" class="secondary">扫码</button><button type="button" id="sale-photo-button" class="secondary">拍照</button><input id="sale-photo-input" type="file" accept="image/*" capture="environment" hidden></div><video id="sale-camera-preview" playsinline muted hidden></video><p id="sale-scan-status" class="muted" role="status"></p><p id="sale-item-feedback" class="field-feedback" role="status"></p></div><div id="sale-results" class="sale-results"></div><div class="sale-dropdowns" hidden><label>按商品大类筛选<select id="sale-category"><option value="">全部分类</option></select></label><label>下拉选择商品<select id="sale-product-select"><option value="">请选择商品</option></select></label></div>${!state.inventory.some(r=>Number(r.quantity)>0)?'<p class="operation-tip" role="status">当前实物库存为0。商品档案不等于现货；请先在订货与入库登记实际数量和手机串号。维修等服务项目可直接开单。</p>':""}<div class="sale-sheet-section-title"><button type="button" class="primary" data-action="add-sale-item">添加商品</button></div>${rows.length ? table(["序号","商品编号","商品名称","规格/系列","单位","数量","串码","单价","金额","操作"],rows) : '<p class="empty">还没有加入商品</p>'}</div>
<div class="sale-step-next"><button type="button" class="secondary" data-sale-next="sale-step-payment">下一步：售价与收款 ↓</button></div><details class="sale-customer-block" id="sale-step-customer"><summary>顾客与单据资料（选填）</summary><p data-page-explanation>顾客资料可以先留空，有空再补；有接待记录就关联。</p>
      <div class="sale-sheet-header fields">${formField({name:"customerName",label:"客户名称",value:draft.customerName,placeholder:"顾客称呼；可留空"})}${formField({name:"customerPhone",label:"顾客手机号",type:"tel",value:draft.customerPhone,placeholder:"用于售后追踪；不提供可留空"})}${formField({name:"receptionId",label:"关联接待单",value:draft.receptionId,options:[{value:"",label:"本次没有接待单"},...state.receptions.filter((r)=>r.status!=="已结案"&&!r.publicAssist).map((r)=>({value:r.id,label:`${r.customerMask} · ${r.purpose} · ${documentNo(r)}`}))]})}<div id="sale-reception-supplement" class="field" hidden></div><div class="field"><label>开单员工（登录账号自动记录）</label><div class="sale-fixed-value">${E(state.user.name)}</div></div>${formField({name:"invoiceType",label:"开票需求",value:draft.invoiceType||"未提出",options:[{value:"未提出",label:"未提出"},{value:"电子发票",label:"需要电子发票"},{value:"纸质发票",label:"需要纸质发票"}]})}${formField({name:"invoiceNo",label:"发票号码（选填，未开票可留空）",value:draft.invoiceNo})}${formField({name:"orderNote",label:"整单备注",type:"textarea",wide:true,value:draft.orderNote,placeholder:"可记录顾客要求、交付或售后说明"})}</div>
            
</details>
      <div class="sale-sheet-settlement" id="sale-step-payment"><div class="sale-step"><span class="sale-step-number">3</span><div><h2>金额与收款</h2><p data-page-explanation>先看应收金额，再选择顾客的付款方式。</p></div></div><div class="sale-sheet-summary"><span>参考零售价合计 <strong>${M(listed)}</strong></span><span>优惠金额 <strong>${M(discount)}</strong></span><span>成交应收 <strong>${M(payable)}</strong></span></div><div class="fields">${formField({name:"saleMode",label:"销售通道",value:draft.saleMode||"ordinary",options:[{value:"ordinary",label:"普通销售"},{value:"guobu",label:"国补销售（单件单独开单）"}]})}<div id="sale-legacy-payment" hidden>${formField({...accountField,value:draft.account||""})}${formField({name:"accountOwnerId",label:"实际收款账户持有人（可暂不确定）",value:draft.accountOwnerId,options:[{value:"",label:"暂不确定"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.financeReceive).map((u)=>({value:u.id,label:u.name}))]})}</div></div><section id="sale-payment-splits" class="wide" aria-label="按账户分笔收款"></section><p id="sale-payment-mode-error" class="payment-selection-alert" role="alert" hidden></p><p><a href="/payment-accounts">收付款账户设置</a> · 可一单分收微信、和包商户等，每笔由实际持有人核对。</p><label class="cash-drawer-check"><input name="cashDrawerConfirmed" type="checkbox" value="yes"${draft.cashDrawerConfirmed?" checked":""}> 我已收到顾客现金；稍后由我确认放入门店现金。</label><p class="sale-sheet-paid" data-page-explanation>现金由营业员确认收到，再确认放入门店现金。非现金由实际收款账户持有人核对到账。转交老板用内部交接单。</p><div id="gov-fields" class="field wide" hidden><p class="muted" data-page-explanation>以国补平台已核销金额为准；顾客仅支付成交价减补贴。国补商品须单件开单。</p><div class="fields">${formField({name:"platformOrderNo",label:"国补平台交易号",value:draft.platformOrderNo})}${formField({name:"subsidyAmount",label:"平台核销补贴金额（元）",type:"number",min:0,step:"0.01",value:draft.subsidyAmount})}${formField({name:"couponNo",label:"资格券编号（如有）",value:draft.couponNo})}</div><p id="gov-preview"></p></div></div>
      ${window.Gifts.saleSection()}<div class="sale-step" id="sale-step-confirm"><span class="sale-step-number">5</span><div><h2>核对提交</h2><p data-page-explanation>确认顾客、商品、成交价与收款信息无误后提交。提交后库存和流水同步更新。</p></div></div><div id="sale-review" class="sale-review" aria-live="polite"></div><details class="clean-document-info"><summary>单据资料</summary><div class="sale-sheet-title"><span>开单日期：${E(new Date().toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"}))}</span><span>销售单号：提交后生成</span></div></details><p id="sale-submit-feedback" class="submit-feedback" role="alert" hidden></p><button class="primary sale-submit" type="submit"${rows.length ? "" : " disabled"}>保存销售单并提交收款核对</button></form></section>` +
    `<section id="sale-copilot" class="card copilot-card" aria-label="数字副驾"><div class="copilot-head"><div><h2>数字副驾 · 开单预检</h2><p class="muted" data-page-explanation>自动检查库存、串码、售价和国补缺项；由你确认后开单。</p></div><button id="copilot-refresh" class="secondary" type="button">重新检查</button></div><div class="copilot-result" aria-live="polite">正在核对本单…</div></section><details class="sale-related"><summary>历史与收款核对</summary><div class="actions">${button("历史单", "view-orders")}<a class="secondary" href="/sale-payments">收款核对</a></div></details>`;  const pickerMode=mode=>{
    state.salePickerMode=mode;
    $('sale-picker-serial').setAttribute('aria-selected',String(mode==='serial'));
    $('sale-picker-product').setAttribute('aria-selected',String(mode==='product'));
    document.querySelector('.sale-dropdowns').hidden=mode!=='product';
    $('sale-search').placeholder=mode==='serial'?'完整69码、串号或后4位':'名称、JY编号或原厂条码';
    document.querySelector('label[for="sale-search"]').textContent=mode==='serial'?'扫描 / 输入条码或串号':'查找商品';
  };
  pickerMode(state.salePickerMode||'serial');
  $('sale-picker-serial').onclick=()=>pickerMode('serial');
  $('sale-picker-product').onclick=()=>pickerMode('product');
  $("sale-search").addEventListener("input",async(event)=>{
    const input=event.target,value=input.value;if(!value.trim()){$('sale-results').innerHTML='';return;}
    try{await ensureSaleSerials();}catch(error){showError(error);return;}if(!input.isConnected||input.value!==value)return;
    const exact=window.SaleCodeResolver?.resolve(state.inventory,state.salesCart,event.target.value,{warehouses:state.warehouses});if(exact?.candidates.length&&!/^\d{4}$/.test(event.target.value.trim())){scanSaleCode(event.target.value,false);return;}
    const terms=event.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if(!terms.length){$("sale-results").innerHTML="";return;}
    const remaining=(p)=>{
      if(p.stockManaged===false)return Infinity;
      const stockLeft=Number(p.quantity||0)-state.salesCart.filter((item)=>item.skuId===p.skuId&&saleCartWarehouse(item)===(p.warehouseId||"")).reduce((n,item)=>n+item.quantity,0);
      if(!p.trackSerial)return stockLeft;
      return Math.min(stockLeft,(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item)=>item.serialNo===s.no)).length);
    };
    const matches=state.inventory.filter((p)=>p.active!==false&&(p.stockManaged===false||Boolean(p.warehouseId))&&remaining(p)>0).filter((p)=>{
      const haystack=[p.name,p.shortName,p.externalCode,p.barcode,p.sourceBarcode,...(p.legacyExternalCodes||[]),p.type,p.subType,p.thirdType,...(p.aliases||[]),...(p.serials||[]).map((s)=>s.no)].join(" ").toLowerCase();
      return terms.every((term)=>{const group=state.searchSynonyms.find((row)=>row.terms.some((word)=>word.toLowerCase()===term));return (group?group.terms:[term]).some((word)=>haystack.includes(word.toLowerCase()));});
    }).slice(0,12);
    const choices=matches.flatMap((p)=>p.trackSerial?(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item)=>item.serialNo===s.no)).map((s)=>({p,serialNo:s.no})):[{p,serialNo:""}]).slice(0,18);
    $("sale-results").innerHTML=choices.length?choices.map(({p,serialNo})=>`<button type="button" data-action="add-sale-item" data-value="${E(serialNo?JSON.stringify([p.skuId,p.warehouseId||"",serialNo]):saleStockKey(p))}"><strong>${E(p.name)}</strong>${saleBarcodeHtml(p)}<span>${E(p.warehouseName||"服务项目")} · ${serialNo?`串号 ${E(serialNo)}`:E(p.externalCode||"")} · ${M(p.salePrice)}</span></button>`).join(""):'<p class="muted">没有匹配的在库商品</p>';
  });
  const selectableProducts=state.inventory.filter((p)=>p.active!==false&&(p.stockManaged===false||Boolean(p.warehouseId)));
  const availableForSale=(p)=>{
    if(p.stockManaged===false)return true;
    const committed=state.salesCart.filter((item)=>item.skuId===p.skuId&&saleCartWarehouse(item)===(p.warehouseId||"")).reduce((sum,item)=>sum+item.quantity,0);
    if(Number(p.quantity||0)<=committed)return false;
    return !p.trackSerial||!state.saleSerialsReady||(p.serials||[]).some((serial)=>["可售","未激活"].includes(serial.status)&&!state.salesCart.some((item)=>item.serialNo===serial.no));
  };
  const categorySelect=$("sale-category"),productSelect=$("sale-product-select");
  const categories=[...new Set(selectableProducts.filter(availableForSale).map((p)=>p.type||"未分类"))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  categorySelect.innerHTML='<option value="">全部分类</option>'+categories.map((name)=>option(name,name)).join("");
  const refreshProductSelect=()=>{
    const category=categorySelect.value;
    const visible=selectableProducts.filter((p)=>availableForSale(p)&&(!category||(p.type||"未分类")===category)).sort((a,b)=>a.name.localeCompare(b.name,"zh-CN"));
    productSelect.innerHTML='<option value="">请选择商品或具体串号</option>'+visible.flatMap((p)=>p.trackSerial&&state.saleSerialsReady?(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item)=>item.serialNo===s.no)).map((s)=>option(JSON.stringify([p.skuId,p.warehouseId||"",s.no]),p.name+" · "+(p.warehouseName||"销售仓")+" · 串号 "+s.no)):[option(saleStockKey(p),p.name+" · "+(p.warehouseName||"服务项目")+" · "+(p.externalCode||p.skuId)+" · "+M(p.salePrice))]).join("");
  };
  categorySelect.addEventListener("change",refreshProductSelect);
  productSelect.addEventListener("change",()=>{const skuId=productSelect.value;productSelect.value="";if(skuId)openSaleStock(skuId);});
  refreshProductSelect();
  const scanSaleCode=async(raw,autoPick=true)=>{try{await ensureSaleSerials();}catch(error){showError(error);return;}if(!$('sale-search'))return;if(!window.SaleCodeResolver)return toast('扫码选品组件未加载，请刷新后再扫',true);const result=window.SaleCodeResolver.resolve(state.inventory,state.salesCart,raw,{warehouses:state.warehouses});return window.SaleCodeResolver.present(result,{host:$('sale-results'),autoPick,onPick:p=>saleItemEditor(-1,p.skuId,p.serialNo,undefined,p.warehouseId),onMessage:(message,error)=>{$('sale-scan-status').textContent=message;$('sale-scan-status').classList.toggle('error',!!error);}});};
  $('sale-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(/^\d{4}$/.test(event.currentTarget.value.trim())){event.currentTarget.dispatchEvent(new Event('input'));$('sale-scan-status').textContent='后4位请核对候选商品与完整串号，再点选；未自动加入。';return;}scanSaleCode(event.currentTarget.value);}});
  window.SaleCapture?.mount(raw=>scanSaleCode(raw));  const checkoutForm=$("sale-checkout");const saleFeedback=window.SaleFeedback.attach(checkoutForm,()=>state.salesCart,()=>state.receptions);const syncGov=()=>{const active=checkoutForm.elements.saleMode.value==="guobu";$("gov-fields").hidden=!active;checkoutForm.elements.account.disabled=active;if(active){checkoutForm.elements.account.value="云闪付";const gross=state.salesCart.length===1?state.salesCart[0].salePrice*state.salesCart[0].quantity:0;const amount=Number(checkoutForm.elements.subsidyAmount.value)||Math.min(Math.round(gross*0.15*100)/100,500);if(!checkoutForm.elements.subsidyAmount.value)checkoutForm.elements.subsidyAmount.value=amount.toFixed(2);$("gov-preview").textContent=`成交价 ${M(gross)} · 国补 ${M(amount)} · 顾客实付 ${M(gross-amount)}`;}};checkoutForm.elements.saleMode.addEventListener("change",()=>{syncGov();saleFeedback.check();});checkoutForm.elements.subsidyAmount.addEventListener("input",()=>{syncGov();saleFeedback.check();});syncGov();saleFeedback.check();
  const customerPayCents=()=>{const gross=saleCartTotalCents();return checkoutForm.elements.saleMode.value==="guobu"?(/^\d+(?:\.\d{1,2})?$/.test(checkoutForm.elements.subsidyAmount.value||"0")?Math.max(0,gross-saleAmountCents(checkoutForm.elements.subsidyAmount.value||0)):0):gross;};
  let paymentChanged=()=>{};
  const paymentController=window.PaymentSplits.mount({container:$("sale-payment-splits"),accounts:state.salePaymentAccounts,totalCents:customerPayCents,legacy:{account:draft.account||"",accountOwnerId:draft.accountOwnerId||"",cashDrawerConfirmed:!!draft.cashDrawerConfirmed},initialParts:draft.payments,people:state.users.filter(user=>user.status==="active"&&user.capabilities?.financeReceive),mode:"sale",requireReference:false,onChange:()=>paymentChanged()});state.salePaymentController=paymentController;
  const salePaymentParts=()=>paymentController.getParts();
  const salePaymentCheck=()=>{const check=paymentController.validate();return check.ok&&checkoutForm.elements.saleMode.value==='guobu'&&check.parts.some(p=>p.account!=='云闪付')?{...check,ok:false,error:'国补顾客实付请明确选择云闪付收款账户'}:check;};
  const syncPaymentSubmit=()=>{const check=salePaymentCheck(),button=checkoutForm.querySelector('button[type="submit"]'),box=$('sale-payment-mode-error');button.disabled=!state.salesCart.length||!check.ok||state.saleSubmitting||!!checkoutForm.dataset.savedId;box.hidden=check.ok||checkoutForm.elements.saleMode.value!=='guobu'||check.parts.some(p=>!p.account);box.textContent=box.hidden?'':check.error;};
  const saveSaleDraft=()=>{state.saleDraft={...Object.fromEntries(new FormData(checkoutForm)),payments:salePaymentParts()};if(checkoutForm.elements.saleMode.value==="guobu")state.saleDraft.account="云闪付";};
  const syncReceptionSupplement=()=>{const id=checkoutForm.elements.receptionId.value,node=$("sale-reception-supplement");node.hidden=!id;node.innerHTML=id?`<a href="/receptions?highlight=${encodeURIComponent(id)}" target="_blank" rel="noopener">补充原接待资料 ↗</a><small data-page-explanation>忙时先开单，需求、预算和顾客描述有空再补。</small>`:"";};
  syncReceptionSupplement();checkoutForm.elements.receptionId.addEventListener("change",syncReceptionSupplement);
  const updateSaleReview=()=>{
    const customer=checkoutForm.elements.customerName.value.trim()||"散客";
    const phone=checkoutForm.elements.customerPhone.value.trim();
    const account=checkoutForm.elements.saleMode.value==="guobu"?"云闪付":checkoutForm.elements.account.value;
    const reception=checkoutForm.elements.receptionId.value;
    const itemSummary=state.salesCart.map((item)=>item.name+' × '+item.quantity+(item.serialNo?' · 串码 '+item.serialNo:'')).join('；')||'尚未添加';
    const paymentParts=salePaymentParts(),accountRows=state.salePaymentAccounts.rows||state.salePaymentAccounts;
    const paymentSummary=paymentParts.map((part,index)=>{const named=accountRows.find((row)=>row.id===part.paymentAccountId),holder=named?.ownerName||state.users.find((u)=>u.id===part.accountOwnerId)?.name||"待指定实际收款人";return "第"+(index+1)+"笔："+part.account+" · "+(named?.name||"未配置具体账户")+" · "+M(part.amount)+" · "+(part.account==="现金"?(part.cashDrawerConfirmed?"营业员已收，待交门店现金":"待营业员确认收现金"):holder+"确认到账");}).join("；")||"无顾客应收款";
    const giftSummary=state.giftCart.length?state.giftCart.map((item)=>item.name+" × "+item.quantity).join("、"):"无赠品";
    $("sale-review").innerHTML='<strong>提交前请确认</strong><span>顾客：'+E(customer)+(phone?' · '+E(phone):' · 未留手机号')+'</span><span>开单员工：'+E(state.user.name)+'</span><span>接待单：'+E(reception||'未关联')+'</span><span>商品：'+E(itemSummary)+'</span><span>赠品：'+E(giftSummary)+'</span><span>顾客应收：'+M(customerPayCents()/100)+'</span><span>分笔收款：'+E(paymentSummary)+'</span><span>每笔按实际到账核对；开单不等于已收到款。</span>';
  };
  checkoutForm.elements.receptionId.addEventListener("change",async()=>{
    const selected=checkoutForm.elements.receptionId.value;
    try{await loadSaleReception(selected);}catch(error){showError(error);return;}
    if(!checkoutForm.isConnected||checkoutForm.elements.receptionId.value!==selected)return;
    const reception=state.receptions.find((row)=>row.id===checkoutForm.elements.receptionId.value);
    if(reception&&!reception.publicAssist){
      checkoutForm.elements.customerName.value=reception.customerName||checkoutForm.elements.customerName.value;
      checkoutForm.elements.customerPhone.value=reception.customerPhone||checkoutForm.elements.customerPhone.value;
    }
    saveSaleDraft();updateSaleReview();
  });
  checkoutForm.addEventListener("input",()=>{saveSaleDraft();updateSaleReview();syncPaymentSubmit();});
  checkoutForm.addEventListener("change",()=>{saveSaleDraft();updateSaleReview();syncPaymentSubmit();});
  paymentChanged=()=>{const first=paymentController.getParts()[0];if(first){checkoutForm.elements.account.value=first.account||"";checkoutForm.elements.accountOwnerId.value=first.accountOwnerId||"";}saveSaleDraft();updateSaleReview();syncPaymentSubmit();};
  paymentChanged();
  if (assistantDraft) { if (assistantDraft.account) checkoutForm.elements.account.value = assistantDraft.account; setTimeout(() => saleItemEditor(-1, assistantDraft.skuId, assistantDraft.serialNo||"", assistantDraft.salePrice), 0); }
  checkoutForm.querySelectorAll("[data-sale-next]").forEach((step)=>step.addEventListener("click",()=>$(step.dataset.saleNext)?.scrollIntoView({behavior:"smooth",block:"start"})));
  checkoutForm.addEventListener("input",()=>refreshSaleCopilot());checkoutForm.addEventListener("change",()=>refreshSaleCopilot());$("copilot-refresh").addEventListener("click",()=>refreshSaleCopilot(0));refreshSaleCopilot(0);
  const syncPaymentChoice=()=>{const guobu=checkoutForm.elements.saleMode.value==="guobu";$("sale-payment-splits").hidden=false;$("sale-legacy-payment").hidden=true;checkoutForm.querySelector(".cash-drawer-check").hidden=true;checkoutForm.elements.accountOwnerId.closest(".field").hidden=true;paymentController.refresh();updateSaleReview();};checkoutForm.elements.account.addEventListener("change",syncPaymentChoice);checkoutForm.elements.saleMode.addEventListener("change",syncPaymentChoice);syncPaymentChoice();
  checkoutForm.addEventListener("submit",async(event)=>{
    event.preventDefault(); const form=event.currentTarget, button=form.querySelector("button[type=submit]");
    if(form.dataset.savedId){toast("本单已保存，单号 "+(form.dataset.savedNo||form.dataset.savedId)+"；无需重新提交。");return;}
    if(state.saleSubmitting||button.disabled)return;
    if(!saleFeedback.check(true)){saleFeedback.showFailure("尚未提交，请修改标红的内容后再提交。");return;}
    const d=Object.fromEntries(new FormData(form)),payload={accountOwnerId:d.accountOwnerId,cashDrawerConfirmed:d.account==="现金"&&form.elements.cashDrawerConfirmed.checked,salespersonId:state.user.id,customerName:d.customerName,customerPhone:d.customerPhone,invoiceType:d.invoiceType,orderNote:d.orderNote,receptionId:d.receptionId||undefined,account:d.saleMode==="guobu"?"云闪付":d.account,saleMode:d.saleMode,platformOrderNo:d.platformOrderNo,subsidyAmount:Number(d.subsidyAmount||0),couponNo:d.couponNo,invoiceNo:d.invoiceNo,items:state.salesCart.map(({name,...item})=>item),gifts:state.giftCart.map(({name,...item})=>item),giftReason:d.giftReason};
    let paymentCheck;try{if(d.saleMode==="guobu")saleAmountCents(d.subsidyAmount||0);paymentCheck=salePaymentCheck();}catch(error){saleFeedback.showFailure(error.message);return;}if(!paymentCheck.ok){saleFeedback.showFailure(paymentCheck.error);return;}payload.payments=paymentCheck.parts;
    const attempt=state.saleAttempt||(state.saleAttempt={});
    const controls=[...form.querySelectorAll("input,select,textarea,button")].map(el=>[el,el.disabled]),caption=button.textContent;
    saleFeedback.clearFailure();state.saleSubmitting=true;controls.forEach(([el])=>el.disabled=true);button.disabled=true;button.textContent="正在提交…";
    let sale;
    try{sale=await post("/api/sale-orders",payload,attempt);}
    catch(error){saleFeedback.showFailure(error.message);if(error.uncertain){const box=$("sale-submit-feedback");if(box)box.textContent="提交结果待核对："+error.message;}return;}
    finally{state.saleSubmitting=false;controls.forEach(([el,disabled])=>el.disabled=disabled);button.textContent=caption;button.disabled=Boolean(sale);if(!sale)syncPaymentSubmit();}
    form.dataset.savedId=sale.id||"已保存";form.dataset.savedNo=documentNo(sale);state.saleAttempt=null;state.salesCart=[];state.giftCart=[];state.saleDraft=null;window.StoreWorkContinuity?.complete(state.saleContinuityName||'office-sale');
    try{window.speakSubmitSuccess?.();}catch{}
    try{await loadBasics();await go("orders");}catch{toast("销售单已保存，单号 "+documentNo(sale)+"；列表刷新失败，请稍后刷新，无需重新提交。",true);}
    try{window.SaleFeedback.showSuccess(sale,()=>go("sales"));}catch{toast("销售单已保存，单号 "+documentNo(sale)+"；无需重新提交。");}
  });
}
async function saleItemEditor(index=-1,selectedSkuId="",selectedSerialNo="",suggestedPrice,selectedWarehouseId="",manualSerial=false) {
  try{await ensureSaleSerials();}catch(error){showError(error);return;}
  const editing=index>=0?state.salesCart[index]:null;
  const needsManualSuffix=index<0&&(manualSerial||!selectedSerialNo);
  const reserved=(skuId,warehouseId)=>state.salesCart.filter((item,i)=>i!==index&&item.skuId===skuId&&saleCartWarehouse(item)===(warehouseId||"")).reduce((sum,item)=>sum+item.quantity,0);
  const products=state.inventory.filter((p)=>p.active!==false&&(p.stockManaged===false||Boolean(p.warehouseId)));
  const available=(p)=>{
    if(p.stockManaged===false)return Infinity;
    const stockLeft=Number(p.quantity||0)-reserved(p.skuId,p.warehouseId);
    if(!p.trackSerial)return stockLeft;
    const serialLeft=(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item,i)=>i!==index&&item.serialNo===s.no)).length;
    return Math.min(stockLeft,serialLeft);
  };
  const directSerial=!!selectedSkuId&&!!selectedSerialNo;
  const stockOptions=products.filter((p)=>available(p)>0&&(!directSerial||(p.skuId===selectedSkuId&&(!selectedWarehouseId||p.warehouseId===selectedWarehouseId)))).map((p)=>({value:saleStockKey(p),label:`${p.name} · ${p.warehouseName||"服务项目"} · ${p.stockManaged===false?"服务":`可加入 ${available(p)}`}`}));
  const options=[{value:"",label:"请选择商品"},...stockOptions];
  if (!stockOptions.length) return toast("没有可售商品",true);
  if(selectedSkuId&&!products.some(p=>p.skuId===selectedSkuId&&(!selectedWarehouseId||p.warehouseId===selectedWarehouseId)&&available(p)>0))return toast("所选商品已不可售，请重新选择",true);
  const initialMatches=products.filter(p=>p.skuId===(editing?.skuId||selectedSkuId)&&(!(editing?.warehouseId||selectedWarehouseId)||p.warehouseId===(editing?.warehouseId||selectedWarehouseId))&&(!selectedSerialNo||(p.serials||[]).some(s=>s.no===selectedSerialNo)));const initial=initialMatches.length===1?initialMatches[0]:null;
  const retailPrice=(skuId)=>{const catalog=state.products.find((p)=>p.skuId===skuId);const stock=products.find((p)=>p.skuId===skuId);const price=Number(catalog?.salePrice??stock?.salePrice??0);return !catalog?.pricePending&&Number.isFinite(price)&&price>0?price:"";};
  let saleSourceData=null,sourceRevision=0;
  window.SaleCapture?.stop();
  modal(editing?"修改本单商品":"加入销售商品",[
    {name:"skuId",label:"商品",options,value:initial?saleStockKey(initial):"",required:true},{name:"supplierId",label:"出库供货商",options:[{value:"",label:"先选择商品和仓库"}],value:editing?.supplierId||""},{name:"quantity",label:"数量",type:"number",min:1,step:1,value:editing?.quantity||1,required:true},{...moneyField("salePrice","本单售价（元）",editing?.salePrice??(initial?retailPrice(initial.skuId):"")),hint:"已填入商品档案零售价；在这里改价只影响本单"},
    {name:"serialNo",label:"选择串码",options:[],hint:"仅显示当前可售串码"},
    {name:"noMaterials",label:"维修服务确认无耗材",type:"checkbox",value:editing?.noMaterials},{name:"note",label:"备注",type:"textarea",wide:true,value:editing?.note},
    {name:"carrier",label:"号卡运营商",value:editing?.card?.carrier},{name:"packageName",label:"号卡套餐",value:editing?.card?.packageName},{name:"cardNo",label:"号卡号码",value:editing?.card?.cardNo},moneyField("expected","预计运营商佣金",editing?.card?.expected??0),
  ],async(d)=>{
    const p=products.find((x)=>saleStockKey(x)===d.skuId);const quantity=Number(d.quantity);
    if(!p)throw new Error("商品已不可售，请重新选择");
    if(warehouseSelect.value!==(p.stockManaged===false?'__service__':p.warehouseId))throw new Error("出库仓库与商品不一致，请重新选择");
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>available(p))throw new Error("加入数量超过当前可售库存");
    const source=saleSourceData?.skuId===p.skuId&&saleSourceData?.warehouseId===p.warehouseId?saleSourceData.options.find(row=>row.id===d.supplierId):null;
    if(p.stockManaged!==false&&!source)throw new Error("请先核对本次出库供货商");
    const sourceReserved=state.salesCart.filter((item,i)=>i!==index&&item.skuId===p.skuId&&item.warehouseId===p.warehouseId&&item.supplierId===source?.id).reduce((n,item)=>n+item.quantity,0);
    if(source&&quantity>source.quantity-sourceReserved)throw new Error("所选供货商的在库数量不足，请核对仓库和来源");
    if(p.trackSerial&&!d.serialNo)throw new Error("请选择可售串码");
    if(p.trackSerial&&quantity!==1)throw new Error("串码商品请逐件加入");
    if(p.trackSerial&&(!p.serials?.some((s)=>s.no===d.serialNo&&["可售","未激活"].includes(s.status))||state.salesCart.some((item,i)=>i!==index&&item.serialNo===d.serialNo)))throw new Error("该串码当前不可售或已加入本单");
    if(p.trackSerial&&saleSourceData?.serials.find(row=>row.no===d.serialNo)?.supplierId!==source?.id)throw new Error("所选供货商与这台手机的串号来源不一致");
    if(p.trackSerial&&needsManualSuffix&&String($('modal-serial-suffix')?.value||'').trim()!==String(d.serialNo).slice(-4))throw new Error("请看手上的真机，输入串号后4位核对。不要照抄屏幕上的串号。");
    const repair=p.stockManaged===false&&p.type==="维修";
    const selectedMaterials=repair?materials.map(({skuId,warehouseId,quantity})=>({skuId,warehouseId,quantity})):[];
    if(repair&&!selectedMaterials.length&&!d.noMaterials)throw new Error("维修服务请选择耗材或确认无耗材");
    const priceCents=saleAmountCents(d.salePrice);
    const item={name:p.name,skuId:p.skuId,warehouseId:p.stockManaged===false?undefined:p.warehouseId,warehouseName:p.warehouseName,supplierId:source?.id||"",supplier:source?.name||"",sourceBarcode:String(p.sourceBarcode||p.barcode||""),quantity,salePrice:priceCents/100,serialNo:p.trackSerial?d.serialNo:"",materials:selectedMaterials,noMaterials:repair&&d.noMaterials,note:d.note,card:p.type==="号卡"?{carrier:d.carrier,packageName:d.packageName||p.name,cardNo:d.cardNo,expected:Number(d.expected||0)}:undefined};
    if(index>=0)state.salesCart[index]=item;else state.salesCart.push(item);
    return {message:editing?"本单商品已更新":"商品已加入，请核对售价与收款",nextStep:editing?"sale-step-items":"sale-step-payment"};
  });
  $("modal-root").classList.add("sale-item-modal");
  const form=$("modal-form");
  form.querySelector('button[type="submit"]').textContent=editing?"保存本单商品":"加入并进入下一页";
  const skuField=form.elements.skuId.closest(".field");
  form.elements.skuId.required=false;
  skuField.hidden=true;
  const warehouseField=document.createElement('div');warehouseField.className='field wide';
  const saleWarehouses=[...new Map(products.filter(p=>p.stockManaged!==false&&p.warehouseId).map(p=>[p.warehouseId,p.warehouseName||state.warehouses.find(w=>w.id===p.warehouseId)?.name||p.warehouseId])).entries()];
  warehouseField.innerHTML='<label for="modal-sale-warehouse">出库仓库 <b class="required-tag">库存商品必选</b></label><select id="modal-sale-warehouse"><option value="">请先选择仓库</option>'+saleWarehouses.map(([id,name])=>option(id,name)).join('')+'<option value="__service__">服务项目（不扣库存）</option></select>';
  skuField.after(warehouseField);
  const warehouseSelect=warehouseField.querySelector('select');warehouseSelect.value=initial?.stockManaged===false?'__service__':initial?.warehouseId||'';
  const picker=document.createElement("div");picker.className="field wide sale-modal-picker";
  picker.innerHTML=`<label>选择商品 <b class="required-tag">必填</b></label><p class="operation-tip" data-page-explanation>可按分类下拉选择、搜索名称/编号/串码，或扫码、拍照识码。</p><select id="modal-sale-category" aria-label="商品分类"><option value="">全部分类</option></select><select id="modal-sale-select" aria-label="下拉选择商品"><option value="">下拉选择商品</option></select><input id="modal-sale-search" type="search" autocomplete="off" placeholder="搜索商品名称、编号或串码" aria-label="搜索商品"><div id="modal-sale-matches" class="sale-modal-matches"></div><div class="sale-lookup-actions"><button type="button" id="modal-sale-camera" class="secondary">扫码</button><button type="button" id="modal-sale-photo" class="secondary">拍照识码</button><input id="modal-sale-photo-input" type="file" accept="image/*" capture="environment" hidden></div><video id="modal-sale-video" playsinline muted hidden></video><p id="modal-sale-picker-status" class="muted" role="status"></p>`;
  warehouseField.after(picker);
  const serialField=form.elements.serialNo.closest('.field');serialField.classList.add('serial-entry-panel','wide');
  picker.after(serialField);
  const supplierField=form.elements.supplierId.closest('.field'),sourceInfo=document.createElement('p');sourceInfo.className='operation-tip';sourceInfo.setAttribute('role','status');supplierField.append(sourceInfo);
  const alignSerialSource=()=>{const source=saleSourceData?.serials?.find(row=>row.no===form.elements.serialNo.value);if(source){form.elements.supplierId.value=source.supplierId;sourceInfo.textContent='这台串号来源：'+source.supplier+'；只能从该供货商库存出库。';}};
  const loadSaleSources=async()=>{
    const revision=++sourceRevision,p=products.find(row=>saleStockKey(row)===form.elements.skuId.value);
    saleSourceData=null;supplierField.hidden=!p||p.stockManaged===false;
    if(!p||p.stockManaged===false)return;
    if(warehouseSelect.value!==p.warehouseId){sourceInfo.textContent='请先核对出库仓库';return;}
    form.elements.supplierId.disabled=true;form.querySelector('button[type="submit"]').disabled=true;sourceInfo.textContent='正在核对 '+(p.warehouseName||'所选仓库')+' 的供货来源…';
    try{
      const query=new URLSearchParams({part:'sources',skuId:p.skuId,warehouseId:p.warehouseId});
      const data=await api('/api/sale-opening?'+query);
      if(revision!==sourceRevision||!form.isConnected||form.elements.skuId.value!==saleStockKey(p))return;
      saleSourceData=data;
      const previous=editing?.skuId===p.skuId&&editing?.warehouseId===p.warehouseId?editing.supplierId:'';
      form.elements.supplierId.innerHTML=option('','请选择出库供货商')+data.options.map(row=>option(row.id,row.name+' · 在库 '+row.quantity+(p.trackSerial?' 台':' '+(p.unit||'件')))).join('');
      form.elements.supplierId.value=data.options.some(row=>row.id===previous)?previous:data.options.length===1?data.options[0].id:'';
      form.elements.supplierId.disabled=false;form.querySelector('button[type="submit"]').disabled=false;
      sourceInfo.textContent='出库仓库：'+(p.warehouseName||p.warehouseId)+'；请按供货商核对可用数量。';alignSerialSource();
    }catch(error){if(revision!==sourceRevision||!form.isConnected)return;sourceInfo.textContent=error.message||'供货来源读取失败，请重新选择商品';}
  };
  form.elements.supplierId.addEventListener('change',()=>{const p=products.find(row=>saleStockKey(row)===form.elements.skuId.value);const source=saleSourceData?.options.find(row=>row.id===form.elements.supplierId.value);sourceInfo.textContent=source?'出库仓库：'+(p?.warehouseName||p?.warehouseId||'')+'；'+source.name+'现存 '+source.quantity+' '+(p?.unit||'件'):'请选该仓的供货商。';});
  if(directSerial){picker.hidden=true;picker.style.display='none';const selected=products.find(p=>p.skuId===selectedSkuId&&(!selectedWarehouseId||p.warehouseId===selectedWarehouseId)&&(p.serials||[]).some(s=>s.no===selectedSerialNo));const summary=document.createElement('p');summary.className='operation-tip';summary.textContent='已选在库手机：'+(selected?.name||'商品')+' · '+(selected?.warehouseName||'销售仓')+' · 串号 '+selectedSerialNo;serialField.before(summary);}
  serialField.insertAdjacentHTML('afterbegin','<label>串号录入 <b class="required-tag">手机必填</b></label><input id="modal-serial-input" type="text" inputmode="numeric" autocomplete="off" placeholder="扫码或输入完整串号／后4位" aria-label="输入串号"><div class="sale-lookup-actions"><button type="button" id="modal-serial-scan" class="secondary">扫码串号</button><button type="button" id="modal-serial-check" class="secondary">核对串号</button></div><p id="modal-serial-feedback" class="field-feedback" role="status"></p>');
  serialField.insertAdjacentHTML('beforeend','<label id="modal-serial-confirm" hidden>看手上真机，输入串号后4位核对<input id="modal-serial-suffix" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" placeholder="真机串号后4位"></label>');
  const serialInput=$('modal-serial-input');
  const verifySerial=()=>{const p=products.find(x=>saleStockKey(x)===form.elements.skuId.value),key=serialInput.value.trim(),note=$('modal-serial-feedback');if(!p?.trackSerial)return;
    const serials=(p.serials||[]).filter(v=>['可售','未激活'].includes(v.status)&&!state.salesCart.some((item,i)=>i!==index&&item.serialNo===v.no));
    const hits=key?serials.filter(v=>v.no===key||(/^\d{4}$/.test(key)&&v.no.endsWith(key))):serials;
    form.elements.serialNo.innerHTML='<option value="">'+(hits.length>1?'同尾号有多台，请选择完整串号':'请选择可售串号')+'</option>'+hits.map(v=>option(v.no,v.no)).join('');
    form.elements.serialNo.value=key&&hits.length===1?hits[0].no:'';
    note.innerHTML=key&&hits.length===1?'✓ 已核对完整串号：<span class="serial-full-number">'+E(hits[0].no)+'</span>':E(!key?'':hits.length>1?'找到 '+hits.length+' 个同尾号，请核对并下拉选择。':'未找到可售串号，请检查输入或库存状态。');form.elements.serialNo.setAttribute('aria-invalid',String(!!key&&hits.length!==1));note.dataset.kind=key&&!hits.length?'error':hits.length===1&&key?'good':'hint';alignSerialSource();
  };
  serialInput.addEventListener('input',verifySerial);$('modal-serial-check').addEventListener('click',verifySerial);$('modal-serial-scan').addEventListener('click',()=>$('modal-sale-camera').click());
  form.elements.serialNo.addEventListener('change',()=>{serialInput.value=form.elements.serialNo.value;form.elements.serialNo.setAttribute('aria-invalid','false');$('modal-serial-feedback').textContent=serialInput.value?'✓ 已选择串号：'+serialInput.value:'';$('modal-serial-feedback').dataset.kind='good';alignSerialSource();});
  const materials=(editing?.materials||[]).map((m)=>({...m}));
  const materialStock=products.filter((p)=>p.stockManaged!==false&&!p.trackSerial&&p.quantity>0);
  const materialSection=document.createElement("div");materialSection.className="field wide sale-materials";
  materialSection.innerHTML=`<label>维修耗材</label><div class="sale-material-add"><select id="sale-material-product">${materialStock.map((p)=>option(saleStockKey(p),`${p.name} · ${p.warehouseName||p.warehouseId} · 库存 ${p.quantity}`)).join("")}</select><input id="sale-material-qty" type="number" min="1" step="1" value="1" aria-label="耗材数量"><button id="sale-material-add" type="button" class="secondary">加入耗材</button></div><div id="sale-material-list"></div>`;
  form.elements.note.closest(".field").before(materialSection);
  const renderMaterials=()=>{$("sale-material-list").innerHTML=materials.map((m,i)=>`<div class="line actions"><span>${E(state.products.find((p)=>p.skuId===m.skuId)?.name||m.skuId)} · ${E(state.warehouses.find(w=>w.id===m.warehouseId)?.name||m.warehouseId||'原仓')} × ${E(m.quantity)}</span>${button("移除","remove-sale-material",i,"danger")}</div>`).join("");};
  materialSection.querySelector("#sale-material-add").addEventListener("click",()=>{
    const stock=materialStock.find((p)=>saleStockKey(p)===$("sale-material-product").value),quantity=Number($("sale-material-qty").value);
    const existing=materials.find((m)=>m.skuId===stock?.skuId&&(m.warehouseId||'')===(stock?.warehouseId||''));
    const otherCart=state.salesCart.reduce((sum,item,i)=>sum+(i===index?0:(item.materials||[]).filter((m)=>m.skuId===stock?.skuId&&(m.warehouseId||'')===(stock?.warehouseId||'')).reduce((n,m)=>n+m.quantity,0)),0);
    if(!stock||!Number.isSafeInteger(quantity)||quantity<1||(existing?.quantity||0)+quantity+otherCart>stock.quantity){$("modal-error").textContent="耗材数量超过可用库存";return;}
    if(existing)existing.quantity+=quantity;else materials.push({skuId:stock.skuId,warehouseId:stock.warehouseId,quantity});
    form.elements.noMaterials.checked=false;$("modal-error").textContent="";renderMaterials();
  });
  materialSection.addEventListener("click",(event)=>{const button=event.target.closest('[data-action="remove-sale-material"]');if(!button)return;materials.splice(Number(button.dataset.value),1);renderMaterials();});
  form.elements.noMaterials.addEventListener("change",()=>{if(form.elements.noMaterials.checked){materials.length=0;renderMaterials();}});
  renderMaterials();
  const field=(name)=>form.elements[name].closest(".field");
  const sync=(changed=false)=>{
    const p=products.find((item)=>saleStockKey(item)===form.elements.skuId.value);
    form.querySelector('button[type="submit"]').disabled=!p;
    if(!p){field("serialNo").hidden=true;materialSection.hidden=field("noMaterials").hidden=true;for(const name of ["carrier","packageName","cardNo","expected"])field(name).hidden=true;return;}
    const serial=p.trackSerial===true,repair=p.stockManaged===false&&p.type==="维修",card=p.type==="号卡";
    const preset=retailPrice(p.skuId);
    const hasSuggested=!changed&&!editing&&p.skuId===selectedSkuId&&typeof suggestedPrice==='number'&&Number.isFinite(suggestedPrice)&&suggestedPrice>0;
    if(changed||!editing)form.elements.salePrice.value=hasSuggested?suggestedPrice.toFixed(2):preset===""?"":preset.toFixed(2);
    field("salePrice").querySelector("small").textContent=hasSuggested?"助理带入本单售价 "+M(suggestedPrice)+"，请核对；档案零售价 "+M(preset):preset>0?"档案零售价 "+M(preset)+"；修改仅对本单有效":"档案零售价未设置，请核对本单售价";
    if(changed)form.elements.quantity.value=1;
    form.elements.quantity.readOnly=serial;
    form.elements.quantity.max=p.stockManaged===false?"":String(available(p));
    field("serialNo").hidden=!serial;
    $('modal-serial-confirm').hidden=!serial||!needsManualSuffix;$('modal-serial-confirm').style.display=serial&&needsManualSuffix?'':'none';
    materialSection.hidden=field("noMaterials").hidden=!repair;
    for(const name of ["carrier","packageName","cardNo","expected"])field(name).hidden=!card;
    const serials=(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item,i)=>i!==index&&item.serialNo===s.no));
    form.elements.serialNo.innerHTML='<option value="">请选择可售串码</option>'+serials.map((s)=>option(s.no,s.no)).join("");
    if(!changed&&editing?.skuId===p.skuId)form.elements.serialNo.value=editing.serialNo||"";
    else if(!changed&&selectedSerialNo&&p.skuId===selectedSkuId)form.elements.serialNo.value=selectedSerialNo;
    form.elements.serialNo.required=serial;form.elements.serialNo.setAttribute('aria-invalid','false');serialInput.value=form.elements.serialNo.value;$("modal-serial-feedback").textContent=serial?"请扫码、输入或选择当前可售串号。":"";serialField.classList.toggle("required-field",serial);
  };
  form.elements.skuId.addEventListener("change",()=>{sync(true);void loadSaleSources();});
  sync();void loadSaleSources();
  const category=picker.querySelector("#modal-sale-category");
  const dropdown=picker.querySelector("#modal-sale-select");
  const search=picker.querySelector("#modal-sale-search");
  const matches=picker.querySelector("#modal-sale-matches");
  const pickerStatus=picker.querySelector("#modal-sale-picker-status");
  const categories=[...new Set(stockOptions.map((o)=>products.find((p)=>saleStockKey(p)===o.value)?.type||"未分类"))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  category.innerHTML='<option value="">全部分类</option>'+categories.map((name)=>option(name,name)).join("");
  const warehouseCandidates=()=>products.filter(p=>warehouseSelect.value&&(p.stockManaged===false?warehouseSelect.value==='__service__':p.warehouseId===warehouseSelect.value));
  const candidates=()=>warehouseCandidates().filter((p)=>available(p)>0&&(!category.value||(p.type||"未分类")===category.value)).sort((a,b)=>a.name.localeCompare(b.name,"zh-CN"));
  const matchesQuery=(p,term)=>{
    const haystack=[p.name,p.shortName,p.externalCode,p.barcode,p.sourceBarcode,...(p.legacyExternalCodes||[]),p.skuId,p.type,p.subType,p.thirdType,...(p.aliases||[]),...(p.serials||[]).map((v)=>v.no)].join(" ").toLowerCase();
    return term.split(/\s+/).filter(Boolean).every((word)=>{const group=state.searchSynonyms.find((row)=>row.terms.some((v)=>v.toLowerCase()===word));return (group?group.terms:[word]).some((v)=>haystack.includes(v.toLowerCase()));});
  };
  const renderPicker=()=>{
    const availableProducts=candidates(),term=search.value.trim().toLowerCase();
    const filtered=term?availableProducts.filter((p)=>matchesQuery(p,term)):availableProducts;
    dropdown.innerHTML='<option value="">下拉选择商品（'+availableProducts.length+' 种）</option>'+availableProducts.map((p)=>option(saleStockKey(p),p.name+' · '+(p.warehouseName||'服务项目')+' · '+(p.externalCode||p.skuId)+' · '+M(retailPrice(p.skuId)))).join("");
    if(filtered.some((p)=>saleStockKey(p)===form.elements.skuId.value))dropdown.value=form.elements.skuId.value;
    matches.innerHTML=filtered.length?filtered.slice(0,12).map((p)=>'<button type="button" data-stock-key="'+E(saleStockKey(p))+'"><strong>'+E(p.name)+'</strong>'+saleBarcodeHtml(p)+'<small class="sale-product-meta"><span>仓库 '+E(p.warehouseName||'服务项目')+'</span><span>编号 '+E(p.externalCode||p.skuId)+'</span><span>'+(p.stockManaged===false?'服务项目':'可售 <b class="sale-stock-number">'+E(available(p))+'</b>')+'</span><span>售价 <b class="sale-product-price">'+M(retailPrice(p.skuId))+'</b></span></small></button>').join(''):'<p class="muted">'+(warehouseSelect.value?'没有匹配的可售商品，请换个名称或编号。':'请先选择出库仓库，再查找商品。')+'</p>';
    if(filtered.length>12)matches.insertAdjacentHTML('beforeend','<p class="muted">还有 '+(filtered.length-12)+' 种；可继续输入关键词或按分类下拉选择。</p>');
  };
  const pick=(stockKey,serialNo='')=>{
    const p=products.find((x)=>saleStockKey(x)===stockKey);
    if(!p||available(p)<=0){pickerStatus.textContent='该商品当前不可售，请换选。';return;}
    if(warehouseSelect.value!==(p.stockManaged===false?'__service__':p.warehouseId)){pickerStatus.textContent='商品与所选出库仓库不一致，请重新选择。';return;}
    form.elements.skuId.value=stockKey;sync(true);
    if(serialNo){form.elements.serialNo.value=serialNo;serialInput.value=serialNo;verifySerial();}
    pickerStatus.textContent='已选 '+p.name+' · '+(p.warehouseName||'服务项目')+'；请核对数量、售价'+(p.trackSerial?'和串码':'')+'。';
    search.value='';renderPicker();void loadSaleSources();
  };
  const useCode=(raw,autoPick=true)=>{if(!window.SaleCodeResolver){pickerStatus.textContent='扫码选品组件未加载，请刷新';return;}if(!warehouseSelect.value){pickerStatus.textContent='请先选择出库仓库';return;}const result=window.SaleCodeResolver.resolve(warehouseCandidates(),state.salesCart,raw,{excludeIndex:index,warehouses:state.warehouses});return window.SaleCodeResolver.present(result,{host:matches,autoPick,onPick:p=>pick(p.stockKey,p.serialNo),onMessage:message=>pickerStatus.textContent=message});};
  warehouseSelect.addEventListener('change',()=>{form.elements.skuId.value='';category.value='';search.value='';sync(true);void loadSaleSources();renderPicker();});
  category.addEventListener('change',renderPicker);
  search.addEventListener('input',()=>{const result=window.SaleCodeResolver?.resolve(warehouseCandidates(),state.salesCart,search.value,{excludeIndex:index,warehouses:state.warehouses});if(result?.candidates.length&&!/^\d{4}$/.test(search.value.trim()))useCode(search.value,false);else renderPicker();});
  search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(/^\d{4}$/.test(search.value.trim())){renderPicker();pickerStatus.textContent='后4位请核对具体商品与完整串号，未自动选择。';return;}useCode(search.value);}});
  dropdown.addEventListener('change',()=>{if(dropdown.value)pick(dropdown.value);});
  matches.addEventListener('click',(event)=>{const button=event.target.closest('button[data-stock-key]');if(button)pick(button.dataset.stockKey);});
  const photoInput=picker.querySelector('#modal-sale-photo-input');
  picker.querySelector('#modal-sale-photo').addEventListener('click',()=>photoInput.click());
  photoInput.addEventListener('change',async()=>{
    const file=photoInput.files?.[0];if(!file)return;
    let image;try{image=await createImageBitmap(file);const code=await window.SaleCapture.decode(image);if(code)useCode(code);else pickerStatus.textContent='照片中未识别到二维码或条码，请换清晰照片或搜索商品。';}
    catch{pickerStatus.textContent='照片识别失败，请换照片或搜索商品。';}
    finally{image?.close();photoInput.value='';}
  });
  const video=picker.querySelector('#modal-sale-video'),cameraButton=picker.querySelector('#modal-sale-camera');
  let stream=null,scanning=false,lastScan=0;
  const stopScan=()=>{scanning=false;if(stream)stream.getTracks().forEach((track)=>track.stop());stream=null;video.pause();video.srcObject=null;video.hidden=true;cameraButton.textContent='扫码';};
  cameraButton.addEventListener('click',async()=>{
    if(scanning){stopScan();return;}
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.srcObject=stream;video.hidden=false;await video.play();scanning=true;cameraButton.textContent='关闭扫码';pickerStatus.textContent='将二维码或条码放入取景框。';
      const frame=async(time)=>{if(!scanning)return;if(time-lastScan<280){requestAnimationFrame(frame);return;}lastScan=time;try{const code=await window.SaleCapture.decode(video);if(code){stopScan();useCode(code);return;}}catch{}requestAnimationFrame(frame);};requestAnimationFrame(frame);
    }catch{stopScan();pickerStatus.textContent='相机未打开。请允许相机权限，或用拍照、搜索和下拉选择。';}
  });
  const observer=new MutationObserver(()=>{if(!picker.isConnected){stopScan();observer.disconnect();}});
  observer.observe(document.body,{childList:true,subtree:true});
  renderPicker();
  if(initial)pickerStatus.textContent='已选 '+initial.name+'；请核对数量、售价'+(initial.trackSerial?'和串码':'')+'。';
}
function salePaymentSummary(order) {
  const credit = Number(order.paymentCredit || 0);
  const actual = Math.max(0, Number(order.receivedAmount || 0) - credit);
  const review = order.paymentReview;
  if (order.redReversedBy || review?.status === "已红冲") return "原收款已红冲，详见资金流水";
  if(order.status==="returned")return "原单已核对收款 "+M(actual)+" · 已退货，退款见退货单";
  const confirmed = !review || ["已核对", "已确认到账", "无需收款"].includes(review.status);
  return `${credit ? `原单抵款 ${M(credit)} · ` : ""}本次应收 ${M(review?.amount ?? actual)} · ${confirmed ? "已核对收款" : "已登记收款（待核对）"} ${M(actual)}`;
}
function customerSaleReceiptEntry(order){if(order.status!=="completed"||order.redReversedBy||(order.items||[]).some(row=>Number(row.returnedQuantity)>0)||!(state.user.roleCode==="owner"||order.operatorId===state.user.id||order.salespersonId===state.user.id))return "";return '<a class="secondary" href="/sale-receipt?orderId='+encodeURIComponent(order.id)+'" target="_blank" rel="noopener">顾客小票</a>';}
async function renderOrders(more=false) {
  if(state.tab==='returns'&&new URLSearchParams(location.search).get('view')==='all'){$('main').innerHTML=heading('销售退换货单');await window.TradeDocuments.renderReturnRequests(officePageCurrent());return;}

  const version=++orderQueryVersion,viewVersion=officeViewVersion,tab=state.tab,term=state.orderQuery||"",cursor=state.orderCursor;
  const current=()=>version===orderQueryVersion&&viewVersion===officeViewVersion&&state.tab===tab&&(state.orderQuery||"")===term;
  const query=documentFilterParams(term);if(more&&cursor)query.set("cursor",cursor);
  let page;try{page=await api("/api/sale-orders/page?"+query);}catch(error){if(!current())return;throw error;}
  if(!current())return;
  state.orders=more?[...state.orders,...page.rows]:page.rows;state.orderCursor=page.nextCursor;
  const rows=state.orders.map((o)=>`<tr><td data-label="单号">${E(documentNo(o))}<small>${E(displayTime(o.createdAt))} · ${E(o.customerName||"散客")}${o.customerMask?" · "+E(o.customerMask):""} · 开单：${E(state.users.find((u)=>u.id===o.operatorId)?.name||o.operatorId||"—")}</small></td><td data-label="商品">${o.items.map(i=>`<div><strong>${E(i.name)} × ${E(i.quantity)}</strong>${saleBarcodeHtml(i)}<small>${E(i.warehouseName||state.warehouses.find(w=>w.id===i.warehouseId)?.name||"仓库待核对")}</small></div>`).join("")}</td><td data-label="赠品">${window.Gifts.orderCell(o)}</td><td data-label="通道">${E(o.mobileActivityId?"移动活动机":o.saleMode==="guobu"?"国补":"普通")}</td><td data-label="整单金额">${M(o.amount)}${o.mobileActivityId?`<small>活动税扣（2.5%） ${M(o.activityTax||0)}</small><small>门店返用户金额 ${M(o.activityTopupCost||0)}</small>${state.user.capabilities.profit?`<small>扣税后活动毛利 ${M(o.profit)}</small>`:''}`:''}<small>${salePaymentSummary(o)}</small></td><td data-label="状态">${E(label("order",o.status))}<small>${E(o.paymentReview?.status||"历史单（原收款记录）")}</small></td><td data-label="操作"><a class="secondary" href="/sale-fund-responsibility?order=${encodeURIComponent(o.id)}">收款明细</a>${o.mobileActivityId?`<a class="secondary" href="/mobile-activity-sales?q=${encodeURIComponent(o.mobileActivityId)}">活动关联单</a>`:''}${customerSaleReceiptEntry(o)}${redPacketEntry("sales",o)}${button("补赠品", "gift-supplement",o.id)}${(state.user.capabilities.returnSale?button("申请退货", "return-sale",o.id)+button("申请换货","exchange-sale",o.id):"")}</td></tr>`);
  $("main").innerHTML=heading(state.tab==="returns"?"退换货":new URLSearchParams(location.search).get("view")==="all"?"销售单":"销售单查询","按时间段、供货商和商品名组合查原单。退货、换货须老板本人批准后生效。",button("刷新","refresh")+"<a class=\"secondary\" href=\"/gift-approvals\">赠品审批</a>"+(state.user.capabilities.manageUsers?button("赠品限额设置","gift-settings"):""))+`${documentFilter("orders-filter",true,state.orderQuery||"")}<div class="card sales-orders-list">${table(["单号","商品","赠品","通道","整单金额","状态","操作"],rows)}${state.orderCursor?button("查看更多销售单","orders-more"):""}</div>`;
  bindDocumentFilter("orders-filter",()=>renderOrders());
  if(tab==="returns"&&current())await window.TradeDocuments.renderReturnRequests(current);
}
function returnSale(id) {
 const o=state.orders.find(x=>x.id===id);if(!o)return;
 if(o.paymentReview&&!['已核对','已确认到账','无需收款'].includes(o.paymentReview.status)){modal('先核对原单收款',[],async()=>{location.assign('/sale-payments');return false;},'原单收款尚未核实，先核实收款账户和金额，再申请退货。');$('modal-form').querySelector('button[type=submit]').textContent='去核对收款';return;}
 const available=o.items.filter(i=>i.quantity>(i.returnedQuantity||0));if(!available.length)return toast('这张单已无可退商品',true);
 const fields=available.map(i=>({name:'item_'+i.id,label:i.name+' · 可退 '+(i.quantity-(i.returnedQuantity||0))+(i.serialNo?' · '+i.serialNo:''),type:'number',min:0,max:i.quantity-(i.returnedQuantity||0),step:1,value:available.length===1?1:0}));
 fields.push(moneyField('refundAmount','申请退款金额',available.length===1?available[0].salePrice:0),{name:'paymentMode',label:'支付信息',options:['老板支付'],value:'老板支付'},{name:'returnWarehouseId',label:'退回仓库',options:state.warehouses.filter(w=>w.active!==false).map(w=>({value:w.id,label:w.name})),value:available[0].warehouseId||'wh-sale',required:true},{name:'reason',label:'退货说明（选填）',type:'textarea',wide:true});
 if(o.saleMode==='guobu')fields.push({name:'platformRefundRef',label:'国补平台退款流水号',required:true,wide:true});
 modal('申请退货 · '+documentNo(o),fields,async(d,write)=>{const items=available.map(i=>({itemId:i.id,quantity:Number(d['item_'+i.id]||0)})).filter(i=>i.quantity>0);if(!items.length)throw Error('请选择退货数量');const face=items.reduce((n,x)=>n+available.find(i=>i.id===x.itemId).salePrice*x.quantity,0);if(Number(d.refundAmount)>face)throw Error('退款金额不能超过原单退回商品金额');return write('/api/sale-returns',{orderId:o.id,items,refundAmount:d.refundAmount,returnWarehouseId:d.returnWarehouseId,paymentMode:'老板支付',reason:d.reason||'',platformRefundRef:d.platformRefundRef});},'营业员或老板代办均先提交申请。老板收到待办后可修改退款金额，确认后才记老板支付、回仓和串号；申请时不扣款、不加库存。');
 const form=$('modal-form'),info=document.createElement('p');info.className='system-status';info.setAttribute('role','status');form.querySelector('.form-actions').before(info);let manual=false;form.elements.refundAmount.addEventListener('input',()=>{manual=true;});
 function update(){const face=available.reduce((n,i)=>n+Number(form.elements['item_'+i.id].value||0)*i.salePrice,0);if(!manual)form.elements.refundAmount.value=face;info.textContent='原单退回商品金额 '+M(face)+' · 申请退款 '+M(Number(form.elements.refundAmount.value||0))+' · 退货扣款 '+M(face-Number(form.elements.refundAmount.value||0));}form.addEventListener('input',update);update();form.querySelector('button[type=submit]').textContent='提交退货申请';
}
async function purchasePlanDetail(id) {
  const plan=state.plans?.find(row=>row.id===id);
  if(!plan)return toast("当前列表没有这张订货单，请重新查询后查看",true);
  const moneyVisible=Boolean(state.user.capabilities.cost||state.user.capabilities.supplierView);
  const recordedMoney=value=>value==null?"未记录":M(value);
  const supplier=state.suppliers?.find(row=>row.id===plan.supplierId)?.name||plan.supplier||"未记录";
  const facts=[["往来单位",supplier],["开单时间",plan.createdAt?displayTime(plan.createdAt):"未记录"],["开单人",plan.operator||state.users?.find(row=>row.id===plan.operatorId)?.name||"未记录"],["验货人",plan.receiver||plan.operator||"待指派"],["收货状态",label("plan",plan.status)]];
  if(moneyVisible)facts.push(["订货金额",recordedMoney(plan.plannedAmount)],["本订货单已登记付款",recordedMoney(plan.paidAmount)]);
  const items=(plan.items||[]).map(item=>{
    const entries=[["商品编码",item.externalCode||state.products?.find(row=>row.skuId===item.skuId)?.externalCode||"未记录"],["订货数量",item.quantity??"未记录"],["已收数量",item.received??"未记录"]];
    if(item.warehouseName)entries.push(["收货仓库",item.warehouseName]);
    if(moneyVisible)entries.push(["订货单价",recordedMoney(item.recordedCostPrice??item.costPrice)]);
    return `<article class="payroll-line"><h3>${E(item.name||"未记录商品名称")}</h3>${payrollFacts(entries)}</article>`;
  }).join("")||'<p>这张单据没有商品明细，请核对原始记录。</p>';
  const eventOrders=new Set((plan.events||[]).map(row=>row.orderId).filter(Boolean));
  const orders=(state.purchaseOrders||[]).filter(row=>row.planId===plan.id||eventOrders.has(row.id));
  const receipts=orders.map(order=>`<article class="payroll-line"><strong>${E(documentNo(order))}</strong>${payrollFacts([["入库时间",order.createdAt?displayTime(order.createdAt):"未记录"],["验收人",order.operator||"未记录"],...(moneyVisible?[["入库金额",recordedMoney(order.amount)]]:[])])}${(order.items||[]).map(item=>`<p>${E(item.name)} × ${E(item.quantity)}${item.serials?.length?`<br>串号：${item.serials.map(E).join("、")}`:""}</p>`).join("")}</article>`).join("")||'<p>当前可见记录中暂无关联入库单。</p>';
  const history=(plan.events||[]).map(event=>`<p>${E(event.at?displayTime(event.at):"未记录时间")}　${E(event.type)}　${E(event.operator||event.operatorId||"")}${event.reason?`<br>${E(event.reason)}`:""}</p>`).join("")||'<p>暂无过程记录。</p>';
  let paymentDocuments;
  try{paymentDocuments=await api('/api/procurement-plans/payment-documents?'+new URLSearchParams({planId:plan.id}));}catch(error){return showError(error);}
  const paymentRows=paymentDocuments.restricted?'<p>'+E(paymentDocuments.message)+'</p>':(paymentDocuments.rows||[]).map(row=>'<article class="payroll-line"><strong>'+E(row.displayNo)+'</strong><p>'+E(row.supplier)+' · '+M(row.amount)+' · '+E(row.status)+'</p><p>'+E(displayTime(row.date))+' · '+E(row.operator)+'</p>'+row.parts.map(part=>'<p>'+E(part.accountName)+' · '+M(part.amount)+' · 支付流水 '+E(part.reference||'待补')+(part.reversed?' · 已红冲':'')+'</p>').join('')+(row.href?'<a href="'+E(row.href)+'">查看付款单与分笔流水</a>':'')+'</article>').join('')||'<p>本订货单尚无关联采购付款单。</p>';
  const paymentSection='<section aria-label="关联采购付款单"><h3>采购付款单</h3>'+(!paymentDocuments.restricted?'<p>付款对象：'+E(supplier)+' · 关联订货：'+E(documentNo(plan))+'</p>':'')+(paymentDocuments.canCreate?'<button type="button" class="primary" data-plan-payment-create>开采购付款单</button>':'')+paymentRows+'</section>';
  payrollReadonlyDialog("订货单详情",`<h3>${E(documentNo(plan))}</h3>${payrollFacts(facts)}${paymentSection}${plan.note?`<p>备注：${E(plan.note)}</p>`:""}<h3>订货商品</h3>${items}<h3>关联入库单</h3>${receipts}<details class="payroll-evidence"><summary>过程记录与内部编号</summary>${history}<p>${E(plan.id)}</p></details>`);
  const payButton=document.querySelector('[data-plan-payment-create]');if(payButton)payButton.onclick=()=>{const dialog=payButton.closest('dialog');dialog?.close();dialog?.remove();purchasePlanPaymentEditor(plan);};
}

function purchaseRecordTitle(row, history = "") {
  const shortNo=documentNo(row);
  const fullNo=shortNo!==String(row.id||"")?`<details class="purchase-record-detail"><summary>内部编号</summary><code>${E(row.id)}</code></details>`:"";
  return `<strong>${E(shortNo)}</strong>${row.createdAt?`<small>${E(displayTime(row.createdAt))}</small>`:""}${fullNo}${history}`;
}
function purchaseLabelLink(order) {
  return order.items.some(item=>item.qrCode||state.products.find(p=>p.skuId===item.skuId)?.qrCode)?`<a class="staff-account-link" href="/qr?purchaseId=${encodeURIComponent(order.id)}">二维码标签／补打</a>`:"";
}
function purchaseItemLines(items, receiving = false) {
  return `<div class="purchase-item-lines">${items.map(i=>`<div><span>${E(i.name)}</span><strong>${receiving?`已收 ${E(i.received)} / 订 ${E(i.quantity)}`:`× ${E(i.quantity)}`}</strong>${state.user.capabilities.cost?`<p class="record-value">${receiving?"预计进货价":"进货价"}：<strong>${M(i.recordedCostPrice??i.costPrice)}</strong>${i.recordedCostPrice!=null&&i.recordedCostPrice!==i.costPrice?`<small>原录入 ${M(i.costPrice)} · 老板已更正</small>`:""}</p>`:""}</div>`).join("")}</div>`;
}
function documentQuery(){return state.documentQueries?.[state.tab]||"";}
function documentMatches(row,term=documentQuery()){
  const q=String(term||"").trim().toLowerCase();if(!q)return true;
  const values=Object.entries(row||{}).filter(([key])=>key==="id"||key==="number"||key==="displayNo"||key.endsWith("Id")||key.endsWith("DisplayNo")||["supplier","counterparty","name","title","reason","reference"].includes(key)).map(([,value])=>String(value??""));
  values.push(...(row.items||[]).map(item=>item.name||""));return values.join(" ").toLowerCase().includes(q);
}
function documentFilterValues(){state.documentFilters||={};if(!state.documentFilters[state.tab]){const params=new URLSearchParams(location.search);state.documentFilters[state.tab]=Object.fromEntries(['from','to','supplier','productName'].map(name=>[name,params.get('tab')===state.tab?params.get(name)||'':'']));}return state.documentFilters[state.tab];}
function documentFilterParams(q=documentQuery()){return new URLSearchParams({q,...documentFilterValues()});}
function documentFilter(id,expanded=false,q=documentQuery()){const f=expanded?documentFilterValues():{};return `<form id="${E(id)}" class="card document-filter"${expanded?' style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));align-items:end;gap:12px"':''}>${expanded?`<label>开始日期<input name="from" type="date" value="${E(f.from)}"></label><label>结束日期<input name="to" type="date" value="${E(f.to)}"></label><label>${id==='purchase-filter'?'单据供货商':'销售商品供货商'}<input name="supplier" type="search" maxlength="160" value="${E(f.supplier)}" placeholder="输入供货商名称"></label><label>商品名<input name="productName" type="search" maxlength="160" value="${E(f.productName)}" placeholder="输入商品名称或型号"></label>`:''}<label>单号 / 原单 / ${expanded?'串号':'名称'}<input name="q" type="search" value="${E(q)}" placeholder="${expanded?'输入短单号、原单号或串号':'输入短单号或原单号'}"></label><button class="primary" type="submit">查询</button><button class="secondary" type="button" data-document-all>${expanded?'清空筛选':'全部'}</button>${expanded?'<p style="grid-column:1/-1;margin:0">日期按北京时间的开单日期，含结束日；供货商与商品名需在同一商品行命中，返回整张单据，金额为整单合计。</p>':''}</form>`;}
function bindDocumentFilter(id,render){const form=$(id);if(!form)return;async function apply(clear){const data=new FormData(form),q=clear?'':String(data.get('q')||'').trim();state.documentQueries||={};state.documentQueries[state.tab]=q;if(form.elements.from){state.documentFilters||={};state.documentFilters[state.tab]=Object.fromEntries(['from','to','supplier','productName'].map(name=>[name,clear?'':String(data.get(name)||'').trim()]));}if(id==='orders-filter'){state.orderQuery=q;state.orderCursor=null;}await render().catch(showError);}form.onsubmit=async event=>{event.preventDefault();await apply(false);};form.querySelector('[data-document-all]').onclick=()=>apply(true);}
function purchaseCorrectionHistory(order) {
  const rows=order.priceCorrections||[];
  return rows.length?`<details class="purchase-record-detail"><summary>进货价更正记录（${rows.length}）</summary>${rows.map(r=>`<p>${E(displayTime(r.createdAt))} · ${E(r.operator)}<br>进货价 ${M(r.currentRecordedPrice)} → ${M(r.correctedUnitPrice)}<br>库存成本差额 ${M(r.inventoryDelta)} · 已售成本差额 ${M(r.salesDelta)}<br>${E(r.note)} · 凭证 ${E(r.reference)}</p>`).join("")}</details>`:"";
}
function purchaseSourceMatches(order){
  if(documentMatches(order))return true;
  const query=String(documentQuery()||'').trim().toLowerCase();if(!query)return true;
  return [(order.supplierAllocations||[]).map(row=>[row.supplier,...(row.serialNos||[])].join(' ')).join(' '),...(order.items||[]).map(item=>(item.serialSources||[]).map(source=>[source.serialNo,source.supplier,source.purchaseDate].join(' ')).join(' '))].join(' ').toLowerCase().includes(query);
}
function purchaseSupplierAttribution(order){
  const allocations=(order.supplierAllocations||[]).filter(row=>Number(row.amount)>0||Number(row.outstanding)>0||row.serialNos?.length),corrected=(order.sourceCorrections||[]).length>0||allocations.some(row=>row.supplierId&&row.supplierId!==order.supplierId);
  if(!corrected)return '<span class="record-value">'+E(order.supplier)+'</span>';
  return '<span class="record-value">原单供货商（历史记录）：'+E(order.supplier)+'</span><strong class="record-value">当前归属</strong>'+allocations.map(row=>'<p>'+E(row.supplier||'待核对')+(row.serialNos?.length?' · '+E(row.serialNos.length)+' 台':'')+(state.user.capabilities.supplierView?'<small>归属货款 '+M(row.amount)+' · 已核销 '+M(row.settledAmount)+' · 未付 '+M(row.outstanding)+'</small>':'')+'</p>').join('');
}
function purchaseSerialSourceLines(order){
  const rows=(order.items||[]).flatMap(item=>(item.serialSources||[]).map(source=>({...source,name:item.name})));
  if(!rows.length)return '';
  return '<details class="purchase-record-detail"><summary>逐台供货来源（'+E(rows.length)+' 台）</summary>'+rows.map(row=>'<p><strong>'+E(row.serialNo)+'</strong><br>'+E(row.name)+' · 当前供货商 '+E(row.supplier||'待补')+'<br>实际进货日期：'+E(row.purchaseDate||'待补')+(state.user.capabilities.cost&&row.costAmount!=null?'<br>本台成本 '+M(row.costAmount):'')+(state.user.capabilities.supplierView&&row.paidAmount!=null&&row.payableAmount!=null?'<br>本台已核销 '+M(row.paidAmount)+' · 未付 '+M(row.payableAmount):'')+'</p>').join('')+'</details>';
}
function purchaseSupplierSettlementLinks(order){
  if(!state.user.capabilities.supplierView)return '';
  const groups=order.supplierAllocations?.length?order.supplierAllocations:[{supplierId:order.supplierId,supplier:order.supplier,outstanding:order.outstanding}];
  return groups.filter(row=>row.supplierId&&Number(row.outstanding)>0).map(row=>'<a class="staff-account-link" href="/app?tab=suppliers&amp;supplierId='+encodeURIComponent(row.supplierId)+'">'+E(row.supplier||'供货商')+' · 未付 '+M(row.outstanding)+' · '+(state.user.capabilities.supplierSettle?'去往来付款':'查看往来')+' ›</a>').join('');
}
async function renderPurchase() {
  const queryOnly=state.tab==="purchase-query";
  const purchaseParams=new URLSearchParams(location.search),purchaseSection=purchaseParams.get('section')||'plans';
  const showPlans=!queryOnly&&purchaseSection!=='inbound',showInbound=queryOnly||purchaseSection==='inbound',allPlans=purchaseParams.get('history')==='1';
  const current=officePageCurrent();
  // A return deep link has its own view; never paint procurement in between.
  if(!queryOnly&&new URLSearchParams(location.search).get('focusPurchaseReturn')){
    await window.TradeDocuments.renderPurchaseReturnRequests(current);return;
  }
  if(!queryOnly&&new URLSearchParams(location.search).get('section')==='purchase-returns'){$('main').innerHTML=heading('采购退货');await window.TradeDocuments.renderPurchaseReturnRequests(current);return;}
  const focusCatalogId=new URLSearchParams(location.search).get("catalogReview");
  if(focusCatalogId||location.hash==='#catalog-reviews'){
    $("main").innerHTML=heading(focusCatalogId?"只看这条新增档案":"新增档案核对");
    if(state.user.roleCode==="owner")await window.TradeDocuments.renderCatalogReviews(current);
    else $("main").insertAdjacentHTML("beforeend",'<p role="status">此项仅老板可以核对。</p>');
    return;
  }
  const filters=documentFilterParams().toString();
  const data=await officePageRead(current,()=>Promise.all([showInbound?api("/api/purchase-orders?"+filters):Promise.resolve([]),showPlans?api("/api/procurement-plans?"+filters):Promise.resolve([]),api("/api/suppliers/directory")]));
  if(!current())return;
  const [orders,plans,suppliers]=data;
  const focusedPurchase=!queryOnly&&!!focusedPlanId&&documentQuery()===focusedPlanId;
  state.plans=plans;state.suppliers=suppliers;state.purchaseOrders=orders;
  const orderedPlans=plans.filter(p=>focusedPurchase?p.id===focusedPlanId:documentMatches(p)&&(allPlans||p.status==='open')).slice().reverse().sort((a,b)=>Number((b.receiverId||b.operatorId)===state.user.id)-Number((a.receiverId||a.operatorId)===state.user.id));
  const planRows=(queryOnly||allPlans?orderedPlans:orderedPlans.slice(0,40)).map((p)=>{
    const mine=(p.receiverId||p.operatorId)===state.user.id;
    const canReceive=p.status==="open"&&(mine||state.user.roleCode==="owner");
    const review=p.paymentReview;
    const reviewLabel=review?.status==="not_required"?"正常办理 · 老板事后对账":review?.status==="approved"?"原制度已批准额度 "+M(review.approvedAmount):review?.status==="deferred"?"原制度暂缓付款":review?.status==="pending"?"原制度待审记录（现正常办理后对账）":"历史单（按真实收付款核对）";
    const remainingPayment=Math.max(0,Number(p.paymentRemaining??(Number(p.plannedAmount||0)-Number(p.paidAmount||0))));
    const canPay=p.status==="open"&&remainingPayment>0&&state.user.capabilities.supplierSettle;
    const actions=queryOnly||allPlans?"":p.status==="open"?(canReceive?button("分批验货入库","receive-plan",p.id):"")+(state.user.roleCode==="owner"?button("指派验货","assign-plan",p.id)+button("终止余货","close-plan",p.id,"danger"):"")+(canPay?button("登记实际付款","pay-plan",p.id):""):"";
    const history=(p.events||[]).map((e)=>`<div>${E(e.type)} · ${E(e.operator||e.operatorId||"")} · ${E(displayTime(e.at))}${e.orderId?" · "+E(documentRef(e,"orderId")):""}${e.amount!=null?" · "+M(e.amount):""}${e.approvedAmount!=null?" · 批准 "+M(e.approvedAmount):""}${e.reason?" · "+E(e.reason):""}</div>`).join("");
    return `<tr><td data-label="编号" class="record-title">${button("查看订货单","purchase-plan-detail",p.id,"primary")}${purchaseRecordTitle(p,`<details class="purchase-record-detail"><summary>过程记录</summary>${history||"历史单据暂无事件明细"}</details>`)}</td><td data-label="往来单位"><span class="record-value">${E(suppliers.find((s)=>s.id===p.supplierId)?.name||p.supplier)}</span></td><td data-label="收货进度">${purchaseItemLines(p.items,true)}</td><td data-label="验货人"><span class="record-value">${E(p.receiver||p.operator||"待指派")}</span></td><td data-label="实际付款核对"><div class="record-value">${E(reviewLabel)}<small>${Number(p.paidAmount||0)>0?"本单已登记付款 "+M(p.paidAmount)+" · 付款对象："+E(p.supplier):"本单未登记关联付款，实际支付需另核对"} / 订货 ${M(p.plannedAmount||0)}</small></div></td><td data-label="状态"><span class="record-value">${E(label("plan",p.status))}</span></td><td data-label="操作">${queryOnly||allPlans?"":redPacketEntry("procurementPlans",p)}${actions}</td></tr>`;
  });
  const orderRows=(queryOnly?orders.filter(purchaseSourceMatches).slice().reverse():(focusedPurchase?[]:orders.filter(purchaseSourceMatches)).slice().reverse().slice(0,40)).map((o)=>`<tr><td data-label="编号" class="record-title">${purchaseRecordTitle(o)}</td><td data-label="往来单位">${purchaseSupplierAttribution(o)}</td><td data-label="商品">${purchaseItemLines(o.items)}${purchaseSerialSourceLines(o)}${queryOnly?'':purchaseLabelLink(o)}${purchaseCorrectionHistory(o)}</td><td data-label="整单金额"><span class="record-value money-value">${M(o.amount)}</span></td><td data-label="待付"><span class="record-value money-value">${state.user.capabilities.supplierView&&o.outstanding!=null?M(o.outstanding):'—'}</span>${purchaseSupplierSettlementLinks(o)}</td><td data-label="操作">${queryOnly?'—':redPacketEntry("purchases",o)+button("申请采购退货","purchase-return-request",o.id)+(state.user.roleCode==="owner"?button("更正进货价","purchase-price-correction",o.id):"")}</td></tr>`);
  const title=focusedPurchase?'只看这张订货单':showPlans?(allPlans&&purchaseParams.get('view')!=='all'?'订货单查询':'订货单'):queryOnly&&purchaseParams.get('view')!=='all'?'进货单查询':'进货单';
  const actions=focusedPurchase||queryOnly||allPlans?'':showPlans?button('新建订货','purchase-plan','','primary'):button('新建进货单','purchase-direct','','primary');
  $('main').innerHTML=heading(title,showPlans?(allPlans?'查询订货单及收货进度。':'这里只列待收货订货单。已验收入库的单据到进货单查询。'):'这里只列已实际验收入库的进货单。',actions)+documentFilter('purchase-filter',true)+
   (showPlans?'<div class="card mobile-record-list purchase-records"><h2>订货单</h2>'+table(['编号','往来单位','收货进度','验货人','实际付款核对','状态','操作'],planRows.length?planRows:['<tr class="purchase-empty"><td colspan="7">暂无订货单</td></tr>'])+'</div>':'')+
   (showInbound?'<div class="card mobile-record-list purchase-records"><h2>进货单</h2>'+table(['编号','往来单位','商品','整单金额','待付','操作'],orderRows.length?orderRows:['<tr class="purchase-empty"><td colspan="6">暂无进货单</td></tr>'])+'</div>':'');
  bindDocumentFilter("purchase-filter",renderPurchase);
  if(current()&&!queryOnly&&!focusedPurchase&&location.hash==='#purchase-return-requests')await window.TradeDocuments.renderPurchaseReturnRequests(current);
  if(current()&&!queryOnly&&!focusedPurchase&&state.user.roleCode==="owner"&&location.hash==='#catalog-reviews')await window.TradeDocuments.renderCatalogReviews(current);
}

function purchaseCategoryPath(p){const type=p.type==='智能手机'?'智能机':p.type==='二手机'?'二手手机':p.type==='其他数码'?'数码产品':/^(配件和维修|配件\s*[/／]\s*维修)$/.test(p.type||'')?(p.stockManaged===false?'维修':'配件'):p.type;return [type||'待归类',p.subType||'待归类',p.thirdType||'待归类'];}
function purchaseCategoryMatches(products,path,term=''){const norm=v=>String(v||'').normalize('NFKC').toLowerCase(),terms=norm(term).trim().split(/\s+/).filter(Boolean);return products.filter(p=>p.active!==false&&path.every((v,i)=>!v||purchaseCategoryPath(p)[i]===v)&&terms.every(t=>norm([p.name,p.externalCode,p.shortName,...(Array.isArray(p.aliases)?p.aliases:[])].join(' ')).includes(t)));}
function attachPurchaseCategoryPicker(select,products,title){
 const field=select.closest('.field');field.classList.add('wide');const panel=document.createElement('div');panel.className='field wide purchase-category-picker';panel.setAttribute('role','group');panel.setAttribute('aria-label',title+'分类选品');panel.innerHTML='<strong>'+E(title)+' · 按分类选择</strong><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px"><label>一级分类<select data-pc-level="0" aria-label="'+E(title)+'一级分类"></select></label><label>二级分类／品牌<select data-pc-level="1" aria-label="'+E(title)+'二级分类或品牌"></select></label><details><summary>三级分类（按需展开）</summary><label>三级分类<select data-pc-level="2" aria-label="'+E(title)+'三级分类"></select></label></details></div><small role="status" aria-live="polite"></small>';field.before(panel);
 const levels=Array.from(panel.querySelectorAll('[data-pc-level]')),message=panel.querySelector('[role=status]');let path=['','',''];let search=field.querySelector('.select-filter');if(!search){search=document.createElement('input');search.type='search';search.setAttribute('aria-label','搜索'+title);select.before(search);}search.classList.remove('select-filter');search.classList.add('purchase-item-search');search.placeholder='在所选分类中搜索名称、编号';originalSelectOptions.delete(select);
 function draw(reset=false){const previous=select.value;for(let level=0;level<3;level++){const rows=purchaseCategoryMatches(products,path.slice(0,level)),names=[...new Set(rows.map(p=>purchaseCategoryPath(p)[level]))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));levels[level].disabled=level>0&&!path[level-1];levels[level].innerHTML=option('',level===0?'请选择一级分类':level===1?'全部二级分类／品牌':'全部三级分类',!path[level])+names.map(name=>option(name,name,path[level]===name)).join('');}
 const matched=path[0]?purchaseCategoryMatches(products,path,search.value):[];select.disabled=!path[0];select.innerHTML=option('',!path[0]?'请先选择一级分类':matched.length?'请选择具体商品':'没有匹配商品',true)+matched.map(p=>option(p.skuId,p.name+' · '+(state.warehouses.find(w=>w.id===p.warehouseId)?.name||'其他仓'))).join('');if(!reset&&matched.some(p=>p.skuId===previous))select.value=previous;else select.value='';message.textContent=path[0]?'当前范围 '+matched.length+' 种商品；可只选一级、二级后直接选择商品。':'先选一级分类，再按品牌或品类缩小范围。';if(previous!==select.value)select.dispatchEvent(new Event('change',{bubbles:true}));}
 levels.forEach((control,i)=>control.addEventListener('change',()=>{path[i]=control.value;for(let j=i+1;j<3;j++)path[j]='';search.value='';draw(true);}));search.addEventListener('input',()=>draw());select.addEventListener('change',()=>{select.title=select.selectedOptions[0]?.textContent||'';});draw();
}

function procurementPlanEditor() {
  const products=state.products.filter(p=>p.stockManaged!==false&&p.active!==false);
  const fields=[
    {name:"supplierId",label:"往来单位",options:[{value:"",label:"请选择往来单位"},...state.suppliers.map(s=>({value:s.id,label:s.name})),{value:"__new_supplier__",label:"＋ 新增往来单位"}],required:true},
    {name:"supplierName",label:"新增往来单位名称",inlineHint:"名单中没有时填写，可直接接着订货。"},
    {name:"supplierContact",label:"联系方式（选填）"},
  ];
  let nextLine=0;const lines=new Map();
  modal("新建订货",fields,(d,write)=>{
    const items=Array.from(lines.values()).map(row=>({skuId:d[row.sku.name],quantity:Number(d[row.qty.name]),costPrice:Number(d[row.cost.name])}));
    if(!items.length)throw new Error("请添加订货商品");
    let totalCents=0;
    for(const [index,item] of items.entries()){
      if(!products.some(p=>p.skuId===item.skuId))throw new Error("第"+(index+1)+"行：请选择有效商品");
      if(!Number.isSafeInteger(item.quantity)||item.quantity<1)throw new Error("第"+(index+1)+"行：数量须为正整数");
      const cents=modalPaymentCents(d[Array.from(lines.values())[index].cost.name]);
      if(cents===null||!Number.isSafeInteger(cents*item.quantity))throw new Error("第"+(index+1)+"行：请核对预计进货价与数量");
      totalCents+=cents*item.quantity;if(!Number.isSafeInteger(totalCents))throw new Error("订货合计金额超出范围，请分单订货");
    }
    const adding=d.supplierId==="__new_supplier__",supplier=adding?String(d.supplierName||"").trim():state.suppliers.find(s=>s.id===d.supplierId)?.name;
    if(!supplier)throw new Error(adding?"请填写新增往来单位名称":"请选择往来单位");
    return write("/api/procurement-plans",{supplierId:adding?"":d.supplierId,supplier,...(adding?{supplierContact:String(d.supplierContact||"").trim()}:{}),items});
  },"同一张单可订多种商品，每种商品可填写多台数量。订货时不用填串号，到货再实际点收、验货并入库；正常办理后交老板对账。本次建单不会自动付款。");
  const form=$("modal-form"),root=form.closest("#modal-root"),host=document.createElement("div");host.className="field wide";host.setAttribute("data-procurement-lines","");form.querySelector(".fields").append(host);
  const toolbar=document.createElement("div");toolbar.className="field wide";toolbar.style.cssText="display:flex;flex-wrap:wrap;align-items:center;gap:.75rem";
  const add=document.createElement("button");add.type="button";add.className="secondary";add.textContent="＋ 添加商品";
  const summary=document.createElement("strong");summary.setAttribute("aria-live","polite");toolbar.append(add,summary);form.querySelector(".fields").append(toolbar);
  const locked=()=>root.dataset.submitting==="1"||root.dataset.uncertain==="1";
  function sync(){
    let total=0,qty=0,valid=true;let index=0;
    for(const row of lines.values()){
      index++;row.title.textContent="商品 "+index;row.remove.disabled=lines.size<=1;
      const q=Number(row.qty.value),cents=modalPaymentCents(row.cost.value);
      if(!Number.isSafeInteger(q)||q<1||cents===null||!Number.isSafeInteger(cents*q)){valid=false;continue;}
      qty+=q;total+=cents*q;if(!Number.isSafeInteger(total)||!Number.isSafeInteger(qty))valid=false;
    }
    summary.textContent=lines.size+" 行商品 · "+(valid?qty+" 件 · 预计合计 "+M(total/100):"请填齐数量与预计进货价");
  }
  function addLine(){
    if(locked())return;if(lines.size>=100){toast("一张订货单最多100行商品，请分单订货",true);return;}
    const key=++nextLine,names={sku:"planSku_"+key,qty:"planQty_"+key,cost:"planCost_"+key};
    const descriptors=[{name:names.sku,label:"商品 "+key,options:[{value:"",label:"请选择商品"},...products.map(p=>({value:p.skuId,label:p.name}))],required:true},qtyField(names.qty,"数量",1),moneyField(names.cost,"预计进货价")];fields.push(...descriptors);
    const block=document.createElement("section");block.style.cssText="border:1px solid #b6c9ed;border-radius:10px;padding:12px;margin-bottom:12px";block.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:10px"><strong data-line-title></strong><button type="button" class="secondary" data-remove-line>删除此行</button></div><div class="fields">'+descriptors.map(formField).join("")+'</div>';host.append(block);
    const row={sku:form.elements[names.sku],qty:form.elements[names.qty],cost:form.elements[names.cost],title:block.querySelector("[data-line-title]"),remove:block.querySelector("[data-remove-line]")};lines.set(key,row);
    row.sku.addEventListener("change",()=>{row.cost.value="";sync();});attachPurchaseCategoryPicker(row.sku,products,"商品 "+key);
    row.remove.addEventListener("click",()=>{if(locked()||lines.size<=1)return;lines.delete(key);for(const descriptor of descriptors){const i=fields.indexOf(descriptor);if(i>=0)fields.splice(i,1);}block.remove();sync();});sync();
  }
  add.addEventListener("click",addLine);form.addEventListener("input",sync);form.addEventListener("change",sync);addLine();
  const syncSupplier=()=>{const adding=form.elements.supplierId.value==="__new_supplier__";for(const name of ["supplierName","supplierContact"]){const input=form.elements[name];input.closest(".field").hidden=!adding;input.disabled=!adding;input.required=adding&&name==="supplierName";}};
  form.elements.supplierId.addEventListener("change",syncSupplier);syncSupplier();exposeNewChoice(form,"supplierId","__new_supplier__","supplierName");enhancePurchaseSupplier(form);
}


function enhancePurchaseSupplier(form){
 const select=form.elements.supplierId,field=select?.closest('.field');if(!field||field.dataset.purchaseSupplier==='1')return;
 field.dataset.purchaseSupplier='1';field.classList.add('wide','purchase-supplier-field');
 if(!document.querySelector('style[data-purchase-supplier-style]')){const style=document.createElement('style');style.dataset.purchaseSupplierStyle='1';style.textContent='#modal-form .purchase-supplier-field .option-add-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}#modal-form .purchase-supplier-field select{width:100%;min-width:0}#modal-form .purchase-supplier-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px}#modal-form .purchase-supplier-tools small{font-size:14px;color:#334c68}#modal-form .purchase-supplier-tools button{font-size:14px;min-height:34px;padding:5px 10px}';document.head.append(style);}
 const search=field.querySelector('.select-filter'),all=Array.from(select.options),isSupplier=o=>Boolean(o.value)&&o.value!=='__new_supplier__',total=all.filter(isSupplier).length;
 const tools=document.createElement('div');tools.className='purchase-supplier-tools';const status=document.createElement('small');status.setAttribute('role','status');status.setAttribute('aria-live','polite');tools.append(status);field.append(tools);
 let clear;if(search){search.placeholder='输入往来单位名称筛选';clear=document.createElement('button');clear.type='button';clear.className='secondary';clear.textContent='显示全部';clear.setAttribute('aria-label','显示全部往来单位');tools.append(clear);clear.addEventListener('click',()=>{search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));update();select.focus();});search.addEventListener('input',()=>queueMicrotask(update));}
 function update(){const term=search?.value.trim(),count=Array.from(select.options).filter(isSupplier).length;status.textContent=term?'匹配 '+count+' / '+total+' 家往来单位':'共 '+total+' 家往来单位，点击下拉选择';if(clear)clear.hidden=!term;select.title=select.selectedOptions[0]?.textContent||'请选择往来单位';}
 select.addEventListener('change',update);update();
}

function directSerialCandidate(raw,product,existing,collected,quantity){
 let value=String(raw||'').trim();if(value.startsWith('{')){let data;try{data=JSON.parse(value);}catch{throw new Error('二维码内容不是可识别的串号');}value=String(data.imei||data.IMEI||data.serialNo||data.sn||'').trim();}
 value=value.replace(/^(?:IMEI[12]?|SN|串号)[：:\s]+/i,'').trim();
 if(!value||!(/^[a-z0-9-]{5,40}$/i.test(value))||value.startsWith('JY1:'))throw new Error('请扫描完整IMEI或SN串号，不能用后4位或商品二维码');
 if(/^(智能机|智能手机|功能机|功能手机|二手机|二手手机)$/.test(product.type)&&/^\d+$/.test(value)&&!/^\d{15}$/.test(value))throw new Error('这可能是商品条码；请扫描15位IMEI串号');
 if(existing.includes(value))throw new Error('该串号已在系统登记，请核对原记录，不能重复入库');
 if(collected.includes(value))throw new Error('这个串号已经扫过，请扫下一台');
 if(value===product.externalCode||value===product.barcode)throw new Error('这是商品编码，请扫描盒子上的IMEI或SN串号');
 if(!Number.isSafeInteger(quantity)||quantity<1)throw new Error('先填写本行入库数量');
 return value;
}
function mountDirectSerialScanner({row,block,form,products,getRows,sync,isLocked}){
 const field=row.serials.closest('.field'),tools=document.createElement('div');tools.innerHTML='<div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-direct-camera class="secondary">手机连续扫码</button><strong data-direct-progress role="status" aria-live="polite"></strong></div><p data-direct-scan-hint role="status"></p><video playsinline muted hidden style="width:100%;max-height:260px;object-fit:contain;background:#18243a"></video><div data-direct-serial-list></div>';field.insertBefore(tools,row.serials);const detail=document.createElement('details');detail.innerHTML='<summary>查看／修正串号</summary>';row.serials.before(detail);detail.append(row.serials);const button=tools.querySelector('button'),video=tools.querySelector('video'),progress=tools.querySelector('[data-direct-progress]'),hint=tools.querySelector('[data-direct-scan-hint]'),list=tools.querySelector('[data-direct-serial-list]');let stream=null,run=0,timer=null,destroyed=false,last='',lastAt=0;
 const values=()=>String(row.serials.value||'').trim().split(/[\s,，]+/).filter(Boolean),product=()=>products.find(p=>p.skuId===row.sku.value);
 function feedback(message,error=false){hint.textContent=message;hint.style.color=error?'#a72c2c':'#334c68';}
 function stop(){run++;clearTimeout(timer);timer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;video.hidden=true;button.textContent='手机连续扫码';}
 function refresh(){if(destroyed)return;const n=values().length,q=Number(row.qty.value);progress.textContent='已扫 '+n+'/'+(Number.isSafeInteger(q)&&q>0?q:'—')+' 台';list.innerHTML=values().map((no,i)=>'<p><span>'+(i+1)+'. '+E(no)+'</span> <button type="button" data-remove-direct-serial="'+i+'" class="secondary">移除</button></p>').join('');if(stream&&n>=q){stop();feedback(n===q?'本行已扫齐，请核对型号和串号后提交。':'串号超过本行数量，请核对。',n!==q);}}
 function add(raw){if(isLocked()||destroyed)return false;const p=product();if(!p?.trackSerial){feedback('先选择本行手机型号。',true);return false;}try{const no=directSerialCandidate(raw,p,state.inventory.flatMap(p=>(p.serials||[]).map(s=>s.no)),getRows().flatMap(r=>String(r.serials.value||'').trim().split(/[\s,，]+/).filter(Boolean)),Number(row.qty.value));if(values().length>=Number(row.qty.value)){feedback('本行已经扫齐；增加数量后再扫。',true);stop();return false;}row.serials.value=[...values(),no].join('\n');row.serials.dispatchEvent(new Event('input',{bubbles:true}));sync();feedback('已加入 '+no+'。'+(values().length===Number(row.qty.value)?'本行已扫齐，请核对型号。':'请扫下一台。'));refresh();return true;}catch(e){feedback(e.message,true);return false;}}
 button.onclick=async()=>{if(stream){stop();feedback('已停止扫码。');return;}if(isLocked())return;const p=product(),q=Number(row.qty.value);if(!p?.trackSerial){feedback('先选择本行手机型号。',true);return;}if(!Number.isSafeInteger(q)||q<1){feedback('先填写本行数量。',true);return;}if(values().length>=q){feedback('本行已扫齐；增加数量后再继续。');return;}if(!navigator.mediaDevices?.getUserMedia||!window.SaleCapture?.decode){feedback('当前浏览器未准备好扫码，请刷新或换用支持相机的手机浏览器。',true);return;}for(const other of getRows())if(other!==row)other.scan?.stop();const active=++run;last='';lastAt=0;try{const captured=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(active!==run||!block.isConnected||!form.isConnected||isLocked()){captured.getTracks().forEach(t=>t.stop());return;}stream=captured;video.srcObject=stream;video.hidden=false;await video.play();button.textContent='停止扫码';feedback('当前型号：'+p.name+'。连续扫每台完整串号；新货请核对包装型号。');const frame=async()=>{if(active!==run||!stream)return;if(!form.isConnected||!block.isConnected||document.hidden||isLocked()){stop();return;}try{if(video.videoWidth){const raw=await window.SaleCapture.decode(video);if(active!==run)return;if(raw&&(raw!==last||Date.now()-lastAt>2000)){last=raw;lastAt=Date.now();add(raw);}}}catch(e){feedback('这一帧未识别，请移动镜头对准串号条码。');}if(active===run&&stream)timer=setTimeout(frame,350);};frame();}catch{if(active===run){stop();feedback('相机未能打开，请在手机浏览器允许相机权限后重试。',true);}}};
 list.onclick=e=>{const b=e.target.closest('[data-remove-direct-serial]');if(!b||isLocked())return;const all=values();all.splice(Number(b.dataset.removeDirectSerial),1);row.serials.value=all.join('\n');sync();refresh();feedback('已移除，请核对实物后重新扫码。');};
 const visibility=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',visibility);const pageHide=()=>stop();window.addEventListener('pagehide',pageHide);const beforeSubmit=()=>stop();form.addEventListener('submit',beforeSubmit,true);const observer=new MutationObserver(()=>{if(!form.isConnected||!block.isConnected)destroy();});observer.observe(document.body,{childList:true,subtree:true});function destroy(){if(destroyed)return;destroyed=true;stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pageHide);form.removeEventListener('submit',beforeSubmit,true);}refresh();return {refresh,stop,destroy,add};
}

function directPurchasePayload(data,rows,products,suppliers){
 if(!rows.length)throw new Error('请添加入库商品');let totalCents=0;const seen=new Set();
 const items=rows.map((row,index)=>{const label='商品 '+(index+1)+'：',skuId=data[row.sku.name],p=products.find(p=>p.skuId===skuId);if(!p)throw new Error(label+'请先按分类选择具体商品');const warehouseId=data[row.warehouse.name];if(!warehouseId)throw new Error(label+'请选择本次入库仓库');const quantity=Number(data[row.qty.name]),cents=modalPaymentCents(data[row.cost.name]);if(!Number.isSafeInteger(quantity)||quantity<1)throw new Error(label+'数量须为正整数');if(cents===null||!Number.isSafeInteger(cents*quantity))throw new Error(label+'请填写实际进货价，赠品可填0');totalCents+=cents*quantity;if(!Number.isSafeInteger(totalCents)||totalCents>100000000000)throw new Error('入库合计超出范围，请分单登记');const serials=p.trackSerial?String(data[row.serials.name]||'').trim().split(/[\s,，]+/).filter(Boolean).map(no=>directSerialCandidate(no,p,[],[],quantity)):[];if(p.trackSerial&&serials.length!==quantity)throw new Error(label+'串号数量须与入库数量一致');for(const no of serials){if(seen.has(no))throw new Error(label+'串号重复，请核对 '+no);seen.add(no);}return {skuId,warehouseId,quantity,costPrice:cents/100,serials};});
 const adding=data.supplierId==='__new_supplier__',supplier=adding?String(data.supplierName||'').trim():suppliers.find(s=>s.id===data.supplierId)?.name;if(!supplier)throw new Error(adding?'请填写新增往来单位名称':'请选择往来单位');
 return {supplierId:adding?'':data.supplierId,supplier,...(adding?{supplierContact:String(data.supplierContact||'').trim()}:{}),invoiceNo:data.invoiceNo||'',dueDate:data.dueDate||'',paidAmount:0,items};
}
function directPurchaseEditor(){
 const products=state.products.filter(p=>p.stockManaged!==false&&p.active!==false),fields=[
  {name:'supplierId',label:'往来单位',options:[{value:'',label:'请选择往来单位'},...state.suppliers.map(s=>({value:s.id,label:s.name})),{value:'__new_supplier__',label:'＋ 新增往来单位'}],required:true},
  {name:'supplierName',label:'新增往来单位名称'},{name:'supplierContact',label:'联系方式（选填）'},
  {name:'invoiceNo',label:'往来单位发票号码（选填）'},
  {name:'dueDate',label:'应付日期',type:'date',inlineHint:'入库建立应付，实际付款在往来对账中登记。'}
 ];let nextLine=0;const lines=new Map();
 modal('直接采购入库 · 多商品',fields,(data,write)=>{const payload=directPurchasePayload(data,[...lines.values()],products,state.suppliers);return write('/api/purchase-orders',payload).then(result=>({...result,message:'本单 '+payload.items.length+' 行商品已入库，已建立应付；请核对本单明细。'}));},'同一供货商可一次录入多项商品。各项分别填写实际进货价；手机逐台填写串号，厂家赠品允许填0。');
 const form=$('modal-form'),root=form.closest('#modal-root'),host=document.createElement('div');host.className='field wide';host.setAttribute('data-direct-purchase-lines','');if(!products.length){const note=document.createElement('p');note.setAttribute('role','status');note.textContent='当前没有可入库的商品档案。请先在基础资料中新增商品，再回本页入库。';host.append(note);}form.querySelector('.fields').append(host);const toolbar=document.createElement('div');toolbar.className='field wide';toolbar.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:12px';const add=document.createElement('button');add.type='button';add.className='secondary';add.textContent='＋ 添加商品';const summary=document.createElement('strong');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');toolbar.append(add,summary);form.querySelector('.fields').append(toolbar);
 const locked=()=>root.dataset.submitting==='1'||root.dataset.uncertain==='1';
 function sync(){let qty=0,total=0,valid=true,index=0;for(const row of lines.values()){index++;row.title.textContent='商品 '+index;row.remove.disabled=lines.size<=1;row.scan?.refresh();const p=products.find(p=>p.skuId===row.sku.value),q=Number(row.qty.value),cents=modalPaymentCents(row.cost.value);row.serials.closest('.field').hidden=!p?.trackSerial;row.serials.required=!!p?.trackSerial;row.info.textContent=p?(p.trackSerial?'按串号入库':'按数量入库')+' · 本次选择 '+(state.warehouses.find(w=>w.id===row.warehouse.value)?.name||'仓库待选'):'先选分类，再选具体商品';if(!p||!row.warehouse.value||!Number.isSafeInteger(q)||q<1||cents===null||!Number.isSafeInteger(q*cents)){valid=false;continue;}qty+=q;total+=q*cents;if(!Number.isSafeInteger(total)||!Number.isSafeInteger(qty))valid=false;}summary.textContent=lines.size+' 行商品 · '+(valid?qty+' 件 · 合计 '+M(total/100):'请填齐商品、仓库、数量和实际进货价');}
 function addLine(){if(locked())return;if(lines.size>=100){toast('一张入库单最多100行商品，请分单登记',true);return;}const key=++nextLine,names={sku:'directSku_'+key,warehouse:'directWarehouse_'+key,qty:'directQty_'+key,cost:'directCost_'+key,serials:'directSerials_'+key},descriptors=[{name:names.sku,label:'商品 '+key,required:true,options:[{value:'',label:'请选择商品'},...products.map(p=>({value:p.skuId,label:p.name}))]},{name:names.warehouse,label:'本次入库仓库',required:true,options:[{value:'',label:'请选择仓库'},...state.warehouses.filter(w=>w.active!==false).map(w=>({value:w.id,label:w.name}))]},qtyField(names.qty,'数量',1),{...moneyField(names.cost,'实际进货价'),inlineHint:'厂家赠品填0；空白表示尚未填写。'},{name:names.serials,label:'手机串号（每行一个）',type:'textarea',wide:true,inlineHint:'串号数量须与本行数量一致，同一串号不能出现在多行。'}];fields.push(...descriptors);const block=document.createElement('section');block.style.cssText='border:1px solid #b6c9ed;border-radius:10px;padding:12px;margin-bottom:20px';block.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px"><strong data-line-title></strong><button type="button" class="secondary" data-remove-line>删除此行</button></div><p data-row-info></p><div class="fields">'+descriptors.map(formField).join('')+'</div>';host.append(block);const row={sku:form.elements[names.sku],warehouse:form.elements[names.warehouse],qty:form.elements[names.qty],cost:form.elements[names.cost],serials:form.elements[names.serials],title:block.querySelector('[data-line-title]'),remove:block.querySelector('[data-remove-line]'),info:block.querySelector('[data-row-info]')};lines.set(key,row);row.sku.addEventListener('change',()=>{row.scan?.stop();row.cost.value='';row.serials.value='';sync();});attachPurchaseCategoryPicker(row.sku,products,'商品 '+key);row.scan=mountDirectSerialScanner({row,block,form,products,getRows:()=>[...lines.values()],sync,isLocked:locked});row.remove.onclick=()=>{if(locked()||lines.size<=1)return;row.scan?.destroy();lines.delete(key);for(const f of descriptors){const i=fields.indexOf(f);if(i>=0)fields.splice(i,1);}block.remove();sync();};sync();}
 add.onclick=addLine;form.addEventListener('input',sync);form.addEventListener('change',sync);addLine();
 const syncSupplier=()=>{const adding=form.elements.supplierId.value==='__new_supplier__';for(const name of ['supplierName','supplierContact']){const input=form.elements[name];input.closest('.field').hidden=!adding;input.disabled=!adding;input.required=adding&&name==='supplierName';}};form.elements.supplierId.addEventListener('change',syncSupplier);syncSupplier();exposeNewChoice(form,'supplierId','__new_supplier__','supplierName');enhancePurchaseSupplier(form);
}

function purchaseEditor(mode,planId="") {
  if(mode!=="plan"&&!planId)return directPurchaseEditor();
  if(mode==="plan")return procurementPlanEditor();
  const plan=state.plans?.find((p)=>p.id===planId);
  const planItems=plan?.items.filter((i)=>i.quantity>i.received)||[];
  const products=state.products.filter((p)=>p.stockManaged!==false&&p.active!==false);
  modal(mode==="plan"?"新建订货":plan?"订货分批收货":"直接采购入库",[
    {name:"supplierId",label:"往来单位",options:[{value:"",label:"请选择往来单位"},...state.suppliers.map((s)=>({value:s.id,label:s.name})),...(!plan?[{value:"__new_supplier__",label:"＋ 新增往来单位"}]:[])],value:plan?.supplierId,required:true},
    ...(!plan?[{name:"supplierName",label:"新增往来单位名称",inlineHint:"名单中没有时填写，可直接接着入库或订货。"},{name:"supplierContact",label:"联系方式（选填）",hint:"可以写联系人姓名、电话等；暂时不知道可留空。"}]:[]),
    plan?{name:"planItemId",label:"待收商品",options:[{value:"",label:"请选择实际收到的商品"},...planItems.map((i)=>({value:i.id,label:`${i.name} · 待收 ${i.quantity-i.received}`}))],required:true}:{name:"skuId",label:"商品",options:[{value:"",label:"请选择商品"},...products.map((p)=>({value:p.skuId,label:p.name}))],required:true},
    {name:"warehouseId",label:"本次收货仓库",options:[{value:"",label:"请选择仓库"},...state.warehouses.filter(w=>w.active!==false).map(w=>({value:w.id,label:w.name}))],required:true},
    qtyField("quantity","数量",planItems[0]?planItems[0].quantity-planItems[0].received:1),{...moneyField("costPrice",mode==="plan"?"预计进货价":"进货价",planItems[0]?.costPrice??""),inlineHint:mode==="plan"?"订货预计价，收货时核实实际进货价。":"填写本次实际进货单价；厂家赠送请明确填0，允许0元入库。空白表示未填价。入库后录错由老板办理更正。"},
    {name:"serials",label:"串号（串号商品必填）",type:"textarea",wide:true,inlineHint:"数量须与串号数一致。",hint:"串码商品每行一个串码，数量须一致"},
    ...(mode!=="plan"?[{name:"invoiceNo",label:"往来单位发票号码（选填）"}]:[]),
    ...(!plan&&mode!=="plan"?[{name:"dueDate",label:"应付日期",type:"date",inlineHint:"入库只建立应付；实际付款请在往来单位往来中登记，可选多个付款账户。"}]:[]),
  ],(d,write)=>{
    const item=plan?planItems.find((x)=>x.id===d.planItemId):null;
    const serials=d.serials.split(/[\s,，]+/).filter(Boolean);
    if(!plan&&!products.some(p=>p.skuId===d.skuId))throw new Error("请先选择一级分类，再选择具体商品");
    const newSupplier=!plan&&d.supplierId==="__new_supplier__";
    const supplierName=newSupplier?String(d.supplierName||"").trim():state.suppliers.find((s)=>s.id===d.supplierId)?.name;
    if(newSupplier&&!supplierName)throw new Error("请填写新增往来单位名称");
    const data={invoiceNo:d.invoiceNo,supplierId:newSupplier?"":d.supplierId,supplier:supplierName,...(newSupplier?{supplierContact:String(d.supplierContact||"").trim()}:{}),items:[{skuId:item?.skuId||d.skuId,warehouseId:d.warehouseId,quantity:Number(d.quantity),costPrice:Number(d.costPrice),serials,...(item?{planItemId:item.id}:{})}]};
    if(plan){data.planId=plan.id;data.receiptToken=plan.receiptToken;}
    else if(mode!=="plan"){data.paidAmount=0;data.dueDate=d.dueDate;}
    return write(mode==="plan"?"/api/procurement-plans":"/api/purchase-orders",data).then(result=>mode!=="plan"&&result.items?.some(i=>i.qrCode)?{...result,message:"入库成功，二维码已生成；点本单的二维码标签可预览、打印或补打。"}:result);
  });
  const form=$("modal-form");
  if(!plan){
    const syncSupplierChoice=()=>{const adding=form.elements.supplierId.value==="__new_supplier__";for(const name of ["supplierName","supplierContact"]){const input=form.elements[name];input.closest(".field").hidden=!adding;input.disabled=!adding;input.required=adding&&name==="supplierName";}};
    form.elements.supplierId.addEventListener("change",syncSupplierChoice);syncSupplierChoice();
    exposeNewChoice(form,"supplierId","__new_supplier__","supplierName");enhancePurchaseSupplier(form);attachPurchaseCategoryPicker(form.elements.skuId,products,"商品");form.elements.skuId.addEventListener("change",()=>{form.elements.costPrice.value="";});
  }
  if(plan){
    const supplier=form.elements.supplierId;
    supplier.setAttribute("aria-disabled","true");
    supplier.title="订货单往来单位已固定";
    supplier.style.pointerEvents="none";
    supplier.tabIndex=-1;
    form.elements.planItemId.addEventListener("change",()=>{
      const item=planItems.find((row)=>row.id===form.elements.planItemId.value);
      if(!item)return;
      form.elements.quantity.value=String(item.quantity-item.received);
      form.elements.costPrice.value=String(item.costPrice??0);
    });
  }else{
    form.elements.skuId.addEventListener("change",()=>{
      const product=products.find((row)=>row.skuId===form.elements.skuId.value);
      form.elements.costPrice.value="";
    });
  }
}

function purchasePriceCorrection(orderId) {
  if(state.user.roleCode!=="owner")return toast("进货价更正由老板操作",true);
  const order=state.purchaseOrders?.find(row=>row.id===orderId);
  if(!order)return toast("请刷新后选择原入库单",true);
  const first=order.items[0];if(!first)return toast("原入库明细不存在",true);
  let prepared=null,confirmedSubmission=null;
  const reference="JC-"+Date.now();
  modal("更正录错的进货价",[
    {name:"itemId",label:"原入库商品",options:order.items.map(i=>({value:i.id,label:i.name+" × "+i.quantity})),value:first.id,required:true},
    {name:"oldPrice",label:"当前录入的进货价",value:M(first.recordedCostPrice??first.costPrice)},
    {...moneyField("newUnitPrice","正确进货价",first.recordedCostPrice??first.costPrice),inlineHint:"更正录入错误；供货商降价补差请使用往来单位中的调价补差。"},
    {name:"reference",label:"更正凭证号",value:reference,required:true},
    {name:"reason",label:"录错原因与核对依据",type:"textarea",wide:true,required:true},
  ],async(d,write)=>{
    const payload={supplierId:order.supplierId,purchaseId:order.id,itemId:d.itemId,newUnitPrice:Number(d.newUnitPrice),reference:d.reference,reason:d.reason};
    const signature=JSON.stringify(payload),root=$("modal-root");
    if(confirmedSubmission?.uncertain&&confirmedSubmission.signature!==signature){const error=new Error("上次更正结果待核对，请按原内容重试后再改。");error.uncertain=true;throw error;}
    if(!prepared||prepared.signature!==signature){
      let preview;try{preview=await api("/api/purchase-price-corrections/preview",{method:"POST",body:JSON.stringify(payload)});}catch(error){error.uncertain=false;throw error;}
      prepared={signature,preview};
      $("purchase-correction-preview")?.remove();
      const panel=document.createElement("section");panel.id="purchase-correction-preview";panel.className="card";panel.setAttribute("aria-live","polite");
      panel.innerHTML=`<h3>请核对更正结果</h3><p>进货价：<strong>${M(preview.currentRecordedPrice)} → ${M(preview.correctedUnitPrice)}</strong></p><p>数量：${E(preview.quantity)} · 采购差额：${M(preview.priceDelta)}</p><p>库存成本变化：${M(preview.inventoryDelta)}<br>已售成本变化：${M(preview.salesDelta)}<br>已售毛利变化：${M(-preview.salesDelta)}</p><p>${E(preview.accountingNote||"未付货款先调整待付；多付部分记应退；本次不登记实际收付款。")}</p><p>原入库记录保留，更正记录另存；已核定或发放的工资不会覆盖。</p><p><strong>核对无误后，再点“确认更正”。</strong></p>`;
      root.querySelector(".form-actions").before(panel);root.dataset.nextSubmitCaption="确认更正";panel.scrollIntoView({block:"nearest"});return false;
    }
    confirmedSubmission||={signature,body:{...payload,previewToken:prepared.preview.previewToken,confirmed:true},uncertain:false};
    try{const result=await write("/api/purchase-price-corrections",confirmedSubmission.body);return {...result,message:"进货价已更正，库存、已售成本及往来账已同步；原入库记录保留。"};}
    catch(error){if(error.uncertain)confirmedSubmission.uncertain=true;else{prepared=null;confirmedSubmission=null;root.dataset.nextSubmitCaption="预览更正";$("purchase-correction-preview")?.remove();}throw error;}
  },"仅用于进货价录错。先预览影响，再由老板确认；关账或来源不完整时须先核对。");
  const form=$("modal-form"),root=$("modal-root");form.elements.oldPrice.readOnly=true;root.dataset.nextSubmitCaption="预览更正";form.querySelector("button[type=submit]").textContent="预览更正";
  const reset=()=>{if(confirmedSubmission?.uncertain)return;prepared=null;confirmedSubmission=null;root.dataset.nextSubmitCaption="预览更正";form.querySelector("button[type=submit]").textContent="预览更正";$("purchase-correction-preview")?.remove();};
  form.addEventListener("input",reset);form.addEventListener("change",reset);
  form.elements.itemId.addEventListener("change",()=>{const item=order.items.find(i=>i.id===form.elements.itemId.value);if(item){form.elements.oldPrice.value=M(item.recordedCostPrice??item.costPrice);form.elements.newUnitPrice.value=String(item.recordedCostPrice??item.costPrice);}});
}
async function renderSuppliers() {
  const focusSupplier=new URLSearchParams(location.search).get("supplierId");
  if(focusSupplier&&state.supplierDeepLink!==focusSupplier){state.supplierDeepLink=focusSupplier;state.supplierId=focusSupplier;await go("supplier-detail");return;}
  const current=officePageCurrent("suppliers");
  const data=await officePageRead(current,()=>api("/api/suppliers"));if(!current())return;state.suppliers=data.rows;
  const rows=data.rows.map((s)=>`<tr><td data-label="往来单位" class="record-title"><strong>${E(s.name)}</strong><small>${E(s.contact)}</small></td><td data-label="待付"><span class="record-value money-value">${M(s.payable)}</span></td><td data-label="应退"><span class="record-value money-value">${M(s.cash)}</span></td><td data-label="预付"><span class="record-value money-value">${M(s.advance)}</span></td><td data-label="仅抵货款"><span class="record-value money-value">${M(s.credit)}</span></td><td data-label="操作">${button("查看往来","supplier-detail",s.id)}</td></tr>`);
  const totals=data.totals||{};
  $("main").innerHTML=heading("往来单位结算","待付、应退、预付、仅抵货款分别记账。",state.user.capabilities.catalogAdd?'<a class="button secondary" href="/master-data#party-basics">维护往来单位基础信息 ↗</a>':"")
    +recordSummary("查看往来单位往来汇总",`<div class="grid">${[["待付",totals.payable],["应退",totals.cash],["预付",totals.advance],["仅抵货款",totals.credit]].map(([label,value])=>`<div class="stat"><span>${label}</span><strong class="money-value">${M(value)}</strong></div>`).join("")}</div>`)
    +`<div class="card mobile-record-list supplier-list">${table(["往来单位","待付","应退","预付","仅抵货款","操作"],rows)}</div>`;
}

function supplierEditor(id="") {
  const s=state.suppliers?.find((row)=>row.id===id)||{};
  modal(id?"编辑往来单位":"新增往来单位",[{name:"name",label:"主体名称",value:s.name,required:true},{name:"contact",label:"联系方式",value:s.contact},{name:"note",label:"备注",value:s.note,type:"textarea",wide:true}],(d,write)=>write("/api/suppliers",{...d,...(id?{id}:{})}));
}
async function renderSupplierDetail(id) {
  const current=officePageCurrent("supplier-detail");
  state.supplierId=id;
  const data=await officePageRead(current,()=>api(`/api/supplier-detail?id=${encodeURIComponent(id)}`));if(!current()||state.supplierId!==id)return;state.supplierDetail=data;
  const b=data.balances||{};
  const entries=(data.entries||[]).slice().reverse().slice(0,100).map((e)=>`<tr><td data-label="业务" class="record-title">${E(e.title)}</td><td data-label="类别">${E({payable:"待付",cash:"应退",advance:"预付",credit:"仅抵"}[e.kind]||e.kind)}</td><td data-label="未结金额"><span class="record-value money-value">${M(e.remaining)}</span></td><td data-label="编号"><span class="record-value record-code">${E(documentNo(e))}</span>${redPacketEntry("supplierEntries",e)}</td></tr>`);
  const logs=(data.settlements||[]).slice(0,80).map((l)=>`<tr><td data-label="类型" class="record-title">${E(label("settlement",l.type||l.logType))}</td><td data-label="金额"><span class="record-value money-value">${M(l.amount)}</span></td><td data-label="时间"><span class="record-value">${E(displayTime(l.createdAt))}</span></td><td data-label="操作">${redPacketEntry("supplierSettlements",l)}${l.type==="payment"||l.type==="offset"?button("撤销分配","reverse-offset",l.id,"danger"):""}</td></tr>`);
  const canSettle=state.user.capabilities.supplierSettle,canAdjust=state.user.roleCode==="owner"&&state.user.capabilities.supplierAdjust;
  $("main").innerHTML=heading(data.supplier.name,"往来单位往来明细",button("返回往来单位结算","back-suppliers"))+
    recordSummary("查看该往来单位余额",`<div class="grid">${[["待付",b.payable],["应退",b.cash],["预付",b.advance],["仅抵货款",b.credit]].map(([label,value])=>`<div class="stat"><span>${label}</span><strong class="money-value">${M(value)}</strong></div>`).join("")}</div>`)+
    `<div class="card"><h2>办理往来</h2><div class="actions">${canSettle?button("付款 / 预付","supplier-payment")+button("收到退款","supplier-refund")+button("抵扣货款","supplier-offset"):""}${state.user.capabilities.opening?button("登记期初","supplier-opening"):""}${canAdjust?button("往来调整","supplier-adjustment")+button("调价补差","supplier-price")+button("采购退货","supplier-return"):""}${button("对账单","supplier-statement")}</div></div>`+
    `<div class="card mobile-record-list"><h2>未结款项</h2>${table(["业务","类别","未结金额","编号"],entries)}</div><div class="card mobile-record-list"><h2>核销记录</h2>${table(["类型","金额","时间","操作"],logs)}</div>`+`<section class="card"><h2>已生成的往来单据</h2>${[["supplierCash",data.cash],["supplierAdjustments",data.adjustments],["purchaseReturns",data.returns]].map(([collection,rows])=>(rows||[]).slice(0,40).map(row=>`<article><strong>${E(documentNo(row))}</strong> · ${E(row.type||row.status||"往来记录")} ${redPacketEntry(collection,row)}</article>`).join("")).join("")}</section>`;
}
function supplierAction(kind) {
  const detail=state.supplierDetail;if(!detail)return;
  const entries=detail.entries||[];
  const sources=entries.filter((e)=>e.kind!=="payable"&&e.remaining>0);
  const targets=entries.filter((e)=>e.kind==="payable"&&e.remaining>0);
  const sid=state.supplierId;
  const sourceOptions=sources.map((e)=>({value:e.id,label:`${e.title} · ${M(e.remaining)}`}));
  const targetOptions=targets.map((e)=>({value:e.id,label:`${e.title} · ${M(e.remaining)}`}));
  const note={name:"note",label:"备注 / 核对依据",type:"textarea",wide:true};
  if(kind==="payment"){
    modal("登记付款或预付",[moneyField("amount","实际付款金额"),accountField,{name:"accountOwnerId",label:"实际付款人",options:[{value:"",label:"请选择付款人"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.finance).map((u)=>({value:u.id,label:u.name}))],required:true},{name:"reference",label:"付款流水号",required:true},{name:"targetId",label:"本次核销的待付款项",options:[{value:"",label:"不核销，留作预付"},...targetOptions]},{name:"planId",label:"关联订货",options:[{value:"",label:"不关联订货"},...(detail.plans||[]).filter((p)=>p.status==="open"&&p.paymentReview?.status==="approved"&&p.approvedRemaining>0).map((p)=>({value:p.id,label:documentNo(p)+" · 余可付 "+M(p.approvedRemaining)}))]},note],(d,write)=>write("/api/supplier-payments",{supplierId:sid,amount:Number(d.amount),payments:d.payments,planId:d.planId||undefined,allocations:d.targetId?[{targetId:d.targetId,amount:Number(d.amount)}]:[],note:d.note}),"只登记实际付款；各笔金额合计须等于本次金额。",{mode:"pay",requireReference:true});
  } else if(kind==="refund"){
    modal("登记往来单位退款",[{name:"sourceId",label:"退款来源",options:sourceOptions.filter((e)=>entries.find((x)=>x.id===e.value)?.kind!=="credit"),required:true},moneyField("amount","已到账金额"),accountField,{name:"accountOwnerId",label:"实际收款人",options:[{value:"",label:"请选择收款人"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.finance).map((u)=>({value:u.id,label:u.name}))],required:true},note],(d,write)=>write("/api/supplier-refunds",{supplierId:sid,...d,amount:Number(d.amount)}),"只登记已实际到账的退款。",{mode:"receive"});
  } else if(kind==="offset"){
    modal("抵扣应付款",[{name:"sourceId",label:"抵扣来源",options:sourceOptions,required:true},{name:"reference",label:"付款流水号",required:true},{name:"targetId",label:"待付款项",options:targetOptions,required:true},moneyField("amount","抵扣金额"),note],(d,write)=>write("/api/supplier-offsets",{supplierId:sid,...d,amount:Number(d.amount)}),"抵扣不产生现金收付。");
  } else if(kind==="opening"){
    modal("往来单位期初登记",[{name:"date",label:"期初日期",type:"date",value:new Date().toISOString().slice(0,10),required:true},...[["payable","待付"],["cash","应退"],["advance","预付"],["credit","仅抵货款"]].map(([name,label])=>moneyField(name,label,0)),{...note,required:true}],(d,write)=>write("/api/supplier-opening",{supplierId:sid,...d}));
  } else if(kind==="adjustment"){
    modal("有依据的往来调整",[{name:"type",label:"调整类型",options:[{value:"rebate",label:"非购货返利"},{value:"reimbursement",label:"费用报销"},{value:"charge",label:"追加应付"},{value:"correction",label:"更正"}]},{name:"kind",label:"往来方向",options:[{value:"cash",label:"对方应退款"},{value:"credit",label:"仅抵货款"},{value:"payable",label:"我方待付"},{value:"advance",label:"预付"}]},moneyField("amount","金额"),{name:"reference",label:"往来单位确认编号",required:true},{...note,required:true}],(d,write)=>write("/api/supplier-adjustments",{supplierId:sid,...d,nature:"non_purchase",amount:Number(d.amount)}));
  }
}
async function supplierCostAction(mode) {
  const sid=state.supplierId,current=officePageCurrent("supplier-detail");
  const candidates=await officePageRead(current,()=>api(`/api/supplier-candidates?id=${encodeURIComponent(sid)}`));
  if(!current()||state.supplierId!==sid)return;
  const options=candidates.map((p)=>({value:p.itemId,label:`${p.name} · ${documentRef(p,"purchaseId")} · 进价 ${M(p.costPrice)}`}));
  if(!options.length)return toast("没有可追溯的进货记录",true);
  const fields=[{name:"itemId",label:"原采购商品",options,required:true},{name:"scope",label:"范围",options:[{value:"inventory",label:"当前库存"},{value:"all",label:"全部可追溯商品"},{value:"selected",label:"仅选定串码"}]},
    {name:"direction",label:"调价方向",options:[{value:"decrease",label:"往来单位降价"},{value:"increase",label:"往来单位涨价"}]},
    {name:"kind",label:"返还方式",options:[{value:"cash",label:"往来单位应退款"},{value:"credit",label:"仅抵货款"}]},
    ...(mode==="price"?[moneyField("unitAmount","每件补差金额",0)]:[qtyField("quantity","数量",1),moneyField("unitPrice","退货单价",0)]),
    {name:"serialNos",label:"指定串号（串号商品必填）",type:"textarea",wide:true,hint:"每行一个；串码商品必须选择"},{name:"reference",label:"往来单位确认编号",required:true},{name:"note",label:"双方确认依据",type:"textarea",wide:true,required:true}];
  let confirmedSubmission=null;
  modal(mode==="price"?"调价补差":"申请采购退货",fields,async(d,write)=>{
    const candidate=candidates.find((p)=>p.itemId===d.itemId);
    const payload={supplierId:sid,purchaseId:candidate.purchaseId,itemId:candidate.itemId,scope:d.scope,direction:d.direction,kind:d.kind,unitAmount:Number(d.unitAmount),quantity:Number(d.quantity),unitPrice:Number(d.unitPrice),serialNos:d.serialNos.split(/[\s,，]+/).filter(Boolean),reference:d.reference,note:d.note};
    if(mode==="return"){const result=await write("/api/purchase-return-requests",{...payload,confirmed:true});return {...result,message:result.message||"采购退货申请已提交，等待老板批准；库存和往来账尚未变化。"};}
    const prefix="/api/supplier-prices";
    const signature=JSON.stringify(payload);
    if(confirmedSubmission?.uncertain&&confirmedSubmission.signature!==signature){const error=new Error("上次入账结果待核对，请恢复原内容重试；确认后再改资料。");error.uncertain=true;throw error;}
    if(!confirmedSubmission||confirmedSubmission.signature!==signature){
      let preview;
      try{preview=await api(prefix+"/preview",{method:"POST",body:JSON.stringify(payload)});}
      catch(error){error.uncertain=false;error.message="预览尚未完成，未提交入账："+error.message;throw error;}
      if(!confirm(`${mode==="price"?"调价补差":"采购退货"}预览：金额 ${M(preview.amount)}，库存成本影响 ${M(preview.inventoryDelta)}。确认入账？`))return false;
      confirmedSubmission={signature,body:{...payload,previewToken:preview.previewToken,confirmed:true},uncertain:false};
    }
    try{return await write(prefix,confirmedSubmission.body);}
    catch(error){if(error.uncertain)confirmedSubmission.uncertain=true;else confirmedSubmission=null;throw error;}
  },mode==="price"?"提交前会按原采购记录预览成本分配。":"先提交申请，老板本人批准后才扣库存并登记往来单位往来。");
}
const financeBusinessNames={sale:"销售收款",cash_recharge:"空中充值收款",other_income:"其他收入",other_income_red:"其他收入红冲",refund:"销售退款",expense:"门店费用",expense_red:"费用红冲",air_funding:"空中充值平台付款",supplier_payment:"往来单位付款",supplier_refund:"往来单位退款",purchase:"采购付款",carrier:"移动酬金到账",carrier_clawback:"移动酬金扣回",carrier_rental:"移动业务结算到账",gov_subsidy:"国补平台返款",gov_subsidy_refund:"国补原路退回",payroll:"工资发放"};
function financeFilterValues(){state.financeFilters||={};return state.financeFilters;}
function financeFilter(data){const f=financeFilterValues(),options=data.filterOptions||{};const field=(name,title,choices)=>`<label>${title}<select name="${name}"><option value="">全部</option>${choices.map(item=>`<option value="${E(item.value)}"${f[name]===item.value?' selected':''}>${E(item.label)}</option>`).join('')}</select></label>`;return `<form id="finance-filter" class="card document-filter" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));align-items:end;gap:12px"><label>开始日期<input name="from" type="date" value="${E(f.from||'')}"></label><label>结束日期<input name="to" type="date" value="${E(f.to||'')}"></label>${field('kind','业务类型',(options.kinds||[]).map(x=>({value:x.value,label:x.label})))}${field('category','商品／业务分类',(options.categories||[]))}${field('employeeId','营业员／经办人',(options.employees||[]).map(x=>({value:x.id,label:x.name})))}${field('fundPartyKey','往来单位',(options.parties||[]).map(x=>({value:x.key,label:x.name})))}<label>单号 / 来源 / 名称<input name="q" type="search" maxlength="160" value="${E(f.q||'')}" placeholder="输入关键词"></label><button class="primary" type="submit">查询</button><button class="secondary" type="button" data-finance-all>清空筛选</button><p style="grid-column:1/-1;margin:0">空中充值归业务分类；商品类别按销售商品档案查询，命中时显示整笔资金流水。金额卡片显示全账套余额。</p></form>`;}
async function renderFinance() {
  const current=officePageCurrent("finance");
  const financeQuery=financeFilterValues();
  const data=await officePageRead(current,()=>api("/api/finance?"+new URLSearchParams(financeQuery)));if(!current())return;
  const rows=(data.receipts||[]).slice(0,150).map((r)=>`<tr><td>${E(r.transactionDate||displayTime(r.createdAt))}</td><td>${E(financeBusinessNames[r.kind]||data.filterOptions?.kinds?.find(x=>x.value===r.kind)?.label||"其他资金业务")}</td><td>${M(r.amount)}</td><td>${E(receiptAccountLabel(r))}</td><td>${E(documentNo(r))}<details><summary>完整流水编号</summary><code>${E(r.id)}</code></details>${redPacketEntry("receipts",r)}</td><td>${r.airFundingOrderId?`<a href="/air-accounts?order=${encodeURIComponent(r.airFundingOrderId)}">查看空充单</a>`:E(documentRef(r,"sourceId"))}${r.sourceId&&r.sourceId!==documentRef(r,"sourceId")?`<details><summary>完整来源编号</summary><code>${E(r.sourceId)}</code></details>`:""}</td></tr>`);
  $("main").innerHTML=heading("资金收支流水","实际资金进出与待付货款分别记录。",button("登记费用","add-expense","","primary"))+
    `${financeFilter(data)}<div class="grid"><div class="stat"><span>全账套往来单位待付</span><strong>${M(data.payable)}</strong></div><div class="stat"><span>全账套往来单位应退</span><strong>${M(data.supplierTotals?.cash)}</strong></div></div><div class="card"><p>符合条件 ${E(data.receiptCount??data.receipts?.length??0)} 笔${(data.receiptCount??0)>150?'，当前显示前 150 笔':''}</p>${table(["时间","业务","金额","账户","流水单号","来源"],rows)}</div>`;
  const filterForm=$("finance-filter");filterForm.onsubmit=async event=>{event.preventDefault();state.financeFilters=Object.fromEntries(new FormData(filterForm));await renderFinance().catch(showError);};filterForm.querySelector('[data-finance-all]').onclick=async()=>{state.financeFilters={};await renderFinance().catch(showError);};
  $("main").insertAdjacentHTML("beforeend",'<div class="actions"><a class="secondary" href="/app?tab=receipts">收款单</a><a class="secondary" href="/app?tab=payments">付款单</a><a class="secondary" href="/app?tab=red">单据红冲</a></div>');
}
function expenseEditor() { modal("登记门店费用",[{name:"type",label:"费用名称",required:true},moneyField("amount","金额"),accountField],(d,write)=>write("/api/expenses",{...d,amount:Number(d.amount)}),"只登记已实际付出的费用，不会自动扣款。",{mode:"pay"}); }
async function renderCards() {
  const current=officePageCurrent("cards");
  const data=await officePageRead(current,()=>api("/api/card-businesses"));if(!current())return;state.cards=data.rows;
  const rows=data.rows.map((c)=>`<tr><td>${E(c.cardNo||documentNo(c))}<small>${E(c.carrier)} · ${E(c.packageName)}</small></td><td>${M(c.expected)}</td><td>${M(c.confirmed)}</td><td>${M(c.received)}</td><td>${redPacketEntry("cardBusinesses",c)}${state.user.capabilities.finance?button("记录佣金","card-event",c.id):""}</td></tr>`);
  $("main").innerHTML=heading("号卡佣金","顾客售价与运营商佣金分别核算。",button("刷新","refresh"))+`<div class="card">${table(["号卡","预计","已确认","已到账","操作"],rows)}</div>`;
}
function cardEvent(id) { modal("登记运营商佣金",[{name:"type",label:"业务",options:[{value:"confirm",label:"确认佣金"},{value:"receive",label:"佣金到账"},{value:"adjust",label:"未到账调整"},{value:"clawback",label:"已到账扣回"}]},moneyField("amount","金额"),accountField,{name:"note",label:"备注",type:"textarea",wide:true}],(d,write)=>write("/api/card-events",{businessId:id,...d,amount:Number(d.amount)}),"确认和调整佣金不记现金；实际到账或扣回才选择收付款账户。",{mode:form=>form.elements.type.value==="clawback"?"pay":"receive",when:form=>["receive","clawback"].includes(form.elements.type.value)}); }
const payrollMonth=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit"}).format(new Date()).slice(0,7);
const payrollMoney=(value)=>value==null?"待核算":M(value);
const payrollRecordedMoney=value=>value==null||!Number.isFinite(Number(value))?"未记录":M(value);
const payrollKind={sale:"销售提成",business:"业务提成",carrier_rebate:"移动返费提成",reception_bonus:"历史业务提成",reception_bonus_adjustment:"历史业务提成调整",return:"退货回冲",gift:"赠品调整",assist_transfer:"协助分配",manual:"人工增减"};
const payrollStatus={missing:"缺提成记录待核对",pending:"待核定",accrued:"已计提",deferred:"待移动分期返费"};
const payrollCanManage=()=>state.user.roleCode==="owner";
function payrollFacts(items){return `<dl class="payroll-facts">${items.map(([name,value])=>`<div><dt>${E(name)}</dt><dd>${E(value)}</dd></div>`).join("")}</dl>`;}
function payrollBusinessSource(row){const kind=row.sourceType||row.businessKind;if(kind==='carrier'||kind==='air_recharge'){const href=kind==='carrier'?'/carrier?service='+encodeURIComponent(row.orderId):'/air-recharge';return `<a class="secondary payroll-source" href="${href}">${E(documentRef(row,'orderId'))} · 查看业务单</a>`;}return row.orderId?`<button type="button" class="payroll-source secondary" data-action="payroll-source" data-value="${E(row.orderId)}">${E(documentRef(row,'orderId'))} · 查看原单</button>`:'';}
function payrollRowCard(r,manage=false){
  const warnings=[r.baseSalary==null?"底薪未设置":"",r.pending?`${r.pending} 笔提成待核定`:"",r.missing?`${r.missing} 笔业务缺提成记录`:"",""].filter(Boolean);
  return `<article class="payroll-employee-card"><div class="payroll-card-head"><h2>${E(r.name)}</h2><span class="payroll-state">${E(label("payroll",r.status))}</span></div><div class="payroll-main-amount"><span>应发工资</span><strong>${E(payrollMoney(r.total))}</strong></div>${payrollFacts([["底薪",r.baseSalary==null?"未设置":M(r.baseSalary)],["业务提成",payrollMoney(r.commission)],["积分换算",r.pointWage==null?"原工资未计入积分":M(r.pointWage)],["人工增减",M(r.manualAdjustment??0)]])}${warnings.length?`<p class="payroll-attention">${E(warnings.join("；"))}</p>`:""}<div class="payroll-card-actions">${manage?button("查看明细","payroll-detail",r.employeeId):""}${manage&&r.status==="draft"?button("工资增减","payroll-adjustment",r.employeeId):""}${manage&&state.payroll.canConfirm&&r.total!=null&&r.status==="draft"?button("确认工资","confirm-pay",r.employeeId,"primary"):""}${manage&&r.status==="confirmed"?button("记录发放","paid-pay",r.id,"primary"):""}</div>${r.confirmedAt||r.paidAt?`<details class="payroll-evidence"><summary>审核与发放记录</summary>${payrollFacts([["确认时间",displayTime(r.confirmedAt)],["发放时间",displayTime(r.paidAt)],["发放账户",r.account||"—"]])}</details>`:""}</article>`;
}
function payrollEntryCard(entry){
 const kind=entry.businessKind==='repair'?'维修提成':payrollKind[entry.kind]||entry.reason||entry.kind||"业务提成";
 const rule=entry.mode==="piece"?`每件 ${M(entry.value)}`:entry.mode==="profit"?`按毛利 ${Number(entry.value||0)}%`:entry.mode==="carrier_percent"?`按移动实际到账 ${entry.value==null?'比例待设置':entry.value+'%'}`:entry.mode==="none"?"不计提成":entry.mode==="unconfigured"?"规则待设置":"按核定记录";
 return `<article class="payroll-line${entry.amount==null?" payroll-line-warning":""}"><div class="payroll-card-head"><strong>${E(entry.productName||kind)}</strong><span class="payroll-line-amount${Number(entry.amount)<0?" payroll-negative":""}">${E(payrollMoney(entry.amount))}</span></div><p class="payroll-line-kind">${E(kind)}${entry.quantity!=null?" · 数量 "+E(entry.quantity):""}</p><p>${E(displayTime(entry.createdAt||entry.date))}</p>${payrollBusinessSource(entry)}<details class="payroll-evidence"><summary>核算依据</summary>${payrollFacts([["提成规则",rule],["记录状态",entry.amount==null?"待核定":"已计提"],["记录编号",documentNo(entry)],["原因",entry.reason||"—"],...(entry.returnId?[["退货单",documentRef(entry,"returnId")]]:[]),...(entry.giftId?[["赠品单",documentRef(entry,"giftId")]]:[]),...(entry.assistId?[["协助单",documentRef(entry,"assistId")]]:[])])}</details></article>`;
}
function payrollSection(title,id,rows,open=false){return `<details class="payroll-section" id="${id}"${open?" open":""}><summary>${E(title)}<span>${rows.length}</span></summary><div class="payroll-section-body">${rows.length?rows.join(""):'<p class="empty">暂无记录</p>'}</div></details>`;}
function payrollSheet(detail,canResolve){
 const entries=detail.entries||[],checks=detail.businessChecks||[],installments=detail.carrierInstallments||[],used=new Set();
 const wageState=detail.rows?.[0]?.status==='paid'?'已发':'未发';
 const rows=checks.map(check=>{
  const base=entries.find(entry=>check.entryIds?.includes(entry.id));
  const linked=entries.filter(entry=>entry.originalId&&check.entryIds?.includes(entry.originalId)&&['gift','return','assist_transfer'].includes(entry.kind));
  linked.forEach(entry=>used.add(entry.id));
  const delta=linked.reduce((sum,entry)=>sum+Number(entry.amount||0),0);
  const amount=check.status==='accrued'?Number(check.amount||0)+delta:null;
  const rule=base?.mode==='profit'?`${Number(base.value)}%`:base?.mode==='piece'?`固定 ${M(base.value)}`:base?.mode==='none'?'不提成':check.status==='deferred'?'按移动返费':'待核定';
  const kind=check.businessKind==='repair'?'维修':check.sourceType==='carrier'?'移动业务':check.sourceType==='air_recharge'?'现金充值':'销售';
  const actions=payrollBusinessSource(check)+(canResolve&&check.status==='missing'&&check.sourceType?button('建待核定记录','payroll-ensure-business',check.orderId):'')+(canResolve&&check.status==='pending'&&check.entryIds?.length?button('核定','payroll-resolve-check',JSON.stringify({entryId:check.entryIds[0],orderId:check.orderId,itemId:check.itemId})):'');
  return `<tr class="${check.status==='accrued'?'':'payroll-sheet-warning'}"><td>${E(check.date||'')}</td><td>${E(documentRef(check,'orderId'))}</td><td>${E(kind)}</td><td>${E(check.productName)}</td><td>${E(check.quantity)}</td><td>${check.profit==null?'—':M(check.profit)}</td><td>${E(rule)}</td><td>—</td><td>—</td><td>${E(payrollMoney(amount))}${delta?`<small>含调整 ${M(delta)}</small>`:''}</td><td>${E(payrollStatus[check.status]||check.status)}${amount!=null?` · ${wageState}`:''}</td><td>${actions}</td></tr>`;
 });
 for(const part of installments){
  const rate=part.rate==null?'比例待设置':`${part.rate}%`;
  const actions=payrollBusinessSource({...part,sourceType:'carrier'})+(canResolve?button('设置比例','payroll-carrier-rate',JSON.stringify({id:part.orderId,rate:part.rate})): '');
  rows.push(`<tr class="${part.companyOutstanding?'payroll-sheet-warning':''}"><td>${E(part.month)}</td><td>${E(part.orderNo||documentRef(part,'orderId'))}</td><td>移动返费分期</td><td>${E(part.productName)}<small>移动预计 ${M(part.expected)}；确认 ${part.confirmed==null?'待确认':M(part.confirmed)}；到账 ${M(part.received)}</small></td><td>1 期</td><td>—</td><td>${E(rate)}</td><td>${E(payrollMoney(part.estimatedWage))}</td><td>${E(payrollMoney(part.unreceivedWage))}</td><td>—</td><td>${E(part.status)} · 预计工资未计入应发</td><td>${actions}</td></tr>`);
 }
 for(const entry of entries.filter(row=>!['sale','business'].includes(row.kind)&&!used.has(row.id))){
  rows.push(`<tr><td>${E(entry.date||'')}</td><td>${E(documentRef(entry,'orderId')||'—')}</td><td>${E(payrollKind[entry.kind]||entry.kind)}</td><td>${E(entry.reason||entry.productName||'工资调整')}${entry.receivedAmount!=null?`<small>本次移动到账 ${M(entry.receivedAmount)}</small>`:''}</td><td>—</td><td>—</td><td>${entry.kind==='carrier_rebate'?entry.value==null?'比例待设置':`${E(entry.value)}%`:['reception_bonus','reception_bonus_adjustment'].includes(entry.kind)?`${E(entry.value)}%`:'调整'}</td><td>—</td><td>—</td><td>${E(payrollMoney(entry.amount))}</td><td>${E(entry.amount==null?'待核定':`已计提 · ${wageState}`)}</td><td>${payrollBusinessSource(entry)}${canResolve&&entry.kind==='carrier_rebate'?button('设置比例','payroll-carrier-rate',JSON.stringify({id:entry.orderId,rate:entry.value})):''}</td></tr>`);
 }
 return `<section class="payroll-sheet"><h2>毛利提成与工资明细表</h2><p>每行一笔业务或一笔移动返费期次。移动预计工资和未到账工资单列，实际到账后才计入应发；赠品等已关联调整合并到原业务。</p><div class="payroll-sheet-scroll"><table><thead><tr><th>日期／月份</th><th>单号</th><th>业务</th><th>项目内容</th><th>数量</th><th>毛利</th><th>提成比例／方式</th><th>预计工资</th><th>未到账工资</th><th>计入工资</th><th>状态</th><th>查看／核定</th></tr></thead><tbody>${rows.length?rows.join(''):'<tr><td colspan="12">本月暂无业务工资记录</td></tr>'}</tbody></table></div></section>`;
}
function payrollPointSheet(detail){
 const rules=detail.pointRules||{},points=detail.points||[],row=detail.rows?.[0];
 const detailRows=points.map(point=>`<tr><td>${E(point.date||'')}</td><td>${E(point.sourceType==='reception'?'历史积分':point.sourceType==='learning'?'学习':'工作日志')}</td><td>${E(point.sourceType==='reception'?'历史已核定积分':(point.kind||'积分'))}</td><td>${E(documentRef(point,'sourceId'))}</td><td>${E(point.points)}</td><td>100 分＝1 元</td><td>${point.convertedAmount==null?'未计入原工资':M(point.convertedAmount)}</td><td>${point.convertedAmount==null?'历史工资保持原额':row?.status==='paid'?'已发':'未发'}</td></tr>`);
 return `<section class="payroll-sheet payroll-points-sheet"><h2>积分规则与换算表</h2><p>积分换算：100 分＝1 元。</p><div class="payroll-sheet-scroll"><table><thead><tr><th>核定日期</th><th>来源</th><th>积分项目</th><th>来源单号</th><th>积分</th><th>换算规则</th><th>计入工资</th><th>状态</th></tr></thead><tbody>${detailRows.length?detailRows.join(''):'<tr><td colspan="8">本月暂无已核定积分</td></tr>'}</tbody><tfoot><tr><th colspan="4">本月合计</th><th>${E(points.reduce((sum,p)=>sum+Number(p.points||0),0))}</th><th>100 分＝1 元</th><th>${row?.pointWage==null?'—':M(row.pointWage)}</th><th>${row?.status==='paid'?'已发':'未发'}</th></tr></tfoot></table></div></section>`;
}
async function renderPayroll(){
  const current=officePageCurrent("payroll");
  const month=state.month||payrollMonth();state.month=month;
  const canManage=payrollCanManage();
  if(!canManage)state.payrollView="details";
  const overview=await officePageRead(current,()=>api(`/api/payroll?month=${encodeURIComponent(month)}`));if(!current()||state.month!==month)return;state.payroll=overview;
  const view=state.payrollView||"details",manage=view==="manage"&&canManage;
  const available=overview.rows||[];
  let selected=state.payrollEmployeeId;
  if(!overview.canViewAll)selected=state.user.id;
  else if(!available.some(r=>r.employeeId===selected))selected=manage?"":available[0]?.employeeId||state.user.id;
  state.payrollEmployeeId=selected;
  let detail=overview;
  if(selected&&overview.canViewAll)detail=await officePageRead(current,()=>api(`/api/payroll?month=${encodeURIComponent(month)}&employeeId=${encodeURIComponent(selected)}`));
  if(!current()||state.month!==month||state.payrollEmployeeId!==selected)return;
  state.payrollDetail=detail;
  const staffSelect=!manage&&overview.canViewAll?`<label for="payroll-employee">员工<select id="payroll-employee">${available.map(r=>option(r.employeeId,r.name,r.employeeId===selected)).join("")}</select></label>`:"";
  const switches=canManage?`<div class="payroll-view-switch" role="group" aria-label="工资页面"><button type="button" data-action="payroll-manage-view" class="${manage?"primary":"secondary"}">工资管理</button><button type="button" data-action="payroll-details-view" class="${manage?"secondary":"primary"}">工资明细查询</button></div>`:"";
  const help="工资明细来自已登记业务和核定记录。对明细有疑问可复制核对记录，请老板核实。底薪、待核定及缺提成记录要核清后才能确认。确认后的工资保存原快照，后续更正另记可调整月份。已核定积分按100分＝1元换算进未确认工资；历史已确认工资保留原额。";
  $("main").innerHTML=heading(manage?"工资管理":"工资明细查询",help,overview.canManage?button("底薪与提成规则","pay-settings"):"")+switches+`<section class="payroll-controls"><label for="payroll-month">月份<input id="payroll-month" name="month" type="month" value="${E(month)}" required></label>${staffSelect}${manage?`<label for="payroll-employee-filter">查员工<input id="payroll-employee-filter" type="search" placeholder="输入姓名筛选"></label>`:""}</section><p id="payroll-feedback" class="payroll-feedback" role="status" aria-live="polite" hidden></p>`;
  if(manage){
    $("main").insertAdjacentHTML("beforeend",`<section id="payroll-overview" class="payroll-overview">${available.length?available.map(r=>`<div data-payroll-employee="${E(r.name)}">${payrollRowCard(r,true)}</div>`).join(""):'<p class="empty">暂无员工工资记录</p>'}</section>`);
  }else{
    const r=(detail.rows||[]).find(x=>x.employeeId===selected)||detail.rows?.[0];
    const checks=detail.businessChecks||[],missing=checks.filter(x=>x.status==="missing");
    const canResolve=detail.canManage&&r?.status==="draft";
    const checkCards=checks.map(x=>`<article class="payroll-line${x.status!=="accrued"?" payroll-line-warning":""}"><div class="payroll-card-head"><strong>${E(x.productName||"销售商品")}</strong><span class="payroll-state">${E(payrollStatus[x.status]||x.status)}</span></div><p>数量 ${E(x.quantity)} · 提成 ${E(payrollMoney(x.amount))}</p><p>${E(displayTime(x.createdAt||x.date))}</p>${payrollBusinessSource(x)}${canResolve&&x.status==="missing"&&x.sourceType?button("建立待核定记录","payroll-ensure-business",x.orderId):""}${canResolve&&x.status==="pending"&&x.entryIds?.length?button("补核提成","payroll-resolve-check",JSON.stringify({entryId:x.entryIds[0],orderId:x.orderId,itemId:x.itemId})):""}</article>`);
    const changes=(detail.adjustments||[]).map(x=>`<article class="payroll-line"><div class="payroll-card-head"><strong>${x.direction==="deduct"?"工资扣减":"工资增加"}</strong><span class="payroll-line-amount${x.direction==="deduct"?" payroll-negative":""}">${x.direction==="deduct"?"−":"＋"}${M(x.amount)}</span></div><p>${E(x.reason)}</p>${x.sourceOrderId?`<button type="button" class="secondary payroll-source" data-action="payroll-source" data-value="${E(x.sourceOrderId)}">${E(x.sourceOrderDisplayNo||x.orderNo||documentRef(x,"sourceOrderId"))} · 查看原单</button>`:""}<p>${E(x.operatorName||"审核人")} · ${E(displayTime(x.createdAt))}</p>${x.originalStatementId?`<p>更正原工资单 ${E(documentRef(x,"originalStatementId"))}</p>`:""}</article>`);
    const pointLinks={reception:["接待记录","/receptions"],learning:["学习记录","/learning"],"work-journal":["工作日志","/work-journal"]};
    const points=(detail.points||[]).map(x=>{const link=pointLinks[x.sourceType];return `<article class="payroll-line"><div class="payroll-card-head"><strong>${E(x.kind||x.type||x.title||"积分")}</strong><span>${E(x.amount??x.points??0)} 分</span></div><p>换算工资 ${x.convertedAmount==null?'原工资未计入':M(x.convertedAmount)} · 100分＝1元</p><p>${E(x.reason||x.event||x.summary||"")}</p><p>${E(displayTime(x.at||x.createdAt))}</p><details class="payroll-evidence"><summary>核定依据</summary>${x.sourceId?`<p>来源单号 ${E(documentRef(x,"sourceId"))}</p>`:""}${link?`<a class="secondary payroll-source" href="${link[1]}">查看${link[0]}</a>`:""}</details></article>`;});
    const carrierCards=(detail.carrierInstallments||[]).map(part=>`<article class="payroll-line"><div class="payroll-card-head"><strong>${E(part.productName)} · ${E(part.month)}</strong><span class="payroll-state">${E(part.status)}</span></div><p>移动预计 ${M(part.expected)} · 已确认 ${part.confirmed==null?'待确认':M(part.confirmed)} · 已到账 ${M(part.received)}</p><p>员工比例 ${part.rate==null?'待设置':E(part.rate)+'%'} · 预计工资 ${E(payrollMoney(part.estimatedWage))} · 未到账工资 ${E(payrollMoney(part.unreceivedWage))}</p><p>未到账工资暂不计入应发。</p>${payrollBusinessSource({...part,sourceType:'carrier'})}${canResolve?button('设置员工比例','payroll-carrier-rate',JSON.stringify({id:part.orderId,rate:part.rate})):''}</article>`);
    $("main").insertAdjacentHTML("beforeend",`<section id="payroll-detail">${r?payrollRowCard(r):'<p class="empty">本月未设置工资记录</p>'}<div class="payroll-card-actions">${button("复制核对记录","payroll-copy","","primary")}${canManage&&r?.status==="draft"?button("工资增减","payroll-adjustment",selected):""}</div>${missing.length?`<p class="payroll-attention">发现 ${missing.length} 笔销售或现金充值缺提成记录，请核对。</p>`:""}${payrollSheet(detail,canResolve)}${payrollPointSheet(detail)}<div class="payroll-mobile-cards">${payrollSection("移动返费分期","payroll-carrier-installments",carrierCards,carrierCards.length>0)}${payrollSection("逐笔工资明细","payroll-entries",(detail.entries||[]).map(payrollEntryCard),true)}${payrollSection("每笔业务与销售核对","payroll-business-checks",checkCards,missing.length>0)}${payrollSection("积分明细与换算","payroll-points",points,points.length>0)}</div>${payrollSection("工资增减记录","payroll-adjustments",changes)}</section>`);
  }
  $("payroll-month").addEventListener("change",event=>{state.month=event.target.value;render().catch(showError);});
  $("payroll-employee")?.addEventListener("change",event=>{state.payrollEmployeeId=event.target.value;render().catch(showError);});
  $("payroll-employee-filter")?.addEventListener("input",event=>{const q=event.target.value.trim();$("payroll-overview").querySelectorAll("[data-payroll-employee]").forEach(el=>el.hidden=!el.dataset.payrollEmployee.includes(q));});
  if(state.payrollNotice){payrollFeedback(state.payrollNotice.text,state.payrollNotice.error);state.payrollNotice=null;}
}
function payrollFeedback(text,error=false){const target=$("payroll-feedback");if(!target)return toast(text,error);target.hidden=false;target.textContent=text;target.dataset.kind=error?"error":"success";target.setAttribute("role",error?"alert":"status");target.scrollIntoView({behavior:"smooth",block:"center"});}
function payrollModal(title,fields,submit,description="",paymentOptions=null){
 modal(title,fields,async(data,write)=>{const result=await submit(data,write);state.payrollNotice={text:result?.message||"已保存，记录可在本月明细中核对。",error:false};return result;},description,paymentOptions);

}
function payrollSourceOptions(checks,selected=""){
 const orders=new Map();for(const row of checks||[]){if(!row.orderId||row.sourceType||['carrier','air_recharge'].includes(row.businessKind))continue;const item=orders.get(row.orderId)||{label:documentRef(row,"orderId"),products:[]};if(row.productName&&!item.products.includes(row.productName))item.products.push(row.productName);orders.set(row.orderId,item);}
 return [{value:"",label:"不关联业务单"},...Array.from(orders,([value,item])=>({value,label:item.label+(item.products.length?" · "+item.products.join("、"):"")})),...(selected&&!orders.has(selected)?[{value:selected,label:shortInternalNo(selected)}]:[])];
}
async function payrollAdjustment(employeeId){
 if(!payrollCanManage())throw new Error("当前账号没有工资增减权限");
 const month=state.month,current=officePageCurrent("payroll");
 const detail=await officePageRead(current,()=>api(`/api/payroll?month=${encodeURIComponent(month)}&employeeId=${encodeURIComponent(employeeId)}`));
 if(!current()||state.month!==month)return;
 const row=detail.rows?.find(r=>r.employeeId===employeeId);
 if(!row||row.status!=="draft")throw new Error("已确认工资不能直接增减，请另记更正月份。");
 payrollModal(`工资增减 · ${row.name}`,[{name:"direction",label:"增减方式",options:[{value:"add",label:"增加工资 / 奖励"},{value:"deduct",label:"扣减工资"}],required:true},moneyField("amount","金额（元）",""),{name:"reason",label:"增减原因",type:"textarea",required:true,wide:true},{name:"sourceOrderId",label:"关联业务单（可选）",options:payrollSourceOptions([...(detail.businessChecks||[]),...(detail.entries||[])])},{name:"originalStatementId",label:"更正原工资单号（可留空）"}],(d,write)=>write("/api/payroll/adjustments",{employeeId,month,...d,amount:Number(d.amount)}));
 const form=$("modal-form");form.elements.amount.min="0.01";
 const advanced=document.createElement("details");advanced.className="payroll-evidence field wide";advanced.innerHTML='<summary>历史更正（可选）</summary>';const originalField=form.elements.originalStatementId.closest(".field");originalField.before(advanced);advanced.append(originalField);
}
function payrollResolveCheck(value){
 const source=JSON.parse(value),row=state.payrollDetail?.businessChecks?.find(x=>x.orderId===source.orderId&&x.itemId===source.itemId);
 if(!row||row.status!=="pending"||!source.entryId)throw new Error("这笔提成没有可补核记录，请先核对原业务。");
 payrollModal("补核提成 · "+row.productName,[{name:"mode",label:"提成方式",required:true,options:row.sourceType?[{value:"piece",label:"本笔固定金额"},{value:"none",label:"本笔不提成"}]:[{value:"piece",label:"按件固定金额"},{value:"profit",label:"按毛利百分比"},{value:"none",label:"不计提成"}]},moneyField("value","金额或百分比",0)],(d,write)=>write("/api/payroll/resolve",{entryId:source.entryId,...d,value:Number(d.value)}));
}
function payrollCarrierRate(value){
 const row=JSON.parse(value);
 payrollModal('设置移动返费员工比例',[moneyField('rate','按实际到账的百分比',row.rate??'')],(data,write)=>write('/api/payroll/carrier-rate',{id:row.id,rate:Number(data.rate)}),'不同移动业务可分别设置；未到账部分只作预计，实际到账后按本比例计入当期工资。');
 const field=$('modal-form').elements.rate;field.min='0';field.max='100';field.required=true;
}
async function payrollEnsureBusiness(sourceId){
 if(!payrollCanManage())throw new Error('只有工资管理员能补建业务工资记录。');
 state.payrollEnsureAttempts||={};const payload={sourceId},signature=JSON.stringify(['/api/payroll/business-ensure',payload]);
 const attempt=state.payrollEnsureAttempts[sourceId]||={signature,key:requestId(),uncertain:false};
 await post('/api/payroll/business-ensure',payload,attempt);
 delete state.payrollEnsureAttempts[sourceId];state.payrollNotice={text:'已建立待核定记录，请逐笔核定固定提成或明确不提成。',error:false};
 await renderPayroll();
}
async function payrollCopy(){
 const detail=state.payrollDetail,row=detail?.rows?.[0];if(!detail)throw new Error("请先打开工资明细。");
 const lines=["工资核对记录",`员工：${row?.name||state.user.name}`,`月份：${state.month}`,`底薪：${row?.baseSalary==null?"未设置":M(row.baseSalary)}`,`业务提成：${payrollMoney(row?.commission)}`,`积分换算：${row?.pointWage==null?'原工资未计入':M(row.pointWage)}（100分＝1元）`,`人工增减：${M(row?.manualAdjustment??0)}`,`应发：${payrollMoney(row?.total)}`,"", "逐笔提成："];
 for(const entry of detail.entries||[])lines.push(`${displayTime(entry.createdAt||entry.date)} · ${documentRef(entry,"orderId")||"未关联原单"} · ${entry.productName||payrollKind[entry.kind]||entry.kind} · 数量 ${entry.quantity??"—"} · ${payrollMoney(entry.amount)}`);
 for(const check of (detail.businessChecks||[]).filter(x=>x.status!=="accrued"))lines.push(`需核对：${documentRef(check,"orderId")} · ${check.productName} · ${payrollStatus[check.status]||check.status}`);
 for(const change of detail.adjustments||[])lines.push(`人工${change.direction==="deduct"?"扣减":"增加"} ${M(change.amount)} · ${change.reason} · ${change.operatorName||"审核人"}`);
 const text=lines.join("\n");
 try{if(!navigator.clipboard?.writeText)throw new Error("请手动复制");await navigator.clipboard.writeText(text);payrollFeedback("核对记录已复制，可发给老板核对。");}
 catch{payrollReadonlyDialog("工资核对记录",`<label for="payroll-copy-record">核对内容</label><textarea id="payroll-copy-record" readonly>${E(text)}</textarea>`);$("payroll-copy-record").select();}
}
let payrollSourceVersion=0;
async function payrollSource(id){
 const current=officePageCurrent("payroll"),version=++payrollSourceVersion;
 const rows=await officePageRead(current,()=>api("/api/sale-orders?q="+encodeURIComponent(id)));
 if(!current()||version!==payrollSourceVersion)return;
 const order=rows.find(x=>x.id===id);
 if(!order){payrollReadonlyDialog("原单核对",`<p class="payroll-attention">当前账号没有可查看的原销售单。请用上方工资明细编号向老板核对。</p>`);return;}
 const items=(order.items||[]).map(x=>`<article class="payroll-line"><strong>${E(x.name)}</strong>${payrollFacts([["数量",x.quantity],["串号",x.serialNo||"—"],["单价",payrollRecordedMoney(x.salePrice)],["金额",payrollRecordedMoney(x.amount??(x.quantity!=null&&x.salePrice!=null?Number(x.quantity)*Number(x.salePrice):null))]])}</article>`).join("");
 payrollReadonlyDialog("原销售单",`<p class="payroll-document-no">${E(documentNo(order))}</p><details class="payroll-evidence"><summary>完整单号</summary><p>${E(order.id)}</p></details>${payrollFacts([["开单时间",displayTime(order.createdAt)],["状态",label("order",order.status)],["销售金额",payrollRecordedMoney(order.amount)]])}${items}`);
}
function payrollReadonlyDialog(title,html){
 $("payroll-source-dialog")?.remove();const restore=document.activeElement,dialog=document.createElement("dialog");dialog.id="payroll-source-dialog";dialog.className="payroll-dialog";dialog.setAttribute("aria-label",title);dialog.innerHTML=`<div class="payroll-dialog-head"><h2>${E(title)}</h2><button type="button" class="secondary" data-payroll-dialog-close>× 关闭</button></div><div class="payroll-dialog-body">${html}</div>`;document.body.append(dialog);dialog.querySelector("[data-payroll-dialog-close]").onclick=()=>dialog.close();dialog.addEventListener("close",()=>{dialog.remove();restore?.focus({preventScroll:true});});dialog.showModal();
}
async function renderPaySettings() {
  const current=officePageCurrent("pay-settings");
  const data=await officePageRead(current,()=>api(`/api/payroll/settings?month=${encodeURIComponent(state.month||payrollMonth())}`));if(!current())return;state.paySettings=data;
  const salaryRows=data.staff.map(u=>`<article class="payroll-line"><strong>${E(u.name)}</strong><p>底薪 ${u.salary?M(u.salary.amount):"未设置"}</p>${button("设置底薪","salary-setting",u.id)}</article>`);
  const ruleRows=data.products.map(p=>`<article class="payroll-line"><strong>${E(p.name)}</strong><p>全体员工：${p.rule?E(label("rule",p.rule.mode))+" · "+E(p.rule.value):"未设置"}</p><p>${(p.employeeRules||[]).map(x=>`${E(x.name)}：${x.rule?E(label('rule',x.rule.mode))+' · '+E(x.rule.value):'未设置'}`).join('；')}</p>${button("设置全体或指定员工提成","rule-setting",p.skuId)}</article>`);
  const pending=(data.pending||[]).map(p=>`<article class="payroll-line payroll-line-warning"><strong>${E(p.employeeName)}</strong><p>${E(p.productName)}</p><p>单号 ${E(documentRef(p,"orderId"))}</p>${p.kind==='carrier_rebate'?button('设置员工比例','payroll-carrier-rate',JSON.stringify({id:p.orderId,rate:p.value})):button("补录提成","resolve-pay",p.id)}</article>`);
  $("main").innerHTML=heading("底薪与提成规则","变更按生效月记录，不覆盖历史已确认工资。",button("返回工资","back-payroll"))+payrollSection("员工底薪","payroll-salary-settings",salaryRows,true)+payrollSection("商品提成规则","payroll-rule-settings",ruleRows)+payrollSection("待补录提成","payroll-pending-settings",pending,pending.length>0);
}
function paySetting(kind,id) {
  if(kind==="salary"){
    const u=state.paySettings.staff.find((r)=>r.id===id);
    modal(`设置底薪 · ${u.name}`,[moneyField("amount","每月金额",u.salary?.amount??0),{name:"effectiveMonth",label:"生效月份",type:"month",value:state.month,required:true}],(d,write)=>write("/api/payroll/salaries",{employeeId:id,amount:Number(d.amount),effectiveMonth:d.effectiveMonth}));
  }else if(kind==='rule'){
    const row=state.paySettings.products.find((r)=>r.skuId===id);
    modal(`设置毛利提成 · ${row.name}`,[{name:'employeeId',label:'适用员工',options:[{value:'',label:'全体员工（统一覆盖）'},...state.paySettings.staff.map(u=>({value:u.id,label:u.name+'（单独设置）'}))]},{name:'mode',label:'提成方式',options:[{value:'profit',label:'按毛利百分比'},{value:'piece',label:'每件固定金额'},{value:'none',label:'不提成'}],value:row.rule?.mode||'profit'},moneyField('value','比例（%）或每件金额',row.rule?.value??0)],(d,write)=>write('/api/payroll/rules',{skuId:row.skuId,employeeId:d.employeeId,mode:d.mode,value:Number(d.value)}),'规则从现在起用于新业务，并自动核算本月同款商品的待核定工资；历史已确认工资保留原记录。');
  }else{
    const row=state.paySettings.pending.find((r)=>r.id===id);
    modal(`补录提成 · ${row.productName}`,[{name:"mode",label:"方式",options:row.kind==='business'?[{value:"piece",label:"本笔固定金额"},{value:"none",label:"本笔不提成"}]:[{value:"piece",label:"按件固定金额"},{value:"profit",label:"按毛利百分比"},{value:"none",label:"不提成"}]},moneyField("value","金额或百分比",0)],(d,write)=>write("/api/payroll/resolve",{entryId:row.id,mode:d.mode,value:Number(d.value)}));
  }
}
async function renderReports() {
  const current=officePageCurrent("reports");
  const date=state.date||new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});state.date=date;
  const data=await officePageRead(current,()=>api(`/api/daily-report?date=${encodeURIComponent(date)}`));if(!current()||state.date!==date)return;
  const s=data.summary||{};
  const metrics=[["订单数",s.orderCount,"count"],["销售额",s.salesAmount],["退货额",s.returnAmount],["净销售额",s.netSales],["销售收款",s.receivedAmount],["退款支出",s.refundAmount]];
  if(data.canViewProfit)metrics.push(["调整后毛利",s.adjustedGrossProfit]);
  if(state.user.capabilities.finance)metrics.push(["门店费用",s.expenseAmount],["运营商佣金到账",s.carrierReceived]);
  if(s.supplierPaid!=null)metrics.push(["往来单位付款",s.supplierPaid]);
  const card=(title,headers,rows)=>`<section class="card"><h2>${E(title)}</h2>${rows.length?table(headers,rows):'<p class="empty">当日暂无记录</p>'}</section>`;
  const categories=(data.categoryStats||[]).map((r)=>`<tr><td>${E(r.category)}</td><td>${E(r.quantity)}</td><td>${M(r.salesAmount)}</td>${data.canViewProfit?`<td>${M(r.grossProfit)}</td>`:""}</tr>`);
  const payments=(data.paymentStats||[]).map((r)=>`<tr><td>${E(r.paymentMethod)}</td><td>${M(r.amount)}</td></tr>`);
  const staff=(data.staffStats||[]).map((r)=>`<tr><td>${E(r.name)}</td><td>${E(r.orderCount)}</td><td>${M(r.salesAmount)}</td></tr>`);
  const orders=(data.recentOrders||[]).map((r)=>`<tr><td>${E(documentNo(r))}<small>${E(displayTime(r.createdAt))}</small></td><td>${E((r.items||[]).map((i)=>`${i.name} × ${i.quantity}`).join("、"))}</td><td>${M(r.amount)}</td><td>${E(label("order",r.status))}</td></tr>`);
  const expenses=(data.expenses||[]).map((r)=>`<tr><td>${E(r.type)}</td><td>${M(r.amount)}</td><td>${E(r.account||"—")}</td></tr>`);
  $("main").innerHTML=heading("经营日报","选择日期查看经营汇总和业务明细。")+
    `<div class="card"><div class="fields">${formField({name:"date",label:"日期",type:"date",value:date})}</div><div class="grid">${metrics.map(([title,value,kind])=>`<div class="stat"><span>${E(title)}</span><strong>${kind==="count"?E(value||0):M(value)}</strong></div>`).join("")}</div></div>`+
    `<div class="dashboard-panels">${card("品类销售",["分类","净售数量","净销售额",...(data.canViewProfit?["毛利"]:[])],categories)}${card("收款方式",["方式","净收款"],payments)}${card("员工销售",["员工","订单数","净销售额"],staff)}</div>`+
    card("销售单",["单号","商品","金额","状态"],orders)+
    (state.user.capabilities.finance?card("门店费用",["费用","金额","账户"],expenses):"");
  $("main").querySelector('input[name="date"]').addEventListener("change",(e)=>{state.date=e.target.value;render().catch(showError);});
}

function openingPeopleCard(){
 const people=state.users.filter(u=>u.status==='active'&&!u.assistantCustomerOnly&&['owner','manager','employee','warehouse'].includes(u.roleCode));
 const rows=people.map(u=>'<article class="opening-person"><strong>'+E(u.name)+'</strong><span>'+E(u.role||'营业员')+' · '+(u.capabilities?.financeReceive?'✓ 可收款确认':'待设置收款确认')+'</span>'+(u.roleCode==='owner'?'<span>管理员</span>':button(u.capabilities?.financeReceive?'修改收款设置':'设为收款人','opening-receiver',u.id))+'</article>').join('');
 return '<section class="card opening-people"><h2>人员与收款资料</h2><p>先登记人员，再选择实际收款人。收款人本人确认到账；权限可在这里设置。</p><div class="form-actions">'+button('＋ 新增营业员','add-staff','','primary')+'<a class="secondary" href="/payment-accounts#manage">＋ 新增或维护收款账户</a><a class="secondary" href="/air-recharge">平台期初余额</a></div><div class="opening-person-list">'+rows+'</div></section>';
}
function openingReceiverPayload(info,enabled){
 return {userId:info.user.id,roleCode:info.user.roleCode,revision:info.revision,reviewSubjectIds:info.reviewSubjectIds||[],capabilities:Object.fromEntries(info.fields.map(f=>[f.key,f.key==='financeReceive'?enabled:info.user.capabilities[f.key]===true]))};
}
async function openingReceiver(id){
 const info=await api('/api/users/permissions?userId='+encodeURIComponent(id));
 modal('收款确认 · '+info.user.name,[{name:'enabled',label:'是否可作为实际收款人',required:true,value:String(info.user.capabilities.financeReceive===true),options:[{value:'true',label:'是，可确认本人收到的款项'},{value:'false',label:'否，不作为账户持有人'}]}],(d,write)=>write('/api/users/permissions',openingReceiverPayload(info,d.enabled==='true')),'确认后更新这名员工的收款确认设置，其他岗位和权限保持原设置。');
}

async function renderOpening() {
  const current=officePageCurrent("opening");
  const status=await officePageRead(current,()=>api("/api/opening-balance/status"));if(!current())return;state.openingStatus=status;
  $("main").innerHTML=heading("期初建账与基础资料","维护人员、收款账户及期初资料。")+openingPeopleCard()+
    `<div class="grid dashboard-stock"><div class="stat"><span>建账状态</span><strong>${status.hasOpeningBalance?"已完成":"未导入"}</strong></div><div class="stat"><span>当前商品</span><strong>${E(status.productCount)}</strong></div><div class="stat"><span>库存记录</span><strong>${E(status.stockCount)}</strong></div><div class="stat"><span>库存价值</span><strong>${M(status.stockValue)}</strong></div></div>`+
    `<div class="card"><h2>导入 Excel 期初数据</h2><p class="notice">${status.locked?"当前账套已有业务记录，不能重新导入期初数据。":"导入会替换当前商品和库存。请先下载模板，填写并核对预览结果。"}</p>${status.completedAt?`<p class="muted">上次建账：${E(displayTime(status.completedAt))}</p>`:""}<p><a href="/api/opening-balance/template" target="_blank" rel="noopener">下载期初模板</a></p>${status.locked?"":`<input id="opening-file" type="file" accept=".xlsx,.xls"><div class="form-actions">${button("预览导入","preview-opening")}</div><div id="opening-preview"></div>`}</div>`;
}
let openingPreviewVersion=0;
async function previewOpening() {
  const input=$("opening-file"),file=input?.files[0];if(!file)return toast("请选择 Excel 文件",true);
  const pageCurrent=officePageCurrent("opening"),version=++openingPreviewVersion;
  const current=()=>pageCurrent()&&version===openingPreviewVersion&&$("opening-file")===input&&input.files[0]===file;
  const data=new FormData();data.append("file",file);
  const result=await officePageRead(current,async()=>{
    const response=await fetch("/api/opening-balance/preview-excel",{method:"POST",credentials:"same-origin",headers:state.token?{Authorization:`Bearer ${state.token}`}:{},body:data});
    const body=await response.json();if(!response.ok)throw new Error(body.error?.message||"预览失败");return body;
  });
  if(!current())return;
  state.openingPreview=result;
  $("opening-preview").innerHTML=`<p>将导入 ${E(result.productCount)} 个商品，库存价值 ${M(result.stockValue)}。当前商品 ${E(result.replacedProducts)} 个。</p>${button("确认期初建账","commit-opening","","danger")}`;
}
async function renderLogs() {
  const current=officePageCurrent("logs");
  const query=state.logQuery||{};
  const data=await officePageRead(current,()=>api("/api/operation-logs?"+new URLSearchParams({q:query.q||'',from:query.from||'',to:query.to||''})));if(!current())return;window.OperationLogUI.render(data);if(query.q){$('audit-query').value=query.q;$('audit-query').dispatchEvent(new Event('input',{bubbles:true}));}if(query.from&&query.from===query.to){$('audit-date').value=query.from;$('audit-search').click();}
}
function renderStaff() {
  const rows=state.users.map((u)=>'<article class="staff-card"><dl class="staff-facts"><div class="staff-name-row"><dt>姓名：</dt><dd><span class="staff-name">'+E(u.name)+'</span>'+(u.status==='active'&&['employee','manager','warehouse'].includes(u.roleCode)&&!String(u.id).startsWith('demo-')?button('修改姓名','staff-rename',u.id):'')+'</dd></div><div><dt>角色：</dt><dd>'+E(u.role)+'</dd></div><div><dt>状态：</dt><dd>'+(u.status==="active"?"使用中":"已停用")+'</dd></div></dl><div class="actions staff-actions">'+(u.roleCode==="owner"?"老板账号":u.status!=="active"?button("权限设置","staff-permissions",u.id)+button("启用","staff-status",u.id):'<a class="staff-account-link" href="/login?employee='+encodeURIComponent(u.id)+'#admin-panel">账号密码</a>'+button("权限设置","staff-permissions",u.id)+button("停用","staff-status",u.id,"danger"))+'</div></article>').join('');
  $("main").innerHTML=heading("员工账号","先新增员工，再到账号管理页为员工分配登录账号。",button("新增员工","add-staff","","primary"))+
    '<p class="notice"><a href="/login#admin-panel">打开员工账号管理，设置或重置密码</a></p><div class="staff-list">'+rows+'</div>';
}
function staffEditor() {
  modal("新增员工",[
    {name:"name",label:"员工姓名",required:true},
    {name:"roleCode",label:"岗位角色",required:true,options:[{value:"employee",label:"营业员"},{value:"warehouse",label:"仓管 · 采购与盘点"},{value:"manager",label:"店长 · 门店管理"}]},
  ],(data,write)=>write("/api/users",data),"创建后请到员工账号管理页设置登录账号与密码。");
}
function staffRenameEditor(id){const u=state.users.find(x=>x.id===id);if(!u)throw Error('员工已变化，请刷新');modal('修改姓名 · '+u.name,[{name:'name',label:'正确姓名',value:u.name,required:true}],(d,write)=>write('/api/users/rename',{userId:u.id,name:d.name,expectedName:u.name}),'沿用原工号和权限；历史单据保留原经办姓名。');}
function showInviteLink(user,url) {
  $("modal-root")?.remove();
  const root=document.createElement("div");root.id="modal-root";root.className="modal";
  root.innerHTML=`<div class="modal-content"><h2>${E(user.name)}的飞书绑定链接</h2><p class="muted">请发给员工本人，30 分钟内使用一次。员工还需位于飞书应用的可用范围内。</p><label for="invite-link">专属链接</label><input id="invite-link" type="text" readonly value="${E(url)}"><div class="form-actions">${button("复制链接","copy-invite","","primary")}${button("关闭","close-modal")}</div></div>`;
  document.body.append(root);
  root.addEventListener("click",(event)=>{if(event.target===root)root.remove();});
}

const officeQueryTabs=new Set(['inventory','orders','returns','receipts','payments','purchase-query','finance','logs','reports']);
function officeSpecificTarget(tab){const p=new URLSearchParams(location.search);if(p.get('tab')!==tab)return false;return ['q','sourceId','supplierId','focusPurchaseReturn','catalogReview','focusSaleReturn','inventoryQ','warehouse'].some(k=>!!p.get(k))||(tab==='purchase'&&(p.get('section')||location.hash==='#catalog-reviews'||location.hash==='#purchase-return-requests'));}
function officeWaitingQuery(tab=state.tab){if(tab==='inventory')return false;if(new URLSearchParams(location.search).get('view')==='all'&&['orders','returns','purchase-query','receipts','payments'].includes(tab))return false;if(tab==='receipts'&&new URLSearchParams(location.search).get('entry')==='create')return false;if(tab==='purchase')return false;return (officeQueryTabs.has(tab)||tab==='purchase')&&!state.queryReady?.[tab]&&!officeSpecificTarget(tab);}
function renderQueryGate(tab){
 const current=officePageCurrent(tab),names={inventory:'库存查询',orders:'销售单查询',returns:'退换货查询',receipts:'收款单查询',payments:'付款单查询','purchase-query':'进货单查询',finance:'资金流水查询',logs:'操作日志查询',reports:'日报查询',suppliers:'往来对账查询',purchase:'进货库存'};

 const finance=tab==='receipts'||tab==='payments',inventory=tab==='inventory';
 $('main').innerHTML=heading(names[tab]||'查询','',finance?button(tab==='receipts'?'登记其他收款':'登记费用付款','financial-new',tab==='receipts'?'receive':'pay','primary'):'')+'<section class="card"><form id="office-query-start" class="document-filter">'+(tab==='reports'?'<label>日期<input type="date" name="from" required></label>':!inventory?'<label>开始日期<input type="date" name="from"></label><label>结束日期<input type="date" name="to"></label>':'<label>仓库<select name="warehouse"><option value="">全部仓库</option></select></label>')+'<label>单号／名称／串号<input type="search" name="q" maxlength="160"></label>'+(['orders','returns','purchase-query'].includes(tab)?'<label>供货商<input name="supplier" maxlength="160"></label><label>商品名<input name="productName" maxlength="160"></label>':'')+(finance?'<label>业务类型<select name="kind"><option value="">全部</option>'+(tab==='receipts'?'<option value="sale">销售收款</option><option value="cash_recharge">充值收款</option><option value="other_income">其他收款</option>':'<option value="expense">费用付款</option><option value="supplier_payment">供货商付款</option><option value="refund">销售退款</option>')+'</select></label>':'')+'<button type="submit" class="primary">查询</button></form><p id="office-query-status" role="status">请选择条件后查询</p></section>';
 const form=$('office-query-start');if(inventory){if(new URLSearchParams(location.search).get('inventoryTiming')==='1'){$('office-query-status').dataset.entryFormMs=Math.round(performance.now());}(state.inventoryEntryWarehousesReady?Promise.resolve(state.warehouses):api('/api/warehouses')).then(rows=>{if(!current()||!form.isConnected)return;for(const w of rows.filter(w=>w.active!==false))form.elements.warehouse.add(new Option(w.name,w.id));if(new URLSearchParams(location.search).get('inventoryTiming')==='1'){const status=$('office-query-status');status.dataset.warehouseReadyMs=Math.round(performance.now());status.textContent='页面可操作 '+(Number(status.dataset.entryFormMs)/1000).toFixed(2)+' 秒；仓库选项就绪 '+(Number(status.dataset.warehouseReadyMs)/1000).toFixed(2)+' 秒。';}}).catch(()=>{});}
 form.onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(form));if(f.from&&f.to&&f.from>f.to){$('office-query-status').textContent='开始日期不能晚于结束日期';return;}if(!Object.values(f).some(value=>String(value||'').trim())){$('office-query-status').textContent='请先选择日期、业务类型或填写查询内容。';return;}const button=form.querySelector('[type=submit]');button.disabled=true;$('office-query-status').textContent='正在查询…';try{state.documentQueries||={};state.documentQueries[tab]=f.q||'';state.documentFilters||={};state.documentFilters[tab]={from:f.from||'',to:f.to||'',supplier:f.supplier||'',productName:f.productName||''};if(tab==='orders'||tab==='returns'){state.orderQuery=f.q||'';state.orderCursor=null;}if(tab==='reports')state.date=f.from;if(tab==='logs')state.logQuery={q:f.q||'',from:f.from||'',to:f.to||''};if(finance)state[(tab==='receipts'?'receive':'pay')+'Filter']={q:f.q||'',from:f.from||'',to:f.to||'',kind:f.kind||''};await loadBasics();if(!current())return;if(inventory)window.InventoryOffice.applyQuery({q:f.q||'',warehouse:f.warehouse||''});state.queryReady||={};state.queryReady[tab]=true;await render();}catch(error){if(current()){$('office-query-status').textContent=error.message||'查询未完成，请重试';button.disabled=false;}}};
}

async function render() {
  const version=++officeViewVersion,tab=state.tab;
  $('main')?.classList.toggle('product-catalog-page',tab==='products'&&new URLSearchParams(location.search).get('view')!=='pricing');
  document.documentElement.classList.toggle("sales-focus",tab==="sales");document.documentElement.classList.remove("sales-navigation-open");document.dispatchEvent(new Event("office-navigation-change"));
  if(state.tab==="stocktake"){location.assign("/stocktake");return;}
  if(state.tab==="sales-list"){location.assign("/sales-list");return;}
  if(tab==="dashboard"){location.replace("/m");return;}
  renderNav();
  if(officeWaitingQuery(tab)){renderQueryGate(tab);window.StoreWorkContinuity?.pageReady();return;}
  if(tab==="sales")await Promise.all([ensureGiftRules(),ensureSalePaymentSplits()]);
  if(version!==officeViewVersion||state.tab!==tab)return;
  const views={dashboard:renderDashboard,inventory:renderInventory,products:renderProducts,sales:renderSales,orders:renderOrders,returns:renderOrders,receipts:()=>window.TradeDocuments.renderFinancial("receive"),payments:()=>window.TradeDocuments.renderFinancial("pay"),red:renderRedReversals,purchase:renderPurchase,"purchase-query":renderPurchase,suppliers:renderSuppliers,
    "supplier-detail":()=>renderSupplierDetail(state.supplierId),finance:renderFinance,cards:renderCards,payroll:renderPayroll,"pay-settings":renderPaySettings,reports:renderReports,staff:renderStaff,opening:renderOpening,logs:renderLogs,backup:()=>window.SystemAdmin.renderBackup()};
  try { await (views[tab]||renderDashboard)(); }
  catch(error) { if(version===officeViewVersion&&state.tab===tab){const message=/[\u3400-\u9fff]/.test(error.message||"")?error.message:"页面读取未完成，请稍后重试。";$("main").innerHTML=heading("页面暂未打开")+'<section class="card"><p role="alert">'+E(message)+'</p><button type="button" class="primary" data-tab="'+E(tab)+'">重新读取本页</button></section>';throw error;}return; }
  if(version!==officeViewVersion||state.tab!==tab)return;
  document.body.classList.toggle("record-view",Boolean(document.querySelector(".mobile-record-list")));window.StoreWorkContinuity?.pageReady();
}
function showError(error) { if(state.tab==="payroll"&&$("payroll-feedback"))payrollFeedback(error.message||String(error),true);else toast(error.message||String(error),true); }
async function go(tab) { if(state.saleSubmitting){toast("销售单正在提交，请等待结果后再切换页面。",true);return;} if(tab==="stocktake"){location.assign("/stocktake");return;}if(tab==="sales-list"){location.assign("/sales-list");return;}window.StoreWorkContinuity?.snapshot();if(state.tab!==tab){const url=new URL(location.href);url.search='';url.searchParams.set('tab',tab);history.replaceState(null,'',url);if(tab==='inventory')window.InventoryOffice?.resetQuery();if(tab==='products'&&state.productCatalogView){state.productCatalogView.mobileQueried=false;state.productCatalogView.desktopQueried=false;}}state.tab=tab; if((officeQueryTabs.has(tab)&&tab!=="inventory")||tab==="purchase"){state.queryReady||={};delete state.queryReady[tab];++officeBasicsVersion;await render();return;} if(["sales","products","inventory","suppliers"].includes(tab)){const requestedTab=tab;$("main").innerHTML=heading(tab==="sales"?"销售开单":tab==="inventory"?"库存查询":tab==='suppliers'?'往来单位':tab==='products'?'商品档案':'商品与调价')+'<section class="card" role="status">'+(tab==='inventory'?'正在读取筛选选项…':tab==='suppliers'?'正在读取往来单位…':tab==='products'?'正在读取商品档案…':'正在读取最新商品与库存…')+'</section>';try{await loadBasics();}catch(error){if(state.tab!==requestedTab)return;$("main").innerHTML=heading("页面读取未完成")+'<section class="card"><p role="alert">'+E(error.message||"请稍后重试")+'</p><button type="button" class="primary" data-tab="'+E(requestedTab)+'">重新读取本页</button></section>';throw error;}if(state.tab!==requestedTab)return;}await render(); }

async function handleAction(action,value) {
  if(state.saleSubmitting){toast("销售单正在提交，请等待结果后再操作。",true);return;}
  switch(action) {
    case "close-modal": {const root=$("modal-root");if(root?.dataset.submitting==="1"||root?.dataset.uncertain==="1"){toast("本单正在提交或结果待核对，请按原内容重试核对后再关闭。",true);return;}root?.remove();return;}
    case "repair-materials":if(state.user?.capabilities?.sell||state.user?.capabilities?.purchase||state.user?.capabilities?.stocktake||state.user?.capabilities?.manageProducts)location.assign("/repair-materials");return;
    case "system-readiness":if(state.user?.roleCode==="owner")location.assign("/system-readiness");return;
    case "payment-accounts":if(state.user?.roleCode==="owner"||state.user?.capabilities.createPaymentAccounts)location.assign("/payment-accounts");return;
    case "orders-more": await renderOrders(true);return;
    case "refresh": {
      if(state.tab!=="inventory"){await loadBasics();await render();return;}
      if(state.inventoryRefreshing)return;state.inventoryRefreshing=true;
      const main=$("main"),button=main.querySelector('[data-action="refresh"]');main.setAttribute('aria-busy','true');if(button)button.disabled=true;
      try{await loadBasics();if(state.tab==="inventory")await render();}finally{state.inventoryRefreshing=false;main.removeAttribute('aria-busy');if(button?.isConnected)button.disabled=false;}return;
    }
    case "stocktake":stocktake(value);return;
    case "edit-product":productEditor(value);return;
    case "mobile-product":mobileProductEditor(value);return;
    case "product-transfer":productWarehouseTransfer(value);return;
    case "transfer-picker":await warehouseTransferPicker();return;
    case "transfer-c":inventoryTransferC(value);return;
    case "add-sale-item":openSaleStock(value);return;
    case "edit-cart":saleItemEditor(Number(value));return;
    case "remove-cart":state.salesCart.splice(Number(value),1);renderSales();return;
    case "view-orders":await go("orders");return;
    case "gift-add":if(state.tab==="sales")await ensureSaleSerials();window.Gifts.addGift();return;
    case "gift-remove":state.giftCart.splice(Number(value),1);renderSales();return;
    case "gift-supplement":{const rows=await Promise.all([api("/api/inventory"),api("/api/products?view=picker")]);state.inventory=rows[0];state.products=rows[1];window.Gifts.addGift(value);return;}
    case "gift-settings":window.Gifts.settings();return;
    case "gift-approve-toggle":{
      const target=state.users.find((row)=>row.id===value);
      if(!target)return;
      const enabled=!target.capabilities.giftApprove;
      modal((enabled?"授权":"取消授权")+"赠品审核 · "+target.name,[],(d,write)=>write('/api/users/gift-approval',{userId:value,enabled}),"确认后修改这名员工的赠品审核权限。");return;
    }
    case "exchange-sale":window.TradeDocuments.exchange(value);return;
    case "financial-new":await loadBasics();await window.TradeDocuments.newFinancial(value);return;
    case "financial-detail":window.TradeDocuments.detail(value);return;
    case "return-sale":returnSale(value);return;
    case "sale-return-approve":window.TradeDocuments.reviewReturnRequest(value,"approve");return;
    case "sale-return-reject":window.TradeDocuments.reviewReturnRequest(value,"reject");return;
    case "purchase-price-correction":purchasePriceCorrection(value);return;
    case "product-status":productStatusEditor(value);return;
    case "purchase-direct":state.inventory=await api("/api/inventory");purchaseEditor("receive");return;
    case "purchase-plan":purchaseEditor("plan");return;
    case "purchase-plan-detail":purchasePlanDetail(value);return;
    case "receive-plan":state.inventory=await api("/api/inventory");purchaseEditor("receive",value);return;
    case "review-plan-payment":{
      const plan=state.plans?.find((p)=>p.id===value);if(!plan)return;
      modal("决定订货付款额度 · "+documentNo(plan),[
        {name:"decision",label:"付款决定",options:[{value:"approve",label:"批准付款额度（不转账）"},{value:"defer",label:"暂缓付款"}],required:true},
        moneyField("approvedAmount","累计批准付款上限（元）",plan.paymentReview?.approvedAmount||plan.plannedAmount),
        {name:"reason",label:"审核说明（暂缓必填）",type:"textarea",wide:true}
      ],async(d,write)=>{const result=await write("/api/procurement-plans/payment-review",{id:plan.id,decision:d.decision,approvedAmount:Number(d.approvedAmount),reason:d.reason});return {...result,message:d.decision==="approve"?"已批准付款额度 "+M(d.approvedAmount)+"；尚未实际付款，需另行登记实际付款。":"已暂缓付款，未发生资金支出。"}},
      "批准额度是本单累计付款上限；审核不会自动转账，也不会增加库存。");
      return;
    }
    case "pay-plan":{const plan=state.plans?.find(p=>p.id===value);if(plan)purchasePlanPaymentEditor(plan);return;}
    case "assign-plan":{
      const plan=state.plans?.find((p)=>p.id===value);if(!plan)return;
      const staff=state.users.filter((u)=>u.status==="active"&&u.capabilities.purchase);
      modal("指派验货 · "+documentNo(plan),[{name:"receiverId",label:"验货责任人",options:staff.map((u)=>({value:u.id,label:u.name+" · "+u.role})),value:plan.receiverId||plan.operatorId,required:true}],(d,write)=>write("/api/procurement-plans/assign",{id:plan.id,receiverId:d.receiverId}));
      return;
    }
    case "close-plan":{
      modal("终止订货余货",[{name:"reason",label:"终止余货原因",type:"textarea",wide:true,required:true}],(d,write)=>write("/api/procurement-plans/close",{id:value,reason:d.reason}));return;
    }
    case "add-supplier":supplierEditor();return;
    case "supplier-detail":state.supplierId=value;await go("supplier-detail");return;
    case "back-suppliers":await go("suppliers");return;
    case "supplier-payment":supplierAction("payment");return;
    case "supplier-refund":supplierAction("refund");return;
    case "supplier-offset":supplierAction("offset");return;
    case "supplier-opening":supplierAction("opening");return;
    case "supplier-adjustment":supplierAction("adjustment");return;
    case "supplier-price":await supplierCostAction("price");return;
    case "supplier-return":await supplierCostAction("return");return;
    case "opening-purchase-return":await window.TradeDocuments.openingPurchaseReturn();return;
    case "purchase-return-request":window.TradeDocuments.purchaseReturn(value);return;
    case "purchase-return-approve":window.TradeDocuments.reviewPurchaseReturnRequest(value,"approve");return;
    case "purchase-return-reject":window.TradeDocuments.reviewPurchaseReturnRequest(value,"reject");return;
    case "catalog-confirm":window.TradeDocuments.reviewCatalog(value,"confirm");return;
    case "catalog-needs-changes":window.TradeDocuments.reviewCatalog(value,"needs_changes");return;
    case "catalog-edit":window.TradeDocuments.editCatalog(value);return;
    case "supplier-statement":window.open(`/api/supplier-statement/export?id=${encodeURIComponent(state.supplierId)}`,"_blank","noopener");return;
    case "reverse-offset":{
      modal("撤销往来分配",[{name:"reason",label:"撤销分配原因",type:"textarea",wide:true,required:true}],(d,write)=>write("/api/supplier-offsets/reverse",{id:value,reason:d.reason}));return;
    }
    case "price-request":priceRequestEditor(value);return;
    case "price-approve":priceReviewEditor(value,"approve");return;
    case "price-reject":priceReviewEditor(value,"reject");return;
    case "add-expense":expenseEditor();return;
    case "red-request":requestExpenseRed(value);return;
    case "red-approve":reviewExpenseRed(value,"approve");return;
    case "red-reject":reviewExpenseRed(value,"reject");return;
    case "card-event":cardEvent(value);return;
    case "payroll-manage-view":state.payrollView="manage";state.payrollEmployeeId="";await go("payroll");return;
    case "payroll-details-view":state.payrollView="details";await go("payroll");return;
    case "payroll-detail":state.payrollView="details";state.payrollEmployeeId=value;await go("payroll");return;
    case "payroll-adjustment":await payrollAdjustment(value);return;
    case "payroll-copy":await payrollCopy();return;
    case "payroll-resolve-check":payrollResolveCheck(value);return;
    case "payroll-ensure-business":await payrollEnsureBusiness(value);return;
    case "payroll-carrier-rate":payrollCarrierRate(value);return;
    case "payroll-source":await payrollSource(value);return;
    case "pay-settings":await go("pay-settings");return;
    case "back-payroll":await go("payroll");return;
    case "salary-setting":paySetting("salary",value);return;
    case "rule-setting":paySetting("rule",value);return;
    case "resolve-pay":paySetting("resolve",value);return;
    case "confirm-pay":{
      const month=state.month;
      payrollModal("确认本月工资",[],(d,write)=>write("/api/payroll/confirm",{employeeId:value,month}),"确认这名员工 "+month+" 的工资？确认后不能改历史工资快照。");return;
    }
    case "paid-pay":{
      const row=state.payroll.rows.find(r=>r.id===value);if(!row)throw new Error("工资单不存在，请刷新后重试。");
      payrollModal("记录工资发放 · "+row.name,[{name:"account",label:"实际发放账户",options:accounts,value:"银行卡",required:true}],(d,write)=>write("/api/payroll/pay",{statementId:value,payments:d.payments}),"请确认已实际发放 "+M(row.total)+"。",{mode:"pay",defaultAccount:"银行卡",totalCents:modalPaymentCents(row.total)});return;
    }
    case "preview-opening":await previewOpening();return;
    case "add-staff":staffEditor();return;
    case "staff-rename":staffRenameEditor(value);return;
    case "opening-receiver":await openingReceiver(value);return;
    case "staff-permissions":await window.SystemAdmin.permissions(value);return;
    case "staff-status":{
      const employee=state.users.find((u)=>u.id===value);if(!employee)return;
      const next=employee.status==="active"?"disabled":"active";
      modal((next==="disabled"?"停用":"启用")+"员工账号 · "+employee.name,[],(d,write)=>write("/api/users/status",{userId:value,status:next}),`确认${next==="disabled"?"停用":"启用"} ${employee.name} 的账号？`);return;
    }
    case "invite-staff":{
      const invitation=await api("/api/users/invite",{method:"POST",body:JSON.stringify({userId:value})});
      showInviteLink(invitation.user,invitation.url);return;
    }
    case "copy-invite":{
      const input=$("invite-link");if(!input)return;
      try{await navigator.clipboard.writeText(input.value);toast("链接已复制");}
      catch{input.select();document.execCommand("copy");toast("链接已选中，可手动复制");}
      return;
    }
    case "commit-opening":{
      const p=state.openingPreview;if(!p)return;
      modal("确认期初建账",[],(d,write)=>write("/api/opening-balance/import",{rows:p.sourceRows,source:p.source,confirmed:true}),`将替换当前 ${p.replacedProducts} 个商品。仅确认当前账套确实需要重新建账时继续。`);return;
    }
  }
}
document.addEventListener("click",(event)=>{
  const target=event.target.closest("[data-action],[data-tab]");if(!target)return;
  if(target.dataset.tab){go(target.dataset.tab).catch(showError);return;}
  handleAction(target.dataset.action,target.dataset.value).catch(showError);
});
$("logout").addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST"}).catch(()=>{});state.token="";sessionStorage.removeItem("officeLocalToken");location.href="/login";});

function registerQueryContinuity(){if(new URLSearchParams(location.search).get('view')==='all')return;if(!window.StoreWorkContinuity||!officeQueryTabs.has(state.tab))return;const tab=state.tab;window.StoreWorkContinuity.register('office-query:'+tab,{route:'/app?tab='+tab,label:tab==='inventory'?'库存查询':'单据查询',read:()=>({queried:tab==='inventory'||!!state.queryReady?.[tab],inventory:tab==='inventory'?window.InventoryOffice?.snapshot():null,history:!!state.inventoryIncludeHistory,filters:state.documentFilters?.[tab],query:state.documentQueries?.[tab],orderQuery:state.orderQuery,date:state.date}),restore:saved=>{if(!saved?.queried)return;state.queryReady||={};state.queryReady[tab]=true;state.inventoryIncludeHistory=!!saved.history;if(tab==='inventory')window.InventoryOffice?.restore(saved.inventory);state.documentFilters||={};state.documentFilters[tab]=saved.filters||{};state.documentQueries||={};state.documentQueries[tab]=saved.query||'';state.orderQuery=saved.orderQuery||'';state.date=saved.date;}});}
async function start() {
  if(state.tab==="dashboard"){location.replace('/m');return;}
  try {
    if(state.tab==="inventory"){const entry=await api("/api/inventory/entry");state.user=entry.user;state.warehouses=entry.warehouses;state.inventoryEntryWarehousesReady=true;}else state.user=await api("/api/me");if(requiredCaps[state.tab]&&!state.user.capabilities[requiredCaps[state.tab]])state.tab="dashboard";$("who").textContent=`${state.user.name} · ${state.user.role}`;$("logout").hidden=false;
    registerSaleContinuity();registerQueryContinuity();if(!officeWaitingQuery())await loadBasics();await render();publishEntryTiming();
    if(state.tab==="products"&&new URLSearchParams(location.search).get("new")==="1"){
      let draft=null;try{draft=JSON.parse(sessionStorage.getItem("assistant-product-draft-v1")||"null");sessionStorage.removeItem("assistant-product-draft-v1");}catch{}
      const validAge=draft&&Number.isFinite(draft.createdAt)&&Date.now()-draft.createdAt>=0&&Date.now()-draft.createdAt<600000;
      const organization=draft?await api("/api/organization").catch(()=>null):null;
      const validBranch=organization&&(organization.enabled===true?typeof organization.currentBranchId==="string"&&Boolean(organization.currentBranchId)&&Boolean(draft?.branchId)&&draft.branchId===organization.currentBranchId:organization.enabled===false&&!draft?.branchId);
      if(state.user.capabilities.manageProducts&&validAge&&draft.ownerId===state.user.id&&validBranch)productEditor("",{name:draft.prefill?.name,warehouseId:draft.prefill?.warehouseId});
      const url=new URL(location.href);url.searchParams.delete("new");history.replaceState(null,"",url);
    }
  } catch(error) {
    if(state.user&&error.status!==401){const message=/[\u3400-\u9fff]/.test(error.message||'')?error.message:'页面组件加载未完成，请刷新后重试。';$("main").innerHTML=heading('页面暂未打开')+'<section class="card"><p role="alert">'+E(message)+'</p><a class="primary" href="/app?tab='+encodeURIComponent(state.tab)+'">重新打开本页</a> <a href="/m">返回工作台</a></section>';showError(new Error(message));return;}
    const mode=await api("/api/auth/mode").catch(()=>({}));
    if(mode.localExperience){
      $("main").innerHTML=heading("本机体验登录","使用虚构测试账套。")+`<div class="card"><form id="local-login"><div class="fields">${formField({name:"userId",label:"测试角色",options:mode.users.map((u)=>({value:u.id,label:`${u.name} · ${u.role}`}))})}</div><button class="primary">进入工作台</button></form></div>`;
      $("local-login").addEventListener("submit",async(e)=>{e.preventDefault();try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({userId:new FormData(e.target).get("userId")})});state.token=result.token;sessionStorage.setItem("officeLocalToken",result.token);state.user=result.user;$("who").textContent=`${state.user.name} · ${state.user.role}`;$("logout").hidden=false;await loadBasics();await render();}catch(err){showError(err);}});
    }else{
      $("main").innerHTML=heading("员工登录","请使用老板分配的账号密码。")+'<div class="card"><a href="/login?next=/app">打开员工登录页</a></div>';
    }
  }
}
start().catch(showError);













function purchasePlanPaymentEditor(plan){
      modal("采购付款单 · "+documentNo(plan),[
        moneyField("amount","本次实际付款（元）",plan.paymentRemaining??Math.max(0,Number(plan.plannedAmount||0)-Number(plan.paidAmount||0))),
        accountField,
        {name:"accountOwnerId",label:"实际付款人",options:[{value:"",label:"请选择付款人"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.finance).map((u)=>({value:u.id,label:u.name}))],required:true},
        {name:"reference",label:"银行或支付平台流水号",required:true},
        {name:"note",label:"备注"}
      ],(d,write)=>write("/api/supplier-payments",{supplierId:plan.supplierId,planId:plan.id,amount:Number(d.amount),payments:d.payments,note:d.note}),
      "付款对象："+plan.supplier+"。本单已关联订货单；只登记已实际付出的货款，累计实付不得超过订货总额。",{mode:"pay",requireReference:true});

}


