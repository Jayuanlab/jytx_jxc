const tariffs = require('./assistant-tariff-query');
const saleInput = require('../../web/assistant-sale-input');
const periods = require('./assistant-period');
const businessReplies = {号卡:'我想办张手机卡',办卡:'我想办张手机卡',买卡:'我想办张手机卡',开卡:'我想办张手机卡',充值:'我来办充值业务',宽带:'装宽带怎么办理',套餐:'套餐怎么变更',维修:'手机维修怎么登记',购机:'怎样向顾客推荐手机',买手机:'怎样向顾客推荐手机'};
const tariffAwaiting = new Set(['budget','usage','region','current-plan','billing-concern','use-check','previous-plan','minutes','data','needs','identity-check','card-choice']);
const answeredKinds=value=>Array.isArray(value)?[...new Set(value.filter(x=>['identity-check','card-choice'].includes(x)))]:[];
const brands = ['华为','荣耀','OPPO','vivo','苹果','iPhone','小米','红米','三星','一加','realme','魅族','中兴','努比亚'];
const detailOnly = /^(?:请|再|给我|帮我|说|讲|看|看看|一下|点|一点|详细|详细点|明细|展开|具体|列出来|说说|讲讲|吧|呢|的|些|清楚|更|多|一|[，,。!！?？\s])+$/;
function resolve(question, context, user) {
  const valid = context && context.userId === user.id && typeof context.question === 'string' && context.question.length <= 240 && Number.isFinite(context.at) && Date.now() - context.at >= 0 && Date.now() - context.at < 30 * 60 * 1000;
  if (!valid) return { question, inherited: false };
  const previous = context.question;
  const token=saleInput.serialToken(context.serialToken||context.serialNo||context.recordSubject||previous,true)||saleInput.serialToken(context.serialToken||context.serialNo||'');
  const explicit=saleInput.analyze(question).serialToken||saleInput.serialToken(question,true);
  if(token&&!explicit&&(saleInput.statusQuery(question)||/^(?:再|继续|帮我)?(?:开|记|填)(?:这台|这一台|它)(?:手机)?(?:的)?(?:销售)?单[。！!？?\s]*$/.test(question)))return {question:('串号 '+token+'，'+question).slice(0,240),inherited:true};
  if(typeof context.recordSubject==='string'&&context.recordSubject.length<=160&&/^(?:那|那么|再看)?(?:这台|这款|它)?(?:的)?(?:进货日期|供货商|供应商|售价|进价|多少钱|毛利多少|毛利|销售清单|卖给谁)(?:呢|是多少)?[?？。!！\s]*$/.test(question))return {question:(context.recordSubject+' '+question).slice(0,240),inherited:true};
  const compact=question.replace(/[\s，,。.!！?？]/g,'');
  if(context.businessChoice&&Object.hasOwn(businessReplies,compact))return {question:businessReplies[compact],inherited:true};
  if(context.tariff&&typeof context.tariff.profile==='object'){
    const profile=tariffs.mergeProfile({},context.tariff.profile);
    const awaiting=tariffAwaiting.has(context.tariff.awaiting)?context.tariff.awaiting:undefined;
    const dialogueAnswered=answeredKinds(context.tariff.dialogueAnswered),dialoguePool=typeof context.tariff.dialoguePool==='string'&&/^tariff:[a-z-]{1,40}$/.test(context.tariff.dialoguePool)?context.tariff.dialoguePool:undefined;
    if(awaiting==='identity-check'&&!/怎么办|怎么|如何|能不能|可以不/.test(compact)&&/^(?:(?:身份证|证件)?(?:带了|带起了|带起|带了的|带了身份证|带了身份证的|带起了身份证|带了证件|已经带了|没带|没带身份证|没带证件|没有带|还没带|还没带身份证|带在身上|在身上|在包里|在包包里|在这里)|(?:我|我的)?(?:身份证|证件)(?:在我|在|已带|带了|没带|没有带).{0,12})$/.test(compact)){
      return {question:'推荐手机卡',profile,dialogueAnswered:[...new Set([...dialogueAnswered,'identity-check'])],dialoguePool,inherited:true};
    }
    if(awaiting==='card-choice'&&/^(?:我自己选|自己选|我先看看|先看看|你帮我(?:选|挑|推荐)(?:一下|嘛|吧)?|帮我(?:选|挑|推荐)(?:一下|嘛|吧)?)$/.test(compact)){
      return {question:/自己|看看/.test(compact)?'整理所有卡资源':'推荐手机卡',profile,dialogueAnswered:[...new Set([...dialogueAnswered,'card-choice'])],dialoguePool,inherited:true};
    }
    if(/^(?:换个预算|重新说预算|预算重填)$/.test(compact)){
      for(const key of ['budgetMax','budgetTarget','budgetApprox','budgetSource','currentMonthlySpend'])delete profile[key];
      return {question:'推荐号卡套餐',profile,awaiting:'budget',dialogueAnswered,dialoguePool,inherited:true};
    }
    if(/^(?:再看)?(?:详细|详细一点|详细点|明细|具体条件|详细条件|再看详细条件)$/.test(compact))return {question:'详细推荐号卡套餐',profile,awaiting,dialogueAnswered,dialoguePool,inherited:true};
    return {question,profile,awaiting,dialogueAnswered,dialoguePool,inherited:false};
  }
  if (detailOnly.test(question) && /详细|明细|展开|具体|列出来/.test(question)) return { question: `详细 ${previous}`.slice(0,240), inherited: true };
  const period = question.match(/^(?:那|那么|再看|看看|看|查|查一下)?(本周|这周|上周|上个星期|上星期|这个星期|这星期|本月|这个月|这月|上月|上个月|今年|去年|今天|昨天|前天|今日|昨日)(?:的)?(?:呢|怎么样|如何|情况)?[?？。!！\s]*$/);
  if(period && /销售|销量|卖|售出|营业额|毛利|利润|赚|挣/.test(previous) && (periods.parse(previous) || /今天|昨天|前天|今日|昨日|20\d{2}[-年/.]/.test(previous))) {
    const inherited=periods.replacePeriod(previous,period[1]).replace(/今天|昨天|前天|今日|昨日/g,period[1]);
    return {question:inherited.slice(0,240),inherited:true};
  }
  const day = question.match(/^(?:那|那么|再看|看看|看|查|查一下)?(今天|昨天|前天|今日|昨日)(?:的)?(?:呢|怎么样|如何|情况)?[?？。!！\s]*$/);
  if (day && /(今天|昨天|前天|今日|昨日|20\d{2}[-年/.])/.test(previous)) return { question: previous.replace(/20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?|今天|昨天|前天|今日|昨日/g, day[1]), inherited: true };
  const brand = brands.find(b => new RegExp('^(?:那|那么|再查|再看|看看|查一下|查|看)?'+b+'(?:的)?(?:呢|怎么样|如何|库存|销量|手机)?[?？。!！\\s]*$', 'i').test(question));
  if (brand && /(库存|有货|销量|卖|销售|售出)/.test(previous)) {
    let q = previous;
    for (const b of brands) q = q.replace(new RegExp(b,'gi'), '');
    return { question: `${brand} ${q}`.slice(0,240), inherited: true };
  }
  return { question, inherited: false };
}
function create(question, user, response={}) {
  const context={question:question.slice(0,240),userId:user.id,at:Date.now()};
  const hint=response.conversationHint;
  const serial=saleInput.analyze(question).serialToken||saleInput.serialToken(question,true);
  if(serial)context.serialToken=serial;
  if(hint?.topic==='serial-status'&&typeof hint.serialNo==='string')context.serialToken=hint.serialNo;
  if(hint?.topic==='record-query'&&typeof hint.subject==='string')context.recordSubject=hint.subject.slice(0,160);
  if(hint?.topic==='business-choice')context.businessChoice=true;
  if(hint?.topic==='tariff-recommendations')context.tariff={profile:tariffs.mergeProfile({},hint.profile),awaiting:tariffAwaiting.has(hint.awaiting)?hint.awaiting:null,...(answeredKinds(hint.dialogueAnswered).length?{dialogueAnswered:answeredKinds(hint.dialogueAnswered)}:{}),...(typeof hint.dialoguePool==='string'&&/^tariff:[a-z-]{1,40}$/.test(hint.dialoguePool)?{dialoguePool:hint.dialoguePool}:{})};
  return context;
}
function followups(question, response) {
  if (response.draft || response.saleFlow || response.action?.type === 'attendance') return [];
  if (!response.sources?.length) return [];
  const rows = [];
  if (!/(详细|明细|展开|具体|怎么算|如何计算|核算过程|逐笔|每笔)/.test(question)) rows.push({label:'详细一点',question:'详细一点'});
  if (/今天|今日/.test(question) && /销售|销量|卖|毛利|营业额|进货|店况|出勤|工作/.test(question)) rows.push({label:'昨天呢',question:'昨天呢'});
  if(response.metrics?.kind==='sales-period'){
    if(response.period?.kind==='month')rows.push({label:'上个月呢',question:'上个月呢'});
    if(response.period?.kind==='week')rows.push({label:'上周呢',question:'上周呢'});
  }
  return rows;
}
module.exports = { resolve, create, followups };
