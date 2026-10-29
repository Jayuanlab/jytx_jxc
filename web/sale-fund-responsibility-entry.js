'use strict';
(()=>{
 if(['/app','/m'].includes(location.pathname))return;if(document.getElementById('sale-fund-responsibility-entry'))return;
 const path=location.pathname,compactHome=path==='/m'||path==='/boss-overview',strip=document.createElement('aside'),panel=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div'),detailLink=document.createElement('a'),policy=document.createElement('p'),rowsHost=document.createElement('div');
 strip.id='work-notice-strip';strip.setAttribute('aria-label','资金待交与业务对账');panel.id='sale-fund-responsibility-entry';panel.setAttribute('aria-label','销售资金待交与待核明细');summary.textContent='销售款待交 / 待核详情';body.className='fund-notice-detail';detailLink.href='/sale-fund-responsibility';detailLink.textContent='打开全部原单收款明细 ›';policy.textContent='现金须实际交来或存入公司账户并核实到账后销挂；顾客已付声明或放入抽屉不等于已交老板。';body.append(detailLink,policy,rowsHost);panel.append(summary,body);strip.append(panel);
 if(!document.getElementById('compact-work-notice-style')){const link=document.createElement('link');link.id='compact-work-notice-style';link.rel='stylesheet';link.href='/compact-work-notices.css?v=20261018-v126';document.head.append(link);}
 function mount(){
  const main=document?.querySelector('main');if(!main)return;
  if(compactHome){const workflow=document.getElementById('normal-workflow-entry');if(workflow&&workflow.parentNode!==strip){workflow.textContent='业务对账 / 付款核实 ›';strip.append(workflow);}const anchor=path==='/m'?(main.querySelector('.home-frequent')||main.querySelector('.hero-actions')||main.querySelector('.home-header')):main.querySelector('#content .boss-quick')||main.querySelector('.page-head');if(anchor&&anchor.nextElementSibling!==strip)anchor.after(strip);else if(!anchor&&strip.parentNode!==main)main.append(strip);
  }else if(strip.parentNode!==main)main.prepend(strip);
 }
 mount();const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});addEventListener('pagehide',()=>observer.disconnect(),{once:true});
 const M=n=>Number(n||0).toFixed(2);
 let loaded=false,loading=false;function loadDetails(){if(loaded||loading||!panel.open)return;loading=true;rowsHost.textContent='正在查询原单…';
 fetch('/api/sale-fund-responsibility',{credentials:'same-origin',cache:'no-store'}).then(async response=>response.ok?response.json():null).then(view=>{
  if(!view)throw Error('未能读取');loaded=true;rowsHost.textContent='';const rows=view.owner?view.rows:view.rows.filter(r=>r.operatorId===view.userId),cash=rows.reduce((n,r)=>n+Number(r.cashPendingAmount||0),0),noncash=rows.reduce((n,r)=>n+Number(r.noncashPendingAmount||0),0),unknown=rows.filter(r=>r.pendingAmount==null).length;
  const cashLine=document.createElement('span'),otherLine=document.createElement('span');cashLine.textContent=(view.owner?'员工':'本人')+'现金待交 ¥'+M(cash);otherLine.textContent='非现金待核 ¥'+M(noncash);summary.replaceChildren(cashLine,otherLine);if(unknown){const unknownLine=document.createElement('span');unknownLine.textContent=unknown+'笔金额待核';summary.append(unknownLine);}summary.setAttribute('aria-label',summary.textContent+'，展开查看原单逐笔明细');
  for(const r of rows.filter(r=>r.pendingAmount>0||r.pendingAmount==null)){const line=document.createElement('p'),a=document.createElement('a');a.href=r.href;a.textContent=(view.owner?r.operator+' · ':'')+r.displayNo+' · '+r.channel+' · '+(r.pendingAmount==null?'金额待核':'¥'+M(r.pendingAmount))+' · '+r.statusLabel;line.append(a);rowsHost.append(line);}
  if(!rowsHost.children.length){const empty=document.createElement('p');empty.textContent='当前范围没有待交待核的原销售分笔。';rowsHost.append(empty);}mount();
 }).catch(()=>{rowsHost.textContent='查询未成功，请收起后重新展开重试。';}).finally(()=>{loading=false;});}panel.addEventListener('toggle',loadDetails);if(panel.open)loadDetails();
})();
