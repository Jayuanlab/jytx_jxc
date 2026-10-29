'use strict';
const c=require('./common'),erp=require('./erp');
const collections=['products','inventory','suppliers','purchases','openingImportBatches','stockTransfers','serialSourceCorrections','productCategoryCatalog'];
function compact(row){const result={...row};delete result.importSource;return result;}
const inStock=row=>row.stockManaged!==false&&Number(row.quantity)>0;
const supplierKey=source=>source.supplierId||(source.supplier?'name:'+source.supplier:'__unknown__');
const group=row=>String(row.subType||row.type||'其他商品').trim()||'其他商品';
function sources(row){return row.trackSerial?(row.serials||[]).filter(source=>source.inStock):row.stockSources?.length?row.stockSources:[{supplier:'',supplierId:''}];}
function supplierQuantity(row,supplier){
 if(!supplier)return Number(row.quantity);
 if(row.trackSerial)return (row.serials||[]).filter(source=>source.inStock&&supplierKey(source)===supplier).length+(supplier==='__unknown__'?Math.max(0,Number(row.serialDifference||0)):0);
 const keys=new Set(sources(row).map(supplierKey));
 return keys.size===1&&keys.has(supplier)?Number(row.quantity):null;
}
const category=row=>require('./product-categories').pathOf(row)[0]||'未分类';
function filterOptions(rows,products,paths){
 const suppliers=new Map(),groups=new Set(),categories=new Map();
 const include=first=>{if(!categories.has(first))categories.set(first,{groups:new Set(),stockProducts:0,serviceProducts:0});return categories.get(first);};
 for(const row of paths){if(row.path?.[0])include(category({type:row.path[0]}));}
 for(const product of products){const item=include(category(product));if(product.stockManaged===false)item.serviceProducts++;else{item.stockProducts++;item.groups.add(group(product));}}
 for(const row of rows.filter(inStock)){
  groups.add(group(row));
  for(const source of sources(row))suppliers.set(supplierKey(source),source.supplier||'供货来源待补');
  if(row.trackSerial&&Number(row.serialDifference)>0)suppliers.set('__unknown__','供货来源待补');
 }
 return {categories:[...categories.keys()].sort((a,b)=>a.localeCompare(b,'zh-CN')),categoryInfo:[...categories].map(([category,row])=>({category,stockProducts:row.stockProducts,serviceProducts:row.serviceProducts})),productGroupsByCategory:[...categories].map(([category,row])=>({category,productGroups:[...row.groups].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}))})),suppliers:[...suppliers].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),productGroups:[...groups].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}))};
}
function get(store,user,{history=false,options=false,warehouse='',supplier='',productGroup='',category:requestedCategory=''}={}){
 c.permit(user,'learn');
 const all=erp.inventory(store,user);
 const paths=require('./product-categories').list(store,user).paths;
 const choices=filterOptions(all,store.products,paths);
 if(options)return {inventory:[],products:[],warehouses:require('./warehouses').WAREHOUSES,filterOptions:choices,asOf:c.now(),optionsOnly:true};
 const inventory=all.filter(row=>(history||row.stockManaged===false||Number(row.quantity)!==0||(row.serials||[]).some(source=>source.inStock))&&(!requestedCategory||category(row)===requestedCategory)&&(!warehouse||row.warehouseId===warehouse)&&(!productGroup||group(row)===productGroup)&&(!supplier||sources(row).some(source=>supplierKey(source)===supplier)||(supplier==='__unknown__'&&row.trackSerial&&Number(row.serialDifference)>0))).map(row=>{const matched=supplierQuantity(row,supplier);return {...compact(row),inventoryCategory:category(row),inventoryProductGroup:group(row),warehouseTotalQuantity:Number(row.quantity),supplierMatchedQuantity:matched,supplierQuantityKnown:matched!==null,serials:(row.serials||[]).filter(source=>(history||source.inStock)&&(!supplier||supplierKey(source)===supplier)).map(compact)};});
 const skuIds=new Set(inventory.map(row=>row.skuId));
 const products=erp.listProducts(store,user).filter(row=>!warehouse&&!supplier&&!productGroup&&!requestedCategory||skuIds.has(row.skuId)).map(compact);
 return {inventory,products,warehouses:require('./warehouses').WAREHOUSES,filterOptions:choices,categoryPaths:paths,searchSynonyms:store.searchSynonyms||[],asOf:c.now(),historyIncluded:history};
}
module.exports={collections,get};
