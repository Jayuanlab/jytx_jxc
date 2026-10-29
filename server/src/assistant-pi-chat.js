'use strict';

const c=require('./common');
const language=require('./assistant-language');
const tools=require('./assistant-agent-tools');

const toolUrl='http://127.0.0.1:'+(process.env.PI_PORT||3655);
const businessFacts=/门店|本店|公司|员工|营业员|在职|考勤|签到|签退|请假|工资|酬金|利润|毛利|销售|营业额|库存|商品|价格|资费|订单|单据|收款|付款|到账|采购|供应商|现金|微信|账户|接待|操作记录|国补|空充/;
const beijingTime=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
const clockContext=()=>({timeZone:'Asia/Shanghai',currentBeijing:beijingTime(Date.now()),rule:'今天、昨天、前天和截至时刻均按北京时间；工具 UTC 时间戳先换算为北京时间，不把 UTC 小时写成北京时间。'});
function normalizeCurrentTime(answer,clock){
  const today=clock.currentBeijing.slice(0,10),now=clock.currentBeijing.slice(11,16);
  return answer.replace(/截至\s*(?:北京时间\s*)?(?:(20\d{2}[-年]\d{1,2}[-月]\d{1,2}日?)\s*)?(\d{1,2}:\d{2})/g,(all,date)=>{
    if(date){const parsed=date.replace(/[年月]/g,'-').replace(/日$/,'').split('-').map((part,index)=>index?part.padStart(2,'0'):part).join('-');if(parsed!==today)return all;}
    return '截至北京时间 '+today+' '+now;
  });
}

async function callModel(path,body,token){
  const response=await fetch(toolUrl+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(24000)});
  if(!response.ok)throw Error('pi-http-'+response.status);
  return response.json();
}

function compact(result){
  const {domain,value}=result;
  if(domain==='staff.directory')return {domain,value:{...value,headCount:Array.isArray(value.names)?value.names.length:0}};
  if(domain==='platform.catalog')return {domain,value:{domains:value.domains.map(x=>({id:x.id,status:x.status}))}};
  if(domain==='documents.search'||domain==='inventory.search')return {domain,value:{query:value.query,counts:value.counts,results:Object.fromEntries(Object.entries(value.results||{}).map(([kind,rows])=>[kind,rows.slice(0,5)])),sources:value.sources}};
  if(domain==='reception.list')return {domain,value:{...value,rows:value.rows.slice(0,20)}};
  return result;
}

function evidenceFor(tool){
  const limit=12000;
  const rows=(tool.results||[]).map(row=>row.domain?compact({domain:row.domain,value:row.result}):row);
  const serialize=value=>JSON.stringify(value,(key,item)=>key==='asOf'&&typeof item==='string'&&!Number.isNaN(Date.parse(item))?'北京时间 '+beijingTime(item):item);
  let evidence=serialize({route:tool.route,clock:clockContext(),results:rows});
  if(evidence.length>limit)evidence=serialize({route:tool.route,clock:clockContext(),truncated:true,results:rows.map(row=>{
    if(row.domain==='sales.performance')return {domain:row.domain,value:{date:row.value.date,facts:row.value.facts,categoryStats:row.value.categoryStats}};
    if(row.domain==='sales.items')return {domain:row.domain,value:{date:row.value.date,saleOrderCount:row.value.saleOrderCount,itemGroupCount:row.value.itemGroupCount,items:row.value.items.slice(0,20),truncated:true}};
    if(row.domain==='sales.staff')return {domain:row.domain,value:{date:row.value.date,people:row.value.people.slice(0,20),profitStatus:row.value.profitStatus}};
    if(row.domain==='carrier.services')return {domain:row.domain,value:{...row.value,services:row.value.services.slice(0,15)}};
    if(row.kind==='authorized-feature-catalog')return {...row,items:row.items.slice(0,25)};
    return row;
  })});
  if(evidence.length>limit)throw Error('tool-evidence-too-long');
  return evidence;
}

function validateNumbers(question,evidence,answer){
  const supported=new Set(((question+' '+evidence).match(/\d+(?:\.\d+)?/g)||[]).map(Number));
  const numbers=answer.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'').replace(/^\s*(?:\*\*)?\d+[.．](?:\*\*)?\s+/gm,'').match(/\d+(?:\.\d+)?/g)||[];
  if(numbers.some(value=>!supported.has(Number(value))))throw Error('pi-unsupported-number');
}

function sourcesFor(tool){return [...new Map((tool.sources||[]).filter(x=>x?.href).map(x=>[x.href,x])).values()];}

async function answer(store,user,question,history,plan,token,ruleMemory,context,phoneQuestion=question){
  const tool=await tools.run(store,user,plan,phoneQuestion,ruleMemory,context);
  const sources=sourcesFor(tool),domains=tool.domains||[];
  if(tool.route==='screen.edit'){
    const preview=tool.screenReply,hint=preview.conversationHint;
    const nextContext={question,topicQuestion:'电子屏内容',userId:user.id,at:Date.now(),mode:'store',...(hint?.topic==='screen'?{screen:{id:hint.id||null,revision:Number.isSafeInteger(hint.revision)?hint.revision:null,draftContent:String(hint.draftContent||'').slice(0,500)}}:{})};
    if(preview.action?.payload?.content)validateNumbers(question,String(context?.screen?.draftContent||'')+' '+String(preview.action?.before?.content||''),preview.action.payload.content);
    return {answer:preview.answer,mode:'store',asOf:c.now(),sources,followups:[],context:nextContext,
      ...(preview.action?{action:preview.action}:{}),metrics:{...preview.metrics,agentTool:'screen.edit',provider:plan.provider,model:plan.model},
      piAgent:{status:'connected',route:'agent-tool',tool:'screen.edit'}};
  }
  if(tool.protectedReply?.metrics?.kind==='active-rule-authority'){
    // A sealed current rule is authoritative even if model wording differs.
    return {...tool.protectedReply,mode:'store',piAgent:{status:'connected',route:'agent-tool',tool:'knowledge.lookup'},metrics:{...tool.protectedReply.metrics,agentTool:'knowledge.lookup'}};
  }
  const restricted=(tool.results||[]).filter(x=>x.result?.restricted);
  if(restricted.length&&restricted.length===tool.results.length)return {answer:restricted.map(x=>x.result.reason||x.result.answer||'当前账号无权查看此项数据。').join('\n'),mode:'store',sources:[],followups:[],unresolved:false,metrics:{kind:'agent-tool',restricted:true,agentTool:tool.route,domains},piAgent:{status:'connected',route:'agent-tool',tool:tool.route}};
  if(tool.route==='phone.parameters'){
    const value=tool.results[0],specs=require('./assistant-phone-spec-tool'),records=value.records||[];
    const text=records.length?records.map(r=>specs.render(r,question,true)).join('\n\n')+'\n电池容量不是实测续航，不能据此保证三天待机；本店售价和现货另按ERP查询。':value.reason;
    return {answer:text,mode:'store',asOf:c.now(),sources,followups:[],unresolved:!records.some(r=>r.status==='ok'),context:{question,topicQuestion:question,userId:user.id,at:Date.now(),mode:'store',phoneSpecifications:{models:(value.targets||[]).map(t=>t.displayName)}},metrics:{kind:'phone-specifications',phoneSpecifications:true,agentTool:tool.route,provider:plan.provider,model:plan.model,cache:records.map(r=>r.cache),statuses:records.map(r=>r.status)},piAgent:{status:'connected',route:'agent-tool',tool:tool.route}};
  }
  let phone=tool.results?.find(x=>x.domain==='inventory.recommend')?.result;
  if(domains.length===1&&domains[0]==='inventory.recommend'&&phone&&!phone.restricted){
    const specs=require('./assistant-phone-spec-tool');phone=await specs.enrich(phone,user,phoneQuestion);
    const talk=require('./assistant-phone-talk'),speech=talk.requested(question)?talk.build(phone,phoneQuestion,store):null;
    // Verified retail fields are rendered directly. The model selects the tool;
    // it cannot turn a truncated accessory search into “no phones”, invent
    // hardware benefits, or turn a small stock count into pressure to buy.
    const label=phone.brands?.join('、')||'手机',count=phone.counts;
    const scope=phone.models?.length?'按你指定的型号':'按本次品牌及整机条件';
    let text=count.availableQuantity?`${scope}，有${label}可售现货 ${count.availableQuantity} 台，共 ${count.availableVersions} 个商品版本。`:`${scope}，暂未查到可售现货；这不表示全店没有其他手机。`;
    if(phone.rows.length){
      const b=phone.budget;
      text+=b?.kind==='approximate'?`你说的 ${b.target} 元左右，可以先比较：`:b?.kind==='maximum'?`在 ${b.maximum} 元以内，可以看：`:'先看当前零售价较低的几款：';
      text+=phone.rows.map(x=>`${x.name}，${x.salePrice} 元，可售 ${x.availableQuantity} 台${b?.kind==='approximate'&&x.salePrice>b.target?'（高于你说的目标价，需你愿意再考虑）':''}。${x.configuration?'参数：'+x.configuration+'。资料于'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short'}).format(new Date(x.phoneSpecification.fetchedAt))+'核对。': '本次尚未取得可核实的配置资料。'}`).join('\n');
      if(/待机|续航|电池|屏幕|拍照|游戏|老年|老人|长辈/.test(question))text+='电池容量不等于实测续航，不能保证能用几天；长辈使用可以现场试字体和音量。';
      if(phone.specifications?.some(r=>r.status==='ok'))text+='参数来源和核对日期已保存，本店价格、数量仍以当前ERP为准。';
      if(!speech)text+='你想先了解哪款？';
    }else if(count.unpricedVersions)text+='其中有未标零售价的手机，请店员先核价。';
    else if(count.availableQuantity)text+='这个预算条件内暂未查到已标价现货，可以调整预算或请店员核对订货。';
    const onlySpeech=!!speech&&/(?:只要|只给|只说|只写).{0,5}话术|不要.{0,4}(?:参数|清单)/.test(question);
    if(speech){const facts=text,wantsSpecs=!onlySpeech&&/参数|配置|详细数据/.test(question)&&!/(?:不要|不报|少报).{0,5}(?:参数|配置|数据)/.test(question);text='给顾客的推荐话术（可以直接这样说）：\n“'+speech.text+'”'+(wantsSpecs?'\n\n选款资料：\n'+facts:'');}
    return {answer:text,mode:'store',asOf:phone.asOf,sources:phone.sources||[],followups:[],unresolved:false,context:{question,topicQuestion:phoneQuestion,userId:user.id,at:Date.now(),mode:'store',phoneSpecifications:{models:phone.rows.map(p=>p.name)},phoneRecommendation:{question:phoneQuestion}},
      table:phone.rows.length&&!onlySpeech?{title:'手机现货与当前零售价',columns:[{key:'name',label:'手机型号'},{key:'salePrice',label:'零售价（元）'},{key:'availableQuantity',label:'可售数量'}],rows:phone.rows.map(({name,salePrice,availableQuantity})=>({name,salePrice,availableQuantity}))}:undefined,
      metrics:{kind:'phone-recommendations',phoneSpecifications:true,customerSpeech:!!speech,speechSkuId:speech?.skuId||null,agentTool:tool.route,domains,provider:plan.provider,model:plan.model,evidenceRendered:true,matchedVersions:count.matchingVersions,availableQuantity:count.availableQuantity,cache:phone.specifications?.map(r=>r.cache),specificationStatuses:phone.specifications?.map(r=>r.status)},piAgent:{status:'connected',route:'agent-tool',tool:tool.route}};
  }
  const warehouseResult=tool.results?.find(x=>x.domain==='inventory.warehouses')?.result;
  if(domains.length===1&&domains[0]==='inventory.warehouses'&&warehouseResult&&!warehouseResult.restricted&&/(?:有哪些|有哪|名称|几个|多少个|列出|名单)/.test(question)){
    const names=warehouseResult.warehouses.map(row=>row.name);
    if(names.length===warehouseResult.count&&names.every(Boolean))return {answer:`库存模块登记 ${names.length} 个仓库：${names.join('、')}。`,mode:'store',asOf:warehouseResult.asOf,sources,followups:[],unresolved:false,
      metrics:{kind:'agent-tool',agentTool:tool.route,domains,provider:plan.provider,model:plan.model,evidenceRendered:true},
      piAgent:{status:'connected',route:'agent-tool',tool:tool.route}};
  }
  if(tool.route==='conversation.reply'&&businessFacts.test(question))return {answer:'这个问题涉及门店事实，但本次没有选到可核实的数据工具。请补充具体对象或日期后重试。',mode:'store',sources:[],followups:[],unresolved:true,metrics:{kind:'agent-tool-selection',agentTool:tool.route},piAgent:{status:'degraded',reason:'business-tool-not-selected'}};
  const evidence=evidenceFor(tool);
  const clock=clockContext(),request={question,history,local:{mode:'store',answer:evidence,unresolved:false,sources,toolEvidence:true,dataQueryEvidence:tool.route==='data.query',clock}};
  let data=await callModel('/grounded-reply',request,token);
  if(data?.reply?.piAgent?.route!=='agent'||!String(data?.reply?.answer||'').trim())data=await callModel('/grounded-reply',request,token);
  const reply=normalizeCurrentTime(String(data?.reply?.answer||'').trim(),clock);
  if(data?.reply?.piAgent?.route!=='agent'||!reply)throw Error('pi-empty-answer');
  validateNumbers(question,evidence,reply);
  return {answer:reply,mode:'store',asOf:c.now(),sources,followups:[],unresolved:false,
    ...(tool.action?{action:tool.action}:{}),metrics:{kind:'agent-tool',agentTool:tool.route,domains,provider:plan.provider,model:plan.model},
    piAgent:{status:'connected',route:'agent-tool',tool:tool.route}};
}

async function agentAsk(store,user,payload,options={}){
  if(payload.mode==='customer'||user.assistantCustomerOnly||['customer-assistant','personal-assistant'].includes(user.roleCode))
    return require('./assistant-chat').ask(store,user,payload,options);
  const question=language.normalize(String(payload.question||'').trim()),history=Array.isArray(payload.history)?payload.history.slice(-8):[];
  const token=process.env.PI_INTERNAL_TOKEN;
  if(!token)return {answer:'工作助理暂时无法连接智能体。',mode:'store',sources:[],followups:[],unresolved:true,metrics:{kind:'agent-unavailable'},piAgent:{status:'unavailable',reason:'not-configured'}};
  const screenContext=payload.context?.userId===user.id&&payload.context?.mode==='store'&&Number.isFinite(payload.context?.at)&&Date.now()-payload.context.at<86400000&&payload.context.at<=Date.now()+60000&&payload.context?.screen;
  if(!/电子屏|轮播|上屏/.test(question)&&!(screenContext&&/这版|正文|草稿|笑话|精简|修改|采用|换一|再来/.test(question))){
    const talk=require('./assistant-phone-talk'),continued=talk.continuation(question,payload.context,user);
    const officeQuestion=continued?continued+'\n本轮补充要求：'+question:question;
    try{return await require('./assistant-office.cjs').ask(store,user,{...payload,question:officeQuestion});}
    catch(error){return require('./assistant-office-resolution.cjs').failure(error);}
  }
  const features=require('./assistant-capabilities').catalog(store,user).items.map(({id,label})=>({id,label}));
  let plan,phoneQuestion=question;
  try{
    plan=await callModel('/work-plan',{question:question.slice(0,1000),history,features,clock:clockContext()},token);
    if(!tools.routes.includes(plan.route))plan=await callModel('/work-plan',{question:question.slice(0,1000),history,features,clock:clockContext()},token);
    if(!tools.routes.includes(plan.route))throw Error('pi-invalid-plan');
    // Purchase advice needs the structured whole-phone reader. A generic keyword
    // search can return screens first or miss “华为手机” as a single phrase.
    const specTool=require('./assistant-phone-spec-tool'),talk=require('./assistant-phone-talk'),phoneIntent=require('./assistant-phone-recommend').intent;
    if(!phoneIntent(question))phoneQuestion=talk.continuation(question,payload.context,user)||question;
    if(phoneIntent(phoneQuestion)){
      const named=specTool.choose(store,user,{modelName:plan.args?.modelName||plan.args?.keyword},phoneQuestion,payload.context),identity=require('./phone-spec-web').identity;
      const knownKeys=new Set((store.products||[]).filter(p=>/^(智能机|智能手机|功能机|按键机|老人机)$/.test(p.type||'')).map(p=>identity(p.name,p.brand||p.subType)?.key));
      plan=named.length&&named.every(id=>!knownKeys.has(id.key))?{...plan,route:'phone.parameters',args:{modelName:named[0].displayName}}:{...plan,route:'data.query',args:{domains:['inventory.recommend']}};
    }else if(specTool.parameterIntent(question))plan={...plan,route:'phone.parameters',args:{modelName:plan.args?.modelName||plan.args?.keyword||''}};
  }catch(error){return {answer:'智能体暂时无法选择查询工具，请稍后重试。',mode:'store',sources:[],followups:[],unresolved:true,metrics:{kind:'agent-unavailable'},piAgent:{status:'unavailable',reason:String(error.message||'plan-failed').slice(0,80)}};}
  try{return await answer(store,user,question,history,plan,token,payload.ruleMemory,payload.context,phoneQuestion);}
  catch(error){return {answer:'智能体暂时无法根据本次查询生成可靠回答，请打开相关业务页面核对。',mode:'store',sources:[],followups:[],unresolved:true,metrics:{kind:'agent-tool-error',agentTool:plan.route},piAgent:{status:'degraded',reason:String(error.message||'answer-failed').slice(0,80)}};}
}

module.exports={agentAsk,evidenceFor,validateNumbers,normalizeCurrentTime,clockContext};
