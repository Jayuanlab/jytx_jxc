const c = require('./common');
const importedTiers = new Set(['store_policy','store_training','store_exam']);
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s“”‘’（）()，,。？?：:、·]/g,'');
const fileName = value => clean(value).replace(/\\/g,'/').split('/').filter(Boolean).at(-1) || '店内来源文件';
const day = value => clean(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
// Treat spoken amounts as the same tariff; keep ambiguous ranges unchanged.
function normalizeQuestion(value) {
  return clean(value).normalize('NFKC').replace(/([\d零〇一二两三四五六七八九十]+(?:\.\d+)?)\s*(?:块(?:钱)?|元)/g,(match,amount)=>{
    if(!/^(?:\d{1,3}(?:\.\d+)?|[一二两三四五六七八九]|[一二两三四五六七八九]?十[一二三四五六七八九]?)$/.test(amount))return match;
    const fee=require('./assistant-tariff-query').parseProfile(amount+'元').budgetTarget;
    return Number.isFinite(fee)?fee+'元':match;
  });
}
const groups = [
  {id:'ai-care-promo',terms:['AI守护礼','5元看家','移动看家'],pattern:/AI守护礼|移动看家|看家.{0,8}5元|5元.{0,8}(?:看家|摄像头|监控)|(?:摄像头|监控).{0,8}5元/i},
  {id:'pan-screen',terms:['泛屏','AI灵犀屏','灵犀屏','璨彩超高清','OTV'],pattern:/泛屏|灵犀屏|璨彩超高清|OTV/i},
  {id:'pad-incentive',terms:['移动爱家PAD','爱家PAD'],pattern:/移动爱家PAD|爱家PAD/i},
  {id:'other-terminal-incentive',terms:['异业购'],pattern:/异业购/},
  {id:'porting',terms:['携号转网','携转','转网'],pattern:/携号转网|携转|转网/},
  {id:'sim-replace',terms:['补卡','异地补卡'],pattern:/补卡/},
  {id:'ownership',terms:['过户','销户','换户主','改名字'],pattern:/过户|销户|换户主|改名字/},
  {id:'shuncha',terms:['顺差让利','顺差','机卡合一'],pattern:/顺差让利|顺差|机卡合一/},
  {id:'campus',terms:['校园青春卡','校园卡','青春卡','动感地带'],pattern:/校园|青春卡|动感地带/},
  {id:'bayu',terms:['巴渝卡','巴渝'],pattern:/巴渝/},
  {id:'feixiang',terms:['神州行飞享','飞享'],pattern:/飞享/},
  {id:'family2025',terms:['全家乐','多人保底'],pattern:/全家乐|多人保底/},
  {id:'ai-phone-contract',terms:['AI手机合约','AI购机权益包','AI融合权益包'],pattern:/AI手机合约|AI购机权益包|AI融合权益包/i},
  {id:'family',terms:['全家享'],pattern:/全家享/},
  {id:'digital',terms:['数字家庭','数家套餐','数家档次','数家'],pattern:/数字家庭|数家/},
  {id:'5ga',terms:['全球通5ga','5ga'],pattern:/5ga/i},
  {id:'hebao',terms:['和包券','和包'],pattern:/和包/},
  {id:'ai-beans',terms:['ai豆','金币','信用购','2026版直降'],pattern:/ai豆|金币|信用购/i},
  {id:'voucher',terms:['话费券','直降话费券'],pattern:/话费券/},
  {id:'double',terms:['流量翻倍','加享1倍'],pattern:/流量翻倍|加享1倍/},
  {id:'hundred',terms:['百g流量','回家行动'],pattern:/百g|回家行动/i},
  {id:'fttr',terms:['fttr','全光'],pattern:/fttr|全光/i},
  {id:'canopy',terms:['移动看家','摄像头'],pattern:/移动看家|摄像头/},
  {id:'welfare',terms:['福利超市','福利爆品','福利金'],pattern:/福利超市|福利爆品|福利金/},
  {id:'recharge',terms:['空中充值','话费充值'],pattern:/空中充值|话费充值/},
  {id:'fusion',terms:['融合套餐','融合开户','融合入网','宽带'],pattern:/融合|宽带/},
  {id:'new-card',terms:['开卡','开户','办卡','新办号码','入网','号卡'],pattern:/开卡|办卡|开户|新办号码|新办.{0,3}号卡|入网/},
  {id:'terminal',terms:['购机','终端','手机直降'],pattern:/购机|终端|手机直降/},
];
const modifiers = ['升级版','标准版','AI版','超级版','优惠版','合约版','2026版','流量翻倍','百G流量','回家行动','会员费','预存','合约','承诺','违约','流量','语音','宽带','流程','步骤','条件','互斥'];
function policyState(item) {
  if (item.policyStatus === 'needs_review') return 'needs_review';
  if (item.policyStatus === 'historical' || day(item.validTo) && day(item.validTo)<c.day()) return 'historical';
  if (day(item.validFrom) && day(item.validFrom)>c.day()) return 'future';
  return item.policyStatus==='current' ? 'current' : 'needs_review';
}
function originalBlocks(item) {
  const blocks=Array.isArray(item.sourceBlocks)?item.sourceBlocks:[];
  return blocks.length ? blocks.map(block=>({...block,text:clean(block.text),rows:Array.isArray(block.rows)?block.rows:undefined})) : clean(item.body).split('\n').filter(Boolean).map((text,index)=>({id:'body-'+(index+1),kind:'paragraph',text}));
}
function tierNumbers(question) {
  const result=[];
  for(const match of question.matchAll(/(\d{1,3}(?:\.\d+)?)\s*元(?:档|套餐)?|(\d{1,3}(?:\.\d+)?)\s*档/g))result.push(match[1]||match[2]);
  if(!result.length)for(const match of question.matchAll(/(?:青春卡|校园卡|巴渝卡|全家享|5ga|数家|数字家庭|飞享|套餐)\s*(\d{1,3}(?:\.\d+)?)(?!\d)/gi))result.push(match[1]);
  return [...new Set(result)];
}
function hasNumber(text,number) { const escaped=String(number).replace(/\./g,'\\.');return new RegExp('(?:^|[^\\d.])'+escaped+'(?:$|[^\\d.])').test(clean(text)); }
function score(item,q,topic,tier,training,exam) {
  const heading=norm([item.title,...(item.tags||[]),...(item.keywords||[])].join(' '));
  const text=norm(item.body), title=norm(item.title);
  let value=0,anchor=false;
  if(title.length>=4&&norm(q).includes(title)){value+=80;anchor=true;}
  if(topic){const h=topic.terms.some(term=>heading.includes(norm(term))),b=topic.terms.some(term=>text.includes(norm(term)));if(!h&&!b)return 0;value+=h?35:8;anchor=true;if(topic.terms.some(term=>norm(q).includes(norm(term))&&heading.includes(norm(term))))value+=25;}
  const ignored=new Set(['移动','业务','业务知识','知识','知识库','资料','现行','政策','重庆移动','套餐','资费','学习','话术','流程','办理']);
  for(const term of [...new Set([...(item.tags||[]),...(item.keywords||[])])]){const n=norm(term);if(n.length>=2&&!ignored.has(n)&&norm(q).includes(n)){value+=Math.min(12,n.length*2);anchor=true;}}
  if(!anchor)return 0;
  if(item.importBatch==='mobile-promotions-20261010'){
    if(item.id.endsWith('-screen-upgrade')&&/升级|加量|加价|换新|自动/.test(q))value+=30;
    if(item.id.endsWith('-screen-fees')&&(tier.length||/灵犀屏|璨彩|OTV/i.test(q)&&/包含|有什么|有啥|权益|合约|月费|月租/.test(q)))value+=25;
  }
  for(const term of modifiers)if(norm(q).includes(norm(term)))value+=(heading.includes(norm(term))?8:text.includes(norm(term))?2:0);
  if(/流程|步骤|怎么(?:办|开)|如何办理/.test(q)&&/流程|步骤|办理|开户/.test(item.title))value+=20;
  if(training&&item.sourceTier==='store_training')value+=15;
  if(exam&&item.sourceTier==='store_exam')value+=15;
  if(tier.length&&originalBlocks(item).some(block=>block.rows?.slice(1).some(row=>tier.some(n=>hasNumber(row[0],n)))))value+=8;
  return value;
}
function metadataBlock(block) { return /^(?:来源|状态|同义词|整理日期|用途)/.test(block.text); }
function feature(question) {
  if(/酬金|激励|怎么返|返还|分月/.test(question))return /酬金|激励|积分|月目标|达量|返|在网|竣工|封顶/;
  if(/会员(?:费|费用)|年包|搭载/.test(question))return /会员|年包|搭载/;
  if(/合约|承诺|签约|多久|有效期|违约|赔付/.test(question))return /合约|承诺|签约|有效|违约|赔付/;
  if(/流量|多少g|多少gb/i.test(question))return /流量|GB|G(?:[^a-z]|$)/i;
  if(/语音|分钟|通话/.test(question))return /语音|分钟|通话/;
  if(/费用|多少钱|月费|价格|资费/.test(question))return /费|价|元|档/;
  if(/流程|步骤|怎么(?:办|开)|如何办理/.test(question))return /步骤|操作|流程|实名认证|本人|身份证|办理/;
  if(/条件|资格|互斥|能不能|可不可以|是否/.test(question))return /适用|条件|限制|需|必|仅限|互斥|不可|不能|不得|前提/;
  return null;
}
function targetTables(item,q,tiers) {
  const blocks=originalBlocks(item),f=feature(q),topic=groups.find(g=>g.pattern.test(q));
  const tables=blocks.filter(block=>block.kind==='table'&&block.rows?.length>1);
  return tables.map(block=>{
    const headers=block.rows[0];let rows=block.rows.slice(1).filter(row=>Array.isArray(row));
    // Select the named product before its fee, so equal-price products do not mix.
    const names=(topic?.terms||[]).filter(term=>norm(q).includes(norm(term))&&rows.some(row=>norm(row[0]).includes(norm(term))));
    if(names.length)rows=rows.filter(row=>names.some(term=>norm(row[0]).includes(norm(term))));
    const feeColumn=headers.findIndex(header=>/资费|月费|月租/.test(clean(header)));
    let selected=tiers.length?rows.filter(row=>tiers.some(n=>hasNumber(row[0],n)||feeColumn>=0&&hasNumber(row[feeColumn],n))):[];
    if(!selected.length&&!tiers.length&&topic){selected=rows.filter(row=>row.some(cell=>topic.terms.some(term=>norm(cell).includes(norm(term)))));}
    if(!tiers.length&&!selected.length&&item.tablePurpose==='incentive'&&/达量|激励|月目标|积分|档次/.test(q))selected=rows;
    if(tiers.length&&!selected.length)return null;
    const otherNamedHeader=clean(headers[0]);
    if(topic && groups.some(g=>g.id!==topic.id&&['family','digital','5ga'].includes(g.id)&&g.pattern.test(otherNamedHeader)))return null;
    if(!tiers.length && f && !headers.some(header=>f.test(clean(header))) && !selected.some(row=>row.some(cell=>f.test(clean(cell)))))return null;
    if(!tiers.length&&!selected.length)return null;
    return {id:block.id,headers,rows:selected};
  }).filter(Boolean);
}
function references(item,blocks=[]) {
  if(item.sourceRevisionNote){const name=fileName(item.sourceFiles?.[0]?.name);return [{id:item.id+':edit-v'+(item.version||1),label:item.title+' · 老板修订第 '+(item.version||1)+' 版（原文件：'+name+'）',href:'/knowledge#'+encodeURIComponent(item.id)}];}
  const ids=new Set(blocks.map(block=>block.id)),allRefs=Array.isArray(item.sourceRefs)?item.sourceRefs:[];
  let refs=allRefs.filter(ref=>!ids.size||!ref.blockId||ids.has(ref.blockId));
  if(!refs.length)refs=allRefs.slice(0,3);
  const mainFile=(item.sourceFiles||[]).find(file=>!file.duplicateOf)||item.sourceFiles?.[0];
  if(!refs.length)refs=[{file:typeof mainFile==='string'?mainFile:mainFile?.name,label:item.title}];
  return refs.slice(0,12).map(ref=>({id:item.id+(ref.blockId?':'+ref.blockId:''),label:fileName(ref.file||ref.name||(typeof mainFile==='string'?mainFile:mainFile?.name))+' · '+(ref.label||ref.blockId||item.title),href:'/knowledge#'+encodeURIComponent(item.id)}));
}
function response(item,answer,blocks=[],extra={}) {
  return {answer:item.sourceRevisionNote?item.sourceRevisionNote+'\n'+answer:answer,sources:references(item,blocks),action:{type:'navigate',label:'查看资料与出处',href:'/knowledge#'+encodeURIComponent(item.id)},metrics:{knowledge:true,articleId:item.id,version:item.version||1,sourceTier:item.sourceTier,policyStatus:policyState(item),asOf:item.asOf||null,kind:item.sourceTier==='store_exam'?'store-exam':item.sourceTier==='store_training'?'training-guidance':'store-policy',...extra.metrics},...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='metrics'))};
}
function pending(item,question='') {
  const state=policyState(item);
  let selectedIssues=item.reviewIssues||[];
  const focused=/会员(?:费|费用)|年包/.test(question)?/会员|年包|费/ : /合约|签约|多久|承诺/.test(question)?/合约|签约|承诺|违约|有效期/ : /酬金|激励/.test(question)?/酬金|激励|公式/ : /30元|门槛|临界/.test(question)?/临界|门槛/ : /电池|参数|配置/.test(question)?/机型|参数|版本/ : null;
  if(focused){const narrowed=selectedIssues.filter(issue=>focused.test([issue.title,issue.detail].join(' ')));if(narrowed.length)selectedIssues=narrowed;}
  if(!/详细|全文|全部/.test(question))selectedIssues=selectedIssues.slice(0,2);
  const issues=selectedIssues.map(issue=>[issue.title,issue.detail].filter(Boolean).join('：')).filter(Boolean);
  const reason=state==='historical'?'这份资料已标为历史或超过适用日期，不能作为现行办理依据。':state==='future'?'这份资料尚未到生效日期，暂不能作为当前办理依据。':'这项资料待核实，暂不按其中的争议金额或条件作确定答复。';
  return response(item,item.title+'：'+reason+(state==='needs_review'&&item.importBatch==='mobile-promotions-20261010'&&item.summary?'\n资料参考：'+item.summary+'\n':'')+(issues.length?'待核实：'+issues.join('；'):'请先核对资料来源、适用范围和当前办理条件。'),[],{metrics:{needsReview:true}});
}
function conditions(item,blocks,question='') {
  let rows=blocks.filter(block=>block.kind!=='table'&&!metadataBlock(block)&&/(适用|条件|前提|限制|必|需|不得|不可|不能|互斥|仅限|承诺|合约|有效|超套|红线|注意|搭载|叠加|办理前|签约|要求|违约)/.test(block.text));
  if(/酬金|激励|怎么返|返还|分月/.test(question))rows=rows.filter(block=>/酬金|激励|返|在网|竣工|封顶|号码|串码|跑.*流量/.test(block.text));
  const scope=clean(item.applicableScope).replace(/；?用户本次提供为店内现行资料，具体客户资格按产品规则核对/,'');
  const pieces=[scope?'适用范围：'+scope:'',...rows.map(block=>block.text)].filter(Boolean);
  return {text:[...new Set(pieces)].join('\n'),blocks:rows};
}
function tableText(table) {return table.rows.map(row=>table.headers.map((header,index)=>clean(header)+'：'+(clean(row[index]??'')||'资料未填写')).join('；')).join('\n');}
function candidatesResult(candidates,label) {
  const rows=candidates.slice(0,6),sources=rows.flatMap(row=>references(row.item,row.tables.map(table=>({id:table.id}))).slice(0,1));
  return {answer:label+'有多种资料或版本，请先选定：'+rows.map(row=>row.item.title+(policyState(row.item)!=='current'?'【待核实或非现行】':'')).join('；')+'。',sources,action:{type:'navigate',label:'选择对应资料',href:'/knowledge'},metrics:{knowledge:true,needsClarification:true,articleIds:rows.map(row=>row.item.id),kind:'store-policy-candidates'}};
}
function query(store,user,question,items=[]) {
  const currentRule=require('./rule-authority').query(question,user);if(currentRule)return currentRule;
  const q=normalizeQuestion(question).slice(0,500);if(!q)return null;
  const explicitKnowledge=/(?:政策|资费|规则|条件|流程|步骤|知识|资料|话术|教程|考核|考试|题库|参数|配置|怎么(?:办|说|推荐)|如何(?:办|说|推荐)|互斥)/.test(q);
  const ledger=/(?:库存|营业额|销量|毛利|出勤|签到|卖了|售出|成交了|资金流水|账套|到账|已收|实际收到|应收|应付|支付了|进了什么货)/.test(q)||/(?:今天|昨天|本月|这月|昨日|本周|多少笔|哪一笔|单号).{0,30}(?:酬金|收入|支出|奖励|办理|业务|办了|开了|多少张|几张)/.test(q)||/(?:办了|开了|办理了|开通了).{0,20}(?:多少|几|笔|单|张)/.test(q);
  if(ledger&&!explicitKnowledge)return null;
  if(/^(?:帮我|给我|请)?(?:删除|覆盖|清空|修改|停用|更新|导入|提交|审批|支付)/.test(q)&&!/(?:流程|政策|规则|条件)/.test(q))return null;
  if(/(?:帮我|给我).{0,12}(?:开单|录入|提交|办卡|开卡)/.test(q)&&!explicitKnowledge)return null;
  const exam=/(?:题库|考试|考核|测验|第[\d一二三四五六七八九十]+题|出(?:一道|一|道)题|练习题|题目答案)/.test(q);
  const training=/(?:话术|推销|销售技巧|怎么说|如何说|卖点|推荐技巧|顾客说|客户说)/.test(q);
  let topic=groups.find(group=>group.pattern.test(q)) || (/电池|续航|芯片|屏幕|配置|参数|快充|内存/.test(q) ? [{id:'vivo-spec',terms:['vivo','iqoo'],pattern:/vivo|iqoo/i},{id:'huawei-spec',terms:['华为','mate','pura','nova'],pattern:/华为|mate|pura|nova/i},{id:'honor-spec',terms:['荣耀','honor'],pattern:/荣耀|honor/i},{id:'oppo-spec',terms:['oppo','reno','find'],pattern:/oppo|reno|find/i},{id:'xiaomi-spec',terms:['小米','红米','redmi'],pattern:/小米|红米|redmi/i},{id:'apple-spec',terms:['苹果','iphone'],pattern:/苹果|iphone/i}].find(group=>group.pattern.test(q)) : null);
  if(!topic){const ignored=new Set(['移动','业务','知识','知识库','资料','政策','资费','套餐','流程','办理','重庆移动']);const matches=items.filter(item=>item.enabled!==false&&item.sourceTier==='store_policy').flatMap(item=>[...(item.tags||[]),...(item.keywords||[])]).filter(term=>norm(term).length>=2&&!ignored.has(norm(term))&&norm(q).includes(norm(term)));if(matches.length)topic={id:'tag-topic',terms:[...new Set(matches)].sort((a,b)=>b.length-a.length).slice(0,8)};}
  if(!explicitKnowledge&&!topic&&!exam&&!training)return null;
  c.permit(user,'learn');
  if(/旧版|老版|旧政策|老政策|已停用/.test(q)&&topic){const stopped=items.find(item=>item.enabled===false&&importedTiers.has(item.sourceTier)&&topic.terms.some(term=>norm([item.title,...(item.tags||[])].join(' ')).includes(norm(term))));if(stopped)return response(stopped,'这份旧版资料已停用，不能作为现行办理依据。请查询对应的现行规则，或由老板核对旧版出处。',[],{metrics:{needsReview:true,policyStatus:'historical'}});}
  const tiers=tierNumbers(q),detailed=/(详细|全文|展开|完整原文|全部步骤)/.test(q);
  const imported=items.filter(item=>item.enabled!==false&&importedTiers.has(item.sourceTier)&&!item.conversationTopic&&(exam?item.sourceTier==='store_exam':item.sourceTier!=='store_exam')&&(!training||item.sourceTier==='store_training'));
  let candidates=imported.map(item=>({item,score:score(item,q,topic,tiers,training,exam),tables:targetTables(item,q,tiers)})).filter(row=>row.score>=(topic?8:12));
  if(!candidates.length)return null;
  candidates.sort((a,b)=>b.score-a.score);
  const namedModifiers=['4G飞享','标准版','AI版','超级版','优惠版','流量翻倍','百G流量','回家行动'].filter(term=>norm(q).includes(norm(term)));
  if(namedModifiers.length){const narrow=candidates.filter(row=>namedModifiers.every(term=>norm([row.item.title,...(row.item.tags||[]),...(row.item.keywords||[])].join(' ')).includes(norm(term))));if(narrow.length)candidates=narrow;}
  const top=candidates[0],exactTitle=norm(top.item.title).length>=4&&norm(q).includes(norm(top.item.title));
  let relevant=exactTitle?[top]:candidates.filter(row=>row.score>=top.score-8);
  if(tiers.length&&topic&&!exactTitle){const tableCandidates=candidates.filter(row=>row.tables.length);if(tableCandidates.length)relevant=tableCandidates;}
  const unique=new Map();for(const row of relevant){const key=norm(row.item.body)+'|'+policyState(row.item)+'|'+norm(row.item.applicableScope);if(!unique.has(key))unique.set(key,row);}relevant=[...unique.values()];
  if(relevant.length>1)return candidatesResult(relevant,topic?.terms[0]||'这个专题');
  const item=relevant[0]?.item||top.item, state=policyState(item);
  if(state!=='current')return pending(item,q);
  if(item.validFrom&&item.validTo&&!/合约|承诺|签约/.test(q)&&/(?:活动|优惠|促销).{0,12}(?:什么时候|何时|哪天|几号|截止|结束|有效期|期限|还有|有没有|有没得|是否还|现在能)|(?:截止|结束|有效期).{0,12}(?:活动|优惠|促销)/.test(q))return response(item,'活动时间：'+item.validFrom+' 至 '+item.validTo+'。促销截止日与产品合约到期日分开计算。',originalBlocks(item).filter(block=>block.id==='activity-period'));
  if(Array.isArray(item.sourceFields)){const missingField=/会员|通赔|电池保|搭载|叠加/.test(q)&&!item.sourceFields.includes('addonRequirements')?'会员或搭载要求':/收费周期|按月|每月|月费|按年|年费/.test(q)&&!item.sourceFields.includes('feePeriod')?'收费周期':/合约期|签约期|合约多久|多久|有效期/.test(q)&&!item.sourceFields.includes('contractPeriod')?'合约期或有效期':null;if(missingField)return response(item,'这份现行资料尚未提供'+missingField+'，需要补充后再答复。',[],{metrics:{missingField,needsClarification:true}});}
  let blocks=originalBlocks(item);
  if(/过户/.test(q)&&!/销户/.test(q)){const start=blocks.findIndex(block=>norm(block.text)==='过户');const end=blocks.findIndex((block,index)=>index>start&&norm(block.text)==='销户');if(start>=0)blocks=blocks.slice(start,end>=0?end:undefined);}
  if(/销户/.test(q)&&!/过户/.test(q)){const start=blocks.findIndex(block=>norm(block.text)==='销户');if(start>=0)blocks=blocks.slice(start);}
  const tables=targetTables(item,q,tiers),qualifications=conditions(item,blocks,q);
  if(detailed)return response(item,item.title+'（'+(item.publicConsultation?'资费与权益':'店内'+(item.sourceTier==='store_policy'?'现行资料':'学习资料')+(item.sourceRevisionNote?'修订内容':'原文'))+'）：\n'+clean(item.body)+(item.applicableScope?'\n适用范围：'+item.applicableScope:''),blocks);
  if(/套餐外|超套|超出|超额/.test(q)){
    const onlyVoice=/分钟|通话|电话/.test(q)&&!/流量|GB/i.test(q),onlyData=/流量|GB/i.test(q)&&!/分钟|通话|电话/.test(q);
    const charges=blocks.filter(block=>block.kind!=='table'&&(/套餐外/.test(block.text)||/超套|超出|超额/.test(block.text)&&/收费|计费|元|GB/i.test(block.text))&&(!onlyVoice||/分钟|通话|电话/.test(block.text))&&(!onlyData||/流量|GB/i.test(block.text)));
    if(charges.length)return response(item,charges.slice(0,4).map(block=>block.text).join('\n'),charges.slice(0,4));
    return response(item,'这份资料没有列明对应的套餐外收费，需要营业员核对后再答复。',[],{metrics:{missingField:'套餐外收费',needsClarification:true}});
  }
  if(tiers.length&&blocks.some(block=>block.kind==='table'&&block.rows?.[0]?.some(header=>/(?:月费|档次|套餐档|价格|资费)/.test(clean(header))))&&!tables.length)return response(item,'这份资料没有找到 '+tiers.join('、')+' 元档的对应行，请确认套餐名称、版本和档次。',[],{metrics:{needsClarification:true}});
  if(tables.length){
    const used=tables.map(table=>({id:table.id})).concat(qualifications.blocks);
    return response(item,item.title+'：\n'+tables.map(tableText).join('\n')+(qualifications.text?'\n'+qualifications.text:''),used,{sections:tables.map(table=>({title:item.title,headers:table.headers,rows:table.rows}))});
  }
  const f=feature(q);
  let excerpts=blocks.filter(block=>block.kind!=='table'&&!metadataBlock(block)&&(!f||f.test(block.text)));
  if(!excerpts.length)excerpts=blocks.filter(block=>block.kind!=='table'&&!metadataBlock(block));
  if(/流程|步骤|怎么(?:办|开)|如何办理/.test(q)){const flow=blocks.filter(block=>block.kind==='table'&&block.rows?.[0]?.some(cell=>/步骤|操作/.test(clean(cell))));if(flow.length)return response(item,item.title+'：\n'+flow.map(table=>table.rows.map(row=>row.join(' | ')).join('\n')).join('\n')+(qualifications.text?'\n'+qualifications.text:''),flow.concat(qualifications.blocks));}
  const selected=excerpts.slice(0,4), text=selected.map(block=>block.text).join('\n');
  if(!text)return response(item,item.summary||'打开对应资料查看原文和适用条件。',[]);
  return response(item,item.title+'：\n'+[...new Set([...selected.map(block=>block.text),...qualifications.text.split('\n').filter(Boolean)])].join('\n'),selected.concat(qualifications.blocks));
}
module.exports={query,isPromotionQuestion:question=>groups.slice(0,4).some(group=>group.pattern.test(normalizeQuestion(question)))};
