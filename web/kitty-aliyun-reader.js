(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.KittyAliyunReader=factory();})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 function create({request,cancelRemote=()=>{},Context=globalThis.AudioContext||globalThis.webkitAudioContext,onState=()=>{},onError=()=>{},decodeBase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))}={}){
  let context,source,abort,sequence=0,current=null;
  function unlock(){if(!Context)return Promise.resolve(false);try{context ||= new Context();return Promise.resolve(context.resume()).then(()=>context.state==='running').catch(()=>false);}catch{return Promise.resolve(false);}}
  function stop(notify=true){sequence++;abort?.abort();abort=null;try{source?.stop();}catch{}source=null;if(current)Promise.resolve(cancelRemote(current)).catch(()=>{});if(notify)onState('stopped');}
  async function speak(ref){stop(false);const token=sequence;current=ref;abort=new AbortController();onState('loading');try{
   if(!context)throw Error('请先点一下发送或朗读按钮，允许播放声音。');
   const reply=await request(ref,{signal:abort.signal});if(token!==sequence)return;
   if(reply.model!=='qwen-audio-3.1-tts-flash'||reply.voice!=='longanhuan_v3.1'||reply.mime!=='audio/wav'||typeof reply.audioBase64!=='string')throw Error('这次没有取得阿里重庆话语音，请点重新朗读。');
   const bytes=decodeBase64(reply.audioBase64);if(bytes.length<44||bytes.length>12*1024*1024+44)throw Error('本次语音不完整，请重新朗读。');
   const audio=await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));if(token!==sequence)return;
   if(context.state!=='running'){const available=await unlock();if(token!==sequence)return;if(!available)throw Error('手机暂停了声音播放，请点重新朗读。');}
   source=context.createBufferSource();source.buffer=audio;source.connect(context.destination);source.onended=()=>{if(token===sequence){source=null;onState('ended');}};source.start();onState('playing');
  }catch(e){if(token===sequence&&e.name!=='AbortError'){onState('error');onError(e.message||'语音暂不可用，文字已保留。');}}finally{if(token===sequence)abort=null;}}
  return {unlock,stop,speak};
 }
 return {create};
});
