/* Shared employee work lock. Only the server decides whether a work account is locked. */
(()=>{
 if(window.top!==window||window.StoreWorkSession||location.pathname==='/login')return;
 let overlay=null,status=null,resume=null,currentUserId=null,state=null,loading=false,requestVersion=0,loadError='';
 const observers=new Set();
 const restoredInert=new Map(),recoveryPage=location.pathname==='/attendance'||location.pathname==='/assistant'&&new URLSearchParams(location.search).get('work-signin')==='1';
 const at=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'出勤记录中显示的时间';
 function feedback(){
  if(!overlay)return;
  const source=document.getElementById('attendance-status')||document.getElementById('feedback'),exit=document.querySelector('.session-controls-status');
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
  const title=document.createElement('h1');title.textContent=state.code==='ATTENDANCE_REQUIRED'?'请先签到 · 工作功能未开放':'已签退 · 工作操作已锁定';
  const note=document.createElement('p');note.className='work-session-time';note.textContent=state.code==='ATTENDANCE_REQUIRED'?'今天尚未签到':'签退时间：'+at(state.checkedOutAt);
  const hint=document.createElement('p');hint.textContent='先签到再办理业务；21:00至次日07:00还必须有老板明确授权。原出勤记录保留。';
  const actions=document.createElement('div');actions.className='work-session-actions';
  if(recoveryPage){
   resume=document.createElement('button');resume.type='button';resume.textContent=state.code==='ATTENDANCE_REQUIRED'?'签到开始工作':'重新签到恢复工作';
   resume.onclick=()=>{
    if(typeof window.AttendanceRecoveryCheckin!=='function'){status.textContent='签到页面正在准备，请稍候再点。';return;}
    window.AttendanceRecoveryCheckin();feedback();
   };
   actions.append(resume);
  }else{
   const link=document.createElement('a');link.href='/attendance';link.textContent=state.code==='ATTENDANCE_REQUIRED'?'去签到后开始工作':'重新签到恢复工作';actions.append(link);
  }
  const password=document.createElement('a');password.href='/login#account-panel';password.textContent='修改本人密码';
  const exit=document.createElement('button');exit.type='button';exit.className='session-logout';exit.textContent='退出登录';
  actions.append(password,exit);
  status=document.createElement('p');status.className='work-session-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  card.append(title,note,hint,actions,status);overlay.append(card);
  for(const node of document.body.children){restoredInert.set(node,node.inert);node.inert=true;}
  document.body.append(overlay);document.body.classList.add('work-session-locked');
  (resume||actions.firstElementChild)?.focus();
  for(const node of [document.getElementById('attendance-status')||document.getElementById('feedback'),document.querySelector('.session-controls-status'),document.getElementById('checkin')].filter(Boolean))
   {const observer=new MutationObserver(feedback);observers.add(observer);observer.observe(node,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','data-feedback-tone']});}
  feedback();
 }
 function apply(user){
  if(!user||typeof user.id!=='string'||typeof user.workLock?.locked!=='boolean')return;
  currentUserId=user.id;state=user.workLock;loadError='';
  if(user.roleCode==='owner'||!state.locked||location.pathname==='/attendance'){remove();if(user.roleCode==='owner')void ownerAttendance();}else{mount();const label=overlay?.querySelector('.work-session-time');if(label)label.textContent=state.code==='ATTENDANCE_REQUIRED'?'今天尚未签到':'签退时间：'+at(state.checkedOutAt);feedback();}
 }
 async function ownerAttendance(){if(location.pathname!=='/app'||!['','dashboard'].includes(new URLSearchParams(location.search).get('tab')||'')){document.getElementById('boss-attendance-alert')?.remove();return;}try{const r=await fetch('/api/assistant/attendance',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;const d=await r.json();let box=document.getElementById('boss-attendance-alert');if(!box){box=document.createElement('section');box.id='boss-attendance-alert';box.className='boss-attendance-alert';document.querySelector('main')?.prepend(box);}const rows=(d.rows||[]).filter(x=>x.checkInAt),signed=new Set(rows.map(x=>x.userId)),active=new Set(rows.filter(x=>!x.checkOutAt).map(x=>x.userId));box.replaceChildren();const title=document.createElement('strong'),note=document.createElement('p'),link=document.createElement('a');title.textContent='今日员工签到 '+signed.size+' 人 · 在岗 '+active.size+' 人';note.textContent=rows.length?rows.slice().sort((a,b)=>Date.parse(b.checkInAt)-Date.parse(a.checkInAt)).map(x=>x.name+' '+new Date(x.checkInAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'签到'+(x.checkOutAt?'（已签退）':'')).join('；'):'今天暂无员工签到记录';link.href='/assistant?work-signin=1';link.textContent='查看签到记录 ›';const night=document.createElement('a');night.href='/attendance-night-access';night.textContent='夜间操作授权 ›';box.append(title,note,link,document.createTextNode(' · '),night);}catch{}}
 async function refresh(){
  const version=++requestVersion;loading=true;feedback();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   let token='';try{token=sessionStorage.getItem('officeLocalToken')||'';}catch{}
   const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:token?{Authorization:'Bearer '+token}:undefined});
   if(version!==requestVersion)return;
   if(response.status===401){remove();if(window.StoreSessionControls?.completeLogout)window.StoreSessionControls.completeLogout();else{try{sessionStorage.removeItem('officeLocalToken')}catch{}location.replace('/login');}return;}
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
