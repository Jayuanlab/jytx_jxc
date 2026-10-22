
(function(){
  const defaults={maxProfitPercent:20,maxUnitCost:50};
  const rules=()=>state.giftRules||defaults;
  let lastQuote=null,lastKey="",quoteVersion=0;
  const quoteKey=()=>JSON.stringify({items:state.salesCart.map(({name,...row})=>row),gifts:(state.giftCart||[]).map(({name,...row})=>row)});
  const available=()=>state.inventory.filter((p)=>p.active!==false&&p.stockManaged!==false&&p.warehouseId==="wh-sale"&&Number(p.quantity||0)>0);
  const product=(skuId)=>available().find((p)=>p.skuId===skuId);
  const estimatedCost=(item)=>{
    const p=product(item.skuId);
    if(!p||p.costPrice==null)return null;
    const serial=(p.serials||[]).find((row)=>row.no===item.serialNo);
    return Math.round(Number(serial?.costPrice??p.costPrice)*item.quantity*100)/100;
  };
  async function loadRules(){state.giftRules=await api("/api/gifts/rules");}
  function saleSection(){
    state.giftCart ||= [];
    const current=lastKey===quoteKey()?lastQuote:null;
    const items=state.giftCart.map((item,index)=>'<div class="gift-line"><span>'+E(item.name)+' × '+E(item.quantity)+(item.serialNo?' · 串码 '+E(item.serialNo):'')+(current?.items[index]?' · 成本 '+M(current.items[index].cost)+'（单件 '+M(current.items[index].unitCost)+'）':' · 成本核算中')+'</span>'+button('移除','gift-remove',index)+'</div>').join('');
    const estimate=current?'<p class="gift-estimate">赠品成本合计 '+M(current.cost)+'；本单累计可赠限额 '+M(current.cap)+'。'+(current.approvalRequired?'超限：'+E(current.reasons.join('；'))+'。提交销售单后将进入老板或授权人审批，赠品暂不出库。':'符合限额，随单出库。')+'</p>':'<p class="gift-estimate" id="gift-quote">'+(state.giftCart.length?'正在核算赠品实际成本…':'选赠品后显示成本与审批状态。')+'</p>';
    return '<section class="sale-gifts" id="sale-step-gifts"><div class="sale-step"><span class="sale-step-number">4</span><div><h2>选择赠品（如有）</h2><p data-page-explanation>从店内库存选择，提交时自动扣库并计入本单成本。</p></div></div>'+
      '<p class="muted" data-page-explanation>默认累计成本不超过赠送前毛利 '+E(rules().maxProfitPercent)+'%；单件成本不超过 '+M(rules().maxUnitCost)+'。超限可先完成开单，赠品待老板或授权人审批后出库。</p>'+
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
        label.textContent=gift.name+' × '+gift.quantity+(gift.serialNo?' · 串码 '+gift.serialNo:'')+' · 成本 '+M(item.cost)+'（单件 '+M(item.unitCost)+'）';
      });
      const note=panel.querySelector('.gift-estimate');
      if(note)note.textContent='赠品成本合计 '+M(data.cost)+'；本单累计可赠限额 '+M(data.cap)+'。'+(data.approvalRequired?'超限：'+data.reasons.join('；')+'。销售单可先保存，赠品待审批后出库。':'符合限额，随单出库。');
    }catch(error){if(version===quoteVersion&&key===quoteKey()&&panel.isConnected&&document.getElementById('sale-step-gifts')===panel){const note=panel.querySelector('.gift-estimate');if(note)note.textContent='赠品成本暂无法核算：'+error.message;}}
  }
  function addGift(orderId=''){
    const p=available();
    if(!p.length)return toast('销售仓没有可赠的实物商品',true);
    modal(orderId?'补开赠品单':'加入本单赠品',[
      {name:'skuId',label:'选择赠品',options:[{value:'',label:'请选择店内商品'},...p.map((row)=>({value:row.skuId,label:row.name+' · 库存 '+row.quantity}))],required:true},
      {name:'quantity',label:'数量',type:'number',min:1,step:1,value:1,required:true},
      {name:'serialNo',label:'选择串码',options:[{value:'',label:'请选择串码'}]},
      ...(orderId?[{name:'reason',label:'补赠原因',type:'textarea',wide:true,required:true}]:[])
    ],async(d,write)=>{
      const item=product(d.skuId);
      if(!item)throw new Error('赠品已无库存，请重新选择');
      const quantity=Number(d.quantity);
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>item.quantity)throw new Error('赠品数量超过可用库存');
      if(item.trackSerial&&(quantity!==1||!d.serialNo))throw new Error('串码赠品请逐件选择串码');
      const line={skuId:item.skuId,name:item.name,quantity,serialNo:item.trackSerial?d.serialNo:''};
      if(orderId)return write('/api/gift-orders',{orderId,items:[line],reason:d.reason});
      state.giftCart ||= [];
      const already=state.giftCart.filter((row)=>row.skuId===item.skuId).reduce((n,row)=>n+row.quantity,0);
      if(already+quantity>item.quantity)throw new Error('本单赠品数量超过库存');
      if(line.serialNo&&state.giftCart.some((row)=>row.serialNo===line.serialNo))throw new Error('该串码已加入本单');
      state.giftCart.push(line);
      return true;
    },orderId?'补赠将生成独立赠品单，关联原销售单号；超限时先申请审批，批准后再出库。':'赠品售价为零，但实际成本从本单毛利中扣除。');
    $('modal-root').classList.add('gift-modal');
    const form=$('modal-form');
    const sync=()=>{
      const item=p.find((row)=>row.skuId===form.elements.skuId.value);
      const serialField=form.elements.serialNo.closest('.field');
      serialField.hidden=!item?.trackSerial;
      form.elements.serialNo.required=!!item?.trackSerial;
      if(item?.trackSerial){
        const used=(state.giftCart||[]).map((row)=>row.serialNo);
        const serials=(item.serials||[]).filter((row)=>['可售','未激活'].includes(row.status)&&!used.includes(row.no));
        form.elements.serialNo.innerHTML='<option value="">请选择串码</option>'+serials.map((row)=>option(row.no,row.no)).join('');
        form.elements.quantity.value='1';form.elements.quantity.max='1';
      }else {form.elements.serialNo.innerHTML='<option value="">无需串码</option>';form.elements.quantity.removeAttribute('max');}
    };
    form.elements.skuId.addEventListener('change',sync);
    sync();
  }
  function orderCell(order){
    const gifts=order.giftOrders||[];
    if(!gifts.length)return order.giftApprovalIds?.length?'<span class="muted">赠品待审批 · '+E(order.giftApprovalIds.length)+' 项申请</span>':'<span class="muted">无赠品</span>';
    return gifts.map((gift)=>'<details><summary>'+E(gift.kind)+' · '+E(gift.items.length)+' 项'+' · 成本 '+M(gift.cost)+'</summary><small>赠品单 '+E(documentNo(gift))+' · '+E(displayTime(gift.createdAt))+' · '+E(gift.operator)+'</small><div>'+gift.items.map((item)=>E(item.name)+' × '+E(item.quantity)+(item.serialNo?' · '+E(item.serialNo):'')).join('、')+'</div>'+redPacketEntry('giftOrders',gift)+'<small>说明：'+E(gift.reason)+'</small></details>').join('');
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

