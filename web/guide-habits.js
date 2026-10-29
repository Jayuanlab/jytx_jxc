(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StoreGuideHabits=api;})(typeof window==='object'?window:this,()=>{
 const slot=at=>{const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(new Date(at)));return h<11?'morning':h<15?'midday':h<19?'afternoon':'evening';};
 function record(events,id,at=Date.now()){return [...events.filter(e=>Number.isFinite(e.at)&&at-e.at<90*86400000),{id,at,slot:slot(at)}].slice(-240);}
 function recommend(entries,events,persona,at=Date.now()){
  const period=slot(at),fallback=persona==='owner'?['/m#pending','/boss-overview','/boss-batch']:period==='evening'?['/close','/sale-payments','/receptions?scope=followups']:['/receptions?assistant=1','/app?tab=sales','/app?tab=inventory'];
  const scores=new Map();for(const e of events){if(!Number.isFinite(e.at)||at<e.at||at-e.at>90*86400000)continue;const weight=(e.slot===period?4:1)*(at-e.at<7*86400000?2:1);scores.set(e.id,(scores.get(e.id)||0)+weight);}
  return entries.map((e,i)=>({...e,score:scores.get(e.id)||0,fallback:fallback.includes(e.id)?fallback.indexOf(e.id):100+i})).sort((a,b)=>b.score-a.score||a.fallback-b.fallback).slice(0,3).map(({score,fallback,...e})=>e);
 }
 return {slot,record,recommend};
});
