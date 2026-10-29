'use strict';
const comparison=require('./statement-comparisons'),{readJsonBody,sendJson}=require('./http'),c=require('./common');
async function handle(req,res,ctx){
 const url=new URL(req.url,'http://localhost'),path=url.pathname,store=ctx.requestStore||await ctx.readStore(),user=ctx.authenticate(req,store);comparison.authorize(user);
 if(req.method==='GET'){
  if(path==='/api/statement-comparisons'){sendJson(res,200,url.searchParams.get('id')?comparison.find(store,user,url.searchParams.get('id')):comparison.list(store,user));return;}
  if(!['/api/statement-comparisons/details','/api/statement-comparisons/original'].includes(path))throw new c.HttpError(404,'流水比对接口不存在');
  const row=comparison.find(store,user,url.searchParams.get('id'));
  if(path.endsWith('/details')){const buffers=await Promise.all([row.mobile,row.bank].map(side=>ctx.readKnowledgeFile(side.file.sha256)));if(buffers.some(b=>!b))throw new c.HttpError(404,'原文件暂不可读取，请联系管理员恢复原文件');sendJson(res,200,comparison.details(user,row,buffers));return;}
  const side=url.searchParams.get('side');if(!['mobile','bank'].includes(side))throw new c.HttpError(400,'请选择移动或银行原文件');const file=row[side].file,buffer=await ctx.readKnowledgeFile(file.sha256);if(!buffer)throw new c.HttpError(404,'原文件暂不可读取');
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="statement-original"; filename*=UTF-8\'\''+encodeURIComponent(file.name),'Content-Length':buffer.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(buffer);return;
 }
 if(req.method!=='POST')throw new c.HttpError(405,'请求方式不支持');
 const body=await readJsonBody(req,9*1024*1024);ctx.onBody(body);ctx.assertWorkSession(store,user,path,body);
 if(path==='/api/statement-comparisons/inspect'){sendJson(res,200,comparison.inspect(user,body));return;}
 if(path==='/api/statement-comparisons/preview'){const prepared=comparison.calculate(user,body);sendJson(res,200,body.showDetails===true?prepared.result:comparison.compact(prepared.result));return;}
 if(path!=='/api/statement-comparisons')throw new c.HttpError(404,'流水比对接口不存在');
 const prepared=comparison.calculate(user,body);
 const result=await ctx.transaction(currentStore=>{const actor=ctx.authenticate(req,currentStore),row=comparison.save(currentStore,actor,body,prepared),saved=prepared.files.map(file=>ctx.saveKnowledgeFile(file.sha256,file.buffer));return ctx.capacityEnabled?Promise.all(saved).then(()=>row):row;});
 sendJson(res,200,result);
}
module.exports={handle};
