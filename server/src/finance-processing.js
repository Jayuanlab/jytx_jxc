'use strict';
const c=require('./common'),master=require('./master-data'),ownership=require('./account-ownership');
function list(store,user,preparedLedger){
 const who=master.actor(store,user),owner=who.roleCode==='owner',tasks=[],seen=new Set(),warnings=[];
 const name=id=>(store.users||[]).find(u=>u.id===id)?.name||'待核实人员';
 function add(row){if(seen.has(row.id))return;seen.add(row.id);tasks.push(row);}
 const responsibility=require('./sale-fund-responsibility').list(store,who),pendingHandovers=(store.cashHandovers||[]).filter(h=>h.status==='待接收人确认');
 for(const h of store.cashHandovers||[]){if(h.status!=='待接收人确认'&&h.status!=='金额有异议')continue;if(!owner&&h.senderId!==who.id&&h.recipientId!==who.id)continue;
  const mine=h.recipientId===who.id,pending=h.status==='待接收人确认';
  add({id:'cash:'+h.id,group:mine&&pending?'action':'waiting',kind:'cash_handover',title:mine?'现金交接待我核收':h.senderId===who.id?'我交出的现金待确认':'员工现金交接待处理',amount:h.amount,party:h.sender+' → '+h.recipient,status:h.status,at:h.createdAt,sourceNo:h.id,detail:pending?'接收人未确认，仍挂交款人；不计接收人已收，不重复计收入。':'金额存在异议，仍需按原交接核实。',action:mine&&pending?'核对并处理':'查看交接',href:'/cash-handover?handover='+encodeURIComponent(h.id)});
 }
 for(const t of store.fundTransfers||[]){if(!['待收款人确认','到账有异议'].includes(t.status)||(!owner&&t.fromId!==who.id&&t.toId!==who.id&&t.operatorId!==who.id))continue;const mine=t.toId===who.id;
  add({id:'transfer:'+t.id,group:mine&&t.status==='待收款人确认'?'action':'waiting',kind:'internal_transfer',title:mine?'内部转款待我确认':'内部转款待对方处理',amount:t.amount,party:t.from+' → '+t.to,status:t.status,at:t.createdAt,sourceNo:t.id,detail:'实际收款人亲自核实后确认；未确认不计已到账。',action:mine?'核对转款':'查看进度',href:'/funds?transfer='+encodeURIComponent(t.id)});
 }
 for(const r of responsibility.rows){if(!(r.pendingAmount>0||r.amount==null))continue;
  const reserved=pendingHandovers.flatMap(h=>h.saleAllocations||[]).filter(a=>a.orderId===r.orderId&&a.partId===r.partId).reduce((n,a)=>n+Number(a.amount||0),0);
  if(r.cash&&reserved>=r.pendingAmount&&r.pendingAmount>0)continue;
  const mine=r.canReceive===true;
  add({id:'sale:'+r.key,group:mine?'action':'waiting',kind:'sale_responsibility',title:mine?'销售款待我实际核收':r.operatorId===who.id?'本人业务待交／待核':'员工业务待交／待核',amount:r.pendingAmount,party:r.operator+' → '+r.targetHolder,status:r.statusLabel,at:r.createdAt,sourceNo:r.displayNo,detail:(r.goods||[]).map(g=>g.name+' × '+g.quantity).join('；')+'。交款、顾客付款声明与实际核收分别记录。',action:mine?'核收原单':'处理原单',href:r.href});
 }
 for(const r of store.paymentRequests||[]){const view=ownership.project(store,r),mayVerify=ownership.canVerify(store,who,r);if(!owner&&r.applicantId!==who.id&&!mayVerify)continue;
  const current=r.policy==='normal_business_then_owner_reconciliation_v120';if(current?r.executionStatus!=='awaiting_holder':r.status!=='待老板确认')continue;
  const mine=current?mayVerify:owner;
  add({id:'payment:'+r.id,group:mine?'action':'waiting',kind:'payment_request',title:mine?'付款请求待我办理':'付款请求待持有人办理',amount:r.amount,party:(r.applicantName||name(r.applicantId))+' → '+(view.accountScope==='store'?(view.displayName||view.accountName||'门店账户')+' / '+(view.custodyLabel||'门店'):view.accountOwnerName||name(view.accountOwnerId)),status:r.status,at:r.createdAt,sourceNo:r.displayNo||r.id,detail:r.counterparty+'；'+r.note+'。未实际支付前不计已付。',action:mine?'办理本笔付款':'查看付款进度',href:current?'/business-reconciliation?request='+encodeURIComponent(r.id):'/payment-requests?legacy=1'});
 }
 const money=require('./money-verifications').list(store,who);
 for(const r of money.rows){if(r.verificationNotRequired||r.verifiedByHolder||r.verifiedByOwner||r.verifiedByStore||!(r.unverifiedAmount>0)||r.status==='reclassified')continue;const receipt=(store.receipts||[]).find(p=>p.id===r.receiptId);if(!receipt||receipt.kind==='sale'||!r.canVerify)continue;
  add({id:'verify:'+r.receiptId,group:'action',kind:'money_verification',title:r.direction==='pay'?'付款登记待本人核实':'收款登记待本人核实',amount:r.unverifiedAmount,party:r.accountName,status:r.statusLabel,at:r.createdAt,sourceNo:r.sourceId,detail:'核实实际账户收付，不再生成一笔付款或收款。',action:'核实本笔记录',href:'/business-reconciliation?id=money-'+encodeURIComponent(r.receiptId)+'#money-'+encodeURIComponent(r.receiptId)});
 }
 if(owner){const data=preparedLedger||require('./fund-party-ledgers').build(store,who);warnings.push(...data.warnings);
  for(const account of data.accounts.filter(a=>!['mine','wallet'].includes(a.kind)))for(const r of account.rows){if(!['unpaid','unreceived'].includes(r.bucket)||r.kind==='sale_due'||!(r.amount>0))continue;
   add({id:'settle:'+r.id,group:'settlement',kind:r.kind,title:r.bucket==='unpaid'?'往来待付款／结算':'往来应收待到账',amount:r.amount,party:account.name,status:r.state,at:r.at,sourceNo:r.sourceNo,detail:r.label+'；'+(r.note||'应收应付不等于实际收付；按原单核实后结算。'),action:'查看原单并结算',href:r.detailHref||r.sourceHref||r.href});
  }
 }
 tasks.sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.id.localeCompare(b.id));
 return {asOf:c.now(),userId:who.id,name:who.name,owner,personalOnly:!owner,tasks,warnings,notice:'待处理事项之间可能关联同一笔资金，金额不可相加为余额。只有实际接收人确认后才转移交接责任。'};
}
module.exports={list};
