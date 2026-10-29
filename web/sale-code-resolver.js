(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SaleCodeResolver=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const value=v=>v==null?'':String(v),key=p=>JSON.stringify([p.skuId,p.warehouseId||'']),tracked=p=>p.trackSerial===true||p.serialRequired===true;
 function resolve(inventory,cart,raw,options={}){
  const original=value(raw).trim(),qr=original.startsWith('JY1:'),code=qr?original.slice(4):original,rows=Array.isArray(inventory)?inventory:[],items=(cart||[]).filter((_,i)=>i!==options.excludeIndex),warehouses=options.warehouses||[];
  if(!code||code.length>120)return{code,candidates:[],selectionRequired:false,message:'请扫描完整商品条码、JY编号或手机串号'};
  const serialMatches=qr?[]:rows.filter(p=>tracked(p)&&(p.serials||[]).some(s=>value(s.no)===code));
  const exact=p=>qr?value(p.skuId)===code:[p.skuId,p.externalCode,p.barcode,...(!tracked(p)&&p.stockManaged!==false?[p.sourceBarcode]:[]),...(p.legacyExternalCodes||[])].some(v=>v!=null&&value(v)===code);
  const found=serialMatches.length?serialMatches:rows.filter(exact),seen=new Set(),candidates=[];
  for(const p of found){const stockKey=key(p);if(seen.has(stockKey)){const old=candidates.find(x=>x.stockKey===stockKey);old.available=false;old.reason='同商品同仓库存记录重复，请核对库存';continue;}seen.add(stockKey);
   const wh=warehouses.find(w=>w.id===p.warehouseId),serial=serialMatches.length?(p.serials||[]).find(s=>value(s.no)===code):null,committed=items.filter(i=>i.skuId===p.skuId&&(!i.warehouseId||value(i.warehouseId)===value(p.warehouseId))).reduce((n,i)=>n+Number(i.quantity||0),0),remaining=p.stockManaged===false?Infinity:Math.max(0,Number(p.quantity||0)-committed);
   let reason=p.active===false?'商品已停用':p.stockManaged!==false&&!p.warehouseId?'实际仓库待补':p.stockManaged!==false&&options.warehouses&&!wh?'不属于有效出库仓库':wh?.active===false?'仓库已停用':remaining<=0?'本仓无可售库存':'';
   if(!reason&&serial&&!['可售','未激活'].includes(serial.status))reason='该完整串号当前不可售';
   if(!reason&&serial&&items.some(i=>i.serialNo===serial.no))reason='该完整串号已加入本单';
   if(!reason&&tracked(p)&&!serial&&!(p.serials||[]).some(s=>['可售','未激活'].includes(s.status)&&!items.some(i=>i.serialNo===s.no)))reason='本仓没有可售完整串号';
   candidates.push({product:p,skuId:p.skuId,warehouseId:p.warehouseId||'',warehouseName:wh?.name||p.warehouseName||p.warehouseId||'服务项目',stockKey,name:p.name,code:p.externalCode||p.skuId,sourceBarcode:value(p.sourceBarcode||p.barcode),remaining,serialNo:serial?.no||'',available:!reason,reason});
  }
  return {code,candidates,selectionRequired:candidates.length>1,message:candidates.length?'':'未找到该完整条码或串号对应的商品，请核对原码或商品档案'};
 }
 function present(result,{host,onPick,onMessage=()=>{},autoPick=true}){
  const rows=result.candidates||[];if(autoPick&&rows.length===1&&rows[0].available){onPick(rows[0]);return true;}
  if(!rows.length){onMessage(result.message||'未找到对应商品',true);return false;}
  const doc=host.ownerDocument;host.replaceChildren();const box=doc.createElement('section'),title=doc.createElement('strong'),note=doc.createElement('p'),search=doc.createElement('input'),list=doc.createElement('div');box.className='sale-code-candidates';box.setAttribute('aria-label','选择准确商品和出库仓库');title.textContent='条码 '+result.code+' 对应 '+rows.length+' 个商品/仓库';note.textContent='请核对具体型号和实际出库仓库，再点选；缺货或停用项不可加入。';search.type='search';search.placeholder='筛选型号、JY编号或仓库';search.setAttribute('aria-label','筛选扫码候选商品');search.autocomplete='off';box.append(title,note,search,list);host.append(box);
  const render=()=>{list.replaceChildren();const terms=search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);for(const row of rows){if(!terms.every(t=>[row.name,row.code,row.warehouseName].join(' ').toLowerCase().includes(t)))continue;const button=doc.createElement('button'),name=doc.createElement('strong'),detail=doc.createElement('span');button.type='button';button.disabled=!row.available;button.dataset.saleStockKey=row.stockKey;name.textContent=row.name;detail.textContent=row.code+' · '+row.warehouseName+(row.sourceBarcode?' · 原厂条码 '+row.sourceBarcode:'')+' · '+(row.available?'可加入 '+(row.remaining===Infinity?'服务项目':row.remaining):row.reason);button.append(name,detail);button.addEventListener('click',()=>{if(!row.available)return;onPick(row);});list.append(button);}if(!list.children.length){const empty=doc.createElement('p');empty.textContent='没有匹配的候选，请换个型号或仓库关键词';list.append(empty);}};search.addEventListener('input',render);render();onMessage(rows.length>1?'共享条码：请明确选择型号和出库仓库':rows[0].available?'请核对商品和实际出库仓库':rows[0].reason,!rows.some(r=>r.available));return false;
 }
 return{resolve,present,stockKey:key};
});
