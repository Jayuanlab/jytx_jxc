'use strict';
const c=require('./common'),erp=require('./erp'),web=require('./phone-spec-web');
const normalized=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s._-]/g,'');
const allowed=u=>u&&u.status==='active'&&['sell','purchase','stocktake','manageProducts'].some(k=>c.capabilities(u)[k]);
const refresh=q=>/实时|最新|刷新参数|重新联网|重新查参数/.test(q);
function fields(record){return record?.status==='ok'?(record.fields||[]).filter(f=>['verified','reference'].includes(f.status)&&f.key!=='storage'):[];}
function summary(record,question,all=false){
 const available=fields(record),priority=/屏幕|清晰/.test(question)?['screenSize','screenType','resolution','refreshRate','battery','charging','chipset']:/拍照|摄像/.test(question)?['rearCamera','screenSize','battery','chipset','charging']: /游戏|性能|处理器/.test(question)?['chipset','refreshRate','screenSize','battery','charging']:['battery','charging','screenSize','screenType','chipset','resolution','refreshRate','rearCamera','os'];
 return priority.map(k=>available.find(f=>f.key===k)).filter(Boolean).slice(0,all?9:4).map(f=>f.label+' '+f.value).join('，');
}
function sources(records){return [...new Map(records.flatMap(r=>r.status==='ok'?(r.sources||[]).map(s=>({label:(s.tier==='manufacturer'?'品牌官网':new URL(s.url).hostname==='product.pconline.com.cn'?'太平洋参数库':'中关村参数库')+' · '+r.displayName,href:s.url})):[]).map(s=>[s.href,s])).values()].slice(0,8);}
async function enrich(phone,user,question){
 if(!allowed(user)||phone.restricted)return phone;
 const records=await Promise.all(phone.rows.slice(0,3).map(p=>web.lookup({name:p.name,brand:p.brand},{refresh:refresh(question)})));
 const rows=phone.rows.map((p,i)=>({...p,phoneSpecification:records[i],configuration:summary(records[i],question)}));
 if(/续航|待机|电池/.test(question))rows.sort((a,b)=>{const over=p=>phone.budget?.kind==='approximate'&&p.salePrice>phone.budget.target?1:0;const battery=p=>Number(fields(p.phoneSpecification).find(f=>f.key==='battery')?.value.match(/\d+/)?.[0]||0);return over(a)-over(b)||battery(b)-battery(a)||a.salePrice-b.salePrice;});
 return {...phone,rows,specifications:records,sources:sources(records)};
}
function choose(store,user,args,question,context){
 const list=erp.listProducts(store,user,{catalog:true}).filter(p=>/^(智能机|智能手机|功能机|按键机|老人机)$/.test(p.type||''));
 const q=normalized(question),direct=web.identity(String(args?.modelName||''));
 if(direct&&q.includes(direct.model)&&(!q.includes('华为')||direct.brand==='huawei')&&(!q.includes('荣耀')||direct.brand==='honor'))return [direct];
 const matches=list.map(p=>web.identity(p.name,p.brand||p.subType)).filter(Boolean).filter(id=>{
  const i=q.indexOf(id.model);if(i<0)return false;const tail=q.slice(i+id.model.length);return /^\d{2,4}(?:g|gb)/.test(tail)||!/^(?:pro|max|plus|ultra|元气版|超级版|[a-z0-9])/.test(tail);
 });
 const unique=[...new Map(matches.map(id=>[id.key,{...id,variant:null}])).values()];if(unique.length)return unique.slice(0,2);
 if(/这款|那款|它|这个|电池|屏幕|参数|配置/.test(question)&&!/(?:华为|荣耀|vivo|oppo|小米|iphone).{0,20}\d/i.test(question)){const remembered=(context?.phoneSpecifications?.models||[]).map(x=>web.identity(x)).filter(Boolean);return remembered.length===1?remembered:[];}
 return [];
}
async function query(store,user,args,question,context){
 if(!allowed(user))return {route:'phone.parameters',results:[{result:{restricted:true,reason:'当前账号没有手机商品查询权限。'}}],sources:[]};
 const targets=choose(store,user,args,question,context);
 if(!targets.length)return {route:'phone.parameters',results:[{kind:'phone-specifications',targets:[],reason:'请告诉我具体品牌和型号，例如“华为畅享90 Plus 256G”，我再联网核对配置。'}],sources:[]};
 const records=await Promise.all(targets.map(id=>web.lookup(id,{refresh:refresh(question)})));
 return {route:'phone.parameters',results:[{kind:'phone-specifications',targets,records}],sources:sources(records)};
}
function render(record,question,all=true){
 if(record.status!=='ok')return `${record.displayName||'这款手机'}暂时没有取得可核对的新参数${record.status==='stale'?'，原资料已保留但本次不当作最新配置':''}，请核对具体型号或稍后重试。`;
 const state=record.cache==='hit'?'读取已保存资料':'本次联网核对并保存';
 const date=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(record.fetchedAt));
 const source=record.sources.some(s=>s.tier==='manufacturer')?'品牌中国官网':'参数库参考资料';
 return record.displayName+'：'+summary(record,question,all)+'。'+source+'，'+date+'核对；'+state+'。'+(record.conflicts?.length?'部分字段来源不一致，已留作待核，不用于推荐。':'');
}
const parameterIntent=q=>/参数|配置|电池容量|充电功率|屏幕分辨率|什么处理器|处理器型号|多大电池|电池多大/.test(q)&&!/成本|进价|毛利|利润|工资|销售单|采购单|删除|修改|设置|怎么实现|如何实现|电子屏/.test(q);
module.exports={query,enrich,render,summary,sources,fields,choose,parameterIntent};
