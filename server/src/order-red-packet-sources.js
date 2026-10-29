"use strict";
const c=require('./common');
const LABELS={sales:'销售／维修单',purchases:'采购入库单',receptions:'接待单',carrierServices:'移动业务单',cardBusinesses:'号卡业务单',cardEvents:'号卡结算单',stocktakes:'库存盘点单',stockTransfers:'仓库调拨单',receipts:'收付款单',expenses:'费用付款单',otherIncome:'收入单',saleReturnRequests:'销售退换申请',saleReturns:'销售退货单',saleExchanges:'销售换货单',purchaseReturnRequests:'采购退货申请',purchaseReturns:'采购退货单',redReversals:'红冲申请',procurementPlans:'采购计划',supplierCash:'往来付款／退款单',supplierSettlements:'往来核销单',supplierAdjustments:'往来调价单',dailyCloseouts:'营业日结单',closeouts:'现金交班单',cashHandovers:'现金交接单',fundTransfers:'内部资金划转单',workJournals:'工作记录单',learningRecords:'学习单',conversionClaims:'成果转化单',assistCommissionAllocations:'协助提成核定单',govSubsidyClaims:'国补核销单',payrollStatements:'工资单',payrollAdjustments:'工资调整单',productPriceChanges:'商品调价单',usedPhoneAssessments:'二手机估价单',dutyAssignments:'任务安排单',airRechargeEvents:'空中充值单',giftApprovals:'赠品审批单',giftOrders:'赠品出库单',receptionAssists:'接待协助单',supplierEntries:'往来记账单'};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
LABELS.mobileCardBundles='新办卡组合办理单';
function actual(store,user){const row=c.userById(store,user?.id);if(row.roleCode!==user.roleCode||row.assistantCustomerOnly||!['owner','manager','employee','warehouse'].includes(row.roleCode))throw new c.HttpError(403,'仅门店账号可使用单据红包');return row;}
function rows(store,collection){
 if(collection==='giftOrders')return(store.sales||[]).flatMap(parent=>(parent.giftOrders||[]).map(row=>({row,parent})));
 if(collection==='receptionAssists')return(store.receptions||[]).flatMap(parent=>(parent.assists||[]).map(row=>({row,parent})));
 return(store[collection]||[]).map(row=>({row,parent:null}));
}
function saleVisible(user,row){return c.capabilities(user).allSales||(row.salespersonId||row.operatorId)===user.id;}
function receptionVisible(user,row){return ['owner','manager'].includes(user.roleCode)||row.ownerId===user.id||(row.assists||[]).some(x=>x.fromId===user.id||x.toId===user.id)||['接待中','待回访','已转业务'].includes(row.status);}
function visible(store,user,collection,row,parent){
 const caps=c.capabilities(user),owner=user.roleCode==='owner';
 if(collection==='sales')return saleVisible(user,row);
 if(collection==='giftOrders')return parent&&saleVisible(user,parent);
 if(collection==='receptions')return receptionVisible(user,row);
 if(collection==='receptionAssists')return parent&&(['owner','manager'].includes(user.roleCode)||parent.ownerId===user.id||row.fromId===user.id||row.toId===user.id);
 if(collection==='purchases'||collection==='procurementPlans')return caps.purchase;
 if(collection==='purchaseReturns')return owner||caps.supplierView||(store.purchaseReturnRequests||[]).some(x=>x.resultId===row.id&&x.requesterId===user.id);
 if(collection==='stocktakes')return caps.stocktake;
 if(collection==='stockTransfers')return caps.purchase&&caps.stocktake;
 if(collection==='carrierServices'||collection==='mobileCardBundles')return caps.finance||caps.allSales||(row.employeeId||row.operatorId)===user.id;
 if(collection==='cardBusinesses')return caps.finance||row.employeeId===user.id;
 if(collection==='cardEvents')return caps.finance||(store.cardBusinesses||[]).some(x=>x.id===row.businessId&&x.employeeId===user.id);
 if(collection==='receipts'||collection==='expenses'||collection==='otherIncome'||collection==='govSubsidyClaims')return caps.finance;
 if(collection==='saleReturnRequests')return owner||row.requesterId===user.id;
 if(collection==='saleReturns'||collection==='saleExchanges'){const sale=(store.sales||[]).find(x=>x.id===(row.orderId||row.originalOrderId));return sale?saleVisible(user,sale):owner;}
 if(collection==='purchaseReturnRequests')return caps.purchase&&(owner||row.requesterId===user.id);
 if(collection==='redReversals')return (caps.redRequest||caps.redReview)&&(caps.redReview||caps.finance||row.requesterId===user.id);
 if(collection==='dailyCloseouts')return owner||row.cashierId===user.id||row.reviewerId===user.id;
 if(collection==='closeouts')return owner||row.cashierId===user.id||row.receiverId===user.id;
 if(collection==='cashHandovers')return caps.learn&&(owner||row.senderId===user.id||row.recipientId===user.id);
 if(collection==='fundTransfers')return caps.finance&&(owner||row.fromId===user.id||row.toId===user.id);
 if(collection==='workJournals')return ['owner','manager'].includes(user.roleCode)||row.employeeId===user.id;
 if(collection==='learningRecords')return owner||row.employeeId===user.id||require('./review-delegation').allowed(store,user,'learning',row);
 if(collection==='conversionClaims')return owner||row.proposerId===user.id||row.targetEmployeeId===user.id;
 if(collection==='productPriceChanges')return caps.manageProducts;
 if(collection==='supplierCash'||collection==='supplierSettlements'||collection==='supplierAdjustments'||collection==='supplierEntries')return caps.supplierView;
 if(collection==='airRechargeEvents')return row.kind==='customer_recharge'?(caps.finance||row.operatorId===user.id):caps.finance;
 // Legacy maintenance-only document families cannot open a new staff read path.
 return owner;
}
function rewardExpense(store,collection,row){
 if(collection==='redReversals'&&row.kind==='expense'){const original=(store.expenses||[]).find(x=>x.id===(row.sourceId||row.expenseId));return Boolean(original&&rewardExpense(store,'expenses',original));}
 if(collection==='expenses')return Boolean(row.redPacketId||(row.redOf&&(store.expenses||[]).find(x=>x.id===row.redOf)?.redPacketId));
 if(collection==='receipts'){const expense=(store.expenses||[]).find(x=>x.id===row.sourceId);return expense&&rewardExpense(store,'expenses',expense);}
 return false;
}
function economicKey(store,collection,row){
 if(collection!=='receipts')return collection+'/'+row.id;
 const mapping={sale:'sales',refund:'saleReturns',purchase:'purchases',expense:'expenses',expense_red:'expenses',other_income:'otherIncome',other_income_red:'otherIncome',supplier_payment:'supplierCash',supplier_refund:'supplierCash',carrier:'cardEvents',carrier_clawback:'cardEvents',payroll:'payrollStatements'};
 if(typeof row.sourceId!=='string'||!row.sourceId)throw new c.HttpError(409,'收付款单缺少可核对的原业务来源');
 const base=mapping[row.kind];if(base&&(store[base]||[]).filter(x=>x.id===row.sourceId).length===1)return base+'/'+row.sourceId;
 if(row.kind==='carrier_rental'){const matches=(store.carrierServices||[]).filter(parent=>(parent.schedule||[]).some(part=>(part.events||[]).some(event=>event.id===row.sourceId)));if(matches.length===1)return 'carrierServices/'+matches[0].id;}
 if(['gov_subsidy','gov_subsidy_refund'].includes(row.kind)){const type=row.kind==='gov_subsidy'?'receive':'refund',matches=(store.govSubsidyClaims||[]).filter(parent=>(parent.events||[]).some(event=>event.id===row.sourceId&&event.type===type));if(matches.length===1)return 'govSubsidyClaims/'+matches[0].id;}
 if(['air_funding','cash_recharge'].includes(row.kind)){const type=row.kind==='air_funding'?'funding':'customer_recharge',matches=(store.airRechargeEvents||[]).filter(event=>event.id===row.sourceId&&event.kind===type);if(matches.length===1)return 'airRechargeEvents/'+matches[0].id;}
 throw new c.HttpError(409,'收付款单原经济业务来源不能核实，暂不能申请红包，请由管理员核对');
}
function contentSummary(store,collection,row){
 const clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 const names=(Array.isArray(row.items)?row.items:[]).map(item=>clean(item.name||item.productName||(store.products||[]).find(p=>p.skuId===item.skuId)?.name)).filter(Boolean);
 const direct=[row.subTypeName,row.typeName,row.serviceName,row.projectName,row.productName,row.title].map(clean).filter(Boolean);
 const selected=names.length?names:direct;
 return [...new Set(selected)].slice(0,2).join('、').slice(0,72)||(LABELS[collection]+' · 详见原单');
}
function description(store,collection,row){const registered=(store.documentNumbers||[]).find(x=>x.collection===collection&&x.sourceId===row.id),displayNo=registered?.displayNo||row.displayNo||row.id;return {collection,sourceId:row.id,sourceKey:economicKey(store,collection,row),displayNo,label:LABELS[collection],contentSummary:contentSummary(store,collection,row),createdAt:row.createdAt||row.confirmedAt||row.approvedAt||row.date||null};}
function resolve(store,user,collection,sourceId){
 const who=actual(store,user);if(typeof collection!=='string'||!own(LABELS,collection)||typeof sourceId!=='string'||!sourceId||sourceId.length>160)throw new c.HttpError(400,'请选择已生成的真实业务单据');
 const found=rows(store,collection).filter(x=>x.row?.id===sourceId);if(found.length!==1)throw new c.HttpError(found.length?409:404,'来源单据不存在或编号重复，请核对');
 const {row,parent}=found[0];if(!visible(store,who,collection,row,parent))throw new c.HttpError(403,'当前账号不能查看该来源单据');if(rewardExpense(store,collection,row))throw new c.HttpError(400,'红包支出本身不能再次作为红包申请来源');
 return description(store,collection,row);
}
function lookup(store,user,query,raw){
 const who=actual(store,user);if(raw.length>6000||query.has('collection')||query.has('sourceId')||query.has('q'))throw new c.HttpError(400,'来源批量查询内容不正确');
 let refs;try{refs=JSON.parse(raw);}catch{throw new c.HttpError(400,'来源批量查询内容不正确');}
 if(!Array.isArray(refs)||refs.length<1||refs.length>50||refs.some(x=>!Array.isArray(x)||x.length!==2||typeof x[0]!=='string'||x[0].length>80||typeof x[1]!=='string'||!x[1]||x[1].length>160||/[\u0000-\u001f\u007f]/.test(x.join(''))))throw new c.HttpError(400,'来源批量查询内容不正确');
 const checked=[],found=[],seen=new Set();for(const [collection,id]of refs){const key=collection+'/'+id;if(seen.has(key))continue;seen.add(key);checked.push(key);try{found.push(resolve(store,who,collection,id));}catch(error){if(![400,403,404,409].includes(error.statusCode))throw error;}}
 return {rows:found,checked,total:found.length,truncated:false,employees:who.roleCode==='owner'?(store.users||[]).filter(x=>x.status==='active'&&x.roleCode==='employee'&&!x.assistantCustomerOnly).map(({id,name})=>({id,name})):[]};
}
function list(store,user,query=new URLSearchParams()){
 const batch=query.get('refs');if(batch!==null)return lookup(store,user,query,batch);
 const who=actual(store,user),wanted=query.get('collection')||'',exact=query.get('sourceId'),q=(query.get('q')||'').trim().toLowerCase();if(wanted&&!own(LABELS,wanted))throw new c.HttpError(400,'来源单据类型不正确');if(q.length>100)throw new c.HttpError(400,'查询内容不能超过100字');
 if(exact!==null){if(!wanted)throw new c.HttpError(400,'准确查询须同时选择单据类型');const item=resolve(store,who,wanted,exact);return {rows:[item],total:1,truncated:false,employees:who.roleCode==='owner'?(store.users||[]).filter(x=>x.status==='active'&&x.roleCode==='employee'&&!x.assistantCustomerOnly).map(({id,name})=>({id,name})):[]};}
 const found=[],seen=new Set();for(const collection of (wanted?[wanted]:Object.keys(LABELS)).filter(k=>!['receptions','receptionAssists','conversionClaims','assistCommissionAllocations'].includes(k)))for(const {row,parent}of rows(store,collection)){if(!row||typeof row.id!=='string'||!visible(store,who,collection,row,parent)||rewardExpense(store,collection,row))continue;let item;try{item=description(store,collection,row);}catch(e){if(e.statusCode===409)continue;throw e;}if(seen.has(item.sourceKey)||q&&!JSON.stringify(item).toLowerCase().includes(q))continue;seen.add(item.sourceKey);found.push(item);}
 found.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));return {rows:found.slice(0,200),total:found.length,truncated:found.length>200,employees:who.roleCode==='owner'?(store.users||[]).filter(x=>x.status==='active'&&x.roleCode==='employee'&&!x.assistantCustomerOnly).map(({id,name})=>({id,name})):[]};
}
module.exports={actual,resolve,list,LABELS};
