'use strict';
function check(schema,value,location='arguments'){
 if(schema.anyOf){if(!schema.anyOf.some(s=>{try{check(s,value,location);return true;}catch{return false;}}))throw Error(location+'不符合任何允许结构');return;}
 if(schema.type==='array'){if(!Array.isArray(value)||schema.minItems&&value.length<schema.minItems||schema.maxItems&&value.length>schema.maxItems)throw Error(location+'数组长度不合法');for(const item of value)check(schema.items,item,location+'[]');return;}
 if(schema.enum&&!schema.enum.includes(value))throw Error(location+'不在授权枚举内');
 if(schema.type==='object'){
  if(!value||Array.isArray(value)||typeof value!=='object')throw Error(location+'应为对象');
  for(const k of schema.required||[])if(!(k in value))throw Error(location+'缺少'+k);
  for(const k of Object.keys(value)){if(!schema.properties[k])throw Error(location+'含未知字段'+k);check(schema.properties[k],value[k],location+'.'+k);}
 }else if(schema.type==='boolean'&&typeof value!=='boolean')throw Error(location+'应为布尔值');
 else if(schema.type==='string'&&(typeof value!=='string'||value.length>2500))throw Error(location+'字符串不合法');
}
function validatePlan(plan,reg){
 if(!plan||!Array.isArray(plan.tasks)||!plan.tasks.length||plan.tasks.length>8)throw Error('任务数必须1至8');
 const seen=new Set();let calls=0;
 for(const t of plan.tasks){if(!/^[a-zA-Z0-9_-]{1,40}$/.test(t.id)||seen.has(t.id))throw Error('任务编号重复或非法');if(!reg.tools[t.tool])throw Error('工具不在目录');if(!Array.isArray(t.dependsOn)||t.dependsOn.some(id=>!seen.has(id)))throw Error('任务依赖非法或成环');check(reg.tools[t.tool].schema,t.arguments);if(t.tool==='data_query'&&t.arguments.domain==='inventory.search'&&/^(?:全部|所有|现货)?(?:华为|荣耀|vivo|oppo|苹果|iphone|小米)(?:手机|整机|库存)?$/i.test(t.arguments.query))throw Error('按品牌查询手机须用inventory.recommend，query写全部品牌手机；关键词检索不能代替整机品牌筛选');seen.add(t.id);if(!['answer','unsupported','clarification'].includes(t.tool))calls++;}
 if(calls>6)throw Error('工具调用最多6次');return plan;
}
function answerErrors(answer,plan,evidence,context={}){
 const errors=[],ids=new Set(plan.tasks.map(t=>t.id)),refs=new Set(evidence.map(e=>e.evidenceId));
 const urls=s=>String(s||'').match(/https?:\/\/[^\s<>"'`）)\]，。；！？]+/gi)||[],allowedUrls=new Set(urls(context.question));
 const sourceUrls=value=>{if(Array.isArray(value)){value.forEach(sourceUrls);return;}if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(['href','url'].includes(key)&&typeof item==='string')for(const url of urls(item))allowedUrls.add(url);else if(item&&typeof item==='object')sourceUrls(item);}};
 sourceUrls(evidence);
 if(urls(answer.answer).some(url=>!allowedUrls.has(url)))errors.push('正文含本次证据之外的网址；只使用工具给出的原入口，不拼接域名');
 for(const id of answer.completedTaskIds||[])if(!ids.has(id)||evidence.find(e=>e.taskId===id)?.status!=='ok')errors.push('错误完成状态:'+id);
 for(const id of answer.remainingTaskIds||[])if(!ids.has(id)||(answer.completedTaskIds||[]).includes(id))errors.push('错误未完成状态:'+id);
 for(const id of answer.evidenceIds||[])if(!refs.has(id))errors.push('无效证据:'+id);
 for(const t of plan.tasks)if(!(answer.completedTaskIds||[]).includes(t.id)&&!(answer.remainingTaskIds||[]).includes(t.id))errors.push('遗漏任务状态:'+t.id);
 const assertions=(answer.answer||'').split(/[。！？\n]/).filter(s=>!/(?:不|未|没有|无法|别|并非)/.test(s)).join('。');
 if(/(?:^|[，。；\s])已(?:提交|保存|审批通过|记账|开单|发布)|保证.{0,8}(?:天|续航)|肯定.{0,8}不用充/.test(assertions))errors.push('禁止的业务完成承诺或续航承诺');
 if(plan.audience==='customer'&&/(?:进价|成本价|员工工资|毛利为)/.test(answer.answer||''))errors.push('对客内容含内部资料');
 if(plan.audience==='customer'&&/声音(?:也|更)?大|音量更大|轻一点|更轻|护眼|看着柔和|仅剩|就剩/.test(assertions))errors.push('加入了无依据的音量、重量、屏幕舒适或紧迫销售描述');
 if(plan.audience==='customer'&&/最新(?:的)?(?:鸿蒙|HarmonyOS|系统)|电池(?:再|更)(?:经用|耐用)|一天(?:要|更)?省心/.test(assertions))errors.push('将出厂系统说成最新系统，或将容量比较说成续航效果');
 if(plan.audience==='customer'&&/(?:更|再|比较|相当|特别)(?:经用|耐用)|拍(?:东西|照|照片).{0,6}(?:清晰|够用|更好)/.test(assertions))errors.push('未提供实测依据，不能评价续航耐用或拍照效果');
 if(plan.audience==='customer'&&/少充|充.{0,8}(?:管|用).{0,6}(?:久|长)|只剩/.test(assertions))errors.push('未提供续航实测，不能承诺少充电、单次使用时长或制造库存紧迫');
 if((answer.answer||'').length>1000)errors.push('回答过长，请缩至600汉字内，去掉参数堆砌、无关话术和重复提醒');
 if(context.draftOnlyReception&&/对客.{0,6}话术|推荐话术/.test(answer.answer||''))errors.push('用户只要求接待草稿，不附带推荐或对客话术');
 const phoneResults=evidence.filter(e=>e.data?.result?.kind==='phone-recommendations').map(e=>e.data.result),phoneRows=phoneResults.flatMap(p=>p.rows||[]);
 if(plan.audience==='customer'&&phoneRows.length){const known=['华为','荣耀','vivo','oppo','苹果','iphone','小米','红米','一加','iqoo','三星'],allowed=JSON.stringify(phoneRows).toLowerCase();for(const brand of known)if(assertions.toLowerCase().includes(brand)&&!allowed.includes(brand))errors.push('不能推荐本次证据之外的品牌:'+brand);if(phoneResults.some(p=>p.budget?.kind==='maximum')&&/加(?:点|一点|几百|预算)|愿意.{0,6}(?:加|提高)预算|两千三四/.test(assertions))errors.push('用户要求严格预算，不能引导加预算或推荐未查询的超预算选项');}
 if(typeof answer.answer!=='string'||!answer.answer.trim())errors.push('回答不能为空，必须交代本次已查结果及未完成项');
 if(plan.audience==='customer'&&/少跑.{0,8}充电|充电.{0,8}从容|字.{0,4}看着更巴适|充电速度.{0,8}一样|一天.{0,8}(?:稳当|省心|够用)|看(?:字|视频).{0,8}更(?:舒展|安逸|巴适|舒服)/.test(assertions))errors.push('未提供实测依据，不能由容量推断充电次数、使用时长，或由屏幕及最大功率推断舒适度和充电速度');
 for(const p of phoneResults)if(p.budget?.kind==='approximate'){const extra=(p.rows||[]).filter(r=>r.salePrice>p.budget.target).map(r=>Math.round((r.salePrice-p.budget.target)*100)/100);for(const m of (answer.answer||'').matchAll(/(?:加|添)([0-9.]+)元?预算/g))if(!extra.includes(Number(m[1])))errors.push('加预算金额必须比较目标价，不能把两机差价说成超出预算金额');}
 if(/(?:只要|只给|只说|只写).{0,5}话术/.test(context.question||'')&&/补充说明|内部核对|待补项|配置核对|选款资料|【说明】/.test(answer.answer||''))errors.push('只要话术，不附带内部核对、待补项或参数清单');
 if(/session-only|(?:profit|finance|allSales)\s*权限|E-t[0-9]/.test(answer.answer||''))errors.push('正文改用中文业务解释，不显示证据编号或技术字段');
 if(context.draftOnlyReception&&!/以内|不超过|最高|上限/.test(context.question||'')&&/预算[^。；\n]{0,12}以内/.test(answer.answer||''))errors.push('保留用户原预算条件，不能擅自改为硬上限');
 const nums=s=>(String(s).match(/\d+(?:\.\d+)?/g)||[]).flatMap(n=>n.includes('.')?[n,n.split('.')[0]]:[n]);
 const allowed=new Set([...nums(JSON.stringify(evidence)),...nums(JSON.stringify(context)),...Array.from({length:9},(_,i)=>String(i))]);
 for(const n of nums(answer.answer))if(!allowed.has(n))errors.push('未找到依据的数字:'+n);
 return [...new Set(errors)];
}
function navigationEntry(reg,evidence){const actual=evidence.filter(e=>e.tool==='workflow_lookup'&&e.status==='ok').flatMap(e=>e.data?.results||[]).flatMap(r=>r.items||[]);return reg.features.find(f=>actual.some(item=>item.id===f.id&&item.href===f.href));}
module.exports={check,validatePlan,answerErrors,navigationEntry};
