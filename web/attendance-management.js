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
  panelEntry=btn('考勤分析报告',openReport,'attm-entry');panelEntry.id='attendance-management-panel-open';panelEntry.hidden=true;panel.querySelector('h2')?.after(panelEntry);
  dialog=el('dialog',undefined,'attm-dialog');dialog.id='attendance-management-dialog';dialog.setAttribute('aria-labelledby','attm-title');
  const head=el('header',undefined,'attm-header'),title=el('h2','考勤分析报告');title.id='attm-title';head.append(title,btn('关闭',()=>{controller?.abort();generation++;get('attm-refresh').disabled=false;dialog.close();},'attm-close'));
  const body=el('div',undefined,'attm-body'),form=el('form',undefined,'attm-filters');form.id='attm-filters';
  for(const [id,label,type]of [['attm-month','月份','month'],['attm-employee','员工','select'],['attm-filter','查看范围','select']]){
   const wrap=el('label',label);wrap.htmlFor=id;const c=el(type==='select'?'select':'input');c.id=id;
   if(type==='month'){c.type='month';c.required=true;c.value=monthNow();}
   if(id==='attm-employee')c.append(new Option('全部员工','all'));
   if(id==='attm-filter')for(const [v,t]of [['needs-review','待核对'],['normal','正常'],['all','全部']])c.append(new Option(t,v));
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
   data=view;const selected=get('attm-employee').value;get('attm-employee').replaceChildren(new Option('全部员工','all'));for(const e of view.employees)if(typeof e.userId==='string')get('attm-employee').append(new Option(e.name||'未提供姓名',e.userId));get('attm-employee').value=view.employees.some(e=>e.userId===selected)?selected:'all';render();status('统计截至 '+time(view.asOf)+'；只读取记录，不修改打卡或工资。');
  }catch(e){if(same(before)&&run===generation&&dialog.open)status(e.name==='AbortError'?'查询超时或已取消，请重新查询。':'无法读取：'+e.message,true);}
  finally{clearTimeout(timer);if(run===generation){get('attm-refresh').disabled=false;controller=null;}}
 }
 function metric(label,value,note){const n=el('article',undefined,'attm-metric');n.append(el('span',label),el('strong',value));if(note)n.append(el('small',note));return n;}
 function render(){
  if(!allowed()||!data)return;const out=get('attm-output');out.replaceChildren();const who=get('attm-employee').value,filter=get('attm-filter').value,s=who==='all'?data.summary:data.employees.find(e=>e.userId===who)||{};
  out.append(el('p',(data.period.startDate||data.period.month)+' 至 '+(data.period.endDate||'月末')+' · '+(who==='all'?'全店':s.name||'所选员工'),'attm-period'));
  const metrics=el('div',undefined,'attm-metrics');metrics.append(metric(who==='all'?'已登记出勤（人天）':'出勤天数',count(s.attendedDays)),metric('闭合记录时长',hours(s.closedWorkSeconds),'含外勤及待核时长，未自动核准'),metric('其中待核时长',hours(s.unverifiedClosedWorkSeconds),'异常连续或重叠班次，须人工核对'),metric('其中外勤',hours(s.fieldworkSeconds),'属于工作时长，不另加一次'),metric('正在工作',count(s.workingCount)+' 条','今天尚未签退'),metric('漏签退',count(s.missingCheckoutCount)+' 条','历史记录尚未闭合'),metric('位置待核对',count(s.locationPendingCount)+' 个点','自动异常、缺少定位等未处理项'),metric('抽查未回应',count(s.spotCheckUnansweredCount)+' 条',num(s.spotCheckOverdueCount)!==null?'其中已逾期 '+count(s.spotCheckOverdueCount)+' 条':'包含时限内尚待回应'));
  out.append(metrics,el('p','以上为所选员工整月统计；下方按“查看范围”筛选日期。未设班次，暂不判迟到、早退或旷工。','attm-note'));
  const days=data.days.filter(d=>(who==='all'||d.userId===who)&&(filter==='all'||d.status===filter)).sort((a,b)=>String(b.date).localeCompare(String(a.date),'zh-CN')||String(a.name).localeCompare(String(b.name),'zh-CN'));
  const issues=data.issues.filter(i=>(who==='all'||i.userId===who)&&days.some(d=>d.date===i.date&&d.userId===i.userId)&&(filter!=='needs-review'||i.needsReview!==false));
  const analysis=el('section',undefined,'attm-analysis');analysis.append(el('h3','记录分析'));if(data.analysis?.summary)analysis.append(el('p',String(data.analysis.summary)));analysis.append(el('p','当前显示 '+days.length+' 个员工出勤日，'+issues.filter(i=>i.needsReview!==false).length+' 项待核对线索。正常记录无需逐条确认。'));
  if(issues.length){const list=el('ul');for(const i of issues){const item=el('li');item.append(el('strong',(i.name||'未提供姓名')+' · '+(i.date||'未提供日期')+'：'),el('span',i.message||i.code||'待核对'));if(i.recommendation)item.append(el('p','建议：'+i.recommendation));if(i.needsReview===false)item.append(el('p','此项已人工核对，原始自动结果仍保留。','attm-note'));list.append(item);}analysis.append(list);}else analysis.append(el('p',filter==='needs-review'?'当前筛选没有待核对问题。':'当前筛选没有额外问题线索。'));
  if(arr(data.analysis?.recommendations).length){const details=el('details');details.append(el('summary','查看报告建议'));for(const text of data.analysis.recommendations)details.append(el('p',String(text)));analysis.append(details);}out.append(analysis,el('h3','出勤日期明细'));
  const table=el('table',undefined,'attm-table'),head=el('thead'),tr=el('tr');for(const title of ['员工 / 日期','自动结果','闭合记录时长','其中外勤','情况 / 操作'])tr.append(el('th',title));head.append(tr);table.append(head);const tbody=el('tbody');
  for(const d of days){
   const row=el('tr',undefined,d.status==='needs-review'?'attm-review-row':'attm-normal-row'),identity=el('td');identity.dataset.label='员工 / 日期';identity.append(el('strong',d.name||'未提供姓名'),el('p',d.date||'未提供日期'));
   const verdict=el('td');verdict.dataset.label='自动结果';verdict.append(el('span',d.status==='normal'?'正常':'待核对',d.status==='normal'?'attm-badge attm-normal':'attm-badge attm-pending'));if(d.locationOutcome)verdict.append(el('p',typeof d.locationOutcome==='string'?({inside:'自动判定在门店范围内（手机报告）',outside:'自动判定在门店范围外（仅供核对）',uncertain:'定位不确定，需核对证据',fieldwork:'外勤位置已记录，不要求在门店',mixed:'含多种定位结果，查看当日明细',none:'暂无定位记录'}[d.locationOutcome]||d.locationOutcome):d.locationOutcome.message||d.locationOutcome.status||''));if(d.isWorking)verdict.append(el('p','正在工作；未闭合时长不累计'));
   const work=el('td',hours(d.closedWorkSeconds));work.dataset.label='闭合记录时长';if(num(d.unverifiedClosedWorkSeconds)>0)work.append(el('p','其中待核 '+hours(d.unverifiedClosedWorkSeconds),'attm-note'));const field=el('td',hours(d.fieldworkSeconds));field.dataset.label='其中外勤';const detail=el('td');detail.dataset.label='情况 / 操作';for(const i of arr(d.issues))detail.append(el('p',typeof i==='string'?i:i.message||i.code||'待核对'));if(!arr(d.issues).length)detail.append(el('p',d.status==='normal'?'记录正常，无需逐条核对。':'请查看当天原始出勤记录。'));if(d.status==='needs-review'&&/^20\d{2}-\d{2}-\d{2}$/.test(d.date))detail.append(btn('查看 / 核对这天',()=>showDay(d.date),'attm-day-open'));row.append(identity,verdict,work,field,detail);tbody.append(row);
  }
  table.append(tbody);out.append(days.length?table:el('p','所选月份和范围没有符合条件的出勤记录。','attm-empty'));
  const limits=el('section',undefined,'attm-limitations');limits.append(el('h3','统计边界'));const defaults=['未打卡不等于旷工；尚无排班依据，不自动判迟到或早退。','历史漏签退不按当前时间跨日累计工作时长。','手机定位仅供核对，沿用打卡当时的门店位置快照；后来的位置或门店设置不改写过去。','报告不自动罚款、扣薪或调整工资。'];for(const text of [...new Set([...defaults,...arr(data.limitations).map(String)])])limits.append(el('p',text));out.append(limits);
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
