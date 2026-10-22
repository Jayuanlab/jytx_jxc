const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(collection,row){if(!row?.id)return '';const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return '<span class="red-packet-slot" data-rp-collection="'+esc(collection)+'" data-rp-source="'+esc(row.id)+'" hidden><button type="button" class="red-packet-request" data-rp-open>申请红包</button><small data-rp-state></small></span>'; }
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
(()=>{'use strict';
const $=id=>document.getElementById(id),E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=sessionStorage.getItem('officeLocalToken')||'';
let catalog,user,draft,key,busy=false,historyLoaded=false,stream=null,cameraRun=0,photoController=null;
const split=v=>String(v||'').trim().split(/[\s,，;；/]+/).filter(Boolean).map(v=>v.toUpperCase());
const at=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
const uid=()=>crypto.randomUUID?.()||'ST-'+Date.now()+'-'+Math.random().toString(36).slice(2);
async function api(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',...options,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
 const data=await res.json();if(!res.ok)throw Error(data.error?.message||'请求失败（'+res.status+'）');return data;
}
function status(text,bad=false){$('stocktake-status').hidden=!text;$('stocktake-status').textContent=text;$('stocktake-status').classList.toggle('bad',bad);}
function save(){if(!key)return;try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{status('内容暂未保存到浏览器，请保持本页打开。',true);}}
function empty(){draft={startedAt:new Date().toISOString(),warehouseId:catalog.warehouses[0]?.id||'',rows:[],requestKey:uid()};save();}
function product(id){return catalog.products.find(p=>p.skuId===id);}
function options(){
 const q=$('stocktake-product-search').value.trim().toLowerCase(),w=$('stocktake-warehouse').value;
 const rows=catalog.products.filter(p=>(!p.warehouseIds.length||p.warehouseIds.includes(w))&&(!q||[p.name,p.externalCode,p.type].join(' ').toLowerCase().includes(q)));
 $('stocktake-product').innerHTML='<option value="">请选择商品</option>'+rows.slice(0,100).map(p=>'<option value="'+E(p.skuId)+'">'+E(p.name)+'</option>').join('');
}
function tally(row){return row.trackSerial?split(row.serialText).length:Number(row.actual||0);}
function rowHTML(row,i){
 const p=product(row.skuId),w=catalog.warehouses.find(w=>w.id===row.warehouseId),unit=p?.trackSerial?'台':p?.unit||'件';
 return '<article class="stocktake-row" data-row-index="'+i+'"><header><div><h3>'+E(p?.name||row.skuId)+'</h3><span>'+E(w?.name||row.warehouseId)+'</span></div><button type="button" data-remove="'+i+'" aria-label="移除'+E(p?.name||row.skuId)+'">移除</button></header>'+
 (p?.trackSerial&&row.countMode==='photo-quantity'?'<div class="stocktake-photo-count"><p class="stocktake-photo-warning">照相数量盘点 · 串号未核对</p><label>实点数量（台）<input type="number" readonly value="'+E(row.actual)+'"></label><p>'+E((row.photoAreas||[]).map(a=>a.area+' '+a.quantity+'台').join('、'))+'</p><small>数量在“已确认的拍摄区域”中修改</small></div>':p?.trackSerial?'<div class="stocktake-serial-entry"><label>实点完整串号<textarea data-field="serialText" data-index="'+i+'" placeholder="'+(p.phone?'15位完整串号，一行一台':'完整串号，一行一个')+'" spellcheck="false">'+E(row.serialText||'')+'</textarea></label><div class="stocktake-scan-actions"><button type="button" data-scan="'+i+'">扫码</button><button type="button" data-photo="'+i+'">拍照识码</button><strong data-count="'+i+'">'+split(row.serialText).length+' '+unit+'</strong></div><label class="stocktake-counted"><input type="checkbox" data-field="counted" data-index="'+i+'"'+(row.counted?' checked':'')+'>已点清</label></div>':
 '<label class="stocktake-quantity">实点数量（'+E(unit)+'）<input data-field="actual" data-index="'+i+'" type="number" inputmode="numeric" min="0" step="1" value="'+E(row.actual??'')+'" placeholder="请输入实点数量"></label>')+'</article>';
}
function draw(){
 $('stocktake-result').hidden=true;$('stocktake-editor').hidden=false;
 $('stocktake-warehouse').value=draft.warehouseId;options();
 $('stocktake-rows').innerHTML=draft.rows.length?draft.rows.map(rowHTML).join(''):'<div class="stocktake-empty">空白实点表</div>';
 $('stocktake-total').textContent=draft.rows.length+' 行';$('stocktake-error').hidden=true;photoController?.render();
}
function add(id){
 const w=$('stocktake-warehouse').value;if(!id)return;
 if(draft.rows.some(r=>r.skuId===id&&r.warehouseId===w)){status('这款商品已加入本仓实点表。',true);return;}
 if(draft.rows.length>=2000){status('每张盘点表最多2000行。',true);return;}
 draft.rows.push({skuId:id,warehouseId:w,actual:'',serialText:'',counted:false});draft.requestKey=uid();save();draw();
 $('stocktake-rows').lastElementChild?.scrollIntoView({block:'center'});
}
function stop(){cameraRun++;stream?.getTracks().forEach(t=>t.stop());stream=null;}
function scanAdd(index,value){
 const row=draft.rows[index],p=product(row?.skuId);if(!row||!p)return;
 const no=String(value||'').trim().replace(/^(?:IMEI|SN|串号)\s*[:：]?\s*/i,'').toUpperCase();
 if(p.phone?!/^\d{15}$/.test(no):!/^[A-Z0-9-]{5,40}$/.test(no)){status('请扫描或输入'+(p.phone?'15位手机串号':'完整串号')+'。',true);return;}
 if(draft.rows.some(r=>split(r.serialText).includes(no))){status('这个串号已录入，请勿重复。',true);return;}
 row.serialText=[...split(row.serialText),no].join('\n');row.counted=false;draft.requestKey=uid();save();draw();status('已加入实点串号。');
 document.querySelector('[data-row-index="'+index+'"]')?.scrollIntoView({block:'center'});
}
async function camera(index){
 stop();if(!navigator.mediaDevices?.getUserMedia){status('相机不可用，请拍照或输入完整串号。',true);return;}
 const dlg=document.createElement('dialog');dlg.className='stocktake-camera';dlg.innerHTML='<h2>扫描实物串号</h2><video playsinline muted></video><p role="status">对准串号条码</p><button type="button">关闭</button>';document.body.append(dlg);dlg.showModal();
 const done=()=>{stop();dlg.remove();};dlg.querySelector('button').onclick=done;dlg.oncancel=done;dlg.onclose=done;
 const run=++cameraRun;
 try{const captured=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(run!==cameraRun||!dlg.isConnected){captured.getTracks().forEach(t=>t.stop());return;}stream=captured;const video=dlg.querySelector('video');video.srcObject=stream;await video.play();
 const frame=async()=>{if(run!==cameraRun||!dlg.isConnected)return;try{if(video.videoWidth){const no=await window.SaleCapture.decode(video);if(run!==cameraRun)return;if(no){done();scanAdd(index,no);return;}}}catch{}if(run===cameraRun)setTimeout(frame,350);};frame();
 }catch{done();status('相机未打开，请拍照或手工输入。',true);}
}
function photo(index){
 const input=document.createElement('input');input.type='file';input.accept='image/*';input.setAttribute('capture','environment');
 input.onchange=async()=>{let bitmap;try{if(!input.files[0])return;bitmap=await createImageBitmap(input.files[0]);const no=await window.SaleCapture.decode(bitmap);if(no)scanAdd(index,no);else status('照片未识别到串号，请手工输入。',true);}catch{status('识别失败，请手工输入。',true);}finally{bitmap?.close();input.remove();}};input.click();
}
function error(message,index,field){
 const box=$('stocktake-error');box.hidden=false;box.textContent=message;
 const el=document.querySelector('[data-index="'+index+'"][data-field="'+field+'"]');el?.setAttribute('aria-invalid','true');el?.scrollIntoView({block:'center'});el?.focus();
}
function payload(){
 if(!draft.rows.length)throw Error('请先加入实点商品。');
 const all=new Set();
 return {startedAt:draft.startedAt,rows:draft.rows.map((r,i)=>{
  const p=product(r.skuId);
  if(!p)throw Error('商品档案已变化，请重新选择。');
  if(r.countMode==='photo-quantity'){if(!r.counted)throw Error('请确认照片数量');return {skuId:r.skuId,warehouseId:r.warehouseId,countMode:'photo-quantity',actual:Number(r.actual),photoAreas:r.photoAreas,counted:true};}
  if(p.trackSerial){
   if(!r.counted){error('请确认这款商品已点清。',i,'counted');throw Error('请勾选已点清。');}
   const serials=split(r.serialText);
   for(const no of serials){if(p.phone?!/^\d{15}$/.test(no):!/^[A-Z0-9-]{5,40}$/.test(no)){error('请填写完整'+(p.phone?'15位手机':'')+'串号。',i,'serialText');throw Error('请检查完整串号。');}if(all.has(no)){error('串号重复：'+no,i,'serialText');throw Error('请去除重复串号。');}all.add(no);}
   return {skuId:r.skuId,warehouseId:r.warehouseId,serials,counted:true};
  }
  if(r.actual===''||!Number.isSafeInteger(Number(r.actual))||Number(r.actual)<0){error('请填写实际数量，没有实物填0。',i,'actual');throw Error('请填写实点数量。');}
  return {skuId:r.skuId,warehouseId:r.warehouseId,actual:Number(r.actual)};
 })};
}
function resultsHTML(sheet,review=false){
 const boundCount=(sheet.rows||[]).reduce((n,r)=>n+(r.boundSerials||[]).length,0);
 const warning=(boundCount?'<p>本次已把 '+boundCount+' 个实点串号补录到原库存，库存数量和金额未变。</p>':'')+(sheet.rows?.some(r=>r.serialsPending)?'<p class="stocktake-photo-warning">照相盘点只核对可见数量，手机串号尚未逐台核实。</p>':'')+(sheet.rows?.some(r=>r.changedDuringCount)?'<p class="stocktake-error">盘点期间有出入库，请按流水重新核实标注的商品。</p>':'');
 const table='<div class="stocktake-comparison"><table><thead><tr>'+['商品 / 仓库','账面','实点','差异','结果'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+sheet.rows.map(r=>'<tr class="'+(r.different||r.changedDuringCount?'different':'')+'"><td data-label="商品 / 仓库"><strong>'+E(r.product)+'</strong><small>'+E(r.warehouseName)+'</small></td><td data-label="账面">'+r.expected+' '+E(r.unit)+'</td><td data-label="实点">'+r.actual+' '+E(r.unit)+'</td><td data-label="差异">'+(r.delta>0?'+':'')+r.delta+'</td><td data-label="结果">'+E(r.status)+'</td></tr>'+((r.missingSerials||[]).length||(r.extraSerials||[]).length||r.serialBookDifference||r.changedDuringCount?'<tr><td colspan="5"><details><summary>查看核对明细</summary>'+((r.missingSerials||[]).length?'<p>未点到：'+r.missingSerials.map(E).join('、')+'</p>':'')+((r.extraSerials||[]).length?'<p>多点到：'+r.extraSerials.map(E).join('、')+'</p>':'')+(r.serialBookDifference?'<p>账面数量与登记串号数相差 '+r.serialBookDifference+' 台。</p>':'')+(r.changedDuringCount?'<p>本次盘点期间发生库存变动。</p>'+r.movementsDuringCount.map(m=>'<p>'+E(at(m.createdAt))+' · '+E(m.type)+' · '+E(m.quantity)+' · '+E(documentRef(m,"sourceId"))+'</p>').join(''):'')+'</details></td></tr>':'')).join('')+'</tbody></table></div>';
 return '<article class="stocktake-saved"><h2>'+E(sheet.status)+'</h2><p>'+E(sheet.operator)+' · '+E(at(sheet.createdAt))+'</p><small>盘点表 '+E(documentNo(sheet))+'</small>'+warning+table+
 ((sheet.uncounted||[]).length?'<details><summary>未盘点商品（'+sheet.uncounted.length+'款）</summary>'+sheet.uncounted.map(r=>'<p>'+E(r.product)+' · '+E(r.warehouseName)+'</p>').join('')+'</details>':'')+
 (sheet.reviewNote?'<p>核实结果：'+E(sheet.reviewNote)+'</p>':'')+
 redPacketEntry('stocktakes',sheet)+(review&&user.capabilities.manageUsers&&sheet.status==='差异待核实'?'<form class="stocktake-review-form" data-sheet="'+E(sheet.id)+'"><label>核实结果<textarea name="note" required maxlength="1000"></textarea></label><button type="submit">保存核实结果</button><p class="stocktake-error" role="alert" hidden></p></form>':'')+'</article>';
}
async function history(){
 try{const [rows,old]=await Promise.all([api('/api/stocktake-sheets'),api('/api/serial-stocktakes')]);$('stocktake-history-content').innerHTML=rows.length?rows.map(s=>'<details class="stocktake-history-sheet"><summary>'+E(at(s.createdAt))+' · '+E(s.operator)+' · '+E(s.status)+'</summary>'+resultsHTML(s,true)+'</details>').join(''):'<p>暂无实点表</p>';
 if(old.length)$('stocktake-history-content').insertAdjacentHTML('beforeend','<details><summary>以前的串号盘点（'+old.length+'）</summary>'+old.map(r=>'<article class="stocktake-saved"><h3>'+E(r.product)+' · '+E(r.status)+'</h3><p>'+E(r.operator)+' · '+E(at(r.createdAt))+'</p><p>账面 '+r.expected+' · 实点 '+r.actual+'</p><p>'+E(r.reason)+'</p>'+(r.reviewNote?'<p>核实结果：'+E(r.reviewNote)+'</p>':'')+redPacketEntry('stocktakes',r)+(user.capabilities.manageUsers&&r.status==='差异待核实'?'<form class="stocktake-review-form" data-legacy="1" data-sheet="'+E(r.id)+'"><label>核实结果<textarea name="note" required maxlength="1000"></textarea></label><button type="submit">保存核实结果</button><p class="stocktake-error" role="alert" hidden></p></form>':'')+'</article>').join('')+'</details>');
 historyLoaded=true;
 }catch(e){$('stocktake-history-content').textContent='记录加载失败：'+e.message;}
}
$('stocktake-form').onsubmit=async e=>{
 e.preventDefault();if(busy||photoController?.isPending())return status('请先完成照片核对。',true);let body;try{body=payload();}catch(err){status(err.message,true);return;}
 busy=true;const form=e.target;form.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);status('正在核对并保存…');
 try{const result=await api('/api/stocktake-sheets/compare',{method:'POST',headers:{'Idempotency-Key':draft.requestKey},body:JSON.stringify(body)});
  sessionStorage.removeItem(key);empty();$('stocktake-editor').hidden=true;$('stocktake-result').hidden=false;$('stocktake-result').innerHTML=resultsHTML(result)+'<button type="button" id="stocktake-next" class="primary">新建空白盘点表</button>';
  $('stocktake-next').onclick=()=>{draw();status('新表已准备好。');};status(result.message);historyLoaded=false;if($('stocktake-history').open)await history();$('stocktake-result').scrollIntoView({block:'start'});
 }catch(err){status('尚未确认保存：'+err.message,true);$('stocktake-error').hidden=false;$('stocktake-error').textContent=err.message;
 }finally{busy=false;form.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);}
};
$('stocktake-form').addEventListener('input',e=>{
 const el=e.target;if(el.dataset.field){const r=draft.rows[Number(el.dataset.index)];if(!r)return;r[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;
 if(el.dataset.field==='serialText'){r.counted=false;const check=document.querySelector('[data-index="'+el.dataset.index+'"][data-field="counted"]');if(check)check.checked=false;document.querySelector('[data-count="'+el.dataset.index+'"]').textContent=split(r.serialText).length+' 台';}
 draft.requestKey=uid();save();el.removeAttribute('aria-invalid');}
});
$('stocktake-warehouse').onchange=e=>{photoController?.clear();draft.warehouseId=e.target.value;save();options();};
$('stocktake-product-search').oninput=options;$('stocktake-add').onclick=()=>add($('stocktake-product').value);
$('stocktake-generate').onclick=()=>{
 const w=$('stocktake-warehouse').value,ids=catalog.products.filter(p=>!p.warehouseIds.length||p.warehouseIds.includes(w)).map(p=>p.skuId);
 if(ids.length+draft.rows.length>2000){status('商品过多，请分批加入。',true);return;}
 for(const id of ids)if(!draft.rows.some(r=>r.skuId===id&&r.warehouseId===w))draft.rows.push({skuId:id,warehouseId:w,actual:'',serialText:'',counted:false});
 draft.requestKey=uid();save();draw();status('已生成空白实点行。');
};
$('stocktake-clear').onclick=()=>{photoController?.clear();if(draft.rows.length&&!confirm('清除本页尚未提交的实点内容，重新开一张空表？'))return;empty();draw();status('新表已准备好。');};
$('stocktake-rows').onclick=e=>{
 const b=e.target.closest('button');if(!b||busy)return;
 if(b.dataset.remove!=null){const i=Number(b.dataset.remove),r=draft.rows[i];if(r.countMode==='photo-quantity')return status('这行数量来自拍摄区域，请在“已确认的拍摄区域”修改或移除。',true);if((r.actual!==''||r.serialText)&&!confirm('移除这一行实点内容？'))return;draft.rows.splice(i,1);draft.requestKey=uid();save();draw();}
 if(b.dataset.scan!=null)camera(Number(b.dataset.scan));if(b.dataset.photo!=null)photo(Number(b.dataset.photo));
};
$('stocktake-history').ontoggle=()=>{if($('stocktake-history').open&&!historyLoaded)history();};
$('stocktake-history-content').addEventListener('submit',async e=>{
 if(!e.target.matches('.stocktake-review-form'))return;e.preventDefault();const form=e.target,b=form.querySelector('button'),note=form.elements.note.value.trim(),feedback=form.querySelector('[role=alert]');
 if(!note){feedback.hidden=false;feedback.textContent='请填写核实结果。';return;}b.disabled=true;
 try{await api(form.dataset.legacy?'/api/serial-stocktakes/review':'/api/stocktake-sheets/review',{method:'POST',headers:{'Idempotency-Key':uid()},body:JSON.stringify({id:form.dataset.sheet,note})});status('核实结果已保存。');await history();}catch(err){feedback.hidden=false;feedback.textContent=err.message;b.disabled=false;}
});
function applyPhotoEntries(entries){
 const combined=window.StocktakePhotoCore.aggregate(entries),photoKeys=new Set(draft.rows.filter(r=>r.countMode==='photo-quantity').map(r=>JSON.stringify([r.warehouseId,r.skuId])));
 for(const row of combined){const old=draft.rows.find(r=>r.skuId===row.skuId&&r.warehouseId===row.warehouseId);if(old&&old.countMode!=='photo-quantity'&&(old.serialText||old.actual!==''))throw Error('这款手机已有其他实点记录，请分开盘点，避免把串号或数量混在一起');}
 const untouched=draft.rows.filter(r=>!photoKeys.has(JSON.stringify([r.warehouseId,r.skuId]))&&!combined.some(p=>p.skuId===r.skuId&&p.warehouseId===r.warehouseId));
 if(untouched.length+combined.length>2000)throw Error('盘点商品超过2000行，请分表');
 draft.rows=[...untouched,...combined.map(r=>({...r,countMode:'photo-quantity',actual:String(r.actual),serialText:'',counted:true}))];draft.photoEntries=entries;draft.requestKey=uid();save();draw();
}
window.addEventListener('pagehide',stop);
(async()=>{
 try{[catalog,user]=await Promise.all([api('/api/stocktake-catalog'),api('/api/me')]);key='stocktake-blank:'+catalog.scopeKey+':'+user.id;
  try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved&&Array.isArray(saved.rows)&&saved.rows.length<=2000&&saved.startedAt&&saved.requestKey)draft=saved;}catch{}
  if(!draft)empty();$('stocktake-warehouse').innerHTML=catalog.warehouses.map(w=>'<option value="'+E(w.id)+'">'+E(w.name)+'</option>').join('');
  photoController=window.StocktakePhoto.mount({api,catalog,getDraft:()=>draft,applyEntries:applyPhotoEntries,status});
  draw();status(draft.rows.length?'已恢复尚未提交的实点表。':'');$('stocktake-status').hidden=!draft.rows.length;
 }catch(e){status(e.message,true);$('stocktake-status').insertAdjacentHTML('beforeend',' <a href="/login">登录</a>');$('stocktake-history').hidden=true;}
})();
})();
