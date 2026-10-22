'use strict';
const $ = id => document.getElementById(id);
const E = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let data = {items:[], categories:[], canManage:false, manageItems:[]};
async function api(path, options={}) {
  const response = await fetch(path, {credentials:'same-origin', ...options});
  let result;
  try { result = await response.json(); } catch { throw new Error('服务暂时无法返回资料，请稍后重试'); }
  if (!response.ok) {
    if (response.status === 401) { location.href='/login?next=/knowledge'; throw new Error('请先登录员工账号'); }
    throw new Error(result.error?.message || '操作失败');
  }
  return result;
}
function post(path, payload) { return api(path, {method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}, body:JSON.stringify(payload)}); }
function status(message, error=false) { $('status').textContent=message; $('status').classList.toggle('error',error); }
function dateText(value) { const match=String(value || '').match(/^(\d{4}-\d{2}-\d{2})/); return match ? match[1] : ''; }
function today() { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
function fileName(value) { return String(value || '').replace(/\\/g,'/').split('/').filter(Boolean).at(-1) || '来源文件'; }
function policyState(row) {
  if (!['store_policy','store_training','store_exam'].includes(row.sourceTier)) return 'general';
  if (row.policyStatus === 'needs_review') return 'needs_review';
  if (row.policyStatus === 'historical' || dateText(row.validTo) && dateText(row.validTo)<today()) return 'historical';
  if (dateText(row.validFrom) && dateText(row.validFrom)>today()) return 'future';
  return row.policyStatus === 'current' ? 'current' : 'needs_review';
}
function policyRank(row) { return ({current:0,general:1,needs_review:2,future:2,historical:3})[policyState(row)]; }
function sourceLabel(row) { return ['store_policy','store_training','store_exam'].includes(row.sourceTier) ? (row.sourceLabel || ({store_policy:'店内现行资料',store_training:'店内话术资料',store_exam:'店内考核题库'})[row.sourceTier]) : (row.builtIn ? '内置学习资料' : '店内学习资料'); }
function policyBadge(row) {
  const state=policyState(row), labels={current:sourceLabel(row)+' · 优先',general:sourceLabel(row),needs_review:'待核实资料',historical:'历史资料',future:'尚未生效'};
  return '<span class="source-badge '+state+'">'+E(labels[state])+'</span>';
}
function policyNotice(row) {
  const state=policyState(row);
  let text=state==='needs_review' ? '资料条件或版本尚待核实，先查看来源并核对后再办理。' : state==='historical' ? '历史资料用于学习和追溯，办理业务请查现行资料。' : state==='future' ? '尚未到生效日期，办理业务请查当前规则。' : '';
  if (row.conflictSummary) text += (text ? ' ' : '') + row.conflictSummary;
  if (Array.isArray(row.reviewIssues) && row.reviewIssues.length) text += (text ? ' ' : '') + row.reviewIssues.map(issue=>[issue.title,issue.detail].filter(Boolean).join('：')).join('；');
  return text ? '<p class="policy-notice '+state+'">'+E(text)+'</p>' : '';
}
function provenance(row) {
  const files=Array.isArray(row.sourceFiles) ? row.sourceFiles : [], refs=Array.isArray(row.sourceRefs) ? row.sourceRefs : [];
  if (!files.length && !refs.length && !['store_policy','store_training','store_exam'].includes(row.sourceTier)) return '';
  const seen=new Set();
  const fileRows=files.filter(file=>{const name=fileName(typeof file==='string'?file:file.name);if(seen.has(name))return false;seen.add(name);return true;}).map(file=>{
    const f=typeof file==='string'?{name:file}:file;
    return '<li>'+E(fileName(f.name))+(row.uploadSha256 && f.sha256===row.uploadSha256 && /^[a-f0-9]{64}$/.test(f.sha256)?' · <a href="/api/assistant/knowledge/file?sha256='+E(f.sha256)+'">下载原文件</a>':'')+(f.duplicateOf?'<span class="duplicate-note"> · 同版副本</span>':'')+'</li>';
  }).join('');
  const refRows=refs.map(ref=>typeof ref==='string'?{label:ref}:ref).map(ref=>'<li>'+E(fileName(ref.file || ref.name))+(ref.label || ref.blockId ? ' · '+E(ref.label || ref.blockId) : '')+'</li>').join('');
  const asOf=dateText(row.asOf || row.sourceAsOf), imported=dateText(row.importedAt), originalDate=dateText(row.sourceDocumentDate);
  const meta=[originalDate?'原文版本/整理日期：'+originalDate:'',asOf?'店内提供确认日期：'+asOf:'',row.sourceNotes?'原文来源说明：'+row.sourceNotes:'',imported?'导入日期：'+imported:'',row.applicableScope?'适用范围：'+row.applicableScope:'',row.validFrom?'生效日期：'+dateText(row.validFrom):'',row.validTo?'截至日期：'+dateText(row.validTo):''].filter(Boolean);
  return '<details class="provenance"><summary>查看原文件与出处'+(files.length?'（'+files.length+' 个文件）':'')+'</summary>'+(row.sourceTier==='store_policy'?'<p class="source-note">由店内提供，按店内现行资料优先使用。文件来源保留，不表示运营商官方审核。</p>':'')+meta.map(text=>'<p class="source-meta">'+E(text)+'</p>').join('')+(fileRows?'<h3>来源文件</h3><ul>'+fileRows+'</ul>':'')+(refRows?'<h3>对应段落与表格</h3><ul>'+refRows+'</ul>':'')+'</details>';
}
function tableContent(row) {
  if (!Array.isArray(row.tables)) return '';
  return row.tables.map(table=>{
    const headers=Array.isArray(table.headers)?table.headers:[], rows=Array.isArray(table.rows)?table.rows:[];
    const cells=value=>Array.isArray(value)?value:[value];
    return '<div class="knowledge-table"><table>'+(table.caption?'<caption>'+E(table.caption)+'</caption>':'')+(headers.length?'<thead><tr>'+headers.map(cell=>'<th scope="col">'+E(cell)+'</th>').join('')+'</tr></thead>':'')+'<tbody>'+rows.map(line=>'<tr>'+cells(line).map(cell=>'<td>'+E(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }).join('');
}
function articleContent(row) {
  return '<article id="'+E(row.id)+'"><div class="article-tags">'+policyBadge(row)+'<span class="tag">'+E(row.category)+'</span></div><h2>'+E(row.title)+'</h2>'+policyNotice(row)+(row.sourceRevisionNote?'<p class="revision-note">'+E(row.sourceRevisionNote)+'</p>':'')+'<p class="summary">'+E(row.summary)+'</p>'+(row.applicableScope?'<p class="source-meta">适用范围：'+E(row.applicableScope)+'</p>':'')+'<details class="article-body"><summary>看正文、操作步骤与例子</summary><div class="steps">'+String(row.body||'').split('\n').filter(Boolean).map(text=>'<p>'+E(text)+'</p>').join('')+tableContent(row)+'</div></details>'+provenance(row)+'<p class="version">'+E(sourceLabel(row))+' · 第 '+E(row.version||1)+' 版'+(row.updatedByName?' · '+E(row.updatedByName)+' 修改':'')+'</p><div class="article-footer"><a href="/learning">写学习单</a><a href="/assistant">向助理提问</a>'+(data.canManage?'<button type="button" data-edit="'+E(row.id)+'">修改</button>':'')+'</div></article>';
}
function render() {
  const q=$('search').value.trim().toLocaleLowerCase('zh-CN'), category=$('category').value, filter=$('source-filter').value;
  const items=data.items.filter(row=>{
    const state=policyState(row);
    if (filter==='current' && state!=='current' || filter==='general' && state!=='general' || filter==='review' && ['current','general'].includes(state)) return false;
    return (!category || row.category===category) && (!q || [row.title,row.category,row.summary,row.body,row.applicableScope,...(row.tags||[]),...(row.customerQuestions||[]),...(row.matchKeywords||[]).flat(),...(row.sourceFiles||[]).map(file=>fileName(typeof file==='string'?file:file.name))].join(' ').toLocaleLowerCase('zh-CN').includes(q));
  }).sort((a,b)=>policyRank(a)-policyRank(b));
  $('articles').innerHTML=items.map(articleContent).join('') || '<section class="tools"><h2>暂时没有匹配资料</h2><p>试试换一个关键词，或选择全部资料和全部分类。</p></section>';
  const current=items.filter(row=>policyState(row)==='current').length;
  status('显示 '+items.length+' 篇资料'+(current?'，其中店内现行资料 '+current+' 篇':''));
  openHash();
}
function openHash() {
  let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
  if(!id)return;
  const article=document.getElementById(id);if(!article)return;
  const detail=article.querySelector('details.article-body');if(detail)detail.open=true;
  article.scrollIntoView({block:'start'});
}
function renderManager() {
  $('admin').hidden=!data.canManage;$('upload-section').hidden=!data.canManage;if(!data.canManage)return;
  $('managed').innerHTML=(data.manageItems||[]).slice().sort((a,b)=>policyRank(a)-policyRank(b)).map(row=>'<div class="manage-row"><div><strong>'+E(row.title)+'</strong><br>'+policyBadge(row)+'<small> '+E(row.category)+' · '+(row.enabled===false?'已停用':'使用中')+' · 第 '+E(row.version||1)+' 版</small></div><div class="manage-actions"><button type="button" data-edit="'+E(row.id)+'">编辑</button><button type="button" data-toggle="'+E(row.id)+'">'+(row.enabled===false?'恢复启用':'停用')+'</button></div></div>').join('');
}
async function load() {
  try {
    data=await api('/api/assistant/knowledge');data.items ||= [];data.categories ||= [];
    const previous=$('category').value;
    $('category').innerHTML='<option value="">全部分类</option>'+data.categories.map(category=>'<option>'+E(category)+'</option>').join('');
    if(data.categories.includes(previous))$('category').value=previous;
    $('category-list').innerHTML=data.categories.map(category=>'<option value="'+E(category)+'"></option>').join('');
    render();renderManager();
  }catch(error){status(error.message,true);}
}
function edit(id) {
  const row=id?(data.manageItems||[]).find(item=>item.id===id):null, form=$('edit-form');
  form.reset();
  if(form.elements.policyStatus.options?.[0])form.elements.policyStatus.options[0].disabled=Boolean(row?.sourceTier);
  for(const name of ['id','title','category','summary','body','applicableScope','policyStatus'])form.elements[name].value=row?.[name]||'';
  form.elements.validFrom.value=dateText(row?.validFrom);form.elements.validTo.value=dateText(row?.validTo);
  form.elements.version.value=row?.version||'';
  const conversation=Boolean(row?.conversationTopic);$('conversation-settings').hidden=!conversation;
  form.elements.customerQuestions.disabled=!conversation;form.elements.matchKeywords.disabled=!conversation;
  form.elements.customerQuestions.value=(row?.customerQuestions||[]).join('\n');form.elements.matchKeywords.value=(row?.matchKeywords||[]).map(group=>group.join('|')).join('\n');
  form.elements.tags.value=(row?.tags||[]).join('，');form.elements.enabled.value=row?.enabled===false?'false':'true';
  $('edit-title').textContent=row?'修改文章 · 第 '+(row.version||1)+' 版':'新增店内知识';
  $('edit-status').textContent='';$('edit-dialog').showModal();
}
$('search').addEventListener('input',render);
$('category').addEventListener('change',render);
$('source-filter').addEventListener('change',render);
$('new-article').addEventListener('click',()=>edit());
$('cancel').addEventListener('click',()=>$('edit-dialog').close());
window.addEventListener('hashchange',openHash);
document.addEventListener('click',async event=>{
  const editButton=event.target.closest('button[data-edit]');if(editButton){edit(editButton.dataset.edit);return;}
  const toggleButton=event.target.closest('button[data-toggle]');if(!toggleButton)return;
  const row=(data.manageItems||[]).find(item=>item.id===toggleButton.dataset.toggle);if(!row)return;
  const activate=row.enabled===false;
  if(!confirm((activate?'恢复启用':'停用')+'「'+row.title+'」？操作会留痕。'))return;
  toggleButton.disabled=true;
  try {await post(activate?'/api/assistant/knowledge/save':'/api/assistant/knowledge/remove',activate?{...row,enabled:true}:{id:row.id});await load();status(activate?'文章已恢复启用':'文章已停用，记录仍保留');}
  catch(error){status(error.message,true);}finally{toggleButton.disabled=false;}
});
$('edit-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget, button=form.querySelector('button[type=submit]');button.disabled=true;
  try {
    const payload=Object.fromEntries(new FormData(form));if(!payload.id)delete payload.id;
    if(payload.version)payload.version=Number(payload.version);else delete payload.version;
    const editing=(data.manageItems||[]).find(row=>row.id===payload.id);
    if(editing?.conversationTopic){
      payload.customerQuestions=String(payload.customerQuestions||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      if(payload.customerQuestions.length>12||payload.customerQuestions.some(value=>value.length>240))throw new Error('常见问法最多12句，每句不超过240字');
      const value=String(payload.matchKeywords||'').trim();
      payload.matchKeywords=value?value.split(/\r?\n/).map(line=>line.split('|').map(word=>word.trim())):[];
      if(payload.matchKeywords.length>8||payload.matchKeywords.some(group=>group.length>12||group.some(word=>!word||word.length>30)))throw new Error('关键词组合最多8组，每组1至12个词；空词请补齐或删除多余的 |');
    }else{delete payload.customerQuestions;delete payload.matchKeywords;}
    payload.enabled=payload.enabled==='true';if(!payload.policyStatus)delete payload.policyStatus;
    if(payload.validFrom && payload.validTo && payload.validFrom>payload.validTo)throw new Error('截至日期不能早于生效日期');
    await post('/api/assistant/knowledge/save',payload);$('edit-dialog').close();await load();status('保存成功，修改已留痕');
  }catch(error){$('edit-status').textContent=error.message;$('edit-status').className='error';}finally{button.disabled=false;}
});
load();

let uploadFile=null,uploadBusy=false;
function uploadStatus(message,error=false){
 const node=$('upload-status');node.textContent=message;node.className=error?'error':message.startsWith('上传成功')?'success':'';
}
function clearUpload(){
 uploadFile=null;$('upload-preview').hidden=true;$('upload-parts').replaceChildren();
 $('upload-title').disabled=true;$('upload-category').disabled=true;$('upload-confirm').disabled=true;
}
function uploading(busy){
 uploadBusy=busy;$('upload-file').disabled=busy;$('upload-preview-button').disabled=busy;
 $('upload-confirm').disabled=busy||!uploadFile;
}
async function uploadRequest(path,file,settings={}){
 const body=new FormData();body.append('file',file);
 for(const [key,value]of Object.entries(settings))body.append(key,value);
 return api(path,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body});
}
$('go-upload').addEventListener('click',()=>$('upload-section').scrollIntoView({block:'start'}));
$('upload-file').addEventListener('change',()=>{clearUpload();uploadStatus($('upload-file').files.length?'已选择文件。':'');});
$('upload-form').addEventListener('submit',async event=>{
 event.preventDefault();if(uploadBusy)return;
 const file=$('upload-file').files[0];clearUpload();
 if(!file){uploadStatus('请先选择资料文件',true);return;}
 if(file.size>5*1024*1024){uploadStatus('每个文件最多 5MB，请拆分后上传',true);return;}
 uploading(true);uploadStatus('正在读取资料，请稍等…');
 try{
  const result=await uploadRequest('/api/assistant/knowledge/upload-preview',file);
  if(result.duplicate){
   uploadStatus('这份文件已经上传过，不会重复保存。');
   const link=document.createElement('a');link.textContent='查看已上传资料';link.href='#'+encodeURIComponent(result.articleIds[0]);$('upload-status').append(document.createElement('br'),link);return;
  }
  uploadFile=file;$('upload-title').value=result.title;$('upload-category').value='学习资料';
  $('upload-title').disabled=false;$('upload-category').disabled=false;
  $('upload-note').textContent=result.note;
  for(const part of result.parts){
   const detail=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');
   summary.textContent='第 '+part.number+' 篇 · 点击查看正文';text.textContent=part.body;detail.append(summary,text);$('upload-parts').append(detail);
  }
  $('upload-preview').hidden=false;
  uploadStatus('已读到 '+result.characters+' 字，将保存为 '+result.parts.length+' 篇。请核对后点“确认上传”。');
 }catch(error){uploadStatus('读取失败：'+error.message,true);}finally{uploading(false);}
});
$('upload-confirm').addEventListener('click',async()=>{
 if(uploadBusy||!uploadFile)return;
 const title=$('upload-title').value.trim(),category=$('upload-category').value.trim();
 if(!title||!category){uploadStatus('请填写资料标题和分类',true);return;}
 uploading(true);uploadStatus('正在上传保存，请稍等…');
 try{
  const result=await uploadRequest('/api/assistant/knowledge/upload',uploadFile,{title,category});
  clearUpload();$('upload-file').value='';$('search').value='';$('source-filter').value='';$('category').value='';
  await load();
  uploadStatus(result.duplicate?'这份文件已经上传过，资料仍保留。':'上传成功，共保存 '+result.articleIds.length+' 篇学习资料，原文件已保留。');
  const link=document.createElement('a');link.textContent='查看这次上传的资料';link.href='#'+encodeURIComponent(result.articleIds[0]);$('upload-status').append(document.createElement('br'),link);
 }catch(error){uploadStatus('上传未成功：'+error.message+'。文件仍保留在当前页面，可重试。',true);}finally{uploading(false);}
});

