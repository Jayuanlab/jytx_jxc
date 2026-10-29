const assert=require('node:assert/strict');
const {summary}=require('../server/src/workbench');
const owner={id:'o',name:'老板',roleCode:'owner'};
const staff={id:'s',name:'店员',roleCode:'employee'};
const past=new Date(Date.now()-3600000).toISOString();
const store={
 receptions:[
  {id:'r1',ownerId:'s',status:'待结案确认',assists:[{status:'待确认'}],wechat:{claimed:true,confirmed:false},followUpAt:past},
  {id:'r2',ownerId:'s',status:'待回访',assists:[],wechat:{claimed:false},followUpAt:past},
  {id:'r3',ownerId:'o',status:'已结案',assists:[],wechat:{claimed:false}}
 ],
 conversionClaims:[{status:'待老板判断'}],
 learningRecords:[{employeeId:'s',status:'待审核'}],
 closeouts:[{status:'待核对'},{status:'待复核'}],
 dailyCloseouts:[{status:'待老板签认'},{status:'待领取复核'},{status:'已锁定'}],
 cashHandovers:[
  {status:'待接收人确认',recipientId:'s'},
  {status:'金额有异议',recipientId:'o'},
  {status:'已确认收到',recipientId:'o'}
 ],
 procurementPlans:[{status:'open',receiverId:'s'},{status:'received',receiverId:'s'}],
 fundTransfers:[{status:'待收款人确认',toId:'s'},{status:'到账有异议',toId:'o'}]
};
const boss=summary(store,owner),employee=summary(store,staff);
assert.equal(boss.pendingCount,14);
assert.deepEqual(boss.reviews,{reception:1,assist:1,wechat:1,conversion:1,learning:1,closeout:1,closeoutRevision:1,dailyClose:1,dailyReview:1,cashHandover:1,fundTransfer:1,fundTransferDispute:1,cashDispute:1,procurement:1});
assert.equal(employee.pendingCount,5);
assert.deepEqual(employee.reviews,{});
assert.equal(employee.followups,1);
assert.equal(employee.openReceptions,2);
assert.equal(employee.unreviewedLearning,1);
assert.equal(employee.cashToConfirm,1);
assert.equal(employee.transferToConfirm,1);
assert.equal(employee.assignedPlans,1);
console.log(JSON.stringify({workbench:'passed',ownerPending:boss.pendingCount,staffPending:employee.pendingCount}));



