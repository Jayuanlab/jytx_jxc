'use strict';
const {Pool}=require('pg'),pg=require('../../server/src/capacity/postgres');
async function main(){const db=new Pool({host:'/var/run/postgresql',user:'postgres',database:'store_erp_capacity_v2',max:1});try{
 const rows=(await db.query('SELECT tenant_id,branch_id,collection,record_key,data FROM erp_records UNION ALL SELECT tenant_id,NULL::uuid,collection,record_key,data FROM erp_shared_records')).rows;
 const changes=rows.filter(row=>row.record_key!==pg.recordKey(row.collection,row.data));
 if(changes.some(row=>row.collection==='operationLogs'))throw Error('Audit key changes are not allowed');
 if(process.argv.includes('--repair')){await db.query('BEGIN');try{for(const row of changes){const key=pg.recordKey(row.collection,row.data);if(row.branch_id)await db.query('UPDATE erp_records SET record_key=$5 WHERE tenant_id=$1 AND branch_id=$2 AND collection=$3 AND record_key=$4',[row.tenant_id,row.branch_id,row.collection,row.record_key,key]);else await db.query('UPDATE erp_shared_records SET record_key=$4 WHERE tenant_id=$1 AND collection=$2 AND record_key=$3',[row.tenant_id,row.collection,row.record_key,key]);}await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}}
 console.log(JSON.stringify({records:rows.length,canonicalKeyChanges:changes.length,repaired:process.argv.includes('--repair'),recordContentsChanged:false}));
}finally{await db.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
