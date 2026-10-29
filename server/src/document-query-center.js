'use strict';
const c=require('./common'),numbers=require('./document-numbers');
const TYPES={sales:'销售单',procurementPlans:'订货单',purchases:'进货入库单',saleReturnRequests:'退换货申请',saleReturns:'销售退货单',saleExchanges:'换货单',purchaseReturnRequests:'采购退货申请',purchaseReturns:'采购退货单',receiptsIn:'收款单',receiptsOut:'付款流水',expenses:'费用付款单',otherIncome:'其他收款单',dailyCloseouts:'日结账单',closeouts:'当日中途扎账单',cashHandovers:'现金交接／存银行',stockTransfers:'调拨单',stocktakes:'盘点单',receptions:'接待单',airRechargeEvents:'空充BOSS充值单',supplierCash:'往来收付款',giftOrders:'赠品单',redReversals:'红冲单'};
const ROUTES={sales:'/app?tab=orders',procurementPlans:'/app?tab=purchase&section=procurement',purchases:'/app?tab=purchase-query',saleReturnRequests:'/app?tab=returns',saleReturns:'/app?tab=returns',saleExchanges:'/app?tab=returns',purchaseReturnRequests:'/app?tab=purchase&section=purchase-returns',purchaseReturns:'/app?tab=purchase&section=purchase-returns',receiptsIn:'/app?tab=receipts',receiptsOut:'/app?tab=payments',expenses:'/app?tab=payments',otherIncome:'/app?tab=receipts',dailyCloseouts:'/daily-close?view=history',closeouts:'/close',cashHandovers:'/cash-handover',stockTransfers:'/app?tab=inventory',stocktakes:'/stocktake',receptions:'/receptions',airRechargeEvents:'/daily-close',supplierCash:'/app?tab=suppliers',giftOrders:'/app?tab=orders',redReversals:'/app?tab=red'};
const low=v=>String(v??'').trim().toLowerCase();
Object.assign(TYPES,{supplierExchanges:'供货商换货单',businessChangeRequests:'业务变更退换申请单',supplierOutboundTransfers:'供货商调货跟踪'});
Object.assign(ROUTES,{supplierExchanges:'/supplier-exchanges',businessChangeRequests:'/business-change-returns',supplierOutboundTransfers:'/supplier-outbound-tracking'});
delete TYPES.receptions;
const match=(values,term)=>!term||values.some(v=>low(v).includes(term));
function query(store,user,params){
 const actor=c.userById(store,user.id),cap=c.capabilities(actor);
 if(actor.assistantCustomerOnly||['customer-assistant','personal-assistant'].includes(actor.roleCode))throw new c.HttpError(403,'当前账号不能查询业务单据');
 const type=params.get('type')||'all';if(type!=='all'&&!TYPES[type])throw new c.HttpError(400,'单据类型不正确');
 const from=params.get('from')||'',to=params.get('to')||'';
 for(const day of [from,to])if(day&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00+08:00'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day))throw new c.HttpError(400,'请填写有效日期');
 if(from&&to&&from>to)throw new c.HttpError(400,'开始日期不能晚于结束日期');
 const fields={};for(const key of ['number','product','counterparty','employee']){fields[key]=low(params.get(key));if(fields[key].length>100)throw new c.HttpError(400,'查询条件最多100字');}
 const offset=Number(params.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw new c.HttpError(400,'页码不正确');
 // Existing visibility functions run once per type, against an isolated snapshot.
 const snapshot=structuredClone(store),actual=c.userById(snapshot,actor.id),cache=new Map();
 const once=(key,fn)=>{if(!cache.has(key))cache.set(key,fn());return cache.get(key);};
 const sales=()=>once('sales',()=>require('./erp').orders(snapshot,actual));
 const finance=()=>once('finance',()=>require('./erp').finance(snapshot,actual));
 const supplierDetails=()=>once('supplierDetails',()=>{c.permit(actual,'supplierView');return (snapshot.suppliers||[]).map(s=>require('./suppliers').detail(snapshot,actual,s.id));});
 function visible(kind){switch(kind){
  case 'sales':return sales();
  case 'procurementPlans':return require('./suppliers').planRows(snapshot,actual);
  case 'purchases':return require('./suppliers').purchaseRows(snapshot,actual);
  case 'saleReturnRequests':return require('./sale-return-requests').list(snapshot,actual);
  case 'saleReturns':case 'saleExchanges':{const ids=new Set(sales().map(x=>x.id));return (snapshot[kind]||[]).filter(x=>ids.has(x.orderId));}
  case 'purchaseReturnRequests':return require('./purchase-return-requests').list(snapshot,actual);
  case 'purchaseReturns':return supplierDetails().flatMap(x=>x.returns||[]);
  case 'supplierCash':return supplierDetails().flatMap(x=>x.cash||[]);
  case 'receiptsIn':return (finance().receipts||[]).filter(x=>Number(x.amount)>=0);
  case 'receiptsOut':return (finance().receipts||[]).filter(x=>Number(x.amount)<0);
  case 'expenses':case 'otherIncome':return finance()[kind]||[];
  case 'dailyCloseouts':return require('./daily-close').list(snapshot,actual);
  case 'businessChangeRequests':return require('./business-change-returns').list(snapshot,actual,new URLSearchParams()).rows;
  case 'supplierExchanges':return require('./supplier-exchanges').list(snapshot,actual,new URLSearchParams()).rows;
  case 'supplierOutboundTransfers':return require('./supplier-outbound-tracking').list(snapshot,actual,new URLSearchParams()).rows;
  case 'closeouts':return require('./closeouts').closeouts(snapshot,actual);
  case 'cashHandovers':return require('./cash-handovers').list(snapshot,actual);
  case 'stockTransfers':return require('./inventory-transfers').list(snapshot,actual);
  case 'stocktakes':c.permit(actual,'stocktake');return snapshot.stocktakes||[];
  case 'receptions':return require('./receptions').list(snapshot,actual).rows;
  case 'airRechargeEvents':return require('./daily-close').airList(snapshot,actual);
  case 'giftOrders':return sales().flatMap(parent=>(parent.giftOrders||[]).map(row=>({...row,createdAt:row.createdAt||parent.createdAt,sourceId:parent.id,operatorId:row.operatorId||parent.operatorId,salespersonId:parent.salespersonId})));
  case 'redReversals':return require('./red-reversals').list(snapshot,actual);
 }}
 const byId=new Map();for(const name of Object.keys(numbers.DEFINITIONS))for(const row of numbers.rowsFor(store,name))if(row.id&&!byId.has(row.id))byId.set(row.id,row);
 const registry=new Map((store.documentNumbers||[]).map(row=>[row.sourceId,row.displayNo]));
 const products=new Map((store.products||[]).map(row=>[row.skuId,row])),people=new Map((store.users||[]).map(row=>[row.id,row.name])),suppliers=new Map((store.suppliers||[]).map(row=>[row.id,row.name]));
 const accounts=new Map((store.users||[]).map(row=>[row.id,[row.employeeNo,row.staffNo,row.workNo,row.username,row.account].filter(Boolean)]));
 const names=(row,keys)=>keys.flatMap(key=>row?.[key]==null?[]:[String(row[key]),people.get(row[key])||'',...(accounts.get(row[key])||[])]);
 const relevantNames=row=>names(row,['operatorId','operator','operatorName','applicantId','applicantName','salespersonId','salesperson','cashierId','cashier','employeeId','employeeName','ownerId','ownerName','receiverId','receiver','senderId','sender','recipientId','recipient','createdBy','handlerId']);
 const output=[];
 for(const kind of type==='all'?Object.keys(TYPES):[type]){
  let rows;try{rows=visible(kind);}catch(error){if([400,403,404].includes(error.statusCode))continue;throw error;}
  if(!Array.isArray(rows))throw new c.HttpError(500,'单据读取结果异常');
  for(const row of rows){
   const collection=kind.startsWith('receipts')?'receipts':kind;
   const parent=byId.get(row.sourceId||row.orderId||row.purchaseId||row.planId),at=row.createdAt||row.appliedAt||row.confirmedAt||row.date||row.at||row.startedAt||'';
   const day=at?c.day(at):'';if((from&&day<from)||(to&&(!day||day>to)))continue;
   const displayNo=registry.get(row.id)||row.displayNo||row.number||row.id;
   if(!match([row.id,displayNo,row.sourceId,row.orderId,registry.get(row.sourceId),registry.get(row.orderId),kind==='businessChangeRequests'?row.customerPhone:'',kind==='businessChangeRequests'?row.mobileBusinessNo:'',kind==='businessChangeRequests'?row.settlementNo:''],fields.number))continue;
   const counterparties=[row.supplier,row.supplierName,row.receivingStore,row.customerPhone,row.counterparty,row.counterpartyName,row.payer,row.payee,row.customerName,suppliers.get(row.supplierId),parent?.supplier,parent?.counterparty,parent?.customerName,suppliers.get(parent?.supplierId)].filter(Boolean);
   if(!match(counterparties,fields.counterparty))continue;
   const staff=[...relevantNames(row),...relevantNames(parent)];if(!match(staff,fields.employee))continue;
   const lines=(row.items?.length?row.items:row.lines?.length?row.lines:parent?.items)||[];
   const lineFields=item=>{const product=products.get(item.skuId);return [item.name,item.product,item.externalCode,item.skuId,item.serialNo,...(item.serials||[]),product?.name,product?.externalCode,...(product?.aliases||[])];};
   if(fields.product&&!match([...lines.flatMap(lineFields),row.product,row.productName,row.serialNo,row.skuId,products.get(row.skuId)?.name,products.get(row.skuId)?.externalCode],fields.product))continue;
   const financialHidden=['purchases','procurementPlans','purchaseReturns','purchaseReturnRequests'].includes(kind)&&!cap.cost&&!cap.supplierView;
   const amount=financialHidden?null:(row.amount??row.plannedAmount??row.refundAmount??row.totalAmount??row.balance?.due??null);
   const route=ROUTES[kind],source=kind==='giftOrders'?parent?.id||row.sourceId||row.id:row.id;
   const href=kind==='supplierExchanges'?'/supplier-exchanges?id='+encodeURIComponent(source):kind==='businessChangeRequests'?'/business-change-returns?id='+encodeURIComponent(source):kind==='supplierOutboundTransfers'?'/supplier-outbound-tracking?id='+encodeURIComponent(source):kind==='dailyCloseouts'?(row.simpleDailyClose?'/simple-daily-close?view=reports&reviewDate='+row.date+'&record='+encodeURIComponent(source):'/daily-close?closeout='+encodeURIComponent(source)):route+(route.includes('?')?'&':'?')+(kind==='receptions'?'highlight':'q')+'='+encodeURIComponent(source);
   output.push({id:row.id,collection,type:kind,typeName:TYPES[kind],displayNo,createdAt:at,counterparty:[...new Set(counterparties)].join('、'),employee:[...new Set(names(row,['operator','salesperson','cashier','employeeName','ownerName','sender','receiver']).filter(Boolean))].join('、')||[...new Set(staff.filter(v=>[...people.values()].includes(v)))].join('、'),status:row.status||'',amount:amount==null?null:Number(amount),items:lines.map(item=>({name:item.name||item.productName||products.get(item.skuId)?.name||'',code:item.externalCode||products.get(item.skuId)?.externalCode||'',quantity:item.quantity??null,serialNo:item.serialNo||'',serials:item.serials||[]})),href});
  }
 }
 output.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||String(a.id).localeCompare(String(b.id)));
 return {rows:output.slice(offset,offset+50),total:output.length,nextOffset:output.length>offset+50?offset+50:null,types:Object.entries(TYPES).map(([value,label])=>({value,label})),limit:50};
}
module.exports={query,TYPES};
