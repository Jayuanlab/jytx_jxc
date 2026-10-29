(function(){'use strict';
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function card(row){
  if(!row||typeof(row.actionHref||row.href)!=='string')return '';let url;try{url=new URL(row.actionHref||row.href,location.origin);}catch{return '';}
  const id=url.searchParams.get('id');if(url.origin!==location.origin||url.pathname!=='/supplier-exchanges'||!/^SX-[a-z0-9-]{1,100}$/i.test(id||'')||row.id!==id)return '';
  const src='/supplier-exchanges?id='+encodeURIComponent(id)+'&embedded=pending';
  return '<section class="pending-original" data-original-id="'+E(id)+'"><p class="original-load-state" role="status">正在读取换货原单…</p><iframe class="pending-original-frame" title="供货商换货单 '+E(row.documentNo||id)+'" src="'+E(src)+'"></iframe><button class="original-retry" type="button" hidden>重新读取原单</button></section>';
 }
 function mount(onUpdated){
  function bind(){for(const frame of document.querySelectorAll('.pending-original-frame')){if(frame.dataset.originalBound)continue;frame.dataset.originalBound='1';const host=frame.closest('.pending-original'),state=host.querySelector('.original-load-state'),retry=host.querySelector('.original-retry');retry.onclick=()=>{state.hidden=false;state.textContent='正在重新读取原单…';retry.hidden=true;frame.src=frame.getAttribute('src');};frame.addEventListener('load',()=>{try{if(frame.contentWindow.location.pathname==='/login'){state.hidden=false;state.textContent='登录已失效，请返回工作台重新登录后读取原单。';retry.hidden=false;}}catch{state.hidden=false;state.textContent='原单未能读取，请重新读取。';retry.hidden=false;}});}}
  new MutationObserver(bind).observe(document.body,{childList:true,subtree:true});bind();
  window.addEventListener('message',event=>{
   const message=event.data;if(event.origin!==location.origin||!message||message.type!=='erp-original-document')return;
   const frame=[...document.querySelectorAll('.pending-original-frame')].find(f=>f.contentWindow===event.source&&f.closest('.pending-original').dataset.originalId===message.documentId);if(!frame)return;
   const host=frame.closest('.pending-original'),state=host.querySelector('.original-load-state'),retry=host.querySelector('.original-retry');
   if(message.action==='resize'){const height=Number(message.height);if(Number.isFinite(height))frame.style.height=Math.min(16000,Math.max(220,Math.ceil(height)))+'px';if(message.ready){state.hidden=true;retry.hidden=true;}else if(typeof message.error==='string'&&message.error){state.hidden=false;state.textContent=message.error;retry.hidden=false;}}
   if(message.action==='updated')Promise.resolve(onUpdated?.()).catch(()=>{state.hidden=false;state.textContent='原单已办理，待办未能刷新，请点待办页的“刷新”核对。';});
  });
 }
 window.StoreOriginalPending={card,mount};
})();

'use strict';
const $=id=>document.getElementById(id);
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥'+Number(n||0).toFixed(2);
const link=href=>typeof href==='string'&&href.startsWith('/')&&!href.startsWith('//')&&!href.includes('\\')?href:'/m';
let rendered=false;
const moduleGroups=[["销售业务",[["销售开单","/app?tab=sales"],["销售清单","/sales-list"],["销售单查询","/app?tab=orders"],["销售收款核对","/sale-payments"],["退换货","/app?tab=returns"],["赠品审批","/gift-approvals"],["单据红包","/order-red-packets"]]],["进货库存",[["库存查询","/app?tab=inventory"],["商品树与商品档案","/app?tab=products"],["订货与入库","/app?tab=purchase"],["进货单查询","/app?tab=purchase-query"],["库存盘点","/stocktake"],["维修与手机膜","/repair-materials"],["扫码与标签","/qr"],["综合查询","/search"],["数字巡检","/brain"]]],["资金与对账",[["财务中心","/funds"],["移动与银行流水比对","/statement-comparisons"],["资金结算与对账","/app?tab=finance"],["收款单","/app?tab=receipts"],["门店付款单","/business-reconciliation?section=payments&entry=paid"],["付款单查询","/app?tab=payments"],["单据红冲","/app?tab=red"],["现金交接","/cash-handover"],["当日扎账单","/daily-close"],["历史当日扎账查询","/daily-close?view=history"],["经营日报","/app?tab=reports"]]],["移动与平台",[["移动业务","/carrier"],["顾客现金充值","/air-recharge"],["空充boss","/air-accounts"],["国补台账","/subsidy"],["号卡佣金","/app?tab=cards"]]],["归口管理与门店",[["人事与考勤","/personnel"],["工资管理","/app?tab=payroll&view=manage"],["工资明细","/app?tab=payroll&view=details"],["员工与权限","/app?tab=staff"],["基础资料","/master-data"],["收付款账户","/payment-accounts"],["门店管理","/organization"],["工作日志与积分","/work-journal"],["软件学习天地","/learning"],["业务知识与销售技巧","/knowledge"],["知识审核","/knowledge-review"],["电子屏设置","/m?panel=electronic-screen"],["门店消息","/notices"],["操作日志","/app?tab=logs"],["备份与恢复","/app?tab=backup"],["期初录入确认","/opening-drafts"],["期初导入","/app?tab=opening"],["设备检查","/system-readiness"],["修改本人密码","/login#account-panel"]]]];
function moduleMenu(){const query=(document.getElementById('module-query')?.value||'').trim().toLowerCase();let count=0;const body=moduleGroups.map(([title,rows])=>{const found=rows.filter(([name])=>!query||name.toLowerCase().includes(query));count+=found.length;return found.length?'<details class="business-group"'+(query?' open':'')+'><summary>'+E(title)+'<small>'+found.length+' 项</small></summary><div class="business-links">'+found.map(([name,href])=>'<a href="'+E(href)+'">'+E(name)+'<span aria-hidden="true">›</span></a>').join('')+'</div></details>':'';}).join('');return body||'<p>没有匹配的模块，请换一个名称。</p>';}
function operations(d){const values=d.operations?.summary,stock=d.stock||{},metric=(name,v,href,moneyValue=true)=>'<a href="'+E(href)+'"><small>'+E(name)+'</small><strong>'+(v==null?'待核对':moneyValue?E(money(v)):E(v))+'</strong></a>';const body=(values?'<div class="operation-numbers">'+metric('销售收款',values.receivedAmount,'/app?tab=receipts')+metric('退款支出',values.refundAmount,'/app?tab=returns')+metric('调整后毛利',values.adjustedGrossProfit,'/app?tab=reports')+metric('门店费用',values.expenseAmount,'/app?tab=payments')+'</div>':'<p>'+E(d.operations?.error||'经营汇总暂未读到')+'</p>')+'<div class="operation-numbers">'+metric('账面库存件数',stock.quantity,'/app?tab=inventory',false)+metric('有库存商品款数',stock.products,'/app?tab=inventory',false)+'</div><p class="detail-foot">收款、退款与费用按原资金流水统计；库存为当前账面数量。</p>';return fold('operating-summary','资金与库存总览',body,null,rendered&&document.getElementById('operating-summary')?.open);}
function decisions(d){const items=(d.tasks||[]).slice(0,4).map(t=>'<a href="#urgent" data-boss-urgent>'+E(t.label)+' '+E(t.count)+'件</a>').join('');return '<details id="boss-decisions" data-layout-section class="boss-decision panel-fold"'+(!rendered||document.getElementById('boss-decisions')?.open?' open':'')+'><summary>老板决定</summary><div class="fold-body"><div class="boss-decision-head"><h2>老板决定</h2><button type="button" id="boss-decision-assign" class="bw-assign-button">＋ 安排工作</button></div><p>'+(items?'这些事项需要您拍板，点击后逐单决定。':'当前没有待拍板单据，可按经营情况安排工作。')+'</p><div class="boss-decision-links">'+items+'<a href="/personnel">人员与排班</a><a href="/app?tab=products">商品与价格</a><a href="/funds">资金安排</a></div><p id="boss-work-summary">正在读取工作安排…</p></div></details>';}
function menuSection(){return '<details class="business-center panel-fold" id="business-modules"'+(!rendered||document.getElementById('business-modules')?.open?' open':'')+'><summary>业务与管理</summary><div class="fold-body"><div class="business-heading"><h2>业务与管理</h2><a href="/master-data">＋ 基础资料</a></div><label class="module-search">查找模块<input id="module-query" type="search" placeholder="如：库存、工资、往来" autocomplete="off"></label><div id="module-menu">'+moduleMenu()+'</div></div></details>';}

let currentStaffing=null;
const focusParams=new URLSearchParams(location.search);
const focusTaskKey=focusParams.get('task'),focusTaskId=focusParams.get('id');
const focusTaskModule=link(focusParams.get('module'));
let lastOverviewLoadStartedAt=0;
const staffRecordId=row=>row.documentId||row.documentNo;
const staffHref=row=>row.kind==='salePayments'?'/sale-payments?order='+encodeURIComponent(staffRecordId(row))+(row.partId?'&part='+encodeURIComponent(row.partId):''):row.kind==='procurement'?'/app?tab=purchase&q='+encodeURIComponent(staffRecordId(row))+'&focusPlan='+encodeURIComponent(staffRecordId(row)):row.kind==='followup'?'/receptions?pendingFollowup=1&highlight='+encodeURIComponent(staffRecordId(row)):link(row.href);
const staffNext=row=>row.kind==='salePayments'?(row.label.includes('经办人')?'经办人核实顾客付款，再推实际收款人':'实际收款人确认到账'):row.kind==='procurement'?'按这张订货单收货与验收':row.kind==='followup'?'回访顾客并补记结果':row.kind==='cashHandover'?'实际接收人核对现金':row.kind==='fundTransfer'?'实际收款人确认到账':'按这张原单处理';
const originalTaskItem=x=>window.StoreOriginalPending.card(x)||'<article class="task-detail"><strong>'+E(x.label)+'</strong><small>'+E(x.sub)+'</small><small>处理人：'+E(x.handler||'老板本人')+' · 下一步：'+E(x.nextStep||'核对原单')+'</small><a href="'+E(link(x.href))+'">'+E(x.nextStep||'处理这一单')+' <span aria-hidden="true">›</span></a></article>';
function task(row){
 const head='<span>'+E(row.label)+'<small>'+(row.priority===0?'请优先核对':row.priority===1?'今日优先':'按原单核对')+'</small></span><b>'+E(row.count)+' 件</b>';
 if(!row.items?.length)return '<a class="task" href="'+E(link(row.href))+'">'+head+'<span aria-hidden="true">›</span></a>';
 return '<details class="task-group"'+(row.key==='supplierExchangeReview'?' open':'')+'><summary class="task">'+head+'<span aria-hidden="true">⌄</span></summary>'+row.items.map(originalTaskItem).join('')+'</details>';
}
function fold(id,title,body,count,open){return '<details class="panel-fold" id="'+E(id)+'"'+(open?' open':'')+'><summary><span class="fold-title">'+E(title)+'</span><span class="fold-side">'+(count==null?'':E(count)+' 条')+' <span class="fold-arrow" aria-hidden="true">⌄</span></span></summary><div class="fold-body">'+body+'</div></details>'}

const attendanceKinds={working:['正在上班','今天已签到、未签退且没有正在外勤的人员'],fieldwork:['正在外勤','今天已签到、未签退且有未结束外勤的人员'],leave:['当前请休假','当前时刻处于已批准请假或休假的人员'],present:['今日已签到','今天至少有一次签到记录的人员'],all:['出勤情况','全部在职人员；未见签到不代表缺勤']};
const clock=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?new Date(n).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}):'时间待核对'};
const when=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'时间待核对'};
function attendanceDetail(row){
 const shifts=(row.shifts||[]).map(shift=>'<div>签到 '+E(clock(shift.checkInAt))+' · '+(shift.checkOutAt?'签退 '+E(clock(shift.checkOutAt)):'尚未签退')+'</div>').join('')||'<div>今天未见签到记录</div>';
 const leave=row.onLeave?'<div>'+E(row.leaveType||'请休假')+'：'+E(when(row.leaveStartAt))+' 至 '+E(when(row.leaveEndAt))+'</div>':'';
 return '<li class="attendance-person"><div class="attendance-person-head"><strong>'+E(row.name)+'</strong><span>'+E(row.status)+'</span></div><div class="attendance-person-times">'+shifts+leave+'</div></li>';
}
function openAttendance(kind){
 const dialog=$('attendance-dialog'),title=$('attendance-dialog-title'),list=$('attendance-dialog-list'),note=$('attendance-dialog-note');
 if(!dialog||!attendanceKinds[kind]||!currentStaffing)return;
 const rows=currentStaffing.details?.[kind]||[];
 title.textContent=attendanceKinds[kind][0]+' · '+rows.length+' 人';
 note.textContent=attendanceKinds[kind][1]+'。数据截至 '+when(currentStaffing.asOf)+'。';
 list.innerHTML=rows.length?rows.map(attendanceDetail).join(''):'<li class="attendance-empty">当前没有这类记录。</li>';
 if(!dialog.open)dialog.showModal();
}

function render(d){
 const t=d.today||{},people=d.people||[],tasks=[...(d.tasks||[])].sort((a,b)=>(a.priority??9)-(b.priority??9)),batch=d.batchSuggestions||[],others=d.waitingOnOthers||[];
 const opened=new Set([...document.querySelectorAll('details.panel-fold[open]')].map(x=>x.id));
 if(focusTaskKey&&!focusTaskId){
  const group=tasks.find(x=>x.key===focusTaskKey);
  $('asof').textContent='老账套 · '+new Date(d.asOf).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})+' 更新';
  const rows=group?.items||[];
  const moduleHref=group?.href?link(group.href):focusTaskModule;
  const summary=group?'<p>'+E(group.count)+' 条待办'+(rows.length?'，逐条打开对应原单。':'，逐笔明细暂未读到，请进入原业务模块核对。')+'</p>':'<p>暂未读到这类待办的逐笔明细，请进入原业务模块核对最新状态。</p>';
  $('content').innerHTML='<section class="panel-fold" aria-label="此类待办明细"><div class="fold-body"><p><a href="/m#pending">‹ 返回待办</a></p><h2>'+E(group?.label||'待办明细暂未读到')+'</h2>'+summary+(rows.length?rows.map(originalTaskItem).join(''):'')+'<p><a href="'+E(moduleHref)+'">进入原业务模块核对 ›</a></p></div></section>';
  $('status').textContent='';rendered=true;return;
 }
 if(focusTaskKey&&focusTaskId){
  const group=tasks.find(x=>x.key===focusTaskKey),item=group?.items?.find(x=>x.id===focusTaskId);
  $('asof').textContent='老账套 · '+new Date(d.asOf).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})+' 更新';
  $('content').innerHTML=item&&window.StoreOriginalPending.card(item)?'<section class="panel-fold"><div class="fold-body">'+window.StoreOriginalPending.card(item)+'</div></section>':item?'<section class="panel-fold" aria-label="待办单笔明细"><div class="fold-body"><p><a href="/boss-overview#urgent">‹ 返回全部待办</a></p><h2>'+E(group.label)+'</h2><article class="task-detail"><strong>'+E(item.label)+'</strong><small>'+E(item.sub)+'</small><small>处理人：'+E(item.handler||'老板本人')+' · 下一步：'+E(item.nextStep||'核对原单')+'</small><a href="'+E(link(item.actionHref||item.href))+'">进入原业务模块办理 ›</a></article></div></section>':'<section class="panel-fold"><div class="fold-body"><h2>这笔待办已处理或未找到</h2><p><a href="/boss-overview#urgent">返回待办，刷新最新记录 ›</a></p></div></section>';
  $('status').textContent='';rendered=true;return;
 }
 $('asof').textContent='老账套 · '+new Date(d.asOf).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})+' 更新';
 const onDuty=d.staffing||{};currentStaffing=onDuty;
 const attendanceCards=[['working','正在上班',onDuty.workingCount||0,'店内未签退'],['fieldwork','正在外勤',onDuty.fieldworkCount||0,'外勤未结束'],['leave','当前请休假',onDuty.leaveCount||0,'已批准且此刻生效'],['present','今日已签到',onDuty.presentCount||0,'含已签退人员']].map(([kind,label,count,hint])=>'<button type="button" class="attendance-tile" data-attendance="'+kind+'" aria-haspopup="dialog"><strong>'+E(count)+'<em>人</em></strong><span>'+E(label)+'</span><small>'+E(hint)+'</small></button>').join('');
 const hero='<section class="hero" aria-label="今天的门店概况"><div class="hero-top"><span class="hero-date">'+E(d.date)+'</span><span class="hero-live"><i></i>今日概况</span></div><h2>今天的门店</h2><p class="hero-attendance-lead">人员情况 · 点击人数查看姓名和打卡时间</p><div class="attendance-grid">'+attendanceCards+'</div><button type="button" class="attendance-all" data-attendance="all" aria-haspopup="dialog">查看全部人员出勤情况 <span aria-hidden="true">›</span></button><p class="hero-caption">先看经营，再按需要展开具体工作。</p><div class="hero-numbers"><div><strong>'+E(t.saleCount)+'<em>张</em></strong><span>交易销售单</span></div><div><strong>'+E(t.mobileCount)+'<em>笔</em></strong><span>移动业务</span></div></div><div class="hero-foot"><span>净登记销售 <strong>'+E(money(t.netSalesAmount))+'</strong></span><span>预计移动酬金 <strong>'+E(money(t.expectedReward))+'</strong></span></div></section>';
 const attendanceDialog='<dialog id="attendance-dialog" class="attendance-dialog" aria-labelledby="attendance-dialog-title"><div class="attendance-dialog-head"><div><h2 id="attendance-dialog-title">出勤情况</h2><p id="attendance-dialog-note"></p></div><button type="button" data-close-attendance aria-label="关闭出勤明细">关闭</button></div><ul id="attendance-dialog-list"></ul><p class="attendance-dialog-foot">未见签到只能说明没有打卡记录；如打卡与已批准假期重叠，请到 <a href="/personnel">人事管理</a> 核对。</p></dialog>';
 const urgent=fold('urgent','待我优先处理',tasks.length?tasks.map(task).join(''):'<p class="empty">目前没有待您处理的记录。</p>',d.pendingCount,rendered?opened.has('urgent'):Number(d.pendingCount)>0);
 const assigned=fold('others','营业员待处理',others.length?others.map(group=>'<details class="person-group"><summary>'+E(group.person)+' <b>'+E(group.count)+' 条</b></summary>'+group.rows.map(row=>'<a class="task" href="'+E(staffHref(row))+'"><span>'+E(row.label)+' · '+E(row.documentNo)+'<small>'+E(row.status)+(row.amount==null?'':' · '+money(row.amount))+'</small><small>下一步：'+E(staffNext(row))+'</small></span><b>查看</b></a>').join('')+'</details>').join(''):'<p class="empty">营业员目前没有待办。</p>',d.waitingOnOthersCount,rendered&&opened.has('others'));
 const batches=fold('batches','工作助理的批量建议',batch.length?batch.map(x=>'<a class="task" href="'+E(link(x.href))+'"><span>'+E(x.label)+'<small>先看原单，再确认批量处理</small></span><b>'+E(x.count)+' 件</b></a>').join(''):'<p class="empty">目前没有适合批量处理的同类事项。</p>',batch.reduce((n,x)=>n+Number(x.count||0),0),rendered&&opened.has('batches'));
 const staff='<div class="table-wrap"><table><thead><tr><th>人员</th><th>交易单</th><th>销售金额</th><th>移动业务</th><th>预计酬金</th><th>工作日志</th><th>已见签到</th></tr></thead><tbody>'+people.map(p=>'<tr><td>'+E(p.name)+'</td><td>'+E(p.salesCount)+'</td><td>'+E(money(p.salesAmount))+'</td><td>'+E(p.mobileCount)+'</td><td>'+E(money(p.expectedReward))+'</td><td>'+E(p.workJournalCount)+'</td><td>'+E(p.checkedIn?'是':'未见记录')+'</td></tr>').join('')+'</tbody></table></div><p class="detail-foot">逐单情况可问 <a href="/assistant?mode=store">工作助理</a>。</p>';
 const staffFold=fold('staff','今日营业员销售与工作',staff,people.length,rendered?opened.has('staff'):true);
 const warnings=[];if(t.missingRewardPlan)warnings.push(t.missingRewardPlan+' 笔移动业务缺少酬金计划，预计额可能不完整。');const u=d.unassigned||{};if(u.sales||u.mobile)warnings.push('经办人未归属：销售 '+(u.sales||0)+'、移动 '+(u.mobile||0)+'。');
 const notes=fold('notes','数字口径与提醒',warnings.map(x=>'<p class="warn">'+E(x)+'</p>').join('')+'<ul>'+(d.notes||[]).map(x=>'<li>'+E(x)+'</li>').join('')+'</ul><p class="detail-foot"><a href="/boss-batch">同类待办</a> · <a href="/m#pending">全部原始待办</a> · <a href="/assistant?mode=store">工作助理</a></p>',null,rendered&&opened.has('notes'));
 const summary=fold('overview','今日经营总览',hero,null,rendered?opened.has('overview'):true);
 $('content').innerHTML='<nav class="boss-quick" aria-label="老板看台快捷入口"><button type="button" data-boss-urgent>待我处理 <b>'+E(d.pendingCount)+'</b></button><a href="#others" data-boss-others>员工待办 <b>'+E(d.waitingOnOthersCount)+'</b></a><a href="#business-modules">业务与管理</a><a href="/assistant?mode=store">工作助理</a></nav>'+summary+urgent+staffFold+operations(d)+decisions(d)+assigned+batches+notes+menuSection()+attendanceDialog;
 $('status').textContent='';rendered=true;
}
async function load(){lastOverviewLoadStartedAt=Date.now();try{$('status').textContent='正在更新门店概况…';const r=await fetch('/api/boss-overview',{credentials:'same-origin',cache:'no-store'});if(r.status===401){location.href='/login?next=/boss-overview';return}const d=await r.json();if(!r.ok)throw Error(d.error?.message||'老板看台读取失败');render(d)}catch(e){$('status').textContent=e.message;$('content').textContent='请稍后刷新，或返回工作台核对原单。'}}
$('refresh').onclick=load;
$('content').addEventListener('click',event=>{
 const urgent=event.target.closest('[data-boss-urgent],[data-boss-others]');if(urgent){const target=urgent.hasAttribute('data-boss-urgent')?$('urgent'):$('others');if(target){event.preventDefault();target.open=true;target.scrollIntoView({block:'start',behavior:'instant'});}return;}
 const open=event.target.closest('[data-attendance]');
 if(open){openAttendance(open.dataset.attendance);return}
 if(event.target.closest('[data-close-attendance]'))$('attendance-dialog')?.close();
});

$('content').addEventListener('input',event=>{if(event.target.id==='module-query')$('module-menu').innerHTML=moduleMenu();});
function refreshReturnedOverview(){
  if(document.visibilityState==='visible'&&Date.now()-lastOverviewLoadStartedAt>10_000)load();
}
document.addEventListener('visibilitychange',refreshReturnedOverview);
addEventListener('focus',refreshReturnedOverview);
setInterval(()=>{if(!document.querySelector('details.task-group[open],dialog[open]'))refreshReturnedOverview();},60_000);
addEventListener('pageshow',event=>{if(event.persisted)load();});
window.StoreOriginalPending.mount(load);
load();
