'use strict';
const c=require('./common');
const norm=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
const prefix=(a,b)=>a.length>=b.length&&b.every((v,i)=>norm(a[i])===norm(v));
function remove(store,user,payload){
 const actual=require('./staff-rename').owner(store,user);
 if(!payload||Object.keys(payload).some(k=>!['id','warehouseId','path'].includes(k)))throw new c.HttpError(400,'删除分类的资料不正确');
 const id=c.text(payload.id,'分类编号'),path=payload.path;
 if(!Array.isArray(path)||path.length<1||path.length>3||path.some(x=>typeof x!=='string'||!x.trim()||x.length>40||/[\x00-\x1f\x7f]/.test(x)))throw new c.HttpError(400,'分类路径不正确');
 const catalog=store.productCategoryCatalog;
 if(!catalog||catalog.version!==1||!Array.isArray(catalog.paths))throw new c.HttpError(409,'分类资料已变化，请刷新');
 const matches=catalog.paths.filter(row=>row.path.length===path.length&&prefix(row.path,path));
 if(matches.length!==1||matches[0].id!==id)throw new c.HttpError(409,'分类已变化或旧仓库分类重名，请先整理后再删除');
 const row=matches[0];
 if(catalog.paths.some(x=>x!==row&&prefix(x.path,path)))throw new c.HttpError(409,'还有下级分类，请先处理下级资料');
 const normalizeType=require('./display-preferences').normalizeType;
 const products=(store.products||[]).filter(x=>prefix([normalizeType(x),x.subType,x.thirdType],path));
 if(products.length)throw new c.HttpError(409,'已有'+products.length+'条商品档案，库存为零也不能删除该分类');
 if((store.masterDataRequests||[]).some(r=>r.status==='待审核'&&(r.path==='/api/products'?prefix([normalizeType(r.payload),r.payload.subType,r.payload.thirdType],path):r.path==='/api/product-category-paths'&&prefix(r.payload.parentPath||[],path))))throw new c.HttpError(409,'还有使用此分类的待审资料，请先处理申请');
 const at=c.now();(store.deletedEmptyCategories||=[]).push({id:c.id('PCD'),original:structuredClone(row),deletedAt:at,deletedBy:actual.id});catalog.paths=catalog.paths.filter(x=>x!==row);
 for(const review of store.catalogAdditionReviews||[])if(review.kind==='category'&&review.sourceId===id){review.status='已撤销';review.reviewedAt=at;review.reviewerId=actual.id;(review.events||=[]).push({type:'删除空分类',at,by:actual.id});for(const notice of store.localCatalogNotices||[])if(notice.key==='catalog-addition:'+review.id&&!notice.readAt)notice.readAt=at;}
 for(const pref of store.displayPreferences||[])if(pref.page==='catalog'&&pref.parentPath?.length===path.length-1&&prefix(path,pref.parentPath)&&pref.order?.includes(path.at(-1))){pref.order=pref.order.filter(n=>n!==path.at(-1));pref.revision++;pref.updatedAt=at;}
 c.audit(store,actual,'product-category:delete-empty',JSON.stringify({id,path}));return {id,path,message:'空分类已删除，库存和账目未改变'};
}
module.exports={remove};
