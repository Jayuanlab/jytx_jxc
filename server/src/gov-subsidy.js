const c = require('./common');
const CATEGORY = {'智能机':'手机','功能机':'手机','平板':'平板','智能手表':'智能手表（手环）','智能手环':'智能手表（手环）','智能眼镜':'智能眼镜'};
const ACCOUNTS = new Set(['云闪付','银行卡','微信','支付宝','现金']);
function classify(product) { return product.govCategory || CATEGORY[product.type] || ''; }
function prepare(store,payload) {
  const mode = payload.saleMode || 'ordinary';
  if (mode === 'ordinary') return null;
  if (mode !== 'guobu') throw new c.HttpError(400,'销售通道不正确');
  if (!Array.isArray(payload.items) || payload.items.length !== 1 || Number(payload.items[0].quantity) !== 1) throw new c.HttpError(400,'国补商品必须单件单独开单；配件另开普通销售单');
  const input = payload.items[0];
  const product = store.products.find((p) => p.skuId === input.skuId);
  if (!product || product.stockManaged === false || !classify(product) || !product.trackSerial || !input.serialNo) throw new c.HttpError(400,'国补通道只允许已登记串码的符合品类实物商品');
  const grossPrice = c.money(input.salePrice,'最终成交价');
  if (grossPrice <= 0 || grossPrice > 6000) throw new c.HttpError(400,'国补商品单件最终成交价须不超过 6000 元');
  const subsidyAmount = c.money(payload.subsidyAmount,'平台核销补贴金额');
  const limit = Math.min(c.round(grossPrice * 0.15),500);
  if (subsidyAmount <= 0 || subsidyAmount > limit) throw new c.HttpError(400,'补贴金额超过成交价 15% 或单件 500 元上限');
  const platformOrderNo = c.text(payload.platformOrderNo,'国补平台交易号');
  if (platformOrderNo.length > 100 || (store.govSubsidyClaims || []).some((row) => row.platformOrderNo === platformOrderNo)) throw new c.HttpError(409,'国补平台交易号已使用或过长');
  if(payload.payments!=null||payload.paymentAccountId){const parts=require('./payment-accounts').normalize(store,payload,c.round(grossPrice-subsidyAmount));if(parts.some(part=>part.account!=='云闪付'))throw new c.HttpError(400,'国补顾客实付每笔均须为云闪付');}
  else if (payload.account !== '云闪付') throw new c.HttpError(400,'当前国补通道须登记云闪付顾客实付');
  return {platformOrderNo,category:classify(product),serialNo:input.serialNo,grossPrice,subsidyAmount,customerPaid:c.round(grossPrice-subsidyAmount),couponNo:String(payload.couponNo||'').trim().slice(0,100),invoiceNo:String(payload.invoiceNo||'').trim().slice(0,100)};
}
function recordSale(store,user,order,prepared) {
  if (!prepared) return;
  const claim = {id:c.id('GB'),orderId:order.id,...prepared,confirmed:null,received:0,refunded:0,status:'待平台结算',events:[],operatorId:user.id,createdAt:order.createdAt};
  store.govSubsidyClaims ||= [];store.govSubsidyClaims.unshift(claim);
  order.saleMode='guobu';order.subsidyClaimId=claim.id;order.subsidyAmount=prepared.subsidyAmount;order.receivedAmount=prepared.customerPaid;
  c.audit(store,user,'gov:sale',claim.id+' '+claim.platformOrderNo);
  const {notice}=require('./feishu-notices');
  notice(store,'gov-sale:'+claim.id,'国补销售',{id:order.id,summary:prepared.category+' · 售价 '+prepared.grossPrice+' 元，顾客云闪付 '+prepared.customerPaid+' 元，国补在途 '+prepared.subsidyAmount+' 元'});
}
function returnInfo(store,order,payload) {
  if (order.saleMode !== 'guobu') return null;
  if (payload.items.length !== 1 || Number(payload.items[0].quantity) !== 1 || payload.items[0].itemId !== order.items[0].id || (order.items[0].returnedQuantity||0)) throw new c.HttpError(400,'国补单按平台规则只能整单退货，不支持部分退货');
  if(order.paymentParts){if(order.paymentParts.some(part=>part.account!=='云闪付')||payload.account&&!['云闪付',order.paymentMethod].includes(payload.account))throw new c.HttpError(400,'国补退款须按原云闪付账户办理');}
  else if (payload.account !== order.paymentMethod) throw new c.HttpError(400,'顾客退款须按原收款渠道办理');
  const refundRef=c.text(payload.platformRefundRef,'国补平台退款流水号');
  const claim=(store.govSubsidyClaims||[]).find((row)=>row.id===order.subsidyClaimId);
  if(!claim)throw new c.HttpError(409,'国补台账缺失，不能直接办理退货');
  if((store.govSubsidyClaims||[]).some((row)=>row.platformRefundRef===refundRef))throw new c.HttpError(409,'平台退款流水号已登记');
  return {claim,refundRef,customerRefund:claim.customerPaid,subsidyReversal:claim.subsidyAmount};
}
function recordReturn(store,user,row,info) {
  if(!info)return;
  const {claim,refundRef,customerRefund,subsidyReversal}=info;
  claim.status=claim.received>claim.refunded?'待退回补贴':'已退货待平台冲退核对';
  claim.platformRefundRef=refundRef;claim.returnId=row.id;
  row.customerRefund=customerRefund;row.subsidyReversal=subsidyReversal;row.platformRefundRef=refundRef;
  c.audit(store,user,'gov:return',claim.id+' '+refundRef);
  const {notice}=require('./feishu-notices');
  notice(store,'gov-return:'+row.id,'国补退货',{id:row.id,summary:'顾客原路退 '+customerRefund+' 元，补贴原渠道冲退 '+subsidyReversal+' 元；平台流水 '+refundRef});
}
function claims(store,user) {
  c.permit(user,'finance');
  return (store.govSubsidyClaims||[]).map((row)=>({...row,outstanding:c.round((row.confirmed??row.subsidyAmount)-row.received),refundDue:c.round(row.received-row.refunded)}));
}
function find(store,id){const row=(store.govSubsidyClaims||[]).find((x)=>x.id===id);if(!row)throw new c.HttpError(404,'国补台账记录不存在');return row;}
function confirm(store,user,payload) {
  c.permit(user,'finance');const row=find(store,payload.id);
  if(row.returnId)throw new c.HttpError(409,'已退货国补单请先与平台核对冲退');
  if(row.confirmed!=null)throw new c.HttpError(409,'平台结算金额已确认');
  const amount=c.money(payload.amount,'平台确认补贴金额');
  if(amount>row.subsidyAmount)throw new c.HttpError(400,'确认金额超过原国补金额');
  const statementNo=c.text(payload.statementNo,'平台结算单号');
  if((store.govSubsidyClaims||[]).some((x)=>x.statementNo===statementNo))throw new c.HttpError(409,'平台结算单号已登记');
  row.confirmed=amount;row.statementNo=statementNo;row.status=amount<row.subsidyAmount?'结算差异待核对':'待到账';
  row.events.push({id:c.id('GBE'),type:'confirm',amount,reference:statementNo,operatorId:user.id,createdAt:c.now()});
  c.audit(store,user,'gov:confirm',row.id+' '+amount);
  require('./feishu-notices').notice(store,'gov-confirm:'+row.id,'国补结算确认',{id:row.id,summary:'平台确认 '+amount+' 元，单号 '+statementNo});
  return row;
}
function receive(store,user,payload) {
  c.permit(user,'finance');const row=find(store,payload.id);
  if(row.confirmed==null||row.returnId)throw new c.HttpError(409,'请先确认未退货订单的平台结算金额');
  const amount=require('./payment-accounts').cents(payload.amount,'国补实际到账金额')/100;
  if(amount<=0||c.round(row.received+amount)>row.confirmed)throw new c.HttpError(409,'到账金额超过平台已确认金额');
  const bankRef=c.text(payload.bankRef,'银行到账流水号');require('./payment-accounts').reference(store,bankRef);
  if((store.govSubsidyClaims||[]).some((x)=>x.events.some((e)=>e.reference===bankRef)))throw new c.HttpError(409,'银行流水号已登记');
  const pa=require('./payment-accounts'),paymentParts=pa.normalize(store,payload,amount);const account=paymentParts.length===1?paymentParts[0].account:'多账户';
  const event={id:c.id('GBE'),type:'receive',amount,reference:bankRef,account,paymentParts,operatorId:user.id,createdAt:c.now()};row.events.push(event);row.received=c.round(row.received+amount);row.status=row.received===row.confirmed?'已到账':'部分到账';
  const ownerId=store.users.find((u)=>u.roleCode==='owner'&&u.status==='active')?.id;
  pa.record(store,user,'gov_subsidy',event.id,paymentParts.map(part=>({...part,...(!part.accountOwnerId&&ownerId?{accountOwnerId:ownerId}:{}),...(!part.reference&&paymentParts.length===1?{reference:bankRef}:{})})));
  c.audit(store,user,'gov:receive',row.id+' '+amount);
  require('./feishu-notices').notice(store,'gov-receive:'+event.id,'国补返款到账',{id:row.id,summary:'到账 '+amount+' 元，流水 '+bankRef,amount});
  return row;
}
function refund(store,user,payload) {
  c.permit(user,'manageUsers');const row=find(store,payload.id);
  if(!row.returnId)throw new c.HttpError(409,'原销售单尚未退货');
  const amount=require('./payment-accounts').cents(payload.amount,'退回补贴金额')/100;
  if(amount<=0||amount>c.round(row.received-row.refunded))throw new c.HttpError(409,'退回金额超过已收到的补贴余额');
  const bankRef=c.text(payload.bankRef,'补贴退回流水号');require('./payment-accounts').reference(store,bankRef);
  if((store.govSubsidyClaims||[]).some((x)=>x.events.some((e)=>e.reference===bankRef)))throw new c.HttpError(409,'退回流水号已登记');
  const pa=require('./payment-accounts'),sourceIds=new Set(row.events.filter(e=>e.type==='receive').map(e=>e.id)),originals=store.receipts.filter(r=>r.kind==='gov_subsidy'&&sourceIds.has(r.sourceId));
  const paymentParts=row.events.some(e=>e.type==='receive'&&e.paymentParts)?pa.originalParts(store,originals,amount,payload.refundPayments??payload.payments):pa.normalize(store,payload,amount);const account=paymentParts.length===1?paymentParts[0].account:'多账户';
  const event={id:c.id('GBE'),type:'refund',amount,reference:bankRef,account,paymentParts,operatorId:user.id,createdAt:c.now()};row.events.push(event);row.refunded=c.round(row.refunded+amount);row.status=row.refunded===row.received?'已退回补贴':'部分退回补贴';
  const ownerId=store.users.find((u)=>u.roleCode==='owner'&&u.status==='active')?.id;
  pa.record(store,user,'gov_subsidy_refund',event.id,paymentParts,-1);
  c.audit(store,user,'gov:refund',row.id+' '+amount);
  require('./feishu-notices').notice(store,'gov-refund:'+event.id,'国补补贴退回',{id:row.id,summary:'原渠道退回 '+amount+' 元，流水 '+bankRef,amount});
  return row;
}
module.exports={CATEGORY,classify,prepare,recordSale,returnInfo,recordReturn,claims,confirm,receive,refund};
