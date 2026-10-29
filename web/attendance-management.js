'use strict';
// Additive read-only report. Original attendance writes stay in assistant.js.
(() => {
 if(window.AttendanceManagementMounted)return;window.AttendanceManagementMounted=true;
 const get=id=>document.getElementById(id),arr=v=>Array.isArray(v)?v:[];
 let dialog,entry,panelEntry,data=null,generation=0,controller=null,invalidated=false,reportContext=null,lastActorId=null;
 function ctx(){try{return {actor:typeof me==='undefined'?null:me,mode:typeof assistantMode==='undefined'?null:assistantMode,epoch:typeof modeEpoch==='undefined'?0:modeEpoch};}catch{return {};}}
 function allowed(){const c=ctx();return !invalidated&&c.mode==='store'&&c.actor?.roleCode==='owner'&&c.actor.active!==false&&c.actor.assistantCustomerOnly!==true;}
 function same(before){return allowed()&&ctx().actor?.id===before.actor?.id&&ctx().epoch===before.epoch;}
 function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
 function btn(text,handler,cls){const n=el('button',text,cls);n.type='button';n.addEventListener('click',handler);return n;}
 function monthNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());}
 const num=v=>Number.isFinite(v)&&v>=0?v:null,count=v=>num(v)===null?'未提供':String(v),hours=v=>num(v)===null?'未提供':(v/3600).toFixed(2)+' 小时';
 function time(v){const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未提供时间';}
 function status(text,error=false){const n=get('attm-status');if(n){n.textContent=text;n.classList.toggle('attm-error',error);}}
 function clear(){generation++;controller?.abort();controller=null;data=null;reportContext=null;if(dialog?.open)dialog.close();get('attm-output')?.replaceChildren();get('attm-employee')?.replaceChildren(new Option('全部员工','all'));if(get('attm-refresh'))get('attm-refresh').disabled=false;status('');}
 function sync(){const owner=allowed(),c=ctx();if(lastActorId!==c.actor?.id||c.mode!=='store'){document.querySelectorAll('.attm-copy-position,.attm-copy-status,.attm-copy-fallback').forEach(n=>n.remove());lastActorId=c.actor?.id;}for(const b of [entry,panelEntry])if(b)b.hidden=!owner;if((!owner||reportContext&&(reportContext.actor?.id!==c.actor?.id||reportContext.epoch!==c.epoch))&&(data||dialog?.open))clear();attachCopyButtons();}
 function mount(){
  const toolbar=document.querySelector('#work-dock .chat-toolbar'),panel=get('attendance-panel');if(!toolbar||!panel)return;
  entry=btn('考勤管理',openReport,'attm-entry');entry.id='attendance-management-open';entry.hidden=true;entry.setAttribute('aria-controls','attendance-management-dialog');entry.setAttribute('data-store-only','');get('fieldwork-shortcut')?.after(entry);if(!entry.parentNode)toolbar.append(entry);
  panelEntry=btn('考勤明细',openReport,'attm-entry');panelEntry.id='attendance-management-panel-open';panelEntry.hidden=true;panel.querySelector('h2')?.after(panelEntry);
  dialog=el('dialog',undefined,'attm-dialog');dialog.id='attendance-management-dialog';dialog.setAttribute('aria-labelledby','attm-title');
  const head=el('header',undefined,'attm-header'),title=el('h2','考勤明细');title.id='attm-title';head.append(title,btn('关闭',()=>{controller?.abort();generation++;get('attm-refresh').disabled=false;dialog.close();},'attm-close'));
  const body=el('div',undefined,'attm-body'),form=el('form',undefined,'attm-filters');form.id='attm-filters';
  for(const [id,label,type]of [['attm-month','月份','month'],['attm-employee','员工','select'],['attm-filter','查看范围','select']]){
   const wrap=el('label',label);wrap.htmlFor=id;const c=el(type==='select'?'select':'input');c.id=id;
   if(type==='month'){c.type='month';c.required=true;c.value=monthNow();}
   if(id==='attm-employee')c.append(new Option('全部员工','all'));
   if(id==='attm-filter')for(const [v,t]of [['all','全部'],['needs-review','待核对'],['normal','正常']])c.append(new Option(t,v));
   wrap.append(c);form.append(wrap);
  }
  const refresh=el('button','查询 / 刷新','attm-primary');refresh.type='submit';refresh.id='attm-refresh';form.append(refresh);
  const state=el('p','','attm-status');state.id='attm-status';state.setAttribute('role','status');state.setAttribute('aria-live','polite');const out=el('div',undefined,'attm-output');out.id='attm-output';body.append(form,state,out);dialog.append(head,body);document.body.append(dialog);
  form.addEventListener('submit',e=>{e.preventDefault();loadReport();});get('attm-month').addEventListener('change',loadReport);for(const id of ['attm-employee','attm-filter'])get(id).addEventListener('change',render);dialog.addEventListener('cancel',()=>{controller?.abort();generation++;get('attm-refresh').disabled=false;});
  const observer=new MutationObserver(sync);
  for(const n of [get('mode-store'),get('who'),document.documentElement])if(n)observer.observe(n,{attributes:true,attributeFilter:['aria-pressed','class'],childList:n.id==='who',subtree:n.id==='who'});
  for(const n of [get('attendance'),get('attendance-spot-requests')])if(n)observer.observe(n,{childList:true,subtree:true});
  window.addEventListener('storage',e=>{if(e.key==='store-session-logout-v1'){invalidated=true;clear();for(const b of [entry,panelEntry])b.hidden=true;document.querySelectorAll('.attm-copy-position,.attm-copy-status,.attm-copy-fallback').forEach(n=>n.remove());}});sync();
 }
 function openReport(){if(!allowed())return;reportContext=ctx();dialog.showModal();loadReport();}
 async function loadReport(){
  if(!allowed()||!dialog.open)return;const month=get('attm-month').value;if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){status('请选择有效月份。',true);return;}
  const before=ctx(),run=++generation;controller?.abort();const request=new AbortController();controller=request;const timer=setTimeout(()=>request.abort(),15000);get('attm-refresh').disabled=true;data=null;get('attm-output').replaceChildren();status('正在统计已登记的出勤和定位记录…');
  try{
   const r=await fetch('/api/assistant/attendance-report?'+new URLSearchParams({month}),{credentials:'same-origin',cache:'no-store',signal:request.signal}),view=await r.json().catch(()=>({}));
   if(!same(before)||run!==generation||!dialog.open)return;
   if(r.status===401||r.status===403){invalidated=true;clear();entry.hidden=true;panelEntry.hidden=true;return;}
   if(!r.ok)throw Error(view.error?.message||view.error||'考勤报告暂时无法读取');
   if(!view.period||view.period.month!==month||!Array.isArray(view.days)||!Array.isArray(view.employees)||!view.summary||!Array.isArray(view.issues))throw Error('考勤报告字段不完整，请稍后重试。');
   data=view;const selected=get('attm-employee').value;get('attm-employee').replaceChildren(new Option('全部员工','all'));for(const e of view.employees)if(typeof e.userId==='string')get('attm-employee').append(new Option(e.name||'未提供姓名',e.userId));get('attm-employee').value=view.employees.some(e=>e.userId===selected)?selected:'all';render();status('更新于 '+time(view.asOf));
  }catch(e){if(same(before)&&run===generation&&dialog.open)status(e.name==='AbortError'?'查询超时或已取消，请重新查询。':'无法读取：'+e.message,true);}
  finally{clearTimeout(timer);if(run===generation){get('attm-refresh').disabled=false;controller=null;}}
 }
 function metric(label,value,note){const n=el('article',undefined,'attm-metric');n.append(el('span',label),el('strong',value));if(note)n.append(el('small',note));return n;}
 function render(){
  if(!allowed()||!data)return;const out=get('attm-output');out.replaceChildren();const who=get('attm-employee').value,filter=get('attm-filter').value,s=who==='all'?data.summary:data.employees.find(e=>e.userId===who)||{};
  out.append(el('p',(data.period.startDate||data.period.month)+' 至 '+(data.period.endDate||'月末')+' · '+(who==='all'?'全店':s.name||'所选员工'),'attm-period'));
  const metrics=el('div',undefined,'attm-metrics');metrics.append(metric(who==='all'?'出勤人天':'出勤天数',count(s.attendedDays)),metric('本月已签退时长',hours(s.closedWorkSeconds)));
  out.append(metrics);
  const days=data.days.filter(d=>(who==='all'||d.userId===who)&&(filter==='all'||d.status===filter)).sort((a,b)=>String(b.date).localeCompare(String(a.date),'zh-CN')||String(a.name).localeCompare(String(b.name),'zh-CN'));
  const issues=data.issues.filter(i=>(who==='all'||i.userId===who)&&days.some(d=>d.date===i.date&&d.userId===i.userId)&&(filter!=='needs-review'||i.needsReview!==false));
  out.append(el('p','绿✓ 已定位/已核　灰✓ 待核','attm-legend'),el('p','补定位：营业员本人当班可点','attm-note'),el('h3','每日打卡'));
  const table=el('table',undefined,'attm-table'),head=el('thead'),tr=el('tr');for(const title of ['员工 / 日期','签到 / 签退','当日时长'])tr.append(el('th',title));head.append(tr);table.append(head);const tbody=el('tbody');
  const shortTime=(value,date)=>{if(!value)return '未提供时间';const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))return '时间异常';const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(parsed);return (localDay===date?'':localDay+' ') + parsed.toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});};
  async function confirmLocation(punch,event,button){if(!allowed()||button.disabled)return;const before=ctx();button.disabled=true;status('正在保存核对…');try{const r=await fetch('/api/assistant/attendance',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Idempotency-Key':requestId()},body:JSON.stringify({action:'location-review',attendanceId:punch.attendanceId,event,decision:'confirmed',note:'老板核对打卡时间后确认；原定位失败记录保留。'})}),view=await r.json().catch(()=>({}));if(!r.ok)throw Error(view.error?.message||'保存失败');if(same(before))await loadReport();}catch(error){if(same(before)){button.disabled=false;status('核对未保存：'+error.message,true);}}}
  const marker=(day,punch,event)=>{const point=arr(day.locations).find(x=>x.attendanceId===punch.attendanceId&&x.event===event);const reviewed=point?.humanReview?.decision==='confirmed',failed=!point||['historical-missing','no-location','permission-denied','invalid-evidence'].includes(point.reason);if(!failed||reviewed){const icon=el('span','✓','attm-location-mark');icon.title=reviewed?'已人工核对时间；原定位失败记录保留':'已取得定位';icon.setAttribute('aria-label',icon.title);return icon;}return btn('✓ 核对',function(){confirmLocation(punch,event,this);},'attm-location-review');};
  for(const d of days){
   const row=el('tr',undefined,d.status==='needs-review'?'attm-review-row':'attm-normal-row'),identity=el('td');identity.dataset.label='员工 / 日期';identity.append(el('strong',d.name||'未提供姓名'),el('p',d.date||'未提供日期'));
   const records=el('td');records.dataset.label='签到 / 签退';const punches=arr(d.punches);if(!punches.length)records.append(el('p','跨日工作延续，当日无新签到'));for(let i=0;i<punches.length;i++){const punch=punches[i],line=el('p',undefined,'attm-punch-line');line.append(el('strong','第'+(i+1)+'次：'),'签到 '+shortTime(punch.checkInAt,d.date)+' ',marker(d,punch,'checkin'),'　签退 '+(punch.checkOutAt?shortTime(punch.checkOutAt,d.date):'未签退'));if(punch.checkOutAt)line.append(' ',marker(d,punch,'checkout'));records.append(line);for(const point of arr(d.locations).filter(x=>x.attendanceId===punch.attendanceId&&x.event==='supplement'))records.append(el('p','补定位 '+shortTime(point.at,d.date)+' ✓','attm-supplement-line'));}
   const duration=el('td');duration.dataset.label='当日时长';duration.append(el('strong',hours(d.closedWorkSeconds)));if(d.isWorking||d.missingCheckoutCount)duration.append(el('p','未签退部分不计时','attm-note'));if(d.status==='needs-review'){const details=el('details',undefined,'attm-day-issues');details.append(el('summary','待核 '+arr(d.issues).length));for(const issue of arr(d.issues))details.append(el('p',issue.message||issue.code||'待核对'));duration.append(details);}row.append(identity,records,duration);tbody.append(row);
  }
  table.append(tbody);out.append(days.length?table:el('p','所选月份和范围没有符合条件的打卡记录。','attm-empty'));

 }
 function showDay(date){if(!allowed()||typeof revealAssistantPanel!=='function')return;controller?.abort();generation++;get('attm-refresh').disabled=false;dialog.close();get('attendance-date').value=date;revealAssistantPanel('attendance-panel');get('attendance-date').dispatchEvent(new Event('change',{bubbles:true}));}
 function fieldLocations(w){return [w?.startLocation,...(w?.endAt?[w.endLocation]:[]),...arr(w?.checkpoints).map(p=>p.locationReport)].filter(Boolean);}
 function copyLinks(host,reports){
  if(!host)return;const available=reports.filter(r=>Number.isFinite(r?.evidence?.latitude)&&Number.isFinite(r?.evidence?.longitude));
  for(const link of host.querySelectorAll('.attendance-location-record > a')){
   if(link.parentElement.querySelector('.attm-copy-position'))continue;let url;try{url=new URL(link.href);if(url.origin!=='https://uri.amap.com'||url.pathname!=='/marker'||url.searchParams.get('coordinate')!=='wgs84')continue;}catch{continue;}
   const pair=(url.searchParams.get('position')||'').split(',').map(Number);if(pair.length!==2)continue;const i=available.findIndex(r=>r.evidence.longitude===pair[0]&&r.evidence.latitude===pair[1]);if(i<0)continue;const report=available.splice(i,1)[0],actorId=ctx().actor?.id;
   const copy=btn('复制位置',async()=>{
    if(invalidated||ctx().mode!=='store'||ctx().actor?.id!==actorId||!copy.isConnected)return;const e=report.evidence,text='经度：'+e.longitude+'\n纬度：'+e.latitude+'\n坐标：WGS84（手机浏览器报告）\n精度：'+(Number.isFinite(e.accuracy)?'约 '+Math.round(e.accuracy)+' 米':'未提供精度')+'\n采集时间：'+time(e.capturedAt)+'\n位置仅供核对，不证明签到时在场。';copy.disabled=true;
    try{if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(text);if(!invalidated&&ctx().mode==='store'&&ctx().actor?.id===actorId&&copy.isConnected)notice.textContent='位置已复制，可粘贴给老板。';}
    catch{if(invalidated||ctx().mode!=='store'||ctx().actor?.id!==actorId||!copy.isConnected)return;notice.textContent='请长按下方位置文字复制。';let fallback=copy.parentElement.querySelector('.attm-copy-fallback');if(!fallback){fallback=el('textarea');fallback.readOnly=true;fallback.className='attm-copy-fallback';fallback.setAttribute('aria-label','位置文字，可长按复制');copy.parentElement.append(fallback);}fallback.value=text;fallback.focus();fallback.select();}
    finally{if(copy.isConnected)copy.disabled=false;}
   },'attm-copy-position');const notice=el('span','','attm-copy-status');notice.setAttribute('role','status');link.after(copy,notice);
  }
 }
 function attachCopyButtons(){
  const c=ctx();if(invalidated||c.mode!=='store'||!c.actor?.id)return;let s;try{s=typeof attendanceSnapshot==='undefined'?null:attendanceSnapshot;}catch{return;}if(!s)return;
  const active=arr(s.activeFieldwork),visibleActive=s.privileged?active:active.filter(r=>r.userId===c.actor.id),activeCards=get('attendance')?.querySelectorAll('.attendance-current > .fieldwork-record')||[];visibleActive.forEach((w,i)=>{if(w.userId===c.actor.id)copyLinks(activeCards[i],fieldLocations(w));});
  const rows=arr(s.rows),visible=s.privileged?rows:rows.filter(r=>r.userId===c.actor.id),cards=get('attendance')?.querySelectorAll(':scope > .attendance-record')||[];visible.forEach((r,i)=>{if(r.userId!==c.actor.id)return;const reports=[r.checkInLocation,...arr(r.locationSupplements).map(p=>p.locationReport),...(r.checkOutAt?[r.checkOutLocation]:[])];for(const w of arr(r.fieldwork)){if(visibleActive.some(v=>v.id===w.id&&v.userId===w.userId))continue;reports.push(...fieldLocations(w));}copyLinks(cards[i],reports.filter(Boolean));});
  const requests=arr(s.spotCheckRequests),shown=s.privileged&&['owner','manager'].includes(c.actor.roleCode)?requests:requests.filter(r=>r.userId===c.actor.id),requestCards=get('attendance-spot-requests')?.querySelectorAll(':scope > .attendance-record')||[];shown.forEach((r,i)=>{if(r.userId===c.actor.id&&r.responseLocation)copyLinks(requestCards[i],[r.responseLocation]);});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
