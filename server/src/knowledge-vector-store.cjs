'use strict';
const pg=require('./capacity/postgres');
const COLLECTION='assistantKnowledgeVectors';
const key=id=>'article:'+id;
async function list(){
 return pg.scoped(async(client,scope)=>{
  const result=await client.query('SELECT data FROM erp_shared_records WHERE tenant_id=$1 AND collection=$2 ORDER BY record_key',[scope.tenantId,COLLECTION]);
  return result.rows.map(row=>row.data);
 });
}
async function get(articleId){
 return pg.scoped(async(client,scope)=>(await client.query('SELECT data FROM erp_shared_records WHERE tenant_id=$1 AND collection=$2 AND record_key=$3',[scope.tenantId,COLLECTION,key(articleId)])).rows[0]?.data||null);
}
async function put(article,record){
 if(article.id!==record.articleId||article.version!==record.articleVersion||!Array.isArray(record.chunks)||!record.chunks.length)throw Error('索引版本不一致');
 return pg.scoped(async(client,scope)=>{
  const source=await client.query("SELECT data FROM erp_shared_records WHERE tenant_id=$1 AND collection='employeeKnowledge' AND record_key=$2",[scope.tenantId,article.id]);
  const current=source.rows[0]?.data;
  if(!current||current.version!==article.version||current.indexContentHash!==record.contentHash||current.customerVisible!==true||current.policyStatus!=='current'||current.enabled===false||current.submissionStatus!=='approved')throw Object.assign(Error('资料已改变或未完成对客审核，请重新预览'),{statusCode:409});
  await client.query('INSERT INTO erp_shared_records(tenant_id,collection,record_key,rank,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,collection,record_key) DO UPDATE SET data=EXCLUDED.data',[scope.tenantId,COLLECTION,key(article.id),Date.now(),JSON.stringify(record)]);
  return {articleId:article.id,articleVersion:article.version,chunkCount:record.chunks.length};
 },{write:true,sharedWrite:true});
}
function status(article,index){const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());return index&&index.articleVersion===article.version&&index.contentHash===article.indexContentHash&&index.model==='qwen3.7-text-embedding'&&index.dimensions===512&&article.customerVisible===true&&article.submissionStatus==='approved'&&article.policyStatus==='current'&&article.enabled!==false&&(!article.validFrom||article.validFrom<=today)&&(!article.validTo||article.validTo>=today)?'vectorized':'not_vectorized';}
module.exports={list,get,put,status,COLLECTION};
