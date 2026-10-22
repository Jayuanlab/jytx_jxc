'use strict';
// Internal maintenance helper. Never mounted as an HTTP route. Caller uses the
// existing pg.scoped(...,{write:true}) branch lock for BOTH planning and applying.
const numbers=require('./document-numbers'),{HttpError}=require('./http');
const COLLECTIONS=Object.keys(numbers.DEFINITIONS).filter(name=>!['giftOrders','receptionAssists'].includes(name)).concat('documentNumbers');
async function load(client,scope){
 const found=await client.query('SELECT collection,record_key,rank,data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection=ANY($3::text[]) ORDER BY collection,rank,record_key',[scope.tenantId,scope.branchId,COLLECTIONS]);
 const store={};let rank=-1000000;
 for(const row of found.rows){if(!COLLECTIONS.includes(row.collection))throw new HttpError(409,'登记数据范围不正确');(store[row.collection]||=[]).push(row.data);if(row.collection==='documentNumbers'){if(row.record_key!==row.data.id)throw new HttpError(409,'登记主键不一致');rank=Math.max(rank,Number(row.rank));}}
 if(!Number.isFinite(rank))throw new HttpError(409,'登记排序值不正确');
 return {store,rank};
}
function counts(preview){return {count:preview.count,byCollection:preview.byCollection,digest:preview.digest,blocked:preview.blocked.length,blockedByCollection:Object.fromEntries(Object.keys(numbers.DEFINITIONS).map(name=>[name,preview.blocked.filter(row=>row.collection===name).length]))};}
async function inspect(client,scope){const {store}=await load(client,scope);return counts(numbers.previewBackfill(store,{collectErrors:true}));}
async function apply(client,scope,expectedDigest){
 const {store,rank}=await load(client,scope),plan=numbers.previewBackfill(store,{collectErrors:true});
 if(plan.blocked.length)throw new HttpError(409,'存在 '+plan.blocked.length+' 张单据缺少可核对日期或稳定编号，请先核对，不登记部分结果');
 if(plan.count===0&&/^[a-f0-9]{64}$/.test(String(expectedDigest||'')))return {registered:0,alreadyRegistered:true,...counts(plan)};
 if(typeof expectedDigest!=='string'||expectedDigest!==plan.digest)throw new HttpError(409,'登记预览已经变化，请重新核对');
 let cursor=rank;
 for(const entry of plan.added){cursor+=1000000;await client.query('INSERT INTO erp_records(tenant_id,branch_id,collection,record_key,rank,data) VALUES($1,$2,$3,$4,$5,$6)',[scope.tenantId,scope.branchId,'documentNumbers',entry.id,cursor,JSON.stringify(entry)]);}
 return {registered:plan.count,...counts(plan)};
}
module.exports={inspect,apply,COLLECTIONS};
