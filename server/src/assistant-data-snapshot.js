'use strict';

const c = require('./common');
const erp = require('./erp');

function dateOf(value) { return value ? c.day(value) : null; }
function visible(row, user, caps) { return caps.allSales || (row.salespersonId || row.operatorId) === user.id; }

async function create(store, user, options = {}) {
  const caps = c.capabilities(user);
  const today = c.day();
  const earliest = new Date(Date.parse(today + 'T00:00:00+08:00') - 90 * 86400000).toISOString().slice(0, 10);
  const days = new Set([today]);
  const visibleSales=(store.sales || []).filter(row=>visible(row,user,caps));
  const visibleReturns=(store.saleReturns || []).filter(row=>visible(row,user,caps));
  const visibleIds=new Set([...visibleSales,...visibleReturns].map(row=>row.id));
  for (const row of [...visibleSales, ...visibleReturns]) {
    const date = dateOf(row.createdAt);
    if (date && date >= earliest && date <= today) days.add(date);
  }
  for (const row of (store.receipts || []).filter(r=>caps.finance||visibleIds.has(r.sourceId))) {
    const date = dateOf(row.transactionDate || row.createdAt);
    if (date && date >= earliest && date <= today) days.add(date);
  }
  if(caps.profit)for (const row of (store.costAdjustments || []).filter(r=>visibleIds.has(r.orderId))) {
    const date = dateOf(row.createdAt);
    if (date && date >= earliest && date <= today) days.add(date);
  }
  for (const sale of visibleSales) for (const gift of sale.giftOrders || []) {
    const date = dateOf(gift.createdAt);
    if (date && date >= earliest && date <= today) days.add(date);
  }
  const sales = [...days].sort().map(date => {
    const s = erp.report(store, user, date).summary;
    return {date, orderCount:s.orderCount, salesAmount:s.salesAmount,
      returnAmount:s.returnAmount, netSales:s.netSales, receivedAmount:s.receivedAmount,
      refundAmount:s.refundAmount, ...(caps.profit ? {adjustedGrossProfit:s.adjustedGrossProfit} : {})};
  });
  const inventory = {skuCount:(store.products || []).length,
    stockRows:(store.inventory || []).length,
    quantity:c.round((store.inventory || []).reduce((n, row) => n + Number(row.quantity || 0), 0))};
  const itemEarliest = new Date(Date.parse(today + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
  const productNames = new Map((store.products || []).map(row=>[row.skuId,row.name]));
  const productTypes = new Map((store.products || []).map(row=>[row.skuId,row.type]));
  const itemDays = new Map();
  for (const [orders, field] of [[visibleSales,'sold'],[visibleReturns,'returned']]) for (const order of orders) {
    const date = dateOf(order.createdAt);
    if (!date || date < itemEarliest || date > today) continue;
    let grouped = itemDays.get(date);
    if (!grouped) { grouped = new Map(); itemDays.set(date,grouped); }
    for (const item of order.items || []) {
      const quantity = Number(item.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const name = String(item.name || productNames.get(item.skuId) || '未命名商品').slice(0,60);
      const key = item.skuId || name;
      const row = grouped.get(key) || {name,category:String(item.type || productTypes.get(item.skuId) || '未分类').slice(0,40),sold:0,returned:0};
      row[field] = c.round(row[field] + quantity);
      grouped.set(key,row);
    }
  }
  let remainingItems = 150;
  const salesItems = [...itemDays].sort((a,b)=>b[0].localeCompare(a[0])).map(([date,grouped])=>{
    const all = [...grouped.values()].sort((a,b)=>b.sold-a.sold || a.name.localeCompare(b.name,'zh-CN'));
    const limit = Math.min(25,remainingItems);
    remainingItems -= Math.min(limit,all.length);
    return {date,items:all.slice(0,limit),omitted:Math.max(0,all.length-limit)};
  });
  const snapshot = {version:1, asOf:new Date().toISOString(), timeZone:'Asia/Shanghai', today, earliest,
    scope:'当前登录门店' + (caps.allSales ? '全店销售' : '本人销售'),
    tools:{sales_summary:{days:sales,canViewProfit:!!caps.profit},
      sales_items:{earliest:itemEarliest,days:salesItems},inventory_overview:inventory}};
  if (caps.manageUsers) {
    const since = Date.now() - 86400000;
    const actions = new Map();
    for (const row of store.operationLogs || []) {
      const at=Date.parse(row.createdAt || 0);
      if (!Number.isFinite(at) || at < since) continue;
      const action = String(row.action || 'unknown').slice(0, 60);
      actions.set(action, (actions.get(action) || 0) + 1);
    }
    snapshot.tools.operations_summary = {last24h:[...actions].sort((a,b)=>b[1]-a[1]).slice(0,12),totalLast24h:[...actions.values()].reduce((a,b)=>a+b,0)};
    let database = {ok:false};
    try { database = await require('./capacity/postgres').health(); } catch { /* health is reported unavailable */ }
    snapshot.tools.runtime_health = {erpUptimeSeconds:Math.round(process.uptime()),databaseOk:database.ok===true,
      postgresPool:database.ok ? database.pool : null};
  }
  if(caps.finance) snapshot.tools.fund_accounts={...require("./named-fund-accounts").build(store,today),wallet:require("./wallet-daily").summary(store,today)};
  return snapshot;
}

module.exports = {create};
