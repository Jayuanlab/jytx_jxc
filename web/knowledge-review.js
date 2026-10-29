'use strict';
const R=id=>document.getElementById(id);
const RE=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const reviewLabels={'mobile-20261009':'移动政策、业务知识与题库','customer-talk-20261009':'顾客口语应答与推荐话术'};
let reviewBatches=[];
function reviewFile(value){return String(value||'').replace(/\\/g,'/').split('/').filter(Boolean).at(-1)||'来源文件';}
function list(value){return Array.isArray(value)?value:[];}
function reviewRefs(rows){return list(rows).map(ref=>'<details class="proof"><summary><span class="ref-label">'+RE(reviewFile(ref.file||ref.name))+' · '+RE(ref.blockId||ref.label||'原文出处')+'</span></summary><div class="review-quote">'+RE(ref.quote||ref.text||'')+'</div></details>').join('');}
function duplicateCopies(row){return list(row.copies).length?row.copies:row.name?[row.name]:row.file?[row.file]:[];}
function duplicateCount(rows){return list(rows).reduce((count,row)=>count+(duplicateCopies(row).length||1),0);}
function contentDuplicate(row){return Boolean(row&&typeof row==='object'&&(row.matchType==='normalized-content'||row.matchType==='normalized-text'||row.binaryMatch===false||row.normalizedContentSha256&&new Set(list(row.sha256s)).size>1));}
function examSection(exam){
 if(!exam||!Number(exam.questionCount))return '';
 const checks=[];
 if(Array.isArray(exam.missingNumbers))checks.push(exam.missingNumbers.length?'缺失题号：'+exam.missingNumbers.join('、'):'题号记录完整');
 if(exam.answerMarkMismatch!==undefined)checks.push(Number(exam.answerMarkMismatch)===0?'勾选项与正确答案一致':'勾选项与答案有 '+exam.answerMarkMismatch+' 处需要核对');
 return '<section class="tools"><h2>题库核对</h2><p>共 '+RE(exam.questionCount)+' 题。'+RE(checks.join('；'))+'。</p>'+(exam.note?'<p>'+RE(exam.note)+'</p>':'')+'<p>试题可能要求选出错误项，不能把错误选项直接当作办理规则。</p></section>';
}
function spotCheckSection(ex){
 if(!ex||!ex.scope&&!list(ex.findings).length)return '';
 return '<section class="tools"><h2>机型官网抽查</h2><p>'+RE(ex.scope||'')+'</p></section>'+list(ex.findings).map(item=>'<article><h2>'+RE(item.model)+' · '+RE(item.blockId)+'</h2><p><strong>'+RE(item.status)+'</strong></p>'+(item.document?'<p>资料写法：'+RE(item.document)+'</p>':'')+(item.official?'<p>官网核对：'+RE(item.official)+'</p>':'')+list(item.sources).filter(source=>/^https:\/\//.test(source.url||'')).map(source=>'<p><a target="_blank" rel="noopener" href="'+RE(source.url)+'">'+RE(source.title)+'</a></p>').join('')+'</article>').join('');
}
function dialectTrainingSection(training){
 if(!training||!Number(training.actualCount))return '';
 return '<section class="tools"><h2>方言与多角度问答</h2><div class="metric-grid"><p>原稿问答 <strong>'+RE(training.actualCount)+'</strong> 条</p><p>明确待确认 <strong>'+RE(training.anyReviewCount??'未统计')+'</strong> 条</p></div><p>'+RE(training.note||'')+'</p></section>';
}
function renderReport(entry){
 const report=entry.report||entry;
 if(entry.available===false){R('review-status').textContent=entry.message||'尚未导入知识资料';R('review-result').innerHTML='';return;}
 const organization=report.organization||{}, issues=Array.isArray(report.issues)?report.issues:list(report.issueGroups),openIssues=issues.filter(issue=>issue.status!=='resolved');
 const duplicates=list(report.duplicates),overlaps=list(report.overlaps),inputCount=report.inputFiles??report.inputCount??'未提供',uniqueCount=report.uniqueBinaryFiles??report.uniqueCount??'未提供';
 const binaryDuplicates=duplicates.filter(row=>!contentDuplicate(row)),contentDuplicates=duplicates.filter(contentDuplicate);
 const contentUniqueCount=report.uniqueContentFiles??report.uniqueSemanticFiles??report.uniqueContentCount;
 const label=entry.label||reviewLabels[entry.id]||report.title||'知识资料';
 const current=organization.current??report.currentCount,needsReview=organization.needsReview??report.needsReviewCount,disabled=organization.disabled??report.disabledCount??0;
 const articleCount=organization.articleCount??report.articleCount??'未提供';
 const organizationText=current!==undefined&&needsReview!==undefined?'首次导入分为 '+current+' 张现行卡片、'+needsReview+' 张待核实卡片、'+disabled+' 张停用旧版卡片。后续老板核实修订，以知识库当前状态为准。':'后续老板核实修订，以知识库当前状态为准。';
 R('review-status').className='';R('review-status').textContent='核对完成 · '+label+'；来源为店内提供资料，供学习参考。';
 R('review-result').innerHTML='<section class="tools"><h2>'+RE(label)+'：整理结果</h2><div class="metric-grid"><p>收到文件 <strong>'+RE(inputCount)+'</strong> 份</p><p>二进制完全相同副本 <strong>'+RE(duplicateCount(binaryDuplicates))+'</strong> 份</p><p>文件校验去重后 <strong>'+RE(uniqueCount)+'</strong> 份</p>'+((contentUniqueCount!==undefined||contentDuplicates.length)?'<p>正文重复副本 <strong>'+RE(duplicateCount(contentDuplicates))+'</strong> 份</p>':'')+(contentUniqueCount!==undefined?'<p>正文归类去重后 <strong>'+RE(contentUniqueCount)+'</strong> 份</p>':'')+'<p>知识卡片 <strong>'+RE(articleCount)+'</strong> 张</p></div><p>'+RE(organizationText)+'</p>'+(organization.note?'<p>'+RE(organization.note)+'</p>':'')+'</section>'+
 '<section class="tools"><h2>重复文件与来源重叠</h2>'+(duplicates.length?'<ul class="review-list">'+duplicates.map(duplicate=>{if(typeof duplicate==='string')return '<li>'+RE(reviewFile(duplicate))+'</li>';const original=duplicate.canonical||duplicate.duplicateOf||duplicate.original||'对应原文件',copies=duplicateCopies(duplicate);return '<li>'+RE(reviewFile(original))+'：'+copies.map(reviewFile).map(RE).join('、')+(contentDuplicate(duplicate)?'：规范化正文一致；文件二进制校验不同。':'：文件二进制校验一致。')+(duplicate.note?' '+RE(duplicate.note):'')+'</li>';}).join('')+'</ul>':'<p>本批报告未发现完全重复文件。</p>')+(overlaps.length?'<p>以下来源存在正文重叠，出处分别保留：</p><ul class="review-list">'+overlaps.map(overlap=>{if(typeof overlap==='string')return '<li>'+RE(overlap)+'</li>';const name=reviewFile(overlap.file||overlap.source||overlap.canonical||overlap.name),target=overlap.target||overlap.overlapsWith||overlap.matchedWith||overlap.coveredBy,blocks=overlap.blocks??overlap.sharedBlocks??overlap.matchedBlocks;return '<li>'+RE(name)+(target?' 与 '+RE(reviewFile(target)):'')+(blocks!==undefined?' · '+RE(Array.isArray(blocks)?blocks.length:blocks)+' 个正文块':'')+(overlap.completeTextMatch?' · 正文一致':'')+(overlap.detail||overlap.note?'：'+RE(overlap.detail||overlap.note):'')+reviewRefs(overlap.refs)+'</li>';}).join('')+'</ul>':'<p>本批报告未列出来源重叠。</p>')+'</section>'+examSection(report.exam)+dialectTrainingSection(report.dialectTraining)+
 '<section class="tools"><h2>核对项目 '+RE(issues.length)+' 组，仍需核实 '+RE(openIssues.length)+' 组</h2></section>'+issues.map((issue,index)=>'<article><span class="tag">'+RE(issue.status==='resolved'?'老板已补充确认':issue.kind||issue.type||'待核实')+'</span><h2>'+RE(index+1)+'．'+RE(issue.title||issue.label)+'</h2><p>'+RE(issue.detail||issue.description||'')+'</p>'+(issue.resolution?'<p class="proof">处理结果：'+RE(issue.resolution)+'</p>':'')+reviewRefs(issue.refs||issue.sources)+'</article>').join('')+spotCheckSection(report.externalSpotCheck)+
 (report.ownerClarifications?'<section class="tools"><h2>老板本次补充</h2><div class="review-quote">'+RE(typeof report.ownerClarifications==='string'?report.ownerClarifications:report.ownerClarifications.text)+'</div></section>':'');
}
function renderReview(data){
 reviewBatches=list(data.batches);
 if(!reviewBatches.length&&data.available!==false)reviewBatches=[data];
 const select=R('review-batch'),tools=R('batch-tools');
 if(tools)tools.hidden=reviewBatches.length<2;
 if(select){select.innerHTML=reviewBatches.map((entry,index)=>'<option value="'+RE(entry.id||String(index))+'">'+RE(entry.label||reviewLabels[entry.id]||entry.report?.title||'资料批次 '+(index+1))+'</option>').join('');select.value=data.id||reviewBatches[0]?.id||'0';}
 const selected=reviewBatches.find(entry=>entry.id===data.id)||reviewBatches[0]||data;
 renderReport(selected);
}
const batchSelect=R('review-batch');
if(batchSelect)batchSelect.addEventListener('change',()=>{const entry=reviewBatches.find((row,index)=>(row.id||String(index))===batchSelect.value);if(entry)renderReport(entry);});
async function loadReview(){
 try{
  const offline=R('review-data');if(offline){renderReview(JSON.parse(offline.textContent));return;}
  const me=await feedbackApi('/api/me');if(me.roleCode!=='owner'){R('review-status').closest('details').hidden=true;return;}
  const response=await fetch('/api/assistant/knowledge-review',{credentials:'same-origin'});
  if(response.status===401){location.href='/login?next=/knowledge-review';return;}
  const result=await response.json();if(!response.ok)throw Error(result.error?.message||'当前账号不能查看资料核对报告');renderReview(result);
 }catch(error){R('review-status').textContent=error.message;R('review-status').className='status-error';}
}
loadReview();

let feedbackReviewRows=[],feedbackNextOffset=null,feedbackLoadVersion=0;
async function feedbackApi(path,body){
 const res=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','Idempotency-Key':globalThis.crypto?.randomUUID?.()||'review-'+Date.now()+'-'+Math.random()}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error?.message||'请求失败');return data;
}
function feedbackDate(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):''}
function feedbackRow(row,canReview){
 canReview=canReview&&row.canReview!==false;
 const container=document.createElement('details');container.className='feedback-item';container.dataset.id=row.id;
 const form=canReview&&row.status==='待审核'?'<form><label>处理方式</label><select name="decision">'+(row.canApply?'<option value="apply">修改正确回答并生效</option>':'')+'<option value="resolve">已核对处理</option><option value="dismiss">不采纳</option></select>'+
 (row.canApply?'<div class="apply-fields"><label>同义问法（用 / 分隔）</label><textarea name="questions" rows="2">'+RE((row.pairEdit?row.suggestedQuestions:row.targetQuestions?.length?row.targetQuestions:row.targetSlot?[]:[row.question]).join(' / '))+'</textarea><label>正确回答（与上方问法一起生效）</label><textarea class="correct-answer" name="answer" rows="4" maxlength="1200" required>'+RE(row.suggestion||row.targetAnswer||'')+'</textarea><details><summary>回答语言与顾客权限</summary><label>普通话回答（可留空）</label><textarea name="answerMandarin" rows="2" maxlength="1200">'+RE(row.pairEdit?row.suggestionMandarin||'':row.targetAnswerMandarin||'')+'</textarea><label><input type="checkbox" name="customerVisible" '+(row.targetCustomerVisible?'checked':'')+'>允许向顾客回答</label></details></div>':'')+
 '<label>处理说明（必填）</label><textarea name="note" rows="2" maxlength="1000" required></textarea><button type="submit" class="primary">确认问答 / 提交处理</button><p class="review-message" role="status"></p></form>':'';
 container.innerHTML='<summary>'+RE(row.submittedBy)+' · '+RE(row.question)+' <span class="tag">'+RE(row.status)+'</span></summary><small>'+RE(feedbackDate(row.createdAt))+'</small><strong>问：</strong><div class="original">'+RE(row.question)+'</div><strong>原回答：</strong><div class="original">'+RE(row.originalAnswer)+'</div><strong>错误说明：</strong><p>'+RE(row.reason)+'</p>'+
 (row.pairEdit?'<strong>提交修改的问法：</strong><p class="suggested">'+RE(row.suggestedQuestions.join(' / '))+'</p>':'')+
 (row.suggestion?'<strong>建议改成的回答：</strong><p class="suggested">'+RE(row.suggestion)+'</p>':'')+
 (row.pairEdit&&row.targetId&&row.submittedDialogueVersion!==row.targetVersion?'<p class="status-error">员工提交后原问答已有更新，请对照最新版本确认。</p>':'')+
 (row.flowStage?'<small>开单步骤：'+RE(({'inventory-check':'可售库存核对',product:'选择商品',booking:'成交与预订核对',serial:'串号核对',choose:'选择具体手机',price:'售价核对',customerName:'顾客称呼',customerPhone:'顾客手机号',gift:'附件情况',giftName:'附件商品',payment:'付款方式',review:'销售草稿核对'})[row.flowStage]||'开单核对')+'</small>':'')+
 (row.targetId?'<small>对应问答：'+RE(row.targetTitle)+' · 第'+RE(row.targetVersion)+'版</small>':'')+
 (!row.canApply&&canReview&&row.status==='待审核'?'<p>这条涉及实时数据或店内操作，请核对数据或功能，再填写处理结果。</p>':'')+
 (row.reviewedAt?'<p>处理人：'+RE(row.reviewedBy)+' · '+RE(feedbackDate(row.reviewedAt))+'</p><p>'+RE(row.reviewNote)+'</p>'+ (row.correctQuestions?'<p class="suggested">生效问法：'+RE(row.correctQuestions.join(' / '))+'</p>':'')+(row.correctAnswer?'<p class="suggested">生效回答：'+RE(row.correctAnswer)+'</p>':''):'')+form;
 if(row.assignedReviewer)container.insertAdjacentHTML('beforeend','<p>指定审核人：'+RE(row.assignedReviewer)+'</p>');
 if(row.reviewers&&row.status==='待审核'){
  const controls=document.createElement('div');controls.className='review-assignment';controls.innerHTML='<label>转交审核<select><option value="">按授权范围审核</option>'+row.reviewers.map(u=>'<option value="'+RE(u.id)+'"'+(u.id===row.assignedReviewerId?' selected':'')+'>'+RE(u.name)+'</option>').join('')+'</select></label><button type="button">保存审核人</button><p role="status"></p>';container.append(controls);
  controls.querySelector('button').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await feedbackApi('/api/reviews/assign',{kind:'feedback',id:row.id,version:row.version,reviewerId:controls.querySelector('select').value});await loadFeedback(false,true);R('feedback-review-status').textContent='审核人已保存，待办会显示给指定员工。';}catch(error){controls.querySelector('p').textContent=error.message;}finally{button.disabled=false}};
 }
 const editor=container.querySelector('form');
 if(editor){
  const fields=editor.elements,decision=fields.namedItem('decision'),status=editor.querySelector('.review-message');
  const toggle=()=>{const apply=decision.value==='apply';const area=editor.querySelector('.apply-fields');if(area)area.hidden=!apply;if(fields.namedItem('answer'))fields.namedItem('answer').required=apply};
  decision.onchange=toggle;toggle();
  editor.onsubmit=async event=>{
   event.preventDefault();const button=editor.querySelector('button[type=submit]');button.disabled=true;status.textContent='正在提交…';status.dataset.error='false';
   const body={id:row.id,version:row.version,decision:decision.value,note:fields.namedItem('note').value.trim()};
   if(body.decision==='apply')Object.assign(body,{targetId:row.targetId,targetVersion:row.targetVersion,answer:fields.namedItem('answer').value.trim(),answerMandarin:fields.namedItem('answerMandarin').value.trim(),questions:fields.namedItem('questions').value.split(/[\/／\r\n]+/).map(x=>x.trim()).filter(Boolean),customerVisible:fields.namedItem('customerVisible').checked});
   try{const saved=await feedbackApi('/api/assistant/feedback/review',body);R('feedback-review-status').textContent='提交成功：'+saved.status+'，处理记录已保存。';await loadFeedback(false,true)}
   catch(error){status.dataset.error='true';status.textContent='提交失败：'+error.message}
   finally{button.disabled=false}
  };
 }
 return container;
}
async function loadFeedback(append=false,keepStatus=false){
 const version=++feedbackLoadVersion;
 try{
  const focusedId=new URLSearchParams(location.search).get('feedback'),query=new URLSearchParams({status:focusedId?'全部':R('feedback-filter').value,offset:focusedId?0:append?feedbackNextOffset||0:0});if(focusedId)query.set('id',focusedId);const data=await feedbackApi('/api/assistant/feedback?'+query);
  if(version!==feedbackLoadVersion)return;
  R('feedback-pending').textContent='待审核 '+data.pendingCount+' 条';feedbackReviewRows=append?[...feedbackReviewRows,...data.rows]:data.rows;feedbackNextOffset=data.nextOffset;
  const focusedFeedbackId=new URLSearchParams(location.search).get('feedback');
  const visible=focusedFeedbackId?feedbackReviewRows.filter(row=>row.id===focusedFeedbackId):feedbackReviewRows;
  R('feedback-list').replaceChildren(...visible.map(row=>feedbackRow(row,data.canReview)));
  if(focusedFeedbackId){R('feedback-filter').disabled=true;const focused=R('feedback-list').querySelector('.feedback-item');if(focused){focused.open=true;focused.scrollIntoView({block:'start'});R('feedback-review-status').textContent='这里只显示这一条工作助理纠错。';}else R('feedback-review-status').textContent='这条原单不存在或当前账号不可见，请返回待办刷新。';let back=R('feedback-focus-back');if(!back){back=document.createElement('a');back.id='feedback-focus-back';back.href='/knowledge-review#answer-feedback';back.textContent='查看全部纠错记录';R('feedback-review-status').after(back)}}
  R('feedback-more').hidden=!!focusedFeedbackId||data.nextOffset==null;if(!keepStatus&&!focusedFeedbackId)R('feedback-review-status').textContent=data.total?'共 '+data.total+' 条；点开记录处理。':'这里暂时没有记录。';
 }catch(error){if(version===feedbackLoadVersion)R('feedback-review-status').textContent='加载失败：'+error.message}
}
async function initFeedback(){
 if(!R('answer-feedback')||R('review-data'))return;
 try{const user=await feedbackApi('/api/me');if(user.assistantCustomerOnly||user.roleCode==='customer-assistant')return;
  R('answer-feedback').hidden=false;if(user.roleCode!=='owner'&&!user.capabilities.feedbackReview)R('answer-feedback').querySelector('h2').firstChild.textContent='我提交的纠错 ';
  await loadFeedback();if(location.hash==='#answer-feedback')R('answer-feedback').scrollIntoView({block:'start'});
 }catch(error){R('feedback-review-status').textContent=error.message}
}
if(R('feedback-reload'))R('feedback-reload').onclick=()=>loadFeedback();
if(R('feedback-filter'))R('feedback-filter').onchange=()=>loadFeedback();
if(R('feedback-more'))R('feedback-more').onclick=()=>loadFeedback(true);
initFeedback();

