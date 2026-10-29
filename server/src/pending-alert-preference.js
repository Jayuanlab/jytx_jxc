'use strict';
const c=require('./common'),{createHash}=require('node:crypto');
const MODES=new Set(['off','sound','vibrate','both']);
function current(store,user){
 const who=require('./master-data').actor(store,user);
 const rows=(store.displayPreferences||[]).filter(row=>row.page==='pending-alert'&&row.userId===who.id);
 if(rows.length>1)throw new c.HttpError(409,'当前账号提醒设置重复，请联系管理员核对');
 return {who,row:rows[0]||null};
}
function list(store,user){const {row}=current(store,user);return {page:'pending-alert',mode:MODES.has(row?.mode)?row.mode:'off',configured:!!row,revision:row?.revision||0};}
function save(store,user,payload){
 if(payload?.page!=='pending-alert'||!MODES.has(payload.mode)||Object.keys(payload).some(key=>!['page','mode'].includes(key)))throw new c.HttpError(400,'待办提醒设置不正确');
 const {who,row:existing}=current(store,user),key=JSON.stringify(['pending-alert',who.id,'',[]]);
 if(existing?.mode===payload.mode)return list(store,user);
 const row=existing||{id:'DP-'+createHash('sha256').update(key).digest('hex').slice(0,24),key,page:'pending-alert',userId:who.id,warehouseId:'',parentPath:[],revision:0};
 const before=row.mode||'off';row.mode=payload.mode;row.revision++;row.updatedAt=c.now();
 if(!existing)(store.displayPreferences||=[]).push(row);
 c.audit(store,who,'pending-alert:preference',{before,mode:row.mode});
 return list(store,user);
}
module.exports={list,save};
