'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../src/common'),comm=require('../src/store-communication'),schedule=require('../src/announcement-schedule');
const owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},staff={id:'clerk',name:'营业员',roleCode:'employee',status:'active',permissions:['sale:create']};
const fixture=()=>c.initialize({users:[structuredClone(owner),structuredClone(staff)]});
const time=s=>Date.parse('2026-10-10T'+s+':00+08:00');
test('自由时段在北京时间开始生效、结束停止；全天内容始终播放',()=>{
 const row={active:true,schedule:schedule.normalize({mode:'time',start:'08:30',end:'11:45'})};
 assert.equal(row.schedule.preset,'custom');
 for(const [at,expected]of [['08:29',false],['08:30',true],['11:44',true],['11:45',false]])assert.equal(schedule.active(row,time(at)),expected,at);
 assert.equal(schedule.active({active:true},time('03:00')),true);
 assert.equal(schedule.active({...row,active:false},time('10:00')),false);
});
test('跨夜时段准确覆盖前后两天，下一切换点取开始或结束边界',()=>{
 const row={active:true,schedule:{mode:'time',start:'21:30',end:'06:45'}};
 for(const [at,on]of [['21:29',false],['21:30',true],['23:59',true],['00:00',true],['06:44',true],['06:45',false]])assert.equal(schedule.active(row,time(at)),on,at);
 assert.equal(schedule.nextChange([row],time('21:00')),'2026-10-10T13:30:00.000Z');
 assert.equal(schedule.nextChange([row],time('22:00')),'2026-10-10T22:45:00.000Z');
 assert.equal(schedule.nextChange([{active:true}],time('01:00')),null);
});
test('非法、相等和缺失时间拒绝，旧通知兼容全天，损坏时间不播放',()=>{
 for(const value of [[],false,{mode:'bad'},{mode:'time',start:'24:00',end:'06:00'},{mode:'time',start:'9:00',end:'18:00'},{mode:'time',start:'12:00',end:'12:00'},{mode:'time',start:'08:00'}])assert.throws(()=>schedule.normalize(value));
 assert.equal(schedule.active({active:true,schedule:{mode:'time',start:'bad',end:'12:00'}},time('10:00')),false);
 assert.deepEqual(schedule.normalize(undefined),{mode:'all',preset:'all'});
});
test('摘要只给当前时段，老板可编辑未到时段的内容，员工无管理记录',()=>{
 const s=fixture(),saved=Date.now;try{Date.now=()=>time('10:00');
 comm.publish(s,owner,{title:'全天',content:'全天内容',level:'normal'});
 comm.publish(s,owner,{title:'下午',content:'下午内容',level:'normal',schedule:{mode:'time',start:'14:00',end:'18:00'}});
 assert.deepEqual(comm.summary(s,staff).announcements.map(r=>r.title),['全天']);
 assert.equal(comm.list(s,owner).managedAnnouncements.length,2);assert.deepEqual(comm.list(s,staff).managedAnnouncements,[]);
 assert.equal(comm.summary(s,staff).nextAnnouncementChangeAt,'2026-10-10T06:00:00.000Z');
 Date.now=()=>time('14:00');assert.equal(comm.summary(s,staff).announcements.length,2);
 }finally{Date.now=saved}
});
test('老板修改关联同一条内容，版本冲突不覆盖，非法修改原样保留并审计',()=>{
 const s=fixture(),row=comm.publish(s,owner,{title:'旧标题',content:'旧内容',level:'normal'}),body={id:row.id,revision:0,title:'新版',content:'新版内容',level:'important',schedule:{mode:'time',start:'08:30',end:'10:50'}};
 assert.throws(()=>comm.update(s,staff,body),e=>e.statusCode===403);
 comm.update(s,owner,body);assert.equal(row.content,'新版内容');assert.equal(row.revision,1);assert.equal(s.storeAnnouncements.length,1);assert.equal(s.operationLogs[0].action,'announcement:update');assert.equal(s.operationLogs[0].detail.before.content,'旧内容');
 const before=JSON.stringify(s);assert.throws(()=>comm.update(s,owner,body),e=>e.statusCode===409);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>comm.update(s,owner,{...body,revision:1,schedule:{mode:'time',start:'99:00',end:'12:00'}}));assert.equal(JSON.stringify(s),before);
 comm.close(s,owner,{id:row.id});assert.throws(()=>comm.update(s,owner,{...body,revision:1}),e=>e.statusCode===409);
});

test('显示方式与停留秒数保存，非法显示参数不改变原文',()=>{
 const s=fixture();for(const mode of ['fixed','fade']){
 const row=comm.publish(s,owner,{title:mode,content:'内容',level:'normal',display:{mode,seconds:20}});
 assert.deepEqual(comm.list(s,owner).managedAnnouncements.find(r=>r.id===row.id).display,{mode,seconds:20});
 const before=JSON.stringify(s);for(const seconds of [0,2,3601,4.5,true,''])assert.throws(()=>comm.update(s,owner,{id:row.id,revision:0,title:'新标题',content:'新内容',level:'normal',display:{mode,seconds}}));assert.equal(JSON.stringify(s),before);
 }
 assert.deepEqual(schedule.normalizeDisplay(undefined),{mode:'scroll'});
 assert.throws(()=>schedule.normalizeDisplay({mode:'bad'}));
});
