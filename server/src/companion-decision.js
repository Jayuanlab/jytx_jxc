 'use strict';
const search=require('./companion-memory-search');
const PROFILE_FIELDS=['nickname','city','interests','routine','lifeRole','personality','priorities','resources','boundaries','replyStyle','experience'];
const ADVICE=/怎么办|怎么处理|如何处理|出(?:个)?主意|拿(?:个)?主意|帮.{0,8}(?:思考|判断|分析|决策)|该不该|要不要|该怎么|应该怎么|纠结|你怎么看|怎么选|如何选|利弊|换个角度|建议.{0,8}(?:处理|解决)|如何解决/;
function query(q,last,now=Date.now()){
 if(/^(?:请)?(?:帮我)?(?:记住|记下来|记一下|收藏|保存)/.test(q))return null;
 if(ADVICE.test(q))return {question:q};
 const metrics=last?.channel==='life'?last.response?.metrics:null;
 if(metrics?.kind==='personal-decision'&&now-Date.parse(last.createdAt)<48*3600000&&q.length<200&&/^(?:那|他|她|对方|这样|还有|如果|换|我想|我希望|我担心|我怕|先|再|行|不行|可以)/.test(q))return {question:metrics.caseQuestion||last.question};
 return null;
}
function context(rows,userId,q){
 const healthy=/药|医疗|医生|医院|病|身体|健康|不适|抑郁|焦虑|失眠|记忆困难|记性/.test(q);
 const own=rows.filter(r=>r.userId===userId&&r.confirmed===true&&r.active!==false&&(!r.expiresAt||Date.parse(r.expiresAt)>Date.now())&&(healthy||r.category!=='健康'));
 const ranked=search.rank(own,userId,q),background=own.filter(r=>['性格','处事','职业','经历'].includes(r.category)).sort((a,b)=>Date.parse(b.updatedAt||b.createdAt||0)-Date.parse(a.updatedAt||a.createdAt||0)).slice(0,4);
 const selected=[];let size=0;for(const r of [...ranked,...background]){if(selected.some(x=>x.id===r.id)||selected.length>=12||size+r.content.length>3500)continue;size+=r.content.length;selected.push(r);}return selected;
}
function profile(p){return Object.fromEntries(PROFILE_FIELDS.filter(k=>typeof p[k]==='string').map(k=>[k,p[k]]));}
function fallback(p,q){
 const role=p.lifeRole?'你填写的身份是“'+p.lifeRole+'”。我会结合你在这件事中的责任考虑。\n':'';
 return role+'先别急着定下来。你最希望这件事达到什么结果？\n你可以补充事情经过、相关人的态度和最难的一点。我们再一起比较办法、各自利弊和能请谁帮忙。\n目前通用聊天服务没有返回可用回答，我先帮你把关键问题理清，不替你猜结论。';
}
const POLICY='你是帮助用户解决问题的个人助理。先理解他想达到的结果、事情经过、约束与相关人的立场；缺关键事实时先问一两个具体问题。信息足够时提出两三种可行办法，说明取舍、建议先做的一小步，必要时给一句可以直接说的话；之后询问实行后的结果。结合用户填写的职业责任、处事偏好、价值取向、真实人脉与资源，不能按职业或性格标签套结论；身份资料不代表权限，不允许越权执行事务。人脉只按确认资料参考，不能假定对方愿意帮忙、承诺人情或鼓励特权。区分本人陈述、亲友看法与客观记录，亲友看法只是一方观察，即使本人允许保存也不是事实或诊断；不揣测他人恶意。遇到矛盾温和请本人举近期例子核实，允许他说不同意。逐步了解相关经历，不能要求交出全部人生隐私、暗中评判或操控。建议与提醒自然、尊重、具体，不能保证判断准确或一味迎合。记忆困难时短句、一次一个问题、少量选择、耐心重复；情绪低落时先倾听、不说教，不凭聊天诊断抑郁或痴呆。若状态持续影响生活建议咨询医生并联系本人信任的现实支持；疑似妄想只接纳感受，不认定未经证实的迫害是事实。不能宣称自己是唯一依靠、鼓励疏远家人或冒充医生。';
module.exports={PROFILE_FIELDS,query,context,profile,fallback,POLICY};
