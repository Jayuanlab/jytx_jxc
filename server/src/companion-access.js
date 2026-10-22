 'use strict';
const c=require('./common'),roles=require('./assistant-roles'),context=require('./capacity/context');
const ownAdmin=user=>{if(user.roleCode!=='owner'||roles.customer(user))throw new c.HttpError(403,'仅管理员可管理个人助理试用账号');};
// Every personal-only endpoint has a separate own-user guard; all ERP and generic assistant endpoints stay denied.
function allowed(user,path){return !roles.personalOnly(user)||path==='/api/me'||path==='/api/assistant/roles'||path==='/api/companion'||path.startsWith('/api/companion/');}
function summary(store,user){ownAdmin(user);return {asOf:c.now(),users:(store.users||[]).filter(roles.personalOnly).map(r=>({id:r.id,name:r.name,status:r.status,createdAt:r.createdAt,role:'个人助理试用用户'})),scope:'仅管理账号和额度，不显示他人的聊天、健康、照片或个人记忆',registration:'管理员建档后，在账号设置页单独创建登录密码；不开放匿名注册'};}
function create(store,user,body){ownAdmin(user);const name=c.text(body.name,'使用者称呼');if(name.length>40)throw new c.HttpError(400,'称呼不能超过40字');
 if((store.users||[]).some(r=>r.name===name))throw new c.HttpError(409,'该称呼已使用，请加上便于区分的称呼');
 const current=context.current(),row={id:c.id('PA'),name,role:'个人助理试用用户',roleCode:'personal-assistant',assistantCustomerOnly:true,personalAssistantOnly:true,status:'active',permissions:[],capabilityOverrides:{},createdAt:c.now(),createdBy:user.id,...(current?.branchId?{branchIds:[current.branchId]}:{})};
 (store.users||=[]).push(row);c.audit(store,user,'companion:account-create',row.id+' · 个人试用，不授予经营权限');return {user:c.publicUser(row),login:'/login?next=/companion',passwordSetup:'/login?next=/companion&employee='+encodeURIComponent(row.id)+'#admin-panel'};
}
function status(store,user,body){ownAdmin(user);const row=(store.users||[]).find(r=>r.id===body.userId&&roles.personalOnly(r));if(!row)throw new c.HttpError(404,'个人助理试用账号不存在');if(!['active','disabled'].includes(body.status))throw new c.HttpError(400,'请选择启用或停用');
 if(row.status!==body.status){row.status=body.status;c.audit(store,user,'companion:account-status',row.id+' · '+row.status);}return {id:row.id,status:row.status};
}
module.exports={allowed,summary,create,status};
