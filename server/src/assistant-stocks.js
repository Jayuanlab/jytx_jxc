'use strict';
// Private chat research: bounded public data reads; no brokerage, order or portfolio writes.
const cache=new Map(),pending=new Map();let active=0;
const SYMBOL=/^(?:sh(?:6\d{5}|000001)|sz(?:[03]\d{5}|399001))$/;
const ALIASES={'贵州茅台':'sh600519','茅台':'sh600519','平安银行':'sz000001','招商银行':'sh600036','比亚迪':'sz002594','宁德时代':'sz300750','中国移动':'sh600941','上证指数':'sh000001','大盘':'sh000001','深证成指':'sz399001'};
function input(question,context){
 const q=String(question).trim();if(/^(?:请)?(?:帮我)?(?:记住|记下来|记一下)/.test(q))return null;
 const codes=[...q.matchAll(/(?<!\d)(?:(sh|sz|沪|深)\s*)?([036]\d{5})(?!\d)/ig)];
 const alias=Object.keys(ALIASES).find(x=>q.includes(x)&&!(x==='中国移动'&&!/股票|股价|行情|持仓|投资|分析/.test(q)));
 const follow=context&&SYMBOL.test(context.symbol)&&/^(?:那|它|这只|该股|继续|再|帮我|现在|明天|今天|还能|要不要|能不能|我(?:的)?(?:成本|持仓|买入|有))/.test(q)&&/股|涨|跌|买|卖|持仓|成本|分析|估值|风险|收益|加仓|减仓|消息|分红/.test(q);
 if(!codes.length&&!alias&&!follow&&!/股票|炒股|股市|股价|港股|美股|自选股|持仓|大盘|证券投资|市盈率|市净率|技术面|基本面|K线/i.test(q))return null;
 if(codes.length>1)return {clarify:'先逐只看，方便讲清依据。请告诉我这次分析哪一只股票的六位代码。'};
 if(/港股|美股|纳斯达克|纽交所|恒生/.test(q))return {clarify:'当前行情查询先支持沪深A股。港股、美股还需接通相应数据；可以先讨论分析思路，不会把A股数据套过去。'};
 if(codes.length){const [,prefix,code]=codes[0],market=prefix?/^(?:sh|沪)$/i.test(prefix)?'sh':'sz':code.startsWith('6')?'sh':'sz',symbol=market+code;return SYMBOL.test(symbol)?{symbol}:{clarify:'这个代码和交易所未能对应，请核对股票名称、六位代码及沪市或深市。'};}
 if(alias)return {symbol:ALIASES[alias]};
 if(follow)return {symbol:context.symbol};
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
 return {symbol,name:f[1],unit:['sh000001','sz399001'].includes(symbol)?'点':'元',price,previousClose,high,low,change,changePercent,at,pe:number(f[39]),pb:number(f[46]),turnover:number(f[38]),fetchedAt:new Date(now).toISOString(),older:now-ms>3*86400000};
}
function history(text,symbol,at){
 const obj=JSON.parse(text);if(obj.code!==0)throw Error('history');const d=obj.data?.[symbol],adjusted=Array.isArray(d?.qfqday),rows=adjusted?d.qfqday:d?.day;if(!Array.isArray(rows)||rows.length>120)throw Error('history');
 let previous='';const bars=rows.map(r=>{if(!Array.isArray(r)||!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||r[0]<=previous||r[0]>at.slice(0,10))throw Error('date');previous=r[0];const close=number(r[2]),high=number(r[3]),low=number(r[4]);if(close===null||close<=0||high===null||low===null||high<low||close>high||close<low)throw Error('bar');return {date:r[0],close};});
 if(!bars.length||bars.at(-1).date!==at.slice(0,10))throw Error('history-stale');
 const avg=n=>bars.length<n?null:bars.slice(-n).reduce((s,b)=>s+b.close,0)/n;
 return {kind:adjusted?'前复权日线':'日线',lastDate:bars.at(-1).date,close:bars.at(-1).close,count:bars.length,ma5:avg(5),ma20:avg(20),ma60:avg(60),change20:bars.length>=21?(bars.at(-1).close/bars.at(-21).close-1)*100:null};
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
const fmt=n=>Number(n).toFixed(2),sign=n=>n>0?'+':'';
function report(data){
 const q=data.quote,t=data.trend,unit=q.unit||'元',at=q.at.slice(0,19).replace('T',' '),lines=[`${q.name}（${q.symbol.slice(2)}）`, `来源：腾讯证券公开行情；数据时间：${at}（北京时间）。这是来源最新快照，可能延迟；非交易时段保留最近交易数据。`,q.older?'这份行情超过3天，仅用于回顾，不能当作当前报价。':null,`最新价 ${fmt(q.price)}${unit}，较前收盘${sign(q.changePercent)}${fmt(q.changePercent)}%；当日区间${fmt(q.low)}～${fmt(q.high)}${unit}。`];
 if(t){lines.push(`走势：截至${t.lastDate}的${t.kind}，5日均价${t.ma5===null?'资料不足':fmt(t.ma5)+unit}，20日均价${t.ma20===null?'资料不足':fmt(t.ma20)+unit}，60日均价${t.ma60===null?'资料不足':fmt(t.ma60)+unit}。`);if(t.ma20!==null)lines.push(`该日收盘${t.close>=t.ma20?'在20日均线上方，短期走势相对较强':'低于20日均线，短期走势偏弱'}。均线只描述已发生的走势，不能保证后续涨跌。`);if(t.change20!==null)lines.push(`最近20个交易日的收盘变化${sign(t.change20)}${fmt(t.change20)}%（${t.kind}）。`);}else lines.push('近期日线暂未取得，暂不判断均线趋势。');
 if(q.pe>0||q.pb>0)lines.push(`估值线索：${q.pe>0?'来源市盈率'+fmt(q.pe)+'倍':'市盈率暂缺'}；${q.pb>0?'市净率'+fmt(q.pb)+'倍':'市净率暂缺'}。仅凭这些数字不能判定便宜，还要比较同行、盈利和负债。`);
 lines.push('接下来重点核对最新财报、公司公告、行业和政策变化；当前未接入这些材料及国际新闻，不能据此断言买卖。你可告诉我成本、仓位和持有计划，再一起衡量风险。');return lines.filter(Boolean).join('\n\n');
}
async function query(question,{context=null,fetchImpl=globalThis.fetch,now=Date.now()}={}){
 const request=input(question,context);if(!request)return null;
 const wrap=(answer,metrics={},sources=[])=>({answer,sources,channel:'life',modelConnected:false,metrics:{kind:'personal-stocks',...metrics}});
 if(request.clarify)return wrap(request.clarify);
 let symbol=request.symbol;
 if(!symbol){try{const matches=await resolve(request.name,fetchImpl);if(matches.length!==1)return wrap('没有把“'+request.name+'”唯一对应到一只沪深A股。请发六位代码，避免分析错股票。');symbol=matches[0].symbol;}catch{return wrap('股票名称查询暂时没有返回。请给我六位代码，我再按代码查行情。');}}
 let data;try{data=await snapshot(symbol,{fetchImpl,now});}catch{return wrap('这只股票的行情来源暂时未返回有效数据，我不会凭印象报价格。请稍后再试；也可以提供带时间的行情截图一起分析。',{stockContext:{symbol}});}
 // Free-form model checks can still smuggle an unsupported prediction through a word filter.
 // Keep stock answers limited to parsed, timestamped market data and fixed risk prompts.
 return wrap(report(data)+'\n\n以上供研究参考，投资有风险。',{stockContext:{symbol,name:data.quote.name},stockSnapshot:data},[{label:'查看腾讯证券行情',href:'https://gu.qq.com/'+symbol}]);
}
module.exports={query,input,quote,history,hints,snapshot,report,clearCache:()=>{cache.clear();pending.clear();}};
