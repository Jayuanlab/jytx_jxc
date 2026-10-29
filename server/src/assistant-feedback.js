'use strict';
const c=require('./common'),dialogue=require('./assistant-dialogue'),delegation=require('./review-delegation');
function staff(user){c.permit(user,'learn');if(user.assistantCustomerOnly||user.roleCode==='customer-assistant')throw new c.HttpError(403,'顾客接待账号不能提交或查看店内纠错');}
function clean(value,label,max,optional=false){if(optional&&(value==null||!String(value).trim()))return '';const text=c.text(value,label);if(text.length>max)throw new c.HttpError(400,label+'过长');return text;}
function targetFor(store,row){
 if(!dialogue.canCustomizeQuestion(row.question))return null;
 const rows=dialogue.list(store,{roleCode:'owner'}).items;
 return rows.find(x=>x.id===row.dialogueId)||dialogue.find(store,row.question)||null;
}
function draft(store,user,query){
 staff(user);const question=clean(query.get('question'),'问题',240),dialogueId=clean(query.get('dialogueId'),'问答编号',160,true)||null;
 if(!dialogue.canCustomizeQuestion(question))throw new c.HttpError(400,'实时账目和店内操作请提交纠错核对，不能改成固定答案');
 const target=targetFor(store,{question,dialogueId});
 if(dialogueId&&target?.id!==dialogueId)throw new c.HttpError(404,'没有找到这条问答，请重新提问');
 return {items:target?[{id:target.id,title:target.title,questions:target.questions,answer:target.answer,answerMandarin:target.answerMandarin,version:target.version,slot:target.slot,enabled:target.enabled,customerVisible:target.customerVisible}]:[],canManage:false,requiresReview:true};
}
function list(store,user,query=new URLSearchParams()){
 staff(user);if(query.get('draft')==='1')return draft(store,user,query);const owner=user.roleCode==='owner',all=(store.assistantAnswerFeedback||[]).filter(x=>owner||x.submittedById===user.id||delegation.allowed(store,user,'feedback',x)),status=query.get('status')||'待审核';
 if(!['待审核','已生效','已处理','不采纳','全部'].includes(status))throw new c.HttpError(400,'纠错状态不正确');
 const offset=Number(query.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw new c.HttpError(400,'页码不正确');
 const focus=query.get('id')||'';const rows=all.filter(x=>focus?x.id===focus:status==='全部'||x.status===status).sort((a,b)=>status==='待审核'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));
 return {canReview:c.capabilities(user).feedbackReview,canAssign:owner,pendingCount:all.filter(x=>x.status==='待审核').length,total:rows.length,rows:rows.slice(offset,offset+50).map(row=>{
  const canReview=delegation.allowed(store,user,'feedback',row),extras={canReview,...(owner?{reviewers:delegation.reviewers(store,'feedback',row.submittedById)}:{})};
  if(!canReview)return {...row,...extras};
  const target=targetFor(store,row);return {...row,...extras,canApply:row.correctionOnly!==true&&dialogue.canCustomizeQuestion(row.question),targetId:target?.id||null,targetVersion:target?.version||0,targetTitle:target?.title||'新增问答',targetAnswer:target?.answer||'',targetAnswerMandarin:target?.answerMandarin||'',targetQuestions:target?.questions||[],targetSlot:target?.slot||null,targetCustomerVisible:target?.customerVisible===true};
 }),nextOffset:offset+50<rows.length?offset+50:null};
}
function submit(store,user,body){
 staff(user);
 const row={id:c.id('AFB'),question:clean(body.question,'问题',240),originalAnswer:clean(body.originalAnswer,'原回答',12000),reason:clean(body.reason,'错误说明',1000),suggestion:clean(body.suggestion,'建议回答',1200,true),dialogueId:clean(body.dialogueId,'问答编号',160,true)||null,submittedById:user.id,submittedBy:user.name,createdAt:c.now(),status:'待审核',version:1};
 if(body.pairEdit===true){
  const correctionOnly=body.correctionOnly===true;
  if(!correctionOnly&&!dialogue.canCustomizeQuestion(row.question))throw new c.HttpError(400,'实时账目和店内操作不能改成固定答案，请提交纠错核对');
  const target=targetFor(store,row);
  if(row.dialogueId&&target?.id!==row.dialogueId)throw new c.HttpError(404,'原问答不存在，请重新提问');
  if(!Number.isSafeInteger(body.dialogueVersion)||body.dialogueVersion!==(target?.version||0))throw new c.HttpError(409,'原问答已被修改，请取消编辑后重新提问，再提交审核');
  if(!Array.isArray(body.suggestedQuestions)||body.suggestedQuestions.length>40)throw new c.HttpError(400,'同义问法最多40条');
  const questions=[...new Set(body.suggestedQuestions.map(value=>clean(value,'同义问法',120)))];
  if(!questions.length&&!target?.slot)throw new c.HttpError(400,'请填写至少一种问法');
  if(!correctionOnly&&questions.some(value=>!dialogue.canCustomizeQuestion(value)))throw new c.HttpError(400,'店内查询和操作不能改成固定问答，请提交纠错核对');
  if(!dialogue.answerOptions(row.suggestion).length)throw new c.HttpError(400,'请填写正确回答');
  const mandarin=clean(body.suggestionMandarin,'普通话建议回答',1200,true);
  if(mandarin&&!dialogue.answerOptions(mandarin).length)throw new c.HttpError(400,'请填写有效的普通话回答');
  Object.assign(row,{pairEdit:true,correctionOnly,suggestedQuestions:questions,suggestionMandarin:mandarin,submittedDialogueVersion:body.dialogueVersion,sourceKind:clean(body.sourceKind,'回答来源',80,true),flowStage:clean(body.flowStage,'开单步骤',80,true)});
 }
 store.assistantAnswerFeedback||=[];store.assistantAnswerFeedback.unshift(row);c.audit(store,user,'assistant:feedback-submit',row.id+' · '+row.question);
 return row;
}
function review(store,user,body){
 c.permit(user,'feedbackReview');const row=(store.assistantAnswerFeedback||[]).find(x=>x.id===body.id);
 if(!row)throw new c.HttpError(404,'纠错记录不存在');
 delegation.permitReview(store,user,'feedback',row);
 if(row.status!=='待审核'||body.version!==row.version)throw new c.HttpError(409,'这条纠错已被处理，请刷新查看');
 if(!['apply','resolve','dismiss'].includes(body.decision))throw new c.HttpError(400,'请选择处理方式');
 const note=clean(body.note,'处理说明',1000),at=c.now();let saved;
 if(body.decision==='apply'){
  if(row.correctionOnly===true||!dialogue.canCustomizeQuestion(row.question))throw new c.HttpError(400,'实时账目和店内操作不能改成固定答案，请核对数据或功能后填写处理说明');
  const target=targetFor(store,row);
  if(body.targetId!==(target?.id||null)||body.targetVersion!==(target?.version||0))throw new c.HttpError(409,'原问答已被修改，请刷新后核对最新回答');
  if(!Array.isArray(body.questions))throw new c.HttpError(400,'请核对同义问法');
  saved=dialogue.saveReviewed(store,user,{id:target?.id,version:target?.version||0,title:target?.title||row.question.slice(0,80),questions:[...new Set([...(target||row.pairEdit?[]:[row.question]),...body.questions])],answer:body.answer,answerMandarin:body.answerMandarin||body.answer,enabled:target?.enabled!==false,customerVisible:body.customerVisible===true},row);
 }
 Object.assign(row,{status:saved?'已生效':body.decision==='resolve'?'已处理':'不采纳',version:row.version+1,reviewedAt:at,reviewedById:user.id,reviewedBy:user.name,reviewNote:note,...(saved?{appliedDialogueId:saved.id,appliedDialogueVersion:saved.version,correctAnswer:saved.answer,correctQuestions:saved.questions,correctAnswerMandarin:saved.answerMandarin}: {})});
 c.audit(store,user,'assistant:feedback-review',row.id+' · '+row.status+' · '+note);return row;
}
module.exports={list,submit,review,draft};
