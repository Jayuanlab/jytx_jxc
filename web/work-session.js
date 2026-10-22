/* Shared employee work lock. Only the server decides whether a work account is locked. */
(()=>{
 if(window.top!==window||window.StoreWorkSession||location.pathname==='/login')return;
 let overlay=null,status=null,resume=null,currentUserId=null,state=null,loading=false,requestVersion=0,loadError='';
 const observers=new Set();
 const restoredInert=new Map(),recoveryPage=location.pathname==='/assistant'&&new URLSearchParams(location.search).get('work-signin')==='1';
 const at=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'出勤记录中显示的时间';
 function feedback(){
  if(!overlay)return;
  const source=document.getElementById('attendance-status'),exit=document.querySelector('.session-controls-status');
  const message=loading?'正在读取最新工作状态…':loadError||source?.textContent||exit?.textContent||'';
  if(status.textContent!==message)status.textContent=message;
  status.dataset.tone=source?.dataset.feedbackTone||'info';
  if(resume)resume.disabled=loading||!!document.getElementById('checkin')?.disabled;
 }
 function remove(){
  if(!overlay)return;
  for(const [node,wasInert]of restoredInert)if(node.isConnected)node.inert=wasInert;
  restoredInert.clear();for(const observer of observers)observer.disconnect();observers.clear();overlay.remove();overlay=null;status=null;resume=null;document.body.classList.remove('work-session-locked');
 }
 function mount(){
  if(overlay||!document.body)return;
  overlay=document.createElement('section');overlay.className='work-session-lock';overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','工号已签退');
  const card=document.createElement('div');card.className='work-session-card';
  const title=document.createElement('h1');title.textContent='已签退 · 工作操作已锁定';
  const note=document.createElement('p');note.className='work-session-time';note.textContent='签退时间：'+at(state.checkedOutAt);
  const hint=document.createElement('p');hint.textContent='重新签到后可继续办理业务。原签退记录会保留。';
  const actions=document.createElement('div');actions.className='work-session-actions';
  if(recoveryPage){
   resume=document.createElement('button');resume.type='button';resume.textContent='重新签到恢复工作';
   resume.onclick=()=>{
    const button=document.getElementById('checkin');
    if(!button||button.disabled){status.textContent='签到页面正在准备，请稍候再点。';return;}
    button.click();feedback();
   };
   actions.append(resume);
  }else{
   const link=document.createElement('a');link.href='/assistant?work-signin=1';link.textContent='重新签到恢复工作';actions.append(link);
  }
  const password=document.createElement('a');password.href='/login#account-panel';password.textContent='修改本人密码';
  const exit=document.createElement('button');exit.type='button';exit.className='session-logout';exit.textContent='退出登录';
  actions.append(password,exit);
  status=document.createElement('p');status.className='work-session-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  card.append(title,note,hint,actions,status);overlay.append(card);
  for(const node of document.body.children){restoredInert.set(node,node.inert);node.inert=true;}
  document.body.append(overlay);document.body.classList.add('work-session-locked');
  (resume||actions.firstElementChild)?.focus();
  for(const node of [document.getElementById('attendance-status'),document.querySelector('.session-controls-status'),document.getElementById('checkin')].filter(Boolean))
   {const observer=new MutationObserver(feedback);observers.add(observer);observer.observe(node,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','data-feedback-tone']});}
  feedback();
 }
 function apply(user){
  if(!user||typeof user.id!=='string'||typeof user.workLock?.locked!=='boolean')return;
  currentUserId=user.id;state=user.workLock;loadError='';
  if(user.roleCode==='owner'||!state.locked)remove();else{mount();const label=overlay?.querySelector('.work-session-time');if(label)label.textContent='签退时间：'+at(state.checkedOutAt);feedback();}
 }
 async function refresh(){
  const version=++requestVersion;loading=true;feedback();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   let token='';try{token=sessionStorage.getItem('officeLocalToken')||'';}catch{}
   const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:token?{Authorization:'Bearer '+token}:undefined});
   if(version!==requestVersion)return;
   if(response.status===401){remove();return;}
   if(!response.ok)throw Error('status');
   const user=await response.json();if(version===requestVersion)apply(user);
  }catch{
   if(overlay&&version===requestVersion)loadError='暂时无法刷新工作状态。已签退仍保持锁定，请恢复网络后重试。';
  }finally{clearTimeout(timer);if(version===requestVersion){loading=false;feedback();}}
 }
 window.StoreWorkSession={refresh};
 window.addEventListener('work-session-update',event=>{
  const detail=event.detail;
  if(detail?.userId===currentUserId&&typeof detail?.workLock?.locked==='boolean'){
   ++requestVersion;loading=false;apply({id:currentUserId,workLock:detail.workLock});
   try{localStorage.setItem('store-work-session-changed',String(Date.now()));}catch{}
  }else refresh();
 });
 window.addEventListener('storage',event=>{if(event.key==='store-work-session-changed')refresh();});
 window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 setInterval(()=>{if(!document.hidden)refresh();},15000);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});else refresh();
})();
