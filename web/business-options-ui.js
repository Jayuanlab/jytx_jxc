(() => {
 'use strict';
 let active=null,styleReady=null;
 const labels={type:'业务类型',subType:'业务细类',receptionSource:'接待来源',receptionPurpose:'接待来意'};
 const baseLabels={card:'号卡',recharge:'充值',broadband:'宽带',package:'套餐',contract:'设备绑合约',other:'其他业务（仅分月酬金）'};
 const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
 function ready(){if(styleReady)return styleReady;styleReady=new Promise((resolve,reject)=>{let link=document.querySelector('link[data-business-options-style]');if(link?.sheet)return resolve();if(!link){link=document.createElement('link');link.rel='stylesheet';link.href='/business-options-ui.css';link.dataset.businessOptionsStyle='1';document.head.append(link);}link.addEventListener('load',resolve,{once:true});link.addEventListener('error',()=>{styleReady=null;link.remove();reject(new Error('新增选项样式未加载，请重试'));},{once:true});});return styleReady;}
 async function read(){const r=await fetch('/api/carrier-business-options',{credentials:'same-origin'}),d=await r.json();if(!r.ok)throw new Error(d.error?.message||'选项读取失败，请稍后重试');return d;}
 async function open({kind,options,parentId='',onSaved,isCurrent=()=>true}){
  if(active?.open){active.focus();return false;}
  if(!labels[kind])throw new Error('此项目不能新增选项');
  const allowed=kind.startsWith('reception')?options?.canCreateReception:options?.canCreate;
  if(!allowed)throw new Error('当前账号没有新增此选项的权限');
  const parent=kind==='subType'?options.types?.find(x=>x.id===parentId):null;
  if(kind==='subType'&&!parent)throw new Error('请先选择所属业务类型');
  await ready();if(!isCurrent())return false;if(active?.open){active.focus();return false;}
  const dialog=document.createElement('dialog');dialog.className='business-option-dialog';dialog.id='business-option-editor';dialog.setAttribute('aria-label','新增'+labels[kind]);
  const form=document.createElement('form'),heading=text('h2','新增'+labels[kind]),nameLabel=text('label','名称'),name=document.createElement('input');name.name='name';name.required=true;name.maxLength=40;name.autocomplete='off';nameLabel.append(name);form.append(heading,nameLabel);
  let basis=null;
  if(kind==='type'){
   const label=text('label','所属业务');basis=document.createElement('select');basis.name='baseType';
   for(const row of options.baseTypes||[])basis.append(new Option(baseLabels[row.id]||row.name,row.id));
   if([...basis.options].some(x=>x.value==='other'))basis.value='other';label.append(basis);form.append(label,text('p','选最接近的业务；不确定时选其他业务。'));
  }else if(kind==='subType'){
   form.append(text('p','所属类型：'+parent.name));const label=text('label','细类归属');basis=document.createElement('select');basis.name='baseSubType';basis.append(new Option('未分类／待核对','unknown'));
   for(const row of options.baseSubTypes?.[parent.baseType||parent.id]||[])if(row.id!=='unknown')basis.append(new Option(row.name,row.id));label.append(basis);form.append(label,text('p','不确定时保留未分类，由管理员后续核对。'));
  }
  form.append(text('p','保存后全店可选择；新选项会通知管理员核对，当前表单保留。'));
  const error=text('p','');error.className='business-option-error';error.setAttribute('role','alert');form.append(error);
  const actions=document.createElement('div');actions.className='business-option-actions';const cancel=text('button','取消'),save=text('button','保存并选中');cancel.type='button';save.type='submit';actions.append(cancel,save);form.append(actions);dialog.append(form);document.body.append(dialog);active=dialog;
  let busy=false,uncertain=false,key='',body='';
  const close=()=>{if(busy||uncertain){error.textContent='正在保存或结果待核对，请先按原内容重试。';return;}dialog.close();};
  cancel.addEventListener('click',close);dialog.addEventListener('cancel',e=>{if(busy||uncertain){e.preventDefault();error.textContent='保存结果待核对，请先按原内容重试。';}});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
  dialog.addEventListener('close',()=>{if(active===dialog)active=null;dialog.remove();});
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy||!isCurrent())return;if(!uncertain&&!form.reportValidity())return;
   if(!uncertain){const value=name.value.trim();if(!value){error.textContent='请填写名称';name.focus();return;}const payload={kind,name:value,...(kind==='type'?{baseType:basis.value}:kind==='subType'?{parentId,baseSubType:basis.value}:{})};body=JSON.stringify(payload);key=crypto.randomUUID();}
   busy=true;name.disabled=true;if(basis)basis.disabled=true;save.disabled=true;cancel.disabled=true;error.textContent='';save.textContent='正在保存…';let result;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
   try{
    let r;try{r=await fetch('/api/carrier-business-options',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':key},body,signal:controller.signal});result=await r.json();}catch{uncertain=true;throw new Error('未收到完整保存结果，请保留原名称重试，不要另建一项。');}
    if(!r.ok){uncertain=r.status>=500;throw new Error(result.error?.message||'选项保存失败');}
    if(!result?.option||typeof result.option.id!=='string'||typeof result.option.name!=='string'||!result.options){uncertain=true;throw new Error('保存结果未识别，请按原内容重试。');}
    uncertain=false;busy=false;dialog.close();if(isCurrent())await onSaved?.(result.option,result.options);
   }catch(err){if(dialog.isConnected)error.textContent=(uncertain?'结果待核对：':'')+err.message;}
   finally{clearTimeout(timer);busy=false;if(dialog.isConnected){save.disabled=false;cancel.disabled=uncertain;name.disabled=uncertain;if(basis)basis.disabled=uncertain;save.textContent=uncertain?'按原内容重试':'保存并选中';}}
  });
  dialog.showModal();name.focus();return true;
 }
 window.BusinessOptionsUI={ready,read,open};
})();
