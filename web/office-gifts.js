
(function(){
  const defaults={maxProfitPercent:20,maxUnitCost:50};
  const rules=()=>state.giftRules||defaults;
  let lastQuote=null,lastKey="",quoteVersion=0;
  const quoteKey=()=>JSON.stringify({items:state.salesCart.map(({name,...row})=>row),gifts:(state.giftCart||[]).map(({name,...row})=>row)});
  const warehouse=(id)=>(state.warehouses||[]).find((row)=>row.id===id&&row.active!==false);
  const stockKey=(skuId,warehouseId)=>JSON.stringify([skuId,warehouseId]);
  const available=()=>{
    const rows=(state.inventory||[]).filter((p)=>p.skuId&&p.active!==false&&p.stockManaged!==false&&warehouse(p.warehouseId)&&Number.isSafeInteger(Number(p.quantity))&&Number(p.quantity)>0);
    const counts=new Map();for(const row of rows){const key=stockKey(row.skuId,row.warehouseId);counts.set(key,(counts.get(key)||0)+1);}
    return rows.filter((row)=>counts.get(stockKey(row.skuId,row.warehouseId))===1);
  };
  const product=(skuId,warehouseId)=>{if(!skuId||!warehouseId)return null;const rows=available().filter((p)=>p.skuId===skuId&&p.warehouseId===warehouseId);return rows.length===1?rows[0]:null;};
  const location=(row)=>warehouse(row.warehouseId)?.name||row.warehouseName||row.warehouseId;
  const reserved=(row,includeDraft)=>includeDraft?[...(state.salesCart||[]),...(state.giftCart||[])].filter((item)=>item.skuId===row.skuId&&item.warehouseId===row.warehouseId).reduce((n,item)=>n+Number(item.quantity||0),0):0;
  const freeQuantity=(row,includeDraft=true)=>Math.max(0,Number(row.quantity)-reserved(row,includeDraft));
  const usedSerials=(includeDraft=true)=>new Set(includeDraft?[...(state.salesCart||[]),...(state.giftCart||[])].map((row)=>row.serialNo).filter(Boolean):[]);
  const estimatedCost=(item)=>{
    const p=product(item.skuId,item.warehouseId);
    if(!p||p.costPrice==null)return null;
    const serial=(p.serials||[]).find((row)=>row.no===item.serialNo);
    return Math.round(Number(serial?.costPrice??p.costPrice)*item.quantity*100)/100;
  };
  async function loadRules(){state.giftRules=await api("/api/gifts/rules");}
  function saleSection(){
    state.giftCart ||= [];
    const current=lastKey===quoteKey()?lastQuote:null;
    const items=state.giftCart.map((item,index)=>'<div class="gift-line"><span>'+E(item.name)+' × '+E(item.quantity)+' · '+E(item.warehouseId?location(item):'出库仓库待选')+(item.serialNo?' · 串码 '+E(item.serialNo):'')+(current?.items[index]?' · 成本 '+M(current.items[index].cost)+'（单件 '+M(current.items[index].unitCost)+'）':' · 成本核算中')+'</span>'+button('移除','gift-remove',index)+'</div>').join('');
    const estimate=current?'<p class="gift-estimate">赠品成本合计 '+M(current.cost)+'；本单累计可赠限额 '+M(current.cap)+'。'+(current.reviewRequired?'超限：'+E(current.reasons.join('；'))+'。随真实销售出库，保留成本预警，提交老板事后对账。':'符合限额，随单出库。')+'</p>':'<p class="gift-estimate" id="gift-quote">'+(state.giftCart.length?'正在核算赠品实际成本…':'选赠品后显示实际成本和对账预警。')+'</p>';
    return '<section class="sale-gifts" id="sale-step-gifts"><div class="sale-step"><span class="sale-step-number">4</span><div><h2>选择赠品（如有）</h2><p data-page-explanation>从店内库存选择，提交时自动扣库并计入本单成本。</p></div></div>'+
      '<p class="muted" data-page-explanation>默认累计成本不超过赠送前毛利 '+E(rules().maxProfitPercent)+'%；单件成本不超过 '+M(rules().maxUnitCost)+'。超限仍按真实商品和仓库出库，保留成本预警交老板事后核对。</p>'+
      '<div class="gift-list">'+(items||'<p class="muted">本单无赠品</p>')+'</div>'+estimate+
      button('＋ 添加赠品','gift-add','','secondary')+
      '<div class="field"><label>赠送说明（可选）</label><input name="giftReason" maxlength="300" value="'+E(state.saleDraft?.giftReason||'')+'" placeholder="例如：随单赠送数据线"></div></section>';
  }
  async function refreshQuote(){
    const panel=document.getElementById('sale-step-gifts');
    if(!panel||!state.giftCart?.length||!state.salesCart?.length)return;
    const key=quoteKey(),version=++quoteVersion;
    try{
      const data=await post('/api/gifts/quote',JSON.parse(key));
      if(version!==quoteVersion||key!==quoteKey()||!panel.isConnected||document.getElementById('sale-step-gifts')!==panel)return;
      lastQuote=data;lastKey=key;
      panel.querySelectorAll('.gift-line').forEach((line,index)=>{
        const item=data.items[index];
        if(!item)return;
        const label=line.querySelector('span');
        const gift=state.giftCart[index];
        label.textContent=gift.name+' × '+gift.quantity+' · '+(item.warehouseName||location(gift))+(gift.serialNo?' · 串码 '+gift.serialNo:'')+' · 成本 '+M(item.cost)+'（单件 '+M(item.unitCost)+'）';
      });
      const note=panel.querySelector('.gift-estimate');
      if(note)note.textContent='赠品成本合计 '+M(data.cost)+'；本单累计可赠限额 '+M(data.cap)+'。'+(data.reviewRequired?'超限：'+data.reasons.join('；')+'。销售单可先保存，赠品待审批后出库。':'符合限额，随单出库。');
    }catch(error){if(version===quoteVersion&&key===quoteKey()&&panel.isConnected&&document.getElementById('sale-step-gifts')===panel){const note=panel.querySelector('.gift-estimate');if(note)note.textContent='赠品成本暂无法核算：'+error.message;}}
  }
  function addGift(orderId=''){
    const includeDraft=!orderId,p=available().filter((row)=>freeQuantity(row,includeDraft)>0);
    if(!p.length)return toast('当前有效仓库没有可赠的可用实物库存，请核对库存及本单已选数量',true);
    const locations=(state.warehouses||[]).filter((row)=>row.active!==false&&p.some((item)=>item.warehouseId===row.id));
    modal(orderId?'补开赠品单':'加入本单赠品',[
      {name:'warehouseId',label:'赠品实际出库仓库',options:[{value:'',label:'请选择出库仓库'},...locations.map((row)=>({value:row.id,label:row.name}))],required:true},
      {name:'giftSearch',label:'快速搜索赠品',type:'search',wide:true,placeholder:'名称 / 型号 / 商品编码 / 条码'},
      {name:'skuId',label:'选择赠品',options:[{value:'',label:'请先选择出库仓库'}],required:true},
      {name:'quantity',label:'数量',type:'number',min:1,step:1,value:1,required:true},
      {name:'serialNo',label:'选择串码',options:[{value:'',label:'请选择串码'}]},
      ...(orderId?[{name:'reason',label:'补赠原因',type:'textarea',wide:true,required:true}]:[])
    ],async(d,write)=>{
      const item=product(d.skuId,d.warehouseId);
      if(!item)throw new Error('赠品已无库存，请重新选择');
      const quantity=Number(d.quantity);
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>freeQuantity(item,includeDraft))throw new Error('赠品数量超过该仓可用库存');
      if(item.trackSerial&&(quantity!==1||!d.serialNo))throw new Error('串码赠品请逐件选择串码');
      if(item.trackSerial&&(!(item.serials||[]).some((row)=>row.no===d.serialNo&&['可售','未激活'].includes(row.status))||usedSerials(includeDraft).has(d.serialNo)))throw new Error('该串码不在所选赠品仓库的可用库存中');
      const line={skuId:item.skuId,name:item.name,warehouseId:item.warehouseId,warehouseName:location(item),quantity,serialNo:item.trackSerial?d.serialNo:''};
      if(orderId)return write('/api/gift-orders',{orderId,items:[line],reason:d.reason});
      state.giftCart ||= [];
      state.giftCart.push(line);
      return true;
    },orderId?'补赠将生成独立赠品单，关联原销售单号；超限时先申请审批，批准后再出库。':'赠品售价为零，但实际成本从本单毛利中扣除。');
    $('modal-root').classList.add('gift-modal');
    const form=$('modal-form');
    const sync=()=>{
      const item=product(form.elements.skuId.value,form.elements.warehouseId.value);
      const serialField=form.elements.serialNo.closest('.field');
      serialField.hidden=!item?.trackSerial;
      form.elements.serialNo.required=!!item?.trackSerial;
      if(item?.trackSerial){
        const used=usedSerials(includeDraft);
        const serials=(item.serials||[]).filter((row)=>['可售','未激活'].includes(row.status)&&!used.has(row.no));
        form.elements.serialNo.innerHTML='<option value="">请选择串码</option>'+serials.map((row)=>option(row.no,row.no)).join('');
        form.elements.quantity.value='1';form.elements.quantity.max='1';
      }else {form.elements.serialNo.innerHTML='<option value="">无需串码</option>';if(item)form.elements.quantity.max=String(freeQuantity(item,includeDraft));else form.elements.quantity.removeAttribute('max');}
    };
    const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
    const filterGifts=(reset=false)=>{const warehouseId=form.elements.warehouseId.value,terms=normalize(form.elements.giftSearch.value).split(/\s+/).filter(Boolean),previous=reset?'':form.elements.skuId.value,previousSerial=form.elements.serialNo.value;const matches=p.filter(row=>row.warehouseId===warehouseId&&freeQuantity(row,includeDraft)>0&&terms.every(term=>normalize([row.name,row.shortName,row.model,row.spec,row.brand,row.externalCode,row.sourceBarcode,row.barcode,row.skuId,...(Array.isArray(row.aliases)?row.aliases:[])].join(' ')).includes(term)));form.elements.skuId.innerHTML='<option value="">'+(!warehouseId?'请先选择出库仓库':matches.length?'请选择该仓赠品':terms.length?'未找到匹配赠品':'该仓暂无可用赠品')+'</option>'+matches.map(row=>option(row.skuId,row.name+' · '+location(row)+' · 可用 '+freeQuantity(row,includeDraft)+' '+(row.unit||'件'))).join('');form.elements.skuId.value=matches.some(row=>row.skuId===previous)?previous:'';sync();if(form.elements.skuId.value===previous&&Array.from(form.elements.serialNo.options).some(row=>row.value===previousSerial))form.elements.serialNo.value=previousSerial;};
    const syncWarehouse=()=>filterGifts(true);
    form.elements.giftSearch.addEventListener('input',()=>filterGifts());
    form.elements.giftSearch.addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();const choices=Array.from(form.elements.skuId.options).filter(row=>row.value);if(choices.length===1){form.elements.skuId.value=choices[0].value;sync();form.elements.quantity.focus();}else form.elements.skuId.focus();});
    form.elements.warehouseId.addEventListener('change',syncWarehouse);
    form.elements.skuId.addEventListener('change',sync);
    syncWarehouse();
  }
  function orderCell(order){
    const gifts=order.giftOrders||[];
    if(!gifts.length)return order.giftApprovalIds?.length?'<span class="muted">赠品待审批 · '+E(order.giftApprovalIds.length)+' 项申请</span>':'<span class="muted">无赠品</span>';
    return gifts.map((gift)=>'<details><summary>'+E(gift.kind)+' · '+E(gift.items.length)+' 项'+' · 成本 '+M(gift.cost)+'</summary><small>赠品单 '+E(documentNo(gift))+' · '+E(displayTime(gift.createdAt))+' · '+E(gift.operator)+'</small><div>'+gift.items.map((item)=>E(item.name)+' × '+E(item.quantity)+(item.warehouseId?' · '+E(location(item)):'')+(item.serialNo?' · '+E(item.serialNo):'')).join('、')+'</div>'+redPacketEntry('giftOrders',gift)+'<small>说明：'+E(gift.reason)+'</small></details>').join('');
  }
  function settings(){
    if(!state.user.capabilities.manageUsers)return;
    const current=rules();
    modal('设置赠品限额',[
      {name:'maxProfitPercent',label:'赠品成本占赠送前毛利上限（%）',type:'number',min:0,step:'0.01',value:current.maxProfitPercent,required:true},
      {name:'maxUnitCost',label:'单件赠品实际成本上限（元）',type:'number',min:0,step:'0.01',value:current.maxUnitCost,required:true}
    ],async(d,write)=>{state.giftRules=await write('/api/gifts/rules',{maxProfitPercent:Number(d.maxProfitPercent),maxUnitCost:Number(d.maxUnitCost)});return true;},'只有老板能修改；新限额立即用于后续赠品单。');
  }
  window.Gifts={loadRules,saleSection,refreshQuote,addGift,orderCell,settings};
})();

