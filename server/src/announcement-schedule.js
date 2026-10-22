'use strict';
const c=require('./common');
const DAY=86400000,OFFSET=8*3600000;
const PRESETS=Object.freeze({
 all:{name:'全天',mode:'all'},
 morning:{name:'上午',mode:'time',start:'06:00',end:'12:00'},
 noon:{name:'中午',mode:'time',start:'12:00',end:'14:00'},
 afternoon:{name:'下午',mode:'time',start:'14:00',end:'18:00'},
 evening:{name:'晚上',mode:'time',start:'18:00',end:'06:00'}
});
function minute(text){if(typeof text!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))throw new c.HttpError(400,'播放时间须为00:00至23:59');return Number(text.slice(0,2))*60+Number(text.slice(3));}
function normalize(value){
 if(value===undefined||value===null)return {mode:'all',preset:'all'};
 if(typeof value!=='object'||Array.isArray(value))throw new c.HttpError(400,'请选择播放时间');
 if(value.mode==='all')return {mode:'all',preset:'all'};
 if(value.mode!=='time')throw new c.HttpError(400,'请选择全天或自定义时间段');
 const start=minute(value.start),end=minute(value.end);if(start===end)throw new c.HttpError(400,'开始与结束时间不能相同；全天播放请选择全天');
 const preset=Object.entries(PRESETS).find(([,p])=>p.mode==='time'&&p.start===value.start&&p.end===value.end)?.[0]||'custom';
 return {mode:'time',preset,start:value.start,end:value.end};
}
function active(row,now){
 if(!row.active)return false;
 let s;try{s=normalize(row.schedule)}catch{return false}
 if(s.mode==='all')return true;
 const m=Math.floor(((now+OFFSET)%DAY+DAY)%DAY/60000),start=minute(s.start),end=minute(s.end);
 return start<end?m>=start&&m<end:m>=start||m<end;
}
function nextChange(rows,now){
 const inDay=((now+OFFSET)%DAY+DAY)%DAY;
 const waits=[];
 for(const row of rows){if(!row.active)continue;let s;try{s=normalize(row.schedule)}catch{continue}if(s.mode==='all')continue;
  for(const text of [s.start,s.end]){let wait=minute(text)*60000-inDay;if(wait<=0)wait+=DAY;waits.push(wait)}
 }
 return waits.length?new Date(now+Math.min(...waits)).toISOString():null;
}
function label(value){let s;try{s=normalize(value)}catch{return '时间设置有误'}
 if(s.mode==='all')return '全天';
 const name=PRESETS[s.preset]?.name||'自定义';
 return name+' '+s.start+'–'+s.end+(minute(s.end)<minute(s.start)?'（跨夜）':'');
}
function normalizeDisplay(value){
 if(value===undefined||value===null)return {mode:'scroll'};
 if(typeof value!=='object'||Array.isArray(value)||!['scroll','fixed','fade'].includes(value.mode))throw new c.HttpError(400,'请选择滚动、固定或淡入淡出');
 if(value.mode==='scroll')return {mode:'scroll'};
 const seconds=Number(value.seconds);
 if(typeof value.seconds==='boolean'||value.seconds===''||!Number.isSafeInteger(seconds)||seconds<3||seconds>3600)throw new c.HttpError(400,'停留时间须为3至3600秒的整数');
 return {mode:value.mode,seconds};
}
function displayLabel(value){let d;try{d=normalizeDisplay(value)}catch{return '显示设置有误'}
 return d.mode==='scroll'?'滚动':(d.mode==='fixed'?'固定':'淡入淡出')+' · '+d.seconds+'秒';
}
module.exports={PRESETS,normalize,active,nextChange,label,normalizeDisplay,displayLabel};
