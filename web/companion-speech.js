'use strict';
// Spoken answers keep a per-user preference. Rendering saved history never starts speech.
(function(root){
 function create({synth=root?.speechSynthesis,Utterance=root?.SpeechSynthesisUtterance,storage,onState=()=>{},onError=()=>{}}={}){
  if(storage===undefined)try{storage=root?.localStorage;}catch{}
  const available=!!(synth&&Utterance);let enabled=true,speaking=false,user='',token=0,utterances=[];const seen=new Set();
  const state=()=>({available,enabled:enabled&&available,speaking});
  const update=()=>onState(state());
  function cancel(){token++;utterances=[];speaking=false;try{synth?.cancel();}catch{}update();}
  function setUser(id){if(!id||id===user)return;cancel();user=String(id);seen.clear();let value=null;try{value=storage?.getItem('companion-read:'+user);}catch{}enabled=value!=='0';update();}
  function setEnabled(value){enabled=!!value;if(user)try{storage?.setItem('companion-read:'+user,enabled?'1':'0');}catch{}if(!enabled)cancel();else update();}
  function prime(){if(!available||!enabled||speaking)return;try{const blank=new Utterance(' ');blank.volume=0;synth.speak(blank);}catch{}}
  function chunks(text){const parts=String(text).replace(/https?:\/\/\S+/g,'链接').replace(/[*#`]/g,'').match(/[^。！？；\n]{1,120}[。！？；\n]?/g)||[];return parts.map(t=>t.trim()).filter(Boolean);}
  function speak(text){if(!available||!enabled)return;cancel();const parts=chunks(text);if(!parts.length)return;const generation=token;let remaining=parts.length;speaking=true;update();
   utterances=parts.map(part=>{const u=new Utterance(part);u.lang='zh-CN';u.rate=.9;u.onend=()=>{if(generation!==token)return;if(--remaining===0){speaking=false;utterances=[];update();}};u.onerror=e=>{if(generation!==token)return;cancel();if(!['canceled','interrupted'].includes(e?.error))onError('自动朗读仍已开启，但浏览器这次没有播放。点回答下方“朗读”重试，并检查手机音量。');};return u;});
   try{for(const u of utterances)synth.speak(u);}catch{cancel();onError('当前浏览器朗读暂不可用，请稍后重试。');}
  }
  function answer(text,id){if(!id||seen.has(id))return;seen.add(id);while(seen.size>30)seen.delete(seen.values().next().value);speak(text);}
  function manual(text){setEnabled(true);speak(text);}
  update();return {state,setUser,setEnabled,prime,answer,manual,cancel,stop:()=>setEnabled(false)};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={create};else root.CompanionSpeech={create};
})(typeof window==='undefined'?null:window);
