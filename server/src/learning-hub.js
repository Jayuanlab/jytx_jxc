'use strict';
const c=require('./common'),learning=require('./learning');
const scenarios=[
 {id:'usage',name:'移动业务推荐',question:'顾客说：套餐太贵，流量还老是不够。你怎么接话？',tips:['先问当前月费和通话、流量用量','查现行套餐再比较，不编造优惠','说明合约、办理条件，交营业员核对']},
 {id:'price',name:'手机销售技巧',question:'顾客说：网上比这里便宜，我为什么要在你这里买？',tips:['先听顾客在比较哪款、预算多少','演示顾客在意的功能和可核实的服务','不贬低同行，不随口承诺未核实的价格']},
 {id:'care',name:'全光与看家',question:'顾客想装宽带，也想看看家里老人，怎么介绍？',tips:['了解家中网络、房间和实际照看需求','先查现行全光与移动看家活动','核对有效期、合约期和室外安装费用']}
];
function staff(user){c.permit(user,'learn');if(user.assistantCustomerOnly||user.roleCode==='customer-assistant')throw new c.HttpError(403,'顾客账号不能参加员工学习');}
function stats(store,user) {
 staff(user);
 const mine=(key,field)=>(store[key]||[]).filter(x=>x[field]===user.id);
 const learned=mine('learningRecords','employeeId'),work=mine('workJournals','employeeId'),feedback=mine('assistantAnswerFeedback','submittedById');
 const approved=learned.filter(x=>x.status==='已通过'),approvedWork=work.filter(x=>x.status==='已核定');
 const contributionPoints=(store.learningContributionAwards||[]).filter(x=>x.employeeId===user.id);
 const since=Date.now()-30*86400000;
 return {points:[...approved,...approvedWork,...contributionPoints].reduce((n,x)=>n+Number(x.points||0),0),learningPoints:approved.reduce((n,x)=>n+Number(x.points||0),0),contributionPoints:contributionPoints.reduce((n,x)=>n+x.points,0),
  activeDays:new Set([...learned,...work,...feedback].filter(x=>Date.parse(x.createdAt)>=since).map(x=>c.day(x.createdAt))).size,
  submissions:learned.length,contributions:feedback.filter(x=>['已生效','已处理'].includes(x.status)).length,pending:learned.filter(x=>x.status==='待审核').length,
  scenarios,canReview:user.roleCode==='owner',
  ... (user.roleCode==='owner'?{pendingContributions:(store.assistantAnswerFeedback||[]).filter(x=>['已生效','已处理'].includes(x.status)&&!(store.learningContributionAwards||[]).some(a=>a.feedbackId===x.id)).map(x=>({id:x.id,employeeName:x.submittedBy,question:x.question,status:x.status}))}:{})};
}
function practice(store,user,body) {
 staff(user);const s=scenarios.find(x=>x.id===body.scenario);
 if(!s)throw new c.HttpError(400,'请选择练习场景');
 const answer=c.text(body.answer,'练习回答');
 if(answer.length<10||answer.length>1000)throw new c.HttpError(400,'练习回答请写10至1000字');
 const today=c.day(),existing=(store.learningRecords||[]).find(x=>x.employeeId===user.id&&x.practiceScenario===s.id&&c.day(x.createdAt)===today);
 if(existing)return {record:existing,duplicate:true,coaching:s.tips};
 const reflection=c.text(body.reflection,'复盘');
 const row=learning.create(store,user,{type:'培训',event:'实战练习：'+s.question,learned:answer,reflection});
 row.practiceScenario=s.id;return {record:row,duplicate:false,coaching:s.tips};
}
function award(store,user,body){
 if(user.roleCode!=='owner')throw new c.HttpError(403,'仅老板可核定贡献积分');
 const row=(store.assistantAnswerFeedback||[]).find(x=>x.id===body.id&&['已生效','已处理'].includes(x.status));
 if(!row)throw new c.HttpError(400,'请先完成问答纠错审核再核定贡献积分');
 if((store.learningContributionAwards||[]).some(x=>x.feedbackId===row.id))throw new c.HttpError(409,'这条贡献已核分');
 const points=c.number(body.points,'贡献积分',0);if(!Number.isSafeInteger(points)||points>1000)throw new c.HttpError(400,'积分须为0至1000的整数');
 const entry={id:c.id('LCA'),feedbackId:row.id,employeeId:row.submittedById,employeeName:row.submittedBy,points,note:c.text(body.note,'核分说明').slice(0,500),createdAt:c.now(),reviewedBy:user.id};
 (store.learningContributionAwards ||= []).push(entry);c.audit(store,user,'learning:contribution-award',entry.id+' '+points);return entry;
}
module.exports={stats,practice,award};
