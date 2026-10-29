'use strict';
(()=>{
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=value=>Number.isFinite(Number(value))?Number(value):0;
  const money=value=>value==null||value===''?'金额待补':'¥'+n(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const time=value=>{if(!value)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});};
  const href=value=>{if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//'))return '';try{const url=new URL(value,location.origin);return url.origin===location.origin?url.pathname+url.search+url.hash:'';}catch{return '';}};
  const names={all:'全部明细',flows:'本人收支登记',custody:'经手门店款',transfers:'内部交接',redPackets:'红包记录'};
  const notes={all:'登记金额与实际核实结果请按原单分别查看。',flows:'这里是本人相关收付登记，登记完成仍须按原单核实真实收付。',custody:'本人经办的门店资金单独列出，不作为个人收入或手中余额。',transfers:'内部交接不重复计算营业收入；对方未确认前，请继续按原单跟进。',redPackets:'申请、核定与登记发放分别显示，发放记录以原单凭据及实际核收为准。'};
  let startDate='2026-10-28',data=null,request=0,controller=null,busy=false;
  const query=new URLSearchParams(location.search),day=today();
  let scope=query.get('scope')==='all'?'all':'day';
  let view=query.get('view')==='history'?'history':'pending',openCategory=['responsibility','confirmation','redPackets'].includes(query.get('pendingCategory'))?query.get('pendingCategory'):'all',openPeriod=['today'].includes(query.get('pendingPeriod'))?query.get('pendingPeriod'):'all';
  const initialDate=key=>validDay(query.get(key)||'')&&(scope==='all'||query.get(key)>=startDate)&&query.get(key)<=day?query.get(key):day;
  let filters={from:scope==='all'?(query.get('from')||'1970-01-01'):initialDate('from'),to:initialDate('to'),q:(query.get('q')||'').slice(0,160),category:Object.prototype.hasOwnProperty.call(names,query.get('category'))?query.get('category'):'all',offset:Math.max(0,Math.floor(n(query.get('offset'))))};
  $('mf-from').value=filters.from;$('mf-to').value=filters.to;$('mf-query').value=filters.q;$('mf-open-query').value=filters.q;$('mf-open-period').value=openPeriod;
  function limits(){for(const id of ['mf-from','mf-to']){$(id).min=scope==='all'?'1970-01-01':startDate;$(id).max=today();$(id).disabled=scope==='all';}if($('mf-start-note'))$('mf-start-note').textContent=scope==='all'?'当前查看全部历史累计；切换当日只看当天收支。':'默认只看'+startDate+'起的账；此前记录可切换全部累计查询。';}
  limits();
  function fieldError(message){$('mf-filter-error').textContent=message||'';$('mf-filter-error').hidden=!message;}
  function readFilters(){const from=$('mf-from').value,to=$('mf-to').value;if(!validDay(from)||!validDay(to)){fieldError('请选择有效的开始日期和结束日期。');return null;}if(scope!=='all'&&(from<startDate||to<startDate)){fieldError('期间明细从 '+startDate+' 起查询；此前记录请点查流水中的历史往来入口。');return null;}if(from>to){fieldError('开始日期不能晚于结束日期。');return null;}if(to>today()){fieldError('结束日期不能晚于今天。');return null;}fieldError('');return {from,to,q:$('mf-query').value.trim().slice(0,160)};}
  function setLoading(value){busy=value;$('mf-content').setAttribute('aria-busy',String(value));for(const id of ['mf-query-button','mf-open-query-button','mf-period-query-button','mf-refresh','mf-retry'])$(id).disabled=value||(scope==='all'&&id==='mf-period-query-button');$('mf-message').hidden=!value;$('mf-message').textContent=data?'正在刷新本人财务…':'正在读取本人财务，请稍候…';}
  function clearError(){$('mf-error').hidden=true;$('mf-error-text').textContent='';$('mf-login').hidden=true;$('mf-retry').hidden=false;}
  function showError(error){const status=n(error.status),restricted=status===401||status===403;$('mf-error').hidden=false;$('mf-login').hidden=status!==401;$('mf-retry').hidden=restricted;if(restricted||!data){$('mf-content').hidden=true;$('mf-person').textContent=status===401?'登录已失效':status===403?'当前账号无权查看本人财务':'本人财务暂未读到';$('mf-asof').textContent='';}const message=status===401?'请重新登录后查看本人财务。':status===403?'当前登录账号没有此页面权限，请返回工作台核对账号。':'本次读取未完成：'+(error.message||'请稍后重试')+'。';$('mf-error-text').textContent=message+(data&&!restricted?' 下方保留上次读取结果，请重新读取后再核对。':'');}
  function saveUrl(){const params=new URLSearchParams({from:filters.from,to:filters.to});if(scope==='all')params.set('scope','all');if(view==='history')params.set('view','history');if(openCategory!=='all')params.set('pendingCategory',openCategory);if(openPeriod!=='all')params.set('pendingPeriod',openPeriod);if(filters.q)params.set('q',filters.q);if(filters.category!=='all')params.set('category',filters.category);if(filters.offset)params.set('offset',String(filters.offset));history.replaceState(history.state,'',location.pathname+'?'+params);}
  const isOwner=()=>data?.viewer?.roleCode==='owner';
  const paidLabel=()=>isOwner()?'已登记发放':'老板登记已发';
  function openSummary(summary){return '<div class="mf-open-stat"><span>本人挂账</span><strong>'+money(n(summary.responsibilityAmount))+'<small>'+n(summary.responsibilityCount)+' 笔</small></strong></div><div class="mf-open-stat"><span>待确认项目</span><strong>'+n(summary.pendingConfirmationCount)+' <small>笔</small></strong></div><div class="mf-open-stat"><span>挂账金额待补</span><strong>'+n(summary.unknownResponsibilityCount)+' <small>笔</small></strong></div>';}
  function periodSummary(summary){const group=(title,values)=>'<section class="mf-period-group"><h3>'+title+'</h3><dl>'+values.map(([label,value])=>'<dt>'+label+'</dt><dd>'+money(n(value))+'</dd>').join('')+'</dl></section>';return group('本人收支登记',[['已登记收款',summary.periodRegisteredIn],['已登记付款',summary.periodRegisteredOut]])+group('经手门店款',[['经手收款',summary.periodHandledIn],['经手付款',summary.periodHandledOut]])+group('红包',[['申请待核定',summary.redPacketRequested],['已核定待发',summary.redPacketApprovedUnpaid],[paidLabel(),summary.redPacketRecordedPaid]]);}
  const dashboardKnown=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const dashboardMoney=value=>dashboardKnown(value)?money(Number(value)):'待核对';
  function renderDashboard(){
    const dashboard=data.dashboard||{},paid=dashboard.paid||{},received=dashboard.received||{},payable=dashboard.payable||{},sameDay=(data.period?.from||filters.from)===(data.period?.to||filters.to);
    const card=(kind,title,value,items,extra='')=>'<article class="mf-dashboard-card" data-kind="'+kind+'"><h3>'+title+'</h3><strong class="mf-dashboard-total" data-unknown="'+!dashboardKnown(value)+'">'+dashboardMoney(value)+'</strong><dl>'+items.map(([label,amount])=>'<dt>'+label+'</dt><dd>'+dashboardMoney(amount)+'</dd>').join('')+'</dl>'+extra+'</article>';
    const unknown=dashboardKnown(payable.unknownCount)&&Number(payable.unknownCount)>0?'<p class="mf-dashboard-unknown">另有 '+Number(payable.unknownCount)+' 笔归属／金额待核</p>':'';
    $('mf-dashboard-cards').innerHTML=card('paid',scope==='all'?'累计登记付款':sameDay?'当日登记付款':'期间登记付款',paid.amount,[['货款',paid.purchaseAmount],['红包',paid.redPacketAmount],['其他付款',paid.otherAmount]])+card('received',scope==='all'?'累计登记进账':sameDay?'当日登记进账':'期间登记进账',received.amount,[['非现金收入',received.noncashAmount],['本人确认收到的员工交款现金',received.cashHandedInAmount],['红包收款',received.rewardAmount],['其他进账',received.otherAmount]])+card('payable','当前待支付',payable.amount,[['货款',payable.purchaseAmount],['已核定待发红包',payable.redPacketAmount],['其他待付',payable.otherAmount]],unknown);
  }
  const isPacket=row=>row.category==='redPackets'||['requestedAmount','approvedAmount','paidAmount'].some(key=>row[key]!=null);
  function evidence(state){return ({recorded:'已登记实际发放，发放凭据可在原单查看。',unpaid:'尚未登记实际发放。',reversed:'关联发放费用已红冲，请打开原单核对。',evidence_missing:'发放凭据缺失，请打开原单核对。',evidence_mismatch:'发放金额或凭据不一致，请打开原单核对。'})[state]||'';}
  function record(row){
    const packet=isPacket(row),target=href(row.href),status=packet&&['已支付','已发放','已收到'].includes(row.status)?paidLabel():row.status||'状态待核对';
    const caption=row.amountLabel||(row.direction==='in'?'收款金额':row.direction==='out'?'付款金额':'金额');
    const meta=[['来源单号',row.sourceNo||row.sourceId||'原单号待核对'],['发生时间',time(row.at||row.date)||'时间待核对'],...(row.account?[['账户',row.account]]:[]),...(row.operator?[['经办人',row.operator]]:[]),...(row.relatedPerson?[['关联人员',row.relatedPerson]]:[]),...(row.sourceLabel?[['来源业务',row.sourceLabel]]:[])];
    const packetEvidence=packet?evidence(row.paymentState):'';
    return '<article class="mf-record"><div class="mf-record-top"><div class="mf-record-title"><h4>'+esc(row.label||'本人财务记录')+'</h4><span class="mf-status'+(/待|异议|差异|缺失|不一致|待补/.test(status)?' mf-status-waiting':'')+'">'+esc(status)+'</span>'+(row.opening?'<span class="mf-opening">期初未清</span>':'')+'</div><div class="mf-record-amount"><span>'+esc(caption)+'</span><strong>'+money(row.amount)+'</strong></div></div><dl class="mf-record-meta">'+meta.map(([name,value])=>'<dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>'+(packet?'<dl class="mf-packet-values"><div><dt>申请金额</dt><dd>'+money(row.requestedAmount)+'</dd></div><div><dt>核定金额</dt><dd>'+(row.approvedAmount==null?'待核定':money(row.approvedAmount))+'</dd></div><div><dt>'+paidLabel()+'</dt><dd>'+(row.paidAmount==null?'尚未登记':money(row.paidAmount))+'</dd></div></dl>':'')+(packetEvidence?'<p class="mf-packet-evidence" data-warning="'+['reversed','evidence_missing','evidence_mismatch'].includes(row.paymentState)+'">'+esc(packetEvidence)+'</p>':'')+(row.note?'<p class="mf-record-note">'+esc(row.note)+'</p>':'')+(row.nextStep?'<p class="mf-next-step"><strong>下一步：</strong>'+esc(row.nextStep)+'</p>':'')+'<div class="mf-record-action">'+(target?'<a href="'+esc(target)+'">'+esc(row.actionLabel||'查看原单')+'</a>':'<span class="mf-source-missing">原单入口待核对，请联系老板。</span>')+'</div></article>';
  }
  function pendingRecord(row){
    const packet=isPacket(row),target=href(row.href),status=packet&&['已支付','已发放','已收到'].includes(row.status)?paidLabel():row.status||'状态待核对';
    const direct=[...(row.relatedPerson?[['关联人员',row.relatedPerson]]:[]),...(row.account?[['账户',row.account]]:[])],more=[['发生时间',time(row.at||row.date)||'时间待核对'],...(row.operator?[['经办人',row.operator]]:[]),...(row.sourceLabel?[['来源业务',row.sourceLabel]]:[])];
    const packetEvidence=packet?evidence(row.paymentState):'';
    return '<article class="mf-record mf-compact-record"><div class="mf-record-top"><div class="mf-record-title"><h4>'+esc(row.sourceNo||row.sourceId||'原单号待核对')+'</h4><p class="mf-compact-label">'+esc(row.label||'本人待处理项目')+'</p><span class="mf-status mf-status-waiting">'+esc(status)+'</span>'+(row.opening?'<span class="mf-opening">期初未清</span>':'')+'</div><div class="mf-record-amount"><span>'+esc(row.amountLabel||'待处理金额')+'</span><strong>'+money(row.amount)+'</strong></div></div>'+(direct.length?'<dl class="mf-record-meta">'+direct.map(([name,value])=>'<dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>':'')+(row.nextStep?'<p class="mf-next-step"><strong>下一步：</strong>'+esc(row.nextStep)+'</p>':'')+'<details class="mf-evidence"><summary>查看说明与凭据</summary><dl class="mf-record-meta">'+more.map(([name,value])=>'<dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>'+(packet?'<dl class="mf-packet-values"><div><dt>申请金额</dt><dd>'+money(row.requestedAmount)+'</dd></div><div><dt>核定金额</dt><dd>'+(row.approvedAmount==null?'待核定':money(row.approvedAmount))+'</dd></div><div><dt>'+paidLabel()+'</dt><dd>'+(row.paidAmount==null?'尚未登记':money(row.paidAmount))+'</dd></div></dl>':'')+(packetEvidence?'<p class="mf-packet-evidence">'+esc(packetEvidence)+'</p>':'')+(row.note?'<p class="mf-record-note">'+esc(row.note)+'</p>':'')+'</details><div class="mf-record-action">'+(target?'<a href="'+esc(target)+'">'+esc(row.actionLabel||'查看原单')+'</a>':'<span class="mf-source-missing">原单入口待核对，请联系老板。</span>')+'</div></article>';
  }
  function renderOpen(){
    const all=Array.isArray(data?.openItems)?data.openItems:[],currentDay=data?.period?.today||today();
    const responsibility=row=>row.responsibilityOnly===true||/^open:(?:responsibility|cash):/.test(row.id||'');
    const rows=all.filter(row=>(openCategory==='all'||openCategory==='responsibility'&&responsibility(row)||openCategory==='redPackets'&&row.category==='redPackets'||openCategory==='confirmation'&&!responsibility(row)&&row.category!=='redPackets')&&(openPeriod==='all'||openPeriod==='today'&&row.date===currentDay||openPeriod==='opening'&&row.opening===true));
    const label=({all:'全部未处理',responsibility:'本人挂账',confirmation:'待确认',redPackets:'红包待办'})[openCategory];
    $('mf-open-label').textContent=label;$('mf-open-count').textContent=(filters.q?'当前搜索显示 ':'')+rows.length+' 笔';
    $('mf-open-list').innerHTML=rows.length?rows.map(pendingRecord).join(''):'<p class="mf-empty">'+(filters.q||openCategory!=='all'||openPeriod!=='all'?'当前条件没有未处理项目，可调整类别、范围或清除搜索。':'当前没有尚未处理／未平衡项目。已完成记录可点“查流水”查看。')+'</p>';
    for(const button of $('mf-open-categories').querySelectorAll('[data-open-category]'))button.setAttribute('aria-pressed',String(button.dataset.openCategory===openCategory));
  }
  function switchView(){
    $('mf-open-section').hidden=view!=='pending';$('mf-history-section').hidden=view!=='history';
    $('mf-warnings').hidden=view!=='pending'||!data?.warnings?.length;
    for(const button of $('mf-views').querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===view));
  }
  const list=(rows,empty)=>rows.length?rows.map(record).join(''):'<p class="mf-empty">'+esc(empty)+'</p>';
  function render(){
    const viewer=data.viewer,summary=data.summary||{},open=Array.isArray(data.openItems)?data.openItems:[],rows=Array.isArray(data.rows)?data.rows:[],total=Math.max(0,n(data.totalRows)),offset=Math.max(0,n(data.offset)),size=Math.max(1,n(data.pageSize)||30);
    const role=({owner:'老板',employee:'营业员',manager:'店长',warehouse:'仓管'})[viewer.roleCode]||'门店账号';
    $('mf-earlier-history').href='/my-finance?scope=all&view=history';for(const button of $('mf-scopes').querySelectorAll('[data-scope]'))button.setAttribute('aria-pressed',String(button.dataset.scope===scope));$('mf-open-period').options[0].textContent=scope==='all'?'全部历史未处理':'10月28日起未处理';$('mf-open-scope-note').textContent=scope==='all'?'当前查看全部历史未处理；已销清记录请查流水。':'当日视图只跟进2026-10-28起未处理项目；全部历史请切换全部累计。';$('mf-content').hidden=false;$('mf-person').textContent=(viewer.name||'本人')+' · '+role;$('mf-asof').textContent=data.asOf?'更新于 '+time(data.asOf):'';$('mf-open-query').value=filters.q;$('mf-query').value=filters.q;
    $('mf-open-summary').innerHTML=openSummary(summary);
    renderOpen();
    const from=data.period?.from||filters.from,to=data.period?.to||filters.to;$('mf-period-label').textContent=(scope==='all'?'全部累计 · ':'')+(from===to?from+' 的支付与进账':from+' 至 '+to+' 的支付与进账');renderDashboard();$('mf-period-summary').innerHTML=periodSummary(summary);
    for(const button of $('mf-categories').querySelectorAll('[data-category]'))button.setAttribute('aria-pressed',String(button.dataset.category===filters.category));
    for(const node of $('mf-categories').querySelectorAll('[data-count]'))node.textContent=String(n(data.categoryCounts?.[node.dataset.count]));
    $('mf-results-title').textContent=names[filters.category];$('mf-result-count').textContent=total+' 条';$('mf-category-note').textContent=notes[filters.category];$('mf-records').innerHTML=list(rows,'所选期间没有这一类记录。可调整日期、类别或搜索条件。');
    $('mf-pages').innerHTML=total>size?'<button type="button" data-offset="'+Math.max(0,offset-size)+'"'+(offset===0?' disabled':'')+'>上一页</button><p>第 '+(Math.floor(offset/size)+1)+' 页 / 共 '+Math.ceil(total/size)+' 页，每页 '+size+' 条</p><button type="button" data-offset="'+(offset+size)+'"'+(offset+size>=total?' disabled':'')+'>下一页</button>':'';
    const warnings=Array.isArray(data.warnings)?data.warnings:[];$('mf-warnings-title').textContent='查看 '+warnings.length+' 项核对提示与凭据';$('mf-warning-list').innerHTML=warnings.map(value=>'<li>'+esc(typeof value==='string'?value:value.message||value.note||'请打开原单核对。')+'</li>').join('');switchView();
  }
  async function load(scrollToRows=false){
    const id=++request;if(controller)controller.abort();const currentController=new AbortController();controller=currentController;const timer=setTimeout(()=>currentController.abort(),20000);clearError();setLoading(true);
    try{
      const params=new URLSearchParams({scope,from:filters.from,to:filters.to,q:filters.q,category:filters.category,offset:String(filters.offset)}),response=await fetch('/api/my-finance?'+params,{credentials:'same-origin',cache:'no-store',signal:currentController.signal});
      let value;try{value=await response.json();}catch{throw Error('服务器返回内容不完整，请重试');}
      if(!response.ok){const error=Error(value.error?.message||value.message||'读取失败');error.status=response.status;throw error;}
      if(id!==request)return;if(value.personalOnly!==true||!value.viewer?.id)throw Error('本人财务范围未能确认，请刷新重试');
      const summaryKeys=['responsibilityCount','responsibilityAmount','unknownResponsibilityCount','pendingConfirmationCount','periodRegisteredIn','periodRegisteredOut','periodHandledIn','periodHandledOut','redPacketRequested','redPacketApprovedUnpaid','redPacketRecordedPaid'];
      if(!value.summary||summaryKeys.some(key=>value.summary[key]==null||!Number.isFinite(Number(value.summary[key])))||!Array.isArray(value.openItems)||!Array.isArray(value.rows)||!value.categoryCounts||!Number.isFinite(Number(value.totalRows)))throw Error('本人财务记录未完整返回，请重新读取');
      data=value;if(validDay(value.startDate||''))startDate=value.startDate;limits();
      if(validDay(value.period?.from||'')){filters.from=value.period.from;$('mf-from').value=filters.from;}if(validDay(value.period?.to||'')){filters.to=value.period.to;$('mf-to').value=filters.to;}filters.offset=Math.max(0,n(value.offset));
      render();saveUrl();if(scrollToRows)$('mf-results-title').scrollIntoView({block:'start',behavior:'auto'});
    }catch(error){if(id!==request)return;showError(error.name==='AbortError'?Error('读取超时，请检查网络后重试'):error);}
    finally{clearTimeout(timer);if(id===request)setLoading(false);}
  }
  $('mf-views').addEventListener('click',event=>{const button=event.target.closest('[data-view]');if(!button)return;view=button.dataset.view;switchView();saveUrl();});
  $('mf-period-filter').addEventListener('submit',event=>{event.preventDefault();const values=readFilters();if(!values)return;filters={...filters,from:values.from,to:values.to,offset:0};load();});
  $('mf-open-categories').addEventListener('click',event=>{const button=event.target.closest('[data-open-category]');if(!button)return;openCategory=button.dataset.openCategory;renderOpen();saveUrl();});
  $('mf-open-period').addEventListener('change',()=>{openPeriod=$('mf-open-period').value;renderOpen();saveUrl();});
  $('mf-open-search').addEventListener('submit',event=>{event.preventDefault();filters={...filters,q:$('mf-open-query').value.trim().slice(0,160),offset:0};$('mf-query').value=filters.q;load();});
  $('mf-filter').addEventListener('submit',event=>{event.preventDefault();const values=readFilters();if(!values)return;filters={...filters,...values,offset:0};$('mf-open-query').value=filters.q;load();});
  $('mf-today').addEventListener('click',()=>{scope='day';limits();const date=today();$('mf-from').value=date;$('mf-to').value=date;fieldError('');filters={...filters,from:date,to:date,offset:0};load();});
  $('mf-categories').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(!button)return;const values=readFilters();if(!values)return;filters={...filters,...values,category:button.dataset.category,offset:0};load();});
  $('mf-pages').addEventListener('click',event=>{const button=event.target.closest('[data-offset]');if(!button||button.disabled||busy)return;filters.offset=Math.max(0,n(button.dataset.offset));load(true);});
  $('mf-scopes').addEventListener('click',event=>{const button=event.target.closest('[data-scope]');if(!button)return;scope=button.dataset.scope;const date=today();filters={...filters,from:scope==='all'?'1970-01-01':date,to:date,offset:0};$('mf-from').value=filters.from;$('mf-to').value=filters.to;fieldError('');limits();load();});
  $('mf-refresh').addEventListener('click',()=>load());$('mf-retry').addEventListener('click',()=>load());load();
})();
