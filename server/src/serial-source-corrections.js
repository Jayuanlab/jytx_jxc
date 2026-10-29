'use strict';
const {createHash}=require('node:crypto');
const c=require('./common'),suppliers=require('./suppliers'),sources=require('./serial-sources');
const TYPE='serial_source_correction';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp=user=>suppliers.stamp(user);
function owner(store,user){try{return require('./sale-return-requests').assertOwner(store,user);}catch(error){if(error.statusCode===403)throw new c.HttpError(403,'只有老板本人可以补录或更正单台供货来源');throw error;}}
function locate(store,payload){
 const no=c.text(payload.serialNo,'完整串号');
 if(!/^[a-z0-9-]{5,40}$/i.test(no))throw new c.HttpError(400,'请填写实物完整串号，后4位不能用于更正');
 const hits=(store.inventory||[]).flatMap(stock=>(stock.serials||[]).filter(serial=>serial.no===no).map(serial=>({stock,serial})));
 if(!hits.length)throw new c.HttpError(404,'没有找到该完整串号，请先核对实物');
 if(hits.length!==1)throw new c.HttpError(409,'该串号存在多条库存记录，须先核实重复数据');
 const {stock,serial}=hits[0],product=(store.products||[]).find(p=>p.skuId===stock.skuId);
 if(!product||!require('./inventory-details').tracked(product))throw new c.HttpError(409,'该串号商品资料不完整');
 if(payload.skuId&&payload.skuId!==stock.skuId||payload.warehouseId&&payload.warehouseId!==stock.warehouseId)throw new c.HttpError(409,'这台手机的商品或仓库已变化，请重新查询');
 return {no,stock,serial,product};
}
function publicHistory(store,no){return sources.history(store,no).map(r=>({id:r.id,serialNo:r.serialNo,before:{...r.before,supplier:sources.supplierName(store,r.before.supplierId,r.before.supplier)},after:{...r.after,supplier:sources.supplierName(store,r.after.supplierId,r.after.supplier)},reason:r.reason,operator:r.operator,createdAt:r.createdAt,accounting:r.accounting?{costAmount:r.accounting.costAmount,paidAmount:r.accounting.paidAmount,payableAmount:r.accounting.payableAmount,noNewCash:true}:null}));}
function get(store,user,payload){
 owner(store,user);const hit=locate(store,payload),before=sources.resolve(store,hit.product,hit.serial),mode=before.sourceType;
 return {serialNo:hit.no,skuId:hit.product.skuId,name:hit.product.name,warehouseId:hit.stock.warehouseId,warehouseName:hit.stock.warehouseName||'',mode,before,source:before,purchaseId:before.purchaseId,sourceType:before.sourceType,costAmount:Number(hit.serial.costPrice||0),history:publicHistory(store,hit.no),canCorrect:!before.sourceConflict,
 supplierOptions:(store.suppliers||[]).filter(s=>s.active!==false&&s.status!=='inactive').map(s=>({id:s.id,name:s.name})),message:before.sourceConflict?'原采购来源有冲突，须先核实记录':'按完整串号补录或更正；只改变这台手机的来源资料。'};
}
function cents(value,label){const n=c.money(value,label);const result=Math.round(n*100);if(!Number.isSafeInteger(result))throw new c.HttpError(400,label+'超出可处理范围');return result;}
function remaining(store,entry){
 if(!entry||!Number.isSafeInteger(entry.cents)||entry.cents<0)throw new c.HttpError(409,'原往来金额异常，须先核对');
 const active=(store.supplierSettlements||[]).filter(s=>!s.reversedAt&&(s.sourceId===entry.id||s.targetId===entry.id));
 if(active.some(s=>s.supplierId!==entry.supplierId||!Number.isSafeInteger(s.cents)||s.cents<=0))throw new c.HttpError(409,'原往来核销异常，须先核对');
 const n=entry.cents-active.reduce((a,s)=>a+s.cents,0);if(n<0)throw new c.HttpError(409,'原往来已超额核销，须先核对');return n;
}
function cashForEntry(store,entry){
 if(entry.sourceType==='payment'){
  const cash=(store.supplierCash||[]).find(r=>r.id===entry.sourceId&&r.sourceId===entry.id&&r.type==='payment');
  if(!cash||cash.supplierId!==entry.supplierId||cents(cash.amount,'付款金额')!==entry.cents)throw new c.HttpError(409,'原付款与往来来源不一致，须先核对');
  const receipts=(store.receipts||[]).filter(r=>r.sourceId===cash.id&&r.kind==='supplier_payment');
  if(!receipts.length||receipts.some(r=>Number(r.amount)>=0||r.supplierId!==cash.supplierId)||receipts.reduce((n,r)=>n+cents(Math.abs(r.amount),'资金金额'),0)!==entry.cents)throw new c.HttpError(409,'原付款缺少完整实际资金流水，须先核对');
  if(cash.paymentParts){if(receipts.length!==cash.paymentParts.length||cash.paymentParts.some(p=>{const matches=receipts.filter(r=>r.partId===p.id);if(matches.length!==1||cents(Math.abs(matches[0].amount),'付款分笔')!==cents(p.amount,'原付款分笔'))return true;const ownership=require('./account-ownership'),left=ownership.project(store,matches[0]),right=ownership.project(store,p);return ['account','paymentAccountId','accountScope','accountOwnerId'].some(k=>(left[k]||'')!==(right[k]||''));}))throw new c.HttpError(409,'原付款账户分笔与资金流水不一致，须先核对');}
  return {cashId:cash.id,reference:cash.reference||cash.paymentParts?.map(p=>p.reference).filter(Boolean).join('、')||'',paidAt:cash.date||cash.createdAt};
 }
 if(entry.sourceType===TYPE&&entry.correctionRole==='paid-allocation'&&entry.originalCashId){
  const cash=(store.supplierCash||[]).find(r=>r.id===entry.originalCashId&&r.type==='payment');
  const proof=(store.serialSourceCorrections||[]).find(r=>r.id===entry.sourceId&&r.accounting?.parts?.some(p=>p.advanceEntryId===entry.id&&p.cashId===cash?.id&&p.cents===entry.cents));
  if(!cash||!proof)throw new c.HttpError(409,'前次付款归属更正记录不完整，须先核对');
  return {cashId:cash.id,reference:cash.reference||'',paidAt:cash.date||cash.createdAt};
 }
 throw new c.HttpError(409,'该采购含返利、仅抵货款或无法追溯的历史付款，请先核对款项归属');
}
function formal(store,hit,before){
 const order=(store.purchases||[]).find(p=>p.id===before.purchaseId),line=order?.items?.find(i=>i.id===before.purchaseItemId);
 if(!order||!line)throw new c.HttpError(409,'原采购单或明细不存在，不能更改货款归属');
 if(order.redOf||order.redReversedBy||['已红冲','已退货','returned','reversed'].includes(order.status))throw new c.HttpError(409,'原采购已退货或红冲，请先核实原单');
 if((store.purchaseReturns||[]).some(r=>r.purchaseId===order.id)||(store.supplierAdjustments||[]).some(r=>r.purchaseId===order.id))throw new c.HttpError(409,'原采购已有退货、调价或价保权益，须先逐项核对分摊后更正来源');
 if((store.purchaseReturnRequests||[]).some(r=>r.purchaseId===order.id&&r.status==='待老板审核')||(store.redReversals||[]).some(r=>(r.sourceId||r.expenseId)===order.id&&['待老板审核','待审核'].includes(r.status)))throw new c.HttpError(409,'原采购有待审核退货或红冲，请先处理申请');
 const prior=sources.history(store,hit.no).filter(r=>r.accounting?.payableEntryId).at(-1),dueId=prior?.accounting.payableEntryId||order.supplierEntryId;
 const due=(store.supplierEntries||[]).find(e=>e.id===dueId&&e.supplierId===before.supplierId&&e.kind==='payable');
 if(!due)throw new c.HttpError(409,'原采购应付归属不完整，须先核对往来账');
 const cost=cents(line.costPrice,'该台原采购货款');
 const paid=(store.supplierSettlements||[]).filter(s=>!s.reversedAt&&s.targetId===due.id).filter(s=>{
  const e=(store.supplierEntries||[]).find(e=>e.id===s.sourceId);
  return !(s.type===TYPE&&e?.correctionRole==='source-release');
 }).map(s=>{const e=(store.supplierEntries||[]).find(e=>e.id===s.sourceId);if(!e||e.kind!=='advance'||e.supplierId!==before.supplierId)throw new c.HttpError(409,'原采购含非现金抵扣，须先核对款项归属');remaining(store,e);return {...s,...cashForEntry(store,e),entry:e};});
 const unpaid=remaining(store,due),paidTotal=paid.reduce((n,s)=>n+s.cents,0);
 if(cost>unpaid+paidTotal)throw new c.HttpError(409,'该台货款超过原采购尚可重归属金额，须先核对');
 return {order,line,due,cost,paid,unpaid,paidTotal,minPaid:Math.max(0,cost-unpaid),maxPaid:Math.min(cost,paidTotal)};
}
// Largest-remainder allocation keeps every cent and never exceeds a source.
function distribute(total,weights){
 const sum=weights.reduce((n,w)=>n+w,0);if(!total)return weights.map(()=>0);if(!Number.isSafeInteger(sum)||!Number.isSafeInteger(total)||!sum||total>sum||weights.some(w=>!Number.isSafeInteger(w)||w<0))throw new c.HttpError(409,'付款分配金额超出可用核销');
 const parts=weights.map((w,i)=>{const scaled=BigInt(total)*BigInt(w);return {i,n:Number(scaled/BigInt(sum)),fraction:scaled%BigInt(sum)};});let left=total-parts.reduce((n,p)=>n+p.n,0);
 for(const part of [...parts].sort((a,b)=>a.fraction===b.fraction?a.i-b.i:a.fraction>b.fraction?-1:1)){if(!left)break;part.n++;left--;}
 return parts.sort((a,b)=>a.i-b.i).map(p=>p.n);
}
function preview(store,user,payload){
 const actor=owner(store,user),hit=locate(store,payload),before=sources.resolve(store,hit.product,hit.serial),history=publicHistory(store,hit.no);
 if(before.sourceConflict)throw new c.HttpError(409,'原采购来源有冲突，须先核实记录');
 const reason=c.text(payload.reason,'补录/更正依据');if(reason.length<4||reason.length>500)throw new c.HttpError(400,'请填写4至500字的补录/更正依据');
 const after={supplierId:before.supplierId||'',supplier:before.supplier||'',purchaseDate:before.purchaseDate||''};
 if(Object.prototype.hasOwnProperty.call(payload,'supplierId')){const id=String(payload.supplierId||'').trim();if(!id)throw new c.HttpError(400,'请选择已有供货商');const supplier=(store.suppliers||[]).find(s=>s.id===id&&s.active!==false&&s.status!=='inactive');if(!supplier)throw new c.HttpError(400,'供货商不存在或已停用');after.supplierId=supplier.id;after.supplier=supplier.name;}
 if(Object.prototype.hasOwnProperty.call(payload,'purchaseDate')){const date=String(payload.purchaseDate||'').trim();if(date){suppliers.validDate(date);if(date>c.day())throw new c.HttpError(400,'实际进货日期不能在未来');}after.purchaseDate=date;}
 const sameDate=(a,b)=>String(a||'').slice(0,10)===String(b||'').slice(0,10);
 if(after.supplierId===before.supplierId&&sameDate(after.purchaseDate,before.purchaseDate))throw new c.HttpError(400,'供货商和日期均没有变化');
 if((store.dailyCloseouts||[]).some(d=>d.date===c.day()&&d.status==='已锁定'))throw new c.HttpError(409,'今日已经日结锁定，请先完成日结更正流程');
 const result={serialNo:hit.no,skuId:hit.product.skuId,name:hit.product.name,warehouseId:hit.stock.warehouseId,warehouseName:hit.stock.warehouseName||'',mode:before.sourceType,before,after,purchaseId:before.purchaseId||'',reason,costAmount:Number(hit.serial.costPrice||0),requiresPaidAllocation:false,paymentAllocation:null,history,noNewCash:true};
 if(before.sourceType==='purchase'&&before.supplierId!==after.supplierId){
  const f=formal(store,hit,before),explicit=Object.prototype.hasOwnProperty.call(payload,'paidAllocationAmount')&&payload.paidAllocationAmount!==''&&payload.paidAllocationAmount!=null;
  let paid=f.minPaid===f.maxPaid?f.minPaid:explicit?cents(payload.paidAllocationAmount,'该台已付款归属金额'):null;
  result.requiresPaidAllocation=paid===null;
  if(paid!==null&&(paid<f.minPaid||paid>f.maxPaid))throw new c.HttpError(400,`该台已付款归属金额须在 ${f.minPaid/100} 至 ${f.maxPaid/100} 元之间`);
  const shares=paid===null?[]:distribute(paid,f.paid.map(s=>s.cents));
  result.costAmount=f.cost/100;result.paymentAllocation={paidAmount:paid===null?null:paid/100,payableAmount:paid===null?null:(f.cost-paid)/100,availablePaidAmount:f.paidTotal/100,minPaidAmount:f.minPaid/100,maxPaidAmount:f.maxPaid/100,method:'按原付款核销金额比例分摊',parts:f.paid.map((s,i)=>({settlementId:s.id,cashId:s.cashId,reference:s.reference,paidAt:s.paidAt,availableAmount:s.cents/100,amount:paid===null?null:shares[i]/100})).filter(p=>p.amount===null||p.amount>0)};
  result.message=paid===null?'原单为部分付款。请依据实际情况明确该台已付金额，再预览逐笔归属分配。':`该台货款 ${f.cost/100} 元转到 ${after.supplier}，其中已付 ${paid/100} 元、未付 ${(f.cost-paid)/100} 元；不产生新的实际收付款。`;
 }else result.message=before.sourceType==='purchase'?'仅更正实际进货日期，原采购货款归属不变。':'仅补录/更正该台来源资料，不生成采购、应付或实际付款。';
 if(!result.requiresPaidAllocation)result.previewToken=hash({actorId:actor.id,result,state:{serial:hit.serial,stock:{skuId:hit.stock.skuId,warehouseId:hit.stock.warehouseId},suppliers:store.suppliers,purchases:store.purchases,entries:store.supplierEntries,settlements:store.supplierSettlements,cash:store.supplierCash,receipts:store.receipts,corrections:store.serialSourceCorrections||[],returns:store.purchaseReturns,adjustments:store.supplierAdjustments,pending:store.purchaseReturnRequests,red:store.redReversals,closeouts:store.dailyCloseouts}});
 return result;
}
function settlement(store,user,source,target,n,correctionId,note){if(!n)return null;const s={id:c.id('SS'),supplierId:source.supplierId,sourceId:source.id,targetId:target.id,cents:n,type:TYPE,automatic:true,sourceCorrectionId:correctionId,note,...stamp(user)};if(source.supplierId!==target.supplierId||n>remaining(store,source)||n>remaining(store,target))throw new c.HttpError(409,'账面转属核销超额，请刷新重试');store.supplierSettlements.push(s);return s;}
function confirm(store,user,payload){
 const actor=owner(store,user),p=preview(store,actor,payload);
 if(payload.confirmed!==true)throw new c.HttpError(400,'请核对预览后确认更正');
 if(!p.previewToken||payload.previewToken!==p.previewToken)throw new c.HttpError(409,'来源、库存或往来余额已变化，请重新预览');
 const hit=locate(store,payload),row={id:c.id('SSC'),serialNo:p.serialNo,skuId:p.skuId,warehouseId:p.warehouseId,mode:p.mode,purchaseId:p.purchaseId,before:p.before,after:p.after,reason:p.reason,...stamp(actor)};
 if(p.paymentAllocation){
  const f=formal(store,hit,p.before),n=f.cost,paid=cents(p.paymentAllocation.paidAmount,'已付金额'),parts=[];
  const make=(supplierId,kind,value,role,title,extra={})=>suppliers.entry(store,{supplierId,kind,cents:value,sourceType:TYPE,sourceId:row.id,purchaseId:f.order.id,serialNo:row.serialNo,correctionRole:role,title,note:row.reason,...extra,...stamp(actor)});
  // Reverse only the old accounting allocations. The actual cash and receipts
  // remain immutable; replacement offsets and clearing entries keep both books balanced.
  for(const part of p.paymentAllocation.parts){
   const old=f.paid.find(s=>s.id===part.settlementId),slice=cents(part.amount,'付款分配');if(!old||slice>old.cents)throw new c.HttpError(409,'原付款核销已变化');
   const stored=store.supplierSettlements.find(s=>s.id===old.id);Object.assign(stored,{reversedAt:c.now(),reversedBy:actor.id,reverseReason:'单台供货来源更正 '+row.id,sourceCorrectionId:row.id});
   if(old.cents>slice)settlement(store,actor,old.entry,f.due,old.cents-slice,row.id,'保留原采购其余货款分配');
   const clearing=make(p.before.supplierId,'payable',slice,'payment-clearing','已付账面归属转出');settlement(store,actor,old.entry,clearing,slice,row.id,'原付款份额转出原供货商账面');
   const advance=make(p.after.supplierId,'advance',slice,'paid-allocation','原实际付款份额转入',{originalCashId:old.cashId,originalSettlementId:old.id});
   parts.push({cashId:old.cashId,cents:slice,amount:slice/100,originalSettlementId:old.id,advanceEntryId:advance.id,reference:old.reference});
  }
  const release=make(p.before.supplierId,'cash',n,'source-release','误录采购货款归属转出');settlement(store,actor,release,f.due,n,row.id,'单台货款从原供货商账面转出');
  const due=make(p.after.supplierId,'payable',n,'purchase-payable','单台采购货款归属转入');
  for(const part of parts){const advance=store.supplierEntries.find(e=>e.id===part.advanceEntryId);part.settlementId=settlement(store,actor,advance,due,part.cents,row.id,'原实际付款份额核销正确供货商').id;}
  row.accounting={costAmount:n/100,paidAmount:paid/100,payableAmount:(n-paid)/100,payableEntryId:due.id,previousPayableEntryId:f.due.id,releaseEntryId:release.id,parts,noNewCash:true};
 }
 (store.serialSourceCorrections||=[]).push(row);c.audit(store,actor,'stock:source-correction',`${row.id} · ${row.serialNo} · ${p.before.supplier||'待补'} → ${p.after.supplier||'待补'} · ${row.reason}`);
 return {...row,source:sources.resolve(store,hit.product,hit.serial),history:publicHistory(store,hit.no),message:p.message};
}
function cashShares(store,cash){
 const groups=new Map([[cash.supplierId,cents(cash.amount,'付款金额')]]);
 if(cash.type==='payment')for(const correction of store.serialSourceCorrections||[])for(const part of correction.accounting?.parts||[])if(part.cashId===cash.id){groups.set(correction.before.supplierId,(groups.get(correction.before.supplierId)||0)-part.cents);groups.set(correction.after.supplierId,(groups.get(correction.after.supplierId)||0)+part.cents);}
 if([...groups.values()].some(n=>n<0)||[...groups.values()].reduce((a,n)=>a+n,0)!==cents(cash.amount,'付款金额'))throw new c.HttpError(409,'付款归属分配不平衡，须先核对');
 return [...groups].filter(([,n])=>n>0).map(([supplierId,n])=>({...cash,supplierId,amount:n/100,originalCashId:cash.id,originalSupplierId:cash.supplierId,attributionCorrected:supplierId!==cash.supplierId||groups.size>1}));
}
function cashRows(store){return (store.supplierCash||[]).flatMap(cash=>cashShares(store,cash));}
function receiptRows(store){
 return (store.receipts||[]).map(r=>require('./mobile-coin-claims').projectReceipt(store,r)).map(r=>require('./source-annotations').projectReceipt(store,r)).flatMap(r=>{
  if(r.kind!=='supplier_payment')return [r];const cash=(store.supplierCash||[]).find(x=>x.id===r.sourceId&&x.type==='payment');if(!cash)return [r];const shares=cashShares(store,cash);if(shares.length===1&&shares[0].supplierId===r.supplierId)return [r];
  const all=(store.receipts||[]).filter(x=>x.sourceId===cash.id&&x.kind==='supplier_payment');const rowIndex=all.findIndex(x=>x===r),weights=shares.map(s=>cents(s.amount,'归属金额'));let residual=weights.slice();
  for(let i=0;i<all.length;i++){const allocations=distribute(cents(Math.abs(all[i].amount),'实际付款'),residual);if(i===rowIndex)return shares.map((s,j)=>({...r,supplierId:s.supplierId,projectionKey:r.id+'|'+s.supplierId,amount:(r.amount<0?-1:1)*allocations[j]/100,originalReceiptId:r.id,originalSupplierId:r.supplierId,attributionCorrected:true})).filter(x=>x.amount!==0);residual=residual.map((n,j)=>n-allocations[j]);}
  return [r];
 });
}
function payableEntries(store,purchaseId){return (store.supplierEntries||[]).filter(e=>e.kind==='payable'&&e.sourceType===TYPE&&e.purchaseId===purchaseId&&e.correctionRole==='purchase-payable');}
function purchaseUnit(store,order,item,no){
 const source=sources.forSale(store,{skuId:item.skuId,serialNo:no,purchaseId:order.id,purchaseItemId:item.id}),costAmount=Number(item.recordedCostPrice??item.costPrice),last=sources.history(store,no).filter(r=>r.accounting?.payableEntryId).at(-1);
 const result={...source,serialNo:no,costAmount};
 const due=(store.supplierEntries||[]).find(e=>e.id===(last?.accounting.payableEntryId||order.supplierEntryId));
 if(due){const left=remaining(store,due)/100;if(last||left===0){result.payableAmount=left;result.paidAmount=c.round(Math.max(0,costAmount-left));}else{const paid=(store.supplierSettlements||[]).filter(s=>!s.reversedAt&&s.targetId===due.id).some(s=>(store.supplierEntries||[]).find(e=>e.id===s.sourceId)?.correctionRole!=='source-release');if(!paid){result.paidAmount=0;result.payableAmount=costAmount;}}}
 return result;
}
function purchaseAllocations(store,order){
 const groups=new Map(),add=(id,name,n)=>{const g=groups.get(id)||{supplierId:id,supplier:sources.supplierName(store,id,name),amount:0,outstanding:0,serialNos:[]};g.amount=c.round(g.amount+n);groups.set(id,g);return g;};
 for(const item of order.items||[])if((item.serials||[]).length){for(const no of item.serials){const source=sources.forSale(store,{skuId:item.skuId,serialNo:no,purchaseId:order.id,purchaseItemId:item.id});const group=add(source?.supplierId||order.supplierId,source?.supplier||order.supplier,Number(item.costPrice));group.serialNos.push(no);}}else add(order.supplierId,order.supplier,Number(item.quantity)*Number(item.costPrice));
 const entries=(store.supplierEntries||[]).filter(e=>e.id===order.supplierEntryId||e.sourceType===TYPE&&e.purchaseId===order.id&&e.correctionRole==='purchase-payable');for(const e of entries){const group=groups.get(e.supplierId)||add(e.supplierId,'',0);group.outstanding=c.round(group.outstanding+remaining(store,e)/100);}
 return [...groups.values()].map(g=>({...g,settledAmount:c.round(Math.max(0,g.amount-g.outstanding))}));
}
module.exports={get,preview,confirm,publicHistory,cashRows,cashShares,receiptRows,payableEntries,purchaseAllocations,purchaseUnit,TYPE,distribute};
