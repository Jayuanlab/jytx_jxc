'use strict';

const purposeNames={operating:'日常经营',inventory:'进货库存',customer:'顾客业务',internal:'内部往来'};
const short=(value,max=140)=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
const first=(...values)=>values.map(value=>short(value)).find(Boolean)||'';
const money=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const mobileSubtype={up:'升档',new:'新办',renew:'续约',change:'变更'};
const mobilePurpose=row=>[first(row.typeName,row.businessName),mobileSubtype[row.subType]||'',first(row.note)].filter(Boolean).join(' · ');
const expensePurpose=note=>/^(快递费|运费|门店耗材|水电费|其他日常费用)(?:：|$)/.test(short(note))?short(note):'';

function itemNames(row){return (row.items||row.rows||[]).map(item=>first(item.name,item.product,item.productName,item.skuName)).filter(Boolean).slice(0,3).join('、');}

function make(collection,row,label){
 const itemText=itemNames(row);
 const names={
  expenses:[first(row.counterparty,row.payeeName),expensePurpose(row.note)],
  otherIncome:[first(row.counterparty,row.payerName),first(row.note,row.type,purposeNames[row.businessPurpose])],
  carrierServices:[first(row.customerMask,row.customerName),mobilePurpose(row)],
  cardBusinesses:[first(row.customerMask,row.customerName),mobilePurpose(row)],
  sales:[first(row.customerName,row.customerMask),first(itemText,row.note)],
  purchases:[first(row.supplier,row.supplierName),first(itemText,row.note)],
  procurementPlans:[first(row.supplier,row.supplierName),first(itemText,row.note)],
  supplierCash:[first(row.supplier,row.supplierName,row.counterparty),first(row.note,row.type)],
  fundTransfers:[first(row.recipientName,row.toName),first(row.purpose,row.note)],
  cashHandovers:[first(row.recipientName,row.receiverName),first(row.purpose,row.note)],
  airFundingOrders:[first(row.accountName,row.customerMask),first(row.purpose,row.note,row.typeName)],
  airRechargeEvents:[first(row.customerMask,row.customerName),first(row.typeName,row.note)],
  govSubsidyClaims:[first(row.customerMask,row.customerName),first(row.purpose,row.note)],
  giftOrders:[first(row.customerMask,row.customerName),first(itemText,row.reason,row.note)],
  stockTransfers:[first(row.toWarehouseName,row.warehouseName),first(itemText,row.reason,row.note)],
  stocktakes:[first(row.warehouseName),first(itemText,row.note)],
  products:[first(row.name,row.product),first(row.type,row.subType)],
  suppliers:[first(row.name,row.supplier),first(row.scope,row.note)],
  paymentRequests:[first(row.counterparty,row.payeeName),first(row.purpose,row.note)]
 };
 const [object='',purpose='']=names[collection]||[first(row.counterparty,row.customerMask,row.supplier,row.name),first(row.purpose,row.note,itemText)];
 const amount=money(row.amount??row.transactionAmount??row.plannedAmount);
 const occurredAt=first(row.date,row.serviceDate,row.occurredAt,row.createdAt);
 const description=collection==='expenses'&&!purpose?short(row.note,160):'';
 return {name:short(label,40),object:short(object,100),purpose:short(purpose,160),description,amount,occurredAt,complete:!!object&&!!purpose};
}

module.exports={make};
