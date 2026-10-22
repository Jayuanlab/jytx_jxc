process.env.NODE_ENV="test";
process.env.STORE_DB_PATH=":memory:";
const test=require("node:test"),assert=require("node:assert/strict");
const c=require("../src/common"),erp=require("../src/erp"),suppliers=require("../src/suppliers"),{search}=require("../src/search");
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

function searchFixture(){
 const s=fixture();s.products[0].name="华为测试手机";
 s.inventory[0].serials=[{no:"123456789001234",status:"已售"},{no:"123456789005678",status:"可售"}];
 s.inventory[0].warehouseName="A仓";
 s.products.push({...s.products[0],skuId:"phone2",externalCode:"P2",name:"荣耀测试手机"});
 s.inventory.push({...s.inventory[0],skuId:"phone2",warehouseName:"C仓",serials:[{no:"223456789001234",status:"可售"}]});
 s.sales=[{id:"SO-261008-0001",createdAt:"2026-10-08T01:00:00Z",salespersonId:"u2",salesperson:"测试员工甲",amount:200,status:"completed",invoiceNo:"FP10001",items:[{id:"SI-1",skuId:"phone",name:"华为测试手机",quantity:1,serialNo:"123456789001234",warehouseName:"A仓"}]},{id:"SO-261009-0002",createdAt:"2026-10-09T01:00:00Z",salespersonId:"u3",salesperson:"测试员工乙",amount:200,status:"completed",invoiceNo:"FP10002",items:[{skuId:"phone",name:"华为测试手机",quantity:1}]}];
 s.purchases=[{id:"PO-TEST",invoiceNo:"FP20001",createdAt:"2026-10-07T01:00:00Z",supplierId:"SUP-1",supplier:"测试供应商",items:[{skuId:"phone",name:"华为测试手机",quantity:1,serials:["123456789001234"],warehouseName:"A仓"}],amount:100}];
 s.suppliers=[{id:"SUP-1",name:"测试供应商"}];
 s.govSubsidyClaims=[{id:"GB-TEST",orderId:s.sales[0].id,invoiceNo:"99887766554433221100",createdAt:"2026-10-08T01:00:00Z",events:[]}];
 s.saleReturns=[{id:"SR-TEST",orderId:s.sales[0].id,createdAt:"2026-10-08T02:00:00Z",items:[{itemId:"SI-1",quantity:1}]}];
 s.receipts=[{id:"RC-TEST",sourceId:s.sales[0].id,amount:200,createdAt:"2026-10-08T01:00:00Z",account:"现金"}];
 return s;
}
const query=(s,user,params)=>search(s,user,new URLSearchParams(params));
test("浏览自动返回记录，库存范围不填关键字也可查询，按最新单据排序且限制数量",()=>{
 const s=searchFixture(),owner=s.users[0];
 assert.throws(()=>query(s,owner,{scope:"all"}),/至少输入/);
 const result=query(s,owner,{scope:"all",browse:"1"});assert.equal(result.counts.inventory,5);assert.equal(result.results.sales[0].id,"SO-261009-0002");
 assert.equal(query(s,owner,{scope:"inventory"}).counts.inventory,5);
 for(let i=0;i<130;i++)s.inventory.push({...s.inventory[1]});assert.equal(query(s,owner,{scope:"inventory"}).counts.inventory,100);
});
test("串号后四位列出同尾号，完整串号和仓库筛选准确，流转关联不串单",()=>{
 const s=searchFixture(),owner=s.users[0];
 const tails=query(s,owner,{scope:"serials",q:"1234"});assert.equal(tails.serialTraces.length,2);assert.equal(tails.counts.inventory,2);
 const full=query(s,owner,{scope:"serials",q:"123456789001234"});assert.equal(full.serialTraces.length,1);assert.equal(full.serialTraces[0].purchase.id,"PO-TEST");assert.equal(full.serialTraces[0].sales[0].returns[0].id,"SR-TEST");
 assert.equal(query(s,owner,{scope:"serials",q:"1234",warehouse:"C仓"}).serialTraces[0].serialNo,"223456789001234");
 assert.throws(()=>query(s,owner,{scope:"serials",q:"华为"}),/完整串号/);
});
test("已登记发票号、新采购发票号、历史国补发票号和销售单号都关联正确单据",()=>{
 const s=searchFixture(),owner=s.users[0];
 for(const no of ["FP10001","99887766554433221100","SO-261008-0001"]){const r=query(s,owner,{scope:"invoices",q:no});assert.equal(r.results.sales[0].id,"SO-261008-0001");assert.equal(r.trace[0].sourceId,"SO-261008-0001");assert.ok(r.results.sales[0].invoiceNos.includes("99887766554433221100"));}
 assert.equal(query(s,owner,{scope:"invoices",q:"FP20001"}).results.purchases[0].id,"PO-TEST");
 assert.equal(query(s,owner,{scope:"invoices",q:"NOT-FOUND"}).trace.length,0);
 assert.equal(query(s,owner,{scope:"invoices",q:"FP10001",warehouse:"C仓"}).trace.length,0);
 assert.equal(query(s,owner,{scope:"invoices",q:"99887766554433221100",from:"2026-10-09"}).trace.length,0);
 assert.throws(()=>query(s,owner,{scope:"invoices"}),/请输入发票/);
});
test("员工只能查询自己的销售发票与流转，不泄露其他员工、采购、资金或成本",()=>{
 const s=searchFixture(),employee=s.users[1];
 assert.equal(query(s,employee,{scope:"invoices",q:"FP10001"}).results.sales.length,1);
 const forbidden=query(s,employee,{scope:"invoices",q:"FP10002"});assert.equal(forbidden.results.sales.length,0);assert.equal(forbidden.trace.length,0);
 const r=query(s,employee,{scope:"all",browse:"1"});assert.equal(r.results.purchases.length,0);assert.equal(r.results.receipts.length,0);assert.equal(r.results.sales.length,1);assert.ok(!("stockValue" in r.results.inventory[0]));
 const trace=query(s,employee,{scope:"serials",q:"1234"});assert.equal(trace.serialTraces[0].purchase,null);
});
test("销售、采购录入发票号码并随原有留痕保存，空号不影响业务，过长号在写入前拒绝",()=>{
 const s=fixture();suppliers.upgrade(s);s.suppliers.push({id:"SUP-1",name:"测试供应商"});
 const sale=erp.sale(s,s.users[1],{invoiceNo:" FP-NEW-SALE ",account:"现金",cashDrawerConfirmed:true,items:[{skuId:"cable",quantity:1,salePrice:30}]});assert.equal(sale.invoiceNo,"FP-NEW-SALE");
 const po=erp.purchase(s,s.users[0],{invoiceNo:"FP-NEW-PO",supplierId:"SUP-1",items:[{skuId:"cable",quantity:2,costPrice:10}]});assert.equal(po.invoiceNo,"FP-NEW-PO");
 assert.ok(s.operationLogs.some(row=>row.action==="sale:create"));assert.ok(s.operationLogs.some(row=>row.action==="purchase:create"));
 const blank=erp.sale(s,s.users[1],{account:"现金",cashDrawerConfirmed:true,items:[{skuId:"cable",quantity:1,salePrice:30}]});assert.equal(blank.invoiceNo,"");
 const savedSales=s.sales.length,savedPurchases=s.purchases.length;
 assert.throws(()=>erp.sale(s,s.users[1],{invoiceNo:"1".repeat(101)}),/发票号码/);assert.throws(()=>erp.purchase(s,s.users[0],{invoiceNo:"1".repeat(101)}),/发票号码/);assert.equal(s.sales.length,savedSales);assert.equal(s.purchases.length,savedPurchases);
});
