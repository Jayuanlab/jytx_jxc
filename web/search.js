const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(collection,row){if(!row?.id)return '';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return '<span class="red-packet-slot" data-rp-collection="'+esc(collection)+'" data-rp-source="'+esc(row.id)+'" hidden><button type="button" class="red-packet-request" data-rp-open>申请红包</button><small data-rp-state></small></span>'; }
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const money = (value) => "¥" + Number(value || 0).toFixed(2);
const shortInternalNo = (value) => String(value || "").replace(/^([A-Z]{2,5})-([0-9a-f]{8})-[0-9a-f-]{20,}$/i, "$1-$2");
const label = { receptions: "接待单", inventory: "库存", sales: "销售单", purchases: "采购单", suppliers: "供货商", movements: "库存流水", receipts: "收支流水" };
const invoiceLine = (row) => (row.invoiceNos || []).length ? `<p class="invoice-number">发票号码：${row.invoiceNos.map(esc).join("、")}</p>` : "";
const time = (value) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";
function card(kind, row) {
  if (kind === "receptions") return `<article><div class="title">${esc(row.purpose)} · ${esc(row.customerMask)} <small>${esc(row.status)}</small></div><p>${esc(time(row.date))} · ${esc(row.ownerName)} · ${esc(row.customerName || "")}</p><p>需求：${esc(row.needs || "待补")}</p>${window.ReceptionIntakeUI?.summary(row) || ""}<a class="reception-link" href="/receptions?highlight=${encodeURIComponent(row.id)}">查看／补充原接待单</a>${redPacketEntry("receptions",row)}</article>`;
  if (kind === "inventory") return `<article><div class="title">${esc(row.name)} <small>${esc(row.code)}</small></div><p>${esc(row.category)} · ${esc(row.warehouse)} · 库存 <b>${esc(row.quantity)}</b></p>${row.serials?.length ? `<details><summary>查看串码（${row.serials.length}）</summary><div class="serials">${row.serials.map((s) => `<span>${esc(s.no)} <em>${esc(s.status)}</em></span>`).join("")}</div></details>` : ""}</article>`;
  if (kind === "sales") return `<article><div class="title">${esc(documentNo(row))} <small>${esc(({completed:"已完成",returned:"已退货","partially-returned":"部分退货"})[row.status] || row.status)}</small></div><p>${esc(time(row.date))} · ${esc(row.salesperson)} · ${esc(row.paymentMethod)} · ${money(row.amount)}</p>${invoiceLine(row)}<div class="lines">${(row.items || []).map((i) => `<div>${esc(i.name)} × ${esc(i.quantity)} ${i.serialNo ? `<code>${esc(i.serialNo)}</code>` : ""}${i.returnedQuantity ? ` · 已退 ${esc(i.returnedQuantity)}` : ""}</div>`).join("")}</div><div class="lines"><strong>赠品：${(row.gifts || []).length ? (row.gifts || []).length + " 张赠品单" : "无"}</strong>${(row.gifts || []).map((gift) => `<div>${esc(gift.kind)} · ${esc(documentNo(gift))} · ${(gift.items || []).map((item) => esc(item.name) + " × " + esc(item.quantity)).join("、")}</div>`).join("")}</div>${redPacketEntry("sales",row)}</article>`;
  if (kind === "purchases") return `<article><div class="title">${esc(documentNo(row))}</div><p>${esc(time(row.date))} · ${esc(row.supplier)} ${row.amount == null ? "" : "· " + money(row.amount)}</p>${invoiceLine(row)}<div class="lines">${(row.items || []).map((i) => `<div>${esc(i.name)} × ${esc(i.quantity)} ${i.serials?.length ? `<code>${esc(i.serials.join("、"))}</code>` : ""}</div>`).join("")}</div>${redPacketEntry("purchases",row)}</article>`;
  if (kind === "suppliers") return `<article><div class="title">${esc(row.name)}</div><p>${esc(row.contact)}</p></article>`;
  if (kind === "movements") return `<article><div class="title">${esc(row.type)} · ${esc(row.product)}</div><p>${esc(time(row.date))} · ${esc(row.warehouse)} · 数量 ${esc(row.quantity)} · 来源 ${esc(documentRef(row,"sourceId"))}</p></article>`;
  return `<article><div class="title">${esc(documentNo(row))}</div><p>来源 ${esc(documentRef(row,"sourceId") || documentNo(row))} · ${esc(time(row.date))} · ${esc(row.account)} · ${money(row.amount)}</p>${redPacketEntry("receipts",row)}</article>`;
}
async function api(url, signal) {
  let r; try { r = await fetch(url, { credentials: "same-origin", cache: "no-store", signal }); }
  catch (error) { if (error.name === "AbortError") throw error; throw new Error("网络连接失败，请检查网络后重试"); }
  if (r.status === 401) throw new Error("LOGIN");
  let data; try { data = await r.json(); } catch { throw new Error("服务器未返回查询数据，请稍后重试"); }
  if (!r.ok) throw new Error(data.error?.message || "查询失败（" + r.status + "）"); return data;
}
function serialTraceCard(row) {
  const events = [];
  if (row.purchase) events.push(time(row.purchase.date) + " · 采购入库 " + documentNo(row.purchase) + " · " + (row.purchase.supplier || ""));
  for (const sale of row.sales || []) { events.push(time(sale.date) + " · 销售 " + documentNo(sale)); for (const item of sale.returns || []) events.push(time(item.date) + " · 退货 " + documentNo(item)); }
  events.sort();
  return "<article><div class=\"title\">" + esc(row.product) + " · 串号 " + esc(row.serialNo) + "</div><p>当前状态：" + esc(row.status) + " · " + esc(row.warehouse) + "</p><div class=\"lines\">" + (events.length ? events.map((event) => "<div>" + esc(event) + "</div>").join("") : "<div>暂未找到当前权限可见的流转单据</div>") + "</div></article>";
}
function traceCard(row) {
  const events = [];
  if (row.purchase) events.push(time(row.purchase.date) + " · 采购单 " + documentNo(row.purchase));
  if (row.sale) events.push(time(row.sale.date) + " · 销售单 " + documentNo(row.sale));
  for (const gift of row.gifts || []) events.push(time(gift.date) + " · " + gift.kind + " " + documentNo(gift) + " · " + gift.items.map((item) => item.name + " × " + item.quantity).join("、"));
  for (const move of row.movements || []) events.push(time(move.date) + " · 库存流水 " + documentNo(move) + " · " + move.type + " · " + move.product + " × " + move.quantity);
  for (const receipt of row.receipts || []) events.push(time(receipt.date) + " · 资金流水 " + documentNo(receipt) + " · " + receipt.kind + " · " + money(receipt.amount));
  for (const item of row.returns || []) events.push(time(item.date) + " · 销售退货 " + documentNo(item) + " · " + money(item.amount));
  for (const claim of row.subsidy || []) { events.push(time(claim.date) + " · 国补单 " + documentNo(claim) + " · 平台号 " + (claim.platformOrderNo || "未登记") + (claim.invoiceNo ? " · 发票号码 " + claim.invoiceNo : "") + " · " + claim.status); for (const event of claim.events) events.push(time(event.date) + " · 国补流水 " + documentNo(event) + " · " + event.reference + " · " + money(event.amount)); }
  for (const service of row.carrier || []) { events.push(time(service.date) + " · 移动业务 " + documentNo(service) + " · 系统号 " + service.externalOrderNo); for (const part of service.schedule) { if (part.statementNo) events.push(part.month.replace("-", "/") + "/01 00:00 · 移动结算 " + part.month + " · 单号 " + part.statementNo); for (const event of part.events) events.push(time(event.date) + " · 移动到账流水 " + documentNo(event) + " · " + event.bankRef + " · " + money(event.amount)); } }
  events.sort();
  return "<article><div class=\"title\">业务来源 " + esc(documentRef(row,"sourceId")) + "</div><div class=\"lines\">" + events.map((event) => "<div>" + esc(event) + "</div>").join("") + "</div></article>";
}
const queryForm = $("query");
let requestNumber = 0, activeRequest;
function clearResults() { for (const id of ["smart", "serial-trace", "trace", "results"]) $(id).replaceChildren(); }
function statusMessage(message, kind = "") { $("status").textContent = message; $("status").className = kind; }
const shanghaiToday = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function updateDateRange(){const from=queryForm.elements.from.value,to=queryForm.elements.to.value,today=shanghaiToday();$("date-range-label").textContent=from||to?(from===today&&to===today?"今日":(from||"最早")+" 至 "+(to||"现在")):"不限日期";$("search-today").setAttribute("aria-pressed",String(from===today&&to===today));$("search-all-dates").setAttribute("aria-pressed",String(!from&&!to));}
$("search-today").addEventListener("click",()=>{const day=shanghaiToday();queryForm.elements.from.value=day;queryForm.elements.to.value=day;if(["inventory","suppliers","serials"].includes(queryForm.elements.scope.value))queryForm.elements.scope.value="all";updateMode();runQuery();});
$("search-all-dates").addEventListener("click",()=>{queryForm.elements.from.value="";queryForm.elements.to.value="";updateMode();runQuery();});
for(const key of ["from","to"])queryForm.elements[key].addEventListener("change",updateDateRange);
function updateMode() {
  const scope = queryForm.elements.scope.value; updateDateRange();
  const serial = scope === "serials", invoice = scope === "invoices";
  queryForm.elements.q.placeholder = serial ? "输入完整串号或后4位" : invoice ? "输入发票号码、销售或采购单号" : "输入商品名称、别名、串号或单号";
  $("search-query-help").content.querySelector("#query-hint").textContent = serial ? "后4位相同的商品会分别列出，请核对完整串号。" : invoice ? "按账套中已登记的发票号码或单据号码查询。" : "不填关键词也可浏览记录；按日期查接待、销售和流水，当前库存请选择不限日期。";
  $("search-submit").textContent = serial ? "追踪串号" : invoice ? "查询号码" : "查询";
  document.querySelectorAll("[data-search-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.searchMode === scope)));
}
function group(title, content, open = false, hint = "") {
  return `<details class="panel result-group"${open ? " open" : ""}><summary>${esc(title)}</summary>${hint ? `<p class="hint">${esc(hint)}</p>` : ""}${content}</details>`;
}
async function runQuery() {
  updateDateRange();const id = ++requestNumber; activeRequest?.abort();
  const controller = new AbortController(); activeRequest = controller;
  const params = new URLSearchParams(new FormData(queryForm)), scope = params.get("scope"), q = (params.get("q") || "").trim();
  params.set("q", q); clearResults();
  if (["serials", "invoices"].includes(scope) && !q) {
    statusMessage(scope === "serials" ? "请输入完整串号或串号后4位" : "请输入发票号码或单号"); $("search-submit").disabled = false; queryForm.elements.q.focus(); return;
  }
  if (scope === "all" && !q) params.set("browse", "1");
  statusMessage("查询中…"); $("search-submit").disabled = true;
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const data = await api("/api/search?" + params, controller.signal);
    if (id !== requestNumber) return;
    const groups = Object.entries(data.results || {}).filter(([, rows]) => rows.length);
    const count = groups.reduce((total, [, rows]) => total + rows.length, 0), serials = data.serialTraces || [], trace = data.trace || [];
    const documents = Array.isArray(data.documents) ? data.documents : [];
    const found = count > 0 || serials.length > 0 || trace.length > 0 || documents.length > 0;
    statusMessage(!found ? "没有匹配记录，请检查号码或清除筛选。" : scope === "serials" ? `找到 ${serials.length} 件串号记录` : `找到 ${count+documents.length} 条记录${trace.length ? `，可查看 ${trace.length} 组关联单据` : ""}`, found ? "success" : "");
    if (serials.length) $("serial-trace").innerHTML = group(`串号追踪（${serials.length}）`, serials.map(serialTraceCard).join(""), true, "相同尾号请核对完整串号。");
    if (trace.length) $("trace").innerHTML = group(`关联单据与流水（${trace.length}）`, trace.map(traceCard).join(""), scope === "invoices" || (!groups.length && !serials.length));
    $("results").innerHTML = groups.map(([kind, rows], index) => group(`${label[kind] || kind}（${rows.length}）`, rows.map(row => card(kind, row)).join(""), index === 0 && !serials.length)).join("") || (!found ? '<section class="panel empty">没有找到记录。可换个商品名称、完整号码，或清除筛选后查看。</section>' : "");
    $("search-query-help").content.querySelector("#query-result-hint").textContent = data.intent?.hint || "按当前账号权限查询已录入记录。";
    if (documents.length) $("results").insertAdjacentHTML("afterbegin", group("单据号码（" + documents.length + "）", documents.map(row => `<article><div class="title">${esc(documentNo(row))}</div><p>${esc(time(row.createdAt))}</p>${redPacketEntry(row.collection,row)}${typeof row.href === "string" && row.href.startsWith("/") && !row.href.startsWith("//") ? `<a href="${esc(row.href)}">查看原单 ↗</a>` : ""}</article>`).join(""), true));
    if (found) $("smart").innerHTML = '<p class="hint query-limit">每类最多100条；串号与关联单据最多30组。</p>';
  } catch (error) {
    if (id !== requestNumber) return;
    if (error.message === "LOGIN") { statusMessage("", "error"); $("status").innerHTML = '<a href="/login?next=/search">登录已失效，点这里重新登录后查询</a>'; }
    else statusMessage(error.name === "AbortError" ? "查询超时，请重试或缩小查询范围" : error.message, "error");
  } finally { clearTimeout(timeout); if (id === requestNumber) $("search-submit").disabled = false; }
}
queryForm.addEventListener("submit", event => { event.preventDefault(); runQuery(); });
queryForm.elements.scope.addEventListener("change", () => { updateMode(); runQuery(); });
for (const button of document.querySelectorAll("[data-search-mode]")) button.addEventListener("click", () => {
  queryForm.reset(); queryForm.elements.scope.value = button.dataset.searchMode; updateMode(); runQuery();
});
$("search-reset").addEventListener("click", () => { queryForm.reset(); updateMode(); runQuery(); });
(async () => {
  const params = new URLSearchParams(location.search);
  if (Array.from(queryForm.elements.scope.options).some(option => option.value === params.get("scope"))) queryForm.elements.scope.value = params.get("scope");
  queryForm.elements.q.value = params.get("q") || ""; updateMode();
  const metadata = api("/api/search?scope=meta").then(meta => {
    for (const name of meta.warehouses || []) $("warehouse").insertAdjacentHTML("beforeend", `<option value="${esc(name)}">${esc(name)}</option>`);
    for (const supplier of meta.suppliers || []) $("supplier").insertAdjacentHTML("beforeend", `<option value="${esc(supplier.name)}">${esc(supplier.name)}</option>`);
  }).catch(() => { /* The record query reports login and network failures visibly. */ });
  await runQuery(); await metadata;
})();
