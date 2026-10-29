'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const html=require('./phone-spec-html');
const hosts=new Set(['consumer.huawei.com','www.honor.com','www.vivo.com.cn','www.oppo.com','www.oneplus.com','www.mi.com','www.apple.com.cn','detail.zol.com.cn','product.pconline.com.cn']);
const directory=()=>process.env.PHONE_SPEC_CACHE_DIR||path.resolve(__dirname,'../data/phone-specifications');
const ttl=30*86400000,missTtl=3600000,inflight=new Map(),pageMemory=new Map(),pageInflight=new Map();
let fetchCount=0;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function safeUrl(value){const u=new URL(value);if(u.protocol!=='https:'||!hosts.has(u.hostname)||u.port||u.username||u.password||u.hash)throw Error('source-url-not-allowed');return u;}
async function download(url,{fresh=false,deadline=Date.now()+8000}={}){
 const allowed=safeUrl(url).href,old=pageMemory.get(allowed);if(!fresh&&old&&Date.now()-old.at<300000)return old.page;
 if(deadline<=Date.now())throw Error('source-time-budget');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(6500,deadline-Date.now()));
 try{let current=allowed,response;for(let i=0;i<3;i++){
   fetchCount++;response=await fetch(current,{redirect:'manual',signal:controller.signal,headers:{'user-agent':'StorePhoneSpecifications/1.0 (public product reference)','accept':'text/html'}});
   if([301,302,303,307,308].includes(response.status)){current=safeUrl(new URL(response.headers.get('location'),current).href).href;await response.body?.cancel();continue;}break;
  }
  if(!response?.ok)throw Error('source-http-'+response?.status);
  if(!/text\/html|application\/xhtml/i.test(response.headers.get('content-type')||''))throw Error('source-not-html');
  const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>3000000){controller.abort();throw Error('source-too-large');}chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),charset=response.headers.get('content-type')||'',body=new TextDecoder(/gb/i.test(charset)?'gb18030':'utf-8').decode(bytes);
  const result={url:current,body,sha256:sha(bytes),fetchedAt:new Date().toISOString()};pageMemory.set(allowed,{at:Date.now(),page:result});return result;
 }finally{clearTimeout(timer);}
}
async function page(url,options={}){const key=safeUrl(url).href;if(pageInflight.has(key))return pageInflight.get(key);const pending=download(key,options);pageInflight.set(key,pending);try{return await pending;}finally{pageInflight.delete(key);}}
function officialUrls(id){
 const m=id.model,base={huawei:'https://consumer.huawei.com/cn/phones/',honor:'https://www.honor.com/cn/phones/',vivo:'https://www.vivo.com.cn/vivo/param/',iqoo:'https://www.vivo.com.cn/vivo/param/',oppo:'https://www.oppo.com/cn/smartphones/'};
 const suffix=s=>s.replace(/promax|pro|plus|ultra|se$/g,value=>({promax:'-pro-max',pro:'-pro',plus:'-plus',ultra:'-ultra',se:'-se'}[value]));
 if(id.brand==='huawei'){let s=m.replace(/^畅享/,'changxiang-');s=suffix(s);return [base.huawei+s+'/specs/'];}
 if(id.brand==='honor'){let s=m.replace(/^畅玩/,'changwan-').replace(/元气版$/,'-genki').replace(/超级版$/,'');s=suffix(s);return [base.honor+'honor-'+s+'/spec/'];}
 if(['vivo','iqoo'].includes(id.brand)){const model=id.brand==='iqoo'?'iqoo'+m:m;return [base[id.brand]+model.replace(/元气版$/,'e')];}
 if(id.brand==='oppo'){const prefix=m.startsWith('find')?'find-x':m.match(/^(reno|a|k)/)?.[1];if(!prefix)return [];let s=suffix(m).replace(/^findx/,'find-x');return [base.oppo+'series-'+prefix+'/'+s+'/specs/'];}
 if(id.brand==='oneplus')return ['https://www.oneplus.com/cn/'+suffix(m.replace(/^turbo/,'turbo-'))+'/specs'];
 return [];
}
const parameterLink=(link)=>/^https:\/\/detail\.zol\.com\.cn\/\d+\/\d+\/param\.shtml$/.test(link)||/^https:\/\/product\.pconline\.com\.cn\/mobile\/[a-z0-9_-]+\/\d+_detail\.html$/.test(link);
function toParameter(link){const u=new URL(link);if(u.hostname==='detail.zol.com.cn'){const m=u.pathname.match(/^\/cell_phone\/index(\d+)\.shtml$/);if(m)return u.origin+'/'+String(Math.ceil(Number(m[1])/1000))+'/'+m[1]+'/param.shtml';}if(u.hostname==='product.pconline.com.cn'&&/^\/mobile\/[^/]+\/\d+\.html$/.test(u.pathname))return u.href.replace('.html','_detail.html');return parameterLink(u.href)?u.href:null;}
async function discover(id,{deadline}={}){
 const known={'xiaomi:14pro:cn':'https://detail.zol.com.cn/1936/1935691/param.shtml','oneplus:turbo6:cn':'https://detail.zol.com.cn/2154/2153079/param.shtml','vivo:y500s:cn':'https://product.pconline.com.cn/mobile/bubugao/2856911_detail.html'};
 const seed=known[id.key]?[known[id.key]]:id.key==='huawei:畅享90plus:cn'&&(!id.variant||/256/.test(id.variant))?['https://detail.zol.com.cn/2162/2161469/param.shtml']:[];
 if(seed.length)return seed;
 // Use the publicly linked product catalogue; the site's search endpoint can
 // return 503, which must not be bypassed or mistaken for “no such phone”.
 const start='https://detail.zol.com.cn/cell_phone_index/subcate57_list_1.html';
 try{
  const listing=await page(start,{deadline}),anchors=html.links(listing.body,start);
  const brands=anchors.filter(a=>[a.label,a.title].some(s=>s.toLowerCase()===id.brandName.toLowerCase())&&/cell_phone_index\/subcate57_[0-9]+_list_1\.html$/.test(a.url));
  const pages=[listing];if(brands[0])try{let next=brands[0].url;for(let i=0;i<3&&next;i++){const p=await page(next,{deadline});pages.push(p);const links=html.links(p.body,p.url);if(links.some(a=>html.identity(a.title||a.label,id.brandName)?.key===id.key))break;next=links.find(a=>/下一页/.test(a.label)&&/cell_phone_index\/subcate57_[0-9]+_list_[0-9]+\.html$/.test(a.url))?.url;}}catch{}
  const found=[];for(const p of pages)for(const a of html.links(p.body,p.url)){const identity=html.identity(a.title||a.label,id.brandName),link=toParameter(a.url);if(identity?.key===id.key&&link&&html.compatibleVariant(id.variant,identity.variant))found.push(link);}
  return [...new Set(found)].slice(0,2);
 }catch{return [];}
}
function cacheFile(id){return path.join(directory(),sha(id.key+':'+(id.variant||'family'))+'.json');}
async function cached(id){try{const value=JSON.parse(await fs.readFile(cacheFile(id),'utf8'));if(value.schema!==1||value.key!==id.key||value.variant!==(id.variant||null))return null;return value;}catch{return null;}}
async function save(id,value){await fs.mkdir(directory(),{recursive:true,mode:0o750});const dest=cacheFile(id),temp=dest+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2),{mode:0o640,flag:'wx'});await fs.rename(temp,dest);}
const comparable=f=>f.value.toLowerCase().replace(/海思|高通|移动平台|cpu|[\s×x（）()、,，]/g,'');
async function collect(id,{fresh=false}={}){
 const diagnostics=[],sources=[],records=[],deadline=Date.now()+8000;
 const official=officialUrls(id);
 for(const url of official.slice(0,1))try{const p=await page(url,{fresh,deadline}),parsed=html.parse(p.body,p.url,id);diagnostics.push({url,status:parsed.status});if(parsed.status==='ok'){sources.push({url:p.url,title:parsed.title,fetchedAt:p.fetchedAt,sha256:p.sha256,tier:'manufacturer'});records.push({fields:parsed.fields,tier:'manufacturer'});}}catch(e){diagnostics.push({url,status:e.message});}
 const references=await discover(id,{deadline});
 for(const url of references.slice(0,1))try{const p=await page(url,{fresh,deadline}),parsed=html.parse(p.body,p.url,id);diagnostics.push({url,status:parsed.status});if(parsed.status==='ok'){sources.push({url:p.url,title:parsed.title,fetchedAt:p.fetchedAt,sha256:p.sha256,tier:'parameter-library'});records.push({fields:parsed.fields,tier:'parameter-library'});}}catch(e){diagnostics.push({url,status:e.message});}
 const fields=new Map(),conflicts=[];
 for(const r of records)for(const f of r.fields){const old=fields.get(f.key);if(!old){fields.set(f.key,{...f,status:r.tier==='manufacturer'?'verified':'reference',tier:r.tier});continue;}
  if(f.key==='storage')continue;
  if(comparable(old)!==comparable(f)){conflicts.push({key:f.key,label:f.label,values:[{value:old.value,url:old.sourceUrl},{value:f.value,url:f.sourceUrl}]});fields.set(f.key,{...old,status:'conflict'});}
 }
 return {schema:1,key:id.key,variant:id.variant||null,displayName:id.displayName,region:id.region,status:fields.size>=3?'ok':'unavailable',fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+(fields.size>=3?ttl:missTtl)).toISOString(),fields:[...fields.values()],sources,conflicts,diagnostics};
}
async function lookup(input,options={}){
 const id=typeof input==='object'&&input.key?input:html.identity(typeof input==='object'?input.name:input,typeof input==='object'?input.brand:'');
 if(!id)return {status:'invalid-model',reason:'请提供完整品牌和具体型号，不能只填“华为手机”或整段顾客描述。',fields:[],sources:[]};
 const key=id.key+':'+(id.variant||'family'),old=await cached(id),fresh=options.refresh===true;
 if(!fresh&&old&&Date.parse(old.expiresAt)>Date.now())return {...old,cache:'hit'};
 if(inflight.has(key))return inflight.get(key);
 const promise=(async()=>{let value;try{value=await collect(id,{fresh});if(value.status==='ok'||!old){await save(id,value);return {...value,cache:'miss'};}
   return {...old,status:'stale',cache:'stale',refreshFailed:true,diagnostics:value.diagnostics};
  }catch(e){return old?{...old,status:'stale',cache:'stale',refreshFailed:true}:{status:'unavailable',displayName:id.displayName,fields:[],sources:[],reason:e.message,cache:'miss'};}
 })();inflight.set(key,promise);try{return await promise;}finally{inflight.delete(key);}
}
module.exports={lookup,identity:html.identity,officialUrls,safeUrl,parse:html.parse,cached,stats:()=>({fetchCount,inflight:inflight.size}),directory};
