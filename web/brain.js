const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
async function run() {
  $("status").textContent = "正在核对…";
  try {
    const r = await fetch("/api/system-check", { credentials: "same-origin" });
    if (r.status === 401) { $("status").innerHTML = '<a href="/login?next=/brain">请先用员工账号登录</a>'; $("findings").textContent = "登录后显示检查结果"; return; }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "检查失败");
    $("status").textContent = "检查完成：" + new Date(data.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const labels = { products: "商品档案", inventoryUnits: "库存件数", serials: "串码条数", sales: "销售单据", suppliers: "供货商", testProducts: "测试商品" };
    $("stats").innerHTML = Object.entries(data.stats).map(([k,v]) => `<div><span>${labels[k]}</span><b>${esc(v)}</b></div>`).join("");
    $("findings").innerHTML = data.findings.length ? data.findings.map((f) => `<article><div class="title">${esc(f.severity)}风险 · ${esc(f.summary)}</div><p>${esc(f.id)}</p></article>`).join("") : '<div class="ok">当前规则检查未发现异常</div>';
  } catch (e) { $("status").textContent = e.message; $("findings").textContent = "请稍后重试"; }
}
$("run").addEventListener("click", run); run();