'use strict';
// Asset ownership, physical custody and verification are separate facts.
const POLICY='store-custody-v1';
const cashNames=new Set(['现金库','门店现金']);
const walletNames=new Set(['信号机微信','门店微信']);
const storeHebaoNames=new Set(['和包商户']);
function channel(row){return row?.account||row?.channel||'';}
function profile(store,row={}){
 const id=row.paymentAccountId||row.accountId||row.id;
 return (store.paymentAccounts||[]).find(a=>id&&a.id===id)||null;
}
function isStoreAccount(store,row={}){
 const p=profile(store,row),name=p?.name||row.accountName||row.name||'';
 if(p?.accountScope==='store'||row.accountScope==='store')return true;
 if(row.paymentAccountId==='SYSTEM-CASH-VAULT'||row.id==='SYSTEM-CASH-VAULT')return true;
 if(cashNames.has(name)||walletNames.has(name)||storeHebaoNames.has(name))return true;
 // Cash collected in normal store business remains store property even while
 // an employee temporarily keeps it. A handover changes custody separately.
 return channel(row)==='现金'||p?.channel==='现金';
}
function isStoreCash(store,row){return isStoreAccount(store,row)&&channel(profile(store,row)||row)==='现金';}
function uniqueOwner(store){const rows=(store.users||[]).filter(u=>u.status==='active'&&u.roleCode==='owner'&&!u.assistantCustomerOnly);return rows.length===1?rows[0]:null;}
function verifierId(store,row={}){
 const p=profile(store,row);
 if(!isStoreAccount(store,row))return row.accountOwnerId||p?.ownerId||row.ownerId||'';
 return p?.verifierId||row.accountVerifierId||row.verifierId||p?.ownerId||uniqueOwner(store)?.id||'';
}
function canVerify(store,user,row){
 const who=(store.users||[]).find(u=>u.id===user?.id&&u.status==='active');
 if(!who||who.assistantCustomerOnly||who.roleCode!==user.roleCode)return false;
 if(!isStoreAccount(store,row))return (row.accountOwnerId||profile(store,row)?.ownerId||row.ownerId)===who.id;
 if(channel(profile(store,row)||row)==='和包商户')return who.roleCode==='owner'&&verifierId(store,row)===who.id;
 // Verifying a store receipt never acknowledges personal receipt of money.
 return ['owner','manager','employee','warehouse'].includes(who.roleCode)&&require('./common').capabilities(who).paymentRegister===true;
}
function isPersonallyHeld(store,row,userId){return !isStoreAccount(store,row)&&(row.accountOwnerId||row.ownerId||'')===userId;}
function confirmedCashHandover(row,recipientId){const n=Number(row?.actualAmount);return !!row&&row.status==='已确认收到'&&!!row.recipientId&&(!recipientId||row.recipientId===recipientId)&&row.confirmedBy===row.recipientId&&row.senderId!==row.recipientId&&!!row.confirmedAt&&Number.isFinite(n)&&n>0&&Math.round(n*100)===Math.round(Number(row.amount)*100)&&(row.events||[]).some(e=>e.type==='接收人确认'&&e.by===row.recipientId&&Math.round(Number(e.amount)*100)===Math.round(n*100));}
function project(store,row={}){
 if(!isStoreAccount(store,row))return {...row};
 const cash=isStoreCash(store,row),employee=cash&&row.cashDestination==='employee';
 const verifier=verifierId(store,row),person=(store.users||[]).find(u=>u.id===verifier);
 const custodian=employee?(row.custodianId||row.accountOwnerId||row.operatorId||''):'',custodianPerson=(store.users||[]).find(u=>u.id===custodian);
 return {...row,accountScope:'store',accountOwnerId:'',accountOwnerName:'门店',
  displayName:cash?'门店现金':walletNames.has(profile(store,row)?.name||row.accountName||row.name)?'门店微信':row.displayName||row.accountName||row.name||'',
  accountVerifierId:verifier,accountVerifierName:person?.name||'',
  custodyLocation:employee?'employee-temporary':cash?'store-drawer':'store-device',
  custodyLabel:employee?'营业员暂存':cash?'门店抽屉':'门店设备',
  ...(employee?{custodianId:custodian,custodianName:custodianPerson?.name||row.custodianName||''}:{}),
  ownershipPolicy:POLICY};
}
module.exports={POLICY,profile,isStoreAccount,isStoreCash,isPersonallyHeld,project,canVerify,verifierId,confirmedCashHandover};
