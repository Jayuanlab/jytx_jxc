'use strict';
const shortcuts=require('./personal-shortcuts'),live=require('./screen-live');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inject(html,store,user){
 const data=shortcuts.list(store,user),entries=new Map(data.entries.map(x=>[x.id,x])),page=data.pages[0].length?data.pages[0]:data.pages[1],icon='<span class="ps-module-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="19" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span>';
 const cards=page.map(id=>{const row=entries.get(id);return row?'<a href="'+esc(row.href)+'" data-module-id="'+esc(id)+'">'+icon+'<strong>'+esc(row.label)+'</strong></a>':'';}).join('');
 const host='<section id="personal-shortcuts" class="personal-shortcuts" data-initial-account="'+esc(user.id)+'"><div class="ps-heading"><h2>'+(data.persona==='owner'?'老板工作台':'我的工作台')+'</h2><div class="ps-heading-actions"><a class="ps-directory-link" href="/workbench-all">功能总览</a><button type="button" data-ps-manage disabled>编辑模块</button></div></div><p role="status" data-ps-status></p><div class="ps-tabs" role="group" aria-label="我的模块页面" hidden></div><nav class="ps-grid" aria-label="我的模块功能">'+cards+'</nav><button type="button" data-ps-retry hidden>重新读取</button></section>';
 const first=live.feed(store)[0],placeholder='<div class="home-board-placeholder"><p>'+esc(first?.content||'认真相伴，温暖服务。')+'</p></div>';
 html=html.replace('<body class="store-workbench">','<body class="store-workbench calm-workbench personal-shortcuts-ready" data-home-initial data-workbench-persona="'+data.persona+'">');
 html=html.replace('<div id="home-board-slot"></div>','<div id="home-board-slot">'+placeholder+'</div>');
 html=html.replace('<div class="hero-actions"',host+'<div class="hero-actions"');
 return html.replace(/(<span id="identity"[^>]*>)[\s\S]*?(<\/span>)/,(_m,a,b)=>a+esc(user.name)+b);
}
function shell(html){
 html=html.replace('<body class="store-workbench">','<body class="store-workbench calm-workbench" data-home-initial data-home-pending>');
 return html.replace('<div id="home-board-slot"></div>','<div id="home-board-slot"><div class="home-board-placeholder"><p>用心服务，温暖相伴。</p></div></div>');
}
module.exports={inject,shell};
