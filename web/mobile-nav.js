(()=>{
 const params=new URLSearchParams(location.search),root=document.documentElement;
 root.classList.toggle('sales-focus',location.pathname==='/app'&&params.get('tab')==='sales');
 root.classList.toggle('single-payment-task',location.pathname==='/business-reconciliation'&&params.get('section')==='payments');
 root.classList.toggle('payment-request-list',location.pathname==='/business-reconciliation'&&params.get('entry')==='requests');
 if(location.pathname==='/assistant'&&params.get('work-signin')==='1'){
  root.classList.add('attendance-task');
  const prepare=()=>{document.title='考勤打卡';const title=document.getElementById('assistant-title');if(title)title.textContent='考勤打卡';const panel=document.getElementById('attendance-panel');if(panel)panel.closest('details').open=true;};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',prepare,{once:true});else prepare();
 }
})();
(()=>{
 if(['/companion','/kitty'].includes(location.pathname))return;
 const onHome=location.pathname==='/m';
 const onPhone=window.matchMedia('(max-width: 700px)').matches;
 const fontKey='store-task-large-text-v1';let doubleText=false;
 try{const v=localStorage.getItem(fontKey);doubleText=v==='1'||(v===null&&localStorage.getItem('store-mobile-text-size')==='double');}catch{}
 const applyText=(value,persist=false)=>{
  doubleText=value==='double';
  document.documentElement.classList.remove('mobile-text-double','mobile-text-large');
  document.documentElement.classList.toggle('task-text-large',doubleText);document.body.classList.toggle('task-text-large',doubleText);
  const button=document.querySelector('.text-size-toggle');
  if(button){button.textContent=doubleText?'标准模式':'大字版';button.setAttribute('aria-pressed',String(doubleText));button.setAttribute('aria-label',doubleText?'当前大字版，切换标准模式':'当前标准模式，切换大字版');}
  if(persist){try{localStorage.setItem(fontKey,doubleText?'1':'0');}catch{}window.dispatchEvent(new CustomEvent('store:font-change',{detail:{large:doubleText}}));}
  document.querySelectorAll('.assistant-float-panel iframe').forEach(frame=>frame.contentWindow?.postMessage({type:'assistant:text-size',value:doubleText?'double':'large'},location.origin));
 };
 applyText(doubleText?'double':'large');
 window.addEventListener('storage',e=>{if(e.key===fontKey)applyText(e.newValue==='1'?'double':'large');});
 window.addEventListener('store:font-change',e=>{if(typeof e.detail?.large==='boolean')applyText(e.detail.large?'double':'large');});
 window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===window.parent&&e.data?.type==='assistant:text-size')applyText(e.data.value);});
 if(location.pathname==='/assistant'&&new URLSearchParams(location.search).has('embedded'))return;
 const dock=document.createElement('nav');
 dock.className='mobile-action-dock';
 dock.setAttribute('aria-label','固定页面操作');
 const backHref='/m';
 const backLabel=onHome?'进销存首页':'返回工作台';
 dock.innerHTML='<a href="'+backHref+'" aria-label="'+backLabel+'"><span class="nav-icon" aria-hidden="true">⌂</span><span>'+(onHome?'首页':'返回工作台')+'</span></a><button type="button" class="text-size-toggle" aria-label="切换手机字体大小" aria-pressed="'+doubleText+'">'+(doubleText?'字小':'字大')+'</button><button type="button" class="mobile-logout" aria-label="退出登录"><span class="nav-icon" aria-hidden="true">×</span><span>退出</span></button>';
 document.body.append(dock);applyText(doubleText?'double':'large');
 if(onHome){
  const brand=document.querySelector('.home-header .home-brand');
  const homeLink=dock.querySelector('a[href="/m"]');
  if(brand&&homeLink){
   const marker=document.createComment('门店标识在宽屏时返回这里');brand.before(marker);
   const phoneHeader=window.matchMedia('(max-width: 1023px), (hover: none) and (pointer: coarse)');
   const placeBrand=()=>{
    if(phoneHeader.matches){if(brand.parentElement!==dock)dock.replaceChild(brand,homeLink);}
    else{if(brand.parentElement===dock)marker.after(brand);if(!homeLink.isConnected)dock.prepend(homeLink);}
   };
   placeBrand();phoneHeader.addEventListener?.('change',placeBrand);
  }
 }
 if(location.pathname==='/app'){
  const navigation=document.createElement('button');navigation.type='button';navigation.className='sale-navigation-toggle';navigation.textContent='导航';navigation.setAttribute('aria-controls','nav');navigation.setAttribute('aria-expanded','false');dock.append(navigation);
  const sync=()=>{navigation.hidden=!document.documentElement.classList.contains('sales-focus');navigation.setAttribute('aria-expanded',String(document.documentElement.classList.contains('sales-navigation-open')));};
  navigation.addEventListener('click',()=>{document.documentElement.classList.toggle('sales-navigation-open');sync();});
  document.addEventListener('office-navigation-change',sync);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){document.documentElement.classList.remove('sales-navigation-open');sync();}});
  sync();
 }

 dock.querySelector('.text-size-toggle').addEventListener('click',()=>{applyText(doubleText?'large':'double',true);});
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
  const entries={work:{label:'工作助理',title:'工作助理',url:'/assistant?mode=store&embedded=1',href:'/assistant?mode=store'},personal:{label:'个人',title:'我的个人助理',url:'/companion?embedded=1',href:'/companion'},customer:{label:'小猫咪',title:'小猫咪机器人',url:'/kitty?embedded=1',href:'/kitty'}};
  if(location.pathname==='/m'){
    const section=document.createElement('nav');section.id='home-assistant-modules';section.className='home-assistant-modules';section.dataset.homeFixed='1';section.setAttribute('aria-label','助理');
    const titles={work:'工作助理',personal:'个人助理',customer:'小猫咪'};
    async function load(){
      section.textContent='';
      try{const response=await fetch('/api/assistant/roles',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('roles');const roles=await response.json();
        for(const [key,entry] of Object.entries(entries)){if(!roles[key])continue;const link=document.createElement('a');link.href=entry.href;link.textContent=titles[key];link.className='home-assistant-module';link.setAttribute('aria-label','打开'+titles[key]);section.append(link);}
      }catch{const retry=document.createElement('button');retry.type='button';retry.textContent='重新读取助理入口';retry.addEventListener('click',load);section.append(retry);}
    }
    const headerRow=document.querySelector('.home-header .hero-top');if(headerRow)headerRow.insertBefore(section,document.getElementById('identity'));else document.querySelector('main')?.prepend(section);load();return;
  }
  if(false){
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
    if(location.pathname!=='/m'&&document.querySelector('.mobile-action-dock'))document.querySelector('.mobile-action-dock').append(homeSlot);
  else if(title){const host=document.createElement('span');host.className='assistant-brand-actions';title.before(host);host.append(title,homeSlot);}
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
  if(location.pathname!=='/m'&&document.querySelector('.mobile-action-dock'))document.querySelector('.mobile-action-dock').append(homeSlot);
  else if(title){const host=document.createElement('span');host.className='assistant-brand-actions';title.before(host);host.append(title,homeSlot);}
  else{const bar=document.createElement('div');bar.className='assistant-launcher-bar';bar.append(homeSlot);document.body.prepend(bar);}
  const panel=document.createElement('section');panel.className='assistant-float-panel assistant-separated-panel';panel.id='assistant-entry-panel';panel.hidden=true;
  const head=document.createElement('div');head.className='assistant-float-head';const heading=document.createElement('strong'),actions=document.createElement('div'),independent=document.createElement('a'),closeButton=document.createElement('button');
  independent.textContent='独立打开 ↗';independent.target='_blank';independent.rel='noopener';closeButton.type='button';closeButton.textContent='×';closeButton.setAttribute('aria-label','收起助理');actions.append(independent,closeButton);head.append(heading,actions);
  const loading=document.createElement('p');loading.className='assistant-frame-status';loading.setAttribute('role','status');loading.hidden=true;panel.append(head,loading);document.body.append(panel);
  const frames=new Map();let active='',lastButton=null,roles=null,roleRequest=0;
  const notify=(frame,type)=>frame?.contentWindow?.postMessage({type},location.origin);
  const textSize=frame=>{const value=document.documentElement.classList.contains('task-text-large')?'double':'large';frame?.contentWindow?.postMessage({type:'assistant:text-size',value},location.origin);};
  function update(){for(const [name,b]of Object.entries(buttons)){const selected=!panel.hidden&&active===name;b.setAttribute('aria-expanded',String(selected));b.setAttribute('aria-pressed',String(selected));}}
  function close(){if(panel.hidden)return;notify(frames.get(active)?.frame,'assistant:close');for(const entry of frames.values())entry.frame.hidden=true;panel.hidden=true;document.body.classList.remove('assistant-personal-open');homeSlot.append(group);loading.hidden=true;update();lastButton?.focus();}
  function open(name){
    if(name!=='customer'&&(!roles||(name==='work'?!roles.work:!roles.personal)))return;
    if(!panel.hidden&&active===name){close();return;}
    if(!panel.hidden)notify(frames.get(active)?.frame,'assistant:close');
    for(const entry of frames.values())entry.frame.hidden=true;
    active=name;lastButton=buttons[name];const entry=entries[name];panel.dataset.assistant=name;panel.setAttribute('aria-label',entry.title);heading.textContent=entry.title;independent.href=entry.href;closeButton.setAttribute('aria-label','收起'+entry.title);head.prepend(group);panel.hidden=false;document.body.classList.toggle('assistant-personal-open',name==='personal');
    let item=frames.get(name);
    if(!item){
      const frame=document.createElement('iframe');frame.title=entry.title;frame.loading='eager';frame.setAttribute('allow','microphone; camera; geolocation');item={frame,loaded:false};frames.set(name,item);panel.append(frame);
      frame.addEventListener('load',()=>{item.loaded=true;const visible=!panel.hidden&&active===name;notify(frame,visible?'assistant:open':'assistant:close');if(visible){loading.hidden=true;textSize(frame);}});
      frame.src=entry.url;
    }
    item.frame.hidden=false;loading.hidden=item.loaded;loading.textContent='正在打开'+entry.title+'…';if(item.loaded){textSize(item.frame);notify(item.frame,'assistant:open');}update();closeButton.focus();
  }
  for(const [name,b]of Object.entries(buttons)){b.setAttribute('aria-controls',panel.id);b.addEventListener('click',()=>open(name));}
  window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===frames.get('personal')?.frame.contentWindow&&event.data?.type==='assistant:request-close'&&active==='personal')close();});
  const fitPersonal=()=>{const viewport=window.visualViewport;document.documentElement.style.setProperty('--assistant-personal-height',(viewport?.height||innerHeight)+'px');document.documentElement.style.setProperty('--assistant-personal-top',(viewport?.offsetTop||0)+'px');};
  window.visualViewport?.addEventListener('resize',fitPersonal);window.visualViewport?.addEventListener('scroll',fitPersonal);window.addEventListener('resize',fitPersonal);fitPersonal();
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


(()=>{if(window.top!==window||['/companion','/kitty'].includes(location.pathname))return;const style=document.createElement("link");style.rel="stylesheet";style.href="/store-communication.css?v=20261024-screen-return-v2";document.head.append(style);const script=document.createElement("script");script.src="/store-communication.js?v=20261024-approved-screen-batch-r2";document.head.append(script)})();
