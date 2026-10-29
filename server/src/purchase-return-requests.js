const c = require("./common");
const supplierCosts = require("./supplier-costs");

function owner(user) {
  return user.roleCode === "owner" && c.capabilities(user).manageUsers;
}

function requireOwner(store, user) {
  return require("./sale-return-requests").assertOwner(store, user);
}

function list(store, user) {
  c.permit(user, "purchase");
  return (store.purchaseReturnRequests || [])
    .filter((row) => owner(user) || row.requesterId === user.id)
    .slice()
    .reverse();
}

function draftPayload(payload) {
  if(payload.sourceType==='opening')return require("./opening-purchase-returns").normalize(payload);
  if (payload.confirmed !== true)
    throw new c.HttpError(400, "请确认实物退货和供应商认可的退货款后提交老板审核");
  return {
    supplierId: c.text(payload.supplierId, "供应商"),
    purchaseId: c.text(payload.purchaseId, "原采购单"),
    itemId: c.text(payload.itemId, "原采购明细"),
    quantity: c.quantity(payload.quantity),
    unitPrice: c.money(payload.unitPrice, "供应商认可退款单价"),
    kind: payload.kind,
    reference: c.text(payload.reference, "供应商退货确认编号"),
    note: c.text(payload.note, "退货及退款约定"),
    serialNos: Array.isArray(payload.serialNos) ? [...payload.serialNos] : [],
    confirmed: true,
  };
}

function request(store, user, payload) {
  c.permit(user, "purchase");
  const draft = draftPayload(payload);
  if ((store.purchaseReturnRequests || []).some((row) =>
    row.status === "待老板审核" && (
      (row.supplierId === draft.supplierId && row.reference === draft.reference) ||
      (draft.sourceType==='opening'?row.sourceType==='opening'&&row.openingKey===draft.openingKey:row.sourceType!=='opening'&&row.purchaseId===draft.purchaseId&&row.itemId===draft.itemId)
    )
  ))
    throw new c.HttpError(409, "该供应商确认编号或原采购明细已有待老板审核的退货申请");

  // The complete inventory/serial/cost validation happens on a clone; applying
  // for a return never changes business stock, payables or cash.
  const preview = supplierCosts.previewReturn(store, user, draft);
  const source = (store.purchases || []).find((row) => row.id === draft.purchaseId);
  const supplier = (store.suppliers || []).find((row) => row.id === draft.supplierId);
  const row = {
    id: c.id("PRQ"),
    kind: "purchase_return",
    ...(preview.sourceType==='opening'?{sourceType:'opening',openingKey:preview.openingKey,openingBatchId:preview.openingBatchId,openingSourceId:preview.openingSourceId,warehouseId:preview.warehouseId,warehouseName:preview.warehouseName}:{}),
    supplierId: preview.supplierId,
    supplier: supplier?.name || source?.supplier || "",
    purchaseId: preview.purchaseId,
    itemId: preview.itemId,
    skuId: preview.skuId,
    name: preview.name,
    quantity: preview.quantity,
    unitPrice: preview.unitPrice,
    amount: preview.amount,
    cost: preview.cost,
    serialNos: [...preview.serialNos],
    reference: preview.reference,
    note: preview.note,
    payload: draft,
    previewToken: preview.previewToken,
    status: "待老板审核",
    requesterId: user.id,
    requester: user.name,
    createdAt: c.now(),
  };
  store.purchaseReturnRequests ||= [];
  store.purchaseReturnRequests.push(row);
  c.audit(store, user, "purchase:return-request", `${row.id} · 原采购 ${row.purchaseId} · ${row.name} × ${row.quantity} · ${row.amount} 元 · ${row.note}`);
  return row;
}

function review(store, user, payload) {
  requireOwner(store, user);
  const row = (store.purchaseReturnRequests || []).find((item) => item.id === payload.id);
  if (!row) throw new c.HttpError(404, "采购退货申请不存在");
  if (row.status !== "待老板审核") throw new c.HttpError(409, "该采购退货申请已经处理");
  if (!["approve", "reject"].includes(payload.decision))
    throw new c.HttpError(400, "审核结果不正确");
  const note = c.text(payload.note, "审核意见");
  if (note.length < 4 || note.length > 500)
    throw new c.HttpError(400, "审核意见须为 4 至 500 字");

  if (payload.decision === "reject") row.status = "已驳回";
  else {
    // Ignore replacement amounts/serials sent by the reviewer: only the saved
    // application may be approved, and its quote must still match current stock.
    let result;
    if(row.sourceType==='opening')result=require('./opening-purchase-returns').applyReviewed(store,user,row);
    else {
    const preview = supplierCosts.previewReturn(store, user, row.payload);
    if (preview.previewToken !== row.previewToken)
      throw new c.HttpError(409, "库存、成本或退货资料已有变化，请驳回后重新申请");
    result = supplierCosts.returnPurchase(store, user, {
      ...row.payload,
      confirmed: true,
      previewToken: preview.previewToken,
    });
    }
    result.requestId = row.id;
    result.requesterId = row.requesterId;
    result.requester = row.requester;
    row.resultId = result.id;
    row.resultEntryId = result.entryId;
    row.status = "已批准";
  }
  row.reviewedAt = c.now();
  row.reviewerId = user.id;
  row.reviewer = user.name;
  row.reviewNote = note;
  c.audit(store, user, "purchase:return-review", `${row.id} · ${row.status} · 原采购 ${row.purchaseId} · ${row.amount} 元 · ${note}`);
  return row;
}

module.exports = { list, request, review };
