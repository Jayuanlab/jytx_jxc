'use strict';
const crypto=require('crypto');
const c=require('./common');
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const allowedBatches=new Set(['mobile-20261009','customer-talk-20261009','mobile-promotions-20261010']);
const batchLabels={'mobile-20261009':'移动政策、业务知识与题库','customer-talk-20261009':'顾客口语应答与推荐话术','mobile-promotions-20261010':'10月资费促销与终端达量激励'};
const sourceTiers=new Set(['store_policy','store_training','store_exam']);
const statuses=new Set(['current','needs_review','historical']);
const date=value=>/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value||'') && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
function validate(row,batch){
 if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id.startsWith(batch+'-')||row.id.length>100||! /^[a-z0-9-]+$/.test(row.id)||row.importBatch!==batch)throw new c.HttpError(400,'资料导入编号不正确');
 for(const [field,max] of [['title',80],['category',30],['summary',240],['body',6000]])if(typeof row[field]!=='string'||!row[field].trim()||row[field].length>max)throw new c.HttpError(400,'资料导入字段不正确：'+field);
 if(!sourceTiers.has(row.sourceTier)||!statuses.has(row.policyStatus)||!date(row.asOf))throw new c.HttpError(400,'资料来源或状态不正确');
 for(const field of ['validFrom','validTo'])if(row[field]!==undefined&&!date(row[field]))throw new c.HttpError(400,'资料有效日期不正确');
 if(row.validFrom&&row.validTo&&row.validFrom>row.validTo)throw new c.HttpError(400,'资料有效期间不正确');
 if(!Array.isArray(row.tags)||row.tags.length>20||row.tags.some(t=>typeof t!=='string'||t.length>30))throw new c.HttpError(400,'资料关键词不正确');
 if(!Array.isArray(row.sourceFiles)||!row.sourceFiles.length||row.sourceFiles.some(f=>!f.name||! /^[a-f\d]{64}$/.test(f.sha256||'')||/[\\/]/.test(f.name)))throw new c.HttpError(400,'来源文件信息不正确');
 if(!Array.isArray(row.sourceBlocks)||!row.sourceBlocks.length||row.sourceBlocks.map(b=>b.text).join('\n')!==row.body)throw new c.HttpError(400,'正文与原文段落不一致');
 if(!Array.isArray(row.sourceRefs)||!row.sourceRefs.length||row.sourceRefs.some(r=>!row.sourceFiles.some(f=>f.name===r.file)))throw new c.HttpError(400,'来源出处不正确');
 return JSON.parse(JSON.stringify(row));
}
function apply(store,user,bundle){
 c.permit(user,'manageUsers');
 if(!bundle||bundle.schemaVersion!==1||!allowedBatches.has(bundle.id)||!Array.isArray(bundle.articles)||!bundle.articles.length||bundle.articles.length>200)throw new c.HttpError(400,'资料包格式不正确');
 const {fingerprint:provided,...content}=bundle;
 if(provided!==fingerprint(content))throw new c.HttpError(400,'资料包校验不一致');
 const rows=bundle.articles.map(row=>validate(row,bundle.id));
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new c.HttpError(400,'资料卡片编号重复');
 const current=store.employeeKnowledge||[], decisions=rows.map(row=>{const before=current.find(r=>r.id===row.id);const importedChecksum=fingerprint(row);const action=!before?'insert':before.importFingerprint===importedChecksum?'same':before.editedAfterImport||before.importBatch!==bundle.id?'retain-edit':'update';return {row,before,importedChecksum,action};});
 const now=c.now(),changed=decisions.filter(d=>d.action==='insert'||d.action==='update');
 const result={batch:bundle.id,inserted:decisions.filter(d=>d.action==='insert').length,updated:decisions.filter(d=>d.action==='update').length,unchanged:decisions.filter(d=>d.action==='same').length,preservedEdits:decisions.filter(d=>d.action==='retain-edit').map(d=>d.row.id)};
 const previous=(store.knowledgeImports||[]).find(r=>r.id===bundle.id);
 if(!changed.length&&previous?.fingerprint===provided)return result;
 store.employeeKnowledge ||= [];store.knowledgeImports ||= [];store.operationLogs ||= [];
 const evidence=[];
 for(const d of changed){const next={...d.row,version:(d.before?.version||0)+1,importedAt:now,importFingerprint:d.importedChecksum,editedAfterImport:false,updatedAt:now,updatedBy:user.id,updatedByName:user.name};const i=store.employeeKnowledge.findIndex(r=>r.id===next.id);if(i<0)store.employeeKnowledge.push(next);else store.employeeKnowledge[i]=next;evidence.push({id:next.id,before:d.before||null,after:next});}
 const manifest={id:bundle.id,fingerprint:provided,asOf:bundle.asOf,sourceAssertion:bundle.sourceAssertion,report:bundle.report,importedAt:now,importedBy:user.id,importedByName:user.name,result};const mi=store.knowledgeImports.findIndex(r=>r.id===bundle.id);if(mi<0)store.knowledgeImports.push(manifest);else store.knowledgeImports[mi]=manifest;
 c.audit(store,user,'knowledge:import',JSON.stringify({batch:bundle.id,fingerprint:provided,result,articles:evidence}));return result;
}
function report(store,user){
 c.permit(user,'manageUsers');
 const entries=JSON.parse(JSON.stringify((store.knowledgeImports||[]).filter(entry=>allowedBatches.has(entry.id))));
 const entry=entries.find(row=>row.id==='mobile-20261009')||entries[0];
 const batches=entries.map(row=>({...row,label:batchLabels[row.id]}));
 return entry?{available:true,...entry,batches}:{available:false,message:'尚未导入知识资料',batches:[]};
}
module.exports={apply,report,fingerprint};
