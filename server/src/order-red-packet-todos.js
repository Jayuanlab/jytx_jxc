'use strict';
const KEYS={orderRedPacketReview:'pending',orderRedPacketPayment:'approved'};
function isKey(key){return Object.hasOwn(KEYS,key);}
function rows(store,key){
 if(!isKey(key))return [];
 const {STATUS}=require('./order-red-packets');
 return (store.orderRedPackets||[]).filter(row=>row.status===STATUS[KEYS[key]]);
}
function amount(row,key){const value=key==='orderRedPacketPayment'?row.approvedAmount:row.requestedAmount;return value!=null&&value!==''&&Number.isFinite(Number(value))?Number(value):null;}
function total(store,key){const list=rows(store,key);return list.every(r=>amount(r,key)!==null)?Math.round(list.reduce((n,r)=>n+amount(r,key),0)*100)/100:null;}
function details(store,key){return rows(store,key).map(row=>({id:String(row.id),label:(row.displayNo||row.id)+' · '+(row.employeeName||'经办员工'),sub:[row.status,amount(row,key)===null?'金额待核定':(key==='orderRedPacketPayment'?'核定':'申请')+' ¥'+amount(row,key).toFixed(2),'来源 '+(row.sourceSnapshot?.displayNo||row.sourceId||'待核对'),row.reason||''].join(' · '),amount:amount(row,key),status:row.status,displayNo:row.displayNo,at:row.createdAt,href:'/order-red-packets?request='+encodeURIComponent(row.id)}));}
module.exports={isKey,rows,total,details};
