 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),personal=require('../src/companion'),chat=require('../src/companion-chat'),decision=require('../src/companion-decision'),{createClient}=require('../src/companion-model'),vision=require('../src/companion-vision'),lib=require('../src/companion-library'),photos=require('../src/stocktake-photo');
const owner={id:'own',name:'本人',roleCode:'owner'},other={id:'other',name:'另一位',roleCode:'owner'},staff={id:'staff',roleCode:'employee'};
const make=()=>({companionProfiles:[],companionMemories:[],companionMessages:[],operationLogs:[],inventory:[],sales:[]});
const memory=(s,content,category='其他',extra={})=>personal.memory(s,owner,{content,category,...extra});
const options=model=>({liveQuery:async()=>null,companionModelClient:model});

test('个人背景保存前验证、旧客户端不清掉新增背景；身份不增加员工权限',()=>{
 const s=make();personal.saveProfile(s,owner,{nickname:'本人',lifeRole:'校长',personality:'先听各方',resources:'老同事愿意帮忙',shareWithModel:false});
 personal.saveProfile(s,owner,{nickname:'本人',shareWithModel:false});assert.equal(personal.profile(s,owner).lifeRole,'校长');
 assert.throws(()=>personal.saveProfile(s,owner,{nickname:'本人',resources:'长'.repeat(501)}),{statusCode:400});assert.equal(personal.profile(s,owner).resources,'老同事愿意帮忙');
 assert.throws(()=>personal.saveProfile(s,staff,{nickname:'校长',lifeRole:'老板'}),{statusCode:403});assert.equal(staff.roleCode,'employee');assert.equal(personal.profile(s,other).lifeRole,undefined);
});

test('本人说法和亲友看法可同时存在，不能去重成一个事实；编辑保留来源和旧版本',()=>{
 const s=make(),a=memory(s,'我做决定有些急','性格'),b=memory(s,'我做决定有些急','性格',{sourceKind:'observer',reportedBy:'女儿'});
 assert.notEqual(a.id,b.id);assert.equal(a.opinionOnly,false);assert.equal(b.opinionOnly,true);
 personal.memory(s,owner,{id:b.id,version:b.version,content:'遇到大事会先想一想',category:'性格'});assert.equal(b.sourceKind,'observer');assert.equal(b.reportedBy,'女儿');assert.equal(b.history[0].reportedBy,'女儿');
 assert.throws(()=>memory(s,'不同看法','性格',{sourceKind:'observer'}),{statusCode:400});assert.throws(()=>memory(s,'伪装留言','性格',{sourceKind:'family',reportedBy:'女儿'}),{statusCode:400});
});

test('亲友留言只能本人允许参考、只用自己收到的内容；看法可查可改可移除且不自动采集',()=>{
 const s=make();personal.saveProfile(s,owner,{nickname:'本人'});personal.profile(s,owner).familyCare={members:[{id:'kid',name:'小李',relationship:'女儿'}],messages:[{id:'child-msg',from:'child',memberId:'kid',content:'爸爸担心麻烦别人，可能不愿求助',createdAt:'2026-10-10T02:00:00Z'},{id:'self-msg',from:'parent',memberId:'kid',content:'我自己的话'}]};
 assert.equal(s.companionMemories.length,0);assert.throws(()=>personal.familyObservation(s,owner,{messageId:'child-msg'}),{statusCode:400});
 assert.throws(()=>personal.familyObservation(s,other,{messageId:'child-msg',consent:true}),{statusCode:404});assert.throws(()=>personal.familyObservation(s,staff,{messageId:'child-msg',consent:true}),{statusCode:403});assert.throws(()=>personal.familyObservation(s,owner,{messageId:'self-msg',consent:true}),{statusCode:404});
 const m=personal.familyObservation(s,owner,{messageId:'child-msg',consent:true});assert.equal(m.opinionOnly,true);assert.equal(m.reportedBy,'小李（女儿）');assert.equal(m.sourceMessageId,'child-msg');assert.equal(personal.familyObservation(s,owner,{messageId:'child-msg',consent:true}).id,m.id);
 personal.memory(s,owner,{id:m.id,version:m.version,content:'女儿认为我不愿求助'});assert.equal(m.sourceKind,'family');assert.equal(m.sourceMessageId,'child-msg');personal.clearScreen(s,owner);assert.equal(personal.snapshot(s,owner).memories[0].id,m.id);personal.removeMemory(s,owner,{id:m.id});assert.equal(s.companionMemories.length,0);assert.equal(personal.profile(s,owner).familyCare.messages.length,2);
});

test('求主意不被亲情记账或习惯召回抢答；只选本人有效相关记忆并遵守授权',async()=>{
 const s=make(),calls=[],model={configured:()=>true,request:async(q,o)=>{calls.push(o);return '先了解双方想法，再比较办法';}};
 memory(s,'我喜欢先冷静再谈','处事');memory(s,'女儿觉得我不愿求助','性格',{sourceKind:'observer',reportedBy:'女儿'});memory(s,'儿子有一项私人疾病','健康');personal.memory(s,other,{content:'另一位的资源',category:'职业'});
 personal.saveProfile(s,owner,{nickname:'本人',lifeRole:'退休教师',resources:'老同事愿意解释政策',shareWithModel:false});
 let r=await chat.prepare(s,owner,{question:'最近儿子送礼了，我要不要回礼，该怎么办？'},options(model));assert.equal(r.metrics.kind,'personal-decision');assert.deepEqual(calls[0].profile,{});assert.deepEqual(calls[0].memories,[]);chat.commit(s,owner,'最近儿子送礼了，我要不要回礼，该怎么办？',r,'one');assert.equal(personal.profile(s,owner).familyCare?.drafts?.length||0,0);
 personal.saveProfile(s,owner,{nickname:'本人',shareWithModel:true});await chat.prepare(s,owner,{question:'按我的习惯，跟女儿起争执该怎么办？'},options(model));assert.equal(calls[1].profile.lifeRole,'退休教师');assert.ok(calls[1].memories.some(x=>x.opinionOnly));assert.ok(!JSON.stringify(calls[1]).includes('私人疾病'));assert.ok(!JSON.stringify(calls[1]).includes('另一位的资源'));
});

test('背景修改不通过旧对话重新带入，刚修改后的同毫秒新对话正常进入',async()=>{
 const s=make();personal.saveProfile(s,owner,{nickname:'本人',personality:'急性子',shareWithModel:true});personal.append(s,owner,'我是急性子',{answer:'先冷静',channel:'life'},'old');
 personal.saveProfile(s,owner,{nickname:'本人',personality:'现在比较耐心',shareWithModel:true});personal.append(s,owner,'新的事情',{answer:'说说看',channel:'life'},'new');let input;
 await chat.prepare(s,owner,{question:'我该怎么处理这件事？'},options({configured:()=>true,request:async(q,b)=>{input=b;return '先弄清情况';}}));assert.ok(!JSON.stringify(input.messages).includes('急性子'));assert.equal(input.messages.length,1);assert.equal(input.profile.personality,'现在比较耐心');
});

test('连续讨论只跟自己的最近事情；模型不可用时询问目标，不伪造人格评判',async()=>{
 const s=make(),m={configured:()=>false};let a=await chat.prepare(s,owner,{question:'跟朋友起争执该怎么办？'},options(m));chat.commit(s,owner,'跟朋友起争执该怎么办？',a,'first');
 a=await chat.prepare(s,owner,{question:'那先请老师帮忙呢'},options(m));assert.equal(a.metrics.caseQuestion,'跟朋友起争执该怎么办？');assert.match(a.answer,/最希望.*结果/);assert.match(a.answer,/没有返回/);assert.equal(a.modelConnected,false);
 assert.equal(decision.query('记住：我总纠结'),null);assert.equal(decision.query('那这样行吗',{channel:'life',question:'另一件事',response:{metrics:{kind:'personal-decision'}},createdAt:'2000-01-01'}),null);
});

test('真实模型请求携带来源与背景，亲友看法不变诊断；接口形状仍兼容',async()=>{
 let sent;const model=createClient({env:{COMPANION_CHAT_URL:'https://model.invalid/chat',COMPANION_CHAT_API_KEY:'synthetic-key'},fetchImpl:async(url,o)=>{sent=JSON.parse(o.body);return new Response(JSON.stringify({success:true,reply:'先听双方的说法'}));}});
 await model.request('给我出个主意',{profile:{lifeRole:'校长',resources:'老师可帮忙'},decision:{caseQuestion:'学生家长误会'},memories:[{content:'家人认为我容易担心',confirmed:true,opinionOnly:true,reportedBy:'女儿',updatedAt:'2026-10-11'}]});
 assert.deepEqual(Object.keys(sent).sort(),['history','message','sessionId','stream']);const policy=sent.history[0].content;assert.match(policy,/校长/);assert.match(policy,/老师可帮忙/);assert.match(policy,/亲友看法，仅供参考/);assert.match(policy,/一次一个问题/);assert.match(policy,/不能宣称自己是唯一依靠/);assert.match(policy,/具体咨询医生或药师/);assert.match(policy,/一小步/);
});

test('药品模式丢弃模型推测的用法，不报价不写记忆，咨询提示经本人核对后仍保留',async()=>{
 const s=make(),image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64'),file=photos.image(image);lib.savePhoto(s,owner,{kind:'药品照片',date:'2000-01-01'},file);const r=lib.snapshot(s,owner).items[0],b={id:r.id,version:r.version,consent:true};
 const p=await vision.prepare(s,owner,b,{readFile:async()=>file.bytes,client:{configured:()=>true,describeLife:async()=>({title:'猜测药名',visibleText:'照片说明：药名[不清]',observations:[{text:'可以加倍服用，肯定能治好',photo:1,confidence:'high'}],uncertain:[]})}});vision.commit(s,owner,b,p,'drug');assert.match(r.analysis.medicineNotice,/仅供参考.*具体咨询医生或药师/);assert.ok(!JSON.stringify(r.analysis).includes('加倍服用'));assert.match(r.analysis.uncertain.join(' '),/无法可靠确认/);assert.match(r.analysis.uncertain.join(' '),/看不清/);assert.equal(r.price,null);assert.equal(r.content,'');assert.equal(s.companionMemories.length,0);
 vision.confirm(s,owner,{id:r.id,version:r.version,analysisId:r.analysis.id,title:'待问药师',content:'药名还没看清',tags:'药盒'});assert.match(r.analysis.medicineNotice,/不能作为服药依据/);assert.equal(lib.search(s,owner,{q:'药',filter:'photos'}).length,1);assert.equal(lib.search(s,other,{q:'药',filter:'photos'}).length,0);
});
