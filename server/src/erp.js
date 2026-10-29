const fifo=require("./fifo-costs");
const c = require("./common");
const pay = require("./payroll");
const legacy = require("./services");
const suppliers = require("./suppliers");
const supplierCosts = require("./supplier-costs");
const vocabulary = require("./search-vocabulary");
const govSubsidy = require("./gov-subsidy");
const salePayments = require("./sale-payments");
const paymentAccounts = require("./payment-accounts");
const businessPurpose=require("./business-purpose");
const warehouses = require("./warehouses");
const inventoryDetails = require("./inventory-details");
const stockSourceChoice = require("./stock-source-choice");
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
  result.name = warehouses.displayName(result.name,result.warehouseId);
  if (!c.capabilities(user).cost) {
    delete result.costPrice;
    delete result.referenceCostPrice;
  }
  return result;
}
function listProducts(store, user, {catalog=false}={}) {
  const caps = c.capabilities(user),supplierNames=new Map();
  if(!catalog){
    for(const doc of store.purchases||[])for(const item of doc.items||[]){if(!supplierNames.has(item.skuId))supplierNames.set(item.skuId,new Set());if(doc.supplier)supplierNames.get(item.skuId).add(doc.supplier);}
    for(const batch of store.openingImportBatches||[])for(const item of batch.products||[]){if(!supplierNames.has(item.skuId))supplierNames.set(item.skuId,new Set());const supplier=(store.suppliers||[]).find(s=>s.id===item.supplierId);if(supplier?.name||item.supplier)supplierNames.get(item.skuId).add(supplier?.name||item.supplier);}
  }

  return store.products.map((p) => {
    const result = {
      ...p,
      name: catalog?p.name:warehouses.displayName(p.name,p.warehouseId),
      ...(!catalog?{supplierNames:[...(supplierNames.get(p.skuId)||[])]}:{}),
      trackSerial: inventoryDetails.tracked(p),
      qrCode: qrProducts.eligible(p) ? qrProducts.encode(p) : null,
      categoryText: [p.type, p.subType, p.thirdType]
        .filter(Boolean)
        .join(" / "),
    };
    for(const key of ["quantity","serials","stockValue","stockSources","inStockSerialCount","serialCount"])delete result[key];
    if(catalog){
      for(const key of ["supplier","supplierId","supplierName","supplierNames","purchaseId","purchaseDate","warehouseName"])delete result[key];
      const origin=p.importSource||{};
      if(p.importSource)result.importSource={priceNeedsConfirmation:origin.priceNeedsConfirmation===true,unitNeedsConfirmation:origin.unitNeedsConfirmation===true,unitSource:origin.unitSource||''};
    }
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
      name: warehouses.displayName(p.name,s.warehouseId||p.warehouseId),
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
// Read the current stock snapshot for sale picking and inventory lookup.
// Provenance is resolved only by the dedicated serial/source detail routes.
function currentInventory(store, user) {
  const canViewCost = c.capabilities(user).cost;
  const products = new Map((store.products || []).map((p) => [p.skuId, p]));
  const result = [];
  for (const row of store.inventory || []) {
    const p = products.get(row.skuId);
    if (!p) continue;
    const serials = (row.serials || []).map((serial) => {
      const copy = { ...serial, inStock: ["可售", "未激活"].includes(serial.status) };
      if (!canViewCost) delete copy.costPrice;
      return copy;
    });
    const count = serials.filter((serial) => serial.inStock).length;
    const tracked = inventoryDetails.tracked(p);
    const stock = {
      ...p,
      ...row,
      name: warehouses.displayName(p.name, row.warehouseId || p.warehouseId),
      stockKey: `${p.skuId}-${row.warehouseId || "wh-sale"}`,
      warehouseId: row.warehouseId || "wh-sale",
      warehouseName: row.warehouseName || "销售仓",
      costPrice: row.costPrice ?? p.costPrice,
      serials,
      stockSources: [],
      serialRequired: tracked,
      trackSerial: tracked,
      serialBoundCount: count,
      serialDifference: tracked ? Number(row.quantity || 0) - count : 0,
    };
    delete stock.costSources;
    if (!canViewCost) {
      delete stock.costPrice;
      delete stock.stockValue;
      delete stock.referenceCostPrice;
    }
    result.push(stock);
  }
  for (const p of store.products || []) {
    if (p.stockManaged !== false) continue;
    const service = {
      ...p, quantity: null, serials: [], stockKey: `${p.skuId}-service`,
      warehouseId: "", warehouseName: "服务项目", stockSources: [],
    };
    if (!canViewCost) {
      delete service.costPrice;
      delete service.referenceCostPrice;
    }
    result.push(service);
  }
  return result;
}
function mobileVariant(store, payload) {
  const sourceId = String(payload.sourceSkuId || "").trim();
  if (!sourceId) return null;
  if (payload.skuId) throw new c.HttpError(400, "编辑原商品不能同时新建C仓同款；请使用新建C仓同款入口");
  if (payload.warehouseId !== "wh-c" || payload.kind === "service" || payload.type === "其他收入")
    throw new c.HttpError(400, "新建C仓同款必须选择C仓实物商品");
  c.text(payload.name, "商品名称");c.text(payload.type, "分类");c.money(payload.salePrice, "预设售价");
  const source = product(store, sourceId);
  if (source.stockManaged === false || source.warehouseId === "wh-c" || source.active === false)
    throw new c.HttpError(400, "请选择在用的非C仓实物商品建立C仓同款");
  if (warehouses.baseName(source.name) !== warehouses.baseName(payload.name))
    throw new c.HttpError(409, "C仓同款应沿用原商品型号；不同商品请分别新建");
  const suffix = require("node:crypto").createHash("sha256").update(source.skuId).digest("hex").slice(0,24);
  const externalCode = "WH-C-" + suffix;
  // Existing IDs and legacy codes remain valid; only newly generated codes use the warehouse code.
  const versions = store.products.filter(row => row.warehouseId === "wh-c" &&
    (row.mobileVariantOf === source.skuId || row.warehouseVariantOf === source.skuId ||
     row.externalCode === externalCode || row.externalCode === "YD-" + suffix ||
     (!row.mobileVariantOf && !row.warehouseVariantOf && warehouses.baseName(row.name) === warehouses.baseName(source.name))));
  if (versions.length > 1) throw new c.HttpError(409, "同款已有多个C仓档案，请管理员核对后再使用");
  if (versions.length) {
    const previous = versions[0],parent = previous.mobileVariantOf || previous.warehouseVariantOf;
    if ((parent && parent !== source.skuId) || previous.active === false || previous.stockManaged === false ||
        inventoryDetails.tracked(previous) !== inventoryDetails.tracked(source) ||
        warehouses.baseName(previous.name) !== warehouses.baseName(source.name) ||
        (previous.unit && source.unit && previous.unit !== source.unit))
      throw new c.HttpError(409, "该型号C仓档案需管理员核对，请勿重复建档");
    return { reused: previous };
  }
  if (store.products.some(row => row.externalCode === externalCode)) throw new c.HttpError(409, "自动商品编号发生冲突，请管理员核对");
  return { source, externalCode };
}
function saveProduct(store, user, payload, options={}) {
  if(payload?.action==="setActive")return require("./product-status").change(store,user,payload);
  c.permit(user, payload.skuId ? "manageProducts" : "catalogAdd");
  if(!payload.skuId&&payload.sourceSkuId)throw new c.HttpError(409,"同一商品可在多个仓库入库，无需新建仓库商品档案");
  const existing = payload.skuId ? product(store, payload.skuId) : null;
  if(existing){
    // An archive entry is permanent. Direct editing may rename it, while
    // price and status changes continue through their audited workflows.
    const changed=(key,value)=>Object.prototype.hasOwnProperty.call(payload,key)&&JSON.stringify(payload[key])!==JSON.stringify(value);
    const immutable={
      externalCode:existing.externalCode,shortName:existing.shortName||"",aliases:existing.aliases||[],
      type:existing.type,subType:existing.subType||"",thirdType:existing.thirdType||"",unit:existing.unit,
      kind:existing.stockManaged===false?"service":"physical",stockManaged:existing.stockManaged!==false,
      trackSerial:inventoryDetails.tracked(existing),warehouseId:existing.warehouseId,
      salePrice:Number(existing.salePrice||0),active:existing.active!==false,
    };
    const forbidden=Object.keys(payload).some(key=>{
      if(key==="skuId"||key==="name")return false;
      if(key==="kind"&&payload.kind==="stock"&&immutable.kind==="physical")return false;
      return !Object.prototype.hasOwnProperty.call(immutable,key)||changed(key,immutable[key]);
    });
    if(forbidden)
      throw new c.HttpError(409,"已建档商品只能直接修改名称；调价、停用或恢复请使用独立流程，档案不能删除");
    const requestedName=warehouses.baseName(c.text(payload.name,"商品名称"));
    if(requestedName!==existing.name){
      const oldName=existing.name;
      existing.name=requestedName;
      c.audit(store,user,"product:rename",`商品 ${existing.externalCode} 改名：${oldName} → ${requestedName}`);
    }
    return visibleProduct(existing,user);
  }
  const mobile = mobileVariant(store, payload);
  if (mobile?.reused) return { ...visibleProduct(mobile.reused, user), message: "该型号C仓商品已建档，已选用现有商品；库存没有重复增加。" };
  if (mobile?.source) payload = { ...payload, externalCode: mobile.externalCode, trackSerial: inventoryDetails.tracked(mobile.source) };
  if(existing&&(payload.active!==false)!==(existing.active!==false))throw new c.HttpError(409,"请使用商品停用或恢复入口修改状态");
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
  if(existing&&payload.externalCode&&payload.externalCode!==existing.externalCode)throw new c.HttpError(409,"商品编码已固定，请刷新后编辑；改名不改变编码");
  if(!existing&&!options.internal&&payload.externalCode)throw new c.HttpError(400,"商品编码由系统在确认提交时生成，请不要手填");
  const requestedWarehouse=existing?.warehouseId||options.initialWarehouseId||""; // Legacy location is kept for old documents, never selected by the public product editor.
  // Declared catalogue owns new/changed classifications; changes remain in the original transaction.
  const nextType=payload.type==="智能手机"?"智能机":payload.type==="功能手机"?"功能机":payload.type==="二手机"?"二手手机":payload.type==="其他数码"?"数码产品":payload.type;
  const nextPath=[nextType,String(payload.subType||"").trim(),String(payload.thirdType===undefined?existing?.thirdType||"":payload.thirdType||"").trim()];
  const previousPath=existing?[existing.type,existing.subType||"",existing.thirdType||""]:[];
  if((store.productCategoryCatalog?.paths||[]).length&&(!existing||JSON.stringify(previousPath)!==JSON.stringify(nextPath))){
    const cat=require("./product-categories"),declared=()=>store.productCategoryCatalog.paths,same=(a,b)=>a.length===b.length&&a.every((v,i)=>String(v).normalize("NFKC").toLowerCase()===String(b[i]).normalize("NFKC").toLowerCase());
    for(let level=0;level<3;level++){
      if(!nextPath[level]){if(nextPath.slice(level+1).some(Boolean))throw new c.HttpError(400,"请先选择上一级分类");if(declared().some(r=>r.path.length>level&&same(r.path.slice(0,level),nextPath.slice(0,level))))throw new c.HttpError(400,"请选择"+["一级","二级","三级"][level]+"分类");break;}
      const prefix=nextPath.slice(0,level+1);
      if(!declared().some(r=>same(r.path,prefix))&&![...cat.allPaths(store).values()].some(path=>same(path,prefix))){if(user.roleCode!=='owner')throw new c.HttpError(409,'请选择已建档商品分类；新增分类按原资料管理流程办理');cat.add(store,user,{parentPath:prefix.slice(0,-1),name:prefix.at(-1)});}
    }
  }
  const requestedName=warehouses.baseName(c.text(payload.name,"商品名称"));
  const requestedType=c.text(payload.type,"分类"),requestedUnit=c.text(payload.unit,"计量单位");
  if(requestedUnit.length>10)throw new c.HttpError(400,"计量单位不能超过10字");
  const priceSupplied=payload.salePrice!==undefined&&payload.salePrice!==null&&String(payload.salePrice).trim()!=='';
  const requestedPrice=priceSupplied?c.money(payload.salePrice,"预设售价"):Number(existing?.salePrice||0);
  const pricePending=existing?existing.pricePending===true:!priceSupplied;
  if (existing && requestedPrice !== Number(existing.salePrice))
    throw new c.HttpError(409, "已有商品改零售价请使用调价单，由老板审核后生效");
  const externalCode = existing?.externalCode||(options.internal&&payload.externalCode?c.text(payload.externalCode,"商品编码"):require("./product-codes").next(store));
  if(store.products.some(p=>p.externalCode===externalCode&&p!==existing))throw new c.HttpError(409,"商品编号已存在");
  const result = {
    ...(existing || {}),
    skuId: existing ? existing.skuId : c.id("SKU"),
    externalCode,
    ...(mobile?.source ? { mobileVariantOf: mobile.source.skuId, mobileVariantSourceCode: mobile.source.externalCode } : {}),
    name: requestedName,
    shortName: String(payload.shortName || "").trim(),
    aliases: payload.aliases === undefined ? (existing?.aliases || []) : vocabulary.words(payload.aliases),
    type: ((type)=>type==="智能手机"?"智能机":type==="二手机"?"二手手机":type==="其他数码"?"数码产品":/^(配件和维修|配件\s*[/／]\s*维修)$/.test(type)?(stockManaged?"配件":"维修"):type)(requestedType),
    subType: payload.subType || "",
    thirdType: payload.thirdType === undefined ? (existing?.thirdType || "") : String(payload.thirdType || "").trim(),
    unit: requestedUnit,
    stockManaged,
    trackSerial,
    ...(requestedWarehouse?{warehouseId:requestedWarehouse}:{}),
    salePrice: requestedPrice,
    pricePending,
    costPrice: existing?.costPrice || 0,
    active: payload.active !== false,
  };
  if (existing) Object.assign(existing, result);
  else store.products.push(result);
  if (existing&&requestedWarehouse === "wh-c") {
    const originalName=warehouses.baseName(payload.name);
    result.aliases=[...new Set([...(result.aliases||[]),originalName,...(mobile?.source ? [mobile.source.name,mobile.source.externalCode,mobile.source.barcode,mobile.source.importSource?.fields?.["条码"]] : [])].filter(Boolean))];
    if(existing)existing.aliases=result.aliases;
  }
  // Product creation has no stock location. The first receipt chooses its actual warehouse.
  if(!existing&&options.initialWarehouseId&&stockManaged&&!store.inventory.some(s=>s.skuId===result.skuId)){
    const warehouse=warehouses.byId(options.initialWarehouseId);
    if(!warehouse||warehouse.active===false)throw new c.HttpError(400,"初始库存仓库不可用");
    store.inventory.push({skuId:result.skuId,warehouseId:warehouse.id,warehouseName:warehouse.name,quantity:0,costPrice:0,stockValue:0,serials:[]});
  }
  const currentCategory=[result.type,result.subType,result.thirdType].filter(Boolean).join(" / ");
  c.audit(store, user, "product:save", `保存商品 ${result.name}`+(existing&&previousCategory!==currentCategory?`；分类：${previousCategory} → ${currentCategory}`:""));
  if (!existing) require("./catalog-reviews").recordAddition(store, user, { kind: "product", sourceId: result.skuId, name: result.name });
  return {...visibleProduct(result, user),...(!existing?{nextCodePreview:require('./product-codes').peek(store),message:'商品已建档，编码 '+externalCode+'；下一个预计编码 '+require('./product-codes').peek(store)}:{})};
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
    if(p.active===false)throw new c.HttpError(409,"该商品已停用，请先恢复再入库");
    if (p.stockManaged === false)
      throw new c.HttpError(400, "服务商品不采购入库");
    // Incoming goods may be the first stock row for this product. Outgoing stock stays strict.
    // Older integrations still submit legacy products without a warehouse. New products have
    // no fallback and every interactive receipt selects the actual warehouse explicitly.
    const warehouseId=c.text(input.warehouseId||p.warehouseId,'本次入库仓库'),warehouse=warehouses.byId(warehouseId);
    if(!warehouse||warehouse.active===false)throw new c.HttpError(409,'请选择在用的入库仓库');
    const matching=store.inventory.filter(row=>row.skuId===p.skuId&&(row.warehouseId||'wh-sale')===warehouseId);
    if(matching.length>1)throw new c.HttpError(409,'该商品仓库库存记录重复，请先核对');
    if(!matching.length)store.inventory.push({skuId:p.skuId,warehouseId,warehouseName:warehouse.name,quantity:0,costPrice:0,stockValue:0,serials:[]});
    const s = stock(store, p.skuId, warehouseId);
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
    if (!inventoryDetails.tracked(p)) supplierCosts.receive(s, itemId, qty, costPrice, store);
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
      warehouseName: s.warehouseName || warehouse.name,
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
function deduct(store, user, p, input, orderId, type) { const locationId=input.warehouseId||p.warehouseId;if(locationId&&(!warehouses.byId(locationId)||warehouses.byId(locationId).active===false))throw new c.HttpError(400,"请选择在用的出库仓库");const s=stock(store,p.skuId,locationId);
  const qty = c.quantity(input.quantity);
  if (s.quantity < qty) throw new c.HttpError(409, `${p.name} 库存不足`);
  const chosen=stockSourceChoice.choose(store,p.skuId,s.warehouseId||'wh-sale',input.supplierId,input.serialNo);
  if(chosen.quantity<qty)throw new c.HttpError(409,`${p.name} 在所选仓库和供货商下库存不足`);
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
    if(fifo.enabled(s))costSources=fifo.take(s,qty,sourceId=>chosen.sourceIds.has(sourceId));
    else if((s.costSources||[]).every(row=>chosen.sourceIds.has(row.sourceId)))costSources=supplierCosts.take(s,qty);
    else throw new c.HttpError(409,'该商品混合供货来源缺少逐批成本资料，请先核对库存来源');
  }
    const cost = !inventoryDetails.tracked(p)&&fifo.enabled(s)?fifo.total(costSources):qty === s.quantity ? s.stockValue : c.round(costPrice * qty);
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
    supplierId:chosen.id,
    supplier:chosen.name,
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
    const warehouseId = typeof input.warehouseId === "string" ? input.warehouseId.trim() : "";
    if (!warehouseId) throw new c.HttpError(400, "请选择赠品实际出库仓库");
    const warehouse = warehouses.byId(warehouseId);
    if (!warehouse || warehouse.active === false) throw new c.HttpError(400, "请选择有效的赠品出库仓库");
    const matching = store.inventory.filter((s) => s.skuId === p.skuId && (s.warehouseId || "wh-sale") === warehouseId);
    if (matching.length !== 1) throw new c.HttpError(409, "该仓赠品库存记录缺失或重复，请重新核对");
    const taken = deduct(store, user, p, {...input, warehouseId}, record.id, "赠品出库");
    if (!approved && c.round(taken.cost / taken.quantity) > rules.maxUnitCost)
      (record.policyWarnings||=[]).push(p.name+" 单件实际成本超过赠品上限，已出库待老板事后核对");
    record.items.push({
      skuId: p.skuId, name: p.name, quantity: taken.quantity,
      serialNo: taken.serialNo, cost: taken.cost,
      warehouseId: taken.warehouseId, warehouseName: warehouse.name || taken.warehouseName,
      unitCost: c.round(taken.cost / taken.quantity),
      costSources: taken.costSources,
    });
  }
  record.cost = c.round(record.items.reduce((sum, item) => sum + item.cost, 0));
  const previous = Number(order.giftCost || 0);
  if (!approved && c.round(previous + record.cost) > cap)
    (record.policyWarnings||=[]).push("本单赠品累计成本超过赠送前毛利的 "+rules.maxProfitPercent+"%，已出库待老板事后核对");
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
  return { cost: gift.cost, items: gift.items.map(({skuId,name,quantity,serialNo,cost,unitCost,warehouseId,warehouseName}) =>
    ({skuId,name,quantity,serialNo,cost,unitCost,warehouseId,warehouseName})), cap, previousCost: Number(order.giftCost || 0),
    reasons, approvalRequired:false,reviewRequired:Boolean(reasons.length),policy:"normal_business_then_owner_reconciliation_v120" };
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
    require("./receptions").adjustReceptionBonus(store, order);
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
  require("./receptions").adjustReceptionBonus(store, order);
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
  if (payload.receptionId) require('./reception-availability').assertEnabled();
  if (payload.receptionId) {
    const reception = (store.receptions || []).find((row) => row.id === payload.receptionId);
    if (!reception) throw new c.HttpError(404, "关联接待单不存在");
    const linkedCustomer = (store.customers || []).find((row) => row.id === reception.customerId);
    if (linkedCustomer?.phone && customerPhone && customerPhone !== linkedCustomer.phone)
      throw new c.HttpError(409, "顾客手机号与接待单不一致，请核对后再开单");
    if (linkedCustomer?.phone) customerPhone = linkedCustomer.phone;
    if (!customerName) customerName = linkedCustomer?.name || reception.visitorName || "";
  }
  if (customerName.length > 40) throw new c.HttpError(400, "顾客姓名不能超过40字");
  if (customerPhone && !/^1[3-9]\d{9}$/.test(customerPhone))
    throw new c.HttpError(400, "顾客手机号须为11位；不提供时请留空");
  if (!Array.isArray(payload.items) || !payload.items.length)
    throw new c.HttpError(400, "请选择销售商品");
  require("./sale-payment-parts").explicitSelection(payload);
  const subsidy = govSubsidy.prepare(store, payload);
  const account = String(payload.account || payload.paymentMethod || "");
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
    let supplierId = "", supplier = "";
    if (p.stockManaged !== false) {
      const taken = deduct(store, user, p, input, order.id, "销售出库");
      cost = taken.cost;
      serialNo = taken.serialNo;
      costSources = taken.costSources;
      supplierId=taken.supplierId;supplier=taken.supplier;
    } else {
      materials = (input.materials || []).map((m) => {
        const material = product(store, m.skuId);
        if(material.active===false)throw new c.HttpError(409,"该耗材已停用，请先恢复");
        if (material.stockManaged === false)
          throw new c.HttpError(400, "耗材必须是实物商品");
        const usage=m.usage==null?'repair':m.usage;
        if(!['repair','gift'].includes(usage)||usage==='gift'&&p.type!=='维修')throw new c.HttpError(400,'维修材料用途不正确');
        return {...deduct(store, user, material, m, order.id, usage==='gift'?'维修赠品':'维修耗材'),usage};
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
      sourceBarcode: String(p.sourceBarcode || p.barcode || ""),
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
      ...(p.stockManaged!==false?{supplierId,supplier}:{}),
      ...(p.stockManaged!==false?{supplySources:[{supplierId,supplier,quantity:qty}]}:{}),
      warehouseId: p.stockManaged !== false ? (input.warehouseId || p.warehouseId || "wh-sale") : "",
      warehouseName: p.stockManaged !== false ? (stock(store,p.skuId,input.warehouseId||p.warehouseId).warehouseName || "销售仓") : "服务项目",
      note: input.note || "",
    };
  });
  order.amount = c.round(order.items.reduce((s, i) => s + i.amount, 0));
  order.profit = c.round(order.items.reduce((s, i) => s + i.profit, 0));
  const repairGifts=order.items.filter(item=>item.type==='维修'&&item.stockManaged===false).flatMap(item=>(item.materials||[]).filter(material=>material.usage==='gift'));
  if(repairGifts.length){
    const rules=giftRules(store),giftCost=c.round(repairGifts.reduce((sum,material)=>sum+material.cost,0));
    order.repairGiftMaterialCost=giftCost;
    order.repairGiftPolicyWarnings=[];
    if(repairGifts.some(material=>c.round(material.cost/material.quantity)>rules.maxUnitCost))order.repairGiftPolicyWarnings.push('有维修赠品的单件实际成本超过赠品上限，请老板核对');
    if(giftCost>c.round(Math.max(0,order.profit+giftCost)*rules.maxProfitPercent/100))order.repairGiftPolicyWarnings.push('维修赠品成本超过本单赠送前毛利比例上限，请老板核对');
  }
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
  if (payload.receptionId) { const kind=order.repairContext?.kind==='repair'||(order.items||[]).some(item=>item.type==='维修'&&item.stockManaged===false)?'维修服务单':'销售单';require("./receptions").link(store, user, {receptionId:payload.receptionId,direct:true}, kind, order); order.receptionId = payload.receptionId; }
  c.audit(store, user, "sale:create", order.id);
  return visibleOrder(order, user);
}
function visibleOrder(order, user) {
  const result = JSON.parse(JSON.stringify(order));
  result.giftCost = c.round(result.giftCost || 0);
  result.netProfit = c.round(Number(result.profit || 0) - result.giftCost);
  if (!c.capabilities(user).profit) {
    delete result.netProfit;
    delete result.repairGiftMaterialCost;
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
    const returnedLayers=fifo.layered(item.costSources)?fifo.slice(item.costSources,previouslyReturned,qty):null;
    const cost = returnedLayers?fifo.total(returnedLayers):item.stockManaged
      ? c.round(
          c.round((item.cost * totalReturned) / item.quantity) -
            c.round((item.cost * previouslyReturned) / item.quantity),
        )
      : 0;
    if (item.stockManaged) {
      const p = product(store, item.skuId);
      const originalStock=stock(store,item.skuId,item.warehouseId||p.warehouseId||"wh-sale");
      const returnWarehouseId=options.returnWarehouseId||originalStock.warehouseId||"wh-sale",returnWarehouse=require('./warehouses').byId(returnWarehouseId);
      if(!returnWarehouse||returnWarehouse.active===false)throw new c.HttpError(400,"退回仓库不存在或已停用");
      let s=store.inventory.find(x=>x.skuId===item.skuId&&(x.warehouseId||"wh-sale")===returnWarehouseId);
      if(!s){s={skuId:item.skuId,warehouseId:returnWarehouseId,warehouseName:returnWarehouse.name,quantity:0,stockValue:0,costPrice:0,serials:[]};store.inventory.push(s);}
      s.serials||=[];
      if(item.serialNo){const all=store.inventory.flatMap(x=>(x.serials||[]).filter(v=>v.no===item.serialNo));if(all.length!==1||!(originalStock.serials||[]).some(v=>v.no===item.serialNo&&v.status==="已售"))throw new c.HttpError(409,"退回串号不是原单唯一已售串号");}
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
        supplierCosts.restore(s, fifo.returnLayers(store,order,item,previouslyReturned,qty)||item.costSources, returnedLayers?1:qty/item.quantity, qty, cost+costDelta);
      s.quantity += qty;
      s.stockValue = c.round(previousValue + cost + costDelta);
      s.costPrice = Number((s.stockValue / s.quantity).toFixed(6));
      if (item.serialNo) {
        if(s!==originalStock){const serial=originalStock.serials.find(x=>x.no===item.serialNo);originalStock.serials=originalStock.serials.filter(x=>x.no!==item.serialNo);s.serials.push(serial);}
        const serial = s.serials.find((x) => x.no === item.serialNo);
        if (!serial || serial.status !== "已售")
          throw new c.HttpError(409, "串码状态与退货不一致");
        serial.status = "可售";
      }
      move(store, user, p, s, qty, cost + costDelta, "销售退货", row.id);
    }
    pay.reverse(store, order, item, qty, totalReturned, row.id, row.createdAt, returnedLayers?c.round(item.salePrice*totalReturned-fifo.total(fifo.slice(item.costSources,0,totalReturned))):undefined);
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
  row.originalAmount=row.amount;
  if(options.customerReturnAmount!=null){
    const actual=require('./payment-accounts').cents(options.customerReturnAmount,'实际退款或退货作价')/100;
    if(actual>row.originalAmount)throw new c.HttpError(400,'实际退款不能超过原单退回商品金额');
    let assigned=0;const total=Math.round(actual*100),face=Math.round(row.originalAmount*100);
    row.items.forEach((i,index)=>{i.originalAmount=i.amount;const n=index===row.items.length-1?total-assigned:face?Math.floor(total*Math.round(i.originalAmount*100)/face):0;assigned+=n;i.amount=n/100;i.profit=c.round(i.amount-i.cost);});
    row.amount=actual;row.retainedAmount=c.round(row.originalAmount-actual);
  }
  row.profit = c.round(row.items.reduce((s, i) => s + i.profit, 0));
  row.returnWarehouseId=options.returnWarehouseId||'';row.documentType='退货入库单';
  store.saleReturns.unshift(row);
  require("./receptions").reverseCommission(store, user, order);
  require("./receptions").adjustReceptionBonus(store, order);
  govSubsidy.recordReturn(store, user, row, subsidyReturn);
  order.status = order.items.every((i) => i.returnedQuantity === i.quantity)
    ? "returned"
    : "partial_return";
  const refundAmount=options.refundAmount ?? c.round((row.customerRefund ?? row.amount)-(options.paymentCredit||0));
  if (order.paymentParts) {
    row.refundParts=options.validatedRefundParts??paymentAccounts.refundParts(store,order,refundAmount,payload.refundPayments);
    row.originalOrderId=order.id;
    paymentAccounts.recordRefund(store,user,row.id,row.refundParts);
  } else {
    // Legacy orders may omit paymentParts, but refunds still follow their actual
    // receipt records. An order's old owner/channel is not refund evidence.
    row.refundParts=options.validatedRefundParts??paymentAccounts.refundParts(store,order,refundAmount,payload.refundPayments);
    row.originalOrderId=order.id;
    paymentAccounts.recordRefund(store,user,row.id,row.refundParts);
  }
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
  const bookSnapshot={quantity:s.quantity,stockValue:s.stockValue,costPrice:s.costPrice,costSources:structuredClone(s.costSources||[]),serials:structuredClone(s.serials||[])};
  const result = {
    id: c.id("ST"),
    skuId: p.skuId,
    product: p.name,
    warehouseId: s.warehouseId || p.warehouseId || "wh-sale",
    warehouseName: s.warehouseName || "销售仓",
    expected: s.quantity,
    bookSnapshot,
    actual,
    delta,
    reason: c.text(payload.reason, "盘点说明"),
    createdAt: c.now(),
    operatorId: user.id,
  };
  const fifoDelta=fifo.count(store,s,actual,result.id);
  if(fifoDelta!==null){s.quantity=actual;s.stockValue=c.round(s.stockValue+fifoDelta);s.costPrice=actual?Number((s.stockValue/actual).toFixed(6)):0;}else{
  s.quantity = actual;
  if (delta)
    s.costSources = actual ? [{ sourceId: "untraced", quantity: actual }] : [];
  s.stockValue = c.round(s.quantity * s.costPrice);
  }
  result.bookSnapshot.missingCostValue=delta<0?c.round(bookSnapshot.stockValue-s.stockValue):0;
  store.stocktakes.unshift(result);
  move(
    store,
    user,
    p,
    s,
    delta,
    fifoDelta===null?c.round(delta * s.costPrice):fifoDelta,
    "盘点调整",
    result.id,
  );
  c.audit(store, user, "stock:count", `${p.name} ${delta}`);
  return result;
}
function expense(store, user, payload, options = {}) {
  user=require('./master-data').actor(store,user);
  c.permit(user,options.normalRegistration===true?'paymentRegister':"finance");
  const amount=paymentAccounts.cents(payload.amount)/100,parts=options.normalRegistration===true&&options.validatedPaymentParts?options.validatedPaymentParts:paymentAccounts.normalize(store,payload,amount,"现金");
  const purpose=businessPurpose.normalizePurpose(payload.businessPurpose);businessPurpose.validateParts(store,purpose,"pay",parts);
  const row={id:c.id("EX"),type:c.text(payload.type,"费用类型"),amount,operatorId:user.id,operator:user.name,createdAt:c.now(),paymentParts:parts};
  store.expenses.push(row);paymentAccounts.record(store,user,"expense",row.id,parts,-1);businessPurpose.classify(store,row,purpose);c.audit(store,user,"expense:create",row.type);return row;
}
function finance(store, user) {
  c.permit(user, "finance");
  const supplierData = c.capabilities(user).supplierView
    ? suppliers.list(store, user)
    : { rows: [], totals: {} };
  return {
    receipts: require("./serial-source-corrections").receiptRows(store).slice().reverse(),
    expenses: store.expenses.slice().reverse(),
    operatingExpenses:store.expenses.filter(row=>!businessPurpose.isPassThrough(store,row)).slice().reverse(),
    operatingOtherIncome:(store.otherIncome||[]).filter(row=>!businessPurpose.isPassThrough(store,row)),
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
  const dayReceipts = require("./serial-source-corrections").receiptRows(store).filter(
    (r) =>
      (r.transactionDate || c.day(r.createdAt)) === date &&
      (caps.finance ||
        sales.some((o) => o.id === r.sourceId) ||
        returns.some((o) => o.id === r.sourceId)),
  );
  const salesAmount = c.round(sales.reduce((s, o) => s + o.amount, 0));
  const returnAmount = c.round(returns.reduce((s, o) => s + Number(o.originalAmount??o.amount), 0));
  const dayGiftCost = c.round(store.sales.filter(owned)
    .flatMap((o) => o.giftOrders || [])
    .filter((gift) => c.day(gift.createdAt) === date)
    .reduce((sum, gift) => sum + Number(gift.cost || 0), 0));
  const grossProfit = c.round(
    sales.reduce((s, o) => s + o.profit, 0) -
      returns.reduce((s, o) => s + Number(o.amount ?? o.originalAmount ?? 0) - (Array.isArray(o.items) ? o.items.reduce((n, i) => n + Number(i.cost || 0), 0) : Number(o.cost || 0)), 0) - dayGiftCost,
  );
  const sumReceipts = (kind) =>
    c.round(
      dayReceipts
        .filter((r) => r.kind === kind && !businessPurpose.isPassThrough(store,r))
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
            sign * ((sign<0?item.originalAmount:undefined)??item.amount??item.quantity*item.salePrice),
        );
        row.grossProfit = caps.profit
          ? c.round(
              row.grossProfit +
                sign *
                  (sign<0?Number(item.amount??item.originalAmount)-Number(item.cost||0):(item.profit??item.quantity*(item.salePrice-item.costPrice))),
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
  // Gift cost is a cost of sales; category totals must include the same cost as the headline.
  if(caps.profit)for(const order of store.sales.filter(owned))for(const gift of (order.giftOrders||[]).filter(g=>c.day(g.createdAt)===date)){
    const items=gift.items?.length?gift.items:[{type:'赠品成本',cost:gift.cost}],total=Math.round(Number(gift.cost||0)*100),weights=items.map(i=>Math.max(0,Number(i.cost||0))),weight=weights.reduce((n,x)=>n+x,0);let assigned=0;
    items.forEach((item,index)=>{const part=index===items.length-1?total-assigned:Math.round(total*(weight?weights[index]/weight:1/items.length));assigned+=part;const name=item.type||store.products.find(p=>p.skuId===item.skuId)?.type||'赠品成本',row=categoryMap.get(name)||{category:name,quantity:0,salesAmount:0,grossProfit:0};row.grossProfit=c.round(row.grossProfit-part/100);categoryMap.set(name,row);});
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
            ownedReturns.reduce((s, o) => s + Number(o.originalAmount??o.amount), 0),
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
      ? store.expenses.filter((e) => c.day(e.createdAt) === date && !businessPurpose.isPassThrough(store,e))
      : [],
  };
}
function openingLocked(store) {
  return (store.products||[]).length>0 || [
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
      "已有商品档案或业务单据，不能重新期初建账覆盖原档；请使用商品维护或盘点",
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
  currentInventory,
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





