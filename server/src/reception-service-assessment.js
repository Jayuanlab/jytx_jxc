'use strict';

const topicRules=[
 ['充值',/充值|充话费|交话费|缴话费/],
 ['手机咨询',/手机(?!卡)|机型|拍照|内存|续航|华为|小米|荣耀|苹果|iPhone/i],
 ['号卡或套餐',/号卡|办卡|手机卡|电话卡|套餐|流量|资费|携号转网/],
 ['宽带',/宽带|装网|家庭网络/],
 ['维修或配件',/维修|换屏|电池|配件|手机壳|贴膜|充电器/],
 ['赠品或优惠',/赠品|礼物|礼品|送您|送你|优惠|折扣/],
];
const question=/[?？]|多少钱|怎么|能不能|可不可以|有没有|什么|哪款|哪个|是否|划算|合适/;
const polite=/您好|你好|请问|您|麻烦|谢谢|慢走|欢迎/;
const recommendationWords=/推荐|建议|介绍|您可以|你可以|这款|这种|我们还有|还可以办理|送您|送你/;
const serviceAction=/核对|确认|查询|查一下|查一查|办理|充值金额|到账|介绍|推荐|建议|说明|告知|演示|试用|帮您看|帮你看|申请|赠品|礼物|礼品/;
const LIMIT=10;
const brief=value=>String(value).slice(0,300);
function parse(transcript){
 const raw=String(transcript||'').trim().slice(0,20000);
 if(!raw)return [];
 const normalized=raw.replace(/(营业员|店员|员工|顾客|客户|用户)\s*[:：]/g,'\n$1：');
 return normalized.split('\n').flatMap(line=>{
  const label=line.trim().match(/^(营业员|店员|员工|顾客|客户|用户)\s*[:：]\s*/);
  const role=label?/顾客|客户|用户/.test(label[1])?'customer':'staff':'unknown',body=label?line.trim().slice(label[0].length):line;
  return body.split(/(?<=[。！？!?；;])/).map(text=>({role,text:text.trim()})).filter(item=>item.text);
 });
}
function assess(transcript,{needs='',recommendation='',links=[]}={}){
 const utterances=parse(transcript),staff=utterances.filter(x=>x.role==='staff').map(x=>x.text),customer=utterances.filter(x=>x.role==='customer').map(x=>x.text),unknown=utterances.filter(x=>x.role==='unknown').map(x=>x.text);
 const topics=topicRules.filter(([,pattern])=>utterances.some(x=>pattern.test(x.text))).map(([name])=>name);
 const customerQuestions=customer.filter(x=>question.test(x)).slice(0,LIMIT);
 const qaPairs=[];for(let index=0;index<utterances.length;index++){const item=utterances[index];if(item.role!=='customer'||!question.test(item.text))continue;const next=utterances.slice(index+1).find(x=>x.role==='staff'||x.role==='customer');if(next?.role==='staff')qaPairs.push({question:item.text,answer:next.text,kind:/手机(?!卡)|机型|拍照|内存|续航|华为|小米|荣耀|苹果|iPhone/i.test(item.text+' '+next.text)?'手机问答':'业务咨询'});}
 const staffAnswers=staff.filter(x=>recommendationWords.test(x)||topicRules.some(([,pattern])=>pattern.test(x))).slice(0,LIMIT);
 const staffService=staff.filter(x=>serviceAction.test(x)).slice(0,LIMIT);
 const staffCourtesy=staff.filter(x=>polite.test(x)).slice(0,LIMIT);
 const otherBusiness=staff.filter(x=>topicRules.slice(1,5).some(([,pattern])=>pattern.test(x))).slice(0,LIMIT);
 const gifts=staff.filter(x=>topicRules[5][1].test(x)).slice(0,LIMIT);
 const evidence=[];
 if(staffAnswers.length)evidence.push('有标明说话人的营业员业务用语');
 if(customerQuestions.length)evidence.push('有标明说话人的顾客咨询');
 if(otherBusiness.length)evidence.push('营业员介绍了充值之外的业务');
 if(gifts.length)evidence.push('营业员提及赠品或优惠，实际赠送仍需核对原业务单');
 if(links.length)evidence.push('接待单已关联业务单，办理结果须核对关联原单');
 const missing=[];
 if(!utterances.length)missing.push('本单没有识别文字，不能还原当时原话');
 if(unknown.length)missing.push('部分话语未区分说话人，不计入营业员态度证据');
 if(!staff.length)missing.push('未见可归属营业员的用语');
 if(!customer.length)missing.push('未见可归属顾客的用语');
 if(!staffAnswers.length)missing.push('尚未看到营业员具体解释或推荐的原话');
 if(!staffService.length)missing.push('未见具体服务动作、解释或推荐的原话');
 const concrete=staffService.length>0&&customer.some(x=>x.length>=5);
 return {
  version:1,method:'原话关键词初评，待营业员核对、老板确认',source:utterances.length?'接待识别文字':String(needs||recommendation||'').trim()?'员工填写，非原话':'无',
  topics,staffWords:staff.slice(0,LIMIT).map(brief),customerWords:customer.slice(0,LIMIT).map(brief),unattributed:unknown.slice(0,LIMIT).map(brief),
  customerQuestions:customerQuestions.map(brief),qaPairs:qaPairs.slice(0,LIMIT).map(pair=>({kind:pair.kind,question:brief(pair.question),answer:brief(pair.answer)})),staffAnswers:staffAnswers.map(brief),staffService:staffService.map(brief),staffCourtesy:staffCourtesy.map(brief),otherBusiness:otherBusiness.map(brief),gifts:gifts.map(brief),evidence,missing,serviceComplete:concrete,
  suggestedValidity:concrete?'可考虑有效，待老板核实':'证据不足，待补充或判无效',
  scoreNote:'只能评估已记录的用语，不能从文字判断语气或音量。初评不改变有效性或积分；有效接待只按正常积分核定。',
 };
}
module.exports={parse,assess};
