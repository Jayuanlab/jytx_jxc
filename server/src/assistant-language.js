'use strict';
// Interpret language only: aliases never select an account or authorize a mutation.
const aliases=[
 ['信号机微信|微信信号机|信号及微信','门店微信'],
 ['现金库|门市抽屉|门店抽屉','门店现金'],
 ['空中充值|空充(?!BOSS)|移动BOSS|移动boss','空充BOSS'],
 ['门店微信扫码|微信扫码|支付宝扫码','扫码支付'],
 ['现金转老板银行卡|现金转存老板银行卡','现金转存老板银行'],
 ['交接班结算|交班结算','当日中途扎账'],
 ['内部交接单|内转单|内部转存单','内转资金交接单'],
 ['内转清单|交接单查询','内转资金交接清单'],
 ['进货与库存','进货库存'],['货品档案','商品档案'],
 ['订货查询','订货单查询'],
 ['充话费|交话费','话费充值'],['手机卡|电话卡','号卡'],
 ['装宽带|安宽带','办理宽带'],['好多钱|几多钱','多少钱'],
 ['有好多|有好多个','有多少'],['啥子|些啥|什么些','什么'],
 ['啷个|咋个','怎么'],['对得到不|对得上不|对得到吗','是否相符'],
 ['查得到不|查得到吗','能否查到'],['看哈|看一哈|瞅一下','看一下'],
 ['今朝','今天'],['昨儿|昨天那天','昨天']
];
function normalize(value,{customer=false}={}){
 let q=String(value||'').trim();
 // Do not rewrite instructions being taught, quoted account names or numerical identifiers.
 if(/^(?:请|帮我)?(?:记住|记下来|长期记住|保存规则|保存这条规则)/.test(q))return q;
 for(const [pattern,name] of aliases){
  if(customer&&/微信|现金|BOSS|付款|交接|转存/.test(name))continue;
  q=q.replace(new RegExp(pattern,'g'),name);
 }
 q=q.replace(/卖的是些什么|卖了些什么|卖的是些?什么|卖的什么|卖些?什么|卖了些?啥/g,'卖了哪些商品');
 if(/当日|今日|今天|结账|现金|余额|账目|核对|明细/.test(q))q=q.replace(/结扎|轧账|打仗/g,'扎账');
 return q;
}
const followup=q=>/^(?:按|按照|分类|分组|再|继续|接着|那|这个|那个|刚才|前面|上一|昨天呢|今天呢|本月呢|详细一点|详细点)/.test(q);
function resolve(question,history=[]){
 const q=normalize(question),turns=history.slice(-8);
 if(!followup(q))return q;
 const previous=[...turns].reverse().find(t=>/销售|销量|营业额|卖|库存|空充|门店微信|老板微信|门店现金|扫码支付/.test(t.question||''));
 if(!previous)return q;
 let anchor=normalize(previous.question).split('；本次追问：')[0];
 // An explicit new topic must win over a pronoun or date continuation.
 const domain=s=>/门店微信|老板微信|门店现金|空充BOSS|库存|销售|卖|营业额/.exec(s)?.[0];
 const next=domain(q),old=domain(anchor);if(next&&old&&next!==old&&!(/销售|卖|营业额/.test(next)&&/销售|卖|营业额/.test(old)))return q;
 const date=q.match(/今天|昨天|本周|本月|\d{4}-\d{2}-\d{2}/)?.[0];
 if(date)anchor=anchor.replace(/今天|今日|当日|昨天|本周|本月|\d{4}-\d{2}-\d{2}/g,'').trim();
 return (anchor+'；本次追问：'+q).slice(0,1000);
}
function selectRules(rules=[],limit=6000){
 const selected=[];let length=0;
 for(const r of rules){const text=r.title+'：'+r.content+'；适用条件：'+(r.conditions||'')+'；例外：'+(r.counterexample||'');if(length+text.length>limit)continue;selected.push(text);length+=text.length;}
 return selected.join('\n');
}
module.exports={normalize,resolve,followup,selectRules,aliases};
