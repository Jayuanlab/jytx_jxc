const c=require('./common'),erp=require('./erp');
const reversalKinds=new Set(['expense_red','other_income_red']);
const names={sale:'销售收款',refund:'销售退款',supplier_payment:'供应商付款',supplier_refund:'供应商退款',purchase:'采购付款',expense:'费用付款',other_income:'其他收入',carrier:'移动佣金到账',carrier_clawback:'移动佣金扣回',carrier_rental:'移动租金',payroll:'工资发放'};
function list(store,user,query){
 c.permit(user,'finance');const direction=query.get('direction')||'receive',q=(query.get('q')||'').trim().toLowerCase(),from=query.get('from')||'',to=query.get('to')||'';
 if(!['receive','pay'].includes(direction))throw new c.HttpError(400,'单据方向不正确');
 for(const date of [from,to])if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new c.HttpError(400,'日期格式不正确');
 if(from&&to&&from>to)throw new c.HttpError(400,'开始日期不能晚于结束日期');
 const rows=store.receipts.filter(row=>!row.isReversal&&!reversalKinds.has(row.kind)&&(direction==='receive'?row.amount>0:row.amount<0)).map(row=>{
  const source=store.expenses.find(x=>x.id===row.sourceId)||(store.otherIncome||[]).find(x=>x.id===row.sourceId)||(store.supplierCash||[]).find(x=>x.id===row.sourceId)||store.sales.find(x=>x.id===row.sourceId)||store.saleReturns.find(x=>x.id===row.sourceId)||{};
  const reversed=source.redReversedBy||store.receipts.some(x=>x.originalReceiptId===row.id&&(x.isReversal||reversalKinds.has(x.kind)));
  const supplier=store.suppliers.find(x=>x.id===(row.supplierId||source.supplierId));
  const counterparty=row.counterparty||source.counterparty||supplier?.name||source.customerName||names[row.kind]||row.kind;
  return {...row,amount:Math.abs(row.amount),business:names[row.kind]||row.kind,counterparty,note:row.note||source.note||source.reason||'',reference:row.reference||source.reference||'',operator:row.operator||store.users.find(x=>x.id===row.operatorId)?.name||row.operatorId,status:reversed?'已红冲':'已登记',date:row.transactionDate||c.day(row.createdAt)};
 }).filter(row=>(!from||row.date>=from)&&(!to||row.date<=to)&&(!q||(row.id+' '+row.sourceId+' '+row.counterparty+' '+row.reference+' '+row.note+' '+row.account+' '+(row.accountName||'')).toLowerCase().includes(q))).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
 return {direction,rows,total:c.round(rows.filter(r=>r.status!=='已红冲').reduce((n,r)=>n+r.amount,0))};
}
function create(store,user,payload){
 c.permit(user,'finance');if(!['receive','pay'].includes(payload.direction))throw new c.HttpError(400,'单据方向不正确');
 const amount=require('./payment-accounts').cents(payload.amount)/100;if(amount<=0)throw new c.HttpError(400,'金额必须大于零');
 const pa=require('./payment-accounts'),parts=pa.normalize(store,payload,amount);
 const counterparty=c.text(payload.counterparty,'收付款对象').slice(0,100),note=c.text(payload.note,'收付款事由').slice(0,500),reference=String(payload.reference||'').trim().slice(0,100);
 const date=payload.date||c.day();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>c.day()||c.day(date+'T04:00:00.000Z')!==date)throw new c.HttpError(400,'实际收付日期不正确');
 if((store.dailyCloseouts||[]).some(x=>(x.date===date||x.date===c.day())&&x.status==='已锁定'))throw new c.HttpError(409,'营业日已锁定，请先办理日结更正');
 if(payload.confirmed!==true)throw new c.HttpError(400,'请确认款项已实际收付');pa.reference(store,reference);
 let row,receipts;
 if(payload.direction==='pay'){row=erp.expense(store,user,{type:note,amount,payments:parts});receipts=store.receipts.filter(x=>x.sourceId===row.id);}
 else {row={id:c.id('SK'),type:note,amount,paymentParts:parts,createdAt:c.now(),operatorId:user.id,operator:user.name};store.otherIncome||=[];store.otherIncome.push(row);receipts=pa.record(store,user,'other_income',row.id,parts);}
 Object.assign(row,{counterparty,note,reference,date});for(const receipt of receipts)Object.assign(receipt,{counterparty,note,transactionDate:date,...(!receipt.reference&&parts.length===1&&reference?{reference}:{})});
 c.audit(store,user,payload.direction==='pay'?'payment:create':'receipt:create',{sourceId:row.id,amount,partCount:parts.length,counterparty,note});return {id:receipts[0].id,sourceId:row.id,receiptIds:receipts.map(row=>row.id),paymentParts:row.paymentParts,message:(payload.direction==='pay'?'付款单':'收款单')+'已保存'};
}
module.exports={list,create};
