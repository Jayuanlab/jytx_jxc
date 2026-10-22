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
 {name:'reason',label:'换货原因',type:'textarea',wide:true,required:true},
 accountField,{name:'accountOwnerId',label:'差额收款人',options:[{value:'',label:'请选择实际收款人'},...state.users.filter(x=>x.status==='active'&&x.capabilities.financeReceive).map(x=>({value:x.id,label:x.name}))]},
 {name:'cashDrawerConfirmed',label:'如已补收现金，确认已入抽屉',type:'checkbox'}
 ],async(d,write)=>{const result=await write('/api/sale-exchanges',{orderId:id,returns:[{itemId:d.itemId,quantity:Number(d.returnQuantity)}],items:[{skuId:d.skuId,serialNo:d.serialNo.trim(),quantity:Number(d.quantity),salePrice:Number(d.salePrice)}],reason:d.reason,account:d.account,accountOwnerId:d.accountOwnerId,cashDrawerConfirmed:d.cashDrawerConfirmed});return {...result,message:result.message||'换货申请已提交，等待老板批准；尚未换货入账。'};},'员工先提交申请，老板本人批准后才办理换货及差额收退款；审批前不会换出手机或恢复原机库存。原单收款需先核实，国补按原平台流程办理。');
 const form=$('modal-form'),summary=document.createElement('p');form.querySelector('button[type=submit]').textContent='提交换货申请';summary.className='system-status';summary.id='exchange-difference';form.querySelector('.form-actions').before(summary);
 const scan=document.createElement('button');scan.type='button';scan.className='secondary';scan.textContent='拍照识码';form.elements.serialNo.after(scan);
 const photo=document.createElement('input');photo.type='file';photo.accept='image/*';photo.setAttribute('capture','environment');photo.hidden=true;scan.after(photo);scan.onclick=()=>photo.click();photo.onchange=async()=>{const file=photo.files[0],skuId=form.elements.skuId.value;if(!file)return;const current=()=>form.isConnected&&$('modal-form')===form&&photo.files[0]===file&&form.elements.skuId.value===skuId&&!form.elements.serialNo.disabled;let bitmap;try{bitmap=await createImageBitmap(file);const code=await window.SaleCapture.decode(bitmap);if(!current())return;if(!code)throw new Error('未识别串号，请重新拍照或手动输入');form.elements.serialNo.value=code;form.elements.serialNo.dispatchEvent(new Event('input',{bubbles:true}));}catch(error){if(current())toast(error.message,true)}finally{bitmap?.close();if(photo.files[0]===file)photo.value='';}};
 function update(){
  const original=old.find(x=>x.id===form.elements.itemId.value);
  form.elements.returnQuantity.max=original.quantity-(original.returnedQuantity||0);
  const next=products.find(x=>x.skuId===form.elements.skuId.value);form.elements.serialNo.required=Boolean(next?.trackSerial);
  const a=Number(form.elements.returnQuantity.value)*original.salePrice,b=Number(form.elements.quantity.value)*Number(form.elements.salePrice.value);
  const delta=Math.round((b-a)*100)/100;summary.textContent='原货退价 '+M(a)+' · 换出金额 '+M(b)+' · '+(delta>0?'需补收 '+M(delta):delta<0?'需退款 '+M(-delta):'无需补退款');
 }
 form.elements.skuId.addEventListener('change',()=>{const product=products.find(x=>x.skuId===form.elements.skuId.value);form.elements.salePrice.value=product?.salePrice??'';form.elements.serialNo.value='';update()});
 form.addEventListener('input',update);form.addEventListener('change',update);update();
}
async function renderFinancial(direction){
 const title=direction==='receive'?'收款单':'付款单',filter=state[direction+'Filter']||{q:documentQuery(),from:'',to:''};
 const pageCurrent=officePageCurrent(direction==='receive'?'receipts':'payments'),version=++financialQueryVersion;
 const current=()=>pageCurrent()&&version===financialQueryVersion;
 const params=new URLSearchParams({direction,...filter}),data=await officePageRead(current,()=>api('/api/financial-documents?'+params));
 if(!current())return;
 $('main').innerHTML=heading(title,'销售收款、退货退款、往来单位往来和工资发放随原业务自动生成。其他收入或费用付款可在这里登记，已登记的业务款不再重复录入。红冲记录保留原单，在单据红冲中审核处理。',
 button(direction==='receive'?'登记其他收款':'登记费用付款','financial-new',direction,'primary')+button('刷新','refresh'))+
 '<section class="card system-backup"><form id="financial-filter" class="document-filter"><label>关键词<input name="q" type="search" placeholder="对象 / 单号 / 流水号" value="'+E(filter.q)+'"></label><label>开始日期<input name="from" type="date" value="'+E(filter.from)+'"></label><label>结束日期<input name="to" type="date" value="'+E(filter.to)+'"></label><div class="system-actions"><button class="primary" type="submit">查询</button><button class="secondary" type="button" id="financial-today">今日</button><button class="secondary" type="button" id="financial-all">全部</button></div></form></section>'+
 '<section class="card mobile-record-list"><h2>'+data.rows.length+' 笔 · '+M(data.total)+'</h2>'+table(['单号与对象','业务','金额','账户','日期','原单','操作'],data.rows.map(r=>'<tr><td data-label="单号与对象" class="record-title">'+E(r.counterparty)+'<small>'+E(documentNo(r))+'</small></td><td data-label="业务">'+E(r.business)+'<small>'+E(r.status)+'</small></td><td data-label="金额"><strong>'+M(r.amount)+'</strong></td><td data-label="账户">'+E(receiptAccountLabel(r))+(r.partId?'<small>分笔 '+E(r.partId)+'</small>':'')+'</td><td data-label="日期">'+E(r.date)+'</td><td data-label="原单">'+E(documentRef(r,"sourceId"))+'</td><td data-label="操作">'+redPacketEntry('receipts',r)+button('查看明细','financial-detail',r.id)+'</td></tr>'))+'</section>';
 state.financialRows=data.rows;
 $('financial-filter').onsubmit=async e=>{e.preventDefault();state[direction+'Filter']=Object.fromEntries(new FormData(e.currentTarget));await renderFinancial(direction).catch(showError)};
 $('financial-today').onclick=async()=>{state[direction+'Filter']={q:'',from:today(),to:today()};await renderFinancial(direction).catch(showError)};
 $('financial-all').onclick=async()=>{state[direction+'Filter']={q:'',from:'',to:''};await renderFinancial(direction).catch(showError)};
}
function newFinancial(direction){modal(direction==='receive'?'登记其他收款':'登记费用付款',[
 {name:'counterparty',label:direction==='receive'?'付款方':'收款方',required:true},moneyField('amount','实际金额'),accountField,
 {name:'date',label:'实际日期',type:'date',value:today(),required:true},
 {name:'reference',label:'支付流水号',hint:'非现金填写支付凭证，便于核对。'},
 {name:'note',label:'收付事由',type:'textarea',wide:true,required:true},
 {name:'confirmed',label:direction==='receive'?'已核实实际到账':'已核实实际付款',type:'checkbox'}
 ],(d,write)=>write('/api/financial-documents',{...d,direction,amount:Number(d.amount)}),'只登记已经实际收付的款项，不会自动扣款。',{mode:direction==='receive'?'receive':'pay'});}
function detail(id){
 const row=state.financialRows.find(x=>x.id===id);if(!row)return;
 const dialog=document.createElement('dialog');dialog.className='system-dialog';dialog.innerHTML='<div class="system-dialog-head"><h2>单据明细</h2><button type="button">返回</button></div><dl class="document-details">'+[['单号',documentNo(row)],['原单',documentRef(row,'sourceId')],['业务',row.business],['对象',row.counterparty],['金额',M(row.amount)],['账户',receiptAccountLabel(row)],['分笔编号',row.partId||'—'],['日期',row.date],['流水号',row.reference||'—'],['操作人',row.operator],['状态',row.status],['事由',row.note||'—']].map(([name,val])=>'<div><dt>'+E(name)+'</dt><dd>'+E(val)+'</dd></div>').join('')+'</dl>';document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.showModal();
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
 const owner=state.user.roleCode==='owner';
 const html=rows.filter(r=>documentMatches(r)).map(r=>'<tr><td data-label="申请与原单"><strong>'+E(r.kind==='exchange'?'换货申请':'退货申请')+'</strong><small>'+E(documentNo(r))+' · 原单 '+E(documentRef(r,"orderId"))+'</small><small>'+E(r.requesterName||r.requester||r.operator||r.requesterId||'')+' · '+E(displayTime(r.createdAt))+'</small></td><td data-label="金额与商品"><strong>'+M(r.amount)+'</strong>'+requestLines(r)+(r.kind==='exchange'&&r.difference!=null?'<p>'+E(Number(r.difference)>0?'补收':Number(r.difference)<0?'退款':'无差额')+' '+M(Math.abs(Number(r.difference)))+'</p>':'')+'</td><td data-label="申请原因">'+E(r.reason||r.payload?.reason||'—')+'</td><td data-label="状态"><strong>'+E(r.status)+'</strong>'+(r.reviewNote?'<p>'+E(r.reviewNote)+'</p>':'')+'</td><td data-label="操作">'+redPacketEntry('saleReturnRequests',r)+(owner&&r.status==='待老板审核'?button('批准并生效','sale-return-approve',r.id,'primary')+button('驳回','sale-return-reject',r.id):r.status==='待老板审核'?'<span>等待老板同意</span>':'')+'</td></tr>');
 $('main').insertAdjacentHTML('beforeend','<section class="card mobile-record-list" id="sale-return-requests"><h2>'+ (owner?'退换货审批':'我提交的退换货申请')+'</h2><p>批准后才变动库存、销售与退款记录。普通入库和销售可直接开单。</p>'+table(['申请与原单','金额与商品','申请原因','状态','操作'],html)+'</section>');
 if(location.hash==='#sale-return-requests')$('sale-return-requests').scrollIntoView({block:'start'});
}
function reviewReturnRequest(id,decision){
 if(state.user.roleCode!=='owner')return toast('退换货必须由老板本人批准',true);
 const row=(state.saleReturnRequests||[]).find(x=>x.id===id);if(!row||row.status!=='待老板审核')return toast('这份申请已处理，请刷新查看',true);
 const refund=decision==='approve'&&row.kind==='exchange'&&Number(row.difference)<0;
 const fields=[{name:'note',label:decision==='approve'?'批准意见':'驳回原因',type:'textarea',wide:true,required:true,hint:'核对原单、实物和金额，记录本次处理依据。'}];
 if(refund)fields.push({name:'refundConfirmed',label:'已核实换货差额退款',type:'checkbox'});
 modal(decision==='approve'?'老板批准 · '+(row.kind==='exchange'?'换货':'退货'):'驳回退换货申请',fields,async(d,write)=>{
  if(refund&&!d.refundConfirmed)throw new Error('请先核实差额退款，再批准换货');
  return write('/api/sale-return-requests/review',{id,decision,note:d.note,refundConfirmed:d.refundConfirmed===true});
 },decision==='approve'?'确认批准后，这份申请才正式生效并更新库存、销售与退款记录。':'驳回后原单与库存保持原状，员工可核实后重新申请。');
 $('modal-form').querySelector('button[type=submit]').textContent=decision==='approve'?'确认批准并生效':'确认驳回';
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
async function renderPurchaseReturnRequests(current){
 const response=await officePageRead(current,()=>api('/api/purchase-return-requests'));if(!current())return;
 const rows=Array.isArray(response)?response:response.rows||[];state.purchaseReturnRequests=rows;
 const owner=state.user.roleCode==='owner';
 const html=rows.filter(r=>documentMatches(r)).map(r=>'<tr><td data-label="申请与原单"><strong>'+E(documentNo(r))+'</strong><small>原入库 '+E(documentRef(r,"purchaseId"))+'</small><small>'+E(r.requesterName||r.requester||r.operator||'')+' · '+E(displayTime(r.createdAt))+'</small></td><td data-label="商品与金额"><p>'+E(r.productName||r.name||r.items?.map(x=>x.name+' × '+x.quantity).join('、')||r.itemId||'商品')+(r.quantity!=null?' × '+E(r.quantity):'')+'</p><strong>'+M(r.amount)+'</strong>'+(r.serialNos?.length?'<p>'+E(r.serialNos.join('、'))+'</p>':'')+'</td><td data-label="退货依据">'+E(r.note||r.reason||'—')+'</td><td data-label="状态"><strong>'+E(r.status)+'</strong>'+(r.reviewNote?'<p>'+E(r.reviewNote)+'</p>':'')+'</td><td data-label="操作">'+redPacketEntry('purchaseReturnRequests',r)+(owner&&r.status==='待老板审核'?button('批准并生效','purchase-return-approve',r.id,'primary')+button('驳回','purchase-return-reject',r.id):r.status==='待老板审核'?'<span>等待老板同意</span>':'')+'</td></tr>');
 $('main').insertAdjacentHTML('beforeend','<section class="card mobile-record-list" id="purchase-return-requests"><h2>'+ (owner?'采购退货审批':'我提交的采购退货申请')+'</h2><p>老板批准后才扣库存、登记往来单位往来；提交申请时不入账。</p>'+table(['申请与原单','商品与金额','退货依据','状态','操作'],html)+'</section>');
 if(location.hash==='#purchase-return-requests')$('purchase-return-requests').scrollIntoView({block:'start'});
}
function reviewPurchaseReturnRequest(id,decision){
 if(state.user.roleCode!=='owner')return toast('采购退货必须由老板本人批准',true);
 const row=(state.purchaseReturnRequests||[]).find(x=>x.id===id);if(!row||row.status!=='待老板审核')return toast('这份申请已处理，请刷新查看',true);
 modal(decision==='approve'?'老板批准采购退货':'驳回采购退货申请',[{name:'note',label:decision==='approve'?'批准意见':'驳回原因',type:'textarea',wide:true,required:true,hint:'核实原入库、实物和往来单位退货依据后，填写处理意见。'}],(d,write)=>write('/api/purchase-return-requests/review',{id,decision,note:d.note,confirmed:decision==='approve'}),decision==='approve'?'确认批准后才扣减库存，并登记往来单位退款或抵货款记录。':'驳回后库存和往来账保持原状。');
 $('modal-form').querySelector('button[type=submit]').textContent=decision==='approve'?'确认批准并生效':'确认驳回';
}
function catalogFacts(row){
 const p=row.current||row.detail||{};
 const facts=row.kind==='businessOption'?[['名称',p.name||row.name],['选项用途',({type:'业务类型',subType:'业务细类',receptionSource:'接待来源',receptionPurpose:'接待来意'})[p.kind]||p.kind||'—'],['所属类型',p.parentName||'—'],['所属业务',({card:'号卡',recharge:'充值',broadband:'宽带',package:'套餐',contract:'设备绑合约',other:'其他业务（仅分月酬金）'})[p.baseType]||p.baseType||'—'],['细类归属',({new:'新开卡',replace:'补卡',topup:'话费充值',fusion:'融合宽带',other:'其他',up:'套餐升档',down:'套餐降档',device:'设备绑合约',unknown:'未分类／待核对'})[p.baseSubType]||p.baseSubType||'—']]:row.kind==='paymentAccount'?[['名称',p.name||row.name],['收付款方式',p.channel||'—'],['实际持有人',p.ownerName||'待核对'],['状态',p.active===false?'已停用':p.active===true?'启用':'待核对'],['备注',p.note||'—']]:row.kind==='supplier'?[['名称',p.name||row.name],['联系方式',p.contact||'暂未填写'],['备注',p.note||'—']]:[['名称',p.name||row.name],['编号',p.externalCode||'—'],['分类',[p.type,p.subType,p.thirdType].filter(Boolean).join(' / ')||'—'],['计量单位',p.unit||'—'],['售价',p.salePrice!=null?M(p.salePrice):'—']];
 return facts.map(([key,value])=>'<p>'+E(key)+'：'+E(value)+'</p>').join('');
}
async function renderCatalogReviews(current){
 if(state.user.roleCode!=='owner')return;
 const response=await officePageRead(current,()=>api('/api/catalog-reviews'));if(!current()||state.user.roleCode!=='owner')return;
 const rows=Array.isArray(response)?response:response.rows||[];state.catalogReviews=rows;
 const html=rows.map(r=>'<tr><td data-label="新增档案"><strong>'+E(r.kind==='supplier'?'往来单位':r.kind==='paymentAccount'?'收付款账户':r.kind==='businessOption'?'业务选项':'商品')+' · '+E(r.current?.name||r.name)+'</strong><small>'+E(r.requester||r.requesterName||'')+' · '+E(displayTime(r.createdAt))+'</small></td><td data-label="现有资料">'+catalogFacts(r)+'</td><td data-label="核对状态"><strong>'+E(r.status)+'</strong>'+(r.reviewNote?'<p>'+E(r.reviewNote)+'</p>':'')+'</td><td data-label="操作">'+(['待老板核对','需完善'].includes(r.status)?button('核对无误','catalog-confirm',r.id,'primary')+button('需完善','catalog-needs-changes',r.id):'')+(r.current||r.kind==='businessOption'?button(r.kind==='paymentAccount'?'查看账户':r.kind==='businessOption'?'查看业务选项':'编辑原档案','catalog-edit',r.id):'')+'</td></tr>');
 $('main').insertAdjacentHTML('beforeend','<section class="card mobile-record-list" id="catalog-reviews"><h2>新增档案核对</h2><p>商品、往来单位、收付款账户和业务选项新增后立即可用。账户仅登记信息，不代表款项到账。核对资料或标记“需完善”，都不会撤销原单或冻结档案。</p>'+table(['新增档案','现有资料','核对状态','操作'],html)+'</section>');
 if(location.hash==='#catalog-reviews')$('catalog-reviews').scrollIntoView({block:'start'});
}
function reviewCatalog(id,decision){
 if(state.user.roleCode!=='owner')return toast('新增档案只能由老板本人核对',true);
 const row=(state.catalogReviews||[]).find(x=>x.id===id);if(!row||!['待老板核对','需完善'].includes(row.status))return toast('这份档案已核对，请刷新查看',true);
 modal(decision==='confirm'?'确认新增档案':'标记资料需完善',[{name:'note',label:'核对意见',type:'textarea',wide:true,required:true,hint:'至少4字，记录核实结果或需要补充的资料。'}],(d,write)=>{if(d.note.trim().length<4)throw new Error('请填写至少4字的核对意见');return write('/api/catalog-reviews/review',{id,decision,note:d.note});},'这次核对只记录资料处理意见，原档案和已开单业务继续有效。');
 $('modal-form').querySelector('button[type=submit]').textContent=decision==='confirm'?'确认核对无误':'记录需完善';
}
function editCatalog(id){
 if(state.user.roleCode!=='owner')return toast('新增档案只能由老板本人核对',true);
 const row=(state.catalogReviews||[]).find(x=>x.id===id);if(row?.kind==='businessOption'){if(!document.querySelector('link[data-business-options-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/business-options-ui.css';link.dataset.businessOptionsStyle='1';document.head.append(link);}const dialog=document.createElement('dialog');dialog.className='business-option-dialog';dialog.innerHTML='<h2>新增业务选项</h2>'+catalogFacts(row)+'<p>此处只查看选项；核对结果在原列表登记。</p><button type="button">关闭</button>';dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return;}if(!row?.current)return toast('原档案暂未查到，请刷新核实',true);
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
window.TradeDocuments={exchange,renderFinancial,newFinancial,detail,renderReturnRequests,reviewReturnRequest,purchaseReturn,renderPurchaseReturnRequests,reviewPurchaseReturnRequest,renderCatalogReviews,reviewCatalog,editCatalog};
})();