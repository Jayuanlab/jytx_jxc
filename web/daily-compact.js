(()=>{'use strict';if(location.pathname!=='/daily-close'||new URLSearchParams(location.search).has('closeout')||new URLSearchParams(location.search).has('legacyCloseout'))return;
const $=id=>document.getElementById(id),historyView=new URLSearchParams(location.search).get('view')==='history';
document.body.classList.add('settlement-clear');document.documentElement.classList.remove('settlement-layout-pending');
function reveal(node){if(!node)return;for(let p=node;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;node.scrollIntoView({block:'center',behavior:'smooth'});}
function summary(p){
 const root=$('summary');if(!root)return;const stats=root.querySelector(':scope>.daily-stats');if(!stats)return;
 const compact=document.createElement('div');compact.className='close-overview';
 for(const key of ['净销售','截至营业日已记销售收款','现金净变动','销售待核／未记收款']){const node=[...stats.children].find(n=>n.querySelector('span')?.textContent===key);if(node){const item=node.cloneNode(true);if(key==='截至营业日已记销售收款')item.querySelector('span').textContent='销售已记收款';compact.append(item);}}
 const detail=document.createElement('details');detail.className='overview-details';const title=document.createElement('summary');title.textContent='明细查询 · 经营、收付款与库存';detail.append(title,...[...root.children]);root.replaceChildren(compact,detail);
}
function metrics(){const h=$('metrics')?.querySelector('h3');if(h)h.textContent='移动BOSS · 空中充值';}
function update({preview:p,records=[],me}){
 if(historyView){$('daily-metrics-panel').hidden=true;$('air-panel').hidden=true;$('daily-summary-panel').hidden=false;const history=$('history').closest('.panel');history.hidden=false;const heading=$('daily-summary-panel').querySelector('h2');heading.textContent='历史扎账单查询';const root=$('summary');if(!root.querySelector('.history-query')){root.replaceChildren();const form=document.createElement('form');form.className='history-query';form.innerHTML='<label>开始日期<input name="from" type="date"></label><label>结束日期<input name="to" type="date"></label><label>记录类型<select name="recordType"><option value="">全部记录</option><option value="temporary">临时扎账</option><option value="formal">正式扎账</option></select></label><button type="submit">查询</button><a href="/daily-close">办理当日扎账单 ›</a><p role="status"></p>';const current=window.StoreDailyHistory.filters;form.elements.from.value=current.from||'';form.elements.to.value=current.to||'';form.elements.recordType.value=current.recordType||'';form.onsubmit=async e=>{e.preventDefault();try{await window.StoreDailyHistory.query(form.elements.from.value,form.elements.to.value,form.elements.recordType.value);form.querySelector('[role=status]').textContent='查询完成';}catch(e){form.querySelector('[role=status]').textContent=e.message;}};root.append(form);}return;}
 summary(p);metrics();$('air-panel').hidden=true;const current=records.filter(r=>r.date===p.date&&!['已被后次替代','已作废'].includes(r.status)).sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)))[0];
 $('settle-state').textContent=current?'本营业日：'+current.status+' · '+(current.displayNo||current.id):'本营业日尚未提交';$('settle-cash-link').href='/daily-cash-receipts?date='+encodeURIComponent(p.date);
 const history=$('history').closest('.panel');history.hidden=!records.length;history.classList.add('close-history');const heading=$('history-title');if(heading)heading.hidden=true;if(!$('settle-history-details')){const details=document.createElement('details');details.id='settle-history-details';details.innerHTML='<summary>复核待办与查询记录</summary>';$('history').before(details);details.append($('history'));}
 document.title=p.date+' · 当日扎账单';const h=document.querySelector('body>header strong');if(h)h.textContent='当日扎账单';
}
function onStatus(error){if(error)reveal($('status'));}
document.addEventListener('invalid',e=>{if(e.target.closest('#daily-form'))reveal(e.target);},true);
window.StoreDailyCompact={summary,metrics,update,onStatus};
if(historyView&&window.StoreDailyHistory?.ready)update({preview:null,records:typeof records!=='undefined'?records:[]});
else if(typeof preview!=='undefined'&&preview)update({preview,records:typeof records!=='undefined'?records:[]});
})();
