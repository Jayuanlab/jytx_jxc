const c = require("./common");

function reviewSale(store, user, draft = {}) {
  c.permit(user, "sell");
  const items = Array.isArray(draft.items) ? draft.items.slice(0, 50) : [];
  const findings = [];
  const add = (level, code, message) => findings.push({ level, code, message });
  const productById = new Map(store.products.map((row) => [row.skuId, row]));
  const stockById = new Map(store.inventory.filter((row) => { const p=productById.get(row.skuId); return p && (row.warehouseId||"wh-sale")===(p.warehouseId||"wh-sale"); }).map((row) => [row.skuId, row]));
  const reserved = new Map();
  const serials = new Set();
  let total = 0;

  if (!items.length) add("stop", "empty", "先从商品搜索中选择商品；手机逐台选串码，配件直接填数量。");
  for (const [index, item] of items.entries()) {
    const p = productById.get(item.skuId);
    if (!p || p.active === false) { add("stop", "product-" + index, "第 " + (index + 1) + " 行商品已停用或不存在，请重新选品。"); continue; }
    const qty = Number(item.quantity);
    const price = Number(item.salePrice);
    if (!Number.isSafeInteger(qty) || qty < 1) add("stop", "quantity-" + index, p.name + " 的数量须为正整数。");
    if (!Number.isFinite(price) || price < 0) add("stop", "price-" + index, p.name + " 的售价不正确。");
    else {
      total = c.round(total + (Number.isSafeInteger(qty) && qty > 0 ? qty : 0) * price);
      if (price === 0) add("warn", "free-" + index, p.name + " 售价为零，请核实是否赠品或服务。");
      else if (Number.isFinite(Number(p.salePrice)) && price < Number(p.salePrice)) add("warn", "discount-" + index, p.name + " 低于预设售价，请核对优惠依据。");
    }
    if(Number.isFinite(price)&&price>0){
      const reference=Number(p.salePrice||0),stock=stockById.get(p.skuId),unit=p.trackSerial?(stock?.serials||[]).find(s=>s.no===String(item.serialNo||"").trim()):stock;
      const cost=Number(unit?.costPrice);
      if(Number.isFinite(cost)&&cost>0&&price<cost)add("warn","below-cost-"+index,c.capabilities(user).cost?("本单售价 "+price+" 元，低于该串号进货成本 "+c.round(cost)+" 元，请再次确认。"):"本单售价低于进货成本，请再次确认。");
      if(reference>0&&price<reference*.8)add("warn","deep-discount-"+index,"本单售价 "+price+" 元，比档案零售价 "+reference+" 元低超过20%，请再次确认。");
      if(reference>0&&price>reference*1.2)add("warn","price-deviation-"+index,"本单售价 "+price+" 元，比档案零售价 "+reference+" 元高超过20%，请核对是否多输数字。");
    }
    if (p.stockManaged !== false) {
      const stock = stockById.get(p.skuId);
      const sum = (reserved.get(p.skuId) || 0) + (Number.isSafeInteger(qty) && qty > 0 ? qty : 0);
      reserved.set(p.skuId, sum);
      if (!stock || sum > Number(stock.quantity || 0)) add("stop", "stock-" + index, p.name + " 的本单数量超过所属仓可售库存。");
      else if (Number(stock.quantity) - sum <= 2) add("tip", "low-" + index, p.name + " 开单后所属仓仅余 " + (Number(stock.quantity) - sum) + " 件。");
      if (p.trackSerial) {
        const no = String(item.serialNo || "").trim();
        if (qty !== 1 || !no) add("stop", "serial-" + index, p.name + " 必须逐台选择唯一串码。");
        else if (serials.has(no)) add("stop", "duplicate-" + index, "本单串码 " + no + " 重复。");
        else if (!(stock?.serials || []).some((s) => s.no === no && ["可售", "未激活"].includes(s.status))) add("stop", "unavailable-" + index, p.name + " 的串码当前不可售。");
        serials.add(no);
      }
    } else {
      if (p.type === "维修" && !(item.materials || []).length && !item.noMaterials) add("stop", "repair-" + index, "维修项目要选择实际耗材，或确认本次无耗材。");
      for (const material of item.materials || []) {
        const mp = productById.get(material.skuId);
        const mq = Number(material.quantity);
        if (!mp || mp.stockManaged === false || !Number.isSafeInteger(mq) || mq < 1) { add("stop", "material-" + index, "维修耗材无效，请重新选择。"); continue; }
        const sum = (reserved.get(mp.skuId) || 0) + mq;
        reserved.set(mp.skuId, sum);
        if (sum > Number(stockById.get(mp.skuId)?.quantity || 0)) add("stop", "material-stock-" + index, mp.name + " 作为维修耗材的数量超过可售库存。");
      }
    }
  }

  if (items.length && !draft.receptionId) add("tip", "reception", "若本次有顾客接待记录，关联接待单可保留跟单与协助依据。");
  if (items.length && !draft.account && draft.payments==null && !draft.paymentAccountId) add("stop", "account", "请选择顾客实际付款账户。");
  if(draft.payments!=null||draft.paymentAccountId){try{const parts=require("./payment-accounts").normalize(store,draft,draft.saleMode==="guobu"?c.round(total-Number(draft.subsidyAmount||0)):total);if(draft.saleMode==="guobu"&&parts.some(part=>part.account!=="云闪付"))throw new c.HttpError(400,"国补顾客实付每笔均须为云闪付");}catch(error){add("stop","payment-parts",error.message);}}
  else if (draft.account && !require("./payment-accounts").channels.includes(draft.account)) add("stop", "unknown-account", "收款账户不在可选范围内。");
  if (draft.saleMode === "guobu") {
    if (items.length !== 1 || Number(items[0]?.quantity) !== 1) add("stop", "gov-single", "国补须单件单独开单，配件另开普通单。");
    if (!String(draft.platformOrderNo || "").trim()) add("stop", "gov-number", "请先在国补平台完成核销，再填平台交易号。");
    if (draft.account && draft.account !== "云闪付") add("stop", "gov-account", "国补顾客实付须选择云闪付。");
    const subsidy = Number(draft.subsidyAmount);
    if (!Number.isFinite(subsidy) || subsidy <= 0 || subsidy > Math.min(c.round(total * 0.15), 500))
      add("stop", "gov-amount", "核对平台实际补贴额：不得超过售价 15% 或单件 500 元。");
    if (items.length === 1) {
      const p = productById.get(items[0].skuId);
      if (!p?.trackSerial) add("stop", "gov-serial", "国补商品必须为符合品类的串码商品。");
      if (p && !require("./gov-subsidy").classify(p)) add("stop", "gov-category", "该商品品类尚未登记为国补适用品类。");
      if (total > 6000) add("stop", "gov-price", "当前国补通道要求单件成交价不超过 6000 元。");
      if ((store.govSubsidyClaims || []).some((row) => row.platformOrderNo === String(draft.platformOrderNo || "").trim())) add("stop", "gov-duplicate", "国补平台交易号已登记，请核对原单。");
    }
  }
  const stops = findings.filter((x) => x.level === "stop").length;
  return {
    asOf: c.now(), mode: "规则预检", ready: stops === 0 && items.length > 0,
    total, customerDue: draft.saleMode === "guobu" ? c.round(total - Number(draft.subsidyAmount || 0)) : total,
    findings: findings.slice(0, 30),
    note: "仅供开单前参考；提交时仍重新核验库存、串码、金额和权限。"
  };
}

module.exports = { reviewSale };
