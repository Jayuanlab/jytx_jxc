'use strict';
const c=require('./common');
const saleReceipt=require('./sale-receipt');
const clean=(value,max=120)=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
function get(store,user,receiptId,branch={}){
 const id=clean(receiptId,160);
 if(!id)throw new c.HttpError(400,'请指定要打印的收款单');
 const receipt=(store.receipts||[]).find(row=>row.id===id);
 if(!receipt||receipt.kind!=='sale'||Number(receipt.amount)<=0||receipt.isReversal||receipt.redReversedBy)throw new c.HttpError(404,'未找到可打印的销售收款单');
 if((store.receipts||[]).some(row=>row.originalReceiptId===id&&(row.isReversal||/_red$/.test(row.kind||''))))throw new c.HttpError(409,'这笔收款已经冲回，请核对原单');
 const sale=saleReceipt.get(store,user,receipt.sourceId,branch);
 const isTest=require('./source-annotations').entries(store).some(row=>row.orderId===receipt.sourceId&&row.test);
 if(isTest)throw new c.HttpError(409,'测试业务不能打印正式收款单');
 const number=(store.documentNumbers||[]).find(row=>row.collection==='receipts'&&row.sourceId===id)?.displayNo||receipt.displayNo||id;
 return {schemaVersion:1,copy:'payment-customer',shop:sale.shop,number:clean(number),saleNumber:sale.order.number,receivedAt:clean(receipt.transactionDate||receipt.createdAt,50),customer:clean((store.sales||[]).find(row=>row.id===receipt.sourceId)?.customerName,80),items:sale.items.map(({name,category,productCode,serialNo,quantity,unit})=>({name,category,productCode,serialNo,quantity,unit})),amount:c.round(Number(receipt.amount)),account:clean(receipt.accountName||receipt.account,80),reference:clean(receipt.reference,100)};
}
module.exports={get};
