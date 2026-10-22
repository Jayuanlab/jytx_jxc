'use strict';
const c=require('./common'),crypto=require('node:crypto');
const norm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s，,。.!！?？、：:“”"‘’']/g,'');
const privateWords=/毛利|利润|成本|进价|采购价|拿货价|工资|底薪|提成|酬金|佣金|积分|奖励|红包|出勤|考勤|签到|签退|营业额|销量|账套|流水|进货|供应商|供货商|应收|应付|银行账户|店内|员工|老板娘|收款账户|库存数量|串号|串码|imei|营业厅|厅店|渠道商|代理商|宇光|益众|达量|稽核|办理路径|受理路径|生态产品订购|H折扣/i;
const operational=/提交|审批|删除|红冲|改价|调价|备份|还原|清空|导出|开单|销售单|接待单|采购单|库存|仓库|单号|订单|今天.*(?:卖|收|赚|进|办了)/;
const welcomeReplies=['你好！','你好！欢迎光临聚友通信','你好！欢迎来到中国移动南溪新场镇特许经营店','你好！什么问题你都可以问我','你好！很高兴为你服务','你好，很高兴回答你问到的问题'];
const presets=[
 ['social:greeting','顾客迎宾与问候',['你好','您好','喂','在吗','顾客到店','有顾客到','顾客来了','有顾客来了','开始接待','迎宾'],welcomeReplies.join(' / '),welcomeReplies.join(' / ')],
 ['social:business-choice','顾客来办业务',['我来办一个业务','我想办业务'],'要得嘛！你要办号卡、充值、宽带、套餐，还是买手机、维修？','您要办理号卡、充值、宽带、套餐，还是购机、维修？'],
 ['tariff:current-plan','办卡：了解原来的卡',['给我办张卡','我来办一张卡','我来买一张卡号'],'你原来用啥子卡？一个月大概交好多钱嘛？新办卡也可以直接说哈。','您原来使用什么套餐，每月大概支出多少？新办卡也可以直接说明。'],
 ['tariff:use-check','办卡：原来的用量是否够用',[],'现在通话和流量够不够用？有没有用超，话费变贵嘛？','现在的通话和流量够用吗？是否超套导致话费变高？'],
 ['tariff:budget','办卡：每月预算',[],'一个月大概想花好多钱嘛？','每月大概预算多少钱？'],
 ['tariff:usage','办卡：流量还是通话',[],'你是流量用得多，还是电话分钟用得多嘛？','您主要是流量用得多，还是通话分钟用得多？'],
 ['tariff:region','办卡：本地还是外地',[],'是在重庆本地用，还是经常去外地用哦？','主要在重庆本地使用，还是经常到外地？'],
 ['tariff:billing-concern','套餐：核对话费贵的原因',[],'是用超了，还是有附加业务、优惠到期嘛？先查原因，再看换哪种。','是超套、附加业务还是优惠到期？先核对原因，再比较方案。'],
 ['qa:id-brought','身份证已带在身上',['带了身份证的','身份证在我身上','身份证在这里','身份证在我包包里','给你我的身份证'],'要得，请交给营业员当面核验哈。带了身份证，还要核本人身份和办理资格。','请交给营业员当面核验。已带身份证，还需要核实本人身份和办理资格。'],
 ['qa:choose-number','顾客准备选号',['那我先选号码','我想选号码','帮我选一个号码'],'你有啥子喜欢的数字，或者有特殊含义的数字嘛？营业员从实际可选号码里帮你筛，特殊号码的条件也要先核清楚。','您有喜欢的数字或特殊含义的数字吗？营业员从实际可选号码中筛选，并核对特殊号码的办理条件。'],
 ['qa:id-question','办业务是否带身份证',['身份证带了没得','身份证带起没有','身份证在身上吗'],'办实名业务要营业员核验身份。你身份证带起没有嘛？','实名业务需要营业员核验身份。您带身份证了吗？'],
 ['qa:card-choice','顾客选定套餐',['那我办一个39的嘛','那我办39元的'],'要得嘛，营业员先核对具体套餐版本、分钟、流量范围和实际总费用，再带你选号确认。','营业员先核对具体套餐版本、分钟、流量范围和实际总费用，再带您选号确认。'],
].map(([id,title,questions,answer,answerMandarin])=>({id,title,questions,answer,answerMandarin,enabled:true,customerVisible:true,version:0,...(id==='social:greeting'?{randomReplies:true}:{}),slot:id.startsWith('social:')||id.startsWith('tariff:')?id:null}));
function defaults(store){
 const articles=(store.employeeKnowledge||[]).filter(x=>x.importBatch==='customer-talk-20261009'&&x.conversationTopic&&x.customerQuestions?.length&&!x.dialectMappings?.length);
 return [...presets,...articles.map(x=>({id:'knowledge:'+x.id,title:x.title,questions:x.customerQuestions,answer:x.summaryDialect||x.summary||'',answerMandarin:x.summary||'',enabled:x.enabled!==false,customerVisible:x.policyStatus==='current'&&!x.sourceRevisionNote&&!privateWords.test(x.summary||'')&&!privateWords.test(x.summaryDialect||''),version:0,slot:null,knowledgeId:x.id}))];
}
function effective(store){const base=defaults(store),overrides=store.assistantDialogues||[];return [...base.map(row=>({...row,...overrides.find(x=>x.id===row.id)})),...overrides.filter(row=>!base.some(x=>x.id===row.id))];}
function list(store,user){c.permit(user,'manageUsers');return {items:effective(store),canManage:true};}
function save(store,user,payload){
 c.permit(user,'manageUsers');return persist(store,user,payload);
}
function saveReviewed(store,user,payload,feedback){
 require('./review-delegation').permitReview(store,user,'feedback',feedback);return persist(store,user,payload);
}
function persist(store,user,payload){
 const rows=effective(store),before=payload.id?rows.find(x=>x.id===payload.id):null;
 if(payload.id&&!before)throw new c.HttpError(404,'这条问答不存在');
 if(!Number.isSafeInteger(payload.version)||payload.version!==(before?.version||0))throw new c.HttpError(409,'问答已被修改，请重新加载后再保存');
 const field=(v,label,max,optional=false)=>{if(optional&&(!v||!String(v).trim()))return '';const t=c.text(v,label);if(t.length>max)throw new c.HttpError(400,label+'过长');return t;};
 const title=field(payload.title,'问答名称',80),answer=field(payload.answer,'川渝话回答或提示',1200),answerMandarin=field(payload.answerMandarin,'普通话回答',1200,true);
 if(!answerOptions(answer).length||answerMandarin&&!answerOptions(answerMandarin).length)throw new c.HttpError(400,'请填写至少一种有效回答，多个回答用 / 分隔');
 if(!Array.isArray(payload.questions)||payload.questions.length>40)throw new c.HttpError(400,'顾客说法最多40条');
 const questions=[...new Set(payload.questions.map(x=>field(x,'顾客说法',120)))];if(!questions.length&&!before?.slot)throw new c.HttpError(400,'请至少填写一种顾客说法');
 if(questions.some(q=>operational.test(q)||privateWords.test(q)))throw new c.HttpError(400,'店内查询和操作请在“教助理理解说法”维护，不能改成固定顾客回答');
 if(typeof payload.enabled!=='boolean'||typeof payload.customerVisible!=='boolean')throw new c.HttpError(400,'请选择启用状态及是否可向顾客回答');
 if(payload.customerVisible&&(privateWords.test(answer)||privateWords.test(answerMandarin)))throw new c.HttpError(400,'顾客回答含店内信息，请修改或关闭“可向顾客回答”');
 for(const row of rows){if(row.id===before?.id||!row.enabled)continue;if((store.assistantDialogues||[]).some(x=>x.id===row.id)&&row.questions.some(q=>questions.some(x=>norm(q)===norm(x))))throw new c.HttpError(409,'这条顾客说法已在“'+row.title+'”定义');}
 const at=c.now(),id=before?.id||c.id('DQA'),history=[...(before?.history||[])];
 if(before)history.push({version:before.version,title:before.title,questions:before.questions,answer:before.answer,answerMandarin:before.answerMandarin,enabled:before.enabled,customerVisible:before.customerVisible,changedAt:at,changedBy:user.name,changedById:user.id});
 const result={id,title,questions,answer,answerMandarin,enabled:payload.enabled,customerVisible:payload.customerVisible,version:(before?.version||0)+1,slot:before?.slot||null,knowledgeId:before?.knowledgeId||null,history,updatedAt:at,updatedBy:user.name};
 store.assistantDialogues||=[];const index=store.assistantDialogues.findIndex(x=>x.id===id);if(index<0)store.assistantDialogues.push(result);else store.assistantDialogues[index]=result;
 c.audit(store,user,'assistant:dialogue-save',title+' · 第'+result.version+'版 · '+(result.customerVisible?'顾客可用':'仅店内'));
 return result;
}
function find(store,question,{customer=false}={}){
 if(operational.test(question)||privateWords.test(question))return null;
 return effective(store).filter(x=>x.enabled&&(!customer||x.customerVisible)).sort((a,b)=>(b.version||0)-(a.version||0)).find(row=>row.questions.some(q=>norm(q)===norm(question)))||null;
}
function answerOptions(value){return [...new Set(String(value||'').split(/[\/／]+/).map(x=>x.trim()).filter(Boolean))];}
function promptKind(value,fallback){
 const q=String(value||'');
 if(/身份证|证件/.test(q)&&/带|拿|身上|在.*(?:包|哪)/.test(q))return 'identity-check';
 if(/自己.*(?:选|挑)|(?:我|帮你|帮您).*(?:选|挑)/.test(q)&&/(?:自己|帮)/.test(q))return 'card-choice';
 if(/够不够|够用|用超|超套/.test(q))return 'use-check';
 if(/本地|外地|重庆|云阳|出差/.test(q)&&/用|去|在/.test(q))return 'region';
 if(/流量|上网|分钟|通话|电话|话费/.test(q)&&/多|为主/.test(q))return 'usage';
 if(/(?:原来|之前|以前|现在|目前|现用).*(?:卡|套餐|资费)|用.*卡.*(?:资费|套餐)/.test(q))return 'current-plan';
 if(/预算|每月|一个月|好多钱/.test(q))return 'budget';
 return fallback;
}
function text(row,style,{answered=[],fallback}={}){
 const value=style==='mandarin'?row.answerMandarin||row.answer:row.answer;
 // Greeting presets and explicitly saved replies use / for alternatives; imported source text stays intact.
 if(!row.version&&!row.randomReplies)return value;
 const choices=answerOptions(value),eligible=choices.filter(choice=>!answered.includes(promptKind(choice)));
 if(!eligible.length)return fallback===undefined?(choices[0]||''):fallback;
 return eligible.length===1?eligible[0]:eligible[crypto.randomInt(eligible.length)];
}
const promptFollowups={
 'identity-check':['带了身份证','还没带身份证'], 'card-choice':['你帮我推荐','我自己选'],
 'region':['本地用','经常去外地'], 'usage':['流量用得多','打电话多','两样都多'],
 'budget':['大概60元','最多100元'], 'use-check':['够用但想省钱','流量用超了','通话不够用'],
};
function manual(row,style){return {answer:text(row,style),sources:[{id:row.id,label:row.title+' · 第'+row.version+'版',href:'/assistant#dialogue-panel'}],metrics:{kind:'customer-dialogue',replyStyle:style,dialogueId:row.id,version:row.version,referenceOnly:true}};}
function customize(store,result,style,{customer=false,answered=[],pool=null}={}){
 const knowledgeOverride=result.metrics?.kind==='customer-talk-guidance'&&!result.metrics.originalRequested?(store.assistantDialogues||[]).find(x=>x.knowledgeId===result.metrics.articleId):null;
 if(knowledgeOverride){
  if(!knowledgeOverride.enabled||customer&&!knowledgeOverride.customerVisible)return {...result,answer:'这项接待问答暂不可用，请营业员当面核对。',sources:[],action:undefined,metrics:{kind:'customer-dialogue',replyStyle:style,referenceOnly:true,unavailable:true}};
  return {...result,...manual(knowledgeOverride,style),action:undefined};
 }
 const hint=result.conversationHint,tariff=hint?.topic==='tariff-recommendations',profile=tariff?hint.profile||{}:{},known=[...answered];
 if(profile.region)known.push('region');if(profile.usage)known.push('usage');if(profile.budgetMax||profile.budgetTarget)known.push('budget');
 if(profile.skipPrevious||profile.currentMonthlySpend||profile.previousPlanName)known.push('current-plan');
 if(profile.enough!==undefined||profile.overage!==undefined||profile.billingConcern?.length)known.push('use-check');
 const slot=result.metrics?.kind==='assistant-social'?'social:'+result.metrics.topic:tariff&&hint.awaiting?'tariff:'+hint.awaiting:null;
 const rows=effective(store),available=x=>x.enabled&&(!customer||x.customerVisible);
 let row=rows.find(x=>x.id===slot&&available(x)),poolRow=tariff&&pool?rows.find(x=>x.id===pool&&x.slot?.startsWith('tariff:')&&available(x)):null;
 const alternatives=x=>x?.version?answerOptions(style==='mandarin'?x.answerMandarin||x.answer:x.answer):[];
 if(!poolRow&&tariff&&alternatives(row).length>1)poolRow=row;
 const pending=poolRow?alternatives(poolRow).filter(value=>!known.includes(promptKind(value,poolRow.slot.slice(7)))):[];
 const activePool=pending.length?poolRow:null;
 if(activePool&&!result.metrics?.catalog&&!result.metrics?.international)row=activePool;
 if(!row)return tariff?{...result,conversationHint:{...hint,dialogueAnswered:answered,...(activePool?{dialoguePool:activePool.id}:{})}}:result;
 const picked=row===activePool?(pending.length===1?pending[0]:pending[crypto.randomInt(pending.length)]):text(row,style,{answered:known,fallback:result.answer});
 const awaiting=tariff&&row.version?promptKind(picked,row===activePool?row.slot.slice(7):hint.awaiting):hint?.awaiting;
 return {...result,answer:picked,metrics:{...result.metrics,dialogueId:row.id,dialogueVersion:row.version,...(row===activePool?{needsClarification:true}:{})},
  ...(tariff?{conversationHint:{...hint,awaiting,dialogueAnswered:answered,...(activePool?{dialoguePool:activePool.id}:{})},...(awaiting!==hint.awaiting&&promptFollowups[awaiting]?{followups:promptFollowups[awaiting].map(question=>({label:question,question}))}:{})}:{}),
  sources:[...(result.sources||[]),{id:row.id,label:row.title+' · 第'+row.version+'版',href:'/assistant#dialogue-panel'}]};
}
function canAnswerKnowledge(store,id,customer){const row=(store.assistantDialogues||[]).find(x=>x.knowledgeId===id);return !row||row.enabled&&(!customer||row.customerVisible);}
function canCustomizeQuestion(value){return typeof value==='string'&&value.trim().length>0&&value.trim().length<=120&&!operational.test(value)&&!privateWords.test(value);}
module.exports={list,save,saveReviewed,find,text,manual,customize,privateWords,canAnswerKnowledge,answerOptions,canCustomizeQuestion};
