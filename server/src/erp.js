const c = require("./common");
const pay = require("./payroll");
const legacy = require("./services");
const suppliers = require("./suppliers");
const supplierCosts = require("./supplier-costs");
const vocabulary = require("./search-vocabulary");
const govSubsidy = require("./gov-subsidy");
const salePayments = require("./sale-payments");
const paymentAccounts = require("./payment-accounts");
const warehouses = require("./warehouses");
const inventoryDetails = require("./inventory-details");
const qrProducts = require("./qr-products");

function product(store, skuId) {
  const p = store.products.find((p) => p.skuId === skuId);
  if (!p) throw new c.HttpError(404, "商品不存在");
  return p;
}
function stock(store, skuId, warehouseId) {
  const target = warehouseId || product(store,skuId).warehouseId || "wh-sale";
  const result = store.inventory.find(
    (s) => s.skuId === skuId && (s.warehouseId || "wh-sale") === target,
  );
  if (!result) throw new c.HttpError(409, "该地点没有此商品库存");
  result.serials ||= [];
  result.costPrice ??= product(store, skuId).costPrice || 0;
  result.stockValue ??= c.round(result.quantity * result.costPrice);
  return result;
}
function move(store, user, p, s, qty, cost, type, sourceId) {
  store.movements.unshift({
    id: c.id("MV"),
    skuId: p.skuId,
    product: p.name,
    warehouseId: s.warehouseId || "wh-sale",
    warehouseName: s.warehouseName || "销售仓",
    quantity: qty,
    cost,
    type,
    sourceId,
    operatorId: user.id,
    operator: user.name,
    createdAt: c.now(),
  });
}
function receipt(store, user, kind, sourceId, amount, account, accountOwnerId = "") {
  if (!amount) return;
  store.receipts.push({
    id: c.id("RC"),
    kind,
    sourceId,
    amount: c.round(amount),
    account: c.text(account, "收付款方式"),
    ...(accountOwnerId ? { accountOwnerId } : {}),
    operatorId: user.id,
    createdAt: c.now(),
  });
}
function selectedUser(store, user, userId) {
  if (!userId || userId === user.id) return user;
  if (!["owner", "manager"].includes(user.roleCode))
    throw new c.HttpError(403, "不能代其他员工开单");
  const selected = c.userById(store, userId);
  c.permit(selected, "sell");
  return selected;
}
function visibleProduct(row, user) {
  const result = structuredClone(row);
  if (!c.capabilities(user).cost) {
    delete result.costPrice;
    delete result.referenceCostPrice;
  }
  return result;
}
function listProducts(store, user) {
  const caps = c.capabilities(user);
  return store.products.map((p) => {
    const result = {
      ...p,
      trackSerial: inventoryDetails.tracked(p),
      qrCode: qrProducts.eligible(p) ? qrProducts.encode(p) : null,
      categoryText: [p.type, p.subType, p.thirdType]
        .filter(Boolean)
        .join(" / "),
    };
    if (!caps.cost) {
      delete result.costPrice;
      delete result.referenceCostPrice;
    }
    return result;
  });
}
function inventory(store, user) {
  const caps = c.capabilities(user);
  const refs = inventoryDetails.index(store);
  const result = store.inventory.map((s) => {
    const p = product(store, s.skuId);
    return {
      ...p,
      ...s,
      stockKey: `${p.skuId}-${s.warehouseId || "wh-sale"}`,
      costPrice: s.costPrice ?? p.costPrice,
      ...inventoryDetails.enrich(store, p, s, refs),
      warehouseId: s.warehouseId || "wh-sale",
      warehouseName: s.warehouseName || "销售仓",
    };
  });
  store.products
    .filter((p) => p.stockManaged === false)
    .forEach((p) =>
      result.push({
        ...p,
        quantity: null,
        serials: [],
        stockKey: `${p.skuId}-service`,
        warehouseId: "",
        warehouseName: "服务项目",
      }),
    );
  return result.map((s) => {
    if (!caps.cost) {
      delete s.costPrice;
      delete s.stockValue;
      delete s.referenceCostPrice;
      delete s.costSources;
      s.serials = s.serials.map(({ costPrice, ...serial }) => serial);
    }
    return s;
  });
}
function mobileVariant(store, payload) {
  if (payload.sourceSkuId && payload.skuId)
    throw new c.HttpError(400, "编辑原商品不能同时新建YD版本；请使用新建YD版本入口");
  const sourceId = String(payload.sourceSkuId || "").trim();
  const isMobile = !payload.skuId && payload.warehouseId === "wh-c" && payload.kind !== "service" && payload.type !== "其他收入";
  if (sourceId && !isMobile) throw new c.HttpError(400, "同款YD版本必须为C仓实物商品");
  if (!isMobile) return null;
  c.text(payload.name, "商品名称");
  c.text(payload.type, "分类");
  c.money(payload.salePrice, "预设售价");
  const code = sourceId ? "" : c.text(payload.externalCode, "商品编号");
  const sameCode = sourceId ? null : store.products.find((row) => row.externalCode === code);
  const source = sourceId ? product(store, sourceId) : sameCode?.warehouseId !== "wh-c" ? sameCode : null;
  if (!source) {
    if (sameCode?.warehouseId === "wh-c" && warehouses.baseName(sameCode.name) === warehouses.baseName(payload.name)) {
      if (sameCode.active === false) throw new c.HttpError(409, "该C仓YD商品已停用，请先恢复商品状态");
      return { reused: sameCode };
    }
    return null;
  }
  if (source.stockManaged === false || source.warehouseId === "wh-c" || source.active === false)
    throw new c.HttpError(400, "请选择在用的非C仓实物商品建立YD版本");
  if (warehouses.baseName(source.name) !== warehouses.baseName(payload.name))
    throw new c.HttpError(409, "YD版本应沿用原商品型号；不同商品请分别新建");
  const codeYD = "YD-" + require("node:crypto").createHash("sha256").update(source.skuId).digest("hex").slice(0,24);
  const versions = store.products.filter((row) => row.warehouseId === "wh-c" && (row.mobileVariantOf === source.skuId || row.externalCode === codeYD || (!row.mobileVariantOf && warehouses.baseName(row.name) === warehouses.baseName(source.name))));
  if (versions.length > 1) throw new c.HttpError(409, "同款已有多个YD档案，请管理员核对后再使用");
  if (versions.length) {
    const previous = versions[0];
    if ((previous.mobileVariantOf && previous.mobileVariantOf !== source.skuId) || previous.active === false || previous.stockManaged === false || inventoryDetails.tracked(previous) !== inventoryDetails.tracked(source))
      throw new c.HttpError(409, "该型号YD档案需管理员核对，请勿重复建档");
    return { reused: previous };
  }
  if (store.products.some((row) => row.externalCode === codeYD)) throw new c.HttpError(409, "自动YD编号发生冲突，请管理员核对");
  return { source, externalCode: codeYD };
}
function saveProduct(store, user, payload) {
  c.permit(user, "manageProducts");
  const mobile = mobileVariant(store, payload);
  if (mobile?.reused) return { ...visibleProduct(mobile.reused, user), message: "该型号C仓YD商品已建档，已选用现有商品；库存没有重复增加。" };
  if (mobile?.source) payload = { ...payload, externalCode: mobile.externalCode, trackSerial: inventoryDetails.tracked(mobile.source) };
  const existing = payload.skuId ? product(store, payload.skuId) : null;
  const previousCategory = existing ? [existing.type,existing.subType,existing.thirdType].filter(Boolean).join(" / ") : "";
  const previousWarehouseId = existing?.warehouseId || "wh-sale";
  const stockManaged = payload.kind !== "service" && payload.type !== "其他收入";
  const trackSerial = stockManaged && (Boolean(payload.trackSerial) || inventoryDetails.phone({...existing,...payload,stockManaged}));
  if (
    existing &&
    ((existing.stockManaged !== false) !== stockManaged ||
      inventoryDetails.tracked(existing) !== trackSerial) &&
    (store.inventory.some((s) => s.skuId === existing.skuId && s.quantity) ||
      store.movements.some((m) => m.skuId === existing.skuId))
  )
    throw new c.HttpError(409, "已有库存或出入库记录，不能改变库存管理方式");
  const externalCode = c.text(payload.externalCode, "商品编号");
  if (
    store.products.some(
      (p) => p.externalCode === externalCode && p !== existing,
    )
  )
    throw new c.HttpError(409, "商品编号已存在");
  const requestedWarehouse = warehouses.selected({ ...existing, ...payload, stockManaged }, payload.warehouseId);
  if (existing && previousWarehouseId !== requestedWarehouse &&
    (store.inventory.some((s) => s.skuId === existing.skuId && s.quantity) || store.movements.some((m) => m.skuId === existing.skuId) ||
      (store.procurementPlans || []).some((plan) => plan.status === "open" && plan.items.some((item) => item.skuId === existing.skuId))))
    throw new c.HttpError(409, "该商品已有库存、流水或未收齐订货单，不能直接修改所属仓；请先完成归仓核对");
  const requestedPrice = c.money(payload.salePrice, "预设售价");
  if (existing && requestedPrice !== Number(existing.salePrice))
    throw new c.HttpError(409, "已有商品改零售价请使用调价单，由老板审核后生效");
  const result = {
    ...(existing || {}),
    skuId: existing ? existing.skuId : c.id("SKU"),
    externalCode,
    ...(mobile?.source ? { mobileVariantOf: mobile.source.skuId, mobileVariantSourceCode: mobile.source.externalCode } : {}),
    name: warehouses.productName((!existing||previousWarehouseId==="wh-c"&&requestedWarehouse!=="wh-c")?warehouses.baseName(c.text(payload.name, "商品名称")):c.text(payload.name, "商品名称"), requestedWarehouse),
    shortName: String(payload.shortName || "").trim(),
    aliases: payload.aliases === undefined ? (existing?.aliases || []) : vocabulary.words(payload.aliases),
    type: ((type)=>type==="智能手机"?"智能机":/^(配件和维修|配件\s*[/／]\s*维修)$/.test(type)?(stockManaged?"配件":"维修"):type)(c.text(payload.type, "分类")),
    subType: payload.subType || "",
    thirdType: payload.thirdType === undefined ? (existing?.thirdType || "") : String(payload.thirdType || "").trim(),
    unit: payload.unit || (stockManaged ? "件" : "项"),
    stockManaged,
    trackSerial,
    warehouseId: requestedWarehouse,
    salePrice: requestedPrice,
    costPrice: existing?.costPrice || 0,
    active: payload.active !== false,
  };
  if (existing) Object.assign(existing, result);
  else store.products.push(result);
  if (requestedWarehouse === "wh-c") {
    const originalName=warehouses.baseName(payload.name);
    result.aliases=[...new Set([...(result.aliases||[]),originalName,...(mobile?.source ? [mobile.source.name,mobile.source.externalCode,mobile.source.barcode,mobile.source.importSource?.fields?.["条码"]] : [])].filter(Boolean))];
    if(existing)existing.aliases=result.aliases;
  }
  if (existing && stockManaged && previousWarehouseId !== requestedWarehouse) for (const row of store.inventory.filter((s) => s.skuId === result.skuId)) { row.warehouseId=requestedWarehouse; row.warehouseName=warehouses.byId(requestedWarehouse).name; }
  if (stockManaged && !store.inventory.some((s) => s.skuId === result.skuId))
    store.inventory.push({
      skuId: result.skuId,
      warehouseId: requestedWarehouse,
      warehouseName: warehouses.byId(requestedWarehouse).name,
      quantity: 0,
      costPrice: 0,
      stockValue: 0,
      serials: [],
    });
  const currentCategory=[result.type,result.subType,result.thirdType].filter(Boolean).join(" / ");
  c.audit(store, user, "product:save", `保存商品 ${result.name}`+(existing&&previousCategory!==currentCategory?`；分类：${previousCategory} → ${currentCategory}`:""));
  if (!existing) require("./catalog-reviews").recordAddition(store, user, { kind: "product", sourceId: result.skuId, name: result.name });
  return visibleProduct(result, user);
}
function purchase(store, user, payload) {
  const invoiceNo=String(payload.invoiceNo||"").trim();
  if(invoiceNo.length>100)throw new c.HttpError(400,"发票号码不能超过100字");
  c.permit(user, "purchase");
  if (!Array.isArray(payload.items) || !payload.items.length)
    throw new c.HttpError(400, "请选择入库商品");
  const orderId = c.id("PO");
  const supplier = suppliers.resolve(store, user, payload);
  suppliers.validatePlanReceipt(store, supplier, payload, user);
  if (Number(payload.paidAmount) > 0 || Number(payload.advanceAmount) > 0)
    c.permit(user, "supplierSettle");
  const items = payload.items.map((input) => {
    const p = product(store, input.skuId);
    if (p.stockManaged === false)
      throw new c.HttpError(400, "服务商品不采购入库");
    const s = stock(store, p.skuId);
    const qty = c.quantity(input.quantity);
    const itemId = c.id("PI");
    const costPrice = c.money(input.costPrice, "实际进价");
    const serials = (input.serials || []).map((x) => c.text(x, "串码"));
    if (inventoryDetails.tracked(p) && serials.length !== qty)
      throw new c.HttpError(400, "串码数量必须与入库数量一致");
    if (
      new Set(serials).size !== serials.length ||
      serials.some((no) =>
        store.inventory.some((row) =>
          (row.serials || []).some((x) => x.no === no),
        ),
      )
    )
      throw new c.HttpError(409, "串码重复，请核对");
    if (!inventoryDetails.tracked(p)) supplierCosts.receive(s, itemId, qty);
    const value = c.round(s.stockValue + qty * costPrice);
    s.quantity += qty;
    s.stockValue = value;
    s.costPrice = Number((value / s.quantity).toFixed(6));
    serials.forEach((no) =>
      s.serials.push({
        no,
        status: "可售",
        costPrice,
        purchaseId: orderId,
        purchaseItemId: itemId,
      }),
    );
    move(store, user, p, s, qty, qty * costPrice, "采购入库", orderId);
    return {
      id: itemId,
      skuId: p.skuId,
      name: p.name,
      quantity: qty,
      costPrice,
      serials,
      warehouseId: s.warehouseId || p.warehouseId || "wh-sale",
      warehouseName: s.warehouseName || warehouses.byId(p.warehouseId)?.name || "销售仓",
      ...(qrProducts.eligible(p) ? {qrCode: qrProducts.encode(p)} : {}),
    };
  });
  const amount = c.round(
    items.reduce((n, i) => n + i.quantity * i.costPrice, 0),
  );
  const order = {
    id: orderId,
    supplier: supplier.name,
    supplierId: supplier.id,
    invoiceNo,
    items,
    amount,
    paidAmount: 0,
    operatorId: user.id,
    operator: user.name,
    createdAt: c.now(),
  };
  store.purchases.unshift(order);
  suppliers.receivePlan(store, order, payload);
  suppliers.registerPurchase(store, user, order, {
    ...payload,
    account: payload.account || "微信",
  });
  c.audit(store, user, "purchase:create", order.id);
  return order;
}
function deduct(store, user, p, input, orderId, type) {
  const s = stock(store, p.skuId);
  const qty = c.quantity(input.quantity);
  if (s.quantity < qty) throw new c.HttpError(409, `${p.name} 库存不足`);
  let costPrice = s.costPrice;
  let serialNo = "";
  let costSources = [];
  if (inventoryDetails.tracked(p)) {
    if (qty !== 1) throw new c.HttpError(400, "串码商品请逐件添加");
    serialNo = c.text(input.serialNo, "串码");
    const serial = s.serials.find(
      (x) => x.no === serialNo && ["可售", "未激活"].includes(x.status),
    );
    if (!serial) throw new c.HttpError(409, "该串码已售或不在可售库存");
    costPrice = serial.costPrice ?? s.costPrice;
    serial.status = "已售";
  } else {
    costSources = supplierCosts.take(s, qty);
  }
  const cost = qty === s.quantity ? s.stockValue : c.round(costPrice * qty);
  s.quantity -= qty;
  s.stockValue = s.quantity ? c.round(s.stockValue - cost) : 0;
  if (s.quantity) s.costPrice = Number((s.stockValue / s.quantity).toFixed(6));
  move(store, user, p, s, -qty, -cost, type, orderId);
  return {
    skuId: p.skuId,
    name: p.name,
    quantity: qty,
    costPrice,
    cost,
    serialNo,
    costSources,
    warehouseId: s.warehouseId || p.warehouseId || "wh-sale",
    warehouseName: s.warehouseName || warehouses.byId(p.warehouseId)?.name || "销售仓",
  };
}
function giftRules(store) {
  return { maxProfitPercent: 20, maxUnitCost: 50, ...(store.giftRules || {}) };
}
function saveGiftRules(store, user, payload) {
  c.permit(user, "manageUsers");
  const maxProfitPercent = c.number(payload.maxProfitPercent, "赠品毛利比例");
  const maxUnitCost = c.money(payload.maxUnitCost, "单件赠品成本上限");
  if (maxProfitPercent > 100 || maxUnitCost > 10000)
    throw new c.HttpError(400, "赠品限额超出可设置范围");
  store.giftRules = { maxProfitPercent, maxUnitCost };
  c.audit(store, user, "gift:rules", "赠品上限：毛利 " + maxProfitPercent + "%，单件 " + maxUnitCost + " 元");
  return giftRules(store);
}
function issueGift(store, user, order, inputs, reason, supplemental = false, approved = false) {
  if (!Array.isArray(inputs) || !inputs.length) throw new c.HttpError(400, "请选择赠品");
  if (inputs.length > 20) throw new c.HttpError(400, "单张赠品单最多 20 项明细");
  if (order.status === "returned") throw new c.HttpError(409, "原销售单已全部退货，不能补赠");
  const rules = giftRules(store);
  const returnedProfit = (store.saleReturns || []).filter((row) => row.orderId === order.id)
    .reduce((sum, row) => sum + Number(row.profit || 0), 0);
  const beforeGiftProfit = c.round(Number(order.profit || 0) - returnedProfit);
  const cap = c.round(Math.max(0, beforeGiftProfit) * rules.maxProfitPercent / 100);
  const record = {
    id: c.id("GFT"), orderId: order.id, createdAt: c.now(),
    operatorId: user.id, operator: user.name,
    reason: String(reason || (supplemental ? "" : "销售时随单赠送")).trim().slice(0, 300),
    kind: supplemental ? "补赠" : "随单赠送", items: [],
  };
  if (!record.reason) throw new c.HttpError(400, "请填写补赠原因");
  for (const input of inputs) {
    const p = product(store, input.skuId);
    if (p.active === false || p.stockManaged === false)
      throw new c.HttpError(400, "赠品必须是店内启用的实物商品");
    const taken = deduct(store, user, p, input, record.id, "赠品出库");
    if (!approved && c.round(taken.cost / taken.quantity) > rules.maxUnitCost)
      throw new c.HttpError(409, p.name + " 单件实际成本超过赠品上限");
    record.items.push({
      skuId: p.skuId, name: p.name, quantity: taken.quantity,
      serialNo: taken.serialNo, cost: taken.cost,
      unitCost: c.round(taken.cost / taken.quantity),
      costSources: taken.costSources,
    });
  }
  record.cost = c.round(record.items.reduce((sum, item) => sum + item.cost, 0));
  const previous = Number(order.giftCost || 0);
  if (!approved && c.round(previous + record.cost) > cap)
    throw new c.HttpError(409, "本单赠品累计成本超过赠送前毛利的 " + rules.maxProfitPercent + "%");
  order.giftOrders ||= [];
  order.giftOrders.push(record);
  order.giftCost = c.round(previous + record.cost);
  c.audit(store, user, supplemental ? "gift:supplement" : "gift:issue",
    record.id + " · 原销售单 " + order.id + " · " + record.items.map((item) => item.name + "×" + item.quantity).join("、"));
  return record;
}
function quoteGiftForOrder(store, user, order, inputs) {
  const copy = structuredClone(store);
  const draft = structuredClone(order);
  const gift = issueGift(copy, user, draft, inputs, "赠品成本预览", false, true);
  const rules = giftRules(store);
  const returnedProfit = (store.saleReturns || []).filter((row) => row.orderId === order.id)
    .reduce((sum, row) => sum + Number(row.profit || 0), 0);
  const cap = c.round(Math.max(0, Number(order.profit || 0) - returnedProfit) * rules.maxProfitPercent / 100);
  const reasons = [];
  for (const item of gift.items) if (item.unitCost > rules.maxUnitCost)
    reasons.push(`${item.name} 单件成本 ${item.unitCost} 元，超过 ${rules.maxUnitCost} 元`);
  if (c.round(Number(order.giftCost || 0) + gift.cost) > cap)
    reasons.push(`累计赠品成本超过本单毛利的 ${rules.maxProfitPercent}%（限 ${cap} 元）`);
  return { cost: gift.cost, items: gift.items.map(({skuId,name,quantity,serialNo,cost,unitCost}) =>
    ({skuId,name,quantity,serialNo,cost,unitCost})), cap, previousCost: Number(order.giftCost || 0),
    reasons, approvalRequired: Boolean(reasons.length) };
}
function quoteSaleGift(store, user, payload) {
  c.permit(user, "sell");
  if (!Array.isArray(payload.gifts) || !payload.gifts.length) return {cost:0,items:[],reasons:[],approvalRequired:false};
  const copy = structuredClone(store);
  const saleDraft = sale(copy, user, {account:"现金",cashDrawerConfirmed:true,items:payload.items,gifts:[]});
  const order = copy.sales.find((row) => row.id === saleDraft.id);
  return quoteGiftForOrder(copy, user, order, payload.gifts);
}
function queueGiftApproval(store, user, order, inputs, reason, quote, supplemental) {
  store.giftApprovals ||= [];
  const request = {
    id: c.id("GA"), orderId: order.id, status: "待审批", createdAt: c.now(),
    requestedById: user.id, requestedBy: user.name, items: structuredClone(inputs),
    reason: String(reason || (supplemental ? "后补赠品" : "随单赠送")).trim().slice(0,300),
    estimatedCost: quote.cost, quotedItems: quote.items, limitReasons: quote.reasons, kind: supplemental ? "补赠" : "随单赠送",
  };
  store.giftApprovals.unshift(request);
  order.giftApprovalIds ||= [];
  order.giftApprovalIds.push(request.id);
  c.audit(store, user, "gift:request", `${request.id} · 销售单 ${order.id} · ${quote.reasons.join("；")}`);
  return request;
}
function giftApprovals(store, user) {
  c.permit(user, "learn");
  const canApprove = c.capabilities(user).giftApprove;
  return (store.giftApprovals || []).filter((row) => canApprove || row.requestedById === user.id)
    .map((row) => ({...row, canApprove: canApprove && row.status === "待审批"}));
}
function reviewGiftApproval(store, user, payload) {
  c.permit(user, "giftApprove");
  const request = (store.giftApprovals || []).find((row) => row.id === payload.id);
  if (!request) throw new c.HttpError(404, "赠品审批单不存在");
  if (request.status !== "待审批") throw new c.HttpError(409, "此赠品单已处理");
  const order = store.sales.find((row) => row.id === request.orderId);
  if (!order) throw new c.HttpError(404, "原销售单不存在");
  const reviewNote = String(payload.note || "").trim().slice(0,300);
  if (payload.approve === false && !reviewNote) throw new c.HttpError(400, "驳回时请填写原因");
  if (payload.approve === true) {
    const quote = quoteGiftForOrder(store, user, order, request.items);
    if (quote.cost > request.estimatedCost)
      throw new c.HttpError(409, "赠品实际成本已高于申请时金额，请退回后重新申请");
    const gift = issueGift(store, user, order, request.items, request.reason, true, true);
    gift.kind = request.kind === "随单赠送" ? "审批随单赠送" : "审批补赠";
    gift.approvalId = request.id;
    request.giftId = gift.id;
    request.actualCost = gift.cost;
    pay.giftAdjustment(store, order, gift);
    require("./receptions").reverseCommission(store, user, order, "赠品成本冲回协助分成");
    request.status = "已批准";
  } else if (payload.approve === false) request.status = "已驳回";
  else throw new c.HttpError(400, "请选择批准或驳回");
  request.reviewedById = user.id;
  request.reviewedBy = user.name;
  request.reviewedAt = c.now();
  request.reviewNote = String(payload.note || "").trim().slice(0,300);
  if (request.status === "已驳回" && !request.reviewNote) throw new c.HttpError(400, "驳回时请填写原因");
  c.audit(store, user, "gift:review", `${request.id} · ${request.status} · ${request.reviewNote}`);
  return request;
}
function supplementGift(store, user, payload) {
  c.permit(user, "sell");
  const order = store.sales.find((row) => row.id === payload.orderId);
  if (!order) throw new c.HttpError(404, "原销售单不存在");
  if (!c.capabilities(user).allSales && (order.salespersonId || order.operatorId) !== user.id)
    throw new c.HttpError(403, "只能为本人销售单补赠");
  const quote = quoteGiftForOrder(store, user, order, payload.items);
  if (quote.approvalRequired) return queueGiftApproval(store, user, order, payload.items, payload.reason, quote, true);
  const gift = issueGift(store, user, order, payload.items, payload.reason, true);
  pay.giftAdjustment(store, order, gift);
  require("./receptions").reverseCommission(store, user, order, "赠品成本冲回协助分成");
  if (c.capabilities(user).profit) return gift;
  const visible = JSON.parse(JSON.stringify(gift));
  visible.items.forEach((item) => { delete item.costSources; });
  return visible;
}
function nextSaleId(store, createdAt) {
  const prefix = `SO-${c.day(createdAt).slice(2).replace(/-/g, "")}-`;
  const last = (store.sales || []).reduce((max, row) => {
    const id = String(row.id || "");
    if (!id.startsWith(prefix)) return max;
    const suffix = id.slice(prefix.length);
    return /^\d{4,}$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  return prefix + String(last + 1).padStart(4, "0");
}
function sale(store, user, payload, options = {}) {
  const invoiceNo=String(payload.invoiceNo||"").trim();
  if(invoiceNo.length>100)throw new c.HttpError(400,"发票号码不能超过100字");
  c.permit(user, "sell");
  const salesperson = selectedUser(store, user, payload.salespersonId);
  let customerName = String(payload.customerName || "").trim();
  let customerPhone = String(payload.customerPhone || "").trim();
  if (payload.receptionId) {
    const reception = (store.receptions || []).find((row) => row.id === payload.receptionId);
    if (!reception) throw new c.HttpError(404, "关联接待单不存在");
    const linkedCustomer = (store.customers || []).find((row) => row.id === reception.customerId);
    if (!linkedCustomer?.phone) throw new c.HttpError(409, "接待单缺少顾客档案，请先核对");
    if (customerPhone && customerPhone !== linkedCustomer.phone)
      throw new c.HttpError(409, "顾客手机号与接待单不一致，请核对后再开单");
    customerPhone = linkedCustomer.phone;
    if (!customerName) customerName = linkedCustomer.name || "";
  }
  if (customerName.length > 40) throw new c.HttpError(400, "顾客姓名不能超过40字");
  if (customerPhone && !/^1[3-9]\d{9}$/.test(customerPhone))
    throw new c.HttpError(400, "顾客手机号须为11位；不提供时请留空");
  if (!Array.isArray(payload.items) || !payload.items.length)
    throw new c.HttpError(400, "请选择销售商品");
  const subsidy = govSubsidy.prepare(store, payload);
  const account = String(payload.account || "微信");
  if (payload.payments == null && !payload.paymentAccountId && !paymentAccounts.channels.includes(account)) throw new c.HttpError(400, "收款方式不正确");
  let accountOwnerId = account === "现金" ? "" : String(payload.accountOwnerId || "");
  if (accountOwnerId) {
    const selected = store.users.find((row) => row.id === accountOwnerId && row.status === "active");
    if (!selected || !c.capabilities(selected).financeReceive) accountOwnerId = "";
  }
  const createdAt = c.now();
  const order = {
    id: nextSaleId(store, createdAt),
    createdAt,
    operatorId: user.id,
    operator: user.name,
    salespersonId: salesperson.id,
    salesperson: salesperson.name,
    status: "completed",
    paymentMethod: account,
    invoiceNo,
    invoiceType: ["未提出", "电子发票", "纸质发票"].includes(payload.invoiceType) ? payload.invoiceType : "未提出",
    note: String(payload.orderNote || "").trim().slice(0, 500),
    ...(accountOwnerId ? { accountOwnerId } : {}),
  };
  if (customerPhone) {
    store.customers ||= [];
    let customer = store.customers.find((row) => row.phone === customerPhone);
    if (!customer) {
      customer = { id: c.id("CU"), phone: customerPhone, name: customerName, receivable: 0, createdAt: c.now() };
      store.customers.unshift(customer);
    } else if (!customer.name && customerName) customer.name = customerName;
    order.customerId = customer.id;
    order.customerMask = customerPhone.slice(0, 3) + "****" + customerPhone.slice(-4);
    order.customerName = customerName || customer.name || "";
  } else if (customerName) order.customerName = customerName;
  order.items = payload.items.map((input) => {
    const p = product(store, input.skuId);
    if (p.active === false) throw new c.HttpError(409, "该商品已停用");
    const qty = c.quantity(input.quantity);
    const salePrice = c.money(input.salePrice, "售价");
    let cost = 0;
    let serialNo = "";
    let materials = [];
    let costSources = [];
    if (p.stockManaged !== false) {
      const taken = deduct(store, user, p, input, order.id, "销售出库");
      cost = taken.cost;
      serialNo = taken.serialNo;
      costSources = taken.costSources;
    } else {
      materials = (input.materials || []).map((m) => {
        const material = product(store, m.skuId);
        if (material.stockManaged === false)
          throw new c.HttpError(400, "耗材必须是实物商品");
        return deduct(store, user, material, m, order.id, "维修耗材");
      });
      if (p.type === "维修" && !materials.length && !input.noMaterials)
        throw new c.HttpError(400, "请选择本次耗材，或确认无耗材");
      cost = c.round(materials.reduce((n, m) => n + m.cost, 0));
    }
    const amount = c.round(qty * salePrice);
    return {
      id: c.id("SI"),
      skuId: p.skuId,
      name: p.name,
      externalCode: p.externalCode || "",
      type: p.type,
      subType: p.subType || "",
      quantity: qty,
      returnedQuantity: 0,
      stockManaged: p.stockManaged !== false,
      trackSerial: inventoryDetails.tracked(p),
      serialNo,
      salePrice,
      amount,
      cost,
      costPrice: cost / qty,
      profit: c.round(amount - cost),
      materials,
      costSources,
      warehouseId: p.stockManaged !== false ? (p.warehouseId || "wh-sale") : "",
      warehouseName: p.stockManaged !== false ? (stock(store,p.skuId).warehouseName || "销售仓") : "服务项目",
      note: input.note || "",
    };
  });
  order.amount = c.round(order.items.reduce((s, i) => s + i.amount, 0));
  order.profit = c.round(order.items.reduce((s, i) => s + i.profit, 0));
  if (payload.gifts?.length) {
    const quote = quoteGiftForOrder(store, user, order, payload.gifts);
    if (quote.approvalRequired) queueGiftApproval(store, user, order, payload.gifts, payload.giftReason, quote, false);
    else issueGift(store, user, order, payload.gifts, payload.giftReason);
  }
  if (subsidy) govSubsidy.recordSale(store, user, order, subsidy);
  salePayments.init(store, user, order, payload, options.paymentCredit || 0);
  store.sales.unshift(order);
  order.items.forEach((item, index) => {
    if (
      salesperson.roleCode !== "owner" ||
      store.salaryRates.some((r) => r.employeeId === salesperson.id)
    )
      pay.accrue(store, order, item);
    if (item.type === "号卡") {
      const data = payload.items[index].card || {};
      store.cardBusinesses.unshift({
        id: c.id("CARD"),
        orderId: order.id,
        itemId: item.id,
        productName: item.name,
        employeeId: salesperson.id,
        employeeName: salesperson.name,
        carrier: data.carrier || "",
        packageName: data.packageName || item.name,
        cardNo: data.cardNo || item.serialNo,
        expected: c.money(data.expected || 0, "预计佣金"),
        confirmed: 0,
        received: 0,
        createdAt: order.createdAt,
      });
    }
  });
  for (const gift of order.giftOrders || []) pay.giftAdjustment(store, order, gift);
  if (payload.receptionId) { require("./receptions").link(store, user, {receptionId:payload.receptionId}, "销售单", order); order.receptionId = payload.receptionId; }
  c.audit(store, user, "sale:create", order.id);
  return visibleOrder(order, user);
}
function visibleOrder(order, user) {
  const result = JSON.parse(JSON.stringify(order));
  result.giftCost = c.round(result.giftCost || 0);
  result.netProfit = c.round(Number(result.profit || 0) - result.giftCost);
  if (!c.capabilities(user).profit) {
    delete result.netProfit;
    (result.giftOrders || []).forEach((gift) => { (gift.items || []).forEach((item) => { delete item.costSources; }); });
    delete result.profit;
    (result.items || []).forEach((i) => {
      delete i.profit;
      delete i.cost;
      delete i.costPrice;
      delete i.costSources;
      (i.materials || []).forEach((m) => {
        delete m.cost;
        delete m.costPrice;
        delete m.costSources;
      });
    });
  }
  return result;
}
function orders(store, user, query = "") {
  return store.sales
    .filter(
      (o) =>
        c.capabilities(user).allSales ||
        (o.salespersonId || o.operatorId) === user.id,
    )
    .filter((o) =>
      `${o.id} ${o.salesperson || o.operator} ${o.items.map((i) => `${i.name} ${i.serialNo || ""}`).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) || (o.giftOrders || []).some((gift) =>
          (gift.id + " " + gift.items.map((item) => item.name + " " + (item.serialNo || "")).join(" ")).toLowerCase().includes(query.toLowerCase())),
    )
    .map((o) => {
      const result = visibleOrder(o, user);
      if (c.capabilities(user).profit) {
        result.costAdjustments = store.costAdjustments.filter(
          (a) => a.orderId === o.id,
        );
        result.costAdjustment = c.round(
          result.costAdjustments.reduce((n, a) => n + a.costDelta, 0),
        );
        result.originalNetProfit = result.netProfit;
        result.adjustedProfit = c.round(o.profit - (o.giftCost || 0) - result.costAdjustment);
        result.netProfit = result.adjustedProfit;
      }
      return result;
    });
}
function returnSale(store, user, payload, options = {}) {
  require('./sale-return-requests').assertOwner(store, user);
  c.permit(user, options.redReversal ? 'redReview' : 'returnSale');
  const order = store.sales.find((o) => o.id === payload.orderId);
  if (!order) throw new c.HttpError(404, "原销售单不存在");
  if (!options.redReversal && !c.capabilities(user).allSales && (order.salespersonId || order.operatorId) !== user.id)
    throw new c.HttpError(403, "只能办理本人销售单的退货");
  if (!options.redReversal && order.paymentReview && !["已核对", "已确认到账", "无需收款"].includes(order.paymentReview.status))
    throw new c.HttpError(409, "请先核实原单收款，再办理退货；误开单请办理红冲");
  if (!Array.isArray(payload.items) || !payload.items.length)
    throw new c.HttpError(400, "请选择退货明细");
  const ids = new Set();
  for(const input of payload.items){if(ids.has(input.itemId))throw new c.HttpError(400,"退货明细不能重复");ids.add(input.itemId);}
  const subsidyReturn = govSubsidy.returnInfo(store, order, payload);
  const row = {
    id: c.id("SR"),
    orderId: order.id,
    createdAt: c.now(),
    operatorId: user.id,
    operator: user.name,
    salespersonId: order.salespersonId || order.operatorId,
    reason: c.text(payload.reason, "退货原因"),
    items: [],
  };
  row.items = payload.items.map((input) => {
    const item = order.items.find((i) => i.id === input.itemId);
    if (!item) throw new c.HttpError(404, "退货商品不存在");
    const qty = c.quantity(input.quantity);
    const previouslyReturned = item.returnedQuantity || 0;
    const totalReturned = previouslyReturned + qty;
    if (totalReturned > item.quantity)
      throw new c.HttpError(409, "退货数量超过可退数量");
    item.returnedQuantity = totalReturned;
    const amount = c.round(item.salePrice * qty);
    const cost = item.stockManaged
      ? c.round(
          c.round((item.cost * totalReturned) / item.quantity) -
            c.round((item.cost * previouslyReturned) / item.quantity),
        )
      : 0;
    if (item.stockManaged) {
      const p = product(store, item.skuId);
      const s = stock(store, item.skuId, item.warehouseId || p.warehouseId || "wh-sale");
      const previousValue = s.stockValue;
      const costDelta = supplierCosts.restoreSaleCost(
        store,
        user,
        order,
        item,
        qty,
        previouslyReturned,
        row.id,
      );
      if (!item.serialNo)
        supplierCosts.restore(s, item.costSources, qty / item.quantity, qty);
      s.quantity += qty;
      s.stockValue = c.round(previousValue + cost + costDelta);
      s.costPrice = Number((s.stockValue / s.quantity).toFixed(6));
      if (item.serialNo) {
        const serial = s.serials.find((x) => x.no === item.serialNo);
        if (!serial || serial.status !== "已售")
          throw new c.HttpError(409, "串码状态与退货不一致");
        serial.status = "可售";
      }
      move(store, user, p, s, qty, cost + costDelta, "销售退货", row.id);
    }
    pay.reverse(store, order, item, qty, totalReturned, row.id, row.createdAt);
    return {
      itemId: item.id,
      skuId: item.skuId,
      name: item.name,
      type: item.type,
      quantity: qty,
      amount,
      cost,
      profit: c.round(amount - cost),
    };
  });
  row.amount = c.round(row.items.reduce((s, i) => s + i.amount, 0));
  row.profit = c.round(row.items.reduce((s, i) => s + i.profit, 0));
  store.saleReturns.unshift(row);
  require("./receptions").reverseCommission(store, user, order);
  govSubsidy.recordReturn(store, user, row, subsidyReturn);
  order.status = order.items.every((i) => i.returnedQuantity === i.quantity)
    ? "returned"
    : "partial_return";
  const refundAmount=options.refundAmount ?? c.round((row.customerRefund ?? row.amount)-(options.paymentCredit||0));
  if (order.paymentParts) {
    row.refundParts=paymentAccounts.refundParts(store,order,refundAmount,payload.refundPayments);
    row.originalOrderId=order.id;
    paymentAccounts.recordRefund(store,user,row.id,row.refundParts);
  } else receipt(store,user,"refund",row.id,-refundAmount,payload.account||order.paymentMethod,order.accountOwnerId||"");
  c.audit(store, user, "sale:return", `${order.id} 退货 ${row.amount}`);
  return row;
}
function cardEvent(store, user, payload) {
  c.permit(user, "finance");
  const business = store.cardBusinesses.find(
    (b) => b.id === payload.businessId,
  );
  if (!business) throw new c.HttpError(404, "号卡业务不存在");
  const amount = ["receive","clawback"].includes(payload.type)?paymentAccounts.cents(payload.amount)/100:c.money(payload.amount);
  if(["receive","clawback"].includes(payload.type)&&amount<=0)throw new c.HttpError(400,"实际收付款金额须大于零");
  const event = {
    id: c.id("CE"),
    businessId: business.id,
    type: payload.type,
    amount,
    note: payload.note || "",
    createdAt: c.now(),
    operatorId: user.id,
  };
  if (event.type === "confirm")
    business.confirmed = c.round(business.confirmed + amount);
  else if (event.type === "receive") {
    if (business.received + amount > business.confirmed + 0.001)
      throw new c.HttpError(409, "到账金额超过已确认的待收佣金");
    event.paymentParts=paymentAccounts.normalize(store,payload,amount,"银行卡");
    business.received = c.round(business.received + amount);
    paymentAccounts.record(store,user,"carrier",event.id,event.paymentParts,1);
  } else if (event.type === "adjust") {
    if (amount > business.confirmed - business.received + 0.001)
      throw new c.HttpError(409, "调整不能超过未到账佣金");
    business.confirmed = c.round(business.confirmed - amount);
  } else if (event.type === "clawback") {
    if (amount > business.received)
      throw new c.HttpError(409, "扣回不能超过已到账佣金");
    const originalEvents=store.cardEvents.filter(row=>row.businessId===business.id&&row.type==='receive'),sourceIds=new Set(originalEvents.map(row=>row.id));
    event.paymentParts=originalEvents.some(row=>row.paymentParts)?paymentAccounts.originalParts(store,store.receipts.filter(row=>row.kind==='carrier'&&sourceIds.has(row.sourceId)),amount,payload.refundPayments??payload.payments):paymentAccounts.normalize(store,payload,amount,"银行卡");
    business.received = c.round(business.received - amount);
    business.confirmed = c.round(business.confirmed - amount);
    paymentAccounts.record(store,user,"carrier_clawback",event.id,event.paymentParts,-1);
  } else throw new c.HttpError(400, "佣金操作不正确");
  store.cardEvents.push(event);
  c.audit(
    store,
    user,
    "carrier:event",
    `${business.productName} ${event.type} ${amount}`,
  );
  return business;
}
function cards(store, user) {
  const rows = store.cardBusinesses.filter(
    (b) => c.capabilities(user).finance || b.employeeId === user.id,
  );
  return {
    canManage: c.capabilities(user).finance,
    rows: rows.map((b) => ({
      ...b,
      outstanding: c.round(b.confirmed - b.received),
      events: store.cardEvents.filter((e) => e.businessId === b.id),
    })),
  };
}
function stocktake(store, user, payload) {
  c.permit(user, "stocktake");
  const p = product(store, payload.skuId);
  if (p.stockManaged === false || inventoryDetails.tracked(p))
    throw new c.HttpError(400, "此入口适用于按数量管理的实物商品");
  const s = stock(store, p.skuId, payload.warehouseId || p.warehouseId || "wh-sale");
  const actual = c.number(payload.actual, "实盘数量");
  if (!Number.isSafeInteger(actual))
    throw new c.HttpError(400, "实盘数量必须为整数");
  if (s.quantity !== Number(payload.expected))
    throw new c.HttpError(409, "盘点期间库存有变化，请刷新后重新核对");
  const delta = actual - s.quantity;
  const result = {
    id: c.id("ST"),
    skuId: p.skuId,
    product: p.name,
    warehouseId: s.warehouseId || p.warehouseId || "wh-sale",
    warehouseName: s.warehouseName || "销售仓",
    expected: s.quantity,
    actual,
    delta,
    reason: c.text(payload.reason, "盘点说明"),
    createdAt: c.now(),
    operatorId: user.id,
  };
  s.quantity = actual;
  if (delta)
    s.costSources = actual ? [{ sourceId: "untraced", quantity: actual }] : [];
  s.stockValue = c.round(s.quantity * s.costPrice);
  store.stocktakes.unshift(result);
  move(
    store,
    user,
    p,
    s,
    delta,
    c.round(delta * s.costPrice),
    "盘点调整",
    result.id,
  );
  c.audit(store, user, "stock:count", `${p.name} ${delta}`);
  return result;
}
function expense(store, user, payload) {
  c.permit(user,"finance");
  const amount=paymentAccounts.cents(payload.amount)/100,parts=paymentAccounts.normalize(store,payload,amount,"现金");
  const row={id:c.id("EX"),type:c.text(payload.type,"费用类型"),amount,operatorId:user.id,operator:user.name,createdAt:c.now(),paymentParts:parts};
  store.expenses.push(row);paymentAccounts.record(store,user,"expense",row.id,parts,-1);c.audit(store,user,"expense:create",row.type);return row;
}
function finance(store, user) {
  c.permit(user, "finance");
  const supplierData = c.capabilities(user).supplierView
    ? suppliers.list(store, user)
    : { rows: [], totals: {} };
  return {
    receipts: store.receipts.slice().reverse(),
    expenses: store.expenses.slice().reverse(),
    suppliers: supplierData.rows,
    supplierTotals: supplierData.totals,
    otherIncome: store.otherIncome || [],
    purchases: [],
    payable: supplierData.totals.payable || 0,
  };
}
function paySupplier(store, user, payload) {
  return suppliers.payment(store, user, {
    ...payload,
    account: payload.account || "微信",
  });
}
function report(store, user, date = c.day()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new c.HttpError(400, "日期不正确");
  const caps = c.capabilities(user);
  const owned = (o) =>
    caps.allSales || (o.salespersonId || o.operatorId) === user.id;
  const sales = store.sales.filter(
    (o) => owned(o) && c.day(o.createdAt) === date,
  );
  const returns = store.saleReturns.filter(
    (o) => owned(o) && c.day(o.createdAt) === date,
  );
  const dayReceipts = store.receipts.filter(
    (r) =>
      (r.transactionDate || c.day(r.createdAt)) === date &&
      (caps.finance ||
        sales.some((o) => o.id === r.sourceId) ||
        returns.some((o) => o.id === r.sourceId)),
  );
  const salesAmount = c.round(sales.reduce((s, o) => s + o.amount, 0));
  const returnAmount = c.round(returns.reduce((s, o) => s + o.amount, 0));
  const dayGiftCost = c.round(store.sales.filter(owned)
    .flatMap((o) => o.giftOrders || [])
    .filter((gift) => c.day(gift.createdAt) === date)
    .reduce((sum, gift) => sum + Number(gift.cost || 0), 0));
  const grossProfit = c.round(
    sales.reduce((s, o) => s + o.profit, 0) -
      returns.reduce((s, o) => s + o.profit, 0) - dayGiftCost,
  );
  const sumReceipts = (kind) =>
    c.round(
      dayReceipts
        .filter((r) => r.kind === kind)
        .reduce((s, r) => s + r.amount, 0),
    );
  const expenseAmount = -sumReceipts("expense") - sumReceipts("expense_red");
  const visibleSaleIds = new Set(store.sales.filter(owned).map(o => o.id));
  const costAdjustmentProfit = -c.round(
    store.costAdjustments
      .filter((a) => a.orderId && visibleSaleIds.has(a.orderId) && c.day(a.createdAt) === date)
      .reduce((n, a) => n + a.costDelta, 0),
  );
  const categoryMap = new Map();
  for (const [source, sign] of [
    [sales, 1],
    [returns, -1],
  ])
    for (const order of source)
      for (const item of order.items) {
        const name = item.type || "其他";
        const row = categoryMap.get(name) || {
          category: name,
          quantity: 0,
          salesAmount: 0,
          grossProfit: 0,
        };
        row.quantity += sign * item.quantity;
        row.salesAmount = c.round(
          row.salesAmount +
            sign * (item.amount ?? item.quantity * item.salePrice),
        );
        row.grossProfit = caps.profit
          ? c.round(
              row.grossProfit +
                sign *
                  (item.profit ??
                    item.quantity * (item.salePrice - item.costPrice)),
            )
          : null;
        categoryMap.set(name, row);
      }
  if(caps.profit)for(const adjustment of store.costAdjustments.filter(a=>a.orderId&&visibleSaleIds.has(a.orderId)&&c.day(a.createdAt)===date)){
    const order=store.sales.find(o=>o.id===adjustment.orderId),item=order?.items.find(i=>i.id===adjustment.itemId);
    const name=item?.type||"其他";
    const row=categoryMap.get(name)||{category:name,quantity:0,salesAmount:0,grossProfit:0};
    row.grossProfit=c.round(row.grossProfit-Number(adjustment.costDelta||0));categoryMap.set(name,row);
  }
  const paymentMap = new Map();
  dayReceipts
    .filter((r) => ["sale", "refund"].includes(r.kind))
    .forEach((r) =>
      paymentMap.set(
        r.account,
        c.round((paymentMap.get(r.account) || 0) + r.amount),
      ),
    );
  const staffStats = store.users
    .filter((u) => caps.allSales || u.id === user.id)
    .map((u) => {
      const ownedSales = sales.filter(
        (o) => (o.salespersonId || o.operatorId) === u.id,
      );
      const ownedReturns = returns.filter((o) => o.salespersonId === u.id);
      return {
        id: u.id,
        name: u.name,
        orderCount: ownedSales.length,
        salesAmount: c.round(
          ownedSales.reduce((s, o) => s + o.amount, 0) -
            ownedReturns.reduce((s, o) => s + o.amount, 0),
        ),
      };
    });
  return {
    date,
    canViewProfit: caps.profit,
    summary: {
      salesAmount,
      returnAmount,
      netSales: c.round(salesAmount - returnAmount),
      grossProfit: caps.profit ? grossProfit : null,
      giftCost: caps.profit ? dayGiftCost : null,
      costAdjustmentProfit: caps.profit ? costAdjustmentProfit : null,
      adjustedGrossProfit: caps.profit
        ? c.round(grossProfit + costAdjustmentProfit)
        : null,
      supplierPaid: caps.supplierView
        ? -sumReceipts("supplier_payment") - sumReceipts("purchase")
        : null,
      supplierRefund: caps.supplierView ? sumReceipts("supplier_refund") : null,
      purchaseReturnDifference: caps.profit
        ? c.round(
            store.purchaseReturns
              .filter((r) => c.day(r.createdAt) === date)
              .reduce((n, r) => n + (r.amount - r.cost || 0), 0),
          )
        : null,
      receivedAmount: sumReceipts("sale"),
      refundAmount: -sumReceipts("refund"),
      otherIncome: caps.finance ? c.round(sumReceipts("other_income") + sumReceipts("other_income_red")) : null,
      expenseAmount,
      carrierReceived: c.round(
        sumReceipts("carrier") + sumReceipts("carrier_clawback") + sumReceipts("carrier_rental"),
      ),
      orderCount: sales.length,
    },
    categoryStats: Array.from(categoryMap.values()),
    paymentStats: Array.from(paymentMap, ([paymentMethod, amount]) => ({
      paymentMethod,
      amount,
    })),
    staffStats,
    recentOrders: sales.slice(0, 12).map((o) => visibleOrder(o, user)),
    expenses: caps.finance
      ? store.expenses.filter((e) => c.day(e.createdAt) === date)
      : [],
  };
}
function openingLocked(store) {
  return [
    "sales",
    "purchases",
    "saleReturns",
    "purchaseReturns",
    "stocktakes",
    "payrollStatements",
    "cardEvents",
    "carrierServices",
    "govSubsidyClaims",
    "receipts",
    "expenses",
    "procurementPlans",
  ].some((key) => store[key].length > 0);
}
function openingRows(rows) {
  if (!Array.isArray(rows) || !rows.length)
    throw new c.HttpError(400, "期初建账明细不能为空");
  return rows.map((row, index) => {
    const label = "第" + (index + 2) + "行";
    const quantity = c.number(
      row.quantity ?? row["期初数量"],
      label + "期初数量",
    );
    if (!Number.isSafeInteger(quantity))
      throw new c.HttpError(400, label + "期初数量必须为整数");
    const costPrice = c.number(
      row.costPrice ?? row["成本均价"],
      label + "成本均价",
    );
    const salePrice = c.money(
      row.salePrice ?? row["预设售价"] ?? 0,
      label + "预设售价",
    );
    const resolvedWarehouse = warehouses.resolveName(row.warehouseName || row["仓库"],{name:row.name||row["商品名称"],type:row.type||row["一级分类"],subType:row.subType||row["二级分类"],thirdType:row.thirdType||row["三级分类"]});
    const warehouseName = resolvedWarehouse.name;
    if (warehouseName === "服务项目" && quantity !== 0)
      throw new c.HttpError(400, label + "服务商品不能有期初库存数量");
    return { ...row, quantity, costPrice, salePrice, warehouseName };
  });
}
function openingPreview(store, user, rows) {
  c.permit(user, "opening");
  const copy = JSON.parse(JSON.stringify(store));
  if (openingLocked(store))
    throw new c.HttpError(
      409,
      "已有业务单据，不能重新期初建账；请使用商品维护或盘点",
    );
  const result = legacy.importOpeningBalance(copy, {
    rows: openingRows(rows),
    operatorId: user.id,
    source: "preview",
  });
  if (
    copy.products.some(
      (p) =>
        p.trackSerial &&
        copy.inventory.some((s) => s.skuId === p.skuId && s.quantity > 0),
    )
  )
    throw new c.HttpError(
      400,
      "期初表不含串码明细，请先按数量导入，串码商品通过入库逐件登记",
    );
  if (
    copy.inventory.some(
      (s) =>
        !Number.isSafeInteger(s.quantity) ||
        !Number.isFinite(s.costPrice) ||
        !Number.isFinite(s.stockValue),
    )
  )
    throw new c.HttpError(400, "库存数量或成本格式不正确");
  return {
    ...result,
    rows: copy.products.map((p) => ({
      ...p,
      quantity: copy.inventory.find((s) => s.skuId === p.skuId)?.quantity || 0,
    })),
    totalQuantity: copy.inventory.reduce((n, s) => n + s.quantity, 0),
    stockValue: c.round(copy.inventory.reduce((n, s) => n + s.stockValue, 0)),
    replacedProducts: store.products.length,
    replacedRules: store.commissionRules.length,
  };
}
function openingCommit(store, user, payload) {
  openingPreview(store, user, payload.rows);
  if (!payload.confirmed) throw new c.HttpError(400, "请先核对导入预览");
  const result = legacy.importOpeningBalance(store, {
    rows: openingRows(payload.rows),
    operatorId: user.id,
    source: payload.source || "excel",
  });
  store.commissionRules = [];
  return result;
}
module.exports = {
  visibleProduct,
  listProducts,
  inventory,
  saveProduct,
  purchase,
  sale,
  orders,
  returnSale,
  cards,
  cardEvent,
  stocktake,
  expense,
  finance,
  paySupplier,
  report,
  openingPreview,
  openingLocked,
  openingCommit,
  visibleOrder,
  giftRules,
  saveGiftRules,
  supplementGift,
  quoteSaleGift,
  giftApprovals,
  reviewGiftApproval,
};





