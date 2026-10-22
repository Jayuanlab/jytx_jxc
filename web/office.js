const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(collection,row){if(!row?.id)return '';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return '<span class="red-packet-slot" data-rp-collection="'+esc(collection)+'" data-rp-source="'+esc(row.id)+'" hidden><button type="button" class="red-packet-request" data-rp-open>申请红包</button><small data-rp-state></small></span>'; }
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $ = (id) => document.getElementById(id);
const E = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const M = (value) => `¥${Number(value || 0).toFixed(2)}`;
const shortInternalNo = (value) => String(value || "").replace(/^([A-Z]{2,5})-([0-9a-f]{8})-[0-9a-f-]{20,}$/i, "$1-$2");
const labels = {
  order: { completed: "已完成", returned: "已退货", "partially-returned": "部分退货", partial_return:"部分退货" },
  plan: { open: "待收货", closed: "已终止", received: "已收齐" },
  settlement: { payment: "付款核销", refund: "收到退款", offset: "货款抵扣", opening: "期初登记", reverse: "撤销核销" },
  receipt: { sale: "销售收款", refund: "销售退款", purchase: "采购付款", supplier_payment: "往来单位付款", supplier_refund: "往来单位退款", expense: "门店费用", expense_red: "费用红冲（账务更正）", carrier: "佣金到账", carrier_clawback: "佣金扣回", carrier_rental: "移动业务结算到账", gov_subsidy: "国补平台返款", gov_subsidy_refund: "国补原路退回", payroll: "工资发放" },
  payroll: { draft: "待确认", confirmed: "已确认", paid: "已发放", incomplete: "待核算" },
  rule: { piece: "按件", profit: "按毛利比例", none: "不提成" },
  audit: { "api:write": "业务操作", "user:create": "新增员工", "user:status": "员工状态变更", "user:permissions":"员工权限修改", "backup:create":"生成门店备份", "backup:restore":"恢复门店备份", "user:bind": "绑定微信", "user:feishu-bootstrap": "绑定老板飞书", "user:feishu-bind": "绑定员工飞书", "product:save": "保存商品", "product:service-reclassify": "收费项目归类", "product:price-request": "申请商品调价", "product:price-review": "审核商品调价", "purchase:create": "采购入库", "sale:create": "销售开单", "sale:return": "销售退货", "sale:exchange":"销售换货", "receipt:create":"登记收款单", "payment:create":"登记付款单", "carrier:event": "号卡佣金", "stock:count": "库存盘点", "stock:transfer": "库存调拨", "stock:blind-compare": "实点表核对", "stock:blind-review": "核实盘点差异", "stock:serial-count": "串号盘库", "stock:bind-serials": "补录串号", "stock:serial-review": "核实盘库差异", "expense:create": "登记费用", "expense:red-request": "申请费用红冲", "expense:red-review": "审核费用红冲", "commission:rule": "设置提成规则", "commission:resolve": "补录提成", "salary:change": "设置底薪", "payroll:confirm": "确认工资", "payroll:paid": "发放工资", "payroll:adjustment": "工资增减", "supplier:save": "保存往来单位", "supplier:payment": "往来单位付款", "supplier:refund": "往来单位退款", "supplier:offset": "抵扣货款", "supplier:reverse-offset": "撤销抵扣", "supplier:opening": "往来单位期初", "supplier:adjustment": "往来调整", "supplier:plan-offset": "订货预付抵扣", "supplier:plan": "建立订货", "supplier:close-plan": "终止订货", "supplier:price": "调价补差", "supplier:return": "采购退货" },
};
const label = (group, value) => labels[group]?.[value] || value || "—";
function displayTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const state = { user: null, token: sessionStorage.getItem("officeLocalToken") || "", tab: "dashboard", inventory: [], products: [], users: [], salesCart: [], saleDraft: null, supplierId: "", orders: [], receptions: [], searchSynonyms: [], warehouses: [] };
const accounts = ["微信", "支付宝", "现金", "银行卡", "云闪付"];

async function api(path, options = {}) {
  const writing = options.method === "POST", controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    let response;
    try { response = await fetch(path, { credentials: "same-origin", ...options, signal: controller.signal, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(state.token ? { Authorization: "Bearer " + state.token } : {}), ...(options.headers || {}) } }); }
    catch { const error = new Error(writing ? "网络连接中断，提交结果待核对。请按原内容重试核对原单，勿另开一单。" : "网络连接失败，请稍后刷新。"); error.uncertain = writing; throw error; }
    let body;
    try { const contentType = response.headers.get("content-type") || ""; body = contentType.includes("json") ? await response.json() : await response.text(); }
    catch { const error = new Error(writing ? "未收到完整提交结果，请按原内容重试核对原单。" : "服务器返回内容无法识别，请稍后刷新。"); error.uncertain = writing; throw error; }
    if (!response.ok) { const error = new Error(response.status === 401 ? "登录已失效，请重新登录；本次填写内容仍保留。" : body?.error?.message || body?.message || "请求失败（" + response.status + "）"); error.status = response.status; error.uncertain = writing && response.status >= 500; throw error; }
    if (writing && (!body || typeof body !== "object" || Array.isArray(body) || (path === "/api/sale-orders" && (typeof body.id !== "string" || !body.id.trim())))) { const error = new Error("未收到可识别的提交结果，请按原内容重试核对原单。"); error.uncertain = true; throw error; }
    return body;
  } finally { clearTimeout(timer); }
}
function requestId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const b=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(b);else for(let i=0;i<16;i++)b[i]=Math.random()*256;return "req-"+Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
function post(path, data, attempt = null) {
  const signature = JSON.stringify([path, data]);
  if (attempt?.uncertain && attempt.signature !== signature) {
    const error = new Error("上次提交结果尚未确认，请恢复原内容重试核对原单；确认后再修改资料。"); error.uncertain = true; return Promise.reject(error);
  }
  if (attempt && attempt.signature !== signature) { attempt.signature = signature; attempt.key = requestId(); }
  const key = attempt ? attempt.key : requestId();
  return api(path, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(data) }).then(
    result => { if (attempt) attempt.uncertain = false; return result; },
    error => { if (attempt) attempt.uncertain = error.uncertain === true; throw error; }
  );
}
function guardPendingExit(event) {
  const root = $("modal-root");
  if (!state.saleSubmitting && !state.saleAttempt?.uncertain && root?.dataset.submitting !== "1" && root?.dataset.uncertain !== "1") return;
  event.preventDefault(); event.returnValue = "";
}
window.addEventListener("beforeunload", guardPendingExit);
function toast(message, error = false) { const target = $("toast"); target.textContent = message; target.style.background = error ? "#a72c2c" : "#20314f"; target.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => target.classList.remove("show"), 5000); }
let pageHelpSequence=0;
function heading(title, subtitle = "", controls = "") { const id="office-help-"+(++pageHelpSequence); return `<div class="heading"><div class="page-title-with-help"><h1>${E(title)}</h1><button type="button" class="page-help-button" data-help-all>? 帮助</button></div><div class="actions">${controls}</div></div>${subtitle?`<template id="${id}" data-page-help-template="${E(title)}"><p>${E(subtitle)}</p></template>`:""}`; }
function button(label, action, value = "", cls = "secondary") { return `<button type="button" class="${cls}" data-action="${E(action)}" data-value="${E(value)}">${E(label)}</button>`; }
function table(headers, rows) { return `<div class="table-wrap"><table><thead><tr>${headers.map((v) => `<th>${E(v)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`; }
function option(value, label, selected = false) { return `<option value="${E(value)}"${selected ? " selected" : ""}>${E(label)}</option>`; }
function formField(f) {
  const val = E(f.value ?? "");
  const placeholder = f.placeholder ? ` placeholder="${E(f.placeholder)}"` : "";
  let control;
  if (f.options) control = `<select name="${E(f.name)}"${f.required ? " required" : ""}>${f.options.map((o) => option(o.value ?? o, o.label ?? o, String(o.value ?? o) === String(f.value ?? ""))).join("")}</select>`;
  else if (f.type === "textarea") control = `<textarea name="${E(f.name)}"${placeholder}${f.required ? " required" : ""}>${val}</textarea>`;
  else if (f.type === "checkbox") control = `<input name="${E(f.name)}" type="checkbox"${f.value ? " checked" : ""}>`;
  else control = `<input name="${E(f.name)}" type="${E(f.type || "text")}" value="${val}"${placeholder}${f.required ? " required" : ""}${f.min != null ? ` min="${E(f.min)}"` : ""}${f.step ? ` step="${E(f.step)}"` : ""}>`;
  const search=f.searchable!==false&&f.options?.length>8?`<input class="select-filter" type="search" aria-label="搜索${E(f.label)}" placeholder="输入名称、编号或关键词筛选" autocomplete="off">`:"";
  return `<div class="field${f.wide ? " wide" : ""}${f.required ? " required-field" : ""}"><label>${E(f.label)}${f.required ? ' <b class="required-tag">必填</b>' : ""}</label>${search}${control}${f.inlineHint ? `<small class="field-limit">${E(f.inlineHint)}</small>` : ""}${f.hint ? `<small class="operation-tip" data-page-explanation>${E(f.hint)}</small>` : ""}</div>`;
}
const originalSelectOptions=new WeakMap();
function exposeNewChoice(form,name,value,targetName){
 const select=form.elements[name];if(!select||select.disabled||(!state.user?.capabilities.manageProducts&&value==='__custom__'))return;
 if(!document.querySelector('link[data-business-options-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/business-options-ui.css';link.dataset.businessOptionsStyle='1';document.head.append(link);}
 const row=document.createElement('div');row.className='option-add-row';select.before(row);row.append(select);const add=document.createElement('button');add.type='button';add.className='secondary';add.textContent='＋新增';add.setAttribute('aria-label','新增'+({type:'一级分类',subType:'二级分类',thirdType:'三级分类',unit:'计量单位',supplierId:'往来单位'}[name]||'选项'));row.append(add);
 add.addEventListener('click',()=>{const root=form.closest('#modal-root');if(root?.dataset.submitting==='1'||root?.dataset.uncertain==='1')return;const search=select.closest('.field')?.querySelector('.select-filter');if(search){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));}if(![...select.options].some(x=>x.value===value)){toast('新增选项未载入，请清空搜索后重试',true);return;}if(select.value!==value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}form.elements[targetName]?.focus();});
}
document.addEventListener("input",(event)=>{
  if(!event.target.matches(".select-filter"))return;
  const select=event.target.closest(".field")?.querySelector("select");if(!select)return;
  if(!originalSelectOptions.has(select))originalSelectOptions.set(select,Array.from(select.options,option=>option.cloneNode(true)));
  const all=originalSelectOptions.get(select),term=event.target.value.trim().toLowerCase(),selected=select.value;
  const matches=term?all.filter(option=>(option.textContent+" "+option.value).toLowerCase().includes(term)):all;
  select.replaceChildren(...matches.map(option=>option.cloneNode(true)));
  if(!matches.some(option=>option.value===selected)){
    select.prepend(new Option(matches.length?"请选择匹配项":"没有匹配项，请清空搜索重选","",true,true));
    select.value="";
  }else select.value=selected;
});

function modalPaymentCents(value){const s=String(value??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)&&n<=10000000000?n:null;}
function mountModalPayments(root,form,options,errorBox){
 const host=document.createElement('div');host.className='field wide';host.setAttribute('data-modal-payments','');form.querySelector('.fields').append(host);
 const submitButton=form.querySelector('button[type=submit]'),actor=state.user?.id;let controller=null,loading=true,failed='',accountData=null,controllerMode='';
 const active=()=>options.when?options.when(form):true;
 const total=()=>typeof options.totalCents==='function'?options.totalCents(form):Number.isSafeInteger(options.totalCents)?options.totalCents:modalPaymentCents(form.elements.amount?.value);
 const current=()=>root.isConnected&&$('modal-root')===root&&state.user?.id===actor;
 const mode=()=>typeof options.mode==='function'?options.mode(form):options.mode||'pay';
 const create=(initialParts)=>{controller?.destroy();controllerMode=mode();controller=window.PaymentSplits.mount({container:host,accounts:accountData,totalCents:total,initialParts,legacy:options.legacy||{account:options.defaultAccount||'微信'},people:state.users.filter(u=>u.status==='active'&&(u.capabilities.financeReceive||u.capabilities.finance)).map(u=>({id:u.id,name:u.name})),mode:controllerMode,requireReference:options.requireReference===true});};
 const sync=()=>{host.hidden=!active();if(controller&&controllerMode!==mode())create(controller.getParts());if(controller)controller.refresh();if(!root.dataset.submitting)submitButton.disabled=loading&&active();};
 form.addEventListener('input',sync);form.addEventListener('change',sync);sync();
 (async()=>{try{
  if(!window.PaymentSplits)throw new Error('分笔收付款功能尚未加载，请刷新页面后重试。');
  const response=await window.PaymentSplits.loadAccounts();if(!current())return;
  accountData=response;create();
 }catch(error){if(current()){failed=error.message||'账户读取失败，请刷新后重试';host.textContent=failed;errorBox.textContent=failed;}}finally{loading=false;if(current())sync();}})();
 return {validate(){if(!active())return {ok:true,parts:null};if(loading)return {ok:false,error:'正在读取收付款账户，请稍候。'};if(failed||!controller)return {ok:false,error:failed||'收付款区域未准备好，请刷新后重试。'};if(!current())return {ok:false,error:'登录身份或表单已经变化，请重新打开。'};return controller.validate();},destroy(){form.removeEventListener('input',sync);form.removeEventListener('change',sync);controller?.destroy();}};
}
function receiptAccountLabel(row){const name=row.accountName||row.accountSnapshot?.name;return name?name+' · '+(row.account||row.accountSnapshot?.channel||''):row.account||'未记录账户';}

function modal(title, fields, submit, description = "", paymentOptions = null) {
  if(paymentOptions)fields=fields.filter(f=>!["account","accountOwnerId","reference"].includes(f.name));
  const existing = $("modal-root");
  if (existing?.dataset.submitting === "1" || existing?.dataset.uncertain === "1") throw new Error("本单正在提交或结果待核对，请先按原内容重试核对后再操作。");
  existing?.remove();
  const root = document.createElement("div"); root.id = "modal-root"; root.className = "modal";
  root.innerHTML = '<div class="modal-content"><div class="page-title-with-help"><h2>' + E(title) + '</h2><button type="button" class="page-help-button" data-help-all data-modal-help>? 帮助</button></div>' + (description ? '<p class="muted">' + E(description) + '</p>' : '') + '<form id="modal-form" novalidate><div class="fields">' + fields.map(formField).join("") + '</div><div class="form-actions"><button class="primary" type="submit">确认提交</button>' + button("取消", "close-modal") + '</div><p id="modal-error" class="error" role="alert"></p></form></div>';
  document.body.append(root);
  const form = root.querySelector("#modal-form"), errorBox = root.querySelector("#modal-error"), attempt = {};
  let redPacketSaved=null;
  const write = async(path,data)=>{const result=await post(path,data,attempt);const collection=({"/api/inventory/transfers":"stockTransfers","/api/financial-documents":"receipts","/api/expenses":"expenses","/api/card-events":"cardEvents","/api/supplier-payments":"supplierCash","/api/supplier-refunds":"supplierCash","/api/supplier-offsets":"supplierSettlements","/api/supplier-adjustments":"supplierAdjustments","/api/supplier-price-adjustments":"supplierAdjustments","/api/procurement-plans":"procurementPlans","/api/purchase-orders":"purchases","/api/sale-return-requests":"saleReturnRequests","/api/purchase-return-requests":"purchaseReturnRequests","/api/red-reversals":"redReversals"})[path];if(collection&&result?.id)redPacketSaved={collection,row:result};return result;};
  const paymentControl = paymentOptions ? mountModalPayments(root,form,paymentOptions,errorBox) : null;
  let busy = false, committed = false;
  for (const ev of ["input", "change"]) root.addEventListener(ev, e => { const el = e.target; if (el.matches("input,select,textarea") && el.checkValidity()) el.setAttribute("aria-invalid", "false"); });
  root.addEventListener("click", event => { if (event.target === root && !busy && !attempt.uncertain) root.remove(); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || committed) return;
    const invalid = [...form.querySelectorAll("input,select,textarea")].filter(el => !el.disabled && !el.closest("[hidden]") && !el.closest("[data-modal-payments]") && (!el.checkValidity() || (el.required && el.type !== "checkbox" && !el.value.trim())));
    if (invalid.length) { invalid.forEach(el => el.setAttribute("aria-invalid", "true")); const missing = [...new Set(invalid.map(el => fields.find(f => f.name === el.name)?.label || el.name))]; errorBox.textContent = "尚未提交，请填写或重新选择：" + missing.join("、") + "。"; invalid[0].scrollIntoView({ block: "center" }); invalid[0].focus({ preventScroll: true }); return; }
    const paymentResult=paymentControl?.validate();if(paymentResult&&!paymentResult.ok){errorBox.textContent=paymentResult.error;root.querySelector("[data-modal-payments]")?.scrollIntoView({block:"center"});return;}
    const data = Object.fromEntries(new FormData(form));
    if(paymentResult?.parts)data.payments=paymentResult.parts;
    for (const field of fields.filter(f => f.type === "checkbox")) data[field.name] = form.elements[field.name].checked;
    const controls = [...form.querySelectorAll("input,select,textarea,button")].map(el => [el, el.disabled]);
    const submitButton = form.querySelector("button[type=submit]"), caption = submitButton.textContent;
    busy = true; root.dataset.submitting = "1"; controls.forEach(([el]) => el.disabled = true); submitButton.textContent = "正在提交…"; errorBox.textContent = "";
    try {
      const result = await submit(data, write);
      if (result === false) return;
      committed = true; root.remove(); toast(result?.message || "操作已完成");
      try { await loadBasics(); await render(); if (result?.nextStep) $(result.nextStep)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
      catch { toast("已保存" + (result?.id ? "，单号 " + documentNo(result) : "") + "；列表刷新失败，请稍后刷新，无需重新提交。", true); }
      if(redPacketSaved)$("main").insertAdjacentHTML("afterbegin",`<section class="card red-packet-saved"><strong>本次已保存：${E(documentNo(redPacketSaved.row))}</strong>${redPacketEntry(redPacketSaved.collection,redPacketSaved.row)}</section>`);
    } catch (error) {
      if (root.isConnected && !committed) { const uncertain=error.uncertain||attempt.uncertain;root.dataset.uncertain = uncertain ? "1" : ""; errorBox.textContent = (uncertain ? "提交结果待核对：" : "") + error.message; errorBox.scrollIntoView({ block: "center" }); }
    } finally {
      busy = false; delete root.dataset.submitting;
      if (!committed) { controls.forEach(([el, disabled]) => el.disabled = disabled); submitButton.textContent = root.dataset.nextSubmitCaption || caption; }
    }
  });
}
const moneyField = (name, label, value = "") => ({ name, label, type: "number", min: 0, step: "0.01", value, required: true });
const qtyField = (name, label, value = 1) => ({ name, label, type: "number", min: 1, step: 1, value, required: true });
const accountField = { name: "account", label: "收付款账户", options: accounts };

const navItems = [
  ["dashboard", "首页"], ["sales", "开单"], ["sales-list", "销售清单"], ["orders", "销售单查询"], ["returns", "退换货"], ["inventory", "库存查询"], ["stocktake", "库存盘点"],
  ["purchase", "订货与入库"], ["suppliers", "往来单位往来"], ["finance", "资金收支流水"], ["receipts", "收款单"], ["payments", "付款单"], ["red", "单据红冲"],
  ["products", "商品管理"], ["cards", "号卡佣金"], ["payroll", "工资查询与管理"],
  ["duties", "值日与工作分工"], ["used-phones", "二手机拍照评估"], ["reports", "日报"], ["staff", "员工管理与权限"], ["opening", "期初导入"], ["logs", "操作日志"], ["backup", "备份与恢复"],
];
const requiredCaps = { stocktake: "stocktake", sales: "sell", purchase: "purchase", suppliers: "supplierView", finance: "finance", receipts: "finance", payments: "finance", red: null, returns: "returnSale", products: "manageProducts", payroll: null, staff: "manageUsers", opening: "opening", logs: "manageUsers", backup: "manageUsers" };
const deepLinkTab=new URLSearchParams(location.search).get("tab");
let requestedReceptionId=new URLSearchParams(location.search).get("reception")||"";
if(navItems.some(([id])=>id===deepLinkTab))state.tab=deepLinkTab;
state.orderQuery=new URLSearchParams(location.search).get("q")||"";
state.documentQueries={[deepLinkTab||"orders"]:state.orderQuery};
state.payrollView=new URLSearchParams(location.search).get("view")==="manage"?"manage":"details";
state.payrollEmployeeId=new URLSearchParams(location.search).get("employeeId")||"";
const requestedPayrollMonth=new URLSearchParams(location.search).get("month")||"";
if(deepLinkTab==="payroll"&&/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPayrollMonth))state.month=requestedPayrollMonth;
function renderNav() {
  const caps = state.user?.capabilities || {};
  $("nav").innerHTML = navItems.filter(([id]) => id==='used-phones'?(caps.usedPhoneAssess||caps.usedPhoneReview):id==='red'?(caps.redRequest||caps.redReview):!requiredCaps[id] || caps[requiredCaps[id]]).map(([id, label]) => `<button type="button" data-tab="${id}" class="${id === state.tab ? "active" : ""}">${label}</button>`+(id==="inventory"&&(caps.sell||caps.purchase||caps.stocktake||caps.manageProducts)?'<button type="button" data-action="repair-materials">维修 · 手机膜</button>':"")+(id==="inventory"&&(state.user?.roleCode==="owner"||caps.createPaymentAccounts)?'<button type="button" data-action="payment-accounts">收付款账户</button>':"")+(id==="orders"&&(state.user?.roleCode==="owner"||caps.sell)?'<a class="secondary" href="/order-red-packets">单据红包</a>':"")+(id==="backup"&&state.user?.roleCode==="owner"?'<button type="button" data-action="system-readiness">推广准备与设备检查</button>':"")).join("");
}
let officeViewVersion=0,orderQueryVersion=0,giftRulesLoading=null;
function officePageCurrent(tab=state.tab) {
  const version=officeViewVersion,main=$("main");
  return ()=>version===officeViewVersion&&state.tab===tab&&$("main")===main&&main?.isConnected!==false;
}
async function officePageRead(current,read) {
  try { return await read(); } catch(error) { if(current())throw error; }
}
async function ensureGiftRules(){
  if(state.giftRules)return;
  if(!giftRulesLoading)giftRulesLoading=window.Gifts.loadRules();
  const pending=giftRulesLoading;try{await pending;}finally{if(giftRulesLoading===pending)giftRulesLoading=null;}
}
let officeBasicsVersion=0;
async function loadBasics() {
  const version=++officeBasicsVersion,token=state.token,userId=state.user?.id;
  const current=()=>version===officeBasicsVersion&&state.token===token&&state.user?.id===userId;
  const data=await officePageRead(current,()=>Promise.all([api("/api/inventory"), api("/api/products"), api("/api/users"), api("/api/receptions"), api("/api/search?scope=meta"), api("/api/warehouses")]));
  if(!current())return;
  const [inventory, products, users, receptions, searchMeta, warehouses]=data;
  state.inventory = inventory; state.products = products; state.users = users; state.receptions = receptions.rows || []; state.searchSynonyms = searchMeta.synonyms || []; state.warehouses=warehouses;
  if(requestedReceptionId){
    const reception=state.receptions.find((row)=>row.id===requestedReceptionId&&!row.publicAssist&&row.status!=="已结案");
    if(reception)state.saleDraft={...(state.saleDraft||{}),receptionId:reception.id,customerName:reception.customerName||"",customerPhone:reception.customerPhone||""};
    requestedReceptionId="";
    const url=new URL(location.href);url.searchParams.delete("reception");history.replaceState(null,"",url);
  }
}
async function renderDashboard() {
  const version=officeViewVersion,current=()=>version===officeViewVersion&&state.tab==="dashboard";
  let data;try{data=await api("/api/dashboard");}catch(error){if(!current())return;throw error;}
  if(!current())return;
  const inStock = state.inventory.filter((p) => p.stockManaged !== false);
  const summary = data.summary || {};
  const metric = (label, value) => `<div class="stat"><span>${E(label)}</span><strong>${M(value)}</strong></div>`;
  const quantityMetric = (label, value) => `<div class="stat"><span>${E(label)}</span><strong>${E(value)}</strong></div>`;
  const categoryRows = (data.categoryStats || []).map((row) => `<tr><td>${E(row.category)}</td><td>${E(row.quantity)}</td><td>${M(row.salesAmount)}</td>${data.canViewProfit ? `<td>${M(row.grossProfit)}</td>` : ""}</tr>`);
  const paymentRows = (data.paymentStats || []).map((row) => `<tr><td>${E(row.paymentMethod)}</td><td>${M(row.amount)}</td></tr>`);
  const staffRows = (data.staffStats || []).map((row) => `<tr><td>${E(row.name)}</td><td>${E(row.orderCount)}</td><td>${M(row.salesAmount)}</td></tr>`);
  const orderStatus = { completed: "已完成", returned: "已退货", "partially-returned": "部分退货" };
  const orderRows = (data.recentOrders || []).map((row) => `<tr><td>${E(documentNo(row))}<small>${E(row.createdAt)}</small></td><td>${E((row.items || []).map((item) => `${item.name} × ${item.quantity}`).join("、"))}</td><td>${M(row.amount)}</td><td>${E(orderStatus[row.status] || row.status || "已完成")}</td></tr>`);
  const section = (title, headers, rows) => `<section class="card"><h2>${E(title)}</h2>${rows.length ? table(headers, rows) : '<p class="empty">今天暂无记录</p>'}</section>`;
  $("main").innerHTML = heading("门店总览", "业务数据来自当前账套，测试商品编号以 DEMO 开头。", button("刷新", "refresh")) +
    `<div class="grid dashboard-stock">${quantityMetric("有库存商品", inStock.filter((p) => p.quantity > 0).length)}${quantityMetric("库存件数", inStock.reduce((n, p) => n + Number(p.quantity || 0), 0))}${quantityMetric("今日订单", summary.orderCount || 0)}</div>` +
    `<section class="card"><h2>今日经营 <small class="muted">${E(data.date)}</small></h2><div class="grid">${metric("销售额", summary.salesAmount)}${metric("退货额", summary.returnAmount)}${metric("净销售额", summary.netSales)}${metric("销售收款", summary.receivedAmount)}${metric("退款支出", summary.refundAmount)}${data.canViewProfit ? metric("调整后毛利", summary.adjustedGrossProfit) : ""}${state.user.capabilities.finance ? metric("门店费用", summary.expenseAmount) : ""}${state.user.capabilities.finance ? metric("运营商佣金到账", summary.carrierReceived) : ""}</div></section>` +
    `<div class="dashboard-panels">${section("按品类", ["分类", "净售数量", "净销售额", ...(data.canViewProfit ? ["毛利"] : [])], categoryRows)}${section("收款方式", ["方式", "净收款"], paymentRows)}${section("员工销售", ["员工", "订单数", "净销售额"], staffRows)}</div>` +
    section("今日销售单", ["单号", "商品", "金额", "状态"], orderRows);
}
function recordSummary(title,content) {
  const open=matchMedia('(max-width:700px)').matches?'':' open';
  return `<details class="record-summary"${open}><summary>${E(title)}</summary>${content}</details>`;
}
async function renderInventory() { await window.InventoryOffice.render(); }

function filterRows() { const q = $("filter")?.value.trim().toLowerCase() || ""; $("list")?.querySelectorAll("tbody tr").forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(q); }); }
function stocktake() { location.assign("/stocktake"); }
async function renderProducts() {
  const current=officePageCurrent("products"),main=$("main");if(!current()||!main)return;
  const view=state.productCatalogView||(state.productCatalogView={query:"",warehouse:"",page:1});
  const normalized=(value)=>String(value??"").normalize("NFKC").toLowerCase();
  const category=(p)=>p.type==="智能手机"?"智能机":/^(配件和维修|配件\s*[/／]\s*维修)$/.test(p.type||"")?(p.stockManaged===false?"维修":"配件"):p.type;
  const warehouses=[{id:"wh-a",name:"A仓·手机数码"},{id:"wh-b",name:"B仓·配件"},{id:"wh-c",name:"C仓·移动业务"},{id:"wh-other",name:"其他仓"}].map((fallback)=>{const row=state.warehouses.find((w)=>w.id===fallback.id)||fallback;return row.id==="wh-other"?{...row,name:"其他仓"}:row;});
  const warehouseId=(p)=>warehouses.some((w)=>w.id===p.warehouseId)?p.warehouseId:"wh-other";
  if(view.warehouse&&!warehouses.some((w)=>w.id===view.warehouse))view.warehouse="";
  main.innerHTML=heading("商品管理","无串号实物商品自动有码，同款共用一码，可随时补打。",button("新增商品","edit-product","","primary"))+
    `<section class="card"><div class="fields"><label>搜索商品<input id="product-catalog-search" type="search" value="${E(view.query||"")}" placeholder="商品名称、编号或别名" autocomplete="off"></label><label>所属仓库<select id="product-catalog-warehouse">${option("","全部仓库",!view.warehouse)}${warehouses.map((w)=>option(w.id,w.name,w.id===view.warehouse)).join("")}</select></label></div><p id="product-catalog-count" role="status" aria-live="polite"></p></section>`+
    '<div id="product-catalog-results" class="card mobile-record-list"></div><div class="inventory-pagination" aria-label="商品分页"><button type="button" id="product-catalog-prev" class="secondary">上一页</button><span id="product-catalog-page"></span><button type="button" id="product-catalog-next" class="secondary">下一页</button></div>';
  const search=main.querySelector("#product-catalog-search"),warehouse=main.querySelector("#product-catalog-warehouse"),results=main.querySelector("#product-catalog-results"),count=main.querySelector("#product-catalog-count"),pageLabel=main.querySelector("#product-catalog-page"),prev=main.querySelector("#product-catalog-prev"),next=main.querySelector("#product-catalog-next");
  const pageCurrent=()=>current()&&main.contains(search)&&main.contains(results);
  const draw=()=>{
    if(!pageCurrent())return;
    const terms=normalized(view.query).trim().split(/\s+/).filter(Boolean);
    const matched=state.products.filter((p)=>{
      if(view.warehouse&&warehouseId(p)!==view.warehouse)return false;
      const haystack=normalized([p.name,p.externalCode,p.shortName,...(Array.isArray(p.aliases)?p.aliases:[p.aliases||""])].join(" "));
      return terms.every((term)=>haystack.includes(term));
    });
    const pages=Math.max(1,Math.ceil(matched.length/20));view.page=Math.min(pages,Math.max(1,Math.floor(Number(view.page)||1)));
    const start=(view.page-1)*20,shown=matched.slice(start,start+20);
    const rows=shown.map((p)=>{
      const source=p.importSource||{},unitPending=source.unitNeedsConfirmation===true||source.unitSource==="derived"||source.unitSource==="pending"||!p.unit;
      const price=Number(p.salePrice),pricePending=source.priceNeedsConfirmation===true||!Number.isFinite(price)||price<=0;
      const priceText=Number.isFinite(price)&&price>0?M(price)+(pricePending?"（待核价）":""):"待核价";
      const warehouseName=warehouses.find((w)=>w.id===warehouseId(p)).name;
      return `<tr data-sku="${E(p.skuId)}"><td data-label="商品" class="record-title"><strong>${E(p.name)}</strong><small>${E(p.externalCode)}</small></td><td data-label="分类"><span class="record-value">${E([category(p),p.subType,p.thirdType].filter(Boolean).join(" / ")||"未分类")}</span></td><td data-label="单位"><span class="record-value">${E(p.unit||"未设置")}${unitPending?' <strong class="notice">单位待核</strong>':""}</span></td><td data-label="所属仓"><span class="record-value">${E(warehouseName)}</span></td><td data-label="库存方式"><span class="record-value">${p.stockManaged===false?"服务":p.trackSerial?"串码":"数量"}</span></td><td data-label="售价"><span class="record-value${pricePending?"":" money-value"}">${E(priceText)}</span>${pricePending?'<small>开单时请核实实际售价</small>':""}</td><td data-label="操作"><div class="actions">${button("编辑","edit-product",p.skuId)}${p.stockManaged!==false&&p.warehouseId!=="wh-c"?button("新建YD版本","mobile-product",p.skuId):""}${button("调价","price-request",p.skuId)}${p.qrCode?`<a class="staff-account-link" href="${E('/qr?skuId='+encodeURIComponent(p.skuId))}">二维码／补打</a>`:""}</div></td></tr>`;
    });
    results.innerHTML=rows.length?table(["商品","分类","单位","所属仓","库存方式","售价","操作"],rows):'<p class="empty">没有匹配商品，请调整搜索或仓库。</p>';
    count.textContent=`找到 ${matched.length} 种商品，共 ${state.products.length} 种；每页20条`;
    pageLabel.textContent=`第 ${view.page} / ${pages} 页${matched.length?` · ${start+1}—${start+shown.length} 条`:""}`;
    prev.disabled=view.page<=1;next.disabled=view.page>=pages;
  };
  search.addEventListener("input",()=>{if(!pageCurrent())return;view.query=search.value;view.page=1;draw();});
  warehouse.addEventListener("change",()=>{if(!pageCurrent())return;view.warehouse=warehouse.value;view.page=1;draw();});
  prev.addEventListener("click",()=>{if(!pageCurrent()||prev.disabled)return;view.page--;draw();});
  next.addEventListener("click",()=>{if(!pageCurrent()||next.disabled)return;view.page++;draw();});
  draw();
  await officePageRead(current,()=>renderPricePanel());
}
function inventoryTransferC(value) {
  const input=JSON.parse(value),source=state.inventory.find(row=>row.stockKey===input.stockKey);
  if(!source||source.stockManaged===false||!["wh-a","wh-b","wh-c","wh-other"].includes(source.warehouseId)||Number(source.quantity)<=0)throw new Error("请选择原仓在库的实物商品。");
  const known=(source.serials||[]).filter(s=>s.inStock===true||["可售","未激活"].includes(s.status));
  if(source.trackSerial&&!known.length)throw new Error("这款手机还缺真实串号，请先补齐后再调拨。");
  let prepared=null,signature="";
  modal("仓库调拨 · "+source.name,[{name:"targetWarehouseId",label:"目标仓库",type:"select",value:["wh-a","wh-b","wh-c","wh-other"].includes(input.targetWarehouseId)&&input.targetWarehouseId!==source.warehouseId?input.targetWarehouseId:"",required:true,options:[{value:"",label:"请选择目标仓库"},...([{value:"wh-a",label:"A仓 · 手机数码"},{value:"wh-b",label:"B仓 · 配件"},{value:"wh-c",label:"C仓 · 移动业务（YD）"},{value:"wh-other",label:"其他仓"}].filter(w=>w.value!==source.warehouseId))],inlineHint:"四个仓库可以互调；C仓自动加YD，其余仓使用不带YD的同款档案。"},qtyField("quantity","调拨数量",1),...(source.trackSerial?[{name:"serialText",label:"调拨串号（每行一个）",type:"textarea",value:input.serialNo||known[0].no,required:true,wide:true,inlineHint:"只能调拨原仓可售的真实串号；待补串号不能转运。"}]:[]),{name:"reason",label:"调拨说明",value:"",required:true,wide:true}],async(data,write)=>{
    const payload={sourceSkuId:source.skuId,sourceWarehouseId:source.warehouseId,targetWarehouseId:String(data.targetWarehouseId||""),quantity:Number(data.quantity),serialNos:source.trackSerial?String(data.serialText||"").split(/[\s,，、;；]+/).filter(Boolean):[],reason:String(data.reason||"").trim()};
    const next=JSON.stringify(payload);
    if($("modal-root")?.dataset.uncertain==="1"&&next!==signature){const error=new Error("上次调拨结果尚未确认，请按原数量和串号重试核对，确认后再修改。");error.uncertain=true;throw error;}
    if(!prepared||next!==signature){
      try{prepared=await api("/api/inventory/transfers/preview",{method:"POST",body:JSON.stringify(payload)});}catch(error){error.uncertain=false;throw error;}
      signature=next;
      $("inventory-transfer-preview").innerHTML='<strong>请核对：'+E(prepared.sourceWarehouseName)+' → '+E(prepared.targetWarehouseName)+'</strong><p>'+E(prepared.targetName)+' · '+E(prepared.quantity)+' '+E(source.unit||"件")+'</p><p>原仓：'+E(prepared.sourceQuantityBefore)+' → '+E(prepared.sourceQuantityAfter)+'；目标仓：'+E(prepared.targetQuantityBefore)+' → '+E(prepared.targetQuantityAfter)+'</p>'+(prepared.amount!==undefined?'<p>随货成本：'+M(prepared.amount)+'；总成本保持不变。</p>':'')+((prepared.serialSources||[]).some(s=>s.sourceType==='historical-bound')?'<p>部分串号已核实补绑定记录，原供货来源仍待补；没有编造采购单。</p>':'')+'<p>'+E(prepared.targetWarehouseId==='wh-c'?'转入C仓后自动加（YD）。':'转入'+(prepared.targetWarehouseId==='wh-other'?'其他仓':prepared.targetWarehouseName)+'后商品名称不加YD。')+'核对实物后，请点“确认调拨”。</p>';
      $("modal-root").dataset.nextSubmitCaption="确认调拨";return false;
    }
    try{return await write("/api/inventory/transfers",{...payload,confirmed:true,previewToken:prepared.previewToken});}
    catch(error){if(!error.uncertain){prepared=null;signature="";$("inventory-transfer-preview").textContent="请重新预览后确认调拨。";$("modal-root").dataset.nextSubmitCaption="预览调拨";}throw error;}
  },"选择目标仓后先预览，再确认调拨。四仓互调，C仓自动加（YD），其余仓不加YD；总数量和总成本不变。");
  const form=$("modal-form"),box=document.createElement("div");box.id="inventory-transfer-preview";box.className="notice";form.querySelector(".form-actions").before(box);
  for(const event of ["input","change"])form.addEventListener(event,()=>{if($("modal-root")?.dataset.uncertain==="1")return;prepared=null;signature="";box.textContent="";$("modal-root").dataset.nextSubmitCaption="预览调拨";form.querySelector('button[type="submit"]').textContent="预览调拨";});
  form.querySelector('button[type="submit"]').textContent="预览调拨";
}
function productWarehouseTransfer(id) {
  const editor=$("modal-root"),form=$("modal-form"),product=state.products.find(row=>row.skuId===id);
  if(!editor||form?.dataset.productSkuId!==id)throw new Error("请先打开需要调拨的商品。");
  if(editor.dataset.submitting==="1"||editor.dataset.uncertain==="1")throw new Error("本单结果待核对，请先按原内容重试核对。");
  if(!state.user?.capabilities.purchase||!state.user?.capabilities.stocktake)throw new Error("仓库调拨需要采购入库和库存盘点权限，请联系管理员。");
  const matches=state.inventory.filter(row=>row.skuId===id&&row.warehouseId===product?.warehouseId&&row.stockManaged!==false&&Number(row.quantity)>0);
  if(matches.length!==1)throw new Error("未找到唯一的原仓现货，请到库存查询核对后调拨。原编辑内容已保留。");
  const input={stockKey:matches[0].stockKey,targetWarehouseId:form.elements.warehouseId.value};
  editor.remove();
  try{inventoryTransferC(JSON.stringify(input));}catch(error){document.body.append(editor);throw error;}
  const transfer=$("modal-root"),cancel=transfer.querySelector('[data-action="close-modal"]');
  cancel.textContent="返回商品编辑";
  transfer.querySelector(".muted").textContent+=" 原编辑内容已保留，取消调拨可返回继续编辑。";
  transfer.addEventListener("click",event=>{
    const back=event.target.closest('[data-action="close-modal"]');
    if(!back&&event.target!==transfer)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(transfer.dataset.submitting==="1"||transfer.dataset.uncertain==="1"){toast("调拨正在提交或结果待核对，请按原内容重试后再返回。",true);return;}
    transfer.remove();document.body.append(editor);form.elements.warehouseId.focus({preventScroll:true});
  },true);
}
function mobileProductEditor(id) {
  const source=state.products.find((row)=>row.skuId===id);
  if(!source||source.stockManaged===false||source.warehouseId==="wh-c")throw new Error("请选择非C仓实物商品新建YD版本。");
  const existing=state.products.find((row)=>row.warehouseId==="wh-c"&&row.mobileVariantOf===source.skuId);
  if(existing){toast("该型号C仓YD商品已有档案，正在打开现有商品。");productEditor(existing.skuId);return;}
  const values={};
  const form=$("modal-form");
  if(form?.dataset.productSkuId===id)for(const name of ["shortName","aliases","type","subType","thirdType","unit","salePrice"]){
    const value=form.elements[name]?.value;
    if(value!==undefined)values[name]=value==="__custom__"?String(form.elements[name+"Custom"]?.value||"").trim():value;
  }
  productEditor("",{sourceSkuId:id,...values,warehouseId:"wh-c"});
}
function productEditor(id,prefill={}) {
  const mobileSource=!id&&prefill.sourceSkuId?state.products.find((row)=>row.skuId===prefill.sourceSkuId):null;
  if(prefill.sourceSkuId&&!mobileSource)throw new Error("原商品不存在，请刷新商品列表。");
  const original=state.products.find((row)=>row.skuId===id)||(mobileSource?{name:mobileSource.name,externalCode:mobileSource.externalCode,shortName:mobileSource.shortName,aliases:mobileSource.aliases,type:mobileSource.type,subType:mobileSource.subType,thirdType:mobileSource.thirdType,unit:mobileSource.unit,trackSerial:mobileSource.trackSerial,stockManaged:true,salePrice:mobileSource.salePrice,...prefill}:{name:String(prefill.name||"").trim().slice(0,200),...(prefill.warehouseId==="wh-c"?{warehouseId:"wh-c"}:{})});
  if(mobileSource)original.aliases=typeof original.aliases==="string"?original.aliases.split(/[、,，]/).map((v)=>v.trim()).filter(Boolean):original.aliases;
  const category=(row)=>row.type==="智能手机"?"智能机":/^(配件和维修|配件\s*[/／]\s*维修)$/.test(row.type||"")?(row.stockManaged===false?"维修":"配件"):row.type;
  const p={...original,type:category(original)};
  const names=(values)=>[...new Set(values.filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  const choices=(values,current,empty,label)=>[
    {value:"",label:empty},
    ...names([...values,current]).map((name)=>({value:name,label:name})),
    {value:"__custom__",label:"＋ 新增"+label}
  ];
  const types=names(["智能机","功能机","二手机","儿童手表","笔记本","其他数码","配件","维修","号卡","其他收入",...state.products.map(category)]);
  const subs=(type)=>state.products.filter((row)=>category(row)===type).map((row)=>row.subType);
  const thirds=(type,subType)=>state.products.filter((row)=>category(row)===type&&row.subType===subType).map((row)=>row.thirdType);
  const units=names(["件","台","个","套","张","米","次",...state.products.map((row)=>row.unit)]);
  const pick=(data,name)=>{
    if(data[name]!=="__custom__")return data[name]||"";
    const custom=String(data[name+"Custom"]||"").trim();
    if(!custom)throw new Error("请填写新增"+({type:"一级分类",subType:"二级分类",thirdType:"三级分类",unit:"计量单位"}[name]));
    return custom;
  };
  modal(id?"编辑商品":mobileSource?"新建C仓YD商品":"新增商品",[
    {name:"name",label:"商品名称",value:p.name,required:true},
    {name:"externalCode",label:"商品编号",value:p.externalCode,required:true,inlineHint:mobileSource?"系统自动生成YD编号，无需修改或重新输入。":""},
    {name:"shortName",label:"简称",value:p.shortName},
    {name:"aliases",label:"搜索别名（逗号分隔）",value:(p.aliases||[]).join("、"),hint:"例如：Mate 60、华为60。保存后可在查询和开单时搜索这些叫法。",wide:true},
    {name:"type",label:"一级分类（商品类别）",value:p.type,options:choices(types,p.type,"请选择商品类别","一级分类"),required:true,inlineHint:"这里选智能机、配件等商品类别；终端公司等往来单位在采购入库时选择。"},
    {name:"typeCustom",label:"新增一级分类"},
    {name:"subType",label:"二级分类",value:p.subType,options:choices(subs(p.type),p.subType,"不选二级分类","二级分类")},
    {name:"subTypeCustom",label:"新增二级分类"},
    {name:"thirdType",label:"三级分类",value:p.thirdType,options:choices(thirds(p.type,p.subType),p.thirdType,"不选三级分类","三级分类")},
    {name:"thirdTypeCustom",label:"新增三级分类"},
    {name:"unit",label:"计量单位",searchable:false,value:p.unit||(p.stockManaged===false?"次":"件"),options:choices(units,p.unit,"请选择计量单位","计量单位"),required:true,inlineHint:"手机选“台”，配件选“件/个”；没有合适的可选“＋ 新增计量单位”。"},
    {name:"unitCustom",label:"新增计量单位"},
    {name:"warehouseId",label:"所属仓库",required:true,value:p.warehouseId||(p.stockManaged===false?"wh-other":""),options:[...(mobileSource?[]:[{value:"",label:"请选择所属仓库"}]),...state.warehouses.filter((w)=>!mobileSource||w.id==="wh-c").map((w)=>({value:w.id,label:(w.id==="wh-other"?"其他仓":w.name)+" · "+w.scope}))],hint:"C仓与A仓共用分类方式，移动商品自动加YD。",inlineHint:p.skuId?"已有现货要移到其他仓库，请点“仓库调拨”，先预览再确认；所属仓库不能直接搬货。同款仅新增C仓档案可用“新建YD版本”。":"每个商品都要选仓库；不属于A、B、C仓的选其他。C仓自动加（YD）。"},
    moneyField("salePrice","预设售价",p.salePrice??0),
    {name:"kind",label:"库存类型",value:p.stockManaged===false?"service":p.trackSerial?"serial":"quantity",options:[{value:"quantity",label:"数量库存"},{value:"serial",label:"串码库存"},{value:"service",label:"服务／其他收入（不计库存）"}]}
  ],(data,write)=>{
    if(data.type==="其他收入")data.kind="service";
    const normalized={...p,...data,type:pick(data,"type"),subType:pick(data,"subType"),thirdType:pick(data,"thirdType"),unit:pick(data,"unit"),warehouseId:data.kind==="service"?"wh-other":data.warehouseId,kind:data.kind==="service"?"service":"physical",trackSerial:data.kind==="serial",salePrice:Number(data.salePrice)};
    for(const name of ["typeCustom","subTypeCustom","thirdTypeCustom","unitCustom"])delete normalized[name];
    if(id&&p.stockManaged!==false&&normalized.warehouseId!==p.warehouseId&&state.inventory.some(row=>row.skuId===id&&Number(row.quantity)>0))throw new Error("现货不能通过修改所属仓库搬货。请点下方“仓库调拨”，已选择的目标仓会自动带入；先预览，再确认。原编辑内容已保留。");
    return write("/api/products",normalized).catch(error=>{if(/不能直接修改所属仓|归仓核对/.test(error.message))error.message="该商品已有库存或业务记录，不能直接修改所属仓库。请点“仓库调拨”搬货；如无现货，请到库存查询核对。原编辑内容已保留。";throw error;});
  },mobileSource?"为同款新增独立C仓商品，系统自动加（YD）和编号；原商品及库存不变。建档后在采购入库登记C仓来货。":"已有分类直接选；没有的选“新增名称”。");
  const form=$("modal-form");
  form.dataset.productSkuId=id||"";
  if(id&&p.stockManaged!==false&&state.user?.capabilities.purchase&&state.user?.capabilities.stocktake&&state.inventory.some(row=>row.skuId===id&&row.warehouseId===p.warehouseId&&Number(row.quantity)>0)){
    form.querySelector(".form-actions").insertAdjacentHTML("afterbegin",button("仓库调拨","product-transfer",id,"primary"));
  }
  if(id&&p.stockManaged!==false&&p.warehouseId!=="wh-c")form.querySelector(".form-actions").insertAdjacentHTML("beforeend",button("新建YD版本","mobile-product",id));
  if(mobileSource){form.elements.name.readOnly=true;form.elements.externalCode.readOnly=true;form.elements.kind.disabled=true;}
  const syncCustom=(name)=>{
    const custom=form.elements[name+"Custom"];
    const show=form.elements[name].value==="__custom__";
    custom.closest(".field").hidden=!show;
    custom.required=show;
    if(!show)custom.value="";
  };
  const fill=(name,values,current,empty,label)=>{
    const select=form.elements[name];
    select.innerHTML=choices(values,current,empty,label).map((item)=>option(item.value,item.label,item.value===current)).join("");
    select.value=current||"";
    originalSelectOptions.delete(select);
    syncCustom(name);
  };
  const syncService=()=>{const income=form.elements.type.value==="其他收入";if(income)form.elements.kind.value="service";form.elements.kind.disabled=income;form.elements.warehouseId.closest(".field").hidden=false;if(form.elements.kind.value==="service")form.elements.warehouseId.value="wh-other";};
  form.elements.kind.addEventListener("change",syncService);
  form.elements.type.addEventListener("change",syncService);
  syncService();
  for(const name of ["type","subType","thirdType","unit"]) {
    syncCustom(name);
    exposeNewChoice(form,name,"__custom__",name+"Custom");
    form.elements[name].addEventListener("change",()=>{
      syncCustom(name);
      if(name==="type"){
        const type=form.elements.type.value;
        fill("subType",subs(type),"","不选二级分类","二级分类");
        fill("thirdType",[],"","不选三级分类","三级分类");
      }else if(name==="subType"){
        fill("thirdType",thirds(form.elements.type.value,form.elements.subType.value),"","不选三级分类","三级分类");
      }
    });
  }
  const syncWarehouse=()=>{const field=form.elements.warehouseId.closest(".field");field.hidden=false;if(form.elements.kind.value==="service")form.elements.warehouseId.value="wh-other";};
  form.elements.kind.addEventListener("change",syncWarehouse);syncWarehouse();
  if(id){const price=form.elements.salePrice;price.readOnly=true;price.title="已建档商品请使用调价单修改零售价";price.style.background="#f2f5fa";}
}
let saleCopilotTimer = 0;
let saleCopilotVersion = 0;
function refreshSaleCopilot(delay = 180) {
  clearTimeout(saleCopilotTimer);
  const panel = $("sale-copilot");
  const form = $("sale-checkout");
  if (!panel || !form) return;
  const version = ++saleCopilotVersion;
  panel.querySelector(".copilot-result").textContent = "正在核对本单…";
  saleCopilotTimer = setTimeout(async () => {
    if (version !== saleCopilotVersion || !$("sale-copilot")) return;
    const draft = {
      items: state.salesCart.map(({name,...item}) => item),
      account: form.elements.account.value,
      saleMode: form.elements.saleMode.value,
      receptionId: form.elements.receptionId.value,
      platformOrderNo: form.elements.platformOrderNo.value,
      subsidyAmount: Number(form.elements.subsidyAmount.value || 0)
    };
    try {
      const result = await api("/api/copilot/sales-review", {method:"POST",body:JSON.stringify(draft)});
      if (version !== saleCopilotVersion || !$("sale-copilot")) return;
      const title = result.ready ? "本单预检通过" : "开单前请处理以下事项";
      const summary = "应收 " + M(result.total) + (draft.saleMode === "guobu" ? " · 顾客实付 " + M(result.customerDue) : "");
      const rows = result.findings.map((item) => '<li class="copilot-' + E(item.level) + '">' + E(item.message) + '</li>').join("");
      panel.querySelector(".copilot-result").innerHTML = '<strong>' + E(title) + '</strong><span>' + E(summary) + '</span>' + (rows ? '<ul>' + rows + '</ul>' : '<p>未发现当前规则覆盖的缺项。</p>') + '<small>' + E(result.note) + '</small>';
    } catch (error) {
      if (version === saleCopilotVersion && $("sale-copilot")) panel.querySelector(".copilot-result").textContent = "副驾暂时无法核对：" + error.message;
    }
  }, delay);
}
let salePaymentAssetsLoading;
async function ensureSalePaymentSplits(){
 if(!window.PaymentSplits){if(!salePaymentAssetsLoading)salePaymentAssetsLoading=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="/payment-splits.js";script.onload=()=>window.PaymentSplits?resolve():reject(new Error("分笔收款组件未加载，请刷新"));script.onerror=()=>{salePaymentAssetsLoading=null;script.remove();reject(new Error("分笔收款组件读取失败，请刷新后再开单"));};document.head.append(script);});await salePaymentAssetsLoading;}
 await window.PaymentSplits.ready();state.salePaymentAccounts=await api("/api/payment-accounts");
}
function saleAmountCents(value){const text=String(value??"").trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error("售价与金额最多填写两位小数");const [whole,fraction=""]=text.split("."),cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));if(!Number.isSafeInteger(cents))throw new Error("金额超出范围");return cents;}
function saleCartTotalCents(){return state.salesCart.reduce((sum,item)=>{const cents=saleAmountCents(item.salePrice),quantity=Number(item.quantity);if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(sum+cents*quantity))throw new Error("请核对商品数量和金额");return sum+cents*quantity;},0);}
function renderSales() {
  window.SaleCapture?.stop();
  let assistantDraft = null;
  try { const raw = sessionStorage.getItem("assistant-sale-draft"); if (raw) { sessionStorage.removeItem("assistant-sale-draft"); const draft = JSON.parse(raw); if (Date.now() - draft.createdAt < 600000 && state.products.some((p) => p.skuId === draft.skuId)) assistantDraft = draft; } } catch {}
  const rows = state.salesCart.map((item,i) => {
    const product = state.inventory.find((entry) => entry.skuId === item.skuId) || {};
    return `<tr><td data-label="序号">${i+1}</td><td data-label="商品编号">${E(product.externalCode || item.skuId)}</td><td data-label="商品名称"><strong>${E(item.name)}</strong><small>${E(product.warehouseName||"服务项目")}</small>${item.materials?.length?`<small>耗材 ${item.materials.length} 项</small>`:""}</td><td data-label="规格/系列">${E([product.subType,product.thirdType].filter(Boolean).join(" / ") || "—")}</td><td data-label="单位">${E(product.unit || "件")}</td><td data-label="数量">${E(item.quantity)}</td><td data-label="串码">${E(item.serialNo || "—")}</td><td data-label="单价">${M(item.salePrice)}</td><td data-label="金额">${M(item.quantity * item.salePrice)}</td><td data-label="操作"><div class="actions">${button("修改", "edit-cart", i)}${button("移除", "remove-cart", i,"danger")}</div></td></tr>`;
  });
  const payable=state.salesCart.reduce((n,i)=>n+i.quantity*i.salePrice,0);
  const listed=state.salesCart.reduce((n,i)=>n+i.quantity*Number(state.products.find((p)=>p.skuId===i.skuId)?.salePrice||i.salePrice),0);
  const discount=Math.max(0,Math.round((listed-payable)*100)/100);
  if (assistantDraft) state.saleDraft={...(state.saleDraft||{}),customerName:assistantDraft.customerName||"",customerPhone:assistantDraft.customerPhone||"",account:assistantDraft.account||"微信",orderNote:assistantDraft.giftRequested?"助理提示拟送赠品："+assistantDraft.giftRequested+"；请在赠品栏选择实物并核对限制。":""};
  const draft=state.saleDraft||{};
  state.salePaymentController?.destroy();state.salePaymentController=null;
  state.giftCart ||= [];
  $("main").innerHTML = heading("销售开单", "先加入商品与串号，再核对售价和收款；顾客与单据资料可按需展开补充，单号在提交后生成。").replace('class="heading"','class="heading sale-page-heading"') +
    `<section class="card sale-sheet"><form id="sale-checkout">
      <div class="sale-opening-staff">开单：<strong>${E(state.user.name)}</strong></div>
      <div class="sale-sheet-items" id="sale-step-items"><div class="sale-step"><span class="sale-step-number">1</span><div><h2>商品与串号</h2><p data-page-explanation>搜索或扫码加入商品。串号可扫码、手输或下拉选择；手机逐台加入，配件填写数量。</p></div></div><div class="sale-picker-tabs" role="tablist" aria-label="选择商品方式"><button type="button" id="sale-picker-serial" role="tab" aria-selected="true">扫串号</button><button type="button" id="sale-picker-product" role="tab" aria-selected="false">选商品</button></div><div class="sale-picker-entry"><label for="sale-search">扫描 / 输入串号</label><input id="sale-search" class="search" type="search" autocomplete="off" placeholder="输入商品、编号或串号后4位"><div class="sale-lookup-actions"><button type="button" id="sale-camera-button" class="secondary">扫码</button><button type="button" id="sale-photo-button" class="secondary">拍照</button><input id="sale-photo-input" type="file" accept="image/*" capture="environment" hidden></div><video id="sale-camera-preview" playsinline muted hidden></video><p id="sale-scan-status" class="muted" role="status"></p><p id="sale-item-feedback" class="field-feedback" role="status"></p></div><div id="sale-results" class="sale-results"></div><div class="sale-dropdowns" hidden><label>按商品大类筛选<select id="sale-category"><option value="">全部分类</option></select></label><label>下拉选择商品<select id="sale-product-select"><option value="">请选择商品</option></select></label></div><div class="sale-sheet-section-title"><button type="button" class="primary" data-action="add-sale-item">添加商品</button></div>${rows.length ? table(["序号","商品编号","商品名称","规格/系列","单位","数量","串码","单价","金额","操作"],rows) : '<p class="empty">还没有加入商品</p>'}</div>
<div class="sale-step-next"><button type="button" class="secondary" data-sale-next="sale-step-payment">下一步：售价与收款 ↓</button></div><details class="sale-customer-block" id="sale-step-customer"><summary>顾客与单据资料（选填）</summary><p data-page-explanation>顾客资料可以先留空，有空再补；有接待记录就关联。</p>
      <div class="sale-sheet-header fields">${formField({name:"customerName",label:"客户名称",value:draft.customerName,placeholder:"顾客称呼；可留空"})}${formField({name:"customerPhone",label:"顾客手机号",type:"tel",value:draft.customerPhone,placeholder:"用于售后追踪；不提供可留空"})}${formField({name:"receptionId",label:"关联接待单",value:draft.receptionId,options:[{value:"",label:"本次没有接待单"},...state.receptions.filter((r)=>r.status!=="已结案"&&!r.publicAssist).map((r)=>({value:r.id,label:`${r.customerMask} · ${r.purpose} · ${documentNo(r)}`}))]})}<div id="sale-reception-supplement" class="field" hidden></div><div class="field"><label>开单员工（登录账号自动记录）</label><div class="sale-fixed-value">${E(state.user.name)}</div></div>${formField({name:"invoiceType",label:"开票需求",value:draft.invoiceType||"未提出",options:[{value:"未提出",label:"未提出"},{value:"电子发票",label:"需要电子发票"},{value:"纸质发票",label:"需要纸质发票"}]})}${formField({name:"invoiceNo",label:"发票号码（选填，未开票可留空）",value:draft.invoiceNo})}<div class="field"><label>出库仓库</label><div class="sale-fixed-value">按所选商品所属 A/B/C 仓自动出库，商品明细中显示仓位</div></div>${formField({name:"orderNote",label:"整单备注",type:"textarea",wide:true,value:draft.orderNote,placeholder:"可记录顾客要求、交付或售后说明"})}</div>
            
</details>
      <div class="sale-sheet-settlement" id="sale-step-payment"><div class="sale-step"><span class="sale-step-number">3</span><div><h2>金额与收款</h2><p data-page-explanation>先看应收金额，再选择钱实际到了哪个账户。</p></div></div><div class="sale-sheet-summary"><span>参考零售价合计 <strong>${M(listed)}</strong></span><span>优惠金额 <strong>${M(discount)}</strong></span><span>成交应收 <strong>${M(payable)}</strong></span></div><div class="fields">${formField({name:"saleMode",label:"销售通道",value:draft.saleMode||"ordinary",options:[{value:"ordinary",label:"普通销售"},{value:"guobu",label:"国补销售（单件单独开单）"}]})}<div id="sale-legacy-payment" hidden>${formField({...accountField,value:draft.account||"微信"})}${formField({name:"accountOwnerId",label:"实际收款账户持有人（可暂不确定）",value:draft.accountOwnerId,options:[{value:"",label:"暂不确定，提交老板待办"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.financeReceive).map((u)=>({value:u.id,label:u.name}))]})}</div></div><section id="sale-payment-splits" class="wide" aria-label="按账户分笔收款"></section><p><a href="/payment-accounts">收付款账户设置</a> · 可一单分收微信、和包商户等，每笔由实际持有人核对。</p><label class="cash-drawer-check"><input name="cashDrawerConfirmed" type="checkbox" value="yes"${draft.cashDrawerConfirmed?" checked":""}> 我是开单人，确认顾客现金已放入门店抽屉（未确认也可先开单，留待核实）。</label><p class="sale-sheet-paid" data-page-explanation>非现金由实际收款账户持有人在“收款核对”确认到账后才计入收款流水。开单不必等待；营业员不能代确认。</p><div id="gov-fields" class="field wide" hidden><p class="muted" data-page-explanation>以国补平台已核销金额为准；顾客仅支付成交价减补贴。国补商品须单件开单。</p><div class="fields">${formField({name:"platformOrderNo",label:"国补平台交易号",value:draft.platformOrderNo})}${formField({name:"subsidyAmount",label:"平台核销补贴金额（元）",type:"number",min:0,step:"0.01",value:draft.subsidyAmount})}${formField({name:"couponNo",label:"资格券编号（如有）",value:draft.couponNo})}</div><p id="gov-preview"></p></div></div>
      ${window.Gifts.saleSection()}<div class="sale-step" id="sale-step-confirm"><span class="sale-step-number">5</span><div><h2>核对提交</h2><p data-page-explanation>确认顾客、商品、成交价与收款信息无误后提交。提交后库存和流水同步更新。</p></div></div><div id="sale-review" class="sale-review" aria-live="polite"></div><details class="clean-document-info"><summary>单据资料</summary><div class="sale-sheet-title"><span>开单日期：${E(new Date().toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"}))}</span><span>销售单号：提交后生成</span></div></details><p id="sale-submit-feedback" class="submit-feedback" role="alert" hidden></p><button class="primary sale-submit" type="submit"${rows.length ? "" : " disabled"}>保存销售单并提交收款核对</button></form></section>` +
    `<section id="sale-copilot" class="card copilot-card" aria-label="数字副驾"><div class="copilot-head"><div><h2>数字副驾 · 开单预检</h2><p class="muted" data-page-explanation>自动检查库存、串码、售价和国补缺项；由你确认后开单。</p></div><button id="copilot-refresh" class="secondary" type="button">重新检查</button></div><div class="copilot-result" aria-live="polite">正在核对本单…</div></section><details class="sale-related"><summary>历史与收款核对</summary><div class="actions">${button("历史单", "view-orders")}<a class="secondary" href="/sale-payments">收款核对</a></div></details>`;  const pickerMode=mode=>{
    state.salePickerMode=mode;
    $('sale-picker-serial').setAttribute('aria-selected',String(mode==='serial'));
    $('sale-picker-product').setAttribute('aria-selected',String(mode==='product'));
    document.querySelector('.sale-dropdowns').hidden=mode!=='product';
    $('sale-search').placeholder=mode==='serial'?'串号或后4位':'商品名称或编号';
    document.querySelector('label[for="sale-search"]').textContent=mode==='serial'?'扫描 / 输入串号':'查找商品';
  };
  pickerMode(state.salePickerMode||'serial');
  $('sale-picker-serial').onclick=()=>pickerMode('serial');
  $('sale-picker-product').onclick=()=>pickerMode('product');
  $("sale-search").addEventListener("input",(event)=>{
    const terms=event.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if(!terms.length){$("sale-results").innerHTML="";return;}
    const remaining=(p)=>{
      if(p.stockManaged===false)return Infinity;
      const stockLeft=Number(p.quantity||0)-state.salesCart.filter((item)=>item.skuId===p.skuId).reduce((n,item)=>n+item.quantity,0);
      if(!p.trackSerial)return stockLeft;
      return Math.min(stockLeft,(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item)=>item.serialNo===s.no)).length);
    };
    const matches=state.inventory.filter((p)=>p.active!==false&&(p.stockManaged===false||Boolean(p.warehouseId))&&remaining(p)>0).filter((p)=>{
      const haystack=[p.name,p.shortName,p.externalCode,p.type,p.subType,p.thirdType,...(p.aliases||[]),...(p.serials||[]).map((s)=>s.no)].join(" ").toLowerCase();
      return terms.every((term)=>{const group=state.searchSynonyms.find((row)=>row.terms.some((word)=>word.toLowerCase()===term));return (group?group.terms:[term]).some((word)=>haystack.includes(word.toLowerCase()));});
    }).slice(0,12);
    $("sale-results").innerHTML=matches.length?matches.map((p)=>`<button type="button" data-action="add-sale-item" data-value="${E(p.skuId)}"><strong>${E(p.name)}</strong><span>${E(p.externalCode||"")} · ${p.stockManaged===false?"服务项目":`本单还可加入 ${E(remaining(p))}`} · ${M(p.salePrice)}</span></button>`).join(""):'<p class="muted">没有匹配的可售商品</p>';
  });
  const selectableProducts=state.inventory.filter((p)=>p.active!==false&&(p.stockManaged===false||Boolean(p.warehouseId)));
  const availableForSale=(p)=>{
    if(p.stockManaged===false)return true;
    const committed=state.salesCart.filter((item)=>item.skuId===p.skuId).reduce((sum,item)=>sum+item.quantity,0);
    if(Number(p.quantity||0)<=committed)return false;
    return !p.trackSerial||(p.serials||[]).some((serial)=>["可售","未激活"].includes(serial.status)&&!state.salesCart.some((item)=>item.serialNo===serial.no));
  };
  const categorySelect=$("sale-category"),productSelect=$("sale-product-select");
  const categories=[...new Set(selectableProducts.filter(availableForSale).map((p)=>p.type||"未分类"))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  categorySelect.innerHTML='<option value="">全部分类</option>'+categories.map((name)=>option(name,name)).join("");
  const refreshProductSelect=()=>{
    const category=categorySelect.value;
    const visible=selectableProducts.filter((p)=>availableForSale(p)&&(!category||(p.type||"未分类")===category)).sort((a,b)=>a.name.localeCompare(b.name,"zh-CN"));
    productSelect.innerHTML='<option value="">请选择商品</option>'+visible.map((p)=>option(p.skuId,p.name+" · "+(p.externalCode||p.skuId)+" · "+(p.stockManaged===false?"服务":p.trackSerial?"串码可售":"库存 "+p.quantity)+" · "+M(p.salePrice))).join("");
  };
  categorySelect.addEventListener("change",refreshProductSelect);
  productSelect.addEventListener("change",()=>{const skuId=productSelect.value;productSelect.value="";if(skuId)saleItemEditor(-1,skuId);});
  refreshProductSelect();
  window.SaleCapture?.mount((raw)=>{
    const code=String(raw||"").trim(),key=code.startsWith("JY1:")?code.slice(4):code;
    const match=selectableProducts.find((p)=>p.skuId===key||p.externalCode===key||(p.serials||[]).some((serial)=>serial.no===key));
    if(!match){$("sale-search").value=key;$("sale-search").dispatchEvent(new Event("input"));toast("未找到对应商品，请检查识别内容",true);return;}
    if(!availableForSale(match)){toast("该商品或串码当前不可售",true);return;}
    const serial=(match.serials||[]).find((entry)=>entry.no===key&&["可售","未激活"].includes(entry.status));
    saleItemEditor(-1,match.skuId,serial?.no||"");
  });  const checkoutForm=$("sale-checkout");const saleFeedback=window.SaleFeedback.attach(checkoutForm,()=>state.salesCart,()=>state.receptions);const syncGov=()=>{const active=checkoutForm.elements.saleMode.value==="guobu";$("gov-fields").hidden=!active;checkoutForm.elements.account.disabled=active;if(active){checkoutForm.elements.account.value="云闪付";const gross=state.salesCart.length===1?state.salesCart[0].salePrice*state.salesCart[0].quantity:0;const amount=Number(checkoutForm.elements.subsidyAmount.value)||Math.min(Math.round(gross*0.15*100)/100,500);if(!checkoutForm.elements.subsidyAmount.value)checkoutForm.elements.subsidyAmount.value=amount.toFixed(2);$("gov-preview").textContent=`成交价 ${M(gross)} · 国补 ${M(amount)} · 顾客实付 ${M(gross-amount)}`;}};checkoutForm.elements.saleMode.addEventListener("change",()=>{syncGov();saleFeedback.check();});checkoutForm.elements.subsidyAmount.addEventListener("input",()=>{syncGov();saleFeedback.check();});syncGov();saleFeedback.check();
  const customerPayCents=()=>{const gross=saleCartTotalCents();return checkoutForm.elements.saleMode.value==="guobu"?(/^\d+(?:\.\d{1,2})?$/.test(checkoutForm.elements.subsidyAmount.value||"0")?Math.max(0,gross-saleAmountCents(checkoutForm.elements.subsidyAmount.value||0)):0):gross;};
  let paymentChanged=()=>{};
  const paymentController=window.PaymentSplits.mount({container:$("sale-payment-splits"),accounts:state.salePaymentAccounts,totalCents:customerPayCents,legacy:{account:draft.account||"微信",accountOwnerId:draft.accountOwnerId||"",cashDrawerConfirmed:!!draft.cashDrawerConfirmed},initialParts:draft.payments,people:state.users.filter(user=>user.status==="active"&&user.capabilities?.financeReceive),mode:"sale",requireReference:false,onChange:()=>paymentChanged()});state.salePaymentController=paymentController;
  const salePaymentParts=()=>checkoutForm.elements.saleMode.value==="guobu"?(customerPayCents()?[{account:"云闪付",accountOwnerId:checkoutForm.elements.accountOwnerId.value,amount:customerPayCents()/100}]:[]):paymentController.getParts();
  const saveSaleDraft=()=>{state.saleDraft={...Object.fromEntries(new FormData(checkoutForm)),payments:salePaymentParts()};if(checkoutForm.elements.saleMode.value==="guobu")state.saleDraft.account="云闪付";};
  const syncReceptionSupplement=()=>{const id=checkoutForm.elements.receptionId.value,node=$("sale-reception-supplement");node.hidden=!id;node.innerHTML=id?`<a href="/receptions?highlight=${encodeURIComponent(id)}" target="_blank" rel="noopener">补充原接待资料 ↗</a><small data-page-explanation>忙时先开单，需求、预算和顾客描述有空再补。</small>`:"";};
  syncReceptionSupplement();checkoutForm.elements.receptionId.addEventListener("change",syncReceptionSupplement);
  const updateSaleReview=()=>{
    const customer=checkoutForm.elements.customerName.value.trim()||"散客";
    const phone=checkoutForm.elements.customerPhone.value.trim();
    const account=checkoutForm.elements.saleMode.value==="guobu"?"云闪付":checkoutForm.elements.account.value;
    const reception=checkoutForm.elements.receptionId.value;
    const itemSummary=state.salesCart.map((item)=>item.name+' × '+item.quantity+(item.serialNo?' · 串码 '+item.serialNo:'')).join('；')||'尚未添加';
    const paymentParts=salePaymentParts(),accountRows=state.salePaymentAccounts.rows||state.salePaymentAccounts;
    const paymentSummary=paymentParts.map((part,index)=>{const named=accountRows.find((row)=>row.id===part.paymentAccountId),holder=named?.ownerName||state.users.find((u)=>u.id===part.accountOwnerId)?.name||"待指定实际收款人";return "第"+(index+1)+"笔："+part.account+" · "+(named?.name||"未配置具体账户")+" · "+M(part.amount)+" · "+(part.account==="现金"?(part.cashDrawerConfirmed?"开单人声明已入抽屉，待老板核对":"未确认入抽屉，待核实"):holder+"确认到账");}).join("；")||"无顾客应收款";
    const giftSummary=state.giftCart.length?state.giftCart.map((item)=>item.name+" × "+item.quantity).join("、"):"无赠品";
    $("sale-review").innerHTML='<strong>提交前请确认</strong><span>顾客：'+E(customer)+(phone?' · '+E(phone):' · 未留手机号')+'</span><span>开单员工：'+E(state.user.name)+'</span><span>接待单：'+E(reception||'未关联')+'</span><span>商品：'+E(itemSummary)+'</span><span>赠品：'+E(giftSummary)+'</span><span>顾客应收：'+M(customerPayCents()/100)+'</span><span>分笔收款：'+E(paymentSummary)+'</span><span>每笔按实际到账核对；开单不等于已收到款。</span>';
  };
  checkoutForm.elements.receptionId.addEventListener("change",()=>{
    const reception=state.receptions.find((row)=>row.id===checkoutForm.elements.receptionId.value);
    if(reception&&!reception.publicAssist){
      checkoutForm.elements.customerName.value=reception.customerName||checkoutForm.elements.customerName.value;
      checkoutForm.elements.customerPhone.value=reception.customerPhone||checkoutForm.elements.customerPhone.value;
    }
    saveSaleDraft();updateSaleReview();
  });
  checkoutForm.addEventListener("input",()=>{saveSaleDraft();updateSaleReview();});
  checkoutForm.addEventListener("change",()=>{saveSaleDraft();updateSaleReview();});
  paymentChanged=()=>{if(checkoutForm.elements.saleMode.value!=="guobu"){const first=paymentController.getParts()[0];if(first){checkoutForm.elements.account.value=first.account;checkoutForm.elements.accountOwnerId.value=first.accountOwnerId||"";}}saveSaleDraft();updateSaleReview();};
  updateSaleReview();
  if (assistantDraft) { if (assistantDraft.account) checkoutForm.elements.account.value = assistantDraft.account; setTimeout(() => saleItemEditor(-1, assistantDraft.skuId, assistantDraft.serialNo||"", assistantDraft.salePrice), 0); }
  checkoutForm.querySelectorAll("[data-sale-next]").forEach((step)=>step.addEventListener("click",()=>$(step.dataset.saleNext)?.scrollIntoView({behavior:"smooth",block:"start"})));
  checkoutForm.addEventListener("input",()=>refreshSaleCopilot());checkoutForm.addEventListener("change",()=>refreshSaleCopilot());$("copilot-refresh").addEventListener("click",()=>refreshSaleCopilot(0));refreshSaleCopilot(0);
  const syncPaymentChoice=()=>{const guobu=checkoutForm.elements.saleMode.value==="guobu";$("sale-payment-splits").hidden=guobu;$("sale-legacy-payment").hidden=!guobu;checkoutForm.querySelector(".cash-drawer-check").hidden=true;checkoutForm.elements.accountOwnerId.closest(".field").hidden=false;paymentController.refresh();updateSaleReview();};checkoutForm.elements.account.addEventListener("change",syncPaymentChoice);checkoutForm.elements.saleMode.addEventListener("change",syncPaymentChoice);syncPaymentChoice();
  checkoutForm.addEventListener("submit",async(event)=>{
    event.preventDefault(); const form=event.currentTarget, button=form.querySelector("button[type=submit]");
    if(form.dataset.savedId){toast("本单已保存，单号 "+(form.dataset.savedNo||form.dataset.savedId)+"；无需重新提交。");return;}
    if(state.saleSubmitting||button.disabled)return;
    if(!saleFeedback.check(true)){saleFeedback.showFailure("尚未提交，请修改标红的内容后再提交。");return;}
    const d=Object.fromEntries(new FormData(form)),payload={accountOwnerId:d.accountOwnerId,cashDrawerConfirmed:d.account==="现金"&&form.elements.cashDrawerConfirmed.checked,salespersonId:state.user.id,customerName:d.customerName,customerPhone:d.customerPhone,invoiceType:d.invoiceType,orderNote:d.orderNote,receptionId:d.receptionId||undefined,account:d.saleMode==="guobu"?"云闪付":d.account,saleMode:d.saleMode,platformOrderNo:d.platformOrderNo,subsidyAmount:Number(d.subsidyAmount||0),couponNo:d.couponNo,invoiceNo:d.invoiceNo,items:state.salesCart.map(({name,...item})=>item),gifts:state.giftCart.map(({name,...item})=>item),giftReason:d.giftReason};
    let paymentCheck;try{if(d.saleMode==="guobu")saleAmountCents(d.subsidyAmount||0);paymentCheck=d.saleMode==="guobu"?{ok:true,parts:salePaymentParts()}:paymentController.validate();}catch(error){saleFeedback.showFailure(error.message);return;}if(!paymentCheck.ok){saleFeedback.showFailure(paymentCheck.error);return;}payload.payments=paymentCheck.parts;
    const attempt=state.saleAttempt||(state.saleAttempt={});
    const controls=[...form.querySelectorAll("input,select,textarea,button")].map(el=>[el,el.disabled]),caption=button.textContent;
    saleFeedback.clearFailure();state.saleSubmitting=true;controls.forEach(([el])=>el.disabled=true);button.disabled=true;button.textContent="正在提交…";
    let sale;
    try{sale=await post("/api/sale-orders",payload,attempt);}
    catch(error){saleFeedback.showFailure(error.message);if(error.uncertain){const box=$("sale-submit-feedback");if(box)box.textContent="提交结果待核对："+error.message;}return;}
    finally{state.saleSubmitting=false;controls.forEach(([el,disabled])=>el.disabled=disabled);button.textContent=caption;button.disabled=Boolean(sale);}
    form.dataset.savedId=sale.id||"已保存";form.dataset.savedNo=documentNo(sale);state.saleAttempt=null;state.salesCart=[];state.giftCart=[];state.saleDraft=null;
    try{window.speakSubmitSuccess?.();}catch{}
    try{await loadBasics();await go("orders");}catch{toast("销售单已保存，单号 "+documentNo(sale)+"；列表刷新失败，请稍后刷新，无需重新提交。",true);}
    try{window.SaleFeedback.showSuccess(sale,()=>go("sales"));}catch{toast("销售单已保存，单号 "+documentNo(sale)+"；无需重新提交。");}
  });
}
function saleItemEditor(index=-1,selectedSkuId="",selectedSerialNo="",suggestedPrice) {
  const editing=index>=0?state.salesCart[index]:null;
  const reserved=(skuId)=>state.salesCart.filter((item,i)=>i!==index&&item.skuId===skuId).reduce((sum,item)=>sum+item.quantity,0);
  const products=state.inventory.filter((p)=>p.active!==false&&(p.stockManaged===false||Boolean(p.warehouseId)));
  const available=(p)=>{
    if(p.stockManaged===false)return Infinity;
    const stockLeft=Number(p.quantity||0)-reserved(p.skuId);
    if(!p.trackSerial)return stockLeft;
    const serialLeft=(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item,i)=>i!==index&&item.serialNo===s.no)).length;
    return Math.min(stockLeft,serialLeft);
  };
  const stockOptions=products.filter((p)=>available(p)>0).map((p)=>({value:p.skuId,label:`${p.name} · ${p.stockManaged===false?"服务":`可加入 ${available(p)}`}`}));
  const options=[{value:"",label:"请选择商品"},...stockOptions];
  if (!stockOptions.length) return toast("没有可售商品",true);
  if(selectedSkuId&&!stockOptions.some((item)=>item.value===selectedSkuId))return toast("所选商品已不可售，请重新选择",true);
  const initial=products.find((p)=>p.skuId===(editing?.skuId||selectedSkuId));
  const retailPrice=(skuId)=>{const catalog=state.products.find((p)=>p.skuId===skuId);const stock=products.find((p)=>p.skuId===skuId);const price=Number(catalog?.salePrice??stock?.salePrice??0);return Number.isFinite(price)?price:0;};
  window.SaleCapture?.stop();
  modal(editing?"修改本单商品":"加入销售商品",[
    {name:"skuId",label:"商品",options,value:initial?.skuId||"",required:true},{name:"quantity",label:"数量",type:"number",min:1,step:1,value:editing?.quantity||1,required:true},{...moneyField("salePrice","本单售价（元）",editing?.salePrice??(initial?retailPrice(initial.skuId):"")),hint:"已填入商品档案零售价；在这里改价只影响本单"},
    {name:"serialNo",label:"选择串码",options:[],hint:"仅显示当前可售串码"},
    {name:"noMaterials",label:"维修服务确认无耗材",type:"checkbox",value:editing?.noMaterials},{name:"note",label:"备注",type:"textarea",wide:true,value:editing?.note},
    {name:"carrier",label:"号卡运营商",value:editing?.card?.carrier},{name:"packageName",label:"号卡套餐",value:editing?.card?.packageName},{name:"cardNo",label:"号卡号码",value:editing?.card?.cardNo},moneyField("expected","预计运营商佣金",editing?.card?.expected??0),
  ],async(d)=>{
    const p=products.find((x)=>x.skuId===d.skuId);const quantity=Number(d.quantity);
    if(!p)throw new Error("商品已不可售，请重新选择");
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>available(p))throw new Error("加入数量超过当前可售库存");
    if(p.trackSerial&&!d.serialNo)throw new Error("请选择可售串码");
    if(p.trackSerial&&quantity!==1)throw new Error("串码商品请逐件加入");
    if(p.trackSerial&&(!p.serials?.some((s)=>s.no===d.serialNo&&["可售","未激活"].includes(s.status))||state.salesCart.some((item,i)=>i!==index&&item.serialNo===d.serialNo)))throw new Error("该串码当前不可售或已加入本单");
    const repair=p.stockManaged===false&&p.type==="维修";
    const selectedMaterials=repair?materials.map(({skuId,quantity})=>({skuId,quantity})):[];
    if(repair&&!selectedMaterials.length&&!d.noMaterials)throw new Error("维修服务请选择耗材或确认无耗材");
    const priceCents=saleAmountCents(d.salePrice);
    const item={name:p.name,skuId:p.skuId,quantity,salePrice:priceCents/100,serialNo:p.trackSerial?d.serialNo:"",materials:selectedMaterials,noMaterials:repair&&d.noMaterials,note:d.note,card:p.type==="号卡"?{carrier:d.carrier,packageName:d.packageName||p.name,cardNo:d.cardNo,expected:Number(d.expected||0)}:undefined};
    if(index>=0)state.salesCart[index]=item;else state.salesCart.push(item);
    return {message:editing?"本单商品已更新":"商品已加入，请核对售价与收款",nextStep:editing?"sale-step-items":"sale-step-payment"};
  });
  $("modal-root").classList.add("sale-item-modal");
  const form=$("modal-form");
  form.querySelector('button[type="submit"]').textContent=editing?"保存本单商品":"加入并进入下一页";
  const skuField=form.elements.skuId.closest(".field");
  form.elements.skuId.required=false;
  skuField.hidden=true;
  const picker=document.createElement("div");picker.className="field wide sale-modal-picker";
  picker.innerHTML=`<label>选择商品 <b class="required-tag">必填</b></label><p class="operation-tip" data-page-explanation>可按分类下拉选择、搜索名称/编号/串码，或扫码、拍照识码。</p><select id="modal-sale-category" aria-label="商品分类"><option value="">全部分类</option></select><select id="modal-sale-select" aria-label="下拉选择商品"><option value="">下拉选择商品</option></select><input id="modal-sale-search" type="search" autocomplete="off" placeholder="搜索商品名称、编号或串码" aria-label="搜索商品"><div id="modal-sale-matches" class="sale-modal-matches"></div><div class="sale-lookup-actions"><button type="button" id="modal-sale-camera" class="secondary">扫码</button><button type="button" id="modal-sale-photo" class="secondary">拍照识码</button><input id="modal-sale-photo-input" type="file" accept="image/*" capture="environment" hidden></div><video id="modal-sale-video" playsinline muted hidden></video><p id="modal-sale-picker-status" class="muted" role="status"></p>`;
  skuField.after(picker);
  const serialField=form.elements.serialNo.closest('.field');serialField.classList.add('serial-entry-panel','wide');
  picker.after(serialField);
  serialField.insertAdjacentHTML('afterbegin','<label>串号录入 <b class="required-tag">手机必填</b></label><input id="modal-serial-input" type="text" inputmode="numeric" autocomplete="off" placeholder="扫码或输入完整串号／后4位" aria-label="输入串号"><div class="sale-lookup-actions"><button type="button" id="modal-serial-scan" class="secondary">扫码串号</button><button type="button" id="modal-serial-check" class="secondary">核对串号</button></div><p id="modal-serial-feedback" class="field-feedback" role="status"></p>');
  const serialInput=$('modal-serial-input');
  const verifySerial=()=>{const p=products.find(x=>x.skuId===form.elements.skuId.value),key=serialInput.value.trim(),note=$('modal-serial-feedback');if(!p?.trackSerial)return;
    const serials=(p.serials||[]).filter(v=>['可售','未激活'].includes(v.status)&&!state.salesCart.some((item,i)=>i!==index&&item.serialNo===v.no));
    const hits=key?serials.filter(v=>v.no===key||(/^\d{4}$/.test(key)&&v.no.endsWith(key))):serials;
    form.elements.serialNo.innerHTML='<option value="">'+(hits.length>1?'同尾号有多台，请选择完整串号':'请选择可售串号')+'</option>'+hits.map(v=>option(v.no,v.no)).join('');
    form.elements.serialNo.value=key&&hits.length===1?hits[0].no:'';
    note.innerHTML=key&&hits.length===1?'✓ 已核对完整串号：<span class="serial-full-number">'+E(hits[0].no)+'</span>':E(!key?'':hits.length>1?'找到 '+hits.length+' 个同尾号，请核对并下拉选择。':'未找到可售串号，请检查输入或库存状态。');form.elements.serialNo.setAttribute('aria-invalid',String(!!key&&hits.length!==1));note.dataset.kind=key&&!hits.length?'error':hits.length===1&&key?'good':'hint';
  };
  serialInput.addEventListener('input',verifySerial);$('modal-serial-check').addEventListener('click',verifySerial);$('modal-serial-scan').addEventListener('click',()=>$('modal-sale-camera').click());
  form.elements.serialNo.addEventListener('change',()=>{serialInput.value=form.elements.serialNo.value;form.elements.serialNo.setAttribute('aria-invalid','false');$('modal-serial-feedback').textContent=serialInput.value?'✓ 已选择串号：'+serialInput.value:'';$('modal-serial-feedback').dataset.kind='good';});
  const materials=(editing?.materials||[]).map((m)=>({...m}));
  const materialStock=products.filter((p)=>p.stockManaged!==false&&!p.trackSerial&&p.quantity>0);
  const materialSection=document.createElement("div");materialSection.className="field wide sale-materials";
  materialSection.innerHTML=`<label>维修耗材</label><div class="sale-material-add"><select id="sale-material-product">${materialStock.map((p)=>option(p.skuId,`${p.name} · 库存 ${p.quantity}`)).join("")}</select><input id="sale-material-qty" type="number" min="1" step="1" value="1" aria-label="耗材数量"><button id="sale-material-add" type="button" class="secondary">加入耗材</button></div><div id="sale-material-list"></div>`;
  form.elements.note.closest(".field").before(materialSection);
  const renderMaterials=()=>{$("sale-material-list").innerHTML=materials.map((m,i)=>`<div class="line actions"><span>${E(state.products.find((p)=>p.skuId===m.skuId)?.name||m.skuId)} × ${E(m.quantity)}</span>${button("移除","remove-sale-material",i,"danger")}</div>`).join("");};
  materialSection.querySelector("#sale-material-add").addEventListener("click",()=>{
    const skuId=$("sale-material-product").value,quantity=Number($("sale-material-qty").value);
    const stock=materialStock.find((p)=>p.skuId===skuId);
    const existing=materials.find((m)=>m.skuId===skuId);
    const otherCart=state.salesCart.reduce((sum,item,i)=>sum+(i===index?0:(item.materials||[]).filter((m)=>m.skuId===skuId).reduce((n,m)=>n+m.quantity,0)),0);
    if(!stock||!Number.isSafeInteger(quantity)||quantity<1||(existing?.quantity||0)+quantity+otherCart>stock.quantity){$("modal-error").textContent="耗材数量超过可用库存";return;}
    if(existing)existing.quantity+=quantity;else materials.push({skuId,quantity});
    form.elements.noMaterials.checked=false;$("modal-error").textContent="";renderMaterials();
  });
  materialSection.addEventListener("click",(event)=>{const button=event.target.closest('[data-action="remove-sale-material"]');if(!button)return;materials.splice(Number(button.dataset.value),1);renderMaterials();});
  form.elements.noMaterials.addEventListener("change",()=>{if(form.elements.noMaterials.checked){materials.length=0;renderMaterials();}});
  renderMaterials();
  const field=(name)=>form.elements[name].closest(".field");
  const sync=(changed=false)=>{
    const p=products.find((item)=>item.skuId===form.elements.skuId.value);
    form.querySelector('button[type="submit"]').disabled=!p;
    if(!p){field("serialNo").hidden=true;materialSection.hidden=field("noMaterials").hidden=true;for(const name of ["carrier","packageName","cardNo","expected"])field(name).hidden=true;return;}
    const serial=p.trackSerial===true,repair=p.stockManaged===false&&p.type==="维修",card=p.type==="号卡";
    const preset=retailPrice(p.skuId);
    const hasSuggested=!changed&&!editing&&p.skuId===selectedSkuId&&typeof suggestedPrice==='number'&&Number.isFinite(suggestedPrice)&&suggestedPrice>0;
    if(changed||!editing)form.elements.salePrice.value=(hasSuggested?suggestedPrice:preset).toFixed(2);
    field("salePrice").querySelector("small").textContent=hasSuggested?"助理带入本单售价 "+M(suggestedPrice)+"，请核对；档案零售价 "+M(preset):preset>0?"档案零售价 "+M(preset)+"；修改仅对本单有效":"档案零售价未设置，请核对本单售价";
    if(changed)form.elements.quantity.value=1;
    form.elements.quantity.readOnly=serial;
    form.elements.quantity.max=p.stockManaged===false?"":String(available(p));
    field("serialNo").hidden=!serial;
    materialSection.hidden=field("noMaterials").hidden=!repair;
    for(const name of ["carrier","packageName","cardNo","expected"])field(name).hidden=!card;
    const serials=(p.serials||[]).filter((s)=>["可售","未激活"].includes(s.status)&&!state.salesCart.some((item,i)=>i!==index&&item.serialNo===s.no));
    form.elements.serialNo.innerHTML='<option value="">请选择可售串码</option>'+serials.map((s)=>option(s.no,s.no)).join("");
    if(!changed&&editing?.skuId===p.skuId)form.elements.serialNo.value=editing.serialNo||"";
    else if(!changed&&selectedSerialNo&&p.skuId===selectedSkuId)form.elements.serialNo.value=selectedSerialNo;
    form.elements.serialNo.required=serial;form.elements.serialNo.setAttribute('aria-invalid','false');serialInput.value=form.elements.serialNo.value;$("modal-serial-feedback").textContent=serial?"请扫码、输入或选择当前可售串号。":"";serialField.classList.toggle("required-field",serial);
  };
  form.elements.skuId.addEventListener("change",()=>sync(true));
  sync();
  const category=picker.querySelector("#modal-sale-category");
  const dropdown=picker.querySelector("#modal-sale-select");
  const search=picker.querySelector("#modal-sale-search");
  const matches=picker.querySelector("#modal-sale-matches");
  const pickerStatus=picker.querySelector("#modal-sale-picker-status");
  const categories=[...new Set(stockOptions.map((o)=>products.find((p)=>p.skuId===o.value)?.type||"未分类"))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  category.innerHTML='<option value="">全部分类</option>'+categories.map((name)=>option(name,name)).join("");
  const candidates=()=>products.filter((p)=>available(p)>0&&(!category.value||(p.type||"未分类")===category.value)).sort((a,b)=>a.name.localeCompare(b.name,"zh-CN"));
  const matchesQuery=(p,term)=>{
    const haystack=[p.name,p.shortName,p.externalCode,p.skuId,p.type,p.subType,p.thirdType,...(p.aliases||[]),...(p.serials||[]).map((v)=>v.no)].join(" ").toLowerCase();
    return term.split(/\s+/).filter(Boolean).every((word)=>{const group=state.searchSynonyms.find((row)=>row.terms.some((v)=>v.toLowerCase()===word));return (group?group.terms:[word]).some((v)=>haystack.includes(v.toLowerCase()));});
  };
  const renderPicker=()=>{
    const availableProducts=candidates(),term=search.value.trim().toLowerCase();
    const filtered=term?availableProducts.filter((p)=>matchesQuery(p,term)):availableProducts;
    dropdown.innerHTML='<option value="">下拉选择商品（'+availableProducts.length+' 种）</option>'+availableProducts.map((p)=>option(p.skuId,p.name+' · '+(p.externalCode||p.skuId)+' · '+M(retailPrice(p.skuId)))).join("");
    if(filtered.some((p)=>p.skuId===form.elements.skuId.value))dropdown.value=form.elements.skuId.value;
    matches.innerHTML=filtered.length?filtered.slice(0,12).map((p)=>'<button type="button" data-sku="'+E(p.skuId)+'"><strong>'+E(p.name)+'</strong><small>'+E(p.externalCode||p.skuId)+' · '+(p.stockManaged===false?'服务项目':p.trackSerial?'串码商品 · 可售 '+available(p):'可售 '+available(p))+' · '+M(retailPrice(p.skuId))+'</small></button>').join(''):'<p class="muted">没有匹配的可售商品，请换个名称或编号。</p>';
    if(filtered.length>12)matches.insertAdjacentHTML('beforeend','<p class="muted">还有 '+(filtered.length-12)+' 种；可继续输入关键词或按分类下拉选择。</p>');
  };
  const pick=(skuId,serialNo='')=>{
    const p=products.find((x)=>x.skuId===skuId);
    if(!p||available(p)<=0){pickerStatus.textContent='该商品当前不可售，请换选。';return;}
    form.elements.skuId.value=skuId;sync(true);
    if(serialNo){form.elements.serialNo.value=serialNo;serialInput.value=serialNo;verifySerial();}
    pickerStatus.textContent='已选 '+p.name+'；请核对数量、售价'+(p.trackSerial?'和串码':'')+'。';
    search.value='';renderPicker();
  };
  const useCode=(raw)=>{
    const original=String(raw||'').trim(),key=original.startsWith('JY1:')?original.slice(4):original;
    const p=products.find((x)=>x.skuId===key||x.externalCode===key||(x.serials||[]).some((entry)=>entry.no===key));
    if(!p){search.value=key;renderPicker();pickerStatus.textContent='已识别 '+key+'，未找到可售商品，请核对编码。';return;}
    const serial=(p.serials||[]).find((entry)=>entry.no===key&&['可售','未激活'].includes(entry.status));
    if(p.trackSerial&&(p.serials||[]).some((entry)=>entry.no===key)&&!serial){pickerStatus.textContent='该串码当前不可售。';return;}
    pick(p.skuId,serial?.no||'');
  };
  category.addEventListener('change',renderPicker);
  search.addEventListener('input',renderPicker);
  dropdown.addEventListener('change',()=>{if(dropdown.value)pick(dropdown.value);});
  matches.addEventListener('click',(event)=>{const button=event.target.closest('button[data-sku]');if(button)pick(button.dataset.sku);});
  const photoInput=picker.querySelector('#modal-sale-photo-input');
  picker.querySelector('#modal-sale-photo').addEventListener('click',()=>photoInput.click());
  photoInput.addEventListener('change',async()=>{
    const file=photoInput.files?.[0];if(!file)return;
    let image;try{image=await createImageBitmap(file);const code=await window.SaleCapture.decode(image);if(code)useCode(code);else pickerStatus.textContent='照片中未识别到二维码或条码，请换清晰照片或搜索商品。';}
    catch{pickerStatus.textContent='照片识别失败，请换照片或搜索商品。';}
    finally{image?.close();photoInput.value='';}
  });
  const video=picker.querySelector('#modal-sale-video'),cameraButton=picker.querySelector('#modal-sale-camera');
  let stream=null,scanning=false,lastScan=0;
  const stopScan=()=>{scanning=false;if(stream)stream.getTracks().forEach((track)=>track.stop());stream=null;video.pause();video.srcObject=null;video.hidden=true;cameraButton.textContent='扫码';};
  cameraButton.addEventListener('click',async()=>{
    if(scanning){stopScan();return;}
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.srcObject=stream;video.hidden=false;await video.play();scanning=true;cameraButton.textContent='关闭扫码';pickerStatus.textContent='将二维码或条码放入取景框。';
      const frame=async(time)=>{if(!scanning)return;if(time-lastScan<280){requestAnimationFrame(frame);return;}lastScan=time;try{const code=await window.SaleCapture.decode(video);if(code){stopScan();useCode(code);return;}}catch{}requestAnimationFrame(frame);};requestAnimationFrame(frame);
    }catch{stopScan();pickerStatus.textContent='相机未打开。请允许相机权限，或用拍照、搜索和下拉选择。';}
  });
  const observer=new MutationObserver(()=>{if(!picker.isConnected){stopScan();observer.disconnect();}});
  observer.observe(document.body,{childList:true,subtree:true});
  renderPicker();
  if(initial)pickerStatus.textContent='已选 '+initial.name+'；请核对数量、售价'+(initial.trackSerial?'和串码':'')+'。';
}
function salePaymentSummary(order) {
  const credit = Number(order.paymentCredit || 0);
  const actual = Math.max(0, Number(order.receivedAmount || 0) - credit);
  const review = order.paymentReview;
  if (order.redReversedBy || review?.status === "已红冲") return "原收款已红冲，详见资金流水";
  const confirmed = !review || ["已核对", "已确认到账", "无需收款"].includes(review.status);
  return `${credit ? `原单抵款 ${M(credit)} · ` : ""}本次应收 ${M(review?.amount ?? actual)} · ${confirmed ? "已核对收款" : "已登记收款（待核对）"} ${M(actual)}`;
}
async function renderOrders(more=false) {
  const version=++orderQueryVersion,viewVersion=officeViewVersion,tab=state.tab,term=state.orderQuery||"",cursor=state.orderCursor;
  const current=()=>version===orderQueryVersion&&viewVersion===officeViewVersion&&state.tab===tab&&(state.orderQuery||"")===term;
  const query=new URLSearchParams({q:term});if(more&&cursor)query.set("cursor",cursor);
  let page;try{page=await api("/api/sale-orders/page?"+query);}catch(error){if(!current())return;throw error;}
  if(!current())return;
  state.orders=more?[...state.orders,...page.rows]:page.rows;state.orderCursor=page.nextCursor;
  const rows=state.orders.map((o)=>`<tr><td data-label="单号">${E(documentNo(o))}<small>${E(displayTime(o.createdAt))} · ${E(o.customerName||"散客")}${o.customerMask?" · "+E(o.customerMask):""} · 开单：${E(state.users.find((u)=>u.id===o.operatorId)?.name||o.operatorId||"—")}</small></td><td data-label="商品">${E(o.items.map((i)=>`${i.name} × ${i.quantity}`).join("、"))}</td><td data-label="赠品">${window.Gifts.orderCell(o)}</td><td data-label="通道">${E(o.saleMode==="guobu"?"国补":"普通")}</td><td data-label="金额">${M(o.amount)}<small>${salePaymentSummary(o)}</small></td><td data-label="状态">${E(label("order",o.status))}<small>${E(o.paymentReview?.status||"历史单（原收款记录）")}</small></td><td data-label="操作">${redPacketEntry("sales",o)}${button("补赠品", "gift-supplement",o.id)}${(state.user.capabilities.returnSale?button("申请退货", "return-sale",o.id)+button("申请换货","exchange-sale",o.id):"")}</td></tr>`);
  $("main").innerHTML=heading(state.tab==="returns"?"退换货":"销售单查询","员工从原销售单提交退货或换货申请，老板本人批准后才生效。审批前库存、销售金额和退款记录保持原状。",button("刷新","refresh")+"<a class=\"secondary\" href=\"/gift-approvals\">赠品审批</a>"+(state.user.capabilities.manageUsers?button("赠品限额设置","gift-settings"):""))+`<form id="orders-filter" class="card document-filter"><label>原单 / 商品 / 串号<input name="q" type="search" value="${E(state.orderQuery||"")}" placeholder="输入单号、商品或串号"></label><button class="primary" type="submit">查询</button></form><div class="card sales-orders-list">${table(["单号","商品","赠品","通道","金额","状态","操作"],rows)}${state.orderCursor?button("查看更多销售单","orders-more"):""}</div>`;
  $("orders-filter").onsubmit=async event=>{event.preventDefault();state.orderQuery=new FormData(event.currentTarget).get("q").trim();state.documentQueries||={};state.documentQueries[state.tab]=state.orderQuery;await renderOrders();};
  if(tab==="returns"&&current())await window.TradeDocuments.renderReturnRequests(current);
}
function returnSale(id) {
  const o=state.orders.find((x)=>x.id===id);if(!o)return;
  const fields=o.items.filter((i)=>i.quantity>(i.returnedQuantity||0)).map((i)=>({name:`item_${i.id}`,label:`${i.name} · 最多可退 ${i.quantity-(i.returnedQuantity||0)}`,type:"number",min:o.saleMode==="guobu"?1:0,step:1,value:o.saleMode==="guobu"?1:0}));
  if(!fields.length)return toast("这张单已无可退商品",true);
  fields.push({name:"reason",label:"退货原因",type:"textarea",wide:true,required:true},{name:"account",label:"退款账户",options:accounts,value:o.paymentMethod||"微信"});
  if(o.saleMode==="guobu")fields.push({name:"platformRefundRef",label:"国补平台退款流水号",required:true,wide:true,hint:"先在原平台完成整单退货；顾客实付款与补贴款分别原路退回",inlineHint:"先在国补原平台完成退款。"});
  modal(`申请退货 · ${documentNo(o)}`,fields,async(d,write)=>{const items=o.items.map((i)=>({itemId:i.id,quantity:Number(d[`item_${i.id}`]||0)})).filter((i)=>i.quantity>0);if(!items.length)throw new Error("请填写退货数量");const result=await write("/api/sale-returns",{orderId:o.id,items,reason:d.reason,account:d.account,platformRefundRef:d.platformRefundRef});return {...result,message:result.message||"退货申请已提交，等待老板批准；尚未退货入账。"};},"提交申请后等待老板同意，审批前不会恢复库存或登记退款。"+(o.saleMode==="guobu"?` 国补整单退货：顾客原路退 ${M(o.receivedAmount)}，补贴 ${M(o.subsidyAmount)} 按平台流程冲退。`:""));
  $("modal-form").querySelector("button[type=submit]").textContent="提交退货申请";
}
function purchaseRecordTitle(row, history = "") {
  const shortNo=documentNo(row);
  const fullNo=shortNo!==String(row.id||"")?`<details class="purchase-record-detail"><summary>完整单号</summary><code>${E(row.id)}</code></details>`:"";
  return `<strong>${E(shortNo)}</strong>${row.createdAt?`<small>${E(displayTime(row.createdAt))}</small>`:""}${fullNo}${history}`;
}
function purchaseLabelLink(order) {
  return order.items.some(item=>item.qrCode||state.products.find(p=>p.skuId===item.skuId)?.qrCode)?`<a class="staff-account-link" href="/qr?purchaseId=${encodeURIComponent(order.id)}">二维码标签／补打</a>`:"";
}
function purchaseItemLines(items, receiving = false) {
  return `<div class="purchase-item-lines">${items.map(i=>`<div><span>${E(i.name)}</span><strong>${receiving?`已收 ${E(i.received)} / 订 ${E(i.quantity)}`:`× ${E(i.quantity)}`}</strong>${state.user.capabilities.cost?`<p class="record-value">${receiving?"预计进货价":"进货价"}：<strong>${M(i.recordedCostPrice??i.costPrice)}</strong>${i.recordedCostPrice!=null&&i.recordedCostPrice!==i.costPrice?`<small>原录入 ${M(i.costPrice)} · 老板已更正</small>`:""}</p>`:""}</div>`).join("")}</div>`;
}
function documentQuery(){return state.documentQueries?.[state.tab]||"";}
function documentMatches(row,term=documentQuery()){
  const q=String(term||"").trim().toLowerCase();if(!q)return true;
  const values=Object.entries(row||{}).filter(([key])=>key==="id"||key==="number"||key==="displayNo"||key.endsWith("Id")||key.endsWith("DisplayNo")||["supplier","counterparty","name","title","reason","reference"].includes(key)).map(([,value])=>String(value??""));
  values.push(...(row.items||[]).map(item=>item.name||""));return values.join(" ").toLowerCase().includes(q);
}
function documentFilter(id){return `<form id="${E(id)}" class="card document-filter"><label>单号 / 原单 / 名称<input name="q" type="search" value="${E(documentQuery())}" placeholder="输入短单号或原单号"></label><button class="primary" type="submit">查询</button><button class="secondary" type="button" data-document-all>全部</button></form>`;}
function bindDocumentFilter(id,render){const form=$(id);if(!form)return;form.onsubmit=async event=>{event.preventDefault();state.documentQueries||={};state.documentQueries[state.tab]=new FormData(form).get("q").trim();await render().catch(showError);};form.querySelector('[data-document-all]').onclick=async()=>{state.documentQueries||={};state.documentQueries[state.tab]="";await render().catch(showError);};}
function purchaseCorrectionHistory(order) {
  const rows=order.priceCorrections||[];
  return rows.length?`<details class="purchase-record-detail"><summary>进货价更正记录（${rows.length}）</summary>${rows.map(r=>`<p>${E(displayTime(r.createdAt))} · ${E(r.operator)}<br>进货价 ${M(r.currentRecordedPrice)} → ${M(r.correctedUnitPrice)}<br>库存成本差额 ${M(r.inventoryDelta)} · 已售成本差额 ${M(r.salesDelta)}<br>${E(r.note)} · 凭证 ${E(r.reference)}</p>`).join("")}</details>`:"";
}
async function renderPurchase() {
  const current=officePageCurrent("purchase");
  const data=await officePageRead(current,()=>Promise.all([api("/api/purchase-orders"),api("/api/procurement-plans"),api("/api/suppliers/directory")]));
  if(!current())return;
  const [orders,plans,suppliers]=data;
  state.plans=plans;state.suppliers=suppliers;state.purchaseOrders=orders;
  const orderedPlans=plans.filter(p=>documentMatches(p)).slice().reverse().sort((a,b)=>Number((b.receiverId||b.operatorId)===state.user.id)-Number((a.receiverId||a.operatorId)===state.user.id));
  const planRows=orderedPlans.slice(0,40).map((p)=>{
    const mine=(p.receiverId||p.operatorId)===state.user.id;
    const canReceive=p.status==="open"&&(mine||state.user.roleCode==="owner");
    const review=p.paymentReview;
    const reviewLabel=review?.status==="approved"?"已批 "+M(review.approvedAmount):review?.status==="deferred"?"暂缓付款":review?.status==="pending"?"待老板审核":"历史单（原收款记录）";
    const canPay=p.status==="open"&&review?.status==="approved"&&p.approvedRemaining>0&&state.user.capabilities.supplierSettle;
    const actions=p.status==="open"?(canReceive?button("分批验货入库","receive-plan",p.id):"")+(state.user.roleCode==="owner"?button("审核付款","review-plan-payment",p.id)+button("指派验货","assign-plan",p.id)+button("终止余货","close-plan",p.id,"danger"):"")+(canPay?button("登记实际付款","pay-plan",p.id):""):"";
    const history=(p.events||[]).map((e)=>`<div>${E(e.type)} · ${E(e.operator||e.operatorId||"")} · ${E(displayTime(e.at))}${e.orderId?" · "+E(documentRef(e,"orderId")):""}${e.amount!=null?" · "+M(e.amount):""}${e.approvedAmount!=null?" · 批准 "+M(e.approvedAmount):""}${e.reason?" · "+E(e.reason):""}</div>`).join("");
    return `<tr><td data-label="编号" class="record-title">${purchaseRecordTitle(p,`<details class="purchase-record-detail"><summary>过程记录</summary>${history||"历史单据暂无事件明细"}</details>`)}</td><td data-label="往来单位"><span class="record-value">${E(suppliers.find((s)=>s.id===p.supplierId)?.name||p.supplier)}</span></td><td data-label="收货进度">${purchaseItemLines(p.items,true)}</td><td data-label="验货人"><span class="record-value">${E(p.receiver||p.operator||"待指派")}</span></td><td data-label="付款审核"><div class="record-value">${E(reviewLabel)}<small>已付 <span class="money-value">${M(p.paidAmount||0)}</span> / 订货 <span class="money-value">${M(p.plannedAmount||0)}</span></small></div></td><td data-label="状态"><span class="record-value">${E(label("plan",p.status))}</span></td><td data-label="操作">${redPacketEntry("procurementPlans",p)}${actions}</td></tr>`;
  });
  const orderRows=orders.filter(o=>documentMatches(o)).slice().reverse().slice(0,40).map((o)=>`<tr><td data-label="编号" class="record-title">${purchaseRecordTitle(o)}</td><td data-label="往来单位"><span class="record-value">${E(o.supplier)}</span></td><td data-label="商品">${purchaseItemLines(o.items)}${purchaseLabelLink(o)}${purchaseCorrectionHistory(o)}</td><td data-label="金额"><span class="record-value money-value">${M(o.amount)}</span></td><td data-label="待付"><span class="record-value money-value">${M(o.outstanding)}</span></td><td data-label="操作">${redPacketEntry("purchases",o)}${button("申请采购退货","purchase-return-request",o.id)}${state.user.roleCode==="owner"?button("更正进货价","purchase-price-correction",o.id):""}</td></tr>`);
  $("main").innerHTML=heading("订货与采购入库","无串号实物商品入库后自动有码，点入库记录可打印或补打标签。",button("直接采购入库","purchase-direct","","primary")+button("新建订货","purchase-plan"))+
    `${documentFilter("purchase-filter")}<div class="card mobile-record-list purchase-records"><h2>订货单</h2>${table(["编号","往来单位","收货进度","验货人","付款审核","状态","操作"],planRows.length?planRows:[`<tr class="purchase-empty"><td colspan="7">暂无订货单</td></tr>`])}</div><div class="card mobile-record-list purchase-records"><h2>最近入库</h2>${table(["编号","往来单位","商品","金额","待付","操作"],orderRows.length?orderRows:[`<tr class="purchase-empty"><td colspan="6">暂无入库记录</td></tr>`])}</div>`;
  bindDocumentFilter("purchase-filter",renderPurchase);
  if(current())await window.TradeDocuments.renderPurchaseReturnRequests(current);
  if(current()&&state.user.roleCode==="owner")await window.TradeDocuments.renderCatalogReviews(current);
}

function procurementPlanEditor() {
  const products=state.products.filter(p=>p.stockManaged!==false&&p.active!==false);
  const fields=[
    {name:"supplierId",label:"往来单位",options:[{value:"",label:"请选择往来单位"},...state.suppliers.map(s=>({value:s.id,label:s.name})),{value:"__new_supplier__",label:"＋ 新增往来单位"}],required:true},
    {name:"supplierName",label:"新增往来单位名称",inlineHint:"名单中没有时填写，可直接接着订货。"},
    {name:"supplierContact",label:"联系方式（选填）"},
  ];
  let nextLine=0;const lines=new Map();
  modal("新建订货",fields,(d,write)=>{
    const items=Array.from(lines.values()).map(row=>({skuId:d[row.sku.name],quantity:Number(d[row.qty.name]),costPrice:Number(d[row.cost.name])}));
    if(!items.length)throw new Error("请添加订货商品");
    let totalCents=0;
    for(const [index,item] of items.entries()){
      if(!products.some(p=>p.skuId===item.skuId))throw new Error("第"+(index+1)+"行：请选择有效商品");
      if(!Number.isSafeInteger(item.quantity)||item.quantity<1)throw new Error("第"+(index+1)+"行：数量须为正整数");
      const cents=modalPaymentCents(d[Array.from(lines.values())[index].cost.name]);
      if(cents===null||!Number.isSafeInteger(cents*item.quantity))throw new Error("第"+(index+1)+"行：请核对预计进货价与数量");
      totalCents+=cents*item.quantity;if(!Number.isSafeInteger(totalCents))throw new Error("订货合计金额超出范围，请分单订货");
    }
    const adding=d.supplierId==="__new_supplier__",supplier=adding?String(d.supplierName||"").trim():state.suppliers.find(s=>s.id===d.supplierId)?.name;
    if(!supplier)throw new Error(adding?"请填写新增往来单位名称":"请选择往来单位");
    return write("/api/procurement-plans",{supplierId:adding?"":d.supplierId,supplier,...(adding?{supplierContact:String(d.supplierContact||"").trim()}:{}),items});
  },"同一张单可订多种商品，每种商品可填写多台数量。订货时不用填串号，到货入库时再逐台登记；提交后由老板审核付款。");
  const form=$("modal-form"),root=form.closest("#modal-root"),host=document.createElement("div");host.className="field wide";host.setAttribute("data-procurement-lines","");form.querySelector(".fields").append(host);
  const toolbar=document.createElement("div");toolbar.className="field wide";toolbar.style.cssText="display:flex;flex-wrap:wrap;align-items:center;gap:.75rem";
  const add=document.createElement("button");add.type="button";add.className="secondary";add.textContent="＋ 添加商品";
  const summary=document.createElement("strong");summary.setAttribute("aria-live","polite");toolbar.append(add,summary);form.querySelector(".fields").append(toolbar);
  const locked=()=>root.dataset.submitting==="1"||root.dataset.uncertain==="1";
  function sync(){
    let total=0,qty=0,valid=true;let index=0;
    for(const row of lines.values()){
      index++;row.title.textContent="商品 "+index;row.remove.disabled=lines.size<=1;
      const q=Number(row.qty.value),cents=modalPaymentCents(row.cost.value);
      if(!Number.isSafeInteger(q)||q<1||cents===null||!Number.isSafeInteger(cents*q)){valid=false;continue;}
      qty+=q;total+=cents*q;if(!Number.isSafeInteger(total)||!Number.isSafeInteger(qty))valid=false;
    }
    summary.textContent=lines.size+" 行商品 · "+(valid?qty+" 件 · 预计合计 "+M(total/100):"请填齐数量与预计进货价");
  }
  function addLine(){
    if(locked())return;if(lines.size>=100){toast("一张订货单最多100行商品，请分单订货",true);return;}
    const key=++nextLine,names={sku:"planSku_"+key,qty:"planQty_"+key,cost:"planCost_"+key};
    const descriptors=[{name:names.sku,label:"商品 "+key,options:[{value:"",label:"请选择商品"},...products.map(p=>({value:p.skuId,label:p.name}))],required:true},qtyField(names.qty,"数量",1),moneyField(names.cost,"预计进货价")];fields.push(...descriptors);
    const block=document.createElement("section");block.style.cssText="border:1px solid #b6c9ed;border-radius:10px;padding:12px;margin-bottom:12px";block.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:10px"><strong data-line-title></strong><button type="button" class="secondary" data-remove-line>删除此行</button></div><div class="fields">'+descriptors.map(formField).join("")+'</div>';host.append(block);
    const row={sku:form.elements[names.sku],qty:form.elements[names.qty],cost:form.elements[names.cost],title:block.querySelector("[data-line-title]"),remove:block.querySelector("[data-remove-line]")};lines.set(key,row);
    row.sku.addEventListener("change",()=>{row.cost.value="";sync();});
    row.remove.addEventListener("click",()=>{if(locked()||lines.size<=1)return;lines.delete(key);for(const descriptor of descriptors){const i=fields.indexOf(descriptor);if(i>=0)fields.splice(i,1);}block.remove();sync();});sync();
  }
  add.addEventListener("click",addLine);form.addEventListener("input",sync);form.addEventListener("change",sync);addLine();
  const syncSupplier=()=>{const adding=form.elements.supplierId.value==="__new_supplier__";for(const name of ["supplierName","supplierContact"]){const input=form.elements[name];input.closest(".field").hidden=!adding;input.disabled=!adding;input.required=adding&&name==="supplierName";}};
  form.elements.supplierId.addEventListener("change",syncSupplier);syncSupplier();exposeNewChoice(form,"supplierId","__new_supplier__","supplierName");
}

function purchaseEditor(mode,planId="") {
  if(mode==="plan")return procurementPlanEditor();
  const plan=state.plans?.find((p)=>p.id===planId);
  const planItems=plan?.items.filter((i)=>i.quantity>i.received)||[];
  const products=state.products.filter((p)=>p.stockManaged!==false&&p.active!==false);
  modal(mode==="plan"?"新建订货":plan?"订货分批收货":"直接采购入库",[
    {name:"supplierId",label:"往来单位",options:[{value:"",label:"请选择往来单位"},...state.suppliers.map((s)=>({value:s.id,label:s.name})),...(!plan?[{value:"__new_supplier__",label:"＋ 新增往来单位"}]:[])],value:plan?.supplierId,required:true},
    ...(!plan?[{name:"supplierName",label:"新增往来单位名称",inlineHint:"名单中没有时填写，可直接接着入库或订货。"},{name:"supplierContact",label:"联系方式（选填）",hint:"可以写联系人姓名、电话等；暂时不知道可留空。"}]:[]),
    plan?{name:"planItemId",label:"待收商品",options:[{value:"",label:"请选择实际收到的商品"},...planItems.map((i)=>({value:i.id,label:`${i.name} · 待收 ${i.quantity-i.received}`}))],required:true}:{name:"skuId",label:"商品",options:[{value:"",label:"请选择商品"},...products.map((p)=>({value:p.skuId,label:p.name}))],required:true},
    qtyField("quantity","数量",planItems[0]?planItems[0].quantity-planItems[0].received:1),{...moneyField("costPrice",mode==="plan"?"预计进货价":"进货价",planItems[0]?.costPrice??""),inlineHint:mode==="plan"?"订货预计价，收货时核实实际进货价。":"填写本次实际进货单价；入库后员工不能修改，录错由老板办理更正。"},
    {name:"serials",label:"串号（串号商品必填）",type:"textarea",wide:true,inlineHint:"数量须与串号数一致。",hint:"串码商品每行一个串码，数量须一致"},
    ...(mode!=="plan"?[{name:"invoiceNo",label:"往来单位发票号码（选填）"}]:[]),
    ...(!plan&&mode!=="plan"?[{name:"dueDate",label:"应付日期",type:"date",inlineHint:"入库只建立应付；实际付款请在往来单位往来中登记，可选多个付款账户。"}]:[]),
  ],(d,write)=>{
    const item=plan?planItems.find((x)=>x.id===d.planItemId):null;
    const serials=d.serials.split(/[\s,，]+/).filter(Boolean);
    const newSupplier=!plan&&d.supplierId==="__new_supplier__";
    const supplierName=newSupplier?String(d.supplierName||"").trim():state.suppliers.find((s)=>s.id===d.supplierId)?.name;
    if(newSupplier&&!supplierName)throw new Error("请填写新增往来单位名称");
    const data={invoiceNo:d.invoiceNo,supplierId:newSupplier?"":d.supplierId,supplier:supplierName,...(newSupplier?{supplierContact:String(d.supplierContact||"").trim()}:{}),items:[{skuId:item?.skuId||d.skuId,quantity:Number(d.quantity),costPrice:Number(d.costPrice),serials,...(item?{planItemId:item.id}:{})}]};
    if(plan){data.planId=plan.id;data.receiptToken=plan.receiptToken;}
    else if(mode!=="plan"){data.paidAmount=0;data.dueDate=d.dueDate;}
    return write(mode==="plan"?"/api/procurement-plans":"/api/purchase-orders",data).then(result=>mode!=="plan"&&result.items?.some(i=>i.qrCode)?{...result,message:"入库成功，二维码已生成；点本单的二维码标签可预览、打印或补打。"}:result);
  });
  const form=$("modal-form");
  if(!plan){
    const syncSupplierChoice=()=>{const adding=form.elements.supplierId.value==="__new_supplier__";for(const name of ["supplierName","supplierContact"]){const input=form.elements[name];input.closest(".field").hidden=!adding;input.disabled=!adding;input.required=adding&&name==="supplierName";}};
    form.elements.supplierId.addEventListener("change",syncSupplierChoice);syncSupplierChoice();
    exposeNewChoice(form,"supplierId","__new_supplier__","supplierName");
  }
  if(plan){
    const supplier=form.elements.supplierId;
    supplier.setAttribute("aria-disabled","true");
    supplier.title="订货单往来单位已固定";
    supplier.style.pointerEvents="none";
    supplier.tabIndex=-1;
    form.elements.planItemId.addEventListener("change",()=>{
      const item=planItems.find((row)=>row.id===form.elements.planItemId.value);
      if(!item)return;
      form.elements.quantity.value=String(item.quantity-item.received);
      form.elements.costPrice.value=String(item.costPrice??0);
    });
  }else{
    form.elements.skuId.addEventListener("change",()=>{
      const product=products.find((row)=>row.skuId===form.elements.skuId.value);
      form.elements.costPrice.value="";
    });
  }
}

function purchasePriceCorrection(orderId) {
  if(state.user.roleCode!=="owner")return toast("进货价更正由老板操作",true);
  const order=state.purchaseOrders?.find(row=>row.id===orderId);
  if(!order)return toast("请刷新后选择原入库单",true);
  const first=order.items[0];if(!first)return toast("原入库明细不存在",true);
  let prepared=null,confirmedSubmission=null;
  const reference="JC-"+Date.now();
  modal("更正录错的进货价",[
    {name:"itemId",label:"原入库商品",options:order.items.map(i=>({value:i.id,label:i.name+" × "+i.quantity})),value:first.id,required:true},
    {name:"oldPrice",label:"当前录入的进货价",value:M(first.recordedCostPrice??first.costPrice)},
    {...moneyField("newUnitPrice","正确进货价",first.recordedCostPrice??first.costPrice),inlineHint:"更正录入错误；供货商降价补差请使用往来单位中的调价补差。"},
    {name:"reference",label:"更正凭证号",value:reference,required:true},
    {name:"reason",label:"录错原因与核对依据",type:"textarea",wide:true,required:true},
  ],async(d,write)=>{
    const payload={supplierId:order.supplierId,purchaseId:order.id,itemId:d.itemId,newUnitPrice:Number(d.newUnitPrice),reference:d.reference,reason:d.reason};
    const signature=JSON.stringify(payload),root=$("modal-root");
    if(confirmedSubmission?.uncertain&&confirmedSubmission.signature!==signature){const error=new Error("上次更正结果待核对，请按原内容重试后再改。");error.uncertain=true;throw error;}
    if(!prepared||prepared.signature!==signature){
      let preview;try{preview=await api("/api/purchase-price-corrections/preview",{method:"POST",body:JSON.stringify(payload)});}catch(error){error.uncertain=false;throw error;}
      prepared={signature,preview};
      $("purchase-correction-preview")?.remove();
      const panel=document.createElement("section");panel.id="purchase-correction-preview";panel.className="card";panel.setAttribute("aria-live","polite");
      panel.innerHTML=`<h3>请核对更正结果</h3><p>进货价：<strong>${M(preview.currentRecordedPrice)} → ${M(preview.correctedUnitPrice)}</strong></p><p>数量：${E(preview.quantity)} · 采购差额：${M(preview.priceDelta)}</p><p>库存成本变化：${M(preview.inventoryDelta)}<br>已售成本变化：${M(preview.salesDelta)}<br>已售毛利变化：${M(-preview.salesDelta)}</p><p>${E(preview.accountingNote||"未付货款先调整待付；多付部分记应退；本次不登记实际收付款。")}</p><p>原入库记录保留，更正记录另存；已核定或发放的工资不会覆盖。</p><p><strong>核对无误后，再点“确认更正”。</strong></p>`;
      root.querySelector(".form-actions").before(panel);root.dataset.nextSubmitCaption="确认更正";panel.scrollIntoView({block:"nearest"});return false;
    }
    confirmedSubmission||={signature,body:{...payload,previewToken:prepared.preview.previewToken,confirmed:true},uncertain:false};
    try{const result=await write("/api/purchase-price-corrections",confirmedSubmission.body);return {...result,message:"进货价已更正，库存、已售成本及往来账已同步；原入库记录保留。"};}
    catch(error){if(error.uncertain)confirmedSubmission.uncertain=true;else{prepared=null;confirmedSubmission=null;root.dataset.nextSubmitCaption="预览更正";$("purchase-correction-preview")?.remove();}throw error;}
  },"仅用于进货价录错。先预览影响，再由老板确认；关账或来源不完整时须先核对。");
  const form=$("modal-form"),root=$("modal-root");form.elements.oldPrice.readOnly=true;root.dataset.nextSubmitCaption="预览更正";form.querySelector("button[type=submit]").textContent="预览更正";
  const reset=()=>{if(confirmedSubmission?.uncertain)return;prepared=null;confirmedSubmission=null;root.dataset.nextSubmitCaption="预览更正";form.querySelector("button[type=submit]").textContent="预览更正";$("purchase-correction-preview")?.remove();};
  form.addEventListener("input",reset);form.addEventListener("change",reset);
  form.elements.itemId.addEventListener("change",()=>{const item=order.items.find(i=>i.id===form.elements.itemId.value);if(item){form.elements.oldPrice.value=M(item.recordedCostPrice??item.costPrice);form.elements.newUnitPrice.value=String(item.recordedCostPrice??item.costPrice);}});
}
async function renderSuppliers() {
  const current=officePageCurrent("suppliers");
  const data=await officePageRead(current,()=>api("/api/suppliers"));if(!current())return;state.suppliers=data.rows;
  const rows=data.rows.map((s)=>`<tr><td data-label="往来单位" class="record-title"><strong>${E(s.name)}</strong><small>${E(s.contact)}</small></td><td data-label="待付"><span class="record-value money-value">${M(s.payable)}</span></td><td data-label="应退"><span class="record-value money-value">${M(s.cash)}</span></td><td data-label="预付"><span class="record-value money-value">${M(s.advance)}</span></td><td data-label="仅抵货款"><span class="record-value money-value">${M(s.credit)}</span></td><td data-label="操作">${button("查看往来","supplier-detail",s.id)}</td></tr>`);
  const totals=data.totals||{};
  $("main").innerHTML=heading("往来单位","待付、应退、预付、仅抵货款分别记账。",state.user.capabilities.purchase?button("新增往来单位","add-supplier","","primary"):"")
    +recordSummary("查看往来单位往来汇总",`<div class="grid">${[["待付",totals.payable],["应退",totals.cash],["预付",totals.advance],["仅抵货款",totals.credit]].map(([label,value])=>`<div class="stat"><span>${label}</span><strong class="money-value">${M(value)}</strong></div>`).join("")}</div>`)
    +`<div class="card mobile-record-list supplier-list">${table(["往来单位","待付","应退","预付","仅抵货款","操作"],rows)}</div>`;
}

function supplierEditor(id="") {
  const s=state.suppliers?.find((row)=>row.id===id)||{};
  modal(id?"编辑往来单位":"新增往来单位",[{name:"name",label:"主体名称",value:s.name,required:true},{name:"contact",label:"联系方式",value:s.contact},{name:"note",label:"备注",value:s.note,type:"textarea",wide:true}],(d,write)=>write("/api/suppliers",{...d,...(id?{id}:{})}));
}
async function renderSupplierDetail(id) {
  const current=officePageCurrent("supplier-detail");
  state.supplierId=id;
  const data=await officePageRead(current,()=>api(`/api/supplier-detail?id=${encodeURIComponent(id)}`));if(!current()||state.supplierId!==id)return;state.supplierDetail=data;
  const b=data.balances||{};
  const entries=(data.entries||[]).slice().reverse().slice(0,100).map((e)=>`<tr><td data-label="业务" class="record-title">${E(e.title)}</td><td data-label="类别">${E({payable:"待付",cash:"应退",advance:"预付",credit:"仅抵"}[e.kind]||e.kind)}</td><td data-label="未结金额"><span class="record-value money-value">${M(e.remaining)}</span></td><td data-label="编号"><span class="record-value record-code">${E(documentNo(e))}</span>${redPacketEntry("supplierEntries",e)}</td></tr>`);
  const logs=(data.settlements||[]).slice(0,80).map((l)=>`<tr><td data-label="类型" class="record-title">${E(label("settlement",l.type||l.logType))}</td><td data-label="金额"><span class="record-value money-value">${M(l.amount)}</span></td><td data-label="时间"><span class="record-value">${E(displayTime(l.createdAt))}</span></td><td data-label="操作">${redPacketEntry("supplierSettlements",l)}${l.type==="payment"||l.type==="offset"?button("撤销分配","reverse-offset",l.id,"danger"):""}</td></tr>`);
  const canSettle=state.user.capabilities.supplierSettle,canAdjust=state.user.roleCode==="owner"&&state.user.capabilities.supplierAdjust;
  $("main").innerHTML=heading(data.supplier.name,"往来单位往来明细",button("返回往来单位","back-suppliers"))+
    recordSummary("查看该往来单位余额",`<div class="grid">${[["待付",b.payable],["应退",b.cash],["预付",b.advance],["仅抵货款",b.credit]].map(([label,value])=>`<div class="stat"><span>${label}</span><strong class="money-value">${M(value)}</strong></div>`).join("")}</div>`)+
    `<div class="card"><h2>办理往来</h2><div class="actions">${canSettle?button("付款 / 预付","supplier-payment")+button("收到退款","supplier-refund")+button("抵扣货款","supplier-offset"):""}${state.user.capabilities.opening?button("登记期初","supplier-opening"):""}${canAdjust?button("往来调整","supplier-adjustment")+button("调价补差","supplier-price")+button("采购退货","supplier-return"):""}${button("对账单","supplier-statement")}</div></div>`+
    `<div class="card mobile-record-list"><h2>未结款项</h2>${table(["业务","类别","未结金额","编号"],entries)}</div><div class="card mobile-record-list"><h2>核销记录</h2>${table(["类型","金额","时间","操作"],logs)}</div>`+`<section class="card"><h2>已生成的往来单据</h2>${[["supplierCash",data.cash],["supplierAdjustments",data.adjustments],["purchaseReturns",data.returns]].map(([collection,rows])=>(rows||[]).slice(0,40).map(row=>`<article><strong>${E(documentNo(row))}</strong> · ${E(row.type||row.status||"往来记录")} ${redPacketEntry(collection,row)}</article>`).join("")).join("")}</section>`;
}
function supplierAction(kind) {
  const detail=state.supplierDetail;if(!detail)return;
  const entries=detail.entries||[];
  const sources=entries.filter((e)=>e.kind!=="payable"&&e.remaining>0);
  const targets=entries.filter((e)=>e.kind==="payable"&&e.remaining>0);
  const sid=state.supplierId;
  const sourceOptions=sources.map((e)=>({value:e.id,label:`${e.title} · ${M(e.remaining)}`}));
  const targetOptions=targets.map((e)=>({value:e.id,label:`${e.title} · ${M(e.remaining)}`}));
  const note={name:"note",label:"备注 / 核对依据",type:"textarea",wide:true};
  if(kind==="payment"){
    modal("登记付款或预付",[moneyField("amount","实际付款金额"),accountField,{name:"accountOwnerId",label:"实际付款人",options:[{value:"",label:"请选择付款人"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.finance).map((u)=>({value:u.id,label:u.name}))],required:true},{name:"reference",label:"付款流水号",required:true},{name:"targetId",label:"本次核销的待付款项",options:[{value:"",label:"不核销，留作预付"},...targetOptions]},{name:"planId",label:"关联订货",options:[{value:"",label:"不关联订货"},...(detail.plans||[]).filter((p)=>p.status==="open"&&p.paymentReview?.status==="approved"&&p.approvedRemaining>0).map((p)=>({value:p.id,label:documentNo(p)+" · 余可付 "+M(p.approvedRemaining)}))]},note],(d,write)=>write("/api/supplier-payments",{supplierId:sid,amount:Number(d.amount),payments:d.payments,planId:d.planId||undefined,allocations:d.targetId?[{targetId:d.targetId,amount:Number(d.amount)}]:[],note:d.note}),"只登记实际付款；各笔金额合计须等于本次金额。",{mode:"pay",requireReference:true});
  } else if(kind==="refund"){
    modal("登记往来单位退款",[{name:"sourceId",label:"退款来源",options:sourceOptions.filter((e)=>entries.find((x)=>x.id===e.value)?.kind!=="credit"),required:true},moneyField("amount","已到账金额"),accountField,{name:"accountOwnerId",label:"实际收款人",options:[{value:"",label:"请选择收款人"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.finance).map((u)=>({value:u.id,label:u.name}))],required:true},note],(d,write)=>write("/api/supplier-refunds",{supplierId:sid,...d,amount:Number(d.amount)}),"只登记已实际到账的退款。",{mode:"receive"});
  } else if(kind==="offset"){
    modal("抵扣应付款",[{name:"sourceId",label:"抵扣来源",options:sourceOptions,required:true},{name:"reference",label:"付款流水号",required:true},{name:"targetId",label:"待付款项",options:targetOptions,required:true},moneyField("amount","抵扣金额"),note],(d,write)=>write("/api/supplier-offsets",{supplierId:sid,...d,amount:Number(d.amount)}),"抵扣不产生现金收付。");
  } else if(kind==="opening"){
    modal("往来单位期初登记",[{name:"date",label:"期初日期",type:"date",value:new Date().toISOString().slice(0,10),required:true},...[["payable","待付"],["cash","应退"],["advance","预付"],["credit","仅抵货款"]].map(([name,label])=>moneyField(name,label,0)),{...note,required:true}],(d,write)=>write("/api/supplier-opening",{supplierId:sid,...d}));
  } else if(kind==="adjustment"){
    modal("有依据的往来调整",[{name:"type",label:"调整类型",options:[{value:"rebate",label:"非购货返利"},{value:"reimbursement",label:"费用报销"},{value:"charge",label:"追加应付"},{value:"correction",label:"更正"}]},{name:"kind",label:"往来方向",options:[{value:"cash",label:"对方应退款"},{value:"credit",label:"仅抵货款"},{value:"payable",label:"我方待付"},{value:"advance",label:"预付"}]},moneyField("amount","金额"),{name:"reference",label:"往来单位确认编号",required:true},{...note,required:true}],(d,write)=>write("/api/supplier-adjustments",{supplierId:sid,...d,nature:"non_purchase",amount:Number(d.amount)}));
  }
}
async function supplierCostAction(mode) {
  const sid=state.supplierId,current=officePageCurrent("supplier-detail");
  const candidates=await officePageRead(current,()=>api(`/api/supplier-candidates?id=${encodeURIComponent(sid)}`));
  if(!current()||state.supplierId!==sid)return;
  const options=candidates.map((p)=>({value:p.itemId,label:`${p.name} · ${documentRef(p,"purchaseId")} · 进价 ${M(p.costPrice)}`}));
  if(!options.length)return toast("没有可追溯的进货记录",true);
  const fields=[{name:"itemId",label:"原采购商品",options,required:true},{name:"scope",label:"范围",options:[{value:"inventory",label:"当前库存"},{value:"all",label:"全部可追溯商品"},{value:"selected",label:"仅选定串码"}]},
    {name:"direction",label:"调价方向",options:[{value:"decrease",label:"往来单位降价"},{value:"increase",label:"往来单位涨价"}]},
    {name:"kind",label:"返还方式",options:[{value:"cash",label:"往来单位应退款"},{value:"credit",label:"仅抵货款"}]},
    ...(mode==="price"?[moneyField("unitAmount","每件补差金额",0)]:[qtyField("quantity","数量",1),moneyField("unitPrice","退货单价",0)]),
    {name:"serialNos",label:"指定串号（串号商品必填）",type:"textarea",wide:true,hint:"每行一个；串码商品必须选择"},{name:"reference",label:"往来单位确认编号",required:true},{name:"note",label:"双方确认依据",type:"textarea",wide:true,required:true}];
  let confirmedSubmission=null;
  modal(mode==="price"?"调价补差":"申请采购退货",fields,async(d,write)=>{
    const candidate=candidates.find((p)=>p.itemId===d.itemId);
    const payload={supplierId:sid,purchaseId:candidate.purchaseId,itemId:candidate.itemId,scope:d.scope,direction:d.direction,kind:d.kind,unitAmount:Number(d.unitAmount),quantity:Number(d.quantity),unitPrice:Number(d.unitPrice),serialNos:d.serialNos.split(/[\s,，]+/).filter(Boolean),reference:d.reference,note:d.note};
    if(mode==="return"){const result=await write("/api/purchase-return-requests",{...payload,confirmed:true});return {...result,message:result.message||"采购退货申请已提交，等待老板批准；库存和往来账尚未变化。"};}
    const prefix="/api/supplier-prices";
    const signature=JSON.stringify(payload);
    if(confirmedSubmission?.uncertain&&confirmedSubmission.signature!==signature){const error=new Error("上次入账结果待核对，请恢复原内容重试；确认后再改资料。");error.uncertain=true;throw error;}
    if(!confirmedSubmission||confirmedSubmission.signature!==signature){
      let preview;
      try{preview=await api(prefix+"/preview",{method:"POST",body:JSON.stringify(payload)});}
      catch(error){error.uncertain=false;error.message="预览尚未完成，未提交入账："+error.message;throw error;}
      if(!confirm(`${mode==="price"?"调价补差":"采购退货"}预览：金额 ${M(preview.amount)}，库存成本影响 ${M(preview.inventoryDelta)}。确认入账？`))return false;
      confirmedSubmission={signature,body:{...payload,previewToken:preview.previewToken,confirmed:true},uncertain:false};
    }
    try{return await write(prefix,confirmedSubmission.body);}
    catch(error){if(error.uncertain)confirmedSubmission.uncertain=true;else confirmedSubmission=null;throw error;}
  },mode==="price"?"提交前会按原采购记录预览成本分配。":"先提交申请，老板本人批准后才扣库存并登记往来单位往来。");
}
async function renderFinance() {
  const current=officePageCurrent("finance");
  const data=await officePageRead(current,()=>api("/api/finance"));if(!current())return;
  const rows=(data.receipts||[]).filter(r=>documentMatches(r)).slice(0,150).map((r)=>`<tr><td>${E(r.transactionDate||displayTime(r.createdAt))}</td><td>${E(label("receipt",r.kind))}</td><td>${M(r.amount)}</td><td>${E(receiptAccountLabel(r))}</td><td>${E(documentNo(r))}<details><summary>完整流水编号</summary><code>${E(r.id)}</code></details>${redPacketEntry("receipts",r)}</td><td>${E(documentRef(r,"sourceId"))}${r.sourceId&&r.sourceId!==documentRef(r,"sourceId")?`<details><summary>完整来源编号</summary><code>${E(r.sourceId)}</code></details>`:""}</td></tr>`);
  $("main").innerHTML=heading("资金收支流水","实际资金进出与待付货款分别记录。",button("登记费用","add-expense","","primary"))+
    `${documentFilter("finance-filter")}<div class="grid"><div class="stat"><span>往来单位待付</span><strong>${M(data.payable)}</strong></div><div class="stat"><span>往来单位应退</span><strong>${M(data.supplierTotals?.cash)}</strong></div></div><div class="card">${table(["时间","业务","金额","账户","流水单号","来源"],rows)}</div>`;
  bindDocumentFilter("finance-filter",renderFinance);
  $("main").insertAdjacentHTML("beforeend",'<div class="actions"><a class="secondary" href="/app?tab=receipts">收款单</a><a class="secondary" href="/app?tab=payments">付款单</a><a class="secondary" href="/app?tab=red">单据红冲</a></div>');
}
function expenseEditor() { modal("登记门店费用",[{name:"type",label:"费用名称",required:true},moneyField("amount","金额"),accountField],(d,write)=>write("/api/expenses",{...d,amount:Number(d.amount)}),"只登记已实际付出的费用，不会自动扣款。",{mode:"pay"}); }
async function renderCards() {
  const current=officePageCurrent("cards");
  const data=await officePageRead(current,()=>api("/api/card-businesses"));if(!current())return;state.cards=data.rows;
  const rows=data.rows.map((c)=>`<tr><td>${E(c.cardNo||documentNo(c))}<small>${E(c.carrier)} · ${E(c.packageName)}</small></td><td>${M(c.expected)}</td><td>${M(c.confirmed)}</td><td>${M(c.received)}</td><td>${redPacketEntry("cardBusinesses",c)}${state.user.capabilities.finance?button("记录佣金","card-event",c.id):""}</td></tr>`);
  $("main").innerHTML=heading("号卡佣金","顾客售价与运营商佣金分别核算。",button("刷新","refresh"))+`<div class="card">${table(["号卡","预计","已确认","已到账","操作"],rows)}</div>`;
}
function cardEvent(id) { modal("登记运营商佣金",[{name:"type",label:"业务",options:[{value:"confirm",label:"确认佣金"},{value:"receive",label:"佣金到账"},{value:"adjust",label:"未到账调整"},{value:"clawback",label:"已到账扣回"}]},moneyField("amount","金额"),accountField,{name:"note",label:"备注",type:"textarea",wide:true}],(d,write)=>write("/api/card-events",{businessId:id,...d,amount:Number(d.amount)}),"确认和调整佣金不记现金；实际到账或扣回才选择收付款账户。",{mode:form=>form.elements.type.value==="clawback"?"pay":"receive",when:form=>["receive","clawback"].includes(form.elements.type.value)}); }
const payrollMonth=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit"}).format(new Date()).slice(0,7);
const payrollMoney=(value)=>value==null?"待核算":M(value);
const payrollRecordedMoney=value=>value==null||!Number.isFinite(Number(value))?"未记录":M(value);
const payrollKind={sale:"销售提成",return:"退货回冲",gift:"赠品调整",assist_transfer:"协助分配",manual:"人工增减"};
const payrollStatus={missing:"缺提成记录待核对",pending:"待核定",accrued:"已计提"};
const payrollCanManage=()=>state.user.roleCode==="owner";
function payrollFacts(items){return `<dl class="payroll-facts">${items.map(([name,value])=>`<div><dt>${E(name)}</dt><dd>${E(value)}</dd></div>`).join("")}</dl>`;}
function payrollRowCard(r,manage=false){
  const warnings=[r.baseSalary==null?"底薪未设置":"",r.pending?`${r.pending} 笔提成待核定`:"",r.missing?`${r.missing} 笔业务缺提成记录`:"",""].filter(Boolean);
  return `<article class="payroll-employee-card"><div class="payroll-card-head"><h2>${E(r.name)}</h2><span class="payroll-state">${E(label("payroll",r.status))}</span></div><div class="payroll-main-amount"><span>应发工资</span><strong>${E(payrollMoney(r.total))}</strong></div>${payrollFacts([["底薪",r.baseSalary==null?"未设置":M(r.baseSalary)],["业务提成",payrollMoney(r.commission)],["人工增减",M(r.manualAdjustment??0)]])}${warnings.length?`<p class="payroll-attention">${E(warnings.join("；"))}</p>`:""}<div class="payroll-card-actions">${manage?button("查看明细","payroll-detail",r.employeeId):""}${manage&&r.status==="draft"?button("工资增减","payroll-adjustment",r.employeeId):""}${manage&&state.payroll.canConfirm&&r.total!=null&&r.status==="draft"?button("确认工资","confirm-pay",r.employeeId,"primary"):""}${manage&&r.status==="confirmed"?button("记录发放","paid-pay",r.id,"primary"):""}</div>${r.confirmedAt||r.paidAt?`<details class="payroll-evidence"><summary>审核与发放记录</summary>${payrollFacts([["确认时间",displayTime(r.confirmedAt)],["发放时间",displayTime(r.paidAt)],["发放账户",r.account||"—"]])}</details>`:""}</article>`;
}
function payrollEntryCard(entry){
 const kind=payrollKind[entry.kind]||entry.reason||entry.kind||"业务提成";
 const rule=entry.mode==="piece"?`每件 ${M(entry.value)}`:entry.mode==="profit"?`按毛利 ${Number(entry.value||0)}%`:entry.mode==="none"?"不计提成":entry.mode==="unconfigured"?"规则待设置":"按核定记录";
 return `<article class="payroll-line${entry.amount==null?" payroll-line-warning":""}"><div class="payroll-card-head"><strong>${E(entry.productName||kind)}</strong><span class="payroll-line-amount${Number(entry.amount)<0?" payroll-negative":""}">${E(payrollMoney(entry.amount))}</span></div><p class="payroll-line-kind">${E(kind)}${entry.quantity!=null?" · 数量 "+E(entry.quantity):""}</p><p>${E(displayTime(entry.createdAt||entry.date))}</p>${entry.orderId?`<button type="button" class="payroll-source secondary" data-action="payroll-source" data-value="${E(entry.orderId)}">${E(documentRef(entry,"orderId"))} · 查看原单</button>`:""}<details class="payroll-evidence"><summary>核算依据</summary>${payrollFacts([["提成规则",rule],["记录状态",entry.amount==null?"待核定":"已计提"],["记录编号",documentNo(entry)],["原因",entry.reason||"—"],...(entry.returnId?[["退货单",documentRef(entry,"returnId")]]:[]),...(entry.giftId?[["赠品单",documentRef(entry,"giftId")]]:[]),...(entry.assistId?[["协助单",documentRef(entry,"assistId")]]:[])])}</details></article>`;
}
function payrollSection(title,id,rows,open=false){return `<details class="payroll-section" id="${id}"${open?" open":""}><summary>${E(title)}<span>${rows.length}</span></summary><div class="payroll-section-body">${rows.length?rows.join(""):'<p class="empty">暂无记录</p>'}</div></details>`;}
async function renderPayroll(){
  const current=officePageCurrent("payroll");
  const month=state.month||payrollMonth();state.month=month;
  const canManage=payrollCanManage();
  if(!canManage)state.payrollView="details";
  const overview=await officePageRead(current,()=>api(`/api/payroll?month=${encodeURIComponent(month)}`));if(!current()||state.month!==month)return;state.payroll=overview;
  const view=state.payrollView||"details",manage=view==="manage"&&canManage;
  const available=overview.rows||[];
  let selected=state.payrollEmployeeId;
  if(!overview.canViewAll)selected=state.user.id;
  else if(!available.some(r=>r.employeeId===selected))selected=manage?"":available[0]?.employeeId||state.user.id;
  state.payrollEmployeeId=selected;
  let detail=overview;
  if(selected&&overview.canViewAll)detail=await officePageRead(current,()=>api(`/api/payroll?month=${encodeURIComponent(month)}&employeeId=${encodeURIComponent(selected)}`));
  if(!current()||state.month!==month||state.payrollEmployeeId!==selected)return;
  state.payrollDetail=detail;
  const staffSelect=!manage&&overview.canViewAll?`<label for="payroll-employee">员工<select id="payroll-employee">${available.map(r=>option(r.employeeId,r.name,r.employeeId===selected)).join("")}</select></label>`:"";
  const switches=canManage?`<div class="payroll-view-switch" role="group" aria-label="工资页面"><button type="button" data-action="payroll-manage-view" class="${manage?"primary":"secondary"}">工资管理</button><button type="button" data-action="payroll-details-view" class="${manage?"secondary":"primary"}">工资明细查询</button></div>`:"";
  const help="工资明细来自已登记业务和核定记录。对明细有疑问可复制核对记录，请老板核实。底薪、待核定及缺提成记录要核清后才能确认。确认后的工资保存原快照，后续更正另记可调整月份。积分单独展示，不直接当作工资；人工奖励需核对是否已经发放，避免重复付款。";
  $("main").innerHTML=heading(manage?"工资管理":"工资明细查询",help,overview.canManage?button("底薪与提成规则","pay-settings"):"")+switches+`<section class="payroll-controls"><label for="payroll-month">月份<input id="payroll-month" name="month" type="month" value="${E(month)}" required></label>${staffSelect}${manage?`<label for="payroll-employee-filter">查员工<input id="payroll-employee-filter" type="search" placeholder="输入姓名筛选"></label>`:""}</section><p id="payroll-feedback" class="payroll-feedback" role="status" aria-live="polite" hidden></p>`;
  if(manage){
    $("main").insertAdjacentHTML("beforeend",`<section id="payroll-overview" class="payroll-overview">${available.length?available.map(r=>`<div data-payroll-employee="${E(r.name)}">${payrollRowCard(r,true)}</div>`).join(""):'<p class="empty">暂无员工工资记录</p>'}</section>`);
  }else{
    const r=(detail.rows||[]).find(x=>x.employeeId===selected)||detail.rows?.[0];
    const checks=detail.businessChecks||[],missing=checks.filter(x=>x.status==="missing");
    const canResolve=detail.canManage&&r?.status==="draft";
    const checkCards=checks.map(x=>`<article class="payroll-line${x.status!=="accrued"?" payroll-line-warning":""}"><div class="payroll-card-head"><strong>${E(x.productName||"销售商品")}</strong><span class="payroll-state">${E(payrollStatus[x.status]||x.status)}</span></div><p>数量 ${E(x.quantity)} · 提成 ${E(payrollMoney(x.amount))}</p><p>${E(displayTime(x.createdAt||x.date))}</p><button type="button" class="secondary payroll-source" data-action="payroll-source" data-value="${E(x.orderId)}">${E(documentRef(x,"orderId"))} · 查看原单</button>${canResolve&&x.status==="pending"&&x.entryIds?.length?button("补核提成","payroll-resolve-check",JSON.stringify({entryId:x.entryIds[0],orderId:x.orderId,itemId:x.itemId})):""}</article>`);
    const changes=(detail.adjustments||[]).map(x=>`<article class="payroll-line"><div class="payroll-card-head"><strong>${x.direction==="deduct"?"工资扣减":"工资增加"}</strong><span class="payroll-line-amount${x.direction==="deduct"?" payroll-negative":""}">${x.direction==="deduct"?"−":"＋"}${M(x.amount)}</span></div><p>${E(x.reason)}</p>${x.sourceOrderId?`<button type="button" class="secondary payroll-source" data-action="payroll-source" data-value="${E(x.sourceOrderId)}">${E(x.sourceOrderDisplayNo||x.orderNo||documentRef(x,"sourceOrderId"))} · 查看原单</button>`:""}<p>${E(x.operatorName||"审核人")} · ${E(displayTime(x.createdAt))}</p>${x.originalStatementId?`<p>更正原工资单 ${E(documentRef(x,"originalStatementId"))}</p>`:""}</article>`);
    const pointLinks={reception:["接待记录","/receptions"],learning:["学习记录","/learning"],"work-journal":["工作日志","/work-journal"]};
    const points=(detail.points||[]).map(x=>{const link=pointLinks[x.sourceType];return `<article class="payroll-line"><div class="payroll-card-head"><strong>${E(x.kind||x.type||x.title||"积分")}</strong><span>${E(x.amount??x.points??0)} 分</span></div><p>${E(x.reason||x.event||x.summary||"")}</p><p>${E(displayTime(x.at||x.createdAt))}</p><details class="payroll-evidence"><summary>核定依据</summary>${x.sourceId?`<p>来源单号 ${E(documentRef(x,"sourceId"))}</p>`:""}${link?`<a class="secondary payroll-source" href="${link[1]}">查看${link[0]}</a>`:""}</details></article>`;});
    $("main").insertAdjacentHTML("beforeend",`<section id="payroll-detail">${r?payrollRowCard(r):'<p class="empty">本月未设置工资记录</p>'}<div class="payroll-card-actions">${button("复制核对记录","payroll-copy","","primary")}${canManage&&r?.status==="draft"?button("工资增减","payroll-adjustment",selected):""}</div>${missing.length?`<p class="payroll-attention">发现 ${missing.length} 笔销售商品缺提成记录，请核对。</p>`:""}${payrollSection("逐笔工资明细","payroll-entries",(detail.entries||[]).map(payrollEntryCard),true)}${payrollSection("每笔销售核对","payroll-business-checks",checkCards,missing.length>0)}${payrollSection("工资增减记录","payroll-adjustments",changes)}${payrollSection("积分明细（单独核对）","payroll-points",points)}</section>`);
  }
  $("payroll-month").addEventListener("change",event=>{state.month=event.target.value;render().catch(showError);});
  $("payroll-employee")?.addEventListener("change",event=>{state.payrollEmployeeId=event.target.value;render().catch(showError);});
  $("payroll-employee-filter")?.addEventListener("input",event=>{const q=event.target.value.trim();$("payroll-overview").querySelectorAll("[data-payroll-employee]").forEach(el=>el.hidden=!el.dataset.payrollEmployee.includes(q));});
  if(state.payrollNotice){payrollFeedback(state.payrollNotice.text,state.payrollNotice.error);state.payrollNotice=null;}
}
function payrollFeedback(text,error=false){const target=$("payroll-feedback");if(!target)return toast(text,error);target.hidden=false;target.textContent=text;target.dataset.kind=error?"error":"success";target.setAttribute("role",error?"alert":"status");target.scrollIntoView({behavior:"smooth",block:"center"});}
function payrollModal(title,fields,submit,description="",paymentOptions=null){
 modal(title,fields,async(data,write)=>{const result=await submit(data,write);state.payrollNotice={text:result?.message||"已保存，记录可在本月明细中核对。",error:false};return result;},description,paymentOptions);

}
function payrollSourceOptions(checks,selected=""){
 const orders=new Map();for(const row of checks||[]){if(!row.orderId)continue;const item=orders.get(row.orderId)||{label:documentRef(row,"orderId"),products:[]};if(row.productName&&!item.products.includes(row.productName))item.products.push(row.productName);orders.set(row.orderId,item);}
 return [{value:"",label:"不关联业务单"},...Array.from(orders,([value,item])=>({value,label:item.label+(item.products.length?" · "+item.products.join("、"):"")})),...(selected&&!orders.has(selected)?[{value:selected,label:shortInternalNo(selected)}]:[])];
}
async function payrollAdjustment(employeeId){
 if(!payrollCanManage())throw new Error("当前账号没有工资增减权限");
 const month=state.month,current=officePageCurrent("payroll");
 const detail=await officePageRead(current,()=>api(`/api/payroll?month=${encodeURIComponent(month)}&employeeId=${encodeURIComponent(employeeId)}`));
 if(!current()||state.month!==month)return;
 const row=detail.rows?.find(r=>r.employeeId===employeeId);
 if(!row||row.status!=="draft")throw new Error("已确认工资不能直接增减，请另记更正月份。");
 payrollModal(`工资增减 · ${row.name}`,[{name:"direction",label:"增减方式",options:[{value:"add",label:"增加工资 / 奖励"},{value:"deduct",label:"扣减工资"}],required:true},moneyField("amount","金额（元）",""),{name:"reason",label:"增减原因",type:"textarea",required:true,wide:true},{name:"sourceOrderId",label:"关联业务单（可选）",options:payrollSourceOptions([...(detail.businessChecks||[]),...(detail.entries||[])])},{name:"originalStatementId",label:"更正原工资单号（可留空）"}],(d,write)=>write("/api/payroll/adjustments",{employeeId,month,...d,amount:Number(d.amount)}));
 const form=$("modal-form");form.elements.amount.min="0.01";
 const advanced=document.createElement("details");advanced.className="payroll-evidence field wide";advanced.innerHTML='<summary>历史更正（可选）</summary>';const originalField=form.elements.originalStatementId.closest(".field");originalField.before(advanced);advanced.append(originalField);
}
function payrollResolveCheck(value){
 const source=JSON.parse(value),row=state.payrollDetail?.businessChecks?.find(x=>x.orderId===source.orderId&&x.itemId===source.itemId);
 if(!row||row.status!=="pending"||!source.entryId)throw new Error("这笔提成没有可补核记录，请先核对原业务。");
 payrollModal("补核提成 · "+row.productName,[{name:"mode",label:"提成方式",required:true,options:[{value:"piece",label:"按件固定金额"},{value:"profit",label:"按毛利百分比"},{value:"none",label:"不计提成"}]},moneyField("value","金额或百分比",0)],(d,write)=>write("/api/payroll/resolve",{entryId:source.entryId,...d,value:Number(d.value)}));
}
async function payrollCopy(){
 const detail=state.payrollDetail,row=detail?.rows?.[0];if(!detail)throw new Error("请先打开工资明细。");
 const lines=["工资核对记录",`员工：${row?.name||state.user.name}`,`月份：${state.month}`,`底薪：${row?.baseSalary==null?"未设置":M(row.baseSalary)}`,`业务提成：${payrollMoney(row?.commission)}`,`人工增减：${M(row?.manualAdjustment??0)}`,`应发：${payrollMoney(row?.total)}`,"", "逐笔提成："];
 for(const entry of detail.entries||[])lines.push(`${displayTime(entry.createdAt||entry.date)} · ${documentRef(entry,"orderId")||"未关联原单"} · ${entry.productName||payrollKind[entry.kind]||entry.kind} · 数量 ${entry.quantity??"—"} · ${payrollMoney(entry.amount)}`);
 for(const check of (detail.businessChecks||[]).filter(x=>x.status!=="accrued"))lines.push(`需核对：${documentRef(check,"orderId")} · ${check.productName} · ${payrollStatus[check.status]||check.status}`);
 for(const change of detail.adjustments||[])lines.push(`人工${change.direction==="deduct"?"扣减":"增加"} ${M(change.amount)} · ${change.reason} · ${change.operatorName||"审核人"}`);
 const text=lines.join("\n");
 try{if(!navigator.clipboard?.writeText)throw new Error("请手动复制");await navigator.clipboard.writeText(text);payrollFeedback("核对记录已复制，可发给老板核对。");}
 catch{payrollReadonlyDialog("工资核对记录",`<label for="payroll-copy-record">核对内容</label><textarea id="payroll-copy-record" readonly>${E(text)}</textarea>`);$("payroll-copy-record").select();}
}
let payrollSourceVersion=0;
async function payrollSource(id){
 const current=officePageCurrent("payroll"),version=++payrollSourceVersion;
 const rows=await officePageRead(current,()=>api("/api/sale-orders?q="+encodeURIComponent(id)));
 if(!current()||version!==payrollSourceVersion)return;
 const order=rows.find(x=>x.id===id);
 if(!order){payrollReadonlyDialog("原单核对",`<p class="payroll-attention">当前账号没有可查看的原销售单。请用上方工资明细编号向老板核对。</p>`);return;}
 const items=(order.items||[]).map(x=>`<article class="payroll-line"><strong>${E(x.name)}</strong>${payrollFacts([["数量",x.quantity],["串号",x.serialNo||"—"],["单价",payrollRecordedMoney(x.salePrice)],["金额",payrollRecordedMoney(x.amount??(x.quantity!=null&&x.salePrice!=null?Number(x.quantity)*Number(x.salePrice):null))]])}</article>`).join("");
 payrollReadonlyDialog("原销售单",`<p class="payroll-document-no">${E(documentNo(order))}</p><details class="payroll-evidence"><summary>完整单号</summary><p>${E(order.id)}</p></details>${payrollFacts([["开单时间",displayTime(order.createdAt)],["状态",label("order",order.status)],["销售金额",payrollRecordedMoney(order.amount)]])}${items}`);
}
function payrollReadonlyDialog(title,html){
 $("payroll-source-dialog")?.remove();const restore=document.activeElement,dialog=document.createElement("dialog");dialog.id="payroll-source-dialog";dialog.className="payroll-dialog";dialog.setAttribute("aria-label",title);dialog.innerHTML=`<div class="payroll-dialog-head"><h2>${E(title)}</h2><button type="button" class="secondary" data-payroll-dialog-close>× 关闭</button></div><div class="payroll-dialog-body">${html}</div>`;document.body.append(dialog);dialog.querySelector("[data-payroll-dialog-close]").onclick=()=>dialog.close();dialog.addEventListener("close",()=>{dialog.remove();restore?.focus({preventScroll:true});});dialog.showModal();
}
async function renderPaySettings() {
  const current=officePageCurrent("pay-settings");
  const data=await officePageRead(current,()=>api(`/api/payroll/settings?month=${encodeURIComponent(state.month||payrollMonth())}`));if(!current())return;state.paySettings=data;
  const salaryRows=data.staff.map(u=>`<article class="payroll-line"><strong>${E(u.name)}</strong><p>底薪 ${u.salary?M(u.salary.amount):"未设置"}</p>${button("设置底薪","salary-setting",u.id)}</article>`);
  const ruleRows=data.products.map(p=>`<article class="payroll-line"><strong>${E(p.name)}</strong><p>${p.rule?E(label("rule",p.rule.mode))+" · "+E(p.rule.value):"未设置提成规则"}</p>${button("设置提成","rule-setting",p.skuId)}</article>`);
  const pending=(data.pending||[]).map(p=>`<article class="payroll-line payroll-line-warning"><strong>${E(p.employeeName)}</strong><p>${E(p.productName)}</p><p>单号 ${E(documentRef(p,"orderId"))}</p>${button("补录提成","resolve-pay",p.id)}</article>`);
  $("main").innerHTML=heading("底薪与提成规则","变更按生效月记录，不覆盖历史已确认工资。",button("返回工资","back-payroll"))+payrollSection("员工底薪","payroll-salary-settings",salaryRows,true)+payrollSection("商品提成规则","payroll-rule-settings",ruleRows)+payrollSection("待补录提成","payroll-pending-settings",pending,pending.length>0);
}
function paySetting(kind,id) {
  if(kind==="salary"){
    const u=state.paySettings.staff.find((r)=>r.id===id);
    modal(`设置底薪 · ${u.name}`,[moneyField("amount","每月金额",u.salary?.amount??0),{name:"effectiveMonth",label:"生效月份",type:"month",value:state.month,required:true}],(d,write)=>write("/api/payroll/salaries",{employeeId:id,amount:Number(d.amount),effectiveMonth:d.effectiveMonth}));
  }else{
    const row=kind==="rule"?state.paySettings.products.find((r)=>r.skuId===id):state.paySettings.pending.find((r)=>r.id===id);
    modal(kind==="rule"?`设置提成 · ${row.name}`:`补录提成 · ${row.productName}`,[{name:"mode",label:"方式",options:[{value:"piece",label:"按件固定金额"},{value:"profit",label:"按毛利百分比"},{value:"none",label:"不提成"}],value:row.rule?.mode},moneyField("value","金额或百分比",row.rule?.value??0)],(d,write)=>write(kind==="rule"?"/api/payroll/rules":"/api/payroll/resolve",{skuId:row.skuId,entryId:row.id,mode:d.mode,value:Number(d.value)}));
  }
}
async function renderReports() {
  const current=officePageCurrent("reports");
  const date=state.date||new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});state.date=date;
  const data=await officePageRead(current,()=>api(`/api/daily-report?date=${encodeURIComponent(date)}`));if(!current()||state.date!==date)return;
  const s=data.summary||{};
  const metrics=[["订单数",s.orderCount,"count"],["销售额",s.salesAmount],["退货额",s.returnAmount],["净销售额",s.netSales],["销售收款",s.receivedAmount],["退款支出",s.refundAmount]];
  if(data.canViewProfit)metrics.push(["调整后毛利",s.adjustedGrossProfit]);
  if(state.user.capabilities.finance)metrics.push(["门店费用",s.expenseAmount],["运营商佣金到账",s.carrierReceived]);
  if(s.supplierPaid!=null)metrics.push(["往来单位付款",s.supplierPaid]);
  const card=(title,headers,rows)=>`<section class="card"><h2>${E(title)}</h2>${rows.length?table(headers,rows):'<p class="empty">当日暂无记录</p>'}</section>`;
  const categories=(data.categoryStats||[]).map((r)=>`<tr><td>${E(r.category)}</td><td>${E(r.quantity)}</td><td>${M(r.salesAmount)}</td>${data.canViewProfit?`<td>${M(r.grossProfit)}</td>`:""}</tr>`);
  const payments=(data.paymentStats||[]).map((r)=>`<tr><td>${E(r.paymentMethod)}</td><td>${M(r.amount)}</td></tr>`);
  const staff=(data.staffStats||[]).map((r)=>`<tr><td>${E(r.name)}</td><td>${E(r.orderCount)}</td><td>${M(r.salesAmount)}</td></tr>`);
  const orders=(data.recentOrders||[]).map((r)=>`<tr><td>${E(documentNo(r))}<small>${E(displayTime(r.createdAt))}</small></td><td>${E((r.items||[]).map((i)=>`${i.name} × ${i.quantity}`).join("、"))}</td><td>${M(r.amount)}</td><td>${E(label("order",r.status))}</td></tr>`);
  const expenses=(data.expenses||[]).map((r)=>`<tr><td>${E(r.type)}</td><td>${M(r.amount)}</td><td>${E(r.account||"—")}</td></tr>`);
  $("main").innerHTML=heading("经营日报","选择日期查看经营汇总和业务明细。")+
    `<div class="card"><div class="fields">${formField({name:"date",label:"日期",type:"date",value:date})}</div><div class="grid">${metrics.map(([title,value,kind])=>`<div class="stat"><span>${E(title)}</span><strong>${kind==="count"?E(value||0):M(value)}</strong></div>`).join("")}</div></div>`+
    `<div class="dashboard-panels">${card("品类销售",["分类","净售数量","净销售额",...(data.canViewProfit?["毛利"]:[])],categories)}${card("收款方式",["方式","净收款"],payments)}${card("员工销售",["员工","订单数","净销售额"],staff)}</div>`+
    card("销售单",["单号","商品","金额","状态"],orders)+
    (state.user.capabilities.finance?card("门店费用",["费用","金额","账户"],expenses):"");
  $("main").querySelector('input[name="date"]').addEventListener("change",(e)=>{state.date=e.target.value;render().catch(showError);});
}
async function renderOpening() {
  const current=officePageCurrent("opening");
  const status=await officePageRead(current,()=>api("/api/opening-balance/status"));if(!current())return;state.openingStatus=status;
  $("main").innerHTML=heading("期初导入","仅在正式开始办理业务前建立期初账。")+
    `<div class="grid dashboard-stock"><div class="stat"><span>建账状态</span><strong>${status.hasOpeningBalance?"已完成":"未导入"}</strong></div><div class="stat"><span>当前商品</span><strong>${E(status.productCount)}</strong></div><div class="stat"><span>库存记录</span><strong>${E(status.stockCount)}</strong></div><div class="stat"><span>库存价值</span><strong>${M(status.stockValue)}</strong></div></div>`+
    `<div class="card"><h2>导入 Excel 期初数据</h2><p class="notice">${status.locked?"当前账套已有业务记录，不能重新导入期初数据。":"导入会替换当前商品和库存。请先下载模板，填写并核对预览结果。"}</p>${status.completedAt?`<p class="muted">上次建账：${E(displayTime(status.completedAt))}</p>`:""}<p><a href="/api/opening-balance/template" target="_blank" rel="noopener">下载期初模板</a></p>${status.locked?"":`<input id="opening-file" type="file" accept=".xlsx,.xls"><div class="form-actions">${button("预览导入","preview-opening")}</div><div id="opening-preview"></div>`}</div>`;
}
let openingPreviewVersion=0;
async function previewOpening() {
  const input=$("opening-file"),file=input?.files[0];if(!file)return toast("请选择 Excel 文件",true);
  const pageCurrent=officePageCurrent("opening"),version=++openingPreviewVersion;
  const current=()=>pageCurrent()&&version===openingPreviewVersion&&$("opening-file")===input&&input.files[0]===file;
  const data=new FormData();data.append("file",file);
  const result=await officePageRead(current,async()=>{
    const response=await fetch("/api/opening-balance/preview-excel",{method:"POST",credentials:"same-origin",headers:state.token?{Authorization:`Bearer ${state.token}`}:{},body:data});
    const body=await response.json();if(!response.ok)throw new Error(body.error?.message||"预览失败");return body;
  });
  if(!current())return;
  state.openingPreview=result;
  $("opening-preview").innerHTML=`<p>将导入 ${E(result.productCount)} 个商品，库存价值 ${M(result.stockValue)}。当前商品 ${E(result.replacedProducts)} 个。</p>${button("确认期初建账","commit-opening","","danger")}`;
}
async function renderLogs() {
  const current=officePageCurrent("logs");
  const data=await officePageRead(current,()=>api("/api/operation-logs"));if(!current())return;window.OperationLogUI.render(data);
}
function renderStaff() {
  const rows=state.users.map((u)=>'<article class="staff-card"><dl class="staff-facts"><div class="staff-name-row"><dt>姓名：</dt><dd><span class="staff-name">'+E(u.name)+'</span></dd></div><div><dt>角色：</dt><dd>'+E(u.role)+'</dd></div><div><dt>状态：</dt><dd>'+(u.status==="active"?"使用中":"已停用")+'</dd></div></dl><div class="actions staff-actions">'+(u.roleCode==="owner"?"老板账号":u.status!=="active"?button("权限设置","staff-permissions",u.id)+button("启用","staff-status",u.id):'<a class="staff-account-link" href="/login?employee='+encodeURIComponent(u.id)+'#admin-panel">账号密码</a>'+button("权限设置","staff-permissions",u.id)+button("停用","staff-status",u.id,"danger"))+'</div></article>').join('');
  $("main").innerHTML=heading("员工账号","先新增员工，再到账号管理页为员工分配登录账号。",button("新增员工","add-staff","","primary"))+
    '<p class="notice"><a href="/login#admin-panel">打开员工账号管理，设置或重置密码</a></p><div class="staff-list">'+rows+'</div>';
}
function staffEditor() {
  modal("新增员工",[
    {name:"name",label:"员工姓名",required:true},
    {name:"roleCode",label:"岗位角色",required:true,options:[{value:"employee",label:"营业员"},{value:"warehouse",label:"仓管 · 采购与盘点"},{value:"manager",label:"店长 · 门店管理"}]},
  ],(data,write)=>write("/api/users",data),"创建后请到员工账号管理页设置登录账号与密码。");
}
function showInviteLink(user,url) {
  $("modal-root")?.remove();
  const root=document.createElement("div");root.id="modal-root";root.className="modal";
  root.innerHTML=`<div class="modal-content"><h2>${E(user.name)}的飞书绑定链接</h2><p class="muted">请发给员工本人，30 分钟内使用一次。员工还需位于飞书应用的可用范围内。</p><label for="invite-link">专属链接</label><input id="invite-link" type="text" readonly value="${E(url)}"><div class="form-actions">${button("复制链接","copy-invite","","primary")}${button("关闭","close-modal")}</div></div>`;
  document.body.append(root);
  root.addEventListener("click",(event)=>{if(event.target===root)root.remove();});
}

async function render() {
  const version=++officeViewVersion,tab=state.tab;
  if(["duties","used-phones"].includes(state.tab)){location.assign("/"+state.tab);return;}
  if(state.tab==="stocktake"){location.assign("/stocktake");return;}
  if(state.tab==="sales-list"){location.assign("/sales-list");return;}
  renderNav();
  if(tab==="sales"){await ensureGiftRules();await ensureSalePaymentSplits();}
  if(version!==officeViewVersion||state.tab!==tab)return;
  const views={dashboard:renderDashboard,inventory:renderInventory,products:renderProducts,sales:renderSales,orders:renderOrders,returns:renderOrders,receipts:()=>window.TradeDocuments.renderFinancial("receive"),payments:()=>window.TradeDocuments.renderFinancial("pay"),red:renderRedReversals,purchase:renderPurchase,suppliers:renderSuppliers,
    "supplier-detail":()=>renderSupplierDetail(state.supplierId),finance:renderFinance,cards:renderCards,payroll:renderPayroll,"pay-settings":renderPaySettings,reports:renderReports,staff:renderStaff,opening:renderOpening,logs:renderLogs,backup:()=>window.SystemAdmin.renderBackup()};
  try { await (views[tab]||renderDashboard)(); }
  catch(error) { if(version===officeViewVersion&&state.tab===tab)throw error;return; }
  if(version!==officeViewVersion||state.tab!==tab)return;
  document.body.classList.toggle("record-view",Boolean(document.querySelector(".mobile-record-list")));
}
function showError(error) { if(state.tab==="payroll"&&$("payroll-feedback"))payrollFeedback(error.message||String(error),true);else toast(error.message||String(error),true); }
async function go(tab) { if(state.saleSubmitting){toast("销售单正在提交，请等待结果后再切换页面。",true);return;} if(["duties","used-phones"].includes(tab)){location.assign("/"+tab);return;} if(tab==="stocktake"){location.assign("/stocktake");return;}if(tab==="sales-list"){location.assign("/sales-list");return;}state.tab=tab; await render(); }

async function handleAction(action,value) {
  if(state.saleSubmitting){toast("销售单正在提交，请等待结果后再操作。",true);return;}
  switch(action) {
    case "close-modal": {const root=$("modal-root");if(root?.dataset.submitting==="1"||root?.dataset.uncertain==="1"){toast("本单正在提交或结果待核对，请按原内容重试核对后再关闭。",true);return;}root?.remove();return;}
    case "repair-materials":if(state.user?.capabilities?.sell||state.user?.capabilities?.purchase||state.user?.capabilities?.stocktake||state.user?.capabilities?.manageProducts)location.assign("/repair-materials");return;
    case "system-readiness":if(state.user?.roleCode==="owner")location.assign("/system-readiness");return;
    case "payment-accounts":if(state.user?.roleCode==="owner"||state.user?.capabilities.createPaymentAccounts)location.assign("/payment-accounts");return;
    case "orders-more": await renderOrders(true);return;
    case "refresh": await loadBasics();await render();return;
    case "stocktake":stocktake(value);return;
    case "edit-product":productEditor(value);return;
    case "mobile-product":mobileProductEditor(value);return;
    case "product-transfer":productWarehouseTransfer(value);return;
    case "transfer-c":inventoryTransferC(value);return;
    case "add-sale-item":saleItemEditor(-1,value);return;
    case "edit-cart":saleItemEditor(Number(value));return;
    case "remove-cart":state.salesCart.splice(Number(value),1);renderSales();return;
    case "view-orders":await go("orders");return;
    case "gift-add":window.Gifts.addGift();return;
    case "gift-remove":state.giftCart.splice(Number(value),1);renderSales();return;
    case "gift-supplement":window.Gifts.addGift(value);return;
    case "gift-settings":window.Gifts.settings();return;
    case "gift-approve-toggle":{
      const target=state.users.find((row)=>row.id===value);
      if(!target)return;
      const enabled=!target.capabilities.giftApprove;
      modal((enabled?"授权":"取消授权")+"赠品审核 · "+target.name,[],(d,write)=>write('/api/users/gift-approval',{userId:value,enabled}),"确认后修改这名员工的赠品审核权限。");return;
    }
    case "exchange-sale":window.TradeDocuments.exchange(value);return;
    case "financial-new":window.TradeDocuments.newFinancial(value);return;
    case "financial-detail":window.TradeDocuments.detail(value);return;
    case "return-sale":returnSale(value);return;
    case "sale-return-approve":window.TradeDocuments.reviewReturnRequest(value,"approve");return;
    case "sale-return-reject":window.TradeDocuments.reviewReturnRequest(value,"reject");return;
    case "purchase-price-correction":purchasePriceCorrection(value);return;
    case "purchase-direct":purchaseEditor("receive");return;
    case "purchase-plan":purchaseEditor("plan");return;
    case "receive-plan":purchaseEditor("receive",value);return;
    case "review-plan-payment":{
      const plan=state.plans?.find((p)=>p.id===value);if(!plan)return;
      modal("审核订货付款 · "+documentNo(plan),[
        {name:"decision",label:"付款决定",options:[{value:"approve",label:"批准付款"},{value:"defer",label:"暂缓付款"}],required:true},
        moneyField("approvedAmount","累计批准付款上限（元）",plan.paymentReview?.approvedAmount||plan.plannedAmount),
        {name:"reason",label:"审核说明（暂缓必填）",type:"textarea",wide:true}
      ],(d,write)=>write("/api/procurement-plans/payment-review",{id:plan.id,decision:d.decision,approvedAmount:Number(d.approvedAmount),reason:d.reason}),
      "批准额度是本单累计付款上限；审核不会自动转账，也不会增加库存。");
      return;
    }
    case "pay-plan":{
      const plan=state.plans?.find((p)=>p.id===value);if(!plan)return;
      modal("登记订货实际付款 · "+documentNo(plan),[
        moneyField("amount","本次实际付款（元）",plan.approvedRemaining),
        accountField,
        {name:"accountOwnerId",label:"实际付款人",options:[{value:"",label:"请选择付款人"},...state.users.filter((u)=>u.status==="active"&&u.capabilities.finance).map((u)=>({value:u.id,label:u.name}))],required:true},
        {name:"reference",label:"银行或支付平台流水号",required:true},
        {name:"note",label:"备注"}
      ],(d,write)=>write("/api/supplier-payments",{supplierId:plan.supplierId,planId:plan.id,amount:Number(d.amount),payments:d.payments,note:d.note}),
      "仅登记已经实际付出的款；本次与累计金额均受老板批准额度限制。",{mode:"pay",requireReference:true});
      return;
    }
    case "assign-plan":{
      const plan=state.plans?.find((p)=>p.id===value);if(!plan)return;
      const staff=state.users.filter((u)=>u.status==="active"&&u.capabilities.purchase);
      modal("指派验货 · "+documentNo(plan),[{name:"receiverId",label:"验货责任人",options:staff.map((u)=>({value:u.id,label:u.name+" · "+u.role})),value:plan.receiverId||plan.operatorId,required:true}],(d,write)=>write("/api/procurement-plans/assign",{id:plan.id,receiverId:d.receiverId}));
      return;
    }
    case "close-plan":{
      modal("终止订货余货",[{name:"reason",label:"终止余货原因",type:"textarea",wide:true,required:true}],(d,write)=>write("/api/procurement-plans/close",{id:value,reason:d.reason}));return;
    }
    case "add-supplier":supplierEditor();return;
    case "supplier-detail":state.supplierId=value;await go("supplier-detail");return;
    case "back-suppliers":await go("suppliers");return;
    case "supplier-payment":supplierAction("payment");return;
    case "supplier-refund":supplierAction("refund");return;
    case "supplier-offset":supplierAction("offset");return;
    case "supplier-opening":supplierAction("opening");return;
    case "supplier-adjustment":supplierAction("adjustment");return;
    case "supplier-price":await supplierCostAction("price");return;
    case "supplier-return":await supplierCostAction("return");return;
    case "purchase-return-request":window.TradeDocuments.purchaseReturn(value);return;
    case "purchase-return-approve":window.TradeDocuments.reviewPurchaseReturnRequest(value,"approve");return;
    case "purchase-return-reject":window.TradeDocuments.reviewPurchaseReturnRequest(value,"reject");return;
    case "catalog-confirm":window.TradeDocuments.reviewCatalog(value,"confirm");return;
    case "catalog-needs-changes":window.TradeDocuments.reviewCatalog(value,"needs_changes");return;
    case "catalog-edit":window.TradeDocuments.editCatalog(value);return;
    case "supplier-statement":window.open(`/api/supplier-statement/export?id=${encodeURIComponent(state.supplierId)}`,"_blank","noopener");return;
    case "reverse-offset":{
      modal("撤销往来分配",[{name:"reason",label:"撤销分配原因",type:"textarea",wide:true,required:true}],(d,write)=>write("/api/supplier-offsets/reverse",{id:value,reason:d.reason}));return;
    }
    case "price-request":priceRequestEditor(value);return;
    case "price-approve":priceReviewEditor(value,"approve");return;
    case "price-reject":priceReviewEditor(value,"reject");return;
    case "add-expense":expenseEditor();return;
    case "red-request":requestExpenseRed(value);return;
    case "red-approve":reviewExpenseRed(value,"approve");return;
    case "red-reject":reviewExpenseRed(value,"reject");return;
    case "card-event":cardEvent(value);return;
    case "payroll-manage-view":state.payrollView="manage";state.payrollEmployeeId="";await go("payroll");return;
    case "payroll-details-view":state.payrollView="details";await go("payroll");return;
    case "payroll-detail":state.payrollView="details";state.payrollEmployeeId=value;await go("payroll");return;
    case "payroll-adjustment":await payrollAdjustment(value);return;
    case "payroll-copy":await payrollCopy();return;
    case "payroll-resolve-check":payrollResolveCheck(value);return;
    case "payroll-source":await payrollSource(value);return;
    case "pay-settings":await go("pay-settings");return;
    case "back-payroll":await go("payroll");return;
    case "salary-setting":paySetting("salary",value);return;
    case "rule-setting":paySetting("rule",value);return;
    case "resolve-pay":paySetting("resolve",value);return;
    case "confirm-pay":{
      const month=state.month;
      payrollModal("确认本月工资",[],(d,write)=>write("/api/payroll/confirm",{employeeId:value,month}),"确认这名员工 "+month+" 的工资？确认后不能改历史工资快照。");return;
    }
    case "paid-pay":{
      const row=state.payroll.rows.find(r=>r.id===value);if(!row)throw new Error("工资单不存在，请刷新后重试。");
      payrollModal("记录工资发放 · "+row.name,[{name:"account",label:"实际发放账户",options:accounts,value:"银行卡",required:true}],(d,write)=>write("/api/payroll/pay",{statementId:value,payments:d.payments}),"请确认已实际发放 "+M(row.total)+"。",{mode:"pay",defaultAccount:"银行卡",totalCents:modalPaymentCents(row.total)});return;
    }
    case "preview-opening":await previewOpening();return;
    case "add-staff":staffEditor();return;
    case "staff-permissions":await window.SystemAdmin.permissions(value);return;
    case "staff-status":{
      const employee=state.users.find((u)=>u.id===value);if(!employee)return;
      const next=employee.status==="active"?"disabled":"active";
      modal((next==="disabled"?"停用":"启用")+"员工账号 · "+employee.name,[],(d,write)=>write("/api/users/status",{userId:value,status:next}),`确认${next==="disabled"?"停用":"启用"} ${employee.name} 的账号？`);return;
    }
    case "invite-staff":{
      const invitation=await api("/api/users/invite",{method:"POST",body:JSON.stringify({userId:value})});
      showInviteLink(invitation.user,invitation.url);return;
    }
    case "copy-invite":{
      const input=$("invite-link");if(!input)return;
      try{await navigator.clipboard.writeText(input.value);toast("链接已复制");}
      catch{input.select();document.execCommand("copy");toast("链接已选中，可手动复制");}
      return;
    }
    case "commit-opening":{
      const p=state.openingPreview;if(!p)return;
      modal("确认期初建账",[],(d,write)=>write("/api/opening-balance/import",{rows:p.sourceRows,source:p.source,confirmed:true}),`将替换当前 ${p.replacedProducts} 个商品。仅确认当前账套确实需要重新建账时继续。`);return;
    }
  }
}
document.addEventListener("click",(event)=>{
  const target=event.target.closest("[data-action],[data-tab]");if(!target)return;
  if(target.dataset.tab){go(target.dataset.tab).catch(showError);return;}
  handleAction(target.dataset.action,target.dataset.value).catch(showError);
});
$("logout").addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST"}).catch(()=>{});state.token="";sessionStorage.removeItem("officeLocalToken");location.href="/login";});

async function start() {
  try {
    state.user=await api("/api/me");if(requiredCaps[state.tab]&&!state.user.capabilities[requiredCaps[state.tab]])state.tab="dashboard";$("who").textContent=`${state.user.name} · ${state.user.role}`;$("logout").hidden=false;
    await loadBasics();await render();
    if(state.tab==="products"&&new URLSearchParams(location.search).get("new")==="1"){
      let draft=null;try{draft=JSON.parse(sessionStorage.getItem("assistant-product-draft-v1")||"null");sessionStorage.removeItem("assistant-product-draft-v1");}catch{}
      const validAge=draft&&Number.isFinite(draft.createdAt)&&Date.now()-draft.createdAt>=0&&Date.now()-draft.createdAt<600000;
      const organization=draft?await api("/api/organization").catch(()=>null):null;
      const validBranch=organization&&(organization.enabled===true?typeof organization.currentBranchId==="string"&&Boolean(organization.currentBranchId)&&Boolean(draft?.branchId)&&draft.branchId===organization.currentBranchId:organization.enabled===false&&!draft?.branchId);
      if(state.user.capabilities.manageProducts&&validAge&&draft.ownerId===state.user.id&&validBranch)productEditor("",{name:draft.prefill?.name,warehouseId:draft.prefill?.warehouseId});
      const url=new URL(location.href);url.searchParams.delete("new");history.replaceState(null,"",url);
    }
  } catch(error) {
    const mode=await api("/api/auth/mode").catch(()=>({}));
    if(mode.localExperience){
      $("main").innerHTML=heading("本机体验登录","使用虚构测试账套。")+`<div class="card"><form id="local-login"><div class="fields">${formField({name:"userId",label:"测试角色",options:mode.users.map((u)=>({value:u.id,label:`${u.name} · ${u.role}`}))})}</div><button class="primary">进入工作台</button></form></div>`;
      $("local-login").addEventListener("submit",async(e)=>{e.preventDefault();try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({userId:new FormData(e.target).get("userId")})});state.token=result.token;sessionStorage.setItem("officeLocalToken",result.token);state.user=result.user;$("who").textContent=`${state.user.name} · ${state.user.role}`;$("logout").hidden=false;await loadBasics();await render();}catch(err){showError(err);}});
    }else{
      $("main").innerHTML=heading("员工登录","请使用老板分配的账号密码。")+'<div class="card"><a href="/login?next=/app">打开员工登录页</a></div>';
    }
  }
}
start().catch(showError);












