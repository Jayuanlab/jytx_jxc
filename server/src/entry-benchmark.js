'use strict';
function browserProbe(){
 'use strict';
 const start=performance.now(),originalFetch=window.fetch,requests=[],failures=[];let pending=0,last=start,finished=false,loaded=document.readyState==='complete';
 const touch=()=>{last=performance.now();};
 const patch=function(input,options){
  const url=new URL(typeof input==='string'?input:input.url,location.href),method=String(options?.method||input?.method||'GET').toUpperCase();
  const row={path:url.pathname,method,started:Math.round(performance.now())};requests.push(row);pending++;touch();
  return originalFetch.apply(this,arguments).then(response=>{
   row.status=response.status;row.headersMs=Math.round(performance.now()-row.started);if(!response.ok)failures.push({path:row.path,status:response.status});
   for(const key of ['json','text','blob','arrayBuffer','formData']){const fn=response[key];if(typeof fn!=='function')continue;response[key]=function(){pending++;touch();return fn.apply(this,arguments).finally(()=>{row.ms=Math.round(performance.now()-row.started);pending--;touch();});};}
   return response;
  },error=>{row.error=String(error?.name||'fetch-error');failures.push({path:row.path,error:row.error});throw error;}).finally(()=>{pending--;touch();});
 };
 window.fetch=patch;
 window.addEventListener('load',()=>{loaded=true;touch();},{once:true});
 const mutations=new MutationObserver(touch);mutations.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
 const interval=setInterval(()=>{
  if(finished||(!loaded||pending||performance.now()-last<800)&&performance.now()<25000)return;
  finished=true;clearInterval(interval);mutations.disconnect();if(window.fetch===patch)window.fetch=originalFetch;
  const nav=performance.getEntriesByType('navigation')[0],resources=performance.getEntriesByType('resource').filter(r=>new URL(r.name).origin===location.origin),apis=resources.filter(r=>new URL(r.name).pathname.startsWith('/api/'));
  const result={status:pending?'timeout':'settled',readyMs:Math.round(last),documentMs:Math.round(nav?.responseEnd||0),ttfbMs:Math.round(nav?.responseStart||0),domContentMs:Math.round(nav?.domContentLoadedEventEnd||0),loadMs:Math.round(nav?.loadEventEnd||0),pending,requests,failures,apiBytes:apis.reduce((n,r)=>n+r.encodedBodySize,0),assetsBytes:resources.filter(r=>!new URL(r.name).pathname.startsWith('/api/')).reduce((n,r)=>n+r.encodedBodySize,0),resources:apis.map(r=>({path:new URL(r.name).pathname,ms:Math.round(r.duration),waitMs:Math.round(r.responseStart-r.startTime),transferMs:Math.round(r.responseEnd-r.responseStart),bytes:r.encodedBodySize,serverTiming:(r.serverTiming||[]).map(t=>({name:t.name,ms:t.duration}))}))};
  const out=document.createElement('output');out.id='module-entry-benchmark';out.hidden=true;out.dataset.result=JSON.stringify(result);document.body.append(out);
 },100);
}
function inject(html){return html.replace(/<head\b([^>]*)>/i,'<head$1><script id="module-entry-probe" src="/entry-benchmark.js?v=20261023-speed"></script>');}
module.exports={inject,browserProbe};
