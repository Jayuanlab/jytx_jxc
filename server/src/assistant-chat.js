'use strict';
const personal=require('./personal-assistant'),dialogue=require('./assistant-dialogue'),c=require('./common');
const {createClient,identity}=require('./assistant-external-chat');
const defaultClient=createClient();
const roles=require('./assistant-roles'),kitty=require('./assistant-kitty');
const internal=/库存|仓库|订单|单号|开单|销售单|接待单|采购|订货|收款|付款|到账|退款|退货|红冲|备份|恢复|复原|清空|删除|审批|权限|口令|密码|(?:今天|本月|本周).{0,8}(?:卖|收|赚|进|办了)|(?:^|\D)\d{11,18}(?:\D|$)|(?:Authorization|Bearer|ks_[a-z0-9])/i;
const privateReply=/底价|拿货价|进货价|采购价|毛利|利润|提成|工资|酬金|佣金|内部口令|API\s*key|ks_[a-z0-9]{12}/i;
function eligible(result,question,hasContext){
 const kind=result.metrics?.kind;
 const helpLink=['customer-talk-guidance','tariff-recommendations'].includes(kind)&&result.action?.type==='navigate'&&/^\/knowledge(?:#|$)/.test(result.action.href);
 if(result.action&&!helpLink||result.saleFlow||result.draft||result.table||result.metrics?.restricted)return false;
 if((result.metrics?.dialogueVersion||0)>0||kind==='customer-dialogue'&&(result.metrics?.version||0)>0||result.metrics?.unavailable)return false;
 if(internal.test(question)||dialogue.privateWords.test(question))return false;
 if(result.metrics?.kind==='customer-talk-guidance')return !(result.metrics.originalRequested||result.metrics.automaticGuidancePaused||result.metrics.dialectTeaching)&&(!result.metrics.needsReview||result.metrics.sourceTier==='store_training'&&result.metrics.summaryOnly);
 if(result.metrics?.kind==='customer-dialogue')return result.unresolved===true||result.metrics.dialogueId?.startsWith('knowledge:')===true;
 if(result.metrics?.kind==='assistant-social')return ['greeting','working'].includes(result.metrics.topic);
 if(result.metrics?.kind==='tariff-recommendations')return !!(result.metrics.needsClarification||result.metrics.noVerifiedMatch);
 return result.unresolved===true;
}
function flowBundleQuote(previous,question){
 if(!previous?.business||!previous.business.hits.some(hit=>/流量包/.test(hit.std)))return null;
 if(!/流量|通用|全国|定向|多少个?G/i.test(question)&&! /^(?:那|这个|这|那个)?[\d一二两三四五六七八九十百]+\s*(?:块|元)(?:钱)?(?:的)?(?:呢|怎么样)?[？?。\s]*$/.test(question)||/办理|办一个|帮我办|购买|买一个|充值|扣款/.test(question))return null;
 const fee=question.match(/(?:那|这个|这|那个)?(\d{1,3})\s*(?:块|元)/)?.[1]||require('./assistant-tariff-query').parseProfile(question).budgetTarget;
 if(!fee)return null;
 const segment=previous.business.reply.match(new RegExp('(?:^|[，,；;。])\\s*'+fee+'(?:块(?:钱)?|元)[^。；;]*?(?=[，,；;。]\\s*\\d{1,3}(?:块(?:钱)?|元)|[；;。]|$)'))?.[0];
 if(!segment)return null;
 return {reply:segment.replace(/^[，,；;。\s]+|[；;\s]+$/g,''),intent:'biz',hits:previous.business.hits,context:previous};
}
async function ask(store,user,payload,options={}){
 payload={...payload,question:require('./assistant-language').normalize(payload.question,{customer:payload.mode==='customer'||user.assistantCustomerOnly||user.roleCode==='customer-assistant'})};
 // Keep the existing permission checks, real ledger answers and draft flow.
 const local=personal.ask(store,user,payload),client=options.client||defaultClient;
 if(local.mode==='store'&&require('./assistant-continuity').identityQuestion(payload.question))return {...local,answer:'我是门店工作助理，负责门店系统使用、按权限查询业务、解答移动业务和手机配置问题；资费与参数以已核实资料为准。',sources:[],followups:[],action:null,draft:null,table:null,saleFlow:null,unresolved:false,metrics:{kind:'assistant-identity',conversationContinued:false},context:{question:String(payload.question).slice(0,240),topicQuestion:String(payload.question).slice(0,240),userId:user.id,at:Date.now(),mode:'store'}};
 if(local.metrics?.kind==='live-clock'||local.metrics?.kind?.startsWith('screen-'))return local;
 const contextualQuestion=local.mode==='store'&&local.metrics?.conversationContinued?require('./assistant-context').resolve(payload.question,payload.context,user).question:payload.question;
 const id=identity(options.scope,user,local.mode),previous=payload.context?.mode===local.mode?payload.context?.externalChat:null;
 if(local.mode==='store'&&(roles.offWork(payload.question)||local.unresolved&&!roles.workQuestion(contextualQuestion)&&!local.metrics?.conversationContinued&&!client.hasContext(previous,id)))return {...local,answer:roles.personal(user)?'这是个人生活的话题，点“我的个人助理”继续聊。':'工作助理只用于门店经营、业务学习和实战练习。你想查业务，还是练一下接待？',sources:[],followups:[],metrics:{kind:'work-scope',restricted:true},...(roles.personal(user)?{action:{type:'navigate',href:'/companion',label:'我的个人助理'}}:{action:null})};
 // Approved dialogue replies must win before casual or business models are consulted.
 const selected=dialogue.find(store,payload.question,{customer:local.mode==='customer'});
 if(selected&&(store.assistantDialogues||[]).some(row=>row.id===selected.id&&row.enabled!==false))return local;
 // Self-description is local and does not need a tariff lookup or an uncertain quote.
 if(local.mode==='customer'&&local.metrics?.kind==='assistant-social'&&['working','identity','employer','capabilities'].includes(local.metrics.topic))return local;
 const kittyReply=await kitty.respond(local,user,payload,options);if(kittyReply)return kittyReply;
 if(!client.configured())return local;
 if(!eligible(local,contextualQuestion,client.hasContext(previous,id)))return local;
 let remote=client.hasContext(previous,id)&&flowBundleQuote(previous,payload.question)||await client.request(contextualQuestion,previous,id);
 if(remote.reply&&remote.status===undefined)remote.status='ok';
 const fallback=reason=>({...local,...(local.unresolved&&/验证码|短信/.test(payload.question)?{answer:'你问的是短信或验证码接收。先请营业员核对号码状态、使用地区和平台要求；是所有短信都收不到，还是某个平台的验证码收不到？',sources:[],followups:[],metrics:{...local.metrics,kind:'business-clarification',needsClarification:true}}:{}),context:{...local.context,...(client.hasContext(previous,id)?{externalChat:previous}:{})},externalChat:{status:'unavailable',reason}});
 if(remote.status!=='ok')return fallback(remote.reason||'disabled');
 if(remote.intent==='deal')return fallback('unexpected-deal');
 if(remote.hits?.length){
  const strong=remote.hits.filter(hit=>hit.score>=0.7);
  if(!strong.length)return fallback('weak-evidence');
  remote={...remote,intent:'biz',hits:strong};
 }else if(/号卡|手机卡|电话卡|流量|数据包|套餐|资费|宽带|办卡|验证码|身份证/.test(payload.question))remote={...remote,intent:'biz'};
 if(privateReply.test(remote.reply)||(local.mode==='customer'&&dialogue.privateWords.test(remote.reply)))return fallback('private-answer');
 // Only quote a selected flow package; retain all other tiers in the signed context for later questions.
 const quote=remote.context&&flowBundleQuote(remote.context,payload.question);
 if(quote)remote={...remote,reply:quote.reply};
 // Business prices require a knowledge match; a no-match answer can ask for verification.
 if(remote.intent==='biz'&&!remote.hits.length&&!/咨询老板|渠道经理|查不到|未查到|没有查到|无法核实|需要核对/.test(remote.reply))return fallback('missing-evidence');
 if(remote.intent==='biz'&&!remote.hits.length&&!local.unresolved)return fallback('no-knowledge-match');
 return {answer:remote.reply,asOf:c.now(),scope:local.scope,mode:local.mode,
  sources:(remote.intent==='biz'?remote.hits:[]).map((hit,index)=>({label:hit.std,id:'资料'+(index+1),href:'/assistant'})),
  context:{...local.context,externalChat:remote.context},followups:[],
  metrics:{kind:'external-chat',intent:remote.intent,replyStyle:'mandarin',referenceOnly:remote.intent==='biz',hits:remote.hits},
  externalChat:{status:'connected'}};
}
module.exports={ask};
