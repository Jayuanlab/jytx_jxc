const c = require('./common');
function allNotices(store) { return [...(store.feishuNotices || []), ...(store.localCatalogNotices || [])].filter(row=>!require('./reception-availability').notice(store,row)).sort((a, b) => Date.parse(a.createdAt || a.sentAt || 0) - Date.parse(b.createdAt || b.sentAt || 0)); }
function category(store, row) {
  const kind=String(row.kind||'');
  if (['cash','aggregate','business','approval'].includes(row.category)) return row.category;
  if (/待审批|待审核|待确认|待签认|待复核|待核定|待核对|申请|异议|差异|待老板/.test(kind)) return 'approval';
  const id=String(row.orderId||'');
  const receipts=(store.receipts||[]).filter(r=>r.id===id||r.sourceId===id);
  const accounts=new Set(receipts.map(r=>String(r.account||r.accountName||'')));
  if (accounts.size===1 && [...accounts].every(x=>x==='现金')) return 'cash';
  if (accounts.size && [...accounts].every(x=>/聚合|微信|支付宝|扫码|云闪付|二维码/.test(x))) return 'aggregate';
  if (/现金/.test(kind) && !/交接|退款|退货/.test(kind)) return 'cash';
  return 'business';
}
function suggestedEmployee(store,row){
  const id=String(row.orderId||'');
  const source=['sales','otherIncome','airRechargeEvents','cardBusinesses','carrierServices','businessReconciliations','cashHandovers','purchases','expenses','receptions'].map(k=>(store[k]||[]).find(x=>x.id===id)).find(Boolean);
  const receipt=(store.receipts||[]).find(x=>x.id===row.receiptId||x.sourceId===id);
  const candidate=source?.operatorId||source?.registeredById||source?.cashierId||source?.ownerId||receipt?.operatorId||receipt?.registeredById;
  return (store.users||[]).some(x=>x.id===candidate&&x.status==='active'&&x.roleCode!=='owner')?candidate:'';
}
function list(store, user, query=new URLSearchParams()) {
  c.permit(user, 'manageUsers');
  const numbers=new Map((store.documentNumbers||[]).map(row=>[row.sourceId,row.displayNo]));
  const unique=new Map();for(const n of allNotices(store)){const prior=unique.get(n.key);unique.set(n.key,{...prior,...n,readAt:prior?.readAt||n.readAt||null});}
  const ordered=[...unique.values()].reverse().map(n=>{const workflow=require('./air-workflow-policy').noticeState(store,n);return workflow?{...n,kind:workflow.kind,summary:n.summary+'；'+workflow.label,readAt:n.readAt||n.createdAt,workflow}:n;});
  const unreadRows=ordered.filter(row=>!row.readAt),recentRead=ordered.filter(row=>row.readAt).slice(0,Math.max(0,500-unreadRows.length));
  const rows=[...unreadRows,...recentRead].sort((a,b)=>Date.parse(b.createdAt||b.sentAt||0)-Date.parse(a.createdAt||a.sentAt||0));
  return { unread: rows.filter((row) => !row.readAt).length,
    rows: (query.get('compact')==='1'?rows.filter(row=>!row.readAt).slice(0,20):rows).map((row) => {
      const { key, kind, orderId, summary, amount, createdAt, sentAt, readAt } = row;
      const inquiry=(store.bossWorkOrders||[]).filter(x=>x.noticeKey===key).at(-1);
      return { key, kind, orderId, receiptId:row.receiptId||'', category:category(store,row), operationNo:orderId?(numbers.get(orderId)||(store.dailyCloseouts||[]).find(item=>item.id===orderId)?.displayNo||orderId):'', summary, amount, href: row.workflow?.href||require('./notice-targets').target(store, row), createdAt: createdAt || sentAt || null, readAt: readAt || null, suggestedEmployeeId:suggestedEmployee(store,row),inquiry:inquiry?{id:inquiry.id,status:inquiry.status,employeeName:inquiry.employeeName}:null };
    }),staff:(store.users||[]).filter(x=>x.status==='active'&&x.roleCode!=='owner'&&!x.assistantCustomerOnly).map(x=>({id:x.id,name:x.name})) };
}
function read(store, user, payload) {
  c.permit(user, 'manageUsers');
  const all = payload.all === true;
  const key = String(payload.key || '');
  const keys=payload.keys;
  if (keys!==undefined && (!Array.isArray(keys)||!keys.length||keys.length>100||keys.some(x=>typeof x!=='string'||!x||x.length>300)||new Set(keys).size!==keys.length)) throw new c.HttpError(400,'请选择1至100条不重复消息');
  if (!all && !key && !keys) throw new c.HttpError(400, '请选择消息');
  if (all && (key||keys) || key && keys) throw new c.HttpError(400,'请选择一种已阅方式');
  const selected=keys?new Set(keys):null;
  if(selected){const found=new Set(allNotices(store).map(row=>row.key));if([...selected].some(k=>!found.has(k)))throw new c.HttpError(409,'消息已变化，请刷新后重试');}
  let updated = 0;
  for (const row of allNotices(store)) {
    if ((all || row.key === key || selected?.has(row.key)) && !row.readAt) { row.readAt = c.now(); updated++; }
  }
  if (!all && !selected && !allNotices(store).some((row) => row.key === key))
    throw new c.HttpError(404, '消息不存在');
  c.audit(store, user, 'notice:read', all ? '全部已阅 '+updated+' 条' : selected ? {keys:[...selected],updated,onlyReadState:true} : key);
  return { updated };
}
function inquire(store,user,payload){
  c.permit(user,'manageUsers');
  const key=String(payload.key||'');
  const notice=allNotices(store).find(row=>row.key===key);
  if(!notice)throw new c.HttpError(404,'原消息不存在，请刷新');
  const reason=String(payload.reason||'').trim();
  if(reason.length<3||reason.length>500)throw new c.HttpError(400,'请写明3至500字的具体疑点');
  const employee=(store.users||[]).find(row=>row.id===payload.employeeId&&row.status==='active'&&row.roleCode!=='owner'&&!row.assistantCustomerOnly);
  if(!employee)throw new c.HttpError(400,'请选择负责核查的营业员');
  const current=(store.bossWorkOrders||[]).find(row=>row.noticeKey===key&&['待处理','需补充','待老板验收'].includes(row.status));
  if(current)throw new c.HttpError(409,'这笔已交给'+current.employeeName+'待查：'+current.id);
  const numbers=new Map((store.documentNumbers||[]).map(row=>[row.sourceId,row.displayNo]));
  const sourceNo=numbers.get(notice.orderId)||notice.orderId||'原单待定位';
  const href=require('./notice-targets').target(store,notice);
  if(href==='/notices')throw new c.HttpError(409,'这条消息的原单尚未定位，请先在单据查询找到原单再安排核查');
  const result=require('./boss-work').create(store,user,{employeeId:employee.id,title:'核查'+String(notice.kind||'业务消息').slice(0,30)+' · '+sourceNo,content:'原单：'+sourceNo+'；收款流水：'+(notice.receiptId||'无')+'；老板疑点：'+reason});
  const task=(store.bossWorkOrders||[]).find(row=>row.id===result.id);
  Object.assign(task,{noticeKey:key,sourceId:notice.orderId||'',sourceNo,sourceHref:href,receiptId:notice.receiptId||'',inquiryReason:reason});
  const at=c.now();for(const row of allNotices(store))if(row.key===key)row.readAt||=at;
  c.audit(store,user,'notice:inquire',{noticeKey:key,sourceNo,employeeId:employee.id,taskId:task.id});
  return {id:task.id,status:task.status,employeeName:task.employeeName,message:'已交给'+task.employeeName+'待查；原单和资金未改动'};
}
module.exports = { list, read, inquire };

