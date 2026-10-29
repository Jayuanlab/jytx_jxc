'use strict';
const crypto=require('node:crypto'),c=require('./common'),live=require('./assistant-live'),{createClient}=require('./companion-model');
const secret=crypto.randomBytes(32),model=createClient();
const casual=q=>/天气|新闻|八卦|明星|娱乐|笑话|笑一个|陪我聊|闲聊|无聊|退休|起居|睡眠|亲朋|生活习惯|养生|运动|我喜欢/.test(q)&&!/套餐|资费|移动业务|手机卡|宽带|流量包|办理/.test(q);
const bridge='你平时用手机看视频多，还是打电话多？我可以帮你看看移动业务。';
function stamp(user,scope,count,weatherContext){
 const data={userId:user.id,tenant:scope?.tenantId||'',branch:scope?.branchId||'',count,at:Date.now(),...(weatherContext?{weatherContext}:{})};
 return {...data,signature:crypto.createHmac('sha256',secret).update(JSON.stringify(data)).digest('hex')};
}
function signedState(value,user,scope){
 if(!value||value.userId!==user.id||value.tenant!==(scope?.tenantId||'')||value.branch!==(scope?.branchId||'')||!Number.isSafeInteger(value.count)||value.count<0||value.count>3||!Number.isFinite(value.at)||Date.now()-value.at>30*60000||value.at>Date.now())return null;
 const {signature,...data}=value;const expected=crypto.createHmac('sha256',secret).update(JSON.stringify(data)).digest('hex');
 return typeof signature==='string'&&/^[a-f0-9]{64}$/.test(signature)&&crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))?value:null;
}
async function respond(local,user,payload,options={}) {
 if(local.mode!=='customer'||local.metrics?.restricted)return null;
 const state=signedState(payload.context?.kitty,user,options.scope),previous=state?.count||0;
 // Zero casual turns is a valid signed weather conversation, not an absent context.
 const weatherContext=state?.weatherContext||null;
 const weather=live.weatherInput(payload.question,{city:payload.city||'',weatherContext});
 if(!casual(payload.question)&&!weather)return null;
 const count=weather?previous:previous+1;
 let result;
 if(weather){
  // A city clarification and forecast follow-ups are one tool task; never spend the chat allowance.
  try{result=await (options.liveQuery||live.query)(payload.question,{city:payload.city||'',weatherContext});}catch{}
  if(!result)result={answer:'天气来源暂时没连上，稍后再查一次；这次不使用旧数据。',sources:[],metrics:{kind:'live-weather',unavailable:true,weatherContext:weather}};
 }else if(count>=3)result={answer:'咱们先聊到这里。'+bridge,sources:[],metrics:{kind:'kitty-redirect',chatLimit:true}};
 else result=await (options.liveQuery||live.query)(payload.question,{city:payload.city||'',weatherContext});
 if(!result){
  const reply=await (options.companionModelClient||model).request(payload.question,{mode:'customer'});
  const safeReply=reply&&!/底价|进货价|成本|毛利|工资|酬金|(?:套餐|资费|月费).{0,15}\d+.{0,3}(?:元|块)/.test(reply)?reply:null;
  const fallback=/笑话|笑一个/.test(payload.question)?'讲个轻松的：手机说自己最怕什么？最怕“没电还要加班”。':/无聊|聊/.test(payload.question)?'我在呢，咱们简单聊两句。你平时喜欢看视频，还是跟朋友聊天？':'这件事可以聊两句。你最关心哪一点？';
  result={answer:(safeReply||fallback).slice(0,350),sources:[],metrics:{kind:'kitty-chat',modelConnected:!!safeReply}};
 }
 return {...local,...result,context:{...local.context,kitty:stamp(user,options.scope,Math.min(count,3),result.metrics?.weatherContext)},followups:[]};
}
module.exports={respond,casual};
