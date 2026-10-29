'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const C=require('../../web/work-continuity-core');
function storage(){const values=new Map();return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};}
function browser(saved,scope=['clerk-a','tenant-a','branch-a'],route='/carrier'){
 const events=new Map(),docEvents=new Map(),calls=[],timers=new Map(),fields=[],location=new URL('https://store.invalid'+route);location.replace=value=>{location.redirect=value;};let sequence=0,network;
 const root={observe(){},disconnect(){}};
 const context={URL,URLSearchParams,Headers,Request,Response,console,Date,JSON,Map,WeakMap,WeakSet,Set,Object,Array,String,Number,Promise,Error,encodeURIComponent,decodeURIComponent,localStorage:saved,location,scrollX:0,scrollY:0,crypto:{randomUUID:()=> 'key-'+(++sequence)},Event:class{constructor(type){this.type=type;}},MutationObserver:class{observe(){}},setTimeout:fn=>{const n=++sequence;timers.set(n,fn);return n;},clearTimeout:n=>timers.delete(n),requestAnimationFrame:fn=>fn(),scrollTo:value=>{context.scrolled=value;},addEventListener:(n,fn)=>events.set(n,[...(events.get(n)||[]),fn]),history:{pushState(){},replaceState(){}}};
 context.document={readyState:'complete',title:'聚友通信 · 移动业务',body:root,hidden:false,querySelector:selector=>selector==='main'?root:{textContent:'移动业务'},querySelectorAll:selector=>selector.includes('main input')?fields:[],getElementById:()=>null,addEventListener:(n,fn)=>docEvents.set(n,[...(docEvents.get(n)||[]),fn])};
 context.fetch=async(input,init={})=>{calls.push({input,init});if(network)return network(input,init);return new Response(JSON.stringify({id:'read',workLock:{locked:false}}),{status:200,headers:{'X-Store-Work-Context':encodeURIComponent(JSON.stringify(scope))}});};
 context.window=context;context.top=context;vm.createContext(context);for(const file of ['work-continuity-core.js','work-continuity.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../web',file),'utf8'),context);
 function field(name,value='',type='text'){const form={id:'new-form',elements:fields},el={name,value,type,id:'',tagName:'INPUT',form,disabled:false,readOnly:false,closest:()=>null,dispatchEvent(){}};fields.push(el);return el;}
 return {context,calls,field,network:fn=>network=fn,emit:name=>(events.get(name)||[]).forEach(fn=>fn({})),edit:el=>(docEvents.get('input')||[]).forEach(fn=>fn({target:el,isTrusted:true})),ready:async()=>{await context.fetch('/api/me');context.StoreWorkContinuity.pageReady();}};
}
test('恢复业务编号、表单、串号草稿和滚动位置，不产生提交请求',async()=>{
 const saved=storage(),a=browser(saved),number=a.field('externalOrderNo'),password=a.field('password','','password'),confirm=a.field('confirmed','','checkbox');await a.ready();let cart={items:[]};a.context.StoreWorkContinuity.register('sale',{route:'/app?tab=sales',read:()=>cart,restore:v=>cart=v,meaningful:v=>v.items.length>0});
 number.value='YD-123';password.value='must-not-save';confirm.value='yes';cart={items:[{serialNo:'869685000000001',price:300}]};a.context.scrollY=640;a.edit(number);a.emit('pagehide');
 assert(![...saved.values.values()].some(v=>v.includes('must-not-save')));
 const b=browser(saved),restored=b.field('externalOrderNo');await b.ready();let recovered;b.context.StoreWorkContinuity.register('sale',{route:'/app?tab=sales',read:()=>recovered,restore:v=>recovered=v});
 assert.equal(restored.value,'YD-123');assert.equal(recovered.items[0].serialNo,'869685000000001');assert.equal(b.context.scrolled.top,640);assert(b.calls.every(c=>!c.init.method));
});
test('其他营业员或另一门店不会恢复本人的草稿',async()=>{
 const saved=storage(),a=browser(saved),f=a.field('externalOrderNo');await a.ready();f.value='private-draft';a.emit('pagehide');
 for(const scope of [['clerk-b','tenant-a','branch-a'],['clerk-a','tenant-a','branch-b']]){const b=browser(saved,scope),g=b.field('externalOrderNo');await b.ready();assert.equal(g.value,'');}
});
test('提交中断后重开页面按原请求号重试，拦截修改后的重复记单',async()=>{
 const saved=storage(),a=browser(saved);a.field('externalOrderNo','YD-1');await a.ready();a.network(async()=>{throw Error('connection lost');});const init={method:'POST',headers:{'Idempotency-Key':'original-key'},body:JSON.stringify({externalOrderNo:'YD-1'})};await assert.rejects(a.context.fetch('/api/carrier-services',init));
 const b=browser(saved);b.field('externalOrderNo');await b.ready();await assert.rejects(b.context.fetch('/api/carrier-services',{...init,body:'{"externalOrderNo":"YD-2"}'}),/上次提交结果待核对/);
 b.network(async()=>new Response('{"id":"carrier-saved"}',{status:200}));await b.context.fetch('/api/carrier-services',{...init,headers:{'Idempotency-Key':'new-key'}});assert.equal(b.calls.at(-1).init.headers.get('Idempotency-Key'),'original-key');
 assert.equal(Object.keys(JSON.parse([...saved.values.values()][0]).requests).length,0);
});
test('保存成功后页面离开不会重新保存旧草稿',async()=>{
 const saved=storage(),a=browser(saved),f=a.field('externalOrderNo');await a.ready();f.value='already-saved';a.context.StoreWorkContinuity.register('sale',{read:()=>({items:['already-saved']}),restore(){}});a.context.StoreWorkContinuity.snapshot();a.context.StoreWorkContinuity.complete('sale');a.emit('pagehide');
 const b=browser(saved),g=b.field('externalOrderNo');await b.ready();let restored=false;b.context.StoreWorkContinuity.register('sale',{read:()=>({}),restore(){restored=true;}});assert.equal(g.value,'');assert.equal(restored,false);
});
test('深链只保留业务导航参数，排除登录、外链与自动办理参数',()=>{
 assert.equal(C.route('//example.com'),'');assert.equal(C.route('/login?token=secret'),'');assert.equal(C.route('/receptions?highlight=R1&assist=approval&token=secret'),'/receptions?highlight=R1');assert.equal(C.route('/app?tab=sales'),'/app?tab=sales');
});
