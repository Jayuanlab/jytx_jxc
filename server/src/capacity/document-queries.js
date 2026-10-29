'use strict';
const pg=require('./postgres'),c=require('../common'),documents=require('../document-query');
async function salesPage(user,query){
 const f=documents.filters(query);
 return pg.scoped(async(client,scope)=>{
  const values=[scope.tenantId,scope.branchId],where=["tenant_id=$1","branch_id=$2","collection='sales'"],bind=value=>{values.push(value);return '$'+values.length;};
  if(!c.capabilities(user).allSales)where.push("COALESCE(data->>'salespersonId',data->>'operatorId')="+bind(user.id));
  if(f.start!==null)where.push("(data->>'createdAt')>="+bind(new Date(f.start).toISOString()));
  if(f.end!==null)where.push("(data->>'createdAt')<"+bind(new Date(f.end).toISOString()));
  const sales=(await client.query('SELECT data FROM erp_records WHERE '+where.join(' AND '),values)).rows.map(row=>row.data);
  const records=(await client.query("SELECT collection,data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection IN('products','suppliers','purchases','serialSourceCorrections','costAdjustments','documentNumbers','openingImportBatches','stockTransfers') ORDER BY collection,rank,record_key",[scope.tenantId,scope.branchId])).rows;
  const store={sales,inventory:[]};for(const name of ['products','suppliers','purchases','serialSourceCorrections','costAdjustments','documentNumbers','openingImportBatches','stockTransfers'])store[name]=records.filter(row=>row.collection===name).map(row=>row.data);
  const nos=[...new Set(sales.flatMap(order=>[...(order.items||[]),...(order.giftOrders||[]).flatMap(g=>g.items||[])].map(item=>item.serialNo).filter(Boolean)))];
  if(nos.length)store.inventory=(await client.query('SELECT inventory_key,data FROM erp_serial_units WHERE tenant_id=$1 AND branch_id=$2 AND serial_no=ANY($3::text[])',[scope.tenantId,scope.branchId,nos])).rows.map(row=>({skuId:row.inventory_key.split('/')[1],warehouseId:row.inventory_key.split('/')[0],serials:[row.data]}));
  // All item/source predicates run before cursor and limit, so later matches are not lost.
  return documents.salesPage(store,user,query);
 });
}
module.exports={salesPage};
