'use strict';
const c=require('./common'),{createHash}=require('node:crypto'),shortcuts=require('./personal-shortcuts');
const PAGE='home-directory';
function context(store,user){const actual=require('./master-data').actor(store,user),listing=shortcuts.list(store,actual);return{actual,entries:listing.entries,key:JSON.stringify([PAGE,actual.id,'',[]])};}
function list(store,user){const {actual,entries,key}=context(store,user),known=new Set(entries.map(x=>x.id)),row=(store.displayPreferences||[]).find(x=>x.key===key),order=[...new Set([...(row?.order||[]).filter(x=>known.has(x)),...entries.map(x=>x.id)])];return{page:PAGE,persona:actual.roleCode==='owner'?'owner':'employee',entries:structuredClone(entries),order,revision:row?.revision||0};}
function save(store,user,p){
 const {actual,entries,key}=context(store,user),known=new Set(entries.map(x=>x.id));
 if(!p||Object.keys(p).some(k=>!['page','order','revision'].includes(k))||p.page!==PAGE||!Array.isArray(p.order)||p.order.length!==known.size||p.order.some(x=>typeof x!=='string'||!known.has(x))||new Set(p.order).size!==p.order.length||!Number.isSafeInteger(p.revision)||p.revision<0)throw new c.HttpError(400,'功能目录已变化，请重新读取后排列');
 const old=(store.displayPreferences||[]).find(x=>x.key===key);
 if((old?.revision||0)!==p.revision)throw new c.HttpError(409,'顺序已在其他页面调整，请重新读取');
 const before=old?.order?.slice()||[],row=old||{id:'DP-'+createHash('sha256').update(key).digest('hex').slice(0,24),key,page:PAGE,userId:actual.id,warehouseId:'',parentPath:[],revision:0};
 row.order=p.order.slice();row.revision++;row.updatedAt=c.now();row.updatedBy=actual.id;
 if(!old)(store.displayPreferences||=[]).push(row);
 c.audit(store,actual,'display:directory',{before,order:row.order});return list(store,actual);
}
module.exports={list,save};
