/* Per-visit observations: optional customer facts, explicit unknown budgets, and viewed products. */
(()=>{
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const bands=[['','请选择预算（必选）'],['unknown','暂未了解，待补'],['none','本次咨询不涉及预算'],['under500','500元以下'],['500to999','500—999元'],['1000to1999','1000—1999元'],['2000to2999','2000—2999元'],['3000to4999','3000—4999元'],['over5000','5000元及以上'],['custom','自填金额或范围']];
 const choices={gender:['未了解','男','女','顾客未说明'],ageBand:['未了解','18岁以下','18—24岁','25—34岁','35—44岁','45—54岁','55—64岁','65岁及以上'],residenceType:['未了解','镇上','村里','外地']};
 const follow=[['unknown','暂未确定，待补'],['yes','需要跟进'],['no','不需要跟进']];
 let products=[],productError='';
 const select=(name,title,values,value,required=false)=>'<label'+(required?' class="required-field"':'')+'><span>'+E(title)+(required?' <b class="required-tag">必填</b>':'')+'</span><select name="'+name+'"'+(required?' required':'')+'>'+values.map(v=>'<option value="'+E(v[0])+'"'+(v[0]===value?' selected':'')+'>'+E(v[1])+'</option>').join('')+'</select></label>';
 const input=(name,title,value='',extra='')=>'<label>'+E(title)+'<input name="'+name+'" value="'+E(value)+'" '+extra+'></label>';
 const localDate=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replace(' ','T'):'';
 function fields(row=null){
  const p=row?.customerProfile||{};
  return '<fieldset class="required-zone"><legend>先填需求和预算</legend><p class="operation-tip" data-page-explanation>蓝色框内填写，红色标记为必填；预算不了解请选择待补。</p><input type="hidden" name="intakeVersion" value="2">'+
   select('needPreset','快捷填写需求（可再补充）',[['','选择常见需求'],...['咨询一般业务','了解宽带办理','咨询手机、比较机型','购买手机','咨询或办理号卡套餐','购买配件','维修或售后','话费充值'].map(x=>[x,x])],'')+
   '<label class="required-field"><span>顾客需求 <b class="required-tag">必填</b></span><textarea name="needs" rows="2" maxlength="1000" required placeholder="例如：给孩子买手机、了解宽带、比较华为与荣耀">'+E(row?.needs||'')+'</textarea></label>'+
   select('budgetBand','预算（必选；未了解到可选待补）',bands,row?(row.budgetBand||'unknown'):'',true)+
   '<div class="grid custom-budget" hidden>'+input('budgetMin','预算下限（元，可留空）',row?.budgetMin??'','type="number" min="0" step="0.01" inputmode="decimal"')+input('budgetMax','预算上限（元，可留空）',row?.budgetMax??'','type="number" min="0" step="0.01" inputmode="decimal"')+'</div>'+
   '</fieldset><fieldset class="follow-zone"><legend>跟进安排</legend>'+select('followUpNeed','是否需要跟进',follow,row?.followUpNeed||'unknown')+
   '<div class="follow-date" hidden>'+input('followUpAt','计划回访时间（选填）',localDate(row?.followUpAt),'type="datetime-local"')+'</div></fieldset>'+
   '<details class="intake-details"><summary>看过哪些商品、什么价位（选填）</summary><div class="intake-content">'+
   '<p class="hint" data-page-explanation>可记多款，也可手工记店外机型；价位没问到就留空。</p>'+input('viewedSearch','搜索商品','', 'type="search" placeholder="名称、型号或编号"')+
   '<label>下拉选择店内商品<select name="viewedSku"><option value="">请选择商品</option></select></label>'+input('viewedName','商品或机型名称','', 'maxlength="150" placeholder="也可手工填写"')+
   input('viewedPrice','当时看的或报价金额（元，选填）','', 'type="number" min="0" step="0.01" inputmode="decimal"')+
   '<button type="button" data-viewed-add>记下这款商品</button><p class="viewed-feedback" role="status"></p><div class="viewed-list"></div><input type="hidden" name="viewedProducts" value="'+E(JSON.stringify(row?.viewedProducts||[]))+'"></div></details>'+
   '<details class="intake-details"><summary>顾客描述、住地（选填，有空再补）</summary><div class="intake-content">'+
   '<p class="operation-tip" data-page-explanation>只记录顾客聊天中自愿提到的情况，不需要一次追问。</p><div class="grid">'+
   Object.entries(choices).map(([key,values])=>select(key,({gender:'性别',ageBand:'年龄段',residenceType:'住地类型'})[key],values.map(x=>[x,x]),p[key]||'未了解')).join('')+
   '<label>职业（可选择，也可填写）<input name="occupation" list="reception-occupations" maxlength="100" value="'+E(p.occupation||'')+'" placeholder="未了解可留空"></label>'+input('town','镇／乡／街道',p.town,'maxlength="100"')+input('village','村／社区',p.village,'maxlength="100"')+'</div>'+input('address','具体地址（自愿告知再填）',p.address,'maxlength="500"')+
   '<label>其他顾客描述<textarea name="description" rows="2" maxlength="2000" placeholder="例如：外地读书、给父母买机、在附近做生意">'+E(p.description||'')+'</textarea></label></div></details>';
 }
 function budget(row){
  if(!row.budgetBand||row.budgetBand==='unknown')return '预算暂未了解';
  if(row.budgetBand==='none')return '不涉及预算';
  if(row.budgetBand==='custom')return row.budgetMin!=null&&row.budgetMax!=null?'预算 '+row.budgetMin+'—'+row.budgetMax+'元':row.budgetMin!=null?'预算至少 '+row.budgetMin+'元':'预算不超过 '+row.budgetMax+'元';
  return '预算 '+(bands.find(x=>x[0]===row.budgetBand)?.[1]||'待补');
 }
 function summary(row){
  const p=row.customerProfile||{},facts=[p.gender,p.ageBand,p.occupation,p.residenceType,[p.town,p.village,p.address].filter(Boolean).join(' '),p.description].filter(x=>x&&x!=='未了解');
  const viewed=(row.viewedProducts||[]).map(x=>E(x.name)+(x.price==null?'（价位未记录）':' · '+E(x.price)+'元'));
  return '<p class="intake-summary">'+E(budget(row))+' · '+E(follow.find(x=>x[0]===row.followUpNeed)?.[1]||'跟进安排待补')+(row.followUpNeed==='yes'&&row.followUpAt?' · 回访 '+E(localDate(row.followUpAt).replace('T',' ')):'')+(row.supplementPending?' · <strong>待补资料</strong>':'')+'</p>'+(facts.length||viewed.length?'<details class="intake-details"><summary>查看顾客描述与看过的商品</summary><div class="intake-content">'+(facts.length?'<p>'+facts.map(E).join(' · ')+'</p>':'')+(viewed.length?'<p>看过：<br>'+viewed.join('<br>')+'</p>':'')+'</div></details>':'');
 }
 function bind(form){
  const el=form.elements;if(!el.budgetBand)return;
  const root=el.budgetBand.closest('form');
  let viewed;try{viewed=JSON.parse(el.viewedProducts.value||'[]');}catch{viewed=[];}
  const sync=()=>{root.querySelector('.custom-budget').hidden=el.budgetBand.value!=='custom';root.querySelector('.follow-date').hidden=el.followUpNeed.value!=='yes';};
  function renderViewed(){el.viewedProducts.value=JSON.stringify(viewed);root.querySelector('.viewed-list').innerHTML=viewed.map((x,i)=>'<div class="viewed-item"><span>'+E(x.name)+' · '+(x.price==null?'价位未了解':E(x.price)+'元')+'</span><button type="button" data-viewed-remove="'+i+'" aria-label="移除'+E(x.name)+'">移除</button></div>').join('');}
  function options(){const q=el.viewedSearch.value.trim().toLowerCase(),selected=el.viewedSku.value;el.viewedSku.innerHTML='<option value="">'+(productError?'店内商品暂未载入，可手工记下':'请选择商品')+'</option>'+products.filter(x=>!q||[x.name,x.externalCode,...(x.aliases||[])].join(' ').toLowerCase().includes(q)||x.skuId===selected).map(x=>'<option value="'+E(x.skuId)+'">'+E(x.name)+' · '+E(x.externalCode||'')+'</option>').join('');el.viewedSku.value=selected;}
  root._intakeOptions=options;
  el.budgetBand.addEventListener('change',sync);el.followUpNeed.addEventListener('change',sync);el.viewedSearch.addEventListener('input',options);
  el.needPreset.addEventListener('change',()=>{if(el.needPreset.value){el.needs.value=el.needs.value.trim()?el.needs.value.trim()+'；'+el.needPreset.value:el.needPreset.value;el.needs.dispatchEvent(new Event('input',{bubbles:true}));}});
  el.viewedSku.addEventListener('change',()=>{const p=products.find(x=>x.skuId===el.viewedSku.value);if(p)el.viewedName.value=p.name;el.viewedPrice.value='';});
  root.querySelector('[data-viewed-add]').addEventListener('click',()=>{const note=root.querySelector('.viewed-feedback'),name=el.viewedName.value.trim(),p=products.find(x=>x.skuId===el.viewedSku.value),raw=el.viewedPrice.value;
   if(!name){note.textContent='请选择或填写商品名称';return;}if(!el.viewedPrice.checkValidity()){note.textContent='请填写正确的非负金额';el.viewedPrice.reportValidity();return;}
   if(viewed.length>=20){note.textContent='最多记录20款商品';return;}
   const price=raw===''?null:Number(raw),skuId=p&&p.name===name?p.skuId:'';
   if(viewed.some(x=>x.name===name&&x.price===price)){note.textContent='这款商品和价位已记下';return;}
   viewed.push({skuId,name,price});renderViewed();note.textContent='✓ 已记下，可继续添加';el.viewedSku.value='';el.viewedName.value='';el.viewedPrice.value='';
  });
  root.querySelector('.viewed-list').addEventListener('click',e=>{const b=e.target.closest('[data-viewed-remove]');if(!b)return;viewed.splice(Number(b.dataset.viewedRemove),1);renderViewed();});
  sync();options();renderViewed();
 }
 function data(form,deferred=false){const raw=Object.fromEntries(new FormData(form));delete raw.needPreset;for(const key of ['viewedSearch','viewedSku','viewedName','viewedPrice'])delete raw[key];raw.intakeVersion=2;if(deferred){raw.deferDetails=true;raw.budgetBand ||= 'unknown';}return raw;}
 function errors(form,deferred=false){
  const issues=[];
  for(const node of form.querySelectorAll('input,select,textarea')){
   if(node.disabled||node.closest('[hidden]')||(deferred&&['needs','budgetBand'].includes(node.name)))continue;
   const invalid=!node.checkValidity()||(node.required&&!node.value.trim());
   node.setAttribute('aria-invalid',String(invalid));
   if(invalid){const title=node.closest('label')?.querySelector('span')?.textContent||node.closest('label')?.childNodes[0]?.textContent||node.name;issues.push({name:node.name,message:title.trim().replace(/必填/g,'')+'：'+(node.validity.valueMissing||!node.value.trim()?'请填写或选择':'请检查格式或金额'),node});}
  }
  return issues;
 }
 function focusIssue(node){const d=node.closest('details');if(d)d.open=true;node.scrollIntoView({behavior:'smooth',block:'center'});node.focus({preventScroll:true});}
 function validate(form,deferred=false){const issues=errors(form,deferred);if(issues.length){focusIssue(issues[0].node);return false;}
  if(form.elements.viewedName?.value.trim()){form.querySelector('[data-viewed-add]').click();if(form.elements.viewedName.value.trim())return false;}
  return true;
 }
 window.ReceptionIntakeUI={fields,bind,data,validate,errors,focusIssue,summary,budget,setProducts(list,error=''){products=Array.isArray(list)?list:[];productError=error;for(const f of document.forms)f._intakeOptions?.();}};
})();
