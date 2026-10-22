'use strict';
const family=require('./companion-family'),repo=require('./repository'),context=require('./capacity/context'),{readJsonBody,sendJson}=require('./http'),c=require('./common');
const cookie=req=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('family_session='))?.slice(15)||'';
async function handle(req,res,path,service=family.defaultService){
 if(path!=='/api/family'&&!path.startsWith('/api/family/'))return false;
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'&&req.method!=='POST')throw new c.HttpError(405,'请求方式不支持');
 const body=req.method==='POST'?await readJsonBody(req,16*1024):{};
 let claim;
 if(path==='/api/family/invite'||path==='/api/family/register')claim=service.verify(body.invite,'invite');
 else if(path==='/api/family/login')claim=service.verify(body.loginRef,'account');
 else claim=service.verify(cookie(req),'session');
 if(process.env.STORE_ENGINE==='postgres'&&(!claim.tenantId||!claim.branchId))throw new c.HttpError(401,'邀请的资料范围不正确');
 const run=work=>context.run({tenantId:claim.tenantId,branchId:claim.branchId,userId:claim.ownerId},work);
 let result;
 if(path==='/api/family/invite'&&req.method==='POST')result=await run(async()=>service.inspect(await repo.readStore(),claim));
 else if(path==='/api/family/register'&&req.method==='POST'){
  await run(async()=>service.inspect(await repo.readStore(),claim));
  const pw=service.password(body.password);
  result=await run(()=>repo.transaction(s=>service.accept(s,claim,body,pw)));
 }else if(path==='/api/family/login'&&req.method==='POST'){
  result=await run(()=>repo.transaction(s=>service.login(s,claim,body)));
  if(result.error){sendJson(res,401,{error:{message:result.error}});return true;}
  const secure=process.env.NODE_ENV==='production'||(process.env.APP_PUBLIC_ORIGIN||'').startsWith('https:')?'; Secure':'';
  res.setHeader('Set-Cookie','family_session='+result.token+'; Path=/api/family; HttpOnly; SameSite=Strict; Max-Age=43200'+secure);
  result={status:result.status,accountId:claim.accountId};
 }else if(path==='/api/family'&&req.method==='GET')result=await run(async()=>service.childSnapshot(await repo.readStore(),claim));
 else if(path==='/api/family/message'&&req.method==='POST')result=await run(()=>repo.transaction(s=>service.childMessage(s,claim,body)));
 else if(path==='/api/family/viewed'&&req.method==='POST')result=await run(()=>repo.transaction(s=>service.childViewed(s,claim,body)));
 else if(path==='/api/family/logout'&&req.method==='POST'){
  result=await run(()=>repo.transaction(s=>service.logout(s,claim)));res.setHeader('Set-Cookie','family_session=; Path=/api/family; HttpOnly; SameSite=Strict; Max-Age=0');
 }else throw new c.HttpError(404,'接口不存在');
 sendJson(res,200,result);return true;
}
module.exports={handle};
