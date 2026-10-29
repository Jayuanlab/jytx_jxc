(()=>{'use strict';
 const form=document.getElementById('new-form');if(!form)return;
 const fromRecharge=new URLSearchParams(location.search).get('from')==='air-recharge';if(fromRecharge){form.elements.phone.required=true;if(!form.elements.purpose.value)form.elements.purpose.value='充值';}
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const box=el('section',null,'assistant-intake');box.setAttribute('aria-label','语音接待助理');
 if(fromRecharge)box.append(el('p','本次要关联现金充值单。请填写顾客手机号，保存语音接待后会返回充值页面，并自动选中这张接待单。','voice-state'));
 const head=el('div',null,'assistant-intake-head'),title=el('h3','语音接待'),start=el('button','开始录音与听取');start.type='button';start.setAttribute('aria-pressed','false');head.append(title);
 const state=el('p','', 'voice-state');state.setAttribute('role','status');
 const details=el('details'),summary=el('summary','接待原话'),text=el('textarea');text.rows=12;text.maxLength=20000;text.placeholder='';text.setAttribute('aria-label','接待原话');
 const speakers=el('div',null,'voice-speaker-actions');
 for(const [role,label] of [['营业员','标注营业员说'],['顾客','标注顾客说']]){const button=el('button',label);button.type='button';button.addEventListener('click',()=>{if(listening||stopping){msg('请先结束听取，再标注说话人。',true);return;}const startAt=text.selectionStart,endAt=text.selectionEnd,prefix=(startAt&&text.value[startAt-1]!=='\n'?'\n':'')+role+'：';text.setRangeText(prefix,startAt,endAt,'end');text.dispatchEvent(new Event('input',{bubbles:true}));text.focus();});speakers.append(button);}
 details.append(summary,el('p','请先告知顾客正在语音接待。结束听取后，在确定的句子前标注“营业员”或“顾客”；未能确认的句子不要标注。'),speakers,text);
 const consentLine=el('label','我已告知顾客本次接待会录音，仅老板可以回放。','voice-consent'),consent=el('input');consent.type='checkbox';consentLine.prepend(consent);
 const audioState=el('p','尚未录音。录音保存后仅老板能播放。','voice-state');
 const actions=el('div',null,'voice-actions'),prepare=el('button','整理到表单');prepare.type='button';actions.append(prepare);
 const help=el('button','?');help.type='button';help.className='page-help-button';help.setAttribute('aria-label','语音接待说明');help.dataset.helpTarget='voice-reception-help';start.classList.add('voice-listen-control');actions.append(help,start);
 const template=el('template');template.id='voice-reception-help';template.dataset.pageHelpTemplate='语音接待';
 const p=el('p','先告知顾客并勾选确认，再点“开始录音与听取”。结束后按真实说话人标注，再点“整理到表单”；营业员核对后建立接待单。');
 const p2=el('p','录音与原始识别文字分别保存。录音只允许老板账号回放，营业员不能播放。未区分说话人的内容不会归给营业员或顾客。工作助理只作初评，老板核定有效性和积分。离开页面或锁屏会停止录制。');
 template.content.append(p,p2);document.body.append(template);
 const preview=el('section',null,'voice-preview');preview.setAttribute('aria-label','接待信息提取');preview.hidden=true;
 const previewTitle=el('strong','已提取'),previewList=el('dl');preview.append(previewTitle,previewList);
 const workspace=el('div',null,'voice-workspace'),liveText=el('div',null,'voice-live-text');workspace.setAttribute('aria-label','正在整理的接待内容');liveText.setAttribute('aria-live','polite');workspace.append(preview,liveText);box.append(head,workspace,consentLine,actions,state,audioState,details);form.before(box);
 for(const name of ['assistantTranscript','assistantRawTranscript','assistantSource']){if(!form.elements[name]){const field=el('input');field.type='hidden';field.name=name;form.append(field);}}
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 let listening=false,stopping=false,busy=false,raw='',source='text',lastInserted=null,draftVersion=0,draftController=null,liveTimer=null,liveController=null,liveVersion=0;
 let recorder=null,mediaStream=null,audioBlob=null,audioToken=null,audioKey=null,recordingStartedAt=0,recordedSeconds=0,recordingTimer=null,recordingDone=null;
 const msg=(value,error=false)=>{state.textContent=value;state.dataset.kind=error?'error':'hint';};
 async function beginRecording(){
  if(audioBlob||audioToken)throw Error('本次录音已结束，请先保存这张接待单。');
  if(!consent.checked)throw Error('请先告知顾客正在录音，再勾选确认。');
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('当前浏览器不能保存录音，请换用支持录音的手机浏览器。');
  const kind=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(value=>MediaRecorder.isTypeSupported(value));
  if(!kind)throw Error('当前浏览器没有可保存的录音格式。');
  mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});
  const chunks=[];recorder=new MediaRecorder(mediaStream,{mimeType:kind,audioBitsPerSecond:24000});recordingStartedAt=Date.now();
  recordingDone=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};recorder.onerror=()=>reject(Error('录音中断，请重新接待录制。'));recorder.onstop=()=>{clearTimeout(recordingTimer);recordingTimer=null;mediaStream?.getTracks().forEach(track=>track.stop());mediaStream=null;recordedSeconds=Math.max(1,Math.ceil((Date.now()-recordingStartedAt)/1000));audioBlob=new Blob(chunks,{type:kind});recorder=null;if(!audioBlob.size||audioBlob.size>5*1024*1024){audioBlob=null;reject(Error('录音为空或超过5MB，请缩短后重新录制。'));return;}audioState.textContent='录音已保留，时长约 '+recordedSeconds+' 秒；建立接待单时会上传，只有老板能回放。';resolve(audioBlob);};});
  recorder.start(1000);audioState.textContent='正在录音，只有老板能回放。';
  recordingTimer=setTimeout(()=>{stop().then(()=>msg('已达到15分钟录音上限，请整理并保存本次接待。'));},15*60*1000);
 }
 async function finishRecording(){if(recorder?.state==='recording')recorder.stop();if(recordingDone)await recordingDone;}
 async function stageAudio(){
  if(audioToken)return audioToken;
  if(!audioBlob)return null;
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('录音读取失败，请重试'));reader.readAsDataURL(audioBlob);});
  audioKey||=crypto.randomUUID();audioState.textContent='正在安全保存录音…';
  const response=await fetch('/api/receptions/audio/stage',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':audioKey},body:JSON.stringify({data,durationSeconds:recordedSeconds,consentConfirmed:consent.checked})});
  const result=await response.json();if(!response.ok)throw Error(result.error?.message||'录音上传失败，请重试');
  audioToken=(result.data||result).token;audioState.textContent='录音已暂存，建立接待单后只有老板能回放。';return audioToken;
 }
 function cancelPreview(){clearTimeout(liveTimer);liveTimer=null;liveController?.abort();liveController=null;++liveVersion;}
 function showPreview(data){
  previewList.replaceChildren();for(const item of data.highlights||[]){previewList.append(el('dt',item.label),el('dd',item.value));}
  if(data.pending?.length)previewList.append(el('dt','待确认'),el('dd',data.pending.join('；')));
  const assessment=data.serviceAssessment;if(assessment){previewList.append(el('dt','服务初评'),el('dd',assessment.suggestedValidity+'；'+assessment.scoreNote));if(assessment.staffWords.length)previewList.append(el('dt','营业员用语'),el('dd',assessment.staffWords.join('；')));if(assessment.staffCourtesy?.length)previewList.append(el('dt','称呼与礼貌用语'),el('dd',assessment.staffCourtesy.join('；')));if(assessment.qaPairs?.length)previewList.append(el('dt','咨询问答'),el('dd',assessment.qaPairs.map(pair=>pair.kind+'：'+pair.question+' → '+pair.answer).join('；')));if(assessment.customerQuestions.length)previewList.append(el('dt','顾客咨询'),el('dd',assessment.customerQuestions.join('；')));if(assessment.otherBusiness.length)previewList.append(el('dt','其他业务介绍'),el('dd',assessment.otherBusiness.join('；')));if(assessment.gifts.length)previewList.append(el('dt','赠品或优惠'),el('dd',assessment.gifts.join('；')));if(assessment.missing.length)previewList.append(el('dt','证据缺口'),el('dd',assessment.missing.join('；')));}
  preview.hidden=!previewList.children.length;liveText.hidden=!preview.hidden;
 }
 async function refreshPreview(){
  liveTimer=null;if(!listening||!text.value.trim()||busy)return;
  const transcript=text.value.trim(),epoch=++liveVersion;liveController?.abort();const controller=new AbortController();liveController=controller;
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch('/api/receptions/assistant-draft',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({transcript})});
   const result=await response.json();if(!response.ok||epoch!==liveVersion||!listening)return;showPreview(result.data||result);
  }catch{}finally{clearTimeout(timeout);if(liveController===controller)liveController=null;}
 }
 function queuePreview(){if(listening&&!liveTimer)liveTimer=setTimeout(refreshPreview,1400);}
 const reasons={'not-allowed':'麦克风未授权，已听文字保留。','service-not-allowed':'浏览器暂不允许语音，已听文字保留。','audio-capture':'麦克风不可用，已听文字保留。','network':'语音连接中断，已听文字保留，可点开始继续。','limit':'已达到本次文字上限，请整理这段接待。',unavailable:'暂时不能继续听取，已听文字保留。','language-not-supported':'此浏览器不支持中文识别，可直接输入。'};
 const voice=Speech&&window.ReceptionVoice?window.ReceptionVoice.create({Speech,onText(value){raw=value;text.value=value;liveText.textContent=value;source='speech';window.StoreWorkContinuity?.snapshot();if(text.selectionStart===text.selectionEnd)text.scrollTop=text.scrollHeight;queuePreview();},onState(kind,reason){
  stopping=kind==='stopping';listening=kind==='listening';text.readOnly=listening||stopping;start.disabled=stopping||busy;start.textContent=stopping?'正在结束…':listening?'结束录音':'开始录音与听取';start.setAttribute('aria-pressed',String(listening));box.setAttribute('aria-busy',String(listening));
  if(listening)msg('正在听取并录音…');else if(stopping)msg('正在整理最后一句…');else if(reason&&reason!=='user'){cancelPreview();finishRecording().catch(error=>msg(error.message,true));msg(reasons[reason]||'听取已中断，文字已保留。',true);}
 }}):null;
 async function stop(){cancelPreview();if(voice)await voice.stop();await finishRecording();listening=stopping=false;text.readOnly=false;start.setAttribute('aria-pressed','false');start.textContent='开始录音与听取';}
 async function parse(){
  if(busy||stopping)return;if(listening)try{await stop();}catch(error){msg(error.message,true);return;}cancelPreview();if(form.elements.assistantTranscript.value){msg('原单已整理，可直接修改下方表单。');return;}if(!lastInserted&&form.elements.needs.value.trim()){msg('表单已有接待内容，请先保存当前接待单。',true);return;}
  // A committed voice transcript stays immutable; text edits are a separate typed source.
  const transcript=text.value.trim();if(!transcript){details.open=true;msg('请先说话或输入接待内容。',true);text.focus();return;}
  if(transcript.length>20000){msg('本次接待内容过长，请分次整理。',true);return;}
  if(lastInserted&&(form.elements.purpose.value!==lastInserted.purpose||form.elements.needs.value!==lastInserted.needs)){msg('表单已有手动修改，请先建立这张接待单。',true);return;}
  busy=true;const epoch=++draftVersion,unchanged=JSON.stringify([form.elements.purpose.value,form.elements.needs.value]);draftController=new AbortController();const timeout=setTimeout(()=>draftController?.abort(),20000);prepare.disabled=true;start.disabled=true;msg('正在整理…');
  try{
   const response=await fetch('/api/receptions/assistant-draft',{method:'POST',credentials:'same-origin',signal:draftController.signal,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({transcript})});
   let result;try{result=await response.json();}catch{throw Error('返回不完整，请重试');}
   if(!response.ok)throw Error(result.error?.message||result.error||result.message||'暂时无法整理');
   if(epoch!==draftVersion)return;
   if(unchanged!==JSON.stringify([form.elements.purpose.value,form.elements.needs.value]))throw Error('已保留你正在填写的内容，请先保存当前接待单。');
   result=result.data||result;showPreview(result);
   const select=form.elements.purpose;
   if(result.purpose&&![...select.options].some(x=>x.value===result.purpose))select.add(new Option(result.purpose,result.purpose));
   select.value=result.purpose||'';form.elements.needs.value=result.needs||'';
   form.elements.assistantTranscript.value=transcript;form.elements.assistantRawTranscript.value=raw||'';form.elements.assistantSource.value=source==='speech'&&transcript===raw?'speech':'text';
   lastInserted={purpose:select.value,needs:form.elements.needs.value};
   form.dispatchEvent(new Event('input',{bubbles:true}));
   msg(result.needsReview?(result.intents?.length?'识别到多项业务：'+result.intents.join('、')+'。请选择本单来意。':'来意尚不明确，请选择本单来意。'):'已整理，请核对后建立接待单。');
   details.open=false;
  }catch(error){if(epoch===draftVersion)msg(error.name==='AbortError'?'整理超时，接待原话已保留。':error.message,true);}finally{clearTimeout(timeout);if(epoch===draftVersion){busy=false;prepare.disabled=false;start.disabled=false;draftController=null;}}
 }
 prepare.addEventListener('click',parse);
 start.addEventListener('click',async()=>{
  if(stopping||busy)return;
  if(listening){try{await stop();details.open=true;msg('已结束录音。请核对原话、标注能确定的说话人，再点“整理到表单”。');}catch(error){msg(error.message,true);}return;}
  if(form.elements.assistantTranscript.value){msg('这份原单已整理，请先核对并建立接待单。');return;}
  if(source==='text'&&raw){details.open=true;msg('已修改识别文字，请先整理并保存本单；原始识别文字会另行保留。');return;}
  try{await beginRecording();details.open=false;source='speech';if(voice)voice.start(text.value);else{listening=true;start.textContent='结束录音';start.setAttribute('aria-pressed','true');msg('正在录音。此浏览器不支持自动识别，结束后请如实填写双方原话。');}}catch(error){msg(error.message,true);}
 });
 form.addEventListener('submit',event=>{if(listening||stopping||busy){event.preventDefault();event.stopImmediatePropagation();if(!stopping&&!busy)parse();}},true);
 text.addEventListener('input',()=>{source='text';liveText.textContent=text.value;liveText.hidden=false;preview.hidden=true;});
 const labels={purpose:'来意',needs:'接待事项',visitorCount:'接待人数',source:'来源',visitorName:'称呼',budgetBand:'预算',budgetMin:'预算下限',budgetMax:'预算上限',followUpNeed:'跟进',followUpAt:'回访时间',viewedProducts:'看过商品',customerProfile:'顾客资料',mobileAppLoggedIn:'移动APP登录',recommendation:'推荐',review:'复盘'};
 function readable(value){if(value==null||value==='')return '未填写';if(typeof value==='object')return JSON.stringify(value,null,2);return String(value);}
 function decorate(rows){
  for(const card of document.querySelectorAll('#records [data-reception-id]')){
   const row=rows.find(x=>x.id===card.dataset.receptionId);if(!row||row.publicAssist)continue;
   if(row.serviceAssessment&&!card.querySelector('.service-assessment')){const report=row.serviceAssessment,section=el('section',null,'service-assessment');section.append(el('strong','工作助理服务初评 · '+report.suggestedValidity),el('p','来源：'+(report.source||'待核对')+'；工作助理不计分，老板按正常接待规则核定。'));
    if(row.receptionServiceRuleVersion===1)section.append(el('p',row.audioSubmitted?'原录音已提交；仅老板账号可回放。':'未保存原录音；本单暂不能核定有效或领取积分。'));
    for(const [label,values] of [['营业员用语',report.staffWords],['称呼与礼貌用语',report.staffCourtesy],['顾客咨询',report.customerQuestions],['业务介绍',report.otherBusiness],['赠品或优惠',report.gifts]])if(values?.length)section.append(el('p',label+'：'+values.join('；')));
    if(report.qaPairs?.length)section.append(el('p','咨询问答：'+report.qaPairs.map(pair=>pair.kind+'「'+pair.question+'」→「'+pair.answer+'」').join('；')));
    if(report.missing?.length)section.append(el('p','待核实：'+report.missing.join('；')));
    card.insertBefore(section,card.querySelector(':scope>.actions')||null);
   }
   if(row.audioEvidence&&!card.querySelector('.reception-audio')){const section=el('section',null,'reception-audio'),title=el('strong','原始接待录音 · 仅老板可听'),player=el('audio');player.controls=true;player.preload='none';player.src='/api/receptions/audio?id='+encodeURIComponent(row.id);section.append(title,el('p','时长约 '+row.audioEvidence.durationSeconds+' 秒；录音与修改后的文字分开保存。'),player);card.insertBefore(section,card.querySelector(':scope>.actions')||null);}
   if(row.originalDocument&&!card.querySelector('.version-history')){
    const history=el('details',null,'version-history');history.append(el('summary',(row.documentKind||'原单')+' · 原单与修改记录'));
    if(row.originalDocument.source==='legacy-baseline')history.append(el('p','历史单：从首次留痕时的内容开始记录。'));
    if(row.originalDocument.rawTranscript){const rawDetails=el('details');rawDetails.append(el('summary','原始识别文字'),el('pre',row.originalDocument.rawTranscript));history.append(rawDetails);}
    if(row.originalDocument.transcript){const marked=el('details');marked.append(el('summary',row.originalDocument.rawTranscript?'核对及说话人标注文字':'接待记录文字'),el('pre',row.originalDocument.transcript));history.append(marked);}
    const original=el('details');original.append(el('summary','原单'),el('pre',Object.entries(row.originalDocument.fields||{}).map(([k,v])=>(labels[k]||k)+'：'+readable(v)).join('\n')));history.append(original);
    for(const version of row.documentVersions||[]){const entry=el('article');entry.append(el('strong',version.kind+' · '+(version.byName||version.by)+' · '+new Date(version.at).toLocaleString('zh-CN')));
     if(version.changes?.length)entry.append(el('pre',version.changes.map(change=>(labels[change.field]||change.field)+'：'+readable(change.before)+' → '+readable(change.after)).join('\n')));else entry.append(el('p','按原单确认'));
     history.append(entry);
    }card.append(history);
   }
   if(!card.querySelector('.reception-more')){
    const more=el('details',null,'reception-more');more.append(el('summary','更多资料与操作'));
    for(const node of [...card.querySelectorAll(':scope>.intake-summary,:scope>.reception-follow-ups')])more.append(node);
    const actions=card.querySelector(':scope>.actions');
    if(actions){const secondary=el('div',null,'actions');for(const button of [...actions.children])if(!button.matches('[data-action="update"],[data-action="close"],[data-action$="-confirm"]'))secondary.append(button);if(secondary.children.length)more.append(secondary);}
    if(more.children.length>1)card.append(more);
   }
  }
 }
 function reset(){cancelPreview();voice?.cancel();listening=stopping=false;text.readOnly=false;preview.hidden=true;previewList.replaceChildren();++draftVersion;draftController?.abort();draftController=null;busy=false;prepare.disabled=false;start.disabled=false;stop().catch(()=>{});raw='';source='text';lastInserted=null;text.value='';liveText.textContent='';liveText.hidden=false;details.open=false;msg('');audioBlob=null;audioToken=null;audioKey=null;recordingDone=null;consent.checked=false;audioState.textContent='尚未录音。录音保存后仅老板能播放。';for(const key of ['assistantTranscript','assistantRawTranscript','assistantSource'])form.elements[key].value='';}
 window.StoreWorkContinuity?.register('reception-voice',{route:location.pathname+location.search,label:'语音接待',read:()=>({text:text.value,raw,source,lastInserted,transcript:form.elements.assistantTranscript.value,assistantSource:form.elements.assistantSource.value}),restore:saved=>{if(!saved)return;text.value=String(saved.text||'');raw=String(saved.raw||'');source=saved.source==='speech'?'speech':'text';lastInserted=saved.lastInserted||null;form.elements.assistantTranscript.value=String(saved.transcript||'');form.elements.assistantRawTranscript.value=raw;form.elements.assistantSource.value=String(saved.assistantSource||'');liveText.textContent=text.value;if(text.value){details.open=true;msg('已恢复上次接待文字，可继续核对和标注。');}},meaningful:saved=>!!saved.text});
 window.ReceptionAssistantUI={payload:()=>form.elements.assistantTranscript.value?{assistantTranscript:form.elements.assistantTranscript.value,assistantRawTranscript:form.elements.assistantRawTranscript.value,assistantSource:form.elements.assistantSource.value}:{},hasAudio:()=>Boolean(audioBlob||audioToken),stageAudio,reset,decorate};
 function pause(){if(listening||stopping){stop().then(()=>msg('听取已暂停，文字保留，返回后可继续。'));}}
 addEventListener('pagehide',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 addEventListener('offline',()=>{if(listening)stop().then(()=>msg('网络已断开，已听文字保留。',true));});
 if(new URLSearchParams(location.search).get('scope')==='followups'){const scope=document.getElementById('scope-filter');if(scope){scope.value='myfollowups';if(typeof render==='function')render();}}
 if(new URLSearchParams(location.search).has('assistant'))box.scrollIntoView({block:'start'});
 // Existing data can finish loading before this deferred file; re-render once when available.
 if(typeof render==='function'&&typeof rows!=='undefined'&&rows.length)render();
})();
