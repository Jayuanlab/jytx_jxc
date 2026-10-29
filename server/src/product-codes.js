'use strict';
function peek(store){
 let n=Number.isSafeInteger(store.productCodeSequence)&&store.productCodeSequence>=0?store.productCodeSequence:0;
 const used=new Set();
 for(const p of store.products||[]){const code=String(p.externalCode||'').trim().toUpperCase(),match=/^JY(\d{4,12})$/.exec(code);used.add(code);if(match)n=Math.max(n,Number(match[1]));}
 let code;do{n++;if(!Number.isSafeInteger(n)||n>999999999999)throw Error('商品编码序号已超出范围');code='JY'+String(n).padStart(4,'0');}while(used.has(code));
 return code;
}
function next(store){const code=peek(store);store.productCodeSequence=Number(code.slice(2));return code;}
function assign(store){
 const used=new Set();for(const p of store.products||[]){if(/^JY\d{4,12}$/i.test(p.externalCode||'')){const value=p.externalCode.toUpperCase();if(used.has(value))throw Error('已有JY商品编码重复');used.add(value);}}
 const inStock=new Set((store.inventory||[]).filter(r=>Number(r.quantity)>0).map(r=>r.skuId));
 const rank=p=>/智能/.test(p.type)?0:/功能/.test(p.type)?1:/配件/.test(p.type)?2:3;
 const rows=store.products.slice().sort((a,b)=>Number(inStock.has(b.skuId))-Number(inStock.has(a.skuId))||rank(a)-rank(b)||String(a.name).localeCompare(String(b.name),'zh-CN')||a.skuId.localeCompare(b.skuId));
 const assigned=[];for(const p of rows){if(/^JY\d{4,12}$/.test(p.externalCode||''))continue;const old=String(p.externalCode||'').trim(),code=next(store);if(old){p.legacyExternalCodes=[...new Set([...(p.legacyExternalCodes||[]),old])];p.aliases=[...new Set([...(p.aliases||[]),old])];if(!p.barcode&&/^\d{8,14}$/.test(old))p.barcode=old;}p.externalCode=code;assigned.push({skuId:p.skuId,name:p.name,oldCode:old,code,inStock:inStock.has(p.skuId)});}
 return assigned;
}
function identity(store){const copy=structuredClone(store);delete copy.productCodeSequence;delete copy.audit;delete copy.operationLogs;delete copy.auditLogs;delete copy.backups;delete copy.systemBackups;copy.products=(copy.products||[]).map(p=>{for(const k of ['externalCode','legacyExternalCodes','aliases','barcode'])delete p[k];return p;});return JSON.stringify(copy);}
module.exports={peek,next,assign,identity};
