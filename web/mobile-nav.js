(()=>{
 if(['/companion','/kitty'].includes(location.pathname))return;
 const onHome=location.pathname==='/m';
 const onPhone=window.matchMedia('(max-width: 700px)').matches;
 let doubleText=true;
 if(onPhone){
  try{doubleText=localStorage.getItem('store-mobile-text-size')!=='large';}catch{}
  document.documentElement.classList.add(doubleText?'mobile-text-double':'mobile-text-large');
 }
 const applyText=value=>{
  doubleText=value!=='large';
  document.documentElement.classList.toggle('mobile-text-double',doubleText);
  document.documentElement.classList.toggle('mobile-text-large',!doubleText);
  const button=document.querySelector('.text-size-toggle');
  if(button){
   button.textContent=doubleText?'字小':'字大';
   button.setAttribute('aria-pressed',String(doubleText));
   button.setAttribute('aria-label',doubleText?'当前双倍字，点击切换为大字':'当前大字，点击切换为双倍字');
  }
  document.querySelectorAll('.assistant-float-panel iframe').forEach(frame=>frame.contentWindow?.postMessage({type:'assistant:text-size',value:doubleText?'double':'large'},location.origin));
 };
 window.addEventListener('storage',e=>{if(onPhone&&e.key==='store-mobile-text-size')applyText(e.newValue);});
 window.addEventListener('message',e=>{if(onPhone&&e.origin===location.origin&&e.source===window.parent&&e.data?.type==='assistant:text-size')applyText(e.data.value);});
 if(location.pathname==='/assistant'&&new URLSearchParams(location.search).has('embedded'))return;
 const dock=document.createElement('nav');
 dock.className='mobile-action-dock';
 dock.setAttribute('aria-label','固定页面操作');
 const backHref='/m';
 const backLabel='返回进销存首页';
 dock.innerHTML='<a href="'+backHref+'" aria-label="'+backLabel+'"><span class="nav-icon" aria-hidden="true">⌂</span><span>首页</span></a><button type="button" class="text-size-toggle" aria-label="切换手机字体大小" aria-pressed="'+doubleText+'">'+(doubleText?'字小':'字大')+'</button><button type="button" class="mobile-logout" aria-label="退出登录"><span class="nav-icon" aria-hidden="true">×</span><span>退出</span></button>';
 document.body.append(dock);
 dock.querySelector('.text-size-toggle').addEventListener('click',()=>{
  applyText(doubleText?'large':'double');
  try{localStorage.setItem('store-mobile-text-size',doubleText?'double':'large');}catch{}

 });
 dock.querySelector('.mobile-logout').addEventListener('click',async()=>{
  const button=dock.querySelector('.mobile-logout');
  button.disabled=true;
  button.setAttribute('aria-label','正在退出登录');
  try{
   const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
   if(!response.ok)throw new Error('退出失败');
   sessionStorage.removeItem('officeLocalToken');
   location.href='/login';
  }catch{
   button.disabled=false;
   button.setAttribute('aria-label','退出登录');
  }
 });
})();
(()=>{
  if(['/assistant','/companion','/kitty','/login'].includes(location.pathname)||window.top!==window||window.StoreAssistantEntries)return;
  window.StoreAssistantEntries=true;
  const entries={work:{label:'工作',title:'工作助理',url:'/assistant?mode=store&embedded=1',href:'/assistant?mode=store'},personal:{label:'个人',title:'我的个人助理',url:'/companion?embedded=1',href:'/companion'},customer:{label:'小猫咪',title:'小猫咪机器人',url:'/kitty?embedded=1',href:'/kitty'}};
  if(!window.matchMedia('(max-width: 700px)').matches){
    const group=document.createElement('span');group.className='assistant-entry-controls';group.setAttribute('aria-label','选择助理');
    const choices=document.createElement('span');choices.className='assistant-role-choice';choices.setAttribute('role','group');choices.setAttribute('aria-label','工作或个人助理');
    const links={};
    for(const [name,entry]of Object.entries(entries)){
      const link=document.createElement('a');link.id='assistant-entry-'+name;link.className='assistant-entry-button assistant-entry-'+name;link.href=entry.href;link.textContent=entry.label;link.title=entry.title;link.setAttribute('aria-label','打开'+entry.title);
      if(name==='customer')group.append(link);else choices.append(link);links[name]=link;
    }
    group.prepend(choices);links.work.hidden=true;links.personal.hidden=true;
    const state=document.createElement('span');state.className='assistant-entry-state';state.setAttribute('role','status');state.textContent='确认权限…';
    const retry=document.createElement('button');retry.type='button';retry.className='assistant-entry-retry';retry.textContent='重试';retry.hidden=true;
    const login=document.createElement('a');login.href='/login';login.textContent='登录';login.hidden=true;group.append(state,retry,login);
    const homeSlot=document.createElement('span');homeSlot.className='assistant-entry-home-slot';homeSlot.append(group);
    const title=document.querySelector('.home-header .home-brand')||document.querySelector('.topbar .brand strong,header h1,header strong,.heading h1,main > h1');
    if(title){const host=document.createElement('span');host.className='assistant-brand-actions';title.before(host);host.append(title,homeSlot);}
    else{const bar=document.createElement('div');bar.className='assistant-launcher-bar';bar.append(homeSlot);document.body.prepend(bar);}
    async function loadRoles(){
      retry.hidden=true;login.hidden=true;state.hidden=false;state.textContent='确认权限…';
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{
        const response=await fetch('/api/assistant/roles',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok){const error=Error(response.status===401?'请先登录，再打开工作或个人助理。':'助理权限暂未读到，请重试。');error.status=response.status;throw error;}
        const roles=await response.json();if(typeof roles.work!=='boolean'||typeof roles.personal!=='boolean')throw Error('助理权限暂未读到，请重试。');
        links.work.hidden=!roles.work;links.personal.hidden=!roles.personal;choices.hidden=!roles.work&&!roles.personal;state.hidden=true;
      }catch(error){links.work.hidden=true;links.personal.hidden=true;choices.hidden=true;state.textContent=error.name==='AbortError'?'确认权限超时，请重试。':error.message;retry.hidden=false;login.hidden=error.status!==401;}
      finally{clearTimeout(timer);}
    }
    retry.addEventListener('click',loadRoles);loadRoles();return;
  }
  const group=document.createElement('span');group.className='assistant-entry-controls';group.setAttribute('aria-label','选择助理');
  const choices=document.createElement('span');choices.className='assistant-role-choice';choices.setAttribute('role','group');choices.setAttribute('aria-label','工作或个人助理');
  const buttons={};
  for(const [name,entry]of Object.entries(entries)){
    const b=document.createElement('button');b.type='button';b.id='assistant-entry-'+name;b.className='assistant-entry-button assistant-entry-'+name;b.textContent=entry.label;b.title=entry.title;b.setAttribute('aria-label','打开'+entry.title);b.setAttribute('aria-expanded','false');b.setAttribute('aria-pressed','false');
    if(name==='customer')group.append(b);else choices.append(b);buttons[name]=b;
  }
  group.prepend(choices);buttons.work.disabled=true;buttons.personal.hidden=true;
  const state=document.createElement('span');state.className='assistant-entry-state';state.setAttribute('role','status');state.textContent='确认权限…';
  const retry=document.createElement('button');retry.type='button';retry.className='assistant-entry-retry';retry.textContent='重试';retry.hidden=true;
  const login=document.createElement('a');login.href='/login';login.textContent='登录';login.hidden=true;group.append(state,retry,login);
  const homeSlot=document.createElement('span');homeSlot.className='assistant-entry-home-slot';homeSlot.append(group);
  const title=document.querySelector('.home-header .home-brand')||document.querySelector('.topbar .brand strong,header h1,header strong,.heading h1,main > h1');
  if(title){const host=document.createElement('span');host.className='assistant-brand-actions';title.before(host);host.append(title,homeSlot);}
  else{const bar=document.createElement('div');bar.className='assistant-launcher-bar';bar.append(homeSlot);document.body.prepend(bar);}
  const panel=document.createElement('section');panel.className='assistant-float-panel assistant-separated-panel';panel.id='assistant-entry-panel';panel.hidden=true;
  const head=document.createElement('div');head.className='assistant-float-head';const heading=document.createElement('strong'),actions=document.createElement('div'),independent=document.createElement('a'),closeButton=document.createElement('button');
  independent.textContent='独立打开 ↗';independent.target='_blank';independent.rel='noopener';closeButton.type='button';closeButton.textContent='×';closeButton.setAttribute('aria-label','收起助理');actions.append(independent,closeButton);head.append(heading,actions);
  const loading=document.createElement('p');loading.className='assistant-frame-status';loading.setAttribute('role','status');loading.hidden=true;panel.append(head,loading);document.body.append(panel);
  const frames=new Map();let active='',lastButton=null,roles=null,roleRequest=0;
  const notify=(frame,type)=>frame?.contentWindow?.postMessage({type},location.origin);
  const textSize=frame=>{let value='double';try{value=localStorage.getItem('store-mobile-text-size')==='large'?'large':'double';}catch{}frame?.contentWindow?.postMessage({type:'assistant:text-size',value},location.origin);};
  function update(){for(const [name,b]of Object.entries(buttons)){const selected=!panel.hidden&&active===name;b.setAttribute('aria-expanded',String(selected));b.setAttribute('aria-pressed',String(selected));}}
  function close(){if(panel.hidden)return;notify(frames.get(active)?.frame,'assistant:close');for(const entry of frames.values())entry.frame.hidden=true;panel.hidden=true;homeSlot.append(group);loading.hidden=true;update();lastButton?.focus();}
  function open(name){
    if(name!=='customer'&&(!roles||(name==='work'?!roles.work:!roles.personal)))return;
    if(!panel.hidden&&active===name){close();return;}
    if(!panel.hidden)notify(frames.get(active)?.frame,'assistant:close');
    for(const entry of frames.values())entry.frame.hidden=true;
    active=name;lastButton=buttons[name];const entry=entries[name];panel.dataset.assistant=name;panel.setAttribute('aria-label',entry.title);heading.textContent=entry.title;independent.href=entry.href;closeButton.setAttribute('aria-label','收起'+entry.title);head.prepend(group);panel.hidden=false;
    let item=frames.get(name);
    if(!item){
      const frame=document.createElement('iframe');frame.title=entry.title;frame.loading='eager';frame.setAttribute('allow','microphone; camera; geolocation');item={frame,loaded:false};frames.set(name,item);panel.append(frame);
      frame.addEventListener('load',()=>{item.loaded=true;const visible=!panel.hidden&&active===name;notify(frame,visible?'assistant:open':'assistant:close');if(visible){loading.hidden=true;textSize(frame);}});
      frame.src=entry.url;
    }
    item.frame.hidden=false;loading.hidden=item.loaded;loading.textContent='正在打开'+entry.title+'…';if(item.loaded){textSize(item.frame);notify(item.frame,'assistant:open');}update();closeButton.focus();
  }
  for(const [name,b]of Object.entries(buttons)){b.setAttribute('aria-controls',panel.id);b.addEventListener('click',()=>open(name));}
  closeButton.addEventListener('click',close);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)close();});
  window.addEventListener('pagehide',()=>{for(const item of frames.values())notify(item.frame,'assistant:close');});
  async function loadRoles(){
    const generation=++roleRequest;retry.hidden=true;login.hidden=true;state.hidden=false;state.textContent='确认权限…';buttons.work.disabled=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/api/assistant/roles',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(!response.ok){const error=Error(response.status===401?'请先登录，再打开工作或个人助理。':'助理权限暂未读到，请重试。');error.status=response.status;throw error;}
      const next=await response.json();if(typeof next.work!=='boolean'||typeof next.personal!=='boolean')throw Error('助理权限暂未读到，请重试。');if(generation!==roleRequest)return;
      roles=next;buttons.work.hidden=!roles.work;buttons.work.disabled=false;buttons.personal.hidden=!roles.personal;choices.hidden=!roles.work&&!roles.personal;state.hidden=true;
      if(active==='work'&&!roles.work||active==='personal'&&!roles.personal)close();
    }catch(error){if(generation!==roleRequest)return;roles=null;buttons.work.hidden=false;buttons.work.disabled=true;buttons.personal.hidden=true;choices.hidden=false;state.textContent=error.name==='AbortError'?'确认权限超时，请重试。':error.message;retry.hidden=false;login.hidden=error.status!==401;}
    finally{clearTimeout(timer);}
  }
  retry.addEventListener('click',loadRoles);loadRoles();
})();


(()=>{if(window.top!==window||['/companion','/kitty'].includes(location.pathname))return;const style=document.createElement("link");style.rel="stylesheet";style.href="/store-communication.css?v=20261010-interface";document.head.append(style);const script=document.createElement("script");script.src="/store-communication.js?v=20261010-interface";document.head.append(script)})();
