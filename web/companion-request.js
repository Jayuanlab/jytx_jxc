'use strict';
// Retain the original write key only while its outcome is uncertain. No draft is persisted.
(function(root){
 function create({fetchImpl=root?.fetch?.bind(root),uuid=()=>root.crypto.randomUUID(),timeoutMs=30000}={}){
  const writes=new Map();
  async function request(path,body,key){
   const writing=body!==undefined&&body!==null,signature=writing?JSON.stringify(body):'',slot=path+(key?'|'+key:'');
   let entry=writing?writes.get(slot):null;
   if(entry&&entry.signature!==signature)throw Error('上次保存结果还未确认，请先重试原内容；确认后再修改。');
   if(entry?.promise)return entry.promise;
   if(writing&&!entry){entry={signature,key:key||uuid()};writes.set(slot,entry);}
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   const work=(async()=>{
    try{
     const r=await fetchImpl(path,{method:writing?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:writing?{'Content-Type':'application/json','Idempotency-Key':entry.key}:undefined,body:writing?signature:undefined,signal:controller.signal});
     let d;try{d=await r.json();}catch{const error=Error(writing?'保存结果未确认，请重试原内容。':'读取结果不完整，请刷新重试。');error.status=r.status;error.uncertain=writing&&(r.ok||r.status>=500);throw error;}
     if(!r.ok){const error=Error(d?.error?.message||(typeof d?.error==='string'?d.error:'暂时无法读取'));error.status=r.status;error.uncertain=writing&&r.status>=500;throw error;}
     if(!d||typeof d!=='object'||Array.isArray(d)){const error=Error(writing?'保存结果未确认，请重试原内容。':'读取结果不完整，请刷新重试。');error.uncertain=writing;throw error;}
     if(writing)writes.delete(slot);return d;
    }catch(cause){
     const error=new Error(cause?.message||'请求暂时失败');error.name=cause?.name||'Error';error.status=cause?.status;error.uncertain=cause?.uncertain;
     if(writing){if(error.uncertain===undefined)error.uncertain=true;if(!error.uncertain)writes.delete(slot);}else if(error.name==='AbortError')error.message='读取超时，请稍后刷新。';
     if(writing&&error.uncertain&&!/未确认/.test(error.message))error.message='保存结果未确认，请重试原内容。'+(error.name==='AbortError'?'（等待超时）':'');
     throw error;
    }finally{clearTimeout(timer);if(entry)entry.promise=null;}
   })();if(entry)entry.promise=work;return work;
  }
  return {request,hasUncertain:()=>writes.size>0};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={create};else root.CompanionRequests={create};
})(typeof window==='undefined'?null:window);
