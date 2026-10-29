'use strict';
// Conversation context supplies meaning, never permissions or proof of execution.
const TOPICS=[['screen',/电子屏|显示屏|大屏|滚动字幕/],['stock',/库存|串号|串码|仓库|供货商|供应商|进货/],['sales',/销售|营业额|销量|毛利|顾客|客户|商品|手机/],['finance',/现金|微信|收款|付款|对账|流水|红包|酬金|工资|账户|账务/],['carrier',/套餐|宽带|号卡|办卡|移动业务|空充|充值/],['weather',/天气|气温|下雨/],['clock',/几点|星期几|几月几号|当前时间/],['tokens',/TOKEN|token|模型用量|计费/]];
function valid(context,user,at=Date.now()){return !!(context&&context.userId===user?.id&&typeof context.question==='string'&&context.question.length<=240&&Number.isFinite(context.at)&&at>=context.at&&at-context.at<86400000);}
function topics(text){return TOPICS.filter(([,re])=>re.test(text)).map(([key])=>key);}
function identityQuestion(question){return /^(?:(?:那|那么|请问|问一下|我问你|请你|请|你好)[，,\s]*)*(?:你(?:到底|究竟)?是谁|你是什么(?:身份|助理|助手|模型)|你叫什么(?:名字)?|介绍一下你自己|自我介绍一下|你能做什么|你有什么功能)[呢吗啊呀吧？?。！!\s]*$/.test(String(question||'').trim());}
function independent(question,context){
 const q=String(question||'').trim();
 if(identityQuestion(q))return true;
 if(/^(?:请|帮我)?(?:换个话题|换一个话题|新话题|重新聊|清空对话|另外问|另一个问题|不说这个|先不说这个)/.test(q))return true;
 if(/^(?:再|那|这个|那个|这笔|那笔|他们|它|就|还是|继续|接着|刚才|之前|前面|更|短|长|温馨|喜庆)/.test(q))return false;
 const old=context?.screen?['screen']:topics(context?.topicQuestion||context?.question||''),next=topics(q);
 if(next.length&&identityQuestion(context?.topicQuestion||context?.question||''))return true;
 return next.length>0&&old.length>0&&!next.some(x=>old.includes(x))&&/(?:查|看|问|多少|怎么样|如何|怎么|帮我|开单|办理|显示|编排|改成|修改|更换|几点|星期|天气)/.test(q);
}
function fallback(question,context,user){if(!valid(context,user)||independent(question,context))return {question,inherited:false};const anchor=String(context.topicQuestion||context.question).slice(0,160),tail=String(question).slice(0,70);return {question:(anchor+'；接着说明：'+tail).slice(0,240),inherited:true};}
function attach(reply,question,context,user){if(!reply?.context)return reply;const continuing=valid(context,user)&&!independent(question,context),turns=continuing&&Array.isArray(context.continuationTurns)?context.continuationTurns.filter(x=>typeof x==='string').slice(-5):[];reply.context.topicQuestion=(continuing?(context.topicQuestion||context.question):question).slice(0,240);reply.context.continuationTurns=[...turns,String(question).slice(0,240)];reply.metrics={...reply.metrics,conversationContinued:continuing};return reply;}
module.exports={valid,independent,fallback,attach,identityQuestion};
