async function renderPricePanel() {
  const current=officePageCurrent("products");
  const changes=await officePageRead(current,()=>api("/api/product-price-changes"));
  if(!current())return;
  const focusedPriceId=new URLSearchParams(location.search).get("focusPrice");
  const visibleChanges=focusedPriceId?changes.filter(row=>row.id===focusedPriceId):changes.slice(0,100);
  const rows = visibleChanges.map((row) =>
    "<tr><td>" + E(row.productName) + "<small>" + E(row.productCode) + " · " + E(row.id) + "</small></td>" +
    "<td>" + M(row.oldPrice) + " → " + M(row.newPrice) + "</td><td>" + E(row.reason) + "</td><td>" + E(row.status) + "</td><td>" +
    (state.user.roleCode === "owner" && row.status === "待老板审核" ? button("批准生效", "price-approve", row.id) + button("驳回", "price-reject", row.id) : "") +
    redPacketEntry("productPriceChanges",row)+"</td></tr>");
  $("main").insertAdjacentHTML("beforeend", '<section class="card"><h2>商品调价单</h2><p class="muted">改价由老板审核后立即生效，旧销售单保持原成交价。本单实际售价仍可在开单时修改。</p>' +
    (focusedPriceId?'<p class="muted">已定位待办原单 · <a href="/app?tab=products">查看全部调价单</a></p>':'') +
    (rows.length ? table(["商品", "原价 → 新价", "原因", "状态", "操作"], rows) : '<p class="empty">'+(focusedPriceId?'未找到这张调价单':'暂无调价单')+'</p>') + "</section>");
}
function priceRequestEditor(skuId) {
  const product = state.products.find((row) => row.skuId === skuId);
  if (!product) return;
  modal("申请调价 · " + product.name,
    [{ name: "newPrice", label: "新零售价（元）", type: "number", min: 0, step: "0.01", value: product.salePrice, required: true },
     { name: "reason", label: "调价原因", type: "textarea", wide: true, required: true, hint: "至少 4 字。原价 " + M(product.salePrice) + "；批准后立即更新商品档案。" }],
    (data, write) => write("/api/product-price-changes", { skuId, newPrice: Number(data.newPrice), reason: data.reason }));
}
function priceReviewEditor(id, decision) {
  modal(decision === "approve" ? "批准商品调价" : "驳回商品调价",
    [{ name: "note", label: "备注（可选）", type: "textarea", wide: true }],
    (data, write) => write("/api/product-price-changes/review", { id, decision, note: data.note }),
    decision === "approve" ? "批准后新零售价立即用于后续开单；历史订单不改变。" : "驳回后价格不变。");
}


