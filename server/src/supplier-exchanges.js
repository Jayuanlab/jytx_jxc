'use strict';
// All mutations run inside the application's branch transaction. One exchange is
// the permanent parent of both physical movements and its net supplier balance.
const c=require('./common'),crypto=require('node:crypto');
const details=require('./inventory-details'),fifo=require('./fifo-costs'),costs=require('./supplier-costs');
const suppliers=require('./suppliers'),accounts=require('./payment-accounts'),ownership=require('./account-ownership'),warehouses=require('./warehouses');
const rows=s=>(s.supplierExchanges||=[]),money=n=>n/100;
const fail=(status,message)=>{throw new c.HttpError(status,message);};
const text=(v,label,max=500)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(400,'请填写'+label+'（最多'+max+'字）');return v.trim();};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const real=(s,u)=>require('./master-data').actor(s,u);
const isOwner=u=>u.roleCode==='owner'&&c.capabilities(u).manageUsers;
const canRead=(u,r)=>isOwner(u)||r.applicantId===u.id||c.capabilities(u).supplierView;
function get(s,u,id){const r=rows(s).find(x=>x.id===id);if(!r)fail(404,'换货单不存在');if(!canRead(u,r))fail(403,'无权查看这张换货单');return r;}
function operator(u,r){c.permit(u,'purchase');if(!isOwner(u)&&r.applicantId!==u.id)fail(403,'请由本单经办人或老板办理');}
function event(r,u,type,data={}){r.events.push({type,...data,at:c.now(),by:u.id,name:u.name});r.version++;}
function remaining(s,id){if(!id)return 0;const e=(s.supplierEntries||[]).find(x=>x.id===id);if(!e)fail(409,'差价往来记录缺失，请联系老板核查');return e.cents-(s.supplierSettlements||[]).filter(x=>!x.reversedAt&&(x.sourceId===id||x.targetId===id)).reduce((n,x)=>n+x.cents,0);}
function balance(s,r){
 const out=r.outgoing.reduce((n,x)=>n+x.valueCents,0),incoming=r.incoming.reduce((n,x)=>n+x.valueCents,0);
 const received=r.receipts.reduce((n,x)=>n+x.valueCents,0),complete=r.incoming.every(x=>x.received===x.quantity);
 const due=remaining(s,r.differenceEntryId),settlements=(s.supplierSettlements||[]).filter(x=>!x.reversedAt&&(x.sourceId===r.differenceEntryId||x.targetId===r.differenceEntryId));
 const cashIds=new Set(settlements.map(x=>x.cashId).filter(Boolean));
 // A generic supplier offset/payment is visible but cannot silently stand in for
 // this order's actual cash settlement and holder verification.
 const external=!!r.differenceEntryId&&settlements.some(x=>!['payment','refund'].includes(x.type));
 const related=(s.supplierCash||[]).filter(x=>cashIds.has(x.id)||settlements.some(y=>y.sourceId===x.sourceId||y.targetId===x.sourceId));
 const ids=new Set(related.map(x=>x.id));
 const receipts=(s.receipts||[]).filter(x=>ids.has(x.sourceId));
 const unverified=settlements.length>0&&(!receipts.length||receipts.some(x=>!(s.moneyVerifications||[]).some(v=>v.receiptId===x.id&&v.status==='verified'&&Math.abs(v.verifiedAmount)===Math.abs(x.amount))));
 const closed=!!r.handedAt&&complete&&due===0&&!external&&!unverified;
 const status=['已驳回','已撤销'].includes(r.status)?r.status:r.status==='待老板批准'?'待老板批准':!r.handedAt?'已批准待交货':!complete?'旧货已出，待收齐新货':due>0?(r.differenceCents>0?'货已收齐，差价待付':'货已收齐，差价待退'):external?'差价抵扣待核查':unverified?'差价流水待账户核实':closed?'已完成':'待核查';
 return {outgoingCents:out,incomingCents:incoming,receivedCents:received,differenceCents:incoming-out,remainingCents:due,actualCostCents:r.handedAt?r.outgoing.reduce((n,x)=>n+x.actualCostCents,0):null,valuationDifferenceCents:r.handedAt?out-r.outgoing.reduce((n,x)=>n+x.actualCostCents,0):null,goodsComplete:complete,closed,status};
}
function project(s,r,u){const b=balance(s,r),copy=structuredClone(r);if(!isOwner(u)&&!c.capabilities(u).cost&&!c.capabilities(u).supplierView){for(const line of copy.outgoing){delete line.actualCostCents;delete line.costSources;delete line.serialEvidence;}b.actualCostCents=null;b.valuationDifferenceCents=null;}return {...copy,displayNo:r.displayNo||(s.documentNumbers||[]).find(x=>x.collection==='supplierExchanges'&&x.sourceId===r.id)?.displayNo||r.id,status:b.status,balance:b,amount:money(b.incomingCents),lines:[...copy.outgoing,...copy.incoming],href:'/supplier-exchanges?id='+encodeURIComponent(r.id),permissions:{review:isOwner(u)&&r.status==='待老板批准',operate:(isOwner(u)||r.applicantId===u.id)&&!!c.capabilities(u).purchase,cancel:!r.handedAt&&(isOwner(u)||r.applicantId===u.id),settle:!!c.capabilities(u).supplierSettle}};}
function list(s,user,params=new URLSearchParams()){const u=real(s,user);c.permit(u,'purchase');const q=String(params.get('q')||'').trim().toLowerCase(),id=params.get('id');return {rows:rows(s).filter(r=>canRead(u,r)&&(!id||r.id===id)&&(!q||[r.id,r.displayNo,r.supplierName,r.applicantName,...r.outgoing.map(x=>x.productName),...r.incoming.map(x=>x.productName)].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>project(s,r,u)),isOwner:isOwner(u)};}
function options(s,user){const u=real(s,user);c.permit(u,'purchase');const base=require('./supplier-outbound-tracking').options(s,u);base.products=base.products.map(p=>{const original=(s.products||[]).find(x=>x.skuId===p.skuId)||{};return {...p,externalCode:original.externalCode||'',unit:original.unit||'件',scanCodes:[...new Set([original.barcode,...(!p.trackSerial?[original.sourceBarcode]:[]),...(original.legacyExternalCodes||[])].filter(v=>v!=null&&String(v).trim()).map(v=>String(v).trim()))]};});return {...base,warehouses:require('./warehouse-directory').list(s),isOwner:isOwner(u),accounts:accounts.list(s,u).rows.filter(x=>x.active!==false&&ownership.canVerify(s,u,{paymentAccountId:x.id})).map(x=>({id:x.id,name:x.displayName||x.name})),canSettle:!!c.capabilities(u).supplierSettle};}
function lines(s,inputs,outgoing){
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>100)fail(400,'换出和换回商品都须填写1至100行');const used=new Set(),serials=new Set();
 return inputs.map((x,i)=>{
  const p=(s.products||[]).find(p=>p.skuId===x.skuId&&p.stockManaged!==false&&p.active!==false),w=warehouses.byId(x.warehouseId);
  if(!p||!w||w.active===false)fail(409,`第${i+1}行须选择当前在用商品和仓库`);
  const key=p.skuId+'/'+w.id;if(used.has(key))fail(400,'同一商品同一仓库请合并数量');used.add(key);
  const quantity=c.quantity(x.quantity),unitPriceCents=accounts.cents(x.unitPrice,'约定单价');
  if(!unitPriceCents||!Number.isSafeInteger(unitPriceCents*quantity))fail(400,'约定单价须大于零，金额不能超出范围');
  const tracked=details.tracked(p),serialNos=x.serialNos||[];
  if(!Array.isArray(serialNos)||(!tracked&&serialNos.length)||(outgoing&&tracked&&serialNos.length!==quantity)||(!outgoing&&serialNos.length&&serialNos.length!==quantity))fail(400,'按串号商品须逐台选择完整串号；数量商品不能填串号');
  for(const no of serialNos){if(typeof no!=='string'||!/^[a-z0-9-]{5,40}$/i.test(no)||serials.has(no))fail(400,'串号无效或重复');serials.add(no);}
  return {id:c.id(outgoing?'SXO':'SXI'),skuId:p.skuId,productName:p.name,type:p.type||'',subType:p.subType||'',thirdType:p.thirdType||'',warehouseId:w.id,warehouseName:w.name,quantity,unitPriceCents,valueCents:quantity*unitPriceCents,trackSerial:tracked,serialNos:[...serialNos],...(outgoing?{}:{received:0})};
 });
}
function create(s,user,p){
 const u=real(s,user);c.permit(u,'purchase');const requestKey=text(p.requestKey,'提交标识',100),fingerprint=hash({supplierId:p.supplierId,mode:p.mode,agreement:p.agreement,outgoing:p.outgoing,incoming:p.incoming});
 const prior=rows(s).find(r=>r.applicantId===u.id&&r.requestKey===requestKey);if(prior){if(prior.fingerprint!==fingerprint)fail(409,'本次提交标识已使用，请刷新后重新填写');return {...project(s,prior,u),duplicate:true};}
 const duplicate=rows(s).find(r=>r.applicantId===u.id&&r.fingerprint===fingerprint&&!['已驳回','已撤销'].includes(r.status)&&Date.now()-Date.parse(r.createdAt)<600000);if(duplicate)return {...project(s,duplicate,u),duplicate:true};
 const supplier=(s.suppliers||[]).find(x=>x.id===p.supplierId&&x.active!==false);if(!supplier)fail(400,'请选择当前供货商');
 if(!['先交后收','当面交换'].includes(p.mode))fail(400,'请选择交货方式');
 const outgoing=lines(s,p.outgoing,true),incoming=lines(s,p.incoming,false),agreement=text(p.agreement,'换货原因及约定');
 // Current availability is rechecked again at physical handoff; application is
 // not a reservation, shipment, payment, or receipt.
 if(![outgoing,incoming].every(items=>Number.isSafeInteger(items.reduce((n,x)=>n+x.valueCents,0))))fail(400,'换货总金额超出范围');
 validateOutgoing(s,outgoing);
 const r={id:c.id('SX'),title:'供货商换货单',supplierId:supplier.id,supplierName:supplier.name,mode:p.mode,agreement,outgoing,incoming,applicantId:u.id,applicantName:u.name,createdAt:c.now(),status:'待老板批准',version:1,requestKey,fingerprint,receipts:[],operations:[],events:[]};
 rows(s).push(r);event(r,u,'提交换货申请');c.audit(s,u,'supplier-exchange:create',r.id);return project(s,r,u);
}
function action(s,user,p,kind,work){const u=real(s,user),r=get(s,u,p.id),key=text(p.requestKey,'操作标识',100),fingerprint=hash({...p,requestKey:undefined});const old=r.operations.find(x=>x.key===key);if(old){if(old.kind!==kind||old.fingerprint!==fingerprint)fail(409,'操作标识已使用，请刷新核对原单');return {...project(s,r,u),duplicate:true};}if(p.version!==r.version)fail(409,'原单状态已变化，请刷新后核对');work(u,r);r.operations.push({key,kind,fingerprint,at:c.now(),by:u.id});c.audit(s,u,'supplier-exchange:'+kind,r.id);return project(s,r,u);}
function review(s,u,p){return action(s,u,p,'review',(u,r)=>{if(!isOwner(u))fail(403,'只有老板本人可以批准换货');if(r.status!=='待老板批准')fail(409,'这张单已审核');if(typeof p.approved!=='boolean')fail(400,'请选择批准或驳回');const reason=p.approved?String(p.reason||'').slice(0,500):text(p.reason,'驳回原因');r.status=p.approved?'已批准待交货':'已驳回';r.reviewedBy=u.id;r.reviewedAt=c.now();event(r,u,p.approved?'老板批准':'老板驳回',{reason});});}
function cancel(s,u,p){return action(s,u,p,'cancel',(u,r)=>{operator(u,r);if(r.handedAt||!['待老板批准','已批准待交货'].includes(r.status))fail(409,'已交货不能直接撤销，请保留原单联系老板处理实际退回');r.status='已撤销';event(r,u,'撤销未交货申请',{reason:text(p.reason,'撤销原因')});});}
function validateOutgoing(s,items){return items.map(x=>{
 const product=s.products.find(p=>p.skuId===x.skuId&&p.active!==false&&p.stockManaged!==false),matches=s.inventory.filter(z=>z.skuId===x.skuId&&z.warehouseId===x.warehouseId);
 if(!product||matches.length!==1)fail(409,'换出商品或库存档案已变化，请核对原单');const stock=matches[0];
 if(x.trackSerial!==details.tracked(product)||stock.quantity<x.quantity)fail(409,x.productName+'库存不足或串号管理方式已变化');
 const serials=x.serialNos.map(no=>(stock.serials||[]).find(z=>z.no===no&&details.inStock(z)));
 if(x.trackSerial&&(serials.some(z=>!z)||serials.length!==x.quantity||(stock.serials||[]).filter(details.inStock).length!==stock.quantity))fail(409,x.productName+'可售串号与库存不一致，请核对');
 if(!x.trackSerial&&fifo.enabled(stock))fifo.assertStock(stock);
 return {line:x,stock,product,serials};
});}
function out(s,u,r,proof,receiver){
 if(r.handedAt||r.status!=='已批准待交货')fail(409,'须先批准，且旧货只能交出一次');
 const prepared=validateOutgoing(s,r.outgoing),at=c.now();
 for(const {line,stock,product,serials} of prepared){const value=c.round(stock.stockValue??stock.quantity*stock.costPrice);let sources=[],cost;
  if(line.trackSerial){cost=c.round(serials.reduce((n,x)=>n+Number(x.costPrice),0));line.serialEvidence=structuredClone(serials);for(const serial of serials){serial.status='供货商换出';serial.supplierExchangeId=r.id;serial.exchangedOutAt=at;}}
  else {sources=costs.take(stock,line.quantity);cost=fifo.enabled(stock)?fifo.total(sources):line.quantity===stock.quantity?value:c.round(value*line.quantity/stock.quantity);}
  if(!Number.isFinite(cost)||cost<0||cost>value)fail(409,'原库存成本异常，请先核对');
  stock.quantity-=line.quantity;stock.stockValue=c.round(value-cost);stock.costPrice=stock.quantity?Number((stock.stockValue/stock.quantity).toFixed(6)):0;
  line.actualCostCents=Math.round(cost*100);line.costSources=sources;
  s.movements.unshift({id:c.id('MV'),skuId:product.skuId,product:product.name,warehouseId:stock.warehouseId,warehouseName:stock.warehouseName,quantity:-line.quantity,cost:-cost,type:'供货商换货出库',sourceId:r.id,supplierExchangeId:r.id,exchangeLineId:line.id,operatorId:u.id,operator:u.name,createdAt:at});
 }
 r.handedAt=at;r.handedBy=u.id;r.receiver=receiver;r.handoffProof=proof;event(r,u,'旧货实际交出并出库',{proof,receiver});
}
function handoff(s,u,p){return action(s,u,p,'handoff',(u,r)=>{operator(u,r);if(r.mode!=='先交后收')fail(409,'当面交换请用“验货并完成交换”，两边库存同时入账');if(p.actual!==true)fail(400,'请确认旧货已经实际交给供货商');out(s,u,r,text(p.proof,'交货凭证'),text(p.receiver,'接货人',100));});}
function receipt(s,u,p){return action(s,u,p,'receipt',(u,r)=>{
 operator(u,r);if(p.actual!==true||!['已批准待交货'].includes(r.status))fail(409,'须先批准，并确认新货已实际验收');
 const proof=text(p.proof,'收货验收凭证'),receiver=r.handedAt?r.receiver:text(p.receiver,'供货商接货人',100);
 if(!r.handedAt&&r.mode!=='当面交换')fail(409,'先交后收须先登记旧货交出');
 if(!Array.isArray(p.items)||!p.items.length||p.items.length>100)fail(400,'请填写本次实际验收数量');
 const keys=new Set(),seen=new Set(),prepared=p.items.map(x=>{
  const line=r.incoming.find(l=>l.id===x.lineId);if(!line||keys.has(x.lineId))fail(400,'验收行不存在或重复');keys.add(x.lineId);
  const quantity=c.quantity(x.quantity);if(quantity>line.quantity-line.received)fail(409,'验收数量超过原单尚未收到的数量');
  const product=s.products.find(z=>z.skuId===line.skuId&&z.active!==false&&z.stockManaged!==false),w=warehouses.byId(line.warehouseId);if(!product||!w||w.active===false||details.tracked(product)!==line.trackSerial)fail(409,'商品或仓库状态已变化，请核对');
  const matches=s.inventory.filter(z=>z.skuId===line.skuId&&z.warehouseId===line.warehouseId);if(matches.length>1)fail(409,'库存记录重复');
  const serialNos=x.serialNos||[];if(!Array.isArray(serialNos)||(line.trackSerial?serialNos.length!==quantity:serialNos.length>0))fail(400,'请逐台填写本次验收的完整串号');
  for(const no of serialNos){if(typeof no!=='string'||!/^[a-z0-9-]{5,40}$/i.test(no)||seen.has(no)||(s.inventory||[]).some(stock=>(stock.serials||[]).some(z=>z.no===no)))fail(409,'串号重复或已存在，请核对实际新货');seen.add(no);}
  return {id:c.id('SXRI'),lineId:line.id,skuId:line.skuId,productName:line.productName,warehouseId:line.warehouseId,warehouseName:line.warehouseName,quantity,unitPriceCents:line.unitPriceCents,valueCents:quantity*line.unitPriceCents,serialNos};
 });
 if(r.mode==='当面交换'&&!r.handedAt&&r.incoming.some(l=>!prepared.some(x=>x.lineId===l.id&&x.quantity===l.quantity)))fail(409,'当面交换须一次验收全部约定新货，未收齐请使用先交后收申请');
 if(!r.handedAt)out(s,u,r,text(p.handoffProof||proof,'交货凭证'),receiver);
 const receiptId=c.id('SXR'),at=c.now();
 for(const item of prepared){const line=r.incoming.find(x=>x.id===item.lineId);let stock=s.inventory.find(x=>x.skuId===line.skuId&&x.warehouseId===line.warehouseId);
  if(!stock){stock={skuId:line.skuId,warehouseId:line.warehouseId,warehouseName:line.warehouseName,quantity:0,stockValue:0,costPrice:0,serials:[]};s.inventory.push(stock);}
  if(line.trackSerial){stock.serials||=[];for(const no of item.serialNos)stock.serials.push({no,status:'可售',costPrice:money(item.unitPriceCents),sourceType:'supplier_exchange',supplierExchangeId:r.id,supplierExchangeReceiptId:receiptId,supplierId:r.supplierId,receivedAt:at});}
  else costs.receive(stock,item.id,item.quantity,money(item.unitPriceCents),s);
  stock.quantity+=item.quantity;stock.stockValue=c.round((stock.stockValue||0)+money(item.valueCents));stock.costPrice=Number((stock.stockValue/stock.quantity).toFixed(6));line.received+=item.quantity;
  s.movements.unshift({id:c.id('MV'),skuId:line.skuId,product:line.productName,warehouseId:line.warehouseId,warehouseName:line.warehouseName,quantity:item.quantity,cost:money(item.valueCents),type:'供货商换货入库',sourceId:r.id,supplierExchangeId:r.id,supplierExchangeReceiptId:receiptId,exchangeLineId:line.id,operatorId:u.id,operator:u.name,createdAt:at});
 }
 r.receipts.push({id:receiptId,at,by:u.id,name:u.name,proof,items:prepared,valueCents:prepared.reduce((n,x)=>n+x.valueCents,0)});event(r,u,'新货实际验收入库',{receiptId,proof});
 if(r.incoming.every(x=>x.received===x.quantity)){
  r.goodsCompletedAt=at;r.differenceCents=balance(s,r).differenceCents;
  if(r.differenceCents){const e=suppliers.entry(s,{supplierId:r.supplierId,kind:r.differenceCents>0?'payable':'cash',cents:Math.abs(r.differenceCents),title:'供货商换货差价',sourceType:'supplier_exchange_difference',sourceId:r.id,note:r.agreement,...suppliers.stamp(u)});r.differenceEntryId=e.id;}
  event(r,u,'新货已收齐',{differenceCents:r.differenceCents});
 }
});}
function settle(s,u,p){return action(s,u,p,'settle',(u,r)=>{
 c.permit(u,'supplierSettle');const b=balance(s,r);if(!b.goodsComplete||!r.handedAt||!r.differenceEntryId||b.remainingCents<=0)fail(409,'请核对本单尚未结清的差价');
 if(p.actual!==true)fail(400,'请确认实际收付款并核实账户流水');
 const value=accounts.cents(p.amount,'实际差价'),account=accounts.resolve(s,{paymentAccountId:text(p.paymentAccountId,'实际账户',100)}),reference=text(p.reference,'实际流水或现金凭证',100);
 if(value<=0||value>b.remainingCents)fail(409,'实付或实退金额超过本单未结差价');if(!ownership.canVerify(s,u,account))fail(403,'请由当前账户有权核实人确认实际收付款');
 const payload={supplierId:r.supplierId,amount:money(value),payments:[{paymentAccountId:account.paymentAccountId,amount:money(value),reference}],reference,note:'供货商换货差价 '+r.id,date:c.day()};
 const result=r.differenceCents>0?suppliers.payment(s,u,{...payload,allocations:[{targetId:r.differenceEntryId,amount:money(value)}]},{supplierExchangeId:r.id}):suppliers.refund(s,u,{...payload,sourceId:r.differenceEntryId},{supplierExchangeId:r.id});
 const cash=result.cash||result,records=s.receipts.filter(x=>x.sourceId===cash.id),at=c.now();cash.supplierExchangeId=r.id;
 for(const rc of records){rc.supplierExchangeId=r.id;(s.moneyVerifications||=[]).push({id:c.id('MVF'),receiptId:rc.id,accountOwnerId:rc.accountOwnerId||'',accountScope:rc.accountScope,reportedAmount:Math.abs(rc.amount),verifiedAmount:Math.abs(rc.amount),status:'verified',version:1,updatedAt:at,events:[{by:u.id,name:u.name,at,decision:'verify',verifiedAmount:Math.abs(rc.amount),evidence:reference,note:'供货商换货差价，当前有权核实人核对实际账户',verificationScope:rc.accountScope,verifierId:u.id,method:'人工核实账户流水'}]});}
 event(r,u,r.differenceCents>0?'实际补付差价并核实':'实际收到退款并核实',{cashId:cash.id,valueCents:value,reference});
});}
function followup(s,u,p){return action(s,u,p,'followup',(u,r)=>{operator(u,r);if(!r.handedAt||balance(s,r).closed)fail(409,'仅未闭合换货单需要跟进');event(r,u,'换货跟进',{note:text(p.note,'跟进结果')});});}
function totals(s){const all=rows(s).filter(r=>r.handedAt);return {open:all.filter(r=>!balance(s,r).closed).length,unclosedOutgoingCostCents:all.filter(r=>!balance(s,r).goodsComplete).reduce((n,r)=>n+balance(s,r).actualCostCents,0),partiallyReceivedValueCents:all.filter(r=>!balance(s,r).goodsComplete).reduce((n,r)=>n+balance(s,r).receivedCents,0),valuationDifferenceCents:all.filter(r=>balance(s,r).goodsComplete).reduce((n,r)=>n+balance(s,r).valuationDifferenceCents,0),scope:'未收齐原单的换出账面成本与已收货金额分别展示，不相加当作在外资产；换货估值差额单列，不作为销售毛利'};}
module.exports={options,list,create,review,cancel,handoff,receipt,settle,followup,project,balance,totals};
