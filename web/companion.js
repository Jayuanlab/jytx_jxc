'use strict';
// Layout only: each assistant keeps its own conversations and permissions.
window.ChatWindow = {
 mount({input,thread,toggle,panel,dock}) {
  const resizeInput=()=>{input.style.height='auto';input.style.height=Math.min(184,Math.max(64,input.scrollHeight+4))+'px';};
  const scroll=(force=true)=>{if(force)requestAnimationFrame(()=>thread.scrollTo({top:thread.scrollHeight,behavior:'auto'}));};
  const menu=(open=panel.hidden)=>{panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'收起功能':'更多功能');toggle.textContent=open?'×':'＋';};
  toggle.onclick=()=>menu();
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){menu(false);toggle.focus();}});
  input.addEventListener('input',resizeInput);
  input.addEventListener('focus',()=>menu(false));
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();input.form?.requestSubmit();}});
  const viewport=()=>{const v=window.visualViewport;document.documentElement.style.setProperty('--chat-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--chat-top',(v?.offsetTop||0)+'px');};
  window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);
  if(window.ResizeObserver)new ResizeObserver(()=>document.documentElement.style.setProperty('--chat-dock-height',dock.offsetHeight+'px')).observe(dock);
  viewport();resizeInput();return {resizeInput,scroll,menu};
 }
};

'use strict';
const companionEmbedded=new URLSearchParams(location.search).has('embedded');let companionVisible=!companionEmbedded;
if(companionEmbedded)document.documentElement.classList.add('companion-embedded');
const $=id=>document.getElementById(id);let data=null,suggestion='',busy=false,pending=null,newsFilter='all';
const chatUI=ChatWindow.mount({input:$('chat-input'),thread:$('messages'),toggle:$('chat-more-toggle'),panel:$('chat-more-panel'),dock:$('companion-dock')});
const el=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const reader=CompanionSpeech.create({onState:state=>{const b=$('auto-read');b.disabled=!state.available;b.textContent=state.available?'自动朗读：'+(state.enabled?'开':'关'):'朗读暂不可用';b.setAttribute('aria-pressed',String(state.enabled));$('stop-reading').hidden=!state.speaking;},onError:message=>$('reading-status').textContent=message});
$('auto-read').onclick=()=>{reader.setEnabled(!reader.state().enabled);$('reading-status').textContent='';reader.prime();};
const requests=CompanionRequests.create(),dirtyForms=new Set();let loadSequence=0;
const savedForms={'/api/companion/profile':'profile-form','/api/companion/news/settings':'news-form','/api/companion/wechat/settings':'wechat-form','/api/companion/emergency':'emergency-form'};
document.addEventListener('input',e=>{const f=e.target.closest('form');if(f&&Object.values(savedForms).includes(f.id))dirtyForms.add(f.id);});
document.addEventListener('change',e=>{const f=e.target.closest('form');if(f&&Object.values(savedForms).includes(f.id))dirtyForms.add(f.id);});
async function api(path,body,key){const id=savedForms[path],form=id&&$(id),draft=form?JSON.stringify([...new FormData(form)]):null;try{const result=await requests.request(path,body,key);if(body&&id&&draft===JSON.stringify([...new FormData(form)]))dirtyForms.delete(id);return result;}catch(e){if(e.status===401)location.href='/login?next=/companion';throw e;}}
async function loadAfterSave(){try{return await load();}catch(e){throw Error('已保存，页面暂未刷新；不需要重新提交，稍后刷新查看。');}}
window.addEventListener('beforeunload',e=>{if(requests.hasUncertain()||busy){e.preventDefault();e.returnValue='';}});
function say(message,error=false){$('page-status').textContent=message;$('page-status').classList.toggle('error',error);}
function tab(name){
 const choice=[...$('feature-select').options].find(x=>x.value===name);if(!choice)return;$('feature-select').value=name;const panel=['library','photos','audio','products'].includes(name)?'library':name;
 for(const n of document.querySelectorAll('.companion-tab'))n.hidden=n.id!=='tab-'+panel;
 if(panel==='library')window.PersonalLibrary.choose(name);if(name==='usage')$('usage-reload').click();
 document.body.classList.toggle('chatting',name==='chat');
 $('chat-back').hidden=name==='chat';$('companion-home').hidden=name!=='chat';
 $('companion-title').textContent=name==='chat'?'我的个人助理':choice.textContent;
 chatUI.menu(false);if(name==='chat'){chatUI.resizeInput();chatUI.scroll();}else window.scrollTo({top:0});
}
$('feature-select').onchange=e=>tab(e.target.value);
$('chat-back').onclick=()=>tab('chat');
function bubble(text,self=false,sources=[]){
 const row=el('article','','chat-message'+(self?' self':'')),avatar=el('div',self?'我':'✦','chat-avatar');
 avatar.setAttribute('aria-hidden','true');row.setAttribute('aria-label',self?'我':'个人助理');
 const content=el('div','','chat-content'),box=el('div','','chat-bubble');box.append(el('p',text));content.append(box);
 if(!self){
  const actions=el('div','','chat-message-actions'),read=el('button','朗读');read.type='button';
  read.disabled=!window.speechSynthesis||!window.SpeechSynthesisUtterance;
  read.onclick=()=>{$('reading-status').textContent='';reader.manual(text);};actions.append(read);content.append(actions);
 }
 if(sources.length){const links=el('div','','chat-sources');for(const source of sources){let u;try{u=new URL(source.href,location.origin);}catch{continue;}if(u.protocol!=='https:'&&u.origin!==location.origin)continue;const a=el('a',source.label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';if(u.origin!==location.origin)a.onclick=()=>api('/api/companion/library/open',{url:u.href,title:source.label}).then(()=>window.PersonalLibrary.refresh()).catch(e=>say('浏览记录未确认保存：'+e.message,true));links.append(a);}content.append(links);}
 row.append(avatar,content);return row;
}
const receiptCache=new Set();
function receive(ids){const unseen=ids.filter(id=>id&&!receiptCache.has(id)).slice(-40);if(!unseen.length)return;api('/api/companion/delivery/received',{ids:unseen}).then(()=>{unseen.forEach(id=>receiptCache.add(id));for(const r of data?.delivery?.items||[])if(unseen.includes(r.id)&&r.status!=='opened')r.status='received';renderDelivery();}).catch(()=>{});}
const deliveryLabel=s=>({new:'新消息',offered:'已生成',received:'已送到窗口',opened:'已点开'})[s]||'新消息';
function messages(){
 const box=$('messages'),nearEnd=box.scrollHeight-box.scrollTop-box.clientHeight<100,previous=box.scrollTop;box.replaceChildren();
 if(!data.messages.length&&!pending)box.append(bubble((data.profile.nickname||'你好')+'，我在这里。今天想聊点什么？'));
 const hiddenCount=data.screen?.hiddenCount||0;
 if(hiddenCount)box.append(button('查看收起的聊天（'+hiddenCount+'轮）',restoreScreen));
 if(hiddenCount>0&&hiddenCount===data.messages.length&&!pending)box.append(bubble('旧对话已收起，记忆和聊天记录仍保留。继续聊吧。'));
 let lastDate='';
 for(const row of data.messages.slice(hiddenCount)){
  if(row.createdAt&&Number.isFinite(Date.parse(row.createdAt))){const date=new Date(row.createdAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'});if(date!==lastDate){box.append(el('p',date,'chat-time'));lastDate=date;}}
  box.append(bubble(row.question,true),bubble(row.answer,false,row.sources));
 }
 if(pending&&!pending.sent)box.append(bubble(pending.question,true));
 receive(data.messages.slice(hiddenCount).map(r=>r.response?.deliveryId));
 if(nearEnd)chatUI.scroll();else box.scrollTop=previous;
}
function card(title,content,meta=''){const row=el('article','','record-card');row.append(el('h3',title),el('p',content));if(meta)row.append(el('p',meta,'record-meta'));return row;}
function button(label,run){const b=el('button',label);b.type='button';b.onclick=run;return b;}
function render(){
 const counts={family:data.family?.drafts?.length||0,news:data.news?.items?.filter(x=>x.deliveryStatus==='new').length||0,reminders:data.reminders?.filter(x=>!x.done&&Date.parse(x.dueAt)<=Date.now()).length||0};
 for(const option of $('feature-select').options){option.dataset.label ||=option.textContent;option.textContent=option.dataset.label+(counts[option.value]?'（'+counts[option.value]+'）':'');}
 $('feature-hint').textContent=counts.family?'有往来待确认':counts.reminders?'有提醒已到时间':counts.news?'有新关注信息':'点下方切换';
 CompanionBilling.render(data.billing);
 const p=data.profile;$('greeting').textContent=(p.nickname||'你好')+'，我在这里';$('identity').textContent=data.modelConfigured?(p.shareWithModel?'生活聊天已开启 · 结合我的记忆':'生活聊天已开启 · 单轮对话'):'个人记忆可试用 · 通用聊天待连接';
 if(!dirtyForms.has('profile-form')){for(const key of ['nickname','city','interests','routine','lifeRole','personality','priorities','resources','boundaries','replyStyle','experience'])$('profile-form').elements[key].value=p[key]||'';$('profile-form').elements.shareWithModel.checked=!!p.shareWithModel;}
 messages();$('memory-list').replaceChildren();for(const r of data.memories){const box=card(r.category,r.content,(r.opinionOnly?'亲友看法（'+r.reportedBy+'，仅供参考）':'本人陈述')+' · '+new Date(r.updatedAt||r.createdAt).toLocaleDateString('zh-CN')),actions=el('div','','record-actions');actions.append(button('修改',()=>{const f=$('memory-form');f.elements.id.value=r.id;f.elements.version.value=r.version||0;f.elements.content.value=r.content;f.elements.category.value=r.category;f.elements.sourceKind.value=r.opinionOnly?'observer':'self';f.elements.reportedBy.value=r.reportedBy||'';$('cancel-memory').hidden=false;f.elements.content.focus();}),button('删除',async()=>{if(!confirm('删除这条已保存记忆？'))return;try{await api('/api/companion/memory/remove',{id:r.id});await loadAfterSave();say('这条记忆已删除');}catch(e){say(e.message,true);}}));box.append(actions);if(r.history?.length){const history=el('details');history.append(el('summary','查看以前的记忆'));for(const old of r.history.slice().reverse())history.append(el('p',old.content,'record-meta'));box.append(history);}$('memory-list').append(box);}
 if(!data.memories.length)$('memory-list').append(el('p','还没有保存记忆。'));
 const sum=direction=>data.favors.filter(x=>x.direction===direction).reduce((n,x)=>n+x.amount,0).toFixed(2);$('favor-summary').textContent='送出 '+sum('送出')+' 元 · 收到 '+sum('收到')+' 元';
 $('favor-list').replaceChildren();for(const r of data.favors){const box=card(r.person+' · '+r.direction+' ¥'+Number(r.amount).toFixed(2),r.occasion+(r.note?'\n'+r.note:''),r.date);box.append(button('删除这笔',async()=>{if(!confirm('删除这笔个人往来记录？'))return;try{await api('/api/companion/favor/remove',{id:r.id});await loadAfterSave();}catch(e){say(e.message,true);}}));$('favor-list').append(box);}
 renderDelivery();renderReminders();renderNews();renderWechat();renderLocation();renderEmergency();window.FamilyCare.render();window.PersonalLibrary.render();
 $('family-pending').hidden=!data.family?.drafts.length;$('family-pending').textContent='确认往来（'+(data.family?.drafts.length||0)+'）';
}
function renderReminders(){if(!data)return;$('reminder-list').replaceChildren();for(const r of data.reminders){const box=card(r.title,r.done?'已完成':new Date(r.dueAt).toLocaleString('zh-CN'),!r.done&&Date.parse(r.dueAt)<=Date.now()?'已到提醒时间':'');box.classList.toggle('due',!r.done&&Date.parse(r.dueAt)<=Date.now());if(!r.done)box.append(button('已完成',async()=>{try{await api('/api/companion/reminder/complete',{id:r.id});await loadAfterSave();}catch(e){say(e.message,true);}}));$('reminder-list').append(box);}if(!data.reminders.length)$('reminder-list').append(el('p','还没有个人提醒。'));}
async function load(){const generation=++loadSequence;let next;try{next=await api('/api/companion');}catch(e){if(generation!==loadSequence)return data;throw e;}if(generation!==loadSequence)return data;if(!next.profile||!Array.isArray(next.messages))throw Error('个人助理资料未完整读取，请刷新重试。');data=next;reader.setUser(data.profile.userId||data.profile.id);render();if(!busy)$('send').disabled=false;return data;}
async function ask(question){
 if(busy||!question||!data)return;stopChatRecognition();reader.prime();busy=true;$('send').disabled=true;$('chat-input').disabled=true;chatUI.menu(false);
 if(!pending||pending.question!==question)pending={question,key:crypto.randomUUID()};
 const snapshot=pending;messages();chatUI.scroll();$('chat-status').textContent='正在回复…';
 try{
  const result=snapshot.reply||await api('/api/companion/chat',{question},snapshot.key);snapshot.reply=result;snapshot.sent=true;
  if(companionVisible)reader.answer(result.answer,snapshot.key);
  suggestion=result.memorySuggestion||'';$('pending-memory').hidden=!suggestion;$('memory-suggestion').textContent=suggestion;
  await load();receive([result.deliveryId]);pending=null;$('chat-input').value='';$('chat-status').textContent='';chatUI.scroll();
 }catch(e){$('chat-status').textContent=snapshot.sent?'已收到回复，聊天记录暂未刷新。可以重试刷新。':'发送未确认：'+e.message+'。可重试原消息。';$('chat-input').value=question;}
 finally{busy=false;$('send').disabled=false;$('chat-input').disabled=false;chatUI.resizeInput();}
}
$('chat-form').onsubmit=e=>{e.preventDefault();ask($('chat-input').value.trim());};
document.addEventListener('click',e=>{const t=e.target.closest('[data-tab]');if(t)tab(t.dataset.tab);const q=e.target.closest('[data-question]');if(q){tab('chat');$('chat-input').value=q.dataset.question;ask(q.dataset.question);}});
$('stop-reading').onclick=()=>{reader.stop();$('reading-status').textContent='自动朗读已关闭。';};
async function restoreScreen(){if(busy)return;try{await api('/api/companion/screen/restore',{});await loadAfterSave();chatUI.menu(false);say('已展开保存的聊天');}catch(e){say(e.message,true);}}
$('restore-screen').onclick=restoreScreen;
$('clear-screen').onclick=async()=>{if(busy)return;try{await api('/api/companion/screen/clear',{});await loadAfterSave();chatUI.menu(false);say('已清屏，记忆和聊天记录都保留，可恢复查看。');}catch(e){say(e.message,true);}};
$('clear-history').onclick=async()=>{if(busy)return;if(!confirm('清除聊天记录？已保存的记忆、已讲与推送记录、用量、人情账、亲情往来、收藏、照片、录音和提醒会保留。'))return;try{await api('/api/companion/history/clear',{});pending=null;suggestion='';$('pending-memory').hidden=true;await loadAfterSave();say('聊天记录已删除，已保存记忆仍保留');}catch(e){say(e.message,true);}};
for(const [id,path,build] of [
 ['profile-form','profile',f=>({...Object.fromEntries(new FormData(f)),shareWithModel:f.elements.shareWithModel.checked})],
 ['memory-form','memory',f=>({...Object.fromEntries(new FormData(f)),...(f.elements.id.value?{version:Number(f.elements.version.value)}:{})})],
 ['favor-form','favor',f=>({...Object.fromEntries(new FormData(f)),amount:Number(f.elements.amount.value)})],
 ['reminder-form','reminder',f=>({...Object.fromEntries(new FormData(f)),dueAt:new Date(f.elements.dueAt.value).toISOString()})]]){
 $(id).onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('[type=submit]');if(b.disabled)return;const draft=JSON.stringify([...new FormData(f)]);b.disabled=true;try{await api('/api/companion/'+path,build(f));if(id!=='profile-form'&&draft===JSON.stringify([...new FormData(f)])){f.reset();if(id==='memory-form')$('cancel-memory').hidden=true;}await loadAfterSave();say('已保存');}catch(err){say(err.message,true);}finally{b.disabled=false;}};
}
$('cancel-memory').onclick=()=>{$('memory-form').reset();$('cancel-memory').hidden=true;};
$('remember-suggestion').onclick=async()=>{const text=suggestion;if(!text)return;try{await api('/api/companion/memory',{content:text,category:'习惯'});suggestion='';$('pending-memory').hidden=true;await loadAfterSave();say('记住了');}catch(e){say(e.message,true);}};
$('skip-suggestion').onclick=()=>{suggestion='';$('pending-memory').hidden=true;};
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
const onPhone=window.matchMedia('(max-width:700px)').matches;
let large=false;
try{
 const ownSize=localStorage.getItem('companion-large');
 large=ownSize===null?(onPhone&&localStorage.getItem('store-mobile-text-size')==='double'):ownSize==='1';
}catch{}
function textSize(value=large,save=false){
 large=value;document.body.classList.toggle('bigger',large);
 const button=$('text-size');button.textContent=large?'字－':'字＋';
 button.setAttribute('aria-pressed',String(large));
 button.setAttribute('aria-label',large?'恢复大字':'再放大文字');
 button.title=large?'恢复大字':'再放大文字';
 chatUI.resizeInput();
 if(save)try{
  localStorage.setItem('companion-large',large?'1':'0');
  if(onPhone)localStorage.setItem('store-mobile-text-size',large?'double':'large');
 }catch{}
}
$('text-size').onclick=()=>textSize(!large,true);
window.addEventListener('storage',e=>{
 if(e.key==='companion-large')textSize(e.newValue==='1');
 else if(onPhone&&e.key==='store-mobile-text-size'&&['double','large'].includes(e.newValue))textSize(e.newValue==='double',true);
});
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||e.source!==window.parent)return;
 if(e.data?.type==='assistant:close'){companionVisible=false;stopChatRecognition();reader.cancel();window.PersonalLibrary.suspend();document.querySelectorAll('audio,video').forEach(player=>player.pause());}
 else if(e.data?.type==='assistant:open'){companionVisible=true;window.PersonalLibrary.resume();}
 else if(onPhone&&e.data?.type==='assistant:text-size'&&['double','large'].includes(e.data.value))textSize(e.data.value==='double',true);
});
window.FamilyCare.init({api,load,tab,say,data:()=>data,el,card,button});
window.PersonalLibrary.init({api,load,tab,say,data:()=>data,el,card,button});
textSize();
$('favor-form').elements.date.value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
load().then(()=>{const requested=new URLSearchParams(location.search).get('tab');if(requested&&[...$('feature-select').options].some(x=>x.value===requested))tab(requested);}).catch(e=>{say(e.message,true);document.querySelectorAll('main form').forEach(f=>f.querySelectorAll('button,input,textarea,select').forEach(x=>x.disabled=true));});
setInterval(()=>{if(!document.hidden)renderReminders();},30000);
window.addEventListener('pagehide',()=>reader.cancel());


function renderNews(){
 const news=data?.news;if(!news)return;
 const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未完成';
 const status=!news.settings.enabled?'自动搜集已暂停。':news.status==='unavailable'?'这次来源暂不可用，稍后会自动重试。':news.status==='partial'?'部分来源暂不可用，已整理能取得的近期消息。':news.status==='pending'?'等待后台第一次搜集。':'后台搜集已完成。';
 $('news-status').textContent=status+(news.checkedAt?' 最近检查：'+time(news.checkedAt):'');
 if(!dirtyForms.has('news-form')){
 const form=$('news-form');form.elements.enabled.checked=news.settings.enabled;form.elements.keywords.value=news.settings.keywords||'';form.elements.seniorFirst.checked=news.settings.seniorFirst!==false;
 $('news-categories').replaceChildren();for(const category of news.categories){const label=el('label',category.label,'check-row'),input=el('input');input.type='checkbox';input.name='categories';input.value=category.id;input.checked=news.settings.categories.includes(category.id);label.prepend(input);$('news-categories').append(label);}
 }
 const items=news.items.filter(x=>newsFilter==='all'||(newsFilter==='senior'?x.categories.some(id=>['senior','health','safety'].includes(id)):x.categories.includes(newsFilter)));
 $('news-count').textContent=(newsFilter==='senior'?'老年关注':newsFilter==='technology'?'科技前沿':'全部关注')+' · '+items.length+' 条';
 for(const b of document.querySelectorAll('[data-news-filter]'))b.setAttribute('aria-pressed',String(b.dataset.newsFilter===newsFilter));
 const list=$('news-list');list.replaceChildren();for(const item of items){const row=card(item.title,'',deliveryLabel(item.deliveryStatus)+' · '+item.source+' · 发布：'+time(item.publishedAt));const group=news.categories.filter(x=>item.categories.includes(x.id)).map(x=>x.label).join(' · ');if(group)row.append(el('p',group,'record-meta'));const link=el('a','查看原文');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.onclick=()=>Promise.all([api('/api/companion/delivery/opened',{kind:'news',id:item.id}),api('/api/companion/library/news/open',{newsId:item.id})]).then(()=>{item.deliveryStatus='opened';renderNews();window.PersonalLibrary.refresh();}).catch(e=>say('原文已打开，记录未确认保存：'+e.message,true));const save=button(data.library?.items.some(x=>x.url===item.url&&x.favorite&&!x.archived)?'已收藏':'收藏',async()=>{try{await api('/api/companion/library/news/save',{newsId:item.id});await loadAfterSave();say('已收藏，近期消息过期后仍能找到链接。');}catch(e){say(e.message,true);}});const actions=el('div','','record-actions');actions.append(link,save);row.append(actions);list.append(row);}
 if(!items.length)list.append(el('p','暂时没有匹配的近期公开消息，后台会继续搜集。'));
}
$('news-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,b=form.querySelector('[type=submit]');b.disabled=true;try{await api('/api/companion/news/settings',{enabled:form.elements.enabled.checked,seniorFirst:form.elements.seniorFirst.checked,keywords:form.elements.keywords.value,categories:[...form.querySelectorAll('input[name=categories]:checked')].map(x=>x.value)});await loadAfterSave();say('关注设置已保存');}catch(error){say(error.message,true);}finally{b.disabled=false;}};
$('news-reload').onclick=async()=>{try{await load();say('已读取后台保存的消息');}catch(error){say(error.message,true);}};

document.addEventListener('click',e=>{const b=e.target.closest('[data-news-filter]');if(b){newsFilter=b.dataset.newsFilter;renderNews();}});

function renderWechat(){
 const w=data?.wechat;if(!w)return;
 const time=t=>t?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚无';
 $('wechat-status').textContent=(w.status==='paused'?'通知试验已暂停':w.status==='waiting'?'等待电脑接收器连接':w.phase==='permission-denied'?'电脑通知权限未授权':w.status==='recent'?'最近收到接收器信号':'暂未收到新信号')+' · 最近收到内容：'+time(w.lastReceivedAt);
 if(!dirtyForms.has('wechat-form')){
 const f=$('wechat-form');f.elements.enabled.checked=w.settings.enabled;f.elements.keywords.value=w.settings.keywords||'';
 $('wechat-topics').replaceChildren();for(const t of w.topics){const l=el('label',t.label,'check-row'),i=el('input');i.type='checkbox';i.name='categories';i.value=t.id;i.checked=w.settings.categories.includes(t.id);l.prepend(i);$('wechat-topics').append(l);}
 }
 const list=$('wechat-list');list.replaceChildren();for(const item of w.items)list.append(card(item.title,item.body,'微信通知 · 未核实 · 通知时间：'+time(item.notificationAt)));
 if(!w.items.length)list.append(el('p','还没有匹配的微信通知。'));
}
$('wechat-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('[type=submit]');b.disabled=true;try{await api('/api/companion/wechat/settings',{enabled:f.elements.enabled.checked,keywords:f.elements.keywords.value,categories:[...f.querySelectorAll('input[name=categories]:checked')].map(i=>i.value)});await loadAfterSave();say('微信通知设置已保存');}catch(e){say(e.message,true);}finally{b.disabled=false;}};
$('wechat-reload').onclick=async()=>{try{await load();say('已读取收到的通知');}catch(e){say(e.message,true);}};

// Dictation only fills the draft; the user still presses Send.
const VoiceRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let chatRecognition=null;
function stopChatRecognition(){const active=chatRecognition;chatRecognition=null;$('chat-voice').textContent='语音输入';$('chat-voice').setAttribute('aria-pressed','false');try{active?.abort();}catch{}}
$('chat-voice').onclick=()=>{
 if(!companionVisible)return;
 if(!VoiceRecognition){$('chat-status').textContent='当前浏览器不支持语音转文字，可使用手机键盘上的麦克风。';return;}
 if(chatRecognition){chatRecognition.stop();return;}if(busy)return;
 reader.cancel();const recognition=new VoiceRecognition(),base=$('chat-input').value;chatRecognition=recognition;
 recognition.lang='zh-CN';recognition.interimResults=true;
 $('chat-voice').textContent='停止语音';$('chat-voice').setAttribute('aria-pressed','true');
 recognition.onresult=e=>{if(chatRecognition!==recognition||!companionVisible)return;let words='';for(let i=0;i<e.results.length;i++)words+=e.results[i][0].transcript;$('chat-input').value=(base+(base?' ':'')+words).slice(0,1500);chatUI.resizeInput();};
 recognition.onerror=()=>{if(chatRecognition!==recognition||!companionVisible)return;$('chat-status').textContent='语音暂不可用，已有文字保留，可以继续打字。';};
 recognition.onend=()=>{if(chatRecognition!==recognition)return;chatRecognition=null;$('chat-voice').textContent='语音输入';$('chat-voice').setAttribute('aria-pressed','false');};
 try{recognition.start();}catch{recognition.onend();$('chat-status').textContent='语音暂不可用，可以继续打字。';}
};
window.addEventListener('pagehide',stopChatRecognition);

function renderLocation(){
 const info=data?.location;if(!info)return;const p=info.current,box=$('location-card');box.replaceChildren();
 $('location-status').textContent=info.mapConfigured?'地图地址查询已接通。':'手机坐标可记录；街道地址查询待配置地图接口。';
 $('clear-location').disabled=!p;
 if(!p){box.append(el('p','还没有记录这次的位置。'));return;}
 box.append(el('h3',p.label),el('p',p.source),el('p','记录时间：'+new Date(p.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})));
 if(p.landmark&&p.addressResolved)box.append(el('p','附近地标：'+p.landmark));
 if(p.latitude!==null)box.append(el('p','经纬度：'+p.longitude+'，'+p.latitude),el('p','大约误差：'+p.accuracy+'米；不代表具体房间或楼层。'));
 if(p.stale)box.append(el('p','这是30分钟前的位置，使用前请重新确认。','error'));
 if(p.accuracy>1000)box.append(el('p','定位误差较大，建议补填街道或附近地标。','error'));
 const f=$('location-form');if(!f.elements.city.value)f.elements.city.value=p.city||'';
}
function locationMessage(text){$('location-status').textContent=text;}
$('location-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{await api('/api/companion/location/manual',{city:f.elements.city.value,label:f.elements.label.value,version:data.location.version});await loadAfterSave();locationMessage('已更新你填写的位置。');}catch(error){locationMessage(error.message);}finally{b.disabled=false;}};
$('clear-location').onclick=async()=>{try{await api('/api/companion/location/clear',{version:data.location.version});await loadAfterSave();$('location-form').reset();locationMessage('位置已清除。');}catch(error){locationMessage(error.message);}};
$('locate-me').onclick=async()=>{
 if(!data)return;if(!window.isSecureContext||!navigator.geolocation){locationMessage('当前环境不能定位，请用手机的安全浏览器打开，或手填具体地标。');return;}
 const b=$('locate-me');b.disabled=true;locationMessage('正在获取手机位置，请在浏览器提示中选择是否允许。');
 const revision=data.location.version;
 try{
  const result=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
  await api('/api/companion/location/gps',{latitude:result.coords.latitude,longitude:result.coords.longitude,accuracy:result.coords.accuracy,observedAt:new Date(result.timestamp).toISOString(),version:revision});
  await loadAfterSave();locationMessage(data.location.current?.addressResolved?'已更新位置。':'坐标已记录，街道地址查询待接通；可以手填附近地标。');
 }catch(error){locationMessage(error.code===1?'定位未获允许，可以手填街道或附近地标。':error.code===3?'定位超时，可以再试一次或手填地标。':error.code===2?'手机暂时无法定位，可以手填地标。':error.message||'位置未能更新，请重试。');}finally{b.disabled=false;}
};

function renderEmergency(){
 const info=data?.emergency;if(!info)return;const area=$('emergency-location');area.replaceChildren();
 const p=info.location;
 if(p){area.append(el('h3',p.stale?'上次记录的位置':'这次记录的位置'),el('p',p.label),el('p','时间：'+new Date(p.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})));
  if(p.accuracy!==null)area.append(el('p','定位误差约'+p.accuracy+'米；仍需说明楼层、门牌和入口。'));
  if(p.stale)area.append(el('p','已超过30分钟，请向接线员说明实际当前位置。','error'));
  if(!p.addressResolved&&p.latitude!==null)area.append(el('p','只有经纬度，街道地址尚未取得；向接线员报你看得到的路牌或地标。','error'));
 }else area.append(el('p','未记录具体位置。拨通后请直接向接线员报告实际地址或附近地标。'));
 const list=$('emergency-contacts');list.replaceChildren();
 for(const person of info.contacts){const a=el('a','拨打 '+person.name+(person.relationship?'（'+person.relationship+'）':''),'emergency-contact');a.href='tel:'+person.phone;list.append(a);}
 if(!info.contacts.length)list.append(el('p','还未设置联系人，可在下面添加。'));
 const card=$('emergency-card');card.replaceChildren(el('h3',info.name),el('p','联系电话：'+(info.phone||'未填写')),el('p','接应说明：'+(info.accessNote||'未填写')),el('p','需告知医生：'+(info.medicalNote||'未填写')));
 if(!dirtyForms.has('emergency-form')){
 const f=$('emergency-form');for(const key of ['name','phone','accessNote','medicalNote'])f.elements[key].value=info[key]||'';
 const fields=$('emergency-contact-fields');fields.replaceChildren();
 for(let i=0;i<3;i++){const person=info.contacts[i]||{},group=el('fieldset');group.append(el('legend','联系人 '+(i+1)));for(const [key,label] of [['name','姓名'],['relationship','关系'],['phone','电话']]){const l=el('label',label),input=el('input');input.name='contact-'+i+'-'+key;input.maxLength=key==='phone'?30:40;if(key==='phone')input.type='tel';input.value=person[key]||'';l.append(input);group.append(l);}fields.append(group);}
 }
}
$('emergency-form').onsubmit=async e=>{
 e.preventDefault();const f=e.currentTarget,b=f.querySelector('[type=submit]');b.disabled=true;
 const contacts=[];for(let i=0;i<3;i++){const person=Object.fromEntries(['name','relationship','phone'].map(key=>[key,f.elements['contact-'+i+'-'+key].value.trim()]));if(Object.values(person).some(Boolean))contacts.push(person);}
 try{await api('/api/companion/emergency',{version:data.emergency.version,name:f.elements.name.value,phone:f.elements.phone.value,accessNote:f.elements.accessNote.value,medicalNote:f.elements.medicalNote.value,contacts});await loadAfterSave();$('emergency-status').textContent='急救卡与联系人已保存。';}catch(error){$('emergency-status').textContent=error.message;}finally{b.disabled=false;}
};

function renderDelivery(){const list=$('delivery-list');list.replaceChildren();if(!data?.delivery)return;list.append(el('h3','已讲与已推送记录'),el('p','按你的账号保存，清屏仍保留。已点开表示打开过内容，并不代表已读完。'));for(const r of data.delivery.items.slice(0,8))list.append(card(deliveryLabel(r.status),r.preview,new Date(r.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})));}
