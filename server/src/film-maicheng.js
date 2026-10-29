'use strict';
const {createHash}=require('node:crypto'),c=require('./common');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function prepareCatalog(input){
 const cfg=input?.kind==='yizuoshan-v1'?{family:'yzs',source:'yizuoshan-source-1',label:'一座山',code:key=>key}:{family:'mc',source:'maicheng-source-1',label:'麦橙',code:key=>'MC-'+key};
 const fail=m=>{throw new c.HttpError(400,m)},text=(v,max=12000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('麦橙资料字段不正确');return v.trim();};
 if(!['maicheng-v1','yizuoshan-v1'].includes(input?.kind)||input.sources?.length!==1||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>1500)fail('麦橙资料格式不正确');
 const source=input.sources[0];if(source.id!==cfg.source||!/^[a-f0-9]{64}$/.test(source.sha256)||/[\\/]/.test(source.file||''))fail('麦橙来源文件不正确');text(source.file,200);
 const sourceDigest=createHash('sha256').update(JSON.stringify([{file:source.file,sha256:source.sha256}])).digest('hex');if(input.sourceDigest!==sourceDigest)fail('麦橙来源摘要不一致');
 const loc=l=>{if(!l||l.file!==source.file||l.sha256!==source.sha256||typeof l.sheet!=='string'||!l.sheet||!/^\$?[A-Z]+\$?\d+$/.test(l.cell))fail('麦橙来源单元格不正确');return structuredClone(l);};
 const rows=input.rows.map(r=>{
  if(!r||!/^[A-Z0-9_-]{1,60}$/.test(r.key)||r.sourceId!==source.id||r.sourceFile!==source.file||r.sourceSHA256!==source.sha256)fail('麦橙商品来源不一致');
  for(const k of ['inventoryQuantity','purchasePrice','salePrice','barcode','unit','warehouse'])if(r[k]!=null)fail('通用资料不能作为库存、价格或仓库依据');
  const series=text(r.series,100),primary=r.primaryModelsRaw?.map(v=>text(v,1000));if(!primary?.length||primary.length>20||!Array.isArray(r.fragments)||!Array.isArray(r.sourceCells)||!r.sourceCells.length)fail('麦橙资料缺少原文');
  const cells=r.sourceCells.map(v=>({raw:text(v.raw),locator:loc(v.locator)}));
  const fragments=r.fragments.map(f=>{const raw=text(f.raw),locator=loc(f.locator);if(f.semanticExpansion===true||!cells.some(v=>v.raw===raw&&JSON.stringify(v.locator)===JSON.stringify(locator))||JSON.stringify(f.tokens)!==JSON.stringify(raw.split('/').map(v=>v.trim()).filter(Boolean)))fail('麦橙适用机型与原文不一致');return {brand:f.brand?text(f.brand,100):null,raw,tokens:f.tokens.map(v=>text(v,1000)),locator,brandLocator:f.brandLocator?loc(f.brandLocator):null,semanticExpansion:false};});
  if(!primary.every(p=>cells.some(v=>v.raw===p)))fail('麦橙主型号不在原表');
  const sourceCode=typeof r.sourceCode==='string'?r.sourceCode.trim():'';if(sourceCode.length>30||sourceCode&&!cells.some(v=>v.raw===sourceCode))fail('麦橙原编号无法核对');
  const qualifiersRaw=(r.qualifiersRaw||[]).map(v=>text(v,1000));
  const fields={catalogKey:cfg.family+':'+r.key,family:cfg.family,sourceCode,sourceCodeOrigin:sourceCode?'source':'system-key-no-source-number',systemCatalogCode:cfg.code(r.key),series,filmType:series,filmTypeStatus:'source-explicit',qualifiersRaw,primaryModelsRaw:primary,fragments,sourceFile:source.file,sourceSHA256:source.sha256,sourceDigest,sourceCodeRaw:r.sourceCodeRaw||[],locators:r.locators.map(loc),sourceCellsDigest:digest(cells),unitConvention:'张为本系统默认计量约定；原表未提供单位',compatibilityNote:'保留原表适用关系和原文简写；不推断扩展机型，贴膜前核对实机、曲面与开孔'};
  return {externalCode:cfg.code(r.key),name:cfg.label+' '+series+' '+(sourceCode?sourceCode+' ':'')+primary.join(' / '),repairFilm:fields};
 });
 if(new Set(rows.map(r=>r.externalCode)).size!==rows.length)fail('麦橙商品编号重复');
 const contentDigest=digest({sourceDigest,rows});return {sourceDigest,contentDigest,sources:[source],rows:rows.map(r=>({...r,repairFilm:{...r.repairFilm,contentDigest,rowDigest:digest(r.repairFilm)}}))};
}
module.exports={prepareCatalog};
