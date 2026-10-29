'use strict';

const c = require('./common'), roles = require('./assistant-roles'),news=require('./companion-news');

const {randomUUID} = require('node:crypto');

const delivery=require('./companion-delivery'),memorySearch=require('./companion-memory-search');
const CATEGORIES = ['习惯','爱好','亲友','生活','健康','性格','处事','职业','经历','其他'];
const BACKGROUND_FIELDS={lifeRole:'身份与责任',personality:'处事特点',priorities:'看重的事情',resources:'可用资源',boundaries:'不愿接受的做法',replyStyle:'沟通偏好',experience:'相关经历'};

const own = (store, key, user) => (store[key] || []).filter(row => row.userId === user.id);

function text(value,label,max=500,optional=false) {

 if (optional && (value == null || value === '')) return '';

 const result = c.text(value,label);

 if (result.length > max) throw new c.HttpError(400,label+'不能超过'+max+'字');

 return result;

}

function profile(store,user) {

 roles.permitPersonal(user);

 return own(store,'companionProfiles',user)[0] || {id:user.id,userId:user.id,nickname:user.name,city:'',interests:'',routine:'',shareWithModel:false};

}

function saveProfile(store,user,body) {
 roles.permitPersonal(user);
 const background=Object.fromEntries(Object.entries(BACKGROUND_FIELDS).filter(([key])=>Object.hasOwn(body,key)).map(([key,label])=>[key,text(body[key],label,key==='lifeRole'?160:500,true)]));
 const value={nickname:text(body.nickname,'称呼',40),city:text(body.city,'城市',60,true),interests:text(body.interests,'兴趣爱好',500,true),routine:text(body.routine,'作息习惯',500,true),shareWithModel:body.shareWithModel===true,...background};
 let row = own(store,'companionProfiles',user)[0];
 if (!row) {row={id:user.id,userId:user.id,sessionId:randomUUID()};(store.companionProfiles ||= []).push(row);}
 const changed=Object.entries(value).filter(([key,val])=>row[key]!==val);
 if(changed.length){
  // Renaming preserves old conversations; sensitive edits keep the privacy barrier.
  if(changed.some(([key])=>key!=='nickname'))delivery.invalidate(store,user);
  reviseMemory(store,user);
 }
 Object.assign(row,value,{updatedAt:c.now()});
 c.audit(store,user,'companion:profile',row.id);
 return snapshot(store,user).profile;
}
function invalidateMemoryContext(store,user){let p=own(store,'companionProfiles',user)[0];if(!p){p={...profile(store,user),sessionId:randomUUID()};(store.companionProfiles||=[]).push(p);}delivery.invalidate(store,user);}
// Concurrency revision is separate from the privacy barrier, so adding a fact keeps old conversations searchable.
function reviseMemory(store,user){let p=own(store,'companionProfiles',user)[0];if(!p){p={...profile(store,user),sessionId:randomUUID()};(store.companionProfiles||=[]).push(p);}p.memoryRevision=(p.memoryRevision||0)+1;}
function memory(store,user,body) {
 roles.permitPersonal(user);
 const old=body.id&&own(store,'companionMemories',user).find(r=>r.id===body.id);
 if(body.sourceKind!==undefined&&!['self','observer'].includes(body.sourceKind))throw new c.HttpError(400,'请选择本人陈述或亲友看法');
 let sourceKind=body.sourceKind||old?.sourceKind||'self';
 const reportedBy=sourceKind==='self'?'':text(body.reportedBy??old?.reportedBy,'提供看法的人',60);
 if(old?.sourceKind==='family'&&sourceKind==='observer'&&reportedBy===old.reportedBy)sourceKind='family';
 return saveMemory(store,user,body,{sourceKind,reportedBy,...(sourceKind==='family'?{sourceMessageId:old.sourceMessageId,reportedAt:old.reportedAt}:{sourceMessageId:null,reportedAt:null})});
}
function saveMemory(store,user,body,provenance) {
 roles.permitPersonal(user);
 const content=text(body.content,'记忆内容',500),category=CATEGORIES.includes(body.category)?body.category:'其他';
 let row = body.id && own(store,'companionMemories',user).find(row=>row.id===body.id);
 if (body.id && !row) throw new c.HttpError(404,'这条记忆不存在');
 if(row&&(!Number.isInteger(body.version)||body.version!==(row.version||0)))throw new c.HttpError(409,'这条记忆已经变化，请刷新后核对再修改');
 if (!row) {
  row=own(store,'companionMemories',user).find(row=>row.content===content&&(row.sourceKind||'self')===provenance.sourceKind&&(row.reportedBy||'')===provenance.reportedBy);
  if (!row) {
   if (own(store,'companionMemories',user).length>=200) throw new c.HttpError(400,'最多保存200条记忆，请先整理');
   row={id:c.id('CM'),userId:user.id,createdAt:c.now()};(store.companionMemories ||= []).push(row);
  }
 }
 if(row.content&&(row.content!==content||row.category!==category||(row.sourceKind||'self')!==provenance.sourceKind||row.reportedBy!==provenance.reportedBy))invalidateMemoryContext(store,user);
 if(row.content&&row.content!==content)store.companionMessages=(store.companionMessages||[]).filter(item=>item.userId!==user.id||!((item.question||'')+' '+(item.answer||'')).includes(row.content));
 if(row.content===content&&row.category===category&&row.confirmed&&(row.sourceKind||'self')===provenance.sourceKind&&(row.reportedBy||'')===provenance.reportedBy)return row;
 reviseMemory(store,user);
 if(row.content){(row.history||=[]).push({content:row.content,category:row.category,sourceKind:row.sourceKind||'self',reportedBy:row.reportedBy||'',updatedAt:row.updatedAt,version:row.version||0});row.history=row.history.slice(-5);}
 Object.assign(row,{content,category,confirmed:true,...provenance,opinionOnly:provenance.sourceKind!=='self',version:(row.version||0)+1,updatedAt:c.now(),source:provenance.sourceKind==='family'?'亲友留言，经本人允许参考':provenance.sourceKind==='observer'?'亲友看法，经本人允许参考':body.id?'本人核对修改':'本人确认保存'});
 c.audit(store,user,'companion:memory-save',row.id);
 return row;
}
function familyObservation(store,user,body){
 roles.permitPersonal(user);
 const f=profile(store,user).familyCare,m=f?.messages?.find(x=>x.id===body.messageId&&x.from==='child'),member=f?.members?.find(x=>x.id===m?.memberId);
 if(!m||!member)throw new c.HttpError(404,'这条亲友留言不存在');
 if(body.consent!==true)throw new c.HttpError(400,'请先确认是否把这条留言作为亲友看法参考');
 const old=own(store,'companionMemories',user).find(x=>x.sourceMessageId===m.id);
 if(old)return old;
 return saveMemory(store,user,{content:text(body.content||m.content,'亲友看法',500),category:body.category||'其他'},{sourceKind:'family',reportedBy:member.name+'（'+member.relationship+'）',sourceMessageId:m.id,reportedAt:m.createdAt});
}
function removeMemory(store,user,body) {

 roles.permitPersonal(user);

 const row=own(store,'companionMemories',user).find(row=>row.id===body.id);

 if (!row) throw new c.HttpError(404,'这条记忆不存在');

 delivery.invalidate(store,user);
 reviseMemory(store,user);
 store.companionMemories=store.companionMemories.filter(item=>item!==row);

 // Do not reintroduce a removed memory through old chat context.

 store.companionMessages=(store.companionMessages||[]).filter(item=>item.userId!==user.id||!((item.question||'')+' '+(item.answer||'')).includes(row.content));

 c.audit(store,user,'companion:memory-remove',row.id);

 return {removed:true};

}

function favor(store,user,body) {

 roles.permitPersonal(user);

 const date=text(body.date,'日期',10);

 if (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new c.HttpError(400,'日期不正确');

 if (!['送出','收到'].includes(body.direction))throw new c.HttpError(400,'请选择送出或收到');

 const row={id:c.id('CF'),userId:user.id,date,person:text(body.person,'亲友姓名',60),

  occasion:text(body.occasion,'往来事项',160),direction:body.direction,amount:c.money(body.amount),note:text(body.note,'备注',500,true),createdAt:c.now()};

 (store.companionFavors ||= []).push(row);c.audit(store,user,'companion:favor',row.id);return row;

}

function removeFavor(store,user,body) {

 roles.permitPersonal(user);const row=own(store,'companionFavors',user).find(x=>x.id===body.id);

 if(!row)throw new c.HttpError(404,'往来记录不存在');

 store.companionFavors=store.companionFavors.filter(x=>x!==row);c.audit(store,user,'companion:favor-remove',row.id);return {removed:true};

}

function reminder(store,user,body) {

 roles.permitPersonal(user);

 const at = Date.parse(body.dueAt);

 if (!Number.isFinite(at)) throw new c.HttpError(400,'提醒时间不正确');

 if(own(store,'companionReminders',user).filter(x=>!x.done).length>=100)throw new c.HttpError(400,'最多保留100条未完成提醒');

 const row={id:c.id('CR'),userId:user.id,title:text(body.title,'提醒内容',160),dueAt:new Date(at).toISOString(),done:false,createdAt:c.now()};

 (store.companionReminders ||= []).push(row);c.audit(store,user,'companion:reminder',row.id);return row;

}

function completeReminder(store,user,body) {

 roles.permitPersonal(user);const row=own(store,'companionReminders',user).find(x=>x.id===body.id);

 if (!row) throw new c.HttpError(404,'提醒不存在');

 row.done=body.done!==false;row.updatedAt=c.now();return row;

}

function snapshot(store,user) {

 roles.permitPersonal(user);

 const p=profile(store,user),{sessionId,newsSubscription,newsDigest,wechatSettings,wechatInbox,wechatCollector,deliveryMemory,billing,currentLocation,locationVersion,emergencyCard,emergencyVersion,familyCare,personalLibrary,...visible}=p;

 return {profile:visible,delivery:delivery.snapshot(store,user),news:news.snapshot(store,user),wechat:require("./companion-wechat").snapshot(store,user),memories:own(store,'companionMemories',user).slice().reverse(),

  messages:own(store,'companionMessages',user).slice(-120),screen:screenState(store,user),favors:own(store,'companionFavors',user).slice().reverse(),

  reminders:own(store,'companionReminders',user).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)),categories:CATEGORIES};

}

function screenState(store,user) {
 const p=profile(store,user),rows=own(store,'companionMessages',user),index=rows.findIndex(x=>x.id===p.screenAfterId);
 const hiddenCount=p.screenAfterId?(index>=0?index+1:rows.filter(x=>Date.parse(x.createdAt)<=Date.parse(p.screenClearedAt)).length):0;
 return {hiddenCount,clearedAt:p.screenClearedAt||null};
}
function clearScreen(store,user) {
 roles.permitPersonal(user);let p=own(store,'companionProfiles',user)[0];
 if(!p){p={...profile(store,user),sessionId:randomUUID()};(store.companionProfiles ||= []).push(p);}
 const last=own(store,'companionMessages',user).at(-1);p.screenAfterId=last?.id||null;p.screenClearedAt=c.now();
 return {screen:screenState(store,user)};
}
function restoreScreen(store,user) {
 roles.permitPersonal(user);const p=own(store,'companionProfiles',user)[0];if(p){p.screenAfterId=null;p.screenClearedAt=null;}return {screen:screenState(store,user)};
}
function clearHistory(store,user) {

 roles.permitPersonal(user);store.companionMessages=(store.companionMessages||[]).filter(row=>row.userId!==user.id);

 const p=own(store,'companionProfiles',user)[0];if(p)p.sessionId=randomUUID();

 c.audit(store,user,'companion:clear-history',user.id);return {cleared:true};

}

function append(store,user,question,response,requestId) {

 roles.permitPersonal(user);

 if(requestId && own(store,'companionMessages',user).some(x=>x.requestId===requestId)) return;

 const messages=store.companionMessages ||= [];

 const row={id:c.id('CC'),userId:user.id,question,answer:response.answer,channel:response.channel||'life',sources:response.sources||[],createdAt:c.now(),memoryContextVersion:profile(store,user).memoryContextVersion||0,requestId};

 messages.push(row);

 const excess=own(store,'companionMessages',user).slice(0,-120);

 const ids=new Set(excess.map(x=>x.id));store.companionMessages=messages.filter(x=>!ids.has(x.id));

}

function recall(store,user,q) {

 const p=profile(store,user),memories=own(store,'companionMemories',user);

 if(/人情|礼金|往来账|送过|收到.*(?:钱|礼)/.test(q)) {

  const rows=own(store,'companionFavors',user),total=direction=>c.round(rows.filter(r=>r.direction===direction).reduce((n,r)=>n+r.amount,0));

  return rows.length?'你的人情账共'+rows.length+'笔，送出'+total('送出')+'元，收到'+total('收到')+'元。最近：'+rows.slice(-3).reverse().map(r=>r.date+' '+r.person+' '+r.direction+r.amount+'元（'+r.occasion+'）').join('；')+'。':'人情账还没有记录，可以在“人情往来”中记一笔。';

 }

 if(/提醒|今天.*(?:安排|要做)|待办/.test(q)) {

  const rows=own(store,'companionReminders',user).filter(x=>!x.done);

  return rows.length?'你还没完成的提醒：'+rows.slice(0,8).map(x=>x.title+'（'+new Date(x.dueAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'）').join('；')+'。':'目前没有未完成的个人提醒。';

 }

 if(memorySearch.recallQuestion(q)) {
  const rows=memorySearch.rank(memories,user.id,q,{limit:8,budget:2500}),all=memorySearch.broad(q);
  const parts=[...(all?[p.city&&'常住城市：'+p.city,p.interests&&'兴趣：'+p.interests,p.routine&&'作息：'+p.routine]:[]),...rows.map(r=>(r.opinionOnly||['observer','family'].includes(r.sourceKind)?'亲友看法（'+(r.reportedBy||'亲友')+'，仅供参考）：':'')+r.content)].filter(Boolean);
  return parts.length?'按你确认保存的记忆：'+parts.join('；')+'。有变化可以随时修改。':'已确认的记忆里还没找到这件事。你可以告诉我正确情况，再确认保存。';
 }

 return null;

}

function localReply(store,user,q) {

 const remembered=recall(store,user,q);if(remembered)return remembered;

 const p=profile(store,user),name=p.nickname||user.name;

 if(/^(?:你好|早上好|晚上好|在吗|嗨|哈喽)[呀啊！!。？?\s]*$/.test(q))return name+'，我在。'+(p.interests?'你喜欢'+p.interests+'，今天想聊聊这个，还是说说身边的事？':'今天过得怎么样？');

 if(/退休/.test(q))return '退休后的生活可以照自己的节奏安排。'+(p.interests?'你喜欢'+p.interests+'，我们就从你熟悉的兴趣聊起。':'你更喜欢出门走走，还是在家找点喜欢的事做？');

 if(/累|心烦|不开心|孤单|烦恼/.test(q))return '听起来今天有些不顺心。你愿意说说发生了什么吗？我先听你讲。';

 if(/健康|运动|睡眠|养生/.test(q))return '我可以帮你记录作息和运动情况，方便回头一起看变化。你今天想记哪一项？涉及身体不适或用药，咱们按医生的意见来。';

 return '这件事我听到了。'+(p.interests?'我记得你平时喜欢'+p.interests+'。':'')+'你想继续聊聊，还是把其中一件事记下来？';

}

module.exports={profile,saveProfile,memory,familyObservation,removeMemory,favor,removeFavor,reminder,completeReminder,snapshot,screenState,clearScreen,restoreScreen,clearHistory,append,localReply,recall,own};

