'use strict';
const language=require('./assistant-language');
function staff(store,user,payload){
 const c=require('./common');
 const data=require('./personnel').list(store,user);
 const result=(answer,restricted=false)=>({answer,mode:'store',asOf:c.now(),sources:restricted?[]:[{label:'在职员工档案',href:'/personnel'}],followups:[],unresolved:false,metrics:{kind:'staff-tool',...(restricted?{restricted:true}:{})}});
 if(!data.staffing)return result('当前账号没有查看全店在职员工名单的权限。',true);
 const names=data.roster.map(row=>row.name).filter(Boolean);
 return result('当前在职员工共 '+names.length+' 人'+(names.length?'：'+names.join('、'):'。')+(names.length?'。':''));
}
function attendance(store,user,payload,argumentsFromAgent={}){
 const c=require('./common'),question=String(payload.question||''),today=c.day();
 const result=(answer,restricted=false,facts)=>({answer,mode:'store',asOf:c.now(),sources:restricted?[]:[{label:'考勤打卡原始记录',href:'/assistant?work-signin=1'}],followups:[],unresolved:false,metrics:{kind:'attendance-tool',...(restricted?{restricted:true}:{})},...(facts?{facts}:{})});
 const proposed=String(argumentsFromAgent.date||'').trim(),fromQuestion=question.match(/\d{4}-\d{2}-\d{2}/)?.[0];
 const date=fromQuestion||(/前天/.test(question)?c.day(Date.now()-2*86400000):/昨天|昨日/.test(question)?c.day(Date.now()-86400000):proposed||today);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today||!Number.isFinite(Date.parse(date+'T00:00:00+08:00'))||c.day(date+'T00:00:00+08:00')!==date)return result('请指定今天或之前的有效日期。');
 const personnel=require('./personnel').list(store,user),leaveAllowed=Boolean(personnel.staffing),allowed=leaveAllowed||user.roleCode==='manager',roster=(store.users||[]).filter(row=>row.status==='active'&&row.roleCode!=='owner'&&!row.assistantCustomerOnly&&!['customer-assistant','personal-assistant'].includes(row.roleCode));
 const name=String(argumentsFromAgent.personName||'').trim(),mentioned=roster.filter(row=>row.name&&question.includes(row.name)).sort((a,b)=>b.name.length-a.name.length)[0];
 const target=mentioned||roster.find(row=>row.name===name)||(name===user.name?user:null);
 if(name&&!target)return result('没有找到这位在职员工，请提供完整姓名。');
 if(target&&target.id!==user.id&&!allowed)return result('当前账号只能查看本人的签到记录。',true);
 const wantsAll=argumentsFromAgent.scope==='all'||!target&&/(?:员工|大家|全店|所有|谁|哪些|几人|多少人|情况|记录)/.test(question);
 if(wantsAll&&!allowed)return result('当前账号不能查看其他员工的签到记录；可以查询本人记录。',true);
 const people=target?[target]:wantsAll?roster:[user];
 const time=value=>new Date(value).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 if(/请假|休假/.test(question)){
   if(!leaveAllowed&&(target?.id!==user.id||wantsAll))return result('当前账号只能查看本人的请休假记录。',true);
   const dayStart=Date.parse(date+'T00:00:00+08:00'),dayEnd=dayStart+86400000,now=Date.now(),current=date===today;
   const lines=people.slice(0,50).map(person=>{
     const approved=personnel.leaves.filter(row=>row.applicantId===person.id&&row.status==='已批准'&&Date.parse(row.startAt)<dayEnd&&Date.parse(row.endAt)>dayStart&&(!current||Date.parse(row.startAt)<=now&&Date.parse(row.endAt)>now));
     return person.name+'：'+(approved.length?approved.map(row=>row.type+' '+new Date(row.startAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' 至 '+new Date(row.endAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})).join('；'):'未见已批准且'+(current?'当前生效':'当日有效')+'的请休假记录');
   });
   return result(date+' 请休假记录：\n'+lines.join('\n')+'\n未见请休假记录不能证明实际在岗。');
 }
 const checkedInPeople=people.filter(person=>(store.attendance||[]).some(row=>row.userId===person.id&&row.date===date&&row.checkInAt));
 const lines=people.slice(0,50).map(person=>{
   const shifts=(store.attendance||[]).filter(row=>row.userId===person.id&&row.date===date&&row.checkInAt).sort((a,b)=>Date.parse(a.checkInAt)-Date.parse(b.checkInAt));
   if(!shifts.length)return person.name+'：未见签到记录';
   return person.name+'：'+shifts.map(row=>{
     const outside=(store.attendanceFieldwork||[]).filter(work=>work.userId===person.id&&work.attendanceId===row.id).map(work=>'，外勤 '+time(work.startAt)+(work.endAt?' 至 '+time(work.endAt):'进行中'));
     return '签到 '+time(row.checkInAt)+(row.checkOutAt?'，签退 '+time(row.checkOutAt):'，尚未签退')+outside.join('');
   }).join('；');
 });
 return result(date+' 签到记录：\n'+lines.join('\n')+(people.length>50?'\n其余人员请在考勤页查看。':'')+'\n未见签到不等于缺勤，需结合请休假和实际在岗核对。',false,
   {date,scope:wantsAll?'all':target?'person':'self',peopleInScope:people.length,checkedInCount:checkedInPeople.length,checkedInNames:checkedInPeople.slice(0,50).map(person=>person.name),checkedInNamesTruncated:checkedInPeople.length>50,note:'按该日当前账号可见的原始签到记录去重计人数；未见签到记录不能断定缺勤。'});
}
function read(store,user,payload){
 if(payload.mode!=='store'||user.assistantCustomerOnly||user.roleCode==='customer-assistant')return null;
 const c=require('./common'),question=language.resolve(payload.question,payload.history),caps=c.capabilities(user);
 if(/上班|在岗|营业员|休假|请假/.test(question)&&/哪些|谁|在不在|是不是|是否|在休假|休假.*吗/.test(question)&&!/申请|提交|批准|修改|删除/.test(question)){
  const data=require('./personnel').list(store,user),staffing=data.staffing;
  const result=answer=>({answer,mode:'store',sources:[{label:'签到与请休假记录',href:'/personnel'}],followups:[],unresolved:false,metrics:{kind:'business-read'}});
  if(/昨天|前天|本月|本周|\d{4}-\d{2}-\d{2}/.test(question))return result('这项在岗查询显示当前状态，历史考勤请按日期查阅记录。');
  const person=(store.users||[]).find(u=>u.name&&question.includes(u.name));
  if(!staffing&&person?.id!==user.id)return {...result('当前账号只能查看本人的请休假记录。'),metrics:{kind:'business-read',restricted:true}};
  if(person&&/休假|请假/.test(question)){
   const now=Date.now(),approved=data.leaves.find(r=>r.applicantId===person.id&&r.status==='已批准'&&Date.parse(r.startAt)<=now&&Date.parse(r.endAt)>now);
   return result(approved?person.name+'当前有已批准的'+approved.type+'记录。':person.name+'当前没有查到已批准且正在生效的请休假记录；不能据此断定其实际在岗。');
  }
  if(!staffing)return result('当前账号不能查看全店在岗人员。');
  return result('按当前签到记录，在岗未签退：'+(staffing.working.join('、')||'暂无')+'。'+(staffing.fieldwork.length?'外勤：'+staffing.fieldwork.join('、')+'。':'')+(staffing.conflict.length?'其中'+staffing.conflict.join('、')+'同时有生效请休假记录，需核对。':''));
 }
 if(!/空充BOSS|门店微信|门店现金|老板微信|老板支付宝|老板银行卡|资金账户/.test(question))return null;
 if(!/多少|几笔|余额|结余|增减|增加|减少|净变动|明细|记录|流水|账户名称|有哪些|所有账户/.test(question))return null;
 if(/开单|新建|创建|录入|提交|确认|审核|删除|修改|调价|转款|红冲|保存|办理|扣款/.test(question))return null;
 if(!caps.finance)return {answer:'当前账号没有资金查询权限。',mode:'store',sources:[],unresolved:false,metrics:{kind:'business-read',restricted:true}};
 const today=c.day(),dateMatch=question.match(/\d{4}-\d{2}-\d{2}/),date=dateMatch?.[0]||(/昨天/.test(question)?new Date(Date.parse(today+'T00:00:00+08:00')-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}):today);
 const reply=(answer,href)=>({answer,mode:'store',asOf:c.now(),sources:[{label:'查看原单与明细',href}],followups:[],unresolved:false,context:{question:question.slice(0,240),topicQuestion:question.slice(0,240),userId:user.id,at:Date.now(),mode:'store'},metrics:{kind:'business-read',date}});
 if(date>today||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return reply('请指定今天或之前的有效日期。','/daily-close?view=query');
 if(/本月|本周|上月|上周|前天|\d{4}-\d{2}-\d{2}.{0,4}(?:到|至)|最近.{0,3}天/.test(question))return reply('请指定要查询哪一天的账户余额或流水。','/daily-close?view=query');
 if(/空充BOSS/.test(question)){
  const a=require('./air-accounts').statement(store,user,{date});
  if(/几笔|多少笔/.test(question)){const kinds=/平台充值|充入|充值到账/.test(question)?['funding']:['customer_recharge'];return reply(date+' 空充BOSS'+(kinds[0]==='funding'?'平台充值':'客户充值')+'台账记录 '+a.rows.filter(r=>kinds.includes(r.kind)).length+' 笔。','/air-accounts');}
  if(!a.hasOpening)return reply('空充BOSS还没有登记期初，暂不能计算账面余额。','/air-accounts');
  const fmt=n=>Number(n).toFixed(2);
  let answer=/充值了多少|充了多少|充值金额|充入|到账多少/.test(question)?date+' 空充BOSS充值到账 '+fmt(a.creditedAmount)+' 元。':/手续费/.test(question)?date+' 空充BOSS已登记手续费 '+fmt(a.feeAmount)+' 元。':/扣了|扣款|消费|充出|客户充值/.test(question)?date+' 空充BOSS客户充值扣减 '+fmt(a.customerDebit)+' 元。':date+' 空充BOSS账面余额 '+fmt(a.closingBalance)+' 元。';
  if(/增减|增加|减少|净变动/.test(question))answer=date+' 空充BOSS：期初 '+fmt(a.startingBalance)+' 元，充值到账 '+fmt(a.creditedAmount)+' 元，客户充值扣减 '+fmt(a.customerDebit)+' 元，其他变动 '+fmt(a.otherChange)+' 元，账面结余 '+fmt(a.closingBalance)+' 元。';
  return reply(answer,'/air-accounts');
 }
 if(/门店微信/.test(question)){
  const w=require('./wallet-daily').summary(store,date);
  if(!w.available)return reply('门店微信：'+w.reason,'/daily-close');
  const fmt=n=>Number(n).toFixed(2);
  const answer=/付款|支出|减少/.test(question)&&!/增减|增加|净变动|明细|流水|记录/.test(question)?date+' 门店微信减少 '+fmt(w.todayOut)+' 元。':/收款|收入|增加/.test(question)&&!/增减|减少|净变动|明细|流水|记录/.test(question)?date+' 门店微信增加 '+fmt(w.todayIn)+' 元。':/增加|减少|增减|净变动|明细|流水|记录/.test(question)?date+' 门店微信增加 '+fmt(w.todayIn)+' 元，减少 '+fmt(w.todayOut)+' 元，净变动 '+fmt(w.todayNet)+' 元。':w.expectedBalance==null?'门店微信尚未建立已复核、已锁定的结余，暂不能推算账面余额。':date+' 门店微信账面余额 '+fmt(w.expectedBalance)+' 元。';
  return reply(answer,'/daily-close');
 }
 // A cash basis is not the owner's personal money; use its established engine.
 if(/门店现金/.test(question)){
  const engine=require('./cash-basis'),shot=engine.rollingSnapshot(store,date);
  return reply(shot.openingCashSuggested==null?'门店现金尚无可追溯的账面基准，暂不能推算余额。':date+' 门店现金账面应有 '+Number(engine.expected(shot.openingCashSuggested,shot)).toFixed(2)+' 元；根据已登记基准和后续现金流水计算，仍需店内按实物核对。','/simple-daily-close');
 }
 const book=require('./named-fund-accounts').build(store,date),names=['老板微信','老板支付宝','老板银行卡'],name=names.find(n=>question.includes(n));
 const rows=name?book.rows.filter(r=>r.name.includes(name)):book.rows;
 if(!rows.length)return reply('没有找到'+(name||'符合条件的资金账户')+'记录。','/payment-accounts');
 const fmt=n=>Number(n).toFixed(2);
 return reply(/账户名称|有哪些|所有账户/.test(question)?rows.map(r=>r.name).join('、')+'。':rows.map(r=>r.name+'：'+(/余额|结余/.test(question)?r.balance==null?'尚无可核实余额基准。':'账面余额 '+fmt(r.balance)+' 元。':'收 '+fmt(r.received)+' 元，付 '+fmt(r.paid)+' 元，净变动 '+fmt(r.net)+' 元。')).join('\n'),'/daily-close');
}
module.exports={read,attendance,staff};
