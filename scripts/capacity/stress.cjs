'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{performance}=require('node:perf_hooks'),{Pool}=require('pg');
if(!process.env.STORE_PG_URL?.endsWith('/store_erp_capacity_test'))throw Error('Use isolated capacity test database');
process.env.STORE_ENGINE='postgres';
const pg=require('../../server/src/capacity/postgres'),ctx=require('../../server/src/capacity/context'),queries=require('../../server/src/capacity/queries'),erp=require('../../server/src/erp');
const admin=new Pool({host:'/var/run/postgresql',user:'postgres',database:'store_erp_capacity_test',max:1});
const tenant=randomUUID(),owner={id:'stress-boss',name:'模拟老板',roleCode:'owner',status:'active'};
let branches;
const run=(branch,work,path='/api/sale-orders')=>ctx.run({tenantId:tenant,branchId:branch.id,path,userId:owner.id},work);
async function bench(name,count,concurrency,work){let next=0;const samples=[],start=performance.now();await Promise.all(Array.from({length:concurrency},async()=>{while(next<count){const i=next++,t=performance.now();await work(i);samples.push(performance.now()-t);}}));samples.sort((a,b)=>a-b);return {name,requests:count,concurrency,seconds:Math.round((performance.now()-start)/10)/100,p50Ms:Math.round(samples[Math.floor(samples.length*.5)]),p95Ms:Math.round(samples[Math.min(samples.length-1,Math.floor(samples.length*.95))]),maxMs:Math.round(samples.at(-1))};}
async function main(){
 console.log('Preparing isolated 300-branch simulation...');
 await admin.query('INSERT INTO erp_tenants VALUES($1,$2,$3,$4)',[tenant,'STRESS_'+tenant.slice(0,8),'300店容量模拟','active']);
 await admin.query("INSERT INTO erp_branches SELECT $1::uuid,md5($1||':'||n)::uuid,lpad(n::text,3,'0'),'模拟门店'||n,'active' FROM generate_series(1,300)n",[tenant]);
 branches=(await admin.query('SELECT id,code FROM erp_branches WHERE tenant_id=$1 ORDER BY code',[tenant])).rows;
 await admin.query("INSERT INTO erp_shared_records VALUES($1,'users',$2,0,$3)",[tenant,owner.id,JSON.stringify({...owner,branchIds:[branches[0].id]})]);
 await admin.query("INSERT INTO erp_shared_records SELECT $1::uuid,'users','employee-'||b.code||'-'||n,n,jsonb_build_object('id','employee-'||b.code||'-'||n,'name','模拟员工'||n,'roleCode','employee','status','active','permissions',jsonb_build_array('sale:create','sale:return'),'branchIds',jsonb_build_array(b.id::text)) FROM erp_branches b CROSS JOIN generate_series(1,100)n WHERE b.tenant_id=$1",[tenant]);
 await admin.query("INSERT INTO erp_metadata SELECT tenant_id,id,'supplierModelVersion','2'::jsonb FROM erp_branches WHERE tenant_id=$1",[tenant]);
 await admin.query("INSERT INTO erp_records SELECT $1::uuid,b.id,'products','phone',0,jsonb_build_object('skuId','phone','name','容量模拟手机','type','智能手机','trackSerial',true,'stockManaged',true,'salePrice',2000,'costPrice',1500,'warehouseId','wh-a'),now() FROM erp_branches b WHERE b.tenant_id=$1",[tenant]);
 await admin.query("INSERT INTO erp_records SELECT $1::uuid,b.id,'inventory','wh-a/phone',0,jsonb_build_object('skuId','phone','warehouseId','wh-a','quantity',200,'stockValue',300000,'costPrice',1500),now() FROM erp_branches b WHERE b.tenant_id=$1",[tenant]);
 await admin.query("INSERT INTO erp_serial_units SELECT $1::uuid,b.id,'86'||b.code||lpad(n::text,10,'0'),'wh-a/phone',jsonb_build_object('no','86'||b.code||lpad(n::text,10,'0'),'status','可售','costPrice',1500) FROM erp_branches b CROSS JOIN generate_series(1,200)n WHERE b.tenant_id=$1",[tenant]);
 // These are synthetic transactions in the verification company only, not reported as real sales.
 await admin.query("INSERT INTO erp_records SELECT $1::uuid,b.id,'sales','SIM-'||b.code||'-'||lpad(n::text,6,'0'),n*1000000,jsonb_build_object('id','SIM-'||b.code||'-'||lpad(n::text,6,'0'),'createdAt',to_char((now() AT TIME ZONE 'UTC')+n*interval '1 millisecond','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'operatorId','employee-'||b.code||'-1','salespersonId','employee-'||b.code||'-1','operator','模拟员工1','salesperson','模拟员工1','status','completed','amount',2000,'profit',500,'giftCost',0,'items',jsonb_build_array(jsonb_build_object('id','SI-'||n,'name','容量模拟手机','skuId','phone','quantity',1,'salePrice',2000,'amount',2000,'profit',500,'cost',1500))),now() FROM erp_branches b CROSS JOIN generate_series(1,1000)n WHERE b.tenant_id=$1",[tenant]);
 await admin.query('ANALYZE erp_records');await admin.query('ANALYZE erp_shared_records');await admin.query('ANALYZE erp_serial_units');
 console.log('Prepared: 300 branches, 30,000 employees, 300,000 sale rows, 60,000 serial units.');
 const result={fixture:{branches:300,employees:30000,sales:300000,serialUnits:60000},benchmarks:[],limitations:['开发服务器测试；不代表全国正式峰值容量','尚未验证3万人同时在线及长年历史数据','部分旧接口仍读取门店完整业务历史']};
 result.benchmarks.push(await bench('授权员工读取',100,20,i=>run(branches[i%300],async()=>{const s=await pg.readStore({usersOnly:true});assert.equal(s.users.length,101);})));
 result.benchmarks.push(await bench('销售单SQL分页',200,30,i=>run(branches[i%300],async()=>{const page=await queries.salesPage(owner,new URLSearchParams({limit:'40'}));assert.equal(page.rows.length,40);assert.ok(page.nextCursor);})));
 result.benchmarks.push(await bench('串号后四位索引查询',100,20,i=>run(branches[i%300],async()=>{const r=await queries.serials(owner,new URLSearchParams({q:'0001'}));assert.equal(r.rows.length,1);})));
 result.benchmarks.push(await bench('不同门店并发销售事务',60,12,i=>{const b=branches[i%300],serial='86'+b.code+'0000000001';return run(b,()=>pg.transaction(s=>erp.sale(s,s.users.find(x=>x.id===owner.id),{account:'现金',cashDrawerConfirmed:true,items:[{skuId:'phone',quantity:1,salePrice:2000,serialNo:serial}]})));}));
 const rows=(await admin.query("SELECT count(*)::int n FROM erp_records WHERE tenant_id=$1 AND collection='sales'",[tenant])).rows[0].n;assert.equal(rows,300060);
 result.benchmarks.push(await bench('300门店汇总',1,1,()=>run(branches[0],async()=>{const r=await queries.report(owner,new URLSearchParams());assert.equal(r.branches.length,300);assert.equal(r.totals.saleCount,300060);})));
 console.log(JSON.stringify(result,null,2));
 if(process.env.CAPACITY_REPORT_PATH)fs.writeFileSync(process.env.CAPACITY_REPORT_PATH,JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{await pg.close();await admin.end();});
