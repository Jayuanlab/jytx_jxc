/* Local, account and branch scoped unfinished work. Never submits on restoration. */
(()=>{'use strict';
 if(window.top!==window||window.StoreWorkContinuity||!window.StoreContinuityCore)return;
 const C=window.StoreContinuityCore,originalFetch=window.fetch.bind(window),adapters=new Map(),applied=new WeakMap(),touched=new WeakSet();
 const createPaths=new Set(['/api/sale-orders','/api/receptions','/api/carrier-services','/api/repair-services']),completedRoutes=new Set(),completedNames=new Set();let reads=0,settled=null;
 let namespace='',data=null,activeRoute=C.route(location.pathname+location.search),ready=false,restoring=false,restorePending=false,scrollRestored=false,timer=null,observer=null,mutations=null,blocked=false,storageFailed=false,exiting=false;
 const key=()=> 'store-unfinished-work-v1:'+namespace;
 const isHome=()=>location.pathname==='/m';
 function persist(){if(!namespace||!data||blocked)return false;let ok=false;try{ok=C.write(localStorage,key(),data);}catch{}storageFailed=!ok;if(!ok&&document.body&&!document.getElementById('unfinished-storage-warning')){const p=document.createElement('p');p.id='unfinished-storage-warning';p.setAttribute('role','alert');p.textContent='本机存储不可用，关闭页面后可能无法恢复。请先保存当前业务。';document.querySelector('main')?.prepend(p);}return ok;}
 function label(){return (document.querySelector('main h1,#main h1')||document.querySelector('header strong,.brand strong'))?.textContent?.trim().slice(0,80)||document.title.split('·').pop().trim();}
 function controls(){return [...document.querySelectorAll('main input,main select,main textarea')].filter(e=>C.fieldAllowed(e)&&!e.closest('dialog,#modal-root,#sale-checkout,.assistant-intake,[data-no-draft]'));}
 function fieldKey(el){if(el.id)return 'id:'+el.id;const f=el.form;if(!el.name||!f?.id)return '';const peers=[...f.elements].filter(n=>n.name===el.name);return 'form:'+f.id+':'+el.name+':'+peers.indexOf(el);}
 function snapshot(){
  if(!namespace||!data||!ready||blocked||restoring||exiting)return;
  if(activeRoute&&!restorePending&&!completedRoutes.has(activeRoute)){const prior=data.pages[activeRoute]||{},fields={};for(const el of controls()){const id=fieldKey(el);if(id)fields[id]=String(el.value).slice(0,20000);}const details={};for(const el of document.querySelectorAll('main details[id]'))details[el.id]=el.open;
   data.pages[activeRoute]={...prior,at:Date.now(),label:label(),fields,details,scroll:{x:scrollX,y:scrollY}};
   data.last={route:activeRoute,label:label(),at:Date.now()};data.navigation={open:true,route:activeRoute};
  }
  for(const [name,a]of adapters){if(completedNames.has(name))continue;try{const value=a.read();data.adapters[name]={value,route:C.route(a.route||activeRoute),at:Date.now(),label:a.label||label()};if(C.route(a.route||activeRoute)===activeRoute&&a.meaningful?.(value))data.last={route:C.route(a.route||activeRoute),label:a.label||label(),at:Date.now()};}catch{}}
  persist();
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(snapshot,120);}
 function bind(value){
  const next=C.scope(value);if(!next||blocked)return;
  if(namespace&&namespace!==next){snapshot();blocked=true;ready=false;location.replace('/m');return;}
  if(namespace)return;
  namespace=next;data=C.read(localStorage,key());if(data.navigationPolicy!==2){delete data.last;data.navigation={open:false};data.navigationPolicy=2;persist();}
  for(const [name,a]of adapters){const entry=data.adapters[name];if(entry)try{a.restore(entry.value);}catch{}}
  mountResume();
 }
 function pageReady(){if(!namespace||blocked)return;ready=true;const saved=data.pages[activeRoute];restorePending=!!saved;restore();}
 function restore(){
  if(!ready||blocked||restoring||!restorePending)return;const saved=data.pages[activeRoute];if(!saved){restorePending=false;return;}
  restoring=true;let waiting=false;const missing=new Set(Object.keys(saved.fields||{}));
  try{for(const el of controls()){const id=fieldKey(el);if(!id||!Object.hasOwn(saved.fields||{},id))continue;missing.delete(id);if(touched.has(el)||applied.get(el)===saved.fields[id])continue;const value=saved.fields[id];if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value)){waiting=true;continue;}el.value=value;applied.set(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}
   for(const [id,open]of Object.entries(saved.details||{})){const el=document.getElementById(id);if(el?.tagName==='DETAILS')el.open=!!open;}
   if(!scrollRestored&&!missing.size){scrollRestored=true;if(!document.documentElement.classList.contains('sales-focus'))requestAnimationFrame(()=>scrollTo({left:saved.scroll?.x||0,top:saved.scroll?.y||0,behavior:'instant'}));}
  }finally{restoring=false;restorePending=waiting||missing.size>0;}
 }
 function mountResume(){
  if(!isHome()||!document.body||!data)return;
  let host=document.getElementById('continue-unfinished-work');if(!data.navigation?.open||!C.route(data.last?.route)){host?.remove();return;}const shortcuts=document.getElementById('personal-shortcuts');if(host){if(shortcuts&&host.parentElement!==shortcuts)shortcuts.prepend(host);return;}
  const last=data.last;if(!C.route(last?.route))return;
  host=document.createElement('section');host.id='continue-unfinished-work';host.className='work-continuity-resume';host.setAttribute('aria-label','返回上次页面');
  host.style.cssText='margin:6px 0;padding:6px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap';
  const note=document.createElement('span');note.textContent='上次页面：'+(last.label||'业务页面');const a=document.createElement('a');a.href=last.route;a.textContent='打开 ›';a.style.cssText='margin-inline-start:auto;min-height:44px;display:inline-flex;align-items:center;font-weight:700';host.append(note,a);
  const main=document.querySelector('main');if(shortcuts)shortcuts.prepend(host);else if(main)main.prepend(host);else document.querySelector('header')?.after(host);
 }
 function register(name,adapter){adapters.set(name,adapter);if(data?.adapters[name]){restoring=true;try{adapter.restore(data.adapters[name].value);}finally{restoring=false;}}return ()=>adapters.delete(name);}
 function clear(name){if(!data)return;if(name)delete data.adapters[name];if(activeRoute){delete data.pages[activeRoute];if(data.last?.route===activeRoute)delete data.last;}restorePending=false;persist();}
 function complete(name){clear(name);if(name)completedNames.add(name);if(activeRoute)completedRoutes.add(activeRoute);}
 function finishNavigation(options={}){
  exiting=true;clearTimeout(timer);clearTimeout(mutations);restorePending=false;
  if(!namespace||!data)return;
  // Keep unresolved submission keys and their draft for reconciliation; never erase transaction evidence.
  const pending=Object.keys(data.requests||{}).length>0;
  if(!pending){for(const route of Object.keys(data.pages))if(options.logout||route===activeRoute)delete data.pages[route];for(const [name,entry]of Object.entries(data.adapters))if(options.logout||entry.route===activeRoute)delete data.adapters[name];}
  delete data.last;data.navigation={open:false,endedRoute:activeRoute,endedAt:Date.now()};data.navigationPolicy=2;persist();document.getElementById('continue-unfinished-work')?.remove();
 }
 document.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||isHome())return;
  const homeButton=event.target?.closest?.('[data-tab="dashboard"]');const link=event.target?.closest?.('a[href]');
  if(homeButton){finishNavigation();return;}if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
  try{const dest=new URL(link.getAttribute('href'),location.href);if(dest.origin===location.origin&&dest.pathname==='/m')finishNavigation();}catch{}
 },true);
 function activate(){const next=C.route(location.pathname+location.search);if(next===activeRoute)return;snapshot();activeRoute=next;ready=false;restorePending=false;scrollRestored=false;}
 window.StoreWorkContinuity={register,pageReady,snapshot,clear,complete,activate,finishNavigation,get restored(){return !!data?.pages[activeRoute];},get storageFailed(){return storageFailed;}};
 window.fetch=async function(input,init={}){
  const request=typeof Request!=='undefined'&&input instanceof Request?input:null;let u;try{u=new URL(request?request.url:String(input),location.href);}catch{return originalFetch(input,init);}
  if(u.origin!==location.origin)return originalFetch(input,init);
  const method=String(init.method||request?.method||'GET').toUpperCase(),tracked=method==='POST'&&createPaths.has(u.pathname)&&namespace&&!blocked;
  let attempt;
  if(tracked){snapshot();const body=typeof init.body==='string'?init.body:'';if(body){const pending=data.requests[u.pathname];if(pending&&pending.body!==body)throw Error('上次提交结果待核对，请保留原内容重试核对原单。');const headers=new Headers(init.headers||request?.headers);attempt=pending||{body,key:headers.get('Idempotency-Key')||crypto.randomUUID(),at:Date.now()};data.requests[u.pathname]=attempt;headers.set('Idempotency-Key',attempt.key);init={...init,headers};persist();}}
  const reading=method==='GET'&&u.pathname.startsWith('/api/');if(reading)reads++;
  let response;try{response=await originalFetch(input,init);}catch(error){if(tracked)persist();throw error;}finally{if(reading){reads--;clearTimeout(settled);settled=setTimeout(()=>{if(!reads&&!ready)pageReady();},250);}}
  const header=response.headers.get('X-Store-Work-Context');if(header){try{bind(JSON.parse(decodeURIComponent(header)));}catch{}}
  if(attempt){if(response.status>=400&&response.status<500){delete data.requests[u.pathname];persist();}else if(response.ok){try{const result=await response.clone().json();if(result&&typeof result==='object'&&!Array.isArray(result)&&typeof result.id==='string'){delete data.requests[u.pathname];persist();}}catch{}}}
  return response;
 };
 const edited=e=>{if(restoring)return;touched.add(e.target);if(e.isTrusted){restorePending=false;completedRoutes.delete(activeRoute);completedNames.clear();}schedule();};document.addEventListener('input',edited);document.addEventListener('change',edited);
 document.addEventListener('reset',()=>setTimeout(snapshot,0));
 document.addEventListener('click',()=>{if(!restoring)schedule();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)snapshot();});addEventListener('pagehide',snapshot);addEventListener('beforeunload',snapshot);addEventListener('scroll',schedule,{passive:true});
 addEventListener('pageshow',e=>{if(e.persisted&&exiting){location.reload();return;}if(e.persisted){/* BFCache already contains the live form and position. */ready=true;}});
 for(const name of ['pushState','replaceState']){const original=history[name].bind(history);history[name]=function(...args){const result=original(...args);activate();return result;};}addEventListener('popstate',activate);
 function mount(){mountResume();observer=new MutationObserver(()=>{if(restoring)return;clearTimeout(mutations);mutations=setTimeout(()=>{restore();mountResume();},180);});observer.observe(document.querySelector('main')||document.body,{childList:true,subtree:true});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
