const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(collection,row){if(!row?.id)return '';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return '<span class="red-packet-slot" data-rp-collection="'+esc(collection)+'" data-rp-source="'+esc(row.id)+'" hidden><button type="button" class="red-packet-request" data-rp-open>申请红包</button><small data-rp-state></small></span>'; }
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
const money = (n) => "¥" + Number(n || 0).toFixed(2);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
const groups = [
  ["新开卡／补卡", ["cardNew","cardReplace"]],
  ["话费充值", ["rechargeCount","rechargeAmount"]],
  ["融合宽带", ["fusionBroadband"]],
  ["套餐升档／降档", ["packageUp","packageDown"]],
  ["设备绑合约", ["deviceContract"]],
  ["空中充值", ["airOpening","airChange","airClosing"]],
  ["移动业务酬金", ["commissionExpected","commissionConfirmed","commissionReceived"]]
];
const checks = [["sales","交易与收付款"],["stock","库存增减"],["serials","贵重串码清点"],["cash","现金实点"],["mobile","移动BOSS七组"],["suppliers","往来余额"]];
let me, preview, records = [], air = [], selectedAction = null, resubmitId = "";
async function api(path, options={}) {
  const r = await fetch(path,{credentials:"same-origin",cache:"no-store",...options,headers:{...(options.body?{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()}:{}),...(options.headers||{})}});
  if (r.status===401) throw new Error("LOGIN");
  const data=await r.json();
  if (!r.ok) throw new Error(data.error?.message || "请求失败");
  return data;
}
const post=(path,data)=>api(path,{method:"POST",body:JSON.stringify(data)});
function status(message,error=false){$("status").textContent=message;$("status").classList.toggle("error-text",error);}
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
  const orderRows=(p.transactions||[]).slice(0,100).map((r)=>'<tr><td>'+esc(documentRef(r,"orderId"))+'</td><td>'+esc(r.product)+(r.serialNo?'<small>串码 '+esc(r.serialNo)+'</small>':'')+'</td><td>'+esc(r.quantity)+'</td><td>'+money(r.amount)+'</td><td>'+esc(r.account)+'</td><td>'+esc(r.operator)+'</td>'+(r.cost!=null?'<td>'+money(r.cost)+'</td><td>'+money(r.profit)+'</td>':'')+'</tr>').join("");
  $("summary").innerHTML =
    '<div class="daily-stats">'+
    stat("销售",p.salesCount+' 单 · '+money(p.salesAmount))+
    stat("退货",p.returnCount+' 单 · '+money(p.returnAmount))+
    stat("净销售",money(p.salesAmount-p.returnAmount))+
    (p.grossProfit==null?'':stat("毛利",money(p.grossProfit)))+
    stat("手机期初＋进－出＝期末",opening+'＋'+incoming+'－'+outgoing+'＝'+closing)+
    stat("库存流水",p.stockMovementCount+' 条')+
    stat("现金净变动",money(p.cashChange))+
    stat("已确认现金交接",money(p.cashHandoverConfirmed))+
    stat("待确认交接",String((p.cashHandoverPending||[]).length)+" 笔")+
    stat("移动业务",p.mobileServiceCount+' 笔')+'</div>'+
    '<details><summary>各账户净流水</summary><div class="account-list">'+Object.entries(p.accountTotals||{}).map(([key,value])=>'<p>'+esc(key)+' '+money(value)+'</p>').join('')+'</div></details>'+
    '<details><summary>库存品类与贵重串码</summary><p>'+[...categories].map(([name,qty])=>esc(name)+' '+qty+' 件').join(' · ')+'</p><div class="detail-list">'+phone.map((r)=>'<p><b>'+esc(r.name)+'</b> · '+esc(r.warehouse)+' · 期初 '+r.openingQuantity+' / 进 '+r.inQuantity+' / 出 '+r.outQuantity+' / 余 '+r.quantity+'<br><small>在库串码：'+esc(r.serials.join('、')||'无')+'</small></p>').join('')+'</div></details>'+
    (p.supplierTotals?'<details><summary>供货商往来余额</summary><p>应付 '+money(p.supplierTotals.payable)+' · 预付 '+money(p.supplierTotals.advance)+' · 往来款 '+money(p.supplierTotals.cash)+'</p></details>':'')+
    '<details><summary>当日销售逐笔明细（最多显示 100 行）</summary><div class="detail-list"><table><thead><tr><th>单号</th><th>商品/串码</th><th>数量</th><th>金额</th><th>收款</th><th>经办</th>'+(p.transactions?.[0]?.cost!=null?'<th>成本</th><th>毛利</th>':'')+'</tr></thead><tbody>'+orderRows+'</tbody></table></div></details>';
}
function renderMetrics(rows, values={}) {
  const byKey=new Map(rows.map((r)=>[r.key,r]));
  $("metrics").innerHTML=groups.map(([title,keys])=>'<section class="metric-group"><h3>'+esc(title)+'</h3>'+keys.map((key)=>{
    const r=byKey.get(key);if(!r)return "";
    const own=r.own==null?'<span class="unknown">待补数据</span>':esc(r.own)+' '+esc(r.unit);
    const value=values[key]??r.boss??"";
    return '<div class="metric-row" data-metric="'+esc(key)+'" data-own="'+(r.own==null?'':esc(r.own))+'"><span>'+esc(r.label)+' · '+esc(r.unit)+'</span><span><small>我方账</small><br><strong>'+own+'</strong></span><label>移动BOSS<input name="metric_'+esc(key)+'" type="number" step="'+(r.unit==='笔'?'1':'0.01')+'" '+(r.unit==='笔'?'min="0" ':'')+'inputmode="decimal" value="'+esc(value)+'"></label><span class="metric-diff">待填写</span></div>';
  }).join('')+'</section>').join('');
  for(const input of $("metrics").querySelectorAll("input"))input.addEventListener("input",()=>updateMetric(input.closest(".metric-row")));
  for(const row of $("metrics").querySelectorAll(".metric-row"))updateMetric(row);
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
  const opening=Number($("openingCash").value||0),actual=Number($("actualCash").value||0);
  const expected=Math.round((opening+Number(preview.cashChange||0)-Number(preview.cashHandoverConfirmed||0))*100)/100;
  const difference=Math.round((actual-expected)*100)/100;
  $("cash-preview").textContent="期初 "+money(opening)+" ＋ 今日现金净变动 "+money(preview.cashChange)+" － 已确认交接 "+money(preview.cashHandoverConfirmed)+" ＝ 应点 "+money(expected)+"；实点 "+money(actual)+"；差异 "+money(difference)+(preview.cashHandoverPending?.length?"；另有 "+preview.cashHandoverPending.length+" 笔交接待接收人确认":"");
  $("cash-preview").classList.toggle("mismatch",difference!==0);
}
function buttons(row){
  const bits=[redPacketEntry('dailyCloseouts',row)];
  if(row.reviewerId===me.id&&row.status==="待领取复核")bits.push('<button data-action="claim" data-id="'+esc(row.id)+'">领取复核</button>');
  if(row.reviewerId===me.id&&row.status==="复核中"){bits.push('<button data-action="pass" data-id="'+esc(row.id)+'">逐栏复核通过</button>');bits.push('<button class="secondary" data-action="reject" data-id="'+esc(row.id)+'">驳回</button>');}
  if(row.reviewerId===me.id&&row.status==="待老板签认")bits.push('<button class="secondary" data-action="reject" data-id="'+esc(row.id)+'">退回重核</button>');
  if(row.cashierId===me.id&&row.status==="已驳回")bits.push('<button data-action="resubmit" data-id="'+esc(row.id)+'">补正再提交</button>');
  if(me.roleCode==="owner"&&row.status==="待老板签认")bits.push('<button data-action="lock" data-id="'+esc(row.id)+'">老板签认锁定</button>');
  if(me.roleCode==="owner"&&row.status==="已锁定")bits.push('<button class="secondary" data-action="unlock" data-id="'+esc(row.id)+'">老板解锁</button>');
  return bits.length?'<div class="record-actions">'+bits.join("")+'</div>':"";
}
function renderHistory(){
  $("history").innerHTML=records.length?records.map((r)=>{
    const bad=(r.snapshot.mobile||[]).filter((m)=>m.status!=="一致");
    return '<article class="close-record"><h3>'+esc(r.date)+' · '+esc(r.status)+'</h3><small>'+esc(documentNo(r))+' · '+esc(r.cashier)+' → '+esc(r.reviewer)+'</small>'+
      '<p>销售 '+r.snapshot.salesCount+' 单 · 退货 '+r.snapshot.returnCount+' 单 · 现金应点 '+money(r.expectedCash)+' / 实点 '+money(r.actualCash)+' / 差异 <b class="'+(r.cashDifference?'mismatch':'match')+'">'+money(r.cashDifference)+'</b></p>'+
      '<p>移动BOSS：'+(bad.length?'<b class="warn-text">'+bad.length+' 项待核/有差异</b>':'<b class="match">已一致</b>')+'</p>'+
      (r.reviewNote?'<p>复核意见：'+esc(r.reviewNote)+'</p>':'')+(r.lockNote?'<p>老板签认：'+esc(r.lockNote)+'</p>':'')+(r.unlockNote?'<p>老板已解锁该日期：'+esc(r.unlockNote)+'</p>':'')+
      '<details><summary>查看七组核对与操作记录</summary>'+r.snapshot.mobile.map((m)=>'<p>'+esc(m.label)+'：我方 '+esc(m.own??'待补')+' / 移动BOSS '+esc(m.boss??'未录')+' / <span class="'+(m.status==='有差异'?'mismatch':'')+'">'+esc(m.status)+'</span></p>').join('')+'<hr>'+r.events.map((e)=>'<p>'+esc(e.type)+' · '+esc(e.by)+' · '+esc(e.at)+(e.note?' · '+esc(e.note):'')+'</p>').join('')+'</details>'+buttons(r)+'</article>';
  }).join(''):'<p class="hint">暂无正式扎账单。</p>';
}
function renderAir(){
  $("air-panel").hidden=!me.capabilities.finance;
  if(!me.capabilities.finance)return;
  $("air-history").innerHTML=air.slice(0,20).map((e)=>'<p>'+esc(e.businessDate)+' · '+esc(e.kind==='funding'?'平台充值入金':e.kind)+' '+money(e.amount)+(e.kind==='funding'?'（实际转出 '+money(e.paidAmount)+'；差额 '+money(e.difference)+' 待核）':'')+' · 余额 '+money(e.balance)+' · 流水 '+esc(e.reference)+'</p>'+redPacketEntry('airRechargeEvents',e)).join('')||'<p class="hint">尚未登记空充期初。</p>';
  $("air-form").elements.kind.querySelector('option[value="opening"]').disabled=air.some((e)=>e.kind==="opening")||me.roleCode!=="owner";
  if($("air-form").elements.kind.value==="opening"&&$("air-form").elements.kind.querySelector('option[value="opening"]').disabled)$("air-form").elements.kind.value="increase";
}
async function load(){
  try{
    me=await api("/api/me");
    const [users,shot,rows]=await Promise.all([api("/api/users"),api("/api/daily-closeouts/preview"),api("/api/daily-closeouts")]);
    preview=shot;records=rows;
    air=me.capabilities.finance?await api("/api/air-recharge"):[];
    $("reviewerId").innerHTML='<option value="">请选择另一名营业员</option>'+users.filter((u)=>u.id!==me.id&&u.status==="active"&&u.roleCode!=="owner"&&u.capabilities.sell).map((u)=>'<option value="'+esc(u.id)+'">'+esc(u.name)+' · '+esc(u.role)+'</option>').join("");
    if(!resubmitId){$("openingCash").value=shot.openingCashSuggested??0;$("openingCash").readOnly=shot.openingCashSuggested!=null;$("actualCash").value=Math.max(0,Number($("openingCash").value)+Number(shot.cashChange)).toFixed(2);renderMetrics(shot.mobile);}
    renderSummary();renderCash();renderHistory();renderAir();
  }catch(error){
    $("summary").innerHTML=error.message==="LOGIN"?'<a href="/login?next=/daily-close">请先用员工账号登录</a>':esc(error.message);
    $("metrics").textContent=error.message==="LOGIN"?"登录后显示移动BOSS核对项":error.message;
    status(error.message==="LOGIN"?"登录后可提交正式扎账":error.message,true);
  }
}
$("refresh").addEventListener("click",load);
$("openingCash").addEventListener("input",renderCash);$("actualCash").addEventListener("input",renderCash);
$("daily-form").addEventListener("submit",async(event)=>{
  event.preventDefault();const f=event.currentTarget;const button=$("submit-daily");button.disabled=true;
  try{
    const manual={};for(const row of $("metrics").querySelectorAll(".metric-row"))manual[row.dataset.metric]=row.querySelector("input").value===""?null:Number(row.querySelector("input").value);
    const payload={date:today(),reviewerId:f.elements.reviewerId.value,openingCash:Number(f.elements.openingCash.value),actualCash:Number(f.elements.actualCash.value),note:f.elements.note.value,manual};
    const path=resubmitId?"/api/daily-closeouts/resubmit":"/api/daily-closeouts";
    if(resubmitId){payload.id=resubmitId;delete payload.date;delete payload.reviewerId;}
    const result=await post(path,payload);resubmitId="";button.textContent="提交今日扎账，请另一人复核";
    status("已提交："+documentNo(result)+"；等待另一名营业员领取复核。");await load();
  }catch(error){status(error.message,true);}finally{button.disabled=false;}
});
$("air-funding-form").addEventListener("submit",async(event)=>{
  event.preventDefault();const f=event.currentTarget;const b=f.querySelector('button[type="submit"]');b.disabled=true;
  try{const d=Object.fromEntries(new FormData(f));await post("/api/air-recharge/funding",{...d,paidAmount:Number(d.paidAmount),creditedAmount:Number(d.creditedAmount)});status("平台充值已登记；扣款差额待核。");f.reset();await load();}
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
  const action=b.dataset.action;
  if(action==="resubmit"){
    resubmitId=row.id;$("reviewerId").value=row.reviewerId;$("submit-daily").textContent="补正并重新提交 "+row.date;
    $("openingCash").readOnly=false;$("openingCash").value=row.openingCash;$("actualCash").value=row.actualCash;$("daily-note").value=row.note||"";
    preview=row.snapshot;renderSummary();renderMetrics(row.snapshot.mobile,row.manual);renderCash();$("daily-form").scrollIntoView({behavior:"smooth",block:"start"});return;
  }
  if(action==="claim"){
    try{await post("/api/daily-closeouts/claim",{id:row.id});status("复核任务已领取，请逐栏核对后再通过。");await load();}
    catch(error){status(error.message,true);}return;
  }
  selectedAction={action,id:row.id};
  $("action-title").textContent={pass:"逐栏复核通过",reject:"驳回扎账单",lock:"老板签认锁定",unlock:"老板解锁日期"}[action];
  $("action-info").textContent=row.date+" · "+documentNo(row)+" · "+row.cashier+" → "+row.reviewer;
  $("action-form").elements.note.value="";
  $("action-error").textContent="";
  $("action-checks").innerHTML=action==="pass"?'<p>逐栏检查无误后勾选：</p>'+checks.map(([key,label])=>'<label class="check-row"><input type="checkbox" name="check_'+key+'"> '+label+'</label>').join(''):"";
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
    await post(path,payload);$("action-dialog").close();status("处理完成。");await load();
  }catch(error){$("action-error").textContent=error.message;}finally{b.disabled=false;}
});
load();

