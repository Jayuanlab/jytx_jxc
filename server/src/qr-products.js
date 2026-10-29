const c=require('./common'),PREFIX='JY1:',tracked=require('./inventory-details').tracked;
function canPrint(user){const caps=c.capabilities(user);return caps.manageProducts||caps.purchase;}
function permitPrint(user){if(!canPrint(user))throw new c.HttpError(403,'当前账号没有商品标签权限');}
function eligible(p){return p&&p.active!==false&&p.stockManaged!==false&&!tracked(p);}
function encode(p){if(!eligible(p))throw new c.HttpError(400,'只有按数量管理的在售商品才能生成商品二维码');return PREFIX+p.skuId;}
function list(store){return store.products.filter(eligible).map(p=>({skuId:p.skuId,code:p.externalCode,name:p.name,unit:p.unit||'件',salePrice:p.salePrice,quantity:store.inventory.filter(s=>s.skuId===p.skuId).reduce((n,s)=>n+Number(s.quantity||0),0)})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));}
function resolve(store,raw,selection={}){
 const code=String(raw||'').trim();if(!code||code.length>120)throw new c.HttpError(400,'请扫描完整商品条码、二维码或JY编号');const qr=code.startsWith(PREFIX),key=qr?code.slice(PREFIX.length):code;
 const products=store.products.filter(p=>p.stockManaged!==false&&!tracked(p)&&(qr?String(p.skuId)===key:[p.skuId,p.externalCode,p.barcode,p.sourceBarcode,...(p.legacyExternalCodes||[])].some(v=>v!=null&&String(v)===key)));
 if(!products.length)throw new c.HttpError(404,'未找到该完整条码对应的按数量商品；手机请使用完整串号流程');
 const warehouses=require('./warehouse-directory').list(store,true),candidates=[];
 for(const p of products){const stocks=(store.inventory||[]).filter(s=>s.skuId===p.skuId),rows=stocks.length?stocks:[{skuId:p.skuId,warehouseId:p.warehouseId,quantity:0}];for(const stock of rows){const warehouseId=stock.warehouseId||'',warehouse=warehouses.find(w=>w.id===warehouseId),duplicates=rows.filter(s=>s.warehouseId===stock.warehouseId).length>1,quantity=Number(stock.quantity||0),reason=p.active===false?'商品已停用':!warehouseId||!warehouse?'实际仓库待补':warehouse.active===false?'仓库已停用':duplicates?'同商品同仓库存记录重复':quantity<=0?'本仓无可售库存':'';if(candidates.some(r=>r.skuId===p.skuId&&r.warehouseId===warehouseId))continue;candidates.push({skuId:p.skuId,warehouseId,warehouseName:warehouse?.name||stock.warehouseName||warehouseId||'仓库待补',name:p.name,code:p.externalCode,sourceBarcode:String(p.sourceBarcode||p.barcode||''),unit:p.unit||'件',salePrice:p.salePrice,quantity,saleQuantity:quantity,available:!reason,reason});}}
 let selected;if(selection.skuId||selection.warehouseId){if(!selection.skuId||!selection.warehouseId)throw new c.HttpError(400,'请选择完整的商品和实际出库仓库');selected=candidates.find(p=>p.skuId===selection.skuId&&p.warehouseId===selection.warehouseId);if(!selected)throw new c.HttpError(403,'所选商品与仓库不属于本次完整条码候选');if(!selected.available)throw new c.HttpError(409,selected.reason);}else if(candidates.length===1&&candidates[0].available)selected=candidates[0];
 return {...(selected||{}),scannedCode:code,selectionRequired:candidates.length>1&&!selected,candidates,warehouses:selected?[{id:selected.warehouseId,name:selected.warehouseName,quantity:selected.quantity}]:[],message:selected?'已识别，请核对具体型号和实际出库仓库':candidates.length>1?'共享条码，请选择具体型号和实际出库仓库':'该商品当前不可售'};
}
async function svg(p){return require('qrcode').toString(encode(p),{type:'svg',errorCorrectionLevel:'M',margin:4,width:240});}
module.exports={canPrint,permitPrint,PREFIX,eligible,encode,list,resolve,svg};
