(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StoreContinuityCore=api;})(typeof window==='object'?window:this,()=>{
 'use strict';
 const paths=new Set(['/app','/receptions','/carrier','/repair-services','/repair-materials','/stocktake','/air-recharge','/air-history','/air-accounts','/work-journal','/learning','/cash-handover','/daily-close','/close','/sale-payments','/sale-fund-responsibility','/sales-list','/funds','/document-query','/search','/opening-drafts','/used-phones']);
 const params=new Set(['tab','view','scope','reception','highlight','order','part','draft','closeout','id','mine','history']);
 function route(value){try{if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x20\x7f]/.test(value))return '';const u=new URL(value,'https://store.invalid');if(u.origin!=='https://store.invalid'||!paths.has(u.pathname))return '';const q=new URLSearchParams();for(const [k,v]of u.searchParams)if(params.has(k))q.set(k,v);q.sort();return u.pathname+(q.size?'?'+q:'');}catch{return '';}}
 function scope(value){return value&&Array.isArray(value)&&value.length===3&&value.every(v=>typeof v==='string'&&v.length>0&&v.length<200)?JSON.stringify(value):'';}
 function read(storage,key){try{const data=JSON.parse(storage.getItem(key)||'null');return data?.version===1&&data.pages&&data.adapters&&data.requests?data:{version:1,pages:{},adapters:{},requests:{}};}catch{return {version:1,pages:{},adapters:{},requests:{}};}}
 function write(storage,key,data){try{const pages=Object.entries(data.pages).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,30);data.pages=Object.fromEntries(pages);storage.setItem(key,JSON.stringify(data));return true;}catch{return false;}}
 function fieldAllowed(el){return !['password','file','hidden','checkbox','radio','submit','button','reset'].includes(String(el.type).toLowerCase())&&!/password|token|credential|confirm|approval|captcha/i.test((el.name||'')+' '+(el.id||''))&&!el.disabled&&!el.readOnly;}
 return {route,scope,read,write,fieldAllowed};
});
