const c = require("./common");

function list(store, user) {
  c.permit(user, "manageProducts");
  return (store.productPriceChanges || []).slice().reverse();
}
function request(store, user, payload) {
  c.permit(user, "manageProducts");
  const product = store.products.find((row) => row.skuId === payload.skuId);
  if (!product) throw new c.HttpError(404, "商品不存在");
  const newPrice = c.money(payload.newPrice, "新零售价");
  if (newPrice === product.salePrice && product.pricePending !== true) throw new c.HttpError(400, "新零售价与当前价格相同");
  const reason = c.text(payload.reason, "调价原因");
  if (reason.length < 4 || reason.length > 500) throw new c.HttpError(400, "调价原因至少 4 字");
  if ((store.productPriceChanges || []).some((row) => row.skuId === product.skuId && row.status === "待老板审核"))
    throw new c.HttpError(409, "该商品已有待审核调价单");
  const row = { id: c.id("PRC"), skuId: product.skuId, productCode: product.externalCode,
    productName: product.name, oldPrice: product.salePrice, newPrice, reason,
    status: "待老板审核", requesterId: user.id, requester: user.name, createdAt: c.now() };
  store.productPriceChanges ||= [];
  store.productPriceChanges.push(row);
  c.audit(store, user, "product:price-request", row.id + " · " + product.name + " · " + row.oldPrice + " → " + row.newPrice + " · " + reason);
  require("./feishu-notices").notice(store, "product-price-request:" + row.id, "商品调价待审核",
    { id: row.id, summary: product.name + " · " + row.oldPrice + " → " + newPrice + " 元；" + reason });
  return row;
}
function review(store, user, payload) {
  c.permit(user, "manageUsers");
  const row = (store.productPriceChanges || []).find((item) => item.id === payload.id);
  if (!row) throw new c.HttpError(404, "调价单不存在");
  if (row.status !== "待老板审核") throw new c.HttpError(409, "调价单已经处理");
  const decision = c.text(payload.decision, "审核结果");
  if (!["approve", "reject"].includes(decision)) throw new c.HttpError(400, "审核结果不正确");
  const note = String(payload.note || "").trim();
  if (note.length > 500) throw new c.HttpError(400, "审核备注过长");
  const product = store.products.find((item) => item.skuId === row.skuId);
  if (!product) throw new c.HttpError(409, "商品已不存在，不能调价");
  if (decision === "approve") {
    if (product.salePrice !== row.oldPrice) throw new c.HttpError(409, "商品价格已变化，请重新提交调价单");
    product.salePrice = row.newPrice;
    product.pricePending = false;
    row.status = "已生效";
    row.effectiveAt = c.now();
  } else {
    row.status = "已驳回";
  }
  row.reviewedAt = c.now();
  row.reviewerId = user.id;
  row.reviewNote = note;
  c.audit(store, user, "product:price-review", row.id + " · " + row.status + " · " + product.name + " · " + row.oldPrice + " → " + row.newPrice + " · " + note);
  require("./feishu-notices").notice(store, "product-price-review:" + row.id, "商品调价" + row.status,
    { id: row.id, summary: product.name + " · " + row.oldPrice + " → " + row.newPrice + " 元；" + note });
  return row;
}
module.exports = { list, request, review };
