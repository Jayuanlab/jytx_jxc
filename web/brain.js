const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const qualitySection=document.createElement('section');qualitySection.className='panel';qualitySection.innerHTML='<h2>接待质量初判</h2><p id="reception-review-summary">正在核对接待单…</p><div id="reception-review-rows">正在读取…</div>';
$("findings").closest('section').after(qualitySection);
const qualityDialog=document.createElement('dialog');qualityDialog.innerHTML='<form method="dialog" id="quality-form"><h2>核定无效接待质量</h2><p id="quality-reference"></p><label>决定<select name="decision"><option value="approve">内容有用，奖励50分</option><option value="reject">暂不奖励</option><option value="revoke">撤销已发的50分</option></select></label><label>判定依据<textarea name="note" rows="4" required placeholder="写明来意、问题、住地或办理时间等有用线索"></textarea></label><p id="quality-error" role="alert"></p><button type="button" id="quality-cancel">取消</button><button type="submit" value="save">确认</button></form>';
document.body.append(qualityDialog);
$("quality-cancel").addEventListener('click',()=>qualityDialog.close());
$("reception-review-rows").addEventListener('click',event=>{const button=event.target.closest('button[data-quality-id]');if(!button)return;qualityDialog.dataset.id=button.dataset.qualityId;$("quality-reference").textContent='接待单 '+button.dataset.qualityNo+' · 请先查看原单，再核对真实性。';$("quality-error").textContent='';$("quality-form").reset();qualityDialog.showModal();});
$("quality-form").addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),note=form.elements.note.value.trim();if(!note){$("quality-error").textContent='请填写判定依据';return;}button.disabled=true;try{const response=await fetch('/api/receptions/quality-review',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({id:qualityDialog.dataset.id,decision:form.elements.decision.value,note})});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'核定失败');qualityDialog.close();await run();}catch(error){$("quality-error").textContent=error.message;}finally{button.disabled=false;}});
async function run() {
  $("status").textContent = "正在核对…";
  try {
    const r = await fetch("/api/system-check", { credentials: "same-origin" });
    if (r.status === 401) { $("status").innerHTML = '<a href="/login?next=/brain">请先用员工账号登录</a>'; $("findings").textContent = "登录后显示检查结果"; return; }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "检查失败");
    $("status").textContent = "检查完成：" + new Date(data.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const batch=await fetch('/api/batch-review',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);if(batch?.owner){let panel=document.getElementById('carrier-batch-policy');if(!panel){panel=document.createElement('section');panel.id='carrier-batch-policy';panel.className='panel';document.getElementById('findings').closest('section').after(panel);}const group=batch.groups.find(g=>g.key==='carrierBusinessReconciliation');panel.innerHTML='<h2>移动酬金登记核对</h2><p>待核 '+esc(group?.rows.length||0)+' 笔，可由老板勾选批量批复登记事实。每月按移动结算单另行比对；批复不记实际到账。</p><p>退换货、红冲、现金及内部交接逐笔审批。营业员收到现金属于门店现金，不能据此认定老板本人收到。</p><a href="/boss-batch?task=carrierBusinessReconciliation">打开移动酬金批量核对 ›</a>'; }
    const labels = { products: "商品档案总数", inStockModels: "在库型号", zeroStockProducts: "零库存档案", inventoryUnits: "在库件数", serials: "串码条数", sales: "销售单据", suppliers: "供货商", testProducts: "测试标记档案" };
    $("stats").innerHTML = Object.entries(data.stats).map(([k,v]) => `<div><span>${labels[k]}</span><b>${esc(v)}</b></div>`).join("");
    $("findings").innerHTML = data.findings.length ? data.findings.map((f) => `<article><div class="title">${esc(f.severity)}风险 · ${esc(f.summary)}</div><p>${esc(f.id)}</p></article>`).join("") : '<div class="ok">当前规则检查未发现异常</div>';
    const review=data.receptionReview||{total:0,invalid:0,pending:0,incomplete:0,rows:[]};
    $("reception-review-summary").textContent=`接待单共 ${review.total} 张 · 已判无效 ${review.invalid} 张 · 待结案确认 ${review.pending} 张 · 资料待补 ${review.incomplete} 张。数字大脑只给初判建议；今后新建接待若判无效，一律不计积分。`;
    $("reception-review-rows").innerHTML=review.rows.length?review.rows.map(row=>`<article class="reception-review-card"><strong>${esc(row.state)}</strong><p>来意、问题：${esc(row.needsPreview||'没有具体咨询内容')}</p><p>住地：${esc(row.residencePreview||'未记录')} · 计划时间：${esc(row.plannedAt||'未记录')}</p><small>${esc(row.displayNo)} · ${esc(row.ownerName)} · ${esc(row.validity)}</small>${row.reasons.length?`<p>核对点：${esc(row.reasons.join('；'))}</p>`:''}<p><a href="${esc(row.href)}">查看原接待单 ›</a>${row.validity==='无效'&&!row.serviceRuleNoPoints?` <button type="button" data-quality-id="${esc(row.id)}" data-quality-no="${esc(row.displayNo)}">核定质量奖励</button>`:''}</p></article>`).join(''):'<div class="ok">当前没有待核对或已判无效的接待单</div>';
  } catch (e) { $("status").textContent = e.message; $("findings").textContent = "请稍后重试"; }
}
$("run").addEventListener("click", run); run();
