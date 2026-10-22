 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vision=require('../src/companion-vision'),lib=require('../src/companion-library'),personal=require('../src/companion'),photos=require('../src/stocktake-photo');
const owner={id:'own',name:'本人',roleCode:'owner'},other={id:'other',roleCode:'owner'},staff={id:'staff',roleCode:'employee'};
const image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64'),file=photos.image(image);
const make=()=>({companionProfiles:[],companionMemories:[],operationLogs:[],inventory:[],sales:[]});
const result={title:'白菜和苹果',visibleText:'标价[不清]',observations:[{text:'可见一棵白菜和苹果',photo:1,confidence:'medium'}],uncertain:['数量和金额无法确定']};
function add(s){lib.savePhoto(s,owner,{kind:'购物记录',date:'2000-01-01'},file);return lib.snapshot(s,owner).items[0];}
const client={configured:()=>true,provider:()=> 'mock.invalid',describeLife:async()=>result};
test('只有本人照片可识别，必须单独同意；禁用时不外发',async()=>{
 const s=make(),r=add(s);let calls=0;const options={client:{...client,describeLife:async()=>{calls++;return result}},readFile:async()=>file.bytes};
 for(const user of [other,staff])await assert.rejects(vision.prepare(s,user,{id:r.id,version:r.version,consent:true},options),{statusCode:user===other?404:403});
 await assert.rejects(vision.prepare(s,owner,{id:r.id,version:r.version},options),{statusCode:400});assert.equal(calls,0);
 await assert.rejects(vision.prepare(s,owner,{id:r.id,version:r.version,consent:true},{client:vision.createClient({env:{}}),readFile:options.readFile}),{statusCode:503});
});
test('只发送所选照片及分类，结果待核对不写内容、不猜金额，不改库存和记忆',async()=>{
 const s=make(),r=add(s),before=structuredClone({inventory:s.inventory,sales:s.sales,memories:s.companionMemories});let sent;
 const b={id:r.id,version:r.version,consent:true},p=await vision.prepare(s,owner,b,{client:{...client,describeLife:async(...args)=>{sent=args;return result}},readFile:async()=>file.bytes});
 const v=vision.commit(s,owner,b,p,'one');assert.deepEqual(sent,[image,'购物记录']);assert.equal(v.analysis.status,'待核对');assert.equal(r.content,'');assert.equal(r.price,null);assert.deepEqual({inventory:s.inventory,sales:s.sales,memories:s.companionMemories},before);
 assert.equal(vision.previous(s,owner,b,'one').analysis.id,v.analysis.id);assert.throws(()=>vision.previous(s,owner,{...b,id:'different'},'one'),{statusCode:409});
 vision.confirm(s,owner,{id:r.id,version:r.version,analysisId:r.analysis.id,title:'今天买的白菜',content:'本人核对：买了白菜和苹果',tags:'白菜 苹果'});
 assert.equal(lib.search(s,owner,{q:'白菜 苹果',filter:'photos'}).length,1);assert.equal(r.analysis.status,'已核对');assert.equal(r.price,null);personal.clearScreen(s,owner);assert.equal(lib.search(s,owner,{q:'白菜'}).length,1);
 assert.deepEqual(lib.search(s,other,{q:'白菜'}),[]);
});
test('识别中途修改、旧版本确认及错误文件均拒绝，不覆盖已有资料',async()=>{
 const s=make(),r=add(s),b={id:r.id,version:r.version,consent:true};const p=await vision.prepare(s,owner,b,{client,readFile:async()=>file.bytes});
 lib.change(s,owner,{id:r.id,version:r.version,action:'unfavorite'});assert.throws(()=>vision.commit(s,owner,b,p,'one'),{statusCode:409});assert.equal(r.analysis,undefined);
 await assert.rejects(vision.prepare(s,owner,{...b,version:r.version},{client,readFile:async()=>Buffer.from('bad')}),{statusCode:400});
 const fresh={...b,version:r.version},prepared=await vision.prepare(s,owner,fresh,{client,readFile:async()=>file.bytes});vision.commit(s,owner,fresh,prepared,'two');
 assert.throws(()=>vision.confirm(s,owner,{id:r.id,version:fresh.version,analysisId:r.analysis.id,title:'覆盖',content:'bad'}),{statusCode:409});vision.dismiss(s,owner,{id:r.id,version:r.version,analysisId:r.analysis.id});assert.equal(r.content,'');
});
test('输出必须带照片依据和确定程度；错误结构拒绝',()=>{
 for(const value of [{title:'苹果',observations:['苹果'],uncertain:[],visibleText:''},{...result,observations:[{text:'苹果',photo:3,confidence:'high'}]},{...result,observations:[{text:'苹果',photo:1,confidence:1}]},{...result,title:''}])assert.throws(()=>photos.parseLifePhoto(JSON.stringify(value)),{statusCode:502});assert.equal(photos.parseLifePhoto(JSON.stringify(result)).observations[0].confidence,'medium');
});
test('真正的多模态请求使用image_url，服务端密钥不进结果；不复用文字聊天URL',async()=>{
 let sent;const env={COMPANION_VISION_ENABLED:'true',COMPANION_VISION_URL:'https://vision.invalid/v1/chat/completions',COMPANION_VISION_API_KEY:'private-vision-key',COMPANION_VISION_MODEL:'vision',COMPANION_CHAT_URL:'https://text.invalid/chat',COMPANION_CHAT_API_KEY:'text-key'};
 const model=vision.createClient({env,fetchImpl:async(url,options)=>{assert.equal(String(url),env.COMPANION_VISION_URL);assert.equal(options.headers.Authorization,'Bearer private-vision-key');sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));}});
 assert.equal((await model.describeLife(image,'购物记录')).title,result.title);assert.equal(sent.messages[1].content[1].image_url.url,image);assert.ok(!JSON.stringify(vision.status(model)).includes('private-vision-key'));
 assert.equal(vision.createClient({env:{COMPANION_CHAT_URL:env.COMPANION_CHAT_URL,COMPANION_CHAT_API_KEY:'text-key'}}).configured(),false);
});
