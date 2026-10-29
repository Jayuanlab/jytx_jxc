'use strict';
const $ = id => document.getElementById(id);
const E = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let data = {items:[], categories:[], canManage:false, canSubmit:false, manageItems:[]}, vectorStates=new Map(), pendingPreview=null, currentView='browse', indexStatusAvailable=true, showAll=false;
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
  if(row.submissionStatus==='pending')return 'needs_review';
  if (!['store_policy','store_training','store_exam'].includes(row.sourceTier)) return 'general';
  if (row.policyStatus === 'needs_review') return 'needs_review';
  if (row.policyStatus === 'historical' || dateText(row.validTo) && dateText(row.validTo)<today()) return 'historical';
  if (dateText(row.validFrom) && dateText(row.validFrom)>today()) return 'future';
  return row.policyStatus === 'current' ? 'current' : 'needs_review';
}
function policyRank(row) { return ({current:0,general:1,needs_review:2,future:2,historical:3})[policyState(row)]; }
function sourceLabel(row) { return ['store_policy','store_training','store_exam'].includes(row.sourceTier) ? (row.sourceLabel || ({store_policy:'店内现行资料',store_training:'店内话术资料',store_exam:'店内考核题库'})[row.sourceTier]) : (row.builtIn ? '内置学习资料' : '店内学习资料'); }
function policyBadge(row) {
  const state=policyState(row), labels={current:sourceLabel(row)+' · 优先',general:sourceLabel(row),needs_review:row.submissionStatus==='pending'?'待审核资料':'待核实资料',historical:'历史资料',future:'尚未生效'};
  return '<span class="source-badge '+state+'">'+E(labels[state])+'</span>';
}
function vectorBadge(row){if(!row.uploadSha256&&!row.migrationBatch)return '';if(!indexStatusAvailable)return '<span class="vector-badge pending">状态待刷新</span>';const indexed=vectorStates.get(row.id)==='vectorized';return '<span class="vector-badge '+(indexed?'vectorized':'pending')+'">'+(indexed?'已向量化 · 小猫咪可用':'未向量化 · 小猫咪不可用')+'</span>';}
function policyNotice(row) {
  const state=policyState(row);
  let text=row.submissionStatus==='pending'&&row.policyStatus==='current'?'正文已核对，等待切片审核和向量化；小猫咪暂不使用。':state==='needs_review' ? '资料条件或版本尚待核实，先查看来源并核对后再办理。' : state==='historical' ? '历史资料用于学习和追溯，办理业务请查现行资料。' : state==='future' ? '尚未到生效日期，办理业务请查当前规则。' : '';
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
  return '<article id="'+E(row.id)+'"><div class="article-tags">'+policyBadge(row)+vectorBadge(row)+'<span class="tag">'+E(row.category)+'</span></div><h2>'+E(row.title)+'</h2>'+policyNotice(row)+(row.sourceRevisionNote?'<p class="revision-note">'+E(row.sourceRevisionNote)+'</p>':'')+'<p class="summary">'+E(String(row.summary||'').replace(/#{1,6}\s+/g,'').replace(/\s+/g,' '))+'</p>'+(row.applicableScope?'<p class="source-meta">适用范围：'+E(row.applicableScope)+'</p>':'')+'<details class="article-body"><summary>查看正文和出处</summary><div class="steps">'+String(row.body||'').split('\n').filter(Boolean).map(text=>'<p>'+E(text)+'</p>').join('')+tableContent(row)+'</div></details>'+provenance(row)+'<p class="version">'+E(sourceLabel(row))+' · 第 '+E(row.version||1)+' 版'+(row.updatedByName?' · '+E(row.updatedByName)+' 修改':'')+'</p>'+(data.canManage&&(data.manageItems||[]).some(item=>item.id===row.id)?'<div class="article-footer"><button type="button" data-edit="'+E(row.id)+'">编辑资料</button><button type="button" data-toggle="'+E(row.id)+'">'+(row.enabled===false?'恢复启用':'停用资料')+'</button></div>':'')+'</article>';
}
function render() {
  const q=$('search').value.trim().toLocaleLowerCase('zh-CN'), category=$('category').value, filter=$('source-filter').value;
  const items=data.items.filter(row=>{
    const indexed=vectorStates.get(row.id)==='vectorized';
    const tracked=row.uploadSha256||row.migrationBatch;
    if(filter==='vectorized'&&(!tracked||!indexed)||filter==='pending'&&(!tracked||indexed)||filter==='library'&&tracked)return false;
    return (!category || row.category===category) && (!q || [row.title,row.category,row.summary,row.body,row.applicableScope,...(row.tags||[]),...(row.customerQuestions||[]),...(row.matchKeywords||[]).flat(),...(row.sourceFiles||[]).map(file=>fileName(typeof file==='string'?file:file.name))].join(' ').toLocaleLowerCase('zh-CN').includes(q));
  }).sort((a,b)=>{const rank=row=>row.uploadSha256?0:row.id.startsWith('active-rule-')?1:2;return rank(a)-rank(b)||policyRank(a)-policyRank(b);});
  const limited=!q&&!category&&!filter&&!showAll&&items.length>8,shown=limited?items.slice(0,8):items;
  $('articles').innerHTML=shown.map(articleContent).join('')+(limited?'<div class="load-more"><button type="button" id="show-all">查看其余 '+(items.length-shown.length)+' 篇资料</button></div>':'') || '<section class="empty-state"><h2>没有找到资料</h2><p>换一个业务词，或把分类和使用状态改回“全部”。</p></section>';
  const current=items.filter(row=>policyState(row)==='current').length;
  status('找到 '+items.length+' 篇资料'+(limited?'，先显示 '+shown.length+' 篇':'')+(current?'；店内现行资料 '+current+' 篇':''));
  openHash();
}
function showView(view){if(!['browse','upload','review'].includes(view)||view==='upload'&&!data.canSubmit||view==='review'&&!data.canManage)view='browse';currentView=view;$('browse-view').hidden=view!=='browse';$('upload-section').hidden=view!=='upload';$('review-view').hidden=view!=='review';for(const button of document.querySelectorAll('[data-view]')){button.setAttribute('aria-current',button.dataset.view===view?'page':'false');}if(view==='review')renderManager();}
function openHash() {
  let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
  if(!id)return;
  let article=document.getElementById(id);
  if(!article&&data.items.some(row=>row.id===id)){
    $('search').value='';$('category').value='';$('source-filter').value='';showAll=true;showView('browse');render();return;
  }
  if(!article)return;
  if(currentView!=='browse')showView('browse');
  const detail=article.querySelector('details.article-body');if(detail)detail.open=true;
  article.scrollIntoView({block:'start'});
}
function renderManager() {
  const pending=(data.manageItems||[]).filter(row=>row.uploadSha256&&row.enabled!==false&&vectorStates.get(row.id)!=='vectorized').sort((a,b)=>String(b.importedAt||'').localeCompare(String(a.importedAt||'')));
  const disabled=(data.manageItems||[]).filter(row=>row.enabled===false);
  $('review-count').textContent=pending.length?'('+pending.length+')':'';
  $('managed').innerHTML=(pending.map(row=>'<article class="review-item"><div class="review-copy"><div class="article-tags">'+vectorBadge(row)+policyBadge(row)+'</div><h3>'+E(row.title)+'</h3><p>'+E(String(row.summary||'').replace(/#{1,6}\s+/g,'').replace(/\s+/g,' '))+'</p><small>提交人：'+E(row.uploadedByName||row.updatedByName||'未记录')+' · 第 '+E(row.version||1)+' 版</small></div><div class="review-actions"><button type="button" data-edit="'+E(row.id)+'">核对正文'+(row.policyStatus==='current'?'':'并标记现行')+'</button><button type="button" data-chunk="'+E(row.id)+'"'+(row.policyStatus==='current'?'':' disabled title="先核对正文并标记现行"')+'>预览切片并向量化</button></div></article>').join('')||'<div class="empty-state"><h3>没有待审核资料</h3><p>员工上传的新资料会出现在这里。已向量化资料可到“查资料”中查看。</p></div>')+(disabled.length?'<details class="disabled-list"><summary>已停用资料（'+disabled.length+'）</summary>'+disabled.map(row=>'<div class="disabled-row"><span>'+E(row.title)+'</span><button type="button" data-toggle="'+E(row.id)+'">恢复启用</button></div>').join('')+'</details>':'');
}
async function load() {
  try {
    data=await api('/api/assistant/knowledge');data.items ||= [];data.categories ||= [];
    try{const indexed=await api('/api/assistant/knowledge/index-status');vectorStates=new Map(indexed.rows.map(row=>[row.id,row.vectorState]));indexStatusAvailable=true;}catch{vectorStates=new Map();indexStatusAvailable=false;}
    const previous=$('category').value;
    $('category').innerHTML='<option value="">全部分类</option>'+data.categories.map(category=>'<option>'+E(category)+'</option>').join('');
    if(data.categories.includes(previous))$('category').value=previous;
    $('category-list').innerHTML=data.categories.map(category=>'<option value="'+E(category)+'"></option>').join('');
    document.querySelector('[data-view="upload"]').hidden=!data.canSubmit;document.querySelector('[data-view="review"]').hidden=!data.canManage;
    render();renderManager();showView(currentView);
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
$('search').addEventListener('keydown',event=>{if(event.key==='Escape'){event.currentTarget.value='';render();}});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
$('new-article').addEventListener('click',()=>edit());
$('cancel').addEventListener('click',()=>$('edit-dialog').close());
window.addEventListener('hashchange',openHash);
document.addEventListener('click',async event=>{
  if(event.target.closest('#show-all')){showAll=true;render();return;}
  const chunkButton=event.target.closest('button[data-chunk]');if(chunkButton){try{const result=await api('/api/assistant/knowledge/chunk-preview?id='+encodeURIComponent(chunkButton.dataset.chunk));pendingPreview=result;$('chunk-notice').textContent=result.notice;$('chunk-list').innerHTML=result.parts.map((part,i)=>'<details><summary>第 '+(i+1)+' 片 · '+E(part.kind)+' · 原文 '+E(part.sourceBlockId)+(part.row?' 第 '+E(part.row)+' 行':'')+'</summary><pre>'+E(part.text)+'</pre></details>').join('');$('chunk-status').textContent=result.policyStatus==='current'?'请逐片核对事实、隐私与对客适用范围。':'请先在“编辑”中核对正文，标记店内现行并保存，然后重新预览切片。';$('vectorize-confirm').disabled=result.policyStatus!=='current';$('chunk-dialog').showModal();}catch(error){status(error.message,true);}return;}
  const editButton=event.target.closest('button[data-edit]');if(editButton){edit(editButton.dataset.edit);return;}
  const toggleButton=event.target.closest('button[data-toggle]');if(!toggleButton)return;
  const row=(data.manageItems||[]).find(item=>item.id===toggleButton.dataset.toggle);if(!row)return;
  const activate=row.enabled===false;
  if(!confirm((activate?'恢复启用':'停用')+'「'+row.title+'」？操作会留痕。'))return;
  toggleButton.disabled=true;
  try {await post(activate?'/api/assistant/knowledge/save':'/api/assistant/knowledge/remove',activate?{...row,enabled:true}:{id:row.id});await load();status(activate?'文章已恢复启用':'文章已停用，记录仍保留');}
  catch(error){status(error.message,true);}finally{toggleButton.disabled=false;}
});
$('chunk-close').addEventListener('click',()=>$('chunk-dialog').close());
$('vectorize-confirm').addEventListener('click',async()=>{if(!pendingPreview)return;const button=$('vectorize-confirm');button.disabled=true;$('chunk-status').textContent='正在生成向量，请保持页面打开…';try{const result=await post('/api/assistant/knowledge/vectorize',{id:pendingPreview.id,version:pendingPreview.version});$('chunk-dialog').close();pendingPreview=null;await load();status('向量化完成：'+result.chunkCount+' 片，小猫咪可使用。');}catch(error){$('chunk-status').textContent='向量化未完成：'+error.message+'。资料仍显示未向量化，可重新预览并重试。';button.disabled=false;}});
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
   if(result.articleIds?.length){const link=document.createElement('a');link.textContent='查看已上传资料';link.href='#'+encodeURIComponent(result.articleIds[0]);$('upload-status').append(document.createElement('br'),link);}return;
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
  clearUpload();$('upload-file').value='';$('search').value='';$('source-filter').value='pending';$('category').value='';
  await load();showView('browse');
  uploadStatus(result.duplicate?'这份文件已经上传过，资料仍保留。':'上传成功，共保存 '+result.articleIds.length+' 篇未向量化资料，等待老板核对。');
  if(result.articleIds?.length){const link=document.createElement('a');link.textContent='查看这次上传的资料';link.href='#'+encodeURIComponent(result.articleIds[0]);$('upload-status').append(document.createElement('br'),link);}
 }catch(error){uploadStatus('上传未成功：'+error.message+'。文件仍保留在当前页面，可重试。',true);}finally{uploading(false);}
});

