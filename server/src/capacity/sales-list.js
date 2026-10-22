'use strict';
const pg=require('./postgres'),c=require('../common'),salesList=require('../sales-list');
async function report(user,query){
 const f=salesList.filters(query),caps=c.capabilities(user);
 if(!caps.allSales&&f.salesperson&&f.salesperson!==user.id)throw new c.HttpError(403,'只能查询本人销售清单');
 return pg.scoped(async(client,scope)=>{
  const values=[scope.tenantId,scope.branchId],where=["tenant_id=$1","branch_id=$2","collection='sales'"],bind=value=>{values.push(value);return '$'+values.length};
  if(!caps.allSales)where.push("COALESCE(data->>'salespersonId',data->>'operatorId')="+bind(user.id));
  if(f.start!=null)where.push("(data->>'createdAt')>="+bind(new Date(f.start).toISOString()));
  if(f.end!=null)where.push("(data->>'createdAt')<"+bind(new Date(f.end).toISOString()));
  const sales=(await client.query('SELECT data FROM erp_records WHERE '+where.join(' AND '),values)).rows.map(r=>r.data);
  const items=sales.flatMap(o=>o.items||[]),serials=[...new Set(items.map(i=>i.serialNo).filter(Boolean))],sources=[...new Set(items.flatMap(i=>(i.costSources||[]).map(s=>s.sourceId)).filter(Boolean))];
  const purchases=serials.length||sources.length?(await client.query("SELECT data FROM erp_records p WHERE tenant_id=$1 AND branch_id=$2 AND collection='purchases' AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.data->'items','[]'::jsonb)) i WHERE i->>'id'=ANY($3::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(i->'serials','[]'::jsonb)) sn WHERE sn=ANY($4::text[])))",[scope.tenantId,scope.branchId,sources,serials])).rows.map(r=>r.data):[];
  const catalog=(await client.query("SELECT collection,data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection IN('products','suppliers')",[scope.tenantId,scope.branchId])).rows;
  // Return only names/IDs, never account credentials or unscoped employee data.
  const users=(await client.query("SELECT data->>'id' AS id,data->>'name' AS name FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND (data->'branchIds' ? $2 OR data->>'roleCode'='owner' OR data->>'id'=$3)",[scope.tenantId,scope.branchId,user.id])).rows;
  const costAdjustments=caps.profit&&sales.length?(await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='costAdjustments' AND data->>'orderId'=ANY($3::text[])",[scope.tenantId,scope.branchId,sales.map(o=>o.id)])).rows.map(r=>r.data):[];
  return salesList.report({sales,purchases,costAdjustments,users:caps.allSales?users:users.filter(u=>u.id===user.id),products:catalog.filter(r=>r.collection==='products').map(r=>({skuId:r.data.skuId,name:r.data.name})),suppliers:catalog.filter(r=>r.collection==='suppliers').map(r=>({id:r.data.id,name:r.data.name}))},user,f);
 });
}
module.exports={report};
