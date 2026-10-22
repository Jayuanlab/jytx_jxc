const {Pool}=require('pg'),context=require('./context');
const communications=require('../store-communication-events');
let worker,listener,timer,running=false,stopped=false;
async function tick(){
 if(running||stopped)return;running=true;
 const client=await worker.connect();
 try{
  await client.query('BEGIN');
  const rows=(await client.query("SELECT id,tenant_id,branch_id,event FROM erp_outbox WHERE status IN('pending','failed') AND next_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50")).rows;
  for(const row of rows){
   const event={...row.event,tenantId:row.tenant_id,branchId:row.branch_id};
   await client.query("SELECT pg_notify('store_erp_changed',$1)",[JSON.stringify(event)]);
   await client.query("UPDATE erp_outbox SET status='sent',attempts=attempts+1,completed_at=now() WHERE id=$1",[row.id]);
  }
  await client.query('COMMIT');
 }catch{await client.query('ROLLBACK').catch(()=>{});console.error('消息任务暂未完成，将自动重试');}
 finally{client.release();running=false;}
}
async function start(){
 if(!process.env.STORE_PG_EVENTS_URL)return;
 stopped=false;worker=new Pool({connectionString:process.env.STORE_PG_EVENTS_URL,max:1,application_name:'store-erp-events'});
 worker.on('error',()=>console.error('消息队列连接中断'));
 listener=await require('./postgres').connection().connect();
 listener.on('notification',msg=>{
  try{const event=JSON.parse(msg.payload);context.run({tenantId:event.tenantId,branchId:event.branchId},()=>communications.changed(event.path,event.row,event.userId));}catch{}
 });
 listener.on('error',()=>console.error('实时消息连接中断，网页轮询仍可读取消息'));
 await listener.query('LISTEN store_erp_changed');
 timer=setInterval(()=>tick().catch(()=>{}),1000);timer.unref();await tick();
}
async function close(){stopped=true;clearInterval(timer);if(listener){await listener.query('UNLISTEN *').catch(()=>{});listener.release();listener=null;}if(worker){await worker.end();worker=null;}}
module.exports={start,tick,close};
