const c = require("./common");
function inspect(store) {
  const findings = [];
  const products = new Map(store.products.map((p) => [p.skuId, p]));
  const serials = new Map();
  for (const row of store.inventory) {
    const product = products.get(row.skuId);
    const key = row.skuId + ":" + (row.warehouseId || "wh-sale");
    if (!product) findings.push({ id: "orphan-stock:" + key, severity: "高", summary: "库存找不到商品档案 " + key });
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 0)
      findings.push({ id: "invalid-quantity:" + key, severity: "高", summary: "库存数量异常 " + key });
    const available = (row.serials || []).filter((s) => ["可售", "未激活"].includes(s.status));
    if (product && product.trackSerial && available.length !== row.quantity)
      findings.push({ id: "serial-balance:" + key, severity: "高", summary: "串码可售数与库存数量不符：" + product.name });
    for (const serial of row.serials || []) {
      const no = String(serial.no || "").trim();
      if (!no) findings.push({ id: "empty-serial:" + key, severity: "高", summary: "存在空串码：" + (product?.name || key) });
      else if (serials.has(no)) findings.push({ id: "duplicate-serial:" + no, severity: "高", summary: "串码重复：" + no });
      else serials.set(no, key);
    }
  }
  for (const order of store.sales) {
    const total = c.round((order.items || []).reduce((n, item) => n + Number(item.amount || 0), 0));
    if (Math.abs(total - Number(order.amount || 0)) > 0.009)
      findings.push({ id: "sale-total:" + order.id, severity: "高", summary: "销售单合计与明细不符：" + order.id });
    for (const item of order.items || [])
      if ((item.returnedQuantity || 0) > item.quantity)
        findings.push({ id: "over-return:" + order.id + ":" + item.id, severity: "高", summary: "退货数量超过销售数量：" + order.id });
  }
  const ids = new Set();
  for (const row of [...store.sales, ...store.purchases, ...store.saleReturns, ...store.purchaseReturns]) {
    if (ids.has(row.id)) findings.push({ id: "duplicate-document:" + row.id, severity: "高", summary: "业务单据编号重复：" + row.id });
    ids.add(row.id);
  }
  for (const row of store.closeouts || []) {
    if (Math.abs(c.round(row.actualCash - row.expectedCash) - row.difference) > 0.009)
      findings.push({ id: "closeout-difference:" + row.id, severity: "高", summary: "当日中途扎账现金差异计算不符：" + row.id });
  }
  for(const row of store.dailyCloseouts||[]){
    if(row.simpleDailyClose===true||row.status!=='待老板签认'||!require('./named-fund-accounts').applies(row.date))continue;
    const unresolved=(row.snapshot?.mobile||[]).filter(item=>item.status!=='一致');
    if(unresolved.length)findings.push({id:'daily-close-mobile-unresolved:'+row.id,severity:'高',summary:'旧详细扎账空充或移动BOSS仍待补录／查差，不能锁定：'+row.id,inAppOnly:true});
  }
  return [...findings,...require("./business-change-flow").findings(store),...require("./wallet-owner-baseline").findings(store)];
}
function collect(store) {
  const findings = inspect(store);
  if (!findings.length) return { checked: true, findings: 0 };
  const { notice } = require("./feishu-notices");
  const day = c.day();
  for (const finding of findings.filter(x=>!x.inAppOnly)) notice(store, "guardian:" + day + ":" + finding.id, "系统预警", { id: finding.id, summary: finding.summary });
  return { checked: true, findings: findings.length };
}
function assessReception(row){
    const reasons=[];
    const needs=String(row.needs||'').trim();
    if(row.duplicateOf)reasons.push('同一时段疑似重复接待，请核对原单');
    if(!String(row.purpose||'').trim())reasons.push('未写接待来意');
    if(!needs||needs==='咨询一般业务')reasons.push('未写具体接待事项');
    if(!['yes','no'].includes(row.followUpNeed))reasons.push('未标明是否需要跟进');
    if(row.followUpNeed==='yes'&&!row.followUpAt)reasons.push('未写计划跟进时间');
    if(row.wechat?.claimed&&!row.wechat?.confirmed)reasons.push('加微信申报待核验');
    if(row.receptionServiceRuleVersion===1){if(!row.audioEvidence)reasons.push('未保存可回放接待录音');if(!require('./reception-service-assessment').assess(row.originalDocument?.transcript,row).serviceComplete)reasons.push('未见具体双方沟通与服务过程');}
    const profile=row.customerProfile||{},residence=[profile.town,profile.village,profile.address].filter(Boolean).join(' ');
    const facts={purpose:!!String(row.purpose||'').trim(),question:needs.length>=6&&needs!=='咨询一般业务'&&!/^(无|没有|不知道|随便看看)$/.test(needs),residence:!!residence,timing:!!row.followUpAt||/今天|明天|后天|下周|下月|月底|月初|周末|星期|\d+月\d+日/.test(needs)};
    const useful=facts.purpose&&facts.question&&(facts.residence||facts.timing)&&!row.duplicateOf,serviceRuleNoPoints=row.receptionServiceRuleVersion===1;
    const state=row.validity==='无效'?(serviceRuleNoPoints?'已判无效，不计积分':row.qualityAward?.status==='已核准'?'已核准质量奖励':useful?'建议核对是否有用，可奖50分':'已判无效，暂不建议奖励'):row.duplicateOf?'建议核为无效':reasons.length?'建议先补资料':'资料齐全，待人工核实真实性';
    return {id:row.id,displayNo:row.displayNo||row.id,ownerName:row.ownerName||'',createdAt:row.createdAt,status:row.status,validity:row.validity||'待确认',state,reasons,needsPreview:needs.slice(0,120),residencePreview:residence.slice(0,100),plannedAt:row.followUpAt||'',qualityFacts:facts,qualitySuggested:!serviceRuleNoPoints&&row.validity==='无效'&&useful&&row.qualityAward?.status!=='已核准',qualityPoints:row.qualityAward?.points||0,serviceRuleNoPoints,href:'/receptions?highlight='+encodeURIComponent(row.id)};
}
function receptionReview(store) {
  const rows=store.receptions||[];
  const assessed=rows.map(assessReception);
  const priority=row=>row.status==='待结案确认'?0:row.validity==='无效'?1:2;
  return {total:rows.length,invalid:rows.filter(row=>row.validity==='无效').length,pending:rows.filter(row=>row.status==='待结案确认').length,incomplete:assessed.filter(row=>row.reasons.some(reason=>reason.startsWith('未写'))).length,rows:assessed.filter(row=>row.validity==='无效'||row.validity!=='有效'&&['待结案确认','接待中','待回访','已转业务'].includes(row.status)).sort((a,b)=>priority(a)-priority(b)||String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,100)};
}
module.exports = { inspect, collect, assessReception, receptionReview };
