'use strict';
const crypto=require('node:crypto'),c=require('./common'),roles=require('./assistant-roles'),core=require('./wechat-notification-core');
const delivery=require("./companion-delivery");
const LIMIT=100,RETENTION=7*86400000;
function own(store,user){return (store.companionProfiles||[]).find(p=>p.userId===user.id);}
function row(store,user){let p=own(store,user);if(!p){p={id:user.id,userId:user.id,nickname:user.name,city:'',interests:'',routine:'',shareWithModel:false};(store.companionProfiles||=[]).push(p);}return p;}
function config(store,user){return {enabled:false,categories:core.topics.map(x=>x.id),keywords:'',...(own(store,user)?.wechatSettings||{})};}
function items(store,user,now){return (own(store,user)?.wechatInbox||[]).filter(x=>now-Date.parse(x.notificationAt)<=RETENTION).sort((a,b)=>Date.parse(b.notificationAt)-Date.parse(a.notificationAt));}
function snapshot(store,user,{now=Date.now()}={}){
 roles.permitPersonal(user);const p=own(store,user),s=config(store,user),status=p?.wechatCollector||{};
 return {settings:s,topics:core.topics.map(({id,label})=>({id,label})),status:!s.enabled?'paused':!status.lastSignalAt?'waiting':now-Date.parse(status.lastSignalAt)<300000?'recent':'quiet',
  lastSignalAt:status.lastSignalAt||null,lastReceivedAt:status.lastReceivedAt||null,unreadableCount:status.unreadableCount||0,phase:status.phase||null,
  items:items(store,user,now).filter(x=>core.matched(x.title+'\n'+x.body,s)).map(x=>({...x,deliveryStatus:delivery.itemStatus(store,user,'wechat',x)})),limit:LIMIT,retentionDays:7,scope:'notification-preview'};
}
function save(store,user,body){
 roles.permitPersonal(user);
 if(typeof body.enabled!=='boolean'||!Array.isArray(body.categories)||body.categories.length>core.topics.length||body.categories.some(id=>!core.topics.some(t=>t.id===id)))throw new c.HttpError(400,'请选择微信通知收集设置');
 const keywords=String(body.keywords||'').trim();if(keywords.length>160)throw new c.HttpError(400,'关键词最多160字');
 row(store,user).wechatSettings={enabled:body.enabled,categories:[...new Set(body.categories)],keywords};
 c.audit(store,user,'companion:wechat-settings',user.id);return snapshot(store,user);
}
function ingest(store,user,body,{now=Date.now()}={}){
 roles.permitPersonal(user);const s=config(store,user);
 if(!s.enabled)throw new c.HttpError(409,'微信通知试验已暂停');
 if(typeof body.deviceId!=='string'||!/^[a-zA-Z0-9-]{10,64}$/.test(body.deviceId)||!Array.isArray(body.notifications)||body.notifications.length>25||!['receiving','permission-denied','paused'].includes(body.phase))throw new c.HttpError(400,'通知批次格式不正确');
 const valid=body.notifications.map(n=>{
  if(!n||typeof n.appId!=='string'||!n.appId.trim()||n.appId.length>260||!['微信','WeChat','Weixin'].includes(n.appName)||typeof n.title!=='string'||n.title.length>180||typeof n.body!=='string'||n.body.length>3000||typeof n.notificationId!=='string'||n.notificationId.length>80)throw new c.HttpError(400,'只接受微信通知预览');
  const at=Date.parse(n.notificationAt);if(!Number.isFinite(at)||at>now+300000||now-at>RETENTION)throw new c.HttpError(400,'通知时间无效');
  const id=crypto.createHash('sha256').update(JSON.stringify([body.deviceId,n.appId,n.notificationId,n.notificationAt,n.title,n.body])).digest('hex').slice(0,32);
  return {id,title:n.title,body:n.body,notificationAt:new Date(at).toISOString(),receivedAt:new Date(now).toISOString(),categories:core.classify(n.title+'\n'+n.body),source:'微信通知',verified:false};
 });
 const p=row(store,user),seen=new Set((p.wechatInbox||[]).map(x=>x.id));let accepted=0,duplicate=0,ignored=0,unreadable=0;
 if(body.phase!=='receiving'&&valid.length)throw new c.HttpError(400,'暂停或未授权时不能上传内容');
 p.wechatInbox=items(store,user,now);
 for(const n of valid){
  if(!core.readable(n.body)){unreadable++;continue;}
  if(!core.matched(n.title+'\n'+n.body,s)){ignored++;continue;}
  if(seen.has(n.id)){duplicate++;continue;}seen.add(n.id);p.wechatInbox.push(n);accepted++;
 }
 p.wechatInbox.sort((a,b)=>Date.parse(b.notificationAt)-Date.parse(a.notificationAt));p.wechatInbox=p.wechatInbox.slice(0,LIMIT);
 p.wechatCollector={lastSignalAt:new Date(now).toISOString(),lastReceivedAt:accepted?new Date(now).toISOString():p.wechatCollector?.lastReceivedAt||null,unreadableCount:(p.wechatCollector?.unreadableCount||0)+unreadable,phase:body.phase};
 // Only counts in audit; no notification titles or chat content in public logs.
 if(accepted)c.audit(store,user,'companion:wechat-ingest',String(accepted)+'条通知');
 return {accepted,duplicate,ignored,unreadable,receivedAt:new Date(now).toISOString()};
}
function answer(store,user,{replay=false}={}){
 const s=snapshot(store,user),rows=s.items.filter(x=>replay||!delivery.delivered(store,user,"wechat",x)).slice(0,5);
 return {answer:rows.length?'从微信通知里留意到的消息（内容尚未核实）：\n'+rows.map((x,i)=>(i+1)+'. '+x.title+'：'+x.body).join('\n'):'目前没有收集到相关微信通知。电脑接收器需要安装、登录并获得通知权限；免打扰或未显示内容的消息可能收不到。',sources:[],metrics:{kind:'personal-wechat-notifications',deliveryItems:rows.map(x=>({id:x.id,title:x.title,body:x.body}))},channel:'life',modelConnected:false};
}
module.exports={save,ingest,snapshot,answer,config};
