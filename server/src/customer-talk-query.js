const c = require('./common');
const batch = 'customer-talk-20261009';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s“”‘’（）()，,。？?：:、·「」！!]/g, '');
const baseName = value => clean(value).replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || '店内来源文件';

// These are the documented reception scenarios, not a general language model.
const routes = [
  { topic:'transfer', score:100, matches:q => /(?:副卡|手机号|号码|手机卡|电话卡).{0,14}(?:改|换|转).{0,10}(?:自己|我的|名字|名下)|(?:副卡|号码).{0,10}过户|(?:过户|改户主|换户主)/.test(q) },
  { topic:'real-name', score:100, matches:q => /(?:办卡|开卡|开户|实名|身份证)/.test(q) && /本人|到场|代办|身份证/.test(q) && /要|需要|能|可以|必须|一定|不用|吗|怎么/.test(q) },
  { topic:'porting60', score:95, matches:q => /(?:联通|电信).{0,14}(?:转|换).{0,8}移动|携号转网|携转|转网/.test(q) },
  { topic:'e-bike', score:95, matches:q => /电动车|电瓶车/.test(q) && /领|送|拿|活动|免费|怎么|能|可以|真/.test(q) },
  { topic:'second-broadband', score:95, matches:q => /宽带/.test(q) && /老家|另一|第二|再装|另外装|另外一条|两条|二宽/.test(q) },
  { topic:'family150', score:90, matches:q => /两三个人|二三个人|一家|家里|全家|多人|一家人|三个人|两个人/.test(q) && /一百五六|一百五十|一百六十|一百多|(?:^|\D)(?:150|160)(?:\D|$)/.test(q) },
  { topic:'only-data', score:85, matches:q => /只(?:想)?要(?:个)?(?:流量|上网)|(?:不打|很少打|不要打|不想打).{0,8}(?:电话|通话)|纯流量|流量卡/.test(q) },
  { topic:'data-shortage', score:80, matches:q => /流量.{0,8}(?:不够|少|不足|用完|用得多|费得快)|(?:不够|不足).{0,5}流量/.test(q) },
  { topic:'budget60', score:75, matches:q => /预算|月费|话费|套餐|每月|每个月|一个月|办卡|开卡/.test(q) && /五六十|五六十元|五十|六十|(?:^|\D)(?:50|59|60)(?:\D|$)/.test(q) },
  { topic:'budget80', score:75, matches:q => /预算|月费|话费|套餐|每月|每个月|一个月|办卡|开卡/.test(q) && /七八十|八十|(?:^|\D)(?:79|80)(?:\D|$)/.test(q) },
  { topic:'broadband', score:70, matches:q => /装(?:个|一条)?宽带|宽带.{0,16}(?:多少钱|怎么收费|怎么办|想装|要装)|(?:我要|我想|想).{0,6}宽带/.test(q) },
  { topic:'subsidy', score:70, matches:q => /国补|以旧换新|换新补贴/.test(q) && /怎么买|怎么办|多少钱|多少|能不能|可以|怎么用|想换|换手机|买手机|怎么领|怎么弄|活动|有什么|还有吗|怎么补|以旧换新/.test(q) },
  { topic:'start-card', score:60, matches:q => /(?:办|开|换|选)(?:个|一张|张|一个|种|哪种)?(?:手机|电话|移动)?卡/.test(q) && /哪[种个]|什么|哪个|推荐|怎么[选办]|好|划算|合适|我想|我要/.test(q) },
  { topic:'principles', score:50, matches:q => /口水话|口语/.test(q) && /原则|注意|怎么接|怎么答|怎么说|应答|回复|学习/.test(q) },
  { topic:'guide', score:50, matches:q => /推荐卡|推荐(?:号|手机|电话)?卡|选卡/.test(q) && /话术|指南|怎么说|怎么接|学习|流程/.test(q) },
  { topic:'quick', score:50, matches:q => /快速|速查|常用/.test(q) && /接话|应答|话术|口水话/.test(q) },
  { topic:'unclear', score:50, matches:q => /听不懂|没听懂|不清楚|说不清|不明确|含糊/.test(q) && /客户|顾客|话术|怎么问|怎么接|怎么说|应答|回复/.test(q) },
];
const ledger = /库存|营业额|销量|毛利|出勤|签到|签退|卖了|售出|成交了|资金|流水号|流水单|账套|到账|已收|实际收到|应收|应付|收入|支出|订单|单号|串号|串码|imei|工资|提成|结算单|支付了|进了什么货/i;
const action = /(?:帮我|给我|替我|立即|马上|现在).{0,16}(?:开(?:张|一张|个|一下)?单|开.{0,5}(?:销售|接待|业务)单|录入|新建|提交|保存|审批|支付|发红包|改价|调价|删除|清空|覆盖(?:数据|记录|账目|资料|配置))|(?:确认|执行)(?:入库|出库|收款|退款|付款)|(?:新建|建立|填写|录入|保存|提交).{0,8}(?:销售|接待|业务|采购|赠品)单|开(?:一张|个|张)(?:销售|接待|业务|采购)?单/;
const policyWords = /政策|资费|规则|条件|流程|步骤|合约|违约|承诺|互斥|多少(?:g|gb|分钟)|几(?:g|gb)|有效期/i;
const productName = /巴渝卡|全家享|全家乐|青春卡|校园卡|神州行|飞享|数字家庭|数家|和包|ai豆|金币|5ga|fttr|全光|百g流量|话费券/i;
const trainingWords = /话术|接话|口水话|口语|推销|销售技巧|顾客(?:说|问)|客户(?:说|问)|怎么(?:说|推荐|接|答)|如何(?:说|推荐|接|答)|学习|培训/;


function interjections(value) {
  return norm(value).replace(/^(?:(?:你好|您好|喂|那个|嗯|诶|哎|对了|请问|我想问一下|我想问下|麻烦问一下|麻烦问下|问一下|问下|不好意思))+/, '').replace(/(?:啊|呀|哦|喔|呢|嘛|咯|噻|唻|哈)+$/, '');
}
function negative(value) {return /不|没|无|未|莫|别/.test(value);}
function numbers(value) {
  return [...String(value).matchAll(/\d+(?:\.\d+)?|[零〇一二三四五六七八九十百千万两幺]+(?=元|块|人|张|条|个|月|年|天|分钟|g|gb)/gi)].map(match=>match[0].toLowerCase());
}
function businessAnchors(value) {
  return [['new',/新办|新开|新卡|新套餐|新版/],['old',/旧(?:卡|版|套餐)|老(?:卡|版|套餐)/],['replacement',/补卡/],['secondary',/副卡/],['primary',/主卡/],['ownership',/过户|改户主|换户主/],['close',/销户|销卡/],['separate',/分户/]].filter(([,pattern])=>pattern.test(value)).map(([key])=>key);
}
function knownCards(items) {
  return items.filter(item=>item.enabled!==false && item.importBatch===batch && item.sourceTier==='store_training');
}
function mappingEntries(items) {
  return items.flatMap(item=>(Array.isArray(item.dialectMappings)?item.dialectMappings:[]).map(mapping=>({...mapping,item,from:clean(mapping.from),to:(Array.isArray(mapping.to)?mapping.to:[mapping.to]).map(clean).filter(Boolean)}))).filter(entry=>entry.from&&entry.from.length<=80&&entry.to.length&&entry.to.every(value=>value.length<=120));
}
function usableMappings(entries) {
  const groups=new Map();
  for(const entry of entries){if(entry.item.sourceRevisionNote||['historical','future'].includes(state(entry.item)))continue;const from=norm(entry.from);if(!groups.has(from))groups.set(from,[]);groups.get(from).push(entry);}
  const result=[];
  for(const [from,rows] of groups){
    const values=[...new Set(rows.flatMap(row=>row.to.map(norm)))];
    if(values.length!==1 || rows.some(row=>row.requiresContext||row.needsContext||row.ambiguous) || from==='二天')continue;
    const to=values[0];
    if(negative(from)!==negative(to) || numbers(from).join('|')!==numbers(to).join('|') || businessAnchors(from).join('|')!==businessAnchors(to).join('|'))continue;
    result.push({from,to});
  }
  return result.sort((a,b)=>b.from.length-a.from.length);
}
function phrase(value,mappings) {
  const initial=interjections(value);
  if(!mappings.length)return initial;
  const alternatives=mappings.map(row=>row.from.replace(/[.*+?^$\{\}()|[\]\\]/g,character=>'\\'+character));
  const byFrom=new Map(mappings.map(row=>[row.from,row.to]));
  return interjections(initial.replace(new RegExp(alternatives.join('|'),'g'),word=>byFrom.get(word)));
}
function taughtMappings(question,entries) {
  if(!/意思|怎么说|啷个说|翻译|方言|普通话|云阳话/.test(question))return null;
  const asked=norm(question),matching=entries.filter(entry=>asked.includes(norm(entry.from)));
  if(!matching.length)return null;
  const longest=Math.max(...matching.map(entry=>norm(entry.from).length));
  return matching.filter(entry=>norm(entry.from).length===longest);
}
function modificationPaused(item) {return !!item.sourceRevisionNote;}
function currentStamp(item) {return clean(item.sourceDocumentDate||item.asOf).replace(/\D/g,'').slice(0,8);}
function latest(rows) {const best=rows.map(row=>currentStamp(row.item)).sort().at(-1)||'';return rows.filter(row=>currentStamp(row.item)===best);}
function fullSentenceTag(tag) {return norm(tag).length>=5 && /我|顾客|客户|怎么|哪里|有没有|为什么|需要|可不可以|能不能|多少钱|想|办|开/.test(tag);}
function keywordMatch(item,question,mappings) {
  const groups=item.matchKeywords;
  if(!Array.isArray(groups)||!groups.length||!groups.every(group=>Array.isArray(group)&&group.length&&group.some(term=>norm(term).length>=1&&question.includes(phrase(term,mappings)))))return false;
  const examples=[...(item.customerQuestions||[]),...(item.tags||[])].map(text=>phrase(text,mappings));
  const definitions=[...examples,...groups.flat().map(text=>phrase(text,mappings))];
  if(negative(question) && !examples.some(negative))return false;
  if(!negative(question) && examples.length && examples.every(negative))return false;
  if(numbers(question).some(number=>!definitions.some(text=>numbers(text).includes(number))))return false;
  const anchors=businessAnchors(question);
  if(anchors.some(anchor=>!definitions.some(text=>businessAnchors(text).includes(anchor))))return false;
  return true;
}
function clarify(rows,replyStyle) {
  const selected=rows.slice(0,6);
  return {answer:(replyStyle==='sichuan'?'你想先了解哪样？':'您想先了解哪一种？')+selected.map(row=>row.item.title).join('；')+'。',sources:selected.flatMap(row=>sources(row.item).slice(0,1)),action:{type:'navigate',label:'选择接话资料',href:'/knowledge'},metrics:{knowledge:true,kind:'customer-talk-guidance',replyStyle,needsClarification:true,referenceOnly:true,articleIds:selected.map(row=>row.item.id)}};
}

function state(item) {
  const today=c.day();
  if(item.policyStatus==='historical' || item.validTo && item.validTo<today) return 'historical';
  if(item.validFrom && item.validFrom>today) return 'future';
  return item.policyStatus==='current' ? 'current' : 'needs_review';
}
function sources(item) {
  if(item.sourceRevisionNote || item.editedAfterImport) return [{id:item.id+':edit-v'+(item.version||1),label:item.title+' · 老板修订第 '+(item.version||1)+' 版',href:'/knowledge#'+encodeURIComponent(item.id)}];
  const refs=Array.isArray(item.sourceRefs)?item.sourceRefs:[];
  const mainFile=item.sourceFiles?.find(file=>!file.duplicateOf)?.name || item.sourceFiles?.[0]?.name;
  return (refs.length?refs:[{file:mainFile,label:item.title}]).slice(0,3).map(ref=>({id:item.id+(ref.blockId?':'+ref.blockId:''),label:baseName(ref.file||mainFile)+' · '+clean(ref.label||ref.blockId||item.title),href:'/knowledge#'+encodeURIComponent(item.id)}));
}
function result(item,text,extra={}) {
  return {answer:text,sources:sources(item),action:{type:'navigate',label:'查看接话资料与出处',href:'/knowledge#'+encodeURIComponent(item.id)},metrics:{knowledge:true,kind:'customer-talk-guidance',articleId:item.id,version:item.version||1,sourceTier:item.sourceTier,policyStatus:state(item),asOf:item.asOf||null,referenceOnly:true,...extra}};
}

function colloquial(summary) {
  return clean(summary).replace(/您/g,'你').replace(/什么/g,'啥子').replace(/怎么/g,'啷个').replace(/这样/g,'这样子');
}
function spokenSummary(item,replyStyle) {
  const current=clean(item.summary);
  if(replyStyle==='mandarin')return current;
  const dialect=clean(item.summaryDialect);
  // A cached dialect summary cannot silently override a later owner edit.
  if(item.editedAfterImport || !dialect || negative(current)!==negative(dialect) || numbers(current).join('|')!==numbers(dialect).join('|'))return colloquial(current);
  return dialect;
}

function query(store,user,question,items=[],options={}) {
  const replyStyle=options?.customerReplyStyle==='mandarin'?'mandarin':'sichuan';
  const reply=(item,text,extra={})=>result(item,text,{replyStyle,...extra});
  const q=clean(question).slice(0,500),nq=norm(q);
  if(!q)return null;
  const candidates=knownCards(items);
  if(!candidates.length)return null;
  const mappingRows=mappingEntries(candidates),mappings=usableMappings(mappingRows),normalized=phrase(q,mappings);
  const exactTitle=candidates.filter(item=>norm(item.title).length>=4 && nq.includes(norm(item.title)));
  const exactQuestions=candidates.filter(item=>[...(Array.isArray(item.customerQuestions)?item.customerQuestions:[]),...(item.tags||[]).filter(fullSentenceTag)].some(text=>phrase(text,mappings)===normalized));
  const businessStats=/(?:今天|昨天|昨日|本周|本月|这月|20\d{2}[-年/.])/.test(q) && /统计|汇总|核算|多少(?:笔|张|单|个|人)|几(?:笔|张|单|个|人)|办了|开了|办理了|开通了/.test(q);
  const rebatePolicy=/返费|返话费|返的钱/.test(q) && /到账|什么时候|哪个月|哪个时候|何时|多久/.test(q) && !/今天|昨天|昨日|本周|本月|这月|20\d{2}[-年/.]|酬金|实际|已经|已到|我们|店里|老板|单号|资金/.test(q);
  const otherLedger=ledger.test(q.replace(/到账/g,''));
  if((ledger.test(q)&&!(rebatePolicy&&!otherLedger)) || action.test(q) || businessStats || /开单|录入|提交|保存|审批|发红包|改价|调价|删除|清空|覆盖(?:数据|记录|账目|资料|配置)/.test(q))return null;
  // A documented customer question can contain dialect words without being a dictionary lesson.
  const teaching=!exactTitle.length&&!exactQuestions.length?taughtMappings(q,mappingRows):null;
  if(teaching?.length){
    c.permit(user,'learn');
    const unique=new Map();for(const row of teaching){const key=norm(row.from)+'|'+row.to.map(norm).join('|');if(!unique.has(key)||currentStamp(row.item)>currentStamp(unique.get(key).item))unique.set(key,row);}
    const rows=[...unique.values()].slice(0,6),multiple=rows.some(row=>row.to.length>1||row.requiresContext||row.needsContext||row.ambiguous||norm(row.from)==='二天') || rows.length>1;
    const edited=rows.some(row=>modificationPaused(row.item));
    if(edited)return reply(rows[0].item,'这份方言资料已修订。请查看当前正文核对，暂不沿用原来的词组映射。',{needsReview:true,automaticGuidancePaused:true});
    const text=rows.map(row=>row.from+'：'+row.to.join(' / ')+(multiple?'；要结合上下文，不能直接替换成一个固定意思。':'。')).join('\n');
    return {answer:'店内方言参考：'+text+'\n依据您提供的资料，未作权威语言核验。',sources:rows.flatMap(row=>sources(row.item).slice(0,1)),action:{type:'navigate',label:'查看方言资料与出处',href:'/knowledge#'+encodeURIComponent(rows[0].item.id)},metrics:{knowledge:true,kind:'customer-talk-guidance',replyStyle,dialectTeaching:true,needsContext:multiple,needsReview:rows.some(row=>state(row.item)!=='current'),referenceOnly:true,articleIds:rows.map(row=>row.item.id)}};
  }

  let ranked;
  if(exactTitle.length)ranked=exactTitle.map(item=>({item,score:200+norm(item.title).length}));
  else if(exactQuestions.length)ranked=latest(exactQuestions.map(item=>({item,score:200})));
  else {
    const training=trainingWords.test(q);
    if(!training && !rebatePolicy && (productName.test(q)||policyWords.test(q)))return null;
    const keywords=candidates.filter(item=>keywordMatch(item,normalized,mappings)).map(item=>({item,score:150}));
    if(keywords.length)ranked=keywords;
    else ranked=candidates.map(item=>({item,score:routes.find(route=>route.topic===item.conversationTopic&&route.matches(normalized)&&(!negative(normalized)||['only-data','data-shortage','real-name','unclear'].includes(route.topic)))?.score||0})).filter(row=>row.score>0);
  }
  if(!ranked.length)return null;
  ranked.sort((a,b)=>b.score-a.score);
  let matches=ranked.filter(row=>row.score===ranked[0].score);
  c.permit(user,'learn');
  if(matches.length>1){
    const topics=new Set(matches.map(row=>row.item.conversationTopic||row.item.id));
    const words=matches.map(row=>(row.item.customerQuestions||[]).map(text=>phrase(text,mappings)));
    const sharedQuestion=words.length&&words[0].some(word=>words.every(list=>list.includes(word)));
    if(topics.size===1||sharedQuestion)matches=latest(matches);
    if(matches.length>1){const texts=new Set(matches.map(row=>clean(row.item.summary)+'|'+state(row.item)+'|'+row.item.sourceRevisionNote));if(texts.size!==1)return clarify(matches,replyStyle);matches=[matches[0]];}
  }
  const item=matches[0].item,policyState=state(item),raw=/(?:查看|显示|阅读|展开|调出|拿出|想看|要看).{0,30}(?:原文|全文|原始资料|原始内容)|(?:原文|全文|原始资料|原始内容)(?:$|[。？?！!])|^(?:原文|全文)[:：]/.test(q),edited=modificationPaused(item);
  if(raw) {
    const note=edited?'老板修订内容，仅供核对，尚未恢复自动接话。':policyState==='current'?'以下为接话资料原文，不代表具体业务已核实。':'以下为待核实或非现行资料原文，含未确定的报价或条件，不可作为办理承诺。';
    return reply(item,note+'\n'+clean(item.body),{needsReview:edited||policyState!=='current',originalRequested:true,automaticGuidancePaused:edited});
  }
  if(edited)return reply(item,'这张接话资料的正文已由老板修订，自动接话暂缓使用。可打开修订内容，或明确要求查看全文。',{needsReview:true,automaticGuidancePaused:true});
  if(policyState==='historical'||policyState==='future')return reply(item,'这张接话资料尚不能作为当前参考，请先核对现行资料。',{needsReview:true});
  const summary=spokenSummary(item,replyStyle);
  if(!summary)return reply(item,'这张资料还没有核定的简短接话，请先查看资料核对。',{needsReview:true});
  const detail=/详细|具体|展开|多少钱|金额|报价|费用|收费/.test(q);
  const reminder=policyState==='needs_review'||detail ? (replyStyle==='sichuan'?'\n办理前，营业员要先核对移动 BOSS 的资费、资格和活动条件。':'\n办理前由营业员核对移动 BOSS 的资费、资格和活动条件。') : '';
  return reply(item,'接话参考：'+summary+reminder,{needsReview:policyState!=='current',summaryOnly:true});
}
module.exports={query};
