'use strict';
const fs=require('fs'),path=require('path'),resolution=require('./assistant-office-resolution.cjs');
const root=__dirname,live=n=>require('./'+n),guards=require('./assistant-office-guards.cjs');
const prompts=Object.fromEntries(['common','planner','answer'].map(k=>[k,fs.readFileSync(path.join(root,'assistant-office-'+k+'.txt'),'utf8')]));
const cashReportRule='\n即时现金清点和晚上正式扎账按实际提交人分派核对待办，不依据当班记录；老板只收到未查看报告条数并可查看原报数、核对人、差异及处理说明；这两类不属于老板审核待办。已查看不等于实物已核对，差额待查不能写成已处理完。早上清点和交接班保留现行审核流程。销售现金待交的工作台工作助理提醒只显示给原经办营业员；老板首页只显示员工待办条数，老板可按权限主动查询原单与处理人。';
function checkedAnswer(response,schema,plan,evidence,context){try{const {generation,...contract}=response;guards.check(schema,contract);return guards.answerErrors(response,plan,evidence,context);}catch{return ['回答结构不符合要求'];}}
function completeStatus(response,evidence){const {generation,...contract}=response;return {...contract,completedTaskIds:evidence.filter(e=>e.status==='ok').map(e=>e.taskId),remainingTaskIds:evidence.filter(e=>e.status!=='ok').map(e=>e.taskId)};}
function renderVerifiedKnowledge(evidence){const parts=evidence.filter(e=>e.tool==='knowledge_lookup'&&e.status==='ok').flatMap(e=>e.data?.results||[]).filter(r=>r.answer).map(r=>(r.kind==='protected-rule'?'现行规则：':'资料要点（培训建议，具体办理仍核现行政策）：')+String.fromCharCode(10)+r.answer);const entries=evidence.filter(e=>e.tool==='workflow_lookup'&&e.status==='ok').flatMap(e=>e.data?.results||[]).flatMap(r=>r.items||[]);if(entries.length)parts.push('查看入口：'+entries.map(e=>e.label+' '+e.href).join('；'));const missing=evidence.filter(e=>e.status!=='ok');if(missing.length)parts.push('未完成：'+missing.map(e=>e.reason||'该项资料尚待核实').join('；'));const result=completeStatus({answer:parts.join(String.fromCharCode(10,10)).slice(0,950),evidenceIds:evidence.filter(e=>e.status==='ok').map(e=>e.evidenceId)},evidence);result.generation={mode:'verified-knowledge-renderer',source:'本次授权且有效的知识或独立现行规则原文摘要'};return result;}
function renderVerifiedPhone(phone,evidence,question,store){const response=verifiedPhoneReply(phone,evidence,question,store);response.generation={mode:'verified-phone-renderer',source:'现行已核实重庆手机话术规则，按本次真实查询渲染'};const only=/(?:只要|只给|只说|只写).{0,5}话术/.test(question);if(!only&&/参数|配置|详细数据/.test(question)&&!/(?:不要|不报|少报).{0,5}(?:参数|配置|数据)/.test(question))response.answer+='\n\n配置核对：\n'+evidence.flatMap(e=>e.data?.records||[]).map(r=>live('assistant-phone-spec-tool').render(r,question,false)).join('\n');return response;}
function historyFor(payload,user){const c=payload.context;if(!c||c.userId!==user.id||c.mode!=='store'||!Number.isFinite(c.at)||Date.now()-c.at>86400000||c.at>Date.now()+60000)return [];return (Array.isArray(payload.history)?payload.history:[]).slice(-8).filter(h=>typeof h.question==='string'&&typeof h.answer==='string').map(h=>({question:h.question.slice(0,240),answer:h.answer.slice(0,400)}));}
function cashReceiptAnswer(store,user,question){
 if(!/(?:收款原单|收款单号|\bSK-\d{6}-\d+\b|哪张\s*SK)/i.test(question)||!/(?:现金|待交|入库|销售|收款)/.test(question))return null;
 const visible=live('assistant-cash-reminders').list(store,user);
 const wanted=(question.match(/\bSK-\d{6}-\d+\b/i)||[])[0]?.toUpperCase();
 const named=user.roleCode==='owner'?(store.users||[]).find(person=>person.roleCode!=='owner'&&person.name&&question.includes(person.name))?.name:null;
 const rows=visible.filter(row=>(!wanted||row.receiptNos?.includes(wanted))&&(!named||row.handler===named));
 const answer=rows.length?'当前仍待交入门店现金的收款单：'+rows.map(row=>`${user.roleCode==='owner'?row.handler+' · ':''}${row.receiptNos?.length?row.receiptNos.join('、')+'（SK 收款单展示号）':'收款单展示号尚待核对'}，关联销售单 ${row.orderId}（SO 原编号），金额 ${Number(row.amount).toFixed(2)} 元，状态“${row.status}”`).join('；')+'。请核对现金实际去向，在收款核对页办理或登记差异；查看提醒不等于完成交接。':'当前账号授权范围内没有查到相应的待交收款单；不能据此判断其他人名下的单据已经交清。';
 return {answer,mode:'store',sources:rows.map(row=>({label:row.receiptNos?.length?'收款单 '+row.receiptNos.join('、'):'销售收款核对',href:row.href})),followups:[],unresolved:false,metrics:{kind:'office-cash-receipt',version:'sk-so-distinct-v1',modelCalls:0},piAgent:{status:'connected',route:'verified-erp-projection'}};
}
function bayuEntryAnswer(store,user,question){
 const q=String(question||'');
 if(!/巴渝卡|惠巴渝|新办卡组合/.test(q)||!/在哪|哪里|入口|怎么(?:办|进|申请)|如何(?:办|进|申请)|去哪|找不到/.test(q))return null;
 const features=live('assistant-capabilities').catalog(store,user).items;
 const bundle=features.find(item=>item.id==='mobile-card-bundles');
 if(!bundle)return {answer:'当前账号没有新办卡组合办理的权限，请由有权限的经办人办理。',mode:'store',sources:[],followups:[],unresolved:false,metrics:{kind:'office-bayu-entry',allowed:false,modelCalls:0},piAgent:{status:'connected',route:'verified-function-directory'}};
 const packet=features.find(item=>item.id==='red-packet-request');
 return {answer:'工作台“移动业务”列表里可直接选择“新办卡组合办理”；如果再点列表里的“移动业务”，会先显示“新办卡组合办理（含红包申请）”和“普通移动业务与酬金”，选定后才进入。巴渝卡坐扣组合在一张组合单中逐项确认新卡、承诺套餐、惠巴渝1元档和终端券，并登记顾客实收。提交后自动生成本单营业员红包申请；红包待老板核定，申请不代表已经发放。普通业务的红包按原单到“红包申请”办理。',mode:'store',sources:[{label:bundle.label,href:bundle.href},...(packet?[{label:packet.label,href:packet.href}]:[])],followups:[],unresolved:false,action:{type:'navigate',label:'打开'+bundle.label,href:bundle.href},metrics:{kind:'office-bayu-entry',allowed:true,modelCalls:0},piAgent:{status:'connected',route:'verified-function-directory'}};
}
function currentPendingAnswer(store,user,question){
 const orderId=(question.match(/\bSO-\d{6}-\d{4}\b/i)||[])[0]||'';
 const asksPending=/待办|待我处理|未处理/.test(question)&&/多少|几条|几笔|现在|当前|还有|哪些|什么|查|看/.test(question);
 const asksCash=!!orderId&&/现金|挂账|挂在|责任|销挂|清责/.test(question);
 if(!asksPending&&!asksCash)return null;
 const state=live('air-funding-orders').workbench(store,user,live('air-history-pending').workbench(store,user,live('workbench').summary(store,user)));
 const parts=[],sources=[];
 if(asksPending){
  parts.push(`工作台当前显示：本人待办 ${Number(state.pendingCount||0)} 条${user.roleCode==='owner'?`，营业员未处理 ${Number(state.waitingOnOthersCount||0)} 条`:''}。`);
  if(/哪些|什么|营业员/.test(question)&&user.roleCode==='owner'&&state.waitingOnOthers?.length)parts.push('营业员分组：'+state.waitingOnOthers.map(x=>`${x.person} ${x.count} 条`).join('；')+'。');
  if(user.roleCode==='owner'){
   const tasks=live('boss-overview').summary(store,user).tasks||[];
   const items=tasks.flatMap(task=>(task.items||[]).map(row=>({task:task.label,...row}))).slice(0,8);
   if(items.length)parts.push('本人待办明细：'+items.map(row=>`${row.documentNo||row.id}，${row.task}，${row.sub||''}`).join('；')+'。');
   for(const row of items)sources.push({label:row.documentNo||row.label,href:row.actionHref||row.href});
   if(state.reports?.simpleDailyClose?.totalCount){parts.push(`今日门店扎账报告 ${state.reports.simpleDailyClose.totalCount} 条，未查看 ${state.reports.simpleDailyClose.count} 条；即时现金清点和晚上正式扎账只作报告消息，由实际提交人现场核对，老板查看不代表审核或实物确认。`);sources.push({label:'门店扎账报告',href:'/simple-daily-close?view=reports'});}
   const special=live('pending-special').list(store,user);if(special.rows.length&&/处理不了|卡|旧|原因|特别|管家/.test(question)){parts.push(`有 ${special.rows.length} 张可由老板逐单核对后特别处理的旧复核或现金零差额报数；旧期初和原差额会保留。`);sources.push({label:'老板特别处理',href:'/pending-special'});}
  }
  const namedHandler=user.roleCode==='owner'?(store.users||[]).find(person=>person.roleCode!=='owner'&&person.name&&String(question).includes(person.name))?.name:null;
  const cashRows=(state.assistantCashReminders||[]).filter(row=>!namedHandler||row.handler===namedHandler);
  if(cashRows.length){parts.push('工作助理现金待交提醒：'+cashRows.slice(0,8).map(row=>`${user.roleCode==='owner'?row.handler+' · ':''}${row.receiptNos?.length?'收款单 '+row.receiptNos.join('、')+'，关联销售单 '+row.orderId:'销售单 '+row.orderId+' 的收款待核'}，已登记收到顾客现金 ${Number(row.amount).toFixed(2)} 元，系统尚未记录交入门店现金，待本人核对实际去向`).join('；')+'。');for(const row of cashRows.slice(0,8))sources.push({label:row.receiptNos?.length?'收款单 '+row.receiptNos.join('、'):'销售单收款核对 '+row.orderId,href:row.href});}
  if(user.roleCode!=='owner'&&state.simpleToCheck){const rows=live('simple-daily-close').list(store,user,{date:require('./common').day()}).filter(row=>row.canCheck&&!row.checkedAt);if(rows.length){parts.push('本人扎账核对待办：'+rows.slice(0,8).map(row=>`${row.displayNo}（${row.stageName}，实际提交人 ${row.ownerRecorded?row.actualCounterName:row.cashier}）`).join('；')+'。');sources.push({label:'当日扎账单',href:'/simple-daily-close'});}}
  parts.push('逐笔处理以工作台待办原单为准。');sources.push({label:'工作台待办',href:'/m#pending'});
 }
 if(asksCash){
  const rows=live('sale-fund-responsibility').project(store).filter(x=>x.orderId===orderId&&(user.roleCode==='owner'||x.operatorId===user.id));
  if(!rows.length)parts.push(`${orderId}：当前账号没有可核实的销售资金责任分笔。`);
  else for(const row of rows.filter(x=>x.cash)){
   parts.push(`${orderId} 的原销售经办人是 ${row.operator}；该现金分笔 ${row.amount} 元，${row.pendingAmount===0?'营业员现金经办责任已清，当前待交待核 0 元':`仍待交待核 ${row.pendingAmount} 元`}。销售经办归属与现金责任是两种口径。`);
   sources.push({label:'销售资金责任原单',href:row.href});
  }
 }
 return {answer:parts.join('\n'),mode:'store',sources,followups:[],unresolved:false,
  context:{question,topicQuestion:question,userId:user.id,at:Date.now(),mode:'store'},
  metrics:{kind:'office-current-pending',version:'shared-store-cash-v1',modelCalls:0},piAgent:{status:'connected',route:'verified-erp-projection'}};
}
function currentReconciliationAnswer(store,user,question){
 const match=String(question||'').match(/\b(?:(?:EX|BR|RC|MB)-[A-Za-z0-9-]{12,}|YW-\d{6}-\d{3})\b/i);
 if(!match||!/对账|核对|核实|流水|原单|费用单|款项|待核|酬金|返还|返款/.test(question))return null;
 const id=match[0],view=live('normal-workflow').dashboard(store,user),business=view.business.rows.find(row=>row.id===id||row.sourceId===id||row.originalDocument?.displayNo===id),money=view.money.rows.filter(row=>row.receiptId===id||business&&row.sourceId===business.sourceId);
 const sources=[];
 if(!business&&!money.length)return {answer:'当前账号的授权范围内未找到 '+id+' 对应的业务对账或账户核实记录。请核对单号与当前门店，不能据此认定原单不存在或款项已完成。',mode:'store',sources,followups:[],unresolved:true,metrics:{kind:'office-normal-workflow',version:'read-only-v1',modelCalls:0},piAgent:{status:'connected',route:'verified-erp-projection'}};
 const lines=[];
 if(business){
 const original=business.originalDocument;
 lines.push('原单 '+(original?.businessName||business.facts.label)+' '+(original?.displayNo||business.sourceId)+'；业务状态：'+business.statusLabel+'。');
 if(original?.available){
  lines.push('办理日期：'+(original.carrier?.businessDate||original.businessDate||'未填写')+'；经办人：'+(original.carrier?.employeeName||original.recordedByName||'未填写')+'。');
  if(original.carrier){const record=original.carrier;
   if(record.expectedCommissionTotal!=null)lines.push('预计总酬金：'+Number(record.expectedCommissionTotal).toFixed(2)+'元；具体产品：'+record.productName+'。');
   if(record.schedule.length)lines.push('预计返还计划：'+record.schedule.map(p=>p.month+' '+Number(p.expected).toFixed(2)+'元（移动确认：'+(p.confirmed==null?'待结算单':Number(p.confirmed).toFixed(2)+'元')+'；已登记到账：'+(p.received==null?'未登记':Number(p.received).toFixed(2)+'元')+'）').join('；')+'。');
   lines.push('移动业务名称：'+record.businessName+'；原填移动系统业务编号：'+(record.externalOrderNo||'未填写')+'；原填关联销售单号：'+(record.reference||'未填写')+'。');
   lines.push('酬金规则：'+(record.commissionRuleStatus||'未填写')+'；'+(record.hasCommissionPlan?'原单有逐月酬金计划，具体结算与到账仍须按月核对。':record.expectedCommissionTotal!=null?'基础酬金总额已知，但原清单未写返期；返还月份待核实，不能认定已结清。':'原单未建立逐月酬金计划，预计酬金、结算和到账仍待核实，不能按0元认定已结清。'));
   lines.push('备注：'+(record.note||'未填写')+'。');
  }
 }else lines.push('未取到原单内容，请核对原单；不能据此认定业务完整。');
sources.push({label:'业务对账原单',href:'/business-reconciliation?id='+encodeURIComponent(business.id)});if(business.sourceHref)sources.push({label:'完整业务原单',href:business.sourceHref});}
 if(money.length){for(const row of money){const account=row.accountScope==='store'&&row.account==='微信'&&row.accountName==='信号机微信'?'门店微信':row.accountName||row.account||'账户';lines.push('关联流水 '+row.receiptId+'；'+account+'；账面登记 '+Number(row.reportedAmount||0).toFixed(2)+' 元，已核 '+Number(row.verifiedAmount||0).toFixed(2)+' 元，待核 '+Number(row.unverifiedAmount||0).toFixed(2)+' 元；状态：'+row.statusLabel+'。');sources.push({label:'账户核实流水',href:'/business-reconciliation?id=money-'+encodeURIComponent(row.receiptId)+(business?'&from='+encodeURIComponent(business.id):'')});}}
 const pending=money.filter(row=>row.unverifiedAmount>0||row.status==='disputed');
 if(pending.length)lines.push(pending.some(row=>row.canVerify)?'下一步：当前登录账号有权打开相应账户核实流水，核对真实收付及凭据后再操作；业务已核对不代表款项已核实。':'下一步：当前登录账号不能核实这些款项，应交由该账户有权限的核对人核对真实收付；业务已核对不代表款项已核实。');
 else if(money.length)lines.push('当前可见关联流水没有待核金额；是否完成仍以每笔账户核实记录为准。');
 else lines.push('当前授权投影没有显示关联流水，不能推断款项已经核实。');
 lines.push('本次只读查询，未确认、付款或修改原单。');
 return {answer:lines.join('\n'),mode:'store',asOf:live('common').now(),sources,followups:[],unresolved:!business||!money.length,context:{question,topicQuestion:question,userId:user.id,at:Date.now(),mode:'store'},metrics:{kind:'office-normal-workflow',version:'read-only-v1',modelCalls:0,domains:['normal-workflow'],taskStatuses:[{id:'normal-workflow',tool:'authorized-projection',status:'ok'}]},piAgent:{status:'connected',route:'verified-erp-projection'}};
}
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},bool={type:'boolean'},oneOf=values=>({type:'string',enum:values});
const keys=['products','inventory','sales','saleReturns','receipts','otherIncome','expenses','cashHandovers','fundTransfers','storeCashWalletTransfers','carrierServices','dailyCloseouts','storeAnnouncements','suppliers','users','employeeKnowledge','receptions'];
function registry(store,user){
 const features=live('assistant-capabilities').catalog(store,user).items.map(({id,label,description,href,mode})=>({id,label,description,href,mode}));
 const caps=live('common').capabilities(user);
 const all=[...(features.some(feature=>feature.id==='my-finance')?['finance.mine']:[]),...(caps.sell?['finance.business-change','finance.store-wallet']:[]),'sales.performance','sales.items','sales.staff','sales.cash-pending','carrier.services','staff.directory','staff.attendance','inventory.warehouses','inventory.search','inventory.recommend','documents.search','platform.catalog',...(caps.finance?['finance.accounts']:[])];
 const draftFeatures=features.filter(f=>/销售填单|接待/.test(f.label)&&/draft/.test(f.mode)).map(f=>f.id);
 const tools={
 supplier_exchanges:{description:'只读查询当前账号有权查看的供货商换货单、换出换回商品、未收数量、差价及实际库存流水。不能替代批准、交货、验收或付款。',schema:object({query:str},[])},
 supplier_outbound_tracking:{description:'只读查询当前账号有权查看的供货商调货原单、未结额、约定原话和已确认到期时间。未经确认的备注不算确定日期；不能替代实收款或验货。',schema:object({query:str},[])},
 data_query:{description:'查询当前账号可见的业务数据；单日口径，不能提交。库存检索需具体query。',schema:object({domain:oneOf(all),query:str,date:str},['domain','query'])},
 phone_parameter_coverage:{description:'只读核对当前明确型号或有效同账号前文机型的已存参数覆盖情况，返回具体缺项，不联网不写缓存。',schema:object({})},
 phone_parameters:{description:'核对手机参数并保存有效缓存。推荐后设置fromDependencies=true读取依赖的具体手机。',schema:object({fromDependencies:bool,modelName:str},['fromDependencies'])},
 knowledge_lookup:{description:'查现行独立规则和经核实知识；无匹配明确告知。',schema:object({query:str})},
 workflow_lookup:{description:'仅返回实际授权功能入口，不执行该功能。',schema:object({featureId:oneOf(features.map(f=>f.id))})},
 pending_tasks:{description:'查当前人员职责待办；营业员限本人，老板可查授权全店。',schema:object({scope:oneOf(caps.allSales?['self','all']:['self'])})},
 evidence_lookup:{description:'按具体单号串号关键词查可见业务凭据；非全量导出。',schema:object({query:str})},
 comparison_prepare:{description:'只比较依赖中取得的具体手机，后台计算差价及可核实配置关系。',schema:object({})},
 answer:{description:'组织前置证据回答，无业务调用。',schema:object({})},
 unsupported:{description:'标明未接通或禁止执行的任务，不执行。',schema:object({reason:str})},
 clarification:{description:'无法确定必要对象时提出简短问题。',schema:object({question:str})}
 };
 if(draftFeatures.length)tools.draft_prepare={description:'仅当前会话草稿，无保存提交能力。销售草稿必须先查真实商品，接待草稿仅整理用户口述。',schema:object({featureId:oneOf(draftFeatures),content:str})};
 return {features,tools:structuredClone(tools),caps};
}
function validatePlan(plan,reg){
 return guards.validatePlan(plan,reg);
}
const planSchema=reg=>object({goal:str,audience:oneOf(['employee','customer']),tasks:{type:'array',minItems:1,maxItems:8,items:{anyOf:Object.entries(reg.tools).map(([name,meta])=>object({id:str,purpose:str,tool:oneOf([name]),arguments:meta.schema,dependsOn:{type:'array',maxItems:8,items:str}}))}},missingInformation:{type:'array',maxItems:6,items:str}});
const answerSchema=object({answer:str,completedTaskIds:{type:'array',items:str},remainingTaskIds:{type:'array',items:str},evidenceIds:{type:'array',items:str}});
async function call(stage,system,input,schema,trace){
 const started=Date.now();
 const res=await fetch('http://127.0.0.1:'+(process.env.PI_PORT||3655)+'/office-stage',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.PI_INTERNAL_TOKEN},body:JSON.stringify({stage,system,input,schema}),signal:AbortSignal.timeout(65000)});
 if(!res.ok)throw Error('office-model-http-'+res.status);
 const data=await res.json();if(!data.output)throw Error('office-model-empty');trace.push({stage,elapsedMs:Date.now()-started,model:data.model});return data.output;
}
function rowsFrom(dependencies){return dependencies.flatMap(e=>e.data?.result?.rows||e.data?.rows||[]);}
function publicSpecs(record){return {displayName:record.displayName,status:record.status,cache:record.cache,fetchedAt:record.fetchedAt,fields:live('assistant-phone-spec-tool').fields(record),sources:record.sources,conflicts:record.conflicts};}
async function executeTask(t,store,user,reg,done,clock,{forceFailure,originalQuestion,ruleMemory,phoneTargets=[]}={}){
 const start=Date.now(),e={taskId:t.id,evidenceId:'E-'+t.id,tool:t.tool,status:'ok',asOf:clock.beijing,scope:user.roleCode==='owner'?'当前门店授权范围':'当前账号授权范围'};
 const deps=t.dependsOn.map(id=>done.find(x=>x.taskId===id));
 try{
 if(!reg.tools[t.tool])throw Error('不在授权工具目录');
 guards.check(reg.tools[t.tool].schema,t.arguments);
 if(!['answer','unsupported','clarification'].includes(t.tool)&&deps.some(x=>!x||!['ok','missing'].includes(x.status)))return resolution.annotate({...e,status:'skipped',reason:'前置任务未取得可用证据',elapsedMs:Date.now()-start},t,originalQuestion);
 if(forceFailure===t.tool||forceFailure===t.tool+':'+t.arguments.domain)throw Error('隔离故障注入：工具暂不可用');
 const a=t.arguments;
 if(t.tool==='data_query'){
  let question=a.query;
  if(a.domain==='inventory.recommend'&&originalQuestion){question=originalQuestion+(/库存|全部|所有|明细|有哪些/.test(originalQuestion)?' 全部':'');}
  e.data=live('assistant-data-query').query(store,user,{domain:a.domain,question,keyword:a.query,date:a.date});
 }
 else if(t.tool==='knowledge_lookup'){
  live('common').permit(user,'learn');
  const current=live('rule-authority').query(a.query,user),knowledge=live('employee-knowledge'),reply=current||knowledge.query(store,user,a.query)||knowledge.query(store,user,'学习资料 '+a.query),catalog=knowledge.catalog(store,user),day=clock.today;
  const sourceIds=new Set([reply?.metrics?.articleId,...(reply?.sources||[]).map(s=>s.id)].filter(Boolean));
  const articles=catalog.items.filter(item=>sourceIds.has(item.id)||(reply?.sources||[]).some(s=>s.href==='/knowledge#'+encodeURIComponent(item.id)));
  const historical=(catalog.historicalItems||[]).some(item=>sourceIds.has(item.id)||(reply?.sources||[]).some(s=>s.href==='/knowledge#'+encodeURIComponent(item.id)))||articles.some(item=>item.policyStatus==='historical'||item.validTo&&item.validTo<day||item.validFrom&&item.validFrom>day);
  const needsReview=reply?.metrics?.needsReview===true||articles.some(item=>['store_policy','store_training','store_exam'].includes(item.sourceTier)&&item.policyStatus!=='current');
  e.data=historical&&!current?{route:'knowledge.lookup',results:[{kind:'not-found',reason:'命中历史或失效资料，本次不作为现行依据'}],sources:[]}:
  reply&&(current||reply.metrics?.knowledge)?{route:'knowledge.lookup',results:[{kind:current?'protected-rule':reply.metrics?.kind||'verified-knowledge',answer:reply.answer,version:reply.metrics?.version,needsReview,policyStatus:reply.metrics?.policyStatus,articleIds:articles.map(item=>item.id)}],sources:reply.sources||[]}:
  {route:'knowledge.lookup',results:[{kind:'not-found',reason:'当前授权且有效的正式知识中没有匹配内容'}],sources:[]};
 }
 else if(t.tool==='workflow_lookup')e.data=live('assistant-agent-tools').run(store,user,{route:'workflow.lookup',args:a},'',{},null);
 else if(t.tool==='supplier_exchanges'){
  const all=live('supplier-exchanges').list(store,user,new URLSearchParams({q:String(a.query||'')})).rows;
  e.data={rows:all.slice(0,30).map(r=>({id:r.id,status:r.status,supplier:r.supplierName,createdAt:r.createdAt,applicant:r.applicantName,agreement:r.agreement,outgoing:r.outgoing,incoming:r.incoming,handedAt:r.handedAt||null,balance:r.balance,href:r.href})),total:all.length,asOf:clock.beijing,note:'申请与批准不动库存；交货才出库，验收才入库，差价以实际账户核实为准。'};
 }
 else if(t.tool==='supplier_outbound_tracking'){
  const all=live('supplier-outbound-tracking').list(store,user,new URLSearchParams()).rows;
  const key=String(a.query||'').trim();
  const rows=all.filter(r=>r.status==='已交货待结'&&(!key||[r.id,r.supplierName,r.receivingStore,r.agreement].some(v=>String(v||'').includes(key)))).slice(0,30);
  e.data={rows:rows.map(r=>({id:r.id,supplier:r.supplierName,receivingStore:r.receivingStore,deliveredAt:r.deliveredAt,agreementOriginal:r.agreement,confirmedDueAt:r.confirmedDueAt,dueEvidence:r.dueEvidence||null,urgency:r.urgency,unsettledAmount:r.balance.balance,lastFollowupAt:r.lastFollowupAt||null,href:r.href})),totalOpen:all.filter(r=>r.status==='已交货待结').length,asOf:clock.beijing,needsAgreementConfirmation:rows.some(r=>!r.confirmedDueAt),sources:rows.map(r=>({label:'供货商调货跟踪 '+r.id,href:r.href})),note:'原备注仅为员工填写；到期时间须经原话或再次联系核对，钱和货以实际流水及入库记录为准。'};
 }
 else if(t.tool==='evidence_lookup')e.data=live('assistant-data-query').query(store,user,{domain:'documents.search',question:a.query,keyword:a.query});
 else if(t.tool==='pending_tasks'){
  const state=live('air-funding-orders').workbench(store,user,live('air-history-pending').workbench(store,user,live('workbench').summary(store,user)));
  const groups=user.roleCode==='owner'&&a.scope==='all'?state.waitingOnOthers||[]:[];
  e.data={scope:a.scope==='all'?'当前门店':'本人',principal:{id:user.id,name:user.name},ownCount:Number(state.pendingCount||0),ownTasks:user.roleCode==='owner'?live('boss-overview').summary(store,user).tasks:[],reports:user.roleCode==='owner'?state.reports||{}:{},staffCount:user.roleCode==='owner'&&a.scope==='all'?Number(state.waitingOnOthersCount||0):null,groups:groups.map(g=>({personId:g.personId,person:g.person,count:g.count,rows:g.rows})),cashPendingReminders:(state.assistantCashReminders||[]).map(({orderId,partId,receiptNos,amount,handler,status,href})=>({orderId,partId,receiptNos,amount,handler,status,href})),note:'与工作台 /api/workbench 同口径；SK 是收款单展示号，SO 是关联销售单原编号，不能互换；现金待交提醒按单据状态计算，查看不代表已交接；只读查询，未执行确认或审批'};
 }else if(t.tool==='phone_parameter_coverage'){
  if(!reg.caps.sell&&!reg.caps.purchase&&!reg.caps.manageProducts&&!reg.caps.stocktake)throw Error('当前账号没有手机查询权限');
  e.data=await resolution.coverage(phoneTargets.length?phoneTargets:rowsFrom(deps).map(x=>({name:x.name,brand:x.brand})));if(!e.data.records.length){e.status='missing';e.reason='缺少明确型号';}else if(e.data.omitted||e.data.records.some(r=>r.status!=='ok')){e.status='partial';e.reason='已存参数存在缺项、过期或冲突';}
 }else if(t.tool==='phone_parameters'){
  if(!reg.caps.sell&&!reg.caps.purchase&&!reg.caps.manageProducts&&!reg.caps.stocktake)throw Error('当前账号没有手机查询权限');
  const requested=a.modelName&&live('phone-spec-web').identity(a.modelName);
  const contextual=requested?phoneTargets.filter(x=>{const id=live('phone-spec-web').identity(x.name,x.brand);return id?.key===requested.key&&(!requested.variant||id.variant===requested.variant);}):phoneTargets;
  const targets=a.fromDependencies?rowsFrom(deps).slice(0,3).map(x=>({name:x.name,brand:x.brand})):a.modelName?live('assistant-phone-spec-tool').choose(store,user,a,originalQuestion||a.modelName,null).concat(contextual).filter((x,i,all)=>all.findIndex(y=>y.name===x.name&&y.brand===x.brand)===i).slice(0,3):contextual.slice(0,3);
  if(!targets.length){e.status='missing';e.reason='缺少前置真实机型或明确型号';}
  else {const records=await Promise.all(targets.map(x=>live('phone-spec-web').lookup(x)));e.data={records:records.map(publicSpecs),sources:live('assistant-phone-spec-tool').sources(records)};if(records.some(x=>x.status!=='ok')){e.status='partial';e.reason='部分机型没有有效参数，不能用旧字段推荐';}}
 }else if(t.tool==='comparison_prepare'){
  const rows=rowsFrom(deps),records=deps.flatMap(x=>x.data?.records||[]),web=live('phone-spec-web'),budget=deps.find(x=>x.data?.result?.budget)?.data.result.budget;
  const phones=rows.map(row=>{const id=web.identity(row.name,row.brand),record=records.find(r=>web.identity(r.displayName)?.key===id?.key);return {...row,...(budget?.target?{priceVsTarget:Math.round((row.salePrice-budget.target)*100)/100}:{}),specification:record};});
  const comparisons=[];for(let i=1;i<phones.length;i++){const a=phones[0],b=phones[i],fields=[];for(const key of ['battery','charging','screenSize','screenType']){const x=a.specification?.fields?.find(f=>f.key===key),y=b.specification?.fields?.find(f=>f.key===key);if(x&&y)fields.push({key,left:x.value,right:y.value,relation:x.value===y.value?'相同':parseFloat(x.value)&&parseFloat(y.value)?parseFloat(x.value)>parseFloat(y.value)?'左大于右':'右大于左':'不同'});}comparisons.push({left:a.name,right:b.name,priceDifference:Math.round((b.salePrice-a.salePrice)*100)/100,fields});}
  e.data={phones,comparisons,note:'容量比较不等于实测续航；无现货订货价格交期待核'};
 }else if(t.tool==='draft_prepare'){
  const f=reg.features.find(x=>x.id===a.featureId),rows=rowsFrom(deps);
  if(/接待/.test(f.label))e.data={label:f.label,content:live('reception-assistant').draft({transcript:a.content}),saved:false,submitted:false,missing:['营业员核对顾客需求与授权信息'],sessionOnly:true};
  else {if(!rows.length)throw Error('销售草稿必须先查询当前可见商品');e.data={label:f.label,content:a.content,items:rows.slice(0,1).map(x=>({skuId:x.skuId,name:x.name,salePrice:x.salePrice})),saved:false,submitted:false,missing:['顾客信息','具体串号','收款账户与方式','数量及价格确认'],sessionOnly:true};}
 }else if(t.tool==='unsupported'){e.status=/无权|权限|未授权/.test(a.reason)?'restricted':'unsupported';e.reason=a.reason;}
 else if(t.tool==='clarification'){e.status='missing';e.reason=a.question;}
 else if(t.tool==='answer')e.data={purpose:t.purpose};
 if(t.tool==='knowledge_lookup'&&e.data?.results?.every(r=>r.kind==='not-found')&&ruleMemory?.rules?.length){e.data={route:'knowledge.lookup',results:ruleMemory.rules.map(r=>({kind:'remembered-rule',answer:r.content,conditions:r.conditions,counterexample:r.counterexample,version:r.version})),sources:ruleMemory.rules.map(r=>({label:r.title||'现行工作规则',href:'/assistant-memory#'+encodeURIComponent(r.id)}))};}
 if(e.data?.result?.restricted){e.status='restricted';e.reason=e.data.result.reason;delete e.data;}
 if(e.data?.result?.unsupported){e.status='unsupported';e.reason=e.data.result.reason;}
 if(e.data?.result?.needsKeyword){e.status='missing';e.reason=e.data.result.reason;}
 if(e.data?.results?.some(x=>x.kind==='not-found')){e.status='missing';e.reason='当前核实知识未匹配，未将其当成规则事实';}
 if(e.data?.results?.some(x=>x.needsReview)){e.status='partial';e.reason='资料需要复核，不能用于确定报价或承诺办理';}
 }catch(error){e.status=/权限|授权|无权/.test(error.message)?'restricted':'failed';e.reason=error.message;if(t.tool==='data_query'){const ids=t.arguments.domain.startsWith('sales.')?['sales','profit']:t.arguments.domain.startsWith('inventory.')?['inventory']:[];e.fallbackActions=reg.features.filter(f=>ids.includes(f.id)).map(({id,label,href})=>({featureId:id,label,href}));}}
 return resolution.annotate({...e,elapsedMs:Date.now()-start},t,originalQuestion);
}
function verifiedPhoneReply(phone,evidence,question,store,errors=[]){
 const web=live('phone-spec-web'),records=evidence.flatMap(e=>e.data?.records||[]);
 const checked={...phone,rows:phone.rows.map(row=>({...row,phoneSpecification:records.find(record=>web.identity(record.displayName)?.key===web.identity(row.name,row.brand)?.key)}))};
 const rendered=live('assistant-phone-talk').build(checked,question,store);
 if(!rendered)throw Error('没有可用的已核实手机话术模板');
 const response={answer:rendered.text,completedTaskIds:evidence.filter(e=>e.status==='ok').map(e=>e.taskId),remainingTaskIds:evidence.filter(e=>e.status!=='ok').map(e=>e.taskId),evidenceIds:evidence.filter(e=>e.status==='ok').map(e=>e.evidenceId),generation:{mode:'verified-template-fallback',modelAnswerValidated:false,reason:errors,source:'现行已核实手机话术规则模板；不是本轮模型原稿'}};
 const remaining=evidence.filter(e=>e.status!=='ok');if(remaining.length)response.answer+='\n未完成：'+remaining.map(e=>e.reason||e.taskId).join('；');return response;
}
function cashBalanceAnswer(store,user,question){
 const q=String(question||'');
 if(!/门店现金/.test(q)||!/账面|应有|余额|结余/.test(q)||/门店微信|信号机微信|备用金|老板微信|支付宝|银行卡/.test(q)||/昨天|昨日|前天|\d{4}-\d{2}-\d{2}|到|至/.test(q))return null;
 const data=live('simple-daily-close').preview(store,user),money=n=>Number(n).toFixed(2);
 const answer=data.cashExpected==null?'今天门店现金尚无可追溯的账面基准，不能计算账面余额；请到当日扎账单查看现金来源并按实物核对。':'今天门店现金账面应有 '+money(data.cashExpected)+' 元。账面期初 '+money(data.openingCash)+' 元，今天已登记现金净变动 '+money(data.cashChange)+' 元，转存银行 '+money(data.cashBankDeposits)+' 元'+(data.cashAdjustment?'，已核清调整 '+money(data.cashAdjustment)+' 元':'')+'。这是账面计算值，现场现金仍以实际清点为准。';
 return {answer,mode:'store',asOf:data.asOf,sources:[{label:'当日扎账单与现金明细',href:'/simple-daily-close'}],followups:[],unresolved:data.cashExpected==null,metrics:{kind:'office-store-cash',modelCalls:0,generation:'verified-cash-count-projection'},piAgent:{status:'connected',route:'verified-erp-projection'}};
}
function myFinanceAnswer(store,user,question){
 const q=String(question||'');
 if(/门店现金/.test(q)&&/账面|应有|余额|结余/.test(q))return null;
 const personal=/我的财务|(?:我|本人)(?:的|今天的?|当日的?|昨日的?|昨天的?|现在的?)?(?:挂账|账务|财务|红包|经手款|支付|付款|支出|进账|收入|收款|收到|已付|待支付|待付款|待付|应付|未支付|未付款|未付)|(?:我|本人)(?:今天|当日|现在|昨日|昨天|还)?(?:有|收到|领到|发了|付了|支付|付款|支出|进账|收入|收款|还要付|还需付).{0,18}(?:多少|几笔|金额|挂账|红包|货款|收入|进账|待付|未付)/.test(q);
 if(!personal)return null;
 const allHistory=/全部累计|全部历史|历史累计|累计|总共/.test(q),feature=live('assistant-capabilities').catalog(store,user).items.find(row=>row.id==='my-finance');
 if(!feature)return {answer:'当前账号没有“我的财务”入口，请使用本人有效门店账号。',mode:'store',sources:[],followups:[],unresolved:true,metrics:{kind:'office-my-finance',restricted:true,modelCalls:0}};
 const reply=(answer,unresolved=false)=>({answer,mode:'store',sources:[{label:feature.label,href:feature.href}],followups:[],unresolved,action:{type:'navigate',label:'打开我的财务',href:feature.href+(allHistory?'?scope=all':'')},metrics:{kind:'office-my-finance',modelCalls:0,personalOnly:true},piAgent:{status:'connected',route:'verified-personal-finance'}});
 if(/在哪|哪里|入口|打开|怎么查/.test(q)&&!/多少|金额|明细|几笔|几条/.test(q))return reply('老板和营业员统一从工作台“财务中心”进入“我的财务”，只查当前登录本人。默认只看2026-10-28起的账，当天收支只统计当天；默认选当日；点“全部累计”可查全部历史，两种范围读取同一本人账套。');
 const today=live('common').day(),dates=q.match(/\d{4}-\d{2}-\d{2}/g)||[],yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10),from=dates[0]||(allHistory?'1970-01-01':/昨天|昨日/.test(q)?yesterday:/历史/.test(q)?'2026-10-28':today),to=dates[1]||dates[0]||(/昨天|昨日/.test(q)?yesterday:today);
 const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 if(!validDate(from)||!validDate(to))return reply('请指定有效日期，范围从2026-10-28到今天。',true);
 if(!allHistory&&(from<'2026-10-28'||to<'2026-10-28'))return reply('“我的财务”从2026-10-28开始展示新记录；之前的全部记录保留在历史往来中，不计入我的财务默认首页。可从“查流水”进入此前历史往来查原单。');
 if(from>today||to>today||from>to||/明天|后天/.test(q))return reply('请选择2026-10-28至今天之间的日期；我的财务不预记未来收付款。');
 if(!dates.length&&/本月|这月|这个月|本周|这周|今年|去年|上月|上周|近\d+天|最近\d+天/.test(q))return reply('请指定2026-10-28至今天之间的起止日期；仅2026-10-28起的未清事项跨期间跟进；此前记录只在历史查询。',true);
 const data=live('my-finance').report(store,user,new URLSearchParams({from,to,scope:allHistory?'all':'day',category:/红包/.test(q)?'redPackets':'all'})),s=data.summary,d=data.dashboard||{},m=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2)+' 元':'待核对';
 const open='当前本人挂账 '+s.responsibilityCount+' 笔，已知金额 '+m(s.responsibilityAmount)+(s.unknownResponsibilityCount?'，另有 '+s.unknownResponsibilityCount+' 笔金额待核':'')+'；本人待确认 '+s.pendingConfirmationCount+' 项。';
 const packets=user.roleCode==='owner'?'所选期间红包申请待核定 '+m(s.redPacketRequested)+'，已核定待发 '+m(s.redPacketApprovedUnpaid)+'，本人登记发放 '+m(s.redPacketRecordedPaid)+'。':'所选期间本人红包申请待核定 '+m(s.redPacketRequested)+'，已核定待发 '+m(s.redPacketApprovedUnpaid)+'，老板登记已发 '+m(s.redPacketRecordedPaid)+'；这不代表本人已经独立核实到账。';
 const recent=data.openItems.slice(0,3).map(row=>(row.opening?'期初未清 ':'')+row.sourceNo+' '+row.label+'：'+row.status).join('；');
 const wantsPayable=/待支付|待付款|待付|应付|未支付|未付款|未付|还(?:要|需)?(?:支付|付款|付)/.test(q),wantsPaid=!wantsPayable&&/支付|付款|支出|付了|付出|发了/.test(q),wantsReceived=/进账|收入|收款|收到|收了|收进|领到/.test(q),wantsOpen=/挂账|待确认|待处理|未清|没处理/.test(q),general=/我的财务|本人(?:的)?财务/.test(q)&&!wantsPayable&&!wantsPaid&&!wantsReceived&&!wantsOpen;
 const parts=[];let unresolved=false;
 if(wantsPaid||general){const p=d.paid||{};parts.push('已登记支付 '+m(p.amount)+'（货款 '+m(p.purchaseAmount)+'；红包 '+m(p.redPacketAmount)+'；其他 '+m(p.otherAmount)+'）。这是本人个人账户的付款登记，账户核实另看原单。');if(p.amount==null)unresolved=true;}
 if(wantsReceived||general){const r=d.received||{};parts.push('登记进账 '+m(r.amount)+'（非现金收入 '+m(r.noncashAmount)+'；交来现金 '+m(r.cashHandedInAmount)+'；本人红包 '+m(r.rewardAmount)+'；其他 '+m(r.otherAmount)+'）。交来现金按已确认交接或直接收现证据；红包与工资按发放登记，实际收到仍看原单。');if(r.amount==null)unresolved=true;}
 if(wantsPayable||general){const p=d.payable||{};parts.push('当前待支付 '+m(p.amount)+'（货款 '+m(p.purchaseAmount)+'；红包 '+m(p.redPacketAmount)+'；其他 '+m(p.otherAmount)+'），'+(allHistory?'包含全部历史未付原记录。':'仅含2026-10-28起的原记录。')+''+(p.unknownCount?'其中 '+p.unknownCount+' 项金额或付款职责待核对，已明确金额 '+m(p.knownAmount)+'；未知金额未按0计算。':'')+'已支付但待账户核实的记录不重复算待支付；本项是当前状态，不按历史流水期间还原。');if(p.amount==null||p.unknownCount)unresolved=true;}
 if(wantsOpen||general)parts.push(open+(recent?' 待跟进原单：'+recent+'。':''));
 if(!parts.length)parts.push(open+packets+(recent?' 待跟进原单：'+recent+'。':''));
 return reply('当前登录本人 '+user.name+'；'+(allHistory?'全部累计 · ':'')+data.period.from+(data.period.from===data.period.to?'':' 至 '+data.period.to)+'。'+parts.join(' ')+'经手门店款、本人账户登记和红包分别核对，不合成个人余额；处理回到各自原单。'+(data.warnings.length?' 另有 '+data.warnings.length+' 项原记录证据或备注需核对。':''),unresolved);
}
async function ask(store,user,payload){
 if(typeof payload.question!=='string'||!payload.question.trim()||payload.question.length>2000)throw Error('请输入2000字内问题');
 const active=store.users.find(x=>x.id===user.id&&x.status==='active');if(!active)throw Error('当前账号已失效');user=active;
 const prior=payload.context?.userId===user.id&&payload.context?.mode==='store'&&Number.isFinite(payload.context?.at)&&Date.now()-payload.context.at<3600000&&live('closeout-original-evidence.cjs').isQuestion(String(payload.context?.topicQuestion||''))?String(payload.context.topicQuestion):'';
 const originalQuestion=prior&&/原单|两张单|比对|漏填|没填|未填|那一项/.test(payload.question)?prior+'\n'+payload.question:payload.question;
 const original=live('closeout-original-evidence.cjs').answer(store,user,originalQuestion,live('common').day());
 if(original)return {answer:original.answer,mode:'store',asOf:live('common').now(),sources:original.sources,followups:[],unresolved:original.unresolved,context:{question:payload.question,topicQuestion:originalQuestion,userId:user.id,at:Date.now(),mode:'store'},metrics:{kind:'office-closeout-original',modelCalls:0,readOnly:true},piAgent:{status:'connected',route:'verified-original-projection'}};
 const personalFinance=myFinanceAnswer(store,user,payload.question);if(personalFinance)return personalFinance;
 const stoppedReception=require('./reception-availability').answer(payload.question);if(stoppedReception)return stoppedReception;
 const reconciliationAnswer=currentReconciliationAnswer(store,user,payload.question);
 if(reconciliationAnswer)return reconciliationAnswer;
 const receiptAnswer=cashReceiptAnswer(store,user,payload.question);
 if(receiptAnswer)return receiptAnswer;
 const bayuAnswer=bayuEntryAnswer(store,user,payload.question);
 if(bayuAnswer)return bayuAnswer;
 const pendingAnswer=currentPendingAnswer(store,user,payload.question);
 if(pendingAnswer)return pendingAnswer;
 const cashAnswer=cashBalanceAnswer(store,user,payload.question);
 if(cashAnswer)return cashAnswer;
 const trace=[],start=Date.now(),reg=registry(store,user);
 const receiptNav=String(payload.question||'').replace(/\s+/g,'').replace(/[。！!？?]+$/,'');
 if(/^(?:请|帮我|给我)?(?:打开|进入|带我去)收款单查询(?:页面|入口)?$/.test(receiptNav)){
  const feature=reg.features.find(row=>row.id==='receipt-query');
  if(!feature)return {answer:'当前账号没有“收款单查询”的授权入口，请使用本人获授权的账号。',mode:'store',sources:[],followups:[],unresolved:true,metrics:{kind:'office-feature-navigation',featureId:'receipt-query',allowed:false,modelCalls:0},piAgent:{status:'connected',route:'authorized-feature-navigation'}};
  return {answer:'可以打开“'+feature.label+'”查询已登记收款单。老板对账与实际账户持有人核实仍按原单分别办理。',mode:'store',asOf:live('common').now(),sources:[{label:feature.label,href:feature.href}],followups:[],unresolved:false,action:{type:'navigate',label:'打开'+feature.label,href:feature.href},metrics:{kind:'office-feature-navigation',featureId:feature.id,allowed:true,modelCalls:0,elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'authorized-feature-navigation'}};
 }
 const history=historyFor(payload,user),phoneTargets=resolution.targets(store,user,payload,history);
 const ctx={question:payload.question,topicQuestion:payload.question,userId:user.id,at:Date.now(),mode:'store',...(phoneTargets.length?{phoneSpecifications:{models:phoneTargets.map(x=>x.name)}}:{})};
 const acknowledgement=resolution.supplement(payload.question);
 if(acknowledgement)return {answer:acknowledgement,mode:'store',sources:[],followups:[],unresolved:false,context:ctx,metrics:{kind:'office-acknowledgement',version:'office-v1.1',modelCalls:0,domains:[],taskStatuses:[],elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'office-acknowledgement'}};
 if(resolution.coverageIntent(payload.question)){
  const task={id:'coverage',tool:'phone_parameter_coverage',arguments:{},dependsOn:[]},clock={beijing:new Date().toISOString()};
  const e=await executeTask(task,store,user,reg,[],clock,{originalQuestion:payload.question,phoneTargets});
  const answer=e.status==='restricted'||e.status==='failed'?e.resolution.message:resolution.coverageText(e.data||{records:[]});
  return {answer,mode:'store',sources:(e.data?.sources||[]).map(s=>({label:s.title||'参数来源',href:s.url||s.href})).filter(s=>s.href),followups:[],unresolved:e.status!=='ok',context:ctx,metrics:{kind:'office-parameter-coverage',version:'office-v1.1',modelCalls:0,domains:[],taskStatuses:[{id:e.taskId,tool:e.tool,status:e.status}],elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'office-parameter-coverage'}};
 }
 if(/每个月|各月|逐月|整年|全年/.test(payload.question)&&/销售|利润|业绩|统计/.test(payload.question)&&!/只给入口|在哪里|打开/.test(payload.question)){
  const entry=reg.features.find(f=>f.id==='sales-list')||reg.features.find(f=>f.id==='sales');
  return {answer:'当前工作助理的数据工具只能查单日，暂不能列出全年各月的销售或净利润。销售毛利也不等于扣除工资、房租等费用后的经营净利润。'+(entry?'可打开“'+entry.label+'”按实际支持的日期条件查询销售记录；净利润还需另核费用与其他收益。':''),mode:'store',sources:entry?[{label:entry.label,href:entry.href}]:[],followups:[],unresolved:true,...(entry?{action:{type:'navigate',label:entry.label,href:entry.href}}:{}),metrics:{kind:'office-capability-boundary',version:'office-v1',modelCalls:0,domains:[],taskStatuses:[{id:'range',tool:'unsupported',status:'unsupported'}],completedTaskIds:[],remainingTaskIds:['range'],elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'office-capability'}};
 }
 const requestPrefix=payload.question.split(/[：:]/)[0],draftOnlyReception=/(?:接待|回访)(?:单)?草稿/.test(requestPrefix)&&!/(?:先查|查询|查库存|推荐|比较|对比|话术|政策|规则|流程)/.test(requestPrefix);
 if(draftOnlyReception&&reg.tools.draft_prepare){
  const entry=reg.features.find(f=>f.id==='reception');if(entry){const text=payload.question.split(/[：:]/).slice(1).join('：').trim()||payload.question;
   const tomorrow=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
   return {answer:'接待草稿（仅在对话中准备，尚未保存或提交）：'+String.fromCharCode(10)+text+(/明天/.test(text)?String.fromCharCode(10)+'其中“明天”按北京时间为'+tomorrow+'。':'')+String.fromCharCode(10,10)+'待核对：顾客称呼、联系电话与实际到店安排。请保留顾客原预算和需求，核对后到接待页面办理。',mode:'store',sources:[{label:entry.label,href:entry.href}],followups:[],unresolved:false,action:{type:'navigate',label:entry.label,href:entry.href},metrics:{kind:'office-reception-draft',version:'office-v1',modelCalls:0,domains:[],taskStatuses:[{id:'draft',tool:'draft_prepare',status:'ok'},{id:'answer',tool:'answer',status:'ok'}],completedTaskIds:['draft','answer'],remainingTaskIds:[],elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'office-draft'}};
  }
 }
 if(draftOnlyReception){for(const key of Object.keys(reg.tools))if(!['draft_prepare','answer','clarification','unsupported'].includes(key))delete reg.tools[key];if(reg.tools.draft_prepare)reg.tools.draft_prepare.schema.properties.featureId.enum=reg.features.filter(f=>f.id==='reception').map(f=>f.id);}
 const directParameters=live('assistant-phone-spec-tool').parameterIntent(payload.question)&&!/推荐|帮我选|选一款|挑一款|对比|比较/.test(payload.question.replace(/(?:不要|不需要|不|别)推荐[^，。；]*/g,''));
 if(directParameters&&reg.tools.data_query){reg.tools.data_query.schema.properties.domain.enum=reg.tools.data_query.schema.properties.domain.enum.filter(d=>d!=='inventory.recommend');reg.tools.phone_parameters.schema.properties.fromDependencies.enum=[false];reg.tools.phone_parameters.schema.required=['fromDependencies','modelName'];}
 if(reg.tools.pending_tasks&&/(?:我|本人).{0,12}(?:待处理|待办|事情)/.test(payload.question)&&!/(?:其他|全店|大家).{0,8}(?:待办|待处理)/.test(payload.question))reg.tools.pending_tasks.schema.properties.scope.enum=['self'];
 if(!resolution.coverageRequested(payload.question))delete reg.tools.phone_parameter_coverage;
 const userAmounts=[...payload.question.matchAll(/([零〇一二两三四五六七八九十百千万\d.]+)\s*(?:元|块)/g)].map(m=>({original:m[0],amount:live('assistant-product-query').spokenMoney(m[1]),kind:'用户提出的条件，不是核实业务事实'})).filter(x=>Number.isFinite(x.amount));
 const now=new Date(),day=offset=>new Date(now.getTime()+8*3600000+offset*86400000).toISOString().slice(0,10),clock={beijing:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(now),timezone:'Asia/Shanghai',today:day(0),tomorrow:day(1),yesterday:day(-1),dayBeforeYesterday:day(-2)};
 const input={question:payload.question,clock,identity:{userRef:user.id,displayName:user.name,role:user.roleCode,tenantScoped:true,branchScoped:true},permissions:Object.fromEntries(['finance','profit','allSales','sell','purchase','manageProducts','stocktake'].map(k=>[k,reg.caps[k]===true])),features:reg.features,tools:reg.tools,customerLanguage:live('assistant-customer-language').context(store),environment:{businessWrites:false,drafts:'session-only'},history,referencedPhones:phoneTargets};
 input.userAmounts=userAmounts;input.workingRules={state:payload.ruleMemory?.state,rules:(payload.ruleMemory?.rules||[]).slice(0,4)};
 const plannerSystem=prompts.common+cashReportRule+'\n门店微信、信号机微信、备用金的账面余额和当日增减优先用 finance.store-wallet 一次查询。无需重复查询 finance.accounts；基准已包含的当日流水不能重新相加。'+'\n业务变更退换申请的状态、退款、和包和代扣税查询优先使用 data_query 的 finance.business-change，query 提取明确单号、手机号、业务或结算编号。该工具已返回原单关联凭证、状态和责任人，不需另用短编号泛查其他单据。原登记金额不代表真实净到账。'+'\n销售现金已收但待交入门店的收款单和处理人使用 data_query 的 sales.cash-pending，或查询本人/员工待办时使用 pending_tasks 中的 cashPendingReminders；SK 是收款单展示号，SO 是关联销售单号，两者不能混称或改变字符；提醒已读不能写成现金已交。'+'\n'+prompts.planner+'\n【本次实际可选工具，其他名称一律不能出现】'+Object.keys(reg.tools).join('、')+(draftOnlyReception?'\n【本次仅整理接待草稿】只安排draft_prepare和answer两项；不查知识、库存、参数、不做比较；featureId使用目录中reception，content保留用户给的需求。':directParameters?'\n【本次为指定型号参数核对】phone_parameters必须fromDependencies=false，modelName只能用用户本轮明确型号或referencedPhones中的确切型号；不做库存推荐，不换其他机型。不存在明确对象时只澄清，不举例编造型号。':'');
 let plan=await call('planner',plannerSystem,input,planSchema(reg),trace);
 try{guards.check(planSchema(reg),plan);validatePlan(plan,reg);}catch(error){plan=await call('planner',plannerSystem,{...input,repair:{previous:plan,error:error.message+'；允许工具仅有'+Object.keys(reg.tools).join('、')+'，删除目录之外的多余任务'}},planSchema(reg),trace);try{guards.check(planSchema(reg),plan);validatePlan(plan,reg);}catch(second){throw second;}}
 const evidence=[];for(const task of plan.tasks)evidence.push(await executeTask(task,store,user,reg,evidence,clock,{originalQuestion:payload.question,ruleMemory:payload.ruleMemory,phoneTargets}));
 const wallet=evidence.find(e=>e.status==='ok'&&e.tool==='data_query'&&e.data?.domain==='finance.store-wallet');
 if(wallet&&/门店微信|信号机微信|备用金/.test(payload.question)&&plan.tasks.every(t=>t.tool!=='data_query'||t.arguments.domain==='finance.store-wallet'||(t.arguments.domain==='finance.accounts'&&evidence.some(e=>e.taskId===t.id&&e.data?.result?.wallet)))){
  const d=wallet.data.result,money=n=>Number.isFinite(n)?n.toFixed(2)+' 元':'待核对';
  const answer=d.expectedBalance==null?'门店微信（备用金）账面余额待核对：'+(d.reason||'尚无已确认基准'):'门店微信（备用金）账面余额 '+money(d.expectedBalance)+'；'+d.date+' 已登记增加 '+money(d.todayIn)+'，减少 '+money(d.todayOut)+'。'+(d.baselineAt?'基准确认时点 '+new Date(d.baselineAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'。':'')+'余额只累加基准确认后新增的收支，基准已包含的当日流水不再重复相加。';
  return {answer:answer+'本次仅查询。系统未直连微信；实际余额仍在扎账时核对。',mode:'store',asOf:d.asOf,sources:d.sources||[],followups:[],unresolved:d.expectedBalance==null,context:ctx,metrics:{kind:'office-store-wallet',version:'wallet-owner-baseline-v1',model:trace.at(-1)?.model,modelCalls:trace.length,generation:'verified-wallet-record-renderer',domains:['finance.store-wallet'],taskStatuses:[{id:wallet.taskId,tool:'data_query',status:'ok'}],elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'office-agent'}};
 }
 const finance=evidence.find(e=>e.status==='ok'&&e.tool==='data_query'&&e.data?.domain==='finance.business-change');
 if(finance&&/\d{4,}|BC-[a-z0-9-]+/i.test(payload.question)&&/业务变更|退换申请|和包|代扣/.test(payload.question)&&!/(?:制度|规则全文|对比|统计)/.test(payload.question)&&plan.tasks.every(t=>t.tool!=='data_query'||t.arguments.domain==='finance.business-change')){
  const data=finance.data.result,activeRows=(data.rows||[]).filter(r=>live('business-change-flow').active({status:r.originalRecordedStatus})),sources=(activeRows.length?activeRows:data.rows||[]).slice(0,5).map(r=>({label:'业务变更退换申请 '+(r.mobileBusinessNo||r.id),href:r.href}));
  return {answer:live('business-change-flow').renderQuery(data),mode:'store',asOf:data.asOf,sources,followups:[],unresolved:!data.count,context:ctx,metrics:{kind:'office-business-change',version:'business-change-carrier-withheld-v1',model:trace.at(-1)?.model,modelCalls:trace.length,generation:'verified-business-record-renderer',domains:['finance.business-change'],taskStatuses:[{id:finance.taskId,tool:'data_query',status:'ok'}],elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'office-agent'}};
 }
 const answerInput={question:payload.question,userAmounts,clock,plan,evidence,customerLanguage:live('assistant-customer-language').context(store),constraints:{draftOnlyReception},history:input.history,environment:input.environment};
 const verifiedPhone=evidence.find(e=>e.data?.result?.kind==='phone-recommendations')?.data.result;
 const renderPhone=live('assistant-phone-talk').requested(payload.question)&&verifiedPhone&&!/移动|宽带|套餐|工资|考勤|待办|电子屏/.test(payload.question)&&plan.tasks.every(t=>['answer','phone_parameters','comparison_prepare','knowledge_lookup'].includes(t.tool)||t.tool==='data_query'&&t.arguments.domain==='inventory.recommend');
 if(renderPhone)plan.audience='customer';
 const renderKnowledge=plan.audience==='employee'&&plan.tasks.every(t=>['knowledge_lookup','workflow_lookup','answer'].includes(t.tool))&&evidence.some(e=>e.tool==='knowledge_lookup'&&e.status==='ok'&&e.data?.results?.some(r=>r.answer));
 const hasMissing=evidence.some(e=>e.status!=='ok'),hasFacts=evidence.some(e=>['ok','partial'].includes(e.status)&&e.tool!=='answer'&&e.data);
 const renderResolution=hasMissing&&!hasFacts;
 let response;try{response=renderResolution?resolution.render(plan,evidence):renderPhone?renderVerifiedPhone(verifiedPhone,evidence,payload.question,store):renderKnowledge?renderVerifiedKnowledge(evidence):completeStatus(await call('answer',prompts.common+cashReportRule+'\n'+prompts.answer,answerInput,answerSchema,trace),evidence);}catch(error){resolution.diagnostic('answer-model-unavailable','answer',evidence);response=resolution.render(plan,evidence,{invalid:true,unavailable:true});}
 let errors=checkedAnswer(response,answerSchema,plan,evidence,{question:payload.question,userAmounts,clock,draftOnlyReception});
 if(errors.length&&response.generation?.mode!=='verified-resolution-renderer'){try{response=completeStatus(await call('answer',prompts.common+cashReportRule+'\n'+prompts.answer,{...answerInput,repair:{previous:response,errors}},answerSchema,trace),evidence);errors=checkedAnswer(response,answerSchema,plan,evidence,{question:payload.question,userAmounts,clock,draftOnlyReception});}catch(error){resolution.diagnostic('answer-model-unavailable','answer-repair',evidence);response=resolution.render(plan,evidence,{invalid:true,unavailable:true});errors=[];}}
 if(errors.length){
  const phone=evidence.find(e=>e.data?.result?.kind==='phone-recommendations')?.data.result;
  const onlyPhone=plan.audience==='customer'&&phone&&!/移动|宽带|套餐|工资|考勤|待办|电子屏/.test(payload.question)&&plan.tasks.every(t=>['answer','phone_parameters','comparison_prepare','knowledge_lookup'].includes(t.tool)||t.tool==='data_query'&&t.arguments.domain==='inventory.recommend');
  if(!onlyPhone){
   const diagnosticId=resolution.diagnostic('answer-validation-failed','answer',evidence);
   response=resolution.render(plan,evidence,{invalid:true});response.generation.diagnosticId=diagnosticId;
  }else{
  response=verifiedPhoneReply(phone,evidence,payload.question,store,errors);
  const fallbackErrors=guards.answerErrors(response,plan,evidence,{question:payload.question,userAmounts,clock,draftOnlyReception});
  if(fallbackErrors.length)response=resolution.render(plan,evidence,{invalid:true});
  }
 }

 const phone=evidence.find(e=>e.data?.result?.kind==='phone-recommendations')?.data.result;
 const specs=evidence.flatMap(e=>e.data?.records||[]),sources=[...new Map(evidence.flatMap(e=>e.data?.sources||e.data?.result?.sources||[]).filter(s=>s?.href).map(s=>[s.href,s])).values()];
 const entry=guards.navigationEntry(reg,evidence);
 const onlySpeech=/(?:只要|只给|只说|只写).{0,5}话术/.test(payload.question);
 if(!response.generation){const notes=[...new Set(evidence.filter(e=>e.status!=='ok').map(e=>e.resolution?.message).filter(Boolean))].filter(s=>!response.answer.includes(s));if(notes.length)response.answer+='\n\n未完成项：'+notes.join('；');}
 return {answer:response.answer,mode:'store',asOf:live('common').now(),sources,followups:[],unresolved:response.remainingTaskIds.length>0||response.generation?.mode==='verified-resolution-renderer',
  ...(entry?{action:{type:'navigate',label:entry.label,href:entry.href}}:{}),
  ...(phone?.rows?.length&&!onlySpeech?{table:{title:'手机现货与当前零售价',columns:[{key:'name',label:'手机型号'},{key:'salePrice',label:'零售价（元）'},{key:'availableQuantity',label:'可售数量'}],rows:phone.rows.map(({name,salePrice,availableQuantity})=>({name,salePrice,availableQuantity}))}}:{}),
  context:{...ctx,...(phone?{phoneRecommendation:{question:payload.question},phoneSpecifications:{models:phone.rows.map(p=>p.name)}}:specs.length?{phoneSpecifications:{models:specs.map(p=>p.displayName)}}:{})},
  metrics:{kind:'office-assistant',version:'office-v1',provider:'opencode-go',model:trace.at(-1)?.model,customerSpeech:plan.audience==='customer',phoneSpecifications:specs.length>0,domains:plan.tasks.filter(t=>t.tool==='data_query').map(t=>t.arguments.domain),generation:response.generation?.mode||'model-grounded',...(response.generation?.diagnosticId?{diagnosticId:response.generation.diagnosticId}:{}),taskStatuses:evidence.map(e=>({id:e.taskId,tool:e.tool,status:e.tool==='answer'&&response.remainingTaskIds.includes(e.taskId)?'failed':e.status})),completedTaskIds:response.completedTaskIds,remainingTaskIds:response.remainingTaskIds,modelCalls:trace.length,elapsedMs:Date.now()-start},piAgent:{status:'connected',route:'office-agent'}};
}
module.exports={ask,registry,validatePlan,executeTask,historyFor};
