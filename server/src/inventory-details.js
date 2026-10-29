const c = require('./common');
const inStock = serial => ['可售', '未激活'].includes(serial.status);
const phone = product => product.stockManaged !== false && [product.type,product.subType,product.thirdType].some(value => /智能手机|智能机|功能机|老人机|老年机|按键机|二手机|二手手机|^手机$/i.test(value || ''));
const tracked = product => product.stockManaged !== false && (product.trackSerial === true || phone(product));
function index(store) {
  const purchases = new Map(), items = new Map(), serials = new Map();
  for (const order of store.purchases || []) {
    purchases.set(order.id, order);
    for (const item of order.items || []) {
      items.set(item.id, {order, item});
      for (const no of item.serials || []) {
        const key = JSON.stringify([item.skuId, no]);
        if (!serials.has(key)) serials.set(key, []);
        serials.get(key).push({order, item});
      }
    }
  }
  return {purchases, items, serials};
}
function source(store, order) {
  if(!order)return {purchaseId:'',supplierId:'',supplier:'',purchaseDate:''};
  const supplier = (store.suppliers || []).find(row => row.id === order.supplierId);
  return {purchaseId: order?.id || '', supplierId: order?.supplierId || '', supplier: order?.supplier || supplier?.name || '', purchaseDate: order?.createdAt || ''};
}
function sourceReached(store,targetSkuId,originSkuId,sourceId,seen=new Set()) {
 if(targetSkuId===originSkuId)return true;
 if(seen.has(targetSkuId))return false;const next=new Set(seen);next.add(targetSkuId);
 return (store.stockTransfers||[]).some(t=>t.status==="completed"&&t.targetSkuId===targetSkuId&&(t.sourceCostSources||[]).some(part=>part.sourceId===sourceId&&part.quantity>0)&&sourceReached(store,t.sourceSkuId,originSkuId,sourceId,next));
}
function enrich(store, product, stock, refs) {
  const serials = (stock.serials || []).map(serial => ({...serial,...require('./serial-sources').resolve(store,product,serial,refs),inStock:inStock(serial)}));
  const sources = tracked(product) ? serials.filter(inStock).map(row => ({purchaseId:row.purchaseId, supplierId:row.supplierId, supplier:row.supplier, purchaseDate:row.purchaseDate})) :
    (stock.costSources || []).filter(row => row.quantity > 0).map(row => {
      const match = refs.items.get(row.sourceId);
      const exchange=(store.supplierExchanges||[]).flatMap(order=>(order.receipts||[]).flatMap(receipt=>receipt.items.filter(item=>item.id===row.sourceId&&sourceReached(store,product.skuId,item.skuId,row.sourceId)).map(item=>({order,receipt,item})))).at(0);
      if(exchange)return {purchaseId:'',supplierId:exchange.order.supplierId,supplier:(store.suppliers||[]).find(x=>x.id===exchange.order.supplierId)?.name||exchange.order.supplierName,purchaseDate:exchange.receipt.at,sourceStatus:'供货商换货验收',supplierExchangeId:exchange.order.id};
      const supplierReturn=(store.supplierOutboundTransfers||[]).flatMap(order=>(order.goodsReceipts||[]).flatMap(receipt=>(receipt.items||[]).filter(item=>item.id===row.sourceId&&item.skuId===product.skuId).map(item=>({order,receipt,item})))).at(0);
      if(supplierReturn){const supplier=(store.suppliers||[]).find(item=>item.id===supplierReturn.order.supplierId);return {purchaseId:'',supplierId:supplierReturn.order.supplierId,supplier:supplier?.name||supplierReturn.order.supplierName||'',purchaseDate:source(store,{createdAt:supplierReturn.receipt.at}).purchaseDate,sourceStatus:'供货商调货换回验收'};}
      if(match && sourceReached(store, product.skuId, match.item.skuId, row.sourceId)) return source(store, match.order); const entry=(store.openingImportBatches||[]).flatMap(batch=>(batch.products||[]).map(item=>({batch,item}))).find(({item})=>item.sourceId===row.sourceId && sourceReached(store,product.skuId,item.skuId,row.sourceId)); if(entry){const supplier=(store.suppliers||[]).find(item=>item.id===entry.item.supplierId);return {purchaseId:"",supplierId:supplier?.id||"",supplier:supplier?.name||entry.item.supplier||"",purchaseDate:"",sourceStatus:"期初登记"};} return source(store,null);
    });
  // A zero-quantity opening profile has documentary provenance but no FIFO stock layer.
  if (!tracked(product) && stock.quantity === 0) {
    const warehouseId = stock.warehouseId || product.warehouseId || 'wh-sale';
    for (const batch of store.openingImportBatches || []) {
      if (batch.kind !== 'opening_quantity_append') continue;
      for (const item of batch.products || []) {
        const sourceWarehouseId = item.warehouseId || batch.warehouseId;
        if (item.skuId !== product.skuId || item.quantity !== 0 || sourceWarehouseId !== warehouseId || (batch.warehouseId && batch.warehouseId !== warehouseId)) continue;
        const supplier = (store.suppliers || []).find(row => row.id === item.supplierId);
        sources.push({purchaseId:'', supplierId:item.supplierId || '', supplier:supplier?.name || item.supplier || '', purchaseDate:'', sourceStatus:'期初档案'});
      }
    }
  }
  const unique = [...new Map(sources.map(row => [JSON.stringify([row.purchaseId,row.supplierId,row.supplier]),row])).values()];
  const count = serials.filter(inStock).length;
  return {serials, stockSources:unique, serialRequired:tracked(product), trackSerial:tracked(product), serialBoundCount:count,
    serialDifference:tracked(product) ? Number(stock.quantity || 0) - count : 0};
}
function target(store, payload) {
  const product = store.products.find(row => row.skuId === payload.skuId);
  if (!product || !tracked(product)) throw new c.HttpError(400, '请选择按串号管理的实物商品');
  const warehouseId = payload.warehouseId || product.warehouseId || 'wh-sale';
  const stock = store.inventory.find(row => row.skuId === product.skuId && (row.warehouseId || 'wh-sale') === warehouseId);
  if (!stock) throw new c.HttpError(404, '该仓没有此商品库存');
  const current = (stock.serials || []).filter(inStock).map(row => row.no).sort();
  if (!Array.isArray(payload.expectedSerials) || JSON.stringify([...payload.expectedSerials].sort()) !== JSON.stringify(current) || Number(payload.expectedQuantity) !== Number(stock.quantity))
    throw new c.HttpError(409, '盘点期间库存或串号有变化，请刷新后重新核对');
  return {product, stock, current};
}
function numbers(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new c.HttpError(400, '请提交实点串号清单');
  const serials = value.map(no => c.text(no, '完整串号'));
  if (serials.some(no => !/^[a-z0-9-]{5,40}$/i.test(no))) throw new c.HttpError(400, '请填写完整串号；后4位只用于查找已有串号');
  if (new Set(serials).size !== serials.length) throw new c.HttpError(409, '实点串号重复，请逐台核对');
  return serials;
}
function count(store, user, payload) {
  c.permit(user, 'stocktake');
  const {product, stock, current} = target(store, payload), serials = numbers(payload.serials);
  const currentSet=new Set(current), actualSet=new Set(serials);
  const missing = current.filter(no => !actualSet.has(no)), extra = serials.filter(no => !currentSet.has(no));
  const different = missing.length || extra.length || Number(stock.quantity) !== serials.length;
  const reason = different ? c.text(payload.reason, '差异说明') : String(payload.reason || '串号逐台核对一致').trim();
  if (reason.length > 1000) throw new c.HttpError(400, '盘点说明不能超过1000字');
  const row = {id:c.id('ST'),kind:'serial',skuId:product.skuId,product:product.name,warehouseId:stock.warehouseId || 'wh-sale',warehouseName:stock.warehouseName || '销售仓',
    expected:stock.quantity,actual:serials.length,delta:serials.length-stock.quantity,expectedSerials:current,actualSerials:serials,missingSerials:missing,extraSerials:extra,
    reason,status:different?'差异待核实':'已核对',operatorId:user.id,operator:user.name,createdAt:c.now()};
  store.stocktakes.unshift(row);
  c.audit(store,user,'stock:serial-count',row.id+' · '+product.name+' · 应有 '+row.expected+'，实点 '+row.actual+' · '+row.status);
  return {...row,message:different?'串号盘点已保存，差异已进入老板待核实。':'串号盘点已保存，账实一致。'};
}
function bind(store, user, payload) {
  c.permit(user,'stocktake');
  const {product,stock,current}=target(store,payload), serials=numbers(payload.serials);
  const missing=Number(stock.quantity)-current.length;
  if (missing <= 0 || serials.length !== missing) throw new c.HttpError(409,'只可补齐当前缺少的 '+Math.max(0,missing)+' 个串号，请重新核对');
  if (serials.some(no => (store.inventory || []).some(row => (row.serials || []).some(serial => serial.no === no)))) throw new c.HttpError(409,'串号已存在，不能重复绑定');
  const reason=c.text(payload.reason,'补录依据');
  if(reason.length>1000)throw new c.HttpError(400,'补录依据不能超过1000字');
  const known=(stock.serials||[]).filter(inStock),value=Number(stock.stockValue??c.round(Number(stock.quantity)*Number(stock.costPrice)));
  if (!Number.isSafeInteger(Number(stock.quantity)) || !Number.isFinite(value) || value<0 || known.some(row=>row.costPrice==null||!Number.isFinite(Number(row.costPrice))||Number(row.costPrice)<0)) throw new c.HttpError(409,'原库存数量或成本资料异常，请先核对库存记录');
  const remaining=c.round(value-known.reduce((n,row)=>n+Number(row.costPrice),0)), cents=Math.round(remaining*100);
  if(remaining<0||!Number.isSafeInteger(cents))throw new c.HttpError(409,'原库存金额与已有串号成本不一致，请先核对库存记录');
  stock.serials ||= [];
  serials.forEach((no,i)=>stock.serials.push({no,status:'可售',costPrice:(Math.floor(cents/missing)+(i<cents%missing?1:0))/100,costBasis:'原库存剩余成本分摊',boundAt:c.now(),boundBy:user.id}));
  product.trackSerial=true;
  c.audit(store,user,'stock:bind-serials',product.skuId+' · '+serials.join('、')+' · '+reason+'；按原库存剩余成本分摊，供货来源按原入库单查询');
  return {message:'串号已绑定，库存数量与总成本保持原记录；供货来源缺失的显示待补。'};
}
function listCounts(store,user) {
  c.permit(user,'stocktake');
  const rows=store.stocktakes.filter(row=>row.kind==='serial');
  const pending=rows.filter(row=>row.status==='差异待核实');
  return [...pending,...rows.filter(row=>row.status!=='差异待核实').slice(0,Math.max(0,100-pending.length))];
}
function review(store,user,payload) {
  c.permit(user,'manageUsers');
  const row=store.stocktakes.find(item=>item.id===payload.id&&item.kind==='serial');
  if(!row)throw new c.HttpError(404,'串号盘点单不存在');
  if(row.status!=='差异待核实')throw new c.HttpError(409,'该盘点单没有待核实差异');
  const note=c.text(payload.note,'核实结果');
  if(note.length>1000)throw new c.HttpError(400,'核实结果不能超过1000字');
  row.status='已核实';row.reviewNote=note;row.reviewedBy=user.id;row.reviewedAt=c.now();
  c.audit(store,user,'stock:serial-review',row.id+' · '+note);
  return {message:'核实结果已保存，实物出入库仍按对应业务单办理。'};
}
module.exports={phone,tracked,inStock,index,enrich,count,bind,listCounts,review};
