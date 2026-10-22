const el = (id) => document.getElementById(id);
const state = { token: sessionStorage.getItem("demoToken") || "", user: null, inventory: [], orders: [] };
const money = (value) => `¥${Number(value || 0).toFixed(2)}`;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "请求失败，请稍后再试");
  return body;
}

function setMessage(id, message, error = false) {
  const target = el(id);
  target.textContent = message;
  target.className = error ? "feedback error" : "feedback success";
}

function showLogin() {
  state.token = "";
  state.user = null;
  sessionStorage.removeItem("demoToken");
  el("login-panel").hidden = false;
  el("app-panel").hidden = true;
  el("logout").hidden = true;
  el("signed-in").textContent = "";
}

function showApp() {
  el("login-panel").hidden = true;
  el("app-panel").hidden = false;
  el("logout").hidden = false;
  el("signed-in").textContent = `${state.user.name} · ${state.user.role}`;
  const allowed = Boolean(state.user.capabilities?.sell);
  for (const control of el("sale-form").elements) control.disabled = !allowed;
  if (!allowed) setMessage("sale-message", "当前测试角色没有开单权限，请切换老板或店员。", true);
  else setMessage("sale-message", "");
}

function cell(row, content, className) {
  const item = document.createElement("td");
  if (className) item.className = className;
  item.textContent = content;
  row.append(item);
  return item;
}

function renderInventory() {
  const query = el("search").value.trim().toLowerCase();
  const rows = state.inventory.filter((item) =>
    [item.name, item.externalCode, item.type, item.subType].some((part) => String(part || "").toLowerCase().includes(query)),
  );
  const body = el("inventory-body");
  body.replaceChildren();
  for (const item of rows) {
    const row = document.createElement("tr");
    const nameCell = cell(row, "");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const code = document.createElement("small");
    code.textContent = item.externalCode || item.skuId;
    nameCell.append(name, code);
    cell(row, [item.type, item.subType, item.thirdType].filter(Boolean).join(" / "));
    cell(row, item.warehouseName || "服务项目");
    cell(row, item.stockManaged === false ? "—" : item.quantity, `right ${item.quantity > 0 ? "in-stock" : "out-stock"}`);
    cell(row, money(item.salePrice), "right");
    body.append(row);
  }
  el("inventory-empty").hidden = rows.length > 0;
  const stock = state.inventory.filter((item) => item.stockManaged !== false);
  el("stat-products").textContent = stock.filter((item) => item.quantity > 0).length;
  el("stat-quantity").textContent = stock.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function renderOrders() {
  el("stat-orders").textContent = state.orders.length;
  const list = el("orders-list");
  list.replaceChildren();
  for (const order of state.orders.slice(0, 10)) {
    const row = document.createElement("div");
    row.className = "order-row";
    const description = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = (order.items || []).map((item) => `${item.name} × ${item.quantity}`).join("、") || order.id;
    const detail = document.createElement("small");
    detail.textContent = `${new Date(order.createdAt).toLocaleString("zh-CN")} · ${order.id}`;
    description.append(title, detail);
    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = money(order.amount);
    row.append(description, amount);
    list.append(row);
  }
  if (!state.orders.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "还没有销售单，可以先试开一单。";
    list.append(empty);
  }
}

function selectedProduct() {
  return state.inventory.find((item) => item.skuId === el("product").value);
}

function updateSaleForm() {
  const item = selectedProduct();
  if (!item) return;
  el("price").value = item.salePrice;
  el("quantity").value = 1;
  const serials = (item.serials || []).filter((entry) => entry.status === "可售" || !entry.status);
  el("serial-wrap").hidden = !item.trackSerial;
  const serial = el("serial");
  serial.replaceChildren();
  for (const entry of serials) serial.add(new Option(entry.no, entry.no));
  el("quantity").max = item.trackSerial ? 1 : item.stockManaged === false ? "" : item.quantity;
  updateTotal();
}

function updateTotal() {
  el("total").textContent = money(Number(el("quantity").value) * Number(el("price").value));
}

function renderProductOptions() {
  const select = el("product");
  const selected = select.value;
  select.replaceChildren();
  for (const item of state.inventory.filter((row) => row.stockManaged === false || row.quantity > 0))
    select.add(new Option(`${item.name}${item.stockManaged === false ? " · 服务" : ` · 余 ${item.quantity}`}`, item.skuId));
  if (state.inventory.some((item) => item.skuId === selected)) select.value = selected;
  updateSaleForm();
}

async function refresh() {
  const [inventory, orders] = await Promise.all([api("/api/inventory"), api("/api/sale-orders")]);
  state.inventory = inventory;
  state.orders = orders;
  renderInventory();
  renderOrders();
  renderProductOptions();
}

async function login(userId) {
  const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ userId }) });
  state.token = result.token;
  state.user = result.user;
  sessionStorage.setItem("demoToken", result.token);
  showApp();
  await refresh();
}

async function start() {
  try {
    const mode = await api("/api/auth/mode");
    if (!mode.localExperience) throw new Error("本机体验账号当前不可用");
    for (const user of mode.users) el("user-select").add(new Option(`${user.name} · ${user.role}`, user.id));
    showLogin();
  } catch (error) { el("login-error").textContent = error.message; }
}

el("login").addEventListener("click", async () => {
  el("login-error").textContent = "";
  try { await login(el("user-select").value); }
  catch (error) { showLogin(); el("login-error").textContent = error.message; }
});
el("logout").addEventListener("click", showLogin);
el("refresh").addEventListener("click", () => refresh().catch((error) => setMessage("sale-message", error.message, true)));
el("search").addEventListener("input", renderInventory);
el("product").addEventListener("change", updateSaleForm);
el("quantity").addEventListener("input", updateTotal);
el("price").addEventListener("input", updateTotal);
el("sale-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const product = selectedProduct();
  const quantity = Number(el("quantity").value);
  const salePrice = Number(el("price").value);
  if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isFinite(salePrice) || salePrice < 0) {
    setMessage("sale-message", "请核对商品、数量和售价。", true);
    return;
  }
  if (product.trackSerial && (quantity !== 1 || !el("serial").value)) {
    setMessage("sale-message", "串码商品每次选一台并指定串码。", true);
    return;
  }
  const button = el("submit-sale");
  button.disabled = true;
  setMessage("sale-message", "正在开单，请稍候…");
  try {
    const order = await api("/api/sale-orders", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        account: el("account").value,
        items: [{ skuId: product.skuId, quantity, salePrice, ...(product.trackSerial ? { serialNo: el("serial").value } : {}) }],
      }),
    });
    setMessage("sale-message", `开单成功：${order.id}`);
    await refresh();
  } catch (error) { setMessage("sale-message", error.message, true); }
  finally { button.disabled = false; }
});
start();
