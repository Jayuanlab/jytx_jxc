const c = require("./common");

const targets = Object.freeze({
  sale: "开销售单",
  reception: "建接待单",
  purchase: "开订货单",
  inventory: "查库存",
  salesSummary: "查销售额",
  attendance: "查出勤",
});
const clean = (value, label, max) => {
  const text = c.text(value, label).replace(/\s+/g, " ");
  if (text.length > max) throw new c.HttpError(400, `${label}不能超过${max}字`);
  return text;
};
const presetRules = Object.freeze([
  { phrase:"顾客来问一下", target:"reception", pattern:/^(?:来了?(?:个|位)?(?:顾客|客户|客人)|(?:顾客|客户|客人)来(?:了)?(?:问|咨询|看看?))(?!.*(?:要了|买了|成交|开单)).*$/ },
  { phrase:"帮我记个接待", target:"reception", pattern:/(?:记|录|建|开).{0,6}(?:接待|来访)(?:单|记录)?/ },
  { phrase:"给顾客记一笔销售", target:"sale", pattern:/(?:给|帮).{0,8}(?:顾客|客户|客人).{0,8}(?:记一笔|记个销售单|做销售单)/ },
  { phrase:"这台手机顾客带走了", target:"sale", pattern:/(?:这台|这部|这个).{0,12}(?:手机|机子).{0,8}(?:带走了|拿走了)/ },
  { phrase:"跟供货商订货", target:"purchase", pattern:/(?:跟|找).{0,8}(?:供货商|供应商).{0,8}(?:订货|要货|拿货|进货)/ },
  { phrase:"店里要补点货", target:"purchase", pattern:/(?:补|进|订).{0,4}(?:一批|一些|一点|点)?货/ },
  { phrase:"店里还有没有货", target:"inventory", pattern:/(?:店里|仓里|库里).{0,8}(?:还有货|有现货|有多少货)/ },
  { phrase:"给我看看库存", target:"inventory", pattern:/(?:看|查|找|瞧).{0,5}(?:库存|现货|还有多少货)/ },
  { phrase:"今天卖得怎么样", target:"salesSummary", pattern:/(?:今天|今日|昨天|昨日).{0,8}(?:卖得怎么样|生意怎么样|营业怎么样)/ },
  { phrase:"今天做了多少钱", target:"salesSummary", pattern:/(?:今天|今日|昨天|昨日).{0,8}(?:做了多少钱|卖了好多钱|营业了多少)/ },
  { phrase:"今天谁在上班", target:"attendance", pattern:/(?:今天|今日|昨天|昨日).{0,8}(?:谁在上班|谁来上班|谁值班|谁来了)/ },
  { phrase:"今天来了几个营业员", target:"attendance", pattern:/(?:今天|今日|昨天|昨日).{0,8}(?:来了几个(?:营业员|员工)|上班几个人|几个人上班)/ },
]);
function list(store, user) {
  c.permit(user, "manageUsers");
  const custom = (store.assistantPhrases || []).map((row) => ({ ...row, targetLabel: targets[row.target] || row.target, builtIn:false }));
  const builtIn = presetRules.map((row,index) => ({ id:`preset-${index+1}`, phrase:row.phrase, target:row.target, targetLabel:targets[row.target], builtIn:true }));
  return [...custom, ...builtIn];
}
function save(store, user, payload) {
  c.permit(user, "manageUsers");
  const phrase = clean(payload.phrase, "助理说法", 40);
  if (phrase.length < 2) throw new c.HttpError(400, "助理说法至少两个字");
  const target = clean(payload.target, "标准操作", 40);
  if (!Object.hasOwn(targets, target)) throw new c.HttpError(400, "标准操作不在可选范围");
  store.assistantPhrases ||= [];
  const row = payload.id ? store.assistantPhrases.find((item) => item.id === payload.id) : null;
  if (payload.id && !row) throw new c.HttpError(404, "这条说法不存在");
  if (store.assistantPhrases.some((item) => item !== row && item.phrase.toLocaleLowerCase("zh-CN") === phrase.toLocaleLowerCase("zh-CN")))
    throw new c.HttpError(409, "这条说法已定义");
  const result = row || { id: c.id("APL") };
  result.phrase = phrase;
  result.target = target;
  result.updatedAt = c.now();
  result.operatorId = user.id;
  if (!row) store.assistantPhrases.push(result);
  c.audit(store, user, "assistant:phrase-save", `${phrase} → ${targets[target]}`);
  return { ...result, targetLabel: targets[target] };
}
function remove(store, user, payload) {
  c.permit(user, "manageUsers");
  const index = (store.assistantPhrases || []).findIndex((row) => row.id === payload.id);
  if (index < 0) throw new c.HttpError(404, "这条说法不存在");
  const [row] = store.assistantPhrases.splice(index, 1);
  c.audit(store, user, "assistant:phrase-delete", `${row.phrase} → ${targets[row.target]}`);
  return { deleted: true };
}
function resolve(store, question) {
  const normalized = question.toLocaleLowerCase("zh-CN");
  const custom = [...(store.assistantPhrases || [])].sort((a,b) => b.phrase.length-a.phrase.length)
    .find((row) => normalized.includes(row.phrase.toLocaleLowerCase("zh-CN")));
  return custom || presetRules.find((row) => row.pattern.test(question)) || null;
}
module.exports = { targets, list, save, remove, resolve };
