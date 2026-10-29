'use strict';
const crypto=require('node:crypto'),c=require('./common'),chunks=require('./knowledge-chunks.cjs'),vectors=require('./knowledge-vector-store.cjs');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const signature=parts=>digest(parts.map(part=>part.text).join('\n--chunk--\n'));
function article(store,id){const row=(store.employeeKnowledge||[]).find(item=>item.id===id);if(!row)throw new c.HttpError(404,'资料不存在');return row;}
function preview(store,user,id){c.permit(user,'manageUsers');const row=article(store,id),parts=chunks.split(row);return {id:row.id,version:row.version,title:row.title,policyStatus:row.policyStatus,submissionStatus:row.submissionStatus||'legacy',chunkCount:parts.length,parts:parts.map(({id,kind,text,sourceBlockId,row})=>({id,kind,text,sourceBlockId,row})),notice:'审核确认后，以上对客文字将发送至阿里云百炼生成向量。请先删除内部价格、个人信息和未经核实的办理承诺。'};}
function approve(store,user,{id,version}){
 c.permit(user,'manageUsers');const row=article(store,id);
 if(row.version!==version)throw new c.HttpError(409,'资料版本已变化，请重新预览');
 if(row.enabled===false||row.policyStatus!=='current')throw new c.HttpError(409,'请先核对正文并标记店内现行，再向量化');
 if(row.submissionStatus!=='approved'){
  row.version++;row.submissionStatus='approved';row.customerVisible=true;row.approvedBy=user.id;row.approvedAt=c.now();row.updatedAt=row.approvedAt;row.updatedBy=user.id;row.updatedByName=user.name;
 }
 const parts=chunks.split(row);row.indexContentHash=signature(parts);
 c.audit(store,user,'knowledge:approve-vectorization',JSON.stringify({id:row.id,version:row.version,contentHash:row.indexContentHash,chunkCount:parts.length}));
 return structuredClone(row);
}
async function embed(article,scope,actorId){
 const parts=chunks.split(article),token=process.env.PI_INTERNAL_TOKEN;if(!token)throw new c.HttpError(503,'小猫咪向量服务未连接');
 const embeddings=[];let usage=0;
 for(let i=0;i<parts.length;i+=4){
  const batch=parts.slice(i,i+4);
  const response=await fetch('http://127.0.0.1:'+(process.env.KITTY_PORT||3676)+'/embed',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({actorId,scope:{tenantId:scope.tenantId,branchId:scope.branchId},texts:batch.map(part=>part.text)}),signal:AbortSignal.timeout(25000)});
  const result=await response.json();if(!response.ok||result.model!=='qwen3.7-text-embedding'||result.dimensions!==512||result.vectors?.length!==batch.length)throw new c.HttpError(503,'向量服务未完成；资料仍未向量化，可稍后重试');
  embeddings.push(...result.vectors);usage+=Number(result.usage||0);
 }
 const record={articleId:article.id,articleVersion:article.version,contentHash:signature(parts),model:'qwen3.7-text-embedding',dimensions:512,branchId:null,indexedAt:c.now(),chunks:parts.map((part,i)=>({...part,vector:embeddings[i]}))};
 const saved=await vectors.put(article,record);return {...saved,vectorState:'vectorized',usage};
}
module.exports={preview,approve,embed};
