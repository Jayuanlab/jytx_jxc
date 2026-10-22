"use strict";
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Module = require('node:module'), load = Module._load;
Module._load = function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const c = require('../src/common'), assistant = require('../src/personal-assistant'), create = require('../src/assistant-product-create'), chat = require('../src/assistant-chat'), capabilities = require('../src/assistant-capabilities');
const owner = {id:'boss',name:'老板',roleCode:'owner',status:'active'};
const staff = {id:'staff',name:'营业员',roleCode:'employee',status:'active',permissions:['sale:create','product:update']};
const denied = {id:'denied',name:'普通账号',roleCode:'employee',status:'active',permissions:['sale:create']};
const kiosk = {id:'kiosk',name:'顾客',roleCode:'customer-assistant',status:'active'};
function store(){return c.initialize({users:[owner,staff,denied,kiosk],products:[],inventory:[],purchases:[],sales:[],receipts:[]})}
test('用户截图原话直接识别，商品建档草稿不含进货价也不改账',()=>{
 const s=store(),before=JSON.stringify(s),reply=assistant.ask(s,staff,{question:'帮我新建一个商品资料 VIVO S60 16+512'});
 assert.equal(reply.metrics.kind,'product-draft');assert.equal(reply.action.type,'navigate');assert.equal(reply.action.href,'/app?tab=products&new=1');assert.equal(reply.action.draftKind,'product');assert.equal(reply.action.ownerId,staff.id);assert.deepEqual(reply.action.prefill,{name:'VIVO S60 16+512'});assert.match(reply.answer,/进货价在进货单/);assert.equal(reply.saleFlow,undefined);assert.equal(JSON.stringify(s),before);
});
test('常见建档命令及全角容量只准备名称，额外价格串码不入草稿',()=>{
 for(const [question,name] of [['新增商品 VIVO S60 16＋512','VIVO S60 16+512'],['请创建一个产品档案 名称：Type-C 数据线','Type-C 数据线'],['商品建档：华为 Mate 70','华为 Mate 70'],['给 VIVO S60 16+512 新建商品档案','VIVO S60 16+512'],['帮我新建商品资料，名称：VIVO S60 16+512，进货价：1200，串号：868123456789001','VIVO S60 16+512']]){
  const s=store(),before=JSON.stringify(s),reply=assistant.ask(s,staff,{question});assert.deepEqual(reply.action?.prefill,{name},question);assert.equal(JSON.stringify(s),before,question);
 }
});
test('无名称或说明型提问不编造名称，没有自动库存和售价默认',()=>{
 for(const question of ['帮我新建商品资料','怎么新增商品资料','请新增一个商品资料吧']){const result=assistant.ask(store(),owner,{question});assert.deepEqual(result.action.prefill,{},question);assert.match(result.answer,/核对商品名称/);assert.equal(result.saleFlow,undefined);}
});
test('重复商品按实际档案识别，返回已有入口而非新建',()=>{
 const s=store();s.products.push({skuId:'p1',externalCode:'real-code',name:'vivo S60 16+512',active:true});const before=JSON.stringify(s),reply=assistant.ask(s,staff,{question:'帮我新建一个商品资料 VIVO S60 16+512'});assert.equal(reply.metrics.existing,true);assert.equal(reply.action.href,'/app?tab=products');assert.equal(reply.action.prefill,undefined);assert.match(reply.answer,/避免重复/);assert.equal(JSON.stringify(s),before);
});
test('未获授权、停用、顾客模式和顾客机器人均无建档动作',()=>{
 const s=store(),before=JSON.stringify(s);
 for(const user of [denied,{...staff,status:'disabled'},{...staff,capabilityOverrides:{manageProducts:false}}]){const result=assistant.ask(s,user,{question:'新建商品资料 VIVO S60 16+512'});assert.equal(result.action,undefined);assert.equal(result.metrics.restricted,true);}
 for(const user of [owner,kiosk]){const result=assistant.ask(s,user,{question:'新建商品资料 VIVO S60 16+512',mode:user===owner?'customer':'store'});assert.equal(result.mode,'customer');assert.equal(result.action,undefined);assert.equal(result.metrics.restricted,true);}
 assert.equal(JSON.stringify(s),before);
});
test('建档功能目录遵守同一权限，正常拒绝及查询不会误识别成建档',()=>{
 assert.ok(capabilities.catalog(store(),staff).items.some(x=>x.id==='product-create'));
 assert.ok(!capabilities.catalog(store(),denied).items.some(x=>x.id==='product-create'));
 for(const q of ['不要新增商品资料 VIVO S60','不需要新建商品 VIVO S60','暂不新建商品','取消新建商品 VIVO S60','查 VIVO S60 库存','今天卖了多少手机','打开商品调价'])assert.equal(create.isRequest(q),false,q);
});
test('建档走本地真实操作权限，不进入通用模型闲聊',async()=>{
 let calls=0;const client={configured:()=>true,hasContext:()=>false,request:async()=>{calls++;throw Error('must not call external chat')}};
 const reply=await chat.ask(store(),staff,{question:'帮我新建一个商品资料 VIVO S60 16+512'},{client});assert.equal(reply.action.draftKind,'product');assert.equal(calls,0);
});
const web=fs.readFileSync(require.resolve('../../web/assistant.js'),'utf8');
const featureCode=web.slice(web.indexOf('function openPendingFeature(){'),web.indexOf('function showConversationPair(){'));
function ui(action,overrides={}){
 const saved=new Map(),nav=[],nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:''});return nodes.get(id)};const state={assistantMode:'store',pendingAction:action,me:{id:staff.id,capabilities:{manageProducts:true}},assistantBranchId:'branch-001',assistantOrganizationReady:true,$:node,sessionStorage:{setItem:(k,v)=>saved.set(k,JSON.parse(v)),removeItem:k=>saved.delete(k)},stopVoiceSession(){},navigate:href=>nav.push(href),Date,...overrides};vm.runInNewContext(featureCode,state);return {state,saved,nav};
}
test('点击商品草稿动作只传白名单名称、当前账号门店和时间，不污染接待草稿',()=>{
 const action={type:'navigate',href:'/app?tab=products&new=1',draftKind:'product',ownerId:staff.id,prefill:{name:'VIVO S60 16+512',costPrice:1200,quantity:5,trackSerial:true}};
 const view=ui(action);assert.equal(view.state.openPendingFeature(),true);assert.deepEqual(view.saved.get('assistant-product-draft-v1').prefill,{name:'VIVO S60 16+512'});assert.equal(view.saved.get('assistant-product-draft-v1').ownerId,staff.id);assert.equal(view.saved.get('assistant-product-draft-v1').branchId,'branch-001');assert.ok(view.saved.get('assistant-product-draft-v1').createdAt>0);assert.equal(view.saved.has('erp-reception-draft-after-login-v1'),false);assert.deepEqual(view.nav,['/app?tab=products&new=1']);
});
test('商品动作跨账号、失权、顾客模式和异常地址不执行，原接待草稿功能保留',()=>{
 const action={type:'navigate',href:'/app?tab=products&new=1',draftKind:'product',ownerId:staff.id,prefill:{name:'VIVO S60'}};
 for(const [a,overrides] of [[{...action,ownerId:'other'},{}],[action,{me:{id:staff.id,capabilities:{manageProducts:false}}}],[action,{assistantMode:'customer'}],[{...action,href:'//evil.example/'},{}],[{...action,href:'/receptions'},{}]]){const view=ui(a,overrides);assert.equal(view.state.openPendingFeature(),false);assert.equal(view.saved.size,0);assert.equal(view.nav.length,0);}
 const view=ui({type:'navigate',href:'/receptions',prefill:{name:'张三',phone:'13800138000'}});assert.equal(view.state.openPendingFeature(),true);assert.equal(view.saved.get('erp-reception-draft-after-login-v1').name,'张三');
});
test('填销售单时建档可中断查询且命令匹配前后端一致，携带串号也不抢进销售流程',()=>{
 const classifierCode=web.slice(web.indexOf('function isProductCreateRequest('),web.indexOf('function isConversationTopic('));
 const context={window:{AssistantSaleInput:{statusQuery:()=>false,receptionRequest:()=>false}}};vm.runInNewContext(classifierCode,context);
 for(const q of ['新建商品 VIVO S60','帮我新建一个商品资料 VIVO S60 16+512','新增商品 VIVO S60，串号868123456789001','不要新增商品资料','新增ｃ仓商品 VIVO S60','不需要新建商品 VIVO S60'])assert.equal(context.isProductCreateRequest(q),create.isRequest(q),q);
 assert.equal(context.isFlowQuery('帮我新建一个商品资料 VIVO S60 16+512'),true);assert.match(web,/me\?\.capabilities\.sell&&!isProductCreateRequest\(q\)/);
});

test('明确移动商品或C仓才预填移动仓，并按YD名称识别已有档案',()=>{
 for(const question of ['帮我新建一个移动商品资料 VIVO S60 16+512','新增C仓商品 VIVO S60 16+512','新建移动公司的商品资料 VIVO S60 16+512']){
  const s=store(),reply=assistant.ask(s,staff,{question});assert.deepEqual(reply.action.prefill,{name:'VIVO S60 16+512',warehouseId:'wh-c'},question);
 }
 const other=assistant.ask(store(),staff,{question:'新建商品资料 VIVO S60 16+512，供货商：终端公司'});assert.deepEqual(other.action.prefill,{name:'VIVO S60 16+512'});
 const noMobile=assistant.ask(store(),staff,{question:'新建商品资料 VIVO S60 16+512，不放C仓'});assert.equal(noMobile.action.prefill.warehouseId,undefined);
 const s=store();s.products.push({skuId:'p-c',warehouseId:'wh-c',name:'VIVO S60 16+512（YD）'});const duplicate=assistant.ask(s,staff,{question:'新建C仓商品资料 VIVO S60 16+512'});assert.equal(duplicate.metrics.existing,true);assert.equal(duplicate.action.prefill,undefined);
 const good=ui({type:'navigate',href:'/app?tab=products&new=1',draftKind:'product',ownerId:staff.id,prefill:{name:'VIVO S60',warehouseId:'wh-c'}});assert.equal(good.state.openPendingFeature(),true);assert.equal(good.saved.get('assistant-product-draft-v1').prefill.warehouseId,'wh-c');
 const arbitrary=ui({type:'navigate',href:'/app?tab=products&new=1',draftKind:'product',ownerId:staff.id,prefill:{name:'VIVO S60',warehouseId:'wh-secret'}});arbitrary.state.openPendingFeature();assert.equal(arbitrary.saved.get('assistant-product-draft-v1').prefill.warehouseId,undefined);
});
test('真实ask函数携带串号的商品建档仍请求后台意图，暂停已有销售草稿',async()=>{
 const askCode=web.slice(web.indexOf('async function ask(q){'),web.indexOf("$('prepare-sale').onclick="));
 const classifierCode=web.slice(web.indexOf('function isProductCreateRequest('),web.indexOf('function isConversationTopic('));
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:true,textContent:'',replaceChildren(){},append(){}});return nodes.get(id)};
 const requests=[];let sales=0;
 const context={window:{AssistantSaleInput:require('../../web/assistant-sale-input')},$:node,assistantMode:'store',me:{id:staff.id,capabilities:{sell:true}},modeEpoch:0,queryVersion:0,conversationContext:null,saleSubmitting:false,saleFlow:{stage:'serial',request:'开销售单'},pausedSaleFlow:null,pendingAction:null,customerReplyStyle:'mandarin',voiceBusy:false,speaking:false,
  beginChatTurn(){},showPausedDraft(){},renderSaleWorkspace(){},isConversationTopic:()=>false,resetAnswerEditor(){},resetTariffExport(){},stopSpeech(){},pauseVoiceCapture(){},renderFollowups(){},renderEvidence(){},setAnswerEditable(){},setSpeechButtons(){},showConversationPair(){},resumeVoiceCapture(){},time:()=>'',replyStyle:()=>'',startSaleFlow:async()=>{sales++},openPendingFeature:()=>false,
  api:async(path,body)=>{requests.push({path,body});return {answer:'商品草稿',metrics:{kind:'product-draft'},action:{type:'navigate',draftKind:'product',href:'/app?tab=products&new=1',label:'核对商品'}}}
 };
 vm.runInNewContext(classifierCode+'\n'+askCode,context);await context.ask('新建商品资料 VIVO S60 16+512，串号868123456789001');
 assert.equal(sales,0);assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/assistant/ask');assert.match(requests[0].body.question,/新建商品资料/);assert.equal(context.saleFlow,null);assert.equal(context.pausedSaleFlow.request,'开销售单');assert.equal(context.pendingAction.draftKind,'product');assert.equal(node('action').hidden,false);
});

test('组织查询失败或多店缺失门店ID不允许生成商品预填草稿，正常单店允许空ID',async()=>{
 const code=web.slice(web.indexOf('async function loadAssistantOrganization(){'),web.indexOf('function openPendingFeature(){'));
 for(const [data,valid,branch] of [[{enabled:true,currentBranchId:'branch-001'},true,'branch-001'],[{enabled:false,storage:'sqlite'},true,''],[null,false,''],[{},false,''],[{enabled:true},false,''],[{enabled:true,currentBranchId:''},false,''],[{enabled:true,currentBranchId:123},false,''],[{enabled:'true',currentBranchId:'branch-001'},false,'']]){
  const state={assistantOrganizationReady:true,assistantBranchId:'old-branch',api:async()=>data};vm.runInNewContext(code,state);assert.equal(await state.loadAssistantOrganization(),valid,JSON.stringify(data));assert.equal(state.assistantOrganizationReady,valid,JSON.stringify(data));assert.equal(state.assistantBranchId,branch);
 }
 const failed={assistantOrganizationReady:true,assistantBranchId:'old-branch',api:async()=>{throw Error('network unavailable')}};vm.runInNewContext(code,failed);assert.equal(await failed.loadAssistantOrganization(),false);assert.equal(failed.assistantOrganizationReady,false);assert.equal(failed.assistantBranchId,'');
 const action={type:'navigate',href:'/app?tab=products&new=1',draftKind:'product',ownerId:staff.id,prefill:{name:'VIVO S60'}};
 const unavailable=ui(action,{assistantOrganizationReady:false,assistantBranchId:''});unavailable.saved.set('assistant-product-draft-v1',{prefill:{name:'Old unsafe draft'}});assert.equal(unavailable.state.openPendingFeature(),false);assert.equal(unavailable.saved.size,0);assert.equal(unavailable.nav.length,0);assert.equal(unavailable.state.pendingAction,null);assert.equal(unavailable.state.$('action').hidden,true);assert.match(unavailable.state.$('status').textContent,/门店信息未读取成功/);
 const single=ui(action,{assistantOrganizationReady:true,assistantBranchId:''});assert.equal(single.state.openPendingFeature(),true);assert.equal(single.saved.get('assistant-product-draft-v1').branchId,'');
});
test('说打开吧时组织尚未就绪安全关闭动作，不转成闲聊或再次请求',async()=>{
 const code=web.slice(web.indexOf('async function ask(q){'),web.indexOf("$('prepare-sale').onclick="));let called=0,requests=0;const state={pendingAction:{type:'navigate'},api:async()=>{requests++}};state.openPendingFeature=()=>{called++;state.pendingAction=null;return false};vm.runInNewContext(code,state);await state.ask('打开吧');assert.equal(called,1);assert.equal(requests,0);
});
