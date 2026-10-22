const {Pool}=require('pg');
const {createHash}=require('node:crypto');
const {initialize,HttpError}=require('../common');
const {upgrade}=require('../suppliers');
const context=require('./context');
const shared=new Set(['users','employeeKnowledge','knowledgeImports','knowledgeUploads','assistantPhrases','assistantDialogues','searchSynonyms','companionProfiles','companionMemories','companionMessages','companionFavors','companionReminders']);
let pool;
function connection(){
 if(!pool){if(!process.env.STORE_PG_URL)throw new Error('STORE_PG_URL is required');
  pool=new Pool({connectionString:process.env.STORE_PG_URL,max:Number(process.env.STORE_PG_POOL_SIZE||16),connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:15000,application_name:'store-erp'});
  pool.on('error',()=>console.error('PostgreSQL connection lost'));
 }return pool;
}
async function scoped(work,{write=false,sharedWrite=false}={}){
 const scope=context.required(),client=await connection().connect();
 try{
  await client.query(write||sharedWrite?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.branch_id',$2,true)",[scope.tenantId,scope.branchId]);
  const branch=await client.query("SELECT id FROM erp_branches WHERE tenant_id=$1 AND id=$2 AND status='active'",[scope.tenantId,scope.branchId]);
  if(!branch.rowCount)throw new HttpError(403,'门店不存在或已停用');
  if(sharedWrite)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.tenantId+':shared']);
  if(write)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.tenantId+':branch:'+scope.branchId]);
  const numberRows=await client.query("SELECT data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2 AND collection='documentNumbers' ORDER BY rank,record_key",[scope.tenantId,scope.branchId]);
  require('../document-numbers').remember({documentNumbers:numberRows.rows.map(row=>row.data)});
  const result=await work(client,scope);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});
  if(error.code==='23505')throw new HttpError(409,'编号、串号或账号已存在，请核对后重试');
  if(['40001','40P01','55P03','57014'].includes(error.code))throw new HttpError(409,'系统正在处理其他提交，请稍后重试');
  throw error;
 }finally{client.release();}
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
function recordKey(collection,row){
 if(collection==='inventory')return String(row.warehouseId||'wh-sale')+'/'+row.skuId;
 if(collection==='requestRecords')return String(row.userId)+'/'+row.path+'/'+row.key;
 if(collection==='products')return String(row.skuId);
 if(row.id!=null)return String(row.id);
 if(row.key!=null)return String(row.key);
 if(row.sha256)return String(row.sha256);
 return createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex');
}
function mapRows(collection,rows){
 const result=new Map();
 for(const row of rows){const key=recordKey(collection,row);if(result.has(key))throw new HttpError(409,'记录编号重复：'+collection);result.set(key,row);}
 return result;
}
async function load(client,scope,{collections=null,usersOnly=false}={}){
 const store={},ranks=new Map();
 if(!usersOnly){
  const meta=await client.query('SELECT key,data FROM erp_metadata WHERE tenant_id=$1 AND branch_id=$2',[scope.tenantId,scope.branchId]);
  for(const row of meta.rows)store[row.key]=row.data;
  const records=await client.query('SELECT collection,record_key,rank,data FROM erp_records WHERE tenant_id=$1 AND branch_id=$2'+(collections?' AND collection=ANY($3::text[])':'')+' ORDER BY collection,rank,record_key',collections?[scope.tenantId,scope.branchId,collections]:[scope.tenantId,scope.branchId]);
  for(const row of records.rows){(store[row.collection]||=[]).push(row.data);ranks.set(row.collection+'/'+row.record_key,Number(row.rank));}
  const serials=await client.query('SELECT inventory_key,data FROM erp_serial_units WHERE tenant_id=$1 AND branch_id=$2 ORDER BY serial_no',[scope.tenantId,scope.branchId]);
  const stocks=new Map((store.inventory||[]).map(row=>[recordKey('inventory',row),row]));
  for(const stock of stocks.values())stock.serials=[];
  for(const row of serials.rows)stocks.get(row.inventory_key)?.serials.push(row.data);
 }
 const userSql="SELECT collection,record_key,rank,data FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND data->>'roleCode'='owner' UNION ALL SELECT collection,record_key,rank,data FROM erp_shared_records WHERE tenant_id=$1 AND collection='users' AND data->'branchIds' ? $2 AND data->>'roleCode' IS DISTINCT FROM 'owner'";
 const records=await client.query((usersOnly?'SELECT * FROM ('+userSql+') members':"SELECT * FROM ("+userSql+" UNION ALL SELECT collection,record_key,rank,data FROM erp_shared_records WHERE tenant_id=$1 AND collection<>'users') shared")+' ORDER BY collection,rank,record_key',[scope.tenantId,scope.branchId]);
 for(const row of records.rows){(store[row.collection]||=[]).push(row.data);ranks.set(row.collection+'/'+row.record_key,Number(row.rank));}
 initialize(store);if(!usersOnly)upgrade(store);
 return {store,ranks};
}
async function readStore(options={}){return scoped(async(client,scope)=>{const store=(await load(client,scope,options)).store;require("../document-numbers").remember(store);return store;});}
function ranksFor(keys,old){
 const result=new Map();let cursor=0,previous=null;
 while(cursor<keys.length){
  let anchor=cursor;
  for(;anchor<keys.length;anchor++){
   const candidate=old.get(keys[anchor]);
   if(Number.isFinite(candidate)&&(previous===null||candidate>previous))break;
  }
  const next=anchor<keys.length?old.get(keys[anchor]):null,count=anchor-cursor;
  const step=previous===null||next===null?1000000:(next-previous)/(count+1);
  let last=previous;
  // Allocate each inserted block together; repeated midpoints exhaust precision.
  for(let offset=1;offset<=count;offset++){
   const rank=previous===null?(next===null?(offset-1)*step:next-(count-offset+1)*step):previous+offset*step;
   if(!Number.isFinite(rank)||(last!==null&&rank<=last)||(next!==null&&rank>=next))throw new HttpError(409,'记录排序需整理，请稍后重试');
   result.set(keys[cursor+offset-1],rank);last=rank;
  }
  if(next!==null){result.set(keys[anchor],next);previous=next;cursor=anchor+1;}
  else cursor=keys.length;
 }
 return result;
}
async function relocateTransferSerials(client,scope,before,store){
 const locate=inventory=>{const found=new Map();for(const stock of inventory||[])for(const serial of stock.serials||[]){if(found.has(serial.no))throw new HttpError(409,'库存串号重复，请先核对');found.set(serial.no,{stock,serial,key:recordKey('inventory',stock)});}return found;};
 const old=locate(before.store.inventory),next=locate(store.inventory),moved=[...next].filter(([no,row])=>old.has(no)&&old.get(no).key!==row.key);
 if(!moved.length)return new Set();
 if(old.size!==next.size||[...old.keys()].some(no=>!next.has(no)))throw new HttpError(409,'调拨不得新增或删除其他串号');
 const movedNames=new Set(moved.map(([no])=>no));
 if([...old].some(([no,row])=>!movedNames.has(no)&&(row.key!==next.get(no).key||JSON.stringify(canonical(row.serial))!==JSON.stringify(canonical(next.get(no).serial)))))throw new HttpError(409,'调拨不得改动其他串号资料');
 if(scope.path!=='/api/inventory/transfers')throw new HttpError(409,'串号不能直接换仓，请走调拨流程');
 const previous=new Set((before.store.stockTransfers||[]).map(row=>row.id)),records=(store.stockTransfers||[]).filter(row=>!previous.has(row.id));
 if(records.length!==1)throw new HttpError(409,'串号调拨证明不完整');
 const transfer=records[0];
 const sourceKey=transfer.sourceWarehouseId+'/'+transfer.sourceSkuId,targetKey=transfer.targetWarehouseId+'/'+transfer.targetSkuId;
 const sourceBefore=(before.store.inventory||[]).find(s=>recordKey('inventory',s)===sourceKey),sourceAfter=(store.inventory||[]).find(s=>recordKey('inventory',s)===sourceKey),targetBefore=(before.store.inventory||[]).find(s=>recordKey('inventory',s)===targetKey),targetAfter=(store.inventory||[]).find(s=>recordKey('inventory',s)===targetKey);
 const targetProduct=(store.products||[]).find(p=>p.skuId===transfer.targetSkuId),sourceProduct=(before.store.products||[]).find(p=>p.skuId===transfer.sourceSkuId);
 if(transfer.status!=='completed'||transfer.operatorId!==scope.userId||!['wh-a','wh-b','wh-c','wh-other'].includes(transfer.sourceWarehouseId)||!['wh-a','wh-b','wh-c','wh-other'].includes(transfer.targetWarehouseId)||transfer.sourceWarehouseId===transfer.targetWarehouseId||!targetProduct||targetProduct.warehouseId!==transfer.targetWarehouseId||!sourceProduct||sourceProduct.warehouseId!==transfer.sourceWarehouseId||JSON.stringify(canonical(sourceProduct))!==JSON.stringify(canonical((store.products||[]).find(p=>p.skuId===sourceProduct.skuId)))||!sourceBefore||!sourceAfter||!targetAfter||!Array.isArray(transfer.serialNos)||transfer.quantity!==transfer.serialNos.length||transfer.serialNos.length!==moved.length||new Set(transfer.serialNos).size!==moved.length)throw new HttpError(409,'串号调拨范围不正确');
 const amountCents=Math.round(Number(transfer.cost)*100),serialCents=Math.round((transfer.serials||[]).reduce((n,s)=>n+Number(s.costPrice),0)*100);
 if(!Number.isSafeInteger(amountCents)||amountCents<0||amountCents!==serialCents||Math.round((sourceBefore.stockValue-sourceAfter.stockValue)*100)!==amountCents||Math.round((targetAfter.stockValue-(targetBefore?.stockValue||0))*100)!==amountCents)throw new HttpError(409,'串号调拨分仓成本与单台成本不一致');
 if(sourceBefore.quantity-sourceAfter.quantity!==transfer.quantity||targetAfter.quantity-(targetBefore?.quantity||0)!==transfer.quantity||Math.round((sourceBefore.stockValue+(targetBefore?.stockValue||0))*100)!==Math.round((sourceAfter.stockValue+targetAfter.stockValue)*100))throw new HttpError(409,'串号调拨数量或总成本不平');
 const expected=new Set(transfer.serialNos);
 for(const [no,row]of moved){const previous=old.get(no),recorded=(transfer.serials||[]).find(s=>s.no===no),stamp={...previous.serial,originSkuId:previous.serial.originSkuId||transfer.sourceSkuId,lastTransferId:transfer.id,lastTransferredAt:transfer.createdAt,lastTransferredBy:transfer.operatorId};
  const origin=require('../inventory-transfers').serialOrigin(before.store,sourceProduct,previous.serial),recordedOrigin=(transfer.serialSources||[]).find(s=>s.no===no);
  if(JSON.stringify(canonical(origin))!==JSON.stringify(canonical(recordedOrigin)))throw new HttpError(409,'串号调拨来源核验不一致');
  if(!expected.has(no)||previous.key!==sourceKey||row.key!==targetKey||!['可售','未激活'].includes(previous.serial.status)||JSON.stringify(canonical(previous.serial))!==JSON.stringify(canonical(recorded))||JSON.stringify(canonical(stamp))!==JSON.stringify(canonical(row.serial)))throw new HttpError(409,'串号调拨原始资料不一致');
 }
 for(const [no,row]of moved){const changed=await client.query('UPDATE erp_serial_units SET inventory_key=$4,data=$5 WHERE tenant_id=$1 AND branch_id=$2 AND serial_no=$3 AND inventory_key=$6 RETURNING serial_no',[scope.tenantId,scope.branchId,no,row.key,JSON.stringify(row.serial),old.get(no).key]);if(changed.rowCount!==1)throw new HttpError(409,'串号原仓已经变化，请重新核对');}
 return new Set(moved.map(([no])=>no));
}
async function persist(client,scope,before,store){
 const movedSerials=await relocateTransferSerials(client,scope,before,store);
 let changed=movedSerials.size;
 for(const [collection,value]of Object.entries(store)){
  if(!Array.isArray(value)){
   if(JSON.stringify(before.store[collection])!==JSON.stringify(value)){
    await client.query('INSERT INTO erp_metadata VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,branch_id,key) DO UPDATE SET data=EXCLUDED.data',[scope.tenantId,scope.branchId,collection,JSON.stringify(value)]);changed++;
   }continue;
  }
  const prior=mapRows(collection,before.store[collection]||[]),next=mapRows(collection,value);
  const oldRanks=new Map([...prior.keys()].map(key=>[key,before.ranks.get(collection+'/'+key)])),ranks=ranksFor([...next.keys()],oldRanks);
  const table=shared.has(collection)?'erp_shared_records':'erp_records';
  for(const [key,row]of next){
   if(collection==='users'&&!row.branchIds)row.branchIds=[scope.branchId];
   const old=prior.get(key);let data=row,oldData=old;
   if(collection==='inventory'){
    const {serials,...rest}=row;data=rest;const {serials:oldSerials,...oldRest}=old||{};oldData=oldRest;
    const oldSerialMap=new Map((oldSerials||[]).map(s=>[s.no,s]));
    for(const serial of serials||[]){
     if(JSON.stringify(oldSerialMap.get(serial.no))===JSON.stringify(serial))continue;
     let updated;try{updated=await client.query('INSERT INTO erp_serial_units(tenant_id,branch_id,serial_no,inventory_key,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,serial_no) DO UPDATE SET inventory_key=EXCLUDED.inventory_key,data=EXCLUDED.data WHERE erp_serial_units.branch_id=EXCLUDED.branch_id AND erp_serial_units.inventory_key=EXCLUDED.inventory_key RETURNING serial_no',[scope.tenantId,scope.branchId,serial.no,key,JSON.stringify(serial)]);}catch(error){if(['23505','42501'].includes(error.code))throw new HttpError(409,'串号已登记在另一商品或门店，请走调拨流程');throw error;}
     if(!updated.rowCount)throw new HttpError(409,'串号已登记在另一商品或门店，请走调拨流程');
     changed++;
    }
    const newSerials=new Set((serials||[]).map(s=>s.no));
    for(const no of oldSerialMap.keys())if(!newSerials.has(no)&&!movedSerials.has(no)){await client.query('DELETE FROM erp_serial_units WHERE tenant_id=$1 AND branch_id=$2 AND serial_no=$3',[scope.tenantId,scope.branchId,no]);changed++;}
   }
   const rank=ranks.get(key),oldRank=oldRanks.get(key);
   if(JSON.stringify(data)===JSON.stringify(oldData)&&rank===oldRank)continue;
   if(collection==='operationLogs'&&old)throw new HttpError(409,'操作记录只能追加，不能修改历史');
   if(shared.has(collection))await client.query('INSERT INTO '+table+'(tenant_id,collection,record_key,rank,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,collection,record_key) DO UPDATE SET rank=EXCLUDED.rank,data=EXCLUDED.data',[scope.tenantId,collection,key,rank,JSON.stringify(data)]);
   else await client.query('INSERT INTO '+table+'(tenant_id,branch_id,collection,record_key,rank,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,branch_id,collection,record_key) DO UPDATE SET rank=EXCLUDED.rank,data=EXCLUDED.data,updated_at=now()',[scope.tenantId,scope.branchId,collection,key,rank,JSON.stringify(data)]);
   changed++;
  }
  for(const key of prior.keys())if(!next.has(key)){
   if(shared.has(collection))await client.query('DELETE FROM '+table+' WHERE tenant_id=$1 AND collection=$2 AND record_key=$3',[scope.tenantId,collection,key]);
   else await client.query('DELETE FROM '+table+' WHERE tenant_id=$1 AND branch_id=$2 AND collection=$3 AND record_key=$4',[scope.tenantId,scope.branchId,collection,key]);
   changed++;
  }
 }return changed;
}
async function transaction(work){
 const scope=context.required(),sharedWrite=/users|assistant\/(?:dialogues|phrases|knowledge|feedback\/review)|search\/synonyms|knowledge/.test(scope.path||'')||/companion/.test(scope.path||'')||!scope.path;
 return scoped(async(client,currentScope)=>{
  const before=await load(client,currentScope),store=structuredClone(before.store),numbers=require("../document-numbers"),numberBefore=numbers.capture(store);
  const result=await context.run({...currentScope,client},()=>work(store));
  numbers.commitNew(store,numberBefore);
  // Rebuild this branch serials when a validated restore moves units between products.
  if(currentScope.path==="/api/system/backups/restore"){
   await client.query("DELETE FROM erp_serial_units WHERE tenant_id=$1 AND branch_id=$2",[currentScope.tenantId,currentScope.branchId]);
   for(const stock of before.store.inventory||[])stock.serials=[];
  }
  const changed=await persist(client,currentScope,before,store);
  if(changed)await client.query('INSERT INTO erp_outbox(tenant_id,branch_id,event) VALUES($1,$2,$3)',[currentScope.tenantId,currentScope.branchId,JSON.stringify({path:currentScope.path||'store:write',userId:currentScope.userId||null,row:{senderId:result?.senderId,recipientId:result?.recipientId},changed})]);
  return numbers.project(result,store);
 },{write:true,sharedWrite});
}
async function saveKnowledgeFile(sha256,content){
 const scope=context.required();if(!scope.client)throw new Error('Knowledge file requires transaction');
 await scope.client.query('INSERT INTO erp_files VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[scope.tenantId,sha256,content]);
}
async function readKnowledgeFile(sha256){
 if(!/^[a-f0-9]{64}$/.test(sha256||''))return null;
 return scoped(async(client,scope)=>(await client.query('SELECT content FROM erp_files WHERE tenant_id=$1 AND sha256=$2',[scope.tenantId,sha256])).rows[0]?.content||null);
}
async function health(){await connection().query('SELECT 1');return {ok:true,storage:'postgresql',pool:{total:connection().totalCount,idle:connection().idleCount,waiting:connection().waitingCount}};}
async function close(){if(pool){await pool.end();pool=null;}}
module.exports={connection,scoped,readStore,transaction,saveKnowledgeFile,readKnowledgeFile,recordKey,ranksFor,shared,health,close,load,persist};
