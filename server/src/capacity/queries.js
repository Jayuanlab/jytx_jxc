const pg=require('./postgres'),c=require('../common'),erp=require('../erp');
function dates(query){
 const from=query.get('from')||c.day(),to=query.get('to')||from;
 for(const value of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||(Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new c.HttpError(400,'日期不正确');
 if(from>to)throw new c.HttpError(400,'开始日期不能晚于结束日期');
 return {from,to,start:new Date(from+'T00:00:00+08:00').toISOString(),end:new Date(Date.parse(to+'T00:00:00+08:00')+86400000).toISOString()};
}
async function salesPage(user,query){
 let limit=Number(query.get('limit')||40);if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new c.HttpError(400,'每页数量须为1至100');
 let cursor=null;
 if(query.get('cursor'))try{cursor=JSON.parse(Buffer.from(query.get('cursor'),'base64url').toString('utf8'));if(!Array.isArray(cursor)||cursor.length!==2||!cursor.every(x=>typeof x==='string')||Number.isNaN(Date.parse(cursor[0]))||cursor[1].length>160)throw Error();}catch{throw new c.HttpError(400,'分页位置不正确，请刷新');}
 return pg.scoped(async(client,scope)=>{
  const params=[scope.tenantId,scope.branchId],where=["tenant_id=$1","branch_id=$2","collection='sales'"];
  const bind=value=>{params.push(value);return '$'+params.length;};
  if(!c.capabilities(user).allSales)where.push("COALESCE(data->>'salespersonId',data->>'operatorId')="+bind(user.id));
  const q=String(query.get('q')||'').trim().slice(0,120);
  if(q){const v=bind('%'+q.replace(/[\\%_]/g,'\\$&')+'%');where.push("(data->>'id' ILIKE "+v+" OR data->>'salesperson' ILIKE "+v+" OR data->>'operator' ILIKE "+v+" OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(data->'items','[]'::jsonb)) i WHERE (COALESCE(i->>'name','')||' '||COALESCE(i->>'serialNo','')||' '||COALESCE(i->>'externalCode','')) ILIKE "+v+") OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(data->'giftOrders','[]'::jsonb)) g WHERE g->>'id' ILIKE "+v+"))");}
  if(query.get('from')||query.get('to')){const range=dates(query);where.push("(data->>'createdAt')>="+bind(range.start),"(data->>'createdAt')<"+bind(range.end));}
  if(cursor)where.push("((data->>'createdAt'),record_key)<("+bind(cursor[0])+","+bind(cursor[1])+")");
  const sql='SELECT record_key,data FROM erp_records WHERE '+where.join(' AND ')+" ORDER BY (data->>'createdAt') DESC,record_key DESC LIMIT "+bind(limit+1);
  const found=(await client.query(sql,params)).rows,more=found.length>limit,selected=found.slice(0,limit);
  const store=c.initialize({sales:selected.map(row=>row.data)});
  if(c.capabilities(user).profit&&selected.length)store.costAdjustments=(await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='costAdjustments' AND data->>'orderId'=ANY($3::text[])",[scope.tenantId,scope.branchId,selected.map(row=>row.record_key)])).rows.map(row=>row.data);
  const last=selected.at(-1);
  return {rows:erp.orders(store,user),nextCursor:more?Buffer.from(JSON.stringify([last.data.createdAt,last.record_key])).toString('base64url'):null,limit};
 });
}
async function serials(user,query){
 const q=String(query.get('q')||'').trim();
 if(!/^[a-z0-9-]{4,40}$/i.test(q))throw new c.HttpError(400,'请输入完整串号或后四位');
 return pg.scoped(async(client,scope)=>{
  const found=(await client.query("SELECT s.serial_no,s.inventory_key,s.data,p.data AS product FROM erp_serial_units s LEFT JOIN erp_records p ON p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id AND p.collection='products' AND p.record_key=split_part(s.inventory_key,'/',2) WHERE s.tenant_id=$1 AND s.branch_id=$2 AND "+(/^\d{4}$/.test(q)?"right(s.serial_no,4)=$3":"s.serial_no=$3")+" ORDER BY s.serial_no LIMIT 101",[scope.tenantId,scope.branchId,q])).rows;
  return {rows:found.slice(0,100).map(row=>{
   const data={...row.data,serialNo:row.serial_no,skuId:row.product?.skuId,name:row.product?.name,warehouseId:row.inventory_key.split('/')[0]};
   if(!c.capabilities(user).cost){delete data.costPrice;delete data.costSources;delete data.cost;delete data.stockValue;}return data;
  }),hasMore:found.length>100,ambiguous:found.length>1};
 });
}
async function report(user,query){
 if(!c.capabilities(user).allSales)throw new c.HttpError(403,'当前岗位没有跨店汇总权限');
 const range=dates(query);
 return pg.scoped(async(client,scope)=>{
  const branches=(await client.query("SELECT id,code,name FROM erp_branches WHERE tenant_id=$1 AND status='active'"+(user.roleCode==='owner'?'':' AND id=ANY($2::uuid[])')+' ORDER BY code',user.roleCode==='owner'?[scope.tenantId]:[scope.tenantId,user.branchIds||[]])).rows;
  const results=[];
  // RLS branch context is changed only for branches authorized above; no unscoped table reads.
  for(const branch of branches){
   await client.query("SELECT set_config('app.branch_id',$1,true)",[branch.id]);
   const rows=(await client.query("SELECT collection,count(*)::int AS count,COALESCE(sum(COALESCE((data->>'amount')::numeric,0)),0)::text AS amount,COALESCE(sum(COALESCE((data->>'profit')::numeric,0)-COALESCE((data->>'giftCost')::numeric,0)),0)::text AS profit FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection IN('sales','saleReturns') AND (data->>'createdAt')>=$3 AND (data->>'createdAt')<$4 GROUP BY collection",[scope.tenantId,branch.id,range.start,range.end])).rows;
   const sale=rows.find(x=>x.collection==='sales'),ret=rows.find(x=>x.collection==='saleReturns');
   results.push({...branch,saleCount:sale?.count||0,returnCount:ret?.count||0,netAmount:c.round(Number(sale?.amount||0)-Number(ret?.amount||0)),...(c.capabilities(user).profit?{salesGrossProfit:c.round(Number(sale?.profit||0)-Number(ret?.profit||0))}:{})});
  }
  return {from:range.from,to:range.to,branches:results,totals:{saleCount:results.reduce((n,x)=>n+x.saleCount,0),returnCount:results.reduce((n,x)=>n+x.returnCount,0),netAmount:c.round(results.reduce((n,x)=>n+x.netAmount,0)),...(c.capabilities(user).profit?{salesGrossProfit:c.round(results.reduce((n,x)=>n+x.salesGrossProfit,0))}:{})},scope:'authorized-branches',profitBasis:'销售毛利（扣赠品，不含全部经营费用及采购成本后调）'};
 });
}
module.exports={salesPage,serials,report};
