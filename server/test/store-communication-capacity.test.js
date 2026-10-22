'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const events=require('../src/store-communication-events');
function stream(validate){const req=new EventEmitter(),res=new EventEmitter();res.frames=[];res.ended=false;res.writeHead=()=>{};res.flushHeaders=()=>{};res.write=t=>{res.frames.push(t);return true;};res.end=()=>{res.ended=true;res.emit('close');};events.subscribe(req,res,'employee',validate);return {req,res};}
const tick=()=>new Promise(r=>setImmediate(r));
test('数据库暂不可用时重连，不能显示登录过期；撤销权限仍关闭连接',async()=>{
 const temporary=stream(()=>Promise.reject(Object.assign(Error('connection timeout'),{statusCode:503})));await tick();assert.equal(temporary.res.ended,true);assert.ok(!temporary.res.frames.some(x=>x.includes('auth-expired')));
 const revoked=stream(()=>Promise.reject(Object.assign(Error('revoked'),{statusCode:401})));await tick();assert.equal(revoked.res.ended,true);assert.ok(revoked.res.frames.some(x=>x.includes('auth-expired')));
});
test('身份检查尚未完成时，多次消息提醒合并且不能丢失，私聊仍仅通知本人',async()=>{
 let resolve,calls=0;
 const client=stream(()=>{calls++;return calls===1?new Promise(r=>resolve=r):Promise.resolve();});
 try{
 for(let i=0;i<100;i++)events.changed('/api/store-communication/send',{senderId:'employee',recipientId:'other'});
 assert.equal(calls,1);assert.ok(!client.res.frames.some(x=>x.includes('changed')));
 resolve();await tick();await tick();assert.equal(calls,2);assert.equal(client.res.frames.filter(x=>x.includes('changed')).length,1);
 events.changed('/api/store-communication/send',{senderId:'unrelated',recipientId:'another'});await tick();assert.equal(calls,2);
 }finally{client.res.end();}
});
