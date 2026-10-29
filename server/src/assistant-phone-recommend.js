'use strict';
const c=require('./common'),erp=require('./erp'),money=require('./assistant-product-query');
const clean=v=>String(v??'').normalize('NFKC').trim();
const norm=v=>clean(v).toLowerCase().replace(/\s+/g,'');
const brands=[['华为','Huawei'],['荣耀','Honor'],['vivo'],['OPPO'],['苹果','iPhone','Apple'],['小米','Xiaomi'],['红米','Redmi'],['一加','OnePlus'],['iQOO'],['三星','Samsung']];
const usable=x=>x.active!==false&&x.enabled!==false&&!x.deleted&&!x.deletedAt&&!/^(inactive|disabled|deleted|off|停用|已停用|禁用|已删除|下架|已下架)$/i.test(clean(x.status));
function intent(question){
 const q=clean(question);
 return /手机|智能机|整机|华为|荣耀|vivo|oppo|iphone|小米|一加|iqoo/i.test(q)&&/推荐|帮我选|选一款|挑一款|买(?:一台|个|一部)?手机|想买|有哪些|有没有|有没得|有啥|哪款|哪种|多少钱|好多钱|什么型号/.test(q)&&!/毛利|利润|成本|进价|销售记录|卖了|售出|营业额|采购单|销售单|串号|维修|屏幕总成|配件|审批|删除|改价|调价|红冲|电子屏|入口|在哪个页面|功能编号|打开|跳转|怎么操作|如何操作|设置|启用|怎么实现/.test(q)&&!/不要.{0,4}手机|不买.{0,4}手机/.test(q);
}
function budget(question){
 const token='(\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]+)';
 const q=clean(question),strict=money.budgetOf(q);
 if(strict!==null)return {kind:'maximum',maximum:strict};
 const match=q.match(new RegExp('(?:预算|价格|价位|大概|大约|差不多)(?:是|为|在)?\\s*'+token+'\\s*(?:元|块)?(?:钱)?(?:左右|上下|出头)?'))||q.match(new RegExp(token+'\\s*(?:元|块)(?:钱)?\\s*(?:左右|上下)'));
 const value=match?money.spokenMoney(match[1]):null;
 if(value===null||!Number.isFinite(value)||value<=0)return null;
 return {kind:'approximate',target:value,minimum:Math.round(value*.8),maximum:Math.round(value*1.2),definition:'大概预算按上下两成展示比较，不当作顾客同意超预算购买。'};
}
function query(store,user,args={}){
 const question=clean(args.question||args.keyword).slice(0,1000);
 if(!user||user.status&&user.status!=='active')return {restricted:true,reason:'请使用在职账号查询手机商品。'};
 const caps=c.capabilities(user);
 if(!caps.sell&&!caps.purchase&&!caps.stocktake&&!caps.manageProducts)return {restricted:true,reason:'当前账号没有手机商品及库存查询权限。'};
 const known=erp.listProducts(store,user).filter(p=>usable(p)&&p.stockManaged!==false&&/^(智能机|智能手机|功能机|按键机|老人机|老年机)$/.test(clean(p.type)));
 const mentioned=brands.filter(group=>group.some(v=>norm(question).includes(norm(v))));
 const excluded=mentioned.filter(group=>group.some(v=>new RegExp('(?:不要|不买|不考虑|不选)'+v,'i').test(question)));
 const selected=mentioned.filter(x=>!excluded.includes(x));
 const matchBrand=(p,group)=>group.some(v=>[p.brand,p.subType,p.name].some(field=>norm(field).includes(norm(v))));
 const featureOnly=/按键机|功能机/.test(question),smartOnly=!featureOnly&&(/智能|华为|荣耀|vivo|oppo|iphone|小米|一加|iqoo/i.test(question)||!/老人机|老年机/.test(question));
 let catalog=known.filter(p=>(!featureOnly||/^(功能机|按键机|老人机|老年机)$/.test(clean(p.type)))&&(!smartOnly||/^(智能机|智能手机)$/.test(clean(p.type)))&&(!selected.length||selected.some(g=>matchBrand(p,g)))&&!excluded.some(g=>matchBrand(p,g)));
 const modelKey=p=>norm(clean(p.name).replace(/\s+(?:\d+\s*\+\s*\d+|\d+\s*[gtb]+)(?:\s*\([12]\))?$/i,'')).replace(/\([12]\)$/,'').replace(/^(?:华为|huawei|荣耀|honor|vivo|oppo|小米|xiaomi|一加|oneplus|iqoo)/i,'');
 const modelKeys=[...new Set(catalog.map(modelKey).filter(x=>x.length>=3))];
 const models=modelKeys.filter(key=>new RegExp(key.split('').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*')+'(?!\\s*[a-z0-9])','i').test(question));
 if(models.length)catalog=catalog.filter(p=>models.includes(modelKey(p)));
 const inventory=erp.inventory(store,user),limit=/全部|所有|详细|明细/.test(question)?15:3,b=budget(question);
 const publicRows=catalog.map(p=>{
  const stock=inventory.filter(r=>r.skuId===p.skuId&&(!p.warehouseId||r.warehouseId===p.warehouseId));
  const locations=new Map();for(const r of stock)locations.set(r.warehouseId,(locations.get(r.warehouseId)||0)+1);
  const qty=stock.reduce((sum,r)=>{if(locations.get(r.warehouseId)!==1||!usable(r)||r.status&&!/^(active|available|可售|正常|在库|未激活)$/i.test(clean(r.status)))return sum;
   const value=Number(r.quantity);if(!Number.isSafeInteger(value)||value<0)return sum;
   const serials=new Set((r.serials||[]).filter(s=>['可售','未激活'].includes(s.status)&&clean(s.no)).map(s=>clean(s.no)));
   return sum+(p.trackSerial?Math.min(value,serials.size):value);
  },0);
  const price=typeof p.salePrice!=='boolean'&&clean(p.salePrice)&&Number.isFinite(Number(p.salePrice))&&Number(p.salePrice)>0?c.round(Number(p.salePrice)):null;
  return {skuId:p.skuId,name:p.name,category:p.type,brand:selected.find(g=>matchBrand(p,g))?.[0]||brands.find(g=>matchBrand(p,g))?.[0]||'',salePrice:price,availableQuantity:qty};
 });
 const available=publicRows.filter(p=>p.availableQuantity>0),within=available.filter(p=>p.salePrice!==null&&(!b||p.salePrice<=b.maximum&&(b.kind!=='approximate'||p.salePrice>=b.minimum)));
 within.sort((a,z)=>b?.kind==='approximate'?Math.abs(a.salePrice-b.target)-Math.abs(z.salePrice-b.target)||a.salePrice-z.salePrice:a.salePrice-z.salePrice||a.name.localeCompare(z.name,'zh-CN'));
 const rows=within.slice(0,limit);
 return {asOf:c.now(),kind:'phone-recommendations',question,brands:selected.map(g=>g[0]),budget:b,
  counts:{catalogVersions:catalog.length,availableVersions:available.length,availableQuantity:available.reduce((n,p)=>n+p.availableQuantity,0),matchingVersions:within.length,matchingQuantity:within.reduce((n,p)=>n+p.availableQuantity,0),unpricedVersions:available.filter(p=>p.salePrice===null).length},models,
  rows,returnedVersions:rows.length,returnedQuantity:rows.reduce((n,p)=>n+p.availableQuantity,0),truncated:within.length>rows.length,fieldsAvailable:['商品型号','存储版本（名称原文）','当前零售价','当前可售数量'],
  limits:['整机分类和品牌先筛选，再截取推荐；维修屏幕总成和配件不属于手机整机。','这些是当前零售价与可售库存事实，不包含手机硬件配置或实测续航证据。','不能承诺待机三天、老人一定适用、屏幕效果或缺货订货日期；可请顾客现场体验字体音量并进一步核实参数。','部分或预算内无匹配不等于全店没有该品牌手机；区分品牌可售总数与条件匹配数。','只作咨询，不创建订单或改变任何账套记录。'],sources:[]};
}
module.exports={query,intent,budget};
