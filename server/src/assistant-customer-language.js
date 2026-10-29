'use strict';
const seed=require('./assistant-customer-language-seed.json');
const clean=v=>String(v??'').trim();
const normalize=v=>clean(v).normalize('NFKC').toLowerCase();
// This module supplies speech examples only. It grants no business authority,
// changes no source status, and must never be used as a tariff evidence tool.
function context(store={},today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())){
  const live=Array.isArray(store.employeeKnowledge)?store.employeeKnowledge:[];
  const byId=new Map(seed.articles.map(x=>[x.id,x]));
  for(const row of live)if(byId.has(row.id))byId.set(row.id,row);
  const usable=[...byId.values()].filter(x=>x.enabled!==false&&!x.deleted&&!x.deletedAt&&x.policyStatus==='current'&&!x.sourceRevisionNote&&(!x.validFrom||x.validFrom<=today)&&(!x.validTo||x.validTo>=today));
  const entries=usable.flatMap(x=>(Array.isArray(x.dialectMappings)?x.dialectMappings:[]).map(m=>({...m,articleId:x.id,to:(Array.isArray(m.to)?m.to:[m.to]).map(clean).filter(Boolean)})));
  const grouped=new Map();
  for(const row of entries){const key=normalize(row.from);if(!key)continue;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
  const mappings=[];
  for(const [from,rows] of grouped){const targets=[...new Set(rows.flatMap(x=>x.to).map(normalize))];if(rows.some(x=>x.requiresContext||x.needsContext||x.ambiguous)||targets.length!==1||/\d/.test(from+targets[0]))continue;mappings.push({from,to:targets[0],articleId:rows[0].articleId});}
  const examples=usable.filter(x=>x.summaryDialect&&!x.dialectMappings&&!/\d/.test(x.summaryDialect)).map(x=>({articleId:x.id,text:clean(x.summaryDialect),sources:x.sourceFiles||[]}));
  return {language:'云阳话',principle:'先听需求，一次问一个问题；多义词先澄清；粗俗词只用于理解，不用于对客回答；语言资料不能证明当前资费、价格或办理资格。',mappings,ambiguous:entries.filter(x=>x.requiresContext).map(x=>({from:x.from,meanings:x.to})),examples};
}
module.exports={context};
