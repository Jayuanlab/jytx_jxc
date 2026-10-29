'use strict';
// Customer copy is an allowlist projection. Internal payment/gift/reconciliation,
// supplier/cost/notes and stored customer contact details never leave this API.
const c=require('./common');
const text=(value,max=180)=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max),money=value=>{const n=Number(value||0);if(!Number.isFinite(n)||n<0)throw new c.HttpError(409,'销售金额资料异常，请先核对原单');return c.round(n);};
function get(store,user,orderId,branch={}){
 const who=(store.users||[]).find(row=>row.id===user?.id&&row.status==='active');if(!who||user.status!=='active'||who.roleCode!==user.roleCode||who.assistantCustomerOnly||!['owner','manager','employee','warehouse'].includes(who.roleCode))throw new c.HttpError(403,'请使用当前门店有效员工身份查看销售凭证');
 const id=text(orderId,160);if(!id)throw new c.HttpError(400,'请指定要打印的原销售单');
 const sale=(store.sales||[]).filter(row=>who.roleCode==='owner'||row.operatorId===who.id||row.salespersonId===who.id).find(row=>row.id===id);if(!sale)throw new c.HttpError(404,'未找到当前账号可查看的这张销售单');
 if(!Array.isArray(sale.items)||!sale.items.length)throw new c.HttpError(409,'销售单商品明细不完整，请核对原单');
 if(sale.status!=='completed'||sale.redReversedBy||sale.paymentReview?.status==='已红冲'||sale.items.some(row=>Number(row.returnedQuantity)>0)||(store.saleReturns||[]).some(row=>row.orderId===sale.id))throw new c.HttpError(409,'这张原单已有退货或作废记录，请选择正常销售单打印顾客销售凭证');
 const items=sale.items.map(row=>{const product=(store.products||[]).find(p=>p.skuId===row.skuId),quantity=Number(row.quantity),isPhone=/^(手机|智能机|智能手机|功能机|功能手机|二手机|二手手机)$/.test(text(row.type||product?.type,30));if(!Number.isSafeInteger(quantity)||quantity<1)throw new c.HttpError(409,'销售单数量资料异常');return {name:text(row.name),productCode:text(row.externalCode||row.skuId,80),category:[row.type,row.subType,row.thirdType].map(x=>text(x,40)).filter(Boolean).join(' / '),isPhone,serialNo:text(row.serialNo,80),quantity,unit:text(row.unit||product?.unit||(isPhone?'台':'件'),12),...(row.salePrice!==undefined&&row.salePrice!==null&&row.salePrice!==''?{unitPrice:money(row.salePrice)}:{}),amount:money(row.amount)};});
 // giftOrders are written only after actual stock issuance. Draft/approval
 // requests are separate and never establish a promised customer entitlement.
 const gifts=(sale.giftOrders||[]).filter(gift=>!gift.reversedAt&&!gift.redReversedBy&&!['cancelled','reversed','已撤销','已红冲'].includes(gift.status)).flatMap(gift=>(gift.items||[]).map(row=>({name:text(row.name),quantity:Math.max(0,(Number(row.quantity)||0)-(Number(row.returnedQuantity)||0)),unit:text(row.unit||(store.products||[]).find(p=>p.skuId===row.skuId)?.unit||'件',12)}))).filter(row=>row.name&&row.quantity>0);
 const saleNumber=(store.documentNumbers||[]).find(row=>row.collection==='sales'&&row.sourceId===sale.id)?.displayNo||sale.displayNo||sale.number||sale.id;
 const activity=sale.mobileActivityId?(store.mobileActivitySales||[]).find(row=>row.id===sale.mobileActivityId&&row.saleId===sale.id):null;
 const base={schemaVersion:1,copy:'customer',shop:{name:text(branch.name,100)},order:{id:sale.id,number:text(saleNumber),createdAt:text(sale.createdAt,50),salesperson:text(sale.salesperson||sale.operator,60)}};
 if(activity){
  if(items.length!==1||!items[0].isPhone)throw new c.HttpError(409,'活动机销售单商品资料异常，请先核对原单');
  return {...base,items:items.map(({name,category,serialNo,quantity,unit})=>({name,category,serialNo,quantity,unit,isPhone:true})),activity:{businessName:text(activity.businessName,60),customerPhone:text(activity.customerPhone,20)},gifts:[],pendingDeliveries:[]};
 }
 return {...base,items,totalAmount:money(sale.amount),gifts,pendingDeliveries:[]};
}
module.exports={get};
