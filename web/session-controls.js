/* Shared account exit controls. Does not alter role, business or login-page logic. */
(()=>{
 if(window.top!==window||new URLSearchParams(location.search).has('embedded')||window.StoreSessionControls)return;
 const logoutMarker='store-session-logout-v1',credentialKeys=['officeLocalToken','assistant-sale-draft','erp-reception-draft-after-login-v1'];
 const readMarker=()=>{try{return localStorage.getItem(logoutMarker);}catch{return null;}};
 let observedMarker=readMarker(),busy=false,navigating=false,controls=null,status=null;
 const clearCredentials=()=>{for(const key of credentialKeys){try{sessionStorage.removeItem(key);}catch{}}};
 const returnToLogin=()=>{if(navigating)return;navigating=true;clearCredentials();location.replace('/login');};
 const completeLogout=()=>{
  if(navigating)return;
  window.StoreWorkContinuity?.finishNavigation({logout:true});
  const marker=Date.now()+'-'+(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2));
  observedMarker=marker;try{localStorage.setItem(logoutMarker,marker);}catch{}
  returnToLogin();
 };
 window.StoreSessionControls={completeLogout};
 if(location.pathname==='/login')return;
 const markerChanged=value=>{if(typeof value==='string'&&value&&value!==observedMarker){observedMarker=value;returnToLogin();}};
 window.addEventListener('storage',event=>{if(event.key===logoutMarker)markerChanged(event.newValue);});
 window.addEventListener('pageshow',()=>markerChanged(readMarker()));
 const exitButtons=()=>document.querySelectorAll('.session-logout,.mobile-logout,#logout');
 function showStatus(message,error=false){
  if(!status)return;
  status.textContent=message;status.hidden=!message;status.classList.toggle('session-controls-error',error);
  if(error)status.scrollIntoView?.({block:'nearest'});
 }
 async function logout(){
  if(busy||navigating)return;
  busy=true;const disabled=new Map();for(const button of exitButtons()){disabled.set(button,button.disabled);button.disabled=true;}
  showStatus('正在退出登录…');
  const controller=new AbortController();let timer;
  try{
   let token='';try{token=sessionStorage.getItem('officeLocalToken')||'';}catch{}
   const request=(async()=>{
    const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store',headers:token?{Authorization:'Bearer '+token}:undefined,signal:controller.signal});
    if(!response.ok)throw Error('server');
    const result=await response.json();if(result?.ok!==true)throw Error('server');
   })();
   const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},10000);});
   await Promise.race([request,timeout]);
   completeLogout();
  }catch(error){showStatus(error.message==='timeout'?'退出未成功：请求超时。请检查网络，再点“退出登录”重试。':'退出未成功，请检查网络，再点“退出登录”重试。',true);}
  finally{clearTimeout(timer);busy=false;if(!navigating)for(const [button,wasDisabled] of disabled)button.disabled=wasDisabled;}
 }
 function mount(){
  if(!document.body||controls)return;
  const home=location.pathname==='/m';const host=home?null:document.querySelector('.home-header .hero-top')||document.querySelector('.topbar')||document.querySelector('.companion-header')||document.querySelector('body > header');
  controls=document.createElement('div');controls.className='session-controls';if(home)controls.dataset.homeFixed='1';controls.setAttribute('role','group');controls.setAttribute('aria-label','登录账号操作');
  const button=document.createElement('button');button.type='button';button.className='session-logout';button.textContent=home?'返回登录 / 切换账号':'退出登录';button.setAttribute('aria-label','退出登录，使用其他账号登录');
  status=document.createElement('p');status.className='session-controls-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
  controls.append(button,status);
  if(host){host.classList.add('session-controls-host');host.append(controls);}else{controls.classList.add('session-controls-fallback');if(home)controls.classList.add('session-controls-home');document.body.prepend(controls);}
  document.body.classList.add('session-controls-ready');
  if(host?.classList.contains('topbar')){
   const measure=()=>document.documentElement.style.setProperty('--session-controls-header-height',Math.ceil(host.getBoundingClientRect().height)+'px');
   measure();if(typeof ResizeObserver!=='undefined')new ResizeObserver(measure).observe(host);else window.addEventListener('resize',measure);
  }
  document.addEventListener('click',event=>{
   const button=event.target?.closest?.('.session-logout,.mobile-logout,#logout');if(!button)return;
   event.preventDefault();event.stopImmediatePropagation();if(button.disabled||busy||navigating)return;
   logout();
  },true);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
