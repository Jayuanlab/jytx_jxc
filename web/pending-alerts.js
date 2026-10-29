(()=>{
 'use strict';
 const select=document.getElementById('pending-alert-mode'),hint=document.getElementById('pending-alert-hint');
 if(!select||!hint)return;
 let userId='',lastCount=null,lastCategories=[],busy=false,audio=null,mode='off',confirmedMode='off',identityVersion=0;
 const key=()=>`store-pending-alert-mode:${userId}`;
 const wantsSound=()=>mode==='sound'||mode==='both',wantsVibrate=()=>mode==='vibrate'||mode==='both';
 const note=value=>{hint.textContent=value;};
 function armSound(){
  if(!wantsSound())return;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio){note('此浏览器不支持网页铃声，可改用震动。');return;}
  try{audio=audio||new Audio();if(audio.state==='suspended')void audio.resume().catch(()=>{});}catch{note('铃声被浏览器拦截，请点一下页面后重试。');}
 }
 function ring(){
  if(!audio||audio.state!=='running')return false;
  try{
   for(const [offset,freq] of [[0,784],[.25,1046]]){
    const osc=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+offset;
    osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.24,at+.018);gain.gain.exponentialRampToValueAtTime(.0001,at+.21);
    osc.connect(gain);gain.connect(audio.destination);osc.start(at);osc.stop(at+.22);
   }
   return true;
  }catch{return false;}
 }
 function speak(categories){
  if(!wantsSound()||!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return false;
  const labels=categories.filter(row=>row.count>0).slice(0,3).map(row=>row.label);
  if(!labels.length)return false;
  try{const speech=new SpeechSynthesisUtterance('新待办：'+labels.join('，')+(categories.length>3?'等类别':''));speech.lang='zh-CN';speech.rate=1.05;speech.volume=1;setTimeout(()=>{window.speechSynthesis.cancel();window.speechSynthesis.speak(speech);},540);return true;}catch{return false;}
 }
 function alertNew(diff,total,categories){
  const sounded=wantsSound()&&ring(),vibrated=wantsVibrate()&&typeof navigator.vibrate==='function'&&navigator.vibrate([180,100,180]);
  const spoken=sounded&&speak(categories);
  note(`新增加 ${diff} 条本人待办，现有 ${total} 条。${categories.length?'类别：'+categories.map(row=>row.label).join('、')+'。':''}${wantsSound()&&!sounded?'铃声被浏览器拦截，请点一下页面。':''}${wantsSound()&&sounded&&!spoken?'此浏览器未能读出类别。':''}${wantsVibrate()&&!vibrated?'此设备未允许震动。':''}`);
 }
 function acceptSnapshot(value,categories=[]){
  if(mode==='off')return;
  const count=Number(value);
  if(!Number.isSafeInteger(count)||count<0)return;
  const rows=Array.isArray(categories)?categories.filter(row=>row&&typeof row.key==='string'&&typeof row.label==='string'&&Number.isSafeInteger(Number(row.count))&&Number(row.count)>=0).map(row=>({key:row.key,label:row.label,count:Number(row.count)})):[];
  if(lastCount!==null&&count>lastCount){const before=new Map(lastCategories.map(row=>[row.key,row.count]));const increased=rows.filter(row=>row.count>(before.get(row.key)||0));alertNew(count-lastCount,count,increased.length?increased:rows.filter(row=>row.count>0));}
  lastCount=count;if(rows.length)lastCategories=rows;
 }
 async function poll(){
  if(!userId||mode==='off'||busy)return;
  busy=true;
  try{
   const response=await fetch('/api/workbench',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)return;
   const data=await response.json(),count=Number(data.pendingCount);
   if(!Number.isSafeInteger(count)||count<0)return;
   acceptSnapshot(count,window.StorePendingAlertCategories?.fromWorkbench?.(data)||[]);
  }catch{}finally{busy=false;}
 }
 async function identity(){
  const version=++identityVersion;userId='';mode='off';select.disabled=true;note('正在读取当前账号的提醒设置…');
  try{
   const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('login');
   const me=await response.json(),id=String(me.id||'');
   if(!id)throw Error('login');
   const preference=await fetch('/api/display-preferences?page=pending-alert',{credentials:'same-origin',cache:'no-store'});
   if(!preference.ok)throw Error('preference');
   const saved=await preference.json();if(version!==identityVersion)return;
   userId=id;mode=['off','sound','vibrate','both'].includes(saved.mode)?saved.mode:'off';confirmedMode=mode;
   if(!saved.configured){let legacy='';try{legacy=localStorage.getItem(key())||'';}catch{}if(['sound','vibrate','both'].includes(legacy)){const migrated=await fetch('/api/display-preferences',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:'pending-alert',mode:legacy})});if(version!==identityVersion)return;if(migrated.ok){mode=legacy;confirmedMode=legacy;}}}
   select.value=mode;select.disabled=false;lastCount=null;lastCategories=[];
   note(mode==='off'?'新待办提醒已关闭；选择后会保存到当前账号。':'已从当前账号恢复提醒设置；工作台打开时，新待办会提醒。');
   if(mode!=='off')void poll();
  }catch{if(version===identityVersion){select.value='off';select.disabled=true;note('账号提醒设置暂未读取，请刷新页面重试。');}}
 }
 select.addEventListener('change',async()=>{
  if(!userId){select.value='off';note('请先登录，再设置提醒。');return;}
  const chosen=select.value;mode=chosen;lastCount=null;lastCategories=[];if(wantsSound())armSound();
  select.disabled=true;note('正在保存到当前账号…');
  try{
   const response=await fetch('/api/display-preferences',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:'pending-alert',mode:chosen})});
   if(!response.ok)throw Error('save');
   confirmedMode=chosen;try{localStorage.setItem(key(),chosen);}catch{}
   note(chosen==='off'?'新待办提醒已关闭，设置已保存。':`已保存到当前账号，重新登录后会恢复。${wantsVibrate()&&typeof navigator.vibrate!=='function'?'此设备不支持网页震动。':''}`);
   if(chosen!=='off')void poll();
  }catch{mode=confirmedMode;select.value=confirmedMode;note('提醒设置保存失败，请重新选择。');}
  finally{select.disabled=false;}
 });
 document.addEventListener('pointerdown',armSound,{passive:true});
 document.addEventListener('keydown',armSound);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void poll();});
 window.addEventListener('focus',()=>void poll());
 document.addEventListener('store-workbench-counts',event=>acceptSnapshot(event.detail?.pendingCount,event.detail?.categories));
 window.addEventListener('work-session-update',event=>{if(event.detail?.userId!==userId)void identity();});
 void identity();
})();
