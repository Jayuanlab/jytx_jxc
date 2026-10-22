const panel = document.getElementById("vocabulary-panel");
const form = document.getElementById("vocabulary-form");
const list = document.getElementById("vocabulary-list");
const status = document.getElementById("vocabulary-status");
let groups = [];
async function requestVocabulary(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "保存失败");
  return result;
}
function renderVocabulary() {
  list.replaceChildren();
  if (!groups.length) {
    const message = document.createElement("p");
    message.className = "hint";
    message.textContent = "还没有同义词组。";
    list.append(message);
  }
  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "vocabulary-row";
    const name = document.createElement("span");
    name.textContent = group.terms.join(" ⇄ ");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "编辑";
    edit.onclick = () => {
      form.elements.id.value = group.id;
      form.elements.terms.value = group.terms.join("、");
      form.elements.terms.focus();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.onclick = async () => {
      if (!confirm("删除这一组同义词？")) return;
      try {
        await requestVocabulary("/api/search/synonyms/delete", { id: group.id });
        await loadVocabulary();
        status.textContent = "已删除，查询和开单会使用新规则。";
      } catch (error) { status.textContent = error.message; }
    };
    row.append(name, edit, remove);
    list.append(row);
  }
}
async function loadVocabulary() {
  groups = await requestVocabulary("/api/search/synonyms");
  renderVocabulary();
}
(async () => {
  try {
    const meta = await requestVocabulary("/api/search?scope=meta");
    if (!meta.canManageSynonyms) return;
    panel.hidden = false; if(location.hash === "#vocabulary-panel") { panel.open = true; } if(location.hash === "#vocabulary-panel") setTimeout(() => panel.scrollIntoView({behavior:"smooth"}), 80);
    await loadVocabulary();
  } catch (error) {
    status.textContent = error.message;
  }
})();
document.getElementById("vocabulary-cancel").onclick = () => form.reset();
form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try {
    await requestVocabulary("/api/search/synonyms", data);
    form.reset();
    await loadVocabulary();
    status.textContent = "已保存，查询和开单会使用新规则。";
  } catch (error) { status.textContent = error.message; }
};

