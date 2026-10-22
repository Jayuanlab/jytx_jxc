/* Explicit, opt-in page help. Business forms, status and evidence stay on the page. */
(()=>{'use strict';
 let dialog=null,returnFocus=null,currentUser=null,scanQueued=false,dialogCustomerMode=false;
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;};
 function user(){if(currentUser)return currentUser;try{if(typeof me!=='undefined'&&me)return me;}catch{}try{if(typeof state!=='undefined'&&state?.user)return state.user;}catch{}return null;}
 function customerMode(){const u=user();if(u?.assistantCustomerOnly||u?.roleCode==='customer-assistant')return true;try{return typeof assistantMode!=='undefined'&&assistantMode==='customer';}catch{return false;}}
 function allowed(node){const u=user();if(node.closest('[data-owner-only]')&&u?.roleCode!=='owner')return false;if(node.closest('[data-store-only]')&&customerMode())return false;return true;}
 function clean(fragment){for(const node of fragment.querySelectorAll('script,style,iframe,form,input,select,textarea,video,button'))node.remove();for(const node of fragment.querySelectorAll('[data-owner-only],[data-store-only]'))if(!allowed(node))node.remove();for(const node of fragment.querySelectorAll('[id]'))node.removeAttribute('id');return fragment;}
 function label(node){return node.getAttribute('data-page-help-template')||node.getAttribute('data-help-title')||node.closest('section,fieldset,.card,.field')?.querySelector('h2,h3,legend,label')?.textContent||'操作说明';}
 function collect(){
  const rows=[];
  for(const template of document.querySelectorAll('template[data-page-help-template]'))if(allowed(template))rows.push({title:label(template),fragment:clean(template.content.cloneNode(true))});
  for(const node of document.querySelectorAll('[data-page-explanation]')){
   if(!allowed(node)||!node.hidden||!node.textContent.trim()||node.closest('template'))continue;
   const copy=node.cloneNode(true);copy.removeAttribute('hidden');copy.removeAttribute('data-page-explanation');copy.classList.remove('page-help-hidden');copy.querySelectorAll('.page-help-button').forEach(n=>n.remove());
   const fragment=document.createDocumentFragment();fragment.append(copy);rows.push({title:label(node),fragment:clean(fragment)});
  }
  return rows;
 }
 function close(){const old=dialog;if(!old)return;if(old.open)old.close();finish(old);}
 function finish(old){if(old!==dialog)return;dialog=null;old?.remove();document.body.classList.remove('page-help-open');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
 function open(target,trigger){
  close();returnFocus=trigger||document.activeElement;dialogCustomerMode=customerMode();
  const rows=target?(()=>{const source=document.getElementById(target);if(!source||!allowed(source))return [];if(source.tagName==='TEMPLATE')return [{title:label(source),fragment:clean(source.content.cloneNode(true))}];return collect().filter(row=>row.title===label(source));})():collect();
  dialog=el('dialog','page-help-dialog');dialog.id='page-help-dialog';dialog.setAttribute('aria-labelledby','page-help-title');
  const header=el('header','page-help-header'),title=el('h2','',target&&rows[0]?rows[0].title:'页面帮助');title.id='page-help-title';const exit=el('button','page-help-close','关闭');exit.type='button';exit.setAttribute('aria-label','关闭帮助');exit.onclick=close;header.append(title,exit);
  const body=el('div','page-help-content');
  if(!rows.length)body.append(el('p','','按页面顺序填写，标有“必填”的项目需要填写；核对后提交。提交结果会显示在页面上。'));
  const seen=new Set();for(const row of rows){const signature=row.title+'\n'+row.fragment.textContent.trim();if(!row.fragment.textContent.trim()||seen.has(signature))continue;seen.add(signature);const section=el('section','page-help-section');if(!target)section.append(el('h3','',row.title));section.append(row.fragment);body.append(section);}
  dialog.append(header,body);document.body.append(dialog);document.body.classList.add('page-help-open');
  const opened=dialog;dialog.addEventListener('close',()=>finish(opened),{once:true});dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}});
  if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}
  exit.focus({preventScroll:true});
 }
 function scan(){
  scanQueued=false;
  for(const node of document.querySelectorAll('[data-page-explanation]')){
   // An incorrectly marked financial state or input remains visible.
   if(node.matches('[role="alert"],[role="status"],[aria-live]')||node.querySelector('input,select,textarea,form,button,[role="alert"],[role="status"],[aria-live]'))continue;
   node.hidden=true;node.classList.add('page-help-hidden');
  }
  if(dialog&&dialogCustomerMode!==customerMode())close();
  const auto=[...document.querySelectorAll('.page-help-global')];
  const existing=document.querySelector('[data-help-all]:not(.page-help-global):not([data-modal-help])');
  if(existing){auto.forEach(node=>node.remove());return;}
  const heading=document.querySelector('main h1,.heading h1,.hero h1,h1');
  const titleHelp=heading?.parentElement.querySelector(':scope > [data-help-target]');
  if(titleHelp){titleHelp.removeAttribute('data-help-target');titleHelp.setAttribute('data-help-all','');titleHelp.setAttribute('aria-haspopup','dialog');auto.forEach(node=>node.remove());return;}
  const button=auto.shift()||el('button','page-help-button page-help-global','? 帮助');auto.forEach(node=>node.remove());button.type='button';button.setAttribute('data-help-all','');button.setAttribute('aria-haspopup','dialog');
  if(heading){let parent=heading.parentElement;if(!parent.classList.contains('page-title-with-help')){const wrap=el('div','page-title-with-help');heading.before(wrap);wrap.append(heading);parent=wrap;}button.classList.remove('page-help-floating');if(button.previousElementSibling!==heading)heading.after(button);}else if(!button.isConnected){button.classList.add('page-help-floating');document.body.append(button);}
 }
 function schedule(){if(scanQueued)return;scanQueued=true;queueMicrotask(scan);}
 document.addEventListener('click',event=>{const button=event.target.closest('[data-help-target],[data-help-all]');if(!button)return;event.preventDefault();open(button.getAttribute('data-help-target'),button);});
 document.addEventListener('keydown',event=>{if(!dialog)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}else if(event.key==='Tab'&&!dialog.open){const list=[...dialog.querySelectorAll('button,a[href],[tabindex="0"]')],first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}},true);
 const boot=()=>{scan();new MutationObserver(records=>{if(records.some(row=>row.type==='childList'))schedule();}).observe(document.body,{childList:true,subtree:true});};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
 window.PageHelp={open,close,refresh:scan,setUser(value){currentUser=value;scan();}};
})();
