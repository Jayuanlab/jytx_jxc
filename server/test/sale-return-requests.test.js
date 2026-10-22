'use strict';
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../src/common'),erp=require('../src/erp'),cash=require('../src/sale-payments'),exchanges=require('../src/sale-exchanges'),requests=require('../src/sale-return-requests'),red=require('../src/red-reversals');
const owner={id:'boss',name:'测试老板',roleCode:'owner',status:'active'};
const staff={id:'staff',name:'测试营业员',roleCode:'employee',status:'active',permissions:['sale:create','sale:return','red:request']};
const manager={id:'manager',name:'测试店长',roleCode:'manager',status:'active',permissions:['red:review'],capabilityOverrides:{redReview:true}};
const other={...staff,id:'other',name:'其他营业员'};
function seed(){
 const s=c.initialize({users:structuredClone([owner,staff,manager,other]),products:[{skuId:'old',name:'原手机',type:'智能手机',warehouseId:'wh-a',trackSerial:true,stockManaged:true,salePrice:200},{skuId:'next',name:'新手机',type:'智能手机',warehouseId:'wh-a',trackSerial:true,stockManaged:true,salePrice:300}],inventory:[{skuId:'old',warehouseId:'wh-a',quantity:0,stockValue:0,serials:[]},{skuId:'next',warehouseId:'wh-a',quantity:0,stockValue:0,serials:[]}],suppliers:[{id:'sup',name:'模拟供货商'}]});
 erp.purchase(s,owner,{supplierId:'sup',items:[{skuId:'old',quantity:1,costPrice:100,serials:['869000000001111']},{skuId:'next',quantity:1,costPrice:150,serials:['869000000002222']}]});
 const result=erp.sale(s,staff,{items:[{skuId:'old',quantity:1,serialNo:'869000000001111',salePrice:200}],account:'现金',cashDrawerConfirmed:true});
 cash.confirm(s,owner,{orderId:result.id,actualAmount:200});return {s,order:s.sales.find(row=>row.id===result.id)};
}
function returnBody(order,more={}){return {orderId:order.id,items:[{itemId:order.items[0].id,quantity:1}],reason:'顾客确认退回此台手机',account:'现金',...more};}
function exchangeBody(order,price=300,more={}){return {orderId:order.id,returns:[{itemId:order.items[0].id,quantity:1}],items:[{skuId:'next',serialNo:'869000000002222',quantity:1,salePrice:price}],reason:'顾客选择更换另一款手机',account:'现金',cashDrawerConfirmed:true,...more};}
function business(s){const copy=structuredClone(s);delete copy.saleReturnRequests;delete copy.operationLogs;return JSON.stringify(copy);}
function approve(s,row,more={}){return requests.review(s,owner,{id:row.id,decision:'approve',note:'核对实物与收付款无误',...more});}
function reject(s,row){return requests.review(s,owner,{id:row.id,decision:'reject',note:'核实申请不予办理'});}

test('员工退货只提交待老板审核单，库存、款项和提成全部保留',()=>{
 const {s,order}=seed(),before=business(s),row=requests.request(s,staff,returnBody(order,{approved:true,refundAmount:9999,redReversal:true,paymentCredit:9999,status:'已退货'}));
 assert.equal(row.status,'待老板审核');assert.equal(row.businessApplied,false);assert.equal(row.amount,200);assert.equal(row.refundAmount,200);assert.equal(row.requesterName,staff.name);assert.equal(row.canReview,false);assert.equal(business(s),before);
 assert.equal(row.payload.refundAmount,undefined);assert.equal(row.payload.redReversal,undefined);assert.equal(row.payload.paymentCredit,undefined);assert.equal(s.saleReturns.length,0);assert.equal(s.inventory[0].serials[0].status,'已售');
 const result=approve(s,row);assert.equal(result.status,'已退货');assert.equal(result.businessApplied,true);assert.equal(result.reviewerName,owner.name);assert.equal(s.saleReturns.length,1);assert.equal(s.saleReturns[0].requestId,row.id);assert.equal(s.inventory[0].serials[0].status,'可售');assert.equal(s.inventory[0].quantity,1);assert.equal(s.receipts.reduce((n,r)=>n+r.amount,0),0);
 const applied=JSON.stringify(s);assert.throws(()=>approve(s,row),{statusCode:409});assert.equal(JSON.stringify(s),applied);
});

test('旧直接退货与换货入口对员工和店长均不生效，内部红冲标志不可绕过',()=>{
 const {s,order}=seed();for(const actor of [staff,manager,{...staff,capabilityOverrides:{redReview:true,returnSale:true}}]){
  const before=JSON.stringify(s);assert.throws(()=>erp.returnSale(s,actor,returnBody(order),{redReversal:true,refundAmount:0}),{statusCode:403});assert.equal(JSON.stringify(s),before);
  assert.throws(()=>exchanges.exchange(s,actor,exchangeBody(order)),{statusCode:403});assert.equal(JSON.stringify(s),before);
 }
});

test('退换货审核仅允许当前有效老板本人，权限覆盖、停用和顾客标记都不能提升',()=>{
 const {s,order}=seed(),row=requests.request(s,staff,returnBody(order));
 const actors=[staff,manager,{...staff,roleCode:'owner'},{...owner,status:'inactive'},{...owner,assistantCustomerOnly:true},{...owner,id:'unregistered-owner'}];
 for(const actor of actors){const before=JSON.stringify(s);assert.throws(()=>requests.review(s,actor,{id:row.id,decision:'approve',note:'试图未经老板审批'}),{statusCode:403});assert.equal(JSON.stringify(s),before);}
 s.users[0].status='inactive';assert.throws(()=>approve(s,row),{statusCode:403});s.users[0].status='active';assert.equal(approve(s,row).status,'已退货');
});

test('员工不能申请他人销售单，店长可按既有全员销售范围申请但不能批准',()=>{
 const {s,order}=seed(),before=JSON.stringify(s);assert.throws(()=>requests.request(s,other,returnBody(order)),{statusCode:403});assert.equal(JSON.stringify(s),before);
 const row=requests.request(s,manager,returnBody(order));assert.equal(row.requesterId,manager.id);assert.throws(()=>requests.review(s,manager,{id:row.id,decision:'approve',note:'店长不能代替老板'}),{statusCode:403});assert.equal(row.status,'待老板审核');assert.equal(approve(s,row).status,'已退货');
});

test('待审列表老板看全店，员工只见本人且不暴露源单指纹',()=>{
 const {s,order}=seed(),row=requests.request(s,staff,returnBody(order));s.saleReturnRequests.push({...s.saleReturnRequests[0],id:'FOREIGN',requesterId:other.id,requesterName:other.name});
 assert.equal(requests.list(s,staff).length,1);assert.equal(requests.list(s,staff)[0].id,row.id);assert.equal(requests.list(s,staff)[0].sourceFingerprint,undefined);assert.equal(requests.list(s,owner).length,2);assert.equal(requests.list(s,owner)[0].canReview,true);
 assert.throws(()=>requests.list(s,{...staff,assistantCustomerOnly:true}),{statusCode:403});
});

test('老板拒绝申请只改审核记录，即使原单已变化仍能驳回',()=>{
 const {s,order}=seed(),row=requests.request(s,staff,returnBody(order));order.note='老板核实原单说明已有变化';const before=business(s),result=reject(s,row);
 assert.equal(result.status,'已驳回');assert.equal(result.businessApplied,false);assert.equal(business(s),before);assert.equal(s.saleReturns.length,0);
 const again=requests.request(s,staff,returnBody(order));assert.equal(again.status,'待老板审核');
});

test('申请验证退货明细、数量、账户和串码，不留下半张业务单',()=>{
 const {s,order}=seed();for(const payload of [returnBody(order,{items:[]}),returnBody(order,{items:[{itemId:order.items[0].id,quantity:2}]}),returnBody(order,{items:[{itemId:order.items[0].id,quantity:1},{itemId:order.items[0].id,quantity:1}]}),returnBody(order,{account:'其他账户'}),returnBody(order,{items:[{itemId:'missing',quantity:1}]})]){
  const before=JSON.stringify(s);assert.throws(()=>requests.request(s,staff,payload),error=>[400,404,409].includes(error.statusCode));assert.equal(JSON.stringify(s),before);
 }
 s.inventory[0].serials[0].status='可售';const before=JSON.stringify(s);assert.throws(()=>requests.request(s,staff,returnBody(order)),{statusCode:409});assert.equal(JSON.stringify(s),before);
});

test('未确认到账的单据不能申请普通退货，可提交误开单红冲供老板审核',()=>{
 const {s,order}=seed();order.paymentReview.status='有异议';const before=JSON.stringify(s);assert.throws(()=>requests.request(s,staff,returnBody(order)),{statusCode:409});assert.equal(JSON.stringify(s),before);
 const row=red.request(s,staff,{kind:'sale',sourceId:order.id,reason:'核对后发现误开单没有实际销售'});assert.equal(row.status,'待老板审核');assert.equal(s.inventory[0].serials[0].status,'已售');
});

test('老板批准前复验原单与收款变化，冲突失败不改库存资金',()=>{
 for(const change of [(s,order)=>{order.note='提交申请后原单已更正';},(s,order)=>{s.receipts.find(row=>row.sourceId===order.id).amount=150;}]){
  const {s,order}=seed(),row=requests.request(s,staff,returnBody(order));change(s,order);const before=JSON.stringify(s);assert.throws(()=>approve(s,row),error=>error.statusCode===409&&/已变化/.test(error.message));assert.equal(JSON.stringify(s),before);assert.equal(reject(s,row).status,'已驳回');
 }
});

test('日结锁定时可以保留申请，但批准被阻断且仍可以驳回',()=>{
 const {s,order}=seed();s.dailyCloseouts.push({date:c.day(),status:'已锁定'});const row=requests.request(s,staff,returnBody(order)),before=business(s);
 assert.throws(()=>approve(s,row),error=>error.statusCode===409&&/已锁定/.test(error.message));assert.equal(business(s),before);assert.equal(row.status,'待老板审核');assert.equal(reject(s,row).status,'已驳回');assert.equal(business(s),before);
});

test('换货申请保留新旧手机库存，老板批准后只收差额并保留员工销售归属',()=>{
 const {s,order}=seed(),before=business(s),row=requests.requestExchange(s,staff,exchangeBody(order,300,{salespersonId:owner.id,refundConfirmed:true}));
 assert.equal(row.difference,100);assert.equal(row.saleAmount,300);assert.equal(row.exchangeItems[0].name,'新手机');assert.equal(row.payload.salespersonId,staff.id);assert.equal(row.payload.refundConfirmed,undefined);assert.equal(business(s),before);
 const applied=approve(s,row),next=s.sales.find(item=>item.id===applied.newOrderId);assert.equal(applied.status,'已换货');assert.equal(next.salespersonId,staff.id);assert.equal(next.operatorId,owner.id);assert.equal(next.paymentCredit,200);assert.equal(next.paymentReview.amount,100);assert.equal(s.inventory[0].serials[0].status,'可售');assert.equal(s.inventory[1].serials[0].status,'已售');assert.equal(s.receipts.reduce((n,r)=>n+r.amount,0),300);
});

test('负差额换货提交不要求先退款，老板批准必须亲自确认差额退款',()=>{
 const {s,order}=seed(),row=requests.requestExchange(s,staff,exchangeBody(order,100)),before=JSON.stringify(s);assert.equal(row.difference,-100);assert.equal(row.refundAmount,100);
 assert.throws(()=>approve(s,row),error=>error.statusCode===400&&/老板须确认/.test(error.message));assert.equal(JSON.stringify(s),before);
 const result=approve(s,row,{refundConfirmed:true});assert.equal(result.status,'已换货');assert.equal(s.receipts.find(item=>item.sourceId===result.returnId).amount,-100);assert.equal(s.receipts.reduce((n,r)=>n+r.amount,0),100);
});

test('换出库存被售或申请人员停用后批准失败，不先恢复旧机或登记退款',()=>{
 for(const scenario of ['sold','inactive']){
  const {s,order}=seed(),row=requests.requestExchange(s,staff,exchangeBody(order));
  if(scenario==='sold')erp.sale(s,other,{items:[{skuId:'next',quantity:1,serialNo:'869000000002222',salePrice:300}],account:'现金',cashDrawerConfirmed:true});else s.users.find(u=>u.id===staff.id).status='inactive';
  const before=JSON.stringify(s);assert.throws(()=>approve(s,row),error=>[403,409].includes(error.statusCode));assert.equal(JSON.stringify(s),before);assert.equal(s.inventory[0].serials[0].status,'已售');assert.equal(s.saleReturns.length,0);assert.equal(reject(s,row).status,'已驳回');
 }
});

test('同一销售单不能同时挂起退货、换货和红冲，批准后也不能重复退回',()=>{
 for(const kind of ['return','red']){
  const {s,order}=seed(),row=kind==='return'?requests.request(s,staff,returnBody(order)):red.request(s,staff,{kind:'sale',sourceId:order.id,reason:'测试误开单需要老板审核红冲'});
  const before=JSON.stringify(s);assert.throws(()=>requests.requestExchange(s,staff,exchangeBody(order)),{statusCode:409});assert.equal(JSON.stringify(s),before);
  if(kind==='return')assert.throws(()=>red.request(s,staff,{kind:'sale',sourceId:order.id,reason:'已有退货申请不能重复申请红冲'}),{statusCode:409});
  if(kind==='return'){approve(s,row);const applied=JSON.stringify(s);assert.throws(()=>requests.request(s,staff,returnBody(order)),{statusCode:409});assert.equal(JSON.stringify(s),applied);}
 }
});

test('旧授权红冲审核员工和店长不能批准或驳回，老板批准才生效',()=>{
 const {s,order}=seed();s.users[1].permissions.push('red:review');s.users[1].capabilityOverrides={redReview:true};const row=red.request(s,s.users[1],{kind:'sale',sourceId:order.id,reason:'测试误开单没有实际发生销售'});
 for(const actor of [s.users[1],s.users[2]])for(const decision of ['approve','reject']){const before=JSON.stringify(s);assert.throws(()=>red.review(s,actor,{id:row.id,decision,note:'不允许员工代替老板'}),{statusCode:403});assert.equal(JSON.stringify(s),before);}
 red.review(s,owner,{id:row.id,decision:'approve',note:'核实错误销售同意红冲'});assert.equal(row.status,'已红冲');assert.equal(s.inventory[0].serials[0].status,'可售');assert.equal(s.receipts.reduce((n,r)=>n+r.amount,0),0);
});

test('红冲原单已经变化不阻止老板驳回过期申请',()=>{
 const {s,order}=seed(),row=red.request(s,staff,{kind:'sale',sourceId:order.id,reason:'核对后可能是误开销售单'});order.redReversedBy='OTHER-REVERSAL';const before=business(s);red.review(s,owner,{id:row.id,decision:'reject',note:'原单已处理驳回旧申请'});assert.equal(row.status,'已驳回');const after=JSON.parse(business(s)),original=JSON.parse(before);delete after.redReversals;delete original.redReversals;delete after.feishuNotices;delete original.feishuNotices;assert.deepEqual(after,original);
});
test('HTTP旧退货入口只建申请，老板待办可见，审批权限与幂等防重复生效',async()=>{
 const repo=require('../src/repository'),{createServer}=require('../src/application'),sessions=require('../src/auth-sessions'),{s,order}=seed();repo.resetStore(s);
 const app=createServer();await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 const tokens={boss:sessions.issue(owner.id),staff:sessions.issue(staff.id),manager:sessions.issue(manager.id)};
 async function api(path,who,body,key){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens[who],...(body?{'Content-Type':'application/json','Idempotency-Key':key||'qa-'+Math.random()}: {})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
 function ledger(){const state=repo.readStore();return JSON.stringify({inventory:state.inventory,sales:state.sales,receipts:state.receipts,saleReturns:state.saleReturns,saleExchanges:state.saleExchanges,commissionEntries:state.commissionEntries});}
 try{
  const before=ledger(),payload=returnBody(order),submitted=await api('/api/sale-returns','staff',payload,'qa-return-submit');assert.equal(submitted.status,200);assert.equal(submitted.body.status,'待老板审核');assert.equal(submitted.body.businessApplied,false);assert.equal(ledger(),before);
  const replay=await api('/api/sale-returns','staff',payload,'qa-return-submit');assert.equal(replay.status,200);assert.equal(replay.body.id,submitted.body.id);assert.equal(repo.readStore().saleReturnRequests.length,1);
  const ownList=await api('/api/sale-return-requests','staff');assert.equal(ownList.status,200);assert.equal(ownList.body.length,1);assert.equal(ownList.body[0].canReview,false);
  const todo=await api('/api/workbench','boss');assert.equal(todo.status,200);assert.equal(todo.body.reviews.saleReturn,1);
  const approval={id:submitted.body.id,decision:'approve',note:'老板核实退货实物与款项'};
  for(const actor of ['staff','manager']){assert.equal((await api('/api/sale-return-requests/review',actor,approval)).status,403);assert.equal(ledger(),before);}
  const applied=await api('/api/sale-return-requests/review','boss',approval,'qa-return-approve');assert.equal(applied.status,200);assert.equal(applied.body.status,'已退货');assert.equal(applied.body.businessApplied,true);
  assert.equal(repo.readStore().saleReturns.length,1);assert.equal(repo.readStore().inventory[0].serials[0].status,'可售');assert.equal(repo.readStore().receipts.reduce((n,r)=>n+r.amount,0),0);
  const once=ledger(),approvedReplay=await api('/api/sale-return-requests/review','boss',approval,'qa-return-approve');assert.equal(approvedReplay.status,200);assert.equal(approvedReplay.body.returnId,applied.body.returnId);assert.equal(ledger(),once);
  assert.equal((await api('/api/sale-return-requests/review','boss',approval)).status,409);assert.equal(ledger(),once);
  assert.equal((await api('/api/workbench','boss')).body.reviews.saleReturn,0);
 }finally{await new Promise(resolve=>app.close(resolve));}
});

test('HTTP换货请求负差额可先提交，仅老板确认退款后恢复旧机并换出新机',async()=>{
 const repo=require('../src/repository'),{createServer}=require('../src/application'),sessions=require('../src/auth-sessions'),{s,order}=seed();repo.resetStore(s);
 const app=createServer();await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port,tokens={boss:sessions.issue(owner.id),staff:sessions.issue(staff.id)};
 async function post(path,who,body){const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+tokens[who],'Content-Type':'application/json','Idempotency-Key':'qa-'+Math.random()},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 try{
  const row=await post('/api/sale-exchanges','staff',exchangeBody(order,100));assert.equal(row.status,200);assert.equal(row.body.status,'待老板审核');assert.equal(repo.readStore().saleExchanges.length,0);assert.equal(repo.readStore().inventory[0].serials[0].status,'已售');assert.equal(repo.readStore().inventory[1].serials[0].status,'可售');
  const approval={id:row.body.id,decision:'approve',note:'老板核实补退差额'};assert.equal((await post('/api/sale-return-requests/review','boss',approval)).status,400);assert.equal(repo.readStore().saleReturns.length,0);
  const done=await post('/api/sale-return-requests/review','boss',{...approval,refundConfirmed:true});assert.equal(done.status,200);assert.equal(done.body.status,'已换货');assert.equal(repo.readStore().sales.find(x=>x.id===done.body.newOrderId).salespersonId,staff.id);assert.equal(repo.readStore().receipts.reduce((n,r)=>n+r.amount,0),100);
 }finally{await new Promise(resolve=>app.close(resolve));}
});