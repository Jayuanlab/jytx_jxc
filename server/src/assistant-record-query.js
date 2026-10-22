'use strict';
// Resolve read-only questions against actual catalog and original business records.
const c=require('./common'),erp=require('./erp'),details=require('./inventory-details'),sales=require('./sales-list'),periods=require('./assistant-period'),warehouses=require('./warehouses');
const norm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s·（）()+，,。？?：:]/g,'');
const money=v=>'¥'+c.round(v).toFixed(2),date=v=>v?c.day(v):'未记录';
const src=(label,id,href)=>({label,id:String(id),href});
const brands=['华为','荣耀','OPPO','vivo','苹果','iPhone','小米','红米','三星','一加','realme','魅族','中兴','努比亚'];
const queryWords=/查|看|找|多少|几台|几张|哪些|哪台|哪家|哪天|什么|谁|有没有|还有|还剩|剩余|现货|库存|在库|清单|明细|价格|售价|进价|成本|毛利|利润|卖得|卖的|卖了|买了什么|买过|进货日期|供货商|供应商/;
const writes=/(?:开|建|做|填|出).{0,5}(?:销售|接待|订货|采购)?单|下单|录单|帮我卖|我要卖|卖一台|买一台|顾客(?:来|到)|顾客.*(?:要了|选好|带走)|(?:提交|确认|新增|删除|改价|调价|红冲|退款|退货|付款|打款|清空|备份|恢复)/;
const learning=/怎么办|怎么操作|如何操作|技巧|话术|学习|流程|使用说明|设置|入口|打开|进入|菜单|页面/;
function names(row){
 const original=[row.name,row.shortName,...(row.aliases||[])].filter(Boolean).map(String);
 return [...new Set(original.flatMap(v=>[v,v.replace(/^演示[··]?/,'')]))];
}
function entities(rows,q,{product=false,supplier=false}={}){
 const text=norm(q);
 const scored=rows.map(row=>{
  const values=names(row).map(value=>({value,weight:4}));
  if(product){
   for(const field of [row.externalCode,row.thirdType,row.spec])if(field){
    values.push({value:String(field),weight:5});
    // A model without its RAM/storage suffix is still a catalog term.
    values.push({value:String(field).replace(/\s*\d+(?:\.\d+)?\s*[gGtT][bB]?(?:\s*\+\s*\d+\s*[gGtT][bB]?)?.*$/,'').trim(),weight:5});
    for(const word of String(field).split(/[\s·（）()]+/))if(/[a-z]/i.test(word)&&!/^\d+[gt]b?$/i.test(word))values.push({value:word,weight:5});
   }
   for(const field of [row.brand,row.subType,row.type])if(field)values.push({value:String(field),weight:2});
   for(const value of names(row)){
    const core=value.replace(/\s*\d+(?:\.\d+)?[gGtT][bB]?(?:\s*\+\s*\d+[gGtT][bB]?)?.*$/,'').trim();
    values.push({value:core,weight:5});
    for(const token of core.split(/\s+/))values.push({value:token,weight:4});
   }
  }
  if(supplier)for(const value of names(row)){
   const short=value.split('·').at(-1).replace(/(?:有限责任公司|有限公司|公司)$/,'');
   if(short.length>=2&&!/^(?:手机|配件|维修|供货商|供应商)$/.test(short))values.push({value:short,weight:4});
  }
  if(product)for(const brand of brands)if(names(row).some(v=>norm(v).includes(norm(brand))))values.push({value:brand,weight:2});
  for(const value of values)if(brands.some(b=>norm(value.value)===norm(b)))value.weight=2;
  const hit=values.filter(x=>norm(x.value).length>=2&&!/^\d+$/.test(norm(x.value))&&text.includes(norm(x.value))).sort((a,b)=>b.weight-a.weight||norm(b.value).length-norm(a.value).length)[0];
  return {row,hit};
 }).filter(x=>x.hit);
 const strongest=Math.max(0,...scored.map(x=>x.hit.weight));
 return scored.filter(x=>x.hit.weight===strongest).map(x=>x.row);
}
function warehouse(q){
 const match=q.match(/(?<![a-z])([a-z])\s*仓/i);
 if(!match)return null;
 const row=warehouses.WAREHOUSES.find(x=>x.code===match[1].toUpperCase());
 return row||{invalid:true,name:match[1].toUpperCase()+'仓'};
}
function range(q,{history=false}={}){
 const today=c.day(),year=today.slice(0,4);
 let text=q.replace(/(?<![\d年])(?:(20\d{2})年|今年)?(\d{1,2})月(\d{1,2})(?:日|号)/g,(_,y,m,d)=>(y||year)+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0'));
 const period=periods.parse(text);
 if(period)return {from:period.startDate,to:period.endDate,label:period.label};
 const single=text.match(/20\d{2}[-年/.](\d{1,2})[-月/.](\d{1,2})日?/);
 if(single){const day=single[0].slice(0,4)+'-'+single[1].padStart(2,'0')+'-'+single[2].padStart(2,'0');sales.filters(new URLSearchParams({from:day}));return {from:day,to:day,label:day};}
 const relative=/前天/.test(text)?-2:/昨天|昨日/.test(text)?-1:/今天|今日|当日|本日/.test(text)?0:null;
 if(relative!==null){const day=c.day(Date.now()+relative*86400000);return {from:day,to:day,label:relative===0?'今天':relative===-1?'昨天':'前天'};}
 if(history||/全部|所有|历史|累计|总共/.test(text))return {from:'',to:'',label:'全部记录'};
 return {from:today,to:today,label:'今天'};
}
function result(answer,kind,{sources=[],table,metrics={},subject,followups=[]}={}){
 return {answer,sources,metrics:{kind,...metrics},...(table?{table}:{}),...(subject?{conversationHint:{topic:'record-query',subject}}:{}),followups:followups.map(question=>({label:question,question}))};
}
function denied(text){return result(text,'record-query',{metrics:{denied:true}});}
function serialQuery(store,user,q,token){
 const caps=c.capabilities(user);
 if(!caps.sell&&!caps.purchase&&!caps.stocktake&&!caps.manageProducts)return denied('当前岗位没有库存和串号查询权限。');
 const rows=erp.inventory(store,user),matches=rows.flatMap(row=>(row.serials||[]).filter(s=>token.length===4?String(s.no).endsWith(token):norm(s.no)===norm(token)).map(serial=>({row,serial})));
 // Trace historical sales even when that serial no longer has an inventory row.
 const visible=store.sales.filter(o=>caps.allSales||(o.salespersonId||o.operatorId)===user.id);
 for(const order of visible)for(const item of order.items||[])if(item.serialNo&&(token.length===4?item.serialNo.endsWith(token):norm(item.serialNo)===norm(token))&&!matches.some(x=>x.serial.no===item.serialNo))matches.push({row:{name:item.name,warehouseName:item.warehouseName},serial:{no:item.serialNo,status:'已售出'}});
 if(!matches.length)return result('没有查到串号 '+token+' 的可见记录。','serial-query',{sources:[src('串号追踪',token,'/search?scope=serials&q='+encodeURIComponent(token))],metrics:{matchedCount:0}});
 if(matches.length>1&&token.length===4)return result('尾号 '+token+' 对应 '+matches.length+' 台：'+matches.slice(0,5).map(x=>x.row.name+'，'+x.serial.no+'，'+x.row.warehouseName).join('；')+'。请选完整串号。','serial-query',{metrics:{matchedCount:matches.length,ambiguous:true},sources:matches.slice(0,5).map(x=>src('查看这台手机',x.serial.no,'/search?scope=serials&q='+encodeURIComponent(x.serial.no)))});
 const sources=[],lines=[],tableRows=[];
 for(const {row,serial} of matches.slice(0,8)){
  const origins=caps.purchase||caps.supplierView?store.purchases.filter(p=>serial.purchaseId?p.id===serial.purchaseId:(p.items||[]).some(i=>(!row.skuId||i.skuId===row.skuId)&&(i.serials||[]).includes(serial.no))):[];
  const purchase=origins.length===1?origins[0]:null;
  const orders=visible.filter(o=>(o.items||[]).some(i=>i.serialNo===serial.no));
  let text=row.name+'，'+(row.warehouseName||'未记录仓库')+'，'+serial.status+'，串号 '+serial.no;
  if(/进货|入库|日期|哪天|供货商|供应商/.test(q)){
   if(!caps.purchase&&!caps.supplierView)text+='；当前岗位没有进货来源查看权限';
   else text+=purchase?'；'+date(purchase.createdAt)+'进货，供货商 '+purchase.supplier:'；进货来源未记录';
  }
  if(/卖|销售|顾客|客户|成交/.test(q)){
   text+=orders.length?'；'+orders.map(o=>{const i=o.items.find(x=>x.serialNo===serial.no);return date(o.createdAt)+'售给'+(o.customerName||'散客')+'，成交价 '+money(i.salePrice)+'，'+(o.salesperson||o.operator||'未记录营业员');}).join('；'):'；没有你有权限查看的销售记录';
   for(const o of orders)sources.push(src('原销售单',o.id,'/app?tab=orders&q='+encodeURIComponent(o.id)));
  }
  if(/进价|成本|进货价/.test(q))text+=!caps.cost?'；当前岗位没有成本查看权限':serial.costPrice!=null?'；进价 '+money(serial.costPrice):'；进价未记录';
  if(/毛利|利润/.test(q)){
   if(!caps.profit)text+='；当前岗位没有毛利查看权限';
   else{const margin=sales.report(store,user,sales.filters(new URLSearchParams({q:serial.no}))).totals.netProfit;text+='；销售毛利 '+(margin==null?'成本资料待核对':money(margin));}
  }
  if(/多少钱|售价|零售价|卖价/.test(q)&&!/卖给|卖了/.test(q)){
   const product=store.products.find(p=>p.skuId===row.skuId);text+=product?'；零售价 '+money(product.salePrice||0):'；零售价未记录';
  }
  lines.push(text);tableRows.push({name:row.name,serialNo:serial.no,warehouse:row.warehouseName||'未记录',status:serial.status});
  sources.push(src('串号追踪',serial.no,'/search?scope=serials&q='+encodeURIComponent(serial.no)));
 }
 return result(lines.join('\n'),'serial-query',{sources,subject:'串号 '+matches[0].serial.no,metrics:{matchedCount:matches.length},table:{title:'串号记录',columns:[{key:'name',label:'商品'},{key:'serialNo',label:'串号'},{key:'warehouse',label:'仓库'},{key:'status',label:'状态'}],rows:tableRows},followups:['进货日期呢','供货商呢','售价呢']});
}
function inventoryQuery(store,user,q,products,suppliers,wh){
 const caps=c.capabilities(user);
 if(!caps.sell&&!caps.purchase&&!caps.stocktake&&!caps.manageProducts)return denied('当前岗位没有库存查询权限。');
 if(suppliers.length&&!caps.supplierView)return denied('当前岗位没有按供货商查询的权限。');
 if(/进价|成本|进货价/.test(q)&&!caps.cost)return denied('当前岗位没有成本查看权限。');
 if(wh?.invalid)return result('没有设置'+wh.name+'，请选现有仓库。','inventory-query');
 const phoneOnly=/手机|几台|多少台/.test(q),accessoryOnly=/配件/.test(q)&&!products.length;
 const ids=new Set(products.map(x=>x.skuId)),supplierIds=new Set(suppliers.map(x=>x.id));
 let stocks=erp.inventory(store,user).filter(x=>x.stockManaged!==false&&(!ids.size||ids.has(x.skuId))&&(!wh||x.warehouseId===wh.id)&&(!phoneOnly||details.phone(x))&&(!accessoryOnly||/配件/.test(x.type)));
 if(supplierIds.size)stocks=stocks.map(row=>{
  if(details.tracked(row)){
   const serials=(row.serials||[]).filter(s=>details.inStock(s)&&supplierIds.has(s.supplierId));const costPrice=serials.length&&serials.every(s=>Number.isFinite(s.costPrice))?c.round(serials.reduce((n,s)=>n+s.costPrice,0)/serials.length):null;return {...row,serials,quantity:serials.length,costPrice,stockSources:(row.stockSources||[]).filter(x=>supplierIds.has(x.supplierId))};
  }
  const refs=details.index(store),original=store.inventory.find(s=>s.skuId===row.skuId&&(s.warehouseId||'wh-sale')===row.warehouseId);
  const quantity=(original?.costSources||[]).filter(s=>supplierIds.has(refs.items.get(s.sourceId)?.order.supplierId)).reduce((n,s)=>n+Number(s.quantity||0),0);
  return {...row,quantity,stockSources:(row.stockSources||[]).filter(x=>supplierIds.has(x.supplierId))};
 });
 const total=stocks.reduce((n,s)=>n+Number(s.quantity||0),0);
 const origin=/进货|入库|日期|哪天|供货商|供应商/.test(q),price=/多少钱|价格|售价|零售价|卖价/.test(q),cost=/进价|成本|进货价/.test(q);
 const label=wh?wh.code+'仓':suppliers.length?suppliers.map(s=>s.name).join('、'):products.length?products.map(p=>p.name).join('、'):phoneOnly?'手机':'库存';
 const selected=stocks.filter(s=>Number(s.quantity)>0||price||cost).slice(0,8);
 const lines=selected.map(s=>{
  const pieces=[s.name,(warehouses.byId(s.warehouseId)?.code?warehouses.byId(s.warehouseId).code+'仓':s.warehouseName||'销售仓')+' '+s.quantity+(details.phone(s)?' 台':' 件')];
  if(/串号|串码|imei/i.test(q))pieces.push((s.serials||[]).filter(details.inStock).slice(0,8).map(x=>x.no).join('、')||'没有可售串号');
  if(price)pieces.push(s.salePrice>0?'零售价 '+money(s.salePrice):'零售价未设置');
  if(cost)pieces.push(s.costPrice!=null?'库存平均进价 '+money(s.costPrice):'进价未记录');
  if(origin){if(caps.purchase||caps.supplierView)pieces.push((s.stockSources||[]).length?s.stockSources.map(x=>x.supplier+'，'+date(x.purchaseDate)+'进货').join('；'):'进货来源未记录');else pieces.push('当前岗位没有进货来源查看权限');}
  return pieces.join('，');
 });
 const text=price||cost||origin?lines.join('\n')||'没有查到符合条件的库存记录。':label+'账面库存 '+total+(phoneOnly||products.length&&products.every(details.phone)?' 台':' 件')+'。'+(lines.length?'\n'+lines.join('\n'):'');
 return result(text,'inventory-query',{sources:[src('按商品查库存',label,'/search?scope=inventory&q='+encodeURIComponent(products.length?products[0].subType||products[0].name:label)),src('库存明细',label,'/app?tab=inventory'+(wh?'&warehouse='+wh.id:'')+(suppliers.length===1?'&supplier='+encodeURIComponent(suppliers[0].id):''))],metrics:{quantity:total,matchedCount:stocks.length,productIds:products.map(p=>p.skuId),warehouseId:wh?.id||null},subject:products.length?products[0].thirdType?.replace(/\s*\d+[gGtT].*$/,'')||products[0].name:label,table:{title:'库存结果',columns:[{key:'name',label:'商品'},{key:'warehouse',label:'仓库'},{key:'quantity',label:'数量'},...(price?[{key:'price',label:'零售价'}]:[])],rows:selected.map(s=>({name:s.name,warehouse:s.warehouseName,quantity:s.quantity,...(price?{price:s.salePrice>0?money(s.salePrice):'未设置'}:{})}))},followups:products.length?['售价呢','供货商呢','进货日期呢']:[]});
}
function salesQuery(store,user,q,products,suppliers,wh,staff,customer){
 const caps=c.capabilities(user);
 if(staff&&!caps.allSales&&staff.id!==user.id)return denied('当前岗位没有查看其他营业员销售的权限。');
 if(suppliers.length&&!caps.supplierView)return denied('当前岗位没有按供货商查询销售的权限。');
 const wantsProfit=/毛利|利润|赚|挣/.test(q);
 if(wantsProfit&&!caps.profit)return denied('当前岗位没有毛利查看权限。');
 const time=range(q,{history:!!customer}),params=new URLSearchParams({limit:'100'});
 if(time.from)params.set('from',time.from);if(time.to)params.set('to',time.to);if(wh?.id)params.set('warehouse',wh.id);if(staff)params.set('salesperson',staff.id);if(suppliers.length===1)params.set('supplier',suppliers[0].id);
 let ledger=store;
 if(products.length||customer){
  const ids=new Set(products.map(p=>p.skuId));
  // Keep complete orders for correct shared gift-cost allocation, then filter resulting rows by product.
  const relevant=store.sales.filter(o=>!customer||o.customerName===customer||o.customerPhone===customer);
  ledger={...store,sales:relevant};
  if(ids.size===1)params.set('product',[...ids][0]);
  else if(ids.size){ledger={...ledger,sales:relevant.filter(o=>(o.items||[]).some(i=>ids.has(i.skuId)))};}
 }
 const f=sales.filters(params);
 if(products.length)f.productIds=new Set(products.map(p=>p.skuId));
 if(suppliers.length>1)f.supplierIds=new Set(suppliers.map(p=>p.id));
 const report=sales.report(ledger,user,f);
 // The opened list must show the same filter as the answer.
 if(products.length>1){const brand=brands.find(b=>norm(q).includes(norm(b)));if(brand)params.set('q',brand);else if(specificLabel(products,q))params.set('q',specificLabel(products,q));}
 if(customer)params.set('q',customer);
 const totals=report.totals,label=time.label+(customer?customer:staff?staff.name:products.length?'所查商品':'')+'销售';
 let text=totals.orderCount?label+' '+totals.orderCount+' 单，净售 '+totals.netQuantity+' 件，总价 '+money(totals.netAmount)+(wantsProfit?'，毛利 '+(totals.netProfit==null?'成本资料待核对':money(totals.netProfit)):'')+'。':label+'没有符合条件的记录。';
 const rank=/哪个|哪家|排名|最好|最多|比较|排行/.test(q)&&/供货商|供应商/.test(q);
 if(rank){
  if(!caps.supplierView)return denied('当前岗位没有供货商销售排名查看权限。');
  const groups=report.supplierSummary.filter(s=>s.id!=='__service__');
  text=groups.length?time.label+'供货商按净销售额排名：'+groups.slice(0,5).map((s,i)=>(i+1)+'. '+s.name+'，'+money(s.netAmount)+'，净售 '+s.netQuantity+' 件').join('；')+'。':'这个时段没有供货商销售记录。';
  return result(text,'supplier-sales-query',{sources:[src('供货商销量','排名','/sales-list?'+params)],metrics:{...totals,rank:groups.slice(0,5)},subject:time.label+'供货商销售'});
 }
 const show=/清单|明细|哪些|什么|买过|买了|每笔|每一笔/.test(q);
 if(show&&report.rows.length)text+='\n'+report.rows.slice(0,5).map(r=>date(r.createdAt)+' '+r.name+(r.serialNo?' · '+r.serialNo:'')+'，'+r.netQuantity+' 件，'+money(r.netAmount)+(customer?'，'+r.salesperson:'')).join('\n');
 const sources=[src('销售清单','查询','/sales-list?'+params),...report.rows.slice(0,5).map(r=>src('原销售单',r.orderId,'/app?tab=orders&q='+encodeURIComponent(r.orderId)))];
 return result(text,'sales-record-query',{sources,metrics:{...totals,from:time.from,to:time.to},subject:(time.label==='全部记录'?'全部':time.label)+' '+(products.length?products[0].subType||products[0].name:staff?staff.name:customer||'')+'销售',table:show?{title:'销售明细',columns:[{key:'name',label:'商品'},{key:'quantity',label:'数量'},{key:'amount',label:'总价'}],rows:report.rows.slice(0,10).map(r=>({name:r.name,quantity:r.netQuantity,amount:money(r.netAmount)}))}:undefined,followups:['销售清单','毛利多少']});
}
function specificLabel(products,q){return products.map(p=>String(p.thirdType||p.name||'').replace(/\s*\d+[gGtT].*$/,'').trim()).find(x=>x&&norm(q).includes(norm(x)))||'';}
function query(store,user,question){
 const q=String(question||'').normalize('NFKC').trim();
 const numbered=require('./document-numbers').questionLookup(store,user,q);if(numbered)return numbered;
 if(!queryWords.test(q)||writes.test(q)||learning.test(q))return null;
 if(require('../../web/assistant-sale-input').analyze(q).saleRequest&&!/查|看|找|哪|谁|记录|清单|明细|统计|销量|销售额|毛利|利润|多少钱|进货日期|供货商|库存|还有|剩|(?:进价|进货价|成本|售价|价格)(?:多少|是多少|呢)/.test(q))return null;
 let products=entities((store.products||[]).filter(p=>p.active!==false),q,{product:true}),suppliers=entities(store.suppliers||[],q,{supplier:true}),wh=warehouse(q);
 const visible=store.sales.filter(o=>c.capabilities(user).allSales||(o.salespersonId||o.operatorId)===user.id);
 const customer=[...new Set(visible.flatMap(o=>[o.customerName,o.customerPhone]).filter(v=>v&&v!=='散客'))].sort((a,b)=>String(b).length-String(a).length).find(v=>norm(q).includes(norm(v))||norm(q).includes(norm(String(v).replace(/^演示/,''))));
 const staff=entities((store.users||[]).filter(u=>u.status==='active'),q).sort((a,b)=>b.name.length-a.name.length)[0];
 const askedBrand=brands.find(b=>norm(q).includes(norm(b)));
 if(askedBrand&&!products.length)return result('没有查到'+askedBrand+'的商品档案，不能把全店数据当作这个品牌回答。','record-query',{metrics:{matchedCount:0,unknownProduct:true}});
 const model=q.match(/(?:华为|荣耀|oppo|vivo|小米|红米|苹果|iphone|三星|一加|realme|魅族|中兴|努比亚)\s*(?:的|手机)?\s*((?:畅享|nova|mate|pura|reno|[a-z]+)\s*\d+(?:\s*(?:pro|ultra|plus))?)/i)?.[1];
 if(model&&!products.some(p=>[p.name,p.thirdType,p.externalCode].some(v=>norm(v).includes(norm(model)))))return result('没有查到型号 '+model+' 的商品档案，请核对型号。','record-query',{metrics:{matchedCount:0,unknownProduct:true}});
 if(/这台|这款|那个手机/.test(q)&&!products.length&&!/\d{4,}/.test(q))return result('请告诉我这台手机的型号或串号后四位。','record-query',{metrics:{needsClarification:true}});
 if(!products.length&&/手机/.test(q)&&/销售|销量|卖|毛利|利润/.test(q))products=(store.products||[]).filter(details.phone);
 const number=q.match(/(?<!\d)(\d{14,18}|\d{4})(?!\d)/)?.[1];
 const serial=number&&(/串号|串码|imei|手机|\d{4}.*哪台/i.test(q))&&/查|看|找|哪|谁|进货|供货|供应|售价|多少钱|卖给|卖了|进价|进货价|成本|毛利|利润/.test(q);
 if(serial)return serialQuery(store,user,q,number);
 const finance=/多少钱|金额|总价|销售额|营业额|毛利|利润/.test(q);
 const salesWords=/卖|销售|销量|毛利|利润|营业额/.test(q);
 const specific=products.some(p=>p.thirdType&&norm(q).includes(norm(p.thirdType.split(/\s/)[0])));
 const namedFinance=salesWords&&finance&&(products.length||suppliers.length||wh||staff&&!/本周|这周|上周|本月|这个月|上月|上个月|今年|去年|最近|20\d{2}/.test(q));
 const sale=/销售清单|销售明细|销售单.*(?:几张|多少|总价|毛利)|供货商.*(?:卖|销售)|供应商.*(?:卖|销售)|卖给|买了什么|买过/.test(q)||customer&&/买|销售|消费/.test(q)||namedFinance||salesWords&&(wh||suppliers.length||specific);

 if(sale)return salesQuery(store,user,q,products,suppliers,wh,staff,customer);
 const stock=/库存|在库|还有|还剩|现货|剩|有几台|有多少|串号|串码|进货日期|供货商|供应商|多少钱|价格|售价|进价|成本|进货价|哪个仓|哪家/.test(q);
 if(stock&&(products.length||suppliers.length||wh))return inventoryQuery(store,user,q,products,suppliers,wh);
 return null;
}
module.exports={query};
