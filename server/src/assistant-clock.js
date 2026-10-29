'use strict';
const c=require('./common');
const zone='Asia/Shanghai',dayNames=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const offsets={今天:0,今日:0,今儿:0,今儿个:0,现在:0,明天:1,后天:2,昨天:-1,昨日:-1,前天:-2};
const dayWord='今天|今日|今儿个|今儿|现在|明天|后天|昨天|昨日|前天';
function query(question,{now=Date.now(),context=null}={}) {
 const q=String(question||'').normalize('NFKC').replace(/幾/g,'几').replace(/[\s，,。.!！?？：:]/g,'')
  .replace(/^(?:(?:请|麻烦|帮我|帮忙|告诉我|查一下|查查|查|看看|看一下|问一下|想问一下|你知道|你知不知道))+/,'');
 const valid=context&&Number.isFinite(context.at)&&now-context.at>=0&&now-context.at<30*60000;
 const followup=valid&&q.match(new RegExp('^(?:那|那么)?('+dayWord+')(?:呢|的呢|啊|呀)?$'));
 const calendar=new RegExp('^(?:'+dayWord+')?(?:是|的)?(?:星期几|周几|礼拜几|几月几[日号]|几[日号]|多少号|什么日期|日期(?:是多少|是什么)?)(?:(?:和)?(?:星期几|周几|礼拜几))?(?:了|啊|呀|呢|吗|嘛|哟|哦|来着|你知道吗)*$').test(q);
 const time=/^(?:现在|此刻|北京)?(?:是|的)?(?:几点(?:钟)?|什么时间|时间是多少|北京时间)(?:了|啊|呀|呢|吗|嘛)*$/.test(q)||/^(?:现在|此刻|北京时间)(?:是|的)?(?:什么时候|啥时候|几时)(?:了|啊|呀|呢|吗|嘛)*$/.test(q);
 if(!calendar&&!time&&!followup)return null;
 const word=followup?.[1]||q.match(new RegExp(dayWord))?.[0]||'今天',dayOffset=offsets[word];
 const date=c.day(now+dayOffset*86400000),[year,month,day]=date.split('-').map(Number);
 // Construct weekdays from the calendar date at UTC midnight, independent of server timezone.
 const weekdayName=dayNames[new Date(date+'T00:00:00Z').getUTCDay()];
 const label=dayOffset===0?'今天':dayOffset===1?'明天':dayOffset===2?'后天':dayOffset===-1?'昨天':'前天';
 const clock=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
 return {answer:time?'现在是北京时间'+year+'年'+month+'月'+day+'日 '+clock+'，'+weekdayName+'。':label+'是'+year+'年'+month+'月'+day+'日，'+weekdayName+'。',
  sources:[],metrics:{kind:'live-clock',timeZone:zone,date,weekday:weekdayName,clockContext:{at:now,dayOffset}}};
}
module.exports={query};
