(()=>{'use strict';
const $=id=>document.getElementById(id),stages={morning:'早上扎账',instant:'即时扎账',handover:'中午交接班扎账',evening:'晚上正式扎账'};
let stage='evening',preview=null,isOwner=false,currentUserId=null,records=[],ownerEntry=false,entryOutcomePending=false;
const yuan=n=>n==null?'待建立账面基准':'¥'+Number(n).toFixed(2);
async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:{}),...(options.headers||{})}});const result=await response.json();if(!response.ok)throw Error(result.error?.message||'请求失败');return result;}
function element(tag,text,className){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
function addLine(root,label,system,name,details,url){const tr=element('tr'),title=element('td',label),systemCell=element('td',yuan(system)),actual=element('td');
 const disclosure=element('details'),summary=element('summary','查看明细');disclosure.append(summary);
 for(const text of details)disclosure.append(element('p',text));
 const link=element('a','打开清单 ›');link.href=url;disclosure.append(link);systemCell.append(disclosure);
 const input=element('input');input.type='number';input.min='0';input.step='0.01';input.inputMode='decimal';input.required=true;input.name=name;input.setAttribute('aria-label',label+'实际清点');input.addEventListener('input',updateDifference);actual.append(input);tr.append(title,systemCell,actual);root.append(tr);
}
function difference(label,system,name){const raw=$('close-form').elements[name]?.value;if(raw==null||raw==='')return null;if(system==null)return label+'：账面基准待建立';const delta=Math.round((Number(raw)-Number(system))*100)/100;return label+'差额 '+(delta>=0?'+':'')+yuan(delta);}
function updateDifference(){if(!preview)return;const parts=[difference('现金',preview.cashExpected,'actualCash'),difference('空充BOSS',preview.airExpected,'airActual'),difference('门店微信',preview.walletExpected,'walletActual'),difference('非现金',preview.noncashExpected,'noncashActual')];const shown=parts.filter(Boolean);$('difference').replaceChildren(element('strong',shown.length?shown.join('；'):'填入实数后显示差额'));}
function updateSubmitAvailability(){if(!preview)return;const last=(preview.existing||[]).filter(row=>row.stage===stage).at(-1),note=$('note').value.trim(),blocked=Boolean(preview.noNewDataByStage?.[stage])&&(!note||note===last?.note);$('close-form').querySelector('[type=submit]').disabled=blocked||entryOutcomePending;$('submit-hint').textContent=entryOutcomePending?'提交结果尚未核清，请先刷新查询扎账原单，勿重复提交。':blocked?'系统没有新增业务数据；本时段已提交。如有新的备注，填写后可再次提交。':'';}
function render(){if(!preview)return;for(const button of document.querySelectorAll('[data-stage]'))button.setAttribute('aria-pressed',String(button.dataset.stage===stage));$('stage-title').textContent=stages[stage];$('owner-report-fields').hidden=!isOwner;$('actual-counter').required=isOwner;$('close-form').elements.actualCountConfirmed.required=isOwner;if(isOwner){const selected=$('actual-counter').value;$('actual-counter').replaceChildren(element('option','请选择'));$('actual-counter').options[0].value='';for(const person of preview.reporters||[]){const opt=element('option',person.name);opt.value=person.id;$('actual-counter').append(opt);}$('actual-counter').value=selected;}const rows=$('rows');rows.replaceChildren();
 addLine(rows,'门店现金',preview.cashExpected,'actualCash',['期初 '+yuan(preview.openingCash),'当日现金净变动 '+yuan(preview.cashChange)],'/daily-cash-receipts?date='+encodeURIComponent(preview.date));
 addLine(rows,'空充BOSS期末余额',preview.airExpected,'airActual',['系统期末来自空充台账；请查看平台实际余额后独立填写。'],'/air-accounts');
 addLine(rows,'门店微信余额',preview.walletExpected,'walletActual',['今日增加 '+yuan(preview.walletTodayIn),'今日减少 '+yuan(preview.walletTodayOut)],'/payment-accounts');
 const items=(preview.noncashDetails||[]).slice(0,30).map(row=>String(row.account||'扫码')+' '+yuan(row.amount)+' · '+String(row.sourceId||row.id||''));
 addLine(rows,'非现金收款',preview.noncashExpected,'noncashActual',items.length?items:['当日无已登记扫码收款'],'/funds');
 updateDifference();updateSubmitAvailability();}
function actionControls(row,kind){
 const controls=element('div',null,'review-controls'),select=element('select'),note=element('input'),button=element('button',kind==='check'?'提交核对':'提交审核'),feedback=element('p','请选择结果后再提交。','action-feedback');
 const placeholder=element('option',kind==='check'?'请选择核对结果':'请选择审核结果');placeholder.value='';placeholder.disabled=true;placeholder.selected=true;select.append(placeholder);
 const values=kind==='check'?['核对一致','有异议']:['核对完成','待查','重复记录'];for(const value of values){const option=element('option',value);option.value=value;select.append(option);}
 select.setAttribute('aria-label',row.displayNo+(kind==='check'?'核对结果':'审核结果'));
 note.placeholder=kind==='check'?'核对说明（有异议时填写）':'审核说明（待查或重复时填写）';note.setAttribute('aria-label',row.displayNo+'说明');
 button.type='button';button.disabled=true;feedback.setAttribute('role','status');
 select.addEventListener('change',()=>{button.disabled=!select.value;feedback.textContent=select.value?'请核对原单与所选结果。':'请选择结果后再提交。';feedback.classList.remove('error');});
 button.addEventListener('click',async()=>{
  if(!select.value||button.disabled)return;
  if((select.value==='有异议'||select.value==='待查'||select.value==='重复记录')&&!note.value.trim()){feedback.textContent='此结果需要填写说明。';feedback.classList.add('error');return;}
  const action=kind==='check'?'店内核对':'老板审核';
  if(!window.confirm('请再次确认：'+row.displayNo+' 的'+action+'结果为「'+select.value+'」。\n此操作会留下记录；审核不代表实际收付款或现金实点。'))return;
  button.disabled=true;button.textContent='正在提交…';feedback.textContent='正在提交'+action+'，请勿重复点击。';feedback.classList.remove('error');
  try{
   await api('/api/daily-closeouts/simple/'+kind,{method:'POST',body:JSON.stringify({id:row.id,decision:select.value,note:note.value})});
   const refreshed=await load();$('status').classList.remove('error');$('status').textContent=refreshed?'已记录 '+row.displayNo+' 的'+action+'：'+select.value+'。':'已记录 '+row.displayNo+' 的'+action+'；列表刷新失败，请刷新查询原单，勿重复提交。';$('action-result').textContent=$('status').textContent;
  }catch(error){
   const uncertain=error instanceof TypeError||error instanceof SyntaxError;feedback.textContent=uncertain?'网络中断或响应不完整，结果待核对。请先刷新查询原单，勿重复提交。':error.message;feedback.classList.add('error');
   button.textContent=kind==='check'?'提交核对':'提交审核';button.disabled=uncertain||!select.value;
  }
 });
 controls.append(select,note,button,feedback);return controls;
}
function renderRolling(){const root=$('rolling');root.replaceChildren();if(!preview)return;root.hidden=false;root.append(element('h2','当前账面余额'));const grid=element('div',null,'balance-grid');for(const [label,value] of [['门店现金',preview.cashExpected],['空充BOSS',preview.airExpected],['门店微信（备用金）',preview.walletExpected]]){const card=element('div');card.append(element('span',label),element('strong',yuan(value)));grid.append(card);}root.append(grid,element('p','微信今日增加 '+yuan(preview.walletTodayIn)+' · 今日减少 '+yuan(preview.walletTodayOut)));if(preview.walletBasisReason)root.append(element('p',preview.walletBasisReason,'error'));if(preview.walletBaselineAt)root.append(element('small','余额基准确认于 '+new Date(preview.walletBaselineAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'；之后随已登记收支连续计算。'));}
function renderRecords(rows){
 records=rows;const root=$('records');root.replaceChildren();
 if(!rows.length){root.append(element('p','今天尚无记录'));return;}
 for(const row of rows){
  const article=element('article');article.id='record-'+row.id;
  const status=row.ownerReportOnly?(row.checkedAt?(row.checkDecision==='有异议'?'店内核对有异议':'店内已核对'):'店内待核对'):row.reviewedAt?row.status:row.needsOwnerReview?(row.checkedAt?'待老板审核':'待核对'):row.status;
  article.append(element('strong',row.stageName+' · '+status),element('p',row.displayNo+' · 提交人 '+row.cashier+' · '+new Date(row.submittedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})),element('p','现金 系统 '+yuan(row.cashSystem)+' / 实点 '+yuan(row.cashActual)+' / 差额 '+(row.cashDifference==null?'待核':yuan(row.cashDifference))));
  if(row.ownerRecorded)article.append(element('p','实际清点报数：'+row.actualCounterName+'；代录：'+row.recordedByName));
  if(row.sourceFormVersion==='simple-four-items-v1'){
    for(const [label,system,actual,delta] of [['空充BOSS',row.airSystem,row.airActual,row.airDifference],['门店微信',row.walletSystem,row.walletActual,row.walletDifference],['非现金收款',row.noncashSystem,row.noncashActual,row.noncashDifference]])
      article.append(element('p',label+' 系统 '+yuan(system)+' / 实报 '+yuan(actual)+' / 差额 '+(delta==null?'账面基准待建立':yuan(delta))));
    article.append(element('p','提交说明：'+(row.note||'无')));
  }else if(row.airActual!=null||row.walletActual!=null||row.noncashActual!=null)article.append(element('small',(row.airActual==null?'':('空充BOSS实看 '+yuan(row.airActual)+'；'))+(row.walletActual==null?'':('门店微信实看 '+yuan(row.walletActual)+'；'))+(row.noncashActual==null?'':('非现金实报 '+yuan(row.noncashActual)+'；'))+(row.note||'无说明')));
  if(row.checkedAt)article.append(element('p','核对人 '+row.checker+(row.selfChecked?(['instant','evening'].includes(row.stage)?'（提交人确认）':'（自核；值班登记'+row.onDutyCountAtCheck+'人）'):'')+' · '+row.checkDecision+' · '+new Date(row.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+(row.checkNote?' · '+row.checkNote:'')));
  else article.append(element('p','核对人：待核对'));
  if(row.reviewedAt)article.append(element('p','老板审核：'+row.reviewer+' · '+new Date(row.reviewedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+(row.reviewNote?' · '+row.reviewNote:'')));
  else if(!isOwner&&!row.checkedAt&&(['instant','evening'].includes(row.stage)?row.canCheck:(row.cashierId!==currentUserId||row.canSelfCheck)))article.append(actionControls(row,'check'));
  else if(isOwner&&row.needsOwnerReview)article.append(actionControls(row,'review'));
  if(row.ownerReportOnly)article.append(element('p','老板查看报告 · '+(row.ownerReportOnly.reason||'已逐单确认转为查看报告')));
  else if(isOwner&&['instant','evening'].includes(row.stage)&&!row.reviewedAt)article.append(element('p','只作报告消息；由实际提交人现场核对。查看不代表老板审核或现金已核实。','hint'));
  const historical=preview?.walletBaselineAt&&row.submittedAt<preview.walletBaselineAt&&(row.reviewedAt||row.ownerReportOnly&&row.checkedAt);
  if(historical){let details=root.querySelector('.prior-reports');if(!details){details=element('details',null,'prior-reports');details.append(element('summary','基准确认前的历史扎账（原记录保留）'));root.append(details);}details.append(article);}else root.append(article);
 }
 const target=new URLSearchParams(location.search).get('record');if(target){const node=document.getElementById('record-'+target);node?.scrollIntoView({block:'center'});node?.classList.add('focused-record');}
 updateSubmitAvailability();
}
async function load(){try{const me=await api('/api/me');isOwner=me.roleCode==='owner';currentUserId=me.id;const params=new URLSearchParams(location.search),requested=params.get('reviewDate'),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),recordDate=/^\d{4}-\d{2}-\d{2}$/.test(requested||'')?requested:today,reportOnly=(isOwner&&!ownerEntry)||(!ownerEntry&&(params.get('view')==='reports'||params.has('record')));$('owner-entry').hidden=!isOwner||ownerEntry||recordDate!==today;$('entry').hidden=reportOnly;$('page-title').textContent=reportOnly?'门店扎账报告':'当日扎账单';$('date').textContent=recordDate;$('records-title').textContent=recordDate+' 的报数与核对';if(recordDate===today){preview=await api('/api/daily-closeouts/simple-preview');renderRolling();}else{preview=null;$('rolling').hidden=true;}if(!reportOnly){$('date').textContent=preview.date+' · 系统截至 '+new Date(preview.asOf).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'});render();}renderRecords(await api('/api/daily-closeouts/simple?date='+encodeURIComponent(recordDate)));if(isOwner)await markReportsSeen();return true;}catch(error){$('status').textContent=error.message;$('status').classList.add('error');return false;}}
async function markReportsSeen(){const focus=new URLSearchParams(location.search).get('record'),shown=records.filter(row=>(!focus||row.id===focus)&&!row.reportViewed);if(!shown.length){$('status').textContent='本页报告已查看。';return}try{await api('/api/daily-closeouts/simple/seen',{method:'POST',body:JSON.stringify({rows:shown.map(row=>({id:row.id,version:row.reportVersion}))})});for(const row of shown)row.reportViewed=true;$('status').textContent='已查看，工作台报告消息提示已更新。';try{localStorage.setItem('store-report-read-signal',String(Date.now()))}catch{}}catch(error){$('status').textContent='报告已显示，查看状态暂未更新：'+error.message;}}
for(const button of document.querySelectorAll('[data-stage]'))button.addEventListener('click',()=>{stage=button.dataset.stage;render()});
$('note').addEventListener('input',updateSubmitAvailability);
$('close-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type=submit]'),feedback=$('entry-feedback');if(submit.disabled||entryOutcomePending)return;const summary=[['现金',form.elements.actualCash.value],['空充BOSS',form.elements.airActual.value],['门店微信',form.elements.walletActual.value],['非现金收款',form.elements.noncashActual.value]].map(([name,value])=>name+' '+yuan(value)).join('；');if(!window.confirm('请核对 '+preview.date+' '+stages[stage]+' 的实际报数：\n'+summary+'。\n提交后生成原单，等待店内核对；本次报数不代表老板审核或实际收付款。确认提交？'))return;submit.disabled=true;submit.textContent='正在提交…';feedback.textContent='正在提交扎账单，请勿重复点击。';feedback.classList.remove('error');try{const row=await api('/api/daily-closeouts/simple',{method:'POST',body:JSON.stringify({stage,...(isOwner?{actualCounterId:form.elements.actualCounterId.value,actualCountConfirmed:form.elements.actualCountConfirmed.checked}:{}),actualCash:form.elements.actualCash.value,airActual:form.elements.airActual.value,walletActual:form.elements.walletActual.value,noncashActual:form.elements.noncashActual.value,note:form.elements.note.value})});const refreshed=await load();feedback.textContent='已提交 '+row.displayNo+' · 待店内核对。'+(refreshed?'':'列表刷新失败，请查询原单，勿重复提交。');$('status').textContent=feedback.textContent;}catch(error){const uncertain=error instanceof TypeError||error instanceof SyntaxError;entryOutcomePending=uncertain;feedback.textContent=uncertain?'网络中断或响应不完整，结果待核对。请刷新查询扎账原单，勿重复提交。':error.message;feedback.classList.add('error');$('status').textContent=feedback.textContent;$('status').classList.add('error');}finally{submit.textContent='提交扎账单';updateSubmitAvailability();}});
$('owner-entry').addEventListener('click',()=>{ownerEntry=true;load();});
load();
})();
