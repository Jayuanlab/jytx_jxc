'use strict';
const c=require('./common');

function rows(store,ids){
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw new c.HttpError(400,'请选择不重复的原销售单');
 return ids.map(id=>{const order=(store.sales||[]).find(row=>row.id===id);if(!order)throw new c.HttpError(404,'原销售单不存在：'+id);return order;});
}
function pendingEntries(store,order){
 if(order.redReversedBy||(order.items||[]).length===0||(order.items||[]).some(item=>item.stockManaged===false||Number(item.returnedQuantity||0)>0))throw new c.HttpError(409,'原单已有退货、红冲或非实物项目，不能直接归类');
 if((store.saleReturns||[]).some(row=>row.orderId===order.id)||(store.redReversals||[]).some(row=>row.orderId===order.id&&row.status==='已批准'))throw new c.HttpError(409,'原单已有反向记录，不能直接归类');
 if((store.commissionEntries||[]).some(row=>row.orderId===order.id&&row.kind!=='sale'))throw new c.HttpError(409,'原单已有提成调整，不能直接归类');
 const employeeId=order.salespersonId||order.operatorId,month=c.month(order.createdAt);
 if((store.payrollStatements||[]).some(row=>row.employeeId===employeeId&&row.month===month))throw new c.HttpError(409,'本月工资已确认，不能直接改业务归类');
 return order.items.map(item=>{
  const matched=(store.commissionEntries||[]).filter(row=>row.orderId===order.id&&row.itemId===item.id);
  if(matched.length!==1||matched[0].kind!=='sale'||matched[0].amount!=null||matched[0].mode!=='unconfigured')throw new c.HttpError(409,'原单提成已经核定或存在调整，不能直接改业务归类');
  return matched[0];
 });
}
function classify(store,user,ids,note,commissionPercent=null){
 if(user.roleCode!=='owner')throw new c.HttpError(403,'只能由老板更正维修业务归类');
 const reason=String(note||'').trim();if(reason.length<4||reason.length>300)throw new c.HttpError(400,'请写明实际维修依据');
 if(commissionPercent!==null&&(!Number.isFinite(Number(commissionPercent))||Number(commissionPercent)<0||Number(commissionPercent)>100))throw new c.HttpError(400,'维修毛利提成比例须在0到100之间');
 const orders=rows(store,ids),entries=orders.map(order=>{if(order.repairContext)throw new c.HttpError(409,'原单已有维修归类记录');return pendingEntries(store,order);});
 const at=c.now();
 orders.forEach((order,index)=>{
  order.repairContext={kind:'repair',basis:'原销售单实物用于维修',note:reason,classifiedAt:at,classifiedBy:user.id,...(commissionPercent===null?{}:{commissionPercent:Number(commissionPercent)})};
  entries[index].forEach((entry,itemIndex)=>{
   entry.businessKind='repair';entry.repairOriginalProductName=entry.productName||order.items[itemIndex]?.name||'';entry.productName='维修 · '+entry.repairOriginalProductName;entry.reason=commissionPercent===null?'维修提成待老板按维修标准核定':'老板核实原单为维修，按毛利 '+Number(commissionPercent)+'% 核定';
   if(commissionPercent!==null)require('./payroll').resolveEntry(store,user,entry.id,{mode:'profit',value:Number(commissionPercent)});
  });
  c.audit(store,user,'sale:classify-repair',order.id+' 原单保留；维修归类；提成'+(commissionPercent===null?'待核定':'按毛利 '+Number(commissionPercent)+'% 核定'));
 });
 const saleCommission=commissionPercent===null?null:c.round(entries.flat().reduce((sum,entry)=>sum+Number(entry.amount||0),0));
 const sourceIds=new Set(entries.flat().map(entry=>entry.id));
 const giftAdjustment=commissionPercent===null?null:c.round((store.commissionEntries||[]).filter(entry=>entry.kind==='gift'&&sourceIds.has(entry.originalId)).reduce((sum,entry)=>sum+Number(entry.amount||0),0));
 return {orders:orders.map(order=>order.id),amount:c.round(orders.reduce((sum,order)=>sum+Number(order.amount||0),0)),commissionStatus:commissionPercent===null?'待核定':'按毛利 '+Number(commissionPercent)+'% 已核定',commissionAmount:saleCommission,commissionGiftAdjustment:giftAdjustment,commissionNetAmount:commissionPercent===null?null:c.round(saleCommission+giftAdjustment),inventoryChanged:false,receiptsChanged:false};
}
function revert(store,user,ids){
 if(user.roleCode!=='owner')throw new c.HttpError(403,'只能由老板撤回维修业务归类');
 const orders=rows(store,ids),entries=orders.map(order=>{
  if(order.repairContext?.kind!=='repair'||order.repairContext?.basis!=='原销售单实物用于维修')throw new c.HttpError(409,'没有可撤回的维修归类');
  if(order.redReversedBy||(order.items||[]).some(item=>Number(item.returnedQuantity||0)>0)||(store.payrollStatements||[]).some(row=>row.employeeId===(order.salespersonId||order.operatorId)&&row.month===c.month(order.createdAt)))throw new c.HttpError(409,'原单或工资已发生后续变化，不能直接撤回归类');
  return order.items.map(item=>{
   const matched=(store.commissionEntries||[]).filter(row=>row.orderId===order.id&&row.itemId===item.id);
   if(matched.length!==1||matched[0].kind!=='sale'||matched[0].businessKind!=='repair')throw new c.HttpError(409,'提成记录已变化，不能直接撤回归类');
   const entry=matched[0],percent=order.repairContext.commissionPercent;
   if(percent==null){if(entry.mode!=='unconfigured'||entry.amount!=null)throw new c.HttpError(409,'提成已变化，不能直接撤回归类');}
   else if(entry.mode!=='profit'||entry.value!==percent||entry.amount!==c.round(Math.max(0,entry.profit)*percent/100)||entry.resolvedBy!==user.id)throw new c.HttpError(409,'维修提成已变化，不能直接撤回归类');
   return entry;
  });
 });
 const saleIds=new Set(entries.flat().map(entry=>entry.id));
 const linked=(store.commissionEntries||[]).filter(row=>ids.includes(row.orderId)&&row.kind!=='sale');
 if(linked.some(row=>row.kind!=='gift'||!saleIds.has(row.originalId)||row.reason!=='赠品成本抵减毛利提成'||!orders.some(order=>order.id===row.orderId&&(order.giftOrders||[]).some(gift=>gift.id===row.giftId))))throw new c.HttpError(409,'提成已有其他后续调整，不能直接撤回归类');
 const giftIds=new Set(linked.map(row=>row.id));
 store.commissionEntries=store.commissionEntries.filter(row=>!giftIds.has(row.id));
 orders.forEach((order,index)=>{delete order.repairContext;entries[index].forEach(entry=>{delete entry.businessKind;delete entry.reason;if(entry.repairOriginalProductName!==undefined){entry.productName=entry.repairOriginalProductName;delete entry.repairOriginalProductName;}if(entry.mode==='profit'){entry.mode='unconfigured';entry.value=null;entry.amount=null;delete entry.resolvedBy;delete entry.resolvedAt;}});c.audit(store,user,'sale:revert-repair-classification',order.id+' 撤回维修归类及本次提成核定，原单及财务记录不变');});
 return {orders:orders.map(order=>order.id),inventoryChanged:false,receiptsChanged:false};
}
module.exports={classify,revert};
