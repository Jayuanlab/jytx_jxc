const c = require("./common");

const labels = { supplier: "往来单位", product: "商品", paymentAccount: "支付账户", businessOption: "业务选项", fundParty:"往来单位/平台", category:"商品分类", warehouse:"仓库" };

function requireOwner(store, user) {
  return require("./sale-return-requests").assertOwner(store, user);
}

function source(store, kind, sourceId) {
  if (kind === "supplier") return (store.suppliers || []).find(row => row.id === sourceId);
  if (kind === "product") return (store.products || []).find(row => row.skuId === sourceId);
  if (kind === "paymentAccount") return (store.paymentAccounts || []).find(row => row.id === sourceId);
  if (kind === "businessOption") return (store.businessOptions || []).find(row => row.id === sourceId);
  if(kind==='fundParty')return (store.fundParties||[]).find(r=>r.id===sourceId);
  if(kind==='category')return (store.productCategoryCatalog?.paths||[]).find(r=>r.id===sourceId);
  if(kind==='warehouse')return (store.warehouseProfiles||[]).find(r=>r.id===sourceId);
  throw new c.HttpError(400, "不支持该类新增档案");
}

function snapshot(row, kind) {
  if (!row) return null;
  if(['fundParty','category','warehouse'].includes(kind))return structuredClone(row);
  if (kind === "supplier") return { name: row.name, contact: row.contact || "", note: row.note || "" };
  if (kind === "businessOption") return { kind: row.kind, name: row.name, parentId: row.parentId, parentName: row.parentName, baseType: row.baseType, baseSubType: row.baseSubType };
  if (kind === "paymentAccount") return { name: row.name, channel: row.channel, ownerId: row.ownerId, ownerName: row.ownerName, active: row.active, note: row.note || "" };
  return { name: row.name, externalCode: row.externalCode, type: row.type, subType: row.subType || "", thirdType: row.thirdType || "", unit: row.unit, warehouseId: row.warehouseId || "", stockManaged: row.stockManaged, trackSerial: row.trackSerial, salePrice: row.salePrice, active: row.active };
}

function recordAddition(store, user, data) {
  if (!["supplier", "product", "paymentAccount", "businessOption","fundParty","category","warehouse"].includes(data.kind)) throw new c.HttpError(400, "不支持该类新增档案");
  c.permit(user,"catalogAdd");
  const sourceId = c.text(data.sourceId, "新增档案编号");
  const original = source(store, data.kind, sourceId);
  if (!original) throw new c.HttpError(404, "新增档案不存在");
  const existing = (store.catalogAdditionReviews || []).find(row => row.kind === data.kind && row.sourceId === sourceId);
  if (existing) return existing;
  const name = c.text(data.name, "新增档案名称");
  const row = {
    id: c.id("CAT"), kind: data.kind, sourceId, name,
    detail: data.detail === undefined ? snapshot(original, data.kind) : structuredClone(data.detail),
    status: "待老板核对", requesterId: user.id, requester: user.name,
    createdAt: c.now(), events: [],
  };
  row.events.push({ type: "新增立即可用", by: user.id, at: row.createdAt });
  store.catalogAdditionReviews ||= [];
  store.catalogAdditionReviews.push(row);
  // This array is consumed only by the in-app local notice endpoint. It must
  // never be added to feishuNotices or any external notification outbox.
  store.localCatalogNotices ||= [];
  store.localCatalogNotices.push({
    key: "catalog-addition:" + row.id, kind: "新增" + labels[row.kind] + "待核对",
    orderId: row.id, sourceId, summary: user.name + " 新增" + labels[row.kind] + "：" + name + "；已可正常开单，待老板核对资料。",
    amount: null, createdAt: row.createdAt, readAt: null, localOnly: true,
  });
  c.audit(store, user, "catalog:addition", `${row.id} · 新增${labels[row.kind]} ${name} · 原档 ${sourceId} · 已可使用，待老板核对`);
  return row;
}

function list(store, user) {
  requireOwner(store, user);
  return (store.catalogAdditionReviews || []).slice().reverse().map(row => ({
    ...structuredClone(row), current: snapshot(source(store, row.kind, row.sourceId), row.kind),
  }));
}

function review(store, user, payload) {
  const actual = requireOwner(store, user);
  const row = (store.catalogAdditionReviews || []).find(item => item.id === payload.id);
  if (!row) throw new c.HttpError(404, "新增档案核对事项不存在");
  if (!["待老板核对", "需完善"].includes(row.status))
    throw new c.HttpError(409, "该新增档案已确认");
  if (!["confirm", "needs_changes"].includes(payload.decision))
    throw new c.HttpError(400, "请选择确认或需完善");
  const note = String(payload.note || "").trim().slice(0, 500);
  const current = snapshot(source(store, row.kind, row.sourceId), row.kind);
  if (!current) throw new c.HttpError(409, "原档案已不存在，请先核实，不能确认");
  if (row.status === "需完善" && payload.decision === "needs_changes" && row.reviewNote === note)
    throw new c.HttpError(409, "已经记录这条需完善意见");
  const at = c.now();
  row.status = payload.decision === "confirm" ? "已确认" : "需完善";
  row.reviewedAt = at;
  row.reviewerId = actual.id;
  row.reviewer = actual.name;
  row.reviewNote = note;
  row.events ||= [];
  row.events.push({ type: row.status, by: actual.id, at, note, current });
  const notice = (store.localCatalogNotices || []).find(item => item.key === "catalog-addition:" + row.id);
  if (notice && !notice.readAt) notice.readAt = at;
  // Checking a directory entry never rewrites stock, orders, ledger entries,
  // the original creation snapshot, or the live product/supplier profile.
  c.audit(store, actual, "catalog:review", `${row.id} · ${labels[row.kind]} ${row.name} · ${row.status} · ${note}`);
  return row;
}

module.exports = { recordAddition, list, review };
