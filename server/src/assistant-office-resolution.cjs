'use strict';
const crypto=require('crypto');
const core={chipset:'处理器',battery:'电池容量',charging:'充电功率',screenSize:'屏幕尺寸',screenType:'屏幕材质',resolution:'分辨率',refreshRate:'刷新率',rearCamera:'后置主摄像素',os:'出厂系统'};
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s._-]/g,'');
function contextValid(context,user){return context?.userId===user.id&&context.mode==='store'&&Number.isFinite(context.at)&&Date.now()-context.at<=86400000&&context.at<=Date.now()+60000;}
function coverageRequested(q){return /参数|配置/.test(q)&&/齐全|完整|缺不缺|缺少|缺哪些|有没有|是否有|保存|存过|存了|系统中|系统里/.test(q)&&!/删除|清空|覆盖|修改|写入|提交|保存起来|存起来/.test(q);}
function coverageIntent(q){return /参数|配置/.test(q)&&/齐全|完整|缺不缺|缺少|缺哪些|有没有|是否有|保存|存过|存了|系统中|系统里/.test(q)&&!/推荐|比较|对比|联网|上网|补齐|补全|更新|刷新|删除|清空|覆盖|修改|写入|提交|保存起来|存起来|销售|营业|收款|付款|资金|考勤|待办|工资|毛利|利润|移动业务|套餐|采购|接待|单据/.test(q);}
function targets(store,user,payload,history){
 if(!/手机|机型|参数|配置|屏幕|电池|处理器|充电|这款|那款|这些|那几|刚才|前面/.test(payload.question))return [];
 if(!['sell','purchase','manageProducts','stocktake'].some(k=>require('./common').capabilities(user)[k]))return [];
 const web=require('./phone-spec-web'),tool=require('./assistant-phone-spec-tool');
 const products=require('./erp').listProducts(store,user,{catalog:true}).filter(p=>/^(智能机|智能手机|功能机|按键机|老人机)$/.test(p.type||''));
 const catalog=products.map(p=>({name:p.name,brand:p.brand||p.subType,id:web.identity(p.name,p.brand||p.subType)})).filter(x=>x.id);
 const match=text=>catalog.filter(x=>{const pos=text.lastIndexOf(x.id.model),tail=text.slice(pos+x.id.model.length);return text.includes(norm(x.name))||pos>=0&&(/^\d{1,4}(?:g?[+/]\d{2,4})?(?:g|gb|t|tb)/.test(tail)||!/^(?:pro|max|plus|ultra|元气版|超级版|[a-z0-9])/.test(tail));});
 const direct=match(norm(payload.question));if(direct.length)return [...new Map(direct.map(x=>[x.id.key+'|'+(x.id.variant||''),{name:x.name,brand:x.brand}])).values()];
 // Pronouns may reuse identities, never old prices, counts or specifications.
 if(!/(?:这些|这几|那几|上述|前面|刚才|它们|这些机型|这款|那款|这个|它)/.test(payload.question)||!contextValid(payload.context,user))return [];
 const remembered=payload.context.phoneSpecifications?.models;
 if(Array.isArray(remembered)&&remembered.length){const out=[];for(const name of remembered.slice(0,100)){const exact=catalog.filter(x=>norm(x.name)===norm(name));if(exact.length){out.push(...exact);continue;}const id=web.identity(name);if(!id)continue;out.push(...catalog.filter(x=>x.id.key===id.key&&(!id.variant||x.id.variant===id.variant)));}if(out.length)return [...new Map(out.map(x=>[x.id.key+'|'+(x.id.variant||''),{name:x.name,brand:x.brand}])).values()];}
 for(const turn of [...history].reverse()){
  const text=norm(turn.question+' '+turn.answer),found=match(text);
  if(found.length){const unique=[...new Map(found.map(x=>[x.id.key+'|'+(x.id.variant||''),x])).values()];return unique.map(x=>({name:x.name,brand:x.brand}));}
 }
 return [];
}
async function coverage(items){
 const web=require('./phone-spec-web'),records=[];
 for(const target of items.slice(0,20)){
  const id=target.key?target:web.identity(target.name,target.brand);if(!id)continue;
  const saved=await web.cached(id),fresh=!!saved&&Date.parse(saved.expiresAt)>Date.now();
  const usable=fresh&&saved.status==='ok',conflicts=new Set((saved?.conflicts||[]).map(x=>x.key));
  const available=usable?(saved.fields||[]).filter(f=>['verified','reference'].includes(f.status)&&!conflicts.has(f.key)):[];
  const missingFields=Object.keys(core).filter(k=>!available.some(f=>f.key===k)).map(k=>core[k]);
  records.push({displayName:target.name,status:!saved?'missing':!fresh?'stale':!usable?'unavailable':missingFields.length?'partial':'ok',missingFields,conflictingFields:[...conflicts].map(k=>core[k]||'其他参数'),saved:!!saved,usable,checkedAt:saved?.fetchedAt,fields:available,sources:usable?saved.sources||[]:[]});
 }
 return {kind:'phone-parameter-coverage',records,omitted:Math.max(0,items.length-20),criteria:Object.values(core),note:'只核对系统已保存且有效的资料；常用参数齐全不代表所有功能都有资料，存储版本仍以商品档案为准。',sources:records.flatMap(r=>r.sources)};
}
function coverageText(data){
 if(!data.records.length)return '我还不能确定你指的是哪些机型。请发一下具体品牌和型号，或重新贴出要核对的机型清单，我再逐款检查系统已存参数。';
 const parts=data.records.map(r=>r.displayName+'：'+(r.status==='ok'?'本次核对的常用参数均有有效资料。':r.status==='missing'?'系统尚未保存该版本可用的参数资料。':r.status==='stale'?'已存资料已过期，需重新核实后使用。':r.status==='unavailable'?'已存资料不足以作为有效参数依据。':'已有部分有效参数，尚缺'+r.missingFields.join('、')+'。')+(r.conflictingFields.length?'来源有冲突：'+r.conflictingFields.join('、')+'，暂不作确定推荐。':''));
 return '系统资料核对结果：\n'+parts.join('\n')+'\n'+(data.omitted?'其余机型本轮尚未核对，可分批继续。\n':'')+'核对范围为处理器、电池、充电、屏幕、摄像头和出厂系统等常用参数；缺少的内容不能当作该手机没有这项功能。';
}
function supplement(q){
 if(/[?？]|怎么|如何|帮我|请|查询|入库|建档|改成|修改|审批|提交|记账|成本/.test(q)||q.length>120)return null;
 if(!/^.{1,60}?(?:是)?(?:厂家|供应商|供货商)(?:免费)?(?:赠送|送|赠)(?:给)?(?:我们|门店|店里|本店)(?:的)?[。！!\s]*$/.test(q))return null;
 return '明白，你是在补充这件商品的来源：按你提供的情况，是厂家赠送给门店的。这个说明本身不等于账上成本已经核实，也不代表要办理给顾客的赠品审批。';
}
const labels={data_query:'业务查询',phone_parameters:'手机参数查询',phone_parameter_coverage:'已存手机参数核对',knowledge_lookup:'知识资料查询',workflow_lookup:'功能入口查询',pending_tasks:'待办查询',evidence_lookup:'单据证据查询',comparison_prepare:'机型比较',draft_prepare:'草稿整理'};
function outcome(e,task,question=''){
 const domains={'sales.performance':'销售业绩查询','sales.items':'销售商品查询','sales.staff':'营业员销售查询','carrier.services':'移动业务记录查询','staff.directory':'员工档案查询','staff.attendance':'考勤查询','inventory.warehouses':'仓库查询','inventory.search':'库存商品查询','inventory.recommend':'手机推荐查询','reception.list':'接待记录查询','documents.search':'业务单据查询','finance.accounts':'资金账户查询','platform.catalog':'系统功能查询'};
 const subject=domains[task?.arguments?.domain]||labels[e.tool]||'本项查询';
 if(e.status==='restricted')return {code:'permission-denied',retryable:false,needsUserInput:[],message:subject+'：当前账号没有查看权限，请由有权限的人员核对。'};
 if(e.status==='failed')return {code:'tool-unavailable',retryable:true,needsUserInput:[],message:subject+'：本次查询暂时不可用，还没有取得结果，请稍后重试。'};
 if(e.status==='skipped')return {code:'dependency-unavailable',retryable:true,needsUserInput:[],message:subject+'：前置查询未完成，本项尚未核对。'};
 if(e.status==='unsupported')return {code:'not-supported',retryable:false,needsUserInput:[],message:'本项尚不能由工作助理直接完成；请到对应业务页面核对或办理。'};
 if(e.status==='missing'){
  if(e.tool==='clarification'){
   const requested=String(task?.arguments?.question||''),dateMissing=/哪天|日期|时间范围|时间段/.test(requested)&&!/今天|昨天|前天|\d{4}-\d{2}-\d{2}/.test(question);
   const missing=dateMissing?['查询日期或时间范围']:/哪个账户|账户名称|具体账户/.test(requested)?['要查询的账户名称']:/手机|机型|配置|参数/.test(question)?['具体品牌和型号']:/收款|付款|到账|单据|单号/.test(question)?['单号，或顾客／往来单位等可定位这笔业务的信息']:/商品|库存/.test(question)?['商品名称、型号或编码']:/考勤|员工|营业员/.test(question)?['要核对的人员或范围']:['具体查询对象'];
   return {code:'needs-clarification',retryable:false,needsUserInput:missing,message:'请补充'+missing.join('、')+'，我再继续核对。'};
  }
  if(e.tool==='phone_parameters'||e.tool==='phone_parameter_coverage')return {code:'missing-model',retryable:false,needsUserInput:['具体品牌和型号'],message:'还未取得要核对的具体机型，请补充品牌和型号，或发一下机型清单。'};
  if(e.tool==='knowledge_lookup'){const query=String(task?.arguments?.query||'').trim(),topic=query&&question.includes(query)?'关于“'+query.slice(0,60)+'”，':'';return {code:'no-verified-knowledge',retryable:false,needsUserInput:['相关现行文件或具体问题'],message:topic+'本次没有找到匹配的有效知识资料。你可以补充具体业务名称，或提供相关现行文件供核对。'};}
  return {code:'missing-evidence',retryable:false,needsUserInput:['查询对象或单号'],message:subject+'未匹配到可核对资料；请补充具体对象或单号，这不代表实际没有该业务。'};
 }
 const missingFields=e.tool==='phone_parameters'?(e.data?.records||[]).filter(r=>r.status!=='ok').map(r=>({subject:r.displayName||'所查机型',missing:['可核实的有效参数资料']})):[];
 return {code:e.status==='partial'?'partial-evidence':'available',retryable:false,needsUserInput:[],missingFields,message:e.status==='partial'?(missingFields.length?missingFields.map(r=>r.subject+'：尚缺'+r.missing.join('、')+'。').join(''):subject+'只取得部分资料，未核实的内容暂不能下结论。'):''};
}
function annotate(e,task,question){const result={...e,resolution:outcome(e,task,question)};if(e.status==='failed')result.resolution.diagnosticId=diagnostic('tool-unavailable','tool',[result]);return result;}
function trustedFacts(e){
 if(e.data?.kind==='phone-parameter-coverage')return coverageText(e.data);
 if(e.tool==='phone_parameters'&&e.data?.records)return e.data.records.map(r=>require('./assistant-phone-spec-tool').render(r,'参数',false)).join('\n');
 if(e.tool==='knowledge_lookup')return (e.data?.results||[]).filter(r=>r.answer&&r.kind!=='not-found').map(r=>String(r.answer).slice(0,260)).join('\n');
 const result=e.data?.result,rows=result?.rows||e.data?.rows;
 if(result?.facts){const names={orderCount:'销售单数',salesAmount:'销售额',returnAmount:'退货金额',netSales:'净销售额',receivedAmount:'已登记销售收款',refundAmount:'退款金额',adjustedGrossProfit:'调整后销售毛利'};return (result.scope||'当前授权范围')+'，'+result.date+'：'+Object.entries(names).filter(([k])=>Number.isFinite(result.facts[k])).map(([k,n])=>n+result.facts[k]+(k==='orderCount'?'笔':'元')).join('；')+'。毛利不等于经营净利润，收款发生日可能与销售日不同。';}
 if(e.tool==='workflow_lookup'){const items=(e.data?.results||[]).flatMap(r=>r.items||[]);return items.length?'可打开：'+items.map(x=>x.label).join('、')+'。':'';}
 if(e.tool==='data_query'&&typeof result?.answer==='string')return result.answer;
 if(e.tool==='pending_tasks'&&e.data){const groups=e.data.groups||[];return '工作台当前待办：本人 '+Number(e.data.ownCount||0)+' 条'+(e.data.staffCount==null?'':'；营业员未处理 '+Number(e.data.staffCount||0)+' 条')+(groups.length?'；'+groups.map(g=>g.person+' '+g.count+' 条').join('；'):'')+'。原销售经办归属不代表现金待交责任；本次仅查询，未办理。';}
 if(result){const scalarNames={saleOrderCount:'销售单数',returnOrderCount:'退货单数',itemGroupCount:'商品分组数',serviceCount:'已登记移动业务数',withoutCommissionPlan:'未配置酬金计划业务数',expectedAmount:'预计酬金',receivedAmount:'已到账酬金',confirmedAmount:'已确认酬金',count:'本次记录数'};const facts=Object.entries(scalarNames).filter(([k])=>Number.isFinite(result[k])).map(([k,n])=>n+'：'+result[k]);if(facts.length)return (result.scope||'本次授权范围')+(result.date?'，'+result.date:'')+'：'+facts.join('；')+'。'+(result.note||result.amountStatus||'');
 if(result.counts)return '本次关键词检索匹配结果：'+Object.entries(result.counts).filter(([,v])=>Number.isFinite(v)).map(([k,v])=>({products:'商品',inventory:'库存',sales:'销售单',receipts:'收款单',expenses:'费用单',suppliers:'往来单位',purchases:'采购单'}[k]||'业务记录')+'：'+v+'项').join('；')+'。未匹配不等于业务实际不存在。';}
 if(rows?.length)return '本次已查到的记录：'+rows.slice(0,4).map(r=>String(r.name||r.label||r.skuId||'业务记录')+(Number.isFinite(r.salePrice)?'，当前零售价'+r.salePrice+'元':'')+(Number.isFinite(r.availableQuantity)?'，可售'+r.availableQuantity+'台':'')).join('；')+'。'+(rows.length>4?'其余结果请到对应业务页面查看。':'');
 return '';
}
function render(plan,evidence,{invalid=false,unavailable=false}={}){
 const parts=[],refs=[];
 for(const e of evidence){if(['answer','comparison_prepare'].includes(e.tool))continue;
  if(['ok','partial'].includes(e.status)){const text=trustedFacts(e);if(text){parts.push(text);refs.push(e.evidenceId);}}
  if(e.status!=='ok')parts.push(e.resolution?.message||outcome(e,plan.tasks.find(t=>t.id===e.taskId)).message);
 }
 if(invalid)parts.push(unavailable?'业务查询结果已保留，但本次回答整理服务暂不可用，其余内容请稍后重试。':'已查到的资料见上；其余回答未通过事实核对，暂不能据此下结论，可以继续核对或稍后重试。');
 if(!parts.length)parts.push('这次没有取得足够的可核对依据，请补充具体查询对象或单号，我再继续核对。');
 return {answer:[...new Set(parts)].join('\n\n'),completedTaskIds:evidence.filter(e=>e.status==='ok'&&!(invalid&&e.tool==='answer')).map(e=>e.taskId),remainingTaskIds:evidence.filter(e=>e.status!=='ok'||invalid&&e.tool==='answer').map(e=>e.taskId),evidenceIds:refs,generation:{mode:'verified-resolution-renderer'}};
}
function diagnostic(category,stage,evidence=[]){const id=crypto.randomUUID();console.warn(JSON.stringify({event:'assistant-office-diagnostic',id,category,stage,tools:evidence.map(e=>({tool:e.tool,status:e.status,code:e.resolution?.code}))}));return id;}
function failure(error){const message=String(error?.message||''),category=/http|timeout|aborted|fetch|ECONN|empty/i.test(message)?'model-unavailable':/权限|授权|失效/.test(message)?'permission-denied':/核对|结构|任务|arguments/.test(message)?'validation-failed':'processing-failed';const id=diagnostic(category,'request');return {answer:category==='permission-denied'?'当前账号或权限状态无法完成本次查询，请先确认登录账号及可用功能。':category==='model-unavailable'?'工作助理的模型服务本次未能返回结果，还没有完成业务查询。请稍后重试；这不代表系统没有相关资料。':category==='validation-failed'?'这次查询计划或回答未通过核对，暂不能给出可靠结论。请补充具体查询对象，或从相关业务页面核对。':'工作助理在处理本次问题时发生异常，尚未取得可靠结果，请稍后重试。',mode:'store',sources:[],followups:[],unresolved:true,metrics:{kind:'office-error',version:'office-v1.1',diagnosticId:id,errorCategory:category},piAgent:{status:'degraded',reason:category}};}
module.exports={contextValid,coverageRequested,coverageIntent,targets,coverage,coverageText,supplement,annotate,render,diagnostic,failure};
