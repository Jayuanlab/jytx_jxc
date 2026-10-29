'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const c=require('./common'),context=require('./capacity/context');
const protectedKeys=new Set(['assistantRuleMemories','assistantMemoryDeliveries','ruleLifecycleEvents','ruleAuthorityPolicy','accountOwnershipPolicy','users','employeeKnowledge','knowledgeImports','knowledgeUploads','assistantPhrases','assistantDialogues','searchSynonyms','operationLogs','requestRecords','staffRoleDefaults','permissionLabels','rolePermissions','tokens','sessions','credentials']);
const root=()=>path.resolve(process.env.STORE_BACKUP_DIR||path.join(__dirname,'../data/backups'));
const clone=x=>structuredClone(x);
const ruleKey=key=>require('./rule-configuration-guard').isKey(key),protectedKey=key=>protectedKeys.has(key)||ruleKey(key);
function plain(x){return x&&typeof x==='object'&&!Array.isArray(x);}
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(plain(x))return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
function serialized(x){return JSON.stringify(canonical(x));}
function scope(){const s=context.current();return {tenantId:s.tenantId||'local',branchId:s.branchId||'local'};}
function sign(value){
 const folder=root();fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const file=path.join(folder,'.backup-key');
 if(!fs.existsSync(file)){try{fs.writeFileSync(file,crypto.randomBytes(32),{mode:0o600,flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;}}
 const key=fs.readFileSync(file);if(key.length!==32)throw Error('备份校验密钥不正确');
 return crypto.createHmac('sha256',key).update(serialized(value)).digest('hex');
}
function same(a,b){return typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(b)&&crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
function business(store){return clone(Object.fromEntries(Object.entries(store).filter(([k])=>!protectedKey(k)&&!['__proto__','constructor','prototype'].includes(k))));}
function fingerprint(store){return crypto.createHash('sha256').update(serialized(business(store))).digest('hex');}
function folder(){const s=scope();for(const value of Object.values(s))if(!/^[a-zA-Z0-9-]{1,80}$/.test(value))throw Error('门店范围不正确');const p=path.join(root(),s.tenantId,s.branchId);fs.mkdirSync(p,{recursive:true,mode:0o700});return p;}
function summary(payload){return Object.entries(payload).filter(([,v])=>Array.isArray(v)).map(([name,rows])=>({name,count:rows.length}));}
function verify(envelope){
 if(!plain(envelope)||envelope.format!=='juyou-branch-backup'||envelope.version!==1||!plain(envelope.payload)||!plain(envelope.scope)||!Number.isFinite(Date.parse(envelope.createdAt)))throw new c.HttpError(400,'请选择本系统生成的门店备份文件');
 const {signature,...unsigned}=envelope;if(!same(signature,sign(unsigned)))throw new c.HttpError(400,'备份校验不通过，文件可能不完整或被改动');
 const s=scope();if(envelope.scope.tenantId!==s.tenantId||envelope.scope.branchId!==s.branchId)throw new c.HttpError(409,'此备份属于其他门店，请切换到对应门店');
 if(Object.keys(envelope.payload).some(k=>(protectedKeys.has(k)&&!['assistantRuleMemories','assistantMemoryDeliveries','ruleLifecycleEvents','ruleAuthorityPolicy','accountOwnershipPolicy'].includes(k))||['__proto__','constructor','prototype'].includes(k)))throw new c.HttpError(400,'备份包含不可恢复的系统资料');
 for(const name of ['products','inventory','sales','purchases'])if(!Array.isArray(envelope.payload[name]))throw new c.HttpError(400,'备份缺少完整业务数据');
 return envelope;
}
function file(id){if(typeof id!=='string'||!/^BKP-[0-9a-f-]{36}$/.test(id))throw new c.HttpError(400,'备份编号不正确');return path.join(folder(),id+'.json');}
function metadata(id,envelope){return {id,createdAt:envelope.createdAt,reason:envelope.reason||'手动备份',bytes:Buffer.byteLength(JSON.stringify(envelope)),counts:summary(envelope.payload)};}
function create(store,user,body={}){
 c.permit(user,'manageUsers');
 if(body.note!==undefined&&(typeof body.note!=='string'||body.note.trim().length>200||/[\x00-\x1f\x7f]/.test(body.note)))throw new c.HttpError(400,'备份备注须为200字以内的单行文字');
 const note=String(body.note||'').trim();
 const id='BKP-'+crypto.randomUUID(),unsigned={format:'juyou-branch-backup',version:1,scope:scope(),createdAt:c.now(),reason:body.reason==='before-restore'?'恢复前自动备份':note||'手动备份',payload:business(store)};
 const envelope={...unsigned,signature:sign(unsigned)},text=JSON.stringify(envelope);
 if(Buffer.byteLength(text)>48*1024*1024)throw new c.HttpError(413,'账套备份超过48MB，请联系管理员使用服务器备份');
 fs.writeFileSync(file(id),text,{mode:0o600,flag:'wx'});
 c.audit(store,user,'backup:create',{id,reason:unsigned.reason,counts:summary(unsigned.payload)});
 return {...metadata(id,envelope),message:'备份已生成，可以下载保存'};
}
const metadataCache=new Map();
function statKey(p){const x=fs.statSync(p);return [x.dev,x.ino,x.size,x.mtimeMs,x.ctimeMs].join(':');}
function listedMetadata(id){const p=file(id),keyPath=path.join(root(),'.backup-key'),stamp=statKey(p)+'|'+(fs.existsSync(keyPath)?statKey(keyPath):'missing'),cached=metadataCache.get(p);if(cached?.stamp===stamp)return clone(cached.value);const value=metadata(id,verify(JSON.parse(fs.readFileSync(p,'utf8'))));metadataCache.set(p,{stamp,value:clone(value)});while(metadataCache.size>200)metadataCache.delete(metadataCache.keys().next().value);return value;}
function currentCounts(store){return Object.entries(store).filter(([k,v])=>!protectedKey(k)&&!['__proto__','constructor','prototype'].includes(k)&&Array.isArray(v)).map(([name,rows])=>({name,count:rows.length}));}
function list(store,user){c.permit(user,'manageUsers');const entries=fs.readdirSync(folder()).filter(x=>/^BKP-[0-9a-f-]{36}\.json$/.test(x)).map(name=>({name,at:fs.statSync(path.join(folder(),name)).mtimeMs})).sort((a,b)=>b.at-a.at).slice(0,100);return {scope:scope(),rows:entries.map(x=>listedMetadata(x.name.slice(0,-5))),currentCounts:currentCounts(store),restoreScope:'当前门店业务数据；员工账号、权限、知识资料和操作日志保留'};}
function download(store,user,id){c.permit(user,'manageUsers');const p=file(id);if(!fs.existsSync(p))throw new c.HttpError(404,'备份不存在');const text=fs.readFileSync(p,'utf8');verify(JSON.parse(text));return text;}
function preview(store,user,body){
 c.permit(user,'manageUsers');const data=verify(body.backup);
 require('./product-archive-integrity').assertProductArchivePreserved(store,data.payload);
 const token={scope:scope(),backupSignature:data.signature,currentHash:fingerprint(store),expiresAt:Date.now()+10*60*1000};
 return {createdAt:data.createdAt,counts:summary(data.payload),currentCounts:summary(business(store)),token:{...token,signature:sign(token)},restoreScope:'只恢复当前门店业务数据，账号权限、知识资料和操作日志保留'};
}
function restore(store,user,body){
 c.permit(user,'manageUsers');
 if(body.confirmed!==true)throw new c.HttpError(400,'请确认恢复当前门店');
 const data=verify(body.backup),token=body.token;
 if(!plain(token))throw new c.HttpError(400,'请先预览备份');
 const {signature,...unsigned}=token;
 if(!same(signature,sign(unsigned))||unsigned.backupSignature!==data.signature||serialized(unsigned.scope)!==serialized(scope())||!Number.isFinite(unsigned.expiresAt)||unsigned.expiresAt<Date.now())throw new c.HttpError(409,'恢复预览已失效，请重新预览');
 if(unsigned.currentHash!==fingerprint(store))throw new c.HttpError(409,'预览后门店业务已变化，请重新预览再恢复');
 require('./product-archive-integrity').assertProductArchivePreserved(store,data.payload);
 const safety=create(store,user,{reason:'before-restore'});
 for(const [key,value]of Object.entries(data.payload))if(!protectedKey(key))store[key]=clone(value);
 // Requests for reverted transactions must not replay obsolete success results.
 store.requestRecords=store.requestRecords.filter(x=>x.path.startsWith('/api/system/backups'));
 require('./document-numbers').markRestored(store);
 c.audit(store,user,'backup:restore',{backupCreatedAt:data.createdAt,safetyBackupId:safety.id,counts:summary(data.payload)});
 return {message:'门店业务已恢复，恢复前数据已自动备份',safetyBackupId:safety.id,createdAt:data.createdAt};
}
module.exports={create,list,download,preview,restore,business,fingerprint,verify};
