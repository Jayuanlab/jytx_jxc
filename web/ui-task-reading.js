'use strict';
/* Presentation only: make each business page begin with its return path and name. */
(()=>{
 const path=location.pathname;
 if(path==='/app'){
  const title=document.getElementById('office-page-name'),main=document.getElementById('main');
  if(!title||!main)return;
  let last='';const update=()=>{const h=main.querySelector('.heading h1, h1');const next=h?.textContent?.trim()||'业务办理';if(next!==last){title.textContent=next;last=next;}};
  update();new MutationObserver(update).observe(main,{childList:true,subtree:true,characterData:true});return;
 }
 if(path==='/m'||path==='/login')return;
 const body=document.body,main=body.querySelector('main'),header=body.querySelector(':scope > header')||main?.querySelector(':scope > header');
 if(path==='/opening-drafts')body.classList.add('ui-opening-page');
 const names={'/air-accounts':'空充对账','/air-history':'历史空充补录','/air-recharge':'顾客现金充值','/assistant-finance':'助理对账','/batch-phone-intake':'手机整表录入','/carrier':'移动业务结算','/cash-handover':'内转资金交接单','/daily-close':'当日扎账单','/gift-approvals':'赠品审批','/payment-accounts':'收付款账户','/repair-materials':'维修与手机膜库存','/sale-payments':'销售收款核对','/sales-list':'销售清单','/statement-comparisons':'移动业务与银行流水比对','/store-wallet-funding':'门店微信充值申请','/subsidy':'国补结算台账'};
 const originalTitle=header?.querySelector('h1,strong')||body.querySelector('h1');
 const title=names[path]||originalTitle?.childNodes[0]?.textContent?.trim()||originalTitle?.textContent?.trim()||document.title.replace(/^聚友通信城?\s*[·—-]\s*/,'').split(' · ')[0].trim()||'业务办理';
 const back=document.createElement('a');back.href='/m';back.textContent='← 返回工作台';back.className='ui-task-back';
 const foldHeaderLinks=()=>{
  const sources=[...header?.querySelectorAll('a[href]')||[]];
  if(path==='/daily-close'||path==='/document-query')sources.push(...main?.querySelectorAll(':scope > a[href]')||[]);
  const links=sources.filter(a=>{
   if(a===back||a.classList.contains('ui-original-back'))return false;
   try{const url=new URL(a.href,location.href);return url.origin===location.origin&&(url.pathname!==path||url.pathname==='/m');}catch{return false;}
  });
  if(!links.length)return;
  const related=document.createElement('details');related.className='ui-header-related';
  const summary=document.createElement('summary');summary.textContent='相关入口';related.append(summary);
  const items=document.createElement('div');items.className='ui-header-related-items';links.forEach(link=>items.append(link));related.append(items);bar.append(related);
 };
 const bar=document.createElement('div');bar.className='ui-task-bar ui-root-task-bar';bar.setAttribute('role','group');bar.setAttribute('aria-label','页面位置');bar.append(back);
 const label=document.createElement('h1');label.className='ui-task-name';label.textContent=title;bar.append(label);
 const first=body.firstElementChild;body.insertBefore(bar,first);
 if(originalTitle&&!originalTitle.querySelector('button,a,input,select')){originalTitle.classList.add('ui-duplicate-title');originalTitle.setAttribute('aria-hidden','true');}
 const oldBack=[...(header?.querySelectorAll('a[href]')||[]),...body.querySelectorAll(':scope > a[href]')].filter(a=>a!==back&&a.textContent?.includes('工作台'));
 oldBack.forEach(a=>{a.classList.add('ui-original-back');a.setAttribute('aria-hidden','true');a.tabIndex=-1;});
 if(header)header.classList.add('ui-origin-header');
 foldHeaderLinks();
})();
