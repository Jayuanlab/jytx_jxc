function createTodoFocus115(parameter,label,back,hidden=[]){
 const id=new URLSearchParams(location.search).get(parameter)||'';let box=null;
 const matches=row=>!!row&&String(row.id||'')===id;
 function select(rows,root){
  if(!id)return rows;const visible=rows.filter(matches),host=document.getElementById(root);
  if(host){if(!box){box=document.createElement('section');box.className='panel todo-focus';box.setAttribute('role','status');host.before(box);for(let node=host.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;box.scrollIntoView({block:'start'});}
   box.replaceChildren();const title=document.createElement('strong'),detail=document.createElement('p'),all=document.createElement('a'),pending=document.createElement('a');
   title.textContent=visible.length?'当前待办 · '+label:'未找到这张'+label;
   const row=visible[0];detail.textContent=row?'单号 '+String(row.displayNo||row.number||row.id)+' · '+String(row.status||'请核对原单')+'。这里只显示这一张原单。':'原单不存在或当前账号不可见，请返回待办刷新。';
   all.href=back;all.textContent='查看全部'+label;pending.href='/m#pending';pending.textContent='返回我的待办';box.append(title,detail,all,document.createTextNode(' · '),pending);
   for(const key of hidden){const node=document.getElementById(key);if(node)node.hidden=true;}
  }return visible;
 }
 return {id,matches,select};
}
const todoFocus115=createTodoFocus115("claim","成交归属申请","/receptions",["new-form"]);
const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(){return '';}
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $=id=>document.getElementById(id);
const E=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const intakeUI=window.ReceptionIntakeUI;
const purposeSelect=$('new-form').elements.purpose;
for(const option of purposeSelect.options)option.defaultSelected=false;
const purposePlaceholder=new Option('请选择本次来意','');purposePlaceholder.defaultSelected=true;
purposeSelect.prepend(purposePlaceholder);
purposeSelect.value='';purposeSelect.required=true;
const oldConvert=$('new-form').querySelector('button[value="convert"]');if(oldConvert)oldConvert.remove();
const entryHelp=document.querySelector('#receptions-entry-help p:nth-child(2)');if(entryHelp)entryHelp.textContent='至少接待1人，并主动选择真实来意，例如看手机、咨询业务或维修。没有手机号也能保存并转业务，系统按接待单号关联；手机号可后补。接待事项、跟进安排未补齐时会在“我的接待单”明确提示。';
const listTools=document.createElement('div');listTools.className='reception-list-tools';
const scopeLabel=document.createElement('label');scopeLabel.textContent='查看范围 ';
const scopeFilter=document.createElement('select');scopeFilter.id='scope-filter';
for(const [value,label] of [['mine','我的接待单'],['myfollowups','我的待回访'],['pending','我的待补接待单'],['followups','待核准跟进'],['all','全部接待单']])scopeFilter.add(new Option(label,value));
if(document.documentElement.dataset.receptionView==='followups')scopeFilter.value='myfollowups';
scopeLabel.append(scopeFilter);$('filter').before(listTools);listTools.append(scopeLabel,$('filter'));
const listStatus=document.createElement('p');listStatus.id='reception-list-status';listStatus.className='form-feedback';listStatus.setAttribute('role','status');listTools.after(listStatus);
const recordsHeading=$('records').closest('section')?.querySelector('h2');if(recordsHeading)recordsHeading.textContent='我的接待单';
if(recordsHeading){recordsHeading.id='my-receptions';recordsHeading.textContent=document.documentElement.dataset.receptionView==='followups'?'我的跟单':'我的接待单';}
$('intake-fields').innerHTML=receptionIntakeFields();intakeUI.bind($('new-form'));
function mobileAppLoginValue(value,required=false){
 if(value===true||value==='true')return true;if(value===false||value==='false')return false;
 if(value==null||value===''){if(required)throw new Error('请选择移动APP登录：是或否');return null;}throw new Error('移动APP登录只能选择是或否');
}
function mobileAppLoginText(value){return value===true?'是':value===false?'否':'未记录';}
function mobileAppLoginField(value=null,required=false){return '<label>移动APP登录<select name="mobileAppLoggedIn"'+(required?' required':'')+'><option value="" hidden disabled'+(value!==true&&value!==false?' selected':'')+'>请选择</option><option value="true"'+(value===true?' selected':'')+'>是</option><option value="false"'+(value===false?' selected':'')+'>否</option></select></label>';}
function receptionIntakeFields(row=null){return intakeUI.fields(row)+mobileAppLoginField(row?.mobileAppLoggedIn);}
function requestId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const bytes=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(bytes);else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);return 'req-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
let user=null,rows=[],claims=[],users=[],rules={basic:50},current=null,action='',serverAttempts=[];
let receptionBusinessOptions=null;
let businessOptionScript=null;
function ensureBusinessOptionsUI(){if(window.BusinessOptionsUI)return Promise.resolve(window.BusinessOptionsUI);if(businessOptionScript)return businessOptionScript;businessOptionScript=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/business-options-ui.js';script.onload=()=>{if(window.BusinessOptionsUI)resolve(window.BusinessOptionsUI);else{businessOptionScript=null;script.remove();reject(new Error('新增选项功能未加载，请重试'));}};script.onerror=()=>{businessOptionScript=null;script.remove();reject(new Error('新增选项功能未加载，请重试'));};document.head.append(script);});return businessOptionScript;}
function populateReceptionChoices(options){receptionBusinessOptions=options;for(const [name,kind] of [['source','receptionSource'],['purpose','receptionPurpose']]){const select=$('new-form').elements[name],selected=select.value;const keep=[...select.options].filter(x=>!x.dataset.businessOption).map(x=>x.cloneNode(true));for(const row of options.groups?.[kind]||[])if(!keep.some(x=>x.value===row.name)){const option=new Option(row.name,row.name);option.dataset.businessOption='1';keep.push(option);}select.replaceChildren(...keep);if(keep.some(x=>x.value===selected))select.value=selected;const button=document.querySelector('[data-reception-option="'+kind+'"]');if(button)button.disabled=options.canCreateReception!==true;}}
function mountReceptionOptionButtons(){for(const [name,kind,label] of [['source','receptionSource','接待来源'],['purpose','receptionPurpose','接待来意']]){const select=$('new-form').elements[name];if(!select||select.closest('.option-add-row'))continue;const row=document.createElement('div');row.className='option-add-row';select.before(row);row.append(select);const button=document.createElement('button');button.type='button';button.textContent='＋新增';button.dataset.receptionOption=kind;button.setAttribute('aria-label','新增'+label);button.disabled=receptionBusinessOptions?.canCreateReception!==true;row.append(button);button.addEventListener('click',async()=>{try{if(pendingCreate?.uncertain)throw new Error('接待单结果待核对，请先按原内容核对后新增选项');const actor=user?.id,ui=await ensureBusinessOptionsUI();await ui.open({kind,options:receptionBusinessOptions,isCurrent:()=>user?.id===actor&&select.isConnected,onSaved:(option,options)=>{populateReceptionChoices(options);select.value=option.name;select.dispatchEvent(new Event('change',{bubbles:true}));say('已新增并选中'+option.name+'，接待内容已保留。');}});}catch(e){say(e.message,true);}});}}
mountReceptionOptionButtons();
async function loadReceptionOptions(){const ui=await ensureBusinessOptionsUI();await ui.ready();populateReceptionChoices(await ui.read());}
async function api(path,options={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 const writing=options.method==='POST';
 try{
  let r;try{r=await fetch(path,{credentials:'same-origin',...options,signal:controller.signal});}
  catch{const error=new Error(writing?'网络连接中断，提交结果待核对。可按原内容重试核对原单。':'网络连接失败，请稍后刷新。');error.uncertain=writing;throw error;}
  let d;try{d=await r.json();}catch{const error=new Error(writing?'未收到可识别的提交结果，可按原内容重试核对原单。':'服务器返回内容无法识别，请稍后刷新。');error.uncertain=writing;throw error;}
  if(!r.ok){const error=new Error(r.status===401?'登录已失效，请用员工账号重新登录':d.error?.message||'提交失败，请稍后重试');error.status=r.status;error.attemptId=d.error?.attemptId;error.uncertain=writing&&r.status>=500;throw error;}
  return d;
 }finally{clearTimeout(timer);}
}
const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestId()},body:JSON.stringify(data)});
function say(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function refreshReceptionFeedback(){
 const form=$('new-form'),phone=form.elements.phone.value.trim(),note=$('reception-phone-feedback'),progress=$('reception-progress');
 const valid=/^1[3-9]\d{9}$/.test(phone);
 note.textContent=phone&&!valid?'请填写正确的11位手机号。':'';note.hidden=!note.textContent;
 note.dataset.kind=!phone?'hint':valid?'good':'error';
 form.elements.phone.setAttribute('aria-invalid',phone&&!valid?'true':'false');
 progress.textContent='';
 progress.hidden=!progress.textContent;
 progress.dataset.kind='hint';
}
function showReceptionErrors(issues,focus=false){const box=$('reception-errors');box.hidden=!issues.length;const signature=JSON.stringify(issues.map(x=>[x.name,x.message]));if(box.dataset.issues!==signature){box.dataset.issues=signature;box.innerHTML=issues.length?'<strong>还需要填写 '+issues.length+' 项</strong><div>'+issues.map(x=>'<button type="button" data-missing="'+E(x.name)+'">'+E(x.message)+'</button>').join('')+'</div>':'';}if(focus&&issues[0])intakeUI.focusIssue(issues[0].node);}
$('reception-errors').addEventListener('click',e=>{const b=e.target.closest('[data-missing]');if(b)intakeUI.focusIssue($('new-form').elements[b.dataset.missing]);});
$('new-form').addEventListener('input',e=>{refreshReceptionFeedback();if(e.target.matches('input,select,textarea'))e.target.removeAttribute('aria-invalid');if(!$('reception-errors').hidden)showReceptionErrors(intakeUI.errors($('new-form')));});
$('new-form').addEventListener('change',()=>{refreshReceptionFeedback();if(!$('reception-errors').hidden)showReceptionErrors(intakeUI.errors($('new-form')));});
refreshReceptionFeedback();const attemptsKey='erp-reception-attempts-v1';
function localAttempts(){try{return JSON.parse(localStorage.getItem(attemptsKey)||'[]').slice(0,30);}catch{return [];}}
function saveLocalAttempt(row){try{localStorage.setItem(attemptsKey,JSON.stringify([row,...localAttempts().filter(x=>x.requestKey!==row.requestKey)].slice(0,30)));}catch{}}
function resolveLocalAttempt(key,id,displayNo){try{const attempts=localAttempts();for(const row of attempts)if(row.requestKey===key){row.resolved=id;row.resolvedDisplayNo=displayNo||id;}localStorage.setItem(attemptsKey,JSON.stringify(attempts));}catch{}}
function renderAttempts(){
 const all=[...serverAttempts];
 for(const row of localAttempts())if(!all.some(x=>(row.id&&x.id===row.id)||(row.requestKey&&x.requestKey===row.requestKey)))all.push(row);
 all.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 if($('failure-count'))$('failure-count').textContent=Math.min(all.length,30)+'条';
 $('failed-attempts').innerHTML=all.length?all.slice(0,30).map(row=>'<article class="failed-attempt"><strong>'+E((row.uncertain?'结果待核对：':'')+row.reason)+'</strong>'+(row.resolved?'<p>已核对保存，接待单 '+E(row.resolvedDisplayNo||row.resolved)+'</p>':'')+'<small>编号：'+E(row.id)+' · '+E(new Date(row.createdAt).toLocaleString('zh-CN'))+' · '+E(row.purpose||'未选来意')+' · '+E(row.customerMask||'手机号待核')+(row.userName?' · '+E(row.userName):'')+'</small></article>').join(''):'<p class="hint">暂无失败记录。</p>';
}
function outcome(ok,message,reference,relogin=false,uncertain=false){
 say('');
 $('result-dialog').dataset.kind=ok?'good':'error';
 $('result-title').textContent=ok?'接待单建立成功':uncertain?'接待单提交结果待核对':'接待单未建立';
 $('result-close').textContent=relogin?'用员工账号重新登录':'知道了';
 $('result-close').dataset.relogin=relogin?'1':'0';
 $('result-detail').textContent=message;
 $('result-reference').textContent=reference||'';
 $('result-dialog').showModal();
}
const option=(value,label)=>'<option value="'+E(value)+'">'+E(label)+'</option>';
const select=(name,label,values)=>'<label>'+E(label)+(values.length>8?'<input class="select-filter" type="search" aria-label="搜索'+E(label)+'" placeholder="输入关键词筛选选项" autocomplete="off">':'')+'<select name="'+name+'">'+values.map(x=>option(x[0],x[1])).join('')+'</select></label>';
const businessHref=link=>['销售单','维修服务单'].includes(link.kind)?'/app?tab=orders&q='+encodeURIComponent(link.id):link.kind==='移动业务单'?'/carrier?order='+encodeURIComponent(link.id):'';
function linkedBusiness(r){const links=r.links||[],assists=r.assists||[];return '<details class="linked-business"><summary>关联业务 '+links.length+' 张 · 协助 '+assists.length+' 笔（点开查看）</summary><div class="linked-business-items">'+(links.length?links.map(x=>{const href=businessHref(x),label=E(x.kind+' '+documentNo(x));return '<div>'+(href?'<a href="'+E(href)+'">'+label+' ›</a>':label)+'</div>';}).join(''):'<div>暂无关联业务</div>')+(assists.length?'<p>协助：'+E(assists.map(x=>x.type+' '+x.fromName+'→'+x.toName+'（'+x.status+'）').join('；'))+'</p>':'')+'</div></details>';}
const input=(name,label,value='',type='text',required=false)=>'<label>'+E(label)+'<input name="'+name+'" type="'+type+'" value="'+E(value)+'" '+(required?'required':'')+'></label>';
const textarea=(name,label,value='')=>'<label>'+E(label)+'<textarea name="'+name+'" rows="3">'+E(value)+'</textarea></label>';
function button(label,act,id,extra=''){return '<button type="button" data-action="'+act+'" data-id="'+E(id)+'" '+extra+'>'+E(label)+'</button>';}
function advice(r){if(r.publicAssist)return '主动协助后填写具体事项，老板确认后再计积分。';const tips=[];if(r.completion&&!r.completion.complete)tips.push('接待待补：'+r.completion.missing.join('、'));if(!r.recommendation&&r.status!=='已结案')tips.push('可补记推荐和顾客反馈');if(r.assists.some(x=>x.status==='待确认'))tips.push('协助单待老板确认');if(r.status==='待结案确认')tips.push('待老板核准有效性和积分');if(r.status==='已转业务'&&!r.review)tips.push('成交后可补复盘');if(r.completion&&!r.completion.canConvert&&r.status!=='已结案')tips.push(r.completion.conversionNotice);return tips.length?tips.join('；'):'接待内容已完善，可继续办理。';}
function assistReviewMode(){const p=new URLSearchParams(location.search);return p.get('pendingAssist')==='1'||p.has('assist')}
function renderAssistReview(){
 const params=new URLSearchParams(location.search),selected=params.get('assist'),highlight=params.get('highlight'),q=$('filter').value.trim().toLowerCase();
 const entries=rows.flatMap(reception=>(reception.assists||[]).filter(assist=>assist.status==='待确认'&&(!selected||assist.id===selected)&&(!highlight||!selected||reception.id===highlight)).map(assist=>({reception,assist}))).filter(({reception,assist})=>[reception.id,reception.displayNo,reception.customerMask,assist.id,assist.type,assist.fromName,assist.toName,assist.detail].join(' ').toLowerCase().includes(q));
 $('records').innerHTML=entries.length?entries.map(({reception:r,assist:a})=>'<article class="receipt assist-review-card" data-reception-id="'+E(r.id)+'"><h3>协助单待确认 · '+E(a.type||'协助')+'</h3><p class="summary">'+E(a.fromName||'发起人')+' → '+E(a.toName||'协助人')+'</p><p>'+E(a.detail||'未填写具体协助内容')+'</p><small>协助单 '+E(a.id)+' · 所属接待单 '+E(documentNo(r))+' · 顾客 '+E(r.customerMask||'未留手机号')+'</small><div class="actions">'+(user.roleCode==='owner'?button('确认这笔协助','assist-confirm',r.id,'data-assist="'+E(a.id)+'"'):'<span>由老板确认</span>')+'<a href="/receptions?highlight='+encodeURIComponent(r.id)+'">查看所属接待单</a></div></article>').join(''):'<p class="hint">这笔协助已处理，或当前没有待确认协助单。<a href="/m#pending">返回待办</a></p>';
}
function focusedReviewMode(){const p=new URLSearchParams(location.search);return p.get('pendingWechat')==='1'?'wechat':p.get('pendingCloseout')==='1'?'closeout':p.get('pendingFollowup')==='1'?'followup':''}
function renderFocusedReview(mode){const params=new URLSearchParams(location.search),highlight=params.get('highlight'),q=$('filter').value.trim().toLowerCase();const filtered=rows.filter(r=>(mode==='wechat'?r.wechat?.claimed&&!r.wechat.confirmed:mode==='followup'?r.status==='待回访'&&(r.ownerId===user.id||user.roleCode==='owner'):r.status==='待结案确认')&&(!highlight||r.id===highlight)&&[r.id,r.displayNo,r.customerMask,r.ownerName,r.purpose].join(' ').toLowerCase().includes(q));$('records').innerHTML=filtered.length?filtered.map(r=>'<article class="receipt" data-reception-id="'+E(r.id)+'"><h3>'+(mode==='wechat'?'加微信积分待核准':mode==='followup'?'到期回访':'接待单待结案')+'</h3><p>'+E(r.purpose||'接待')+' · '+E(r.customerMask||'未留手机号')+'</p><small>接待单 '+E(documentNo(r))+' · 经办 '+E(r.ownerName||'未标明')+'</small><p>'+E(r.needs||'没有补充需求')+'</p><div class="actions">'+(mode==='followup'?(r.ownerId===user.id?button('补记回访结果','update',r.id)+button('回访后提交结案','close',r.id):'<span>由经办营业员回访并提交结案</span>'):user.roleCode==='owner'?button(mode==='wechat'?'核准加微信积分':'核准结案积分',mode==='wechat'?'wechat-confirm':'close-confirm',r.id):'<span>由老板确认</span>')+'<a href="/receptions?highlight='+encodeURIComponent(r.id)+'">查看完整接待单</a></div></article>').join(''):'<p class="hint">这类待办已经处理完毕。<a href="/m#pending">返回待办</a></p>'}
function render(){if(assistReviewMode()){renderAssistReview();return}const focused=focusedReviewMode();if(focused){renderFocusedReview(focused);return}const q=$('filter').value.trim().toLowerCase();const pendingOnly=new URLSearchParams(location.search).get('pendingAssist')==='1';const filtered=rows.filter(x=>(!pendingOnly||(x.assists||[]).some(a=>a.status==='待确认'))&&[x.id,x.displayNo,x.number,x.customerPhone,x.customerMask,x.purpose,x.ownerName,x.needs,JSON.stringify(x.customerProfile||{}),(x.viewedProducts||[]).map(v=>v.name).join(' ')].join(' ').toLowerCase().includes(q));
 $('records').innerHTML=filtered.length?filtered.map(r=>{
 const points=(r.points||[]).reduce((n,p)=>n+p.amount,0),own=r.ownerId===user.id,boss=user.roleCode==='owner';
 const pending=r.assists.filter(a=>a.status==='待确认');
 return '<article class="receipt" data-reception-id="'+E(r.id)+'"><h3>'+E(r.purpose)+' <small>· '+E(r.customerMask)+'</small></h3><small>'+E(documentNo(r))+' · '+E(r.ownerName)+' · '+E(new Date(r.createdAt).toLocaleString('zh-CN'))+'</small><div class="chips"><span class="chip">'+E(r.status)+'</span><span class="chip">接待人数 '+E(r.visitorCount||1)+'（同行 '+E(r.companionCount||0)+'）</span><span class="chip">有效性 '+E(r.validity)+'</span><span class="chip">已核定 '+points+' 分</span></div><p class="summary">'+E(r.needs||'尚未记录需求')+'</p>'+(r.publicAssist?'':intakeUI.summary(r))+'<p class="intake-summary">移动APP登录：'+E(mobileAppLoginText(r.mobileAppLoggedIn))+'</p><p class="guidance" data-page-explanation>'+E(advice(r))+'</p><small>业务关联：'+E(r.links.map(x=>x.kind+' '+documentNo(x)).join('；')||'暂无')+'<br>协助：'+E(r.assists.map(x=>x.type+' '+x.fromName+'→'+x.toName+'（'+x.status+'）').join('；')||'暂无')+'</small><div class="actions">'+redPacketEntry('receptions',r)+(!r.publicAssist&&(own||['owner','manager'].includes(user.roleCode))?button('移动APP登录','mobile-app-login',r.id):'')+(r.publicAssist?button('我来协助','assist',r.id):'')+(own&&r.status!=='已结案'?[button('补资料/复盘','update',r.id),button('协助/转介','assist',r.id),r.customerId&&!r.wechat.claimed?button('已加微信','wechat',r.id):'',r.customerPhone?button('转销售单','convert-sale',r.id):'',r.customerPhone?button('关联业务单','link',r.id):'',button('提交结案','close',r.id)]:[]).join('')+(!r.publicAssist&&r.status==='已结案'&&(own||['owner','manager'].includes(user.roleCode))?button('补充顾客资料','profile',r.id):'')+(r.publicAssist||!r.customerId?'':button('顾客历程','journey',r.id))+(own&&r.customerId&&!r.links.some(x=>x.kind==='销售单')?button('申请后续成交归属','conversion',r.id):'')+(!r.publicAssist&&!own&&r.status!=='已结案'&&['owner','manager'].includes(user.roleCode)?button('补充顾客资料','profile',r.id):'')+(boss&&r.wechat.claimed&&!r.wechat.confirmed?button('核准加微信积分','wechat-confirm',r.id):'')+(boss?pending.map(x=>button('核准协助 '+x.toName,'assist-confirm',r.id,'data-assist="'+E(x.id)+'"')).join(''):'')+(boss&&r.assists.some(x=>x.status==='有效')&&r.links.some(x=>x.kind==='销售单')?button('分配协助提成','commission',r.id):'')+(boss&&r.status==='待结案确认'?button('核准结案积分','close-confirm',r.id):'')+'</div>'+r.assists.map(x=>'<div>'+E(x.type+' · '+x.fromName+' → '+x.toName)+redPacketEntry('receptionAssists',x)+'</div>').join('')+'</article>';
 }).join(''):'<p class="hint">没有符合条件的接待单。</p>';
 const ownRows=rows.filter(row=>row.ownerId===user.id),pendingRows=ownRows.filter(row=>row.completion&&!row.completion.complete);
 listStatus.textContent='我的接待 '+ownRows.length+' 张 · 其中待补 '+pendingRows.length+' 张';
 for(const card of $('records').querySelectorAll('[data-reception-id]')){
  const row=rows.find(item=>item.id===card.dataset.receptionId);if(!row)continue;
  const mine=row.ownerId===user.id,scope=scopeFilter.value;
  const highlighted=new URLSearchParams(location.search).get('highlight')===row.id;
  card.hidden=!highlighted&&(scope==='mine'&&!mine||scope==='myfollowups'&&(!mine||!(row.status==='待回访'||(row.followUps||[]).length||row.followUpNeed||row.followUpAt))||scope==='pending'&&(!mine||row.completion?.complete)||scope==='followups'&&!(user.roleCode==='owner'&&(row.followUps||[]).some(x=>x.status==='待确认')));
  if(row.publicAssist)continue;
  const originalLinks=[...card.querySelectorAll('small')].find(node=>node.textContent.startsWith('业务关联：'));
  if(originalLinks){const holder=document.createElement('div');holder.innerHTML=linkedBusiness(row);originalLinks.replaceWith(holder.firstElementChild);}
  const status=document.createElement('p');status.className='reception-completion';status.dataset.complete=row.completion?.complete?'yes':'no';
  status.textContent=row.completion?.complete?'✓ 接待内容已完善':'待补：'+(row.completion?.missing||['具体接待事项']).join('、');
  card.querySelector('.chips')?.after(status);
  const actions=card.querySelector('.actions');
  if(mine){
   if(!row.wechat?.claimed&&!actions?.querySelector('[data-action="wechat"]'))actions?.insertAdjacentHTML('beforeend',button('已加微信','wechat',row.id));
   actions?.insertAdjacentHTML('beforeend',button('登记电话/再次到店','follow-up',row.id));
  }
  if(user.roleCode==='owner')for(const follow of row.followUps||[])if(follow.status==='待确认')actions?.insertAdjacentHTML('beforeend',button('核准'+follow.kind,'follow-up-confirm',row.id,'data-follow-up="'+E(follow.id)+'"'));
  if((row.followUps||[]).length){const follow=document.createElement('p');follow.className='reception-follow-ups';follow.textContent='跟进记录：'+row.followUps.map(x=>x.kind+' '+x.detail+'（'+x.status+(x.points==null?'':' · '+x.points+'分')+'）').join('；');actions?.before(follow);}
  if(mine&&row.status!=='已结案'){
   actions?.querySelector('[data-action="convert-sale"]')?.remove();
   const conversion=document.createElement('section');conversion.className='reception-conversion';
   conversion.innerHTML='<strong>继续办理</strong><div class="reception-conversion-actions">'+button('转销售单','convert-sale',row.id)+button('转维修服务单','convert-repair',row.id)+button('转移动业务单','convert-carrier',row.id)+'</div>';
   status.after(conversion);
  }else{
   const note=document.createElement('p');note.className='reception-conversion-note';note.textContent=row.status==='已结案'?'本单已结案；已办理的业务请查看下方“关联业务”。':'转单由本单接待员工操作；当前账号可查看接待情况。';status.after(note);
  }
 }
 window.ReceptionAssistantUI?.decorate(rows);window.StoreWorkContinuity?.pageReady();
}
scopeFilter.addEventListener('change',render);
function renderClaims(){const visible=todoFocus115.select(claims,'claims');if(todoFocus115.id){$('records').hidden=true;$('failed-attempts').hidden=true;}$('claims').innerHTML=visible.length?visible.map(x=>'<article class="receipt"><h3>'+E(x.customerMask)+' · '+E(x.proposerName)+' → '+E(x.targetEmployeeName)+'</h3><small>'+E(documentNo(x))+' · 成交单 '+E(documentRef(x,'orderId'))+' · '+E(x.status)+(x.points!=null?' · '+x.points+' 积分':'')+'</small><p>'+E(x.contribution)+'</p><p class="guidance">'+E(x.assessment.advice)+'</p><small>依据：'+E(x.assessment.evidence.join('；'))+(x.reviewNote?' · 老板意见：'+E(x.reviewNote):'')+'</small>'+redPacketEntry('conversionClaims',x)+(user.roleCode==='owner'&&x.status==='待老板判断'?'<div class="actions">'+button('判断转化贡献','conversion-review',x.id)+'</div>':'')+'</article>').join(''):'<p class="hint">暂无后续成交归属申请。</p>';}
async function load(){try{if(assistReviewMode()||focusedReviewMode()){const sections=[...document.querySelectorAll('main > section.panel')];for(const index of [0,1,3])if(sections[index]){sections[index].hidden=true;sections[index].style.display="none"};const heading=sections[2]?.querySelector('h2');if(heading)heading.textContent=assistReviewMode()?'协助单待确认':focusedReviewMode()==='wechat'?'加微信待核准':focusedReviewMode()==='followup'?'到期回访':'接待单待结案';const header=document.querySelector('header strong');if(header)header.textContent=heading.textContent;}const [me,organization]=await Promise.all([api('/api/me'),api('/api/organization')]);user=me;setDraftScope(organization);try{await loadReceptionOptions();}catch(e){say('新增常用选项暂未载入：'+e.message,true);}$('auth-notice').hidden=true;$('new-form').querySelectorAll('button[type=submit]').forEach(b=>b.disabled=false);registerReceptionContinuity();restoreDraft();const [result,staff,conversionRows,attemptRows]=await Promise.all([api('/api/receptions'),api('/api/users'),api('/api/conversion-claims'),api('/api/receptions/attempts')]);rows=result.rows;rules=result.rules;claims=conversionRows;serverAttempts=attemptRows;users=staff.filter(x=>x.status==='active');$('reception-operator').textContent=user.name+'（不可代填）';render();renderClaims();renderAttempts();const highlight=new URLSearchParams(location.search).get('highlight');if(highlight){$('filter').value=highlight;render();const card=document.querySelector('[data-reception-id="'+CSS.escape(highlight)+'"]');card?.scrollIntoView({block:'start'});const assistId=new URLSearchParams(location.search).get('assist');if(assistId){const url=new URL(location.href);url.searchParams.delete('assist');history.replaceState(null,'',url.pathname+url.search+url.hash);const pending=rows.find(r=>r.id===highlight)?.assists?.find(a=>a.id===assistId&&a.status==='待确认');const confirmButton=card?.querySelector('[data-action="assist-confirm"][data-assist="'+CSS.escape(assistId)+'"]');if(user.roleCode==='owner'&&pending&&confirmButton)confirmButton.click();else say('这笔协助单已处理或当前账号无权确认，请核对原单状态。',true);}}}catch(e){if(e.status===401){$('auth-notice').hidden=false;$('reception-operator').textContent='请重新登录';$('new-form').querySelectorAll('button[type=submit]').forEach(b=>b.disabled=true);}$('records').innerHTML=e.status===401?'<a href="/login?next=/receptions">用员工账号重新登录</a>':E(e.message);$('claims').innerHTML='';}}
let draftKey='',pendingKey='',pendingCreate=null,draftRestored=false;
let receptionContinuityRegistered=false;
function registerReceptionContinuity(){if(receptionContinuityRegistered||!window.StoreWorkContinuity)return;receptionContinuityRegistered=true;window.StoreWorkContinuity.register('reception',{route:location.pathname+location.search,label:'接待与跟单',read:()=>({values:formValues($('new-form')),pending:pendingCreate}),restore:saved=>{if(!saved?.values)return;pendingCreate=saved.pending||null;savePending();sessionStorage.setItem(draftKey,JSON.stringify(saved.values));draftRestored=false;restoreDraft();},meaningful:saved=>!!saved.values?.phone||!!saved.values?.needs||!!saved.values?.name});}
function setDraftScope(organization){
 const scope=user.id+':'+(organization.enabled?organization.currentBranchId:'single');
 const key='erp-reception-pending-v1:'+scope;
 if(pendingKey===key)return;
 pendingKey=key;draftKey='erp-reception-draft-after-login-v2:'+scope;pendingCreate=null;draftRestored=false;
 try{const saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(saved&&typeof saved.key==='string'&&saved.payload&&saved.signature===JSON.stringify(saved.payload))pendingCreate=saved;}catch{}
}
function savePending(){try{if(pendingCreate)sessionStorage.setItem(pendingKey,JSON.stringify(pendingCreate));else sessionStorage.removeItem(pendingKey);}catch{}}
function formValues(form){return Object.fromEntries(new FormData(form));}
function restoreDraft(){
 if(draftRestored)return;draftRestored=true;
 let data=pendingCreate?.formValues;
 if(!data)try{data=JSON.parse(sessionStorage.getItem(draftKey)||'null');}catch{return;}
 if(!data)return;
 const form=$('new-form');$('intake-fields').innerHTML=receptionIntakeFields();
 for(const key of Object.keys(data))if(form.elements[key]&&typeof data[key]==='string'){const node=form.elements[key];if(['source','purpose'].includes(key)&&data[key]&&![...node.options].some(x=>x.value===data[key]))node.append(new Option(data[key],data[key]));node.value=data[key];}
 intakeUI.bind(form);refreshReceptionFeedback();try{sessionStorage.removeItem(draftKey);}catch{}
}
function show(title,info,fields,act,row,assistId=''){current=row;action=act;$('entry-title').textContent=title;$('entry-info').textContent=info;$('entry-fields').innerHTML=fields;$('entry-error').textContent='';$('entry-dialog').dataset.assist=assistId;const dialog=$('entry-dialog');if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.scrollIntoView({block:'center'});}}
function previousReceptionPoints(kind,subtype,field,fallback){const history=rows.flatMap(r=>kind==='协助'?(r.assists||[]).filter(x=>x.status==='有效'&&x.type===subtype&&x.confirmedAt).map(x=>({at:x.confirmedAt,value:Number(x[field])})):kind==='接待有效'?(r.points||[]).filter(x=>x.kind===kind&&r.purpose===subtype).map(x=>({at:x.at,value:Number(x.amount)})):(r.points||[]).filter(x=>x.kind===kind).map(x=>({at:x.at,value:Number(x.amount)})));history.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));const latest=history.find(x=>Number.isSafeInteger(x.value)&&x.value>=0);return latest?latest.value:fallback;}
async function act(button){const row=rows.find(x=>x.id===button.dataset.id);if(!row)return;const a=button.dataset.action;const staff=users.map(x=>[x.id,x.name+' · '+x.role]);const base=rules.basic??50;
 if(a==='mobile-app-login'){if(row.publicAssist||!(row.ownerId===user.id||['owner','manager'].includes(user.roleCode)))throw new Error('只能由接待本人或负责人补录');show('移动APP登录',documentNo(row)+' · 已记录：'+mobileAppLoginText(row.mobileAppLoggedIn),mobileAppLoginField(row.mobileAppLoggedIn,true),a,row);return;}
 if(a==='convert-sale'){location.href='/app?tab=sales&reception='+encodeURIComponent(row.id);return;}
 if(a==='convert-repair'){location.href='/repair-services?reception='+encodeURIComponent(row.id);return;}
 if(a==='convert-carrier'){location.href='/carrier?reception='+encodeURIComponent(row.id);return;}
 if(a==='journey'){const profile=await api('/api/customer-journey?customerId='+encodeURIComponent(row.customerId));const dialog=document.createElement('dialog');dialog.className='journey-dialog';dialog.innerHTML='<h2>顾客历程 · '+E(profile.customer.phone)+'</h2><p>'+E(profile.visits.length)+' 次接待 · '+E(profile.customer.name||'未填写称呼')+'</p><ol>'+profile.events.map(x=>'<li><strong>'+E(x.kind)+'</strong><br><small>'+E(new Date(x.at).toLocaleString('zh-CN'))+' · '+E(x.operator)+' · '+E(documentRef(x,"receptionId"))+'</small><br>'+E(x.summary)+'</li>').join('')+'</ol><h3>接待详情</h3>'+profile.visits.map(v=>'<section class="journey-visit"><strong>'+E(v.purpose)+' · '+E(v.ownerName)+'</strong><br><small>'+E(documentNo(v))+' · '+E(v.status)+'</small><p>需求：'+E(v.needs===undefined?'仅本人或老板可查看':(v.needs||'未记录'))+'</p>'+(v.budgetBand===undefined?'':intakeUI.summary(v))+'<p>推荐：'+E(v.recommendation===undefined?'仅本人或老板可查看':(v.recommendation||'未记录'))+'</p><p>复盘：'+E(v.review===undefined?'仅本人或老板可查看':(v.review||'未记录'))+'</p><small>关联业务：'+E((v.links||[]).map(x=>x.kind+' '+documentNo(x)).join('、')||'无')+'</small></section>').join('')+'<button type="button">关闭</button>';document.body.append(dialog);dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return;}
 if(a==='conversion'){const options=await api('/api/conversion-candidates?id='+encodeURIComponent(row.id));if(!options.length){say('该顾客还没有可认领的后续成交单。乙先建立接待单并关联销售单后，再回来申请。',true);return;}show('申请后续成交归属',documentNo(row)+' · 原接待和后续成交须属于同一顾客',select('target','选择后续成交单',options.map(x=>[x.receptionId+'|'+x.orderId,x.employeeName+' · '+documentRef(x,'orderId')+' · '+x.createdAt.slice(0,10)]))+textarea('contribution','你做了哪些推动成交的工作？'),a,row);}
 if(a==='update'||a==='profile'){show(a==='profile'?'补充顾客资料':'补充接待和复盘',documentNo(row),input('visitorCount','本次接待人数（至少1人）',row.visitorCount||1,'number',true)+input('phone','顾客手机号（未留可后补）',row.customerPhone||'','tel')+input('name','顾客称呼',row.customerName||'')+receptionIntakeFields(row)+(a==='update'?textarea('recommendation','推荐、体验与顾虑',row.recommendation)+textarea('review','复盘与知识',row.review):''),a,row);intakeUI.bind($('entry-form'));}
 if(a==='wechat')show('申报加微信',row.customerMask+' · 需有具体接待内容，同一顾客只能领取一次',input('identity','微信号或可核对的唯一标识','','text',true)+select('evidence','核验方式',[['当面打开好友页面','当面打开好友页面'],['老板确认已有好友','老板确认已有好友']]),a,row);
 if(a==='wechat-confirm')show('核准加微信积分',row.customerMask+' · '+(row.wechat.evidence||'')+' · 标识：'+(row.wechat.identity||'待补录'),'<p>核验通过后固定计 200 分；请确认微信标识没有重复。</p>'+(row.wechat.identityKey?'':input('identity','旧申报补录微信号或可核对的唯一标识','','text',true)),a,row);
 if(a==='follow-up'){const now=new Date();show('登记跟进',documentNo(row)+' · 必须填写实际沟通内容；有手机号的接待核准后按基本分计',select('kind','跟进方式',[['电话跟进','电话跟进'],['再次到店','再次到店']])+input('occurredAt','实际跟进时间',new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16),'datetime-local',true)+textarea('detail','本次具体沟通内容'),a,row);}
 if(a==='follow-up-confirm'){const entry=(row.followUps||[]).find(x=>x.id===button.dataset.followUp);if(!entry)return;show('核准跟进记录',entry.kind+' · '+entry.detail+' · 时间 '+new Date(entry.occurredAt).toLocaleString('zh-CN'),select('approve','核验结果',[['true','有效'+(row.customerPhone?'，计100分':'，无手机号计0分')],['false','无效，不计分']]),a,row,entry.id);}
 if(a==='assist')show('登记转介或协助',documentNo(row),select('type','协助类型',[['转介','甲店员转给乙店员'],['协助销售','协助销售'],['协助办理业务','协助办理业务'],['其他协助','其他协助']])+select('fromId','发起/转介店员',staff)+select('toId','协助/承接店员',staff)+textarea('detail','具体协助内容'),a,row);if(a==='assist'){const f=$('entry-form');f.elements.fromId.value=row.ownerId;f.elements.toId.value=row.publicAssist?user.id:row.ownerId;}
 if(a==='assist-confirm'){const entry=row.assists.find(x=>x.id===button.dataset.assist);if(!entry)return;show('核准协助单',entry.type+' · '+entry.fromName+' → '+entry.toName+' · '+entry.detail,select('approve','是否有效',[['true','有效'],['false','无效']])+input('fromPoints','发起/转介人积分',previousReceptionPoints('协助',entry.type,'fromPoints',0),'number',true)+input('toPoints','协助/承接人积分',previousReceptionPoints('协助',entry.type,'toPoints',0),'number',true),a,row,entry.id);}
 if(a==='link'){
  if(!row.customerPhone){say('手动关联已经办理的旧单需要手机号核对；可直接点上方“转业务单”办理新单。',true);return;}
  show('按手机号关联业务单',documentNo(row)+' · 只允许关联同一手机号的业务单',
    '<label>顾客手机号<input id="link-phone" type="tel" inputmode="numeric" maxlength="11" value="'+E(row.customerPhone)+'" autocomplete="off"></label>'+
    '<button id="search-business" type="button">搜索此手机号的业务单</button>'+
    '<label>业务类型<select id="link-business-kind"><option value="">全部</option><option>销售单</option><option>维修服务单</option><option>移动业务单</option></select></label>'+
    '<label>按单号或业务内容查找<input id="link-business-filter" type="search" placeholder="输入单号、金额或业务名称" autocomplete="off"></label>'+
    '<p id="link-search-status" role="status" class="hint">正在搜索…</p>'+
    select('business','选择已办理的业务单',[['','请先搜索手机号']]),a,row);
  $('entry-form').elements.business.required=true;
  $('search-business').click();
 }
 if(a==='close'){const hasLinkedBusiness=Boolean(row.links.length);show('提交接待结案',documentNo(row)+(hasLinkedBusiness?' · 负责人核准后计积分':' · 暂无关联业务单，默认按未成交结案；若已办理请先关联业务单'),select('result','结果',hasLinkedBusiness?[['成交','成交'],['未成交','未成交']]:[['未成交','未成交'],['成交','成交（须先关联业务单）']])+select('noSaleReason','未成交原因',[['价高','价高'],['还要比较','还要比较'],['家人未定','家人未定'],['暂时不买','暂时不买'],['其他','其他']])+textarea('review','本次复盘',row.review),a,row);}
 if(a==='commission'){
  const options=await api('/api/receptions/commission-options?id='+encodeURIComponent(row.id));
  const available=options.filter(x=>!x.unresolved&&x.available>0);
  if(!available.length){say('该销售单没有可分提成，或原销售提成尚未核定。',true);return;}
  const assists=row.assists.filter(x=>x.status==='有效');
  show('老板分配协助提成','从原销售人的提成中分出。',
    select('assistId','有效协助单',assists.map(x=>[x.id,x.type+' · '+x.fromName+' → '+x.toName]))+
    select('orderId','关联销售单',available.map(x=>[x.orderId,documentRef(x,'orderId')+' · 净毛利 ¥'+x.netProfit+' · 可分 ¥'+x.available]))+
    select('beneficiaryId','分给谁',[])+
    select('rate','老板核定比例',[['1','毛利 1%'],['2','毛利 2%'],['3','毛利 3%']])+
    textarea('reason','分配依据'),a,row);
  const f=$('entry-form');
  const sync=()=>{
    const assist=assists.find(x=>x.id===f.elements.assistId.value);
    const order=available.find(x=>x.orderId===f.elements.orderId.value);
    const choices=[assist?.fromId,assist?.toId].filter(id=>id&&id!==order?.sellerId);
    f.elements.beneficiaryId.innerHTML=choices.map(id=>option(id,users.find(x=>x.id===id)?.name||id)).join('');
    const amount=Math.round(order.netProfit*Number(f.elements.rate.value))/100;
    $('entry-info').textContent='净毛利 ¥'+order.netProfit+' · 建议分配 ¥'+amount.toFixed(2)+' · 原销售人 '+order.sellerName+' · 当前可分 ¥'+order.available;
  };
  for(const name of ['assistId','orderId','rate'])f.elements[name].addEventListener('change',sync);sync();
 }
 if(a==='close-confirm'){const serviceRequired=row.receptionServiceRuleVersion===1,serviceReady=Boolean(row.audioEvidence)&&row.serviceAssessment?.serviceComplete===true,forced=Boolean(row.duplicateOf)||serviceRequired&&!serviceReady;show('老板确认结案',documentNo(row)+' · '+(serviceRequired&&!serviceReady?'缺少可回放录音或具体的双方沟通和服务过程：本单只能核定无效，不发接待积分；关联的业务原单不受影响。':'有手机号且内容完整计正常接待积分；无手机号或无效单基础积分为0。'),select('validity','判定',forced?[['无效',row.duplicateOf?'无效（同一次重复接待）':'无效（缺少录音或服务过程）']]:[['有效','有效'],['无效','无效']]),a,row);}
}
$('new-form').addEventListener('submit',async ev=>{
 ev.preventDefault();const form=ev.currentTarget,b=ev.submitter||form.querySelector('button[type=submit]'),convert=b.value==='convert';
 if(b.disabled)return;
 if(new URLSearchParams(location.search).get('from')==='air-recharge'&&!/^1[3-9]\d{9}$/.test(form.elements.phone.value.trim())){say('关联现金充值单需要顾客手机号，请先核对填写。',true);form.elements.phone.focus();return;}
 if(convert&&!/^1[3-9]\d{9}$/.test(form.elements.phone.value.trim())){say('转销售需要填写顾客手机号；没有号码可先建立留底接待单。',true);form.elements.phone.focus();return;}
 const issues=intakeUI.errors(form,convert);if(issues.length){showReceptionErrors(issues,true);say('');return;}showReceptionErrors([]);if(!intakeUI.validate(form,convert)){say('看过的商品资料尚未记下，请检查商品名称和价位。',true);return;}
 if(!user||!pendingKey){say('账号与门店尚未读取成功，请先刷新页面。',true);return;}
 const visitors=Number(form.elements.visitorCount.value);if(!Number.isInteger(visitors)||visitors<1||visitors>31){say('本次接待人数至少为1人，最多31人。',true);form.elements.visitorCount.focus();return;}
 const data={...intakeUI.data(form,convert),...window.ReceptionAssistantUI?.payload(),visitorCount:visitors,mobileAppLoggedIn:mobileAppLoginValue(form.elements.mobileAppLoggedIn?.value)};
 try{if(window.ReceptionAssistantUI?.hasAudio()){const token=await window.ReceptionAssistantUI.stageAudio();if(token)data.assistantAudioToken=token;}else if(pendingCreate?.payload?.assistantAudioToken){const previous={...pendingCreate.payload};delete previous.assistantAudioToken;if(JSON.stringify(previous)===JSON.stringify(data))data.assistantAudioToken=pendingCreate.payload.assistantAudioToken;}}catch(error){say('录音尚未保存：'+error.message,true);return;}
 const signature=JSON.stringify(data);
 if(pendingCreate?.uncertain&&pendingCreate.signature!==signature){outcome(false,'上次提交结果尚未确认，请先按原内容重试核对；补充资料可在保存后的原单中修改。','刷新页面可恢复上次提交的内容。',false,true);return;}
 if(!pendingCreate||pendingCreate.signature!==signature)pendingCreate={key:requestId(),signature,payload:data,formValues:formValues(form),uncertain:false};
 savePending();
 const requestKey=pendingCreate.key,buttons=[...form.querySelectorAll('button[type=submit]')],labels=buttons.map(x=>x.textContent),controls=[...form.querySelectorAll('input,select,textarea,button')].map(x=>[x,x.disabled]);
 controls.forEach(([x])=>x.disabled=true);b.textContent='正在提交…';
 try{
   const row=await api('/api/receptions',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(data)});
   resolveLocalAttempt(requestKey,row.id,documentNo(row));pendingCreate=null;savePending();window.StoreWorkContinuity?.complete('reception');window.StoreWorkContinuity?.complete('reception-voice');try{sessionStorage.removeItem(draftKey);}catch{}
   window.speakSubmitSuccess?.();
   if(convert){location.href='/app?tab=sales&reception='+encodeURIComponent(row.id);return;}
   if(new URLSearchParams(location.search).get('from')==='air-recharge'){try{sessionStorage.setItem('air-recharge-reception-handoff',JSON.stringify({id:row.id,phone:String(data.phone||'')}));}catch{}location.href='/air-recharge';return;}
   window.ReceptionAssistantUI?.reset();form.reset();showReceptionErrors([]);$('intake-fields').innerHTML=receptionIntakeFields();intakeUI.bind(form);refreshReceptionFeedback();location.href='/receptions?view=mine&highlight='+encodeURIComponent(row.id);
   say('已保存 · '+documentNo(row));
 }catch(error){
   const phone=String(data.phone||'').trim();
   if(error.status===401){try{sessionStorage.setItem(draftKey,JSON.stringify(pendingCreate?.formValues||{}));}catch{}$('auth-notice').hidden=false;}
   const reason=error.message||'提交失败，请稍后重试',id=error.attemptId||'本机-'+requestKey.slice(0,8);
   if(pendingCreate){pendingCreate.uncertain=Boolean(error.uncertain);if(!error.uncertain&&error.status!==401)pendingCreate=null;savePending();}
   if(error.status!==401){saveLocalAttempt({id,requestKey,reason,uncertain:Boolean(error.uncertain),createdAt:new Date().toISOString(),purpose:data.purpose||'',customerMask:/^1[3-9]\d{9}$/.test(phone)?phone.slice(0,3)+'****'+phone.slice(-4):(phone?'手机号格式不符':'未填手机号'),userName:user?.name||''});try{serverAttempts=await api('/api/receptions/attempts');}catch{}renderAttempts();}
   outcome(false,reason,error.status===401?'本次内容已暂存；重新登录后会自动带回表单。':'记录编号：'+id+'。请点下方“查看失败记录”检查。',error.status===401,Boolean(error.uncertain));
 }finally{controls.forEach(([x,disabled])=>x.disabled=disabled);buttons.forEach((x,i)=>{x.disabled=errorAuth();x.textContent=labels[i];});}
 function errorAuth(){return !$('auth-notice').hidden;}
});
$('records').addEventListener('click',ev=>{const b=ev.target.closest('button[data-action]');if(!b)return;act(b).catch(e=>{const card=b.closest('article');if(card){let note=card.querySelector('.action-error');if(!note){note=document.createElement('p');note.className='action-error';note.setAttribute('role','alert');b.closest('.actions')?.after(note);}if(note){note.textContent=e.message;note.scrollIntoView({block:'center'});}}});});
$('claims').addEventListener('click',ev=>{const button=ev.target.closest('button[data-action="conversion-review"]');if(!button)return;const claim=claims.find(x=>x.id===button.dataset.id);if(!claim)return;show('老板判断转化贡献',claim.assessment.advice+'；依据：'+claim.assessment.evidence.join('、'),select('approve','判断',[['true','认可'],['false','不认可']])+input('points','老板核定转化积分',0,'number',true)+textarea('note','判断依据或不认可原因'), 'conversion-review',claim);});
const originalOptions=new WeakMap();
let receptionLinkVersion=0,receptionLinkCandidates=[];
function renderLinkCandidates(){const selected=$('entry-form').elements.business,kind=$('link-business-kind').value,q=$('link-business-filter').value.trim().toLowerCase();const matching=receptionLinkCandidates.filter(x=>(!kind||x.kind===kind)&&(!q||(x.label+' '+x.id).toLowerCase().includes(q)));const visible=matching.slice(0,20),previous=selected.value;selected.innerHTML=option('','请选择对应的业务单')+visible.map(x=>option(x.kind+'|'+x.id,x.label)).join('');if(visible.some(x=>x.kind+'|'+x.id===previous))selected.value=previous;$('link-search-status').textContent='同一手机号可关联 '+receptionLinkCandidates.length+' 张；当前匹配 '+matching.length+' 张'+(matching.length>20?'，先显示 20 张，请输入单号缩小范围':'')+'。请核对单号后关联。';}
$('entry-dialog').addEventListener('close',()=>{receptionLinkVersion++;receptionLinkCandidates=[];});
$('entry-dialog').addEventListener('input',ev=>{
 if(ev.target.id==='link-business-filter'){renderLinkCandidates();return;}
 if(ev.target.id!=='link-phone')return;
 receptionLinkVersion++;
 receptionLinkCandidates=[];
 const select=$('entry-form').elements.business;if(select)select.innerHTML=option('','请重新搜索');
 const status=$('link-search-status');if(status)status.textContent='手机号已变更，请点击搜索。';
});
$('entry-dialog').addEventListener('change',ev=>{if(ev.target.id==='link-business-kind')renderLinkCandidates();});
$('entry-dialog').addEventListener('click',async ev=>{
 if(ev.target.id!=='search-business')return;
 const version=++receptionLinkVersion,row=current,dialog=$('entry-dialog'),phoneInput=$('link-phone'),phone=phoneInput.value.trim(),status=$('link-search-status'),select=$('entry-form').elements.business;
 const valid=()=>version===receptionLinkVersion&&current===row&&action==='link'&&dialog.open&&phoneInput.isConnected&&phoneInput.value.trim()===phone&&$('entry-form').elements.business===select;
 select.innerHTML=option('','正在搜索…');status.textContent='正在搜索…';
 try{
  const options=await api('/api/receptions/link-candidates?id='+encodeURIComponent(row.id)+'&phone='+encodeURIComponent(phone));
  if(!valid())return;
  receptionLinkCandidates=options.map(x=>({...x,label:x.displayNo?String(x.label||x.id).split(x.id).join(documentNo(x)):x.label})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  renderLinkCandidates();
  if(!options.length)status.textContent='未找到可关联的业务单。只有留有相同手机号的业务单才会显示。';
 }catch(error){if(!valid())return;select.innerHTML=option('','请重新搜索');status.textContent=error.message;}
});
$('entry-dialog').addEventListener('input',ev=>{
 if(!ev.target.matches('.select-filter'))return;
 const select=ev.target.closest('label')?.querySelector('select');if(!select)return;
 if(!originalOptions.has(select))originalOptions.set(select,Array.from(select.options,x=>x.cloneNode(true)));
 const all=originalOptions.get(select),q=ev.target.value.trim().toLowerCase(),previous=select.value;
 const matches=q?all.filter(x=>(x.textContent+' '+x.value).toLowerCase().includes(q)):all;
 select.replaceChildren(...matches.map(x=>x.cloneNode(true)));
 if(matches.some(x=>x.value===previous))select.value=previous;
 else {select.prepend(new Option(matches.length?'请选择匹配项':'没有匹配项','',true,true));select.value='';}
});$('filter').addEventListener('input',render);$('refresh').addEventListener('click',load);$('refresh-attempts').addEventListener('click',load);$('result-close').addEventListener('click',()=>{if($('result-close').dataset.relogin==='1'){location.href='/login?next=/receptions';return;}$('result-dialog').close();});$('cancel').addEventListener('click',()=>$('entry-dialog').close());
$('entry-form').addEventListener('submit',async ev=>{ev.preventDefault();const form=ev.currentTarget,b=form.querySelector('button[type=submit]');b.disabled=true;try{const d=Object.fromEntries(new FormData(form));const id=current.id;let path,payload={id};
 if(action==='update'||action==='profile'){if(!intakeUI.validate(form,!d.needs.trim()))throw new Error('请检查所填资料');path=action==='update'?'/api/receptions/update':'/api/receptions/supplement';const visitors=Number(d.visitorCount);if(!Number.isInteger(visitors)||visitors<1||visitors>31)throw new Error('本次接待人数至少为1人，最多31人');payload={...intakeUI.data(form,!d.needs.trim()),id,visitorCount:visitors,mobileAppLoggedIn:mobileAppLoginValue(d.mobileAppLoggedIn)};}
 if(action==='mobile-app-login'){path='/api/receptions/supplement';payload={id,mobileAppLoggedIn:mobileAppLoginValue(d.mobileAppLoggedIn,true)};}
 if(action==='wechat'){path='/api/receptions/wechat';payload={...payload,identity:d.identity,evidence:d.evidence};}
 if(action==='wechat-confirm'){path='/api/receptions/wechat/confirm';payload={...payload,identity:d.identity};}
 if(action==='follow-up'){path='/api/receptions/follow-up';payload={...payload,kind:d.kind,detail:d.detail,occurredAt:new Date(d.occurredAt).toISOString()};}
 if(action==='follow-up-confirm'){path='/api/receptions/follow-up/confirm';payload={...payload,followUpId:$('entry-dialog').dataset.assist,approve:d.approve==='true'};}
 if(action==='assist'){path='/api/receptions/assist';payload={...payload,type:d.type,fromId:d.fromId,toId:d.toId,detail:d.detail};}
 if(action==='assist-confirm'){path='/api/receptions/assist/confirm';payload={...payload,assistId:$('entry-dialog').dataset.assist,approve:d.approve==='true',fromPoints:Number(d.fromPoints),toPoints:Number(d.toPoints)};}
 if(action==='link'){if(!d.business)throw new Error('请先按顾客手机号搜索并选择业务单');path='/api/receptions/link';const [kind,sourceId]=d.business.split('|');payload={receptionId:id,kind,sourceId};}
 if(action==='close'){path='/api/receptions/close';payload={...payload,result:d.result,noSaleReason:d.noSaleReason,review:d.review};}
 if(action==='commission'){path='/api/receptions/commission';payload={...payload,assistId:d.assistId,orderId:d.orderId,beneficiaryId:d.beneficiaryId,rate:Number(d.rate),reason:d.reason};}
 if(action==='conversion'){path='/api/conversion-claims';const [targetReceptionId,orderId]=d.target.split('|');payload={sourceReceptionId:id,targetReceptionId,orderId,contribution:d.contribution};}
 if(action==='conversion-review'){path='/api/conversion-claims/review';payload={id,approve:d.approve==='true',points:Number(d.points),note:d.note};}
 if(action==='close-confirm'){path='/api/receptions/close/confirm';payload={...payload,validity:d.validity};}
 await post(path,payload);$('entry-dialog').close();if(action==='assist-confirm'&&assistReviewMode()||action==='wechat-confirm'&&focusedReviewMode()==='wechat'||action==='close-confirm'&&focusedReviewMode()==='closeout'){const url=new URL(location.href);url.searchParams.delete('highlight');url.searchParams.delete('assist');if(action==='assist-confirm')url.searchParams.set('pendingAssist','1');history.replaceState(null,'',url.pathname+url.search+url.hash);$('filter').value='';say(action==='assist-confirm'?'这笔协助单已处理，请继续核对剩余协助单。':'这笔待办已处理，请继续核对剩余单据。');}else say('已保存，接待单 '+documentNo(current));await load();
 }catch(e){$('entry-error').textContent=e.message;}finally{b.disabled=false;}});
renderAttempts();load();



api('/api/products').then(p=>intakeUI.setProducts(p)).catch(e=>intakeUI.setProducts([],e.message));


