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
  const businessValues=[scope.tenantId,scope.branchId],businessWhere=["tenant_id=$1","branch_id=$2","collection IN ('carrierServices','airRechargeEvents')"],businessBind=value=>{businessValues.push(value);return '$'+businessValues.length};
  if(f.from)businessWhere.push("COALESCE(data->>'serviceDate',data->>'businessDate',left(data->>'createdAt',10))>="+businessBind(f.from.slice(0,10)));
  if(f.to)businessWhere.push("COALESCE(data->>'serviceDate',data->>'businessDate',left(data->>'createdAt',10))<="+businessBind(f.to.slice(0,10)));
  if(!caps.allSales)businessWhere.push("COALESCE(data->>'employeeId',data->>'operatorId')="+businessBind(user.id));
  const business=(await client.query('SELECT collection,data FROM erp_records WHERE '+businessWhere.join(' AND '),businessValues)).rows;
  const items=sales.flatMap(o=>o.items||[]),serials=[...new Set(items.map(i=>i.serialNo).filter(Boolean))],sources=[...new Set(items.flatMap(i=>(i.costSources||[]).map(s=>s.sourceId)).filter(Boolean))];
  const purchases=serials.length||sources.length?(await client.query("SELECT data FROM erp_records p WHERE tenant_id=$1 AND branch_id=$2 AND collection='purchases' AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.data->'items','[]'::jsonb)) i WHERE i->>'id'=ANY($3::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(i->'serials','[]'::jsonb)) sn WHERE sn=ANY($4::text[])))",[scope.tenantId,scope.branchId,sources,serials])).rows.map(r=>r.data):[];
  // Only FIFO sources from the already scoped sales are read; no full-store origin scan.
  const transferCandidates=sources.length?(await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='stockTransfers' AND data->>'status'='completed' AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(data->'sourceCostSources','[]'::jsonb)) part WHERE part->>'sourceId'=ANY($3::text[])) ORDER BY rank,record_key",[scope.tenantId,scope.branchId,sources])).rows.map(row=>row.data):[];
  const wantedOrigins=new Map(),selectedTransfers=new Set();
  for(const order of sales)for(const item of order.items||[])for(const part of item.costSources||[]){
   if(!part.sourceId||!item.skuId||!item.warehouseId||!(Number(part.quantity)>0))continue;
   const saleAt=Date.parse(order.createdAt);if(!Number.isFinite(saleAt))continue;
   const queue=[{skuId:item.skuId,warehouseId:item.warehouseId,before:saleAt}],visited=new Set();
   for(let cursor=0;cursor<queue.length;cursor++){
    const node=queue[cursor],visit=JSON.stringify([node.skuId,node.warehouseId,node.before]);if(visited.has(visit))continue;visited.add(visit);
    const origin={sourceId:part.sourceId,skuId:node.skuId,warehouseId:node.warehouseId};wantedOrigins.set(JSON.stringify(origin),origin);
    for(const transfer of transferCandidates){const at=Date.parse(transfer.createdAt);
     if(transfer.targetSkuId!==node.skuId||transfer.targetWarehouseId!==node.warehouseId||!transfer.sourceSkuId||!transfer.sourceWarehouseId||!Number.isFinite(at)||at>node.before||!(transfer.sourceCostSources||[]).some(row=>row.sourceId===part.sourceId&&Number(row.quantity)>0))continue;
     selectedTransfers.add(transfer);queue.push({skuId:transfer.sourceSkuId,warehouseId:transfer.sourceWarehouseId,before:at});
    }
   }
  }
  const openingImportBatches=wantedOrigins.size?(await client.query(
   "SELECT jsonb_set(p.data,'{products}',matched.products) AS data FROM erp_records p CROSS JOIN LATERAL (SELECT jsonb_agg(i) AS products FROM jsonb_array_elements(COALESCE(p.data->'products','[]'::jsonb)) i WHERE EXISTS(SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS wanted(\"sourceId\" text,\"skuId\" text,\"warehouseId\" text) WHERE i->>'sourceId'=wanted.\"sourceId\" AND i->>'skuId'=wanted.\"skuId\" AND COALESCE(NULLIF(i->>'warehouseId',''),p.data->>'warehouseId')=wanted.\"warehouseId\")) matched WHERE p.tenant_id=$1 AND p.branch_id=$2 AND p.collection='openingImportBatches' AND matched.products IS NOT NULL ORDER BY p.rank,p.record_key",
   [scope.tenantId,scope.branchId,JSON.stringify([...wantedOrigins.values()])])).rows.map(row=>row.data):[];
  const catalog=(await client.query("SELECT collection,data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection IN('products','suppliers')",[scope.tenantId,scope.branchId])).rows;
  // Return only names/IDs, never account credentials or unscoped employee data.
  const users=(await client.query("SELECT data->>'id' AS id,data->>'name' AS name FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND (data->'branchIds' ? $2 OR data->>'roleCode'='owner' OR data->>'id'=$3)",[scope.tenantId,scope.branchId,user.id])).rows;
  const costAdjustments=caps.profit&&sales.length?(await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='costAdjustments' AND data->>'orderId'=ANY($3::text[])",[scope.tenantId,scope.branchId,sales.map(o=>o.id)])).rows.map(r=>r.data):[];
  const saleReturns=sales.length?(await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='saleReturns' AND data->>'orderId'=ANY($3::text[])",[scope.tenantId,scope.branchId,sales.map(o=>o.id)])).rows.map(r=>r.data):[];
  const giftApprovals=sales.length?(await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='giftApprovals' AND data->>'orderId'=ANY($3::text[])",[scope.tenantId,scope.branchId,sales.map(o=>o.id)])).rows.map(r=>r.data):[];
  const serialSourceCorrections=serials.length?(await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='serialSourceCorrections' AND data->>'serialNo'=ANY($3::text[]) ORDER BY rank,record_key",[scope.tenantId,scope.branchId,serials])).rows.map(r=>r.data):[];
  const serialUnits=serials.length?(await client.query('SELECT inventory_key,data FROM erp_serial_units WHERE tenant_id=$1 AND branch_id=$2 AND serial_no=ANY($3::text[])',[scope.tenantId,scope.branchId,serials])).rows:[];
  const inventory=serialUnits.map(r=>({skuId:r.inventory_key.split('/')[1],serials:[r.data]}));
  const categoryMeta=await client.query("SELECT data FROM erp_metadata WHERE tenant_id=$1 AND branch_id=$2 AND key='productCategoryCatalog'",[scope.tenantId,scope.branchId]);
  return salesList.report({productCategoryCatalog:categoryMeta.rows[0]?.data,sales,saleReturns,purchases,openingImportBatches,stockTransfers:[...selectedTransfers],costAdjustments,giftApprovals,serialSourceCorrections,inventory,carrierServices:business.filter(r=>r.collection==='carrierServices').map(r=>r.data),airRechargeEvents:business.filter(r=>r.collection==='airRechargeEvents').map(r=>r.data),users:caps.allSales?users:users.filter(u=>u.id===user.id),products:catalog.filter(r=>r.collection==='products').map(r=>({skuId:r.data.skuId,name:r.data.name,unit:r.data.unit,externalCode:r.data.externalCode,type:r.data.type,subType:r.data.subType,thirdType:r.data.thirdType,stockManaged:r.data.stockManaged})),suppliers:catalog.filter(r=>r.collection==='suppliers').map(r=>({id:r.data.id,name:r.data.name}))},user,f);
 });
}
async function filterOptions(user){
 // Reuse account restrictions before issuing any scoped database read.
 salesList.filterOptions({users:[],products:[],suppliers:[]},user);
 const caps=c.capabilities(user);
 return pg.scoped(async(client,scope)=>{
  const catalog=(await client.query("SELECT collection,data->>'type' AS type,data->>'subType' AS sub_type,data->>'thirdType' AS third_type,data->'stockManaged' AS stock_managed,data->>'id' AS id,data->>'skuId' AS sku_id,data->>'name' AS name FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection IN ('products','suppliers')",[scope.tenantId,scope.branchId])).rows;
  const people=(await client.query("SELECT data->>'id' AS id,data->>'name' AS name FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND (data->'branchIds' ? $2 OR data->>'roleCode'='owner' OR data->>'id'=$3)"+(caps.allSales?'':" AND data->>'id'=$3"),[scope.tenantId,scope.branchId,user.id])).rows;
  const categoryMeta=await client.query("SELECT data FROM erp_metadata WHERE tenant_id=$1 AND branch_id=$2 AND key='productCategoryCatalog'",[scope.tenantId,scope.branchId]);
  return salesList.filterOptions({productCategoryCatalog:categoryMeta.rows[0]?.data,users:people,products:catalog.filter(r=>r.collection==='products').map(r=>({skuId:r.sku_id,name:r.name,type:r.type,subType:r.sub_type,thirdType:r.third_type,stockManaged:r.stock_managed})),suppliers:catalog.filter(r=>r.collection==='suppliers').map(r=>({id:r.id,name:r.name}))},user);
 });
}
module.exports={report,filterOptions};
