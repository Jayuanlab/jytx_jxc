'use strict';

const crypto=require('node:crypto'),c=require('./common'),roles=require('./assistant-roles');

const delivery=require('./companion-delivery');
const HOUR=3600000,RETENTION=7*24*HOUR;

const LEGACY_CATEGORIES=['community','incident','policy','travel'];

const SENIOR_CATEGORIES=['senior','health','safety'];

const PREVIOUS_CATEGORIES=[...LEGACY_CATEGORIES,...SENIOR_CATEGORIES];

const categories=[

 {id:'technology',label:'科技前沿',pattern:/人工智能|(?:^|[^A-Za-z])AI(?:$|[^A-Za-z])|大模型|机器人|机器学习|智能体|量子|芯片|半导体|航天|载人|卫星|月球|火星|空间站|新能源|储能|固态电池|氢能|核聚变|脑机接口|新发明|科技前沿|科技创新|科研突破|科学家|无人驾驶|自动驾驶|低空经济|无人机/},

 {id:'senior',label:'老年生活与养老',pattern:/老年|老人|长者|银龄|适老|助老|敬老|养老|退休|离退休|老有所|老龄|高龄|失能|居家照护|社区助餐|老年大学|老年旅游|老年旅客/},

 {id:'health',label:'健康与养生',pattern:/健康|养生|慢病|慢性病|血压|血糖|糖尿病|心脑血管|骨质疏松|阿尔茨海默|认知障碍|失眠|睡眠|膳食|营养|用药|健身|散步|太极|广场舞|防跌倒|康复|体检/},

 {id:'safety',label:'防骗与消费提醒',pattern:/防骗|反诈|诈骗|骗局|骗术|养老骗局|消费提醒|消费警示|消费维权|保健品.{0,12}(陷阱|虚假|夸大)|冒充.{0,10}(客服|亲友|公检法)|非法集资/},

 {id:'community',label:'社区公开消息',pattern:/社区|小区|街道|停水|停电|物业|便民|居民.{0,8}(通知|通告|公告)/},

 {id:'incident',label:'突发与预警',pattern:/火灾|起火|失火|洪水|洪灾|洪涝|水灾|防汛|暴雨|内涝|山洪|泥石流|台风|预警|地震/},

 {id:'policy',label:'政策与民生',pattern:/政策|退休|养老金|养老保险|医保|社保|补贴|民生|公积金|新规|条例|住房保障|医疗保障/},

 {id:'travel',label:'旅游与活动',pattern:/旅游|旅行|景区|文旅|游客|出游|赏花|节庆|文化活动|免票|门票/},

];

const feeds=['scroll-news','society','china','life','jk','fz','culture','finance'].map(id=>({id,url:'https://www.chinanews.com.cn/rss/'+id+'.xml',source:'中新网'}));

const defaults=()=>({enabled:true,categories:categories.map(x=>x.id),keywords:'',seniorFirst:true});

function settings(profile){

 const saved=profile?.newsSubscription||{},config={...defaults(),...saved};

 // Expand the original all-topics preset once; keep deliberately narrowed subscriptions.

 if((saved.version!==2&&saved.version!==3&&LEGACY_CATEGORIES.every(id=>(saved.categories||[]).includes(id)))||(saved.version===2&&PREVIOUS_CATEGORIES.every(id=>(saved.categories||[]).includes(id))))config.categories=categories.map(x=>x.id);

 return config;

}

const seniorItem=item=>(item.categories||[]).some(id=>SENIOR_CATEGORIES.includes(id));

function order(items,config){return items.slice().sort((a,b)=>(config.seniorFirst?Number(seniorItem(b))-Number(seniorItem(a)):0)||Date.parse(b.publishedAt)-Date.parse(a.publishedAt));}

const clean=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();

function safeLink(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.hostname!=='www.chinanews.com.cn'||u.username||u.password||u.port)return null;u.protocol='https:';u.hash='';return u.href;}catch{return null;}}

function publishedTime(value){

 const local=String(value||'').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);

 return Date.parse(local?local[1]+'-'+local[2].padStart(2,'0')+'-'+local[3].padStart(2,'0')+'T'+local[4].padStart(2,'0')+':'+local[5]+':'+(local[6]||'00')+'+08:00':value);

}

function classify(title){return categories.filter(x=>x.pattern.test(title)).map(x=>x.id);}

function parse(xml,{now=Date.now(),source='中新网'}={}){

 if(Buffer.byteLength(xml)>1024*1024)throw Error('feed-too-large');

 return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,500).flatMap(match=>{

  const field=name=>clean(match[1].match(new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]);

  const title=field('title').slice(0,180),url=safeLink(field('link')),time=publishedTime(field('pubDate'));

  if(!title||!url||!Number.isFinite(time)||time>now+300000||now-time>RETENTION)return [];

  return [{id:crypto.createHash('sha256').update(url).digest('hex').slice(0,24),title,url,source,publishedAt:new Date(time).toISOString(),categories:classify(title)}];

 });

}

function dedupe(items,now=Date.now(),limit=100){

 const links=new Set(),titles=new Set(),result=[];

 for(const item of items.slice().sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))){

  if(!safeLink(item.url)||!item.title||!Number.isFinite(Date.parse(item.publishedAt))||now-Date.parse(item.publishedAt)>RETENTION||Date.parse(item.publishedAt)>now+300000)continue;

  const title=item.title.normalize('NFKC').replace(/[\s，,。.!！?？“”"'‘’]/g,'');

  if(links.has(item.url)||titles.has(title))continue;links.add(item.url);titles.add(title);result.push({...item,categories:classify(item.title)});

 }

 return result.slice(0,limit);

}

function matched(item,config){

 const words=String(config.keywords||'').split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean);

 return (item.categories||[]).some(id=>(config.categories||[]).includes(id))||words.some(word=>item.title.includes(word));

}

async function fetchFeed(feed,fetchImpl,now){

 const r=await fetchImpl(feed.url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{Accept:'application/rss+xml, application/xml, text/xml'}});

 if(!r.ok)throw Error('source-unavailable');

 let size=0;const reader=r.body.getReader(),parts=[];

 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('feed-too-large');}parts.push(Buffer.from(value));}

 const xml=Buffer.concat(parts).toString('utf8');if(!/<(?:rss|feed)\b/i.test(xml))throw Error('invalid-feed');

 const items=parse(xml,{now,source:feed.source});if(!items.length)throw Error('no-fresh-items');

 return items;

}

async function collect({fetchImpl=fetch,now=Date.now()}={}){

 const results=await Promise.allSettled(feeds.map(feed=>fetchFeed(feed,fetchImpl,now)));

 const items=dedupe(results.flatMap(x=>x.status==='fulfilled'?x.value:[]),now,500),success=results.filter(x=>x.status==='fulfilled').length;

 return {items,status:success===feeds.length?'ok':success?'partial':'unavailable',sourceCount:success,totalSources:feeds.length,checkedAt:new Date(now).toISOString()};

}

function own(store,user){return (store.companionProfiles||[]).find(x=>x.userId===user.id);}

function profileRow(store,user){

 let p=own(store,user);if(!p){p={id:user.id,userId:user.id,nickname:user.name,city:'',interests:'',routine:'',shareWithModel:false};(store.companionProfiles||=[]).push(p);}return p;

}

function save(store,user,body){

 roles.permitPersonal(user);if(typeof body.enabled!=='boolean'||!Array.isArray(body.categories)||body.categories.length>categories.length||body.categories.some(id=>!categories.some(x=>x.id===id)))throw new c.HttpError(400,'请选择关注类型和自动搜集状态');

 const keywords=typeof body.keywords==='string'?body.keywords.trim():'';if(keywords.length>160)throw new c.HttpError(400,'关键词最多160字');

 const row=profileRow(store,user);if(body.seniorFirst!==undefined&&typeof body.seniorFirst!=='boolean')throw new c.HttpError(400,'请选择是否优先显示老年关注');

 row.newsSubscription={enabled:body.enabled,categories:[...new Set(body.categories)],keywords,seniorFirst:body.seniorFirst??settings(row).seniorFirst,version:3};c.audit(store,user,'companion:news-settings',user.id);return snapshot(store,user);

}

function snapshot(store,user,{now=Date.now()}={}){

 roles.permitPersonal(user);const p=own(store,user),config=settings(p),digest=p?.newsDigest||{};

 return {settings:config,categories:categories.map(({id,label})=>({id,label})),intervalMinutes:60,status:digest.status||'pending',checkedAt:digest.checkedAt||null,lastSuccessAt:digest.lastSuccessAt||null,sourceCount:digest.sourceCount||0,totalSources:feeds.length,

  items:order(dedupe(digest.items||[],now).filter(x=>matched(x,config)),config).map(x=>({...x,deliveryStatus:delivery.itemStatus(store,user,'news',x),categories:x.categories.filter(id=>categories.some(c=>c.id===id))})),wechatConnected:false};

}

function eligible(store,now,force=false){return (store.users||[]).filter(user=>user.status==='active'&&roles.personal(user)&&settings(own(store,user)).enabled&&(force||!own(store,user)?.newsDigest?.checkedAt||Math.floor(now/HOUR)>Math.floor(Date.parse(own(store,user).newsDigest.checkedAt)/HOUR)));}

async function refresh(repository,options={}){

 const now=options.now??Date.now(),first=await repository.readStore();

 if(!eligible(first,now,options.force===true).length)return {checkedProfiles:0,status:'idle',items:0};

 // Fetch public feeds once; no account, private chat or personal memory is sent.

 const result=await collect({...options,now});let checkedProfiles=0;

 await repository.transaction(store=>{

  for(const user of eligible(store,now,options.force===true)){

   const row=profileRow(store,user),previous=row.newsDigest||{},config=settings(row);

   row.newsDigest={checkedAt:result.checkedAt,status:result.status,sourceCount:result.sourceCount,

    lastSuccessAt:result.status==='unavailable'?previous.lastSuccessAt||null:result.checkedAt,

    items:order(dedupe([...result.items.filter(x=>matched(x,config)),...(previous.items||[])],now,500),config).slice(0,100)};

   checkedProfiles++;

  }

 });

 return {checkedProfiles,status:result.status,items:result.items.length,sourceCount:result.sourceCount};

}

function query(question,context){

 const q=String(question||'').trim();

 if(context?.kind==='personal-news-digest'&&/^(?:还有(?:呢|吗|么)?|继续|再(?:来|说|看)(?:几条|一些|一点)?|下一批|接着说)[？?。！!]*$/.test(q))return {topic:context.topic||'all',offset:context.nextOffset||0};

 if(!/新闻|消息|信息|报道/.test(q)&&!(context?.kind==='personal-news-digest'&&/^(?:最近的?|最新的?|看看|查查)?(?:政策|养老|退休|健康|养生|反诈|防骗|旅游|活动|科技|科技前沿|人工智能)[？?]*$/.test(q)))return null;

 const topic=/科技|人工智能|大模型|机器人|航天|新能源/.test(q)?'technology':/老年|老人|银龄|长者|退休|养老/.test(q)?'senior':/健康|养生/.test(q)?'health':/反诈|防骗|诈骗/.test(q)?'safety':/政策|养老金|医保|社保/.test(q)?'policy':/旅游|旅行|活动/.test(q)?'travel':/(?:我|我的|你帮我)?关注的?(?:信息|消息|新闻)|搜集的(?:信息|消息)|整理的(?:信息|消息)/.test(q)?'all':null;

 return topic?{topic,offset:0}:null;

}

function answer(store,user,{topic='all',offset=0,replay=false,now=Date.now()}={}){

 const digest=snapshot(store,user,{now});

 const all=digest.items.filter(item=>replay||!delivery.delivered(store,user,'news',item)).filter(item=>topic==='all'||(topic==='senior'?seniorItem(item):item.categories.includes(topic)));

 const start=Math.max(0,Number.isInteger(offset)?offset:0),items=all.slice(start,start+5);

 const label=topic==='senior'?'老年人关注的公开消息':topic==='all'?'你关注的公开消息':categories.find(x=>x.id===topic)?.label||'公开消息';

 const none=start>0?'这一批已经看完，暂时没有更多匹配的近期消息。':'目前没有还未讲过的匹配消息，后台会继续搜集新内容。想重看旧消息，可以说“重看之前的新闻”。';

 return {answer:items.length?label+'：\n'+items.map((x,i)=>(start+i+1)+'. '+x.title+'（发布：'+new Date(x.publishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'）').join('\n')+(all.length>start+items.length?'\n想继续看，可以说“还有呢”。':'')+(digest.status==='unavailable'?'\n本轮来源暂不可用，以上为之前保存的近期消息。':''):none,sources:items.map(x=>({id:x.id,label:x.source+' · '+x.title,href:x.url})),metrics:{kind:'personal-news-digest',checkedAt:digest.checkedAt,status:digest.status,topic,nextOffset:start+items.length,deliveryItems:items.map(x=>({id:x.id,title:x.title,url:x.url}))},channel:'life',modelConnected:false};

}

module.exports={save,snapshot,refresh,collect,parse,dedupe,matched,settings,eligible,answer,query,seniorItem};

