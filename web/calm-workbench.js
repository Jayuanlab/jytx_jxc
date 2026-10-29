(()=>{'use strict';
 const path=location.pathname;
 if(['/companion','/kitty','/companion-admin','/sale-receipt'].includes(path))return;
 document.body.classList.add('calm-workbench');
 for(const help of document.querySelectorAll('button[data-help-target],button[data-help-all]')){if(!help.getAttribute('aria-label'))help.setAttribute('aria-label',help.textContent.trim()||'查看帮助');help.textContent='?';}
 if(path==='/receptions')document.body.classList.add('calm-receptions');
 // Collapse only explicit, static explanations. Never touch alerts, balances, or required fields.
 const helpTemplate=document.querySelector('template[data-page-help-template]');
 function compactHelp(root=document){
  for(const node of root.querySelectorAll('[data-page-explanation]')){
   if(node.dataset.calmHelp||node.closest('dialog,template')||node.id||node.hasAttribute('role')||node.querySelector('a,button,input'))continue;
   node.dataset.calmHelp='1';
   if(helpTemplate){const p=document.createElement('p');p.textContent=node.textContent;if(![...helpTemplate.content.querySelectorAll('p')].some(x=>x.textContent===p.textContent))helpTemplate.content.append(p);node.hidden=true;}
  }
 }
 compactHelp();
 if(path==='/m'){
  const action=document.querySelector('.hero-actions>a[href="/receptions"]');
  if(action)action.parentElement.prepend(action);
  const assistant=document.querySelector('.assistant-entry');
  if(assistant){const title=assistant.querySelector('strong');if(title)title.textContent='语音接待 · 工作助理';assistant.href='/receptions?assistant=1';assistant.setAttribute('aria-label','语音接待，打开工作助理');}
  const tools=document.querySelector('.home-account-tools-body'),privacy=document.querySelector('.privacy-controls');if(tools&&privacy)tools.append(privacy);
  const board=document.getElementById('home-board-slot');
  if(board){board.setAttribute('aria-label','门店电子屏与标注');board.dataset.homeFixed='1';}
 }
 if(path==='/receptions'){
  document.querySelector('.page-help-button[data-help-target="receptions-entry-help"]')?.setAttribute('aria-label','接待帮助');
  const title=document.querySelector('label:has(input[name="visitorCount"]) span');if(title)title.textContent='接待人数';
  const empty=document.getElementById('reception-phone-feedback');if(empty&&!document.querySelector('[name=phone]')?.value){empty.textContent='';empty.hidden=true;}
  // Existing detailed optional sections remain accessible, with fewer words on the working face.
  for(const legend of document.querySelectorAll('legend'))if(legend.textContent==='接待资料（可后补）')legend.textContent='接待事项';
 }
 // Deduplicate exactly matching visible explanatory text inside a single panel only.
 function dedupe(panel){
  const seen=new Set();
  for(const node of panel.querySelectorAll('.hint,.operation-tip,[data-page-explanation]')){
   if(node.hidden||node.id||node.hasAttribute('role')||node.querySelector('a,button,input')||node.closest('details,dialog'))continue;
   const key=node.textContent.replace(/\s+/g,' ').trim();
   if(key&&seen.has(key))node.hidden=true;else if(key)seen.add(key);
  }
 }
 document.querySelectorAll('main>.panel,main>.card').forEach(dedupe);
})();
