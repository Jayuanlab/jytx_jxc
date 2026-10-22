const {test}=require('node:test');
const assert=require('node:assert/strict');
const guardian=require('../src/guardian');

function store() {
  return {products:[],inventory:[],sales:[],purchases:[],saleReturns:[],purchaseReturns:[],
    closeouts:[],dailyCloseouts:[],airRechargeEvents:[],receipts:[]};
}
function recharge(s) {
  s.airRechargeEvents.push({id:'AIR-1',kind:'customer_recharge',reference:'BOSS-1',
    cashReceived:30,debitAmount:30,businessDate:'2026-10-18',createdAt:'2026-10-18T02:00:00Z'});
  s.receipts.push({id:'RC-1',kind:'cash_recharge',sourceId:'AIR-1',account:'现金',amount:30,
    transactionDate:'2026-10-18',createdAt:'2026-10-18T02:00:00Z'});
}

test('正常充值分别保留现金和平台记录，不报差异',()=>{
  const s=store();recharge(s);
  assert.deepEqual(guardian.inspect(s),[]);
});

test('缺少平台流水号、现金流水或金额不一致逐单提示',()=>{
  const s=store();recharge(s);
  s.airRechargeEvents[0].reference='';
  s.airRechargeEvents[0].debitAmount=20;
  s.receipts[0].amount=25;
  assert.deepEqual(guardian.inspect(s).map(x=>x.id).sort(),[
    'recharge-amount:AIR-1','recharge-receipt:AIR-1','recharge-reference:AIR-1'
  ]);
});

test('跨日现金标为待核实，不擅自判定现金多或少',()=>{
  const s=store();recharge(s);
  s.receipts[0].createdAt='2026-10-19T02:00:00Z';
  const findings=guardian.inspect(s);
  assert.equal(findings.length,1);
  assert.equal(findings[0].id,'cross-day-cash:RC-1');
  assert.equal(findings[0].severity,'待核实');
});

test('孤立现金流水和重复平台流水号会指出具体单号',()=>{
  const s=store();recharge(s);
  s.airRechargeEvents.push({...s.airRechargeEvents[0],id:'AIR-2'});
  s.receipts.push({...s.receipts[0],id:'RC-2',sourceId:'missing'});
  const ids=guardian.inspect(s).map(x=>x.id);
  assert.ok(ids.includes('recharge-duplicate-reference:AIR-2'));
  assert.ok(ids.includes('recharge-receipt:AIR-2'));
  assert.ok(ids.includes('orphan-recharge-receipt:RC-2'));
});

test('正式扎账核对实点依据及现金公式，现金与空充不混算',()=>{
  const s=store();recharge(s);
  s.dailyCloseouts.push({id:'DC-1',status:'待老板签认',openingCash:3281,
    snapshot:{cashChange:975,cashHandoverConfirmed:0},expectedCash:4256,actualCash:4256,cashDifference:0});
  assert.deepEqual(guardian.inspect(s),[]);
  s.dailyCloseouts[0].actualCash=undefined;
  assert.deepEqual(guardian.inspect(s).map(x=>x.id),['daily-close-evidence:DC-1']);
  s.dailyCloseouts[0].actualCash=4256;
  s.dailyCloseouts[0].expectedCash=4246;
  assert.deepEqual(guardian.inspect(s).map(x=>x.id),['daily-close-formula:DC-1']);
});

test('扎账有登记差异或待确认交接时只提示复核',()=>{
  const s=store();
  s.dailyCloseouts.push({id:'DC-2',status:'待老板签认',openingCash:100,
    snapshot:{cashChange:30,cashHandoverConfirmed:0,cashHandoverPending:[{id:'CH-1'}]},
    expectedCash:130,actualCash:140,cashDifference:10});
  assert.deepEqual(guardian.inspect(s).map(x=>x.id),[
    'daily-close-handover:DC-2','daily-close-cash-difference:DC-2'
  ]);
  assert.ok(guardian.inspect(s).every(x=>x.severity==='待核实'));
});
