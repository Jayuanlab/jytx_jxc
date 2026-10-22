'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {DatabaseSync}=require('node:sqlite');
async function main(){
 const destination=process.env.CAPACITY_ENV_PATH||'/opt/store-erp/capacity/runtime.env';
 if(fs.existsSync(destination))throw Error('Capacity environment already exists; provisioning never clears an existing database');
 const tenantId=randomUUID(),branchId=randomUUID(),pass=randomBytes(32).toString('base64url'),workerPass=randomBytes(32).toString('base64url');
 const admin=new Pool({host:'/var/run/postgresql',user:'postgres',database:'postgres',max:1});
 const literal=value=>"'"+value.replace(/'/g,"''")+"'";
 try{
  await admin.query('CREATE ROLE store_erp_runtime_v2 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '+literal(pass));
  await admin.query('CREATE ROLE store_erp_events_v2 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '+literal(workerPass));
  await admin.query('CREATE DATABASE store_erp_capacity_v2');
 }finally{await admin.end();}
 const db=new Pool({host:'/var/run/postgresql',user:'postgres',database:'store_erp_capacity_v2',max:1});
 try{
  await db.query(fs.readFileSync(path.join(__dirname,'../../server/migrations/postgres/002_store_runtime.sql'),'utf8'));
  await db.query('GRANT SELECT ON erp_tenants TO store_erp_runtime_v2');
  await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON erp_branches,erp_records,erp_shared_records,erp_metadata,erp_serial_units,erp_files,erp_credentials,erp_sessions,erp_outbox TO store_erp_runtime_v2');
  await db.query('GRANT USAGE,SELECT ON SEQUENCE erp_outbox_id_seq TO store_erp_runtime_v2');
  await db.query('GRANT SELECT,UPDATE ON erp_outbox TO store_erp_events_v2');
  await db.query("CREATE POLICY events_worker ON erp_outbox USING(current_user='store_erp_events_v2') WITH CHECK(current_user='store_erp_events_v2')");
  await db.query('INSERT INTO erp_tenants VALUES($1,$2,$3,$4)',[tenantId,'JYTX','聚友通信','active']);
  await db.query('INSERT INTO erp_branches VALUES($1,$2,$3,$4,$5)',[tenantId,branchId,'001','聚友通信城','active']);
  const source=new DatabaseSync(process.env.CAPACITY_SOURCE_DB||'/opt/store-erp/app/server/data/store.sqlite',{readOnly:true});
  const keep=new Set(['users','categories','commissionRules','salaryRates','employeeKnowledge','knowledgeImports','knowledgeUploads','searchSynonyms','assistantPhrases','assistantDialogues']);
  let kept=0,discarded=0,files=0;
  try{
   if(source.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Source database failed integrity check');
   for(const row of source.prepare('SELECT key,value FROM metadata ORDER BY key').all()){
    if(row.key==='initialized'||row.key.startsWith('array:')||['openingBalance','mockBusinessReset','saleNumberSequences'].includes(row.key))continue;
    await db.query('INSERT INTO erp_metadata VALUES($1,$2,$3,$4)',[tenantId,branchId,row.key,row.value]);
   }
   const pg=require('../../server/src/capacity/postgres');
   for(const row of source.prepare('SELECT collection,position,value FROM records ORDER BY collection,position').all()){
    if(!keep.has(row.collection)){discarded++;continue;}
    const data=JSON.parse(row.value);if(row.collection==='users')data.branchIds=[branchId];
    const key=pg.recordKey(row.collection,data),rank=row.position*1000000;
    if(pg.shared.has(row.collection))await db.query('INSERT INTO erp_shared_records VALUES($1,$2,$3,$4,$5)',[tenantId,row.collection,key,rank,JSON.stringify(data)]);
    else await db.query('INSERT INTO erp_records VALUES($1,$2,$3,$4,$5,$6,now())',[tenantId,branchId,row.collection,key,rank,JSON.stringify(data)]);
    kept++;
   }
   for(const row of source.prepare('SELECT sha256,content FROM knowledge_files').all()){await db.query('INSERT INTO erp_files VALUES($1,$2,$3)',[tenantId,row.sha256,Buffer.from(row.content)]);files++;}
  }finally{source.close();}
  const creds=new DatabaseSync(process.env.CAPACITY_SOURCE_CREDENTIALS||'/opt/store-erp/app/server/data/local-credentials.sqlite',{readOnly:true});
  let credentials=0;
  try{for(const row of creds.prepare('SELECT * FROM credentials').all()){
   await db.query('INSERT INTO erp_credentials(tenant_id,user_id,username,salt,password_hash) VALUES($1,$2,$3,$4,$5)',[tenantId,row.user_id,row.username,row.salt,row.password_hash]);credentials++;
  }}finally{creds.close();}
  await db.query("INSERT INTO erp_metadata VALUES($1,$2,'supplierModelVersion','2') ON CONFLICT(tenant_id,branch_id,key) DO UPDATE SET data='2'",[tenantId,branchId]);
  const env=[
   'STORE_ENGINE=postgres',
   'STORE_PG_URL=postgresql://store_erp_runtime_v2:'+pass+'@127.0.0.1:5432/store_erp_capacity_v2',
   'STORE_PG_EVENTS_URL=postgresql://store_erp_events_v2:'+workerPass+'@127.0.0.1:5432/store_erp_capacity_v2',
   'STORE_TENANT_ID='+tenantId,'STORE_BRANCH_ID='+branchId,
   'HIDE_FEISHU=1','NODE_ENV=production','HOST=127.0.0.1','PORT=3110',
   'APP_PUBLIC_ORIGIN=https://123.57.238.244','NODE_PATH=/opt/store-erp/scale-deps/node_modules'
  ].join('\n')+'\n';
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,env,{mode:0o600});
  console.log(JSON.stringify({database:'store_erp_capacity_v2',tenantId,branchId,kept,discardedSimulationRows:discarded,knowledgeFiles:files,credentials,sourceModified:false}));
 }finally{await db.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
