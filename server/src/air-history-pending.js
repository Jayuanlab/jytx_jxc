'use strict';
// Extend the existing old443 workbench and boss overview responses without
// changing their established task definitions or counting unapproved money.
const finalRows=store=>(store.airHistoryDrafts||[]).filter(row=>row.status==='待老板终审');
const managerRows=store=>(store.airHistoryDrafts||[]).filter(row=>row.status==='待店长初审');
const activeManager=store=>(store.users||[]).find(user=>user.id===store.personnelConfig?.managerId&&user.status==='active'&&user.roleCode!=='owner'&&!String(user.id||'').startsWith('demo-')&&!user.assistantCustomerOnly&&!['customer-assistant','personal-assistant'].includes(user.roleCode));
const staleRows=store=>managerRows(store).filter(row=>row.managerId!==activeManager(store)?.id);
function workbench(store,user,result){
  if(user.roleCode==='owner'){
    const count=finalRows(store).length,stale=staleRows(store).length;
    result.reviews={...(result.reviews||{}),airHistoryDrafts:count,airHistoryStaleDrafts:stale};
    result.pendingCount=Number(result.pendingCount||0)+count+stale;
  } else {
    const count=store.personnelConfig?.managerId===user.id?
      managerRows(store).filter(row=>row.managerId===user.id&&row.submittedById!==user.id).length:0;
    result.airHistoryToReview=count;
    result.pendingCount=Number(result.pendingCount||0)+count;
    const terminal=new Set(['已批准入账','店长驳回','老板驳回']);
    const latest=[...(store.airHistoryDrafts||[])].reverse().find(row=>row.submittedById===user.id&&terminal.has(row.status));
    result.airHistoryMyResult=latest?{id:String(latest.id),version:Number(latest.version||0),
      status:String(latest.status),reason:String(latest.rejectReason||'').slice(0,200)}:null;
  }
  return result;
}
function overview(store,user,result){
  if(user.roleCode!=='owner')return result;
  const finals=finalRows(store),stale=staleRows(store),managerPending=managerRows(store).filter(row=>row.managerId===activeManager(store)?.id);
  if(finals.length){
    const items=finals.map(row=>({
      id:String(row.id),label:String(row.id)+' · '+String(row.submittedBy||'经办人')+' · '+Number(row.pendingCount||0)+' 笔BOSS流水',
      sub:(row.managerBypassed?'店长本人提交，直接送老板':'店长 '+String(row.managerApproval?.by||row.managerName||'')+' 已初审')+
        ' · 账面 ¥'+Number(row.bookBalance||0).toFixed(2)+' · BOSS ¥'+Number(row.observedBalance||0).toFixed(2),
      href:'/air-history?draft='+encodeURIComponent(row.id),
      handler:'老板本人',nextStep:'核对这笔历史流水并终审'
    }));
    result.tasks=[{key:'airHistoryDrafts',label:'历史空充补单待老板终审',href:'/air-history?mine=pending',priority:0,
      category:'资金与扎账',amount:null,count:items.length,items},...(result.tasks||[])];
    result.pendingCount=Number(result.pendingCount||0)+items.length;
  }
  if(stale.length){
    const items=stale.map(row=>({id:String(row.id),label:String(row.id)+' · '+String(row.submittedBy||'经办人'),
      sub:'原店长已变更或停用 · 请驳回并由营业员重新提交',href:'/air-history?draft='+encodeURIComponent(row.id),
      handler:'老板本人',nextStep:'驳回旧草稿并要求重新提交'}));
    result.tasks=[{key:'airHistoryStaleDrafts',label:'历史空充补单店长变更待驳回重提',href:'/air-history',
      priority:0,category:'资金与扎账',amount:null,count:items.length,items},...(result.tasks||[])];
    result.pendingCount=Number(result.pendingCount||0)+items.length;
  }  const groups=(result.waitingOnOthers||[]).map(group=>({...group,rows:[...(group.rows||[])]}));
  for(const row of managerPending){
    const id=row.managerId||store.personnelConfig?.managerId;
    const manager=(store.users||[]).find(u=>u.id===id);
    let group=groups.find(item=>item.personId===id);
    if(!group){group={personId:id,person:manager?.name||row.managerName||'店长',count:0,rows:[]};groups.push(group);}
    group.count=Number(group.count||0)+1;
    group.rows.push({kind:'airHistoryDrafts',label:'历史空充补单待店长初审',documentNo:row.id,documentId:row.id,
      status:'待店长初审',href:'/air-history?draft='+encodeURIComponent(row.id)});
  }
  result.waitingOnOthers=groups;
  result.waitingOnOthersCount=Number(result.waitingOnOthersCount||0)+managerPending.length;
  return result;
}
module.exports={workbench,overview};