const c=require('./common'),feedback=require('./assistant-feedback');
const redact=value=>String(value||'').replace(/(?<!\d)(1[3-9]\d{9})(?!\d)/g,phone=>phone.slice(0,3)+'****'+phone.slice(-4)).replace(/(?:Bearer\s+|sk_|ks_)[A-Za-z0-9_-]{12,}/gi,'[已隐去凭证]');
function capture(store,user,question,result){
 // 机器人问答暂停自动上报；历史记录保留供现场纠正。
 return null;
 if(result.mode!=='store'||result.unresolved!==true||user.assistantCustomerOnly||!c.capabilities(user).learn)return null;
 if(/口令|密码|验证码|密钥|私钥/.test(question))return null;
 const q=redact(question).trim().slice(0,240),answer=redact(result.answer).trim().slice(0,12000);
 if(!q||!answer)return null;
 store.assistantAnswerFeedback||=[];
 const recent=store.assistantAnswerFeedback.find(row=>row.autoCaptured&&row.status==='待审核'&&row.submittedById===user.id&&row.question===q);
 if(recent)return recent.id;
 const row=feedback.submit(store,user,{question:q,originalAnswer:answer,reason:'工作助理未能给出可核实回答，系统自动记录待核对',suggestion:''});
 row.autoCaptured=true;row.source='work-assistant';return row.id;
}
module.exports={capture};
