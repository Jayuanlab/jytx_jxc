'use strict';
const c=require('./common');
const accounts=require('./payment-accounts');
const ownership=require('./account-ownership');
const flow=require('./business-change-flow');
const TAX_NUMERATOR=25,TAX_DENOMINATOR=1000,TAX_RULE='business-change-hebao-2.5%-20261027';
const rows=store=>store.businessChangeRequests||=[];
const money=(n,label)=>accounts.cents(n,label);
const taxCents=n=>Math.floor((n*TAX_NUMERATOR+TAX_DENOMINATOR/2)/TAX_DENOMINATOR);
function actor(store,user){const who=c.userById(store,user.id);if(who.roleCode!==user.roleCode||who.assistantCustomerOnly||who.status==='disabled')throw new c.HttpError(403,'当前账号不能办理门店业务');return who;}
function owner(store,user){const who=actor(store,user);if(who.roleCode!=='owner')throw new c.HttpError(403,'此操作须老板本人办理');return who;}
function text(value,label,max=160){const s=String(value||'').trim();if(s.length>max)throw new c.HttpError(400,label+'过长');return s;}
function find(store,id){const row=rows(store).find(x=>x.id===String(id||''));if(!row)throw new c.HttpError(404,'业务变更退换申请单不存在');return row;}
function visible(store,user,row){const who=actor(store,user);if(who.roleCode!=='owner'&&row.operatorId!==who.id&&row.employeeId!==who.id)throw new c.HttpError(403,'只能查看本人单据');return row;}
function storeWallet(store,id,channel){const row=(store.paymentAccounts||[]).find(x=>x.id===id&&x.active!==false&&ownership.isStoreAccount(store,x));if(!row||row.channel!==channel)throw new c.HttpError(409,'门店资金账户不存在或已停用');return row;}
function hebao(store,id){if(id==='LEGACY-HEBAO')return{id,name:'和包商户',channel:'和包商户',legacy:true};const row=storeWallet(store,id,'和包商户');if(row.name!=='和包商户')throw new c.HttpError(409,'须选择门店和包商户');return row;}
function cash(store){const row=require('./cash-vault').account(store);if(!row)throw new c.HttpError(409,'门店现金账户尚未配置');return row;}
function options(store,user){const who=actor(store,user);c.permit(who,'sell');const vault=require('./cash-vault').account(store),hebaoAccounts=(store.paymentAccounts||[]).filter(x=>x.active!==false&&x.name==='和包商户'&&x.channel==='和包商户'&&ownership.isStoreAccount(store,x)).map(x=>({id:x.id,name:x.name}));if(!hebaoAccounts.length)hebaoAccounts.push({id:'LEGACY-HEBAO',name:'和包商户'});return {canReview:who.roleCode==='owner',hebaoAccounts,wechatAccounts:(store.paymentAccounts||[]).filter(x=>x.active!==false&&x.channel==='微信'&&['门店微信','信号机微信'].includes(x.name)&&ownership.isStoreAccount(store,x)).map(x=>({id:x.id,name:x.name})),hasCash:!!vault,cashAccount:vault?{id:vault.id,name:vault.name}:null};}
function candidates(store,user,query){const who=actor(store,user);c.permit(who,'sell');const q=String(query?.get?.('q')||'').trim();if(q.length<4)return {rows:[]};const out=[];for(const [kind,collection] of [['移动业务单',store.carrierServices||[]],['号卡业务单',store.cardBusinesses||[]]])for(const row of collection){if(![row.id,row.displayNo,row.businessNo,row.businessId,row.customerPhone,row.phone,row.mobilePhone,row.primaryPhone].some(x=>String(x||'').includes(q)))continue;if(who.roleCode!=='owner'&&row.operatorId!==who.id&&row.employeeId!==who.id)continue;out.push({kind,id:row.id,displayNo:row.displayNo||row.id,phone:row.customerPhone||row.phone||row.mobilePhone||'',date:row.createdAt||''});}return {rows:out.slice(0,20)};}
function list(store,user,query){const who=actor(store,user);c.permit(who,'sell');const q=String(query?.get?.('q')||'').trim().toLowerCase(),id=String(query?.get?.('id')||'');return {rows:rows(store).filter(r=>(who.roleCode==='owner'||r.operatorId===who.id||r.employeeId===who.id)&&(!id||r.id===id)&&(!q||[r.id,r.customerPhone,r.mobileBusinessNo,r.businessText].join(' ').toLowerCase().includes(q))).map(r=>({...r,metrics:metrics(r)}))};}
function metrics(row){return flow.metrics(row);}
function create(store,user,payload){const who=actor(store,user);c.permit(who,'sell');const phone=text(payload.customerPhone,'手机号',20),businessNo=text(payload.mobileBusinessNo,'移动业务编号',80);if(!phone&&!businessNo)throw new c.HttpError(400,'手机号或移动业务编号至少填一项');if(phone&&!/^1[3-9]\d{9}$/.test(phone))throw new c.HttpError(400,'手机号格式不正确');const refund=money(payload.refundAmount,'应退金额'),hebaoAmount=money(payload.hebaoAmount,'和包应收');if(!refund||!hebaoAmount)throw new c.HttpError(400,'退款和和包应收金额均须大于零');const method=String(payload.refundMethod||'');if(!['cash','store-wechat','boss-wechat'].includes(method))throw new c.HttpError(400,'请选择退顾客方式');const account=method==='cash'?cash(store):method==='store-wechat'?storeWallet(store,payload.refundAccountId,'微信'):null;if(method==='store-wechat'&&!['门店微信','信号机微信'].includes(account.name))throw new c.HttpError(409,'须选择门店微信具体账户');const wallet=hebao(store,payload.hebaoAccountId);let sourceId=text(payload.sourceId,'原业务单号',100);const matched=['carrierServices','cardBusinesses'].flatMap(k=>(store[k]||[]).filter(x=>businessNo&&[x.id,x.displayNo,x.businessNo,x.businessId].some(v=>String(v||'')===businessNo)||phone&&[x.customerPhone,x.phone,x.mobilePhone,x.primaryPhone].some(v=>String(v||'')===phone)).map(x=>x.id));if(sourceId&&!matched.includes(sourceId))throw new c.HttpError(409,'所选原业务与手机号或业务编号不符');if(!sourceId&&matched.length===1)sourceId=matched[0];if(!sourceId&&matched.length>1)throw new c.HttpError(409,'找到多张原业务，请选择正确原单');const row={id:c.id('BC'),title:'业务变更退换申请单',status:payload.draft===true?'草稿':'待老板批准',customerPhone:phone,mobileBusinessNo:businessNo,businessText:text(payload.businessText,'涉及业务',500),sourceId,sourceState:sourceId?'已关联':'未关联',refundAmount:refund/100,refundMethod:method,refundAccountId:account?.id||'',refundStatus:'待付',hebaoAmount:hebaoAmount/100,hebaoAccountId:wallet.id,hebaoStatus:'待收',settlementNo:text(payload.settlementNo,'移动结算编号',100),expectedAt:text(payload.expectedAt,'预计到账日期',20),taxSettlementMode:flow.MODE,taxSettlementRule:flow.VERSION,taxRate:2.5,taxRule:TAX_RULE,taxAmount:taxCents(hebaoAmount)/100,operatorId:who.id,operatorName:who.name,employeeId:who.id,employeeName:who.name,createdAt:c.now(),events:[{type:'申请建立',by:who.id,at:c.now()}]};(store.businessChangeRequests||=[]).unshift(row);c.audit(store,who,'business-change:create',{id:row.id,status:row.status,refund:row.refundAmount,hebao:row.hebaoAmount,tax:row.taxAmount});return {...row,metrics:metrics(row)};}
function submit(store,user,payload){const who=actor(store,user),row=visible(store,who,find(store,payload.id));if(row.operatorId!==who.id||row.status!=='草稿')throw new c.HttpError(409,'只能提交本人草稿');row.status='待老板批准';row.events.push({type:'提交老板批准',by:who.id,at:c.now()});c.audit(store,who,'business-change:submit',{id:row.id});return {...row,metrics:metrics(row)};}
function review(store,user,payload){const who=owner(store,user),row=find(store,payload.id);if(row.status!=='待老板批准')throw new c.HttpError(409,'申请状态已变化');const approved=payload.approved===true;if(!approved&&payload.approved!==false)throw new c.HttpError(400,'请选择批准或退回');row.status=approved?'已批准':'已退回';row.reviewedBy=who.id;row.reviewedAt=c.now();row.reviewNote=text(payload.note,'审核意见',500);row.events.push({type:row.status,by:who.id,at:row.reviewedAt,note:row.reviewNote});c.audit(store,who,'business-change:review',{id:row.id,status:row.status});return {...row,metrics:metrics(row)};}
function uniqueReference(store,value){const ref=text(value,'流水或凭证编号',100);if(!ref)throw new c.HttpError(400,'请填写实际付款或到账凭证编号');accounts.reference(store,ref);if(rows(store).some(row=>row.refundReference===ref||row.hebaoReference===ref||row.taxReference===ref||row.bossAdvanceSettlementReference===ref))throw new c.HttpError(409,'凭证编号已用于另一笔资金动作');return ref;}
function complete(row){if(row.refundStatus==='已付'&&row.hebaoStatus==='已收'&&(!flow.withheld(row)||row.withholdingConfirmed===true)){row.status=row.bossAdvanceStatus==='门店待结算'?'老板垫付待结算':'资金已核清';row.realizedAt=c.now();}}
function refund(store,user,payload){const who=actor(store,user),row=find(store,payload.id);if(row.status!=='已批准'&&row.status!=='资金已核清')throw new c.HttpError(409,'须先由老板批准');if(row.refundStatus==='已付')throw new c.HttpError(409,'本单退款已登记');if(row.refundMethod==='boss-wechat'&&who.roleCode!=='owner')throw new c.HttpError(403,'老板微信付款只能由老板本人确认');if(row.refundMethod!=='boss-wechat'&&who.roleCode!=='owner'&&who.id!==row.operatorId)throw new c.HttpError(403,'仅经办营业员或老板可登记门店退款');if(payload.actualPaid!==true||money(payload.amount,'实退金额')!==money(row.refundAmount))throw new c.HttpError(409,'请按批准金额核实实际退款');const reference=uniqueReference(store,payload.reference),at=c.now();let receiptId='';if(row.refundMethod!=='boss-wechat'){const account=row.refundMethod==='cash'?cash(store):storeWallet(store,row.refundAccountId,'微信');const part={id:c.id('PP'),...accounts.resolve(store,{paymentAccountId:account.id,account:account.channel}),amount:row.refundAmount,reference};receiptId=accounts.record(store,who,'business_change_refund',row.id,[part],-1,{businessChangeId:row.id})[0].id;}else{row.bossAdvanceAmount=row.refundAmount;row.bossAdvanceStatus='门店待结算';}row.refundStatus='已付';row.actualRefundAmount=row.refundAmount;row.refundReference=reference;row.refundAt=at;row.refundBy=who.id;row.refundReceiptId=receiptId;row.events.push({type:'实际退顾客',by:who.id,at,amount:row.refundAmount,reference,receiptId,method:row.refundMethod});complete(row);c.audit(store,who,'business-change:refund',{id:row.id,receiptId,amount:row.refundAmount});return {...row,metrics:metrics(row)};}
function receive(store,user,payload){const who=owner(store,user),row=find(store,payload.id);if(row.status!=='已批准'&&row.status!=='资金已核清')throw new c.HttpError(409,'须先由老板批准');if(row.hebaoStatus==='已收')throw new c.HttpError(409,'本单和包到账已确认');if(payload.actualReceived!==true||money(payload.amount,'和包实收')!==money(row.hebaoAmount))throw new c.HttpError(409,'实际到账与申请金额不一致，请先核查差异');const wallet=hebao(store,row.hebaoAccountId),reference=uniqueReference(store,payload.reference),part={id:c.id('PP'),...accounts.resolve(store,{paymentAccountId:wallet.id,account:'和包商户'}),amount:row.hebaoAmount,reference},at=c.now();const receipt=accounts.record(store,who,'business_change_hebao',row.id,[part],1,{businessChangeId:row.id,fundPartyKey:'platform:carrier',counterpartyNameSnapshot:'中国移动'})[0];row.hebaoStatus='已收';row.actualHebaoAmount=row.hebaoAmount;row.hebaoReference=reference;row.hebaoAt=at;row.hebaoBy=who.id;row.hebaoReceiptId=receipt.id;row.taxAmount=taxCents(money(row.actualHebaoAmount))/100;row.events.push({type:'和包实际到账',by:who.id,at,amount:row.hebaoAmount,reference,receiptId:receipt.id,taxAmount:row.taxAmount});complete(row);c.audit(store,who,'business-change:hebao-receive',{id:row.id,receiptId:receipt.id,tax:row.taxAmount});return {...row,metrics:metrics(row)};}
function taxPay(store,user,payload){const who=owner(store,user),row=find(store,payload.id);if(flow.withheld(row))throw new c.HttpError(409,'移动直接代扣本单税款，不得另登记门店缴税重复扣款');if(row.hebaoStatus!=='已收'||row.taxExpenseId)throw new c.HttpError(409,'本单税费尚未可缴或已登记');if(payload.actualPaid!==true||money(payload.amount,'实缴税费')!==money(row.taxAmount))throw new c.HttpError(409,'税费金额须按和包实收的2.5%核对');const accountId=text(payload.paymentAccountId,'付款账户',100),account=accountId?accounts.resolve(store,{paymentAccountId:accountId}):null;if(!account||!ownership.isStoreAccount(store,account))throw new c.HttpError(409,'请选择实际付款的门店账户');const reference=uniqueReference(store,payload.reference),part={id:c.id('PP'),...account,amount:row.taxAmount,reference},at=c.now(),expense={id:c.id('EX'),type:'业务变更税费 · '+row.id,amount:row.taxAmount,operatorId:who.id,operator:who.name,createdAt:at,paymentParts:[part],businessChangeId:row.id};(store.expenses||=[]).push(expense);accounts.record(store,who,'expense',expense.id,[part],-1,{businessChangeId:row.id});require('./business-purpose').classify(store,expense,'operating');row.taxExpenseId=expense.id;row.taxReference=reference;row.taxPaidAt=at;row.taxPaidBy=who.id;row.events.push({type:'本单税费已缴',by:who.id,at,amount:row.taxAmount,expenseId:expense.id,reference});c.audit(store,who,'business-change:tax-paid',{id:row.id,expenseId:expense.id});return {...row,metrics:metrics(row)};}
function createWithoutSource(store,user,payload){
 const who=actor(store,user);c.permit(who,'sell');
 const phone=text(payload.customerPhone,'手机号',20),businessNo=text(payload.mobileBusinessNo,'移动业务编号',80);
 if(!phone&&!businessNo)throw new c.HttpError(400,'手机号或移动业务编号至少填一项');
 if(phone&&!/^1[3-9]\d{9}$/.test(phone))throw new c.HttpError(400,'手机号格式不正确');
 const refund=money(payload.refundAmount,'应退金额'),hebaoAmount=money(payload.hebaoAmount,'和包应收');
 if(!refund||!hebaoAmount)throw new c.HttpError(400,'退款和和包应收金额均须大于零');
 const method=String(payload.refundMethod||'');
 if(!['cash','store-wechat','boss-wechat'].includes(method))throw new c.HttpError(400,'请选择退顾客方式');
 const account=method==='cash'?cash(store):method==='store-wechat'?storeWallet(store,payload.refundAccountId,'微信'):null;
 if(method==='store-wechat'&&!['门店微信','信号机微信'].includes(account.name))throw new c.HttpError(409,'须选择门店微信具体账户');
 const wallet=hebao(store,payload.hebaoAccountId),at=c.now();
 if(payload.draft!==true){
  const same=(store.businessChangeRequests||[]).find(r=>r.operatorId===who.id&&r.status==='待老板批准'&&Date.parse(at)-Date.parse(r.createdAt)>=0&&Date.parse(at)-Date.parse(r.createdAt)<10*60*1000&&r.customerPhone===phone&&r.mobileBusinessNo===businessNo&&r.businessText===text(payload.businessText,'涉及业务',500)&&Math.round(r.refundAmount*100)===refund&&r.refundMethod===method&&r.refundAccountId===(account?.id||'')&&Math.round(r.hebaoAmount*100)===hebaoAmount&&r.hebaoAccountId===wallet.id&&r.settlementNo===text(payload.settlementNo,'移动结算编号',100)&&r.expectedAt===text(payload.expectedAt,'预计到账日期',20));
  if(same)return {...same,metrics:metrics(same),duplicateSubmission:true};
 }
 const row={id:c.id('BC'),title:'业务变更退换申请单',status:payload.draft===true?'草稿':'待老板批准',customerPhone:phone,mobileBusinessNo:businessNo,businessText:text(payload.businessText,'涉及业务',500),sourceId:'',sourceState:'按本单资料登记',refundAmount:refund/100,refundMethod:method,refundAccountId:account?.id||'',refundStatus:'待付',hebaoAmount:hebaoAmount/100,hebaoAccountId:wallet.id,hebaoStatus:'待收',settlementNo:text(payload.settlementNo,'移动结算编号',100),expectedAt:text(payload.expectedAt,'预计到账日期',20),taxSettlementMode:flow.MODE,taxSettlementRule:flow.VERSION,taxRate:2.5,taxRule:TAX_RULE,taxAmount:taxCents(hebaoAmount)/100,operatorId:who.id,operatorName:who.name,employeeId:who.id,employeeName:who.name,createdAt:at,events:[{type:'申请建立',by:who.id,at}]};
 (store.businessChangeRequests||=[]).unshift(row);
 c.audit(store,who,'business-change:create',{id:row.id,status:row.status,refund:row.refundAmount,hebao:row.hebaoAmount,tax:row.taxAmount});
 return {...row,metrics:metrics(row)};
}
function receiveWithActualChannel(store,user,payload){
 const who=owner(store,user),row=find(store,payload.id);
 if(row.status!=='已批准'&&row.status!=='资金已核清')throw new c.HttpError(409,'须先由老板批准');
 if(row.hebaoStatus==='已收')throw new c.HttpError(409,'本单和包到账已确认');
 const plan=flow.settlement(row),direct=flow.withheld(row);
 if(payload.actualReceived!==true||money(payload.amount,'和包实收')!==money(plan.netReceivable))throw new c.HttpError(409,direct?'请核对移动代扣税后的实际净到账金额':'实际到账与申请金额不一致，请先核查差异');
 if(direct&&(payload.withholdingConfirmed!==true||money(payload.withheldTaxAmount,'移动代扣税款')!==money(plan.tax)))throw new c.HttpError(409,'须同时核实移动代扣税额和结算凭据');
 const withholdingReference=direct?text(payload.withholdingReference,'移动代扣结算凭据',100):'';
 if(direct&&!withholdingReference)throw new c.HttpError(400,'请填写移动代扣结算凭据编号');
 const wallet=hebao(store,row.hebaoAccountId),reference=uniqueReference(store,payload.reference);
 const resolved=wallet.legacy?accounts.resolve(store,{account:'和包商户'}):accounts.resolve(store,{paymentAccountId:wallet.id,account:'和包商户'});
 const part={id:c.id('PP'),...resolved,amount:direct?plan.gross:plan.netReceivable,reference},at=c.now();
 const receipt=accounts.record(store,who,'business_change_hebao',row.id,[part],1,{businessChangeId:row.id,fundPartyKey:'platform:carrier',counterpartyNameSnapshot:'中国移动'})[0];
 if(direct){
  const withheldEntry=accounts.record(store,who,'business_change_withheld_tax',row.id,[{id:c.id('PP'),...resolved,amount:plan.tax}],-1,{businessChangeId:row.id,fundPartyKey:'platform:carrier',counterpartyNameSnapshot:'中国移动',settlementAdjustment:true,relatedReceiptId:receipt.id,withholdingReference,note:'移动结算直接代扣，和包实际净到账 '+plan.netReceivable})[0];row.withholdingReceiptId=withheldEntry.id;
  if(!row.taxSettlementMode)row.events.push({type:'采用移动直接代扣结算规则',by:who.id,at,originalGrossAmount:row.hebaoAmount,taxAmount:plan.tax,netAmount:plan.netReceivable,rule:flow.VERSION});
  row.taxSettlementMode=flow.MODE;row.taxSettlementRule=flow.VERSION;row.withholdingConfirmed=true;row.actualWithheldTaxAmount=plan.tax;row.withholdingReference=withholdingReference;row.withheldAt=at;row.withheldBy=who.id;
 }
 row.hebaoStatus='已收';row.actualHebaoAmount=plan.netReceivable;row.hebaoReference=reference;row.hebaoAt=at;row.hebaoBy=who.id;row.hebaoReceiptId=receipt.id;row.taxAmount=plan.tax;
 row.events.push({type:direct?'和包净到账及移动代扣已核实':'和包实际到账',by:who.id,at,amount:plan.netReceivable,reference,receiptId:receipt.id,grossAmount:plan.gross,taxAmount:plan.tax,...(direct?{withholdingReference}:{} )});
 complete(row);c.audit(store,who,'business-change:hebao-receive',{id:row.id,receiptId:receipt.id,gross:plan.gross,net:plan.netReceivable,tax:plan.tax,taxMode:plan.mode});
 return {...row,metrics:metrics(row)};
}

function withholdTax(store,user,payload){
 const who=owner(store,user),row=find(store,payload.id);
 if(!flow.active(row)||row.hebaoStatus!=='已收'||row.withholdingConfirmed||row.taxExpenseId)throw new c.HttpError(409,'本单不需要重复登记和包代扣税');
 if(!flow.withheld(row))throw new c.HttpError(409,'历史已登记税款不能改为代扣，请核对原凭证');
 const plan=flow.settlement(row),amount=money(payload.amount,'移动代扣税'),net=money(payload.actualNetAmount,'和包实际净到账');
 if(payload.withholdingConfirmed!==true||payload.actualReceived!==true||amount!==money(plan.tax)||net!==money(plan.netReceivable))throw new c.HttpError(409,'请按移动结算凭据核对代扣税及和包净到账金额');
 const reference=text(payload.withholdingReference,'移动代扣结算凭据',100),note=text(payload.note,'核对说明',500);
 if(!reference)throw new c.HttpError(400,'请填写移动代扣结算凭据编号');
 const original=(store.receipts||[]).find(r=>r.id===row.hebaoReceiptId&&r.sourceId===row.id&&r.kind==='business_change_hebao');
 if(!original||original.account!=='和包商户'||money(original.amount)!==money(plan.gross)||money(row.actualHebaoAmount)!==money(plan.gross))throw new c.HttpError(409,'原和包收入与结算总额不一致，请先核对原流水');
 if((store.receipts||[]).some(r=>r.sourceId===row.id&&r.kind==='business_change_withheld_tax'))throw new c.HttpError(409,'本单已有和包代扣记录，不能重复扣税');
 if(payload.paymentAccountId&&payload.paymentAccountId!==(original.paymentAccountId||row.hebaoAccountId))throw new c.HttpError(409,'代扣只能归入原单和包账户，不能使用现金或微信');
 const at=c.now(),part={id:c.id('PP'),...accounts.snapshot(original),amount:plan.tax};
 const entry=accounts.record(store,who,'business_change_withheld_tax',row.id,[part],-1,{businessChangeId:row.id,fundPartyKey:'platform:carrier',counterpartyNameSnapshot:'中国移动',settlementAdjustment:true,relatedReceiptId:original.id,withholdingReference:reference,note:'移动结算直接代扣；净到账核对更正，不是门店再次付款'+(note?'；'+note:'')})[0];
 const before={status:row.status,actualHebaoAmount:row.actualHebaoAmount,taxSettlementMode:row.taxSettlementMode||'',withholdingConfirmed:row.withholdingConfirmed===true};
 row.taxSettlementMode=flow.MODE;row.taxSettlementRule=flow.VERSION;row.withholdingConfirmed=true;row.actualWithheldTaxAmount=plan.tax;row.actualHebaoAmount=plan.netReceivable;row.taxAmount=plan.tax;row.withholdingReference=reference;row.withholdingReceiptId=entry.id;row.withheldAt=at;row.withheldBy=who.id;
 row.events.push({type:'和包代扣税核实及净到账更正',by:who.id,at,before,grossAmount:plan.gross,taxAmount:plan.tax,netAmount:plan.netReceivable,originalReceiptId:original.id,withholdingReceiptId:entry.id,withholdingReference:reference,note});
 complete(row);c.audit(store,who,'business-change:withholding-confirm',{id:row.id,before,originalReceiptId:original.id,withholdingReceiptId:entry.id,gross:plan.gross,tax:plan.tax,net:plan.netReceivable,withholdingReference:reference,note});
 return {...row,metrics:metrics(row)};
}

function listWithPersonalPerformance(store,user,query){
 const who=actor(store,user),result=list(store,who,query),groups=new Map();
 for(const row of rows(store)){
  if(who.roleCode!=='owner'&&row.employeeId!==who.id)continue;
  const value=metrics(row);if(!value.realized)continue;
  const key=row.employeeId||row.operatorId,entry=groups.get(key)||{employeeId:key,employeeName:row.employeeName||row.operatorName,count:0,gross:0,tax:0,netIncrease:0};
  entry.count++;entry.gross+=value.gross;entry.tax+=value.tax;entry.netIncrease+=value.netIncrease;groups.set(key,entry);
 }
 return {...result,performance:[...groups.values()].map(entry=>({...entry,gross:c.round(entry.gross),tax:c.round(entry.tax),netIncrease:c.round(entry.netIncrease),commissionAmount:null}))};
}
function taxPayWithReconciliation(store,user,payload){
 const result=taxPay(store,user,payload);
 require('./business-reconciliation').register(store,owner(store,user),'expenses',result.taxExpenseId);
 return result;
}
function settleBossAdvance(store,user,payload){
 const who=owner(store,user),row=find(store,payload.id);
 if(row.refundMethod!=='boss-wechat'||row.bossAdvanceStatus!=='门店待结算')throw new c.HttpError(409,'本单没有待结算的老板微信垫付款');
 if(payload.actualPaid!==true||money(payload.amount,'垫付结算金额')!==money(row.bossAdvanceAmount))throw new c.HttpError(409,'须核对实际偿付老板的金额');
 const accountId=text(payload.paymentAccountId,'门店付款账户',100);
 const vault=cash(store),account=accountId===vault.id?vault:storeWallet(store,accountId,'微信');
 if(account.channel==='微信'&&!['门店微信','信号机微信'].includes(account.name))throw new c.HttpError(409,'须选择门店付款账户');
 const reference=uniqueReference(store,payload.reference),at=c.now();
 const part={id:c.id('PP'),...accounts.resolve(store,{paymentAccountId:account.id,account:account.channel}),amount:row.bossAdvanceAmount,reference};
 const receipt=accounts.record(store,who,'business_change_boss_reimbursement',row.id,[part],-1,{businessChangeId:row.id,counterpartyNameSnapshot:who.name})[0];
 row.bossAdvanceStatus='已结算';row.bossAdvanceSettledAt=at;row.bossAdvanceSettlementReceiptId=receipt.id;row.bossAdvanceSettlementReference=reference;
 if(row.refundStatus==='已付'&&row.hebaoStatus==='已收')row.status='资金已核清';
 row.events.push({type:'老板垫付已由门店偿付',by:who.id,at,amount:row.bossAdvanceAmount,receiptId:receipt.id,reference});
 c.audit(store,who,'business-change:boss-reimbursement',{id:row.id,receiptId:receipt.id,amount:row.bossAdvanceAmount});
 return {...row,metrics:metrics(row)};
}
module.exports={TAX_RULE,taxCents,options,candidates,list:listWithPersonalPerformance,create:createWithoutSource,submit,review,refund,receive:receiveWithActualChannel,taxPay:taxPayWithReconciliation,settleBossAdvance,withholdTax,metrics};
