const c = require('./common');
const guardian = require('./guardian');
const privileged = user => ['owner','manager'].includes(user.roleCode);
const onDay=(value,date)=>Boolean(value)&&!Number.isNaN(Date.parse(value))&&c.day(value)===date;
const labelDay=date=>date===c.day()?'今天':date===c.day(Date.now()-86400000)?'昨天':date;
const source=(label,id,href)=>({label,id:String(id),href});
function snapshot(store,user,{date=c.day(),employeeId=null}={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00+08:00'))||c.day(date+'T00:00:00+08:00')!==date)throw new c.HttpError(400,'日期格式不正确');
  if(employeeId&&employeeId!==user.id&&!privileged(user))throw new c.HttpError(403,'当前岗位不能查看其他员工的工作和积分');
  const scope=employeeId?[employeeId]:privileged(user)?(store.users||[]).map(x=>x.id):[user.id];
  const allowed=new Set(scope), people=new Map((store.users||[]).map(x=>[x.id,{id:x.id,name:x.name,receptions:0,sales:0,carrier:0,assists:0,learning:0,journals:0,points:0,pendingPoints:0,events:0}]));
  const evidence=[],alerts=[];
  const count=(id,key,doc,href,at=doc.createdAt)=>{if(!allowed.has(id)||!onDay(at,date))return;const person=people.get(id);if(!person)return;person[key]++;person.events++;evidence.push(source(key==='journals'?'工作日志':key==='learning'?'学习单':key==='assists'?'协助记录':key==='carrier'?'移动业务':key==='sales'?'销售单':'接待单',doc.id,href));};
  for(const r of store.receptions||[]) {
    count(r.ownerId,'receptions',r,'/receptions');
    for(const a of r.assists||[]) { // The same participant is counted once per assistance record.
      for(const id of new Set([a.fromId,a.toId])){count(id,'assists',a,'/receptions');if(a.status==='待确认'&&allowed.has(id)&&people.has(id))people.get(id).pendingPoints++;}
    }
    for(const p of r.points||[])if(allowed.has(p.employeeId)&&p.confirmedBy&&onDay(p.at,date)&&people.has(p.employeeId)){people.get(p.employeeId).points+=Number(p.amount||0);evidence.push(source('核定积分',r.id,'/receptions'));}
    if(allowed.has(r.ownerId)&&r.wechat?.claimed&&!r.wechat.confirmed&&people.has(r.ownerId))people.get(r.ownerId).pendingPoints++;
    if(allowed.has(r.ownerId)&&r.status==='待结案确认'&&people.has(r.ownerId))people.get(r.ownerId).pendingPoints++;
    if(allowed.has(r.ownerId)&&r.status==='待回访'&&r.followUpAt&&!Number.isNaN(Date.parse(r.followUpAt))&&Date.parse(r.followUpAt)<Date.now())alerts.push({kind:'回访已到期',id:r.id,employee:people.get(r.ownerId)?.name||r.ownerName,href:'/receptions'});
  }
  for(const s of store.conversionClaims||[])if(s.status==='待老板判断'&&allowed.has(s.proposerId)&&people.has(s.proposerId))people.get(s.proposerId).pendingPoints++;
  for(const s of store.sales||[])count(s.operatorId||s.salespersonId,'sales',s,'/app?tab=orders');
  for(const s of store.carrierServices||[])count(s.employeeId||s.operatorId,'carrier',s,'/carrier');
  for(const s of store.learningRecords||[]) {
    count(s.employeeId,'learning',s,'/learning');
    if(!allowed.has(s.employeeId)||!people.has(s.employeeId))continue;
    if(s.status==='已通过'&&s.reviewedBy&&onDay(s.reviewedAt,date))people.get(s.employeeId).points+=Number(s.points||0);
    if(s.status==='待审核')people.get(s.employeeId).pendingPoints++;
  }
  for(const s of store.workJournals||[]) {
    count(s.employeeId,'journals',s,'/work-journal',s.occurredAt||s.createdAt);
    if(!allowed.has(s.employeeId)||!people.has(s.employeeId))continue;
    if(s.status==='已核定'&&s.reviewedBy&&onDay(s.reviewedAt,date))people.get(s.employeeId).points+=Number(s.points||0);
    if(s.status==='待核定')people.get(s.employeeId).pendingPoints++;
  }
  for(const r of store.procurementPlans||[])if(r.status==='open'&&(privileged(user)||r.receiverId===user.id)) {
    const remaining=(r.items||[]).reduce((n,x)=>n+Math.max(0,Number(x.quantity||0)-Number(x.received||0)),0);
    if(remaining>0)alerts.push({kind:'采购未收齐',id:r.id,remaining,employee:r.receiver||'待指定验收人',href:'/app?tab=purchase'});
  }
  for(const r of store.cashHandovers||[])if(['待接收人确认','金额有异议'].includes(r.status)&&(privileged(user)||r.recipientId===user.id||r.operatorId===user.id))alerts.push({kind:r.status==='金额有异议'?'现金金额有异议':'现金交接待确认',id:r.id,href:'/cash-handover'});
  for(const r of store.sales||[])if(['待老板核对','待收款人确认','有异议'].includes(r.paymentReview?.status)&&(privileged(user)||r.operatorId===user.id||r.paymentReview.recipientId===user.id))alerts.push({kind:r.paymentReview.status==='有异议'?'销售收款有异议':'销售收款待确认',id:r.id,href:'/sale-payments'});
  if(user.roleCode==='owner')for(const finding of guardian.inspect(store))alerts.push({kind:'账套巡检线索',id:finding.id,note:finding.summary,href:'/brain'});
  const rows=[...people.values()].filter(p=>allowed.has(p.id)&&(p.events||p.points||p.pendingPoints));
  const registered=rows.reduce((n,r)=>n+r.events,0),points=rows.reduce((n,r)=>n+r.points,0),pendingPoints=rows.reduce((n,r)=>n+r.pendingPoints,0);
  return {date,rows,registered,points,pendingPoints,alerts,evidence:evidence.slice(0,60),asOf:c.now(),note:'仅按登记记录统计；没有记录不能认定员工没工作，积分不等于已支付报酬。'};
}
function query(store,user,question,{date=c.day(),detail=false}={}) {
  if(/(?:开|建|记录|登记|写).{0,8}(?:小事|工作日志|工作工单)|(?:小事工单|工作日志).{0,6}(?:在哪|入口|怎么开)/.test(question))return {answer:'打开工作日志，选择做过的事情并写清结果；提交后由老板核定积分。',sources:[source('工作日志','新建','/work-journal')],action:{type:'navigate',label:'记录工作日志',href:'/work-journal'}};
  if(/(?:开|建|我要|填写|记录).{0,5}学习单/.test(question))return {answer:'请在学习单里记录参与的事件、学到的内容和心得；老板核定后记积分。',sources:[source('学习单','新建','/learning')],action:{type:'navigate',label:'打开学习单',href:'/learning'}};
  const relevant=/(员工|营业员|店员).{0,12}(工作|干了|做了|忙|积分|奖励)|工作动态|店内动态|工作记录|工作积分|多少积分|获得.*积分|监督|巡检|哪些异常|异常.*核实|积分.*核定|待核定/.test(question);
  if(!relevant)return null;
  const named=(store.users||[]).filter(x=>x.name&&question.includes(x.name)).sort((a,b)=>b.name.length-a.name.length)[0];
  if(named&&named.id!==user.id&&!privileged(user))return {answer:'当前岗位没有查看其他员工工作与积分的权限。',sources:[]};
  const view=snapshot(store,user,{date,employeeId:named?.id}),day=labelDay(date);
  let text;
  if(/积分/.test(question))text=`${day}${named?named.name:privileged(user)?'员工':'你'}已核定 ${view.points} 积分`+(view.pendingPoints?`；还有 ${view.pendingPoints} 份记录待核定`:'')+'。积分不等于报酬已发放。';
  else text=`${day}已登记 ${view.registered} 项员工参与记录`+(view.registered?`，涉及 ${view.rows.filter(r=>r.events).length} 人`:'')+(view.alerts.length?`；目前 ${view.alerts.length} 项跟进或核对线索`:'')+'。';
  if(detail&&view.rows.length)text+=' '+view.rows.map(p=>p.name+'：'+[['receptions','接待'],['sales','开销售单'],['carrier','移动业务'],['assists','参与协助'],['learning','学习'],['journals','小事日志']].filter(([key])=>p[key]).map(([key,label])=>label+' '+p[key]).join('、')+(p.points?'，核定积分 '+p.points:'')).join('；')+'。';
  if(detail&&view.alerts.length)text+=' 待跟进：'+view.alerts.slice(0,6).map(a=>a.kind+(a.employee?'（'+a.employee+'）':'')).join('、')+'。';
  const sources=[source('员工工作日志','记录','/work-journal'),source('接待与跟单','记录','/receptions'),...view.evidence.slice(0,8),...view.alerts.slice(0,8).map(a=>source(a.kind,a.id,a.href))];
  const table={columns:[{key:'name',label:'员工'},{key:'receptions',label:'接待'},{key:'sales',label:'销售单'},{key:'carrier',label:'移动业务'},{key:'assists',label:'协助'},{key:'learning',label:'学习单'},{key:'journals',label:'小事记录'},{key:'points',label:'核定积分'},{key:'pendingPoints',label:'待核定记录'}],rows:view.rows};
  return {answer:text,sources,metrics:{date,registered:view.registered,points:view.points,pendingPoints:view.pendingPoints,alertCount:view.alerts.length},table,note:view.note,alerts:view.alerts.slice(0,30)};
}
module.exports={snapshot,query};
