(()=>{'use strict';
 const root=document.getElementById('workbench-directory'),grid=document.getElementById('directory-grid'),state=document.getElementById('directory-status'),arrange=document.getElementById('directory-arrange'),search=document.getElementById('directory-search'),retry=document.getElementById('directory-reload');
 if(new URLSearchParams(location.search).get('view')==='documents'){
  root.classList.add('is-document-view');
  document.title='所有单据';document.querySelector('h1').textContent='所有单据';document.getElementById('directory-persona').textContent='按单据类型查看';
  arrange.hidden=true;(search.closest('label')||search).hidden=true;document.getElementById('directory-movebar').hidden=true;
  const documents=[
   ['/app?tab=sales','销售单','/app?tab=orders&view=all'],
   ['/app?tab=purchase','订货单','/app?tab=purchase&section=plans&history=1&view=all'],
   ['/app?tab=purchase-query','进货单','/app?tab=purchase-query&view=all'],
   ['/app?tab=returns','销售退换货单','/app?tab=returns&view=all'],
   ['/app?tab=purchase&section=purchase-returns','采购退货单','/app?tab=purchase&section=purchase-returns'],
   ['/app?tab=receipts','收款单','/app?tab=receipts&view=all'],
   ['/app?tab=payments','付款单','/app?tab=payments&view=all'],
   ['/cash-handover','内转资金交接单','/cash-handover?view=history'],
   ['/daily-close?view=history','每日结账单','/daily-close?view=history'],
   ['/stocktake','库存盘点单','/stocktake'],
   ['/air-recharge','现金充值单','/air-recharge'],
   ['/carrier','移动业务单','/carrier'],
   ['/subsidy','国补台账','/subsidy'],
   ['/repair-services','维修单','/repair-services'],
   ['/app?tab=red','红冲单据','/app?tab=red']
  ];
  state.textContent='正在读取单据入口…';
  fetch('/api/display-preferences?page=home-directory',{credentials:'same-origin',cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('无法读取单据入口，请重新登录或重试');return response.json();}).then(data=>{
   const allowed=new Set(data.entries.map(e=>e.id));grid.replaceChildren();for(const [source,label,href]of documents){if(!allowed.has(source))continue;const card=document.createElement('article');card.className='directory-card';card.style.setProperty('min-height','72px','important');card.style.setProperty('padding','12px','important');const a=document.createElement('a');a.style.setProperty('min-height','48px','important');a.href=href;const title=document.createElement('span');title.className='directory-label';title.textContent=label;a.append(title);card.append(a);grid.append(card);}state.textContent='固定单据入口，点开直接查看。按条件搜索请使用“单据查询”。';
  }).catch(error=>{state.textContent=error.message;});
  return;
 }
 arrange.hidden=true;
 let listing=null,editing=false,busy=false,blocked=false,pending=null,dragId=null,touch=null,selectedId=null,generation=0,controller=null;
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const message=t=>state.textContent=t;
 async function request(body,key){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);controller=ctrl;try{
  const response=await fetch('/api/display-preferences'+(body?'':'?page=home-directory'),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:ctrl.signal,...(body?{headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw Error('返回不完整，请重试');}
  if(!response.ok){const e=Error(data.error?.message||data.error||'暂时无法读取');e.status=response.status;throw e;}return data;
 }finally{clearTimeout(timer);if(controller===ctrl)controller=null;}}
 function icon(entry){
  const kind=entry.id.includes('assistant=1')?'voice':/fund|cash|payment|receipts/.test(entry.id)?'money':/inventory|stocktake|purchase/.test(entry.id)?'box':/reception/.test(entry.id)?'person':/boss/.test(entry.id)?'chart':/learning|knowledge/.test(entry.id)?'book':'document';
  const paths={voice:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',money:'<rect x="2" y="5" width="20" height="15" rx="3"/><path d="M2 10h20M7 15h3"/>',box:'<path d="m3 7 9-5 9 5v10l-9 5-9-5V7zm0 0 9 5 9-5M12 12v10"/>',person:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',chart:'<path d="M3 20h18M6 16V9M12 16V4M18 16v-6"/>',book:'<path d="M12 5v16M3 3c3 0 6 0 9 2 3-2 6-2 9-2v16c-3 0-6 0-9 2-3-2-6-2-9-2V3z"/>',document:'<rect x="4" y="3" width="16" height="19" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'};
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[kind]+'</svg>';
 }
 const modules=[
  {name:'销售接待',groups:['销售接待','单据 · 销售接待']},
  {name:'进货库存',groups:['进货库存','单据 · 采购库存']},
  {name:'基础资料管理',groups:['基础资料管理','商品资料']},
  {name:'财务中心',groups:['财务中心','财务结算','收款付款','账户往来','交接扎账','单据 · 收款付款','单据 · 申请交接','单据 · 核对结算']},
  {name:'移动业务',groups:['移动业务']},
  {name:'查询分析',groups:['查询分析']},
  {name:'员工学习',groups:['员工学习','员工日常','单据 · 员工日常']},
  {name:'管理中心',groups:['管理设置']}
 ];
 const moduleOf=group=>modules.find(module=>module.groups.includes(group))?.name||'其他功能';
 const soundAliases=[[/日子|日誌/g,'日志'],[/扎帐|轧账|轧帐|杂账/g,'扎账'],[/串码/g,'串号']];
 const normalizeSound=value=>soundAliases.reduce((text,[pattern,replacement])=>text.replace(pattern,replacement),String(value||'').trim().toLocaleLowerCase());
 const oneCharacterApart=(term,label)=>{if(term.length<2||term.length>6)return false;for(let i=0;i+term.length<=label.length;i++){let differences=0;for(let j=0;j<term.length;j++)if(term[j]!==label[i+j]&&++differences>1)break;if(differences===1)return true;}return false;};
 function render(){
  if(!listing)return;const entries=new Map(listing.entries.map(e=>[e.id,e])),term=search.value.trim().toLocaleLowerCase(),normalized=normalizeSound(term);grid.replaceChildren();
  const nameMatches=term?listing.entries.filter(e=>e.label.toLocaleLowerCase().includes(term)):[];
  const groupMatches=term&&!nameMatches.length?listing.entries.filter(e=>(e.group+' '+moduleOf(e.group)).toLocaleLowerCase().includes(term)):[];
  const exact=nameMatches.length?nameMatches:groupMatches;
  const aliases=normalized!==term?listing.entries.filter(e=>e.label.toLocaleLowerCase().includes(normalized)):[];
  const matches=term?(exact.length?exact:aliases.length?aliases:listing.entries.filter(e=>oneCharacterApart(normalized,e.label.toLocaleLowerCase()))):listing.entries;
  const grouped=new Map();for(const e of matches){const module=moduleOf(e.group);if(!grouped.has(module))grouped.set(module,new Map());const groups=grouped.get(module);if(!groups.has(e.group))groups.set(e.group,[]);groups.get(e.group).push(e);}
  const names=[...modules.map(x=>x.name),'其他功能'];for(const name of names){const groups=grouped.get(name);if(!groups)continue;const section=make('section',null,'directory-module');section.setAttribute('aria-label',name);const heading=make('div',null,'directory-module-heading'),count=[...groups.values()].reduce((sum,rows)=>sum+rows.length,0);heading.append(make('h2',name),make('span',count+'项','directory-module-count'));section.append(heading);
   for(const [group,rows] of groups){const block=make('div',null,'directory-subgroup');if(group!==name)block.append(make('h3',group,'directory-subgroup-heading'));const cards=make('div',null,'directory-subgrid');for(const e of rows){const id=e.id;const card=make('article',null,'directory-card');card.dataset.id=id;card.dataset.voice=String(id.includes('assistant=1'));card.draggable=editing&&!busy&&!blocked;card.classList.toggle('is-selected',editing&&selectedId===id);
   const link=make('a');link.href=e.href;link.setAttribute('aria-label',e.label);const picture=make('span',null,'directory-icon');picture.innerHTML=icon(e);link.append(picture,make('span',e.label,'directory-label'));
   const grip=make('button','⠿','directory-grip');grip.type='button';grip.setAttribute('aria-label','移动'+e.label);grip.title='拖动或用方向键移动';grip.disabled=busy||blocked;card.append(link,grip);cards.append(card);}block.append(cards);section.append(block);}grid.append(section);
  }if(!grouped.size)grid.append(make('p','没有找到匹配的功能，请换个说法查找。','directory-empty'));if(term&&!exact.length&&matches.length)grid.prepend(make('p','按相近读音或识别错字找到以下候选，请核对功能名称后打开。','directory-empty'));root.classList.toggle('is-arranging',editing);arrange.setAttribute('aria-pressed',String(editing));arrange.textContent=editing?'完成':'排列';search.disabled=editing||busy;arrange.disabled=busy||blocked;
  const bar=document.getElementById('directory-movebar');bar.hidden=!editing;document.getElementById('directory-selected').textContent=entries.get(selectedId)?.label||'选择模块';for(const b of bar.querySelectorAll('button'))b.disabled=busy||blocked||!selectedId;
  document.getElementById('directory-persona').textContent=listing.persona==='owner'?'老板':'我的功能';
 }
 async function load(){
  const version=++generation;busy=true;blocked=false;pending=null;retry.hidden=true;arrange.disabled=true;message('正在读取…');
  try{const data=await request();if(version!==generation)return;if(!Array.isArray(data.entries)||!Array.isArray(data.order)||!Number.isSafeInteger(data.revision))throw Error('功能目录不完整');listing=data;busy=false;render();message('');}
  catch(e){if(version!==generation)return;busy=false;blocked=true;arrange.disabled=true;message(e.name==='AbortError'?'读取超时，请重试。':e.message);retry.textContent='重新读取';retry.hidden=false;}
 }
 async function persist(){
  if(busy||!listing)return;
  if(!pending)pending={body:{page:'home-directory',order:listing.order.slice(),revision:listing.revision},key:crypto.randomUUID()};
  const attempt=pending,version=generation;busy=true;render();retry.hidden=true;message('正在保存…');
  try{const result=await request(attempt.body,attempt.key);if(version!==generation)return;listing=result;pending=null;blocked=false;message('已保存');}
  catch(e){if(version!==generation)return;blocked=true;if([400,401,403,409].includes(e.status)){pending=null;retry.textContent='重新读取';}else retry.textContent='重试保存';message(e.name==='AbortError'?'保存超时，当前排列已保留。':e.message);retry.hidden=false;}
  finally{if(version===generation){busy=false;render();}}
 }
 function move(id,target){const order=listing.order,from=order.indexOf(id),to=typeof target==='number'?target:order.indexOf(target);if(from<0||to<0||to>=order.length||from===to)return false;order.splice(from,1);order.splice(to,0,id);
  const nodes=new Map([...grid.children].map(n=>[n.dataset.id,n]));for(const key of order)grid.append(nodes.get(key));return true;
 }
 arrange.onclick=()=>{if(busy||blocked)return;editing=!editing;selectedId||=listing.order[0];search.value='';render();message(editing?'拖动小方块换位，也可用方向键移动。':'');};
 search.oninput=render;retry.onclick=()=>pending?persist():load();
 grid.addEventListener('click',e=>{const grip=e.target.closest('.directory-grip');if(grip&&editing&&!busy&&!blocked){selectedId=grip.closest('.directory-card').dataset.id;render();}if(grip||editing)e.preventDefault();});
 document.getElementById('directory-movebar').onclick=e=>{const button=e.target.closest('[data-move]');if(!button||busy||blocked||!editing||!selectedId)return;const index=listing.order.indexOf(selectedId);if(move(selectedId,index+Number(button.dataset.move)))persist();};
 grid.addEventListener('keydown',e=>{
  const grip=e.target.closest('.directory-grip');if(!grip||!editing||busy||blocked)return;
  const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-4,ArrowDown:4}[e.key];if(delta===undefined)return;e.preventDefault();
  const id=grip.closest('.directory-card').dataset.id,index=listing.order.indexOf(id);
  if(move(id,index+delta))persist().then(()=>[...grid.querySelectorAll('.directory-card')].find(n=>n.dataset.id===id)?.querySelector('.directory-grip').focus());
 });
 grid.addEventListener('dragstart',e=>{const card=e.target.closest('.directory-card');if(!editing||busy||blocked||!card){e.preventDefault();return;}dragId=card.dataset.id;card.classList.add('is-dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);});
 grid.addEventListener('dragover',e=>{if(dragId){e.preventDefault();e.dataTransfer.dropEffect='move';}});
 grid.addEventListener('drop',e=>{if(!dragId||busy||blocked)return;e.preventDefault();const card=e.target.closest('.directory-card'),id=dragId;dragId=null;if(card&&move(id,card.dataset.id))persist();else render();});
 grid.addEventListener('dragend',()=>{dragId=null;for(const card of grid.children)card.classList.remove('is-dragging');});
 grid.addEventListener('pointerdown',e=>{const grip=e.target.closest('.directory-grip');if(!grip||e.pointerType==='mouse'||!editing||busy||blocked)return;e.preventDefault();selectedId=grip.closest('.directory-card').dataset.id;document.getElementById('directory-selected').textContent=listing.entries.find(x=>x.id===selectedId)?.label||'';touch={id:selectedId,pointer:e.pointerId,changed:false};grip.closest('.directory-card').classList.add('is-dragging');});
 document.addEventListener('pointermove',e=>{if(!touch||touch.pointer!==e.pointerId)return;e.preventDefault();const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.directory-card');if(target&&move(touch.id,target.dataset.id))touch.changed=true;if(e.clientY<70)window.scrollBy(0,-16);else if(e.clientY>innerHeight-70)window.scrollBy(0,16);},{passive:false});
 const finish=e=>{if(!touch||touch.pointer!==e.pointerId)return;const changed=touch.changed;touch=null;for(const card of grid.children)card.classList.remove('is-dragging');if(changed)persist();};
 document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
 addEventListener('pagehide',()=>{generation++;controller?.abort();touch=null;dragId=null;});
 load();
})();
