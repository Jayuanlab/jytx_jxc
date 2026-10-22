'use strict';
const c=require('./common'),context=require('./capacity/context');
const kinds={feedback:{collection:'assistantAnswerFeedback',cap:'feedbackReview',subject:'submittedById'},learning:{collection:'learningRecords',cap:'learningReview',subject:'employeeId'}};
function staff(store){const branch=context.current().branchId;return (store.users||[]).filter(u=>u.status==='active'&&!u.assistantCustomerOnly&&u.roleCode!=='customer-assistant'&&(!u.branchIds?.length||u.roleCode==='owner'||u.branchIds.includes(branch)));}
function allowed(store,user,kind,row){
 const cfg=kinds[kind];if(!cfg||user.assistantCustomerOnly||user.roleCode==='customer-assistant')return false;
 if(user.roleCode==='owner')return true;
 if(!staff(store).some(u=>u.id===user.id))return false;
 if(!c.capabilities(user)[cfg.cap]||row[cfg.subject]===user.id)return false;
 if(row.assignedReviewerId)return row.assignedReviewerId===user.id;
 return (user.reviewSubjectIds||[]).includes(row[cfg.subject]);
}
function permitReview(store,user,kind,row){if(!allowed(store,user,kind,row))throw new c.HttpError(403,'只能审核老板指定给你的内容，不能审核自己提交的内容');}
function reviewers(store,kind,subjectId){return staff(store).filter(u=>u.id!==subjectId&&c.capabilities(u)[kinds[kind].cap]).map(u=>({id:u.id,name:u.name}));}
function assign(store,user,body){
 c.permit(user,'manageUsers');const cfg=kinds[body.kind];if(!cfg)throw new c.HttpError(400,'请选择问答或学习审核');
 const row=(store[cfg.collection]||[]).find(x=>x.id===body.id);if(!row)throw new c.HttpError(404,'审核内容不存在');
 if(row.status!=='待审核'||body.version!==(row.version||1))throw new c.HttpError(409,'审核内容已变化，请刷新后转交');
 const reviewerId=body.reviewerId||null;
 if(reviewerId&&!reviewers(store,body.kind,row[cfg.subject]).some(u=>u.id===reviewerId))throw new c.HttpError(400,'请选择已获相应审核权限的在职员工，不能指定提交人本人');
 const before=row.assignedReviewerId||null,at=c.now(),reviewer=staff(store).find(u=>u.id===reviewerId);
 row.assignmentHistory||=[];row.assignmentHistory.push({from:before,to:reviewerId,by:user.id,byName:user.name,at});
 Object.assign(row,{assignedReviewerId:reviewerId,assignedReviewer:reviewer?.name||null,assignedAt:at,version:(row.version||1)+1});
 c.audit(store,user,'review:assign',{kind:body.kind,id:row.id,before,reviewerId,reviewer:reviewer?.name||'按授权范围审核'});
 return {id:row.id,version:row.version,assignedReviewerId:reviewerId,assignedReviewer:row.assignedReviewer};
}
module.exports={staff,allowed,permitReview,reviewers,assign};
