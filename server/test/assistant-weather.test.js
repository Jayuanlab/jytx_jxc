'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:original.call(this,name,...args);};
const c=require('../src/common'),live=require('../src/assistant-live'),chat=require('../src/companion-chat'),personal=require('../src/companion');
const owner={id:'weather-a',name:'测试甲',roleCode:'owner'},other={id:'weather-b',name:'测试乙',roleCode:'owner'};
const store=()=>c.initialize({users:[owner,other],products:[],inventory:[],sales:[]});
function fixtures(){
 const date=c.day(),days=[0,1,2].map(n=>c.day(Date.now()+n*86400000)),calls=[];
 const fetchImpl=async url=>{
  const u=new URL(url);calls.push(u);
  return new Response(JSON.stringify(u.hostname.startsWith('geocoding')?{results:[
   {id:1,name:'云阳',country_code:'CN',admin1:'江苏',admin2:'镇江市',latitude:32,longitude:119},
   {id:2,name:'云阳',country_code:'CN',admin1:'重庆市',admin2:'重庆市',latitude:30.99795,longitude:108.88137}
  ]}:{daily:{time:days,weather_code:[2,61,3],temperature_2m_min:[15,14,12],temperature_2m_max:[25,22,20]},current:{temperature_2m:21}}));
 };
 return {date,days,calls,fetchImpl};
}
test('完整省市区县拆分，直辖市与同名地名不会混用',()=>{
 assert.deepEqual(live.locationParts('重庆市云阳县'),{name:'云阳',regions:['重庆']});
 assert.deepEqual(live.locationParts('重庆云阳'),{name:'云阳',regions:['重庆']});
 assert.deepEqual(live.locationParts('四川省成都市温江区'),{name:'温江',regions:['四川','成都']});
 assert.deepEqual(live.locationParts('云阳县'),{name:'云阳',regions:[]});
 assert.deepEqual(live.locationParts('重庆市'),{name:'重庆',regions:[]});
 assert.equal(live.cityFrom('帮我查重庆市云阳县今天的天气'),'重庆市云阳县');
 assert.equal(live.cityFrom('今天的天气怎么样','重庆'),'重庆');
});
test('截图原话：问今天→补重庆市云阳县→问明天，走真实天气工具，默认不向聊天模型发历史',async()=>{
 live.clearCache();const s=store(),f=fixtures();let modelCalls=0;
 const options={liveQuery:(q,o)=>live.query(q,{...o,fetchImpl:f.fetchImpl}),companionModelClient:{configured:()=>true,request:async()=>{modelCalls++;return '不应调用';}}};
 const ask=async(q,id)=>{const r=await chat.prepare(s,owner,{question:q},options);chat.commit(s,owner,q,r,id);return r;};
 const prompt=await ask('今天天气怎么样','w1');assert.equal(prompt.metrics.needsCity,true);
 const today=await ask('重庆市云阳县','w2');assert.equal(today.metrics.kind,'live-weather');assert.match(today.answer,/重庆市 云阳/);assert.ok(today.answer.includes(f.date));assert.match(today.answer,/15～25℃/);assert.equal(today.sources.length,1);assert.equal(today.modelConnected,false);
 const tomorrow=await ask('明天呢？','w3');assert.ok(tomorrow.answer.includes(f.days[1]));assert.match(tomorrow.answer,/14～22℃/);
 const rain=await ask('明天有雨吗','w4');assert.match(rain.answer,/小雨/);assert.ok(rain.answer.includes(f.days[1]));
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].searchParams.get('name'),'云阳');assert.equal(f.calls[1].searchParams.get('longitude'),'108.88137');
 assert.equal(modelCalls,0);assert.equal(personal.profile(s,owner).city,'');assert.equal(personal.profile(s,owner).shareWithModel,false);
});
test('先问明天再补地点保留日期，后天和今天能切换',async()=>{
 live.clearCache();const s=store(),f=fixtures(),options={liveQuery:(q,o)=>live.query(q,{...o,fetchImpl:f.fetchImpl})};
 const ask=async q=>{const r=await chat.prepare(s,owner,{question:q},options);chat.commit(s,owner,q,r,Math.random().toString());return r;};
 assert.equal((await ask('明天天气怎么样')).metrics.needsCity,true);
 assert.ok((await ask('我在重庆市云阳县')).answer.includes(f.days[1]));
 assert.ok((await ask('后天呢')).answer.includes(f.days[2]));
 assert.ok((await ask('今天几度')).answer.includes(f.days[0]));
});
test('待补城市只作用于本人，换话题及过期上下文不能误触发天气',async()=>{
 const s=store(),f=fixtures(),modelCalls=[],options={liveQuery:(q,o)=>live.query(q,{...o,fetchImpl:f.fetchImpl}),companionModelClient:{configured:()=>true,request:async q=>{modelCalls.push(q);return '继续聊生活';}}};
 const prompt=await chat.prepare(s,owner,{question:'今天天气'},options);chat.commit(s,owner,'今天天气',prompt,'p');
 const otherResult=await chat.prepare(s,other,{question:'重庆市云阳县'},options);assert.equal(otherResult.modelConnected,true);
 const food=await chat.prepare(s,owner,{question:'明天吃什么'},options);assert.equal(food.modelConnected,true);chat.commit(s,owner,'明天吃什么',food,'f');
 assert.equal((await chat.prepare(s,owner,{question:'明天呢'},options)).modelConnected,true);
 const state=prompt.metrics.weatherContext;
 assert.equal(live.weatherInput('重庆市云阳县',{weatherContext:{...state,at:Date.now()-31*60000}}),null);
 assert.equal(live.weatherInput('好的',{weatherContext:state}),null);
 assert.equal(live.weatherInput('冷不冷',{weatherContext:state}).city,'');
 assert.equal(f.calls.length,0);assert.equal(modelCalls.length,3);
});
test('同名云阳先消歧，补完整省市后才请求预报',async()=>{
 live.clearCache();const f=fixtures();
 const ambiguous=await live.query('云阳县天气',{fetchImpl:f.fetchImpl});assert.equal(ambiguous.metrics.needsCity,true);assert.match(ambiguous.answer,/江苏.*重庆市/);assert.equal(f.calls.length,1);
 const chosen=await live.query('重庆市云阳县',{weatherContext:ambiguous.metrics.weatherContext,fetchImpl:f.fetchImpl});
 assert.match(chosen.answer,/重庆市 云阳/);assert.equal(chosen.sources.length,1);assert.equal(f.calls.length,3);
});
test('个人设置的完整城市可直接查，明确地点优先于个人城市',async()=>{
 live.clearCache();const s=store(),f=fixtures();personal.saveProfile(s,owner,{nickname:'测试甲',city:'重庆市云阳县'});
 const r=await chat.prepare(s,owner,{question:'今天天气怎么样'},{liveQuery:(q,o)=>live.query(q,{...o,fetchImpl:f.fetchImpl})});assert.equal(r.sources.length,1);
 assert.equal(live.weatherInput('上海今天天气',{city:'重庆市云阳县'}).city,'上海');
});
test('天气源不可用继续走天气提示，不退回模型说不会查询',async()=>{
 live.clearCache();const s=store();let modelCalls=0;
 const options={liveQuery:(q,o)=>live.query(q,{...o,fetchImpl:async()=>{throw Error('source-offline');}}),companionModelClient:{configured:()=>true,request:async()=>{modelCalls++;return '无法查天气';}}};
 const r=await chat.prepare(s,owner,{question:'重庆市云阳县今天天气'},options);assert.equal(r.metrics.unavailable,true);assert.equal(r.metrics.kind,'live-weather');assert.equal(r.sources.length,0);assert.equal(modelCalls,0);
});
test('完整省市没有匹配地点时，不采用其他省的同名县',async()=>{
 live.clearCache();const f=fixtures(),r=await live.query('山东省云阳县天气',{fetchImpl:f.fetchImpl});assert.equal(r.metrics.needsCity,true);assert.equal(r.sources.length,0);assert.equal(f.calls.length,1);
});

test('小猫咪补充地点沿用签名天气上下文，第三次闲聊仍回到业务',async()=>{
 live.clearCache();const f=fixtures(),kitty=require('../src/assistant-kitty'),scope={tenantId:'test',branchId:'branch'},options={scope,liveQuery:(q,o)=>live.query(q,{...o,fetchImpl:f.fetchImpl})},local={mode:'customer',metrics:{}};
 const first=await kitty.respond(local,owner,{question:'今天天气怎么样'},options);assert.equal(first.metrics.needsCity,true);
 const second=await kitty.respond(local,owner,{question:'重庆市云阳县',context:first.context},options);assert.equal(second.sources.length,1);assert.match(second.answer,/重庆市 云阳/);
 const third=await kitty.respond(local,owner,{question:'明天呢',context:second.context},options);assert.equal(third.metrics.chatLimit,true);
 assert.equal(await kitty.respond(local,other,{question:'重庆市云阳县',context:first.context},options),null);
 const forged=JSON.parse(JSON.stringify(first.context));forged.kitty.weatherContext.city='重庆市云阳县';
 assert.equal(await kitty.respond(local,owner,{question:'明天呢',context:forged},options),null);
});
