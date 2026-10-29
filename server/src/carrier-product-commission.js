'use strict';
const c=require('./common'),policy=require('./carrier-product-commission-policy.json');
function catalog(store,user){
 require('./business-options').list(store,user);
 return {id:policy.id,revision:policy.revision,sourceName:policy.sourceName,sourceSha256:policy.sourceSha256,sourceSheet:policy.sourceSheet,applicability:policy.applicability,returnRule:policy.returnRuleConfirmedByUser,products:structuredClone(policy.products)};
}
function plan(id,day,business){
 if(!id||id==='__unlisted__')return null;
 if(business.type!=='other')throw new c.HttpError(400,'此清单适用于具体新业务产品，不能作为新开卡、补卡或终端合约的通用酬金');
 const product=policy.products.find(p=>p.id===id);
 if(!product)throw new c.HttpError(400,'所选酬金产品不存在，请刷新后按实际办理产品重新选择');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw new c.HttpError(400,'办理日期不正确');
 const snapshot={...structuredClone(product),policyId:policy.id,policyRevision:policy.revision,sourceName:policy.sourceName,sourceSha256:policy.sourceSha256,sourceSheet:policy.sourceSheet,selectedAt:c.now(),basis:'顾客业务办理后预计获得的移动基础酬金；不代表移动确认、实际到账或营业员工资提成'};
 const schedule=Array.from({length:product.terms},(_,i)=>({month:require('./carrier-rentals').monthAfter(day,1+i),expected:product.periodAmount,confirmed:null,received:0,statementNo:'',events:[]}));
 return {product:snapshot,rule:{id:policy.id+'/'+product.id,revision:policy.revision,typeId:business.businessTypeId||business.type,subTypeId:business.businessSubTypeId||business.subType,productId:product.id,productName:product.name,kind:product.terms===4?'four':'once-next-month',label:product.terms===4?'次月起4个月返还':'次月一次性返清',startOffset:1,monthlyAmounts:schedule.map(p=>p.expected),expectedTotal:product.expectedTotal,sourceName:policy.sourceName,sourceSha256:policy.sourceSha256,sourceSheet:policy.sourceSheet,sourceRange:product.sourceRange},schedule,status:'已匹配'};
}
module.exports={catalog,plan};
