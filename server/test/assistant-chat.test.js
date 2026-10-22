'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args);};
const c=require('../src/common'),personal=require('../src/personal-assistant'),chat=require('../src/assistant-chat'),{createClient}=require('../src/assistant-external-chat');
function fixture(){return c.initialize({users:[{id:'owner',name:'老板',roleCode:'owner',status:'active'},{id:'clerk',name:'营业员',roleCode:'employee',status:'active',permissions:['sale:create']},{id:'kiosk',name:'顾客助理',roleCode:'customer-assistant',status:'active'}],products:[],sales:[],inventory:[]});}
function adapter(reply='这几天天热，记得喝水。',intent='chat',hits=[]){
 const calls=[];const client=createClient({env:{ASSISTANT_CHAT_ENABLED:'true',ASSISTANT_CHAT_URL:'https://chat.example.test/api/public/chat',ASSISTANT_CHAT_API_KEY:'test-only-key'},fetchImpl:async(_url,options)=>{
 const body=JSON.parse(options.body);calls.push(body);return new Response(JSON.stringify({success:true,sessionId:body.sessionId,intent,reply,hits}),{headers:{'content-type':'application/json'}});}});
 return {client,calls,scope:{tenantId:'t1',branchId:'b1'}};
}
test('默认关闭时回答与原助理一致',async()=>{
 const s=fixture(),p={question:'帮我了解一下移动业务办理条件'},client=createClient({env:{},fetchImpl:async()=>{throw Error('unused');}});
 const a=await chat.ask(s,s.users[0],p,{client});assert.equal(a.answer,personal.ask(s,s.users[0],p).answer);assert.equal(a.externalChat,undefined);
});
test('业务自然对话进入外部接口，连续聊天保留会话，账套不变',async()=>{
 const s=fixture(),before=JSON.stringify(s),options=adapter(),a=await chat.ask(s,s.users[0],{question:'帮我了解一下移动业务办理条件'},options);
 assert.equal(a.metrics.kind,'external-chat');assert.match(a.answer,/记得喝水/);
 const b=await chat.ask(s,s.users[0],{question:'你好',context:a.context},options);
 assert.equal(options.calls.length,2);assert.equal(options.calls[0].sessionId,options.calls[1].sessionId);assert.equal(b.externalChat.status,'connected');assert.equal(JSON.stringify(s),before);
});
test('不同门店、不同员工及顾客模式在网站桥接处仍隔离',async()=>{
 const s=fixture(),options=adapter(),a=await chat.ask(s,s.users[0],{question:'你好'},options);
 for(const [user,scope,mode] of [[s.users[1],options.scope,'store'],[s.users[0],{tenantId:'t1',branchId:'b2'},'store'],[s.users[0],options.scope,'customer']]){
 const b=await chat.ask(s,user,{question:'你好',context:a.context,mode},{...options,scope});assert.equal(b.metrics.kind,'external-chat');assert.notEqual(b.context.externalChat.sessionId,a.context.externalChat.sessionId);
 }
});
test('库存、经营账目、开单和顾客禁查内容不交给外部聊天回答',async()=>{
 const s=fixture(),options=adapter('已开单并收款','biz',[{std:'假来源',score:1}]);
 for(const q of ['查库存','今天赚了多少','工资明细在哪里','串号1234','帮我开销售单','备份怎么做','客户手机号15923432599']){
 await chat.ask(s,s.users[0],{question:q},options);
 }
 await chat.ask(s,s.users[2],{question:'今天营业额多少',mode:'store'},options);assert.equal(options.calls.length,0);
});
test('老板保存的问答优先，不被外部模型覆盖',async()=>{
 const s=fixture();s.assistantDialogues=[{id:'manual-1',questions:['你好'],answer:'欢迎来到本店。',answerMandarin:'欢迎来到本店。',enabled:true,customerVisible:true,version:1}];
 const options=adapter();assert.equal((await chat.ask(s,s.users[0],{question:'你好'},options)).answer,'欢迎来到本店。');assert.equal(options.calls.length,0);
});
test('外部接口 404 时回退，原答案和编辑入口仍保留',async()=>{
 const s=fixture(),options=adapter();options.client=createClient({env:{ASSISTANT_CHAT_ENABLED:'true',ASSISTANT_CHAT_URL:'https://chat.example.test/chat',ASSISTANT_CHAT_API_KEY:'test-only-key'},fetchImpl:async()=>new Response('html',{status:404})});
 const p={question:'帮我了解一下移动业务办理条件'},r=await chat.ask(s,s.users[0],p,options);
 assert.equal(r.answer,personal.ask(s,s.users[0],p).answer);assert.equal(r.unresolved,true);assert.equal(r.externalChat.reason,'http-404');
});
test('没有知识证据的确定资费报价及内部底价不能作为外部回答显示',async()=>{
 const s=fixture();
 for(const [reply,intent,hits,reason] of [['每月20元可办理','biz',[],'missing-evidence'],['内部底价为800元','biz',[{std:'问题',score:1}],'private-answer']]){
 const options=adapter(reply,intent,hits),r=await chat.ask(s,s.users[0],{question:'帮我了解一下移动业务办理条件'},options);assert.equal(r.externalChat.reason,reason);assert.notEqual(r.answer,reply);
 }
});
test('有命中的业务回答保留标准问题和证据；缺资料可以交老板核对',async()=>{
 const s=fixture();
 const options=adapter('按本店资料，15元档提供对应流量，办理条件请核对。','biz',[{std:'单独加流量包好多钱',score:0.763}]);
 const a=await chat.ask(s,s.users[0],{question:'帮我了解一下移动业务办理条件'},options);assert.equal(a.metrics.referenceOnly,true);assert.equal(a.sources[0].label,'单独加流量包好多钱');
 const empty=adapter('查不到这项资料，请咨询老板或渠道经理。','biz');
 assert.match((await chat.ask(s,s.users[0],{question:'帮我了解一下移动业务办理条件'},empty)).answer,/咨询老板/);
});
test('顾客模式中普通未知问句可以聊天，不能泄漏店内资料',async()=>{
 const s=fixture(),options=adapter('欢迎，有什么可以帮您？');
 const a=await chat.ask(s,s.users[2],{question:'帮我了解一下移动业务办理条件'},options);assert.equal(a.mode,'customer');assert.equal(a.metrics.kind,'external-chat');
 const unsafe=adapter('库存数量现在有30台','chat');const b=await chat.ask(s,s.users[2],{question:'帮我了解一下移动业务办理条件'},unsafe);assert.equal(b.externalChat.reason,'private-answer');
});

test('资费追问从已核实的上次回答引用，不被误判为成交；上下文价格不能篡改',async()=>{
 const s=fixture(),options=adapter('按本店资料，15块钱的有10个G通用加10个G定向；20块钱的是15个G通用加10个G定向；30块钱的是20个G通用加20个G定向。','biz',[{std:'单独加流量包好多钱',score:0.763}]);
 const a=await chat.ask(s,s.users[0],{question:'单独加个流量包好多钱'},options);
 assert.equal(a.metrics.kind,'external-chat');
 const b=await chat.ask(s,s.users[0],{question:'那20块的有多少流量',context:a.context},options);
 assert.equal(options.calls.length,1);assert.match(b.answer,/20块钱的是15个G通用加10个G定向/);assert.equal(b.metrics.kind,'external-chat');
 const forged=structuredClone(a.context);forged.externalChat.business.reply='20块钱的是999个G。';
 await chat.ask(s,s.users[0],{question:'那20块的有多少流量',context:forged},options);assert.equal(options.calls.length,2);
});
test('外部接口错判普通资费问题为成交时保留本地查询',async()=>{
 const s=fixture(),options=adapter('请到门店买手机','deal'),p={question:'外地卡能收验证码吗'};
 const r=await chat.ask(s,s.users[0],p,options);assert.match(r.answer,/核对号码状态/);assert.doesNotMatch(r.answer,/到门店买手机|查库存/);assert.equal(r.externalChat.reason,'unexpected-deal');
});

test('逗号分隔的多档资费追问只引用对应一档',async()=>{
 const s=fixture(),options=adapter('15块钱的有10个G通用加10个G定向，20块钱的是15个G通用加10个G定向，30块钱的是20个G通用加20个G定向。','biz',[{std:'单独加流量包好多钱',score:0.763}]);
 const a=await chat.ask(s,s.users[0],{question:'单独加个流量包好多钱'},options);
 const b=await chat.ask(s,s.users[0],{question:'那20块的有多少流量',context:a.context},options);
 assert.match(b.answer,/20块钱的是15个G通用加10个G定向/);assert.doesNotMatch(b.answer,/30块/);assert.equal(options.calls.length,1);
});

test('导入的通用接话继续查具体答案，老板修订的回答保留优先',async()=>{
 const s=fixture(),q='我不想换套餐，单独加流量包好多钱';
 s.employeeKnowledge=[{id:'flow-training',importBatch:'customer-talk-20261009',conversationTopic:'mobile',customerQuestions:[q],title:'流量包咨询',summary:'先核对费用和流量范围。',summaryDialect:'先核对费用和流量范围哈。',policyStatus:'current',enabled:true}];
 const options=adapter('20元档15G通用加10G定向。','biz',[{std:q,score:1}]);
 assert.equal(personal.ask(s,s.users[0],{question:q}).metrics.kind,'customer-dialogue');
 const a=await chat.ask(s,s.users[0],{question:q},options);assert.match(a.answer,/15G/);assert.equal(a.metrics.kind,'external-chat');
 s.assistantDialogues=[{id:'knowledge:flow-training',questions:[q],answer:'老板已核对的回答。',enabled:true,version:1,customerVisible:true}];
 assert.equal((await chat.ask(s,s.users[0],{question:q},options)).answer,'老板已核对的回答。');assert.equal(options.calls.length,1);
});

test('实际导入的接话资料带帮助入口和资料版本，仍继续查具体答案',async()=>{
 const fs=require('node:fs'),path=require('node:path'),s=fixture();
 const bundle=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../data/knowledge-imports/customer-talk-20261009/bundle.json'),'utf8'));
 require('../src/employee-knowledge-import').apply(s,s.users[0],bundle);
 const q='单独加个流量包好多钱',local=personal.ask(s,s.users[0],{question:q});assert.equal(local.metrics.kind,'customer-talk-guidance');assert.equal(local.action.type,'navigate');
 const options=adapter('15元、20元和30元三档流量包。','biz',[{std:'单独加流量包好多钱',score:0.8}]),before=JSON.stringify(s);
 const a=await chat.ask(s,s.users[0],{question:q},options);assert.equal(a.metrics.kind,'external-chat');assert.equal(options.calls.length,1);assert.equal(JSON.stringify(s),before);
});

test('口语价位追问、中文数字与暂时查不到的问题不丢失已核实的会话',async()=>{
 const s=fixture(),options=adapter('15块钱的是10个G通用加10个G定向；20块钱的是15个G通用加10个G定向。','biz',[{std:'单独加流量包好多钱',score:1}]);
 const a=await chat.ask(s,s.users[0],{question:'单独加个流量包好多钱'},options);
 for(const question of ['那20块的呢','20元的呢','二十块的呢']){
  const b=await chat.ask(s,s.users[0],{question,context:a.context},options);assert.match(b.answer,/15个G通用/);assert.equal(options.calls.length,1);
 }
 options.client=createClient({env:{ASSISTANT_CHAT_ENABLED:'true',ASSISTANT_CHAT_URL:'https://chat.example.test/api/public/chat',ASSISTANT_CHAT_API_KEY:'test-only-key'},fetchImpl:async(_url,options)=>new Response(JSON.stringify({success:true,sessionId:JSON.parse(options.body).sessionId,intent:'deal',reply:'请到门店买手机',hits:[]}),{headers:{'content-type':'application/json'}})});
 const b=await chat.ask(s,s.users[0],{question:'外地卡能收验证码吗',context:a.context},options);assert.equal(b.externalChat.reason,'unexpected-deal');assert.equal(b.context.externalChat.sessionId,a.context.externalChat.sessionId);
});

test('带出处的业务回答即使上游标成闲聊，也保留业务证据',async()=>{
 const s=fixture(),options=adapter('流量包20元档15G通用加10G定向。','other',[{std:'单独加流量包好多钱',score:0.8}]);
 const a=await chat.ask(s,s.users[0],{question:'20元流量包有多少流量'},options);
 assert.equal(a.metrics.intent,'biz');assert.equal(a.metrics.referenceOnly,true);assert.equal(a.sources.length,1);
});
test('未命中的其他意图不得覆盖已识别的需求，低相似回答不能冒充正确答案',async()=>{
 const s=fixture(),q='想装宽带，有哪些套餐',options=adapter('查不到资料，请咨询老板或渠道经理。','other');
 const a=await chat.ask(s,s.users[0],{question:q},options);
 assert.equal(a.answer,personal.ask(s,s.users[0],{question:q}).answer);assert.equal(a.externalChat.reason,'no-knowledge-match');
 const weak=adapter('未核实的资费。','biz',[{std:'不相关问题',score:0.3}]);
 assert.equal((await chat.ask(s,s.users[0],{question:'单独加个流量包好多钱'},weak)).externalChat.reason,'weak-evidence');
});
test('初次问具体价位只答对应流量档，后续仍可问其他价位',async()=>{
 const s=fixture(),options=adapter('15元是10G通用加10G定向；20元是15G通用加10G定向；30元是20G通用加20G定向。','biz',[{std:'单独加流量包好多钱',score:1}]);
 const a=await chat.ask(s,s.users[0],{question:'20元流量包里面有多少流量'},options);
 assert.match(a.answer,/20元是15G/);assert.doesNotMatch(a.answer,/15元|30元/);
 const b=await chat.ask(s,s.users[0],{question:'那30块的呢',context:a.context},options);
 assert.match(b.answer,/30元是20G/);assert.equal(options.calls.length,1);
});

test('短信验证码没有可靠答案时先澄清具体问题，不退回库存和开单菜单',async()=>{
 const s=fixture(),before=JSON.stringify(s);
 for(const mode of ['store','customer']){
  const options=adapter('不可靠的验证码结论','biz',[{std:'另一问题',score:0.2}]);
  const a=await chat.ask(s,s.users[0],{question:'外地卡能收验证码吗',mode},options);
  assert.equal(a.externalChat.reason,'weak-evidence');assert.equal(a.metrics.kind,'business-clarification');
  assert.match(a.answer,/核对号码状态|短信|验证码/);assert.doesNotMatch(a.answer,/查库存|查单据|开单|不可靠的验证码结论/);
  assert.deepEqual(a.sources,[]);
 }
 assert.equal(JSON.stringify(s),before);
});
