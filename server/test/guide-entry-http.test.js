'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const c=require('../src/common'),access=require('../src/attendance-access'),ctx=require('../src/capacity/context');
const owner={id:'fixture-owner',name:'老板',roleCode:'owner',status:'active'},employee={id:'fixture-clerk',name:'营业员',roleCode:'employee',status:'active'};
const fixture=c.initialize({users:[owner,employee],displayPreferences:[],localCatalogNotices:[],feishuNotices:[],attendance:[]});
const night=access.windowFor();if(night)fixture.attendanceNightGrants=[{userId:employee.id,windowKey:night.key,validFrom:new Date(night.start).toISOString(),expiresAt:new Date(night.end).toISOString(),approvedAt:new Date(night.start).toISOString(),approverId:owner.id}];
const reads=[];const repository=require('../src/repository');repository.readStore=async options=>{reads.push(options?.collections||null);const out=structuredClone(fixture);for(const key of Object.keys(out))if(Array.isArray(out[key])&&key!=='users'&&options?.collections&&!options.collections.includes(key))out[key]=[];return out;};
require('../src/session-read').readSessionStore=async()=>structuredClone(fixture);
require('../src/capacity/auth').request=(req,work)=>{const user=req.headers['x-fixture-user']==='employee'?employee:owner;req.erpSession={user,userId:user.id,expiresAt:Date.now()+60000};return ctx.run({tenantId:'fixture',branchId:'fixture',userId:user.id},work);};
const {createServer}=require('../src/application');
test('首页只读导引资料，未签到员工不触发业务读取',async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;try{
 reads.length=0;let response=await fetch(origin+'/api/home-entry',{headers:{'x-fixture-user':'employee'}});assert.equal(response.status,200);assert.deepEqual(JSON.parse(decodeURIComponent(response.headers.get('X-Store-Work-Context'))),[employee.id,'fixture','fixture']);assert.equal((await response.json()).workLock.locked,true);assert.deepEqual(reads,[]);
 reads.length=0;response=await fetch(origin+'/api/inventory/entry',{headers:{'x-fixture-user':'employee'}});assert.notEqual(response.status,200);assert.deepEqual(reads,[]);
 reads.length=0;response=await fetch(origin+'/m');assert.equal(response.status,200);const html=await response.text();assert(html.includes('personal-shortcuts'));assert(html.indexOf('/work-continuity.js')<html.indexOf('/feishu-mobile.js'));assert(reads.length>0);assert(reads.every(rows=>rows&&!rows.includes('inventory')&&!rows.includes('sales')&&!rows.includes('operationLogs')));
 for(const asset of ['/work-continuity-core.js','/work-continuity.js']){response=await fetch(origin+asset);assert.equal(response.status,200);assert((await response.text()).length>500);}
 reads.length=0;response=await fetch(origin+'/api/inventory/entry');assert.equal(response.status,200);assert((await response.json()).warehouses.length>0);assert.deepEqual(reads,[['warehouseProfiles']]);
 reads.length=0;response=await fetch(origin+'/api/display-preferences?page=home');assert.equal(response.status,200);assert(reads.every(rows=>Array.isArray(rows)&&rows.includes('displayPreferences')&&!rows.includes('inventory')));
 }finally{await new Promise(r=>server.close(r));}});
