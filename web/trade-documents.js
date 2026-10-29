(()=>{'use strict';
let financialQueryVersion=0;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function exchange(id){
 const order=state.orders.find(x=>x.id===id);if(!order)return;
 const old=order.items.filter(x=>x.quantity>(x.returnedQuantity||0));if(!old.length)return toast('这张单没有可换商品',true);
 const products=state.products.filter(x=>x.active!==false);
 modal('申请换货 · '+documentNo(order),[
 {name:'itemId',label:'退回商品',options:old.map(x=>({value:x.id,label:x.name+(x.serialNo?' · '+x.serialNo:'')})),required:true},
 qtyField('returnQuantity','退回数量',1),
 {name:'skuId',label:'换出商品',options:[{value:'',label:'请选择商品'},...products.map(x=>({value:x.skuId,label:x.name}))],required:true},
 {name:'serialNo',label:'换出手机串号',placeholder:'扫码或输入完整串号',hint:'手机串号必填，配件可留空。'},
 qtyField('quantity','换出数量',1),moneyField('salePrice','换出商品成交单价'),
 moneyField('returnValue','退回商品作价',old[0].salePrice),{name:'returnWarehouseId',label:'退回仓库',options:state.warehouses.filter(w=>w.active!==false).map(w=>({value:w.id,label:w.name})),value:old[0].warehouseId||'wh-sale',required:true},{name:'warehouseId',label:'换出仓库',options:state.warehouses.filter(w=>w.active!==false).map(w=>({value:w.id,label:w.name})),required:true},{name:'paymentMode',label:'退款支付信息',options:['老板支付'],value:'老板支付'},{name:'reason',label:'换货说明（选填）',type:'textarea',wide:true},
 accountField,{name:'accountOwnerId',label:'差额收款人',options:[{value:'',label:'请选择实际收款人'},...state.users.filter(x=>x.status==='active'&&x.capabilities.financeReceive).map(x=>({value:x.id,label:x.name}))]},
 {name:'cashDrawerConfirmed',label:'如已补收现金，确认已入抽屉',type:'checkbox'}
 ],async(d,write)=>{const result=await write('/api/sale-exchanges',{orderId:id,returns:[{itemId:d.itemId,quantity:Number(d.returnQuantity)}],items:[{skuId:d.skuId,warehouseId:d.warehouseId,serialNo:d.serialNo.trim(),quantity:Number(d.quantity),salePrice:Number(d.salePrice)}],returnValue:d.returnValue,returnWarehouseId:d.returnWarehouseId,reason:d.reason||'销售换货',account:d.account,accountOwnerId:d.accountOwnerId,cashDrawerConfirmed:d.cashDrawerConfirmed});return {...result,message:result.message||'换货申请已提交，等待老板批准；尚未换货入账。'};},'员工先提交申请，老板本人批准后才办理换货及差额收退款；审批前不会换出手机或恢复原机库存。原单收款需先核实，国补按原平台流程办理。');
 const form=$('modal-form'),summary=document.createElement('p');form.querySelector('button[type=submit]').textContent='提交换货申请';summary.className='system-status';summary.id='exchange-difference';form.querySelector('.form-actions').before(summary);
 const scan=document.createElement('button');scan.type='button';scan.className='secondary';scan.textContent='拍照识码';form.elements.serialNo.after(scan);
 const photo=document.createElement('input');photo.type='file';photo.accept='image/*';photo.setAttribute('capture','environment');photo.hidden=true;scan.after(photo);scan.onclick=()=>photo.click();photo.onchange=async()=>{const file=photo.files[0],skuId=form.elements.skuId.value;if(!file)return;const current=()=>form.isConnected&&$('modal-form')===form&&photo.files[0]===file&&form.elements.skuId.value===skuId&&!form.elements.serialNo.disabled;let bitmap;try{bitmap=await createImageBitmap(file);const code=await window.SaleCapture.decode(bitmap);if(!current())return;if(!code)throw new Error('未识别串号，请重新拍照或手动输入');form.elements.serialNo.value=code;form.elements.serialNo.dispatchEvent(new Event('input',{bubbles:true}));}catch(error){if(current())toast(error.message,true)}finally{bitmap?.close();if(photo.files[0]===file)photo.value='';}};
 function update(){
  const original=old.find(x=>x.id===form.elements.itemId.value);
  form.elements.returnQuantity.max=original.quantity-(original.returnedQuantity||0);
  const next=products.find(x=>x.skuId===form.elements.skuId.value);form.elements.serialNo.required=Boolean(next?.trackSerial);
  const a=Number(form.elements.returnValue.value||0),b=Number(form.elements.quantity.value)*Number(form.elements.salePrice.value);
  const delta=Math.round((b-a)*100)/100;summary.textContent='原货退价 '+M(a)+' · 换出金额 '+M(b)+' · '+(delta>0?'需补收 '+M(delta):delta<0?'需退款 '+M(-delta):'无需补退款');
 }
 form.elements.skuId.addEventListener('change',()=>{const product=products.find(x=>x.skuId===form.elements.skuId.value);form.elements.warehouseId.value=product?.warehouseId||'wh-sale';form.elements.salePrice.value=product?.salePrice??'';form.elements.serialNo.value='';update()});
 form.addEventListener('input',update);form.addEventListener('change',update);update();
}
async function renderFinancial(direction){
 if(direction==='receive'&&new URLSearchParams(location.search).get('entry')==='create'){
  $('main').innerHTML=heading('收款单','','')+'<section class="card"><p>登记本次真实收到的款项。已有业务原单的收款不重复开单。</p>'+button('填写收款单','financial-new','receive','primary')+'</section>';
  await newFinancial('receive');return;
 }
if(direction==='pay'&&!state.user.capabilities.finance){location.assign('/business-reconciliation?section=payments');return;}
 const title=new URLSearchParams(location.search).get('view')==='all'?(direction==='receive'?'收款单':'付款单'):(direction==='receive'?'收款单查询':'付款单查询'),filter=state[direction+'Filter']||{q:documentQuery(),from:!location.search.match(/sourceId=|fundPartyKey=|newFor=|view=all|[?&]q=/)?today():'',to:!location.search.match(/sourceId=|fundPartyKey=|newFor=|view=all|[?&]q=/)?today():'',fundPartyKey:new URLSearchParams(location.search).get('fundPartyKey')||'',sourceId:new URLSearchParams(location.search).get('sourceId')||''};
 const pageCurrent=officePageCurrent(direction==='receive'?'receipts':'payments'),version=++financialQueryVersion;
 const current=()=>pageCurrent()&&version===financialQueryVersion;
 const params=new URLSearchParams({...filter,direction,...(direction==='pay'?{view:'documents'}:{})}),data=await officePageRead(current,()=>api('/api/financial-documents?'+params));
 if(!current())return;
 const receive=direction==='receive',summary=data.reconciliationSummary||{};
 $('main').innerHTML=heading(title,receive?(data.personalOnly?'只显示本人收款单。':'显示全店收款单。')+'营业员正常登记后计入账面，另发老板事后对账。账面登记、老板已核对、持有人核实分别显示，不表示银行自动验证。销售等已有业务随原单生成，请勿重复登记。':'每张业务单据显示一行；多账户或分次付款在分笔流水中查看。',
 (direction==='receive'?button('登记其他收款','financial-new',direction,'primary'):'<a class="primary" href="/business-reconciliation?section=payments&amp;entry=paid">门店付款单</a>')+'<a href="/store-transfer">门店互转单</a>'+button('刷新','refresh'))+
 '<section class="card system-backup"><form id="financial-filter" class="document-filter"><input type="hidden" name="fundPartyKey" value="'+E(filter.fundPartyKey||'')+'"><input type="hidden" name="sourceId" value="'+E(filter.sourceId||'')+'"><label>关键词<input name="q" type="search" placeholder="对象 / 单号 / 流水号" value="'+E(filter.q)+'"></label><label>开始日期<input name="from" type="date" value="'+E(filter.from)+'"></label><label>结束日期<input name="to" type="date" value="'+E(filter.to)+'"></label><div class="system-actions"><button class="primary" type="submit">查询</button><button class="secondary" type="button" id="financial-today">今日</button><button class="secondary" type="button" id="financial-all">全部</button></div></form></section>'+
 (receive?'<section class="card"><h2>账面登记 '+M(summary.registeredAmount)+'</h2><p>老板已核对 '+M(summary.reconciledAmount)+' · 有差异 '+M(summary.disputedAmount)+' · 待老板核对 '+M(summary.pendingReconciliationAmount)+'</p><p>持有人已核实 '+M(summary.verifiedByHolderAmount)+' · 历史未单列对账状态 '+M(summary.legacyWithoutReconciliationAmount)+'</p></section>':'')+
 (receive?'<section class="card mobile-record-list"><h2>'+data.rows.length+' 笔 · '+M(data.total)+'</h2>'+(filter.sourceId?'<p>当前仅显示所点原单。点击“全部”返回列表。</p>':'')+table(['单号与对象','业务','金额','账户','日期','原单','操作'],data.rows.map(r=>'<tr><td data-label="单号与对象" class="record-title">'+E(r.counterparty)+'<small>'+E(documentNo(r))+'</small></td><td data-label="业务">'+E(r.business)+(receive?'':'<small>'+E(r.status)+'</small>')+(receive?'<strong>'+E(r.reconciliationStatus==='历史记录（未单列对账状态）'?(r.verifiedByHolder===true?'已核实':'已登记'):r.reconciliationStatus)+'</strong>'+(r.reconciliation?.checkedAt?'<small>'+E(r.reconciliation.checkedByName)+' · '+E(displayTime(r.reconciliation.checkedAt))+' · 核对 '+M(r.reconciliation.actualCheckedAmount)+'</small>':'')+(r.reconciliation?.note?'<small>'+E(r.reconciliation.note)+'</small>':''):'')+'</td><td data-label="金额"><strong>'+M(r.amount)+'</strong></td><td data-label="账户">'+E(receiptAccountLabel(r))+'<small>'+E(r.accountName==='信号机微信'?'门店设备':r.accountName==='现金库'?'门店抽屉':r.accountOwnerName||'原记录未填持有人')+'</small>'+'</td><td data-label="日期">'+E(r.date)+'</td><td data-label="原单">'+E(documentRef(r,"sourceId"))+'</td><td data-label="操作">'+redPacketEntry('receipts',r)+button('查看明细','financial-detail',r.id)+(receive&&r.reconciliationStatus==='待营业员更正'&&(data.canReconcile||r.reconciliation?.returnedToId===state.user.id)?'<button type="button" data-receipt-revise="'+E(r.sourceId)+'">更正名称</button>':'')+(receive&&data.canReconcile&&r.reconciliation&&r.status!=='已红冲'&&['待老板核对','有差异','已核对'].includes(r.reconciliationStatus)?'<button type="button" data-receipt-return="'+E(r.sourceId)+'">退回更正</button>':'')+(receive&&data.canReconcile&&r.status!=='已红冲'&&['待老板核对','有差异'].includes(r.reconciliationStatus)?'<button type="button" class="primary" data-receipt-reconcile="'+E(r.sourceId)+'">老板对账</button>':'')+'</td></tr>'))+'</section>':paymentDocumentList(data,filter));
 state.financialRows=data.rows;state.financialView=receive?'flows':'documents';state.financialFilteredToParty=!receive&&Boolean(data.filteredToParty||data.filterNotice);
  if(receive){const label=document.createElement('label');label.textContent='业务类型';const select=document.createElement('select');select.name='kind';select.setAttribute('aria-label','收款业务类型');for(const [value,text]of [['','全部收款'],['sale','销售收款'],['cash_recharge','充值收款'],['other_income','其他收款'],['supplier_refund','供货商退款'],['carrier','移动酬金到账']])select.add(new Option(text,value));select.value=filter.kind||'';label.append(select);$('financial-filter').prepend(label);}
 const newFor=new URLSearchParams(location.search).get('newFor');if(newFor&&state.masterFinancialOpen!==direction+':'+newFor){state.masterFinancialOpen=direction+':'+newFor;void newFinancial(direction,newFor);}
 $('financial-filter').onsubmit=async e=>{e.preventDefault();state[direction+'Filter']=Object.fromEntries(new FormData(e.currentTarget));await renderFinancial(direction).catch(showError)};
 $('financial-today').onclick=async()=>{state[direction+'Filter']={q:'',from:today(),to:today()};await renderFinancial(direction).catch(showError)};
 $('financial-all').onclick=async()=>{state[direction+'Filter']={q:'',from:'',to:''};await renderFinancial(direction).catch(showError)};
 $('main').querySelectorAll('[data-receipt-reconcile]').forEach(button=>button.onclick=()=>reconcileFinancial(button.dataset.receiptReconcile));
 $('main').querySelectorAll('[data-receipt-return]').forEach(b=>b.onclick=()=>returnFinancial(b.dataset.receiptReturn));
 $('main').querySelectorAll('[data-receipt-revise]').forEach(b=>b.onclick=()=>reviseFinancialName(b.dataset.receiptRevise));
}
async function newFinancial(direction,selectedKey=''){
 try{const directory=await window.MasterDataUI.fresh();selectedKey=selectedKey||new URLSearchParams(location.search).get('newFor')||'';let parties=directory.parties.filter(p=>p.active!==false&&!p.system);
 modal(direction==='receive'?'登记其他收款':'登记费用付款',[
 {name:'businessPurpose',label:'业务性质',required:true,value:'operating',options:[{value:'operating',label:direction==='receive'?'正常收入':'日常费用'}]},
 {name:'fundPartyKey',label:direction==='receive'?'付款方（选填）':'收款方（基础档案）',required:direction!=='receive',value:selectedKey,options:[{value:'',label:direction==='receive'?'其他（可不选）':'请选择往来对象'},...parties.map(p=>({value:p.key,label:p.name+' · '+({person:'人员',supplier:'供货商',organization:'往来单位',platform:'平台'})[p.kind]}))]},moneyField('amount','实际金额'),accountField,
 {name:'date',label:'实际日期',type:'date',value:today(),required:true},
 {name:'reference',label:'支付流水号',hint:'非现金填写支付凭证，便于核对。'},
 {name:'note',label:direction==='receive'?'备注':'收付事由',type:'textarea',wide:true,required:true},
 {name:'confirmed',label:direction==='receive'?'我声明已按实际收款登记，登记后发老板对账':'已核实实际付款',type:'checkbox'}
 ],(d,write)=>{if(d.businessPurpose==='agency_topup'&&(!Array.isArray(d.payments)||d.payments.length!==1||d.payments[0].account!==(direction==='receive'?'现金':'微信')))throw Error(direction==='receive'?'代充值收款请选择一笔门店现金；门店微信付款另开单。':'代充值付款请选择一笔门店微信；现金收款另开单。');return write('/api/financial-documents',{...d,direction,businessPurpose:d.businessPurpose||'operating',amount:Number(d.amount)});},direction==='receive'?'收款进入所选账户并发老板对账。门店现金、门店微信归门店；交给个人须另开内部交接单，由接收人本人确认。已有业务随原单生成，请勿重复登记。':'门店付款单只可选择门店现金或门店微信。已有业务随原单生成，请勿重复登记。',{mode:direction==='receive'?'receive':'pay',...(direction==='pay'?{allowedAccountNames:['现金库','信号机微信'],requireNamedAccount:true}:{})});
 const form=$('modal-form'),purpose=form.elements.businessPurpose,purposeHint=document.createElement('p');purposeHint.className='hint';purpose.parentElement.after(purposeHint);purpose.onchange=()=>{purposeHint.textContent=purpose.value==='agency_topup'?(direction==='receive'?'代充值收款只收一笔门店现金，不计营业收入；门店微信付款另开单，随后手动关联。':'代充值付款只登记一笔门店微信支出，不计日常费用；随后手动关联原现金收款单。'):'按正常收入或日常费用登记。';};purpose.onchange();const select=form.elements.fundPartyKey,add=document.createElement('a');add.className='secondary';add.textContent='到基础资料管理维护（新窗口）';add.href='/master-data#party-basics';add.target='_blank';add.rel='noopener';select.after(add);const refresh=document.createElement('button');refresh.type='button';refresh.className='secondary';refresh.textContent='刷新往来对象';add.after(refresh);const search=document.createElement('input');search.type='search';search.placeholder='查找收付款单位';search.setAttribute('aria-label','查找收付款单位');select.before(search);search.oninput=()=>{const chosen=select.value,q=search.value.trim().toLowerCase();select.innerHTML='<option value="">请选择往来对象</option>'+parties.filter(p=>!q||p.name.toLowerCase().includes(q)||p.key===chosen).map(p=>'<option value="'+E(p.key)+'">'+E(p.name)+'</option>').join('');select.value=chosen;};refresh.onclick=async()=>{const chosen=select.value;refresh.disabled=true;try{const next=await window.MasterDataUI.fresh();if(!form.isConnected)return;parties=next.parties.filter(p=>p.active!==false&&!p.system);search.value='';search.oninput();select.value=parties.some(p=>p.key===chosen)?chosen:'';}catch(error){toast(error.message||'往来对象未刷新，请保留填写内容重试',true);}finally{refresh.disabled=false;}};
 }catch(error){toast(error.message||'往来档案读取失败，请刷新',true);}
}

function returnFinancial(id){const r=state.financialRows.find(r=>r.sourceId===id);if(!r)return;
 modal('退回营业员更正',[{name:'note',label:'更正要求（选填）',type:'textarea',wide:true}],(d,write)=>write('/api/financial-documents/return',{id,version:r.reconciliation.version,note:d.note||''}).then(r=>({...r,officeRefresh:'receipt-review'})),'原营业员更正后，重新提交老板核对。');$('modal-form').querySelector('[type=submit]').textContent='确认退回更正';}
function reviseFinancialName(id){const r=state.financialRows.find(r=>r.sourceId===id);if(!r)return;
 modal('更正收款单名称',[{name:'name',label:'名称',value:r.counterparty,required:true}],(d,write)=>write('/api/financial-documents/revise',{id,version:r.reconciliation.version,name:d.name}).then(r=>({...r,officeRefresh:'receipt-review'})),r.reconciliation.note||'按老板要求更正名称，提交后重新核对。');$('modal-form').querySelector('[type=submit]').textContent='更正后重新提交';}
function reconcileFinancial(id){
 if(state.user.roleCode!=='owner')return toast('收款对账由老板本人记录',true);
 const row=state.financialRows.find(r=>r.sourceId===id&&r.reconciliation);if(!row)return toast('请先刷新原收款单',true);
 modal('收款单事后对账',[
 {name:'decision',label:'对账结果',options:[{value:'match',label:'核对一致'},{value:'dispute',label:'有差异，保留原账并说明'}],required:true},
 moneyField('actualAmount','请填写实际核对金额（元）'),
 {name:'note',label:'核实说明（有差异必填）',type:'textarea',wide:true},
 ...(row.account==='现金'?[]:[{name:'holderVerified',label:'所有分笔均实际进入我本人持有账户，我已人工核实（选填）',type:'checkbox'}])
 ],(d,write)=>write('/api/financial-documents/reconcile',{id,version:row.reconciliation.version,decision:d.decision,actualAmount:d.actualAmount,note:d.note||'',holderVerified:d.holderVerified}),
 '原单账面已登记 '+M(row.reconciliation.registeredAmount)+'。请实际核对账户、金额及流水；此操作只记录对账结果，不重复生成收款，也不会自动调整差异。');
 $('modal-form').querySelector('button[type=submit]').textContent='记录对账结果';
}

function paymentDocumentDate(row){return row.dateTo&&row.dateTo!==row.date?(row.date||'—')+' 至 '+row.dateTo:row.date||'—';}
function paymentDocumentSource(row){const href=String(row.sourceHref||'');return href.startsWith('/')&&!/^\/[\\/]/.test(href)&&!/[\\\u0000-\u0020]/.test(href)?'<a href="'+E(href)+'">打开原业务</a>':'';}
function paymentDocumentAccounts(row){return row.accounts?.length?row.accounts.map(account=>'<span>'+E(receiptAccountLabel(account))+' '+M(account.amount)+'</span>').join('<br>'):E(row.accountSummary||'原记录未填账户');}
function paymentDocumentFlowCount(row){return row.parts?.length?new Set(row.parts.map(part=>part.id).filter(Boolean)).size:row.partCount??0;}
function paymentDocumentAttribution(part){if(!part.projectionKey&&!part.attributionCorrected)return part.counterparty?'<small>对象：'+E(part.counterparty)+'</small>':'';return '<small>归属：'+E(part.counterparty||part.supplierName||part.supplierId||'待核实')+'</small>'+(part.originalSupplierName||part.originalSupplierId?'<small>原供货商：'+E(part.originalSupplierName||part.originalSupplierId)+'</small>':'');}
function paymentDocumentList(data,filter){
 const rows=data.rows||[],flowCount=data.flowCount??new Set(rows.flatMap(row=>(row.parts||[]).map(part=>part.id)).filter(Boolean)).size;
 return '<section class="card mobile-record-list"><h2>'+(data.documentCount??rows.length)+' 张单据 / '+flowCount+' 笔付款流水</h2><p>有效付款 '+M(data.total)+'</p>'+(data.filteredToParty||data.filterNotice||rows.some(row=>row.filteredToParty)?'<p>仅所选往来单位的付款份额</p>':'')+(filter.sourceId?'<p>当前仅显示所点原单。点击“全部”返回列表。</p>':'')+(rows.length?table(['单据号','付款单位 / 对象','对应业务','付款账户','金额','日期','状态','操作'],rows.map(row=>'<tr><td data-label="单据号" class="record-title"><strong>'+E(row.displayNo||row.sourceDisplayNo||row.sourceId||row.id)+'</strong><small>'+E(paymentDocumentFlowCount(row))+' 笔付款流水</small></td><td data-label="付款单位 / 对象">'+E(row.counterparty||'—')+'</td><td data-label="对应业务">'+E(row.business||'—')+(row.sourceWarning?'<small>'+E(row.sourceWarning)+'</small>':'')+'</td><td data-label="付款账户">'+paymentDocumentAccounts(row)+'</td><td data-label="金额"><strong>'+M(row.amount)+'</strong>'+(Number(row.activeAmount??row.amount)!==Number(row.amount)?'<small>有效付款 '+M(row.activeAmount)+'</small>':'')+'</td><td data-label="日期">'+E(paymentDocumentDate(row))+'</td><td data-label="状态">'+E(row.status||'已登记')+'</td><td data-label="操作">'+button('查看分笔流水','financial-detail',row.id)+paymentDocumentSource(row)+'</td></tr>')):'<p class="empty">没有符合条件的付款单据。</p>')+'</section>';
}
function paymentDocumentDetail(row){
 const parts=row.parts||[],flowCount=paymentDocumentFlowCount(row),dialog=document.createElement('dialog');dialog.className='system-dialog';dialog.style.width='min(1100px,calc(100vw - 20px))';
 const linked=parts.some(part=>part.walletCashExchange),agency=linked||row.businessPurpose==='agency_topup'||parts.some(part=>part.businessPurpose==='agency_topup');
 dialog.innerHTML='<div class="system-dialog-head"><h2>付款单据 · 分笔流水</h2><button type="button">返回</button></div>'+((row.filteredToParty||state.financialFilteredToParty)?'<p>仅所选往来单位的付款份额</p>':'')+'<dl class="document-details">'+[['单据号',row.displayNo||row.sourceDisplayNo||row.sourceId||row.id],['付款对象',row.counterparty||'—'],['对应业务',row.business||'—'],...(row.sourceWarning?[['来源说明',row.sourceWarning]]:[]),['本次可见付款金额',M(row.amount)],['有效付款',M(row.activeAmount??row.amount)],['日期',paymentDocumentDate(row)],['状态',row.status||'已登记'],['经办',row.operator||'—'],['事由',row.note||'—']].map(([name,value])=>'<div><dt>'+E(name)+'</dt><dd>'+E(value)+'</dd></div>').join('')+'</dl><div class="system-actions">'+paymentDocumentSource(row)+(agency?'<a href="/topup-pairs">代充值两单关联</a>':'')+'</div><section class="card mobile-record-list"><h3>'+flowCount+' 笔付款流水 / '+parts.length+' 条明细</h3>'+table(['付款流水号','账户','金额','日期','支付流水号','经办','状态','关联收款'],parts.map(part=>'<tr><td data-label="付款流水号" class="record-title"><strong>'+E(documentNo(part))+'</strong>'+(part.displayNo&&part.id!==part.displayNo?'<small>流水编号 '+E(part.id)+'</small>':'')+(part.partId?'<small>分笔编号 '+E(part.partId)+'</small>':'')+paymentDocumentAttribution(part)+'</td><td data-label="账户">'+E(receiptAccountLabel(part))+'</td><td data-label="金额"><strong>'+M(part.amount)+'</strong>'+(part.projectionKey||part.attributionCorrected?'<small>归属份额</small>':'')+'</td><td data-label="日期">'+E(part.date||part.transactionDate||'—')+'</td><td data-label="支付流水号">'+E(part.reference||'—')+'</td><td data-label="经办">'+E(part.operator||'—')+'</td><td data-label="状态">'+E(part.status||'已登记')+'</td><td data-label="关联收款">'+(part.walletCashExchange?.otherReceiptId?'<a href="/app?tab=receipts&amp;sourceId='+encodeURIComponent(part.walletCashExchange.otherReceiptId)+'">查看现金收款单</a><small>代充值 · 已关联</small>':part.businessPurpose==='agency_topup'?'<a href="/topup-pairs">代充值 · 待关联</a>':'—')+'</td></tr>'))+'</section>';
 document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.showModal();
}
function detail(id){
 const row=state.financialRows.find(x=>x.id===id);if(!row)return;
 if(state.financialView==='documents'&&Array.isArray(row.parts))return paymentDocumentDetail(row);
 const goods=(row.goods||[]).map(x=>x.name+' × '+x.quantity+(x.type||x.subType||x.thirdType?' · '+[x.type,x.subType,x.thirdType].filter(Boolean).join(' / '):'')+(x.externalCode?' · 商品编码 '+x.externalCode:'')+(x.serialNo?' · 串号 '+x.serialNo:'')).join('；');
 const outbound=(row.outbound||[]).map(x=>x.id+' · '+x.product+' × '+x.quantity+' · '+x.warehouseName).join('；');
 const dialog=document.createElement('dialog');dialog.className='system-dialog';dialog.innerHTML='<div class="system-dialog-head"><h2>单据明细</h2><button type="button">返回</button></div><dl class="document-details">'+[['单号',documentNo(row)],['原单',documentRef(row,'sourceId')],['销售单',row.saleDisplayNo||'—'],['出货凭据号',row.outboundDisplayNo||'—'],['销售商品',goods||'—'],['出货流水 / 仓库',outbound||'—'],['业务',row.business],['业务性质',row.businessPurpose==='internal_transfer'?'门店互转（不计损益）':row.businessPurpose==='agency_topup'||row.walletCashExchange?'代充值（不计损益）':'正常经营'],['对象',row.counterparty],['金额',M(row.amount)],['账户',receiptAccountLabel(row)],['分笔编号',row.partId||'—'],['日期',row.date],['流水号',row.reference||'—'],['操作人',row.operator],['状态',row.status],['事由',row.note||'—']].map(([name,val])=>'<div><dt>'+E(name)+'</dt><dd>'+E(val)+'</dd></div>').join('')+'</dl>'+(row.saleId?'<p><a href="/app?tab=orders&amp;q='+encodeURIComponent(row.saleId)+'">打开原销售单</a></p>':'');document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();const edits=(row.reconciliation?.events||[]).filter(e=>e.beforeName||e.afterName);if(edits.length)dialog.insertAdjacentHTML('beforeend','<h3>更正记录</h3>'+edits.map(e=>'<p>'+E(e.action)+' · '+E(e.name||e.by)+' · '+E(e.at)+(e.afterName?'<br>'+E(e.beforeName)+' → '+E(e.afterName):'')+(e.note?'<br>'+E(e.note):'')+'</p>').join(''));dialog.onclose=()=>dialog.remove();dialog.showModal();
}
function requestLines(row){
 const payload=row.payload||{};
 const returned=(row.returnItems||row.items||(row.kind==='exchange'?payload.returns:payload.items)||[]).map(x=>(x.name||x.itemId||x.skuId||'商品')+' × '+x.quantity+(x.serialNo?' · '+x.serialNo:'')).join('、');
 const replaced=(row.exchangeItems||payload.items||[]).map(x=>(x.name||x.skuId||'商品')+' × '+x.quantity+(x.serialNo?' · '+x.serialNo:'')).join('、');
 return (returned?'<p>退回：'+E(returned)+'</p>':'')+(row.kind==='exchange'&&replaced?'<p>换出：'+E(replaced)+'</p>':'');
}
async function renderReturnRequests(current){
 const response=await officePageRead(current,()=>api('/api/sale-return-requests'));if(!current())return;
 const rows=Array.isArray(response)?response:response.rows||[];state.saleReturnRequests=rows;
 const focusId=new URLSearchParams(location.search).get('focusSaleReturn');
 const owner=state.user.roleCode==='owner';
 const html=(focusId?rows.filter(r=>r.id===focusId):rows.filter(r=>documentMatches(r))).map(r=>'<tr><td data-label="申请与原单"><strong>'+E(r.kind==='exchange'?'换货申请':'退货申请')+'</strong><small>'+E(documentNo(r))+' · 原单 '+E(documentRef(r,"orderId"))+'</small><small>'+E(r.requesterName||r.requester||r.operator||r.requesterId||'')+' · '+E(displayTime(r.createdAt))+'</small></td><td data-label="金额与商品"><strong>'+M(r.amount)+'</strong>'+requestLines(r)+(r.refundAmount!=null?'<p>老板支付退款 '+M(r.refundAmount)+(r.businessApplied?' · 已记账':' · 待确认')+'</p>':'')+(r.returnWarehouseName?'<p>退回 '+E(r.returnWarehouseName)+'</p>':'')+(r.retainedAmount?'<p>退货扣款 '+M(r.retainedAmount)+'</p>':'')+(r.kind==='exchange'&&r.difference!=null?'<p>'+E(Number(r.difference)>0?'补收':Number(r.difference)<0?'退款':'无差额')+' '+M(Math.abs(Number(r.difference)))+'</p>':'')+'</td><td data-label="申请原因">'+E(r.reason||r.payload?.reason||'—')+'</td><td data-label="状态"><strong>'+E(r.status)+'</strong>'+(r.reviewNote?'<p>'+E(r.reviewNote)+'</p>':'')+'</td><td data-label="操作">'+redPacketEntry('saleReturnRequests',r)+(owner&&r.status==='待老板审核'?button('批准并生效','sale-return-approve',r.id,'primary')+button('驳回','sale-return-reject',r.id):r.status==='待老板审核'?'<span>等待老板同意</span>':'')+'</td></tr>');
 if(focusId)$('main').innerHTML=heading('退换货审批','只显示这张申请。核对原单、金额和原因后处理。')+'<p><a href="/app?tab=returns">查看全部申请</a></p>';
 $('main').insertAdjacentHTML('beforeend','<section class="card mobile-record-list" id="sale-return-requests"><h2>'+ (owner?'退换货审批':'我提交的退换货申请')+'</h2><p>批准后才变动库存、销售与退款记录。普通入库和销售可直接开单。</p>'+(focusId&&!html.length?'<p role="status">这张申请已处理或未找到，请返回老板看台刷新。</p>':'')+table(['申请与原单','金额与商品','申请原因','状态','操作'],html)+'</section>');
 if(location.hash==='#sale-return-requests')$('sale-return-requests').scrollIntoView({block:'start'});
}
function reviewReturnRequest(id,decision){
 if(state.user.roleCode!=='owner')return toast('退换货由老板确认',true);
 const row=(state.saleReturnRequests||[]).find(x=>x.id===id);if(!row||row.status!=='待老板审核')return toast('此申请已处理，请刷新',true);
 const approve=decision==='approve',ex=row.kind==='exchange',fields=approve?[moneyField('returnValue',ex?'退回商品作价':'确认退款金额',row.approvedReturnValue??row.requestedReturnValue??row.payload?.returnValue??row.amount),{name:'returnWarehouseId',label:'退回仓库',value:row.payload?.returnWarehouseId,options:state.warehouses.filter(w=>w.active!==false).map(w=>({value:w.id,label:w.name})),required:true},{name:'paymentMode',label:'支付信息',options:['老板支付'],value:'老板支付'},{name:'note',label:'备注（选填）',type:'textarea',wide:true}]:[{name:'note',label:'备注（选填）',type:'textarea',wide:true}];
 modal(approve?'确认'+(ex?'换货':'退货'):'驳回申请',fields,(d,write)=>write('/api/sale-return-requests/review',{id,decision,note:d.note||'',confirmed:approve,refundConfirmed:approve,...(approve?{returnValue:d.returnValue,refundAmount:d.returnValue,returnWarehouseId:d.returnWarehouseId}:{})}),approve?'核对退回实物及款项。点确认即确认按最终金额退款或处理换货差额，系统记老板支付并更新所选仓库；不重复开费用单。':'驳回不会改变库存或资金。');
 const form=$('modal-form');form.querySelector('button[type=submit]').textContent=approve?'确认'+(ex?'换货':'退货'):'确认驳回';
 if(approve){const info=document.createElement('p');info.setAttribute('role','status');form.querySelector('.form-actions').before(info);const update=()=>{const v=Number(form.elements.returnValue.value||0),face=Number(row.originalReturnAmount??row.amount),delta=Number(row.saleAmount||0)-v;info.textContent='原单退回商品金额 '+M(face)+' · 退货扣款 '+M(face-v)+(ex?' · '+(delta>0?'需补收 ':delta<0?'老板退款 ':'无补退 ')+M(Math.abs(delta)):' · 老板支付 '+M(v));};form.addEventListener('input',update);update();}
}
async function openingPurchaseReturn(){
 const rows=await api('/api/opening-purchase-return-candidates');if(!rows.length)return toast('没有来源和供货商明确的期初可退库存，请先核对库存来源',true);
 const reference='OPEN-RETURN-'+crypto.randomUUID(),label=r=>r.name+' · '+r.warehouseName+' · '+r.supplier+' · 可退 '+r.quantity+' '+r.unit;
 modal('期初库存退给供货商',[
  {name:'openingSearch',label:'快速搜索',type:'search',wide:true,placeholder:'名称 / 编码 / 供货商 / 串号'},
  {name:'openingKey',label:'期初库存商品',options:[{value:'',label:'请选择期初库存'},...rows.map(r=>({value:r.key,label:label(r)}))],searchable:false,required:true,wide:true},
  qtyField('quantity','退回数量',1),moneyField('unitPrice','退货单价',0),
  {name:'serialNos',label:'退回串号',type:'textarea',wide:true},
  {name:'kind',label:'返还方式',options:[{value:'cash',label:'供货商应退款'},{value:'credit',label:'抵货款'}]},
  {name:'reference',label:'对方单号（选填）'},
  {name:'note',label:'备注（选填）',type:'textarea',wide:true}
 ],async(d,write)=>{const selected=rows.find(r=>r.key===d.openingKey);if(!selected)throw Error('请选择期初库存商品');return write('/api/purchase-return-requests',{sourceType:'opening',openingKey:selected.key,supplierId:selected.supplierId,quantity:Number(d.quantity),unitPrice:Number(d.unitPrice),serialNos:String(d.serialNos||'').split(/[\s,，]+/).filter(Boolean),kind:d.kind,reference:d.reference||reference,note:d.note||'',confirmed:true});},'老板批准后生效；收到退款另行确认。');
 const form=$('modal-form'),select=form.elements.openingKey,search=form.elements.openingSearch,serialField=form.elements.serialNos.closest('.field'),info=document.createElement('small');info.setAttribute('role','status');select.after(info);form.querySelector('button[type=submit]').textContent='提交老板审批';
 function sync(){const row=rows.find(r=>r.key===select.value);form.elements.unitPrice.value=String(row?.unitPrice||0);form.elements.quantity.max=row?String(row.quantity):'';form.elements.serialNos.value='';form.elements.serialNos.required=!!row?.serialRequired;serialField.hidden=!row?.serialRequired;info.textContent=row?'期初批次 '+row.openingBatchId+(row.serialRequired?' · 可退串号 '+row.serialNos.join('、'):''):'';}
 search.addEventListener('input',()=>{const before=select.value,terms=search.value.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean),found=rows.filter(r=>terms.every(t=>[r.name,r.externalCode,r.supplier,r.warehouseName,...r.serialNos].join(' ').normalize('NFKC').toLowerCase().includes(t)));select.innerHTML=option('',found.length?'请选择期初库存':'没有匹配的期初库存')+found.map(r=>option(r.key,label(r))).join('');select.value=found.some(r=>r.key===before)?before:'';if(select.value!==before)sync();});
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const available=Array.from(select.options).filter(o=>o.value);if(available.length===1){select.value=available[0].value;sync();}select.focus();}});select.addEventListener('change',sync);sync();
}

function purchaseReturn(id){
 const order=(state.purchaseOrders||[]).find(x=>x.id===id);if(!order)return toast('请先刷新入库记录',true);
 const items=order.items||[];if(!items.length)return toast('这张入库单没有可选商品',true);
 modal('申请采购退货 · '+documentNo(order),[
  {name:'itemId',label:'原入库商品',options:items.map(x=>({value:x.id,label:x.name+' · 原入库 '+x.quantity})),required:true},
  qtyField('quantity','申请退回数量',1),moneyField('unitPrice','往来单位确认的退货单价',items[0].costPrice||0),
  {name:'serialNos',label:'退回手机串号',type:'textarea',wide:true,hint:'手机每行一个串号，数量须一致；无串号商品可留空。'},
  {name:'kind',label:'往来单位返还方式',options:[{value:'cash',label:'往来单位应退款'},{value:'credit',label:'仅抵货款'}]},
  {name:'reference',label:'往来单位确认编号',required:true},
  {name:'note',label:'退货原因与双方确认依据',type:'textarea',wide:true,required:true}
 ],async(d,write)=>{const result=await write('/api/purchase-return-requests',{supplierId:order.supplierId,purchaseId:id,itemId:d.itemId,quantity:Number(d.quantity),unitPrice:Number(d.unitPrice),serialNos:d.serialNos.split(/[\s,，]+/).filter(Boolean),kind:d.kind,reference:d.reference,note:d.note,confirmed:true});return {...result,message:result.message||'采购退货申请已提交，等待老板批准；库存和往来账尚未变化。'};},'员工先提交申请，老板本人批准后才扣减库存和登记往来单位往来，普通入库可直接办理。');
 const form=$('modal-form');form.querySelector('button[type=submit]').textContent='提交采购退货申请';
 form.elements.itemId.addEventListener('change',()=>{const item=items.find(x=>x.id===form.elements.itemId.value);form.elements.unitPrice.value=String(item?.costPrice||0);form.elements.serialNos.value='';});
}
async function renderPurchaseReturnRequests(current,options={}){
 const response=options.rows||await officePageRead(current,()=>api('/api/purchase-return-requests'));if(!current())return;
 const rows=Array.isArray(response)?response:response.rows||[];state.purchaseReturnRequests=rows;
 const focusId=new URLSearchParams(location.search).get('focusPurchaseReturn');
 const owner=state.user.roleCode==='owner';
 const html=(focusId?rows.filter(r=>r.id===focusId):rows.filter(r=>documentMatches(r))).map(r=>'<tr><td data-label="申请与原单"><strong>'+E(documentNo(r))+'</strong><small>'+E(r.sourceType==='opening'?'期初库存 · '+r.openingBatchId+' · '+r.warehouseName+' · '+r.supplier+' · '+(r.payload.kind==='credit'?'抵货款':'供货商应退款'):'原入库 '+documentRef(r,"purchaseId"))+'</small><small>'+E(r.requesterName||r.requester||r.operator||'')+' · '+E(displayTime(r.createdAt))+'</small></td><td data-label="商品与金额"><p>'+E(r.productName||r.name||r.items?.map(x=>x.name+' × '+x.quantity).join('、')||r.itemId||'商品')+(r.quantity!=null?' × '+E(r.quantity):'')+'</p><strong>'+M(r.amount)+'</strong>'+(r.serialNos?.length?'<p>'+E(r.serialNos.join('、'))+'</p>':'')+'</td><td data-label="退货依据">'+E(r.note||r.reason||'—')+'</td><td data-label="状态"><strong>'+E(r.status)+'</strong>'+(r.reviewNote?'<p>'+E(r.reviewNote)+'</p>':'')+'</td><td data-label="操作">'+redPacketEntry('purchaseReturnRequests',r)+(owner&&r.status==='待老板审核'?button('批准并生效','purchase-return-approve',r.id,'primary')+button('驳回','purchase-return-reject',r.id):r.status==='待老板审核'?'<span>等待老板同意</span>':'')+'</td></tr>');
 const main=$('main'),existing=$('purchase-return-requests'),section='<section class="card mobile-record-list" id="purchase-return-requests"><h2>'+ (owner?'采购退货审批':'我提交的采购退货申请')+'</h2><p>老板批准后才扣库存、登记往来单位往来；提交申请时不入账。</p>'+(focusId&&!html.length?'<p role="status">这张申请已处理或未找到，请返回老板看台刷新。</p>':'')+table(['申请与原单','商品与金额','退货依据','状态','操作'],html)+'</section>';
 if(focusId)main.innerHTML=heading('采购退货审批','只显示这张申请。核对原单、金额和原因后处理。')+'<p><a href="/app?tab=purchase">查看全部申请</a></p>'+section;
 else if(existing)existing.outerHTML=section;
 else main.insertAdjacentHTML('beforeend',section);
 if(options.scroll!==false&&!existing&&location.hash==='#purchase-return-requests')$('purchase-return-requests').scrollIntoView({block:'start'});
}
function refreshPurchaseReturnReview(result){
 const {officeRefresh,message,...row}=result;state.purchaseReturnRequests||=[];
 const index=state.purchaseReturnRequests.findIndex(r=>r.id===row.id);if(index<0)state.purchaseReturnRequests.unshift(row);else state.purchaseReturnRequests[index]={...state.purchaseReturnRequests[index],...row};
 if(state.tab!=='purchase')return;
 const focusId=new URLSearchParams(location.search).get('focusPurchaseReturn');if(focusId&&focusId!==row.id)return;
 return renderPurchaseReturnRequests(officePageCurrent(),{rows:state.purchaseReturnRequests,scroll:false});
}
function reviewPurchaseReturnRequest(id,decision){
 if(state.user.roleCode!=='owner')return toast('采购退货必须由老板本人批准',true);
 const row=(state.purchaseReturnRequests||[]).find(x=>x.id===id);if(!row||row.status!=='待老板审核')return toast('这份申请已处理，请刷新查看',true);
 modal(decision==='approve'?'老板批准采购退货':'驳回采购退货申请',[{name:'note',label:row.sourceType==='opening'?'备注（选填）':decision==='approve'?'批准意见':'驳回原因',type:'textarea',wide:true,required:row.sourceType!=='opening',hint:row.sourceType==='opening'?'':'核实原入库、实物和往来单位退货依据后，填写处理意见。'}],(d,write)=>write('/api/purchase-return-requests/review',{id,decision,note:d.note||(row.sourceType==='opening'?(decision==='approve'?'老板确认期初库存退货':'老板驳回期初库存退货'):''),confirmed:decision==='approve'}).then(result=>({...result,officeRefresh:'purchase-return-review',message:decision==='approve'?'采购退货已批准并生效':'采购退货申请已驳回'})),decision==='approve'?'确认批准后才扣减库存，并登记往来单位退款或抵货款记录。':'驳回后库存和往来账保持原状。');
 $('modal-form').querySelector('button[type=submit]').textContent=decision==='approve'?'确认批准并生效':'确认驳回';
}
function catalogFacts(row){
 const p=row.current||row.detail||{};
 if(['fundParty','category','warehouse'].includes(row.kind))return '<p>名称：'+E(p.name||row.name)+'</p>'+(p.path?'<p>分类：'+E(p.path.join(' / '))+'</p>':'')+(p.contact?'<p>联系：'+E(p.contact)+'</p>':'')+'<a href="/master-data?review='+encodeURIComponent(row.id)+'">打开这一条基础资料</a>';
 const facts=row.kind==='businessOption'?[['名称',p.name||row.name],['选项用途',({type:'业务类型',subType:'业务细类',receptionSource:'接待来源',receptionPurpose:'接待来意'})[p.kind]||p.kind||'—'],['所属类型',p.parentName||'—'],['所属业务',({card:'号卡',recharge:'充值',broadband:'宽带',package:'套餐',contract:'设备绑合约',other:'其他业务（仅分月酬金）'})[p.baseType]||p.baseType||'—'],['细类归属',({new:'新开卡',replace:'补卡',topup:'话费充值',fusion:'融合宽带',other:'其他',up:'套餐升档',down:'套餐降档',device:'设备绑合约',unknown:'未分类／待核对'})[p.baseSubType]||p.baseSubType||'—']]:row.kind==='paymentAccount'?[['名称',p.name||row.name],['收付款方式',p.channel||'—'],['实际持有人',p.ownerName||'待核对'],['状态',p.active===false?'已停用':p.active===true?'启用':'待核对'],['备注',p.note||'—']]:row.kind==='supplier'?[['名称',p.name||row.name],['联系方式',p.contact||'暂未填写'],['备注',p.note||'—']]:[['名称',p.name||row.name],['编号',p.externalCode||'—'],['分类',[p.type,p.subType,p.thirdType].filter(Boolean).join(' / ')||'—'],['计量单位',p.unit||'—'],['售价',p.salePrice!=null?M(p.salePrice):'—']];
 return facts.map(([key,value])=>'<p>'+E(key)+'：'+E(value)+'</p>').join('');
}
function replaceCatalogReview(html){const previous=$('catalog-reviews');if(previous)previous.outerHTML=html;else $('main').insertAdjacentHTML('beforeend',html);}
async function renderCatalogReviews(current){
 if(new URLSearchParams(location.search).get('focusPurchaseReturn'))return;
 if(state.user.roleCode!=='owner')return;
 const response=await officePageRead(current,()=>api('/api/catalog-reviews'));if(!current()||state.user.roleCode!=='owner')return;
 const rows=Array.isArray(response)?response:response.rows||[];state.catalogReviews=rows;
 const focusCatalogId=new URLSearchParams(location.search).get('catalogReview');
 const pendingStatus=new Set(["待老板核对","需完善"]);
 const pendingRows=rows.filter(row=>pendingStatus.has(row.status));
 const historyRows=rows.filter(row=>!pendingStatus.has(row.status));
 const visibleRows=focusCatalogId?rows.filter(row=>row.id===focusCatalogId):pendingRows;
 const renderReviewRow=r=>'<tr><td data-label="新增档案"><strong>'+E(({supplier:'往来单位',fundParty:'往来单位／平台',category:'商品分类',warehouse:'仓库',paymentAccount:'收付款账户',businessOption:'业务选项',product:'商品'})[r.kind]||'档案')+' · '+E(r.current?.name||r.name)+'</strong><small>'+E(r.requester||r.requesterName||'')+' · '+E(displayTime(r.createdAt))+'</small></td><td data-label="现有资料">'+catalogFacts(r)+'</td><td data-label="核对状态"><strong>'+E(r.status)+'</strong>'+(r.reviewNote?'<p>'+E(r.reviewNote)+'</p>':'')+'</td><td data-label="操作">'+(['待老板核对','需完善'].includes(r.status)?button('是，确认','catalog-confirm',r.id,'primary')+button('否，退回待完善','catalog-needs-changes',r.id):'')+(r.current||r.kind==='businessOption'?button(r.kind==='paymentAccount'?'查看账户':r.kind==='businessOption'?'查看业务选项':'编辑原档案','catalog-edit',r.id):'')+'</td></tr>';
 const html=visibleRows.map(renderReviewRow);
 const headers=['新增档案','现有资料','核对状态','操作'];
 const mainList=focusCatalogId&&!visibleRows.length
  ? '<p role="status">未找到编号 '+E(focusCatalogId)+' 的档案核对记录，请返回老板看台刷新。</p>'
  : visibleRows.length?table(headers,html):'<p>暂无待核对档案。</p>';
 const historyShell=!focusCatalogId&&historyRows.length
  ? '<details id="catalog-review-history"><summary>已处理历史（'+historyRows.length+' 条）</summary><div id="catalog-review-history-list"></div></details>'
  : '';
 replaceCatalogReview('<section class="card mobile-record-list" id="catalog-reviews"><h2>新增档案核对</h2><p>商品、往来单位、收付款账户和业务选项新增后立即可用。账户仅登记信息，不代表款项到账。核对资料或标记“需完善”，都不会撤销原单或冻结档案。</p>'+(focusCatalogId?'':'<p>待核对 '+pendingRows.length+' 条；已处理 '+historyRows.length+' 条。</p>')+mainList+historyShell+'</section>');
 if(!focusCatalogId&&historyRows.length){
  const history=$('catalog-review-history');
  history.addEventListener('toggle',()=>{
   if(!history.open||history.dataset.loaded)return;
   $('catalog-review-history-list').innerHTML=table(headers,historyRows.map(renderReviewRow));
   history.dataset.loaded='1';
  });
 }
 if(location.hash==='#catalog-reviews')$('catalog-reviews').scrollIntoView({block:'start'});
}
const catalogConfirmPending=new Set();
async function reviewCatalog(id,decision){
 if(state.user.roleCode!=='owner')return toast('新增档案只能由老板本人核对',true);
 const row=(state.catalogReviews||[]).find(x=>x.id===id);if(!row||!['待老板核对','需完善'].includes(row.status))return toast('这份档案已核对，请刷新查看',true);
 if(decision==='confirm'){
  if(catalogConfirmPending.has(id))return;
  catalogConfirmPending.add(id);
  try{await post('/api/catalog-reviews/review',{id,decision,note:''});toast('新增档案已确认生效');await renderCatalogReviews(officePageCurrent());}
  catch(error){toast(error.message||'确认失败，请刷新核对原单',true);}
  finally{catalogConfirmPending.delete(id);}
  return;
 }
 modal('否，退回待完善',[{name:'note',label:'备注（选填）',type:'textarea',wide:true,hint:'可留空。'}],(d,write)=>write('/api/catalog-reviews/review',{id,decision,note:d.note||''}).then(r=>({...r,officeRefresh:'catalog-review'})),'原档案和已开单业务继续有效。');
 $('modal-form').querySelector('button[type=submit]').textContent='否，退回待完善';
}
function editCatalog(id){
 if(state.user.roleCode!=='owner')return toast('新增档案只能由老板本人核对',true);
 const row=(state.catalogReviews||[]).find(x=>x.id===id);if(['fundParty','category','warehouse'].includes(row?.kind)){location.assign('/master-data?review='+encodeURIComponent(row.id));return;}if(row?.kind==='businessOption'){if(!document.querySelector('link[data-business-options-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/business-options-ui.css';link.dataset.businessOptionsStyle='1';document.head.append(link);}const dialog=document.createElement('dialog');dialog.className='business-option-dialog';dialog.innerHTML='<h2>新增业务选项</h2>'+catalogFacts(row)+'<p>此处只查看选项；核对结果在原列表登记。</p><button type="button">关闭</button>';dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return;}if(!row?.current)return toast('原档案暂未查到，请刷新核实',true);
 if(row.kind==='supplier'){
  state.suppliers||=[];const source=state.suppliers.find(x=>x.id===row.sourceId);if(source)Object.assign(source,row.current);else state.suppliers.push({id:row.sourceId,...row.current});
  supplierEditor(row.sourceId);
 }else if(row.kind==='paymentAccount'){
  location.assign('/payment-accounts');
 }else if(row.kind==='product'){
  const source=state.products.find(x=>x.skuId===row.sourceId);if(!source)return toast('商品档案暂未查到，请刷新核实',true);
  Object.assign(source,row.current);productEditor(row.sourceId);
 }
}
window.TradeDocuments={exchange,renderFinancial,newFinancial,detail,renderReturnRequests,reviewReturnRequest,openingPurchaseReturn,purchaseReturn,renderPurchaseReturnRequests,refreshPurchaseReturnReview,reviewPurchaseReturnRequest,renderCatalogReviews,reviewCatalog,editCatalog};
})();
