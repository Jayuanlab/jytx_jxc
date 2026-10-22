"use strict";
const c = require('./common');
const command = /(?:新建|新增|创建|建立|添加|增加|录入|登记)\s*(?:(?:一个|一条|一份|个|条|份|新的|新)\s*)?(?:(?:移动(?:公司)?(?:的)?|C\s*仓)\s*)?(?:商品|产品)(?:资料|档案|信息)?|(?:商品|产品)\s*(?:建档|建个档案|建一个档案)/i;
const norm = value => String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s，,。！!？?：:]/g, '');
function isRequest(question) {
  const q = String(question || '').normalize('NFKC');
  return command.test(q) && !/(?:不要|不用|不想|不需要|不必|暂不|先不|别|取消|停止)\s*.{0,8}(?:新建|新增|创建|建立|添加|增加|录入|登记|建档)/.test(q);
}
function productName(question) {
  const q = String(question || '').normalize('NFKC').trim(), match = q.match(command);
  if (!match) return '';
  let name = q.slice(match.index + match[0].length).replace(/^[\s，,。:：]*(?:商品名称|产品名称|名称|名字)?\s*(?:是|为|叫)?\s*[:：]?\s*/, '');
  // Carry a model string as a name only; never turn other clauses into prices or stock writes.
  name = name.split(/[，,；;\n]|(?:进货价|采购价|成本|售价|价格|编号|串号|串码|库存|数量|单位|仓库)\s*[:：]/)[0].trim();
  name = name.replace(/[。！!？?]+$/g, '').replace(/(?:谢谢|麻烦了|吧|嘛|一下)$/, '').trim();
  if (!name) {
    name = q.slice(0, match.index).replace(/^(?:请|帮我|给我|帮忙|为我|给|为|把)\s*/, '').replace(/[，,\s]+$/, '').trim();
  }
  if (!name || /^(?:帮我|给我|请|我要|我想|怎么|怎样|如何|一下|在哪里|在哪|哪里|入口|页面|功能)$/.test(name) || /怎么|怎样|如何|可以|能不能|在哪里|在哪个/.test(name) || name.length > 120) return '';
  return name;
}
function query(store, user, question) {
  if (!isRequest(question)) return null;
  if (user.status !== 'active' || !c.capabilities(user).manageProducts) return {
    answer: '当前账号没有新建商品档案的权限，请让老板授权后办理。', sources: [],
    metrics: {kind: 'product-draft', allowed: false, restricted: true}, followups: [],
  };
  const name = productName(question);
  const mobileWarehouse = /移动(?:公司)?(?:的)?(?:商品|产品)|移动(?:商品)?仓|C\s*仓/i.test(question) && !/(?:不是|不放|不要|不用|非)\s*.{0,5}(?:移动|C\s*仓)/i.test(question);
  const nameKey = value => norm(value).replace(/[（(]yd[）)]$/i, '');
  const existing = name && (store.products || []).find(row => mobileWarehouse ? row.warehouseId === 'wh-c' && nameKey(row.name) === nameKey(name) : norm(row.name) === norm(name));
  if (existing) return {
    answer: '商品档案中已经有“' + existing.name + '”，请先核对这条资料，避免重复建档。',
    sources: [{label: '商品档案', id: existing.externalCode || existing.skuId, href: '/app?tab=products'}],
    action: {type: 'navigate', label: '查看已有商品', href: '/app?tab=products'},
    metrics: {kind: 'product-draft', allowed: true, existing: true, requiresHumanConfirmation: true}, followups: [],
  };
  return {
    answer: (name ? '已准备“' + name + '”的商品资料草稿。' : '可以打开新增商品资料。') + '请核对商品名称、编号、分类、计量单位、仓库和售价后提交。进货价在进货单里录入；现在还没有建档或增加库存。',
    sources: [{label: '新增商品', id: '待核对', href: '/app?tab=products&new=1'}],
    action: {type: 'navigate', label: '打开商品资料草稿', href: '/app?tab=products&new=1', draftKind: 'product', ownerId: user.id, prefill: {...(name ? {name} : {}), ...(mobileWarehouse ? {warehouseId: 'wh-c'} : {})}},
    metrics: {kind: 'product-draft', allowed: true, requiresHumanConfirmation: true}, followups: [],
  };
}
module.exports = {isRequest, productName, query};
