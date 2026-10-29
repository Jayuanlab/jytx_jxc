'use strict';
const c=require('./common'),warehouses=require('./warehouses'),origins=require('./inventory-details');
const categories=require('./product-categories');
const UNKNOWN='__unknown__',SERVICE='__service__';
function filters(query){
 const text=key=>String(query.get(key)||'').trim().slice(0,160);
 const from=text('from'),to=text('to');
 const parse=value=>{
  if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value))throw new c.HttpError(400,'请选择正确的日期和时间');
  const [date,time='00:00']=value.split('T');
  if(!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new c.HttpError(400,'日期或时间不正确');
  return Date.parse(date+'T'+time+':00+08:00');
 };
 let start=from?parse(from):null,end=to?parse(to)+(to.includes('T')?60000:86400000):null;
 if(start!=null&&end!=null&&start>=end)throw new c.HttpError(400,'开始时间不能晚于结束时间');
 const page=Number(query.get('page')||1),limit=Number(query.get('limit')||30);
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new c.HttpError(400,'分页参数不正确');
 const saleState=text('saleState');if(!['','returns_red','returned','red','normal'].includes(saleState))throw new c.HttpError(400,'单据状态不正确');
 const kind=text('kind');if(!['','sale','repair','mobile'].includes(kind))throw new c.HttpError(400,'业务类型不正确');
 const mobilePage=Number(query.get('mobilePage')||1);if(!Number.isSafeInteger(mobilePage)||mobilePage<1)throw new c.HttpError(400,'移动业务页码不正确');
 return {from,to,start,end,page,limit,kind,separateMobile:query.get('separateMobile')==='1',mobilePage,saleState,category:text('category'),brand:text('brand'),q:text('q').toLowerCase(),warehouse:text('warehouse'),salesperson:text('salesperson'),product:text('product'),supplier:text('supplier')};
}
function sourceKey(s){return s.supplierId||(s.supplier?'name:'+s.supplier:UNKNOWN);}
function source(store,order,quantity){const supplier=(store.suppliers||[]).find(s=>s.id===order?.supplierId);return {purchaseId:order?.id||'',supplierId:order?.supplierId||'',supplier:order?.supplier||supplier?.name||'',quantity};}

// Historical quantity sources are documentary FIFO origins, never the current SKU default supplier.
function quantitySourceIndex(store){
 const sources=new Map(),transfers=new Map(),add=(map,key,row)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(row);};
 for(const order of store.purchases||[])for(const item of order.items||[]){
  const warehouseId=item.warehouseId||order.warehouseId;
  if(item.warehouseId&&order.warehouseId&&item.warehouseId!==order.warehouseId)continue;
  add(sources,item.id,{kind:'purchase',order,item,skuId:item.skuId,warehouseId,quantity:Number(item.quantity),createdAt:order.createdAt});
 }
 for(const batch of store.openingImportBatches||[])for(const item of batch.products||[]){
  const warehouseId=item.warehouseId||batch.warehouseId;
  if(item.warehouseId&&batch.warehouseId&&item.warehouseId!==batch.warehouseId)continue;
  add(sources,item.sourceId,{kind:'opening',batch,item,skuId:item.skuId,warehouseId,quantity:Number(item.quantity),createdAt:batch.createdAt});
 }
 const ids=new Map();for(const row of store.stockTransfers||[])if(row.id)ids.set(row.id,(ids.get(row.id)||0)+1);
 for(const row of store.stockTransfers||[]){
  if(row.status!=='completed'||!row.id||ids.get(row.id)!==1||!row.sourceSkuId||!row.targetSkuId||!row.sourceWarehouseId||!row.targetWarehouseId||!Number.isFinite(Date.parse(row.createdAt))||!Number.isFinite(Number(row.quantity))||!(Number(row.quantity)>0))continue;
  const parts=new Map();for(const part of row.sourceCostSources||[])if(part.sourceId&&Number.isFinite(Number(part.quantity))&&Number(part.quantity)>0)parts.set(part.sourceId,(parts.get(part.sourceId)||0)+Number(part.quantity));
  if([...parts.values()].reduce((total,quantity)=>total+quantity,0)>Number(row.quantity)+1e-6)continue;
  for(const[sourceId,quantity]of parts)add(transfers,sourceId,{...row,quantity,at:Date.parse(row.createdAt)});
 }
 return {sources,transfers};
}
function quantityReached(refs,origin,item,sourceId,quantity,saleAt){
 const epsilon=1e-6,key=(sku,warehouse)=>JSON.stringify([sku,warehouse]),start=key(origin.skuId,origin.warehouseId),target=key(item.skuId,item.warehouseId),originAt=Date.parse(origin.createdAt);
 if(!origin.skuId||!origin.warehouseId||!item.skuId||!item.warehouseId||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(origin.quantity)||origin.quantity+epsilon<quantity||!Number.isFinite(saleAt)||Number.isFinite(originAt)&&originAt>saleAt)return false;
 if(start===target)return true;
 const edges=(refs.transfers.get(sourceId)||[]).filter(row=>row.at<=saleAt&&(!Number.isFinite(originAt)||row.at>=originAt));
 if(!edges.length)return false;
 // Time-expanded flow proves the exact source quantity reached this SKU and warehouse before sale.
 const timeline=new Map(),addTime=(node,at)=>{if(!timeline.has(node))timeline.set(node,new Set());timeline.get(node).add(at);},initial=Number.isFinite(originAt)?originAt:Math.min(...edges.map(row=>row.at))-1;
 addTime(start,initial);addTime(target,saleAt);
 for(const row of edges){addTime(key(row.sourceSkuId,row.sourceWarehouseId),row.at);addTime(key(row.targetSkuId,row.targetWarehouseId),row.at);}
 const graph=new Map(),edge=(a,b,capacity)=>{if(!graph.has(a))graph.set(a,[]);if(!graph.has(b))graph.set(b,[]);const forward={to:b,capacity,reverse:graph.get(b).length},reverse={to:a,capacity:0,reverse:graph.get(a).length};graph.get(a).push(forward);graph.get(b).push(reverse);},node=(id,at)=>JSON.stringify([id,at]);
 for(const[id,times]of timeline){const sorted=[...times].sort((a,b)=>a-b);for(let i=1;i<sorted.length;i++)edge(node(id,sorted[i-1]),node(id,sorted[i]),quantity);}
 for(const row of edges)edge(node(key(row.sourceSkuId,row.sourceWarehouseId),row.at),node(key(row.targetSkuId,row.targetWarehouseId),row.at),Math.min(quantity,row.quantity));
 const sourceNode=node(start,initial),targetNode=node(target,saleAt);let flow=0;
 while(flow+epsilon<quantity){
  const queue=[sourceNode],parents=new Map([[sourceNode,null]]);for(let cursor=0;cursor<queue.length&&!parents.has(targetNode);cursor++){const id=queue[cursor];for(const[eIndex,e]of(graph.get(id)||[]).entries())if(e.capacity>epsilon&&!parents.has(e.to)){parents.set(e.to,{id,eIndex});queue.push(e.to);}}
  if(!parents.has(targetNode))return false;let amount=quantity-flow;
  for(let id=targetNode;id!==sourceNode;){const p=parents.get(id),e=graph.get(p.id)[p.eIndex];amount=Math.min(amount,e.capacity);id=p.id;}
  for(let id=targetNode;id!==sourceNode;){const p=parents.get(id),e=graph.get(p.id)[p.eIndex];e.capacity-=amount;graph.get(id)[e.reverse].capacity+=amount;id=p.id;}flow+=amount;
 }
 return true;
}
function quantitySource(store,refs,order,item,part){
 const quantity=Number(part.quantity||0),matches=(refs.sources.get(part.sourceId)||[]).filter(origin=>quantityReached(refs,origin,item,part.sourceId,quantity,Date.parse(order.createdAt)));
 if(matches.length!==1)return source(store,null,quantity);
 const origin=matches[0];if(origin.kind==='purchase')return source(store,origin.order,quantity);
 const supplier=(store.suppliers||[]).find(row=>row.id===origin.item.supplierId);
 return {purchaseId:'',supplierId:origin.item.supplierId||'',supplier:origin.item.supplier||supplier?.name||'',quantity};
}
function lineSources(store,refs,order,item){
 if(item.stockManaged===false)return [{supplierId:SERVICE,supplier:'服务项目',quantity:Number(item.quantity)}];
 if(item.serialNo){const current=require('./serial-sources').forSale(store,item,refs);if(current)return [{...current,quantity:Number(item.quantity)}];}
 if(item.supplySources?.length)return item.supplySources;
 if(item.serialNo){
  const matches=(refs.serials.get(JSON.stringify([item.skuId,item.serialNo]))||[])
   .filter(x=>(!x.item.warehouseId||!item.warehouseId||x.item.warehouseId===item.warehouseId)&&Date.parse(x.order.createdAt)<=Date.parse(order.createdAt));
  const selected=item.purchaseId?matches.filter(x=>x.order.id===item.purchaseId):matches;
  // Duplicate origin records are not guessed: keep them visibly unassigned.
  return [source(store,selected.length===1?selected[0].order:null,Number(item.quantity))];
 }
 const quantityRefs=refs.quantitySources||quantitySourceIndex(store);
 return (item.costSources?.length?item.costSources:[{quantity:Number(item.quantity)}]).map(part=>quantitySource(store,quantityRefs,order,item,part));
}
function allocations(store,refs,order,item){
 const groups=new Map(),qty=Number(item.quantity||0);
 for(const s of lineSources(store,refs,order,item)){
  if(!(s.quantity>0))continue;const id=sourceKey(s);
  const group=groups.get(id)||{id,name:s.supplier||(id===SERVICE?'服务项目':'来源待补'),quantity:0,purchases:[]};
  group.quantity+=Number(s.quantity);if(s.purchaseId&&!group.purchases.includes(s.purchaseId))group.purchases.push(s.purchaseId);groups.set(id,group);
 }
 let rows=[...groups.values()],total=rows.reduce((n,s)=>n+s.quantity,0);
 if(!total)return [{id:UNKNOWN,name:'来源待补',quantity:qty,purchases:[],weight:1}];
 if(total<qty-1e-6){rows.push({id:UNKNOWN,name:'来源待补',quantity:qty-total,purchases:[]});total=qty;}
 return rows.map(s=>({...s,quantity:s.quantity/total*qty,weight:s.quantity/total}));
}
function shares(rows,totals){
 let netLeft=Math.round(totals.netAmount*100),returnedLeft=Math.round(totals.returnedAmount*100),profitLeft=totals.netProfit==null?null:Math.round(totals.netProfit*100);
 return rows.map((s,index)=>{
  const last=index===rows.length-1,net=last?netLeft:Math.round(totals.netAmount*100*s.weight),ret=last?returnedLeft:Math.round(totals.returnedAmount*100*s.weight);
  netLeft-=net;returnedLeft-=ret;
  const profit=profitLeft===null?null:last?profitLeft:Math.round(totals.netProfit*100*s.weight);if(profitLeft!==null)profitLeft-=profit;
  return {...s,quantity:totals.quantity*s.weight,returnedQuantity:totals.returnedQuantity*s.weight,netQuantity:totals.netQuantity*s.weight,netAmount:net/100,returnedAmount:ret/100,grossAmount:(net+ret)/100,...('netProfit' in totals?{netProfit:profit===null?null:profit/100}:{})};
 });
}
function options(store,user,orders,rows){
 const pairs=(catalog,historical)=>[...new Map([...catalog,...historical].filter(x=>x&&x.id!=null&&x.id!=='').map(x=>[x.id,{id:x.id,name:String(x.name||x.id||'未命名')}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const caps=c.capabilities(user);
 const people=(store.users||[]).filter(u=>!u.assistantCustomerOnly&&u.roleCode!=='customer-assistant'&&(caps.allSales||u.id===user.id)).map(u=>({id:u.id,name:u.name}));
 return {
  categoryPaths:categories.list(store).paths,
  warehouses:pairs(warehouses.WAREHOUSES||warehouses.list(),rows.map(r=>({id:r.warehouseId||SERVICE,name:r.warehouseName}))),
  salespeople:pairs(people,orders.map(o=>({id:o.salespersonId||o.operatorId,name:o.salesperson||o.operator||'未记录营业员'}))),
  products:pairs((store.products||[]).map(p=>({id:p.skuId,name:p.name})),rows.map(r=>({id:r.skuId,name:r.name}))),
  suppliers:pairs((store.suppliers||[]).map(s=>({id:s.id,name:s.name})),rows.flatMap(r=>r.suppliers))
 };
}
function returnedAmountForLine(store,order,item){
 const quantity=Number(item.quantity||0),returned=Math.min(quantity,Math.max(0,Number(item.returnedQuantity||0))),gross=c.round(Number(item.amount??quantity*Number(item.salePrice||0)));
 if(order.redReversedBy)return gross;if(!returned)return 0;
 const rows=(store.saleReturns||[]).filter(r=>r.orderId===order.id).flatMap(r=>(r.items||[]).filter(i=>i.itemId===item.id));
 if(rows.length&&rows.every(i=>Number.isSafeInteger(i.quantity)&&i.quantity>0&&i.amount!==null&&i.amount!==undefined&&i.amount!==''&&Number.isFinite(Number(i.amount))&&Number(i.amount)>=0)&&rows.reduce((n,i)=>n+i.quantity,0)===returned)return c.round(rows.reduce((n,i)=>n+Number(i.amount),0));
 return c.round(gross*(quantity?returned/quantity:0));
}
function profits(store,order){
 const items=order.items||[],total=items.reduce((n,i)=>n+Math.max(0,Number(i.amount??Number(i.quantity||0)*Number(i.salePrice||0))),0);
 const gift=Math.round(Number(order.giftCost||0)*100);let cumulative=0,allocated=0;
 const valid=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
 return items.map((i,index)=>{
  const quantity=Number(i.quantity||0),returned=Math.min(quantity,Math.max(0,Number(i.returnedQuantity||0))),gross=c.round(Number(i.amount??quantity*Number(i.salePrice||0)));
  cumulative+=Math.max(0,gross);
  const giftCents=index===items.length-1?gift:Math.round(gift*(total?cumulative/total:(index+1)/items.length)),giftPart=(giftCents-allocated)/100;allocated=giftCents;
  if(order.redReversedBy)return 0;
  const cost=valid(i.cost)?Number(i.cost):valid(i.costPrice)?Number(i.costPrice)*quantity:valid(i.profit)?gross-Number(i.profit):null;
  if(cost===null||cost<0)return null;
  const adjustment=(store.costAdjustments||[]).filter(a=>a.orderId===order.id&&a.itemId===i.id).reduce((n,a)=>n+Number(a.costDelta||0),0);
  const fifo=require('./fifo-costs'),layers=i.costSources,exact=i.stockManaged!==false&&fifo.layered(layers)&&layers.reduce((n,p)=>n+p.quantity,0)===quantity;
  const returnedCost=i.stockManaged===false?0:exact?fifo.total(fifo.slice(layers,0,returned)):quantity?c.round(cost*returned/quantity):0;
  const retainedCost=c.round(cost-returnedCost+adjustment);
  const netAmount=c.round(gross-returnedAmountForLine(store,order,i));
  return c.round(netAmount-retainedCost-giftPart);
 });
}

// Mobile registrations are operational records, not retail revenue. Keep their
// recharge face value and expected carrier commission separate from sale totals.
function mobileBusinessRows(store,user,f){
 const caps=c.capabilities(user),services=store.carrierServices||[],air=(store.airRechargeEvents||[]).filter(row=>row.kind==='customer_recharge');
 const linked=new Map();for(const row of air)if(row.reference){const matches=services.filter(service=>service.type==='recharge'&&service.externalOrderNo===row.reference&&service.serviceDate===row.businessDate);if(matches.length===1&&!linked.has(matches[0].id))linked.set(matches[0].id,row);}
 const inRange=date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&(f.from===''||date>=f.from.slice(0,10))&&(f.to===''||date<=f.to.slice(0,10));
 const rows=[];
 for(const service of services){
  const date=String(service.serviceDate||'');if(!inRange(date))continue;
  const salespersonId=service.employeeId||service.operatorId;if(!caps.allSales&&salespersonId!==user.id)continue;
  const attached=linked.get(service.id),unknownCommission=!(service.schedule||[]).length||(service.schedule||[]).some(part=>part.expected==null||part.expected===''||!Number.isFinite(Number(part.expected))),expected=unknownCommission?null:c.round((service.schedule||[]).reduce((sum,part)=>sum+Number(part.expected),0));
  rows.push({recordKind:'mobile',mobileKind:'carrier',id:'mobile:'+service.id,sourceId:service.id,sourceUrl:'/carrier',businessDate:date,createdAt:date+'T12:00:00+08:00',registeredAt:service.createdAt||'',name:service.typeName||'移动业务',detail:service.subTypeName||'',reference:service.externalOrderNo||'',customerMask:service.customerMask||attached?.customerMask||'',salespersonId,salesperson:service.employeeName||service.operator||'未记录营业员',businessAmount:service.transactionAmount==null?null:Number(service.transactionAmount),expectedCommission:expected,cashReceived:attached?.cashReceived??null,status:!(service.schedule||[]).length?'已登记 · 酬金规则待配置':(service.schedule||[]).every(part=>part.confirmed!=null)?'已确认结算':'已登记 · 待结算',linkedAirId:attached?.id||''});
 }
 for(const event of air){
  if([...linked.values()].some(row=>row.id===event.id))continue;
  const date=String(event.businessDate||(event.createdAt?c.day(event.createdAt):''));if(!inRange(date))continue;
  const salespersonId=event.operatorId||'';if(!caps.allSales&&salespersonId!==user.id)continue;
  rows.push({recordKind:'mobile',mobileKind:'air',id:'mobile:'+event.id,sourceId:event.id,sourceUrl:'/air-recharge',businessDate:date,createdAt:date+'T12:00:00+08:00',registeredAt:event.createdAt||'',name:'空充顾客充值',detail:'',reference:event.reference||event.displayNo||'',customerMask:event.customerMask||'',salespersonId,salesperson:event.operator||'未记录营业员',businessAmount:Number(event.debitAmount??-Number(event.amount||0)),expectedCommission:0,cashReceived:event.cashReceived??null,status:event.settlementStatus||'已登记'});
 }
 return rows;
}

function giftDetails(order,canProfit,catalog,requests){
 const project=(item,meta)=>{
  const product=catalog.get(item.skuId),cost=item.cost,known=cost!==null&&cost!==undefined&&cost!==''&&Number.isFinite(Number(cost))&&Number(cost)>=0;
  return {skuId:item.skuId||'',name:item.name||product?.name||'未记录赠品名称',externalCode:item.externalCode||product?.externalCode||'',quantity:Number(item.quantity||0),unit:item.unit||product?.unit||'',serialNo:item.serialNo||'',warehouseId:item.warehouseId||'',warehouseName:item.warehouseName||warehouses.byId(item.warehouseId)?.name||'未记录仓库',...meta,...(canProfit&&meta.status==='已赠送'?{cost:known?Number(cost):null}:{})};
 };
 const items=(order.giftOrders||[]).flatMap(gift=>(gift.items||[]).map(item=>project(item,{giftId:gift.id,kind:gift.kind||'随单赠送',status:'已赠送',costIncludedInMaterial:false})));
 for(const line of order.items||[])for(const material of line.materials||[])if(material.usage==='gift')items.push(project(material,{giftId:line.id,kind:'维修赠料',status:'已赠送',costIncludedInMaterial:true}));
 const pending=requests.filter(r=>['待审批','已驳回'].includes(r.status)).flatMap(request=>(request.items||[]).map(item=>project(item,{giftId:request.id,kind:request.kind||'赠品申请',status:request.status,costIncludedInMaterial:false})));
 const materials=items.filter(i=>i.costIncludedInMaterial),issued=items.filter(i=>!i.costIncludedInMaterial);
 const issuedKnown=order.giftCost!==null&&order.giftCost!==undefined&&order.giftCost!==''&&Number.isFinite(Number(order.giftCost));
 return {items,pending,scope:'整单赠品',redReversed:Boolean(order.redReversedBy),...(canProfit?{issuedCost:issued.length?(issuedKnown?c.round(Number(order.giftCost)):null):0,materialCost:materials.some(i=>i.cost==null)?null:c.round(materials.reduce((n,i)=>n+i.cost,0))}:{})};
}
function report(store,user,f){
 const caps=c.capabilities(user);
 if(!caps.allSales&&f.salesperson&&f.salesperson!==user.id)throw new c.HttpError(403,'只能查询本人销售清单');
 const refs={...origins.index(store),quantitySources:quantitySourceIndex(store)},orders=(store.sales||[]).filter(o=>{
  const at=Date.parse(o.createdAt);return Number.isFinite(at)&&(caps.allSales||(o.salespersonId||o.operatorId)===user.id)&&(f.start==null||at>=f.start)&&(f.end==null||at<f.end);
 }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 const giftCatalog=new Map((store.products||[]).map(p=>[p.skuId,p]));
 const rows=orders.flatMap(o=>{const margins=caps.profit?profits(store,o):[],gifts=giftDetails(o,caps.profit,giftCatalog,(store.giftApprovals||[]).filter(r=>r.orderId===o.id));return (o.items||[]).map((i,index)=>{
  const quantity=Number(i.quantity||0),returnedQuantity=Math.min(quantity,Math.max(0,Number(i.returnedQuantity||0)));
  const grossAmount=c.round(Number(i.amount??quantity*Number(i.salePrice||0))),returnedAmount=returnedAmountForLine(store,o,i);
  const suppliers=shares(allocations(store,refs,o,i),{quantity,returnedQuantity:o.redReversedBy?quantity:returnedQuantity,netQuantity:o.redReversedBy?0:quantity-returnedQuantity,grossAmount,returnedAmount,netAmount:c.round(grossAmount-returnedAmount),...(caps.profit?{netProfit:margins[index]}:{})});
  const classification=categories.pathOf(giftCatalog.get(i.skuId)||i);
  return {category:classification[0]||'',brand:classification[1]||'',recordKind:o.repairContext?.kind==='repair'||i.type==='维修'&&i.stockManaged===false?'repair':'sale',stockManaged:i.stockManaged!==false,repairReclassified:o.repairContext?.kind==='repair',id:i.id||o.id+'/'+index,orderId:o.id,createdAt:o.createdAt,skuId:i.skuId,name:i.name,externalCode:i.externalCode||'',serialNo:i.serialNo||'',warehouseId:i.warehouseId||'',warehouseName:i.warehouseName||(i.stockManaged===false?'服务项目':warehouses.byId(i.warehouseId)?.name||'未记录仓库'),salespersonId:o.salespersonId||o.operatorId,salesperson:o.salesperson||o.operator||'未记录营业员',customerName:o.customerName||'散客',customerMask:o.customerMask||'',salePrice:Number(i.salePrice||0),quantity,returnedQuantity:o.redReversedBy?quantity:returnedQuantity,netQuantity:o.redReversedBy?0:quantity-returnedQuantity,grossAmount,returnedAmount,netAmount:c.round(grossAmount-returnedAmount),status:o.redReversedBy?'已红冲':returnedQuantity>=quantity?'已退货':returnedQuantity>0?'部分退货':'已销售',paymentStatus:o.paymentReview?.status||'历史收款记录',suppliers,allocation:false,gifts,...(caps.profit?{netProfit:margins[index]}:{})};
 });});
 const allOptions=options(store,user,orders,rows),filtered=[];
 for(const r of rows){
  if(f.category&&r.category!==f.category||f.brand&&r.brand!==f.brand)continue;
  const red=r.status==='已红冲',returned=Number(r.returnedQuantity)>0&&!red;if(f.saleState==='red'&&!red||f.saleState==='returned'&&!returned||f.saleState==='returns_red'&&!red&&!returned||f.saleState==='normal'&&(red||returned))continue;
  if(f.kind==='mobile'||f.kind==='sale'&&r.recordKind!=='sale'||f.kind==='repair'&&r.recordKind!=='repair')continue;
  if(f.warehouse&&(r.warehouseId||SERVICE)!==f.warehouse||f.salesperson&&r.salespersonId!==f.salesperson||f.product&&r.skuId!==f.product||f.productIds&&!f.productIds.has(r.skuId))continue;
  if(f.q&&!([r.orderId,r.name,r.externalCode,r.serialNo,r.salesperson,r.customerName,r.customerMask,...r.suppliers.map(s=>s.name),...[...r.gifts.items,...r.gifts.pending].flatMap(g=>[g.name,g.externalCode,g.serialNo])].join(' ').toLowerCase().includes(f.q)))continue;
  const chosen=f.supplier?r.suppliers.filter(s=>s.id===f.supplier):f.supplierIds?r.suppliers.filter(s=>f.supplierIds.has(s.id)):r.suppliers;
  if(!chosen.length)continue;
  const weight=chosen.reduce((n,s)=>n+s.weight,0),row={...r,suppliers:chosen,allocation:weight<1-1e-9||r.suppliers.length>1};
  for(const key of ['quantity','returnedQuantity','netQuantity'])row[key]=Number(chosen.reduce((n,s)=>n+s[key],0).toFixed(6));
  for(const key of ['grossAmount','returnedAmount','netAmount'])row[key]=c.round(chosen.reduce((n,s)=>n+s[key],0));
  if(caps.profit)row.netProfit=r.netProfit===null?null:c.round(chosen.reduce((n,s)=>n+s.netProfit,0));
  filtered.push(row);
 }
 const saleRows=filtered.slice(),mobileRows=(f.kind&&f.kind!=='mobile'?[]:mobileBusinessRows(store,user,f)).filter(r=>{
  if(f.saleState||f.category||f.brand||f.warehouse||f.product||f.productIds||f.supplier||f.supplierIds)return false;
  if(f.salesperson&&r.salespersonId!==f.salesperson)return false;
  return !f.q||[r.sourceId,r.name,r.detail,r.reference,r.salesperson,r.customerMask].join(' ').toLowerCase().includes(f.q);
 });
 allOptions.salespeople=[...new Map([...allOptions.salespeople,...mobileRows.map(r=>({id:r.salespersonId,name:r.salesperson})).filter(r=>r.id)].map(r=>[r.id,r])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const groups=new Map(),totals={orderCount:new Set(saleRows.map(r=>r.orderId)).size,lineCount:saleRows.length+mobileRows.length,saleLineCount:saleRows.length,mobileBusinessCount:mobileRows.length,repairCount:saleRows.filter(r=>r.recordKind==='repair').length,repairNetAmount:0,repairNetQuantity:0,goodsNetAmount:0,goodsNetQuantity:0,mobileRechargeAmount:0,mobileExpectedCommission:0,mobileCommissionUnknownCount:0,quantity:0,returnedQuantity:0,netQuantity:0,grossAmount:0,returnedAmount:0,netAmount:0};
 for(const r of saleRows){
  for(const key of ['quantity','returnedQuantity','netQuantity','grossAmount','returnedAmount','netAmount'])totals[key]+=r[key];
  totals[r.recordKind==='repair'?'repairNetAmount':'goodsNetAmount']+=r.netAmount;
  totals[r.recordKind==='repair'?'repairNetQuantity':'goodsNetQuantity']+=r.netQuantity;
  r.suppliers.forEach(s=>{
   const g=groups.get(s.id)||{id:s.id,name:s.name,quantity:0,returnedQuantity:0,netQuantity:0,grossAmount:0,returnedAmount:0,netAmount:0,orderIds:new Set(),allocated:false};
   for(const key of ['quantity','returnedQuantity','netQuantity','grossAmount','returnedAmount','netAmount'])g[key]+=s[key];
   g.orderIds.add(r.orderId);g.allocated||=r.allocation;groups.set(s.id,g);
  });
 }
 for(const key of ['quantity','returnedQuantity','netQuantity'])totals[key]=Number(totals[key].toFixed(6));
 for(const key of ['repairNetQuantity','goodsNetQuantity'])totals[key]=Number(totals[key].toFixed(6));
 for(const key of ['grossAmount','returnedAmount','netAmount'])totals[key]=c.round(totals[key]);
 for(const row of mobileRows){if(row.businessAmount!=null)totals.mobileRechargeAmount+=row.businessAmount;if(row.mobileKind==='carrier'&&row.expectedCommission==null)totals.mobileCommissionUnknownCount++;else totals.mobileExpectedCommission+=Number(row.expectedCommission||0);}
 for(const key of ['repairNetAmount','goodsNetAmount','mobileRechargeAmount','mobileExpectedCommission'])totals[key]=c.round(totals[key]);
 if(caps.profit){totals.unknownProfitLines=filtered.filter(r=>r.netProfit===null).length;totals.netProfit=totals.unknownProfitLines?null:c.round(filtered.reduce((n,r)=>n+r.netProfit,0));}
 const supplierSummary=[...groups.values()].map(({orderIds,...g})=>({...g,orderCount:orderIds.size,quantity:Number(g.quantity.toFixed(6)),returnedQuantity:Number(g.returnedQuantity.toFixed(6)),netQuantity:Number(g.netQuantity.toFixed(6)),grossAmount:c.round(g.grossAmount),returnedAmount:c.round(g.returnedAmount),netAmount:c.round(g.netAmount)})).sort((a,b)=>b.netAmount-a.netAmount||b.netQuantity-a.netQuantity||a.name.localeCompare(b.name,'zh-CN'));
 const split=f.separateMobile&&f.kind!=='mobile',combined=(split?saleRows:[...saleRows,...mobileRows]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)),pages=Math.max(1,Math.ceil(combined.length/f.limit)),page=Math.min(f.page,pages),mobilePages=Math.max(1,Math.ceil(mobileRows.length/f.limit)),mobilePage=Math.min(f.mobilePage||1,mobilePages),separateRows=split?mobileRows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice((mobilePage-1)*f.limit,mobilePage*f.limit):[];
 return {separateMobile:split,mobileRows:separateRows,mobilePage,mobilePages,canProfit:caps.profit,rows:combined.slice((page-1)*f.limit,page*f.limit),totals,supplierSummary,options:allOptions,page,pages,limit:f.limit,from:f.from,to:f.to,scope:caps.allSales?'门店销售':'本人销售',basis:'销售与维修按原销售单开单时间，移动业务按业务日期筛选；移动充值面额与预计酬金单列，不计入销售金额。销售金额扣减原单截至查询时的累计退货和红冲。'};
}
function filterOptions(store,user){
 if(user.assistantCustomerOnly||['customer-assistant','personal-assistant'].includes(user.roleCode))throw new c.HttpError(403,'此账号不能查询门店销售清单');
 return options(store,user,[],[]);
}
module.exports={filters,report,lineSources,filterOptions};
