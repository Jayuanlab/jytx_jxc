 'use strict';
const c=require('./common'),roles=require('./assistant-roles'),position=require('./companion-location');
const own=(s,u)=>(s.companionProfiles||[]).find(p=>p.userId===u.id);
const text=(v,max)=>{const t=typeof v==='string'?v.trim():'';if(t.length>max)throw new c.HttpError(400,'填写内容过长');return t;};
function contacts(value){
 if(!Array.isArray(value)||value.length>3)throw new c.HttpError(400,'最多保存三名紧急联系人');
 const phones=new Set();return value.map(x=>{if(!x||typeof x!=='object')throw new c.HttpError(400,'联系人格式不正确');const name=text(x.name,40),relationship=text(x.relationship,40),raw=text(x.phone,30);if(!/^[+\d -]+$/.test(raw))throw new c.HttpError(400,'联系人电话号码格式不正确');const phone=raw.replace(/[ -]/g,'');if(!name||!/^\+?\d{5,15}$/.test(phone))throw new c.HttpError(400,'请填写联系人姓名和电话号码');if(phones.has(phone))throw new c.HttpError(400,'联系人电话号码重复');phones.add(phone);return {name,relationship,phone};});
}
function snapshot(store,user){
 roles.permitPersonal(user);const p=own(store,user),saved=p?.emergencyCard||{};
 return {version:p?.emergencyVersion||0,name:saved.name||user.name,phone:saved.phone||'',accessNote:saved.accessNote||'',medicalNote:saved.medicalNote||'',contacts:saved.contacts||[],updatedAt:saved.updatedAt||null,location:position.location(store,user),dialNumber:'120',region:'中国大陆',automaticNotificationConnected:false};
}
function save(store,user,body){
 roles.permitPersonal(user);let p=own(store,user);if(!Number.isInteger(body.version)||body.version!==(p?.emergencyVersion||0))throw new c.HttpError(409,'急救资料已更新，请刷新后重试');
 const name=text(body.name,40),phone=text(body.phone,30).replace(/[ -]/g,'');if(!name)throw new c.HttpError(400,'请填写称呼或姓名');if(phone&&!/^\+?\d{5,15}$/.test(phone))throw new c.HttpError(400,'本人电话号码不正确');
 const value={name,phone,accessNote:text(body.accessNote,160),medicalNote:text(body.medicalNote,500),contacts:contacts(body.contacts),updatedAt:c.now()};
 if(!p){p={id:user.id,userId:user.id,nickname:user.name,city:'',interests:'',routine:'',shareWithModel:false};(store.companionProfiles||=[]).push(p);}
 p.emergencyCard=value;p.emergencyVersion=(p.emergencyVersion||0)+1;c.audit(store,user,'companion:emergency-card',user.id);return snapshot(store,user);
}
module.exports={save,snapshot,contacts};
