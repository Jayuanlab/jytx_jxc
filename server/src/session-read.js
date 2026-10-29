'use strict';
// Fresh identity snapshot only. No cache and no business-table writes.
const path=require('node:path'),{DatabaseSync}=require('node:sqlite');
function readSessionStore(){
 const repository=require('./repository');
 if(process.env.STORE_ENGINE==='postgres')return readPostgresSession();
 if(process.env.STORE_DB_PATH===':memory:')return repository.readStore();
 const filename=process.env.STORE_DB_PATH||path.join(__dirname,'..','data','store.sqlite');
 const db=new DatabaseSync(filename,{readOnly:true});
 try{
  db.exec('PRAGMA busy_timeout=5000; BEGIN');
  const store={users:[],attendance:[],attendanceNightGrants:[]};
  for(const row of db.prepare("SELECT collection,value FROM records WHERE collection IN ('users','attendance','attendanceNightGrants') ORDER BY collection,position").all())store[row.collection].push(JSON.parse(row.value));
  const cutoffs=db.prepare("SELECT value FROM metadata WHERE key='attendanceSessionCutoffs'").get();
  if(cutoffs)store.attendanceSessionCutoffs=JSON.parse(cutoffs.value);
  db.exec('COMMIT');return store;
 }finally{db.close();}
}
async function readPostgresSession(){
 const pg=require('./capacity/postgres');
 return pg.scoped(async(client,scope)=>{
  const users=await client.query("SELECT data FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND (data->>'roleCode'='owner' OR (data->'branchIds' ? $2 AND data->>'roleCode' IS DISTINCT FROM 'owner')) ORDER BY rank,record_key",[scope.tenantId,scope.branchId]);
  const attendance=await client.query("SELECT collection,data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection IN ('attendance','attendanceNightGrants') ORDER BY collection,rank,record_key",[scope.tenantId,scope.branchId]);
  const cutoff=await client.query("SELECT data FROM erp_metadata WHERE tenant_id=$1 AND branch_id=$2 AND key='attendanceSessionCutoffs'",[scope.tenantId,scope.branchId]);
  const store={users:users.rows.map(r=>r.data),attendance:attendance.rows.filter(r=>r.collection==='attendance').map(r=>r.data),attendanceNightGrants:attendance.rows.filter(r=>r.collection==='attendanceNightGrants').map(r=>r.data)};
  if(cutoff.rows[0])store.attendanceSessionCutoffs=cutoff.rows[0].data;
  return store;
 });
}
module.exports={readSessionStore};
