'use strict';
// Private chat research: bounded public data reads; no brokerage, order or portfolio writes.
const cache=new Map(),pending=new Map();let active=0;
const SYMBOL=/^(?:sh(?:6\d{5}|000001)|sz[03]\d{5})$/;
const INDEX_NAMES={'sh000001':'上证综指','sz399001':'深证成指','sz399006':'创业板指'};
const ALIASES={'贵州茅台':'sh600519','茅台':'sh600519','平安银行':'sz000001','招商银行':'sh600036','比亚迪':'sz002594','宁德时代':'sz300750','中国移动':'sh600941','上证综指':'sh000001','上证指数':'sh000001','沪指':'sh000001','深证成指':'sz399001','深成指':'sz399001','创业板指数':'sz399006','创业板指':'sz399006','创业板':'sz399006'};
function input(question,context){
 const q=String(question).trim();if(/^(?:请)?(?:帮我)?(?:记住|记下来|记一下)/.test(q))return null;
 // A remembered stock is context for an explicit stock question, not evidence of holdings or a weather request.
 if(/^(?:我的股票|我持有的股票|我持仓|我的持仓)(?:怎么办|怎么判断|如何处理|呢)?[？?。]?$/.test(q))return {clarify:'先告诉我具体股票名称或六位代码；若要结合你的持仓，还需成本、仓位和持有期限。目前没有读取你的证券账户，不能擅自认定你持有哪些股票。'};
 if(/^(?:今天|现在|明天|当地|这里)?(?:的)?天气(?:怎么样|如何|预报|呢)?[？?。]?$/.test(q))return null;
 const marketSignal=/股票|股价|A股|股市|行情|公司|企业|业绩|盈利|利润|收入|需求|成本|产能|供应|供货|个股|该股|这只|买|卖|涨|跌|市值|(?<!\d)[036]\d{5}(?!\d)/;
 const ordinaryWeatherOrEvent=/天气|气温|下雨|降雨|晴天|阴天|几度|预报|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|雨雪|寒潮|台风|干旱|汛期|地质灾害|地震|洪水|滑坡|泥石流|山火/;
 if(ordinaryWeatherOrEvent.test(q)&&!marketSignal.test(q)&&!Object.keys(ALIASES).some(name=>q.includes(name)))return null;
 const codes=[...q.matchAll(/(?<!\d)(?:(sh|sz|沪|深)\s*)?([036]\d{5})(?!\d)/ig)];
 const interest=/(?:我(?:平时|平常|一直|很)?(?:喜欢|爱|关注|研究)(?:A股|股票|股市|炒股)|我(?:平时|平常|一直|很)?炒股|我的(?:爱好|兴趣)(?:是|有)?(?:A股|股票|炒股))/.test(q);
 const alias=Object.keys(ALIASES).find(x=>q.includes(x)&&!(x==='中国移动'&&!/股票|股价|行情|持仓|投资|分析/.test(q)));
 const sectors=['机器人','半导体','新能源'].filter(name=>q.includes(name));
 const sectorPreference=sectors.length>0&&/^(?:我|我的|本人)/.test(q)&&/选股|股票|股市|投资|炒股|板块|概念股/.test(q)&&/重点|关注|喜欢|偏好|兴趣|看好|研究|主要/.test(q)&&!/为什么|怎么|如何|哪些|哪只|推荐|分析|走势|行情|现价|涨跌|买卖|[？?]/.test(q);
 if(sectorPreference)return {interestOnly:true,sectorInterest:sectors};
 if(sectors.length&&!codes.length&&!alias&&/板块|概念股|选股|股票|股市|A股|投资|行业|产业链|成分股|龙头|估值|行情|走势|涨跌/.test(q))return {sector:sectors};
 const follow=context&&SYMBOL.test(context.symbol)&&/^(?:那|它|这只|这条|这则|这份|这篇|这个|该股|继续|再|帮我|现在|明天|今天|刚才|公告|财报|美股|日经|海外|外围|听说|据说|网传|群里|利好|利空|烟雾弹|天气|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|暴雨|雨雪|寒潮|台风|干旱|汛期|这是|大家|还能|要不要|能不能|我(?:的)?(?:成本|持仓|买入|有))/.test(q)&&/股|涨|跌|买|卖|持仓|成本|分析|估值|风险|收益|加仓|减仓|消息|分红|公告|财报|业绩|政策|行业|美股|日经|海外|外围|利好|利空|传闻|拉升|放量|缩量|异动|烟雾弹|操纵|庄家|天气|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|雨雪|寒潮|台风|干旱|汛期|看好|怎么办|怎么判断/.test(q);
 const officialLink=context&&SYMBOL.test(context.symbol)&&/^https?:\/\/(?:www\.)?(?:cninfo\.com\.cn|sse\.com\.cn|szse\.cn)/i.test(q);
 const contextual=context&&SYMBOL.test(context.symbol)&&/烟雾弹|跷板效应|此涨彼跌|彼跌我涨|大家都看好|天气|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|暴雨|雨雪|寒潮|地质灾害|地震|洪水|滑坡|泥石流|山火|减产|停产|产量下降|我的股票|我持有的股票|我的持仓|我持仓/.test(q);
 const weatherNamed=q.match(/^(?:天气|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|暴雨|雨雪|寒潮|台风|干旱|汛期)(?:会|是否|对)?(?:影响|利好|利空|拖累)?([\u4e00-\u9fa5A-Za-z]{2,12})(?:的)?(?:股票|股价|公司)/);
 if(weatherNamed){const stockName=weatherNamed[1].replace(/的$/,'');if(stockName.length>=2&&!/^(?:这只|该只|我的|这家)$/.test(stockName)&&!['影响','利好','利空','拖累','股票','股市','公司'].includes(stockName))return {name:stockName};}
 const disasterQuestion=/地质灾害|地震|洪水|滑坡|泥石流|山火|重大损失|产量下降|减产|停产/.test(q)&&/股|公司|企业|产量|产品|供货|供给|供应|受益|受损|影响/.test(q);
 const concept=disasterQuestion?'disaster':/烟雾弹|传闻|庄家|操纵/.test(q)?'smoke':/跷板效应|此涨彼跌|彼跌我涨/.test(q)?'seesaw':/大家都看好|一致看好|一致看空/.test(q)?'consensus':/天气|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|雨雪|台风/.test(q)&&/股票|股市|A股/.test(q)?'weather':null;
 if(!codes.length&&!alias&&!follow&&!officialLink&&!contextual&&concept)return {concept};
 const unnamedHolding=/^(?:我的股票|我持有的股票|我持仓|我的持仓)/.test(q);
 if(!codes.length&&!alias&&!follow&&!officialLink&&!contextual&&unnamedHolding)return {clarify:'先告诉我具体股票名称或六位代码；若要结合你的持仓，还需成本、仓位和持有期限。目前没有读取你的证券账户，不能擅自认定你持有哪些股票。'};
 if(!codes.length&&!alias&&!follow&&!officialLink&&!contextual&&!interest&&!/A股|沪深股市|沪深两市|中国股市|股票|炒股|股市|股价|港股|美股|自选股|持仓|大盘|证券投资|市盈率|市净率|技术面|基本面|K线/i.test(q))return null;
 if(codes.length>1)return {clarify:'先逐只看，方便讲清依据。请告诉我这次分析哪一只股票的六位代码。'};
 if(/港股|美股|纳斯达克|纽交所|恒生/.test(q)&&!alias&&!codes.length&&!follow&&!officialLink&&!/A股|中国股市/.test(q))return {clarify:'当前行情查询先支持沪深A股。港股、美股还需接通相应数据；可以先讨论分析思路，不会把A股数据套过去。'};
 if(codes.length){const [,prefix,code]=codes[0],market=prefix?/^(?:sh|沪)$/i.test(prefix)?'sh':'sz':code.startsWith('6')?'sh':'sz',symbol=market+code;return SYMBOL.test(symbol)?INDEX_NAMES[symbol]?{index:symbol}:{symbol}:{clarify:'这个代码和交易所未能对应，请核对股票名称、六位代码及沪市或深市。'};}
 if(alias)return INDEX_NAMES[ALIASES[alias]]?{index:ALIASES[alias],interest}:{symbol:ALIASES[alias],interest};
 if(follow||officialLink||contextual)return INDEX_NAMES[context.symbol]?{index:context.symbol,interest}:{symbol:context.symbol,interest};
 if(/大盘/.test(q))return {market:true,interest};
 if(/A股|沪深股市|沪深两市|中国股市/i.test(q))return interest&&!/分析|行情|信息|走势|怎么样|如何|最近|这几天|今天|现在|了解|看看|情况|推荐|哪些|什么|[？?]/.test(q)?{interestOnly:true}:{market:true,interest};
 if(interest&&/^(?:我|我的)/.test(q)&&!/分析|查|看看|怎么样|行情|现在|今天|最近|推荐|哪些|什么|[？?]/.test(q))return {interestOnly:true};
 if(/^(?:你(?:现在|还)?|个人助理)?(?:懂|懂不懂|会|会不会|知道|能不能|可以)(?:分析|讲|看|聊)?(?:股票|炒股|股市)[吗呢不？?。]*$/.test(q))return {clarify:'可以帮你看股票。请告诉我股票名称或六位代码，我会先查有时间的行情，再解释走势和风险。'};
 const name=q.replace(/^(?:请|你|给我|帮我|麻烦|能不能|能|可以|想|我想|看一下|看看|分析一下|分析|查一下|查询|查|评判一下|评判|了解|判断一下|判断|一下|今天|现在|这只|这个)+/g,'').replace(/(?:的)?(?:股票|股价|行情|怎么样|如何|能买吗|能买|该买吗|值不值得买|有风险吗|分析|评判|一下|\s|[？?。！!,，：:])+$/g,'').trim();
 if(/^[\u4e00-\u9fa5A-Za-z*]{2,12}$/.test(name)&&!['股票','帮我','能不能','会不会','会','懂不懂','你会','你会不会','分析一只','一只','懂','什么是','我想炒','我想买'].includes(name))return {name};
 return {clarify:'可以帮你看股票。告诉我股票名称或六位代码，例如“分析600519”。我会查带时间的行情、近期走势和主要风险；有持仓可再告诉我成本、仓位和打算持有多久。'};
}
async function read(url,{fetchImpl=globalThis.fetch,encoding='utf-8',max=524288}={}){
 const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(6000),headers:{Accept:'text/plain, application/json'}});if(!r.ok)throw Error('upstream');
 const chunks=[];let size=0;const reader=r.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('oversize')}chunks.push(Buffer.from(value));}
 return new TextDecoder(encoding).decode(Buffer.concat(chunks));
}
function number(value){if(!/^-?\d+(?:\.\d+)?$/.test(String(value)))return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function quote(text,symbol,now=Date.now()){
 if(!SYMBOL.test(symbol))throw Error('symbol');const match=text.match(new RegExp('v_'+symbol+'="([^"\\r\\n]*)"'));if(!match)throw Error('missing');
 const f=match[1].split('~'),time=f[30]||'',stamp=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(time);if(f[2]!==symbol.slice(2)||!stamp||!f[1]||f[1].length>40)throw Error('identity');
 const at=`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}+08:00`,ms=Date.parse(at);
 if(!Number.isFinite(ms)||new Date(ms+8*3600000).toISOString().slice(0,19)!==at.slice(0,19)||ms>now+5*60000)throw Error('time');
 const price=number(f[3]),previousClose=number(f[4]),high=number(f[33]),low=number(f[34]);if(price===null||price<=0||previousClose===null||previousClose<=0||high===null||low===null||high<low||price>high||price<low)throw Error('price');
 const change=price-previousClose,changePercent=change/previousClose*100,shownChange=number(f[31]),shownPercent=number(f[32]);if(shownChange===null||shownPercent===null||Math.abs(change-shownChange)>.03||Math.abs(changePercent-shownPercent)>.03)throw Error('change');
 return {symbol,name:f[1],unit:INDEX_NAMES[symbol]?'点':'元',price,previousClose,high,low,change,changePercent,at,pe:number(f[39]),pb:number(f[46]),turnover:number(f[38]),fetchedAt:new Date(now).toISOString(),older:now-ms>3*86400000};
}
function history(text,symbol,at){
 const obj=JSON.parse(text);if(obj.code!==0)throw Error('history');const d=obj.data?.[symbol],adjusted=Array.isArray(d?.qfqday),rows=adjusted?d.qfqday:d?.day;if(!Array.isArray(rows)||rows.length>120)throw Error('history');
 let previous='';const bars=rows.map(r=>{if(!Array.isArray(r)||!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||r[0]<=previous||r[0]>at.slice(0,10))throw Error('date');previous=r[0];const close=number(r[2]),high=number(r[3]),low=number(r[4]);if(close===null||close<=0||high===null||low===null||high<low||close>high||close<low)throw Error('bar');return {date:r[0],close};});
 if(!bars.length||bars.at(-1).date!==at.slice(0,10))throw Error('history-stale');
 const avg=n=>bars.length<n?null:bars.slice(-n).reduce((s,b)=>s+b.close,0)/n;
 return {kind:adjusted?'前复权日线':'日线',lastDate:bars.at(-1).date,close:bars.at(-1).close,count:bars.length,ma5:avg(5),ma20:avg(20),ma60:avg(60),change5:bars.length>=6?(bars.at(-1).close/bars.at(-6).close-1)*100:null,change20:bars.length>=21?(bars.at(-1).close/bars.at(-21).close-1)*100:null,bars:bars.slice(-61)};
}
function hints(text){const m=text.match(/^\s*v_hint\s*=\s*("(?:[^"\\]|\\.)*")\s*;?\s*$/);if(!m)throw Error('search');return JSON.parse(m[1]).split('^').map(x=>x.split('~')).filter(x=>x[4]==='GP-A'&&SYMBOL.test(x[0]+x[1])).map(x=>({symbol:x[0]+x[1],name:x[2]}));}
async function resolve(name,fetchImpl){const text=await read('https://smartbox.gtimg.cn/s3/?q='+encodeURIComponent(name)+'&t=all',{fetchImpl,encoding:'gb18030',max:65536});return hints(text).filter(x=>x.name===name);}
async function snapshot(symbol,{fetchImpl=globalThis.fetch,now=Date.now()}={}){
 if(!SYMBOL.test(symbol))throw Error('symbol');const key=symbol,standard=fetchImpl===globalThis.fetch;
 if(standard&&cache.has(key)&&now-cache.get(key).time<60000)return cache.get(key).data;if(standard&&pending.has(key))return pending.get(key);if(active>=6)throw Error('busy');
 const job=(async()=>{active++;try{
  const results=await Promise.allSettled([read('https://qt.gtimg.cn/q='+symbol,{fetchImpl,encoding:'gb18030',max:65536}),read('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+symbol+',day,,,80,qfq',{fetchImpl})]);
  if(results[0].status!=='fulfilled')throw Error('quote');const current=quote(results[0].value,symbol,now);let trend=null;try{if(results[1].status==='fulfilled')trend=history(results[1].value,symbol,current.at);}catch{}
  const data={quote:current,trend};if(standard){cache.set(key,{time:now,data});while(cache.size>100)cache.delete(cache.keys().next().value);}return data;
 }finally{active--;}})();if(standard)pending.set(key,job);try{return await job;}finally{if(standard)pending.delete(key);}
}
const disclosureCache=new Map(),disclosurePending=new Map();
let lastDisclosureFetch=0;
async function recentDisclosures(symbol,{fetchImpl=globalThis.fetch,now=Date.now()}={}){
 if(!SYMBOL.test(symbol)||INDEX_NAMES[symbol])throw Error('symbol');
 const standard=fetchImpl===globalThis.fetch;
 // CNINFO's site-internal endpoint is opt-in until API/licence terms are confirmed.
 if(standard&&process.env.PERSONAL_STOCK_DISCLOSURE_ENABLED!=='1')throw Error('disclosure-disabled');
 const saved=standard?disclosureCache.get(symbol):null;
 if(saved&&Date.now()-saved.savedAt<15*60000)return saved.rows;
 if(standard&&disclosurePending.has(symbol))return disclosurePending.get(symbol);
 if(standard&&Date.now()-lastDisclosureFetch<5000)throw Error('disclosure-rate-limited');
 if(standard)lastDisclosureFetch=Date.now();
 const job=(async()=>{
  const params=new URLSearchParams({searchkey:symbol.slice(2),sdate:'',edate:'',isfulltext:'false',sortName:'pubdate',sortType:'desc',pageNum:'1',pageSize:'20',type:''});
  const raw=await read('https://www.cninfo.com.cn/new/fulltextSearch/full?'+params,{fetchImpl,max:131072});
  const payload=JSON.parse(raw);
  if(!Array.isArray(payload.announcements)||payload.announcements.length>20)throw Error('disclosures');
  const cutoff=now-180*86400000,code=symbol.slice(2);
  return payload.announcements.filter(a=>String(a.secCode)===code).map(a=>{
   const date=Number(a.announcementTime),title=String(a.announcementTitle||'').replace(/<[^>]{0,100}>/g,'').replace(/[\r\n<>]/g,'').trim();
   const path=String(a.adjunctUrl||'');
   if(!Number.isFinite(date)||date<cutoff||date>now+5*60000||!title||title.length>120||!/^finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.PDF$/i.test(path))return null;
   return {date:new Date(date+8*3600000).toISOString().slice(0,10),title,url:'https://static.cninfo.com.cn/'+path,source:'巨潮资讯官方公告'};
  }).filter(Boolean).slice(0,3);
 })();
 if(standard)disclosurePending.set(symbol,job);
 try{const rows=await job;if(standard){disclosureCache.set(symbol,{savedAt:Date.now(),rows});while(disclosureCache.size>50)disclosureCache.delete(disclosureCache.keys().next().value)}return rows}
 finally{if(standard)disclosurePending.delete(symbol)}
}


const fmt=n=>Number(n).toFixed(2),sign=n=>n>0?'+':'';
const shortTime=iso=>String(iso).slice(0,19).replace('T',' ');
const beijingNow=now=>new Date(now+8*3600000).toISOString().slice(0,16).replace('T',' ');
const amplitude=q=>(q.high-q.low)/q.previousClose*100;
function trendLine(t,unit){
 if(!t||t.change5===null)return '近5个交易日日线不足，走势暂不能判断';
 let state='震荡';
 if(t.ma5!==null&&t.ma20!==null){
  if(t.change5>0&&t.ma5>t.ma20)state='短线偏强';
  else if(t.change5<0&&t.ma5<t.ma20)state='短线偏弱';
 }
 return '近5个交易日'+sign(t.change5)+fmt(t.change5)+'%，'+state;
}
function quoteFreshness(q,now=Date.now()){
 const local=new Date(now+8*3600000),date=local.toISOString().slice(0,10),day=local.getUTCDay(),minutes=local.getUTCHours()*60+local.getUTCMinutes();
 const regularSession=day>=1&&day<=5&&((minutes>=570&&minutes<=690)||(minutes>=780&&minutes<=900));
 if(q.older)return {status:'old',note:'该行情超过3天，仅供历史回顾'};
 if(q.at.slice(0,10)!==date)return regularSession?{status:'lag',note:'按通常A股交易时段，报价仍是前一日或更早，尚未更新到今天；不可当实时价'}:{status:'last-close',note:'这是最近可见收盘，未见当日新行情；休市日历未核对，不可当实时价'};
 const age=now-Date.parse(q.at);
 if(regularSession&&age>15*60000)return {status:'lag',note:'按通常A股交易时段，报价已超过15分钟未更新；不可当实时价'};
 if(minutes>915&&Date.parse(q.at)<Date.parse(date+'T14:45:00+08:00'))return {status:'lag',note:'收盘后仍缺临近收盘行情，不能当作今日最终收盘价'};
 return {status:'current',note:''};
}function indexLine(data,now=Date.now()){
 const q=data.quote,fresh=quoteFreshness(q,now);
 return INDEX_NAMES[q.symbol]+' '+fmt(q.price)+'点（'+sign(q.changePercent)+fmt(q.changePercent)+'%）；日内'+fmt(q.low)+'～'+fmt(q.high)+'点、振幅'+fmt(amplitude(q))+'%；'+trendLine(data.trend,'点')+'；行情时间'+shortTime(q.at)+(fresh.note?'；'+fresh.note:'');
}
function marketReport(results,now=Date.now()){
 const lines=['答复时间'+beijingNow(now)+'（北京）。'];
 for(const [symbol,result] of results){
  lines.push(result.status==='fulfilled'?indexLine(result.value,now):INDEX_NAMES[symbol]+'：行情来源暂未返回有效数据，不能报点位');
 }
 lines.push('来源：腾讯证券公开行情（可能延迟）。走势仅描述已发生数据；仅供参考，不作依据。');
 return lines.join('\n');
}
function assessRelationship(stockTrend,indexTrend,days){
 if(![20,60].includes(days))throw Error('window');
 const a=stockTrend?.bars,b=indexTrend?.bars,required=days+1;
 if(!Array.isArray(a)||!Array.isArray(b))return {status:'missing',days,required};
 if(a.length<required||b.length<required)return {status:'insufficient',days,required,available:Math.min(a.length,b.length)};
 const left=a.slice(-required),right=b.slice(-required);
 if(left.some((bar,i)=>bar.date!==right[i].date))return {status:'date-mismatch',days,required};
 const x=[],y=[];let sameDays=0,oppositeDays=0,validDays=0;
 for(let i=1;i<required;i++){
  const p=left[i].close/left[i-1].close-1,r=right[i].close/right[i-1].close-1;
  if(!Number.isFinite(p)||!Number.isFinite(r)||left[i-1].close<=0||right[i-1].close<=0)return {status:'invalid',days,required};
  x.push(p);y.push(r);
  if(Math.abs(p)>=0.0005&&Math.abs(r)>=0.0005){validDays++;if(p*r>0)sameDays++;else oppositeDays++;}
 }
 const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
 const mx=mean(x),my=mean(y),cov=x.reduce((sum,value,i)=>sum+(value-mx)*(y[i]-my),0),vx=x.reduce((sum,value)=>sum+(value-mx)**2,0),vy=y.reduce((sum,value)=>sum+(value-my)**2,0);
 if(validDays<Math.ceil(days*.7)||vx<1e-12||vy<1e-12)return {status:'low-variation',days,required,validDays};
 const correlation=Math.max(-1,Math.min(1,cov/Math.sqrt(vx*vy)));
 const relationship=correlation<=-.45&&oppositeDays/validDays>=.6?'inverse':correlation>=.45&&sameDays/validDays>=.6?'same':'weak';
 return {status:'ok',days,startDate:left[0].date,endDate:left.at(-1).date,validDays,sameDays,oppositeDays,correlation,relationship};
}
function relationshipLine(result){
 const label='过去'+result.days+'个交易日：';
 if(result.status==='missing')return label+'个股或指数日线未取得，关系未知。';
 if(result.status==='insufficient')return label+'仅有'+result.available+'个可用收盘点，至少需要'+result.required+'个，关系未知。';
 if(result.status==='date-mismatch')return label+'个股与指数日期未逐日对齐，关系未知，不拼接错位数据。';
 if(result.status!=='ok')return label+'有效涨跌样本或波动不足，相关性未知。';
 const kind=result.relationship==='inverse'?'观察到较明显反向':result.relationship==='same'?'观察到较明显同向':'方向关系偏弱或不稳定';
 return label+result.startDate+'至'+result.endDate+'；同向'+result.sameDays+'/'+result.validDays+'日、反向'+result.oppositeDays+'/'+result.validDays+'日；日涨跌相关系数'+sign(result.correlation)+fmt(result.correlation)+'，'+kind+'。';
}
function shortOutlook(q,trend,twenty,sixty,now=Date.now()){
 if(q.older)return '未来1～5个交易日：报价超过3天，不能据旧价预判；先取新行情，再核对正式公告与公司盈利。';
 if(quoteFreshness(q,now).status!=='current')return '未来1～5个交易日：当前报价不是可核实的本交易时段行情，暂不作当前涨跌倾向或买卖预判；先取得更新行情与正式公告。';
 if(!trend||trend.ma20===null||trend.ma5===null||trend.change5===null)return '未来1～5个交易日：日线或均价样本不足，暂不能给方向倾向；先补齐对齐行情和正式公告。';
 const strong=trend.change5>0&&trend.ma5>trend.ma20&&q.price>=trend.ma20;
 const weak=trend.change5<0&&trend.ma5<trend.ma20&&q.price<trend.ma20;
 const bias=strong?'短线价格偏强':weak?'短线价格偏弱':'方向暂不明确';
 const inverseBoth=twenty.relationship==='inverse'&&sixty.relationship==='inverse';
 const swing=inverseBoth?'20/60日均观察到反向，但这只是历史关系；后续指数涨跌只能当观察线索，个股仍须自身价格与公告验证。':twenty.relationship==='inverse'?'20日见反向而60日未证实，不能当稳定跷板规律。':'未证实稳定跷板关系，不能按指数涨跌机械反做。';
 return '未来1～5个交易日（条件性预判）：'+bias+'。上涨情景：守住或重新站上20日均价'+fmt(trend.ma20)+'元，近5日走势改善，并由正式公告/财报证实盈利与现金流；下跌情景：跌破该均价或正式披露显示盈利转弱。破坏信号：价格方向反转、公告与预期相反，或原来观察到的个股/指数反向关系不再出现。'+swing+'不承诺涨跌和胜率。';
}
function weatherAndSeason(question){
 const asked=/天气|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|暴雨|雨雪|寒潮|台风|干旱|汛期/.test(String(question||''));
 const lead=asked?'你问的天气/季节影响目前不能直接定向为利好或利空。':'天气/季节是否影响本股尚未核实。';
 return '天气与季节核验：'+lead+'需先核公司主营业务、受影响地区和供应链，再核带发布时间/地区的气象预报或可比历史季节数据，说明需求、产量、物流或成本如何传到收入、利润和现金流，并用后续正式财报验证。当前没有这些公司暴露、天气及财报证据，不能说高温、雨雪已造成股价涨跌。';
}function disasterLens(question){
 if(!/地质灾害|地震|洪水|滑坡|泥石流|山火|重大损失|产量下降|减产|停产/.test(String(question||'')))return null;
 return '灾害/减产影响核验：先确认具体地点、发生时间、产品和官方灾情及公司公告。直接暴露要查该地厂矿、供应链、运输和产能/销量占比，以及库存、保险与替代产能；潜在替代供应商可能受益，也须核实际可供货量、价格变化与成本。当前没有完成这些核验，不能列确定受影响或受益公司，更不能编损失金额。';
}function informationRisk(question,disclosures){
 const q=String(question||'');
 const rumor=/传闻|据说|听说|网传|群里|小道消息|内幕|庄家|操纵/.test(q);
 const snippet=/标题|截图|片段|转发|摘录|公告内容/.test(q);
 const oldNews=/旧闻|以前|去年|上个月|之前|早前/.test(q);
 const volume=/放量|缩量|量价|换手|异动|拉升|砸盘|庄家|操纵|资金/.test(q);
 const parts=[];
 if(rumor)parts.push('你提到的传闻或市场说法未经独立核验，不能纳入买卖证据');
 if(oldNews)parts.push('可能涉及旧闻，先核对首次披露日期和当前进展，不能把旧消息当新消息');
 if(snippet)parts.push('标题、截图或片段不足以代表公告全文，须核证券代码、原文和风险提示');
 parts.push(disclosures.length?'正式公告目前仅核到标题和日期，未核全文':'正式公告内容尚未核实');
 parts.push('所谓利好是否真正增加盈利，须核合同兑现、利润和经营现金流');
 parts.push(volume?'尚无可比成交量与逐笔资金数据，无法验证量价背离、短时异动的成因，更不能认定操纵或“庄家”':'成交量与逐笔资金数据未核，不能判断量价背离或操纵');
 return '消息真伪筛查：'+parts.join('；')+'。未经证实的信息不作为买卖预判依据。';
}function report(data,{now=Date.now(),benchmark=null,disclosures=[],disclosureStatus='unavailable',question=''}={}){
 const q=data.quote,t=data.trend,fresh=quoteFreshness(q,now),unit=q.unit||'元',lines=[
  q.name+'（'+q.symbol.slice(2)+'）｜答复'+beijingNow(now)+'（北京）；行情'+shortTime(q.at)+'。来源：腾讯证券公开行情（可能延迟）。',
  '已核实报价：'+fmt(q.price)+unit+'，较前收盘'+sign(q.changePercent)+fmt(q.changePercent)+'%；日内'+fmt(q.low)+'～'+fmt(q.high)+unit+'，振幅'+fmt(amplitude(q))+'%。'
 ];
 if(fresh.status!=='current')lines.push('行情时效：'+fresh.note+'。暂不依据这份报价给出当前买卖倾向。');
 if(t)lines.push('近期走势：'+trendLine(t,unit)+'；'+(t.change20===null?'20日变化资料不足':'近20个交易日'+sign(t.change20)+fmt(t.change20)+'%')+'；'+(t.ma20===null?'20日均价资料不足':'20日均价'+fmt(t.ma20)+unit+'，当前价'+(q.price>=t.ma20?'在其上方':'在其下方'))+'。');
 else lines.push('近期走势：日线暂未取得，不能凭当日涨跌推断趋势。');
 const aligned=benchmark&&benchmark.quote.at.slice(0,10)===q.at.slice(0,10)&&Math.abs(Date.parse(benchmark.quote.at)-Date.parse(q.at))<=30*60000,b=aligned?benchmark.quote:null;
 if(b)lines.push('同期市场：'+INDEX_NAMES[b.symbol]+' '+fmt(b.price)+'点（'+sign(b.changePercent)+fmt(b.changePercent)+'%；行情'+shortTime(b.at)+'）。仅作市场背景，不能直接归因为本股涨跌。');
 else lines.push('同期大盘数据未核实，不能判断相对强弱。');
 const relation20=assessRelationship(t,benchmark?.trend,20),relation60=assessRelationship(t,benchmark?.trend,60);
 lines.push('历史跷板核验（对照'+(INDEX_NAMES[benchmark?.quote?.symbol]||'A股指数')+'，截至'+q.at.slice(0,10)+'）：'+relationshipLine(relation20)+' '+relationshipLine(relation60)+' 历史同向或反向不保证未来继续。');
 if(q.pe>0||q.pb>0)lines.push('估值线索：'+(q.pe>0?'市盈率'+fmt(q.pe)+'倍':'市盈率缺失')+'；'+(q.pb>0?'市净率'+fmt(q.pb)+'倍':'市净率缺失')+'。未结合最新财报和同行，不能据此判定便宜或昂贵。');
 if(disclosures.length)lines.push('最近正式公告（巨潮资讯；只核对标题和日期，未读取全文）：'+disclosures.map(x=>x.date+'《'+x.title+'》').join('；')+'。公告影响仍需读原文和财报后判断。');
 else lines.push(disclosureStatus==='disabled'?'正式公告自动检索尚未启用。可粘贴公告标题、日期、关键段落或官方链接；用户提供材料尚未独立核验，先核对原文。':'正式公告：未取得可按代码核对的近期公告，内容和影响未知；可提供官方公告标题、日期或链接供核对。');
 lines.push('同行比较：尚未取得可信同行名单、同口径财报及对应行情，暂不能判断这家公司是否优于同类型公司。');
 lines.push('行业/宏观与资金面：同期政策、行业盈利和资金流尚未核实；不能把这些因素写成已发生的利好或利空。');
 const positives=[],negatives=[];
 if(t&&t.change5!==null){
  if(t.change5>0)positives.push('近5日价格上行'+fmt(t.change5)+'%');
  if(t.change5<0)negatives.push('近5日价格下行'+fmt(-t.change5)+'%');
  if(t.ma20!==null) (q.price>=t.ma20?positives:negatives).push('价格'+(q.price>=t.ma20?'站在':'低于')+'20日均价');
 }
 if(amplitude(q)>=5)negatives.push('当日振幅'+fmt(amplitude(q))+'%，短线波动较大');
 lines.push('看多证据（已核实价格）：'+(positives.length?positives.join('；'):'暂无明确支撑')+'。盈利兑现、政策利好和同行优势未知。');
 lines.push('看空证据（已核实价格）：'+(negatives.length?negatives.join('；'):'暂无明确支撑')+'。负面公告、估值拥挤度和资金压力未知。');
 if(b){
  const opposite=(q.changePercent>0.05&&b.changePercent< -0.05)||(q.changePercent< -0.05&&b.changePercent>0.05);
  lines.push('A股内部对照：本股与'+INDEX_NAMES[b.symbol]+'当日'+(opposite?'方向相反':'未见明确反向')+'（本股'+sign(q.changePercent)+fmt(q.changePercent)+'%，指数'+sign(b.changePercent)+fmt(b.changePercent)+'%）。只确认对齐时点的价格方向，不能归因于海外或市场共识。');
 }else lines.push('A股内部对照：未取得同一时段的指数行情，方向关系未知。');
 lines.push('海外反向情景：美股、日经尚无经授权且带来源、交易日和收盘时间的行情，无法确认这次是否与A股反向。隔夜美股与当日日经须按时区对齐；即便海外同涨同跌，也不能直接推出A股买卖方向。');
 lines.push('市场共识反证：未取得机构一致预期、估值历史分位、换手拥挤度与资金流，不能说“大家一致看好”或“一致看空”。若日后核实看好拥挤但盈利、现金流未兑现，风险可能升高；若看空而正式财报或本地政策改善，原看空判断可能失效。这是待验证情景，不是当前事实，也不能机械反向操作。');
 lines.push(informationRisk(question,disclosures));
 lines.push(weatherAndSeason(question));
 const disasterNote=disasterLens(question);if(disasterNote)lines.push(disasterNote);
 lines.push(shortOutlook(q,t,relation20,relation60,now));
 let judgment='资料不足，暂偏观望。',trigger='取得新行情、读完公告和财报，并核对行业、同行及外围变化。',invalid='若出现与当前判断相反的已核实事实，立即重评。';
 if(q.older){judgment='行情过时，先取得新报价，暂偏观望。';trigger='拿到新报价和同期市场数据。';invalid='新数据推翻旧价格走势。';}
 else if(fresh.status!=='current'){judgment='报价未更新到当前交易时段，暂不判断买卖方向。';trigger='取得带时间的新行情并核对公告。';invalid='新行情与旧收盘走势不同。';}
 else if(t&&t.ma20!==null&&t.ma5!==null&&t.change5!==null){
  if(t.change5>0&&t.ma5>t.ma20&&q.price>=t.ma20){judgment='技术走势偏强，但基本面及外围证据未齐，暂偏观望；补齐材料后才考虑分批买入。';trigger='正式公告与财报无重大不利变化，且价格继续站稳20日均价。';invalid='跌破20日均价、盈利不及预期或公告出现重大不利信息。';}
  else if(t.change5<0&&t.ma5<t.ma20&&q.price<t.ma20){judgment='技术走势偏弱；若已持有且触及自己的风险线，可研究减仓或卖出；新买暂缓。';trigger='确认风险线、持仓成本，并核对公告与公司盈利。';invalid='重新站上20日均价且盈利、公告等证据改善。';}
 }
 lines.push('买/观望/卖（条件性推断）：'+judgment+'触发条件：'+trigger+'失效条件：'+invalid+'证据仍有限，仅供参考，不作依据。');
 return lines.join('\n\n');
}


async function query(question,{context=null,fetchImpl=globalThis.fetch,now=Date.now(),model=null}={}){
 const request=input(question,context);if(!request)return null;
 const wrap=(answer,metrics={},sources=[],connected=false,extra={})=>({answer,sources,channel:'life',modelConnected:connected,metrics:{kind:'personal-stocks',...metrics},...extra});
 const preference=request.sectorInterest?{memorySuggestion:'我选股重点关注'+request.sectorInterest.join('、')+'板块。'}:(request.interest||request.interestOnly)?{memorySuggestion:'我关注A股，喜欢研究股票。'}:{};
 if(request.concept){
  const answers={
   smoke:'识别股市“烟雾弹”要先核正式公告与首次披露时间，再看全文是否被截取、所谓利好能否传到收入和利润；没有成交量、逐笔资金与可靠消息源，不能断言异动原因或“庄家操纵”。未经核实的传闻不作为买卖依据。给我股票代码或官方公告链接，我再逐项核对。',
   seesaw:'“此涨彼跌、彼跌我涨”可能发生，但不是固定规律。要对齐个股与相关A股指数的交易日，用至少21/61个收盘点分别看过去20/60日同反向次数与日涨跌相关性；历史关系不能保证未来。美股、日经还需合法且带时间的行情才可比较。给我股票代码，我再列未来1～5日的条件情景。',
   consensus:'大家看好不一定是好事，也不能据此机械卖出。先核机构一致预期、估值历史分位、资金与成交拥挤度，再看盈利和现金流是否兑现；当前未核这些数据，无法说市场确已一致看好。给我具体股票代码，才能分析支持与反对证据。',
   weather:'天气和季节不会让所有股票同涨同跌。先确认具体公司的业务与地区暴露，再核气象发布时间、历史季节性及对需求/成本/利润的传导；目前未核这些资料。给我股票代码，才能按公司分析。',
   disaster:'灾害或某地减产可能同时造成直接受损与替代供应受益，不能只按新闻标题猜股票。先给出地点、发生时间、产品及官方灾情或公司公告；再核该地产能/销量占比、厂矿和物流受损、库存/保险/替代产能，及产品价格变化。没有这些证据就不能列受影响名单、损失金额或买卖结论。'
  };
  return wrap(answers[request.concept],{stockConcept:request.concept});
 } if(request.interestOnly)return wrap(request.sectorInterest?'你选股重点关注'+request.sectorInterest.join('、')+'。我会把它作为待你确认的记忆建议；现在不自动保存，也不会据板块名称直接荐股。':'知道你喜欢关注股票了。以后问A股或具体股票，我会先核对带时间的行情，再按已有资料分析；如果你希望我下次记得这个爱好，可以确认下方的记忆建议。',{},[],false,preference);
 if(request.sector)return wrap('答复时间'+beijingNow(now)+'（北京）。你问的'+request.sector.join('、')+'板块，目前尚未取得可核验日期和来源的板块成分股、板块行情及同行财报，不能列确定成分名单、当前涨跌或直接推荐买卖。若给出具体沪深A股六位代码，我可以按有时间的个股行情分析；选股还需逐一核公司主营收入占比、正式公告、财报和估值。仅供参考，不作依据。',{stockSector:request.sector});
 if(request.market){
  const symbols=['sh000001','sz399001','sz399006'],values=await Promise.allSettled(symbols.map(symbol=>snapshot(symbol,{fetchImpl,now})));
  const marketAnswer=marketReport(symbols.map((symbol,i)=>[symbol,values[i]]),now);
  const contrastAsked=/反向|反着|逆向|海外|外围|美股|日经|一致看好|都看好|都说涨/.test(String(question));
  const contrastNote=contrastAsked?'\n美股、日经缺经授权且有交易日/时间的行情，暂不能核实当前是否与A股反向；“大家一致看好”也缺一致预期及拥挤度数据。A股还要核对本地盈利、政策、估值与资金，不能机械跟随或反着操作。':'';
  const weatherNote=/天气|季节|春天|夏天|秋天|冬天|春季|夏季|秋季|冬季|雨季|高温|暴雨|雨雪|寒潮|台风|干旱|汛期/.test(String(question))?'\n天气对A股没有统一涨跌方向；需指定公司，并核其业务/地区暴露、气象发布时间、财务传导和财报。目前这些证据未核实。':'';
  return wrap(marketAnswer+contrastNote+weatherNote,{stockMarket:true,stockSnapshots:values.map((result,i)=>result.status==='fulfilled'?{symbol:symbols[i],...result.value}:null)},symbols.map(symbol=>({label:'查看腾讯证券'+INDEX_NAMES[symbol]+'行情',href:'https://gu.qq.com/'+symbol})),false,preference);
 }
 if(request.index){
  const symbol=request.index;let data;
  try{data=await snapshot(symbol,{fetchImpl,now});}
  catch{return wrap(INDEX_NAMES[symbol]+'：行情来源暂未返回有效数据，不能报点位。答复时间'+beijingNow(now)+'（北京）；请稍后重试。仅供参考，不作依据。',{stockMarket:true,index:symbol},[],false,preference);}
  return wrap('答复时间'+beijingNow(now)+'（北京）。\n'+indexLine(data,now)+'。\n来源：腾讯证券公开行情（可能延迟）；仅供参考，不作依据。',{stockMarket:true,index:symbol,stockSnapshots:[{symbol,...data}]},[{label:'查看腾讯证券'+INDEX_NAMES[symbol]+'行情',href:'https://gu.qq.com/'+symbol}],false,preference);
 }
 if(request.clarify)return wrap(request.clarify,{},[],false,preference);
 let symbol=request.symbol;
 if(!symbol){try{const matches=await resolve(request.name,fetchImpl);if(matches.length!==1)return wrap('没有把“'+request.name+'”唯一对应到一只沪深A股。请发六位代码，避免分析错股票。');symbol=matches[0].symbol;}catch{return wrap('股票名称查询暂时没有返回。请给我六位代码，我再按代码查行情。');}}
 const benchmarkSymbol=symbol.startsWith('sz30')?'sz399006':'sh000001';
 const results=await Promise.allSettled([snapshot(symbol,{fetchImpl,now}),snapshot(benchmarkSymbol,{fetchImpl,now}),recentDisclosures(symbol,{fetchImpl,now})]);
 if(results[0].status!=='fulfilled')return wrap('这只股票的行情来源暂时未返回有效数据，我不会凭印象报价格。请稍后再试；也可以提供带时间的行情截图一起分析。',{stockContext:{symbol}});
 const data=results[0].value,benchmark=results[1].status==='fulfilled'?results[1].value:null,disclosures=results[2].status==='fulfilled'?results[2].value:[],disclosureStatus=results[2].status==='fulfilled'?'titles':results[2].reason?.message==='disclosure-disabled'?'disabled':'unavailable';
 let analysis=null;
 if(quoteFreshness(data.quote,now).status==='current'&&model?.configured())try{const reply=await model.request('请根据所提供的资料，整理'+data.quote.name+'（'+symbol.slice(2)+'）股票研究的下一步核对事项。只返回要求的JSON格式。',{mode:'personal',marketContext:{...data,benchmark,userQuestion:question}});const parsed=JSON.parse(String(reply||'').replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g,''));if(Object.keys(parsed).length===1&&Array.isArray(parsed.checks)&&parsed.checks.length>=1&&parsed.checks.length<=3&&parsed.checks.every(x=>typeof x==='string'&&x.length<=100&&/^(?:核对|确认|检查|了解|比较|查看|梳理|考虑|先|请|你|有没有|是否|需要)/.test(x)&&!/\d|套餐|资费|营业员|新闻信息|今日头条|稳赚|保证(?:盈利|收益)|一定(?:会)?涨|目标价|估值偏[高低]|板块里|属于.*估值/.test(x)))analysis=parsed.checks.map((x,i)=>(i+1)+'、'+x).join('\n');}catch{}
 const sources=[{label:'腾讯证券行情与日线',href:'https://gu.qq.com/'+symbol},{label:'巨潮资讯官方公告检索',href:'https://www.cninfo.com.cn/new/fulltextSearch?keyWord='+symbol.slice(2)},...disclosures.map(x=>({label:'正式公告：'+x.date+' '+x.title,href:x.url}))];
 if(benchmark)sources.push({label:'腾讯证券'+INDEX_NAMES[benchmarkSymbol]+'行情',href:'https://gu.qq.com/'+benchmarkSymbol});
 const supplied=/https?:\/\/\S+/.test(String(question))||/公告(?:内容|原文|摘要)[:：]/.test(String(question));
 const materialNote=supplied?'\n\n你提供的公告文字或链接尚未独立核验，也未自动读取链接全文；先对照官方证券代码、发布日期、公告原文，再核查盈利、现金流、风险提示及是否与旧公告矛盾。':'';
 return wrap(report(data,{now,benchmark,disclosures,disclosureStatus,question})+materialNote+(analysis?'\n\n下一步核对：\n'+analysis:''),{stockContext:{symbol,name:data.quote.name},stockSnapshot:data,benchmarkSnapshot:benchmark,disclosures,disclosureStatus},sources,!!analysis,preference);
}
module.exports={query,input,quote,history,hints,snapshot,recentDisclosures,assessRelationship,relationshipLine,shortOutlook,informationRisk,weatherAndSeason,disasterLens,report,marketReport,quoteFreshness,clearCache:()=>{cache.clear();pending.clear();disclosureCache.clear();disclosurePending.clear();}};

