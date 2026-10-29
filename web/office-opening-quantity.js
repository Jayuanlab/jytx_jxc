(()=>{
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const money=value=>'¥'+Number(value||0).toFixed(2);
 const aliases=Object.assign(Object.create(null),{'万州朗丰公司':'重庆万州朗丰公司','万州朗丰':'重庆万州朗丰'});
 const families={E:'E系列钢化膜',M:'M系列水凝膜',G:'G系列光固膜',GB:'GB系列光固膜',MY:'MY系列水凝膜',B:'B系列高清膜'};
 function parseCsv(text){
  text=String(text).replace(/^\uFEFF/,'');const records=[];let cells=[],cell='',quoted=false,closed=false,line=1,startLine=1;
  const endCell=()=>{cells.push(cell);cell='';closed=false;};
  const endRow=()=>{endCell();if(cells.some(value=>value.trim()!==''))records.push({cells,line:startLine});cells=[];if(records.length>501)throw Error('每次最多500条商品数据，请分批导入。');};
  for(let i=0;i<text.length;i++){
   const ch=text[i];
   if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;cell+='\n';line++;}else cell+=ch;continue;}
   if(ch===','){endCell();continue;}
   if(ch==='\r'||ch==='\n'){endRow();if(ch==='\r'&&text[i+1]==='\n')i++;line++;startLine=line;continue;}
   if(closed){if(ch===' '||ch==='\t')continue;throw Error('CSV第'+line+'行引号后存在多余字符。');}
   if(ch==='"'){if(cell!=='')throw Error('CSV第'+line+'行引号格式不正确。');quoted=true;continue;}
   cell+=ch;
  }
  if(quoted)throw Error('CSV引号没有闭合，请重新导出UTF-8 CSV。');if(cell!==''||cells.length||closed)endRow();
  if(records.length<2)throw Error('CSV没有商品数据行。');
  const headers=records.shift().cells.map(value=>value.trim()),required=['商品名','简称','编码','数量','供货商','进价'];
  for(const name of required)if(headers.filter(header=>header===name).length!==1)throw Error('CSV须有且仅有一列“'+name+'”。');
  const index=name=>headers.indexOf(name),sourceRowIndex=['原表行号','sourceRow','sheetrow'].map(index).find(value=>value>=0);
  return records.map(record=>{
   if(record.cells.length!==headers.length)throw Error('CSV第'+record.line+'行列数与表头不一致。');
   const value=name=>String(record.cells[index(name)]??'').trim(),quantity=value('数量'),cost=value('进价'),sale=index('卖价')<0?null:value('卖价'),sourceRow=sourceRowIndex==null?String(record.line):String(record.cells[sourceRowIndex]||'').trim();
   if(!value('商品名')||!value('简称')||!value('供货商'))throw Error('CSV第'+record.line+'行商品名、简称和供货商不能为空。');
   if(!/^\d+$/.test(quantity)||!Number.isSafeInteger(Number(quantity)))throw Error('CSV第'+record.line+'行数量须为明确的非负整数，0数量也会保留。');
   if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(cost)||!Number.isFinite(Number(cost)))throw Error('CSV第'+record.line+'行进价须明确填写，真实0元请填0。');
   if(sale!=null&&(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(sale)||!Number.isFinite(Number(sale))))throw Error('CSV第'+record.line+'行卖价须明确填写，真实0元请填0。');
   if(!/^\d+$/.test(sourceRow)||!Number.isSafeInteger(Number(sourceRow))||Number(sourceRow)<1)throw Error('CSV第'+record.line+'行来源行号无效。');
   const model=value('简称'),series=model.match(/^(GB|MY|G|E|M|B)\d/i)?.[1]?.toUpperCase();
   return {sourceRow:Number(sourceRow),name:value('商品名'),model,sourceBarcode:value('编码'),supplier:value('供货商'),quantity:Number(quantity),unitCost:Number(cost),...(sale!=null?{salePrice:Number(sale)}:{}),type:'配件产品',subType:'保护膜',thirdType:families[series]||'',unit:'张',purchaseDate:''};
  });
 }
 async function open(){
  if(state.user?.roleCode!=='owner')return;
  const prior=document.getElementById('inventory-opening-quantity-dialog');if(prior?.dataset.saving==='1')return;prior?.remove();
  const root=document.createElement('dialog');root.id='inventory-opening-quantity-dialog';root.className='inventory-count-dialog inventory-source-dialog inventory-opening-dialog';root.setAttribute('aria-labelledby','opening-quantity-title');
  root.innerHTML='<button type="button" class="inventory-source-close" data-quantity-close>关闭</button><h2 id="opening-quantity-title">补录期初商品</h2><p>用于保护膜等期初漏录商品。上传UTF-8 CSV，一次最多500条；0数量仅建档，明确填0的进价按真实0元记账。可另列“卖价”，仅用于新建商品档案；已有商品调价仍走审批。</p><form id="opening-quantity-form"><label>入库仓库<select name="warehouseId" required>'+state.warehouses.filter(w=>w.id==='wh-b'&&w.active!==false).map(w=>'<option value="'+escape(w.id)+'">'+escape(w.name)+'</option>').join('')+'</select></label><label>上传UTF-8 CSV<input name="csvFile" type="file" accept=".csv,text/csv" required><small>必需列：商品名、简称、编码、数量、供货商、进价；可加卖价。原编码按文本保留前导0，可重复。</small></label><p id="opening-quantity-file-status" role="status">请选择原表转换的CSV文件。</p><section id="opening-quantity-suppliers" hidden></section><label>来源依据<input name="sourceRef" required maxlength="200" placeholder="填写原始库存表或实物核对依据"></label><label>漏录原因与核对依据<textarea name="reason" required minlength="4" maxlength="500"></textarea></label><details><summary>原XLSX来源证据（选填）</summary><p>所上传CSV另有独立文件哈希；下方只填真实原表信息。</p><label>原表文件名<input name="originalFile" maxlength="200"></label><label>原表SHA-256<input name="originalSha" maxlength="64" spellcheck="false" autocomplete="off"></label><label>原表工作表<input name="originalSheet" maxlength="100"></label></details><p id="opening-quantity-status" role="status">正在读取已有供货商…</p><p id="opening-quantity-error" class="inventory-warning" role="alert" hidden></p><section id="opening-quantity-preview" class="inventory-source-preview" aria-live="polite" hidden></section><div class="inventory-count-submit"><button type="submit" id="opening-quantity-prepare" disabled>预览追加内容</button><button type="button" id="opening-quantity-confirm" hidden>确认追加期初商品</button><button type="button" data-quantity-close>取消</button></div></form>';
  document.body.append(root);root.showModal();const get=id=>root.querySelector('#'+id),form=get('opening-quantity-form'),field=name=>form.elements[name],error=get('opening-quantity-error'),status=get('opening-quantity-status'),fileStatus=get('opening-quantity-file-status'),prepare=get('opening-quantity-prepare'),confirm=get('opening-quantity-confirm'),preview=get('opening-quantity-preview'),mappingHost=get('opening-quantity-suppliers');
  let suppliers=[],uploaded=null,mapping=Object.create(null),revision=0,fileRevision=0,prepared=null,preparedBody='',saving=false,uncertain=false,attempt={};
  const showError=err=>{error.hidden=false;error.textContent=err.message||String(err);error.scrollIntoView({block:'center'});};
  const clearPreview=()=>{prepared=null;preparedBody='';preview.hidden=true;confirm.hidden=true;prepare.hidden=false;error.hidden=true;};
  const finish=()=>{if(!saving&&!uncertain)root.remove();};root.querySelectorAll('[data-quantity-close]').forEach(button=>button.onclick=finish);root.addEventListener('cancel',event=>{event.preventDefault();finish();});root.addEventListener('close',()=>{if(!saving&&!uncertain)root.remove();});
  const lock=enabled=>root.querySelectorAll('input,select,textarea,button').forEach(element=>element.disabled=enabled);
  const drawMappings=()=>{
   if(!uploaded){mappingHost.hidden=true;return;}
   const names=[...new Set(uploaded.rows.map(row=>row.supplier))];for(const name of names)if(!mapping[name])mapping[name]=suppliers.find(s=>s.name===name)?.id||suppliers.find(s=>s.name===aliases[name])?.id||'';
   mappingHost.innerHTML='<h3>请核对供货商对应关系</h3>'+names.map((name,index)=>'<label>原表：'+escape(name)+(aliases[name]?'（已确认别名）':'')+'<select data-source-supplier="'+index+'" required><option value="">请选择系统中的正确供货商</option>'+suppliers.map(s=>'<option value="'+escape(s.id)+'"'+(mapping[name]===s.id?' selected':'')+'>'+escape(s.name)+'</option>').join('')+'</select></label>').join('');
   mappingHost.querySelectorAll('[data-source-supplier]').forEach(select=>select.onchange=()=>{mapping[names[Number(select.dataset.sourceSupplier)]]=select.value;revision++;clearPreview();});mappingHost.hidden=false;
  };
  field('csvFile').onchange=async()=>{
   const version=++fileRevision;revision++;clearPreview();uploaded=null;mapping=Object.create(null);mappingHost.hidden=true;const file=field('csvFile').files?.[0];if(!file)return;prepare.disabled=true;fileStatus.textContent='正在读取CSV与计算真实文件哈希…';
   try{if(file.size>2*1024*1024)throw Error('CSV超过2MB，请分批保存为UTF-8 CSV。');const bytes=await file.arrayBuffer(),rows=parseCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),digest=await crypto.subtle.digest('SHA-256',bytes);if(version!==fileRevision||!root.isConnected)return;uploaded={name:file.name,sha:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),rows};fileStatus.textContent=file.name+' · '+rows.length+'条 · CSV SHA-256：'+uploaded.sha;drawMappings();prepare.disabled=!suppliers.length;}catch(err){if(version===fileRevision&&root.isConnected){fileStatus.textContent='CSV读取未完成。';showError(err);}}
  };
  const payload=()=>{
   if(!uploaded)throw Error('请先选择并读取UTF-8 CSV文件。');const reason=field('reason').value.trim(),sourceRef=field('sourceRef').value.trim();if(reason.length<4||reason.length>500||!sourceRef)throw Error('请填写来源依据及4至500字的漏录原因。');
   const rows=uploaded.rows.map(row=>{const supplierId=mapping[row.supplier];if(!suppliers.some(s=>s.id===supplierId))throw Error('请为原表供货商“'+row.supplier+'”明确选择正确系统供货商。');return {...row,supplierId};});
   const value={sourceFile:uploaded.name,sourceSHA256:uploaded.sha,sourceSheet:'CSV',sourceRef,reason,warehouseId:field('warehouseId').value,sourceSupplierMap:{...mapping},rows};
   const originalFile=field('originalFile').value.trim(),originalSha=field('originalSha').value.trim(),originalSheet=field('originalSheet').value.trim();if(originalFile||originalSha||originalSheet){if(!originalFile||!/^[a-f0-9]{64}$/i.test(originalSha)||!originalSheet)throw Error('原表证据须填写真实文件名、64位哈希和工作表；未知时请都留空。');value.originalSourceEvidence={sourceFile:originalFile,sourceSHA256:originalSha.toLowerCase(),sourceSheet:originalSheet};}
   return value;
  };
  const drawPreview=result=>{
   const rows=result.rows||[],series=new Map(),bySupplier=new Map();for(const row of rows){const key=row.thirdType||'待核对系列',group=series.get(key)||{rows:0,quantity:0,value:0};group.rows++;group.quantity+=Number(row.quantity||0);group.value+=Number(row.value??Number(row.quantity)*Number(row.unitCost));series.set(key,group);const name=suppliers.find(s=>s.id===row.supplierId)?.name||row.supplier||'待核对',supplier=bySupplier.get(name)||{rows:0,quantity:0,value:0};supplier.rows++;supplier.quantity+=Number(row.quantity||0);supplier.value+=Number(row.value??Number(row.quantity)*Number(row.unitCost));bySupplier.set(name,supplier);}
   const groups=map=>[...map].map(([name,group])=>'<p><strong>'+escape(name)+'</strong> · '+group.rows+'款 · '+group.quantity+'张 · 成本 '+money(group.value)+'</p>').join('');
   preview.innerHTML='<h3>请核对期初商品追加</h3><p><strong>'+escape(result.productCount??rows.length)+'款 · '+escape(result.totalQuantity)+'张 · 成本 '+money(result.totalValue)+'</strong></p><p>新建 '+escape(result.newProducts)+'款 · 追加已有档案 '+escape(result.existingProducts)+'款 · 0数量建档 '+escape(result.zeroQuantityProducts)+'款 · 真实0元成本 '+escape(result.zeroCostQuantity)+'张 · 已提供卖价 '+escape(result.retailPriceProvided||0)+'款</p><p class="inventory-fixed">只追加期初存货，采购、应付与实际收付款均不新增。原表卖价用于新建档案；已有商品如需调价仍走独立审批。未提供的售价和实际进货日期继续待补。</p><h3>按系列核对</h3>'+groups(series)+'<h3>按供货商核对</h3>'+groups(bySupplier)+(result.warnings||[]).map(warning=>'<p class="inventory-warning">'+escape(warning)+'</p>').join('')+'<details><summary>逐行核对（'+rows.length+'条）</summary>'+rows.map(row=>'<article class="inventory-history-record"><strong>'+escape(row.name)+' · '+escape(row.model)+'</strong><p>来源行 '+escape(row.sourceRow)+' · 原编码 '+escape(row.sourceBarcode||'空')+'</p><p>'+escape(suppliers.find(s=>s.id===row.supplierId)?.name||row.supplier)+' · '+escape(row.thirdType)+'</p><p>数量 '+escape(row.quantity)+'张 × 进价 '+money(row.unitCost)+' ＝ '+money(row.value??Number(row.quantity)*Number(row.unitCost))+' · 卖价 '+(row.salePrice==null?'待补':money(row.salePrice))+'</p><p>原库存 '+escape(row.quantityBefore)+' → 追加后 '+escape(row.quantityAfter)+' · '+escape(row.action==='append'?'追加指定档案':'新建档案')+'</p></article>').join('')+'</details>';preview.hidden=false;
  };
  const showAlreadyImported=result=>{
   prepared=null;preparedBody='';confirm.hidden=true;prepare.hidden=true;error.hidden=true;
   const count=result.productCount??result.products?.length??result.rows?.length??'待核对',quantity=result.totalQuantity??result.quantity??'待核对',value=result.totalValue??result.stockValue;
   status.textContent='此来源已录入，本次不增加库存。';
   preview.innerHTML='<h3>此来源已经录入</h3><p class="inventory-fixed">本次库存没有重复增加，可正常关闭。</p><p>'+escape(count)+'款 · '+escape(quantity)+'张 · 成本 '+(value==null?'待核对':money(value))+'</p><p>来源：'+escape(result.sourceFile||uploaded?.name)+'</p><p>批次：'+escape(result.batchId||result.id)+'</p>'+(result.message?'<p>'+escape(result.message)+'</p>':'');preview.hidden=false;preview.scrollIntoView({block:'start'});
  };
  form.addEventListener('input',event=>{if(event.target.type==='file')return;if(!saving&&!uncertain){revision++;clearPreview();}});
  form.onsubmit=async event=>{event.preventDefault();if(saving||uncertain)return;clearPreview();let body;try{body=payload();}catch(err){showError(err);return;}const version=revision;prepare.disabled=true;try{const result=await post('/api/inventory/opening-quantity-append/preview',body);if(!root.isConnected||version!==revision)return;if(result.alreadyImported===true){showAlreadyImported(result);return;}if(!result.previewToken||result.noNewPayments!==true)throw Error('预览未完成，请重新预览后确认。');prepared=result;preparedBody=JSON.stringify(body);drawPreview(result);confirm.hidden=false;prepare.hidden=true;preview.scrollIntoView({block:'start'});}catch(err){if(root.isConnected&&version===revision)showError(err);}finally{if(root.isConnected)prepare.disabled=false;}};
  confirm.onclick=async()=>{if(saving||!prepared?.previewToken)return;let body;try{body=payload();if(JSON.stringify(body)!==preparedBody)throw Error('内容已改变，请重新预览。');}catch(err){clearPreview();showError(err);return;}saving=true;root.dataset.saving='1';lock(true);try{const result=await post('/api/inventory/opening-quantity-append',{...body,previewToken:prepared.previewToken,confirmed:true},attempt);if(result.alreadyImported===true){saving=false;uncertain=false;root.dataset.saving='';lock(false);showAlreadyImported(result);return;}root.remove();try{await loadBasics();if(state.tab==='inventory')await window.InventoryOffice.render();}catch{toast('期初商品追加已保存，列表刷新失败，请点刷新核对。',true);return;}toast(result.message||'期初商品已追加，请核对库存。');window.speakSubmitSuccess?.();}catch(err){saving=false;uncertain=err.uncertain===true;root.dataset.saving=uncertain?'1':'';confirm.disabled=false;if(uncertain){confirm.textContent='重试核对这次追加';showError(err);}else{lock(false);clearPreview();showError(err);}}};
  try{const result=await api('/api/suppliers/directory');if(!root.isConnected)return;suppliers=(Array.isArray(result)?result:result.rows||[]).filter(s=>s.active!==false&&s.status!=='inactive');status.textContent='供货商名单已读取，上传CSV后请核对原名与系统名称。';drawMappings();prepare.disabled=!uploaded||!suppliers.length;}catch(err){if(root.isConnected){status.textContent='供货商读取失败，请关闭后重新打开。';showError(err);}}
 }
 window.InventoryOpeningQuantity={open,parseCsv};
})();
