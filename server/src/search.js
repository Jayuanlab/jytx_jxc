const c = require("./common");
const inventoryDetails = require("./inventory-details");
const vocabulary = require("./search-vocabulary");
const receptions = require("./receptions");

const scopes = new Set(["all", "inventory", "sales", "purchases", "suppliers", "movements", "receipts", "receptions", "serials", "invoices"]);
const contains = (value, q) => String(value ?? "").toLowerCase().includes(String(q ?? "").toLowerCase());
const sameDay = (value) => value ? c.day(value) : "";
function search(store, user, params) {
  const cap = c.capabilities(user);
  const scope = params.get("scope") || "all";
  if (scope === "meta") return {
    warehouses: [...new Set(store.inventory.map((s) => s.warehouseName || "销售仓"))].sort(),
    suppliers: cap.supplierView ? store.suppliers.map((s) => ({ id: s.id, name: s.name })) : [],
    scopes: [...scopes],
    synonyms: store.searchSynonyms || [],
    canManageSynonyms: cap.manageProducts,
  };
  if (!scopes.has(scope)) throw new c.HttpError(400, "查询类型不正确");
  const raw = String(params.get("q") || "").trim();
  const documentNumbers=require("./document-numbers");
  let numbered=null;try{numbered=documentNumbers.lookup(store,user,raw);}catch(error){if(error.statusCode!==404)throw error;}
  params=documentNumbers.queryParams(store,params);
  if (raw.length > 100) throw new c.HttpError(400, "关键词过长");
  const q = String(params.get("q")||raw).toLowerCase();
  const browse=params.get("browse")==="1";
  if(scope==="serials"&&!/^[a-z0-9-]{4,40}$/i.test(raw))throw new c.HttpError(400,"请输入完整串号或串号后4位");
  if(scope==="invoices"&&!raw)throw new c.HttpError(400,"请输入发票号码或销售、采购单号");
  const claimInvoices = new Map();
  for (const claim of store.govSubsidyClaims || []) if (claim.invoiceNo) {
    if (!claimInvoices.has(claim.orderId)) claimInvoices.set(claim.orderId, []);
    claimInvoices.get(claim.orderId).push(claim.invoiceNo);
  }
  const invoiceNumbers = row => [...new Set([row.invoiceNo, row.invoiceNumber, ...(claimInvoices.get(row.id) || [])].filter(Boolean).map(String))];
  const terms = q.split(/\s+/).filter(Boolean);
  const match = (values) => terms.every((term) => vocabulary.matches(store, values, term));
  const serialMatch = (value) => /^\d{4}$/.test(q) ? String(value || "").endsWith(q) : contains(value, q);
  const warehouse = String(params.get("warehouse") || "").trim();
  const supplier = String(params.get("supplier") || "").trim().toLowerCase();
  const from = String(params.get("from") || "").trim();
  const to = String(params.get("to") || "").trim();
  for (const date of [from, to]) if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new c.HttpError(400, "日期格式不正确");
  if (from && to && from > to) throw new c.HttpError(400, "开始日期不能晚于结束日期");
  if (!q && !warehouse && !supplier && !from && !to && !browse && scope==="all") throw new c.HttpError(400, "请至少输入一项查询条件");
  const inDate = (value) => {
    const date = sameDay(value);
    return (!from || date >= from) && (!to || date <= to);
  };
  const within = (name) => scope === "all" || scope === name || (scope==="serials"&&name==="inventory") || (scope==="invoices"&&["sales","purchases"].includes(name));
  const productMap = new Map(store.products.map((p) => [p.skuId, p]));
  const supplierMatches = store.suppliers.filter((s) => contains(s.name, supplier) || contains(s.id, supplier));
  const supplierIds = new Set(supplierMatches.map((s) => s.id));
  const suppliedSkus = new Set(store.purchases.filter((p) => supplierIds.has(p.supplierId)).flatMap((p) => p.items.map((i) => i.skuId)));
  const data = { inventory: [], sales: [], purchases: [], suppliers: [], movements: [], receipts: [], receptions: [] };
  const intent = /^\d{4}$/.test(q) ? { type: "serialTail", label: "串号后四位", hint: "可能存在相同尾号，请核对完整串号与商品。" } : /^(SO|GFT|PO|RC|MV|MB|GB|GBE|MRC)-/i.test(raw) ? { type: "document", label: "单据或流水编号", hint: "优先显示编号命中的记录和关联业务。" } : /^\d{14,18}$/.test(q) ? { type: "serial", label: "完整串号", hint: "查看库存、采购及销售流转。" } : { type: "keyword", label: "商品或业务关键词", hint: "同时使用商品别名和自定义同义词。" };
  if(scope==="invoices")Object.assign(intent,{type:"invoice",label:"发票或单据号码",hint:"仅查询账套已登记号码，不代表发票已开具或验真。"});
  if(browse&&!q)Object.assign(intent,{type:"browse",label:"浏览账套记录",hint:"可输入关键词、串号或单号继续筛选。"});
  if (within("inventory") && !from && !to) for (const stock of store.inventory) {
    const p = productMap.get(stock.skuId);
    if (!p || (warehouse && !contains(stock.warehouseName || stock.warehouseId, warehouse))) continue;
    if (supplier && !suppliedSkus.has(p.skuId)) continue;
    const serials = (stock.serials || []).filter((s) => !q || serialMatch(s.no));
    if(scope==="serials"&&!serials.length)continue;
    if (q && !match([...vocabulary.productFields(p), stock.warehouseName]) && !serials.length) continue;
    data.inventory.push({
      skuId: p.skuId, code: p.externalCode, name: p.name, aliases: p.aliases || [], category: [p.type, p.subType, p.thirdType].filter(Boolean).join(" / "),
      warehouse: stock.warehouseName || "销售仓", quantity: stock.quantity, trackSerial: inventoryDetails.tracked(p),
      serials: serials.slice(0, 30).map((s) => ({ no: s.no, status: s.status })),
      ...(cap.cost ? { stockValue: stock.stockValue } : {}),
    });
  }
  if (within("sales")) for (const order of store.sales) {
    if (!cap.allSales && (order.salespersonId || order.operatorId) !== user.id) continue;
    if (!inDate(order.createdAt) || (warehouse && !(order.items || []).some((item) => contains(item.warehouseName || productMap.get(item.skuId)?.warehouseId || "销售仓", warehouse)))) continue;
    const items = order.items || [];
    const gifts = (order.giftOrders || []).flatMap((gift) => gift.items.map((item) => ({...item, giftId: gift.id, giftKind: gift.kind})));
    if (supplier && !items.concat(gifts).some((i) => suppliedSkus.has(i.skuId))) continue;
    if(scope==="invoices"&&!match([order.id,invoiceNumbers(order)]))continue;
    if (q && scope!=="invoices" && !match([order.id, invoiceNumbers(order), order.operator, order.salesperson, order.paymentMethod, ...(order.giftOrders || []).map((gift) => gift.id), ...items.concat(gifts).flatMap((i) => [i.name, i.externalCode, i.serialNo, vocabulary.productFields(productMap.get(i.skuId))])])) continue;
    data.sales.push({ id: order.id, invoiceNos:invoiceNumbers(order), date: order.createdAt, status: order.status, amount: order.amount, salesperson: order.salesperson, paymentMethod: order.paymentMethod,
      items: items.map((i) => ({ code: i.externalCode, name: i.name, quantity: i.quantity, serialNo: i.serialNo, returnedQuantity: i.returnedQuantity || 0 })),
      gifts: (order.giftOrders || []).map((gift) => ({ id: gift.id, date: gift.createdAt, kind: gift.kind, items: gift.items.map((item) => ({name:item.name,quantity:item.quantity,serialNo:item.serialNo})) })),
      ...(cap.profit ? {giftCost:order.giftCost || 0, netProfit:c.round(order.profit - (order.giftCost || 0) - (store.costAdjustments||[]).filter(a=>a.orderId===order.id).reduce((n,a)=>n+Number(a.costDelta||0),0))} : {}) });
  }
  if (within("purchases") && (cap.purchase || cap.supplierView)) for (const order of store.purchases) {
    if (!inDate(order.createdAt) || (supplier && !supplierIds.has(order.supplierId)) || (warehouse && !(order.items || []).some((item) => contains(item.warehouseName || productMap.get(item.skuId)?.warehouseId || "销售仓", warehouse)))) continue;
    const items = order.items || [];
    if(scope==="invoices"&&!match([order.id,invoiceNumbers(order)]))continue;
    if (q && scope!=="invoices" && !match([order.id, invoiceNumbers(order), order.supplier, order.operator, ...items.flatMap((i) => [i.name, i.externalCode, i.serials || [], vocabulary.productFields(productMap.get(i.skuId))])])) continue;
    data.purchases.push({ id: order.id, invoiceNos:invoiceNumbers(order), date: order.createdAt, supplier: order.supplier, amount: cap.cost ? c.round(items.reduce((n,i)=>n+i.quantity*require("./purchase-price-corrections").currentUnitPrice(store,order.id,i.id),0)) : undefined,
      items: items.map((i) => ({ code: i.externalCode, name: i.name, quantity: i.quantity, serials: (i.serials || []).filter((no) => !q || contains(no, q)).slice(0, 30) })) });
  }
  if (within("suppliers") && cap.supplierView && !warehouse && !from && !to) for (const row of supplierMatches) {
    if (q && !match([row.name, row.id, row.contact])) continue;
    data.suppliers.push({ id: row.id, name: row.name, contact: row.contact || "" });
  }
  if (within("movements") && (cap.stocktake || cap.cost)) for (const row of store.movements) {
    if (!inDate(row.createdAt) || (warehouse && !contains(row.warehouseName, warehouse))) continue;
    const p = productMap.get(row.skuId);
    if (supplier && !suppliedSkus.has(row.skuId)) continue;
    if (q && !match([row.id, row.sourceId, row.product, row.type, vocabulary.productFields(p)])) continue;
    data.movements.push({ id: row.id, sourceId: row.sourceId, date: row.createdAt, type: row.type, product: row.product, quantity: row.quantity, warehouse: row.warehouseName });
  }
  if (within("receipts") && cap.finance) for (const row of store.receipts) {
    if (!inDate(row.createdAt) || warehouse || supplier) continue;
    if (q && !match([row.id, row.sourceId,row.account,row.accountName,row.paymentAccountId,row.kind])) continue;
    data.receipts.push({ id: row.id, sourceId: row.sourceId, date: row.createdAt, kind: row.kind, amount:row.amount,account:row.account,accountName:row.accountName,paymentAccountId:row.paymentAccountId,accountOwnerId:row.accountOwnerId,partId:row.partId });
  }
  if(within("receptions")&&!warehouse&&!supplier) for(const row of receptions.list(store,user).rows){
    if(row.publicAssist||!inDate(row.createdAt))continue;
    const profile=row.customerProfile||{};
    if(q&&!match([row.id,row.purpose,row.customerPhone,row.customerName,row.ownerName,row.needs,...Object.values(profile),...(row.viewedProducts||[]).map(x=>x.name)]))continue;
    data.receptions.push({id:row.id,date:row.createdAt,purpose:row.purpose,status:row.status,ownerName:row.ownerName,customerMask:row.customerMask,customerName:row.customerName,needs:row.needs,budgetBand:row.budgetBand,budgetMin:row.budgetMin,budgetMax:row.budgetMax,followUpNeed:row.followUpNeed,followUpAt:row.followUpAt,customerProfile:profile,viewedProducts:row.viewedProducts||[],supplementPending:row.supplementPending});
  }
  for (const name of Object.keys(data)) { if(data[name].some(row=>row.date))data[name].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))); data[name] = data[name].slice(0, 100); }
  const claims = cap.finance ? (store.govSubsidyClaims || []) : [];
  const carriers = cap.finance ? (store.carrierServices || []) : [];
  const eventParents = new Map();
  for (const row of claims) for (const event of row.events || []) eventParents.set(event.id, row.orderId);
  for (const row of carriers) for (const part of row.schedule || []) for (const event of part.events || []) eventParents.set(event.id, row.id);
  for (const row of store.saleReturns || []) eventParents.set(row.id, row.orderId);
  for (const order of store.sales) for (const gift of order.giftOrders || []) eventParents.set(gift.id, order.id);
  const parentId = (id) => eventParents.get(id) || id;
  const externalMatches = [];
  if (q && scope !== "invoices") {
    for (const row of claims) {
      const references = (row.events || []).flatMap((event) => [event.id, event.reference]);
      if ((scope!=="invoices"||match([row.id,row.orderId,row.invoiceNo]))&&inDate(row.createdAt)&&match([row.id, row.orderId, row.platformOrderNo, row.invoiceNo, row.statementNo, row.platformRefundRef, references])) externalMatches.push(row.orderId);
    }
    for (const row of scope==="invoices"?[]:carriers) {
      const references = (row.schedule || []).flatMap((part) => [part.statementNo, (part.events || []).flatMap((event) => [event.id, event.bankRef])]);
      if (match([row.id, row.externalOrderNo, row.reference, references])) externalMatches.push(row.id);
    }
  }
  const sourceIds = [...new Set([...data.sales.map((row) => row.id), ...data.purchases.map((row) => row.id), ...data.movements.map((row) => row.sourceId), ...data.receipts.map((row) => row.sourceId), ...externalMatches].filter(Boolean).map(parentId))].slice(0, 30);
  const trace = sourceIds.map((id) => ({
    sourceId: id,
    sale: data.sales.find((row) => row.id === id) || (() => { const row = store.sales.find((item) => item.id === id && (cap.allSales || (item.salespersonId || item.operatorId) === user.id)); return row ? { id: row.id, date: row.createdAt, status: row.status, amount: row.amount } : null; })(),
    purchase: data.purchases.find((row) => row.id === id) || (() => { const row = (cap.purchase || cap.supplierView) && store.purchases.find((item) => item.id === id); return row ? { id: row.id, date: row.createdAt, supplier: row.supplier } : null; })(),
    gifts: (() => { const order = store.sales.find((row) => row.id === id && (cap.allSales || (row.salespersonId || row.operatorId) === user.id)); return (order?.giftOrders || []).map((gift) => ({id:gift.id,date:gift.createdAt,kind:gift.kind,items:gift.items.map((item)=>({name:item.name,quantity:item.quantity,serialNo:item.serialNo}))})); })(),
    movements: (cap.stocktake || cap.cost) ? store.movements.filter((row) => parentId(row.sourceId) === id).slice(0, 30).map((row) => ({ id: row.id, type: row.type, product: row.product, quantity: row.quantity, date: row.createdAt })) : [],
    receipts: cap.finance ? store.receipts.filter((row) => parentId(row.sourceId) === id).slice(0, 30).map((row) => ({ id: row.id, kind: row.kind, amount: row.amount, date: row.createdAt })) : [],
    returns: (cap.allSales || store.sales.some((row) => row.id === id && (row.salespersonId || row.operatorId) === user.id)) ? (store.saleReturns || []).filter((row) => row.orderId === id).slice(0, 30).map((row) => ({ id: row.id, amount: row.amount, date: row.createdAt })) : [],
    subsidy: cap.finance ? claims.filter((row) => row.orderId === id).slice(0, 2).map((row) => ({ id: row.id, platformOrderNo: row.platformOrderNo, status: row.status, amount: row.subsidyAmount, date: row.createdAt, invoiceNo:row.invoiceNo||"", events: (row.events || []).slice(0, 30).map((event) => ({ id: event.id, reference: event.reference, type: event.type, amount: event.amount, date: event.createdAt })) })) : [],
    carrier: cap.finance ? carriers.filter((row) => row.id === id).slice(0, 1).map((row) => ({ id: row.id, externalOrderNo: row.externalOrderNo, typeName: row.typeName, date: row.createdAt, schedule: (row.schedule || []).map((part) => ({ month: part.month, statementNo: part.statementNo, confirmed: part.confirmed, received: part.received, events: (part.events || []).map((event) => ({ id: event.id, bankRef: event.bankRef, amount: event.amount, date: event.createdAt })) })) })) : [],
  }));
  const serialTraces = /^[a-z0-9-]{4,40}$/i.test(q) && (scope==="all"||scope==="inventory"||scope==="serials") ? store.inventory.filter(stock=>(!warehouse||contains(stock.warehouseName||stock.warehouseId,warehouse))&&(!supplier||suppliedSkus.has(stock.skuId))).flatMap((stock) => (stock.serials || []).filter((serial) => serialMatch(serial.no)).map((serial) => {
    const product = productMap.get(stock.skuId);
    const purchase = (cap.purchase || cap.supplierView) ? store.purchases.find((row) => row.id === serial.purchaseId || (row.items || []).some((item) => (item.serials || []).includes(serial.no))) : null;
    const sales = store.sales.filter((row) => (cap.allSales || (row.salespersonId || row.operatorId) === user.id) && ((row.items || []).some((item) => item.serialNo === serial.no) || (row.giftOrders || []).some((gift) => gift.items.some((item) => item.serialNo === serial.no))));
    return { serialNo: serial.no, product: product?.name || stock.skuId, warehouse: stock.warehouseName || "销售仓", status: serial.status,
      purchase: purchase ? { id: purchase.id, date: purchase.createdAt, supplier: purchase.supplier } : null,
      sales: sales.map((row) => ({ id: row.id, date: row.createdAt, status: row.status, returns: (store.saleReturns || []).filter((item) => item.orderId === row.id && (item.items || []).some((line) => (row.items || []).some((saleItem) => saleItem.id === line.itemId && saleItem.serialNo === serial.no))).map((item) => ({ id: item.id, date: item.createdAt })) })) };
  })).filter(row=>!from&&!to||[row.purchase?.date,...row.sales.flatMap(sale=>[sale.date,...sale.returns.map(item=>item.date)])].filter(Boolean).some(inDate)).slice(0, 30) : [];
  const topHits = Object.entries(data).flatMap(([kind, rows]) => rows.map((row, index) => {
    const id = row.id || row.code || row.skuId || "";
    const serials = kind === "inventory" ? row.serials.map((item) => item.no) : kind === "sales" ? row.items.map((item) => item.serialNo) : kind === "purchases" ? row.items.flatMap((item) => item.serials) : [];
    const exact = q && String(id).toLowerCase() === q;
    const serial = q && serials.some((no) => serialMatch(no));
    const score = exact ? 100 : serial ? 90 : kind === "inventory" && q && [row.code, row.name, ...(row.aliases || [])].some((value) => String(value || "").toLowerCase() === q) ? 80 : 40;
    return { kind, index, title: kind === "inventory" ? row.name : kind === "suppliers" ? row.name : id, score, reason: exact ? "编号完全匹配" : serial ? "串号匹配" : "关键词匹配" };
  })).sort((a, b) => b.score - a.score).slice(0, 8);
  if (!topHits.length) topHits.push(...trace.slice(0, 8).map((row, index) => ({ kind: "trace", index, title: row.sourceId, score: 80, reason: "外部流水关联" })));
  return { query: { q: raw, warehouse, supplier, from, to, scope }, intent, topHits, serialTraces, results: data, documents: numbered ? [numbered] : [], trace, counts: Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length])) };
}
module.exports = { search };