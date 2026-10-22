'use strict';
const c=require('./common');
const clean=value=>String(value??'').trim();
const baseName=value=>clean(value).replace(/\\/g,'/').split('/').filter(Boolean).at(-1)||'店内资料';
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=100000?value:null;

function sanitize(profile={}){
  const result={};if(!profile||typeof profile!=='object'||Array.isArray(profile))return result;
  for(const key of ['budgetMax','budgetTarget','currentMonthlySpend','baselineBaseFee'])if(positive(profile[key])!==null)result[key]=positive(profile[key]);
  for(const key of ['minutesNeeded','dataGBNeeded'])if(typeof profile[key]==='number'&&Number.isFinite(profile[key])&&profile[key]>=0&&profile[key]<=100000)result[key]=profile[key];
  if(['calls','data','balanced'].includes(profile.usage))result.usage=profile.usage;
  if(['local','travel','international'].includes(profile.region))result.region=profile.region;
  for(const key of ['budgetApprox','broadband','student','enough','overage','skipPrevious','usageSurplus'])if(typeof profile[key]==='boolean')result[key]=profile[key];
  if(Number.isSafeInteger(profile.people)&&profile.people>=1&&profile.people<=20)result.people=profile.people;
  if(typeof profile.previousPlanName==='string'&&profile.previousPlanName.trim())result.previousPlanName=profile.previousPlanName.trim().slice(0,100);
  if(profile.budgetSource==='previousSpend')result.budgetSource='previousSpend';
  if(Array.isArray(profile.billingConcern)){const concerns=[...new Set(profile.billingConcern.filter(value=>['insufficient','overage','expensive'].includes(value)))];result.billingConcern=concerns;}
  return result;
}
function chineseNumber(value){
  const s=clean(value);if(/[百千][一二两三四五六七八九]$/.test(s))return null;if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);
  const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};let total=0,part=0;
  for(const char of s){if(Object.hasOwn(digits,char))part=digits[char];else if(char==='十'||char==='百'||char==='千'){total+=(part||1)*({十:10,百:100,千:1000}[char]);part=0;}else return null;}
  return s?total+part:null;
}
function parseProfile(question,awaiting=null){
  const q=clean(question).slice(0,500),result={};
  const range=q.match(/([一二三四五六七八九])([一二三四五六七八九])十(?:块|元)?/);let budget=null;
  const match=q.match(/(?:预算|月费|一个月|每月|每个月|话费|最多|以内|不超过|上限|大概|大约)[^\d零〇一二两三四五六七八九十百千]{0,8}([\d零〇一二两三四五六七八九十百千]+(?:\.\d+)?)(?:\s*(?:元|块))?/)
    ||q.match(/([\d零〇一二两三四五六七八九十百千]+(?:\.\d+)?)\s*(?:元|块)(?:钱)?(?:以内|以下|左右|上下|一个月|每月|吧)?/)
    ||(awaiting==='budget'?q.match(/^\s*([\d零〇一二两三四五六七八九十百千]+(?:\.\d+)?)(?:\s*(?:元|块|钱|左右|吧))*[。！!?？]?\s*$/):null);
  if(range)budget=chineseNumber(range[2]+'十');else if(match)budget=chineseNumber(match[1]);
  const oldContext=/原来|以前|原卡|原套餐|旧卡|旧套餐|平时|目前每月|现在每月/.test(q);
  const explicitNewBudget=/预算|以后.{0,12}(?:想花|花|交|支出)|新套餐.{0,8}(?:月费|月租)|想控制|愿意花/.test(q);
  const newBudget=explicitNewBudget||!oldContext&&/上限|最多|以内|以下|不超过/.test(q);
  if(explicitNewBudget){const intended=q.match(/(?:预算|以后(?:每月|一个月)?(?:想花|花|交)|想控制|愿意花)[^\d零〇一二两三四五六七八九十百千]{0,8}([\d零〇一二两三四五六七八九十百千]+(?:\.\d+)?)/);if(intended)budget=chineseNumber(intended[1]);}
  const currentSpend=q.match(/(?:现在|目前|原来|以前|平时|原卡|原套餐).{0,15}(?:每月|一个月|月月|月支出|账单|花|交|付|话费|消费)[^\d零〇一二两三四五六七八九十百千]{0,6}([\d零〇一二两三四五六七八九十百千]+(?:\.\d+)?)\s*(?:元|块)?/)
    ||(awaiting==='current-plan'&&!newBudget?q.match(/([\d零〇一二两三四五六七八九十百千]+)\s*(?:元|块)/):null);
  if(currentSpend&&positive(chineseNumber(currentSpend[1]))!==null){result.currentMonthlySpend=chineseNumber(currentSpend[1]);if(!newBudget)budget=null;}
  if(awaiting==='current-plan'&&positive(budget)!==null&&!newBudget&&!/基础费|月租/.test(q)){result.currentMonthlySpend=budget;budget=null;}
  if(awaiting==='current-plan'&&!currentSpend&&!newBudget){const bare=q.match(/^([\d零〇一二两三四五六七八九十百千]+)(?:元|块|钱|左右|吧|。)*$/);if(bare&&positive(chineseNumber(bare[1]))!==null){result.currentMonthlySpend=chineseNumber(bare[1]);budget=null;}}
  const baseline=q.match(/(?:原套餐|旧套餐|原卡|现在的套餐|现有套餐).{0,10}(?:基础费|基础月费|基础月租|月租)[^\d零〇一二两三四五六七八九十百千]{0,4}([\d零〇一二两三四五六七八九十百千]+)/);
  if(baseline&&positive(chineseNumber(baseline[1]))!==null)result.baselineBaseFee=chineseNumber(baseline[1]);
  const previous=q.match(/(?:原来用|以前用|现在用的?是?|目前用|原套餐叫|旧套餐叫)([^，。！？?!；;]{1,60})/);
  if(previous)result.previousPlanName=previous[1].replace(/(?:每月|一个月|月租|话费|花|交|付).*/, '').trim();
  if(/不知道(?:旧卡|原卡|原套餐)|不知道.*(?:套餐|卡)|没(?:有)?旧卡|新(?:办|开)?卡|先推荐|先给.*推荐/.test(q)||awaiting==='current-plan'&&/^(?:不知道|不晓得|没有|没得|不清楚|先推荐)[。！!?？]*$/.test(q))result.skipPrevious=true;
  if(/(?:通话|电话|分钟|流量|上网).{0,8}不够|不够用|用不够/.test(q)){result.enough=false;result.usageSurplus=false;result.billingConcern=['insufficient'];}
  else if(/够用|用不完|剩很多|用得少|用不完|闲置/.test(q)){result.enough=true;if(/用不完|剩很多|用得少|闲置/.test(q))result.usageSurplus=true;}
  if(/超额|超套|用超|超出了|超出套餐/.test(q)){result.overage=true;result.billingConcern=[...(result.billingConcern||[]),'overage'];}
  if(/太贵|话费贵|费用高|账单贵|消费高|想省钱|便宜点/.test(q))result.billingConcern=[...(result.billingConcern||[]),'expensive'];
  if(/没(?:有)?(?:用)?超|不超|未超/.test(q)){result.overage=false;result.billingConcern=(result.billingConcern||[]).filter(value=>value!=='overage');}
  if(positive(budget)!==null){if(/上限|最多|以内|以下|不超过|不能超过|至多|顶多/.test(q))result.budgetMax=budget;else {result.budgetTarget=budget;result.budgetApprox=true;}}
  const calls=/打(?:电话|话费|话)|通话|语音|分钟(?:数)?/.test(q)&&/多|经常|主要|基本|长|为主|不够/.test(q)&&!/不打|没(?:有)?打|不怎么打|很少打|打得少/.test(q);
  const data=/流量|上网|刷(?:视频|手机|抖音)|看视频/.test(q)&&/多|经常|主要|基本|大|为主|不够/.test(q)&&!/不(?:要|用|怎么用)|很少用|用得少/.test(q);
  if(/都多|都要|两(?:个|种|样)都|均衡|差不多|一样多/.test(q)||calls&&data)result.usage='balanced';else if(data||/不打电话|很少打电话|不怎么打电话|只(?:要|用|上)流量|只上网/.test(q))result.usage='data';else if(calls||/只打电话|通话多|电话多|话费多/.test(q))result.usage='calls';
  if(/港澳台|香港|澳门|台湾|国外|出国|海外|国际漫游/.test(q))result.region='international';
  else if(/不去外地|很少去外地|不(?:会)?出重庆|基本在本地|只在(?:重庆|本地|云阳)|本地用|重庆用|就在云阳|主要在重庆/.test(q))result.region='local';
  else if(/外地|出差|全国|跨省|外出|省外|重庆外|出重庆|在外面/.test(q))result.region='travel';
  else if(awaiting==='region'&&/本地|重庆|云阳|南溪/.test(q))result.region='local';
  if(/不要宽带|不(?:办|装|用|需要|要).*宽带|单卡|只要卡/.test(q))result.broadband=false;else if(/要.*宽带|装.*宽带|办.*宽带|卡加宽带/.test(q))result.broadband=true;
  if(/不是学生|不在读|孩子.{0,5}(?:不上学|没上学)/.test(q))result.student=false;else if(/我是学生|在校学生|学生用|孩子.{0,8}(?:上学|在校|读书)|给.{0,4}(?:学生|读书的孩子)|(?:我|我要).{0,10}读书|(?:去|在).{0,8}(?:读大学|上大学|读高中|上高中)/.test(q))result.student=true;
  const minutes=q.match(/([\d零〇一二两三四五六七八九十百千]+)\s*分钟/),gb=q.match(/(\d+(?:\.\d+)?)\s*(?:GB|G)(?![a-z])/i),people=q.match(/([\d一二两三四五六七八九十]+)\s*(?:个人|人用|人使用)/);
  if(minutes&&positive(chineseNumber(minutes[1]))!==null)result.minutesNeeded=chineseNumber(minutes[1]);if(gb&&positive(Number(gb[1]))!==null)result.dataGBNeeded=Number(gb[1]);if(people)result.people=chineseNumber(people[1]);
  if(/(?:通话|电话|语音|分钟|流量|上网).{0,12}都不用|都(?:不要|不用)(?:电话|流量)?/.test(q)){result.minutesNeeded=0;result.dataGBNeeded=0;result.usage='balanced';}
  return sanitize(result);
}
function mergeProfile(previous,patch){const result={...sanitize(previous),...sanitize(patch)};if(Object.hasOwn(patch||{},'budgetMax')){delete result.budgetTarget;delete result.budgetApprox;}else if(Object.hasOwn(patch||{},'budgetTarget'))delete result.budgetMax;if(!result.budgetMax&&!result.budgetTarget&&result.currentMonthlySpend){result.budgetTarget=result.currentMonthlySpend;result.budgetApprox=true;result.budgetSource='previousSpend';}return sanitize(result);}
function nextQuestion(profile,replyStyle='sichuan'){
  const p=sanitize(profile),dialect=replyStyle!=='mandarin';let awaiting=null,question='',followups=[];
  const complete=(p.budgetMax||p.budgetTarget)&&p.usage&&p.region;
  if(!complete&&!p.skipPrevious&&!Object.keys(p).length){awaiting='current-plan';question=dialect?'现在用啥子卡？一个月大概交好多钱嘛？':'现在使用什么套餐，每月大概支出多少钱？';followups=['不知道旧套餐，先推荐','新办卡'];}
  else if(!complete&&!p.skipPrevious&&(p.currentMonthlySpend||p.previousPlanName)&&p.enough===undefined&&p.overage===undefined&&!p.billingConcern?.length){awaiting='use-check';question=dialect?'现在的通话和流量够不够用？有没有用超了，话费变贵嘛？':'现在的通话和流量够用吗？是否超套导致话费变高？';followups=['够用但想省钱','流量用超了','通话不够用','先推荐'];}
  else if(!p.budgetMax&&!p.budgetTarget){awaiting='budget';question=dialect?'一个月大概想花好多钱嘛？':'每月大概预算多少钱？';followups=['大概60元','大概100元','最多150元'];}
  else if(!p.usage){awaiting='usage';question=dialect?'你平时打电话多些，还是上网多些嘛？':'您主要是通话多，还是上网多？';followups=['打电话多','上网多','两样都多'];}
  else if(!p.region){awaiting='region';question=dialect?'主要在重庆用，还是经常去外地嘛？':'主要在重庆使用，还是经常到外地？';followups=['主要在重庆用','经常去外地','经常出国'];}
  return {awaiting,question,followups:followups.map(question=>({label:question,question}))};
}
function effectiveState(item){const today=c.day();if(item.enabled===false)return 'disabled';if(item.policyStatus==='historical'||item.validTo&&item.validTo<today)return 'historical';if(item.validFrom&&item.validFrom>today)return 'future';return item.policyStatus==='current'?'current':'needs_review';}
function familyOf(item){const text=clean(item.title);if(/4G飞享/i.test(text))return '4g-feixiang';if(/神州行飞享/.test(text))return 'feixiang';if(/巴渝卡.*资费/.test(text))return 'bayu';if(/数字家庭.*套餐权益/.test(text))return 'digital-family';if(/全家享.*月租/.test(text))return 'family';if(/5GA.*套餐权益/i.test(text))return '5ga';if(/校园青春卡.*资费/.test(text))return 'campus';return null;}
function source(item,blockId){const ref=(item.sourceRefs||[]).find(row=>row.blockId===blockId);return {id:item.id+':'+blockId,label:baseName(ref?.file||item.sourceFiles?.[0]?.name)+' · '+(ref?.label||blockId),href:'/knowledge#'+encodeURIComponent(item.id)};}
function numberCell(value){const s=clean(value),match=s.match(/^(\d+(?:\.\d+)?)\s*(?:GB|G|元|元档|分钟)?$/i);return match?Number(match[1]):null;}
function column(headers,pattern){return headers.findIndex(header=>pattern.test(clean(header)));}
function rowValue(headers,row,pattern){const index=column(headers,pattern);return index<0?null:numberCell(row[index]);}
function customerConditions(item,family){
  const blocks=(item.sourceBlocks||[]).filter(block=>block.kind!=='table'&&!/^(?:来源|状态|同义词|业务卡片)/.test(block.text||'')&&!/酬金|积分|激励|佣金|渠道获|利润|成本/.test(block.text||''));
  const conditions=blocks.filter(block=>/仅限|适合|必叠加|承诺|合约|签约|有效期|办理对象|学生身份|主副|副卡|超套|套餐外/.test(block.text||'')).map(block=>clean(block.text));
  if(family==='campus')conditions.push('办理对象和学生身份要求、定向APP和校园使用区域需营业员核对。');
  if(family==='bayu')conditions.push('有效期2年与另一资料签约期3年未区分，不作确定办理承诺。');
  return [...new Set(conditions)].slice(0,8);
}
function catalog(store,user){
  c.permit(user,'learn');const items=(store.employeeKnowledge||[]).filter(item=>['store_policy','store_training'].includes(item.sourceTier)&&!['disabled','historical','future'].includes(effectiveState(item)));let rows=[];
  for(const item of items){const family=familyOf(item);if(!family||item.sourceRevisionNote)continue;
    for(const block of item.sourceBlocks||[]){if(block.kind!=='table'||!Array.isArray(block.rows)||block.rows.length<2)continue;const headers=block.rows[0];if(column(headers,/^月费$/)<0||column(headers,/^(?:语音|通话)/)<0)continue;
      for(let index=1;index<block.rows.length;index++){const values=block.rows[index];const monthlyCell=clean(values[column(headers,/^月费$/)]),monthlyMatch=monthlyCell.match(/^(\d+(?:\.\d+)?)(?:元档)?(?:[（(][^）)]*[）)])?$/);const baseMonthlyFee=monthlyMatch?Number(monthlyMatch[1]):null;if(baseMonthlyFee===null)continue;
        const universalGB=rowValue(headers,values,/^通用流量/),nationalGB=rowValue(headers,values,/^全国流量/),chongqingGB=rowValue(headers,values,/^重庆(?:优惠区|流量)/),directedGB=rowValue(headers,values,/^定向流量/),unspecifiedGB=rowValue(headers,values,/^流量$/),minutes=rowValue(headers,values,/^(?:语音|通话)/);
        const flowLabel=nationalGB!==null?'全国流量':universalGB!==null?'通用流量':'范围待核';const domesticGB=nationalGB??universalGB;
        const feeNote=family==='4g-feixiang'?['基础套餐费；未提供的附加条件仍需核对。',...customerConditions(item,family)].join('；'):family==='feixiang'?'必叠加移动云盘或和留言合约包，费用未填；此为基础套餐费，总月支出待核。':family==='campus'?'基础套餐费；办理资格、定向范围及叠加项待核。':'基础套餐费；副卡、设备、叠加项费用及流量范围待核。';
        const variant=clean(values[column(headers,/^月费$/)]).replace(/^\d+(?:\.\d+)?(?:元档)?/,'');
        const planName=clean(item.title).split(/[：:]/)[0];rows.push({id:item.id+':'+block.id+':'+index,articleId:item.id,family,planName,variant,baseMonthlyFee,totalMonthlyFee:null,feeNote,minutes,voiceMinutes:minutes,nationalGB,universalGB,domesticGB,domesticFlowLabel:flowLabel,chongqingGB,directedGB,unspecifiedGB,exclusiveFlowText:column(headers,/^专属流量/)>=0?clean(values[column(headers,/^专属流量/)]):null,broadband:column(headers,/^宽带$/)>=0?clean(values[column(headers,/^宽带$/)]):null,subcards:rowValue(headers,values,/^副卡$/),commitment:column(headers,/^承诺期$/)>=0?clean(values[column(headers,/^承诺期$/)]):null,conditions:customerConditions(item,family),status:effectiveState(item),reviewReasons:(item.reviewIssues||[]).map(issue=>clean(issue.title)),sourceDocumentDate:item.sourceDocumentDate||item.asOf||null,sources:[source(item,block.id)],eligibleForNewCard:family==='feixiang'?true:null});
      }
    }
  }
  // Keep complete rows for the same plan/version/variant. Never splice later prices into older allowances.
  const groups=new Map();for(const row of rows){const key=[row.planName,row.variant,row.baseMonthlyFee].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  rows=[];for(const group of groups.values()){const date=group.map(row=>row.sourceDocumentDate||'').sort().at(-1);const latest=group.filter(row=>(row.sourceDocumentDate||'')===date);const signature=row=>JSON.stringify([row.baseMonthlyFee,row.minutes,row.domesticGB,row.chongqingGB,row.directedGB,row.unspecifiedGB,row.broadband,row.subcards,row.commitment,row.status,row.conditions]);const distinct=[...new Set(latest.map(signature))];for(const row of latest){if(distinct.length>1){row.status='needs_review';row.reviewReasons.push('同日同档资料不一致，需核对版本。');}if(!rows.some(existing=>existing.planName===row.planName&&existing.variant===row.variant&&existing.baseMonthlyFee===row.baseMonthlyFee&&signature(existing)===signature(row)))rows.push(row);}}
  const pending=items.filter(item=>item.policyStatus==='needs_review'&&(familyOf(item)||/推荐卡|预算|全家预算|转移动/.test(item.title||''))).map(item=>({id:item.id,title:item.title,summary:item.summary||'具体资费与办理条件待核。',sources:[source(item,item.sourceBlocks?.[0]?.id||'body')]}));
  const domesticNote='通用/全国流量用于中国内地，不含港澳台和国外；重庆流量与定向流量分开比较，不能相加当作全国通用流量。';
  const classifications=[
    {key:'calls',label:'通话多',basis:'按语音分钟比较，实际用量和预算确认后再选。',rowIds:rows.filter(row=>row.status==='current'&&row.minutes!==null).sort((a,b)=>b.minutes-a.minutes||a.baseMonthlyFee-b.baseMonthlyFee).map(row=>row.id)},
    {key:'data',label:'流量多',basis:'全国/通用、重庆、定向分列，按常用地区和APP比较，不能把不同范围合成通用流量。',rowIds:rows.filter(row=>row.domesticGB!==null||row.chongqingGB!==null||row.directedGB!==null).map(row=>row.id)},
    {key:'local',label:'主要在重庆',basis:'重庆优惠流量只作本地参考；巴渝具体签约期和资格仍待核。',rowIds:rows.filter(row=>row.chongqingGB!==null).map(row=>row.id)},
    {key:'travel',label:'经常到外地',basis:'只比较明确写全国/通用的流量，重庆、校园和定向流量不当全国通用。',rowIds:rows.filter(row=>row.status==='current'&&row.domesticGB!==null).map(row=>row.id)}
  ];
  return {rows,pending,domesticNote,classifications,counts:{plans:rows.length,current:rows.filter(row=>row.status==='current').length,needsReview:rows.filter(row=>row.status!=='current').length},sources:[...new Map(rows.flatMap(row=>row.sources).map(row=>[row.id,row])).values()]};
}
function tableRows(rows){return rows.map(row=>[row.planName+(row.variant||''),String(row.baseMonthlyFee)+'元（基础）',row.domesticGB===null?'范围未明确':row.domesticFlowLabel+' '+row.domesticGB+'GB',row.chongqingGB===null?'未列明':row.chongqingGB+'GB',row.directedGB===null?(row.exclusiveFlowText||'未列明'):row.directedGB+'GB（APP待核）',row.unspecifiedGB===null?'—':row.unspecifiedGB+'GB（范围待核）',row.minutes===null?'未列明':row.minutes+'分钟',row.status==='current'?'店内现行参考，资格/总费仍须核对':'待核实',[...row.conditions,row.feeNote].join('；')]);}
function makeTable(title,rows){return {title,columns:[{key:'planName',label:'套餐版本'},{key:'baseMonthlyFee',label:'基础月费'},{key:'voiceMinutes',label:'通话（分钟/月）'},{key:'domesticGB',label:'全国/通用流量（GB/月）'},{key:'chongqingGB',label:'重庆流量（GB/月）'},{key:'directedGB',label:'定向流量（GB/月）'},{key:'unspecifiedGB',label:'范围待核流量（GB/月）'},{key:'statusLabel',label:'资料状态'},{key:'feeNote',label:'费用与限制'}],rows:rows.map(row=>({...row,planName:row.planName+(row.variant||''),statusLabel:row.status==='current'?'现行参考，资格/总费另核':'待核实',feeNote:[...row.conditions,row.feeNote].join('；')}))};}
function adjustment(profile){
  if(profile.enough===false||profile.overage||profile.billingConcern?.includes('insufficient'))return {direction:'compare-upgrade-or-addon',adjustmentAdvice:'可比较升档或合适加包，总费用先核实。'};
  if(profile.usageSurplus)return {direction:'compare-downgrade',adjustmentAdvice:'可比较降档，先核原合约和实际总费。'};
  if(profile.billingConcern?.includes('expensive')&&!profile.enough)return {direction:'check-bill',adjustmentAdvice:'先查超套、附加业务和优惠到期原因。'};
  if(profile.enough&&profile.billingConcern?.includes('expensive'))return {direction:'compare-lower-spend',adjustmentAdvice:'比较更低支出方案，先核实际费用和合约。'};
  return {direction:'compare',adjustmentAdvice:''};
}
function result(answer,rows,profile,replyStyle,extra={}){if(Array.isArray(extra.followups))extra={...extra,followups:extra.followups.map(value=>typeof value==='string'?{label:value,question:value}:value)};const advice=adjustment(profile);const refs=[...new Map(rows.flatMap(row=>row.sources||[]).map(row=>[row.id,row])).values()].slice(0,20);return {answer,adjustmentAdvice:advice.adjustmentAdvice,sources:refs,action:{type:'navigate',label:'查看资费资料与出处',href:'/knowledge'},metrics:{kind:'tariff-recommendations',replyStyle,referenceOnly:true,knowledge:true,profile,direction:advice.direction,...extra.metrics},conversationHint:{topic:'tariff-recommendations',profile,awaiting:null},...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='metrics'))};}
function query(store,user,question,options={}){
  const q=clean(question).slice(0,500),replyStyle=options.customerReplyStyle==='mandarin'?'mandarin':'sichuan';if(!q)return null;
  if(/接待案例|办卡案例|销售卡案例|训练案例|选号话术/.test(q))return null;
  const ledger=/库存|串号|销售单|流水|订单|到账|实收|应收|应付|工资|毛利|利润|出勤|酬金|佣金|积分|奖励|红包|充值(?:了|到账)|(?:今天|昨天|本月|这月).{0,15}(?:办了|开了|销售|卖了|多少(?:张|笔|单))/.test(q);
  const mutation=/提交|审批|付款|支付|发红包|删除|改价|红冲|录入|开单|销售|卖出|售出|成交/.test(q);
  if(ledger||mutation||/银行卡|信用卡|充值卡|卡住|维修|故障|不(?:想|要|用|需要).{0,4}(?:买|办|开)卡/.test(q)||/补卡|挂失|销户|过户|携号转网.{0,8}(?:流程|步骤)|实名|身份证/.test(q))return null;
  const card=/号卡|手机卡|电话卡|移动卡|套餐|资费|买号码|办号码|开号码|(?:买|办|办理|开|选|挑|推荐)(?:个|一张|张|一个|种)?卡|卡(?:资源|资费|套餐|推荐|哪种|哪些|怎么选)|(?:什么|哪些|哪种|哪个|有啥子|有没得).{0,6}卡|卡.{0,6}(?:有哪些|有啥|哪个好)/.test(q),detail=/整理|所有|全部|分类|清单|资源|一览/.test(q);
  const recommend=/推荐|适合|划算|选择|选哪|有哪些|哪种|哪款|办(?:什么|哪种|哪张)卡|(?:买|办|开|办理)(?:个|一张|张|一个|种)?(?:手机|电话|移动|号)?卡|(?:买|办|开)号码|来.*卡/.test(q);
  const namedPolicy=/巴渝卡|神州行|飞享|校园|青春卡|全家享|全家乐|5ga|数字家庭|数家/i.test(q)&&/资费|多少(?:分钟|流量|GB|G)|月费|月租|费用|收费|多少钱|套餐外|超套|超出|超额|合约|有效期/i.test(q);
  if(namedPolicy&&!recommend&&!detail)return null;
  const mobileNeed=/推荐移动业务|移动业务推荐|(?:移动业务|手机业务).{0,6}(?:推荐|适合)|话费(?:太|好)?贵|(?:流量|通话|电话).{0,6}不够|(?:想|要|准备|打算).{0,5}(?:装|办|安装)宽带|家里.{0,8}宽带/.test(q);
  const patch=parseProfile(q,options.awaiting),profile=mergeProfile(options.profile,patch);
  const otherProduct=/华为|荣耀|oppo|vivo|小米|红米|苹果|iphone|功能机|老人机|数码|配件|赠品|串码/i.test(q);
  const wantsDetails=/详细|详情|条件|资格|合约|限制/.test(q);
  const contextual=options.profile&&typeof options.profile==='object'&&(Object.keys(patch).length>0||wantsDetails)&&!otherProduct;
  if(!card&&!contextual&&!mobileNeed)return null;if(!detail&&!recommend&&!contextual&&!mobileNeed&&!Object.keys(patch).length)return null;
  if(mobileNeed&&!Object.keys(profile).length)return result(replyStyle==='sichuan'?'这位顾客主要想省话费、补流量、通话够用，还是装宽带嘛？':'顾客主要想降低话费、增加流量、满足通话，还是安装宽带？',[],profile,replyStyle,{metrics:{needsClarification:true},conversationHint:{topic:'tariff-recommendations',profile,awaiting:'needs'},followups:['顾客话费太贵，想省钱','顾客流量不够用','顾客通话不够用','家里想装宽带']});
  const data=catalog(store,user);
  if(detail){const answer='已按通话、上网、本地和外地用途整理 '+data.counts.plans+' 个基础套餐档。全国/通用、重庆和定向流量分列；待核版本、优惠净价和叠加费用不作确定报价。';const sections=[{title:'基础套餐资源（总费用和资格另核）',headers:['套餐/版本','基础月费','全国/通用流量','重庆流量','定向/专属流量','未明确范围流量','语音','状态','条件'],rows:tableRows(data.rows)}];return result(answer,data.rows,profile,replyStyle,{sections,tariffCatalog:data,table:makeTable('全部基础套餐资源（总费用及资格另核）',data.rows),metrics:{catalog:true,counts:data.counts,classifications:data.classifications}});}
  if(profile.region==='international')return result(replyStyle==='sichuan'?'港澳台和国外不能拿国内通用流量来算哦。先说去哪个地方，我再帮你核对专门的漫游资费。':'港澳台和国外不在国内通用流量范围。请先说明目的地，再核对专门的漫游资费。',[],profile,replyStyle,{metrics:{needsClarification:true,international:true},followups:['香港','澳门','台湾','国外其他地方']});
  const next=nextQuestion(profile,replyStyle);if(next.awaiting)return result(next.question,[],profile,replyStyle,{metrics:{needsClarification:true},conversationHint:{topic:'tariff-recommendations',profile,awaiting:next.awaiting},followups:next.followups});
  if(profile.billingConcern?.includes('expensive')&&!profile.billingConcern.includes('insufficient')&&!profile.overage&&!profile.usageSurplus&&!profile.enough)return result(replyStyle==='sichuan'?'话费贵是因为用超了，还是有附加业务、优惠到期嘛？先核这个原因，再看降档还是换方案。':'话费高是超套、附加业务还是优惠到期？请先核对原因，再比较降档或换套餐。',[],profile,replyStyle,{metrics:{needsClarification:true,billingCauseRequired:true},conversationHint:{topic:'tariff-recommendations',profile,awaiting:'billing-concern'},followups:['流量用超了','通话不够用','用量很少，想降档']});
  let candidates=data.rows.filter(row=>row.status==='current'&&(row.family!=='campus'||profile.student===true)&&(profile.region!=='travel'||row.domesticGB!==null));
  if(profile.broadband===true)candidates=candidates.filter(row=>row.broadband);else if(profile.broadband===false||(!profile.broadband&&(!profile.people||profile.people===1)))candidates=candidates.filter(row=>!row.broadband);
  if(profile.budgetMax)candidates=candidates.filter(row=>row.baseMonthlyFee<=profile.budgetMax);
  const target=profile.budgetMax||profile.budgetTarget;
  if(profile.usageSurplus&&profile.baselineBaseFee)candidates=candidates.filter(row=>row.baseMonthlyFee<profile.baselineBaseFee);
  if(profile.budgetTarget)candidates=candidates.filter(row=>Math.abs(row.baseMonthlyFee-target)<=Math.max(20,target*.3));
  const flow=row=>profile.region==='travel'?row.domesticGB:(row.domesticGB??row.unspecifiedGB);
  if(profile.minutesNeeded)candidates=candidates.filter(row=>row.minutes!==null&&row.minutes>=profile.minutesNeeded);if(profile.dataGBNeeded)candidates=candidates.filter(row=>flow(row)!==null&&flow(row)>=profile.dataGBNeeded);
  candidates.sort((a,b)=>{if(profile.minutesNeeded===0&&profile.dataGBNeeded===0)return a.baseMonthlyFee-b.baseMonthlyFee;const volume=row=>profile.usage==='calls'?(row.minutes??-1):profile.usage==='data'?(flow(row)??-1):(row.minutes??0)/300+(flow(row)??0)/20;const delta=volume(b)-volume(a);return delta||Math.abs(a.baseMonthlyFee-target)-Math.abs(b.baseMonthlyFee-target)||a.baseMonthlyFee-b.baseMonthlyFee;});
  const selected=candidates.slice(0,wantsDetails?3:2);if(!selected.length)return result('现有已核资料没有同时满足这些条件的基础套餐。可以调整预算或用量；未核实的巴渝、优惠净价和漫游方案请营业员核对后再推荐。',[],profile,replyStyle,{metrics:{noVerifiedMatch:true,needsReview:true},followups:['换个预算','整理所有卡资源']});
  const lead=replyStyle==='sichuan'?'先拿这几个基础档来比嘛：':'可以先比较这几个基础档：';const lines=selected.map(row=>row.planName+row.variant+' '+row.baseMonthlyFee+'元基础费，'+row.minutes+'分钟、'+(row.domesticGB!==null?row.domesticGB+'GB'+row.domesticFlowLabel:row.unspecifiedGB+'GB（范围待核）'));
  const basis=profile.usage==='calls'?'按通话分钟优先':profile.usage==='data'?'按可核对流量优先':'兼顾通话和流量';const budget=profile.budgetSource==='previousSpend'?'用原来的实际月支出作参考；不能据此认定原套餐或总费。':profile.budgetMax?'基础费按你说的上限筛选；总支出还未核准。':'围绕你说的大概预算比较，不把它当硬上限。';
  return result(lead+lines.join('；')+'。'+(wantsDetails?basis+'。'+budget:'')+(adjustment(profile).adjustmentAdvice?adjustment(profile).adjustmentAdvice:'')+'以上仅基础费，总支出还未核准，资格与合约请营业员确认。',selected,profile,replyStyle,{tariffOptions:selected,table:makeTable('基础档比较（总费用待核）',selected),sections:[{title:'基础档比较',headers:['套餐/版本','基础月费','全国/通用流量','重庆流量','定向/专属流量','未明确范围流量','语音','状态','条件'],rows:tableRows(selected)}],metrics:{recommendedIds:selected.map(row=>row.id),baseFeesOnly:true,needsReview:true,details:wantsDetails,budgetComparison:budget},followups:['再看详细条件','整理所有卡资源']});
}
module.exports={query,catalog,parseProfile,mergeProfile,nextQuestion};
