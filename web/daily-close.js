function createTodoFocus115(parameter,label,back,hidden=[]){
 const id=new URLSearchParams(location.search).get(parameter)||'';let box=null;
 const matches=row=>!!row&&String(row.id||'')===id;
 function select(rows,root){
  if(!id)return rows;const visible=rows.filter(matches),host=document.getElementById(root);
  if(host){if(!box){box=document.createElement('section');box.className='panel todo-focus';box.setAttribute('role','status');host.before(box);for(let node=host.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;box.scrollIntoView({block:'start'});}
   box.replaceChildren();const title=document.createElement('strong'),detail=document.createElement('p'),all=document.createElement('a'),pending=document.createElement('a');
   title.textContent=visible.length?'当前待办 · '+label:'未找到这张'+label;
   const row=visible[0];detail.textContent=row?'单号 '+String(row.displayNo||row.number||row.id)+' · '+String(row.status||'请核对原单')+'。这里只显示这一张原单。':'原单不存在或当前账号不可见，请返回待办刷新。';
   all.href=back;all.textContent='查看全部'+label;pending.href='/m#pending';pending.textContent='返回我的待办';const refresh=document.createElement('button');refresh.type='button';refresh.textContent='刷新原单';refresh.onclick=()=>load();box.append(title,detail,all,document.createTextNode(' · '),pending,document.createTextNode(' · '),refresh);
   for(const key of hidden){const node=document.getElementById(key);if(node)node.hidden=true;}
  }return visible;
 }
 return {id,matches,select};
}
const todoFocus115=createTodoFocus115("closeout","每日扎账单","/daily-close?view=history",["daily-form","air-panel","summary"]);
const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(){return '';}
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
const money = (n) => "¥" + Number(n || 0).toFixed(2);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
const groups = [["移动空中充值", ["airOpening","airChange","airClosing"]]];
const checks = [["sales","交易与收付款"],["stock","库存增减"],["serials","贵重串码清点"],["cash","现金实点"],["mobile","空充及账户分项核对"],["suppliers","往来余额"],["wallet","门店微信账面与实看余额、差额和逐笔收付"]];
let me, preview, records = [], air = [], selectedAction = null, resubmitId = "";
async function api(path, options={}) {
  const r = await fetch(path,{credentials:"same-origin",cache:"no-store",...options,headers:{...(options.body?{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()}:{}),...(options.headers||{})}});
  if (r.status===401) throw new Error("LOGIN");
  const data=await r.json();
  if (!r.ok) throw new Error(data.error?.message || "请求失败");
  return data;
}
const post=(path,data)=>api(path,{method:"POST",body:JSON.stringify(data)});
function status(message,error=false){$("status").textContent=message;$("status").classList.toggle("error-text",error);window.StoreDailyCompact?.onStatus(error);}
function stat(label,value){return '<article><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>';}
function renderSummary() {
  const p=preview;
  const inventory=p.inventory||[];
  const phone=inventory.filter((r)=>r.trackSerial);
  const opening=phone.reduce((n,r)=>n+r.openingQuantity,0);
  const incoming=phone.reduce((n,r)=>n+r.inQuantity,0);
  const outgoing=phone.reduce((n,r)=>n+r.outQuantity,0);
  const closing=phone.reduce((n,r)=>n+r.quantity,0);
  const categories=new Map();
  for(const r of inventory)categories.set(r.category,(categories.get(r.category)||0)+Number(r.quantity||0));
  const orderRows=(p.transactions||[]).map((r)=>'<tr><td>'+esc(documentRef(r,"orderId"))+'</td><td>'+esc(r.product)+(r.serialNo?'<small>串码 '+esc(r.serialNo)+'</small>':'')+'</td><td>'+esc(r.quantity)+'</td><td>'+money(r.amount)+'</td><td>'+esc(r.account)+'</td><td>'+esc(r.operator)+'</td>'+(r.cost!=null?'<td>'+money(r.cost)+'</td><td>'+money(r.profit)+'</td>':'')+'</tr>').join("");
  $("summary").innerHTML =
    '<div class="daily-stats">'+
    stat("销售原单",p.salesCount+' 单'+(p.testSalesCount?'（测试 '+p.testSalesCount+' 单，正式 '+p.formalSalesCount+' 单）':'')+' · '+money(p.salesAmount))+
    stat("退货",p.returnCount+' 单 · '+money(p.returnAmount))+
    stat("实际退款（资金流水）",money(p.actualRefundAmount))+(p.cancelledUnreceivedReturnAmount?stat("未收款撤单（无退款）",money(p.cancelledUnreceivedReturnAmount)):"")+(p.refundUnrecordedAmount?stat("登记应退待核流水",money(p.refundUnrecordedAmount)):"")+
    stat("净销售",money(p.salesAmount-p.returnAmount))+(Number(p.refundDifferenceAmount)?stat(Number(p.confirmedReturnRemainder)===Number(p.refundDifferenceAmount)?"退货余款（老板已确认）":"退货成交额与实退差额（另核）",money(p.refundDifferenceAmount)):"")+
    stat("截至营业日已记销售收款",money(p.salePaymentRecordedAmount))+
    stat("销售待核／未记收款",p.salePaymentUnsettledCount+" 单 · "+money(p.salePaymentOutstandingAmount))+
    stat("已记但尚待收款人核对",money(p.salePaymentUnverifiedRecordedAmount))+
    (p.grossProfit==null?'':stat("毛利",money(p.grossProfit)))+
    stat("手机期初＋进－出＝期末",p.inventoryStatus==="unavailable"?"无历史快照（不能回溯）":opening+'＋'+incoming+'－'+outgoing+'＝'+closing)+
    stat("库存流水",p.stockMovementCount+' 条')+
    stat("现金净变动",money(p.cashChange))+
    stat("已确认交接（仅作记录）",money(p.cashHandoverConfirmed))+stat("现金转存老板银行",money(p.cashBankDeposits))+ 
    stat("待确认交接",String((p.cashHandoverPending||[]).length)+" 笔")+
    stat("老板银行卡 · 本日已确认转入",money(p.fundAccounts?.rows.find(a=>a.name==='老板银行卡')?.internalReceived))+'</div>'+
    ((p.sourceAnnotations||[]).length?'<details><summary>测试原单与退货余款留痕</summary>'+p.sourceAnnotations.map(r=>'<p><a href="/app?tab=orders&amp;q='+encodeURIComponent(r.orderId)+'">'+esc(r.orderId)+'</a> · 测试原单保留；原收 '+money(r.originalReceived)+'，实退 '+money(r.actualRefund)+'，退货余款 '+money(r.remainder)+(r.remainder?' · 归老板 '+esc(r.ownerName)+'（不指定银行卡）':'')+'<br><small>'+esc(r.note)+' · '+esc(r.annotationId)+'</small></p>').join('')+'</details>':'')+
    ((p.mobileCoinClaims||[]).length?'<details><summary>移动金币顺差待到账 · '+money(p.mobileCoinClaims.reduce((n,r)=>n+r.remaining,0))+'</summary>'+p.mobileCoinClaims.map(r=>'<p><a href="/mobile-coin-claims?q='+encodeURIComponent(r.id)+'">'+esc(r.displayNo)+'</a> · 手机款 '+money(r.saleAmount)+' ＋ 垫付话费 '+money(r.advanceAmount)+' ＝ '+money(r.amount)+'<br>金币应到 '+money(r.coins)+'，顺差应到 '+money(r.surplus)+'；已到 '+money(r.received)+'，待到 '+money(r.remaining)+'<br>原BOSS已扣话费一次，不再扣款；未到账不算老板实收。</p>').join('')+'</details>':'')+
    '<details><summary>各账户净流水</summary><div class="account-list">'+Object.entries(p.accountTotals||{}).map(([key,value])=>'<p>'+esc(key)+' '+money(value)+'</p>').join('')+'</div></details>'+
    '<details><summary>销售收款逐单核对（账面销售不等于已收款）</summary><p>未核对单据请到 <a href="/sale-payments">销售收款核对</a> 逐笔核实；已记但未签认的现金仍须与抽屉实点比对。</p><div class="detail-list"><table><thead><tr><th>单号</th><th>方式</th><th>应核收</th><th>当日已记</th><th>未记</th><th>状态</th></tr></thead><tbody>'+(p.salePaymentRows||[]).map(r=>'<tr><td>'+esc(r.orderId)+'</td><td>'+esc(r.account)+'</td><td>'+esc(r.due==null?'待核':money(r.due))+'</td><td>'+money(r.recorded)+'</td><td>'+esc(r.outstanding==null?'待核':money(r.outstanding))+'</td><td>'+esc(r.status)+'</td></tr>').join('')+'</tbody></table></div></details>'+
    '<details><summary>库存品类与贵重串码</summary><p>'+esc(p.inventoryNote||'')+'</p><p>'+[...categories].map(([name,qty])=>esc(name)+' '+qty+' 件').join(' · ')+'</p><div class="detail-list">'+phone.map((r)=>'<p><b>'+esc(r.name)+'</b> · '+esc(r.warehouse)+' · 期初 '+r.openingQuantity+' / 进 '+r.inQuantity+' / 出 '+r.outQuantity+' / 余 '+r.quantity+'<br><small>在库串码：'+esc(r.serials.join('、')||'无')+'</small></p>').join('')+'</div></details>'+
    (p.supplierTotals?'<details><summary>供货商往来余额</summary><p>应付 '+money(p.supplierTotals.payable)+' · 预付 '+money(p.supplierTotals.advance)+' · 往来款 '+money(p.supplierTotals.cash)+'</p></details>':'')+
    '<details><summary>当日销售逐笔明细（最多显示 100 行）</summary><div class="detail-list"><table><thead><tr><th>单号</th><th>商品/串码</th><th>数量</th><th>金额</th><th>收款</th><th>经办</th>'+(p.transactions?.[0]?.cost!=null?'<th>成本</th><th>毛利</th>':'')+'</tr></thead><tbody>'+orderRows+'</tbody></table></div></details>';
}
function renderMetrics(rows, values={}) {
  const byKey=new Map(rows.map((r)=>[r.key,r]));
  $("metrics").innerHTML=groups.map(([title,keys])=>'<section class="metric-group"><h3>'+esc(title)+'</h3>'+keys.map((key)=>{
    const r=byKey.get(key);if(!r)return "";
    const own=r.own==null?'<span class="unknown">待补数据</span>':esc(r.own)+' '+esc(r.unit);
    const value=values[key]??r.boss??"";
    return '<div class="metric-row" data-metric="'+esc(key)+'" data-own="'+(r.own==null?'':esc(r.own))+'"><span>'+esc(r.label)+' · '+esc(r.unit)+'</span><span><small>我方账</small><br><strong>'+own+'</strong></span><label>'+(key==='aggregateReceived'?'非现金实际交收':'移动BOSS')+'<input name="metric_'+esc(key)+'" type="number" step="'+(r.unit==='笔'?'1':'0.01')+'" '+(r.unit==='笔'?'min="0" ':'')+'inputmode="decimal" value="'+esc(value)+'"></label><span class="metric-diff">待填写</span></div>';
  }).join('')+'</section>').join('');
  for(const input of $("metrics").querySelectorAll("input"))input.addEventListener("input",()=>updateMetric(input.closest(".metric-row")));
  for(const row of $("metrics").querySelectorAll(".metric-row"))updateMetric(row);window.StoreDailyCompact?.metrics(rows);
}
function updateMetric(row) {
  const own=row.dataset.own, raw=row.querySelector("input").value, target=row.querySelector(".metric-diff");
  if(own===""){target.textContent="我方待补";target.className="metric-diff unknown";return;}
  if(raw===""){target.textContent="待抄录";target.className="metric-diff muted-text";return;}
  const diff=Math.round((Number(own)-Number(raw))*100)/100;
  target.textContent=(diff===0?"一致":"差异 "+diff);
  target.className="metric-diff "+(diff===0?"match":"mismatch");
}
function renderCash(){
  if(!preview)return;
  const openingRaw=$("openingCash").value,actualRaw=$("actualCash").value;
  if(openingRaw===""){$("cash-preview").textContent="请依据开业前清点或上一日结存填写现金期初；系统不会默认为零。";$("cash-preview").classList.remove("mismatch");return;}
  const opening=Number(openingRaw),expected=Math.round((opening+Number(preview.cashChange||0)-Number(preview.cashBankDeposits||0)+Number(preview.cashAdjustment||0))*100)/100;
  if(actualRaw===""){$("cash-preview").textContent="期初 "+money(opening)+" ＋ 已登记现金流水 "+money(preview.cashChange)+" － 转存银行 "+money(preview.cashBankDeposits)+" ＋ 已核清调整 "+money(preview.cashAdjustment)+" ＝ 应点 "+money(expected)+"；请独立清点抽屉现金后填写实点。";$("cash-preview").classList.remove("mismatch");return;}
  const actual=Number(actualRaw),difference=Math.round((actual-expected)*100)/100;
  $("cash-preview").textContent="期初 "+money(opening)+" ＋ 已登记现金流水 "+money(preview.cashChange)+" － 转存银行 "+money(preview.cashBankDeposits)+" ＋ 已核清调整 "+money(preview.cashAdjustment)+" ＝ 应点 "+money(expected)+"；实点 "+money(actual)+"；差异 "+money(difference)+(preview.cashHandoverPending?.length?"；另有 "+preview.cashHandoverPending.length+" 笔交接待确认":"");
  $("cash-preview").classList.toggle("mismatch",difference!==0);
}
function renderWallet(){
 const w=preview?.wallet,box=$('wallet-daily-summary');if(!box)return;if(!w?.available){box.textContent=w?.reason||'门店微信账户待加载';return;}
 box.innerHTML='<div class="money-strip"><div><span>当日增加</span><strong>'+money(w.todayIn)+'</strong></div><div><span>当日减少</span><strong>'+money(w.todayOut)+'</strong></div><div><span>净变动</span><strong>'+money(w.todayNet)+'</strong></div></div>'+
 '<p class="'+(w.previousBalance==null?'account-warning':'account-hint')+'">'+(w.previousBalance==null?'账面基准待建立；实看余额只核差额，不能覆盖账面。':'上次锁定 '+esc(w.previousDate)+' · '+money(w.previousBalance)+' → 本日账面应有 '+money(w.expectedBalance))+'</p>'+
 '<details><summary>明细查询 · 门店微信逐笔增减 · '+w.entries.length+' 笔</summary><div class="detail-list">'+(w.entries.length?w.entries.map(r=>'<p>'+esc(r.amount>=0?'增加':'减少')+' '+money(Math.abs(r.amount))+' · '+esc(r.business||r.kind)+'<br><small>原单 '+esc(r.sourceDisplayNo||r.sourceId)+' · '+esc(r.counterparty||'对象待核')+' · '+esc(r.displayNo||r.id)+'</small></p>').join(''):'<p>本营业日无资金流水。</p>')+'</div></details>';
}
function lockEvidence(row){
  const shot=row.snapshot||{},facts=[];
  facts.push('门店现金：期初 '+money(row.openingCash)+'，当日净流水 '+money(shot.cashChange)+'，已确认交接 '+money(shot.cashHandoverConfirmed)+'，应点 '+money(row.expectedCash)+'，实点 '+money(row.actualCash)+'，差额 '+money(row.cashDifference)+'。');
  const expected=Number(shot.aggregatePayments?.net||0),actual=Number(row.manual?.aggregateReceived||0),difference=shot.fundAccounts?(row.accountChecks||[]).reduce((n,a)=>n+Math.abs(a.difference||0),0):Math.round((actual-expected)*100)/100;
  if(shot.fundAccounts)facts.push(...(row.accountChecks||[]).map(a=>a.name+'：系统净变动 '+money(a.expected)+'，实核 '+(a.actual==null?'未填':money(a.actual))+'，差额 '+(a.difference==null?'待核':money(a.difference))+'。'));else facts.push('历史合并汇总：系统净收 '+money(expected)+'，营业员填报 '+money(actual)+'，差额 '+money(difference)+'。');
  const mobile=(shot.mobile||[]).filter(item=>item.status!=='一致');
  if(mobile.length)facts.push('移动 BOSS '+mobile.length+' 项待核：'+mobile.map(item=>item.label+'（'+item.status+'）').join('；')+'。');
  if(shot.salePaymentUnsettledCount||shot.salePaymentUnknownCount)facts.push('销售收款待核 '+Number(shot.salePaymentUnsettledCount||0)+' 笔，金额待核 '+Number(shot.salePaymentUnknownCount||0)+' 笔。');
  if(row.note)facts.push('营业员说明：'+row.note);
  if(row.reviewNote)facts.push('复核意见：'+row.reviewNote);
  const concerns=[row.cashDifference?'现金差额 '+money(row.cashDifference):'',difference?'账户分项核对差额 '+money(difference):'',mobile.length?'移动 BOSS '+mobile.length+' 项待核':'',shot.salePaymentUnsettledCount?'销售收款 '+shot.salePaymentUnsettledCount+' 笔待核':''].filter(Boolean);
  const draft=concerns.length?'签认前核对：'+concerns.join('；')+'。以上是系统比对结果，差异原因尚待查明，保留原单继续核查。':'已查看现金实点、账户分项核对填报及复核记录，同意签认锁定。';
  return {html:'<h3>系统比对依据</h3><p>以下数据来自营业员提交时的扎账快照；系统不能据此判定实际到账。</p><ul>'+facts.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul><p><a href="/daily-cash-receipts?date='+encodeURIComponent(row.date)+'" target="_blank" rel="noopener">查看当日现金流水原单</a></p><small>下方为助理整理的批示草稿，可修改或清空。</small>',draft:draft.slice(0,1000)};
}
function buttons(row){
  const bits=[redPacketEntry('dailyCloseouts',row)];
  if(row.reviewerId===me.id&&row.status==="待领取复核")bits.push('<button data-action="claim" data-id="'+esc(row.id)+'">领取复核</button>');
  if(row.reviewerId===me.id&&row.status==="复核中"){bits.push('<button data-action="pass" data-id="'+esc(row.id)+'">逐栏复核通过</button>');bits.push('<button class="secondary" data-action="reject" data-id="'+esc(row.id)+'">驳回</button>');}
  if(row.reviewerId===me.id&&row.status==="待老板签认")bits.push('<button class="secondary" data-action="reject" data-id="'+esc(row.id)+'">退回重核</button>');
  if(row.cashierId===me.id&&["已驳回","已撤回"].includes(row.status))bits.push('<button data-action="resubmit" data-id="'+esc(row.id)+'">补正再提交</button>');
  if(me.roleCode==="owner"&&row.status==="待老板签认")bits.push('<button data-action="lock" data-id="'+esc(row.id)+'">老板签认锁定</button>');
  if(me.roleCode==="owner"&&row.status==="已锁定")bits.push('<button class="secondary" data-action="unlock" data-id="'+esc(row.id)+'">老板解锁</button>');
  return bits.length?'<div class="record-actions">'+bits.join("")+'</div>':"";
}
function originalCloseoutFull(row){
 const shot=row.snapshot||{},fields=[['提交单号',documentNo(row)],['营业日',row.date],['提交时间',row.submittedAt||'—'],['扎账营业员',row.cashier||'—'],['指定复核人',row.reviewer||'—'],['现金期初',money(row.openingCash)],['账面现金净变动',money(shot.cashChange)],['现金转存老板银行',money(shot.cashBankDeposits)],['账面应点现金',money(row.expectedCash)],['营业员实点现金',money(row.actualCash)],['现金差异',money(row.cashDifference)],['销售原单',String(shot.salesCount??'—')+' 单 · '+money(shot.salesAmount)],['退货',String(shot.returnCount??'—')+' 单 · '+money(shot.returnAmount)],['实际退款',money(shot.actualRefundAmount)],['销售已记收款',money(shot.salePaymentRecordedAmount)],['账户分项核对当日净收',money(shot.aggregatePayments?.net)],['历史营业员填报合并实收',row.manual?.aggregateReceived==null?'未填':money(row.manual.aggregateReceived)]];
 if(shot.fundAccounts){fields.splice(-2);for(const a of shot.fundAccounts.rows)fields.push([a.name+' · 净变动',money(a.net)]);}
 const metrics=(shot.mobile||[]).map(item=>'<tr><td>'+esc(item.label||item.key)+'</td><td>'+esc(item.own==null?'待补':item.own)+' '+esc(item.unit||'')+'</td><td>'+esc(item.boss==null?'未填':item.boss)+' '+esc(item.unit||'')+'</td><td>'+esc(item.status||'待核')+'</td></tr>').join('');
 const transactions=(shot.transactions||[]).map(item=>'<tr><td>'+esc(documentRef(item,'orderId'))+'</td><td>'+esc(item.product||'')+(item.serialNo?' · 串号 '+esc(item.serialNo):'')+'</td><td>'+esc(item.quantity)+'</td><td>'+money(item.amount)+'</td><td>'+esc(item.account||'')+'</td><td>'+esc(item.operator||'')+'</td></tr>').join('');
 const inventory=(shot.inventory||[]).map(item=>'<tr><td>'+esc(item.name||'')+'</td><td>'+esc(item.warehouse||'')+'</td><td>'+esc(item.openingQuantity)+'</td><td>'+esc(item.inQuantity)+'</td><td>'+esc(item.outQuantity)+'</td><td>'+esc(item.quantity)+'</td><td>'+esc((item.serials||[]).join('、'))+'</td></tr>').join('');
 const accounts=Object.entries(shot.accountTotals||{}).map(([name,value])=>'<p>'+esc(name)+'：'+money(value)+'</p>').join('');
 const events=(row.events||[]).map(event=>'<p>'+esc(event.type)+' · '+esc(event.by)+' · '+esc(event.at)+(event.note?' · '+esc(event.note):'')+'</p>').join('');
 const revisions=(row.revisions||[]).map((revision,index)=>'<p>第 '+(index+1)+' 次原提交 · '+esc(revision.at)+' · 实点 '+money(revision.actualCash)+' · '+esc(revision.note||'无说明')+'</p>').join('');
 return '<section class="closeout-original"><h4>门店微信核对</h4><p>锁定账面结余：'+(row.walletBookClosingBalance==null?'待建立基准':money(row.walletBookClosingBalance))+'；营业员实看：'+(row.walletActualBalance==null?'未填':money(row.walletActualBalance))+'；差额：'+(row.walletDifference==null?'待有账面基准再核对':money(row.walletDifference))+'。实看余额不覆盖账面。</p><h4>营业员提交的原始扎账单</h4><p>这张单供老板核对账户分项核对与营业员填报结果。现金仍由营业员保管在门店抽屉；查看或签认扎账单都不代表现金已交接。金额和明细取自提交时的快照，打开页面不会重新扎账或改写原单。</p><dl>'+fields.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl><h4>提交说明与复核意见</h4><p>营业员说明：'+esc(row.note||'无')+'</p><p>复核意见：'+esc(row.reviewNote||'尚未填写')+'</p>'+(row.lockNote?'<p>老板签认：'+esc(row.lockNote)+'</p>':'')+'<h4>空充、账户分项核对逐项核对</h4><div class="table-wrap"><table><thead><tr><th>项目</th><th>系统账面</th><th>营业员填报</th><th>比对</th></tr></thead><tbody>'+metrics+'</tbody></table></div><h4>提交时的收付账户净流水</h4>'+(accounts||'<p>原单无账户明细。</p>')+'<h4>提交时的销售明细</h4><div class="table-wrap"><table><thead><tr><th>原单号</th><th>商品与串号</th><th>数量</th><th>金额</th><th>方式</th><th>经办人</th></tr></thead><tbody>'+transactions+'</tbody></table></div>'+(transactions?'':'<p>原单未保存销售逐笔明细。</p>')+'<h4>提交时的库存清点依据</h4><div class="table-wrap"><table><thead><tr><th>商品</th><th>仓库</th><th>期初</th><th>进</th><th>出</th><th>结余</th><th>在库串码</th></tr></thead><tbody>'+inventory+'</tbody></table></div><h4>这张单的操作记录</h4>'+(events||'<p>无操作记录。</p>')+(revisions?'<h4>之前提交的版本</h4>'+revisions:'')+'</section>';
}
function simpleOriginalCloseout(row){
 const shot=row.snapshot||{},air=(shot.mobile||[]).find(item=>item.key==='airClosing'),evening=row.simpleStage==='evening',newForm=row.sourceFormVersion==='simple-four-items-v1';
 const amount=value=>value==null?'未记录':money(value);
 const field=(label,value)=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>';
 const submitted=[field('门店现金实点',amount(row.actualCash))];
 if(newForm)submitted.push(field('空充BOSS实际余额',amount(row.simpleAirActualBalance)),field('门店微信实看余额',amount(row.walletActualBalance)),field('非现金收款实报',amount(row.simpleNoncashActual)));
 else if(evening)submitted.push(field('门店微信实看余额',amount(row.walletActualBalance)),field('非现金收款实报',amount(row.simpleNoncashActual)));
 submitted.push(field('提交说明原文',row.note||'无'));
 const reporter=row.ownerRecorded?'实际报数人 '+esc(row.actualCounterName||'未记录')+'；代录人 '+esc(row.recordedByName||row.cashier||'未记录'):'提交人 '+esc(row.cashier||'未记录');
 const basis=[field('现金账面应点',amount(row.expectedCash))];
 if(newForm)basis.push(field('空充BOSS系统期末',amount(row.simpleAirSystem)),field('门店微信账面应有',amount(row.simpleWalletSystem)),field('非现金系统统计',amount(row.simpleNoncashSystem)));
 else if(evening)basis.push(field('门店微信账面应有',amount(row.simpleWalletSystem)),field('非现金系统统计',amount(row.simpleNoncashSystem)),field('移动BOSS空充系统期末',amount(air?.own)));
 const version=row.sourceFormVersion?'表单版本 '+esc(row.sourceFormVersion):'历史简易表单（提交时未保存版本号）';
 const events=(row.events||[]).map(event=>'<li>'+esc(event.type||'操作')+' · '+esc(event.at||'时间未记录')+' · 操作账号 '+esc(event.by||'未记录')+(event.note?' · 记录说明 '+esc(event.note):'')+'</li>').join('');
 return '<section class="closeout-original"><h4>提交时的原单内容</h4><p>单号 '+esc(documentNo(row))+' · '+esc(row.date)+' · '+esc(new Date(row.submittedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+' · '+version+' · '+reporter+'</p><dl>'+submitted.join('')+'</dl><p>'+(newForm?'四项实际数字均为报数人提交的原填写；系统依据另列，差额待核。':'这版原单没有移动BOSS余额的独立实报栏。备注保留原文；不能把系统余额当成报数人填写，也不能凭独立栏为空判断报数人没有报过。')+'</p><h4>提交时保存的系统核对依据</h4><dl>'+basis.join('')+'</dl><p>系统统计与原单报数分开显示；查看和核对不会改写原单，也不表示现金已交接。</p><h4>后续操作记录</h4>'+(events?'<ol>'+events+'</ol>':'<p>无后续操作记录。</p>')+'</section>';
}
function originalCloseout(row){
 if(row.simpleDailyClose===true)return simpleOriginalCloseout(row);
 const shot=row.snapshot||{},ledger=shot.aggregatePayments?.net,reported=row.manual?.aggregateReceived;
 const air=(shot.mobile||[]).find(item=>item.key==='airClosing')||{};
 const value=n=>n==null?'未填':money(n);
 const delta=(left,right)=>left==null||right==null?'待核':value(Number((Number(left)-Number(right)).toFixed(2)));
 const detailRows=lines=>'<dl>'+lines.map(([label,amount])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(amount)+'</dd></div>').join('')+'</dl>';
 const card=(title,lines,detail)=>'<section class="closeout-check-card"><h4>'+esc(title)+'</h4>'+detailRows(lines)+'<details><summary>查看本项明细</summary>'+detail+'</details></section>';
 const cashDetail=detailRows([['营业员填写期初',value(row.openingCash)],['现金净流水',value(shot.cashChange)],['转存银行',value(shot.cashBankDeposits)],['已核清调整',value(shot.cashAdjustment)],['账面应点',value(row.expectedCash)],['实际点数',value(row.actualCash)]])+'<p><a href="/daily-cash-receipts?date='+encodeURIComponent(row.date)+'">查看该日逐笔现金收支</a></p>';
 const cash=card('门店现金 · 营业员负责',[['账面应点',value(row.expectedCash)],['营业员实点',value(row.actualCash)],['差额',value(row.cashDifference)]],cashDetail);
 const mobile=key=>(shot.mobile||[]).find(item=>item.key===key)||{};
 const airDetail=detailRows([['空充系统期初',value(mobile('airOpening').own)],['营业员填报期初',value(mobile('airOpening').boss)],['空充系统净变动',value(mobile('airChange').own)],['营业员填报净变动',value(mobile('airChange').boss)],['空充系统期末',value(air.own)],['营业员填报期末',value(air.boss)]]);
 const airCard=card('空充 · 核对平台余额',[['系统期末',value(air.own)],['营业员填报期末',value(air.boss)],['差额',delta(air.own,air.boss)]],airDetail);
 const aggregateDetail=detailRows([['登记收入',value(shot.aggregatePayments?.received)],['退款',value(shot.aggregatePayments?.refunded)],['现金转银行',value(shot.aggregatePayments?.bankDeposits)],['当日净收',value(ledger)]])+(shot.aggregatePayments?.details||[]).map(item=>'<p>'+esc(item.account)+'：收入 '+esc(value(item.received))+' · 退款 '+esc(value(item.refunded))+' · 净收 '+esc(value(item.net))+'</p>').join('');
 const aggregate=shot.fundAccounts?namedFundHistory(shot.fundAccounts,row.accountChecks):card('历史非现金汇总（旧快照，只读）',[['系统登记当日净收',value(ledger)],['营业员填报当日净收',value(reported)],['差额',delta(ledger,reported)]],aggregateDetail);
 const wallet=shot.wallet, walletCard=wallet?card('门店微信 · 营业员每日核对',[['今日增加',value(wallet.todayIn)],['今日减少',value(wallet.todayOut)],['账面应有',value(wallet.expectedBalance)],['实看余额',value(row.walletActualBalance)],['差额',value(row.walletDifference)]],(wallet.entries||[]).map(r=>'<p>'+esc(r.amount>=0?'增加':'减少')+' '+value(Math.abs(r.amount))+' · '+esc(r.business||r.kind)+' · 原单 '+esc(r.sourceDisplayNo||r.sourceId)+' · '+esc(r.counterparty||'对象待核')+' · '+esc(r.displayNo||r.id)+'</p>').join('')||'<p>当日无增减。</p>'):'';
 return '<section class="closeout-original"><h4>当日扎账核对卡</h4><p>单号 '+esc(documentNo(row))+' · '+esc(row.date)+' · 营业员 '+esc(row.cashier||'—')+'</p><div class="closeout-check-cards">'+cash+airCard+walletCard+aggregate+'</div><p>具体账户分别核对。老板银行卡仅列本人已确认到账的交接，未确认不计实收。现金仍在门店抽屉，签认本单不表示现金已交接；货物由营业员核对负责。</p><details><summary>需要追查其他单据时查看完整提交快照</summary>'+originalCloseoutFull(row)+'</details></section>';
}
function renderHistory(){
  const visible=todoFocus115.select(records,"history");
  $("history").innerHTML=visible.length?visible.map((r)=>{if(r.legacyCheckpoint)return unifiedLegacyCard(r);
    const bad=(r.snapshot.mobile||[]).filter((m)=>m.status!=="一致");
    return '<article class="close-record"><h3>'+esc(r.date)+' · '+(r.simpleDailyClose===true?(r.sourceFormVersion==='simple-four-items-v1'?'四项扎账':r.simpleStage==='evening'?'简易晚间报数':'简易现金清点'):r.recordType==='formal'?'详细正式扎账':r.recordType==='temporary'?'临时扎账':'历史记录')+' · '+esc(r.status)+'</h3><small>当日累计截至 '+esc(new Date(r.submittedAt||r.snapshot.asOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+' · 第 '+esc(r.sequence||1)+' 次扎账</small><small>'+esc(documentNo(r))+' · '+(r.simpleDailyClose===true?(r.ownerRecorded?'实际报数 '+esc(r.actualCounterName||'未记录')+'；老板代录 '+esc(r.recordedByName||r.cashier||'未记录'):'提交人 '+esc(r.cashier||'未记录')):esc(r.cashier)+' → '+esc(r.reviewer))+'</small>'+
      '<p>销售 '+r.snapshot.salesCount+' 单 · 退货 '+r.snapshot.returnCount+' 单 · 现金应点 '+money(r.expectedCash)+' / 实点 '+money(r.actualCash)+' / 差异 <b class="'+(r.cashDifference?'mismatch':'match')+'">'+money(r.cashDifference)+'</b></p>'+
      (r.needsCashBasisCorrection&&!['已锁定','已解锁','已被后次替代'].includes(r.status)?'<p>原现金计算口径已更新，请重新提交扎账；原实点和复核记录保留。</p>':'')+
      (r.simpleDailyClose?(r.sourceFormVersion==='simple-four-items-v1'?'<p>空充BOSS：系统 '+(r.simpleAirSystem==null?'待建立账面基准':money(r.simpleAirSystem))+' / 实报 '+money(r.simpleAirActualBalance)+' / 差额 '+(r.simpleAirDifference==null?'待建立账面基准':money(r.simpleAirDifference))+'</p>':'<p>此版原单未设置移动BOSS余额独立实报栏；系统空充余额与原单说明请分别查看。</p>'):'<p>移动BOSS：'+(bad.length?'<b class="warn-text">'+bad.length+' 项待核/有差异</b>':'<b class="match">已一致</b>')+'</p>')+
      (r.reviewNote?'<p>复核意见：'+esc(r.reviewNote)+'</p>':'')+(r.lockNote?'<p>老板签认：'+esc(r.lockNote)+'</p>':'')+(r.unlockNote?'<p>老板已解锁该日期：'+esc(r.unlockNote)+'</p>':'')+
      (todoFocus115.id?originalCloseout(r):'<p><a href="/daily-close?closeout='+encodeURIComponent(r.id)+'">查看完整原扎账单 · '+esc(documentNo(r))+'</a></p>')+buttons(r)+'</article>';
  }).join(''):'<p class="hint">'+(historyPage&&!historyRequested?'请选择日期或记录类型后查询；不选条件可查询全部记录。':'当前筛选条件下没有已保存的扎账记录。')+'</p>';
}
function renderAir(){
  $("air-panel").hidden=!!todoFocus115.id||!me.capabilities.finance;
  if(!me.capabilities.finance)return;
  $("air-history").innerHTML=air.slice(0,20).map((e)=>'<p>'+esc(e.businessDate)+' · '+esc(e.kind==='funding'?'平台充值入金':e.kind)+' '+money(e.amount)+(e.kind==='funding'?'（实际转出 '+money(e.paidAmount)+'；'+(e.feeRatePerMille!=null?'BOSS平台手续费 '+money(e.feeAmount)+(e.unexplainedDifference?'，其他差额 '+money(e.unexplainedDifference)+' 待核':''):'差额 '+money(e.difference)+' 待核')+'）':'')+' · 余额 '+money(e.balance)+' · 流水 '+esc(e.reference)+'</p>'+redPacketEntry('airRechargeEvents',e)).join('')||'<p class="hint">尚未登记空充期初。</p>';
  $("air-form").elements.kind.querySelector('option[value="opening"]').disabled=air.some((e)=>e.kind==="opening")||me.roleCode!=="owner";
  if($("air-form").elements.kind.value==="opening"&&$("air-form").elements.kind.querySelector('option[value="opening"]').disabled)$("air-form").elements.kind.value="increase";
}
const historyPage=new URLSearchParams(location.search).get('view')==='history';let historyRequested=false,historyFrom='',historyTo='',historyRecordType='';
function filterHistory(rows){return rows.filter(r=>(!historyFrom||r.date>=historyFrom)&&(!historyTo||r.date<=historyTo)&&(!historyRecordType||r.recordType===historyRecordType));}
window.StoreDailyHistory={get ready(){return !!me&&(historyPage||!!preview);},get filters(){return {from:historyFrom,to:historyTo,recordType:historyRecordType,requested:historyRequested};},async query(from,to,recordType=''){if(recordType&&!['temporary','morning_cash_count','formal'].includes(recordType))throw new Error('扎账类型不正确');historyRecordType=recordType;if(from&&to&&from>to)throw new Error('开始日期不能晚于结束日期');historyFrom=from;historyTo=to;historyRequested=true;records=filterHistory(await unifiedHistory(true));renderHistory();window.StoreDailyCompact?.update({preview,records,air,me});}};
async function load(){
  const unifiedLoadEpoch=++unifiedEpoch;
  try{
    if(!historyPage&&!resubmitId){$('settlement-date').value=today();if($('today-business-date'))$('today-business-date').textContent='营业日：'+today()+'（北京时间）';}
    me=await api("/api/me");if(unifiedLoadEpoch!==unifiedEpoch)return;
    if(unifiedLegacyFocus){records=(await unifiedHistory(true)).filter(r=>r.legacyCheckpoint&&r.id===unifiedLegacyFocus);$("daily-form").hidden=true;$("daily-summary-panel").hidden=true;$("air-panel").hidden=true;$("history-title").textContent="当日扎账原单 · 临时记录";renderHistory();return;}
    if(todoFocus115.id){records=await api('/api/daily-closeouts?closeout='+encodeURIComponent(todoFocus115.id));$('history-title').textContent='核对营业员提交的原扎账单';renderHistory();return;}
    if(historyPage){records=historyRequested?filterHistory(await unifiedHistory(true)):[];renderHistory();window.StoreDailyCompact?.update({preview:null,records,air:[],me});return;}
    if(unifiedTemporary()&&!resubmitId){await unifiedLoadTemporary();return;}
    const [users,shot,rows]=await Promise.all([api("/api/users"),api("/api/daily-closeouts/preview?date="+encodeURIComponent($("settlement-date").value||today())),unifiedHistory(false).then(rows=>historyPage?filterHistory(rows):rows)]);
    if(unifiedLoadEpoch!==unifiedEpoch)return;preview=shot;records=rows;$("submit-daily").disabled=false;
    air=[]; // The embedded air ledger is hidden; open /air-accounts for its details.
    $("reviewerId").innerHTML='<option value="">请选择另一名营业员</option>'+users.filter((u)=>u.id!==me.id&&u.status==="active"&&u.roleCode!=="owner"&&u.capabilities.sell).map((u)=>'<option value="'+esc(u.id)+'">'+esc(u.name)+' · '+esc(u.role)+'</option>').join("");
    if(!resubmitId){$("openingCash").value=shot.openingCashSuggested??"";$("openingCash").readOnly=shot.openingCashSuggested!=null;$("actualCash").value="";$("walletActualBalance").value="";$("walletChecked").checked=false;$("walletInChecked").checked=false;$("walletOutChecked").checked=false;renderMetrics(shot.mobile);renderFundAccounts(shot);}
    renderSummary();renderCash();renderWallet();renderHistory();renderAir();renderAirQuery();window.StoreDailyCompact?.update({preview,records,air,me});
  }catch(error){
    if(todoFocus115.id){$('history').innerHTML='<p class="error-text">'+esc(error.message==='LOGIN'?'请先登录后查看这张原单':error.message)+'</p>';return;}
    $("summary").innerHTML=error.message==="LOGIN"?'<a href="/login?next=/daily-close">请先用员工账号登录</a>':esc(error.message);
    $("metrics").textContent=error.message==="LOGIN"?"登录后显示移动BOSS核对项":error.message;
    status(error.message==="LOGIN"?"登录后可提交正式扎账":error.message,true);
  }finally{
    document.documentElement.classList.remove('daily-initializing');
    if($('daily-entry-loading'))$('daily-entry-loading').hidden=true;
  }
}
$("refresh").addEventListener("click",load);
$("openingCash").addEventListener("input",renderCash);$("actualCash").addEventListener("input",renderCash);
$("daily-form").addEventListener("submit",async(event)=>{
  event.preventDefault();const f=event.currentTarget;const button=$("submit-daily");button.disabled=true;
  try{
    if(unifiedTemporary()&&!resubmitId){await unifiedSubmitTemporary(f);return;}
    if(!resubmitId&&!historyPage&&preview?.date!==today())throw new Error('北京时间已换日，请刷新后核对今天的流水再提交');
    const manual={};for(const row of $("metrics").querySelectorAll(".metric-row"))manual[row.dataset.metric]=row.querySelector("input").value===""?null:Number(row.querySelector("input").value);
    const payload={date:resubmitId||historyPage?$("settlement-date").value:today(),dateMode:resubmitId||historyPage?"original":"today",recordType:f.elements.recordType.value,reviewerId:f.elements.reviewerId.value,openingCash:f.elements.openingCash.value===""?null:Number(f.elements.openingCash.value),actualCash:f.elements.actualCash.value===""?null:Number(f.elements.actualCash.value),walletActualBalance:f.elements.walletActualBalance.value===""?null:Number(f.elements.walletActualBalance.value),walletChecked:f.elements.walletChecked.checked,walletInChecked:f.elements.walletInChecked.checked,walletOutChecked:f.elements.walletOutChecked.checked,note:f.elements.note.value,manual};
    payload.accountChecks=Object.fromEntries([...document.querySelectorAll("[data-fund-id]")].map(input=>[input.dataset.fundId,input.value===""?null:Number(input.value)]));
    const path=resubmitId?"/api/daily-closeouts/resubmit":"/api/daily-closeouts";
    if(resubmitId){payload.id=resubmitId;delete payload.date;delete payload.reviewerId;}
    const result=await post(path,payload);resubmitId="";button.textContent="提交本次扎账，请另一人复核";
    status("已提交："+documentNo(result)+"；等待另一名营业员领取复核。");await load();
  }catch(error){status(error.message,true);}finally{button.disabled=false;}
});
$("air-funding-form").addEventListener("submit",async(event)=>{
  event.preventDefault();const f=event.currentTarget;const b=f.querySelector('button[type="submit"]');b.disabled=true;
  try{const d=Object.fromEntries(new FormData(f));const result=await post("/api/air-recharge/funding",{...d,paidAmount:Number(d.paidAmount),creditedAmount:Number(d.creditedAmount)});status(result.message||"平台充值已登记。");f.reset();await load();}
  catch(error){status(error.message,true);}finally{b.disabled=false;}
});
$("air-form").addEventListener("submit",async(event)=>{
  event.preventDefault();const f=event.currentTarget;const b=f.querySelector('button[type="submit"]');b.disabled=true;
  try{const d=Object.fromEntries(new FormData(f));await post("/api/air-recharge",{...d,amount:Number(d.amount),businessDate:today()});status("空充流水已登记。");f.reset();await load();}
  catch(error){status(error.message,true);}finally{b.disabled=false;}
});
$("history").addEventListener("click",async(event)=>{
  const b=event.target.closest("button[data-action]");if(!b)return;
  const row=records.find((r)=>r.id===b.dataset.id);if(!row)return;
  if(row.detailsDeferred){b.disabled=true;try{const full=await api('/api/daily-closeouts?closeout='+encodeURIComponent(row.id));if(!full.length)throw new Error('原扎账单已变化，请刷新');Object.assign(row,full[0]);delete row.detailsDeferred;}catch(error){status(error.message,true);return;}finally{b.disabled=false;}}
  const action=b.dataset.action;
  if(action==="resubmit"){
    resubmitId=row.id;if($("recordType"))$("recordType").value=row.recordType||"temporary";$("daily-metrics-panel").hidden=false;$("settlement-date").value=row.date;$("daily-form").hidden=false;$("summary").hidden=false;$("reviewerId").value=row.reviewerId;$("submit-daily").textContent="补正并重新提交 "+row.date;
    $("openingCash").readOnly=false;$("openingCash").value=row.openingCash;$("actualCash").value="";$("walletActualBalance").value="";$("walletChecked").checked=false;$("walletInChecked").checked=false;$("walletOutChecked").checked=false;status("补正时请重新独立清点现金，并核对门店微信增减与实看余额。");$("daily-note").value=row.note||"";
    preview=row.snapshot;renderSummary();renderMetrics(row.snapshot.mobile,row.manual);renderFundAccounts(row.snapshot,row.accountChecks);renderCash();renderWallet();renderAirQuery();window.StoreDailyCompact?.summary(preview);$("daily-form").scrollIntoView({behavior:"smooth",block:"start"});return;
  }
  if(action==="claim"){
    try{await post("/api/daily-closeouts/claim",{id:row.id});status("复核任务已领取，请逐栏核对后再通过。");await load();}
    catch(error){status(error.message,true);}return;
  }
  selectedAction={action,id:row.id};
  $("action-title").textContent={pass:"逐栏复核通过",reject:"驳回扎账单",lock:"老板签认锁定",unlock:"老板解锁日期"}[action];
  $("action-info").textContent=row.date+" · "+documentNo(row)+" · "+row.cashier+" → "+row.reviewer;
  $("action-note-label").firstChild.textContent=action==="lock"?"处理意见／差异原因（选填）":"处理意见／差异原因";
  const evidence=action==="lock"?lockEvidence(row):null;
  $("lock-evidence").hidden=!evidence;$("lock-evidence").innerHTML=evidence?.html||"";
  $("action-form").elements.note.value=evidence?.draft||"";
  $("action-error").textContent="";
  $("action-checks").innerHTML=action==="pass"?'<p>逐栏检查无误后勾选：</p>'+checks.map(([key,label])=>'<label class="check-row"><input type="checkbox" name="check_'+key+'"> '+label+'</label>').join(''):"";
  if(action==='lock'&&row.snapshot?.wallet?.expectedBalance==null){
    $('action-checks').innerHTML='<details><summary>首次账面基准（单独核实后填写，选填）</summary><p>没有已复核锁定的基准。留空可保留待建立状态；不会采用营业员实看余额。</p><label>首次账面结余基准（元）<input name="walletBaselineClosing" type="number" min="0" step="0.01" placeholder="单独核实后填写，不自动带入"></label><label>基准核实依据<textarea name="walletBaselineEvidence" maxlength="1000"></textarea></label><label><input name="walletBaselineConfirmed" type="checkbox"> 我已单独核实并确认该首次基准</label></details>';
  }
  $("action-dialog").showModal();
});
$("action-cancel").addEventListener("click",()=>$("action-dialog").close());
$("action-form").addEventListener("submit",async(event)=>{
  event.preventDefault();const b=event.currentTarget.querySelector('button[type="submit"]');b.disabled=true;
  try{
    const {action,id}=selectedAction;const note=event.currentTarget.elements.note.value;
    let path,payload={id,note};
    if(action==="pass"||action==="reject"){
      path="/api/daily-closeouts/review";payload.decision=action==="pass"?"通过":"驳回";
      if(action==="pass")payload.checks=Object.fromEntries(checks.map(([key])=>[key,event.currentTarget.elements["check_"+key].checked]));
    }else path="/api/daily-closeouts/"+action;
    if(action==='lock'&&event.currentTarget.elements.walletBaselineClosing){
      payload.walletBaselineClosing=event.currentTarget.elements.walletBaselineClosing.value;
      payload.walletBaselineEvidence=event.currentTarget.elements.walletBaselineEvidence.value;
      payload.walletBaselineConfirmed=event.currentTarget.elements.walletBaselineConfirmed.checked;
    }
    await post(path,payload);$("action-dialog").close();status("处理完成。");await load();
  }catch(error){$("action-error").textContent=error.message;}finally{b.disabled=false;}
});
if($('settlement-date')){
 const requested=new URLSearchParams(location.search).get('date');
 $('settlement-date').value=historyPage&&requested&&requested>='2026-10-22'&&requested<=today()?requested:today();
 if($('today-business-date'))$('today-business-date').textContent='营业日：'+$('settlement-date').value+'（北京时间）';
 if(historyPage){$('instant-close-intro').hidden=true;document.title='当日扎账查询';document.querySelector('header strong').textContent='当日扎账查询';}
}

// One visible day-close document; original cash and formal handlers retain their evidence boundaries.
const unifiedLegacyFocus=new URLSearchParams(location.search).get('legacyCloseout')||'';
let unifiedAttempt=null,unifiedLoading=false,unifiedEpoch=0;
function unifiedTemporary(){return ['temporary','morning_cash_count'].includes($('recordType').value)&&!historyPage&&!todoFocus115.id&&!unifiedLegacyFocus;}
async function unifiedHistory(all){
 const q=all?'':'?from='+encodeURIComponent(today()+'T00:00:00+08:00');
 const [daily,legacy]=await Promise.all([api('/api/daily-closeouts?'+(all?'all=1&':'')+'summary=1'),api('/api/closeouts'+q)]);
 return [...daily,...legacy.map(r=>({...r,legacyCheckpoint:true,recordType:r.recordType==='morning_cash_count'?'morning_cash_count':'temporary',date:r.cashDate||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.countedAt||r.endAt)),reviewerId:r.reviewerId||r.receiverId,reviewer:r.reviewer||r.receiver,submittedAt:r.submittedAt||r.countedAt||r.endAt}))].sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)));
}
function unifiedLegacyCard(r){
 const current=r.checkpointPolicy==='store-cash-checkpoint-v2',canReview=current&&r.status==='待核对'&&me.id!==r.cashierId&&(me.roleCode==='owner'||r.reviewerId===me.id),canRevise=current&&r.status==='待复核'&&r.cashierId===me.id;
 const controls=canReview?'<button data-legacy-action="确认" data-id="'+esc(r.id)+'">已复核现金，确认</button><button data-legacy-action="退回" data-id="'+esc(r.id)+'">退回核查</button>':canRevise?'<button data-legacy-action="补正" data-id="'+esc(r.id)+'">重新清点并补正</button>':'';
 const at=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
 return '<article class="close-record"><h3>'+esc(r.date)+' · '+(r.recordType==='morning_cash_count'?'开门现金清点':'中途交班现金清点')+' · '+esc(r.status)+'</h3><p>'+esc(documentNo(r))+' · '+esc(at(r.countedAt||r.endAt))+' · '+esc(r.cashier)+' → '+esc(r.reviewer)+'</p><p>账面现金 '+money(r.expectedCash)+' / 实点 '+money(r.actualCash)+' / 差额 '+money(r.difference)+'</p><p>'+esc(r.note||'无差异说明')+'</p><p>现金仍属于门店；清点记录不会转移资金或自动转为正式扎账。</p><details><summary>原单与复核历史</summary><p>原始编号 '+esc(r.id)+'</p>'+(r.confirmedAt?'<p>'+esc(at(r.confirmedAt))+' · '+esc(r.confirmedByName||r.confirmedBy)+' · '+esc(r.reviewNote||'')+'</p>':'')+(r.revisions||[]).map(x=>'<p>'+esc(at(x.at))+' · 原实点 '+money(x.actualCash)+' · '+esc(x.note||'')+'</p>').join('')+'</details>'+controls+'</article>';
}
function unifiedMode(){
 const temporary=unifiedTemporary();$('settle-accounts').hidden=temporary;
 for(const input of $('settle-accounts').querySelectorAll('input,select,textarea'))input.disabled=temporary;
 $('unified-mode-note').textContent=temporary?($('recordType').value==='morning_cash_count'?'开门时清点现金：系统按已核实的期初和现金流水计算账面数；营业员亲自填实点数。':'中途交班只清点现金：系统计算账面数，营业员亲自填实点数。其他账户留在正式扎账核对。'):'营业结束正式扎账：核对现金、门店微信、移动BOSS及具体账户，交另一人复核，再由老板次日签认。';
 $('submit-daily').textContent=temporary?$('recordType').value==='morning_cash_count'?'保存开门现金清点，交另一人复核':'保存中途交班现金清点，交另一人复核':'提交正式扎账，交另一人复核';
 $('daily-summary-panel').hidden=temporary;
 if(temporary)$('history').closest('.panel').hidden=true;
 const stepNodes=[$('settle-date'),...(!temporary?[$('settle-accounts')]:[]),$('settle-cash'),$('settle-submit')];stepNodes.forEach((node,i)=>{const n=node.querySelector('.step-number');if(n)n.textContent=String(i+1);});
 $('settle-submit').querySelector('.step-heading p').textContent=temporary?'另一位指定人员复核现金清点，不转移资金，不锁定当天业务。':'另一位营业员完整复核，老板次日签认。核对和签认不会重复记账。';
 document.title=historyPage?'当日扎账查询':'当日扎账单';document.querySelector('header strong').textContent=historyPage?'当日扎账查询':'当日扎账单';
}
async function unifiedLoadTemporary(){
 const epoch=++unifiedEpoch;unifiedLoading=true;unifiedMode();$('submit-daily').disabled=true;$('settle-state').textContent='正在读取今天的现金依据…';
 const [people,shot,history]=await Promise.allSettled([api('/api/users'),api('/api/closeouts/preview'),unifiedHistory(false)]);
 if(epoch!==unifiedEpoch||!unifiedTemporary())return;
 if(people.status==='fulfilled'){$('reviewerId').innerHTML='<option value="">请选择另一位复核人</option>'+people.value.filter(u=>u.id!==me.id&&u.status==='active'&&(u.capabilities?.sell||u.roleCode==='owner')).map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>').join('');}
 if(history.status==='fulfilled'){records=history.value;renderHistory();}else $('history').textContent='记录读取失败：'+history.reason.message;
 if(shot.status==='fulfilled'){
   preview={...shot.value,date:shot.value.cashDate};$('openingCash').value=preview.openingCashSuggested??'';$('openingCash').readOnly=true;renderCash();$('settle-state').textContent='清点人：'+me.name+' · 截至 '+new Date(preview.countedAt||preview.endAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});$('submit-daily').disabled=people.status!=='fulfilled';
 }else{
   preview=null;$('openingCash').value='';$('openingCash').readOnly=true;$('cash-preview').textContent='现金账面尚未取得，不能据此核算差额，也不会默认为零。';$('settle-state').innerHTML=esc(shot.reason.message)+(me.roleCode==='owner'?' <a href="/assistant-finance?date='+today()+'">核实并保存现金期初依据 ›</a>':' 请交老板核实并保存现金期初依据。');
 }
 if(people.status!=='fulfilled')status('复核人员读取失败：'+people.reason.message,true);
 $('air-panel').hidden=true;unifiedLoading=false;
}
async function unifiedSubmitTemporary(form){
 if(unifiedLoading||!preview||!preview.cashBasisFingerprint)throw new Error('现金期初依据或账面尚未就绪，请先刷新核对');
 if(preview.date!==today())throw new Error('北京时间已换日，请刷新后重新清点');
 const body={recordType:form.elements.recordType.value,actualCash:Number(form.elements.actualCash.value),reviewerId:form.elements.reviewerId.value,note:form.elements.note.value.trim(),cashBasisFingerprint:preview.cashBasisFingerprint};
 const signature=JSON.stringify(body);if(unifiedAttempt&&unifiedAttempt.signature!==signature)throw new Error('上次提交结果待核对，请先查看记录，不要另开一笔');
 unifiedAttempt||={signature,key:crypto.randomUUID()};
 const r=await fetch('/api/closeouts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':unifiedAttempt.key},body:JSON.stringify(body)});
 let value;try{value=await r.json();}catch{throw new Error('结果未完整返回，请保留原输入并重试核对同一请求');}
 if(!r.ok){if(r.status<500)unifiedAttempt=null;throw new Error(value.error?.message||'保存未完成');}
 unifiedAttempt=null;$('actualCash').value='';$('daily-note').value='';status((value.recordType==='morning_cash_count'?'开门现金清点':'中途交班现金清点')+'已保存 · '+documentNo(value)+'，等待另一人复核。');await load();
}
$('history').addEventListener('click',async event=>{
 const b=event.target.closest('[data-legacy-action]');if(!b)return;const row=records.find(r=>r.legacyCheckpoint&&r.id===b.dataset.id);if(!row)return;
 const action=b.dataset.legacyAction,d=document.createElement('dialog');d.innerHTML='<form><h2>临时扎账 · '+esc(action)+'</h2><p>'+esc(documentNo(row))+' · '+esc(row.cashier)+' · 实点 '+money(row.actualCash)+'</p>'+(action==='补正'?'<label>重新清点现金<input name="actualCash" type="number" step="0.01" min="0" required></label>':'')+'<label>说明<textarea name="note" maxlength="500"'+(action==='确认'?'':' required')+'></textarea></label><p role="alert"></p><button type="submit">确认'+esc(action)+'</button><button type="button" data-cancel>取消</button></form>';document.body.append(d);d.querySelector('[data-cancel]').onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal();const key=crypto.randomUUID();
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target,submit=f.querySelector('[type=submit]');submit.disabled=true;try{const r=await api(action==='补正'?'/api/closeouts/revise':'/api/closeouts/confirm',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({id:row.id,note:f.elements.note.value.trim(),...(action==='补正'?{actualCash:Number(f.elements.actualCash.value)}:{decision:action})})});d.close();status('临时扎账处理已保存，没有资金转移。');await load();}catch(error){f.querySelector('[role=alert]').textContent=error.message;}finally{submit.disabled=false;}};
});
$('recordType').value=['formal','temporary','morning_cash_count'].includes(new URLSearchParams(location.search).get('recordType'))?new URLSearchParams(location.search).get('recordType'):'morning_cash_count';
$('recordType').onchange=()=>{if(unifiedAttempt){status('上次临时扎账提交结果待核对，请保留原类型核对。',true);$('recordType').value='temporary';return;}unifiedEpoch++;unifiedMode();load();};
unifiedMode();

load();

function renderFundAccounts(shot,values=[]){
 const book=shot.fundAccounts;if(!book)return;$('named-fund-accounts')?.remove();const valuesById=new Map((values||[]).map(r=>[r.id,r.actual]));
 renderScanSummary(book);const node=document.createElement('section');node.id='named-fund-accounts';node.className='metric-group';node.innerHTML='<h3>老板账户与其他账户</h3><p class="account-hint">扫码支付按具体到账账户归集；现金转存老板银行卡单列内部交接。核对净变动，不将它当作账户余额。</p><div class="fund-account-list">'+book.rows.map(a=>(a.id.startsWith('unresolved:微信:')||a.id.startsWith('unresolved:支付宝:')?'<details class="account-card"><summary>明细查询 · '+esc(a.name)+'</summary>':'<section class="account-card">')+'<div class="account-heading"><h4>'+esc(a.displayName||a.name)+'</h4><span class="account-tag">'+(a.identityStatus==='mapping_required'?'账户待核':a.scope==='personal'?'老板账户':'具体账户')+'</span></div><div class="account-check-row"><div><div class="money-strip"><div><span>当日收</span><strong>'+money(a.received)+'</strong></div><div><span>当日付</span><strong>'+money(a.paid)+'</strong></div><div><span>净变动</span><strong>'+money(a.net)+'</strong></div></div>'+(a.pending?'<p class="account-warning">另有 '+money(a.pending)+' 待接收人确认，尚未计入。</p>':'')+(a.scanReceived?'<p class="account-hint">其中扫码支付到账 '+money(a.scanReceived)+'</p>':'')+(a.identityStatus==='mapping_required'?'<p class="account-warning">仅有支付渠道，具体账户需核实。</p>':'')+'</div><label class="account-actual">实核当日净变动（元）<input type="number" step="0.01" inputmode="decimal" data-fund-id="'+esc(a.id)+'" placeholder="核对后填写" value="'+esc(valuesById.get(a.id)??'')+'"><small>本账户本日增加 − 减少</small></label></div><details><summary>明细查询 · 原单与流水 · '+a.entries.length+' 条</summary><p>'+esc(a.balanceStatus)+'</p><p>内部交入 '+money(a.internalReceived)+' · 内部交出 '+money(a.internalPaid)+' · 账务更正 '+money(a.adjustment)+'</p><div class="detail-list">'+(a.entries.map(e=>'<p>'+esc(e.displayNo||e.sourceId)+' · '+money(e.amount)+' · '+esc(e.collectionMethodLabel||e.kind)+(e.pending?' · 待确认，不计入':'')+'</p>').join('')||'<p>本日无记录；不表示余额为零。</p>')+'</div></details>'+(a.id.startsWith('unresolved:微信:')||a.id.startsWith('unresolved:支付宝:')?'</details>':'</section>')).join('')+'</div>';$('metrics').append(node);
}
function namedFundHistory(book,checks=[]){return '<section class="closeout-check-card"><h4>具体资金账户 · 逐项核对</h4>'+book.rows.map(a=>{const checked=(checks||[]).find(r=>r.id===a.id);return '<h4>'+esc(a.name)+'</h4><p>收 '+money(a.received)+' · 付 '+money(a.paid)+' · 净变动 '+money(a.net)+' · 待确认 '+money(a.pending)+'</p><p>实核 '+(checked?.actual==null?'未填':money(checked.actual))+' · 差额 '+(checked?.difference==null?'待核':money(checked.difference))+'</p>';}).join('')+'</section>';}

function renderScanSummary(book){
 $('scan-payment-summary')?.remove();const s=book.scanSummary;if(!s)return;const node=document.createElement('section');node.id='scan-payment-summary';node.className='account-card';node.innerHTML='<div class="account-heading"><h3>扫码支付汇总</h3><span class="account-tag">收款方式汇总</span></div><div class="money-strip"><div><span>当日收</span><strong>'+money(s.received)+'</strong></div><div><span>当日退</span><strong>'+money(s.paid)+'</strong></div><div><span>净变动</span><strong>'+money(s.net)+'</strong></div></div>'+(s.adjustment?'<p class="account-warning">账务更正 '+money(s.adjustment)+'，不代表实际付款；请查对应红冲原单。</p>':'')+'<p class="account-hint">'+esc(s.note)+'</p><details><summary>明细查询 · 扫码支付 · '+s.entries.length+' 笔</summary><div class="detail-list">'+(s.entries.map(r=>'<p><a href="'+esc(r.href)+'">'+esc(r.displayNo)+'</a> · '+money(r.amount)+' · '+esc(r.channel)+'<br><small>'+esc(r.accountName)+' · '+esc(r.operator)+' · '+esc(r.status)+'</small></p>').join('')||'<p>本营业日无扫码支付流水。</p>')+'</div></details>';$('metrics').append(node);
}
function renderAirQuery(){
 $('air-detail-query')?.remove();const rows=preview?.fundAccounts?.airDetails||[],date=preview?.date;if(!date)return;const node=document.createElement('details');node.id='air-detail-query';node.className='account-card';node.innerHTML='<summary>明细查询 · 移动BOSS期初、当日变动与结余</summary><p>期初来自此前累计及本日期初登记；本日净变动来自非期初记录。期末＝期初＋净变动。</p>'+['airOpening','airChange','airClosing'].map(key=>{const picked=rows.filter(r=>key==='airOpening'?r.date<date||r.kind==='opening':key==='airChange'?r.date===date&&r.kind!=='opening':true);return '<details id="query-'+key+'"><summary>'+esc(key==='airOpening'?'期初依据':key==='airChange'?'当日增减明细':'期末累计依据')+' · '+picked.length+' 条</summary><div class="detail-list">'+(picked.map(r=>'<p><a href="'+esc(r.href)+'">'+esc(r.displayNo)+'</a> · '+esc(r.date)+' · '+esc(r.kind)+' · '+money(r.amount)+' · '+esc(r.reference)+'</p>').join('')||'<p>没有对应明细，不能据此认定余额为零。</p>')+'</div></details>';}).join('');$('metrics').querySelector('.metric-group')?.append(node);
 for(const row of $('metrics').querySelectorAll('[data-metric]')){const link=document.createElement('button');link.type='button';link.className='detail-query-button';link.textContent='明细查询';link.onclick=()=>{node.open=true;const section=$('query-'+row.dataset.metric);section.open=true;section.scrollIntoView({block:'center',behavior:'smooth'});};row.firstElementChild.append(document.createElement('br'),link);}
}
