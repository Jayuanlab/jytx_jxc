'use strict';
const c=require('./common');
function owner(store,user){const actual=c.userById(store,user?.id);if(actual.roleCode!=='owner'||user.roleCode!=='owner'||actual.status!=='active'||actual.assistantCustomerOnly)throw new c.HttpError(403,'商品停用与恢复由老板处理');return actual;}
function change(store,user,data){
 const actual=owner(store,user);if(!data||Object.keys(data).some(k=>!['action','skuId','active','expectedActive','expectedName'].includes(k))||data.action!=='setActive'||typeof data.active!=='boolean'||typeof data.expectedActive!=='boolean')throw new c.HttpError(400,'商品状态资料不正确');
 const matches=store.products.filter(p=>p.skuId===data.skuId);if(matches.length!==1)throw new c.HttpError(409,'商品不存在或编号不唯一，请刷新');const row=matches[0];if(data.expectedName!==row.name||(row.active!==false)!==data.expectedActive)throw new c.HttpError(409,'商品资料或状态已变化，请刷新后再处理');
 if(data.active===(row.active!==false))return {skuId:row.skuId,active:data.active,message:'状态没有变化'};
 if(!data.active){const stocks=store.inventory.filter(s=>s.skuId===row.skuId);if(stocks.some(s=>!Number.isFinite(Number(s.quantity))||Number(s.quantity)!==0||s.stockValue!=null&&(!Number.isFinite(Number(s.stockValue))||Number(s.stockValue)!==0)||(s.serials||[]).some(x=>x.inStock===true||['可售','未激活','在库'].includes(x.status))))throw new c.HttpError(409,'该商品仍有库存或库存成本，请先核对处理，不能停用');
 if((store.procurementPlans||[]).some(p=>p.status==='open'&&(p.items||[]).some(i=>i.skuId===row.skuId&&Number(i.quantity)>Number(i.received||0))))throw new c.HttpError(409,'该商品还有未收齐订货单，请先处理订货');
 if((store.masterDataRequests||[]).some(r=>r.status==='待审核'&&r.payload?.skuId===row.skuId))throw new c.HttpError(409,'该商品还有待审核的资料修改，请先处理');}
 row.active=data.active;row.statusChangedAt=c.now();row.statusChangedBy=actual.id;
 c.audit(store,actual,'product:status',JSON.stringify({skuId:row.skuId,name:row.name,active:row.active}));return {skuId:row.skuId,active:row.active,message:row.active?'商品已恢复，可重新选用':'商品已停用，已从常用商品和分类树隐藏；历史单据保留，可随时恢复'};
}
module.exports={owner,change};
