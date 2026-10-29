'use strict';
const requested=q=>!/(?:不要|不需要|不用|别给).{0,5}(?:话术|讲解)/.test(String(q||''))&&/话术|讲解|重庆话|地方话|方言|口语一点|自然一点|对比着讲|少报参数|怎么(?:跟|给|向).{0,12}(?:顾客|客户|用户|客人).{0,8}(?:说|介绍|推荐)|对(?:顾客|客户|用户|客人)(?:说|介绍|推荐)|直接(?:给|跟|向).{0,8}(?:讲|说|介绍)|口语.{0,4}(?:介绍|推荐)/.test(String(q||''));
const unrelated=q=>/成本|进价|毛利|利润|工资|删除|改价|调价|红冲|审批|电子屏|收款|付款|资金|移动业务|套餐|资费|宽带|国补/.test(q);
function continuation(question,context,user){
 if(!requested(question)||unrelated(question)||context?.userId!==user?.id||context?.mode!=='store'||!Number.isFinite(context?.at)||Date.now()-context.at<0||Date.now()-context.at>1800000||!context.phoneSpecifications?.models?.length)return null;
 const previous=String(context.phoneRecommendation?.question||context.topicQuestion||context.question||'').slice(0,750);
 if(!require('./assistant-phone-recommend').intent(previous))return null;
 // Context carries the old request, never trusted prices or stock. The current
 // user's authorized inventory reader runs again before any speech is formed.
 return (previous+'\n本次要求：'+question).slice(0,1000);
}
const fields=p=>p?.phoneSpecification?.status==='ok'?(p.phoneSpecification.fields||[]).filter(f=>['verified','reference'].includes(f.status)):[];
const number=(p,key)=>{const v=fields(p).find(f=>f.key===key)?.value;return v?Number(v.match(/\d+(?:\.\d+)?/)?.[0])||null:null;};
function display(p){const name=p.name.replace(/[（(][12][)）]$/,'').trim(),brand=p.brand||'';return name.toLowerCase().includes(brand.toLowerCase())?name:brand+' '+name;}
function build(phone,question,store={}){
 if(!requested(question)||phone.restricted)return null;
 const b=phone.budget,under=p=>b?.kind!=='approximate'||p.salePrice<=b.target;
 const selected=phone.rows.find(under)||phone.rows[0];
 if(!selected)return {skuId:null,text:'您这个预算和型号条件，店里现在没有匹配的可售现货。咱们先核对其他款或订货，价钱和到货时间确认了再定。'};
 const language=require('./assistant-customer-language').context(store),lastStyle=[...question.matchAll(/不用方言|不要方言|普通话|重庆话|地方话|方言/g)].at(-1)?.[0],local=!/^(?:普通话|不用方言|不要方言)$/.test(lastStyle||'')&&language.examples.length>0;
 const cheap=local&&language.mappings.some(x=>x.from==='相因点')?'相因':'便宜';
 const home=local&&language.examples.some(x=>x.articleId==='customer-talk-20261009-broadband')?'屋头':'家里';
 const model=display(selected),budget=b?.kind==='approximate'?b.target+'块左右':b?.kind==='maximum'?b.maximum+'块以内':null;
 let text=local?'我给您摆清楚哈，':'我给您比较一下，';
 text+=(budget?'您预算'+budget+'，':'')+'我先给您看这款'+model+'，本店'+selected.salePrice+'块，有现货。';
 if(b?.kind==='approximate')text+=selected.salePrice>b.target?'这款超过了您原来的目标价，得您愿意加预算再考虑。':'价钱在您目标预算内。';
 else if(b?.kind==='maximum')text+='价钱没有超出您的预算。';
 const other=phone.rows.filter(p=>p.skuId!==selected.skuId&&Number.isFinite(p.salePrice)&&p.availableQuantity>0).sort((a,z)=>Math.abs(a.salePrice-selected.salePrice)-Math.abs(z.salePrice-selected.salePrice))[0];
 const comparisons=[];
 if(other){
  const diff=Math.round(Math.abs(other.salePrice-selected.salePrice)*100)/100;
  text+='跟'+display(other)+'一比，';
  text+=diff?(selected.salePrice<other.salePrice?'这款'+cheap+diff+'块，那款是'+other.salePrice+'块。':'这款贵'+diff+'块，那款是'+other.salePrice+'块。'):'两款价钱一样。';
  for(const [key,label]of [['battery','电池容量'],['screenSize','屏幕尺寸'],['charging','有线充电功率']]){const a=number(selected,key),z=number(other,key);if(a!==null&&z!==null)comparisons.push({key,label,selected:a,other:z,relation:a===z?'equal':a>z?'selected-greater':'other-greater'});}
  const battery=comparisons.find(x=>x.key==='battery'),screen=comparisons.find(x=>x.key==='screenSize'),charging=comparisons.find(x=>x.key==='charging');
  if(battery&&battery.relation!=='equal')text+=(battery.relation==='other-greater'?'那款':'这款')+'电池容量更大';
  if(screen&&screen.relation!=='equal')text+=(battery&&battery.relation!=='equal'?'；':'')+(screen.relation==='other-greater'?'那款':'这款')+'屏幕大一点';
  if(battery&&battery.relation!=='equal'||screen&&screen.relation!=='equal')text+='。';
  if(charging?.relation==='equal')text+='两款有线充电功率一样，不用为了这一项多花钱。';
  if(battery?.relation==='equal')text+='电池容量这一项，两款也一样。';
  const identity=require('./phone-spec-web').identity,storage=p=>{const raw=identity(p.name,p.brand)?.variant?.split('+').at(-1),value=Number(raw?.replace(/[GTB]/g,''));return value&&(/T/.test(raw)?value*1024:value);};
  const ownStorage=storage(selected),otherStorage=storage(other);
  if(ownStorage&&otherStorage&&ownStorage!==otherStorage){text+=(ownStorage>otherStorage?'这款':'那款')+'存储空间更大，照片、视频更有地方放。';comparisons.push({key:'storage',selected:ownStorage,other:otherStorage,relation:ownStorage>otherStorage?'selected-greater':'other-greater'});}
  if(b?.kind==='approximate'&&under(selected)&&other.salePrice>b.target)text+='守住'+b.target+'块左右这个预算，就先看'+model+'；那款得您愿意加到'+other.salePrice+'块再选。';
 }
 if(/老年|老人|长辈|父母|爸爸|妈妈/.test(question))text+='给'+home+'长辈用，咱们把字调大、试清楚来电声音，再拿起看看顺不顺手'+(local?'嘛。':'。');
 else text+='咱们拿起'+(other?'两款':'这款')+'试一试，按您最在意的地方来选'+(local?'嘛。':'。');
 return {skuId:selected.skuId,text,comparisonSkuId:other?.skuId||null,comparisons,language:local?'重庆口语（参考原云阳话资料）':'普通话',languageArticleIds:local?['customer-talk-20261009-dialect-glossary','customer-talk-20261009-principles',...(home==='屋头'?['customer-talk-20261009-broadband']:[])].filter(id=>language.examples.some(x=>x.articleId===id)||language.mappings.some(x=>x.articleId===id)):[]};
}
module.exports={requested,continuation,build};
