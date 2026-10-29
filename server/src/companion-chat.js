'use strict';
const c=require('./common'),roles=require('./assistant-roles'),memory=require('./companion'),live=require('./assistant-live'),clock=require('./assistant-clock'),work=require('./assistant-chat'),{createClient}=require('./companion-model');
const client=createClient(),delivery=require('./companion-delivery'),context=require('./companion-context');
function status(){return {modelConfigured:client.configured(),privateMemory:true,longTermRecall:true,deliveryMemory:true,newsWeather:true,pilot:true};}
async function prepare(store,user,body,options={}) {
 roles.permitPersonal(user);const question=c.text(body.question,'消息');
 if(question.length>1500)throw new c.HttpError(400,'消息不能超过1500字');
 const usage=require('./companion-billing').usageAnswer(store,user,question);if(usage)return usage;
 const last=memory.own(store,'companionMessages',user).at(-1);
 const replay=delivery.replay(store,user,question);if(replay)return replay;
 if(last?.response?.metrics?.kind==='personal-repeat-blocked'&&/什么时候聊过|怎么会聊过|第[一1]句话.*聊过|哪里聊过/.test(question))return {answer:'刚才我判断错了，把普通回答误当成重复内容。你现在问什么，我都会重新回答。',channel:'life',modelConnected:false,metrics:{kind:'personal-correction'}};
 const history=context.summaryQuestion(store,user,question);if(history)return history;
 const calendar=clock.query(question,{context:last?.channel==='life'?last.response?.metrics?.clockContext:null});
 if(calendar)return {...calendar,channel:'life',modelConnected:false};
 const stockContext=last?.channel==='life'&&Date.now()-Date.parse(last.createdAt)<30*60000?last.response?.metrics?.stockContext:null;
 const stockReply=await (options.stockQuery||require('./assistant-stocks').query)(question,{context:stockContext,model:options.companionModelClient||client});
 if(stockReply)return stockReply;
 const p=memory.profile(store,user),memoryVersion=p.memoryContextVersion||0,memoryRevision=p.memoryRevision||0;
 const libraryReply=require('./companion-library').answer(store,user,question);if(libraryReply)return libraryReply;
 const position=require('./companion-location').answer(store,user,question);if(position)return position;
 const family=require('./companion-family'),draft=family.suggest(question);
 if(draft)return {answer:'这件亲情往来我先整理成待确认内容了。到“子女关怀”核对亲友、日期和内容，再确认保存；没有提到的时间和金额不会代填。',channel:'life',modelConnected:false,metrics:{kind:'personal-family'},sources:[{label:'确认亲情往来',href:'/companion?tab=family'}]};
 const related=family.recall(store,user,question);if(related)return related;
 const news=require('./companion-news'),newsQuery=news.query(question,last?.response?.metrics);
 if(newsQuery)return news.answer(store,user,{...newsQuery,offset:0,replay:delivery.repeat(question)});
 const explicit=question.match(/^(?:请)?(?:帮我)?(?:记住|记下来|记一下)[：:，,\s]*(.+)$/s);
 if(explicit)return {answer:'好，我会记住：'+explicit[1].trim(),sources:[],channel:'life',remember:{content:explicit[1].trim(),category:'其他'},modelConnected:false};
 if(!roles.personalOnly(user)&&/门店|营业厅|店里|店内|库存|销售|开单|进货|订货|营业员|员工|营业额|毛利|工作积分|接待单|接待人数|接待记录|工单|酬金|佣金|移动业务|单据|账套|老板看台|老板待办|收款单|付款单|回款|来客|到店|客流|电子屏|成绩单|工作日志/.test(question)){
  const result=await work.ask(store,user,{question,mode:'store'},{...options});
  return {...result,channel:'work',modelConnected:false};
 }
 if(/微信.{0,12}(?:消息|通知|内容)|群里.{0,12}(?:消息|通知)/.test(question))return require('./companion-wechat').answer(store,user,{replay:delivery.repeat(question)});
 if(/天气预报.{0,12}(?:随时更新|多久更新|实时|准吗|准不准)/.test(question))return {answer:'天气预报会持续更新。我每次查询都会重新请求天气来源；来源暂不可用时会明确说明，不沿用旧天气。',channel:'life',modelConnected:false,metrics:{kind:'personal-weather-explain'}};
 // Realtime requests must be answered before memory recall.
 const weatherContext=last?.channel==='life'?last.response?.metrics?.weatherContext:null;
 const current=await (options.liveQuery||live.query)(question,{city:p.city,weatherContext});
 if(current)return {...current,channel:'life',modelConnected:false};
 const recalled=context.recalled(store,user,question)||memory.recall(store,user,question);
 if(recalled)return {answer:recalled,sources:[],channel:'life',modelConnected:false};
 const model=options.companionModelClient||client;
 // Personal memories leave this server only after the user enables it in their profile.
 const modelProfile={nickname:p.nickname,city:p.city,interests:p.interests,routine:p.routine,lifeRole:p.lifeRole,personality:p.personality,priorities:p.priorities,resources:p.resources,boundaries:p.boundaries,replyStyle:p.replyStyle,experience:p.experience};
 const retrieved=context.retrieve(store,user,question);
 const directKind=delivery.kind(question),priorKind=delivery.records(store,user).at(-1)?.kind;
 const contentKind=directKind==='chat'&&/^(?:再来|再讲|继续|换一个|还有)(?:一个|个|一点|呢|吗)?[?？。！!]*$/.test(question)&&['joke','story'].includes(priorKind)?priorKind:directKind;
 const modelQuestion=contentKind!==directKind?question+'（请讲一个新的'+(contentKind==='joke'?'笑话':'故事')+'）':question;
 const visibleMessages=memory.own(store,'companionMessages',user).filter(x=>(x.memoryContextVersion||0)===(p.memoryContextVersion||0));
 const reply=model.configured()?await model.request(modelQuestion,{profile:p.shareWithModel?modelProfile:{},memories:p.shareWithModel?retrieved.facts:[],messages:p.shareWithModel?visibleMessages.filter(x=>!['personal-wechat-notifications','personal-location','personal-family','personal-library'].includes(x.response?.metrics?.kind)):[],mode:'personal',memoryContext:p.shareWithModel?{episodes:retrieved.episodes,alreadyTold:retrieved.alreadyTold}:null}):null;
 const unavailable=!reply&&contentKind==='chat';
 const fallback=unavailable?(/哈哈|有意思|好笑/.test(question)?'哈哈，刚才那段你喜欢就好。想再听一段新的笑话吗？':/逗我开心|讲笑话|换个话题/.test(question)?delivery.fallback(store,user,'joke')||'聊天服务暂时连不上，笑话库里的内容已经讲完了。':/被查|落马|被捕|被抓|去世|辞职|当选/.test(question)?'这是需要实时核实的消息。当前没有可用的核验来源，我不能确认真假；请以可靠新闻来源或官方发布为准。':'聊天服务暂时连接不上。我仍能查询当前时间和天气；你刚才的问题我不会假称已经答过。'):delivery.fallback(store,user,contentKind)||memory.localReply(store,user,question);
 let result={memoryVersion,memoryRevision,...(['joke','story'].includes(contentKind)?{metrics:{kind:'personal-entertainment',contentKind}}:unavailable?{metrics:{kind:'personal-model-unavailable'}}:{}),answer:reply||fallback,sources:[],channel:'life',modelConnected:!!reply,
  memorySuggestion:/^(?:我(?:每天|平时|通常|喜欢|不喜欢)|我的(?:朋友|家人|爱好))/.test(question)?question.slice(0,500):null};
 if(['joke','story'].includes(contentKind)&&delivery.duplicate(store,user,result.answer,contentKind)){
  const second=model.configured()?await model.request('换一个之前没有讲过的内容。'+question,{profile:p.shareWithModel?modelProfile:{},memories:p.shareWithModel?retrieved.facts:[],messages:[],mode:'personal',memoryContext:p.shareWithModel?{episodes:retrieved.episodes,alreadyTold:[...retrieved.alreadyTold,{said:result.answer.slice(0,500)}]}:null}):null;
  if(second&&!delivery.duplicate(store,user,second,contentKind))result={...result,answer:second,modelConnected:true};
 }
 return delivery.sanitize(store,user,question,result);
}
function commit(store,user,question,response,requestId) {
 roles.permitPersonal(user);
 const past=delivery.records(store,user).find(r=>r.requestId===requestId&&!r.legacy);if(past){const value=delivery.unpack(past);if(value.question!==question)throw new c.HttpError(409,'消息已变化，请重新发送');return {...value.response,deliveryId:past.id};}
 const previous=memory.own(store,'companionMessages',user).find(x=>x.requestId===requestId);
 if(previous){if(previous.question!==question)throw new c.HttpError(409,'消息已变化，请重新发送');return previous.response;}
 if(response.remember)memory.memory(store,user,response.remember);
 if(response.metrics?.kind==='personal-news-digest')response=require('./companion-news').answer(store,user,{topic:response.metrics.topic,replay:delivery.repeat(question)});
 if(response.metrics?.kind==='personal-wechat-notifications')response=require('./companion-wechat').answer(store,user,{replay:delivery.repeat(question)});
 if((response.memoryVersion!==undefined&&response.memoryVersion!==(memory.profile(store,user).memoryContextVersion||0))||(response.memoryRevision!==undefined&&response.memoryRevision!==(memory.profile(store,user).memoryRevision||0)))throw new c.HttpError(409,'你的记忆刚刚更新，请重新发送，让我按新资料回答');
 const {remember,memoryVersion,memoryRevision,...clean}=response,result=delivery.remember(store,user,question,clean,requestId);memory.append(store,user,question,result,requestId);
 const row=memory.own(store,'companionMessages',user).at(-1);row.response=result;
 require("./companion-family").collect(store,user,question,row);
 require("./companion-library").collect(store,user,question,row);
 return result;
}
function previous(store,user,question,key){roles.permitPersonal(user);const r=delivery.records(store,user).find(x=>x.requestId===key&&!x.legacy);if(r){const v=delivery.unpack(r);if(v.question!==question)throw new c.HttpError(409,'消息已变化，请重新发送');return {...v.response,deliveryId:r.id};}const msg=memory.own(store,'companionMessages',user).find(x=>x.requestId===key);if(msg){if(msg.question!==question)throw new c.HttpError(409,'消息已变化，请重新发送');return msg.response;}return null;}
module.exports={status,prepare,commit,previous,client};
