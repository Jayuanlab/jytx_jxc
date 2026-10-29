'use strict';
const MAX_CENTS=100_000_000_000;
function cents(value,label){const raw=String(value??'').trim();if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw))throw new Error(label+'须为非负金额，最多两位小数');const [whole,fraction='']=raw.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n>MAX_CENTS)throw new Error(label+'超出范围');return n;}
function calculate({hebaoReceived,storeTopup='0',inventoryCost}){const W=cents(hebaoReceived,'和包到账'),T=cents(storeTopup,'门店承担充值'),C=cents(inventoryCost,'库存成本');if(!W||T>W)throw new Error('和包到账须大于零，充值不得超过到账');const tax=Math.floor((W*25+500)/1000),margin=W-C-T-tax;return {saleOrderAmountCents:W,hebaoReceivedCents:W,storeTopupCents:T,inventoryCostCents:C,activityTaxCents:tax,commissionBaseCents:margin,commissionStatus:margin>0?'calculated_preview':'requires_review'};}
module.exports={calculate};
