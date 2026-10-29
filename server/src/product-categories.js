'use strict';
// Old 443 only. POST is called within the existing authenticated repository transaction.
const c=require('./common');
const kind=product=>product.type==='智能手机'?'智能机':product.type==='二手机'?'二手手机':product.type==='其他数码'?'数码产品':/^(配件和维修|配件\s*[/／]\s*维修)$/.test(product.type||'')?(product.stockManaged===false?'维修':'配件'):product.type;
const pathKey=path=>JSON.stringify(path.map(v=>String(v).normalize('NFKC').trim().toLowerCase()));
function cleanName(value){
  const name=c.text(value,'分类名称').normalize('NFKC');
  if(name.length>40||/[\x00-\x1f\x7f/／\\]/.test(name)||['__proto__','prototype','constructor','待归类'].includes(name))throw new c.HttpError(400,'分类名称限40字，不要填写斜线、换行或待归类');
  return name;
}
function explicit(store){
  const value=store.productCategoryCatalog;
  if(value==null)return [];
  if(value.version!==1||!Array.isArray(value.paths))throw new c.HttpError(409,'分类目录格式异常，请联系管理员核对');
  return value.paths;
}
function pathOf(product){const path=[kind(product),product.subType,product.thirdType],gap=path.findIndex(v=>!String(v||'').trim());return (gap<0?path:path.slice(0,gap)).map(v=>String(v).trim());}
function allPaths(store){
  const found=new Map(),include=path=>{for(let n=1;n<=path.length;n++){const part=path.slice(0,n);found.set(pathKey(part),part);}};
  for(const p of store.products||[])include(pathOf(p));
  for(const row of explicit(store))include(row.path);
  return found;
}
function list(store){return {version:1,levels:3,paths:[...allPaths(store).values()].map(path=>({path}))};}
function add(store,user,data){
  c.permit(user,'catalogAdd');
  if(!Array.isArray(data.parentPath)||data.parentPath.length>2)throw new c.HttpError(400,'分类最多三级，请选择有效上级');
  const requestedParent=data.parentPath.map(cleanName),name=cleanName(data.name),existing=allPaths(store);
  const parent=requestedParent.length?existing.get(pathKey(requestedParent)):[];
  if(!parent)throw new c.HttpError(409,'上级分类不存在或已变化，请刷新后重试');
  const path=[...parent,name];
  if(existing.has(pathKey(path)))throw new c.HttpError(409,'这个位置已有同名分类，请直接选择');
  if(explicit(store).length>=10000)throw new c.HttpError(409,'分类数量过多，请先联系管理员整理');
  const entry={id:c.id('PC'),path,createdAt:c.now(),createdBy:user.id,name:path.join(' / ')};
  store.productCategoryCatalog={version:1,paths:[...explicit(store),entry]};
  c.audit(store,user,'product-category:create',path.join(' / '));
  require('./catalog-reviews').recordAddition(store,user,{kind:'category',sourceId:entry.id,name:entry.name});
  return {path:path.slice(),message:'分类已保存：'+path.join(' / ')};
}
module.exports={list,add,allPaths,pathOf};
