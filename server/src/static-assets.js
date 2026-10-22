'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {gzip}=require('node:zlib');
const {promisify}=require('node:util');
const zip=promisify(gzip);
const SECURITY="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'";
function qualityMap(header){
  const out=new Map();
  for(const part of String(header||'').toLowerCase().split(',')){
    const [name,...parameters]=part.trim().split(';'),coding=name.trim();if(!coding)continue;
    let quality=1;
    for(const parameter of parameters){const match=parameter.trim().match(/^q\s*=\s*(.*)$/);if(match){const raw=match[1];quality=/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw)?Number(raw):0;}}
    out.set(coding,out.has(coding)?Math.min(out.get(coding),quality):quality);
  }
  return out;
}
function encoding(header){
  const q=qualityMap(header),wild=q.get('*'),gz=q.has('gzip')?q.get('gzip'):(wild??0);
  const identity=q.has('identity')?q.get('identity'):(wild===0?0:1);
  if(gz>0&&gz>=identity)return 'gzip';
  if(identity>0)return 'identity';
  if(gz>0)return 'gzip';
  const error=new Error('请求不支持可用的静态编码');error.statusCode=406;throw error;
}
function version(stat){return [stat.dev,stat.ino,stat.size,stat.mtimeNs??stat.mtimeMs,stat.ctimeNs??stat.ctimeMs].join(':');}
function tag(buffer){return '"sha256-'+createHash('sha256').update(buffer).digest('hex')+'"';}
function matches(header,etag){return String(header||'').split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag);}
function safeError(error){
  if(error.statusCode===406)return error;
  const safe=new Error('静态资源暂不可用，请稍后刷新');
  safe.statusCode=['ENOENT','ENOTDIR'].includes(error.code)?404:['EACCES','EPERM'].includes(error.code)?403:500;
  safe.code=error.code||'STATIC_READ_FAILED';return safe;
}
function createStaticAssetServer(options={}){
  const io=options.io||fs.promises;
  const minBytes=Math.max(0,options.minBytes??1024);
  const maxBytes=Math.min(2*1024*1024,options.maxBytes??2*1024*1024);
  const maxEntries=Math.min(24,Math.max(1,options.maxEntries??24));
  const maxCacheBytes=Math.min(8*1024*1024,Math.max(1,options.maxCacheBytes??8*1024*1024));
  const maxInflight=Math.min(8,Math.max(1,options.maxInflight??8));
  const cache=new Map(),loading=new Map();let cacheBytes=0;
  function remove(file){const item=cache.get(file);if(item){cacheBytes-=item.bytes;cache.delete(file);}}
  function remember(file,item){
    remove(file);if(item.bytes>maxCacheBytes)return;
    while(cache.size>=maxEntries||cacheBytes+item.bytes>maxCacheBytes)remove(cache.keys().next().value);
    cache.set(file,item);cacheBytes+=item.bytes;
  }
  async function read(file,expected){
    const handle=await io.open(file,'r');
    try{
      const initial=await handle.stat({bigint:true});
      if(!initial.isFile()||version(initial)!==expected)return null;
      const size=Number(initial.size);if(size<minBytes||size>maxBytes)return null;
      const buffer=Buffer.alloc(size);let count=0;
      while(count<buffer.length){const result=await handle.read(buffer,count,buffer.length-count,count);if(!result.bytesRead)break;count+=result.bytesRead;}
      const final=await handle.stat({bigint:true}),atPath=await io.stat(file,{bigint:true});
      if(count!==size||version(final)!==expected||version(atPath)!==expected)return null;
      const identity=buffer.subarray(0,size),compressed=await zip(identity,{level:6});
      return {version:expected,identity,gzip:compressed,identityTag:tag(identity),gzipTag:tag(compressed),bytes:identity.length+compressed.length};
    }finally{await handle.close();}
  }
  async function serve(req,res,file,contentType){
    let pathname;try{pathname=new URL(req.url,'http://static.invalid').pathname;}catch{return false;}
    const extension=path.extname(file).toLowerCase();
    // The caller must have matched officeFiles before invoking this function.
    if(req.method!=='GET'||pathname.startsWith('/api/')||!['.js','.css'].includes(extension)||!pathname.endsWith(extension)||!(extension==='.css'?contentType.startsWith('text/css'): /^(text|application)\/javascript(?:;|$)/.test(contentType)))return false;
    try{
      let item=null;
      for(let attempt=0;attempt<2&&!item;attempt++){
        const stat=await io.stat(file,{bigint:true});
        if(!stat.isFile()){const error=new Error('Not a file');error.code='ENOENT';throw error;}
        const stamp=version(stat),size=Number(stat.size);
        if(size<minBytes||size>maxBytes){remove(file);return false;}
        const cached=cache.get(file);
        if(cached?.version===stamp){cache.delete(file);cache.set(file,cached);item=cached;break;}
        remove(file);const key=file+'\0'+stamp;
        if(!loading.has(key)){
          if(loading.size>=maxInflight)return false;
          const pending=read(file,stamp).then(value=>{if(value)remember(file,value);return value;});loading.set(key,pending);
        }
        const pending=loading.get(key);
        try{item=await pending;}finally{if(loading.get(key)===pending)loading.delete(key);}
      }
      if(!item)return false;
      const coding=encoding(req.headers['accept-encoding']),body=item[coding],etag=coding==='gzip'?item.gzipTag:item.identityTag;
      const priorVary=String(res.getHeader?.('Vary')||''),values=priorVary.split(',').map(value=>value.trim()).filter(Boolean);
      if(!values.some(value=>value==='*'||value.toLowerCase()==='accept-encoding'))values.push('Accept-Encoding');
      const vary=values.includes('*')?'*':values.join(', ');
      const headers={'Content-Type':contentType,'Cache-Control':'public, max-age=0, must-revalidate','Vary':vary,'ETag':etag,'X-Content-Type-Options':'nosniff','Content-Security-Policy':SECURITY};
      if(coding==='gzip')headers['Content-Encoding']='gzip';
      if(res.destroyed)return true;
      if(matches(req.headers['if-none-match'],etag)){res.writeHead(304,headers);res.end();return true;}
      res.writeHead(200,{...headers,'Content-Length':body.length});res.end(body);return true;
    }catch(error){throw safeError(error);}
  }
  serve.cacheStats=()=>({entries:cache.size,bytes:cacheBytes,inflight:loading.size,maxEntries,maxCacheBytes,maxInflight});
  return serve;
}
const serveStaticAsset=createStaticAssetServer();
module.exports={serveStaticAsset,createStaticAssetServer};
