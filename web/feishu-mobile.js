const $=id=>document.getElementById(id);
if(new URLSearchParams(location.search).has("logged_out")){document.documentElement.classList.add("signed-out");document.addEventListener("DOMContentLoaded",()=>{const note=document.createElement("section");note.className="logout-notice";note.innerHTML='<h1>已退出门店进销存</h1><p>门店业务数据已退出。您可以随时使用员工账号重新登录。</p><a href="/login">用员工账号登录</a><p data-page-explanation>要关闭此页面，请使用手机浏览器的返回或关闭标签页按钮。</p>';document.querySelector(".wrap")?.prepend(note);});}
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ownerEntries(){return [...document.querySelectorAll("[data-owner-only]"),...Array.from(document.querySelectorAll("template[data-page-help-template]")).flatMap(template=>Array.from(template.content.querySelectorAll("[data-owner-only]")))];}
const ownerItems=[
  ['assistantFeedback','助理回答待纠错','/knowledge-review#answer-feedback'],
  ['assistantReports','员工情况待核实','/assistant?mode=store#report-panel'],
  ['fundTransferDispute','店内转款到账有异议','/funds'],
  ['fundTransfer','店内转款待收款人确认','/funds'],
  ['cashDispute','现金交接有异议','/cash-handover'],
  ['cashHandover','现金交接待接收人确认','/cash-handover'],
  ['salePayments','销售款待本人核对','/sale-payments'],
  ['salePaymentDisputes','销售收款有异议','/sale-payments'],
  ['procurementPaymentReview','订货待老板决定付款','/app?tab=purchase'],
  ['expenseRed','单据红冲待老板批准','/app?tab=red'],
  ['saleReturn','退换货待老板批准','/app?tab=returns#sale-return-requests'],
  ['purchaseReturn','采购退货待老板批准','/app?tab=purchase#purchase-return-requests'],
  ['catalogAddition','新增档案核对','/app?tab=purchase#catalog-reviews'],
  ['productPrice','商品调价待审核','/app?tab=products'],
  ['serialStocktake','盘点差异待核实','/stocktake'],
  ['giftApprovals','超限赠品待审批','/gift-approvals'],
  ['procurement','进行中的订货与收货','/app?tab=purchase'],
  ['dailyClose','每日扎账待老板签认','/daily-close'],
  ['dailyReview','日结待复核或修订','/daily-close'],
  ['reception','接待单待结案','/receptions'],
  ['assist','协助单待确认','/receptions'],
  ['wechat','加微信待核分','/receptions'],
  ['conversion','成交归属待判断','/receptions'],
  ['learning','学习单待审核','/learning'],
  ['dutyReview','值日照片待审核','/duties'],
  ['usedPhoneReview','二手机评估待复核','/used-phones'],
  ['workJournal','工作日志待核定','/work-journal'],
  ['closeout','交班单待核对','/close'],
  ['closeoutRevision','交班单退回待修订','/close']
];
function item(label,count,href){return '<a class="pending-item '+(count?'urgent':'')+'" href="'+href+'"><span class="pending-name">'+E(label)+'</span><span class="pending-item-action"><strong>'+count+'</strong><span class="pending-go">'+(count?'去处理 ›':'查看 ›')+'</span></span></a>';}
function setMetric(id,value){
 const node=$(id);
 node.textContent=value;
 node.closest('.stat')?.classList.toggle('wide-count',String(value??'').length>2);
}
let workbenchLoadVersion=0;
async function load(){
  const version=++workbenchLoadVersion,current=()=>version===workbenchLoadVersion;
  try{
    const response=await fetch('/api/workbench',{credentials:'same-origin',cache:'no-store'});
    if(!current())return;
    if(response.status===403){location.replace('/assistant?mode=customer');return;}
    if(!response.ok)throw new Error(response.status===401?'LOGIN':'工作台读取失败（'+response.status+'）');
    const data=await response.json();
    if(!current())return;
    window.PageHelp?.setUser({roleCode:data.owner?"owner":"employee",owner:data.owner});
    $('identity').textContent=String(data.name??'');
    const identityLabel=String(data.name??'')+' · '+(data.owner?'老板':'员工');
    $('identity').title=identityLabel;
    $('identity').setAttribute('aria-label',identityLabel);
    $('pending-label').textContent=data.owner?'待办审核':'我的待办';
    setMetric('pending-count',data.pendingCount);
    setMetric('followup-count',data.followups);
    const entries=data.owner
      ?ownerItems.map(([key,label,href])=>[label,data.reviews?.[key]||0,href])
      :[
        ['值日照片待我审核',data.dutyToReview||0,'/duties'],
        ['二手机评估待我复核',data.usedPhoneToReview||0,'/used-phones'],
        ['工作积分待我核定',data.workToReview||0,'/work-journal'],
        ['问答纠错待我审核',data.feedbackToReview||0,'/knowledge-review#answer-feedback'],
        ['学习单待我审核',data.learningToReview||0,'/learning'],
        ['超限赠品待我审批',data.giftApprovalsToReview||0,'/gift-approvals'],
        ['销售款待我核对',data.salePaymentsToConfirm||0,'/sale-payments'],
        ['我开的销售单收款有异议',data.ownPaymentDisputes||0,'/sale-payments'],
        ['待我确认店内转款',data.transferToConfirm||0,'/funds'],
        ['待我确认现金交接',data.cashToConfirm||0,'/cash-handover'],
        ['待我验收的订货',data.assignedPlans||0,'/app?tab=purchase'],
        ['到期回访',data.followups||0,'/receptions'],
        ['学习单待老板审核',data.unreviewedLearning||0,'/learning'],
        ['工作日志待核定',data.unreviewedWork||0,'/work-journal'],
        ['进行中接待',data.openReceptions||0,'/receptions']
      ];
    const active=entries.filter(([,count])=>count>0), rest=entries.filter(([,count])=>!(count>0));
    pendingTotal=Number(data.pendingCount)||0;updatePendingSummary();
    $('pending-list').innerHTML=(active.length?active.map(row=>item(...row)).join(''):'<p class="muted">暂无待办。</p>')
      +(rest.length?'<details class="pending-rest"><summary>查看无待办的项目</summary><div class="pending-list">'+rest.map(row=>item(...row)).join('')+'</div></details>':'');
    for(const card of ownerEntries())card.hidden=!data.owner;
    for(const card of document.querySelectorAll('[data-capability]'))card.hidden=!data.capabilities?.[card.dataset.capability];
    for(const card of document.querySelectorAll('[data-any-capability]'))card.hidden=!card.dataset.anyCapability.split(',').some(key=>data.capabilities?.[key]);
    if(data.owner){
      try{const n=await fetch("/api/local-notices",{credentials:"same-origin",cache:"no-store"});if(!current())return;if(n.ok){const v=await n.json();if(current())setMetric('notice-count',v.unread);}else $('notice-count').textContent='暂未更新';}
      catch{if(current())$('notice-count').textContent='暂未更新';}
    }
  }catch(error){
    if(!current())return;
    $('identity').textContent=error.message==='LOGIN'?'请先登录':'加载失败';
    $('identity').title=$('identity').textContent;
    $('identity').setAttribute('aria-label',$('identity').textContent);
    $('pending-list').innerHTML=error.message==='LOGIN'
      ?'<p class="muted">请先使用员工账号登录，查看你有权限处理的单据。 <a href="/login">去登录 →</a></p>'
      :'<p class="muted">'+E(error.message)+'，请点“刷新”重试。</p>';
    for(const card of ownerEntries())card.hidden=true;
  }
}
let pendingTotal=0;
function updatePendingSummary(){$('pending-summary').textContent=($('pending-details').open?'收起待办明细':'查看待办明细')+(pendingTotal>0?'（'+pendingTotal+'）':'');}
$('pending-details').addEventListener('toggle',updatePendingSummary);
$('pending-clear').addEventListener('click',()=>{
 $('pending-details').open=false;
 for(const detail of $('pending-list').querySelectorAll('details'))detail.open=false;
 $('pending-screen-status').textContent='已收起，待办记录保留。';updatePendingSummary();
 $('pending').scrollIntoView({block:'start'});$('pending-clear').focus({preventScroll:true});
});
$('refresh').addEventListener('click',()=>{$('pending-screen-status').textContent='';load();});
addEventListener('pageshow',event=>{if(event.persisted)load();});
load();






// 同一份模块内容在电脑折叠区和手机弹窗之间移动，保留账号权限与链接。
(()=>{
  const phone=matchMedia('(max-width:700px)'),dialog=$('module-dialog'),body=$('module-dialog-body');
  let active=null,fromHistory=false;
  function close(){if(dialog.open)dialog.close();}
  dialog.addEventListener('close',()=>{
    if(!active)return;
    const {module,content,summary}=active;
    module.append(content);
    summary.setAttribute('aria-expanded',String(module.open));
    active=null;
    document.body.classList.remove('home-dialog-open');
    if(!fromHistory&&history.state?.homeModule===module.id)history.back();
    fromHistory=false;
    summary.focus({preventScroll:true});
  });
  $('module-dialog-close').addEventListener('click',close);
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();
  });
  addEventListener('popstate',event=>{
    if(active&&event.state?.homeModule!==active.module.id){fromHistory=true;close();}
  });
  for(const module of document.querySelectorAll('[data-module]')){
    const summary=module.querySelector('summary'),content=module.querySelector('.module-content');
    summary.addEventListener('click',event=>{
      if(!phone.matches||typeof dialog.showModal!=='function')return;
      event.preventDefault();
      if(active)return;
      $('module-dialog-title').textContent=summary.querySelector('.module-label').textContent;
      active={module,content,summary};
      body.append(content);
      dialog.showModal();
      body.scrollTop=0;
      summary.setAttribute('aria-expanded','true');
      document.body.classList.add('home-dialog-open');
      history.pushState({...history.state,homeModule:module.id},'',location.href);
      $('module-dialog-title').focus();
    });
  }
  phone.addEventListener('change',close);
})();


// 待办单独打开，沿用原列表、单据链接和权限，不把工作台菜单放进窗口。
(()=>{
 const dialog=$('pending-dialog'),body=$('pending-dialog-body'),section=$('pending'),shortcut=$('pending-shortcut');
 const placeholder=document.createComment('待办原位置');section.before(placeholder);
 let moved=false,fromHistory=false,panelState=null;
 function open(recordHistory=true){
  if(dialog.open)return;
  $('pending-screen-status').textContent='';$('pending-details').open=true;updatePendingSummary();
  if(typeof dialog.showModal!=='function'){section.scrollIntoView({block:'start'});return;}
  $('pending-dialog-title').textContent=$('pending-label').textContent;
  body.append(section);moved=true;
  dialog.showModal();body.scrollTop=0;
  shortcut.setAttribute('aria-expanded','true');
  document.body.classList.add('home-dialog-open');
  panelState=recordHistory?crypto.randomUUID():null;
  if(recordHistory)history.pushState({...history.state,pendingPanel:panelState},'',location.href);
  $('pending-dialog-title').focus();
 }
 shortcut.addEventListener('click',event=>{event.preventDefault();open();});
 $('pending-dialog-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{
  if(!moved)return;
  placeholder.after(section);moved=false;
  $('pending-details').open=false;updatePendingSummary();
  shortcut.setAttribute('aria-expanded','false');
  if(!$('module-dialog').open)document.body.classList.remove('home-dialog-open');
  if(!fromHistory&&panelState&&history.state?.pendingPanel===panelState)history.back();
  fromHistory=false;panelState=null;
  shortcut.focus({preventScroll:true});
 });
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const rect=dialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
 });
 addEventListener('popstate',event=>{
  if(dialog.open&&event.state?.pendingPanel!==panelState){fromHistory=true;dialog.close();}
 });
 if(location.hash==='#pending')open(false);
})();
