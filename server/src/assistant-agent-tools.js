'use strict';

// Work-assistant tools return bounded, permission-scoped evidence. They never
// compose the final conversational answer or perform a business write.
const c=require('./common');
const data=require('./assistant-data-query');
const authority=require('./rule-authority');
const screenTime=require('./screen-time');

const routes=Object.freeze(['data.query','phone.parameters','knowledge.lookup','workflow.lookup','screen.edit','conversation.reply']);
const source=(label,href)=>({label,href});

function domainsArg(value){
  if(Array.isArray(value))return value;
  if(typeof value==='string')try{const parsed=JSON.parse(value);if(Array.isArray(parsed))return parsed;}catch{}
  return [];
}

function queryData(store,user,args={},question=''){
  const domains=[...new Set(domainsArg(args.domains).map(String))].slice(0,3);
  if(!domains.length)throw new c.HttpError(400,'请选择要查询的数据领域');
  const results=domains.map(domain=>data.query(store,user,{...args,domain,question}));
  return {route:'data.query',results,sources:results.flatMap(x=>x.result?.sources||[]),domains};
}

function lookupKnowledge(store,user,question,ruleMemory={}){
  const active=authority.query(question,user);
  if(active)return {route:'knowledge.lookup',results:[{kind:'protected-rule',answer:active.answer,asOf:c.now(),sources:active.sources||[],authority:'current-rule'}],sources:active.sources||[],protectedReply:active};
  const matched=(Array.isArray(ruleMemory.rules)?ruleMemory.rules:[]).slice(0,4);
  if(matched.length)return {route:'knowledge.lookup',results:matched.map(x=>({kind:'confirmed-rule-memory',title:x.title,content:x.content,conditions:x.conditions,counterexample:x.counterexample,version:x.version})),sources:matched.map(x=>source(x.title,'/assistant-memory#'+encodeURIComponent(x.id)))};
  const found=require('./policy-knowledge-query').query(store,user,question,store.employeeKnowledge||[]);
  if(found)return {route:'knowledge.lookup',results:[{kind:'verified-knowledge',answer:found.answer,needsReview:found.metrics?.needsReview===true}],sources:found.sources||[]};
  return {route:'knowledge.lookup',results:[{kind:'not-found',reason:'当前已核实资料中没有与本次问题匹配的内容。不能猜测资费、政策或办理条件。'}],sources:[]};
}

function lookupWorkflow(store,user,args={}){
  const items=require('./assistant-capabilities').catalog(store,user).items;
  const id=String(args.featureId||'').trim();
  const selected=id?items.filter(x=>x.id===id):items;
  return {route:'workflow.lookup',results:[{kind:'authorized-feature-catalog',items:selected.slice(0,45).map(x=>({id:x.id,label:x.label,description:x.description,href:x.href,mode:x.mode})),
    ...(id&&!selected.length?{reason:'当前账号无此功能入口，或功能编号不正确。'}:{})}],sources:selected.slice(0,8).map(x=>source(x.label,x.href)),
    action:selected.length===1?{type:'navigate',href:selected[0].href,label:'打开'+selected[0].label}:null};
}

function editScreen(store,user,question,args={},context=null){
  const normalized=String(question||'').replace(/草稿|写一段|写一条|拟一段|拟一条/g,'起草');
  const reply=require('./assistant-screen').query(store,user,normalized,{context});
  if(!reply)throw new c.HttpError(400,'请说明要起草或修改的电子屏内容');
  const proposed=screenTime.bodyOnly(args.draftContent);
  const explicit=/(?:改成|改为|修改为|更新为|换成|换为|写成|内容是|内容为|(?:电子屏|显示屏|大屏)(?:显示|发布|播报))[：:，,\s]*[“"「]?[^\s]/.test(question);
  if(!explicit&&proposed&&proposed.length<=500&&['screen-update','screen-publish'].includes(reply.action?.type)){
    const playback=reply.action.payload.schedule;
    if(!screenTime.fits(proposed,playback))return {route:'screen.edit',screenReply:{...reply,action:null,answer:'草稿里的早中晚问候与播放时段不一致，请指定正确时段或改用全天适用的正文。',metrics:{kind:'screen-time-conflict'}},results:[{kind:'screen-time-conflict'}],sources:reply.sources||[],action:null};
    reply.action={...reply.action,payload:{...reply.action.payload,content:proposed}};
    reply.conversationHint={...reply.conversationHint,draftContent:proposed};
    reply.answer='已准备电子屏文案草稿：'+proposed+'\n点击确认按钮后才会保存；当前电子屏内容尚未改变。';
  }
  return {route:'screen.edit',screenReply:reply,results:[{kind:'screen-edit-preview',answer:reply.answer}],sources:reply.sources||[],action:reply.action||null};
}

function run(store,user,{route,args}={},question,ruleMemory,context){
  if(!routes.includes(route))throw new c.HttpError(400,'不支持的智能体工具');
  if(route==='data.query')return queryData(store,user,args,question);
  if(route==='phone.parameters')return require('./assistant-phone-spec-tool').query(store,user,args,question,context);
  if(route==='knowledge.lookup')return lookupKnowledge(store,user,question,ruleMemory);
  if(route==='workflow.lookup')return lookupWorkflow(store,user,args);
  if(route==='screen.edit')return editScreen(store,user,question,args,context);
  return {route:'conversation.reply',results:[{kind:'general-conversation',constraint:'没有读取门店业务数据；不得声称当前门店、人员、金额或商品事实。'}],sources:[]};
}

module.exports={routes,run};
