'use strict';
const {createHmac,randomUUID,timingSafeEqual}=require('node:crypto');
const MAX_BYTES=128*1024, MAX_REPLY=8000, SESSION_TTL=30*60*1000;
class ChatError extends Error {constructor(code){super(code);this.code=code;}}
function configuration(env){
 if(env.ASSISTANT_CHAT_ENABLED!=='true')return null;
 const key=String(env.ASSISTANT_CHAT_API_KEY||'').trim();
 let url;try{url=new URL(env.ASSISTANT_CHAT_URL);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||!key||/[\r\n]/.test(key))return null;
 return {url:url.href,key,timeout:Math.max(1000,Math.min(30000,Number(env.ASSISTANT_CHAT_TIMEOUT_MS)||20000)),maxConcurrent:Math.max(1,Math.min(32,Number(env.ASSISTANT_CHAT_MAX_CONCURRENT)||8))};
}
function identity(scope,user,mode){
 return JSON.stringify([scope?.tenantId||'local',scope?.branchId||'local',String(user.id),String(user.roleCode||''),user.permissionRevision||0,mode]);
}
async function readBody(response){
 if(!response.body)throw new ChatError('empty-response');
 const reader=response.body.getReader(),parts=[];let bytes=0;
 try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;
 if(bytes>MAX_BYTES)throw new ChatError('response-too-large');parts.push(Buffer.from(next.value));}
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 return Buffer.concat(parts).toString('utf8');
}
function parseResponse(raw,type,sessionId){
 let data;
 if(/text\/event-stream/i.test(type)){
  let reply='',intent,done=false,hits=[],returnedSession;
  for(const frame of raw.split(/\r?\n\r?\n/)){
   const lines=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart());
   if(!lines.length)continue;
   let event;try{event=JSON.parse(lines.join('\n'));}catch{throw new ChatError('invalid-stream');}
   if(done)throw new ChatError('data-after-done');
   if(event.success===false||event.error)throw new ChatError('upstream-error');
   if(event.intent!==undefined){if(intent&&intent!==event.intent)throw new ChatError('intent-changed');intent=event.intent;}
   if(event.hits!==undefined)hits=event.hits;
   if(event.t!==undefined){if(typeof event.t!=='string')throw new ChatError('invalid-stream');reply+=event.t;if(reply.length>MAX_REPLY)throw new ChatError('reply-too-long');}
   if(event.done===true){done=true;returnedSession=event.sessionId;}
  }
  if(!done)throw new ChatError('incomplete-stream');
  data={success:true,sessionId:returnedSession,intent,reply,hits};
 }else{
  if(!/application\/json/i.test(type))throw new ChatError('unexpected-content-type');
  try{data=JSON.parse(raw);}catch{throw new ChatError('invalid-json');}
 }
 if(!data||data.success!==true||typeof data.reply!=='string'||!data.reply.trim()||data.reply.length>MAX_REPLY)throw new ChatError('invalid-response');
 if(data.sessionId!==sessionId)throw new ChatError('session-mismatch');
 if(typeof data.intent!=='string'||! /^[a-z][a-z0-9_-]{0,30}$/i.test(data.intent))throw new ChatError('invalid-intent');
 if(data.hits!==undefined&&!Array.isArray(data.hits))throw new ChatError('invalid-hits');
 const hits=(data.hits||[]).slice(0,10).map(hit=>{
  if(!hit||typeof hit.std!=='string'||!hit.std.trim()||hit.std.length>500||!Number.isFinite(hit.score)||hit.score<0||hit.score>1)throw new ChatError('invalid-hits');
  return {std:hit.std.trim(),score:hit.score};
 });
 return {reply:data.reply.trim(),intent:data.intent,hits};
}
function createClient({env=process.env,fetchImpl=globalThis.fetch,now=Date.now}={}){
 let active=0;
 const signature=(cfg,id,sessionId,at,business)=>createHmac('sha256',cfg.key).update(JSON.stringify([id,sessionId,at,business||null])).digest('hex');
 function valid(previous,id,cfg=configuration(env)){
  if(!cfg||!previous||typeof previous.sessionId!=='string'||! /^[0-9a-f-]{36}$/.test(previous.sessionId)||!Number.isFinite(previous.at)||now()-previous.at<0||now()-previous.at>=SESSION_TTL||typeof previous.signature!=='string'||! /^[0-9a-f]{64}$/.test(previous.signature))return false;
  return timingSafeEqual(Buffer.from(previous.signature,'hex'),Buffer.from(signature(cfg,id,previous.sessionId,previous.at,previous.business),'hex'));
 }
 return {
  configured:()=>Boolean(configuration(env)),
  hasContext:(previous,id)=>valid(previous,id),
  async request(message,previous,id){
   const cfg=configuration(env);if(!cfg)return {status:'disabled'};
   if(typeof message!=='string'||!message.trim()||message.length>1000)return {status:'unavailable',reason:'invalid-message'};
   if(active>=cfg.maxConcurrent)return {status:'unavailable',reason:'busy'};
   active++;const sessionId=valid(previous,id,cfg)?previous.sessionId:randomUUID();
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),cfg.timeout);
   try{
    const response=await fetchImpl(cfg.url,{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+cfg.key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({message:message.trim(),sessionId,stream:false})});
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new ChatError('http-'+response.status);}
    let result=parseResponse(await readBody(response),response.headers.get('content-type')||'',sessionId);
    // A purchase classifier must not replace consultation. Check the independent knowledge endpoint.
    if((result.intent==='deal'||!result.hits.some(hit=>hit.score>=0.7)&&/号卡|手机卡|电话卡|流量|数据包|套餐|资费|宽带|办卡|验证码|身份证/.test(message))&&new URL(cfg.url).pathname==='/api/public/chat'){
     try{
      const searchUrl=new URL(cfg.url);searchUrl.pathname='/api/public/knowledge-search';
      const lookup=await fetchImpl(searchUrl.href,{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+cfg.key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({q:/流量包|数据包/.test(message)?'单独加个流量包好多钱':message.trim(),source:'mobile',topK:5})});
      if(lookup.ok&&/application\/json/i.test(lookup.headers.get('content-type')||'')){
       const search=JSON.parse(await readBody(lookup));
       const entries=search.success===true&&Array.isArray(search.entries)?search.entries:[];
       const best=entries.filter(row=>row&&row.source==='mobile'&&typeof row.std==='string'&&row.std.length<=500&&typeof row.answer==='string'&&row.answer.trim()&&row.answer.length<=MAX_REPLY&&Number.isFinite(row.score)&&row.score>=0.7&&row.score<=1&&(!/流量包|数据包/.test(message)||/流量包/.test(row.std))&&!/随机|作废|自测|随测|vtestnamespace|银河|冥王星|[a-z]{12,}/i.test(row.std)).sort((a,b)=>b.score-a.score)[0];
       if(best)result={reply:best.answer.trim(),intent:'biz',hits:[{std:best.std,score:best.score}]};
      }else await lookup.body?.cancel().catch(()=>{});
     }catch{/* Retain the original response for the website's safe fallback. */}
    }
    // Upstream sometimes labels a matched tariff answer as other. Evidence determines its kind.
    if(result.hits.length)result.intent='biz';
    const at=now();
    // Never expose the key or arbitrary upstream fields to the browser.
    const business=result.intent==='biz'&&result.hits.length?{question:message.trim(),reply:result.reply,hits:result.hits}:valid(previous,id,cfg)?previous.business:undefined;
    return {status:'ok',...result,context:{sessionId,at,...(business?{business}:{}),signature:signature(cfg,id,sessionId,at,business)}};
   }catch(error){return {status:'unavailable',reason:controller.signal.aborted?'timeout':error instanceof ChatError?error.code:'network'};}
   finally{clearTimeout(timer);active--;}
  }
 };
}
module.exports={createClient,identity,configured:(env=process.env)=>Boolean(configuration(env))};
