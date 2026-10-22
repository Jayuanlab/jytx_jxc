// One stream per visible browser page. Message data is fetched through the normal authorized API.
const subscribers = new Set();
function scopeKey(){const s=require("./capacity/context").current();return s.tenantId?s.tenantId+"/"+s.branchId:"legacy";}
function subscribe(req, res, userId, validate) {
  res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders();
  let stopped=false,validating=false,pendingChanged=false;
  const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);subscribers.delete(client);res.end();};
  const send=event=>{
    if(stopped)return;
    if(validating){if(event==='changed')pendingChanged=true;return;}
    validating=true;
    const complete=()=>{validating=false;if(pendingChanged&&!stopped){pendingChanged=false;send('changed');}};
    const write=()=>{if(!stopped&&!res.write('event: '+event+'\ndata: {}\n\n'))stop();complete();};
    const failed=error=>{if(!stopped){if(error?.statusCode===401||error?.statusCode===403)res.write('event: auth-expired\ndata: {}\n\n');stop();}complete();};
    try{const validation=validate();if(validation&&typeof validation.then==='function')Promise.resolve(validation).then(write,failed);else write();}catch(error){failed(error);}
  };
  const client={userId,scopeKey:scopeKey(),send,stop};subscribers.add(client);
  const timer=setInterval(()=>send('heartbeat'),25000);timer.unref();
  res.on('close',stop);req.on('aborted',stop);
  res.write('retry: 2000\n');send('ready');
}
function changed(path,row,userId){
  let targets;
  if(path.endsWith('/send')||path.endsWith('/withdraw')){const recipients=row.recipients||row.recipientReceipts;targets=Array.isArray(recipients)?new Set([row.senderId,...recipients.map(r=>r.userId)]):row.recipientId==='all'?null:new Set([row.senderId,row.recipientId]);}
  else if(path.endsWith('/cloud-clean'))targets=new Set((row.localSaveReceipts||[]).map(r=>r.userId));
  else if(path.endsWith('/read')||path.endsWith('/ack')||path.endsWith('/local-save'))targets=new Set([userId,...(row.receiptViewerIds||[])]);
  else if(path.endsWith('/clear'))targets=new Set([userId]);
  else if(path.endsWith('/publish')||path.endsWith('/update')||path.endsWith('/close'))targets=null;
  else return;
  for(const client of subscribers)if(client.scopeKey===scopeKey()&&(!targets||targets.has(client.userId)))client.send('changed');
}
module.exports={subscribe,changed};
