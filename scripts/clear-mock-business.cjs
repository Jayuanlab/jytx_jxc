'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const keptCollections=new Set(['users','categories','commissionRules','salaryRates','employeeKnowledge','knowledgeImports','searchSynonyms','assistantPhrases','assistantDialogues']);
const clearedCollections=new Set(['products','inventory','sales','purchases','saleReturns','purchaseReturns','stocktakes','movements','expenses','receipts','commissionEntries','payrollStatements','cardBusinesses','customers','receptions','receptionAttempts','learningRecords','workJournals','conversionClaims','assistCommissionAllocations','carrierServices','dailyCloseouts','cashHandovers','fundTransfers','airRechargeEvents','govSubsidyClaims','cardEvents','requestRecords','suppliers','supplierEntries','supplierSettlements','supplierCash','supplierAdjustments','costAdjustments','procurementPlans','redReversals','productPriceChanges','attendance','assistantReports','closeouts','feishuJobs','feishuNotices','giftApprovals','productClassificationArchives','testDataImports','serialStocktakes']);
const keptMetadata=new Set(['initialized','storeName','subcategories','supplierModelVersion','warehouseMigrationVersion','warehouseTestSeedVersion','mockBusinessReset']);
const clearedMetadata=new Set(['openingBalance']);
const keepLog=log=>/^(?:knowledge:|assistant:dialogue|assistant:phrase|auth:|user:|credentials:|search:synonym)/.test(log.action||'');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function snapshot(db){
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('数据库完整性检查失败');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
  if(JSON.stringify(tables)!==JSON.stringify(['knowledge_files','metadata','records']))throw Error('数据库表结构不匹配，停止清理');
  return {
    metadata:db.prepare('SELECT key,value FROM metadata ORDER BY key').all(),
    records:db.prepare('SELECT collection,record_key,position,value FROM records ORDER BY collection,position').all(),
    files:db.prepare('SELECT sha256,content FROM knowledge_files ORDER BY sha256').all().map(row=>({sha256:row.sha256,contentHash:hash(row.content)})),
  };
}
function clearMockDatabase(dbPath,backupPath,{apply=false,actorId}={}){
  if(!dbPath||!backupPath||!fs.existsSync(dbPath)||!fs.existsSync(backupPath))throw Error('必须指定现有账套和已验证备份');
  if(fs.realpathSync(dbPath)===fs.realpathSync(backupPath))throw Error('备份不能与账套为同一个文件');
  const backup=new DatabaseSync(backupPath,{readOnly:true});let saved;
  try{saved=snapshot(backup);}finally{backup.close();}
  const db=new DatabaseSync(dbPath,{readOnly:!apply});let transaction=false;
  try{
    if(apply){db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');transaction=true;}
    const before=snapshot(db);
    if(hash(JSON.stringify(before))!==hash(JSON.stringify(saved)))throw Error('账套与备份内容不一致，请重新备份后再清理');
    const known=new Set([...keptCollections,...clearedCollections,'operationLogs']);
    for(const {collection}of before.records)if(!known.has(collection))throw Error('发现未归类集合 '+collection+'，停止清理');
    for(const {key}of before.metadata){
      if(key.startsWith('array:')){if(!known.has(key.slice(6)))throw Error('发现未归类集合 '+key.slice(6)+'，停止清理');}
      else if(!keptMetadata.has(key)&&!clearedMetadata.has(key))throw Error('发现未归类配置 '+key+'，停止清理');
    }
    if(!before.metadata.some(row=>row.key==='initialized'&&row.value==='true'))throw Error('账套尚未初始化，停止清理');
    const actors=before.records.filter(row=>row.collection==='users').map(row=>JSON.parse(row.value)).filter(row=>row.roleCode==='owner'&&row.status==='active');
    const actor=actorId?actors.find(row=>row.id===actorId):actors.length===1?actors[0]:null;
    if(!actor)throw Error('必须指定账套中的在职老板');
    const removed={},preserved={};
    for(const row of before.records){const dest=clearedCollections.has(row.collection)||row.collection==='operationLogs'&&!keepLog(JSON.parse(row.value))?removed:preserved;dest[row.collection]=(dest[row.collection]||0)+1;}
    const summary={removed,preserved,knowledgeFiles:before.files.length,backup:path.resolve(backupPath),applied:apply};
    if(!apply)return summary;
    const del=db.prepare('DELETE FROM records WHERE collection=?');
    for(const name of clearedCollections)del.run(name);
    const delMeta=db.prepare('DELETE FROM metadata WHERE key=?');for(const name of clearedMetadata)delMeta.run(name);
    const logs=before.records.filter(row=>row.collection==='operationLogs'&&keepLog(JSON.parse(row.value)));
    const id='LOG-'+crypto.randomUUID(),at=new Date().toISOString();
    const log={id,operatorId:actor.id,operator:actor.name,action:'ledger:clear-mock-business',detail:JSON.stringify({reason:'老板授权：当前全为模拟业务数据，清空业务账套并保留系统与知识',removed,preserved,backup:summary.backup}),createdAt:at};
    // Put the cleanup record first, retaining knowledge/configuration audit history.
    del.run('operationLogs');const insert=db.prepare('INSERT INTO records(collection,record_key,position,value) VALUES(?,?,?,?)');
    insert.run('operationLogs','0',0,JSON.stringify(log));logs.forEach((row,i)=>insert.run('operationLogs',String(i+1),i+1,row.value));
    db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('mockBusinessReset',JSON.stringify({at,by:actor.id,backup:summary.backup,auditId:id}));
    const after=snapshot(db);
    if(after.records.some(row=>clearedCollections.has(row.collection)))throw Error('模拟业务清理不完整');
    if(JSON.stringify(before.files)!==JSON.stringify(after.files))throw Error('知识原文件变化，停止清理');
    const keptRecords=rows=>rows.filter(row=>keptCollections.has(row.collection));
    if(JSON.stringify(keptRecords(before.records))!==JSON.stringify(keptRecords(after.records)))throw Error('系统或知识记录变化，停止清理');
    const keptMeta=rows=>rows.filter(row=>row.key!=='mockBusinessReset'&&!clearedMetadata.has(row.key));
    if(JSON.stringify(keptMeta(before.metadata))!==JSON.stringify(keptMeta(after.metadata)))throw Error('系统配置变化，停止清理');
    db.exec('COMMIT');transaction=false;return {...summary,auditId:id};
  }finally{if(transaction)db.exec('ROLLBACK');db.close();}
}
if(require.main===module){
  try{
    const args=process.argv.slice(2),get=flag=>args[args.indexOf(flag)+1];
    if(!args.includes('--db')||!args.includes('--backup'))throw Error('用法：node scripts/clear-mock-business.cjs --db <账套> --backup <已验证备份> [--actor <老板ID>] [--apply]；默认只预览');
    console.log(JSON.stringify(clearMockDatabase(get('--db'),get('--backup'),{apply:args.includes('--apply'),actorId:args.includes('--actor')?get('--actor'):undefined})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={clearMockDatabase,keptCollections,clearedCollections};
