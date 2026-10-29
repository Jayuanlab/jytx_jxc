'use strict';
const c=require('./common');
const cache=new Map(),pending=new Map();
const conditions={0:'晴',1:'大致晴朗',2:'多云',3:'阴',45:'雾',48:'冻雾',51:'小毛毛雨',53:'毛毛雨',55:'较强毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'较强阵雨',82:'强阵雨',95:'雷雨',96:'雷雨伴冰雹',99:'强雷雨伴冰雹'};
async function limited(url,fetchImpl) {
 const r=await fetchImpl(url,{signal:AbortSignal.timeout(8000),redirect:'error'});
 if(!r.ok)throw Error('upstream');
 const reader=r.body.getReader();let bytes=0,parts=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024*1024){await reader.cancel();throw Error('oversize')}parts.push(Buffer.from(value));}
 return Buffer.concat(parts).toString('utf8');
}
async function cached(key,ttl,work) {
 const old=cache.get(key);if(old&&Date.now()-old.at<ttl)return old.value;
 if(pending.has(key))return pending.get(key);
 const promise=work().then(value=>{if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),value});return value;}).finally(()=>pending.delete(key));
 pending.set(key,promise);return promise;
}
const clean=v=>String(v||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
const requestPrefix=/^(?:请|麻烦|帮我|帮忙|查一下|查查|查询|查|看看|看一下|我就想知道|我想知道|我想查|给我查|我在|我住在|就是|在|今天|今日|今儿个|今儿|明天|后天|现在|今晚上|今晚)+/;
function locationText(value) {
 return String(value||'').trim().replace(requestPrefix,'').replace(/[，,、\s]+/g,'').replace(/[。.!！?？]+$/,'');
}
function isLocation(value) {
 return /^(?:[\p{Script=Han}]{2,40}|[A-Za-z][A-Za-z -]{1,50})$/u.test(value)&&
  !/天气|新闻|喜欢|想要|记住|吃什么|聊天|不知道|算了|不用|不查|不要|取消|结束|谢谢|好的|你好|继续|什么|怎么样|如何|明天|今天|今日|今儿|后天|业务|套餐|资费|办理|办卡|手机卡|宽带|流量|充值|话费|购机|手机|商品|咨询|笑话|笑一个|八卦|明星|娱乐|无聊|起居|睡眠|生活习惯|养生|运动/.test(value);
}
function cityFrom(question,fallback='') {
 const text=String(question||'').trim(),match=text.match(/^(.*?)(?:天气|气温|温度|下雨|有雨|降雨|多少度|几度|冷不冷|热不热)/u);
 if(!match)return fallback;
 const candidate=locationText(match[1]).replace(/(?:的|今天|今日|今儿个|今儿|明天|后天|现在|今晚上|今晚|上午|下午|早上|晚上|中午|夜里|会不会|会|有没有|是否)+$/,'');
 return /^(?:该地方|这里|那里|这个地方)$/.test(candidate)?fallback:isLocation(candidate)?candidate:fallback;
}
function weatherInput(question,{city='',weatherContext=null,now=Date.now()}={}) {
 const q=String(question||'').trim();
 const valid=weatherContext&&Number.isFinite(weatherContext.at)&&now-weatherContext.at>=0&&now-weatherContext.at<30*60000&&
  typeof weatherContext.city==='string'&&weatherContext.city.length<=60&&[0,1,2].includes(weatherContext.dayOffset);
 const context=valid?weatherContext:null;
 const direct=/天气|下雨|有雨|降雨|气温|(?:今天|今日|今儿个|今儿|明天|后天|现在|今晚上|今晚|室外).*(?:几度|多少度|温度|冷不冷|热不热)/.test(q);
 const followup=context&&/^(?:那|那么)?(?:(?:今天|今日|今儿个|今儿|明天|后天|现在|今晚)(?:呢|怎么样|咋样|如何|的天气|会不会下雨|会下雨|下雨|有没有雨|有雨|多少度|几度|冷不冷|热不热)?|会不会下雨|会下雨|下雨|有没有雨|有雨|多少度|几度|温度多少|气温多少|冷不冷|热不热)[呢吗啊呀?？。！!]*$/.test(q);
 const supplied=locationText(q),cityAnswer=context?.needsCity&&!direct&&!followup&&isLocation(supplied)&&!/(?:哪里|为什么|怎么|是不是|有多个|吗|呢|谁)/.test(q);
 if(!direct&&!followup&&!cityAnswer)return null;
 const location=cityAnswer?supplied:cityFrom(q,context?.city||city);
 const dayOffset=/后天/.test(q)?2:/明天/.test(q)?1:/今天|今日|今儿|现在|今晚/.test(q)?0:context?.dayOffset||0;
 return {city:location,dayOffset,at:now,needsCity:!location};
}
const provincePrefix=/^(北京市|北京|天津市|天津|上海市|上海|重庆市|重庆|(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾)(?:省)?|(?:内蒙古|广西|宁夏|新疆|西藏)(?:壮族自治区|回族自治区|维吾尔自治区|自治区)?)(.*)$/u;
const areaName=value=>String(value||'').replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治县|自治州|省|市|县|区)$/u,'');
function locationParts(location) {
 let name=locationText(location),regions=[];
 const province=name.match(provincePrefix);
 if(province?.[2]){regions.push(areaName(province[1]));name=province[2];}
 const municipality=name.match(/^(.+?市)(.+)$/u);
 if(municipality){regions.push(areaName(municipality[1]));name=municipality[2];}
 if(!regions.length&&areaName(name)==='云阳')regions.push('重庆');
 return {name:areaName(name),regions};
}
async function query(question,{city='',weatherContext=null,fetchImpl=globalThis.fetch,now=Date.now()}={}) {
 const state=weatherInput(question,{city,weatherContext,now});
 if(state){
  const location=state.city;
  const withContext=result=>({...result,metrics:{...result.metrics,weatherContext:{...state,needsCity:!!result.metrics?.needsCity}}});
  if(!location)return withContext({answer:'你想查哪个城市或区县的天气？',sources:[],metrics:{kind:'live-weather',needsCity:true}});
  try{
   const parts=locationParts(location);
   if(parts.name.length<2)throw Error('invalid-location');
   const result=await cached('weather:'+c.day(now)+':'+JSON.stringify(parts),0,async()=>{
    const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:parts.name,count:'20',language:'zh',format:'json',countryCode:'CN'});
    const geo=JSON.parse(await limited(url,fetchImpl));
    const places=(geo.results||[]).filter(x=>x.country_code==='CN'&&Number.isFinite(x.latitude)&&Number.isFinite(x.longitude)&&
     areaName(x.name)===parts.name&&parts.regions.every(region=>[x.admin1,x.admin2,x.admin3].some(admin=>areaName(admin)===region)));
    if(places.length!==1)return {answer:places.length?'这个地名有多个地点，请选一个：'+places.map(x=>[x.admin1,x.admin2,x.name].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' ')).join('；')+'。':'暂时没找到“'+location+'”的天气地点，可以换成所在城市名。',sources:[],metrics:{kind:'live-weather',needsCity:true}};
    const p=places[0],forecast=new URL('https://api.open-meteo.com/v1/forecast');
    forecast.search=new URLSearchParams({latitude:String(p.latitude),longitude:String(p.longitude),current:'temperature_2m,weather_code',hourly:'temperature_2m,precipitation_probability,weather_code',daily:'weather_code,temperature_2m_max,temperature_2m_min',timezone:'Asia/Shanghai',forecast_days:'3'});
    const weather=JSON.parse(await limited(forecast,fetchImpl));
    return {place:[p.admin1,p.admin2,p.name].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' '),weather};
   });
   if(!result.weather)return withContext(result);
   const index=state.dayOffset,w=result.weather,d=w.daily;
   if(!Array.isArray(d?.time)||!d.time[index]||d.time[0]!==c.day(now))throw Error('stale');
   const lo=d.temperature_2m_min?.[index],hi=d.temperature_2m_max?.[index];
   if(!Number.isFinite(lo)||!Number.isFinite(hi))throw Error('missing');
   const period=/上午|早上|早晨/.test(question)?{label:'上午',from:6,to:12}:/下午/.test(question)?{label:'下午',from:12,to:18}:/今晚上|今晚|晚上|夜里|夜间/.test(question)?{label:'晚上',from:18,to:24}:null;
   if(period&&Array.isArray(w.hourly?.time)){
    const hours=w.hourly.time.map((time,i)=>({time,temp:w.hourly.temperature_2m?.[i],rain:w.hourly.precipitation_probability?.[i]})).filter(x=>x.time?.slice(0,10)===d.time[index]&&Number(x.time.slice(11,13))>=period.from&&Number(x.time.slice(11,13))<period.to&&Number.isFinite(x.temp));
    if(hours.length){const min=Math.min(...hours.map(x=>x.temp)),max=Math.max(...hours.map(x=>x.temp)),rain=hours.filter(x=>Number.isFinite(x.rain)).map(x=>x.rain);return withContext({answer:result.place+' '+d.time[index]+' '+period.label+'：气温约'+min+'～'+max+'℃。'+(rain.length?'降雨概率最高约'+Math.max(...rain)+'%。':'降雨概率暂无小时数据。')+'这是查询时的小时预报。',sources:[{label:'Open-Meteo 小时天气预报',href:'https://open-meteo.com/en/docs',id:d.time[index]}],metrics:{kind:'live-weather',fetchedAt:c.now(),period:period.label}});}
   }
   return withContext({answer:result.place+' '+d.time[index]+'：'+(conditions[d.weather_code?.[index]]||'天气情况见预报')+'，'+lo+'～'+hi+'℃。'+(!index&&Number.isFinite(w.current?.temperature_2m)?'当前约'+w.current.temperature_2m+'℃。':''),
    sources:[{label:'Open-Meteo 天气预报',href:'https://open-meteo.com/en/docs',id:d.time[index]}],metrics:{kind:'live-weather',fetchedAt:c.now()}});
  }catch{return withContext({answer:'天气来源暂时没连上，稍后再查一次；这次不使用旧数据。',sources:[],metrics:{kind:'live-weather',unavailable:true}});}
 }
 if(/新闻|八卦|娱乐|明星/.test(question)){
  const culture=/八卦|娱乐|明星|文娱/.test(question),feed=culture?'culture':'scroll-news';
  try{
   const items=await cached('news:'+feed,5*60000,async()=>{
    const xml=await limited('https://www.chinanews.com.cn/rss/'+feed+'.xml',fetchImpl);
    return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(match=>{
     const field=name=>clean(match[1].match(new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]);
     return {title:field('title').slice(0,150),href:field('link'),at:field('pubDate')};
    });
   });
   const fresh=items.filter(x=>{let u;try{u=new URL(x.href);}catch{return false;}const at=Date.parse(x.at);return x.title&&u.protocol==='https:'&&/(^|\.)chinanews\.com\.cn$/.test(u.hostname)&&Number.isFinite(at)&&now-at>=-3600000&&now-at<48*3600000;}).slice(0,3);
   if(!fresh.length)throw Error('no-current-headlines');
   return {answer:(culture?'最近公开报道的文娱消息':'近期新闻')+'：\n'+fresh.map((x,i)=>(i+1)+'. '+x.title+'（'+c.day(x.at)+'）').join('\n'),
    sources:fresh.map(x=>({label:x.title,href:x.href,id:x.at})),metrics:{kind:'live-news',fetchedAt:c.now()}};
  }catch{return {answer:'新闻来源暂时没取到近期内容，可以打开中新网看最新报道。娱乐消息也以公开报道为准。',sources:[{label:'中新网新闻',href:'https://www.chinanews.com.cn/',id:'news-home'}],metrics:{kind:'live-news',unavailable:true}};}
 }
 return null;
}
module.exports={query,cityFrom,weatherInput,locationParts,clearCache:()=>{cache.clear();pending.clear();}};
