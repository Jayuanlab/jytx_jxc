'use strict';
const c=require('./common');
const service=require('./reception-service-assessment');
const audio=require('./reception-audio');
const clean=(v,n=20000)=>String(v??'').trim().slice(0,n);
const rules=[
 ['购买手机',/(?:买|购|要|换)(?:一[台部个])?(?:个|台|部)?(?:新)?手机(?![壳膜])|手机(?:购买|买一|下单)/],
 ['咨询手机',/手机(?![卡壳膜])|苹果|华为|小米|荣耀|[iI][pP]hone/],
 ['配件',/配件|充电器|充电线|数据线|耳机|手机膜|贴膜|保护壳|手机壳/],
 ['维修',/维修|修手机|换屏|屏幕碎|不开机|换电池|修理/],
 ['号卡',/号卡|办卡|开卡|手机卡|电话卡|新号码|携号转网/],
 ['充值',/充值|充话费|交话费|缴话费/],
 ['宽带',/宽带|装网|装网络/],
 ['套餐',/套餐|资费|流量包|改套餐/],
 ['售后',/售后|退货|换货|保修/],
 ['找人',/找(?:一下|你们|下)?(?:老板|店长|负责人)|老板(?:在不在|在吗|在哪|在哪里)|找人/]
];
const useful=/找老板|找店长|找负责人|老板在|找人|手机|配件|充电|数据线|耳机|贴膜|保护壳|维修|换屏|屏幕|开机|电池|修理|号卡|办卡|开卡|电话卡|号码|转网|充值|话费|宽带|装网|套餐|资费|流量|售后|退货|换货|保修|预算|价位|价格|便宜|贵|块|元|[千万]以内|苹果|华为|小米|荣耀|[iI][pP]hone|[vV][iI][vV][oO]|[oO][pP][pP][oO]|红米|[一二两三四五六七八九十百千万\d]+[GgTt]|字体|字大|声音|音量|拍照|内存|容量|续航|游戏|颜色|黑色|白色|蓝色|老人|学生|孩子|防水|耐用|回访|联系|考虑|再来|留货|预约|到货|现货|库存|分期|以旧换新|身份证|资料|手续/;
const question=/[?？]|多少钱|什么区别|能不能|可不可以|有没有|是否|怎么|哪(?:个|款|种)|您(?:要|想|需要)|你(?:要|想|需要)|[吗呢]$/;
const budget=/预算|打算花|能接受|价位(?:在|是|大概|约)|不超过|控制在/;
const offer=/建议|推荐|可以选|这款|我们有|店里有|给您介绍/;
const follow=/回访|再联系|联系我|电话联系|微信联系|考虑一下|考虑下|再来|留货|预约|到货(?:后|了)|通知我/;
const unique=values=>[...new Set(values)];
function draft(payload){
 const transcript=clean(payload.assistantTranscript||payload.transcript);
 if(!transcript)throw new c.HttpError(400,'请先说话或输入接待内容');
 const clauses=unique(transcript.replace(/(?:顾客|客户|营业员|店员|员工)\s*[:：]/g,'\n$&').split(/[，,。！？；;\n]+/).map(x=>x.trim()).filter(Boolean));
 // Keep negation and question text in the source; do not turn them into a confirmed purchase.
 const positive=clauses.flatMap(s=>s.split(/但是|但|不过|而是|只想|只要/)).filter(s=>!/(?:不是|不想|不要|不买|不用|无需|没打算)/.test(s)).join('。');
 let intents=rules.filter(([,re])=>re.test(positive)).map(([name])=>name);
 if(intents.includes('配件')&&!/(买|购|换).{0,5}手机(?![壳膜])/.test(positive))intents=intents.filter(x=>x!=='购买手机');
 if(intents.includes('购买手机')&&!clauses.some(s=>!question.test(s)&&!/(不买|不想|不要|没打算)/.test(s)&&rules[0][1].test(s)))intents=unique(intents.filter(x=>x!=='购买手机').concat('咨询手机'));
 if(intents.includes('购买手机'))intents=intents.filter(x=>x!=='咨询手机');
 if(intents.some(x=>!['购买手机','咨询手机'].includes(x))&&!/(看手机|咨询手机|了解手机|选手机|想买|要买|买手机|换手机|手机多少钱)/.test(positive))intents=intents.filter(x=>x!=='咨询手机');
 const purpose=intents.length===1?intents[0]:'';
 const picked=clauses.filter(s=>useful.test(s)),questions=picked.filter(s=>question.test(s)&&!budget.test(s)&&!follow.test(s));
 const budgets=picked.filter(s=>budget.test(s)&&!question.test(s)).slice(-3),followups=picked.filter(s=>follow.test(s)).slice(-3);
 const offers=picked.filter(s=>offer.test(s)&&!questions.includes(s)).slice(-3);
 const needs=picked.filter(s=>!questions.includes(s)&&!budgets.includes(s)&&!followups.includes(s)&&!offers.includes(s)).slice(-12);
 const highlights=[];
 if(intents.length)highlights.push({label:'业务',value:intents.join('、')});
 if(needs.length)highlights.push({label:'需求原话',value:needs.join('；').slice(0,620)});
 if(budgets.length)highlights.push({label:'预算原话',value:budgets.join('；').slice(0,220)});
 if(followups.length)highlights.push({label:'跟进原话',value:followups.join('；').slice(0,220)});
 if(offers.length)highlights.push({label:'介绍原话',value:offers.join('；').slice(0,220)});
 if(questions.length)highlights.push({label:'对话问句',value:questions.slice(-5).join('；').slice(0,220)});
 const pending=[];
 if(!intents.length)pending.push('业务类型待核对');else if(intents.length>1)pending.push('本单主要业务待选择');
 if(questions.length)pending.push('问句中的需求及办理结果待核实');
 if(intents.includes('找人'))pending.push('找人事由、是否已联系到本人待核实');
 const summary=highlights.map(x=>x.label+'：'+x.value).join('\n').slice(0,1000);
 return {purpose,needs:summary,intents,highlights,pending,needsReview:intents.length!==1,method:'关键词提取（待营业员核对）',version:2,serviceAssessment:service.assess(transcript)};
}
const keys=['purpose','needs','visitorCount','source','visitorName','budgetBand','budgetMin','budgetMax','followUpNeed','followUpAt','viewedProducts','customerProfile','mobileAppLoggedIn','recommendation','review'];
function snapshot(row){return Object.fromEntries(keys.map(k=>[k,structuredClone(row[k]??null)]));}
function diff(before,after){return keys.filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])).map(field=>({field,before:before[field]??null,after:after[field]??null}));}
function attach(row,user,payload){
 const at=c.now(),final=snapshot(row),transcript=clean(payload.assistantTranscript),rawTranscript=clean(payload.assistantRawTranscript);
 const parsed=transcript?draft({transcript}):null;
 const original=parsed?{...structuredClone(final),purpose:parsed.purpose,needs:parsed.needs}:structuredClone(final);
 row.originalDocument={at,by:user.id,byName:user.name,source:parsed?'assistant':'manual',transcript:transcript||null,rawTranscript:rawTranscript||null,transcriptSource:parsed?(payload.assistantSource==='speech'?'speech':'text'):null,method:parsed?.method||null,intents:parsed?.intents||[],fields:original};
 row.serviceAssessment=service.assess(transcript,{...final,links:row.links||[]});
 const changes=diff(original,final);
 row.documentVersions=[{version:1,kind:changes.length?'修改单':'原单',at,by:user.id,byName:user.name,changes,fields:final,confirmed:true}];
 row.documentKind=changes.length?'修改单':'原单';
 return row;
}
function wrap(api){
 const create=api.create,update=api.update,supplement=api.supplement,confirmClose=api.confirmClose,reviewInvalidQuality=api.reviewInvalidQuality;
 const requireServiceRecord=(store,payload)=>{const row=(store.receptions||[]).find(x=>x.id===payload.id);if(row?.receptionServiceRuleVersion===1&&(!row.audioEvidence||!service.assess(row.originalDocument?.transcript,row).serviceComplete))throw new c.HttpError(409,'这张新接待单缺少可回放录音或具体的双方沟通和服务过程，暂不能核定有效或发放积分；不能补证的由老板核定无效');return row;};
 return {...api,assistantDraft:(_store,_user,payload)=>draft(payload),
 list(store,user){const result=api.list(store,user);return {...result,rows:result.rows.map(row=>{if(row.publicAssist)return row;const projected={...row,audioSubmitted:Boolean(row.audioEvidence),serviceAssessment:row.serviceAssessment||service.assess(row.originalDocument?.transcript,{...row,links:row.links||[]})};if(user.roleCode!=='owner')delete projected.audioEvidence;return projected;})};},
 create(store,user,payload){if(payload.assistantTranscript!==undefined&&typeof payload.assistantTranscript!=='string'||payload.assistantRawTranscript!==undefined&&typeof payload.assistantRawTranscript!=='string')throw new c.HttpError(400,'识别文字格式错误');const row=attach(create(store,user,payload),user,payload);row.receptionServiceRuleVersion=1;row.audioEvidence=audio.claim(store,user,payload.assistantAudioToken,row);row.qualityAssessment={...require('./guardian').assessReception(row),assessedAt:c.now(),source:'数字大脑规则初判'};return user.roleCode==='owner'?row:{...row,audioEvidence:undefined,audioSubmitted:Boolean(row.audioEvidence)};},
 confirmClose(store,user,payload){if(user.roleCode!=='owner')return confirmClose(store,user,payload);if(payload.validity==='有效')requireServiceRecord(store,payload);return confirmClose(store,user,payload);},
 confirmWechat(store,user,payload){if(user.roleCode==='owner')requireServiceRecord(store,payload);return api.confirmWechat(store,user,payload);},
 confirmFollowUp(store,user,payload){if(user.roleCode==='owner'&&payload.approve===true)requireServiceRecord(store,payload);return api.confirmFollowUp(store,user,payload);},
 confirmAssist(store,user,payload){if(user.roleCode==='owner'&&payload.approve===true&&(Number(payload.fromPoints)>0||Number(payload.toPoints)>0))requireServiceRecord(store,payload);return api.confirmAssist(store,user,payload);},
 reviewInvalidQuality(store,user,payload){if(user.roleCode!=='owner')return reviewInvalidQuality(store,user,payload);const row=(store.receptions||[]).find(x=>x.id===payload.id);if(row?.receptionServiceRuleVersion===1&&payload.decision==='approve')throw new c.HttpError(409,'新版接待判无效后不计积分，不能另发质量奖励');return reviewInvalidQuality(store,user,payload);},
 ...Object.fromEntries([['update',update],['supplement',supplement]].map(([name,fn])=>[name,function(store,user,payload){
  const old=(store.receptions||[]).find(x=>x.id===payload.id),before=old?snapshot(old):null;
  const original=old?.originalDocument,versions=old?.documentVersions;
  if(payload.purpose!==undefined)c.text(payload.purpose,'来意');
  const row=fn(store,user,payload);
  if(payload.purpose!==undefined)row.purpose=clean(payload.purpose,200);
  if(payload.source!==undefined)row.source=clean(payload.source,40)||'到店';
  const after=snapshot(row),changes=before?diff(before,after):[];
  // Backfill a visible baseline on the first edit of a legacy document, never invent its history.
  if(!original){row.originalDocument={at:row.createdAt,by:row.ownerId,byName:row.ownerName,source:'legacy-baseline',transcript:null,fields:before};row.documentVersions=[{version:1,kind:'历史基线',at:c.now(),by:user.id,byName:user.name,fields:before,changes:[]}];}
  else{row.originalDocument=original;row.documentVersions=versions;}
  if(changes.length){row.documentVersions.push({version:row.documentVersions.length+1,kind:'修改单',at:c.now(),by:user.id,byName:user.name,changes,fields:after,confirmed:true});row.documentKind='修改单';}
  row.serviceAssessment=service.assess(row.originalDocument?.transcript,{...after,links:row.links||[]});
  return row;
 }]))};
}
module.exports={draft,snapshot,diff,wrap};
