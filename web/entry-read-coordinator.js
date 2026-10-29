(()=>{'use strict';
 if(window.StoreEntryReads)return;
 const original=window.fetch.bind(window),pending=new Map();let generation=0;
 const allowed=new Set(['/api/me','/api/local-notices','/api/display-preferences','/api/assistant/roles']);
 function clear(){generation++;pending.clear();}
 window.StoreEntryReads={clear};
 window.fetch=function(input,init){
  const request=typeof Request!=='undefined'&&input instanceof Request?input:null;
  const method=String(init?.method||request?.method||'GET').toUpperCase();
  let url;try{url=new URL(typeof input==='string'?input:input.url,location.href);}catch{return original(input,init);}
  if(url.origin!==location.origin)return original(input,init);
  if(method!=='GET'){clear();return original(input,init);}
  // Only share simultaneous reads. No persisted cache, no financial result cache.
  if(!allowed.has(url.pathname)||init?.signal||request?.signal||init?.headers||request)return original(input,init);
  const key=generation+' '+url.href+' '+String(init?.credentials||'same-origin');
  let item=pending.get(key);
  if(!item){item=Promise.resolve().then(()=>original(input,init));pending.set(key,item);item.finally(()=>{if(pending.get(key)===item)pending.delete(key);}).catch(()=>{});}
  return item.then(response=>response.clone());
 };
 addEventListener('pagehide',clear);
})();
