process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../src/common'),r=require('../src/receptions'),intake=require('../src/reception-intake'),erp=require('../src/erp'),{search}=require('../src/search');
function fixture() {
  const base = JSON.parse(JSON.stringify(require("../data/store.json")));
  // The bundled demo ledger uses demo-* user IDs; these tests need stable actors.
  base.users = [
    { id: "u1", name: "测试老板", role: "老板", roleCode: "owner", status: "active", permissions: ["opening_balance:import"] },
    { id: "u2", name: "测试员工甲", role: "店员", roleCode: "employee", status: "active", permissions: ["sale:create", "sale:return"] },
    { id: "u3", name: "测试员工乙", role: "店员", roleCode: "employee", status: "active", permissions: ["sale:create", "sale:return"] },
    { id: "u5", name: "测试仓管", role: "仓管", roleCode: "warehouse", status: "active", permissions: ["purchase:create", "stock:adjust"] },
  ];
  base.users.push({
    id: "manager-test",
    name: "测试店长",
    role: "店长",
    roleCode: "manager",
    status: "active",
    permissions: [],
  });
  Object.assign(base, {
    products: [
      {
        skuId: "phone",
        externalCode: "P1",
        name: "测试手机",
        type: "智能手机",
        stockManaged: true,
        trackSerial: true,
        costPrice: 100,
        salePrice: 200,
        unit: "台",
      },
      {
        skuId: "cable",
        externalCode: "C1",
        name: "数据线",
        type: "配件",
        stockManaged: true,
        costPrice: 10,
        salePrice: 30,
        unit: "条",
      },
      {
        skuId: "screen",
        externalCode: "M1",
        name: "屏幕材料",
        type: "维修",
        stockManaged: true,
        costPrice: 185,
        salePrice: 300,
        unit: "块",
      },
      {
        skuId: "repair",
        externalCode: "R1",
        name: "更换屏幕",
        type: "维修",
        stockManaged: false,
        costPrice: 999,
        salePrice: 380,
        unit: "项",
      },
      {
        skuId: "card",
        externalCode: "K1",
        name: "套餐号卡",
        type: "号卡",
        stockManaged: true,
        costPrice: 1,
        salePrice: 50,
        unit: "张",
      },
    ],
    inventory: [
      {
        skuId: "phone",
        quantity: 1,
        costPrice: 100,
        serials: [{ no: "IMEI-1", status: "可售", costPrice: 100 }],
      },
      { skuId: "cable", quantity: 10, costPrice: 10, serials: [] },
      { skuId: "screen", quantity: 3, costPrice: 185, serials: [] },
      { skuId: "card", quantity: 2, costPrice: 1, serials: [] },
    ],
    sales: [],
    purchases: [],
    receipts: [],
    saleReturns: [],
    movements: [],
    expenses: [],
    commissionRules: [],
    salaryRates: [],
    commissionEntries: [],
    payrollStatements: [],
    cardBusinesses: [],
    cardEvents: [],
    requestRecords: [],
  });
  return c.initialize(base);
}


function cleanFixture(){const s=fixture();s.customers=[];s.receptions=[];s.operationLogs=[];return s;}
const payload={phone:'13900000001',name:'顾客甲',purpose:'咨询手机',intakeVersion:2,needs:'给孩子买华为，比较荣耀',budgetBand:'1000to1999',followUpNeed:'yes'};
test('普通新接待必须记录需求、预算选择，未知预算和不涉及预算不捏造成零元',()=>{
 const s=cleanFixture(),u=s.users[1];
 for(const p of [{...payload,needs:''},{...payload,budgetBand:''},{...payload,budgetBand:undefined},{...payload,budgetBand:'toString'}])assert.throws(()=>r.create(s,u,p),/需求|预算/);
 assert.equal(s.receptions.length,0);assert.equal(s.customers.length,0);
 const unknown=r.create(s,u,{...payload,budgetBand:'unknown'});assert.equal(unknown.budgetMin,null);assert.equal(unknown.budgetMax,null);assert.equal(unknown.supplementPending,true);
 const none=r.create(s,u,{...payload,budgetBand:'none',followUpNeed:'no'});assert.equal(none.budgetMin,null);assert.equal(none.budgetMax,null);assert.equal(none.supplementPending,false);
});
test('预算金额、看过商品的价位和回访时间校验，按北京时间保存本地输入',()=>{
 const s=cleanFixture(),u=s.users[1];
 for(const b of [{budgetMin:-1},{budgetMin:'nan'},{budgetMin:2000,budgetMax:1000},{budgetMin:'',budgetMax:''}])assert.throws(()=>r.create(s,u,{...payload,budgetBand:'custom',...b}),/预算/);
 assert.throws(()=>r.create(s,u,{...payload,followUpAt:'不是时间'}),/回访/);
 const row=r.create(s,u,{...payload,budgetBand:'custom',budgetMin:1299.5,budgetMax:2000,followUpAt:'2026-10-10T09:30'});assert.equal(row.budgetMin,1299.5);assert.equal(row.followUpAt,'2026-10-10T01:30:00.000Z');assert.equal(row.status,'待回访');
});
test('描述均可留空，顾客自愿告知的镇村地址、职业、年龄和多款商品按原始资料保留',()=>{
 const s=cleanFixture(),u=s.users[1],empty=r.create(s,u,payload);assert.equal(empty.customerProfile.gender,'未了解');assert.equal(empty.customerProfile.address,'');
 const row=r.create(s,u,{...payload,gender:'女',ageBand:'25—34岁',occupation:'个体经营',residenceType:'村里',town:'南溪镇',village:'新场村',address:'顾客自愿告知的门牌',description:'给孩子买手机，在外地读书',viewedProducts:JSON.stringify([{skuId:'phone',name:'不能伪造档案名',price:1999},{name:'外店荣耀型号',price:null}])});
 assert.equal(row.customerProfile.village,'新场村');assert.equal(row.customerProfile.occupation,'个体经营');assert.equal(row.viewedProducts[0].name,s.products[0].name);assert.equal(row.viewedProducts[0].price,1999);assert.equal(row.viewedProducts[1].price,null);
 for(const p of [{gender:'猜测男性'},{viewedProducts:'bad'},{viewedProducts:[{skuId:'missing',name:'伪造'}]},{viewedProducts:[{name:'手机',price:-1}]}])assert.throws(()=>r.create(s,u,{...payload,...p}),/性别|商品|价位/);
});
test('忙时可先保存并转销售，原接待关联仍在，补充不重复计库存、收款和积分',()=>{
 const s=cleanFixture(),u=s.users[1],row=r.create(s,u,{phone:payload.phone,purpose:'购买手机',intakeVersion:2,deferDetails:true});assert.equal(row.supplementPending,true);
 const sale=erp.sale(s,u,{receptionId:row.id,account:'现金',cashDrawerConfirmed:true,items:[{skuId:'cable',quantity:1,salePrice:30}]});assert.equal(sale.receptionId,row.id);assert.equal(s.customers.find(x=>x.id===sale.customerId).phone,payload.phone);assert.equal(row.status,'已转业务');
 const before={sales:s.sales.length,receipts:s.receipts.length,quantity:s.inventory.find(x=>x.skuId==='cable').quantity,points:JSON.stringify(row.points)};
 r.update(s,u,{id:row.id,intakeVersion:2,needs:'买数据线，原线坏了',budgetBand:'under500',followUpNeed:'no',occupation:'退休'});assert.equal(row.supplementPending,false);assert.equal(row.status,'已转业务');assert.deepEqual({sales:s.sales.length,receipts:s.receipts.length,quantity:s.inventory.find(x=>x.skuId==='cable').quantity,points:JSON.stringify(row.points)},before);
 assert.equal(row.links[0].id,sale.id);
});
test('补充已结案接待允许留痕，不能重开状态、改积分或原销售链，其他员工不能修改',()=>{
 const s=cleanFixture(),u=s.users[1],row=r.create(s,u,payload);row.status='已结案';row.points=[{amount:50}];row.links=[{kind:'销售单',id:'SO-ORIGINAL'}];const before=JSON.stringify([row.status,row.points,row.links]);
 assert.throws(()=>r.supplement(s,s.users[2],{id:row.id,occupation:'学生'}),/仅接待人/);
 r.supplement(s,u,{id:row.id,occupation:'学生',town:'南溪镇'});assert.equal(JSON.stringify([row.status,row.points,row.links]),before);assert.equal(row.intakeUpdatedBy,u.id);
 const event=row.timeline.at(-1);assert.equal(event.by,u.id);assert.equal(event.action,'补充顾客资料');const diff=event.changes.find(x=>x.field==='customerProfile');assert.equal(diff.before.occupation,'');assert.equal(diff.after.occupation,'学生');assert.ok(s.operationLogs.some(x=>x.action==='reception:supplement'));
 assert.throws(()=>r.update(s,u,{id:row.id}),/补充顾客资料/);
});
test('历史单可补资料，不强制追问，局部更新保留已知商品、预算和详细住地',()=>{
 const s=cleanFixture(),u=s.users[1],row=r.create(s,u,{phone:payload.phone,purpose:'一般咨询'});r.supplement(s,u,{id:row.id,description:'闲聊了解到',village:'某村'});assert.equal(row.budgetMin,null);assert.equal(row.customerProfile.village,'某村');
 r.supplement(s,u,{id:row.id,needs:'了解宽带',budgetBand:'none',followUpNeed:'no',viewedProducts:[{name:'某款手机',price:2000}]});r.supplement(s,u,{id:row.id,occupation:'务农'});assert.equal(row.customerProfile.village,'某村');assert.equal(row.viewedProducts[0].price,2000);assert.equal(row.supplementPending,false);
});
test('今日按北京时间边界查接待、销售；手机号、机型和镇村均能定位原资料',()=>{
 const s=cleanFixture(),u=s.users[1],row=r.create(s,u,{...payload,town:'南溪镇',village:'新场村',viewedProducts:[{name:'荣耀X60',price:1299}]});row.createdAt='2026-10-08T16:05:00Z';
 const other=r.create(s,u,{...payload,phone:'13900000002'});other.createdAt='2026-10-08T15:59:00Z';
 for(const q of ['13900000001','南溪镇','新场村','荣耀X60']){const result=search(s,u,new URLSearchParams({scope:'receptions',q,from:'2026-10-09',to:'2026-10-09'}));assert.deepEqual(result.results.receptions.map(x=>x.id),[row.id]);}
 assert.equal(search(s,u,new URLSearchParams({scope:'all',browse:'1',from:'2026-10-09',to:'2026-10-09'})).results.receptions.length,1);
});
test('接待描述权限随原单，公开协助卡、综合查询和顾客历程不泄露其他员工地址',()=>{
 const s=cleanFixture(),u=s.users[1],other=s.users[2],row=r.create(s,u,{...payload,address:'私密详细地址',occupation:'顾客职业'});
 const publicCard=r.list(s,other).rows.find(x=>x.id===row.id);assert.equal(publicCard.publicAssist,true);assert.equal(publicCard.customerProfile,undefined);
 const denied=search(s,other,new URLSearchParams({scope:'receptions',q:'私密详细地址'}));assert.equal(denied.results.receptions.length,0);
 const allowed=search(s,s.users[0],new URLSearchParams({scope:'receptions',q:'私密详细地址'}));assert.equal(allowed.results.receptions[0].id,row.id);
 r.create(s,other,{...payload});const journey=r.journey(s,other,row.customerId);assert.equal(journey.visits.find(x=>x.id===row.id).customerProfile,undefined);
});
test('有日期筛选时串号只返回期间有可见流转的商品，仍保留其完整历程',()=>{
 const s=cleanFixture(),u=s.users[0];s.inventory[0].serials=[{no:'123456789001234',status:'已售'},{no:'223456789001234',status:'可售'}];
 s.sales=[{id:'SO-1',salespersonId:s.users[1].id,createdAt:'2026-10-08T16:05:00Z',items:[{serialNo:'123456789001234',skuId:'phone',quantity:1}]}];
 const result=search(s,u,new URLSearchParams({scope:'serials',q:'1234',from:'2026-10-09',to:'2026-10-09'}));assert.deepEqual(result.serialTraces.map(x=>x.serialNo),['123456789001234']);
});
