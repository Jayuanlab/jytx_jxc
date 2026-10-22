const c = require("./common");

const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase("zh-CN");
function words(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[，,、;；\n]+/);
  const result = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
  if (result.length > 20 || result.some((item) => item.length > 50))
    throw new c.HttpError(400, "每组最多 20 个叫法，每个不超过 50 字");
  return result;
}
function saveGroup(store, user, payload) {
  c.permit(user, "manageProducts");
  const terms = words(payload.terms);
  if (terms.length < 2) throw new c.HttpError(400, "同义词组至少需要两个叫法");
  const existing = payload.id ? store.searchSynonyms.find((row) => row.id === payload.id) : null;
  if (payload.id && !existing) throw new c.HttpError(404, "同义词组不存在");
  const collisions = store.searchSynonyms.filter((row) => row !== existing).flatMap((row) => row.terms.map(normalize));
  if (terms.some((term) => collisions.includes(normalize(term)))) throw new c.HttpError(409, "该叫法已在其他同义词组中");
  const row = existing || { id: c.id("SYN") };
  row.terms = terms;
  row.updatedAt = c.now();
  row.operatorId = user.id;
  if (!existing) store.searchSynonyms.push(row);
  c.audit(store, user, "search:synonym-save", terms.join(" / "));
  return row;
}
function deleteGroup(store, user, payload) {
  c.permit(user, "manageProducts");
  const index = store.searchSynonyms.findIndex((row) => row.id === payload.id);
  if (index < 0) throw new c.HttpError(404, "同义词组不存在");
  const [row] = store.searchSynonyms.splice(index, 1);
  c.audit(store, user, "search:synonym-delete", row.terms.join(" / "));
  return { deleted: true };
}
function variants(store, term) {
  const needle = normalize(term);
  const group = (store.searchSynonyms || []).find((row) => (row.terms || []).some((word) => normalize(word) === needle));
  return group ? group.terms.map(normalize) : [needle];
}
function matches(store, fields, term) {
  if (!term) return true;
  const haystack = fields.flat(Infinity).map(normalize);
  return variants(store, term).some((word) => haystack.some((field) => field.includes(word)));
}
function productFields(product) {
  return [product?.name, product?.shortName, product?.externalCode, product?.type, product?.subType, product?.thirdType, product?.spec, product?.aliases || []];
}
module.exports = { words, saveGroup, deleteGroup, variants, matches, productFields };
