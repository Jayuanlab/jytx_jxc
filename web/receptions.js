const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(collection,row){if(!row?.id)return '';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return '<span class="red-packet-slot" data-rp-collection="'+esc(collection)+'" data-rp-source="'+esc(row.id)+'" hidden><button type="button" class="red-packet-request" data-rp-open>申请红包</button><small data-rp-state></small></span>'; }
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $=id=>document.getElementById(id);
const E=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const intakeUI=window.ReceptionIntakeUI;
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
 note.textContent=!phone?'无手机号不能关联交易。':valid?'✓ 手机号格式正确。':'请填写正确的11位手机号；没有号码可留空。';
 note.dataset.kind=!phone?'hint':valid?'good':'error';
 form.elements.phone.setAttribute('aria-invalid',phone&&!valid?'true':'false');
 progress.textContent=form.elements.needs.value.trim()?'✓ 已记录顾客需求。':'';
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
 say(message,!ok);
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
const input=(name,label,value='',type='text',required=false)=>'<label>'+E(label)+'<input name="'+name+'" type="'+type+'" value="'+E(value)+'" '+(required?'required':'')+'></label>';
const textarea=(name,label,value='')=>'<label>'+E(label)+'<textarea name="'+name+'" rows="3">'+E(value)+'</textarea></label>';
function button(label,act,id,extra=''){return '<button type="button" data-action="'+act+'" data-id="'+E(id)+'" '+extra+'>'+E(label)+'</button>';}
function advice(r){if(r.publicAssist)return '主动协助后填写具体事项，老板确认后再计积分。';const tips=[];if(!r.needs)tips.push('补记谁使用、预算、用途和顾虑');if(!r.recommendation&&r.status!=='已结案')tips.push('记录推荐机型与顾客反馈');if(r.status==='待回访'&&!r.followUpAt)tips.push('设置回访时间');if(r.assists.some(x=>x.status==='待确认'))tips.push('协助单待老板确认');if(r.status==='待结案确认')tips.push('待老板核准有效性和积分');if(r.status==='已转业务'&&!r.review)tips.push('成交后补一条复盘');return tips.length?'规则提醒：'+tips.join('；'):'记录已齐，可继续办理。';}
function render(){const q=$('filter').value.trim().toLowerCase();const filtered=rows.filter(x=>[x.id,x.displayNo,x.number,x.customerPhone,x.customerMask,x.purpose,x.ownerName,x.needs,JSON.stringify(x.customerProfile||{}),(x.viewedProducts||[]).map(v=>v.name).join(' ')].join(' ').toLowerCase().includes(q));
 $('records').innerHTML=filtered.length?filtered.map(r=>{
 const points=(r.points||[]).reduce((n,p)=>n+p.amount,0),own=r.ownerId===user.id,boss=user.roleCode==='owner';
 const pending=r.assists.filter(a=>a.status==='待确认');
 return '<article class="receipt" data-reception-id="'+E(r.id)+'"><h3>'+E(r.purpose)+' <small>· '+E(r.customerMask)+'</small></h3><small>'+E(documentNo(r))+' · '+E(r.ownerName)+' · '+E(new Date(r.createdAt).toLocaleString('zh-CN'))+'</small><div class="chips"><span class="chip">'+E(r.status)+'</span><span class="chip">有效性 '+E(r.validity)+'</span><span class="chip">已核定 '+points+' 分</span></div><p class="summary">'+E(r.needs||'尚未记录需求')+'</p>'+(r.publicAssist?'':intakeUI.summary(r))+'<p class="intake-summary">移动APP登录：'+E(mobileAppLoginText(r.mobileAppLoggedIn))+'</p><p class="guidance" data-page-explanation>'+E(advice(r))+'</p><small>业务关联：'+E(r.links.map(x=>x.kind+' '+documentNo(x)).join('；')||'暂无')+'<br>协助：'+E(r.assists.map(x=>x.type+' '+x.fromName+'→'+x.toName+'（'+x.status+'）').join('；')||'暂无')+'</small><div class="actions">'+redPacketEntry('receptions',r)+(!r.publicAssist&&(own||['owner','manager'].includes(user.roleCode))?button('移动APP登录','mobile-app-login',r.id):'')+(r.publicAssist?button('我来协助','assist',r.id):'')+(own&&r.status!=='已结案'?[button('补资料/复盘','update',r.id),button('协助/转介','assist',r.id),r.customerId&&!r.wechat.claimed?button('已加微信','wechat',r.id):'',r.customerPhone?button('转销售单','convert-sale',r.id):'',r.customerPhone?button('关联业务单','link',r.id):'',button('提交结案','close',r.id)]:[]).join('')+(!r.publicAssist&&r.status==='已结案'&&(own||['owner','manager'].includes(user.roleCode))?button('补充顾客资料','profile',r.id):'')+(r.publicAssist||!r.customerId?'':button('顾客历程','journey',r.id))+(own&&r.customerId&&!r.links.some(x=>x.kind==='销售单')?button('申请后续成交归属','conversion',r.id):'')+(!r.publicAssist&&!own&&r.status!=='已结案'&&['owner','manager'].includes(user.roleCode)?button('补充顾客资料','profile',r.id):'')+(boss&&r.wechat.claimed&&!r.wechat.confirmed?button('核准加微信积分','wechat-confirm',r.id):'')+(boss?pending.map(x=>button('核准协助 '+x.toName,'assist-confirm',r.id,'data-assist="'+E(x.id)+'"')).join(''):'')+(boss&&r.assists.some(x=>x.status==='有效')&&r.links.some(x=>x.kind==='销售单')?button('分配协助提成','commission',r.id):'')+(boss&&r.status==='待结案确认'?button('核准结案积分','close-confirm',r.id):'')+'</div>'+r.assists.map(x=>'<div>'+E(x.type+' · '+x.fromName+' → '+x.toName)+redPacketEntry('receptionAssists',x)+'</div>').join('')+'</article>';
 }).join(''):'<p class="hint">没有符合条件的接待单。</p>';}
function renderClaims(){$('claims').innerHTML=claims.length?claims.map(x=>'<article class="receipt"><h3>'+E(x.customerMask)+' · '+E(x.proposerName)+' → '+E(x.targetEmployeeName)+'</h3><small>'+E(documentNo(x))+' · 成交单 '+E(documentRef(x,'orderId'))+' · '+E(x.status)+(x.points!=null?' · '+x.points+' 积分':'')+'</small><p>'+E(x.contribution)+'</p><p class="guidance">'+E(x.assessment.advice)+'</p><small>依据：'+E(x.assessment.evidence.join('；'))+(x.reviewNote?' · 老板意见：'+E(x.reviewNote):'')+'</small>'+redPacketEntry('conversionClaims',x)+(user.roleCode==='owner'&&x.status==='待老板判断'?'<div class="actions">'+button('判断转化贡献','conversion-review',x.id)+'</div>':'')+'</article>').join(''):'<p class="hint">暂无后续成交归属申请。</p>';}
async function load(){try{const [me,organization]=await Promise.all([api('/api/me'),api('/api/organization')]);user=me;setDraftScope(organization);try{await loadReceptionOptions();}catch(e){say('新增常用选项暂未载入：'+e.message,true);}$('auth-notice').hidden=true;$('new-form').querySelectorAll('button[type=submit]').forEach(b=>b.disabled=false);restoreDraft();const [result,staff,conversionRows,attemptRows]=await Promise.all([api('/api/receptions'),api('/api/users'),api('/api/conversion-claims'),api('/api/receptions/attempts')]);rows=result.rows;rules=result.rules;claims=conversionRows;serverAttempts=attemptRows;users=staff.filter(x=>x.status==='active');$('reception-operator').textContent=user.name+'（不可代填）';render();renderClaims();renderAttempts();const highlight=new URLSearchParams(location.search).get('highlight');if(highlight){$('filter').value=highlight;render();const card=document.querySelector('[data-reception-id="'+CSS.escape(highlight)+'"]');card?.scrollIntoView({block:'start'});}}catch(e){if(e.status===401){$('auth-notice').hidden=false;$('reception-operator').textContent='请重新登录';$('new-form').querySelectorAll('button[type=submit]').forEach(b=>b.disabled=true);}$('records').innerHTML=e.status===401?'<a href="/login?next=/receptions">用员工账号重新登录</a>':E(e.message);$('claims').innerHTML='';}}
let draftKey='',pendingKey='',pendingCreate=null,draftRestored=false;
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
function show(title,info,fields,act,row,assistId=''){current=row;action=act;$('entry-title').textContent=title;$('entry-info').textContent=info;$('entry-fields').innerHTML=fields;$('entry-error').textContent='';$('entry-dialog').dataset.assist=assistId;$('entry-dialog').showModal();}
async function act(button){const row=rows.find(x=>x.id===button.dataset.id);if(!row)return;const a=button.dataset.action;const staff=users.map(x=>[x.id,x.name+' · '+x.role]);const base=rules.basic||50;
 if(a==='mobile-app-login'){if(row.publicAssist||!(row.ownerId===user.id||['owner','manager'].includes(user.roleCode)))throw new Error('只能由接待本人或负责人补录');show('移动APP登录',documentNo(row)+' · 已记录：'+mobileAppLoginText(row.mobileAppLoggedIn),mobileAppLoginField(row.mobileAppLoggedIn,true),a,row);return;}
 if(a==='convert-sale'){location.href='/app?tab=sales&reception='+encodeURIComponent(row.id);return;}
 if(a==='journey'){const profile=await api('/api/customer-journey?customerId='+encodeURIComponent(row.customerId));const dialog=document.createElement('dialog');dialog.className='journey-dialog';dialog.innerHTML='<h2>顾客历程 · '+E(profile.customer.phone)+'</h2><p>'+E(profile.visits.length)+' 次接待 · '+E(profile.customer.name||'未填写称呼')+'</p><ol>'+profile.events.map(x=>'<li><strong>'+E(x.kind)+'</strong><br><small>'+E(new Date(x.at).toLocaleString('zh-CN'))+' · '+E(x.operator)+' · '+E(documentRef(x,"receptionId"))+'</small><br>'+E(x.summary)+'</li>').join('')+'</ol><h3>接待详情</h3>'+profile.visits.map(v=>'<section class="journey-visit"><strong>'+E(v.purpose)+' · '+E(v.ownerName)+'</strong><br><small>'+E(documentNo(v))+' · '+E(v.status)+'</small><p>需求：'+E(v.needs===undefined?'仅本人或老板可查看':(v.needs||'未记录'))+'</p>'+(v.budgetBand===undefined?'':intakeUI.summary(v))+'<p>推荐：'+E(v.recommendation===undefined?'仅本人或老板可查看':(v.recommendation||'未记录'))+'</p><p>复盘：'+E(v.review===undefined?'仅本人或老板可查看':(v.review||'未记录'))+'</p><small>关联业务：'+E((v.links||[]).map(x=>x.kind+' '+documentNo(x)).join('、')||'无')+'</small></section>').join('')+'<button type="button">关闭</button>';document.body.append(dialog);dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return;}
 if(a==='conversion'){const options=await api('/api/conversion-candidates?id='+encodeURIComponent(row.id));if(!options.length){say('该顾客还没有可认领的后续成交单。乙先建立接待单并关联销售单后，再回来申请。',true);return;}show('申请后续成交归属',documentNo(row)+' · 原接待和后续成交须属于同一顾客',select('target','选择后续成交单',options.map(x=>[x.receptionId+'|'+x.orderId,x.employeeName+' · '+documentRef(x,'orderId')+' · '+x.createdAt.slice(0,10)]))+textarea('contribution','你做了哪些推动成交的工作？'),a,row);}
 if(a==='update'||a==='profile'){show(a==='profile'?'补充顾客资料':'补充接待和复盘',documentNo(row),receptionIntakeFields(row)+(a==='update'?textarea('recommendation','推荐、体验与顾虑',row.recommendation)+textarea('review','复盘与知识',row.review):''),a,row);intakeUI.bind($('entry-form'));}
 if(a==='wechat')show('申报加微信',row.customerMask+' · 同一顾客只能领取一次',select('evidence','核验方式',[['当面打开好友页面','当面打开好友页面'],['老板确认已有好友','老板确认已有好友']]),a,row);
 if(a==='wechat-confirm')show('核准加微信积分',row.customerMask+' · '+(row.wechat.evidence||''),input('points','老板核定积分',rules.wechat||0,'number',true),a,row);
 if(a==='assist')show('登记转介或协助',documentNo(row),select('type','协助类型',[['转介','甲店员转给乙店员'],['协助销售','协助销售'],['协助办理业务','协助办理业务'],['其他协助','其他协助']])+select('fromId','发起/转介店员',staff)+select('toId','协助/承接店员',staff)+textarea('detail','具体协助内容'),a,row);if(a==='assist'){const f=$('entry-form');f.elements.fromId.value=row.ownerId;f.elements.toId.value=row.publicAssist?user.id:row.ownerId;}
 if(a==='assist-confirm'){const entry=row.assists.find(x=>x.id===button.dataset.assist);if(!entry)return;show('核准协助单',entry.type+' · '+entry.fromName+' → '+entry.toName+' · '+entry.detail,select('approve','是否有效',[['true','有效'],['false','无效']])+input('fromPoints','发起/转介人积分',0,'number',true)+input('toPoints','协助/承接人积分',0,'number',true),a,row,entry.id);}
 if(a==='link'){
  if(!row.customerPhone){say('无手机号接待不能关联业务单，只能留底并核定基础积分。',true);return;}
  show('按手机号关联业务单',documentNo(row)+' · 只允许关联同一手机号的业务单',
    '<label>顾客手机号<input id="link-phone" type="tel" inputmode="numeric" maxlength="11" value="'+E(row.customerPhone)+'" autocomplete="off"></label>'+
    '<button id="search-business" type="button">搜索此手机号的业务单</button>'+
    '<p id="link-search-status" role="status" class="hint">正在搜索…</p>'+
    select('business','选择已办理的业务单',[['','请先搜索手机号']]),a,row);
  $('entry-form').elements.business.required=true;
  $('search-business').click();
 }
 if(a==='close')show('提交接待结案',documentNo(row)+' · 负责人核准后才计积分',select('result','结果',row.customerId?[['成交','成交'],['未成交','未成交']]:[['未成交','未成交（无手机号留底）']])+select('noSaleReason','未成交原因',[['价高','价高'],['还要比较','还要比较'],['家人未定','家人未定'],['暂时不买','暂时不买'],['其他','其他']])+textarea('review','本次复盘',row.review),a,row);
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
 if(a==='close-confirm')show('老板确认结案',documentNo(row)+' · 无效单不少于 '+base+' 分',select('validity','判定',row.customerId?[['有效','有效'],['无效','无效']]:[['无效','无效（无手机号）']])+input('points','老板核定接待积分',base,'number',true),a,row);
}
$('new-form').addEventListener('submit',async ev=>{
 ev.preventDefault();const form=ev.currentTarget,b=ev.submitter||form.querySelector('button[type=submit]'),convert=b.value==='convert';
 if(b.disabled)return;
 if(convert&&!/^1[3-9]\d{9}$/.test(form.elements.phone.value.trim())){say('转销售需要填写顾客手机号；没有号码可先建立留底接待单。',true);form.elements.phone.focus();return;}
 const issues=intakeUI.errors(form,convert);if(issues.length){showReceptionErrors(issues,true);say('尚未提交，请补齐上方列出的项目后再提交。',true);return;}showReceptionErrors([]);if(!intakeUI.validate(form,convert)){say('看过的商品资料尚未记下，请检查商品名称和价位。',true);return;}
 if(!user||!pendingKey){say('账号与门店尚未读取成功，请先刷新页面。',true);return;}
 const data={...intakeUI.data(form,convert),mobileAppLoggedIn:mobileAppLoginValue(form.elements.mobileAppLoggedIn?.value)},signature=JSON.stringify(data);
 if(pendingCreate?.uncertain&&pendingCreate.signature!==signature){outcome(false,'上次提交结果尚未确认，请先按原内容重试核对；补充资料可在保存后的原单中修改。','刷新页面可恢复上次提交的内容。',false,true);return;}
 if(!pendingCreate||pendingCreate.signature!==signature)pendingCreate={key:requestId(),signature,payload:data,formValues:formValues(form),uncertain:false};
 savePending();
 const requestKey=pendingCreate.key,buttons=[...form.querySelectorAll('button[type=submit]')],labels=buttons.map(x=>x.textContent),controls=[...form.querySelectorAll('input,select,textarea,button')].map(x=>[x,x.disabled]);
 controls.forEach(([x])=>x.disabled=true);b.textContent='正在提交…';
 try{
   const row=await api('/api/receptions',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(data)});
   resolveLocalAttempt(requestKey,row.id,documentNo(row));pendingCreate=null;savePending();try{sessionStorage.removeItem(draftKey);}catch{}
   window.speakSubmitSuccess?.();
   if(convert){location.href='/app?tab=sales&reception='+encodeURIComponent(row.id);return;}
   form.reset();showReceptionErrors([]);$('intake-fields').innerHTML=receptionIntakeFields();intakeUI.bind(form);refreshReceptionFeedback();await load();$('filter').value=row.id;render();
   outcome(true,row.customerId?'接待单已保存，可以在下方查看、跟进或补充顾客资料。':'无手机号接待已留底；结案后由老板核定基本积分。','接待单号：'+documentNo(row));
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
$('records').addEventListener('click',ev=>{const b=ev.target.closest('button[data-action]');if(b)act(b).catch(e=>say(e.message,true));});
$('claims').addEventListener('click',ev=>{const button=ev.target.closest('button[data-action="conversion-review"]');if(!button)return;const claim=claims.find(x=>x.id===button.dataset.id);if(!claim)return;show('老板判断转化贡献',claim.assessment.advice+'；依据：'+claim.assessment.evidence.join('、'),select('approve','判断',[['true','认可'],['false','不认可']])+input('points','老板核定转化积分',0,'number',true)+textarea('note','判断依据或不认可原因'), 'conversion-review',claim);});
const originalOptions=new WeakMap();
let receptionLinkVersion=0;
$('entry-dialog').addEventListener('close',()=>{receptionLinkVersion++;});
$('entry-dialog').addEventListener('input',ev=>{
 if(ev.target.id!=='link-phone')return;
 receptionLinkVersion++;
 const select=$('entry-form').elements.business;if(select)select.innerHTML=option('','请重新搜索');
 const status=$('link-search-status');if(status)status.textContent='手机号已变更，请点击搜索。';
});
$('entry-dialog').addEventListener('click',async ev=>{
 if(ev.target.id!=='search-business')return;
 const version=++receptionLinkVersion,row=current,dialog=$('entry-dialog'),phoneInput=$('link-phone'),phone=phoneInput.value.trim(),status=$('link-search-status'),select=$('entry-form').elements.business;
 const valid=()=>version===receptionLinkVersion&&current===row&&action==='link'&&dialog.open&&phoneInput.isConnected&&phoneInput.value.trim()===phone&&$('entry-form').elements.business===select;
 select.innerHTML=option('','正在搜索…');status.textContent='正在搜索…';
 try{
  const options=await api('/api/receptions/link-candidates?id='+encodeURIComponent(row.id)+'&phone='+encodeURIComponent(phone));
  if(!valid())return;
  select.innerHTML=option('','请选择业务单')+options.map(x=>option(x.kind+'|'+x.id,x.displayNo?String(x.label||x.id).split(x.id).join(documentNo(x)):x.label)).join('');
  status.textContent=options.length?'找到 '+options.length+' 张同手机号、尚未关联的业务单。':'未找到可关联的业务单。只有留有相同手机号的业务单才会显示。';
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
 if(action==='update'||action==='profile'){if(!intakeUI.validate(form,!d.needs.trim()))throw new Error('请检查所填资料');path=action==='update'?'/api/receptions/update':'/api/receptions/supplement';payload={...intakeUI.data(form,!d.needs.trim()),id,mobileAppLoggedIn:mobileAppLoginValue(d.mobileAppLoggedIn)};}
 if(action==='mobile-app-login'){path='/api/receptions/supplement';payload={id,mobileAppLoggedIn:mobileAppLoginValue(d.mobileAppLoggedIn,true)};}
 if(action==='wechat'){path='/api/receptions/wechat';payload={...payload,evidence:d.evidence};}
 if(action==='wechat-confirm'){path='/api/receptions/wechat/confirm';payload={...payload,points:Number(d.points)};}
 if(action==='assist'){path='/api/receptions/assist';payload={...payload,type:d.type,fromId:d.fromId,toId:d.toId,detail:d.detail};}
 if(action==='assist-confirm'){path='/api/receptions/assist/confirm';payload={...payload,assistId:$('entry-dialog').dataset.assist,approve:d.approve==='true',fromPoints:Number(d.fromPoints),toPoints:Number(d.toPoints)};}
 if(action==='link'){if(!d.business)throw new Error('请先按顾客手机号搜索并选择业务单');path='/api/receptions/link';const [kind,sourceId]=d.business.split('|');payload={receptionId:id,kind,sourceId};}
 if(action==='close'){path='/api/receptions/close';payload={...payload,result:d.result,noSaleReason:d.noSaleReason,review:d.review};}
 if(action==='commission'){path='/api/receptions/commission';payload={...payload,assistId:d.assistId,orderId:d.orderId,beneficiaryId:d.beneficiaryId,rate:Number(d.rate),reason:d.reason};}
 if(action==='conversion'){path='/api/conversion-claims';const [targetReceptionId,orderId]=d.target.split('|');payload={sourceReceptionId:id,targetReceptionId,orderId,contribution:d.contribution};}
 if(action==='conversion-review'){path='/api/conversion-claims/review';payload={id,approve:d.approve==='true',points:Number(d.points),note:d.note};}
 if(action==='close-confirm'){path='/api/receptions/close/confirm';payload={...payload,validity:d.validity,points:Number(d.points)};}
 await post(path,payload);$('entry-dialog').close();say('已保存，接待单 '+documentNo(current));await load();
 }catch(e){$('entry-error').textContent=e.message;}finally{b.disabled=false;}});
renderAttempts();load();



api('/api/products').then(p=>intakeUI.setProducts(p)).catch(e=>intakeUI.setProducts([],e.message));
