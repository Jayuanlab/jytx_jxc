'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../src/capacity/postgres.js'),realRequire=createRequire(filename),scope={module:{exports:{}},require:id=>id==='pg'?{Pool:class{}}:realRequire(id),console};
vm.runInNewContext(fs.readFileSync(filename,'utf8'),scope,{filename});
const {ranksFor}=scope.module.exports;
function ordered(keys,ranks){assert.equal(ranks.size,keys.length);for(let i=1;i<keys.length;i++)assert.ok(ranks.get(keys[i])>ranks.get(keys[i-1]),'Ranks must preserve the requested order');}
test('bulk prepend 2000 audit records retains every historical rank',()=>{
 const old=new Map([['old-1',-20000000],['old-2',-19000000],['old-3',-18000000]]);
 const keys=Array.from({length:2000},(_,i)=>'new-'+i).concat([...old.keys()]);
 const ranks=ranksFor(keys,old);ordered(keys,ranks);
 for(const [k,v]of old)assert.equal(ranks.get(k),v);
});
test('bulk inserts between existing records use the available gap',()=>{
 const old=new Map([['a',0],['b',1000000],['c',2000000]]);
 const keys=['a',...Array.from({length:1000},(_,i)=>'middle-'+i),'b',...Array.from({length:1000},(_,i)=>'second-'+i),'c'];
 const ranks=ranksFor(keys,old);ordered(keys,ranks);for(const [k,v]of old)assert.equal(ranks.get(k),v);
});
test('empty collections and appended records retain predictable order',()=>{
 const keys=Array.from({length:5000},(_,i)=>String(i)),first=ranksFor(keys,new Map());ordered(keys,first);
 assert.equal(first.get('0'),0);const more=keys.concat(['end-1','end-2']),second=ranksFor(more,first);ordered(more,second);for(const key of keys)assert.equal(second.get(key),first.get(key));
});
test('repeated batch prepends do not progressively consume the old gap',()=>{
 let keys=['historical'],ranks=new Map([['historical',-1000000]]);
 for(let batch=0;batch<100;batch++){keys=Array.from({length:20},(_,i)=>batch+'-'+i).concat(keys);ranks=ranksFor(keys,ranks);ordered(keys,ranks);assert.equal(ranks.get('historical'),-1000000);}
});
test('reordering existing keys still creates strictly increasing ranks',()=>{
 const keys=['c','a','new','b'],ranks=ranksFor(keys,new Map([['a',0],['b',1000000],['c',2000000]]));ordered(keys,ranks);
});
test('unrepresentable gaps fail before writing any rank',()=>{
 assert.throws(()=>ranksFor(['a','new','b'],new Map([['a',1],['b',1+Number.EPSILON]])),error=>error.statusCode===409);
});
