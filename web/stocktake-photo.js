(function(root,factory){const core=factory();if(typeof module==='object'&&module.exports)module.exports=core;else root.StocktakePhotoCore=core;})(typeof window==='object'?window:globalThis,function(){
 'use strict';const areaKey=e=>JSON.stringify([e.warehouseId,String(e.area).trim().normalize('NFKC').replace(/\s+/g,' ').toLowerCase()]);
 function replace(entries,entry){
  if(!entry.area?.trim()||!entry.warehouseId||!/^[a-f0-9]{64}$/.test(entry.photoId))throw Error('请填写拍摄区域并选择照片');
  if(entries.some(e=>e.photoId===entry.photoId&&areaKey(e)!==areaKey(entry)))throw Error('这张照片已用于其他区域，不能重复计算');
  const next=entries.filter(e=>areaKey(e)!==areaKey(entry));if(next.length>=100)throw Error('一张盘点表最多100个拍摄区域');
  const quantities=new Map();
  for(const row of entry.rows){if(!row.skuId||!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>10000)throw Error('请选择准确型号，填写实际数量');quantities.set(row.skuId,(quantities.get(row.skuId)||0)+row.quantity);}
  if(!quantities.size)throw Error('请至少保留一款实点手机');
  next.push({...entry,area:entry.area.trim(),rows:[...quantities].map(([skuId,quantity])=>({skuId,quantity}))});return next;
 }
 function aggregate(entries){const rows=new Map();for(const entry of entries)for(const item of entry.rows){const key=JSON.stringify([entry.warehouseId,item.skuId]);const row=rows.get(key)||{skuId:item.skuId,warehouseId:entry.warehouseId,actual:0,photoAreas:[]};row.actual+=item.quantity;if(!Number.isSafeInteger(row.actual))throw Error('累计数量过大');row.photoAreas.push({area:entry.area,photoId:entry.photoId,quantity:item.quantity});rows.set(key,row);}return [...rows.values()];}
 return {areaKey,replace,aggregate};
});
if(typeof window==='object')window.StocktakePhoto={mount:function({api,catalog,getDraft,applyEntries,status}){
 const $=id=>document.getElementById(id),E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let selected=null,stream=null,run=0,pending=false,configured=false,controller=null;
 function note(text){$('stocktake-photo-status').textContent=text;}
 function stop(){run++;stream?.getTracks().forEach(t=>t.stop());stream=null;}
 function clear(){controller?.abort();selected=null;$('stocktake-photo-preview').hidden=true;$('stocktake-photo-image').removeAttribute('src');note('');}
 function phones(w){return catalog.products.filter(p=>p.phone&&(!p.warehouseIds.length||p.warehouseIds.includes(w)));}
 async function prepare(source){
  const width=source.videoWidth||source.width,height=source.videoHeight||source.height;
  if(!width||!height||width*height>40000000)throw Error('照片尺寸过大或内容无法读取，请重新拍摄');
  const canvas=document.createElement('canvas'),scale=Math.min(1,2048/Math.max(width,height));canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);const image=canvas.toDataURL('image/jpeg',.88);
  if(image.length>3*1024*1024*4/3+100)throw Error('照片过大，请分区域拍摄');
  clear();selected={image,warehouseId:$('stocktake-warehouse').value};$('stocktake-photo-image').src=image;$('stocktake-photo-preview').hidden=false;note('先检查照片：手机与盒子是否清楚、包裹是否打开。');
 }
 async function load(file){if(!file)return;let bitmap;try{if(!/^image\//.test(file.type)||file.size>20*1024*1024)throw Error('请选择20MB以内的照片');bitmap=await createImageBitmap(file);await prepare(bitmap);}catch(e){status(e.message,true);}finally{bitmap?.close();}}
 $('stocktake-shelf-photo').onclick=()=>{if(!pending)$('stocktake-shelf-input').click();};
 $('stocktake-album-photo').onclick=()=>{if(!pending)$('stocktake-album-input').click();};
 for(const id of ['stocktake-shelf-input','stocktake-album-input'])$(id).onchange=e=>{load(e.target.files[0]);e.target.value='';};
 $('stocktake-walk-camera').onclick=async()=>{
  if(pending)return;if(!navigator.mediaDevices?.getUserMedia)return status('相机不能打开，请用拍照或相册。',true);
  const dlg=document.createElement('dialog');dlg.className='stocktake-camera';dlg.innerHTML='<h2>走拍盘点</h2><p>对准一个包裹或货架区域，停稳后拍一张；同一区域多次拍摄替换原结果。</p><video playsinline muted></video><div class="stocktake-camera-actions"><button type="button" class="primary" disabled>拍下这一区域</button><button type="button">关闭</button></div>';
  document.body.append(dlg);dlg.showModal();const current=++run,finish=()=>{stop();dlg.remove();};dlg.oncancel=finish;dlg.onclose=finish;dlg.querySelectorAll('button')[1].onclick=finish;
  try{const capture=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});if(current!==run||!dlg.isConnected){capture.getTracks().forEach(t=>t.stop());return;}stream=capture;const video=dlg.querySelector('video');video.srcObject=stream;await video.play();if(current!==run||!dlg.isConnected)return;const shutter=dlg.querySelector('button');shutter.disabled=false;shutter.onclick=async()=>{try{await prepare(video);finish();}catch(e){status(e.message,true);}};}catch{finish();status('相机未打开，请允许相机权限或选取照片。',true);}
 };
 function review(result,photo){
  const w=result.warehouseId,choices=phones(w),dlg=document.createElement('dialog');dlg.className='stocktake-photo-review';
  dlg.innerHTML='<form><h2>核实照片里的手机</h2><p>'+E(catalog.warehouses.find(x=>x.id===w)?.name)+' · '+E(result.area)+'</p>'+(photo?'<img class="stocktake-review-image" src="'+E(photo)+'" alt="本次盘点照片">':'')+'<p class="stocktake-photo-warning">手机盒须确认非空；遮挡与未打开的包裹请补拍。照片不能确认全部串号。</p>'+(result.warnings||[]).map(w=>'<p>'+E(w)+'</p>').join('')+'<div class="stocktake-photo-items">'+(result.items||[]).map((item,i)=>'<article data-photo-item="'+i+'"><label class="stocktake-photo-use"><input type="checkbox" name="use"'+(['phone','phone_box'].includes(item.kind)?' checked':'')+'>计入这一区域</label><strong>'+E(item.name)+'</strong><p>'+E(item.note||'请核对型号和可见数量')+'</p><label>实际商品<select name="skuId"><option value="">请选择准确型号</option>'+choices.map(p=>'<option value="'+E(p.skuId)+'"'+(p.skuId===item.skuId?' selected':'')+'>'+E(p.name)+'</option>').join('')+'</select></label><label>实际数量（台）<input name="quantity" type="number" min="0" max="10000" step="1" inputmode="numeric" value="'+(item.quantity===null?'':E(item.quantity))+'" required></label></article>').join('')+'</div><button type="button" class="stocktake-manual-item">＋ 补充一个型号</button><label class="stocktake-photo-confirm"><input name="confirmed" type="checkbox">已检查型号、数量、空盒和遮挡；此区域与其他已拍区域没有重复</label><p role="alert"></p><div class="stocktake-camera-actions"><button type="button" class="stocktake-review-cancel">取消</button><button type="submit" class="primary">确认加入实点表</button></div></form>';
  document.body.append(dlg);dlg.showModal();dlg.oncancel=()=>dlg.remove();dlg.querySelector('.stocktake-review-cancel').onclick=()=>dlg.remove();
  dlg.querySelector('.stocktake-manual-item').onclick=()=>{const item=document.createElement('article');item.innerHTML='<label class="stocktake-photo-use"><input type="checkbox" name="use" checked>计入这一区域</label><strong>人工补充</strong><label>实际商品<select name="skuId"><option value="">请选择准确型号</option>'+choices.map(p=>'<option value="'+E(p.skuId)+'">'+E(p.name)+'</option>').join('')+'</select></label><label>实际数量（台）<input name="quantity" type="number" min="0" max="10000" step="1" inputmode="numeric" required></label>';dlg.querySelector('.stocktake-photo-items').append(item);item.scrollIntoView({block:'nearest'});};
  dlg.querySelector('form').noValidate=true;dlg.querySelector('form').onsubmit=e=>{e.preventDefault();const error=dlg.querySelector('[role=alert]');try{
   if(!dlg.querySelector('[name=confirmed]').checked)throw Error('请先核实照片内容并勾选确认');
   const rows=[...dlg.querySelectorAll('.stocktake-photo-items article')].filter(el=>el.querySelector('[name=use]').checked).map(el=>{const input=el.querySelector('[name=quantity]');if(input.value==='')throw Error('数量不清楚的商品请补拍或手工清点，不能默认为0');return {skuId:el.querySelector('[name=skuId]').value,quantity:Number(input.value)};});
   const draft=getDraft();if(draft.startedAt!==result.startedAt)throw Error('已换了盘点表，请重新拍摄');
   applyEntries(window.StocktakePhotoCore.replace(draft.photoEntries||[],{area:result.area,warehouseId:w,photoId:result.photoId,rows}));dlg.remove();clear();status('已加入实点表；数量已确认，串号尚未核对。');
  }catch(e){error.textContent=e.message;}};
 }
 $('stocktake-photo-recognize').onclick=async()=>{
  if(pending)return;if(!selected)return status('请先拍摄或选择照片。',true);
  const area=$('stocktake-photo-area').value.trim(),w=$('stocktake-warehouse').value;if(!area){$('stocktake-photo-area').focus();return status('请填写包裹或货架区域名称。',true);}if(selected.warehouseId!==w)return status('仓库已经改变，请重新选择照片。',true);
  const currentDraft=getDraft(),startedAt=currentDraft.startedAt;controller=new AbortController();pending=true;$('stocktake-photo-recognize').disabled=true;note('正在识别可见手机与型号…');
  try{const result=await api('/api/stocktake-photo/recognize',{method:'POST',signal:controller.signal,body:JSON.stringify({image:selected.image,warehouseId:w,area})});if(getDraft().startedAt!==startedAt||controller.signal.aborted)return;review({...result,startedAt},selected.image);note('请在核对窗口确认后加入实点表。');}catch(e){if(e.name!=='AbortError'){note(e.message);status(e.message,true);}}finally{pending=false;$('stocktake-photo-recognize').disabled=!configured;}
 };
 $('stocktake-photo-manual').onclick=()=>{if(!selected)return status('请先拍摄或选择照片。',true);const area=$('stocktake-photo-area').value.trim();if(!area)return status('请填写拍摄区域。',true);if(selected.warehouseId!==$('stocktake-warehouse').value)return status('仓库已经改变，请重新选择照片。',true);const bytes=Uint8Array.from(atob(selected.image.split(',')[1]),c=>c.charCodeAt(0));crypto.subtle.digest('SHA-256',bytes).then(buffer=>review({warehouseId:selected.warehouseId,area,startedAt:getDraft().startedAt,photoId:[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join(''),items:[],warnings:[]},selected.image)).catch(()=>status('照片记录未准备好，请重试。',true));};
 function render(){const entries=getDraft().photoEntries||[];$('stocktake-photo-regions').innerHTML=entries.length?entries.map((e,i)=>'<div class="stocktake-photo-region"><strong>'+E(e.area)+'</strong><span>'+E(catalog.warehouses.find(w=>w.id===e.warehouseId)?.name)+' · '+e.rows.reduce((n,r)=>n+r.quantity,0)+'台</span><button type="button" data-edit-region="'+i+'">修改数量</button><button type="button" data-remove-region="'+i+'">移除区域</button></div>').join(''):'<p>尚未确认拍摄区域</p>';}
 $('stocktake-photo-regions').onclick=e=>{const b=e.target.closest('button');if(!b)return;const entries=getDraft().photoEntries||[];
  if(b.dataset.editRegion!=null){const entry=entries[Number(b.dataset.editRegion)];if(!entry)return;review({...entry,startedAt:getDraft().startedAt,items:entry.rows.map(r=>({...r,name:catalog.products.find(p=>p.skuId===r.skuId)?.name||r.skuId,kind:'phone',note:'修改已确认区域数量'}))});}
  if(b.dataset.removeRegion!=null){const i=Number(b.dataset.removeRegion);if(confirm('移除这个区域的数量记录？'))applyEntries(entries.filter((_,index)=>index!==i));}
 };
 api('/api/stocktake-photo/status').then(s=>{configured=s.configured;$('stocktake-photo-recognize').disabled=!configured;$('stocktake-photo-ready').textContent=configured?'图片识别已接通。照片会发送到配置的图片识别服务，只用于本次识别。':'图片识别接口待接通；目前可拍照查看并手工登记数量。';}).catch(e=>note(e.message));render();window.addEventListener('pagehide',()=>{stop();controller?.abort();});
 return {render,clear,isPending:()=>pending};
}};
