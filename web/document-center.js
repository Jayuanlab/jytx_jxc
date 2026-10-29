'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let data,group='',q='';
 function render(){
  const groups=data.groups;
  if(!groups.some(g=>g.id===group))group=groups[0]?.id||'';
  $('document-groups').innerHTML=groups.map(g=>'<button type="button" data-group="'+E(g.id)+'" aria-pressed="'+(!q&&g.id===group)+'"><span>'+E(g.label)+'</span><span class="category-count">'+g.items.length+'</span></button>').join('');
  const selected=groups.find(g=>g.id===group);
  const rows=groups.filter(g=>q||g.id===group).flatMap(g=>g.items.map(i=>({...i,group:g.label}))).filter(i=>!q||(i.label+' '+i.group+' '+i.actions.map(a=>a.label).join(' ')).toLowerCase().includes(q.toLowerCase()));
  $('document-result-title').textContent=q?'查找结果':selected?.label||'单据目录';
  $('document-items').innerHTML=rows.length?rows.map(i=>'<tr><td><strong class="document-name">'+E(i.label)+'</strong>'+(q?'<span class="document-group-label">'+E(i.group)+'</span>':'')+'</td><td><div class="document-actions">'+i.actions.map(a=>'<a href="'+E(a.href)+'">'+E(a.label)+'</a>').join('')+'</div></td></tr>').join(''):'<tr><td class="document-empty" colspan="2">没有找到对应单据。请换个名称查找，或清空后按左侧类别查看。</td></tr>';
  $('document-status').textContent=q?'找到 '+rows.length+' 类单据入口。':rows.length+' 类单据入口；选择单据后进入原办理页面。';
 }
 $('document-search-form').onsubmit=e=>{e.preventDefault();q=$('document-search').value.trim();render();};
 $('document-reset').onclick=()=>{$('document-search').value='';q='';render();};
 $('document-groups').onclick=e=>{const b=e.target.closest('[data-group]');if(!b)return;group=b.dataset.group;q='';$('document-search').value='';render();};
 fetch('/api/document-center',{credentials:'same-origin',cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error?.message||'目录读取未成功，请刷新');return d;}).then(d=>{data=d;$('document-person').textContent=d.actor.name;const preset=new URLSearchParams(location.search).get('group');group=d.groups.some(g=>g.id===preset)?preset:'';render();}).catch(e=>{$('document-status').textContent=e.message;$('document-status').className='error';});
})();
