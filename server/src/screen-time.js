'use strict';
// 北京时间分段：早 06–11，午 11–14，下午 14–18，晚 18–24，凌晨 00–06。
const WINDOWS=Object.freeze({
 morning:{mode:'time',start:'06:00',end:'11:00'},
 noon:{mode:'time',start:'11:00',end:'14:00'},
 afternoon:{mode:'time',start:'14:00',end:'18:00'},
 evening:{mode:'time',start:'18:00',end:'00:00'},
 overnight:{mode:'time',start:'00:00',end:'06:00'}
});
const LABELS=Object.freeze({morning:'早间 06:00–11:00',noon:'午间 11:00–14:00',afternoon:'下午 14:00–18:00',evening:'晚间 18:00–24:00',overnight:'凌晨 00:00–06:00'});
function bodyOnly(text){
 let value=String(text||'').trim();
 for(let i=0;i<3;i++){
  const next=value.replace(/^(?:通知提示|通知内容|店内通知|重要提醒|电子屏内容|播报内容|通知|提示)[：:\s]+/,'').trim();
  if(next===value)break;
  value=next;
 }
 return value;
}
function periodIn(text){
 const q=String(text||'');
 if(/凌晨|深夜|半夜/.test(q))return 'overnight';
 if(/晚上|晚间|今晚|夜间|夜色|夜晚/.test(q))return 'evening';
 if(/下午|午后/.test(q))return 'afternoon';
 if(/中午|午间|午安/.test(q))return 'noon';
 if(/早上|早间|早安|清晨/.test(q))return 'morning';
 return null;
}
function greetingPeriod(text){
 const q=String(text||'');
 const found=[
  /早上好|早安|清晨好|早晨好|新的一天/.test(q)?'morning':null,
  /中午好|午安|午间愉快/.test(q)?'noon':null,
  /下午好|午后愉快/.test(q)?'afternoon':null,
  /晚上好|晚安|今晚|夜色|晚间愉快/.test(q)?'evening':null,
  /凌晨好|深夜好/.test(q)?'overnight':null
 ].filter(Boolean);
 return new Set(found).size>1?'mixed':found[0]||null;
}
function periodOfSchedule(value){
 if(!value||value.mode!=='time')return null;
 return Object.keys(WINDOWS).find(key=>value.start===WINDOWS[key].start&&value.end===WINDOWS[key].end)||null;
}
function fits(text,schedule){
 const greeting=greetingPeriod(text);
 return !greeting||greeting!=='mixed'&&periodOfSchedule(schedule)===greeting;
}
function scheduleFor(period){return period&&WINDOWS[period]?{...WINDOWS[period]}:{mode:'all'};}
module.exports={WINDOWS,LABELS,bodyOnly,periodIn,greetingPeriod,periodOfSchedule,fits,scheduleFor};