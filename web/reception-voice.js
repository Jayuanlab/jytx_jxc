/* One user-controlled listening session may span multiple browser recognition sessions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReceptionVoice=api;})(typeof window==='object'?window:this,()=>{
 'use strict';
 function create({Speech,onText=()=>{},onState=()=>{},maxLength=20000,timers={set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)}}){
  let wanted=false,rec=null,session=0,base='',finals='',interim='',restartTimer=null,endTimer=null,stopTimer=null,resolveStop=null,stopping=null,failures=0,lastError='',ended=false;
  const clear=name=>{timers.clear(name);};
  const join=(a,b)=>a&&b?a+'，'+b:a||b;
  const value=()=>join(base,join(finals,interim)).slice(0,maxLength);
  function emit(){onText(value(),{interim:!!interim});}
  function commit(){base=value();finals='';interim='';emit();}
  function settle(){clear(stopTimer);stopTimer=null;const resolve=resolveStop;resolveStop=null;stopping=null;resolve?.(base);}
  function detach(abort=false){const old=rec;rec=null;++session;if(old){old.onresult=old.onend=old.onerror=old.onstart=null;if(abort)try{old.abort();}catch{}}}
  function finish(reason){wanted=false;clear(restartTimer);clear(endTimer);clear(stopTimer);restartTimer=endTimer=stopTimer=null;commit();detach(true);settle();onState('stopped',reason);}
  function schedule(){
   if(!wanted||restartTimer)return;
   onState('listening','reconnecting');restartTimer=timers.set(()=>{restartTimer=null;if(wanted)open();},lastError==='network'?Math.min(5000,500*2**failures):400);
  }
  function open(){
   if(!wanted)return;detach();finals='';interim='';ended=false;lastError='';const generation=++session;
   let current;try{current=new Speech();}catch{finish('unavailable');return;}
   rec=current;current.lang='zh-CN';current.continuous=true;current.interimResults=true;current.maxAlternatives=1;
   current.onstart=()=>{if(generation===session&&wanted)onState('listening');};
   current.onresult=e=>{
    if(generation!==session)return;
    // Rebuild the session's result list: interim revisions must replace, never append.
    const done=[],pending=[];for(let i=0;i<e.results.length;i++){const r=e.results[i],t=String(r?.[0]?.transcript||'').trim();if(t)(r.isFinal?done:pending).push(t);}
    finals=done.join('，');interim=pending.join('，');failures=0;emit();
    if(join(base,join(finals,interim)).length>=maxLength){finish('limit');}
   };
   current.onerror=e=>{
    if(generation!==session)return;lastError=e.error||'unknown';
    if(['not-allowed','service-not-allowed','audio-capture','language-not-supported','bad-grammar'].includes(lastError)){finish(lastError);return;}
    if(!wanted)return;
    if(lastError!=='no-speech'&&lastError!=='aborted'&&++failures>=4){finish(lastError);return;}
    // Some engines emit error without end; retire that engine before opening another.
    clear(endTimer);endTimer=timers.set(()=>{if(generation!==session)return;commit();detach(true);if(wanted)schedule();else finish('user');},2000);
   };
   current.onend=()=>{
    if(generation!==session||ended)return;ended=true;clear(endTimer);endTimer=null;commit();detach();
    if(wanted)schedule();else{settle();onState('stopped','user');}
   };
   try{current.start();onState('listening');}catch(error){if(error.name==='NotAllowedError'){finish('not-allowed');return;}if(++failures>=4){finish('unavailable');return;}detach(true);schedule();}
  }
  function start(initial=''){
   if(wanted||stopping)return false;base=String(initial).trim().slice(0,maxLength);finals=interim='';failures=0;wanted=true;emit();open();return wanted;
  }
  function stop(){
   if(stopping)return stopping;
   wanted=false;clear(restartTimer);clear(endTimer);restartTimer=endTimer=null;
   if(!rec){commit();onState('stopped','user');return Promise.resolve(base);}
   const pending=new Promise(resolve=>{resolveStop=resolve;});stopping=pending;onState('stopping');
   stopTimer=timers.set(()=>finish('user'),1500);
   try{rec.stop();}catch{finish('user');}
   return pending;
  }
  function cancel(){wanted=false;clear(restartTimer);clear(endTimer);clear(stopTimer);restartTimer=endTimer=stopTimer=null;detach(true);settle();base=finals=interim='';}
  return {start,stop,cancel,value,isListening:()=>wanted};
 }
 return {create};
});
