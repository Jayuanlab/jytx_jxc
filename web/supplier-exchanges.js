'use strict';
const ExchangeScanCore=(()=>{
 const normalize=value=>String(value||'').trim();
 function resolve(products,raw,side,selectedSku){
  const original=normalize(raw),qr=original.startsWith('JY1:'),code=qr?original.slice(4):original;
  if(!code||code.length>120)throw Error('请扫描完整串号或商品条码');
  const serialMatches=qr?[]:products.flatMap(p=>(p.stocks||[]).flatMap(stock=>(stock.serials||[]).includes(code)?[{product:p,stock,serialNo:code,kind:'serial'}]:[]));
  if(serialMatches.length){if(side==='in')throw Error('该串号已在本店库存中，不能作为新货重复入库');if(serialMatches.length!==1)throw Error('这个串号对应多条库存，请先核对库存');const match=serialMatches[0];if(!(match.stock.quantity>0))throw Error('该串号当前没有可换出的库存');return match;}
  const found=products.filter(p=>(qr?[p.skuId]:[p.skuId,p.externalCode,...(p.scanCodes||[])]).some(x=>normalize(x)===code));
  if(found.length>1)return {kind:'ambiguous',code,products:found};
  if(found.length===1){const p=found[0],stocks=(p.stocks||[]).filter(s=>s.quantity>0);if(side==='out'&&!stocks.length)throw Error(p.name+'没有可换出库存');return {kind:'product',product:p,stock:side==='out'&&stocks.length===1?stocks[0]:null,serialNo:''};}
  if(side==='out')throw Error('本店库存未找到该完整串号或条码，请核对原码');
  const p=products.find(p=>p.skuId===selectedSku);
  if(!p)throw Error('新串号尚不能识别型号，请先扫商品条码或查找准确商品');
  if(!p.trackSerial)throw Error('配件按商品条码和数量登记，不填设备串号');
  if(!/^[a-z0-9-]{5,40}$/i.test(code))throw Error('请扫描完整设备串号');
  return {kind:'new-serial',product:p,stock:null,serialNo:code};
 }
 function append(existing,serialNo,limit){
  if(!/^[a-z0-9-]{5,40}$/i.test(serialNo))throw Error('请扫描完整设备串号');
  if(existing.includes(serialNo))throw Error('这个串号已录入，不能重复：'+serialNo);
  if(Number.isInteger(limit)&&limit>0&&existing.length>=limit)throw Error('已录满'+limit+'件，请核对数量后再继续');
  return [...existing,serialNo];
 }
 return {resolve,append};
})();
if(typeof module==='object'&&module.exports)module.exports=ExchangeScanCore;

(()=>{'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const yuan=n=>'¥'+(Number(n||0)/100).toFixed(2),time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const key=()=>globalThis.crypto?.randomUUID?.()||'sx-'+Date.now()+'-'+Math.random().toString(36).slice(2);
let data={products:[],suppliers:[],warehouses:[],accounts:[]},records=[],current=null,busy=false,submission={key:key(),hash:''};
const api=async(path,body)=>{const res=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'content-type':'application/json','idempotency-key':body.requestKey||key()}:undefined,body:body?JSON.stringify(body):undefined});const result=await res.json().catch(()=>({}));if(!res.ok){const error=Error(result.error?.message||result.error||result.message||'读取失败，请刷新后重试');error.confirmedFailure=[400,401,403,404,409,422].includes(res.status);throw error;}return result;};
const option=(v,label)=>{const el=document.createElement('option');el.value=v;el.textContent=label;return el;};
const tell=(msg,error=false)=>{$('message').hidden=!msg;$('message').textContent=msg;$('message').className=error?'error':'success';};
// Uses only the current permission-filtered exchange catalog. Camera frames stay on this device.
let scanStream=null,scanSequence=0,scanLine=null,scanCameraBusy=false;
const mobileScanner=()=>navigator.maxTouchPoints>0||window.matchMedia?.('(pointer:coarse)').matches;
function scanNotice(line,message,error=false){const node=line.querySelector('.scan-state');node.textContent=message;node.classList.toggle('error',error);}
function selectedSerials(line){return line.dataset.side==='out'?[...line.querySelector('.serial-select').selectedOptions].map(o=>o.value):parsedSerials(line.querySelector('.incoming-serials').value);}
function scanPick(line,p,stock){
 const current=product(line);if(current&&current.skuId!==p.skuId)throw Error('这个码属于'+p.name+'，请点“增加商品”另开一行');if(current?.skuId===p.skuId)return;
 const first=line.querySelector('.first'),second=line.querySelector('.second');line.querySelector('.product-search').value='';first.value='';secondary(line);second.value='';models(line);line.querySelector('.sku').value=p.skuId;warehouse(line);
 if(stock)line.querySelector('.warehouse').value=stock.warehouseId;
 else if(!line.querySelector('.warehouse').value&&data.warehouses.length===1)line.querySelector('.warehouse').value=data.warehouses[0].id;
 serials(line);if(!line.querySelector('.warehouse').value)line.querySelector('.manual-product').open=true;
}
function acceptScan(line,raw){
 if(line.classList.contains('receipt-line'))return acceptReceiptScan(line,raw);
 const side=line.dataset.side,old=product(line),result=ExchangeScanCore.resolve(data.products,raw,side,old?.skuId),p=result.product;
 if(result.kind==='ambiguous'){
  const host=line.querySelector('.scan-choices');host.replaceChildren();for(const candidate of result.products){const b=document.createElement('button');b.type='button';b.textContent=candidate.name;b.onclick=()=>{try{scanPick(line,candidate,null);host.replaceChildren();scanNotice(line,'已选：'+candidate.name+'；按实际数量填写');}catch(e){scanNotice(line,e.message,true);}};host.append(b);}throw Error('这个条码对应多个商品，请在下面选准型号');
 }
 if(old&&old.skuId!==p.skuId)throw Error('这个码属于'+p.name+'，请点“增加商品”另开一行');
 if(result.serialNo){
  const duplicated=[...document.querySelectorAll('.item-line')].some(other=>selectedSerials(other).includes(result.serialNo));if(duplicated)throw Error('本单已录入这个串号：'+result.serialNo);
  const previous=selectedSerials(line),limit=line.dataset.quantityManual==='1'?Number(line.querySelector('.quantity').value):undefined;
  const next=ExchangeScanCore.append(previous,result.serialNo,limit);
  // A scanner must not silently change the actual outgoing warehouse of already selected goods.
  if(side==='out'&&previous.length&&line.querySelector('.warehouse').value!==result.stock.warehouseId)throw Error('这个串号在另一仓库，请增加商品行分别登记');
  if(!old)scanPick(line,p,result.stock);
  if(side==='out'){
   const select=line.querySelector('.serial-select');if(![...select.options].some(o=>o.value===result.serialNo)){line.querySelector('.warehouse').value=result.stock.warehouseId;serials(line);}for(const o of select.options)o.selected=next.includes(o.value);
  }else line.querySelector('.incoming-serials').value=next.join('\n');
  if(!limit)line.querySelector('.quantity').value=next.length;
  serialCount(line);calculate();scanNotice(line,'已录入：'+result.serialNo+'　'+p.name);return {kind:'serial',product:p,quantity:next.length,complete:!!limit&&next.length===limit};
 }
 if(!old)scanPick(line,p,result.stock);
 if(!p.trackSerial){
  const qty=line.querySelector('.quantity');if(old&&line.dataset.quantityManual!=='1')qty.value=Number(qty.value||0)+1;calculate();scanNotice(line,p.name+' · '+qty.value+'件，请核对实际数量');return {kind:'quantity',product:p};
 }
 scanNotice(line,'已识别：'+p.name+'；继续扫'+(side==='out'?'旧货':'新货')+'完整串号');return {kind:'product',product:p};
}
function stopScanCamera(close=true){
 scanSequence++;scanCameraBusy=false;if(scanStream)scanStream.getTracks().forEach(t=>t.stop());scanStream=null;
 const video=$('exchange-scan-video');if(video){video.pause();video.srcObject=null;}if(close&&$('exchange-camera-dialog')?.open)$('exchange-camera-dialog').close();
}
async function openScanCamera(line){
 if(scanCameraBusy)return;stopScanCamera();scanLine=line;const dialog=$('exchange-camera-dialog'),state=$('exchange-camera-state');$('exchange-camera-title').textContent=line.dataset.side==='out'?'扫码换出商品':'扫码换回商品';state.textContent='请对准商品条码或设备串号条码';dialog.showModal();
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){state.textContent='请在手机正式HTTPS工作台使用相机，或点“拍照识码”。';return;}
 const run=scanSequence;scanCameraBusy=true;
 try{
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
  if(run!==scanSequence||!dialog.open){stream.getTracks().forEach(t=>t.stop());return;}scanStream=stream;const video=$('exchange-scan-video');video.srcObject=stream;await video.play();scanCameraBusy=false;
  let last=0,lastCode='',emptySince=0;
  async function frame(time){
   if(run!==scanSequence||!dialog.open||!line.isConnected)return;
   if(time-last>350&&video.videoWidth){last=time;let code='';try{code=await window.SaleCapture.decode(video);}catch{}
    if(run!==scanSequence||!dialog.open)return;
    if(!code){if(!emptySince)emptySince=time;if(time-emptySince>900)lastCode='';}
    else if(code!==lastCode){lastCode=code;emptySince=0;try{const result=acceptScan(line,code);state.textContent=line.querySelector('.scan-state').textContent;if(result.kind==='quantity'||result.complete){stopScanCamera(false);state.textContent+='；请核对后关闭';return;}}catch(e){state.textContent=e.message;scanNotice(line,e.message,true);}}
   }
   requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
 }catch(e){stopScanCamera(false);state.textContent=e.name==='NotAllowedError'?'相机权限未允许。请在手机浏览器的网站权限中允许相机，或点“拍照识码”。':'未能打开相机，请关闭其他占用相机的应用后重试，或点“拍照识码”。';}
}
function bindScanner(line){
 const input=line.querySelector('.scan-input'),add=()=>{try{const raw=input.value.trim();if(!raw)return;acceptScan(line,raw);input.value='';}catch(e){scanNotice(line,e.message,true);}input.focus();};
 input.onkeydown=e=>{if(e.key==='Enter'||e.key==='Tab'&&input.value.trim()){e.preventDefault();e.stopPropagation();add();}};line.querySelector('.scan-add').onclick=add;line.querySelector('.scan-camera').onclick=()=>openScanCamera(line);line.querySelector('.scan-photo').onclick=()=>{scanLine=line;$('exchange-scan-photo').click();};
 if(mobileScanner())line.classList.add('mobile-scanner');
}
function mountLineScanner(line){bindScanner(line);line.querySelector('.quantity').addEventListener('input',()=>{line.dataset.quantityManual='1';});const input=line.querySelector('.scan-input');input.parentElement.firstChild.textContent=line.dataset.side==='out'?'扫旧货串号／商品条码':'扫商品条码／新货串号';input.placeholder=line.dataset.side==='out'?'扫库存串号，自动带出型号':'先扫商品编码，再扫新货串号';line.addEventListener('invalid',event=>{const detail=event.target.closest('.manual-product');if(detail)detail.open=true;},true);}
function acceptReceiptScan(line,raw){
 const expected=current?.row.incoming.find(x=>x.id===line.dataset.line);if(!expected)throw Error('原单已变化，请关闭后刷新核对');
 const result=ExchangeScanCore.resolve(data.products,raw,'in',expected.skuId);
 if(result.kind==='ambiguous'||result.product?.skuId!==expected.skuId)throw Error('扫描商品与原单不一致，请核对：'+expected.productName);
 if(!result.serialNo){scanNotice(line,'已核对商品：'+expected.productName+'；'+(expected.trackSerial?'继续扫新货完整串号':'请按实物填写验收数量'));return {kind:'product'};}
 const field=line.querySelector('.received-serials'),qty=line.querySelector('.received-quantity');
 if(!field)throw Error('本项按数量验收，不填写设备串号');
 const duplicate=[...$('action-fields').querySelectorAll('.received-serials')].some(x=>parsedSerials(x.value).includes(result.serialNo));if(duplicate)throw Error('本次验收已录入这个串号：'+result.serialNo);
 const limit=line.dataset.quantityManual==='1'?Number(qty.value):expected.quantity-expected.received,next=ExchangeScanCore.append(parsedSerials(field.value),result.serialNo,limit);
 field.value=next.join('\n');if(line.dataset.quantityManual!=='1')qty.value=next.length;
 scanNotice(line,'已录入：'+result.serialNo+'；本次 '+next.length+' 件');return {kind:'serial',complete:next.length===limit};
}
function mountReceiptScanners(){
 for(const line of $('action-fields').querySelectorAll('.receipt-line')){
  const expected=current.row.incoming.find(x=>x.id===line.dataset.line);
  line.insertAdjacentHTML('beforeend',exchangeScannerMarkup);bindScanner(line);
  const qty=line.querySelector('.received-quantity'),serial=line.querySelector('.received-serials');if(serial&&parsedSerials(serial.value).length)qty.value=parsedSerials(serial.value).length;
  qty.addEventListener('input',()=>{line.dataset.quantityManual='1';});
  line.querySelector('.scan-input').placeholder=expected.trackSerial?'扫码枪扫码或输入新货完整串号':'扫码核对商品条码';
 }
}
function validateReceiptScan(body,row){
 const all=new Set();for(const item of body.items){const expected=row.incoming.find(x=>x.id===item.lineId);if(!expected)throw Error('原单已变化，请刷新核对');if(expected.trackSerial&&item.serialNos.length!==item.quantity)throw Error(expected.productName+'：本次验收'+item.quantity+'件，须填'+item.quantity+'个完整串号');for(const no of item.serialNos){if(!/^[a-z0-9-]{5,40}$/i.test(no)||all.has(no))throw Error('验收串号无效或重复：'+no);all.add(no);if(data.products.some(p=>p.stocks.some(s=>(s.serials||[]).includes(no))))throw Error('该串号已在当前库存：'+no);}}
}
function mountScanCamera(){
 $('exchange-camera-close').onclick=()=>stopScanCamera();$('exchange-camera-dialog').addEventListener('cancel',()=>stopScanCamera());$('exchange-camera-dialog').addEventListener('close',()=>stopScanCamera(false));$('exchange-camera-photo').onclick=()=>$('exchange-scan-photo').click();
 $('exchange-scan-photo').onchange=async event=>{const file=event.target.files?.[0],line=scanLine;if(!file||!line)return;stopScanCamera();let bitmap;try{bitmap=await createImageBitmap(file);const code=await window.SaleCapture.decode(bitmap);if(!code)throw Error('未识别到清晰条码，请对准完整条码重新拍照，或直接输入串号');acceptScan(line,code);}catch(e){scanNotice(line,e.message,true);}finally{bitmap?.close();event.target.value='';}};
 window.addEventListener('pagehide',()=>stopScanCamera());document.addEventListener('visibilitychange',()=>{if(document.hidden)stopScanCamera();});
}

const exchangeScannerMarkup="<div class=\"scan-row\"><label>扫串号／商品条码<input class=\"scan-input\" type=\"text\" autocomplete=\"off\" autocapitalize=\"off\" spellcheck=\"false\" placeholder=\"扫码枪扫码或输入完整码\" aria-label=\"扫串号或商品条码\"></label><div class=\"scan-buttons\"><button class=\"scan-add\" type=\"button\">录入</button><button class=\"scan-camera phone-only\" type=\"button\">相机扫码</button><button class=\"scan-photo phone-only\" type=\"button\">拍照识码</button></div><p class=\"scan-state\" role=\"status\"></p><div class=\"scan-choices\"></div></div>";
function product(line){return data.products.find(x=>x.skuId===line.querySelector('.sku').value);}
function secondary(line){const first=line.querySelector('.first').value,select=line.querySelector('.second');select.replaceChildren(option('','全部二级分类'));[...new Set(data.products.filter(p=>!first||p.type===first).map(p=>p.subType||'未分二级'))].sort((a,b)=>a.localeCompare(b,'zh-CN')).forEach(x=>select.append(option(x,x)));models(line);}
function models(line){const first=line.querySelector('.first').value,second=line.querySelector('.second').value,q=line.querySelector('.product-search').value.trim().toLowerCase(),select=line.querySelector('.sku'),old=select.value,out=line.dataset.side==='out';select.replaceChildren(option('','请选择具体商品'));
 for(const p of data.products.filter(p=>(!first||p.type===first)&&(!second||(p.subType||'未分二级')===second)&&(!q||[p.name,p.skuId,p.externalCode].join(' ').toLowerCase().includes(q))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))){const count=p.stocks.reduce((n,s)=>n+s.quantity,0),o=option(p.skuId,p.name+(out?' · 现货'+count:''));o.disabled=out&&count<1;select.append(o);}if([...select.options].some(x=>x.value===old&&!x.disabled))select.value=old;warehouse(line);}
function warehouse(line){const p=product(line),select=line.querySelector('.warehouse'),old=select.value,out=line.dataset.side==='out';select.replaceChildren(option('','请选择仓库'));if(p){const choices=out?p.stocks.filter(x=>x.quantity>0):data.warehouses;for(const w of choices)select.append(option(out?w.warehouseId:w.id,out?(w.warehouseName||w.warehouseId)+' · '+w.quantity+'件':w.name));if([...select.options].some(x=>x.value===old))select.value=old;else if(choices.length===1)select.selectedIndex=1;}serials(line);}
function parsedSerials(value){return String(value||'').trim().split(/[\s,，、;；.。]+/).filter(Boolean);}
function serialCount(line){const chosen=line.querySelector('.chosen-product'),picked=product(line),wh=line.querySelector('.warehouse');chosen.hidden=!picked;if(picked)chosen.textContent=picked.name+' · '+(wh.value?wh.options[wh.selectedIndex].textContent:'请选择仓库');const p=product(line),out=line.dataset.side==='out',n=out?line.querySelector('.serial-select').selectedOptions.length:parsedSerials(line.querySelector('.incoming-serials').value).length,qty=Number(line.querySelector('.quantity').value||0),node=line.querySelector(out?'.serial-field .hint':'.serial-count');if(node)node.textContent=p?.trackSerial?(out?'已选择 ':'已填写 ')+n+' 个 / '+qty+' 件':'';}
function serials(line){const p=product(line),field=line.querySelector('.serial-field'),select=line.querySelector('.serial-select'),w=line.querySelector('.warehouse').value;const outgoing=line.dataset.side==='out';field.hidden=!(outgoing&&p?.trackSerial);line.querySelector('.incoming-serial-field').hidden=!(line.dataset.side==='in'&&p?.trackSerial);if(line.dataset.serialSku!==p?.skuId){line.querySelector('.incoming-serials').value='';line.dataset.serialSku=p?.skuId||'';}select.replaceChildren();for(const no of p?.stocks.find(x=>x.warehouseId===w)?.serials||[])select.append(option(no,no));serialCount(line);calculate();}
function addLine(side){const line=$('line-template').content.firstElementChild.cloneNode(true);line.dataset.side=side;$(side==='out'?'outgoing':'incoming').append(line);const first=line.querySelector('.first');first.append(option('','全部一级分类'));[...new Set(data.products.map(p=>p.type||'未分类'))].sort((a,b)=>a.localeCompare(b,'zh-CN')).forEach(x=>first.append(option(x,x)));line.querySelector('.unit-label').firstChild.textContent=side==='out'?'抵价单价（元）':'入库单价（元）';first.onchange=()=>secondary(line);line.querySelector('.second').onchange=()=>models(line);line.querySelector('.product-search').oninput=()=>models(line);line.querySelector('.sku').onchange=()=>warehouse(line);line.querySelector('.warehouse').onchange=()=>serials(line);line.querySelectorAll('.unit,.quantity').forEach(x=>x.oninput=()=>{serialCount(line);calculate();});line.querySelector('.serial-select').onchange=()=>serialCount(line);line.querySelector('.incoming-serials').oninput=()=>serialCount(line);line.querySelector('.remove').onclick=()=>{if(line.parentElement.children.length>1){line.remove();calculate();}};secondary(line);mountLineScanner(line);}
function calculate(){const totals=['outgoing','incoming'].map(id=>[...$(id).children].reduce((n,line)=>{const value=Math.round(Number(line.querySelector('.unit').value||0)*100)*Number(line.querySelector('.quantity').value||0);line.querySelector('.line-amount').textContent=yuan(value);return n+(Number.isFinite(value)?value:0);},0));$('out-total').textContent=yuan(totals[0]);$('in-total').textContent=yuan(totals[1]);$('difference-label').firstChild.textContent=totals[1]>totals[0]?'需补差价 ':totals[1]<totals[0]?'供货商应退 ':'差价 ';$('difference').textContent=yuan(Math.abs(totals[1]-totals[0]));}
function collect(id){return [...$(id).children].map(line=>({skuId:line.querySelector('.sku').value,warehouseId:line.querySelector('.warehouse').value,quantity:Number(line.querySelector('.quantity').value),unitPrice:line.querySelector('.unit').value,serialNos:line.dataset.side==='out'?[...line.querySelector('.serial-select').selectedOptions].map(x=>x.value):parsedSerials(line.querySelector('.incoming-serials').value)}));}
function validateSerialLines(body){const incoming=new Set(),outgoing=new Set();for(const [kind,list]of [['outgoing',body.outgoing],['incoming',body.incoming]])for(const line of list){const p=data.products.find(p=>p.skuId===line.skuId);if(!p?.trackSerial)continue;const numbers=line.serialNos;if(kind==='outgoing'&&numbers.length!==line.quantity||kind==='incoming'&&numbers.length&&numbers.length!==line.quantity)throw Error(p.name+'：'+(kind==='outgoing'?'换出':'换回')+line.quantity+'件须逐台填写'+line.quantity+'个完整串号');for(const no of numbers){const set=kind==='outgoing'?outgoing:incoming;if(!/^[a-z0-9-]{5,40}$/i.test(no)||set.has(no))throw Error('串号无效或重复，请逐台核对：'+no);set.add(no);if(kind==='incoming'&&data.products.some(p=>p.stocks.some(s=>(s.serials||[]).includes(no))))throw Error('换回串号已在当前库存中，请核对：'+no);}}for(const no of incoming)if(outgoing.has(no))throw Error('换出与换回串号不能重复：'+no);}
function goods(items,incoming,receipt=false){return '<table class="goods"><thead><tr><th>具体商品 / 仓库</th><th class="number">'+(receipt?'验收数量':incoming?'已收 / 应收':'换出数量')+'</th><th class="number">单价</th><th class="number">金额</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+esc(x.productName)+'<div class="meta">'+esc([x.type,x.subType,x.warehouseName].filter(Boolean).join(' / '))+'</div>'+(x.serialNos?.length?'<div class="serial">串号：'+x.serialNos.map(esc).join('、')+'</div>':'')+'</td><td class="number">'+(incoming?esc(x.received||0)+' / ':'')+esc(x.quantity)+'</td><td class="number">'+yuan(x.unitPriceCents)+'</td><td class="number">'+yuan(x.valueCents)+'</td></tr>').join('')+'</tbody></table>';}
function buttons(r){const b=[];const push=(a,t)=>b.push('<button type="button" data-action="'+a+'" data-id="'+esc(r.id)+'">'+t+'</button>');if(r.permissions.review){push('approve','批准换货');push('reject','驳回申请');}if(r.permissions.operate&&r.reviewedAt&&r.status!=='已驳回'&&r.status!=='已撤销'){if(!r.handedAt){if(r.mode==='先交后收')push('handoff','登记旧货交出');else push('receipt','验货并完成交换');}else if(!r.balance.goodsComplete)push('receipt','登记新货验收');if(r.handedAt&&!r.balance.closed)push('followup','记录跟进');}if(r.permissions.settle&&r.balance.goodsComplete&&r.balance.remainingCents>0)push('settle',r.balance.differenceCents>0?'核实补付差价':'核实收到退款');if(r.permissions.cancel&&!['已撤销','已驳回'].includes(r.status))push('cancel','撤销未交货申请');return b.join('');}
function draw(){const scope=$('scope').value,id=new URLSearchParams(location.search).get('id');const embedded=new URLSearchParams(location.search).get('embedded')==='pending';const selected=records.filter(r=>(!embedded||r.id===id)&&(scope==='all'||(scope==='closed'?r.balance.closed:!r.balance.closed&&!['已撤销','已驳回'].includes(r.status))));
 $('records').innerHTML=selected.length?selected.map(r=>'<article id="record-'+esc(r.id)+'" class="record'+(id===r.id?' selected':'')+'"><div class="summary"><h3>'+esc(r.supplierName)+' · '+esc(r.displayNo||r.id)+'</h3><span class="state">'+esc(r.status)+'</span></div><p class="meta">提交：'+time(r.createdAt)+' · 经办人：'+esc(r.applicantName)+' · '+esc(r.mode)+'</p><p>约定：'+esc(r.agreement)+'</p><h4>换出商品</h4>'+goods(r.outgoing,false)+'<h4>换回商品</h4>'+goods(r.incoming,true)+'<p class="ledger-total">换出抵价 '+yuan(r.balance.outgoingCents)+'　换回金额 '+yuan(r.balance.incomingCents)+'　'+(r.balance.differenceCents>=0?'应补差价 ':'供货商应退 ')+yuan(Math.abs(r.balance.differenceCents))+'</p>'+(r.handedAt?'<p class="meta">实际交货：'+time(r.handedAt)+' · 接货人：'+esc(r.receiver)+'</p>':'')+(r.balance.goodsComplete?'<p>差价未结：'+yuan(r.balance.remainingCents)+'</p>':'')+'<div class="actions">'+buttons(r)+'</div><details><summary>查看交货、验收和历史记录</summary><p>交货凭证：'+esc(r.handoffProof||'尚未交货')+'</p>'+r.receipts.map(x=>'<p>'+time(x.at)+'　验收人：'+esc(x.name)+'　凭证：'+esc(x.proof)+'</p>'+goods(x.items,false,true)).join('')+r.events.map(x=>'<p class="evidence">'+time(x.at)+'　'+esc(x.name)+'　'+esc(x.type)+(x.reason?'：'+esc(x.reason):'')+(x.note?'：'+esc(x.note):'')+(x.reference?'　流水：'+esc(x.reference):'')+'</p>').join('')+(r.balance.actualCostCents!==null?'<p class="meta">换出账面成本 '+yuan(r.balance.actualCostCents)+'；换出抵价与账面成本差额 '+yuan(r.balance.valuationDifferenceCents)+'（单列，不计销售毛利）</p>':'')+'</details></article>').join(''):'<p class="meta">没有符合条件的换货单。可在上方新建申请。</p>';
 $('records').querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>open(b.dataset.action,records.find(r=>r.id===b.dataset.id)));}
const field=(label,name,type='text',value='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0.01" step="0.01"':'')+' required></label>';
function open(action,row){current={action,row,key:key(),hash:''};$('action-title').textContent={approve:'批准换货',reject:'驳回换货申请',cancel:'撤销未交货申请',handoff:'登记旧货交出',receipt:row.handedAt?'登记新货验收':'验货并完成交换',settle:row.balance.differenceCents>0?'核实补付差价':'核实收到退款',followup:'记录换货跟进'}[action];$('action-context').innerHTML='<p>'+esc(row.supplierName)+' · '+esc(row.displayNo||row.id)+'</p><p class="meta">经办人：'+esc(row.applicantName)+'　提交：'+time(row.createdAt)+'</p><p>换出抵价 '+yuan(row.balance.outgoingCents)+'；换回金额 '+yuan(row.balance.incomingCents)+'；'+(row.balance.differenceCents>=0?'应补差价 ':'供货商应退 ')+yuan(Math.abs(row.balance.differenceCents))+'</p><p>'+esc(row.agreement)+'</p>'+(action==='handoff'?goods(row.outgoing,false):'');const host=$('action-fields');host.innerHTML='';if(['reject','cancel','followup'].includes(action))host.innerHTML='<label>'+({reject:'驳回原因',cancel:'撤销原因',followup:'本次联系结果'}[action])+'<textarea name="'+(action==='followup'?'note':'reason')+'" maxlength="500" required></textarea></label>';if(action==='approve')host.innerHTML=goods(row.outgoing,false)+goods(row.incoming,true);if(action==='handoff')host.innerHTML=field('供货商接货人','receiver')+field('交货凭证或交接记录','proof')+'<label class="check"><input name="actual" type="checkbox" required>已将所列旧货实际交给供货商</label>';
 if(action==='receipt'){host.innerHTML=row.incoming.filter(x=>x.quantity>x.received).map(x=>'<div class="receipt-line" data-line="'+esc(x.id)+'"><strong>'+esc(x.productName)+'</strong><span class="meta">　尚待 '+esc(x.quantity-x.received)+' 件　'+yuan(x.unitPriceCents)+'/件</span><label>本次验收数量<input class="received-quantity" type="number" min="0" step="1" max="'+(x.quantity-x.received)+'" value="'+(row.mode==='当面交换'?x.quantity-x.received:0)+'" required></label>'+(x.trackSerial?'<label>本次验收完整串号<textarea class="received-serials" placeholder="每行一个新货串号">'+esc((x.serialNos||[]).filter(no=>!row.receipts.some(receipt=>receipt.items.some(item=>item.lineId===x.id&&(item.serialNos||[]).includes(no)))).join('\n'))+'</textarea></label>':'')+'</div>').join('')+(!row.handedAt?field('供货商接货人','receiver')+field('旧货交出凭证','handoffProof'):'')+field('收货验收凭证','proof')+'<label class="check"><input name="actual" type="checkbox" required>已逐件核对本次验收实物和完整串号</label>';}
 if(action==='settle'){host.innerHTML=field('本次实际金额（元）','amount','number',(row.balance.remainingCents/100).toFixed(2))+'<label>实际账户<select name="paymentAccountId" required>'+data.accounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('')+'</select></label>'+field('实际流水或现金凭证','reference')+'<label class="check"><input name="actual" type="checkbox" required>我有权核实该账户，已核实本次真实收付款</label>';if(!data.accounts.length)host.innerHTML+='<p class="error">当前账号没有可核实账户，请联系实际账户核实人。</p>';}
 if(action==='receipt')mountReceiptScanners();$('action-error').textContent='';$('dialog').showModal();}
async function refresh(){const p=new URLSearchParams({q:$('query').value});const [result,latest]=await Promise.all([api('/api/supplier-exchanges?'+p),api('/api/supplier-exchanges/options')]);data=latest;records=result.rows||[];for(const line of document.querySelectorAll('.item-line')){const selected=new Set([...line.querySelector('.serial-select').selectedOptions].map(x=>x.value));models(line);for(const item of line.querySelector('.serial-select').options)item.selected=selected.has(item.value);}draw();}
function signal(){try{localStorage.setItem('workbench-updated',String(Date.now()));}catch{}document.dispatchEvent(new Event('store-data-updated'));}
$('exchange-form').onsubmit=async event=>{event.preventDefault();if(busy)return;const form=event.currentTarget;const body={...Object.fromEntries(new FormData(form)),outgoing:collect('outgoing'),incoming:collect('incoming')},fingerprint=JSON.stringify(body);try{validateSerialLines(body);}catch(error){tell(error.message,true);return;}if(submission.uncertain&&submission.hash!==fingerprint){tell('上次提交结果尚未确认，请先刷新换货记录核对，避免重复申请。',true);return;}if(submission.hash&&submission.hash!==fingerprint)submission={key:key(),hash:''};submission.hash=fingerprint;body.requestKey=submission.key;busy=true;$('submit').disabled=true;$('submit').textContent='提交中，请等待…';try{const r=await api('/api/supplier-exchanges',body);form.reset();$('outgoing').replaceChildren();$('incoming').replaceChildren();addLine('out');addLine('in');submission={key:key(),hash:''};$('submit-result').innerHTML=(r.duplicate?'该申请已提交：':'已提交老板批准：')+'<a href="/supplier-exchanges?id='+encodeURIComponent(r.id)+'">'+esc(r.displayNo||r.id)+'</a>';tell('申请已保存，等待老板批准；库存尚未变化。');signal();await refresh();$('record-'+r.id)?.scrollIntoView({behavior:'smooth'});}catch(error){submission.uncertain=!error.confirmedFailure;tell(error.message+(submission.uncertain?'；本次结果未确认，请保留内容重试或刷新原单核对。':''),true);}finally{busy=false;$('submit').disabled=false;$('submit').textContent='提交老板批准';}};
$('action-form').onsubmit=async event=>{event.preventDefault();if(busy||!current)return;const form=event.currentTarget,{action,row}=current,body={...Object.fromEntries(new FormData(form)),id:row.id,version:row.version};if(action==='approve'||action==='reject')body.approved=action==='approve';if('actual' in body)body.actual=true;if(action==='receipt')body.items=[...form.querySelectorAll('[data-line]')].map(el=>({lineId:el.dataset.line,quantity:Number(el.querySelector('.received-quantity').value),serialNos:parsedSerials(el.querySelector('.received-serials')?.value)})).filter(x=>x.quantity>0);if(action==='receipt')try{validateReceiptScan(body,row);}catch(error){$('action-error').textContent=error.message;return;}const fingerprint=JSON.stringify(body);if(current.hash&&current.hash!==fingerprint){$('action-error').textContent='上次提交结果尚未确认，请刷新核对原单后重新办理。';return;}current.hash=fingerprint;body.requestKey=current.key;busy=true;$('action-submit').disabled=true;$('cancel').disabled=true;try{const r=await api('/api/supplier-exchanges/'+({approve:'review',reject:'review'}[action]||action),body);$('dialog').close();signal();tell('已办理：'+r.status);await refresh();}catch(error){if(error.confirmedFailure){current.hash='';current.key=key();}$('action-error').textContent=error.message+(error.confirmedFailure?'':'；结果尚未确认，请保留原内容重试，或刷新核对原单。');}finally{busy=false;$('action-submit').disabled=false;$('cancel').disabled=false;}};
$('dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});$('cancel').onclick=()=>{if(!busy)$('dialog').close();};$('add-out').onclick=()=>addLine('out');$('add-in').onclick=()=>addLine('in');$('refresh').onclick=()=>refresh().catch(e=>tell(e.message,true));$('scope').onchange=draw;$('filter').onsubmit=e=>{e.preventDefault();refresh().catch(e=>tell(e.message,true));};
mountScanCamera();
(async()=>{try{data=await api('/api/supplier-exchanges/options');$('supplier').replaceChildren(option('','请选择供货商'));data.suppliers.forEach(x=>$('supplier').append(option(x.id,x.name)));addLine('out');addLine('in');await refresh();tell('');const id=new URLSearchParams(location.search).get('id');if(id){$('editor').hidden=true;$('record-'+id)?.scrollIntoView();if(!records.some(r=>r.id===id))tell('当前账号没有找到这张换货单，请核对单号或权限。',true);}}catch(e){tell(e.message,true);$('records').innerHTML='<p class="error">未能读取换货记录，请刷新页面重试。</p>';}})();
})();

(function(){'use strict';
 const params=new URLSearchParams(location.search),id=params.get('id');if(params.get('embedded')!=='pending'||!/^SX-[a-z0-9-]{1,100}$/i.test(id||'')||window.parent===window)return;
 document.documentElement.classList.add('original-embedded');let queued=false;
 function report(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;const record=document.getElementById('record-'+id),ready=!!record,message=document.getElementById('message'),bottom=record?record.getBoundingClientRect().bottom:message&&!message.hidden?message.getBoundingClientRect().bottom:220;window.parent.postMessage({type:'erp-original-document',action:'resize',documentId:id,height:Math.max(220,bottom+window.scrollY+12),ready,error:!ready&&message&&!message.hidden?message.textContent:''},location.origin);});}
 new ResizeObserver(report).observe(document.body);new MutationObserver(report).observe(document.body,{childList:true,subtree:true,characterData:true});report();
 document.addEventListener('store-data-updated',()=>window.parent.postMessage({type:'erp-original-document',action:'updated',documentId:id},location.origin));
})();
