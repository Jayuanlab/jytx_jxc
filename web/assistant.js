const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
'use strict';
// Layout only: each assistant keeps its own conversations and permissions.
window.ChatWindow = {
 mount({input,thread,toggle,panel,dock}) {
  const resizeInput=()=>{input.style.height='auto';input.style.height=Math.min(184,Math.max(64,input.scrollHeight+4))+'px';};
  const scroll=(force=true)=>{if(force)requestAnimationFrame(()=>thread.scrollTo({top:thread.scrollHeight,behavior:'auto'}));};
  const menu=(open=panel.hidden)=>{panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'收起功能':'更多功能');toggle.textContent=open?'×':'＋';};
  toggle.onclick=()=>menu();
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){menu(false);toggle.focus();}});
  input.addEventListener('input',resizeInput);
  input.addEventListener('focus',()=>menu(false));
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();input.form?.requestSubmit();}});
  const viewport=()=>{const v=window.visualViewport;document.documentElement.style.setProperty('--chat-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--chat-top',(v?.offsetTop||0)+'px');};
  window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);
  if(window.ResizeObserver)new ResizeObserver(()=>document.documentElement.style.setProperty('--chat-dock-height',dock.offsetHeight+'px')).observe(dock);
  viewport();resizeInput();return {resizeInput,scroll,menu};
 }
};

const assistantEmbedded=new URLSearchParams(location.search).has('embedded');let assistantVisible=!assistantEmbedded;
if(assistantEmbedded)document.documentElement.classList.add('assistant-embedded');
const $=id=>document.getElementById(id);let assistantBranchId='',assistantOrganizationReady=false,me,draft,pendingAction,conversationContext=null,pausedSaleFlow=null,displayedReply=null,inlineDialogue=null,inlineReplyStyle='sichuan';
const workChat=ChatWindow.mount({input:$('question'),thread:$('work-thread'),toggle:$('work-more-toggle'),panel:$('work-more-panel'),dock:$('work-dock')});
let chatPending=false;
function beginChatTurn(question){
 if(chatPending&&$('current-question').textContent===question)return;
 if(!chatPending&&!$('result').hidden&&$('current-question').textContent){
  for(const [value,self]of [[$('current-question').textContent,true],[$('answer').value,false]]){
   const line=document.createElement('p');line.className='chat-history-bubble'+(self?' self':'');line.textContent=value;$('chat-history').append(line);
  }
  while($('chat-history').children.length>80)$('chat-history').firstElementChild.remove();
 }
 $('answer-details').open=false;chatPending=true;$('current-question').hidden=false;$('current-question').querySelector('p').textContent=question;workChat.menu(false);workChat.scroll();
}
function finishChatTurn(){
 chatPending=false;if(!inlineDialogue)$('question').value='';
 workChat.resizeInput();
 requestAnimationFrame(()=>{const thread=$('work-thread'),question=$('current-question'),latestHeight=question.getBoundingClientRect().height+$('result').getBoundingClientRect().height+54;
  if(latestHeight<=thread.clientHeight)workChat.scroll();else thread.scrollTo({top:Math.max(0,thread.scrollTop+question.getBoundingClientRect().top-thread.getBoundingClientRect().top-16),behavior:'auto'});});

}
function resetChatWindow(){
 chatPending=false;$('chat-history').replaceChildren();$('current-question').hidden=true;$('current-question').querySelector('p').textContent='';workChat.menu(false);workChat.resizeInput();
}
function requestId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const b=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(b);else for(let i=0;i<16;i++)b[i]=Math.random()*256;return 'req-'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
async function api(path,body,key){const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','Idempotency-Key':key||requestId()}:undefined,body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401)location.href='/login?next=/assistant';const error=Error(d.error?.message||'请求失败');error.statusCode=r.status;throw error}return d}
const time=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
const navigate=href=>{if(window.top&&window.top!==window)window.top.location.href=href;else location.href=href};
const modeKey='erp-assistant-mode-v1';let assistantMode='store',modeEpoch=0,queryVersion=0;const modeParams=new URLSearchParams(location.search);let customerLocked=modeParams.get('locked')==='1'||location.pathname==='/kitty';
try{assistantMode=modeParams.get('mode')||'store'}catch{}
if(customerLocked)assistantMode='customer';if(!['store','customer'].includes(assistantMode))assistantMode='store';
const customerReplyStyleKey='erp-assistant-customer-reply-style-v1';
const replyStyle=value=>value==='mandarin'?'mandarin':'sichuan';
let customerReplyStyle='sichuan',answerReplyStyle='mandarin';
try{const stored=window.localStorage?.getItem(customerReplyStyleKey);if(['sichuan','mandarin'].includes(stored))customerReplyStyle=stored}catch{}
$('customer-reply-style').value=customerReplyStyle;
$('customer-reply-style').onchange=()=>{customerReplyStyle=replyStyle($('customer-reply-style').value);$('customer-reply-style').value=customerReplyStyle;try{window.localStorage?.setItem(customerReplyStyleKey,customerReplyStyle)}catch{}};
const synth=window.speechSynthesis;
const ttsSupported=!!(synth&&window.SpeechSynthesisUtterance);
let speaking=false,speechVersion=0;
let voiceSession=false,voicePaused=false,voiceBusy=false,activeRecognition=null,voiceRestartTimer=null,voiceFlushTimer=null,voiceBuffer="",voiceInterim="";
function setSpeechButtons(){const hasAnswer=!$('result').hidden&&!inlineDialogue;$('read-answer').disabled=!ttsSupported||!hasAnswer;$('stop-voice').disabled=!speaking;$('auto-voice').disabled=!ttsSupported}
function stopSpeech(){speechVersion++;if(ttsSupported)synth.cancel();speaking=false;setSpeechButtons()}
function speechChunks(value){const spoken=String(value||'').replace(/^\s*接话参考\s*[：:]\s*/,'');const pieces=spoken.match(/[^。！？；]+[。！？；]?/g)||[];const chunks=[];for(const piece of pieces){for(let i=0;i<piece.length;i+=100)chunks.push(piece.slice(i,i+100))}return chunks}
function speechVoice(style){
  let voices=[];try{voices=synth.getVoices()}catch{return undefined}
  if(style==='sichuan'){const dialect=voices.find(voice=>/(?:sichuan|chongqing|四川|重庆)/i.test([voice.name,voice.lang].join(' ')));if(dialect)return dialect}
  return voices.find(voice=>/^zh(-|_)/i.test(voice.lang));
}
function readAnswer(value,style=answerReplyStyle){
  if(!assistantVisible)return;
  pauseVoiceCapture();
  if(!ttsSupported){$('status').textContent='这个浏览器不支持语音播报，可查看文字回答';resumeVoiceCapture();return}
  stopSpeech();const chunks=speechChunks(value);if(!chunks.length){resumeVoiceCapture();return}
  let index=0;speaking=true;const version=speechVersion;setSpeechButtons();
  const next=()=>{if(!speaking||version!==speechVersion)return;if(index>=chunks.length){speaking=false;setSpeechButtons();resumeVoiceCapture();return}
    const utterance=new SpeechSynthesisUtterance(chunks[index++]);utterance.lang='zh-CN';utterance.rate=0.92;const voice=speechVoice(style);if(voice)utterance.voice=voice;
    utterance.onend=next;utterance.onerror=()=>{if(version!==speechVersion)return;speaking=false;setSpeechButtons();$('status').textContent='文字查询成功；语音播放失败，可点“重听回答”重试';resumeVoiceCapture()};synth.speak(utterance)};
  next();
}
$('read-answer').onclick=()=>{if(!inlineDialogue)readAnswer(displayedReply?.data.answer||$('answer').value)};
$('stop-voice').onclick=()=>{stopSpeech();resumeVoiceCapture()};
$('auto-voice').onchange=()=>{if(!$('auto-voice').checked){stopSpeech();resumeVoiceCapture()}};
setSpeechButtons();

function spokenDigits(value){const digits={'零':'0','〇':'0','○':'0','一':'1',二:'2',两:'2',三:'3',四:'4',五:'5',六:'6',七:'7',八:'8',九:'9',幺:'1'};return String(value||'').replace(/[零〇○一二两三四五六七八九幺]/g,ch=>digits[ch])}
function accessoryDecision(value){const q=String(value||'').replace(/[\s，,。.!！?？]/g,'');if(/^(?:没有|无|不用|不送|否|不需要|没有附件|没附件|不带附件|不要附件|不需要附件|无附件|没有赠品|无赠品)$/.test(q))return 'no';if(/^(?:有|要|送|是|需要|有附件|要附件|带附件|附件|赠品|正品|有赠品|有正品)$/.test(q))return 'yes';return null}

let saleFlow=null,lastAssistantQuestion="",saleSubmitting=false;
const pendingSaleKey='erp-assistant-pending-sale-v1';
const saleLabels={serial:'商品 / 串号',price:'售价',customerName:'顾客姓名',customerPhone:'顾客手机号',gift:'附件',payment:'付款方式',invoiceNo:'发票号',orderNote:'备注'};
const paymentChoices=()=>window.AssistantSaleInput.accounts.map(value=>({label:value,value}));
function saleButton(label,click){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=click;return button}
function salePending(f){return ['serial','price'].filter(key=>key==='serial'?!f.product||!f.serialNo:key==='price'?!Number.isFinite(f.salePrice)||f.salePrice<=0:!f.account)}
function saleEditable(){if(saleSubmitting||saleFlow?.submission){$('status').textContent='这张单正在确认提交结果，请先重试确认结果。';return false}return true}
function renderSaleWorkspace(){
  syncReplyBox();const box=$('sale-workspace'),wasOpen=!!box.querySelector('details[open]');box.replaceChildren();box.hidden=assistantMode!=='store'||!saleFlow||['booking','product'].includes(saleFlow.stage);if(box.hidden)return;
  const f=saleFlow,locked=!!f.submission||saleSubmitting||!!inlineDialogue;
  const optional=document.createElement('details'),summary=document.createElement('summary');summary.textContent='补充资料 / 附件';optional.open=wasOpen;optional.append(summary);
  const field=(key,type='text')=>{
    const form=document.createElement('form');form.className='sale-field-editor';const label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button');
    input.id='sale-edit-'+key;input.type=type;input.value=key==='serial'?f.serialNo||'':key==='price'?f.salePrice??'':f[key]||'';input.disabled=locked;
    label.htmlFor=input.id;label.textContent=saleLabels[key];button.type='submit';button.textContent='应用';button.disabled=locked;
    if(key==='serial'){input.required=true;input.maxLength=40;input.placeholder='串号后四位或完整串号';}
    else if(key==='price'){input.required=true;input.min='0.01';input.step='0.01';input.inputMode='decimal';input.placeholder='本单成交价';}
    else if(key==='customerPhone'){input.inputMode='tel';input.maxLength=11;input.pattern='1[0-9]{10}';input.placeholder='选填';}
    else{input.maxLength=key==='orderNote'?500:key==='invoiceNo'?100:60;input.placeholder='选填';}
    const row=document.createElement('div');row.className='sale-field-edit-row';row.append(input,button);form.append(label,row);
    form.onsubmit=event=>{event.preventDefault();if(saleFlow!==f||!saleEditable()||inlineDialogue)return;f.stage=key;const value=input.value.trim();
      if(!value&&!['serial','price'].includes(key)){f[key]='';delete f.issues[key];f.revision++;continueSale(f);return;}
      advanceSale(key==='serial'?'串号'+value:key==='price'?'售价'+value+'元':key==='customerName'?'姓名'+value:key==='customerPhone'?'手机号'+value:value);
    };
    if(['serial','price'].includes(key)&&salePending(f).includes(key))form.classList.add('sale-missing');return form;
  };
  if(f.product){const title=document.createElement('strong');title.textContent=f.product.name;box.append(title);}
  box.append(field('serial'),field('price','number'));
  const payLabel=document.createElement('label');payLabel.htmlFor='sale-edit-account';payLabel.textContent='付款方式';const select=document.createElement('select');select.id='sale-edit-account';select.disabled=locked;
  const unset=document.createElement('option');unset.value='';unset.textContent='确认时选择';select.append(unset);
  for(const account of window.AssistantSaleInput.accounts){const option=document.createElement('option');option.value=account;option.textContent=account;select.append(option);}select.value=f.account||'';
  select.onchange=()=>{if(saleFlow!==f||!saleEditable()||inlineDialogue)return;f.account=select.value||undefined;delete f.issues.account;f.revision++;continueSale(f);};
  box.append(payLabel,select);
  for(const key of ['customerName','customerPhone','invoiceNo','orderNote'])optional.append(field(key,key==='customerPhone'?'tel':'text'));
  const gift=saleButton('附件：'+(f.gifts?.length?f.gifts.map(x=>x.product.name+' × '+x.quantity).join('；'):f.giftRequests?.length?'待选择具体附件':'选填'),()=>focusSaleField('gift'));gift.className='sale-field';gift.disabled=locked;optional.append(gift);box.append(optional);
}
function syncReplyBox(){
 const input=$('assistant-reply-text');input.placeholder=saleFlow?.stage==='price'?'输入售价':saleFlow?.stage==='serial'?'输入串号': '输入回复';
 input.disabled=!!saleFlow?.submission||saleSubmitting;$('assistant-reply-send').disabled=input.disabled;
}
function flowAnswer(message, choices=[]){
  resetAnswerEditor();answerReplyStyle='mandarin';stopSpeech();pauseVoiceCapture();draft=null;pendingAction=null;
  $('result').hidden=false;$('draft').hidden=true;$('action').hidden=true;$('teach-this').hidden=true;
  $('answer').value=message;setAnswerEditable({answer:message,metrics:{kind:'assistant-sale-flow',flowStage:saleFlow?.stage||'inventory-check'}},lastAssistantQuestion||$('question').value.trim(),conversationContext);
  $('basis').textContent='销售草稿 · 尚未入账';$('sources').replaceChildren();renderEvidence({});$('followups').replaceChildren();$('flow-choices').replaceChildren();
  for(const item of choices)$('flow-choices').append(saleButton(item.label,()=>item.run?item.run():advanceSale(item.value)));
  renderSaleWorkspace();syncReplyBox();$('status').textContent='可一次说完，也可随时补充或修改';showConversationPair();setSpeechButtons();
}
function saleCandidates(rows,request){return window.AssistantSaleInput.candidates(rows,request)}
function saleDraftValue(f){return {skuId:f.product.skuId,productName:f.product.name,serialNo:f.serialNo,quantity:1,referencePrice:Number(f.product.salePrice||0),salePrice:f.salePrice,customerName:f.customerName||'',customerPhone:f.customerPhone||'',giftRequested:f.giftRequested||'',account:f.account,trackSerial:true}}
function focusSaleField(key){
  if(!saleFlow||!saleEditable())return;const f=saleFlow;f.stage=key;
  const prompts={serial:'请提供串号后四位，或扫码、输入完整串号。',price:'本单售价多少？',customerName:'顾客姓名（可跳过）。',customerPhone:'顾客手机号（可跳过）。',gift:'请说附件名称和数量，或选择无附件。',payment:'请确认付款方式；收款证据仍由实际收款人核对。',invoiceNo:'请填写发票号，可跳过。',orderNote:'请填写备注，可跳过。'};
  if(key==='gift')f.resolveGiftNow=true;
  const choices=key==='payment'?paymentChoices():key==='price'&&Number(f.product?.salePrice)>0?[{label:'按零售价 '+f.product.salePrice+' 元',value:'按零售价'}]:key==='gift'?[{label:'无附件',value:'没有附件'}]:[];
  choices.push({label:'先跳过',value:'先跳过'});flowAnswer(prompts[key],choices);
}
function continueSale(f){
  if(saleFlow!==f)return;
  const issue=Object.entries(f.issues||{})[0];
  if(issue){f.stage=issue[0]==='salePrice'?'price':issue[0]==='account'?'payment':issue[0];flowAnswer(issue[1],[{label:'重新填写',run:()=>focusSaleField(f.stage)}]);return}
  if(f.pendingSerial?.length){f.stage='choose';flowAnswer('串号后四位重复，请选择准确的手机。',f.pendingSerial.map((m,i)=>({label:m.p.name+' · '+m.serialNo,run:()=>{if(!saleEditable())return;selectSaleSerial(f,m)}})));return}
  if(f.giftRequests?.length>0&&f.gifts?.filter(Boolean).length!==f.giftRequests.length){resolveSaleGifts(f);return}
  const missing=salePending(f),next=missing.find(key=>!f.deferred.includes(key));
  if(next){focusSaleField(next);return}
  if(missing.length){f.stage='pending';flowAnswer('已保留填写内容。提交前还需：'+missing.map(x=>saleLabels[x]).join('、')+'。',missing.map(key=>({label:'补充'+saleLabels[key],run:()=>focusSaleField(key)})));return}
  saleReview(f);
}
function selectSaleSerial(f,match){rememberSaleSerial(match.serialNo);f.product=match.p;f.serialNo=match.serialNo;f.pendingSerial=null;delete f.issues.serial;f.deferred=f.deferred.filter(x=>x!=='serial');continueSale(f)}
function resolveSaleGifts(f){
  f.gifts ||= [];
  for(let index=0;index<f.giftRequests.length;index++){
    if(f.gifts[index])continue;const request=f.giftRequests[index],candidates=window.AssistantSaleInput.giftCandidates(f.allRows,request.name);
    if(!Number.isInteger(request.quantity)||request.quantity<1||request.quantity>999){f.supplement ||= [];f.supplement.push('附件数量待核对：'+f.giftRequested);f.giftRequests=[];f.gifts=[];continueSale(f);return}
    const choose=product=>{
      if(!saleEditable())return;if(product.trackSerial){
        f.stage='gift';flowAnswer('这件附件需要串号，请选择准确的一件。',(product.serials||[]).filter(s=>['可售','未激活'].includes(s.status)).map(s=>({label:product.name+' · '+s.no,run:()=>{if(!saleEditable())return;f.gifts[index]={product,quantity:request.quantity,serialNo:s.no};continueSale(f)}})));return
      }
      f.gifts[index]={product,quantity:request.quantity,serialNo:''};continueSale(f);
    };
    if(candidates.length===1&&candidates[0].quantity>=request.quantity){choose(candidates[0]);return}
    if(!f.resolveGiftNow){f.supplement ||= [];f.supplement.push('待补赠附件：'+f.giftRequested);f.giftRequests=[];f.gifts=[];continueSale(f);return}
    f.stage='gift';
    const choices=candidates.filter(x=>x.quantity>=request.quantity).slice(0,12).map(p=>({label:p.name+' · '+(p.warehouseName||p.warehouseId),run:()=>choose(p)}));
    choices.push({label:'先开单，附件后补',run:()=>{if(!saleEditable())return;f.supplement ||= [];f.supplement.push('待补赠附件：'+f.giftRequested);f.giftRequests=[];f.gifts=[];delete f.issues.gift;continueSale(f)}},{label:'无附件',value:'没有附件'});
    flowAnswer(candidates.length?'请选择“'+request.name+'”对应的附件商品。':'“'+request.name+'”没有匹配到足量库存，请补充准确名称，或改为无附件。',choices);return;
  }
  continueSale(f);
}
function rememberSaleSerial(value){
 if(assistantMode!=='store'||!me)return;
 const token=window.AssistantSaleInput.serialToken(value);if(!token)return;
 conversationContext={question:'串号 '+token,userId:me.id,at:Date.now(),mode:'store',branchId:assistantBranchId,serialToken:token};
}
function prepareWorkDocument(kind){
 if(assistantMode!=='store'||!me||!saleEditable())return;
 if(inlineDialogue||answerEditLoad){$('status').textContent='请先保存或取消正在修改的问答。';return}
 if(kind==='sale'&&!me.capabilities.sell){$('status').textContent='当前岗位没有销售开单权限。';return}
 if(kind==='sale'&&saleFlow){$('status').textContent='这张销售草稿还在，请继续补充所需信息。';$('question').focus();return}
 if(kind==='sale'&&pausedSaleFlow){resumeSale();$('question').focus();return}
 ask(kind==='sale'?'帮我开手机销售单':'准备接待单');$('question').focus();
}
function mergeSaleInput(f,q){
  const parsed=window.AssistantSaleInput.analyze(q,f.stage),previousStage=f.stage;f.revision++;
  for(const [key,value]of Object.entries(parsed.facts)){f[key]=value;if(key==='customerPhone')f.supplement=(f.supplement||[]).filter(x=>!x.startsWith('手机号待补：'));delete f.issues[key];f.deferred=f.deferred.filter(x=>x!==(key==='salePrice'?'price':key==='account'?'payment':key))}
  for(const [key,value]of Object.entries(parsed.issues)){if(key==='customerPhone'){f.customerPhone='';f.supplement ||= [];f.supplement.push('手机号待补：'+q);continue}f.issues[key]=value;delete f[key==='serial'?'serialNo':key];if(key==='serial'){f.product=null;f.pendingSerial=null}}
  if(parsed.giftRequests!==undefined){f.supplement=(f.supplement||[]).filter(x=>!x.startsWith('待补赠附件：'));f.giftRequests=parsed.giftRequests;f.gifts=[];delete f.issues.gift}
  if(previousStage==='gift'&&parsed.giftRequests===undefined&&!parsed.serialToken&&!Object.keys(parsed.facts).length&&!Object.keys(parsed.issues).length){
    const decision=accessoryDecision(q);if(decision==='no'){f.giftRequests=[];f.gifts=[];f.giftRequested='';delete f.issues.gift}
    else if(decision==='yes'){f.issues.gift='请补充附件名称和数量。'}
    else{f.giftRequests=[{name:q,quantity:1}];f.gifts=[];f.giftRequested=q;delete f.issues.gift}
  }
  if(previousStage==='price'&&/^(按零售价|用零售价|原价|不改价)[。！!？?]*$/.test(q)&&Number(f.product?.salePrice)>0){f.salePrice=Number(f.product.salePrice);delete f.issues.salePrice}
  if(['invoiceNo','orderNote'].includes(previousStage)&&!Object.keys(parsed.facts).length&&!parsed.serialToken){f[previousStage]=q.slice(0,previousStage==='invoiceNo'?100:500)}
  const brand=/华为|荣耀|OPPO|vivo|苹果|iPhone|小米|红米|三星|一加|realme|魅族|中兴|努比亚/i.test(q);
  if(brand){const rows=saleCandidates(f.allRows,q);f.rows=rows;if(f.product&&!rows.some(p=>p.skuId===f.product.skuId&&p.warehouseId===f.product.warehouseId)){f.product=null;f.serialNo='';f.pendingSerial=null}if(!rows.length)f.issues.serial='没有匹配到该型号的可售手机，请核对商品型号。';else delete f.issues.serial}
  if(parsed.serialToken){rememberSaleSerial(parsed.serialToken);const {matches}=window.AssistantSaleInput.serialMatches(f.rows,parsed.serialToken);f.pendingSerial=null;f.product=null;f.serialNo='';
    if(matches.length===1){f.product=matches[0].p;f.serialNo=matches[0].serialNo;delete f.issues.serial}
    else if(matches.length>1){f.pendingSerial=matches;delete f.issues.serial}
    else f.issues.serial='没有找到串号 '+parsed.serialToken+' 的可售手机，请核对型号和串号。';
  }
  return parsed;
}
async function startSaleFlow(request,reservation=false,candidateSkuIds){
  const epoch=modeEpoch,version=queryVersion,current=()=>assistantMode==='store'&&epoch===modeEpoch&&version===queryVersion;
  if(!current())return;
  rememberSaleSerial(window.AssistantSaleInput.analyze(request).serialToken);
  if(reservation){saleFlow={stage:'booking',request,candidateSkuIds};flowAnswer('是已成交取机，还是仅预订？',[{label:'已成交，开销售单',value:'已成交'},{label:'仅预订，记跟进单',value:'只是预订'}]);return}
  voiceBusy=true;pauseVoiceCapture();$('status').textContent='正在核对库存与串号…';
  try{
    const rows=await api('/api/inventory');if(!current())return;
    const candidates=saleCandidates(Array.isArray(candidateSkuIds)&&candidateSkuIds.length?rows.filter(p=>candidateSkuIds.includes(p.skuId)):rows,request);
    if(!candidates.length){saleFlow=null;flowAnswer('没有找到这款手机的可售库存，请核对型号。',[{label:'打开完整销售单',value:'open-sale'}]);return}
    if(/(?:[2-9]|\d{2,}|两|二|三|四|五|六|七|八|九|十)\s*台/.test(request)){saleFlow=null;flowAnswer('多台手机请在完整销售单逐台核对串号。',[{label:'打开完整销售单',value:'open-sale'}]);return}
    saleFlow={stage:'serial',request,rows:candidates,allRows:rows,issues:{},deferred:[],gifts:[],giftRequests:[],revision:0};
    mergeSaleInput(saleFlow,request);continueSale(saleFlow);showConversationPair();
  }catch(error){if(current()){saleFlow=null;flowAnswer('库存核对失败：'+error.message)}}
  finally{if(current())voiceBusy=false}
}
function advanceSale(raw){
 beginChatTurn(String(raw).trim());
  if(assistantMode!=='store')return;if(raw==='open-sale'){navigate('/app?tab=sales');return}
  const q=String(raw||'').trim();lastAssistantQuestion=q;if(!saleFlow||!saleEditable())return;const f=saleFlow;
  if(/^(取消|取消开单|退出开单|重新开始)[。！!？?]*$/.test(q)){queryVersion++;saleFlow=null;flowAnswer('草稿已取消，没有入账。');return}
  if(f.stage==='product'){saleFlow=null;ask(f.request.replace(/[。！!？?]+$/,'')+' '+q);return}
  if(f.stage==='booking'){
    if(/^(已成交|成交了|已付款|已经付款|已交付|已取机|确认成交)/.test(q)){saleFlow=null;queryVersion++;startSaleFlow(f.request+'，'+q,false,f.candidateSkuIds);return}
    if(/^(只是预订|仅预订|预订|未成交|还没成交|尚未成交)/.test(q)){sessionStorage.setItem('erp-reception-draft-after-login-v1',JSON.stringify({phone:'',name:'',source:'到店',purpose:'购买手机',needs:f.request}));saleFlow=null;navigate('/receptions');return}
    flowAnswer('请确认：已成交还是仅预订？',[{label:'已成交',value:'已成交'},{label:'仅预订',value:'只是预订'}]);return;
  }
  if(/^(?:先)?跳过[。！!？?]*$/.test(q)){
    const key=f.stage;delete f.issues[key==='price'?'salePrice':key==='payment'?'account':key];
    if(['customerName','customerPhone','invoiceNo','orderNote'].includes(key))f[key]='';
    else if(key==='gift'){f.giftRequests=[];f.gifts=[];f.giftRequested=''}
    else if(['serial','price','payment'].includes(key)&&!f.deferred.includes(key))f.deferred.push(key);
    continueSale(f);return;
  }
  if(f.stage==='choose'){
    const number=spokenDigits(q).match(/^(?:第)?(\d{1,2})(?:台|个|款)?[。！!？?]*$/);
    if(number&&f.pendingSerial[Number(number[1])-1]){selectSaleSerial(f,f.pendingSerial[Number(number[1])-1]);return}
  }
  mergeSaleInput(f,q);continueSale(f);
}
function saleReview(f){
  f.stage='review';flowAnswer('草稿已齐：'+f.product.name+'，'+f.salePrice+' 元'+(f.account?'，'+f.account:'')+'。核对后确认开单。',[
    {label:'核对并提交',run:()=>openSaleReview()},{label:'打开完整销售单',run:()=>openDraftForReview()}]);
  draft=saleDraftValue(f);$('draft-text').textContent=f.product.name+' · '+f.serialNo+' · '+f.salePrice+' 元';$('draft').hidden=true;
}
function salePayload(f){return {salespersonId:me.id,customerName:f.customerName||'',customerPhone:f.customerPhone||'',account:f.account,invoiceNo:f.invoiceNo||'',invoiceType:f.invoiceNo?'电子发票':'未提出',orderNote:[f.orderNote,...(f.supplement||[])].filter(Boolean).join('；').slice(0,500),items:[{skuId:f.product.skuId,quantity:1,serialNo:f.serialNo,salePrice:f.salePrice}],gifts:(f.gifts||[]).map(g=>({skuId:g.product.skuId,quantity:g.quantity,serialNo:g.serialNo||''})),giftReason:f.giftRequested||'',cashDrawerConfirmed:false}}
function saleReviewLine(parent,label,value){const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+'：';p.append(strong,document.createTextNode(value));parent.append(p)}
async function openSaleReview(){
  const f=saleFlow;if(assistantMode!=='store'||!f||!f.product||salePending(f).length||Object.keys(f.issues).length)return;
  const dialog=$('sale-review-dialog'),body=$('sale-review-body');body.replaceChildren();
  saleReviewLine(body,'商品',f.product.name);saleReviewLine(body,'完整串号',f.serialNo);saleReviewLine(body,'售价',f.salePrice+' 元');
  if(f.customerName||f.customerPhone)saleReviewLine(body,'顾客',[f.customerName,f.customerPhone].filter(Boolean).join(' · '));
  if(f.invoiceNo)saleReviewLine(body,'发票号',f.invoiceNo);if(f.orderNote)saleReviewLine(body,'备注',f.orderNote);if(f.supplement?.length)saleReviewLine(body,'待补资料',f.supplement.join('；'));
  const submit=$('sale-confirm-submit'),status=$('sale-submit-status');submit.disabled=true;status.textContent='正在核对附件成本与限制…';
  $('sale-payment-select').value=f.account||'';$('sale-payment-select').disabled=!!f.submission;$('sale-price-check').hidden=true;$('sale-price-confirmed').required=false;
  $('sale-cash-check').hidden=f.account!=='现金';$('sale-cash-confirmed').checked=!!f.submission?.payload.cashDrawerConfirmed;
  $('sale-cash-confirmed').disabled=!!f.submission;dialog.showModal();
  const revision=f.revision,epoch=modeEpoch;
  try{
    const payload=salePayload(f);
    const [quote,review]=f.submission?[{items:[],cost:0},null]:await Promise.all([api('/api/gifts/quote',payload),api('/api/copilot/sales-review',payload)]);
    const stops=(review?.findings||[]).filter(x=>x.level==='stop'&&!['account','unknown-account'].includes(x.code));
    f.priceWarnings=(review?.findings||[]).filter(x=>/^(?:below-cost|price-deviation|deep-discount)-/.test(x.code)).map(x=>x.message);
    for(const message of f.priceWarnings)saleReviewLine(body,'售价提醒',message);
    $('sale-price-check').hidden=!f.priceWarnings.length;$('sale-price-confirmed').checked=false;$('sale-price-confirmed').disabled=!!f.submission;$('sale-price-confirmed').required=!!f.priceWarnings.length;
    if(stops.length)throw Error(stops.map(x=>x.message).join('；'));if(saleFlow!==f||f.revision!==revision||epoch!==modeEpoch||assistantMode!=='store')return;
    for(const item of quote.items||[])saleReviewLine(body,'附件',item.name+' × '+item.quantity+' · 成本 '+item.unitCost+' 元/件');
    if(f.gifts.length&&!f.submission)saleReviewLine(body,'附件成本',quote.cost+' 元'+(quote.approvalRequired?' · 超限，随销售单提交老板审批':''));
    else if(f.gifts.length)saleReviewLine(body,'附件',f.gifts.map(g=>g.product.name+' × '+g.quantity).join('；'));
    if(quote.approvalRequired)saleReviewLine(body,'超限原因',(quote.reasons||[]).join('；'));
    saleReviewLine(body,'收款核对','开单后仍保留实际收款确认与审核记录。');
    status.textContent=f.submission?'上次提交结果待确认；重试使用同一请求，不重复开单。':'请核对，点确认提交后才入账。';submit.disabled=false;
  }catch(error){if(epoch===modeEpoch){status.textContent='核对失败：'+error.message+'。请返回修改或重新核对。'}}
}
async function submitAssistantSale(){
  const f=saleFlow;if(assistantMode!=='store'||!f||saleSubmitting)return;
  if(!f.submission){f.account=$('sale-payment-select').value;if(!window.AssistantSaleInput.accounts.includes(f.account))return;
    if(f.priceWarnings?.length&&!$('sale-price-confirmed').checked){$('sale-submit-status').textContent='请再次核对并确认成交价。';return}
    const payload=salePayload(f);if(f.priceWarnings?.length)payload.orderNote=[payload.orderNote,'成交价经开单人复核确认：'+f.priceWarnings.join('；')].filter(Boolean).join('；').slice(0,500);
    f.submission={key:requestId(),payload:{...payload,cashDrawerConfirmed:f.account==='现金'&&$('sale-cash-confirmed').checked}};}
  const entry={...f.submission,userId:me.id,branchId:assistantBranchId,summary:{name:f.product.name,giftNames:f.gifts.map(g=>g.product.name)}};try{sessionStorage.setItem(pendingSaleKey,JSON.stringify(entry))}catch{}
  saleSubmitting=true;$('sale-payment-select').disabled=true;$('sale-price-confirmed').disabled=true;$('sale-cash-confirmed').disabled=true;$('sale-confirm-submit').disabled=true;$('sale-review-close').disabled=true;$('sale-submit-status').textContent='正在提交，请稍等…';const epoch=modeEpoch;
  try{
    const result=await api('/api/sale-orders',f.submission.payload,f.submission.key);try{sessionStorage.removeItem(pendingSaleKey)}catch{}
    if(epoch!==modeEpoch||assistantMode!=='store')return;
    rememberSaleSerial(f.serialNo);$('sale-review-dialog').close();saleFlow=null;pausedSaleFlow=null;draft=null;showPausedDraft();
    flowAnswer('提交成功，销售单 '+documentNo(result)+'。'+(result.giftApprovalIds?.length?'附件已交老板审批。':''),[{label:'查看销售单',run:()=>navigate('/app?tab=orders')},{label:'再开一单',run:()=>clearConversation()}]);
    $('basis').textContent='已入账';$('status').textContent='✓ 提交成功 · '+documentNo(result);$('status').classList.add('sale-success');
  }catch(error){
    if(epoch!==modeEpoch)return;
    if([400,403,404,409,422].includes(error.statusCode)){delete f.submission;try{sessionStorage.removeItem(pendingSaleKey)}catch{}$('sale-payment-select').disabled=false;$('sale-price-confirmed').disabled=false;$('sale-cash-confirmed').disabled=false;$('sale-submit-status').textContent='未提交成功：'+error.message+'。返回修改后重新核对。';}
    else $('sale-submit-status').textContent='提交结果尚未确认：'+error.message+'。请点确认提交重试，同一请求不会重复开单。';
    $('sale-confirm-submit').disabled=false;
  }finally{saleSubmitting=false;$('sale-review-close').disabled=false;renderSaleWorkspace()}
}
$('sale-payment-select').onchange=()=>{if(saleSubmitting||saleFlow?.submission)return;$('sale-cash-check').hidden=$('sale-payment-select').value!=='现金';$('sale-cash-confirmed').checked=false};
$('sale-review-form').onsubmit=e=>{e.preventDefault();submitAssistantSale()};
$('sale-review-close').onclick=()=>{if(!saleSubmitting)$('sale-review-dialog').close()};
$('sale-review-dialog').addEventListener('cancel',e=>{if(saleSubmitting)e.preventDefault()});

function restorePendingSale(){
 if(assistantMode!=='store'||!me||saleFlow)return;
 try{const saved=JSON.parse(sessionStorage.getItem(pendingSaleKey)||'null');if(!saved||saved.userId!==me.id||(saved.branchId||'')!==assistantBranchId)return;const p=saved.payload,item=p?.items?.[0];if(!saved.key||!item||!Array.isArray(p.gifts))return;
 saleFlow={stage:'review',product:{skuId:item.skuId,name:saved.summary?.name||item.skuId},serialNo:item.serialNo,salePrice:item.salePrice,account:p.account,customerName:p.customerName,customerPhone:p.customerPhone,invoiceNo:p.invoiceNo,orderNote:p.orderNote,issues:{},deferred:[],revision:0,giftRequests:[],gifts:p.gifts.map((g,i)=>({product:{skuId:g.skuId,name:saved.summary?.giftNames?.[i]||g.skuId},quantity:g.quantity,serialNo:g.serialNo})),submission:{key:saved.key,payload:p}};
 flowAnswer('上次销售单提交结果待确认，请重试核对。同一请求不会重复开单。',[{label:'重试确认结果',run:()=>openSaleReview()}]);
 }catch{}
}

function showPausedDraft(){ $('resume-sale').hidden=!pausedSaleFlow; }
function clearConversation(){$('assistant-reply-text').value='';$('assistant-reply-status').textContent='';
  if((saleFlow?.submission||saleSubmitting)&&assistantMode==='store'){$('status').textContent='请先重试确认这张销售单的提交结果。';return}
  resetChatWindow();window.SaleCapture?.stop();queryVersion++;voiceBusy=false;resetAnswerEditor();resetTariffExport();stopSpeech();conversationContext=null;saleFlow=null;pausedSaleFlow=null;draft=null;pendingAction=null;
  $('result').hidden=true;$('draft').hidden=true;$('action').hidden=true;$('question').value='';
  $('flow-choices').replaceChildren();$('followups').replaceChildren();showPausedDraft();renderSaleWorkspace();$('status').classList.remove('sale-success');
  $('status').textContent='已开始新话题。请告诉我需要做什么。';resumeVoiceCapture();
}
$('new-topic').onclick=clearConversation;
function isProductCreateRequest(q){q=String(q||'').normalize('NFKC');return /(?:新建|新增|创建|建立|添加|增加|录入|登记)\s*(?:(?:一个|一条|一份|个|条|份|新的|新)\s*)?(?:(?:移动(?:公司)?(?:的)?|C\s*仓)\s*)?(?:商品|产品)(?:资料|档案|信息)?|(?:商品|产品)\s*(?:建档|建个档案|建一个档案)/i.test(q)&&!/(?:不要|不用|不想|不需要|不必|暂不|先不|别|取消|停止)\s*.{0,8}(?:新建|新增|创建|建立|添加|增加|录入|登记|建档)/.test(q)}
function isFlowQuery(q){if(isProductCreateRequest(q)||window.AssistantSaleInput.statusQuery(q)||window.AssistantSaleInput.receptionRequest(q))return true;return /(库存|串号|串码|销量|营业额|销售额|毛利|利润|订单|单据|采购|进货|供应商|供货商|待办|待审核|待确认|出勤|考勤|店况|店里情况|积分|工单|奖励|同义词|能做什么)/.test(q)&&/(查|找|看|统计|汇报|多少|怎么样|有没有|在哪|能做什么|什么情况|情况如何)/.test(q)}
function isConversationTopic(value){
  const q=String(value||'').replace(/[\s，,。.!！?？～~、]/g,'');
  const greeting='(?:你好|您好|嗨|哈喽|hello|hi|早上好|上午好|中午好|下午好|晚上好)';
  if(/^(?:(?:有)?(?:顾客|客人|客户)(?:来(?:了)?|到(?:了)?|到店(?:了)?|进店(?:了)?)|来(?:了)?(?:个|一个)(?:顾客|客人|客户)|有人来了|开始接待|迎宾|欢迎顾客)[啊呀呢嘛哇哦哈]{0,2}$/.test(q))return true;
  if(new RegExp('^(?:喂|哎)?'+greeting+'(?:呀|啊|哇|嘛)?$','i').test(q)||/^(?:喂|在吗|在不在|有人吗|有人在吗|听得到吗)$/.test(q))return true;
  const rest=q.replace(new RegExp('^(?:喂|哎)?'+greeting+'(?:呀|啊|哇|嘛)?','i'),'').replace(/^(?:喂|哎|那个|嗯){1,3}/,'');
  if(/^(?:你)?(?:(?:现在|这会儿)?(?:在干吗|在干嘛|在干什么|在做什么|在忙什么|在忙啥子|在做啥子|在做啥|在干啥|忙啥子|干啥子|干啥|忙不忙|有空吗)|(?:能|可以|会|会不会|能不能)(?:帮我|帮我们|帮顾客)?(?:干什么|做什么|干点什么|做点什么|干啥子|做啥子|干啥|做啥|办业务|办理业务|办事)(?:吗|不)?|有什么本事|有啥子本事|有什么用|有啥子用|有哪些功能|有什么功能|是谁|是什么人|是什么机器人|是什么助理|是哪里的人|是哪里人|是哪儿的人|是哪儿人|来自哪里|来自哪儿|是不是(?:重庆|云阳)妹儿|是不是南溪街上的|老板是谁|老板是哪个|老板叫什么|帮谁干|帮哪个干|给谁干活|为谁服务|是谁的助理)[啊呀呢嘛哇哦哈]{0,2}$/i.test(rest))return true;
  if(/^(?:你)?(?:(?:是不是|是)(?:重庆|云阳)(?:妹儿|妹子|妹妹|人)(?:吗|不)?|(?:是不是|是)南溪(?:街上|镇上)?(?:的)?(?:人|妹儿|妹子)?(?:吗|不)?|(?:是哪里的人|是哪里人|是哪儿的人|是哪儿人|是哪的人|来自哪里|来自哪儿|是哪里来的|是哪儿来的|是哪里(?:的)?|是哪儿(?:的)?)|帮哪个干|给哪个干活|为哪个服务|替谁工作|替哪个工作|是给谁干的)[啊呀呢嘛哇哦哈]{0,2}$/.test(rest))return true;
  if(/(?:我|我们)?(?:来|想来|要|想|想要)?(?:办|办理|咨询)(?:一下|个|一个|一项|点|一点)?业务/.test(rest))return true;
  return /(?:号卡|手机卡|电话卡|套餐|资费|卡资源)/.test(rest)&&/推荐|适合|划算|选择|哪种|哪款|整理|分类|买|办|开|变更|降档|升档/.test(rest)||/(?:买|办|开)(?:个|一张|张)?卡/.test(rest)||/(?:老人机|功能机|按键机|老年机)/.test(rest)&&/便宜|有哪些|推荐|选|预算|以内|以下/.test(rest);
}
function resumeSale(){if(!pausedSaleFlow)return;saleFlow=pausedSaleFlow;pausedSaleFlow=null;showPausedDraft();
 if(saleFlow.stage==='booking'){flowAnswer('是已成交还是仅预订？',[{label:'已成交',value:'已成交'},{label:'仅预订',value:'只是预订'}]);return}
 if(saleFlow.stage==='product'){flowAnswer('请补充商品名称或型号。');return}
 continueSale(saleFlow)}
$('resume-sale').onclick=resumeSale;
function renderDataTable(tableData){
  const box=$('data-table');box.replaceChildren();box.hidden=!tableData?.rows?.length;
  if(!tableData?.rows?.length)return;
  const table=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
  if(tableData.title){const caption=document.createElement('caption');caption.textContent=tableData.title;table.append(caption)}
  for(const column of tableData.columns||[]){const th=document.createElement('th');th.textContent=column.label;tr.append(th)}head.append(tr);table.append(head);const body=document.createElement('tbody');
  for(const row of tableData.rows.slice(0,100)){const line=document.createElement('tr');for(const column of tableData.columns||[]){const td=document.createElement('td');td.textContent=row[column.key]===null?'未列明':String(column.key==='id'?documentNo(row):/Id$/.test(column.key)&&row[column.key.replace(/Id$/,'DisplayNo')]?documentRef(row,column.key):row[column.key]??'');line.append(td)}body.append(line)}table.append(body);box.append(table);
}
let tariffExportState=null;
function resetTariffExport(){
 tariffExportState=null;$('tariff-export').hidden=true;$('tariff-type-panel').hidden=true;$('tariff-types').replaceChildren();$('tariff-export-text').value='';$('tariff-preview').hidden=true;$('tariff-preview-button').setAttribute('aria-expanded','false');$('tariff-export-status').textContent='';
}
function renderTariffExport(table,data){
 const available=data.metrics?.kind==='tariff-recommendations'&&table?.rows?.length;
 $('tariff-export').hidden=!available;$('tariff-preview').hidden=true;$('tariff-preview-button').setAttribute('aria-expanded','false');$('tariff-export-status').textContent='';
 if(!available){tariffExportState=null;$('tariff-export-text').value='';return}
 tariffExportState={rows:table.rows,allRows:data.table.rows,title:table.title||'套餐资费核对清单',asOf:data.asOf,epoch:modeEpoch};
 $('tariff-export-text').value=StoreTariffExport.text(table.rows,{title:tariffExportState.title,asOf:data.asOf});
 $('tariff-export-count').textContent='当前清单 '+table.rows.length+' 档 · 本次共 '+data.table.rows.length+' 档';
}
function previewTariffs(select=false){
 if(!tariffExportState)return;$('tariff-preview').hidden=false;$('tariff-preview-button').setAttribute('aria-expanded','true');
 if(select){$('tariff-export-text').focus();$('tariff-export-text').select();$('tariff-export-text').scrollIntoView({block:'center',behavior:'smooth'})}
}
$('tariff-preview-button').onclick=()=>{if(!$('tariff-preview').hidden){$('tariff-preview').hidden=true;$('tariff-preview-button').setAttribute('aria-expanded','false')}else previewTariffs()};
$('tariff-copy').onclick=async()=>{
 const snapshot=tariffExportState;if(!snapshot)return;const text=$('tariff-export-text').value;
 try{if(!window.navigator?.clipboard?.writeText)throw Error('clipboard unavailable');await window.navigator.clipboard.writeText(text);if(snapshot===tariffExportState)$('tariff-export-status').textContent='复制成功。可到微信粘贴，分钟与流量逐项列明。'}
 catch{if(snapshot!==tariffExportState)return;previewTariffs(true);$('tariff-export-status').textContent='浏览器未允许自动复制。请长按下面已选中的清单文字，再点复制。'}
};
function downloadTariffs(all=false){
 const snapshot=tariffExportState;if(!snapshot)return;
 const text=all?StoreTariffExport.text(snapshot.allRows,{title:'本次套餐资费核对清单（按套餐类型）',asOf:snapshot.asOf,groupByType:true}):$('tariff-export-text').value;
 try{const blob=new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  const at=snapshot.asOf?new Date(snapshot.asOf):new Date(),date=at.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).replace(/-/g,'');
  a.href=url;a.download=(all?'本次套餐资费_按类型':snapshot.title.replace(/[\\/:*?"<>|]/g,'').slice(0,55))+'_核对_'+date+'.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('tariff-export-status').textContent='已发起下载（文字文件）。在浏览器下载列表找到文件，可转发给对方核对。';
 }catch{previewTariffs(true);$('tariff-export-status').textContent='浏览器未能发起下载。可使用“复制当前清单”，或长按下面的清单文字复制。'}
}
$('tariff-download').onclick=()=>downloadTariffs();$('tariff-download-all').onclick=()=>downloadTariffs(true);
function renderEvidence(data){
 resetTariffExport();const tariff=data.metrics?.kind==='tariff-recommendations';
 const note=$('data-note');note.textContent=data.note||data.tariffCatalog?.domesticNote||(tariff?StoreTariffExport.note:'');note.hidden=!note.textContent;
 const select=(table,type='all')=>{renderDataTable(table);renderTariffExport(table,data);for(const button of $('tariff-types').children)button.setAttribute('aria-pressed',String(button.dataset.type===type))};
 select(data.table);
 const groups=$('data-groups');groups.replaceChildren();
 const classifications=data.metrics?.catalog?data.metrics.classifications:[];
 groups.hidden=!classifications?.length;
 if(classifications?.length&&data.table){
  const all=document.createElement('button');all.type='button';all.textContent='全部资费';all.onclick=()=>select(data.table);groups.append(all);
  const byId=new Map(data.table.rows.map(row=>[row.id,row]));
  for(const item of classifications){const b=document.createElement('button');b.type='button';b.textContent=item.label;b.onclick=()=>{const rows=item.rowIds.map(id=>byId.get(id)).filter(Boolean);select({...data.table,title:item.label+' · '+item.basis,rows},null)};groups.append(b)}
 }
 if(tariff&&data.table?.rows?.length){
  $('tariff-type-panel').hidden=false;const types=$('tariff-types');
  const button=(label,key,click)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.type=key;b.setAttribute('aria-pressed',String(key==='all'));b.onclick=click;types.append(b)};
  button('全部类型','all',()=>select(data.table));
  for(const group of StoreTariffExport.types(data.table.rows))button(group.label+'（'+group.count+'档）',group.key,()=>select({...data.table,title:group.label+'资费核对清单',rows:data.table.rows.filter(row=>StoreTariffExport.typeKey(row)===group.key)},group.key));
 }
 $('alert-list').replaceChildren();for(const alert of data.alerts||[]){const a=document.createElement('a');a.textContent=alert.kind+(alert.employee?' · '+alert.employee:'')+(alert.note?'：'+alert.note:'');if(typeof alert.href==='string'&&alert.href.startsWith('/')&&!alert.href.startsWith('//'))a.href=alert.href;a.target='_top';$('alert-list').append(a)}
}
function renderFollowups(rows){
  $('followups').replaceChildren();
  for(const row of Array.isArray(rows)?rows:[]){if(!row||typeof row.question!=='string')continue;const b=document.createElement('button');b.type='button';b.textContent=row.label||row.question;b.onclick=()=>{$('question').value=row.question;ask(row.question)};$('followups').append(b)}
}
async function loadSupervision(){
  if(assistantMode==='customer'||!['owner','manager'].includes(me?.roleCode))return;
  $('supervision-panel').hidden=false;
  try{const view=await api('/api/assistant/supervision');$('supervision-summary').textContent='今天已登记参与 '+view.registered+' 项；积分待核定 '+view.pendingPoints+' 份；跟进或核对线索 '+view.alerts.length+' 项。'}catch(error){$('supervision-summary').textContent='动态暂未查到：'+error.message}
}
$('show-supervision').onclick=()=>{$('question').value='详细说说今天员工做了哪些工作';ask($('question').value)};
let capabilityItems=[];
function renderCapabilities(){
  const q=($('capability-search')?.value||'').trim().toLowerCase();
  const items=capabilityItems.filter(item=>[item.label,item.description,item.example].join(' ').toLowerCase().includes(q));
  $('capability-list').replaceChildren();
  for(const item of items){const box=document.createElement('div');box.className='capability-item';const title=document.createElement('strong');title.textContent=item.label;box.append(title);if(item.description){const p=document.createElement('p');p.textContent=item.description;box.append(p)}
    if(item.example){const b=document.createElement('button');b.type='button';b.textContent=item.example;b.onclick=()=>{$('question').value=item.example;ask(item.example)};box.append(b)}
    if(typeof item.href==='string'&&item.href.startsWith('/')&&!item.href.startsWith('//')){const a=document.createElement('a');a.href=item.href;a.target='_top';a.textContent=item.mode==='draft'?'核对草稿入口':'打开功能';box.append(a)}$('capability-list').append(box)}
  if(!items.length)$('capability-list').textContent=q?'没有找到对应功能，可以直接问助理或换个关键词。':'当前岗位暂无可用功能。';
}
if($('capability-search'))$('capability-search').oninput=renderCapabilities;
async function loadCapabilities(){
  if(assistantMode==='customer')return;
  const epoch=modeEpoch;
  try{const data=await api('/api/assistant/capabilities');if(epoch!==modeEpoch||assistantMode==='customer')return;capabilityItems=data.items||[];renderCapabilities();
  }catch(error){if(epoch===modeEpoch&&assistantMode==='store')$('capability-list').textContent='功能目录暂未加载：'+error.message}
}
async function loadAssistantOrganization(){
  assistantOrganizationReady=false;assistantBranchId='';
  try{
    const organization=await api('/api/organization');
    if(!organization||typeof organization!=='object'||Array.isArray(organization)||typeof organization.enabled!=='boolean')return false;
    if(organization.enabled&&(typeof organization.currentBranchId!=='string'||!organization.currentBranchId.trim()||organization.currentBranchId.length>120))return false;
    assistantBranchId=organization.enabled?organization.currentBranchId:'';assistantOrganizationReady=true;return true;
  }catch{return false;}
}
function openPendingFeature(){
  if(assistantMode!=='store'||pendingAction?.type!=='navigate')return false;
  const action=pendingAction;if(typeof action.href!=='string'||!action.href.startsWith('/')||action.href.startsWith('//'))return false;
  if(action.draftKind==='product'){
    if(!me?.capabilities.manageProducts||action.ownerId!==me.id||action.href!=='/app?tab=products&new=1')return false;
    if(!assistantOrganizationReady){
      try{sessionStorage.removeItem('assistant-product-draft-v1');}catch{}
      pendingAction=null;$('action').hidden=true;$('status').textContent='门店信息未读取成功，请刷新页面后再打开商品资料草稿。';return false;
    }
    const prefill={};if(typeof action.prefill?.name==='string'&&action.prefill.name.trim()&&action.prefill.name.length<=120)prefill.name=action.prefill.name.trim();
    if(action.prefill?.warehouseId==='wh-c')prefill.warehouseId='wh-c';
    sessionStorage.setItem('assistant-product-draft-v1',JSON.stringify({prefill,ownerId:me.id,branchId:assistantBranchId,createdAt:Date.now()}));
  }else if(action.prefill)sessionStorage.setItem('erp-reception-draft-after-login-v1',JSON.stringify(action.prefill));
  pendingAction=null;stopVoiceSession();navigate(action.href);return true;
}
function showConversationPair(){finishChatTurn();}
async function ask(q){
  q=String(q).trim();if(!q)return;const pair=q.match(/^(\d{4}|\d{12,20})[\s，,；;]+(\d{1,8}(?:\.\d{1,2})?)(?:元|块)?[。！!]*$/);
  if(pair)q='手机，串号'+pair[1]+'，售价'+pair[2]+'元';lastAssistantQuestion=q;
  if(/^(?:打开这个功能|打开这个|打开吧|进去|进去吧|进入吧|确认打开|去看看)[。！!？?]*$/.test(q)&&pendingAction?.type==='navigate'){openPendingFeature();return;}
  if(/^(?:换个话题|新话题|重新聊|清空对话)[。！!？?]*$/.test(q)){clearConversation();return}
  if(assistantMode==='store'&&pausedSaleFlow&&/^(?:继续填单|继续刚才的单|继续开刚才的单|恢复填单)[。！!？?]*$/.test(q)){resumeSale();return}
  if(saleSubmitting||saleFlow?.submission){$('status').textContent='请先核对这张单的提交结果，再查询或准备另一张单。';return}
  beginChatTurn(q);
  if(saleFlow&&!saleFlow.submission&&(isFlowQuery(q)||isConversationTopic(q))){pausedSaleFlow=saleFlow;saleFlow=null;showPausedDraft();renderSaleWorkspace()}
  if(saleFlow?.stage==='review'&&/^(?:去核对|打开销售单|确认开单|继续开单|确认|继续)$/.test(String(q).trim())){if(q==='打开销售单')openDraftForReview();else openSaleReview();return}
  if(saleFlow){advanceSale(q);return}
  if(assistantMode==='store'&&me?.capabilities.sell&&!isProductCreateRequest(q)){const parsed=window.AssistantSaleInput.analyze(q);if(parsed.saleRequest&&(parsed.serialToken||/手机(?:串号|串码)/.test(q))){queryVersion++;await startSaleFlow('手机，'+q);return}}
  resetAnswerEditor();resetTariffExport();stopSpeech();pauseVoiceCapture();voiceBusy=true;pendingAction=null;$('action').hidden=true;$('status').textContent=assistantMode==='customer'?'正在查资料…':'正在核对账套…';$('result').hidden=true;$('flow-choices').replaceChildren();
  const requestEpoch=modeEpoch,requestVersion=++queryVersion,requestContext=conversationContext;const current=()=>requestEpoch===modeEpoch&&requestVersion===queryVersion;
  try{const requestedStyle=customerReplyStyle;const d=await api('/api/assistant/ask',{question:q,context:conversationContext,customerReplyStyle:requestedStyle,mode:assistantMode});if(!current())return;answerReplyStyle=['customer-talk-guidance','customer-dialogue','assistant-social','product-recommendations','tariff-recommendations'].includes(d.metrics?.kind)?replyStyle(d.metrics.replyStyle||d.metrics.customerReplyStyle||d.customerReplyStyle||requestedStyle):'mandarin';conversationContext=d.context||null;renderFollowups(d.followups);renderEvidence(d);if(d.saleFlow&&assistantMode==='store'){pausedSaleFlow=null;showPausedDraft();if(d.saleFlow.type==='product'){saleFlow={stage:'product',request:d.saleFlow.request};flowAnswer('顾客选定或预订了什么商品？请说商品名称或型号，例如“华为手机”。');return}await startSaleFlow(d.saleFlow.request,d.saleFlow.reservation,d.saleFlow.candidateSkuIds);return}
    $('result').hidden=false;$('answer').value=d.answer;setAnswerEditable(d,q,requestContext);$('basis').textContent=assistantMode==='customer'?'顾客咨询 · 具体办理由营业员核对':d.metrics?.kind==='function-entry'?'功能入口 · 按当前岗位权限':'查询时间：'+time(d.asOf)+' · 范围：'+d.scope;$('sources').replaceChildren();
    for(const s of d.metrics?.kind==='function-entry'?[]:d.sources||[]){const a=document.createElement('a');a.href=s.href;a.target='_top';a.textContent=s.label+' · '+documentNo(s);$('sources').append(a)}
    renderSaleWorkspace();draft=d.draft||null;$('draft').hidden=!draft;pendingAction=d.action||null;$('action').hidden=!pendingAction;if(pendingAction)$('action-button').textContent=pendingAction.label;$('teach-this').hidden=assistantMode==='customer'||me?.roleCode!=='owner'||d.metrics?.kind==='function-entry';
    if(d.metrics?.kind==='function-entry'&&pendingAction){$('data-note').hidden=false;$('data-note').textContent='点下面按钮，或说“打开吧”。'}
    if(draft)$('draft-text').textContent=draft.productName+' × '+draft.quantity+'；参考零售价 '+draft.referencePrice+' 元。须由人核对后提交。';
    $('status').textContent='';showConversationPair();setSpeechButtons();
  }catch(e){if(current()){saleFlow=null;$('status').textContent=e.message}}finally{if(current()){voiceBusy=false;if(!speaking)resumeVoiceCapture()}}
}
$('prepare-sale').onclick=()=>prepareWorkDocument('sale');$('prepare-reception').onclick=()=>prepareWorkDocument('reception');
$('action-button').onclick=async()=>{
 if(!pendingAction)return;
 if(pendingAction.type==='navigate'){openPendingFeature();return}
 if(pendingAction.type==='attendance'){
  const selected=pendingAction,operation=selected.operation;
  if(['fieldwork-start','fieldwork-end','fieldwork-checkpoint'].includes(operation)){await openFieldwork(operation,selected.fieldworkId);if(fieldworkTarget)fieldworkTarget.pendingAction=selected;return;}
  if(!['checkin','checkout'].includes(operation)||!confirm(selected.label+'？'))return;
  await submitAttendance({action:operation},selected);
 }
};
$('teach-this').onclick=()=>{$('phrase-form').elements.phrase.value=displayedReply?.question||$('question').value.trim();revealAssistantPanel('phrase-panel');$('phrase-form').elements.phrase.focus()};
$('assistant-reply').onsubmit=async event=>{
 event.preventDefault();const input=$('assistant-reply-text'),q=input.value.trim();if(!q)return;
 if(inlineDialogue||(canEditDisplayedAnswer()&&$('answer').value!==displayedReply.data.answer)){$('assistant-reply-status').textContent='请先保存或取消正在修改的问答，再继续回复。';return;}
 if(saleSubmitting||saleFlow?.submission){$('assistant-reply-status').textContent='请先确认本单的提交结果。';return;}
 if(voiceSession)stopVoiceSession();input.value='';$('assistant-reply-status').textContent='';$('question').value=q;
 $('assistant-reply-send').disabled=true;try{await ask(q);}finally{syncReplyBox();}
};
$('ask').onsubmit=async e=>{
 e.preventDefault();if(voiceSession){stopVoiceSession();return}const q=$('question').value.trim();if(!q)return;
 if(answerEditLoad&&!await answerEditLoad)return;
 if(!inlineDialogue&&canEditDisplayedAnswer()&&$('answer').value!==displayedReply.data.answer){if(!await openAnswerEdit({fromAnswer:true,preserveQuestion:true}))return}
 if(inlineDialogue){answerEditStatus('修改后请点回答下面的按钮一起保存；不修改可点取消。');return}
 if(canEditPair()&&hasQuestionWays(q)){await openAnswerEdit({preserveQuestion:true});return}
 ask(q);
};$('quick').onclick=e=>{const b=e.target.closest('[data-q]');if(b){$('question').value=b.dataset.q;ask(b.dataset.q)}};function openDraftForReview(){if(assistantMode!=='store'||!draft||!saleEditable())return;sessionStorage.setItem('assistant-sale-draft',JSON.stringify({...draft,createdAt:Date.now()}));stopVoiceSession();navigate('/app?tab=sales')}
$('open-draft').onclick=openDraftForReview;
let attendanceSnapshot=null,attendanceLoadGeneration=0,attendanceWriteBusy=false,fieldworkOpening=false,fieldworkTarget=null,fieldworkRequest=null,attendanceStoreRequest=null,attendanceReviewTarget=null,attendanceReviewRequest=null,attendanceSpotSettingsRequest=null;
let attendanceLocationRun=null,attendanceNativeLocationPending=null;
function attendanceLogoutMarker(){try{return window.localStorage?.getItem('store-session-logout-v1')||'';}catch{return '';}}
function attendancePageVisible(){return typeof document==='undefined'||document.visibilityState==='visible';}
function cancelAttendanceLocationRun(){
 const run=attendanceLocationRun;if(!run||run.cancelled)return;
 run.cancelled=true;run.controller.abort();fieldworkRequest=null;
 if(attendancePageVisible()&&attendanceAllowed()&&me.id===run.ownerId){const message=run.hasPosted?'已停止后续定位。已提交的打卡记录请刷新核对，原签到时间保留。':'本次定位已取消，没有继续提交打卡。';attendanceMessage(message);$('status').textContent=message;}
}
function beginAttendanceLocationRun(){
 const run={ownerId:me.id,epoch:modeEpoch,marker:attendanceLogoutMarker(),controller:new AbortController(),cancelled:false,hasPosted:false};
 run.current=()=>attendanceLocationRun===run&&!run.cancelled&&attendancePageVisible()&&run.epoch===modeEpoch&&attendanceAllowed()&&me.id===run.ownerId&&attendanceLogoutMarker()===run.marker;
 attendanceLocationRun=run;return run;
}
function attendanceRunRequestMatches(run,serialized){return !!fieldworkRequest&&fieldworkRequest.serialized===serialized&&fieldworkRequest.ownerId===run.ownerId&&fieldworkRequest.epoch===run.epoch&&fieldworkRequest.marker===run.marker;}
function attendanceRunProgress(run,message){
 if(!run.current())return;
 attendanceMessage(message);
 const boxes=[$('attendance-status')];if($('fieldwork-dialog').open){$('fieldwork-status').textContent=message;boxes.push($('fieldwork-status'));}
 for(const box of boxes){const button=attendanceNode('button','取消定位');button.type='button';button.onclick=cancelAttendanceLocationRun;box.append(button);}
}
async function attendanceRunApi(run,path,body,key){
 const send=async(route,data,requestKey)=>{
  if(!run.current())throw Error('attendance-cancelled');
  if(data)run.hasPosted=true;
  const response=await fetch(route,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:run.controller.signal,headers:data?{'Content-Type':'application/json','Idempotency-Key':requestKey||requestId()}:undefined,body:data?JSON.stringify({...data,locationOwnerId:run.ownerId}):undefined});
  const result=await response.json().catch(()=>({}));
  if(!run.current())throw Error('attendance-cancelled');
  if(!response.ok){if(response.status===401){cancelAttendanceLocationRun();location.href='/login?next=/assistant';}const error=Error(result.error?.message||'请求失败');error.statusCode=response.status;throw error;}
  return result;
 };
 // Recheck the cookie session before sending captured location, including a retry of a saved request.
 if(body){const user=await send('/api/me');if(user?.id!==run.ownerId){cancelAttendanceLocationRun();throw Error('attendance-cancelled');}}
 return send(path,body,key);
}
function attendanceNeedsLocationSupplement(row){
 if(!row||row.userId!==me?.id||row.checkOutAt)return false;
 const points=Array.isArray(row.locationSupplements)?row.locationSupplements:[],report=points.length?points[points.length-1]?.locationReport:row.checkInLocation;
 return !!report&&(['timeout','unavailable'].includes(report.failure)||['low-accuracy','stale','future'].includes(report.reason));
}
async function autoSupplementAttendanceLocation(run,expectedId){
 if(!run.current())return;
 const row=ownAttendanceSupplementRow(expectedId);if(!attendanceNeedsLocationSupplement(row))return;
 const body={action:'location-supplement',attendanceId:row.id},serialized=JSON.stringify(body);
 try{
  attendanceRunProgress(run,'签到已记录，正在补定位，请稍候…');
  if(!attendanceRunRequestMatches(run,serialized)){
   // One additional native attempt after the check-in has been saved; no recurring background job.
   const location=await captureAttendanceLocation(()=>run.current()&&!!ownAttendanceSupplementRow(row.id),{attempts:1,timeout:15000,signal:run.controller.signal});
   if(!run.current()||location.locationCancelled)return;
   if(!location.locationEvidence){const message='签到已记录。'+attendanceLocationFailureHelp(location.locationFailure)+' 自动补定位未取得可用位置，仍待老板核对；原签到时间保留。';attendanceMessage(message,false,'pending');$('status').textContent=message;return;}
   fieldworkRequest={serialized,key:requestId(),body:{...body,...location},ownerId:run.ownerId,epoch:run.epoch,marker:run.marker};
  }
  if(!run.current()||!ownAttendanceSupplementRow(row.id))return;
  const request=fieldworkRequest,result=await attendanceRunApi(run,'/api/assistant/attendance',request.body,request.key);
  if(fieldworkRequest===request)fieldworkRequest=null;
  if(!run.current())return;
  const report=result?.supplement?.locationReport,message='签到已记录，已补定位。补充的是现在位置，原签到时间保留。'+(report?' '+attendanceLocationText(report):' 请核对最新记录。');
  attendanceMessage(message,false,report?.status==='待老板核对'?'pending':attendanceLocationTone(report));$('status').textContent=message;
  if(run.current())await attendance();
 }catch(error){if(run.current()){const message='签到已记录，补定位'+(error.statusCode?'未能保存：'+error.message:'结果尚未确认，请刷新核对后再点“补定位”。')+' 原签到时间保留；位置仍需核对。';attendanceMessage(message,false,'pending');$('status').textContent=message;}}
}

function attendanceAllowed(){return assistantMode==='store'&&!customerLocked&&!!me?.id;}
function attendanceMessage(message,error=false,tone='info'){const box=$('attendance-status');box.textContent=message;box.classList.toggle('attendance-error',error);box.dataset.feedbackTone=error?'error':tone;}
function attendanceDuration(value){
 if(!Number.isInteger(value)||value<0)return '待核对';
 if(value===0)return '0分钟';if(value<60)return '不足1分钟';
 const minutes=Math.floor(value/60),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
 return [days?days+'天':'',hours?hours+'小时':'',rest?rest+'分钟':''].filter(Boolean).join('');
}
function attendanceTime(value){return value&&Number.isFinite(new Date(value).getTime())?time(value):'未记录';}
function ownLatestAttendance(){
 return (attendanceSnapshot?.rows||[]).filter(row=>row.userId===me?.id).slice().sort((a,b)=>Date.parse(b.checkInAt)-Date.parse(a.checkInAt))[0]||null;
}
function attendanceLocationTone(location){
 if(location?.status==='待老板核对'||location?.humanReview?.decision==='needs-followup')return 'pending';
 return location?.reason==='inside'||location?.humanReview?.decision==='confirmed'?'normal':'info';
}
async function attendancePublishWorkLock(action,result){
 if(!['checkin','checkout'].includes(action)||typeof window==='undefined')return;
 const ownerId=me?.id,epoch=modeEpoch;
 try{
  const user=await api('/api/me');
  if(epoch!==modeEpoch||!attendanceAllowed()||ownerId!==me?.id||user?.id!==ownerId||typeof user.workLock?.locked!=='boolean')return;
  me.workLock=user.workLock;
  window.dispatchEvent(new CustomEvent('work-session-update',{detail:{workLock:user.workLock,userId:ownerId}}));
 }catch{window.StoreWorkSession?.refresh();}
}
function attendanceResultMessage(body,result,supplement){
 const feedback=result?.feedback,stamp=attendanceTime(feedback?.eventAt||result?.checkpoint?.at||(body.action==='checkout'?result?.checkOutAt:result?.checkInAt));
 if(feedback?.repeated)return (body.action==='checkout'?'已在 '+stamp+' 签退，'+(me?.roleCode==='owner'?'管理员账号继续可办理业务。':'工作操作已锁定，请重新签到恢复。'):body.action==='fieldwork-end'?'本次外勤已在 '+stamp+' 结束。':body.action==='fieldwork-start'?'外勤已在 '+stamp+' 开始。':'已在 '+stamp+' 签到。')+' 本次未重复记录。';
 if(supplement)return '补充定位已记录。补充的是现在位置，原签到时间和记录保留。';
 if(body.action==='checkin')return '签到时间：'+stamp+'。'+(feedback?.outcome==='resumed'?'已重新签到，工作操作恢复；原班次保留。':'签到已记录。');
 if(body.action==='checkout')return '签退时间：'+stamp+'。'+(me?.roleCode==='owner'?'签退记录已保存；管理员账号继续可办理业务。':'工作操作已锁定，重新签到后恢复；本人进行中的外勤已结束。');
 if(body.action==='fieldwork-checkpoint')return '第 '+(result?.lastFieldwork?.checkpoints?.length||1)+' 次定位打卡已记录；时间：'+stamp+'；地点：'+(result?.checkpoint?.location||body.location)+'。可继续到新地点打卡，不重复累计工作时间。';
 if(body.action==='fieldwork-start')return '外勤已开始；时间：'+stamp+'；地点：'+(result?.lastFieldwork?.location||body.location)+'。';
 if(body.action==='fieldwork-end')return '外勤已结束；时间：'+stamp+'。';
 return '抽查定位已记录；时间：'+attendanceTime(result?.request?.respondedAt)+'。'+(result?.request?.reviewRequired===true||result?.request?.reviewRequired===undefined&&result?.request?.late?'已超过回应期限，需要老板核对。':'');
}
function attendanceToday(){const value=attendanceSnapshot?.asOf;return value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}):'';}
function ownActiveFieldwork(){return attendanceSnapshot?.activeFieldwork?.find(row=>row.userId===me?.id&&!row.endAt)||null;}
function attendanceNode(tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
function attendanceResultLocation(action,result){
 if(action==='checkin')return result?.checkInLocation;
 if(action==='checkout')return result?.checkOutLocation;
 if(action==='fieldwork-start')return result?.lastFieldwork?.startLocation;
 if(action==='fieldwork-end')return result?.lastFieldwork?.endLocation;
 if(action==='fieldwork-checkpoint')return result?.checkpoint?.locationReport;
 if(action==='spot-check-respond')return result?.request?.responseLocation;
 if(action==='location-supplement')return result?.supplement?.locationReport;
 return null;
}
function attendanceLocationText(location){
 if(!location)return '历史记录未保存定位，仅供核对。';
 const parts=[location.status||'待老板核对',location.message||''];
 if(location.failure&&['permission-denied','unavailable','timeout','unsupported','unknown'].includes(location.failure))parts.push(attendanceLocationFailureHelp(location.failure));
 const evidence=location.evidence;
 if(evidence&&Number.isFinite(evidence.accuracy))parts.push('定位精度约 '+Math.round(evidence.accuracy)+' 米');
 if(Number.isFinite(location.distanceMeters))parts.push('距门店约 '+Math.round(location.distanceMeters)+' 米');
 if(evidence?.capturedAt)parts.push('定位采集时间 '+attendanceTime(evidence.capturedAt));
 return parts.filter(Boolean).join('；');
}
function attendanceLocationNode(label,location,target){
 const box=attendanceNode('div','','attendance-location-record');box.dataset.feedbackTone=attendanceLocationTone(location);
 box.append(attendanceNode('p',label+'：'+attendanceLocationText(location),'attendance-note'));
 const evidence=location?.evidence;
 if(evidence&&Number.isFinite(evidence.latitude)&&Number.isFinite(evidence.longitude)){
  const link=attendanceNode('a','高德查看位置');
  link.href='https://uri.amap.com/marker?position='+encodeURIComponent(evidence.longitude+','+evidence.latitude)+'&name='+encodeURIComponent(label)+'&coordinate=wgs84&src=store-erp';
  link.target='_blank';link.rel='noopener noreferrer';box.append(link);
 }
 const review=location?.humanReview;
 if(review)box.append(attendanceNode('p','老板核对：'+(review.decision==='confirmed'?'已确认':'还需跟进')+'；'+(review.note||'')+'；'+(review.reviewerName||'老板')+'；'+attendanceTime(review.reviewedAt),'attendance-note'));
 if((location?.status==='待老板核对'||target?.reviewRequired)&&attendanceStoreAllowed()&&target){const button=attendanceNode('button','老板核对定位');button.type='button';button.onclick=()=>openAttendanceLocationReview({...target,summary:label+'：'+attendanceLocationText(location)+(target.reviewMessage?'；'+target.reviewMessage:'')});box.append(button);}
 return box;
}
function attendanceLocationFailureHelp(failure){
 return ({'permission-denied':'浏览器未允许定位。请在网址旁的位置权限中点允许，并打开手机定位后重试。','unavailable':'手机暂时未能提供位置。请确认手机定位已开启，保持网络连接，到窗边或室外再试。','timeout':'读取位置超时。请保持网络和手机定位开启，到信号较好的地方稍后重试。','unsupported':'此浏览器没有提供定位功能，请用支持定位的手机浏览器打开系统。','unknown':'未取得可用的位置。请检查手机定位和浏览器位置权限后重试。'}[failure]||'本次没有取得位置，请稍后重试。');
}
function captureAttendanceLocation(shouldContinue=()=>true,options={}){
 const current=()=>{try{return attendancePageVisible()&&!options.signal?.aborted&&shouldContinue()!==false;}catch{return false;}};
 const attempt=(enableHighAccuracy,timeout)=>{
  if(!current())return Promise.resolve({locationCancelled:true});
  if(typeof navigator==='undefined'||!navigator.geolocation?.getCurrentPosition)return Promise.resolve({locationFailure:'unsupported'});
  // getCurrentPosition cannot be aborted. Keep its slot until the native callback actually settles.
  if(attendanceNativeLocationPending)return Promise.resolve({locationFailure:'unknown',locationBusy:true});
  let nativeFinish,complete=false;
  const pending=new Promise(resolve=>{nativeFinish=value=>{if(complete)return;complete=true;resolve(value);};});
  attendanceNativeLocationPending=pending;
  pending.then(()=>{if(attendanceNativeLocationPending===pending)attendanceNativeLocationPending=null;});
  try{navigator.geolocation.getCurrentPosition(position=>{
   const {latitude,longitude,accuracy}=position.coords||{},stamp=position.timestamp;
   if(!Number.isFinite(latitude)||latitude < -90||latitude > 90||!Number.isFinite(longitude)||longitude < -180||longitude > 180||!Number.isFinite(accuracy)||accuracy < 0||accuracy > 100000||!Number.isFinite(stamp)||!Number.isFinite(new Date(stamp).getTime())){nativeFinish({locationFailure:'unknown'});return;}
   nativeFinish({locationEvidence:{latitude,longitude,accuracy,capturedAt:new Date(stamp).toISOString()}});
  },error=>nativeFinish({locationFailure:error?.code===1?'permission-denied':error?.code===2?'unavailable':error?.code===3?'timeout':'unknown'}),{enableHighAccuracy,timeout,maximumAge:0});}
  catch{nativeFinish({locationFailure:'unknown'});}
  // Native timeout starts after permission is granted. A wall-clock watchdog would wrongly charge permission waiting.
  return new Promise(resolve=>{
   let settled=false;const finish=value=>{if(settled)return;settled=true;options.signal?.removeEventListener('abort',cancel);resolve(current()?value:{locationCancelled:true});},cancel=()=>finish({locationCancelled:true});
   options.signal?.addEventListener('abort',cancel,{once:true});pending.then(finish);if(!current())cancel();
  });
 };
 return (async()=>{
  const first=await attempt(true,options.timeout||10000);
  if(options.attempts!==1&&['unavailable','timeout'].includes(first.locationFailure)&&current()){
   if(typeof options.onRetry==='function')options.onRetry();
   return attempt(false,15000);
  }
  return first;
 })();
}
function attendanceLocationWarning(body){
 const failure=body.locationFailure;
 if(failure)return attendanceLocationFailureHelp(failure)+' 本次打卡可先记录为待老板核对。';
 const evidence=body.locationEvidence,maxAccuracy=attendanceSnapshot?.locationPolicy?.maxAccuracyMeters||100;
 return evidence&&evidence.accuracy>maxAccuracy?'定位精度约 '+Math.round(evidence.accuracy)+' 米，精度不足；仍可提交，标记为待老板核对。':'';
}
function attendanceStoreAllowed(){return attendanceAllowed()&&me?.roleCode==='owner'&&attendanceSnapshot?.canManageLocationSettings===true;}
function syncAttendanceLocationControls(){
 for(const button of $('attendance-spot-requests').querySelectorAll('button'))button.disabled=!attendanceAllowed()||attendanceWriteBusy||fieldworkOpening;
 const allowed=attendanceStoreAllowed();$('attendance-store-open').hidden=!allowed;$('attendance-spot-open').hidden=!allowed;
 for(const id of ['attendance-store-open','attendance-store-locate','attendance-store-save','attendance-store-cancel','attendance-spot-open','attendance-spot-save','attendance-spot-cancel'])$(id).disabled=!allowed||attendanceWriteBusy||fieldworkOpening;
 for(const id of ['attendance-store-address','attendance-store-latitude','attendance-store-longitude','attendance-store-radius','attendance-review-decision','attendance-review-note','attendance-review-save','attendance-review-cancel'])$(id).disabled=attendanceWriteBusy;
}
function renderAttendanceStore(){
 const setting=attendanceSnapshot?.locationSettings;
 $('attendance-store-summary').textContent=setting?.configured?'门店打卡位置：'+setting.address+'；允许范围 '+setting.radiusMeters+' 米（WGS84）。':'门店打卡位置尚未设置；签到和签退先记录为待老板核对。';
}
function previewAttendanceStore(){
 const latText=$('attendance-store-latitude').value.trim(),lonText=$('attendance-store-longitude').value.trim(),radiusText=$('attendance-store-radius').value.trim(),
 lat=Number(latText),lon=Number(lonText),radius=Number(radiusText);
 const usable=latText&&lonText&&Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lon)&&lon>=-180&&lon<=180;
 $('attendance-store-preview').textContent=usable?'待保存位置：纬度 '+lat+'，经度 '+lon+'（WGS84）；半径 '+(radiusText&&Number.isInteger(radius)?radius+' 米':'待填写')+'。':'尚无准确坐标。填写地址不会自动转换为地图坐标；请在门店现场取当前位置，或填写 WGS84 经纬度。';
}
function openAttendanceStore(){
 if(!attendanceStoreAllowed()||attendanceWriteBusy||fieldworkOpening)return;
 const setting=attendanceSnapshot.locationSettings||{};
 $('attendance-store-address').value=setting.address||'';
 $('attendance-store-latitude').value=Number.isFinite(setting.latitude)?String(setting.latitude):'';
 $('attendance-store-longitude').value=Number.isFinite(setting.longitude)?String(setting.longitude):'';
 $('attendance-store-radius').value=String(setting.radiusMeters||attendanceSnapshot.locationPolicy?.defaultRadiusMeters||200);
 $('attendance-store-status').textContent='';previewAttendanceStore();syncAttendanceControls();$('attendance-store-dialog').showModal();
}
function closeAttendanceStore(){if(!attendanceWriteBusy)$('attendance-store-dialog').close();}
async function locateAttendanceStore(){
 if(!attendanceStoreAllowed()||attendanceWriteBusy)return;
 const epoch=modeEpoch,ownerId=me.id;attendanceWriteBusy=true;syncAttendanceControls();$('attendance-store-status').textContent='正在读取当前手机位置，请在门店现场允许定位…';
 try{
  const location=await captureAttendanceLocation(()=>epoch===modeEpoch&&attendanceStoreAllowed()&&me.id===ownerId&&$('attendance-store-dialog').open);
  if(epoch!==modeEpoch||!attendanceStoreAllowed()||me.id!==ownerId||!$('attendance-store-dialog').open)return;
  if(!location.locationEvidence){$('attendance-store-status').textContent=attendanceLocationFailureHelp(location.locationFailure)+' 门店坐标尚未保存，也可以填写准确 WGS84 坐标。';return;}
  const evidence=location.locationEvidence;
  $('attendance-store-latitude').value=String(evidence.latitude);$('attendance-store-longitude').value=String(evidence.longitude);previewAttendanceStore();
  $('attendance-store-status').textContent='已填入当前坐标，精度约 '+Math.round(evidence.accuracy)+' 米。请确认就在门店，再点保存；当前还没有保存。'+(evidence.accuracy>100?'当前精度不足100米，建议稍后重新定位。':'');
 }finally{attendanceWriteBusy=false;syncAttendanceControls();}
}
async function saveAttendanceStore(event){
 event.preventDefault();if(!attendanceStoreAllowed()||attendanceWriteBusy)return;
 const address=$('attendance-store-address').value.trim(),latText=$('attendance-store-latitude').value.trim(),lonText=$('attendance-store-longitude').value.trim(),radiusText=$('attendance-store-radius').value.trim(),
 latitude=Number(latText),longitude=Number(lonText),radiusMeters=Number(radiusText);
 if(!address||address.length>300||!latText||!lonText||!Number.isFinite(latitude)||latitude < -90||latitude > 90||!Number.isFinite(longitude)||longitude < -180||longitude > 180||!radiusText||!Number.isInteger(radiusMeters)||radiusMeters<20||radiusMeters>5000){$('attendance-store-status').textContent='请填写门店地址（最多300字）、准确 WGS84 经纬度，以及20到5000米的整数半径。';return;}
 const body={action:'location-settings',address,latitude,longitude,radiusMeters},serialized=JSON.stringify(body),epoch=modeEpoch,ownerId=me.id;
 if(!attendanceStoreRequest||attendanceStoreRequest.serialized!==serialized)attendanceStoreRequest={serialized,key:requestId(),body};
 attendanceWriteBusy=true;syncAttendanceControls();$('attendance-store-status').textContent='正在保存门店打卡位置…';
 try{
  await api('/api/assistant/attendance',attendanceStoreRequest.body,attendanceStoreRequest.key);attendanceStoreRequest=null;
  if(epoch!==modeEpoch||!attendanceAllowed()||me.id!==ownerId)return;
  $('attendance-store-dialog').close();$('attendance-date').value='';await attendance();attendanceMessage('门店打卡位置已保存；这次操作没有登记签到或签退。');
 }catch(error){if(epoch===modeEpoch&&attendanceAllowed()&&me.id===ownerId)$('attendance-store-status').textContent=error.statusCode?'未能保存：'+error.message:'尚未确认保存结果，请保留相同内容重试；修改内容将作为新的设置提交。';}
 finally{attendanceWriteBusy=false;syncAttendanceControls();}
}
function openAttendanceLocationReview(target){
 if(!attendanceStoreAllowed()||attendanceWriteBusy||fieldworkOpening)return;
 attendanceReviewTarget={...target,ownerId:me.id,epoch:modeEpoch};
 $('attendance-review-title').textContent='老板核对'+(target.event==='checkin'?'签到':target.event==='checkout'?'签退':target.event==='start'?'外勤出发':target.event==='checkpoint'?'外勤定位打卡':target.event==='spot-check'?'系统抽查':target.event==='supplement'?'补充':'外勤结束')+'定位';
 $('attendance-review-context').textContent=target.summary||'请结合实际工作情况核对；不改原定位、不自动修改工资。';
 $('attendance-review-decision').value='confirmed';$('attendance-review-note').value='';$('attendance-review-status').textContent='';
 syncAttendanceControls();$('attendance-review-dialog').showModal();
}
function closeAttendanceLocationReview(){if(!attendanceWriteBusy)$('attendance-review-dialog').close();}
async function saveAttendanceLocationReview(event){
 event.preventDefault();const target=attendanceReviewTarget;
 if(!attendanceStoreAllowed()||attendanceWriteBusy||!target||target.ownerId!==me.id||target.epoch!==modeEpoch)return;
 const decision=$('attendance-review-decision').value,note=$('attendance-review-note').value.trim();
 if(!['confirmed','needs-followup'].includes(decision)||!note||note.length>1000){$('attendance-review-status').textContent='请选择核对结果，填写说明（1到1000字）。';return;}
 const body={action:'location-review',event:target.event,decision,note,...(target.requestId?{requestId:target.requestId}:target.attendanceId?{attendanceId:target.attendanceId,...(target.event==='supplement'?{supplementId:target.supplementId}:{})}:{fieldworkId:target.fieldworkId,...(target.event==='checkpoint'?{checkpointId:target.checkpointId}:{})})},serialized=JSON.stringify(body),epoch=modeEpoch,ownerId=me.id;
 if(!attendanceReviewRequest||attendanceReviewRequest.serialized!==serialized)attendanceReviewRequest={serialized,key:requestId(),body};
 attendanceWriteBusy=true;syncAttendanceControls();$('attendance-review-status').textContent='正在保存核对记录…';
 try{
  await api('/api/assistant/attendance',attendanceReviewRequest.body,attendanceReviewRequest.key);attendanceReviewRequest=null;
  if(epoch!==modeEpoch||!attendanceAllowed()||me.id!==ownerId)return;
  $('attendance-review-dialog').close();attendanceReviewTarget=null;await attendance();attendanceMessage('定位核对记录已保存，原定位和工作时间保持原样。');
 }catch(error){if(epoch===modeEpoch&&attendanceAllowed()&&me.id===ownerId)$('attendance-review-status').textContent=error.statusCode?'未能保存：'+error.message:'尚未确认保存结果，请保留相同内容重试。';}
 finally{attendanceWriteBusy=false;syncAttendanceControls();}
}
function renderAttendanceSpotChecks(){
 const data=attendanceSnapshot,requests=Array.isArray(data?.spotCheckRequests)?data.spotCheckRequests:[],
 visible=data?.privileged&&['owner','manager'].includes(me?.roleCode)?requests:requests.filter(row=>row.userId===me?.id),pending=visible.filter(row=>['pending','expired'].includes(row.status)&&!row.respondedAt);
 $('attendance-spot-summary').hidden=!attendanceAllowed()||pending.length===0;
 $('attendance-spot-summary').textContent=pending.length?'抽查待回应 '+pending.length+' 条':'';
 const setting=data?.spotCheckSettings;
 $('attendance-spot-settings-summary').textContent=setting?.enabled?'自动抽查已启用：每天 '+setting.dailyCount+' 次，'+setting.startTime+' 至 '+setting.endTime+'，'+setting.responseMinutes+' 分钟内回应。':'自动抽查尚未启用，由老板设置次数和时段。';
 const box=$('attendance-spot-requests');box.replaceChildren();
 for(const request of visible){
  const awaiting=['pending','expired'].includes(request.status)&&!request.respondedAt,overdue=awaiting&&(request.status==='expired'||Number.isFinite(Date.parse(request.dueAt))&&Number.isFinite(Date.parse(data.asOf))&&Date.parse(data.asOf)>Date.parse(request.dueAt));
  const card=attendanceNode('article','','attendance-record');
  card.append(attendanceNode('strong',(request.name||'本人')+' · '+({pending:'等待回应',responded:'已回应',expired:'已超过回应时间',cancelled:'已取消'}[overdue&&request.status==='pending'?'expired':request.status]||'待核对'),'fieldwork-record-title'));
  card.append(attendanceNode('p','抽查时间：'+attendanceTime(request.createdAt)));
  card.append(attendanceNode('p','回应期限：'+attendanceTime(request.dueAt)));
  if(request.late||overdue)card.append(attendanceNode('p',request.reviewStatus==='已人工核对'?'已超过回应时间；老板已人工核对，不自动认定缺勤或扣工资。':'已超过回应时间，需老板核对；不自动认定缺勤或扣工资。','attendance-note'));
  if(request.reviewStatus)card.append(attendanceNode('p','核对状态：'+request.reviewStatus+(request.reviewRequired&&request.reviewMessage?'；'+request.reviewMessage:''),'attendance-note'));
  if(request.responseLocation){card.append(attendanceNode('p','回应时间：'+attendanceTime(request.respondedAt)));card.append(attendanceLocationNode('抽查定位',request.responseLocation,{event:'spot-check',requestId:request.id,reviewRequired:request.reviewRequired===true||request.reviewRequired===undefined&&request.late===true,reviewMessage:request.reviewMessage}));}
  if(request.userId===me?.id&&awaiting){
   const active=data.rows.some(row=>row.id===request.attendanceId&&row.userId===me.id&&!row.checkOutAt);
   if(active){const button=attendanceNode('button','立即定位打卡');button.type='button';button.onclick=()=>submitAttendance({action:'spot-check-respond',requestId:request.id});card.append(button);}
   else card.append(attendanceNode('p','请先查看本班次出勤记录；已签退不能回应抽查，由老板核对。','attendance-note'));
  }
  box.append(card);
 }
 if(!visible.length)box.append(attendanceNode('p','暂无抽查提醒。'));
}
function openAttendanceSpotSettings(){
 if(!attendanceStoreAllowed()||attendanceWriteBusy||fieldworkOpening)return;
 const setting=attendanceSnapshot.spotCheckSettings||{enabled:false,dailyCount:1,startTime:'09:00',endTime:'18:00',responseMinutes:10};
 $('attendance-spot-enabled').checked=setting.enabled===true;
 $('attendance-spot-count').value=String(setting.dailyCount);
 $('attendance-spot-start').value=setting.startTime;$('attendance-spot-end').value=setting.endTime;
 $('attendance-spot-response').value=String(setting.responseMinutes);$('attendance-spot-status').textContent='';
 syncAttendanceControls();$('attendance-spot-dialog').showModal();
}
function closeAttendanceSpotSettings(){if(!attendanceWriteBusy)$('attendance-spot-dialog').close();}
async function saveAttendanceSpotSettings(event){
 event.preventDefault();if(!attendanceStoreAllowed()||attendanceWriteBusy)return;
 const body={action:'spot-check-settings',enabled:$('attendance-spot-enabled').checked===true,dailyCount:Number($('attendance-spot-count').value),startTime:$('attendance-spot-start').value,endTime:$('attendance-spot-end').value,responseMinutes:Number($('attendance-spot-response').value)};
 const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
 if(!Number.isInteger(body.dailyCount)||body.dailyCount<1||body.dailyCount>10||!validTime(body.startTime)||!validTime(body.endTime)||body.startTime>=body.endTime||!Number.isInteger(body.responseMinutes)||body.responseMinutes<1||body.responseMinutes>60){$('attendance-spot-status').textContent='请设置每天1到10次、同一天由早到晚的时段，以及1到60分钟回应期限。';return;}
 const serialized=JSON.stringify(body),epoch=modeEpoch,ownerId=me.id;
 if(!attendanceSpotSettingsRequest||attendanceSpotSettingsRequest.serialized!==serialized)attendanceSpotSettingsRequest={serialized,key:requestId(),body};
 attendanceWriteBusy=true;syncAttendanceControls();$('attendance-spot-status').textContent='正在保存抽查设置…';
 try{
  await api('/api/assistant/attendance',attendanceSpotSettingsRequest.body,attendanceSpotSettingsRequest.key);attendanceSpotSettingsRequest=null;
  if(epoch!==modeEpoch||!attendanceAllowed()||me.id!==ownerId)return;
  $('attendance-spot-dialog').close();await attendance();attendanceMessage('自动抽查设置已保存；每天计划按服务端规则执行，次数和时段调整从次日起生效。');
 }catch(error){if(epoch===modeEpoch&&attendanceAllowed()&&me.id===ownerId)$('attendance-spot-status').textContent=error.statusCode?'未能保存：'+error.message:'尚未确认保存结果，请保留相同设置重试。';}
 finally{attendanceWriteBusy=false;syncAttendanceControls();}
}
function refreshAttendanceSpotChecks(){
 if(!attendanceAllowed()||attendanceWriteBusy||fieldworkOpening||document.visibilityState!=='visible'||['fieldwork-dialog','attendance-store-dialog','attendance-review-dialog','attendance-spot-dialog'].some(id=>$(id).open))return;
 attendance();
}

function fieldworkRecord(row,active=false){
 const card=attendanceNode('article','','fieldwork-record');
 card.append(attendanceNode('strong',(row.name||'本人')+' · '+(active?'外勤进行中':'下村外勤'),'fieldwork-record-title'));
 card.append(attendanceNode('p','地点：'+(row.location||'未记录')));
 card.append(attendanceNode('p','事项：'+(row.workContent||'下村工作')));
 card.append(attendanceNode('p','开始：'+attendanceTime(row.startAt)));
 card.append(attendanceNode('p',row.endAt?'结束：'+attendanceTime(row.endAt):'结束：尚未结束'));
 card.append(attendanceLocationNode('出发定位',row.startLocation,{fieldworkId:row.id,event:'start'}));
 if(row.endAt)card.append(attendanceLocationNode('结束定位',row.endLocation,{fieldworkId:row.id,event:'end'}));
 card.append(attendanceNode('p','外勤时长：'+attendanceDuration(row.durationSeconds)));
 for(const [pointIndex,point] of (Array.isArray(row.checkpoints)?row.checkpoints:[]).entries()){const visit=attendanceNode('section','','fieldwork-checkpoint');visit.append(attendanceNode('strong','第 '+(pointIndex+1)+' 次定位打卡：'+(point.location||'未记录地点')));visit.append(attendanceNode('p','时间：'+attendanceTime(point.at)));if(point.workContent)visit.append(attendanceNode('p','事项：'+point.workContent));visit.append(attendanceLocationNode('地点定位',point.locationReport,{fieldworkId:row.id,event:'checkpoint',checkpointId:point.id}));card.append(visit);}
 if(active&&row.userId===me?.id){const pointButton=attendanceNode('button','到新地点打卡');pointButton.type='button';pointButton.onclick=()=>openFieldwork('fieldwork-checkpoint',row.id);card.append(pointButton);}
 if(row.autoCheckIn)card.append(attendanceNode('p','已自动登记当天签到','attendance-note'));
 if(active&&row.userId===me?.id){const button=attendanceNode('button','结束本次外勤');button.type='button';button.className='fieldwork-end-button';button.disabled=attendanceWriteBusy;button.onclick=()=>openFieldwork('fieldwork-end',row.id);card.append(button);}
 return card;
}
function syncAttendanceControls(){
 const allowed=attendanceAllowed(),historic=!!attendanceSnapshot&&attendanceSnapshot.date!==attendanceToday(),latest=ownLatestAttendance();
 $('checkin').textContent=latest?.checkOutAt?'重新签到':'签到';
 for(const id of ['attendance-date','attendance-refresh'])$(id).disabled=!allowed||attendanceWriteBusy;
 for(const id of ['checkin','checkout','fieldwork-start'])$(id).disabled=!allowed||attendanceWriteBusy||fieldworkOpening||historic||!attendanceSnapshot;
 $('fieldwork-shortcut').disabled=!allowed||attendanceWriteBusy||fieldworkOpening;
 $('fieldwork-checkpoint-shortcut').disabled=!allowed||attendanceWriteBusy||fieldworkOpening||!attendanceSnapshot;
 $('fieldwork-shortcut').hidden=!allowed;
 for(const button of $('attendance').querySelectorAll('button'))button.disabled=!allowed||attendanceWriteBusy||fieldworkOpening;
 for(const id of ['fieldwork-submit','fieldwork-cancel'])$(id).disabled=attendanceWriteBusy;
 const end=fieldworkTarget?.action==='fieldwork-end';
 for(const id of ['fieldwork-location','fieldwork-content']){$(id).readOnly=end;$(id).disabled=attendanceWriteBusy;}
 syncAttendanceLocationControls();
 $('action-button').disabled=pendingAction?.type==='attendance'&&(!allowed||attendanceWriteBusy||fieldworkOpening);
}
function renderAttendance(){
 const box=$('attendance');box.replaceChildren();const data=attendanceSnapshot;if(!data)return;
 renderAttendanceStore();
 $('attendance-date').value=data.date;
 const current=attendanceNode('section','','attendance-current'),active=Array.isArray(data.activeFieldwork)?data.activeFieldwork:[],
 visibleActive=data.privileged?active:active.filter(row=>row.userId===me.id);
 current.append(attendanceNode('h3',data.privileged?'当前外勤':'我的当前外勤'));
 if(visibleActive.length)for(const row of visibleActive)current.append(fieldworkRecord(row,true));
 else current.append(attendanceNode('p','目前没有正在进行的下村外勤。'));
 box.append(current);
 box.append(attendanceNode('h3',data.date+' 出勤记录'));
 const rows=Array.isArray(data.rows)?data.rows:[],visibleRows=data.privileged?rows:rows.filter(row=>row.userId===me.id);
 for(const row of visibleRows){
  const card=attendanceNode('article','','attendance-record');
  card.append(attendanceNode('strong',(row.name||'本人')+' · '+(row.checkOutAt?'已签退':'已签到'),'fieldwork-record-title'));
  card.append(attendanceNode('p','签到：'+attendanceTime(row.checkInAt)));
  card.append(attendanceLocationNode('签到定位',row.checkInLocation,{attendanceId:row.id,event:'checkin'}));
  if(ownAttendanceSupplementRow(row.id)){const button=attendanceNode('button','补定位');button.type='button';button.className='attendance-supplement-button';button.onclick=()=>openAttendanceSupplement(row.id);card.append(button);card.append(attendanceNode('p','补充的是现在位置，原签到时间和记录保留；不能证明早先签到时的位置。','attendance-note'));}
  for(const point of Array.isArray(row.locationSupplements)?row.locationSupplements:[]){const supplement=attendanceNode('section','','attendance-supplement-record');supplement.append(attendanceNode('strong','补充定位：'+attendanceTime(point.at)));supplement.append(attendanceLocationNode('补充的当前位置',point.locationReport,{attendanceId:row.id,event:'supplement',supplementId:point.id}));card.append(supplement);}
  card.append(attendanceNode('p',row.checkOutAt?'签退：'+attendanceTime(row.checkOutAt):'签退：尚未签退'));
  if(row.checkOutAt)card.append(attendanceLocationNode('签退定位',row.checkOutLocation,{attendanceId:row.id,event:'checkout'}));
  card.append(attendanceNode('p','工作时长（含外勤）：'+attendanceDuration(row.workSeconds),'attendance-total'));
  card.append(attendanceNode('p','其中外勤：'+attendanceDuration(row.fieldworkSeconds)));
  for(const segment of Array.isArray(row.fieldwork)?row.fieldwork:[]){if(visibleActive.some(active=>active.id===segment.id&&active.userId===segment.userId))continue;card.append(fieldworkRecord(segment,!segment.endAt));}
  box.append(card);
 }
 if(!visibleRows.length)box.append(attendanceNode('p','所选日期没有'+(data.privileged?'员工':'本人')+'签到记录。'));
 if(data.privileged)box.append(attendanceNode('p','在职员工 '+data.expected+' 人；未登记：'+((data.notRecorded||[]).join('、')||'无')+'。未登记不能认定缺勤。','attendance-note'));
 if(data.date!==attendanceToday())box.append(attendanceNode('p','当前正在查看历史记录。要签到或开始下村外勤，请选择今天。','attendance-note'));
 renderAttendanceSpotChecks();
 syncAttendanceControls();
}
function resetAttendanceView(){
 cancelAttendanceLocationRun();
 attendanceLoadGeneration++;attendanceSnapshot=null;fieldworkOpening=false;fieldworkTarget=null;fieldworkRequest=null;
 $('attendance-date').value='';$('attendance').replaceChildren();attendanceMessage('');
 if($('fieldwork-dialog').open)$('fieldwork-dialog').close();
 if($('attendance-store-dialog').open)$('attendance-store-dialog').close();
 attendanceStoreRequest=null;attendanceReviewTarget=null;attendanceReviewRequest=null;attendanceSpotSettingsRequest=null;if($('attendance-spot-dialog').open)$('attendance-spot-dialog').close();$('attendance-spot-summary').hidden=true;if($('attendance-review-dialog').open)$('attendance-review-dialog').close();$('attendance-store-summary').textContent='门店打卡位置尚未核对。';
 syncAttendanceControls();
}
async function attendance(){
 if(!attendanceAllowed())return null;
 const generation=++attendanceLoadGeneration,epoch=modeEpoch,ownerId=me.id,date=$('attendance-date').value,
 current=()=>generation===attendanceLoadGeneration&&epoch===modeEpoch&&attendanceAllowed()&&me.id===ownerId;
 if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)){attendanceMessage('请选择有效日期。',true);return null;}
 try{
  const data=await api('/api/assistant/attendance'+(date?'?date='+encodeURIComponent(date):''));
  if(!current())return null;
  if(!data||!Array.isArray(data.rows)||!Array.isArray(data.activeFieldwork)||!/^\d{4}-\d{2}-\d{2}$/.test(data.date))throw Error('出勤记录格式不完整，请刷新重试。');
  attendanceSnapshot=data;renderAttendance();return data;
 }catch(error){if(current()){attendanceSnapshot=null;$('attendance').replaceChildren();attendanceMessage('无法读取出勤记录：'+error.message,true);syncAttendanceControls();}return null;}
}
function closeFieldwork(){if(attendanceLocationRun)cancelAttendanceLocationRun();if(!attendanceWriteBusy||attendanceLocationRun?.cancelled)$('fieldwork-dialog').close();}
async function openFieldwork(action,expectedId){
 if(!attendanceAllowed()||attendanceWriteBusy||fieldworkOpening||!['fieldwork-start','fieldwork-end','fieldwork-checkpoint'].includes(action))return;
 fieldworkOpening=true;syncAttendanceControls();const epoch=modeEpoch,ownerId=me.id;
 try{
  if(!await attendance()||epoch!==modeEpoch||!attendanceAllowed()||me.id!==ownerId)return;
  const active=ownActiveFieldwork();
  if(action==='fieldwork-start'&&active){revealAssistantPanel('attendance-panel');attendanceMessage('已有外勤进行中，请先结束“'+active.location+'”再开始下一处。',true);return;}
  if(action==='fieldwork-start'&&attendanceSnapshot.date!==attendanceToday()){revealAssistantPanel('attendance-panel');attendanceMessage('请先选择今天，再开始下村外勤。',true);return;}
  if(['fieldwork-end','fieldwork-checkpoint'].includes(action)&&(!active||expectedId&&active.id!==expectedId)){revealAssistantPanel('attendance-panel');attendanceMessage(action==='fieldwork-checkpoint'?'请先开始下村外勤，再到新地点定位打卡。':'本次外勤已结束，或当前没有本人正在进行的外勤，请查看最新记录。');return;}
  const row=ownLatestAttendance();
  if(action==='fieldwork-start'&&row?.checkOutAt){revealAssistantPanel('attendance-panel');attendanceMessage('已在 '+attendanceTime(row.checkOutAt)+' 签退。请先点“重新签到”恢复工作，再开始下村外勤。');return;}
  fieldworkTarget={action,fieldworkId:active?.id||null,ownerId,epoch};
  $('fieldwork-title').textContent=action==='fieldwork-start'?'登记下村外勤':action==='fieldwork-checkpoint'?'定位打卡':'结束本次外勤';
  $('fieldwork-hint').textContent=action==='fieldwork-start'?'填好后开始。今天尚未签到时，系统会同时登记本人签到；时间以服务器记录为准。':action==='fieldwork-checkpoint'?'每到新地点填写村名/地点，再保存手机定位。可重复打卡，只追加地点记录，不新建班次，不重复累计工作时间。':'核对地点后结束。只结束本人这一段外勤，不会自动签退。';
  $('fieldwork-location').value=action!=='fieldwork-end'?'':active.location;
  $('fieldwork-content').value=action!=='fieldwork-end'?'':active.workContent||'下村工作';
  $('fieldwork-submit').textContent=action==='fieldwork-start'?'开始下村工作':action==='fieldwork-checkpoint'?'保存本次定位':'确认结束外勤';
  $('fieldwork-status').textContent='';syncAttendanceControls();$('fieldwork-dialog').showModal();
  if(action!=='fieldwork-end')$('fieldwork-location').focus();else $('fieldwork-submit').focus();
 }finally{fieldworkOpening=false;syncAttendanceControls();}
}
function ownAttendanceSupplementRow(expectedId){
 if(!attendanceAllowed()||!attendanceSnapshot||attendanceSnapshot.date!==attendanceToday())return null;
 const rows=(Array.isArray(attendanceSnapshot.rows)?attendanceSnapshot.rows:[]).filter(row=>row.userId===me.id&&!row.checkOutAt);
 return rows.length===1&&rows[0].id===expectedId&&rows[0].checkInAt?rows[0]:null;
}
async function openAttendanceSupplement(expectedId){
 if(!attendanceAllowed()||attendanceWriteBusy||fieldworkOpening||$('fieldwork-dialog').open||!ownAttendanceSupplementRow(expectedId))return false;
 const epoch=modeEpoch,ownerId=me.id;fieldworkOpening=true;syncAttendanceControls();
 try{
  if(!await attendance()||epoch!==modeEpoch||!attendanceAllowed()||me.id!==ownerId)return false;
  if(!ownAttendanceSupplementRow(expectedId)){attendanceMessage('该签到记录已签退，或当前班次已变化，请查看最新出勤记录。',true);return false;}
  return await submitAttendance({action:'location-supplement',attendanceId:expectedId});
 }finally{fieldworkOpening=false;syncAttendanceControls();}
}
async function submitAttendance(body,actionToClear=null){
 if(!attendanceAllowed()||attendanceWriteBusy||!attendancePageVisible())return false;
 const supplement=body.action==='location-supplement';
 if(supplement&&!ownAttendanceSupplementRow(body.attendanceId))return false;
 const run=beginAttendanceLocationRun(),serialized=JSON.stringify(body);
 attendanceWriteBusy=true;syncAttendanceControls();attendanceRunProgress(run,supplement?'正在补定位，请稍候…':'等待允许定位，正在读取手机位置，请稍候…');
 try{
  if(['checkin','checkout'].includes(body.action)&&!attendanceRunRequestMatches(run,serialized)){
   $('attendance-date').value='';
   if(!run.current()||!await attendance()||!run.current())return false;
   const latest=ownLatestAttendance(),active=ownActiveFieldwork();
   if(body.action==='checkin'&&(latest&&!latest.checkOutAt||active)){
    const message='已在 '+attendanceTime(latest?.checkInAt||active?.startAt)+' 签到。本次未重复记录。';
    attendanceMessage(message);$('status').textContent=message;
    if(latest&&!latest.checkOutAt)await autoSupplementAttendanceLocation(run,latest.id);
    return true;
   }
   if(body.action==='checkout'&&latest?.checkOutAt){
    const message='已在 '+attendanceTime(latest.checkOutAt)+' 签退。本次未重复记录。'+(me?.roleCode==='owner'?'管理员账号继续可办理业务。':'工作操作已锁定，请重新签到恢复。');
    attendanceMessage(message);$('status').textContent=message;if(run.current())await attendancePublishWorkLock(body.action,latest);return true;
   }
   if(body.action==='checkout'&&!latest&&!active){attendanceMessage('当前没有本人已签到的班次，请先签到，再签退。',true);return false;}
  }
  if(!attendanceRunRequestMatches(run,serialized)){
   const location=await captureAttendanceLocation(()=>run.current()&&(!supplement||!!ownAttendanceSupplementRow(body.attendanceId)),{signal:run.controller.signal,onRetry:()=>attendanceRunProgress(run,'手机暂未取得位置，正在自动重试，请稍候…')});
   if(!run.current()||location.locationCancelled)return false;
   if(location.locationBusy){attendanceMessage('上次定位尚未结束，请稍后再试；本次没有提交打卡。',true);return false;}
   if(supplement&&!ownAttendanceSupplementRow(body.attendanceId)){attendanceMessage('当前班次已变化，本次没有提交补定位，请查看最新记录。',true);return false;}
   if(supplement&&!location.locationEvidence){const message=attendanceLocationFailureHelp(location.locationFailure)+' 本次未提交补定位，原签到记录保留；仍待老板核对。';attendanceMessage(message,false,'pending');$('status').textContent=message;return false;}
   fieldworkRequest={serialized,key:requestId(),body:{...body,...location},ownerId:run.ownerId,epoch:run.epoch,marker:run.marker};
  }
  if(!run.current())return false;
  if(supplement&&!ownAttendanceSupplementRow(body.attendanceId)){attendanceMessage('当前班次已变化，本次没有提交补定位，请查看最新记录。',true);return false;}
  const request=fieldworkRequest,warning=attendanceLocationWarning(request.body);
  attendanceRunProgress(run,warning||'已取得手机定位，正在保存打卡记录…');
  const result=await attendanceRunApi(run,'/api/assistant/attendance',request.body,request.key);
  const verdict=attendanceResultLocation(body.action,result),reviewRequired=verdict?.status==='待老板核对'||result?.request?.reviewRequired===true||result?.request?.reviewRequired===undefined&&result?.request?.late===true,locationSummary=verdict?attendanceLocationText(verdict):warning;
  if(fieldworkRequest===request)fieldworkRequest=null;
  if(!run.current())return true;
  if(actionToClear&&pendingAction===actionToClear){pendingAction=null;$('action').hidden=true;}
  const message=attendanceResultMessage(body,result,supplement);
  if(!supplement){fieldworkTarget=null;if($('fieldwork-dialog').open)$('fieldwork-dialog').close();}
  $('attendance-date').value='';attendanceMessage(message+(locationSummary?' '+locationSummary:''),false,result?.feedback?.repeated?'info':reviewRequired||!!warning?'pending':attendanceLocationTone(verdict));$('status').textContent=message+(locationSummary?' '+locationSummary:'');
  if(run.current())await attendancePublishWorkLock(body.action,result);
  if(run.current())await attendance();
  if(run.current()&&body.action==='checkin'&&result?.userId===run.ownerId&&result.id)await autoSupplementAttendanceLocation(run,result.id);
  return true;
 }catch(error){
  const message=error.statusCode===423?'已签退，工作操作已锁定。请重新签到恢复；原签退时间见出勤记录。':error.statusCode?'未能保存：'+error.message:'未能确认保存结果，请用相同内容重试，并核对最新记录。';
  if(run.current()){attendanceMessage(message,true);$('status').textContent=message;if($('fieldwork-dialog').open)$('fieldwork-status').textContent=message;}
  return false;
 }finally{if(attendanceLocationRun===run)attendanceLocationRun=null;attendanceWriteBusy=false;syncAttendanceControls();}
}
$('fieldwork-form').onsubmit=async event=>{
 event.preventDefault();const target=fieldworkTarget;
 if(!target||attendanceWriteBusy||!attendanceAllowed()||target.ownerId!==me.id||target.epoch!==modeEpoch)return;
 let body;
 if(['fieldwork-start','fieldwork-checkpoint'].includes(target.action)){
  const location=$('fieldwork-location').value.trim(),workContent=$('fieldwork-content').value.trim()||'下村工作';
  if(!location||location.length>120||workContent.length>300){$('fieldwork-status').textContent='请填写村名/地点（最多120字），事项最多300字。';$('fieldwork-location').focus();return;}
  if(target.action==='fieldwork-checkpoint'&&!target.fieldworkId)return;
  body={action:target.action,location,workContent,...(target.action==='fieldwork-checkpoint'?{fieldworkId:target.fieldworkId}:{})};
 }else{if(!target.fieldworkId)return;body={action:target.action,fieldworkId:target.fieldworkId};}
 await submitAttendance(body,target.pendingAction||null);
};
$('fieldwork-cancel').onclick=closeFieldwork;
$('fieldwork-dialog').addEventListener('cancel',event=>{if(attendanceLocationRun)cancelAttendanceLocationRun();else if(attendanceWriteBusy)event.preventDefault();});
$('fieldwork-dialog').addEventListener('close',()=>{if(!attendanceWriteBusy){fieldworkTarget=null;$('fieldwork-status').textContent='';}});
$('fieldwork-start').onclick=()=>openFieldwork('fieldwork-start');
$('fieldwork-shortcut').onclick=()=>{$('attendance-date').value='';revealAssistantPanel('attendance-panel');attendance();};
$('attendance-date').onchange=()=>{attendanceMessage('');attendance();};
$('attendance-refresh').onclick=()=>{attendanceMessage('');attendance();};
for(const action of ['checkin','checkout'])$(action).onclick=()=>submitAttendance({action});
$('attendance-store-open').onclick=openAttendanceStore;
$('attendance-spot-open').onclick=openAttendanceSpotSettings;
$('attendance-spot-form').onsubmit=saveAttendanceSpotSettings;
$('attendance-spot-cancel').onclick=closeAttendanceSpotSettings;
$('attendance-spot-dialog').addEventListener('cancel',event=>{if(attendanceWriteBusy)event.preventDefault();});
setInterval(refreshAttendanceSpotChecks,30000);
document.addEventListener?.('visibilitychange',()=>{if(!attendancePageVisible())cancelAttendanceLocationRun();refreshAttendanceSpotChecks();});
window.addEventListener('pagehide',cancelAttendanceLocationRun);
window.addEventListener('storage',event=>{if(event.key==='store-session-logout-v1')cancelAttendanceLocationRun();});
window.addEventListener('click',event=>{if(event.target?.closest?.('.session-logout,.mobile-logout,#logout'))cancelAttendanceLocationRun();},true);
$('attendance-store-locate').onclick=locateAttendanceStore;
$('fieldwork-checkpoint-shortcut').onclick=()=>openFieldwork('fieldwork-checkpoint');
if(typeof location!=='undefined'&&new URLSearchParams(location.search).get('work-signin')==='1'){
 $('attendance-date').value='';revealAssistantPanel('attendance-panel');
}
$('attendance-store-form').onsubmit=saveAttendanceStore;
$('attendance-store-cancel').onclick=closeAttendanceStore;
$('attendance-store-dialog').addEventListener('cancel',event=>{if(attendanceWriteBusy)event.preventDefault();});
$('attendance-review-form').onsubmit=saveAttendanceLocationReview;
$('attendance-review-cancel').onclick=closeAttendanceLocationReview;
$('attendance-review-dialog').addEventListener('cancel',event=>{if(attendanceWriteBusy)event.preventDefault();});
$('attendance-review-dialog').addEventListener('close',()=>{if(!attendanceWriteBusy)attendanceReviewTarget=null;});
for(const id of ['attendance-store-address','attendance-store-latitude','attendance-store-longitude','attendance-store-radius'])$(id).addEventListener('input',previewAttendanceStore);

async function reports(){if(assistantMode==='customer')return;try{const rows=await api('/api/assistant/reports');$('reports').replaceChildren();for(const r of rows){const box=document.createElement('div');box.className='report';const h=document.createElement('strong');h.textContent=r.author+' · '+r.status;const p=document.createElement('p');p.textContent=r.text;const t=document.createElement('small');t.textContent=time(r.createdAt)+' · '+documentNo(r);box.append(h,p,t);if(r.reviewNote){const n=document.createElement('p');n.textContent='核实说明：'+r.reviewNote;box.append(n)}if(me.roleCode==='owner'&&r.status==='待老板核实')for(const status of ['已核实','无需处理']){const b=document.createElement('button');b.textContent=status;b.onclick=()=>openReportReview(r,status);box.append(b)}$('reports').append(box)}if(!rows.length)$('reports').textContent='暂无情况报告。'}catch(e){$('report-status').textContent=e.message}}
let reportReviewTarget=null,reportReviewBusy=false;
function openReportReview(row,status){
 if(assistantMode!=='store'||me?.roleCode!=='owner'||reportReviewBusy)return;
 reportReviewTarget={id:row.id,status};$('report-review-title').textContent=status==='已核实'?'确认情况已核实':'确认情况无需处理';
 $('report-review-content').textContent=row.author+'：'+row.text;$('report-review-note').value='';$('report-review-status').textContent='';
 $('report-review-dialog').showModal();$('report-review-note').focus();
}
$('report-review-cancel').onclick=()=>{if(!reportReviewBusy)$('report-review-dialog').close();};
$('report-review-dialog').addEventListener('cancel',e=>{if(reportReviewBusy)e.preventDefault();});
$('report-review-dialog').addEventListener('close',()=>{if(!reportReviewBusy)reportReviewTarget=null;});
$('report-review-form').onsubmit=async event=>{
 event.preventDefault();if(reportReviewBusy||!reportReviewTarget||assistantMode!=='store'||me?.roleCode!=='owner')return;
 const target=reportReviewTarget;reportReviewBusy=true;$('report-review-submit').disabled=true;$('report-review-cancel').disabled=true;$('report-review-status').textContent='正在保存…';
 try{await api('/api/assistant/reports/review',{...target,note:$('report-review-note').value.trim()});await reports();$('report-status').textContent='已处理：'+target.status;reportReviewBusy=false;reportReviewTarget=null;$('report-review-dialog').close();}
 catch(error){$('report-review-status').textContent=error.message;}
 finally{reportReviewBusy=false;$('report-review-submit').disabled=false;$('report-review-cancel').disabled=false;}
};
$('report-form').onsubmit=async e=>{e.preventDefault();const text=$('report-text').value.trim();if(!text)return;$('report-status').textContent='提交中…';try{await api('/api/assistant/reports',{text});$('report-text').value='';$('report-status').textContent='已提交老板待核实，并留下操作记录。';reports()}catch(e){$('report-status').textContent=e.message}};

const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
const voiceButtons=[$('voice'),$('voice-start')];let dictationBase='',dictationGeneration=0;
function setVoiceButtonState(){for(const button of voiceButtons){button.disabled=!Speech;button.textContent=!Speech?'可用键盘麦克风输入':voiceSession?'■ 结束录音，检查文字':'🎙 语音转文字'}}
function pauseVoiceCapture(){if(voiceSession)stopVoiceSession(false)}
function stopVoiceSession(showStatus=true){
  if(voiceSession){$('question').value=[dictationBase,voiceBuffer,voiceInterim].filter(Boolean).join(' ').trim();}
  voiceSession=false;voicePaused=true;dictationGeneration++;clearTimeout(voiceRestartTimer);
  const rec=activeRecognition;activeRecognition=null;if(rec)try{rec.abort()}catch{}setVoiceButtonState();
  if(showStatus)$('status').textContent='已转成文字，请检查后点发送。';
}
function resumeVoiceCapture(){
  if(!Speech||!voiceSession||activeRecognition)return;const generation=dictationGeneration,rec=new Speech();activeRecognition=rec;rec.lang='zh-CN';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
  rec.onstart=()=>{if(generation===dictationGeneration)$('status').textContent='正在转文字，可一次说完；结束后检查并发送。'};
  rec.onresult=e=>{
    if(generation!==dictationGeneration||!voiceSession)return;let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){const text=e.results[i][0]?.transcript?.trim();if(!text)continue;if(e.results[i].isFinal)voiceBuffer+=(voiceBuffer?' ':'')+text;else interim+=text}
    voiceInterim=interim;$('question').value=[dictationBase,voiceBuffer,voiceInterim].filter(Boolean).join(' ');$('status').textContent='正在转文字，点麦克风结束后检查发送。';
  };
  rec.onerror=e=>{if(generation!==dictationGeneration)return;if(['not-allowed','service-not-allowed','audio-capture','network'].includes(e.error)){stopVoiceSession(false);$('status').textContent=e.error==='network'?'语音网络暂不可用，已有文字已保留，可继续打字。':'麦克风暂不可用，请允许权限或使用键盘麦克风。'}};
  rec.onend=()=>{if(generation!==dictationGeneration)return;activeRecognition=null;if(!voiceSession)return;
    // A browser may end recognition after a pause. Preserve the words and resume dictation, without submitting.
    if(voiceInterim){voiceBuffer+=(voiceBuffer?' ':'')+voiceInterim;voiceInterim=''}
    voiceRestartTimer=setTimeout(resumeVoiceCapture,350);
  };
  try{rec.start()}catch{activeRecognition=null;stopVoiceSession(false);$('status').textContent='语音无法启动，可继续文字输入。'}
}
function startVoiceSession(){if(voiceSession){stopVoiceSession();return}stopSpeech();dictationGeneration++;dictationBase=$('question').value.trim();voiceBuffer='';voiceInterim='';voiceSession=true;voicePaused=false;setVoiceButtonState();resumeVoiceCapture()}
for(const button of voiceButtons)button.onclick=startVoiceSession;setVoiceButtonState();
window.SaleCapture?.mount(code=>{
 if(assistantMode!=='store'||!me?.capabilities.sell||!saleEditable())return;
 const token=String(code||'').trim().replace(/^JY1:/,'');
 if(!/^[a-z0-9-]{4,40}$/i.test(token)){$('sale-scan-status').textContent='识别内容不是串号，请扫描串号条码或手动输入。';return}
 stopVoiceSession(false);const instruction=(saleFlow?'':'开销售单，手机，')+'串号'+token;$('question').value=instruction;ask(instruction);
});
window.addEventListener('pagehide',()=>stopVoiceSession(false));
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent)return;if(event.data?.type==='assistant:close'){assistantVisible=false;stopVoiceSession(false);stopSpeech();window.SaleCapture?.stop();}else if(event.data?.type==='assistant:open')assistantVisible=true;});

let phraseRows=[];
async function loadPhrases(){
  phraseRows=await api('/api/assistant/phrases');
  $('phrase-list').replaceChildren();
  for(const row of phraseRows){
    const div=document.createElement('div');div.className='phrase-row';
    const name=document.createElement('span');name.textContent=(row.builtIn?'常用预设 · ':'自己添加 · ')+row.phrase+' → '+row.targetLabel;
    div.append(name);
    if(!row.builtIn){
      const edit=document.createElement('button');edit.type='button';edit.textContent='编辑';edit.onclick=()=>{const form=$('phrase-form');form.elements.id.value=row.id;form.elements.phrase.value=row.phrase;form.elements.target.value=row.target;form.elements.phrase.focus()};
      const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.onclick=async()=>{if(!confirm('删除这条助理说法？'))return;try{await api('/api/assistant/phrases/delete',{id:row.id});await loadPhrases();$('phrase-status').textContent='已删除'}catch(e){$('phrase-status').textContent=e.message}};
      div.append(edit,remove);
    }
    $('phrase-list').append(div);
  }
}
$('phrase-cancel').onclick=()=>$('phrase-form').reset();
$('phrase-form').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));$('phrase-status').textContent='保存中…';try{await api('/api/assistant/phrases',body);e.currentTarget.reset();await loadPhrases();$('phrase-status').textContent='已保存，助理现在能按这条说法理解'}catch(error){$('phrase-status').textContent=error.message}};

function applyMode(){
 if(assistantMode==='customer')resetAttendanceView();else syncAttendanceControls();
 $('prepare-sale').hidden=assistantMode!=='store'||!me;$('prepare-sale').disabled=!me?.capabilities.sell;$('prepare-reception').hidden=assistantMode!=='store'||!me;
 document.title=assistantMode==='customer'?'小猫咪机器人':'工作助理';$('assistant-title').textContent=document.title;$('personal-entry').hidden=assistantMode==='customer'||me?.roleCode!=='owner';document.querySelector('.mode-panel').hidden=customerLocked||assistantEmbedded;
 document.documentElement.classList.toggle('customer-mode',assistantMode==='customer');
 document.documentElement.classList.toggle('customer-editor',assistantMode==='customer'&&isDialogueOwner());
 $('mode-store').setAttribute('aria-pressed',String(assistantMode==='store'));$('mode-customer').setAttribute('aria-pressed',String(assistantMode==='customer'));
 $('assistant-home').hidden=false;$('mode-store').hidden=customerLocked;$('mode-store').disabled=customerLocked;
 $('mode-hint').textContent=assistantMode==='customer'?(customerLocked?'固定顾客模式：仅提供商品和业务咨询。':'顾客模式：仅提供商品和业务咨询。切换会清除之前的对话。'):'店内模式：按本账号权限查看业务和账务。';
 $('hero-title').textContent=assistantMode==='customer'?'选商品，问业务，轻松办':'问账套，找单据，办事情';
 $('hero-description').textContent=assistantMode==='customer'?'可以咨询号卡、套餐、宽带和商品，具体办理由营业员核对。':'只按当前账号可见的已录入数据回答。开单草稿由人确认后才入账。';
 $('who').textContent=assistantMode==='customer'?(isDialogueOwner()?'顾客咨询 · 老板预览':'顾客咨询'):me?me.name+' · '+(me.role||'已登录'):'确认身份中';
 for(const id of ['attendance-panel','report-panel','capability-panel'])$(id).hidden=assistantMode==='customer';
 $('supervision-panel').hidden=assistantMode==='customer'||!['owner','manager'].includes(me?.roleCode);
 for(const id of ['phrase-panel','dialogue-panel','dialogue-shortcut','answer-feedback-shortcut'])$(id).hidden=assistantMode==='customer'||me?.roleCode!=='owner';
 setPairEditing(false);
}
function setMode(mode){
 if(attendanceWriteBusy){$('status').textContent='请先确认出勤记录的保存结果，再切换模式。';return;}
 if(customerLocked&&mode!=='customer')return;
 // Mode choices in the floating panel open the corresponding full chat page.
 if(window.top&&window.top!==window){
  if(saleSubmitting||saleFlow?.submission){$('status').textContent='请先重试确认这张销售单的提交结果。';return}
  stopVoiceSession();navigate('/assistant?mode='+mode);return;
 }
 if(mode===assistantMode)return;
 if(saleSubmitting||saleFlow?.submission){$('status').textContent='请先重试确认这张销售单的提交结果。';return}
 window.SaleCapture?.stop();modeEpoch++;assistantMode=mode;resetAttendanceView();$('sale-review-dialog').close();$('sale-review-body').replaceChildren();stopVoiceSession();clearConversation();voiceBusy=false;draft=null;pendingAction=null;
 capabilityItems=[];if($('capability-search'))$('capability-search').value='';
 for(const id of ['answer','basis','draft-text','sources','followups','flow-choices','data-table','alert-list','attendance','reports','capability-list','supervision-summary','phrase-list','dialogue-history'])$(id).replaceChildren();
 $('question').value='';$('report-text').value='';$('phrase-form').reset();$('dialogue-form').reset();dialogueRows=[];editingDialogue=null;$('dialogue-select').replaceChildren();
 applyMode();try{window.localStorage?.setItem(modeKey,assistantMode)}catch{}
 $('status').textContent=assistantMode==='customer'?'已进入顾客模式':'已进入店内模式';
 setSpeechButtons();
 if(assistantMode==='store'&&me){restorePendingSale();attendance();reports();loadCapabilities();loadSupervision();if(me.roleCode==='owner'){loadPhrases();loadDialogues()}}
}
$('mode-store').onclick=()=>setMode('store');$('mode-customer').onclick=()=>setMode('customer');
$('personal-entry').onclick=event=>{event.preventDefault();if(assistantMode!=='store'||me?.roleCode!=='owner')return;stopVoiceSession();navigate('/companion')};
let dialogueRows=[],editingDialogue=null;
const splitQuestionWays=value=>String(value||'').split(/[\/／\r\n]+/).map(x=>x.trim()).filter(Boolean);
function editDialogue(row){
 editingDialogue=row||null;$('dialogue-title').value=row?.title||'';$('dialogue-questions').value=(row?.questions||[]).join(' / ');$('dialogue-answer').value=row?.answer||'';$('dialogue-mandarin').value=row?.answerMandarin||'';
 $('dialogue-enabled').checked=row?.enabled!==false;$('dialogue-public').checked=row?.customerVisible!==false;
 $('dialogue-slot').textContent=row?.slot?'流程提示：'+row.title+'。请保留所问内容的含义，助理按这个步骤接收下一句回答。':'自定义问答按整句匹配；顾客的不同说法用 / 分隔。';
 $('dialogue-history').replaceChildren();for(const revision of [...(row?.history||[])].reverse()){const p=document.createElement('p');p.textContent='第'+revision.version+'版 · '+revision.changedBy+' · '+time(revision.changedAt)+'\n'+revision.answer;$('dialogue-history').append(p)}
 if(!row?.history?.length)$('dialogue-history').textContent='尚无修改记录。';
}
async function loadDialogues(){
 if(assistantMode==='customer'||me?.roleCode!=='owner')return;const epoch=modeEpoch;
 try{const view=await api('/api/assistant/dialogues');if(epoch!==modeEpoch)return;dialogueRows=view.items||[];$('dialogue-search').value='';const selected=editingDialogue?.id;$('dialogue-select').replaceChildren();
 for(const row of dialogueRows){const option=document.createElement('option');option.value=row.id;option.textContent=row.title+' · '+(row.enabled?'启用':'停用')+' · 第'+row.version+'版';$('dialogue-select').append(option)}
 const row=dialogueRows.find(x=>x.id===selected)||dialogueRows[0];if(row)$('dialogue-select').value=row.id;editDialogue(row);
 }catch(error){if(epoch===modeEpoch)$('dialogue-status').textContent=error.message}
}

$('dialogue-search').oninput=()=>{const q=$('dialogue-search').value.trim().toLowerCase(),rows=dialogueRows.filter(row=>[row.title,...row.questions].join(' ').toLowerCase().includes(q));$('dialogue-select').replaceChildren();for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.title+' · '+(row.enabled?'启用':'停用')+' · 第'+row.version+'版';$('dialogue-select').append(option)}if(rows.length){$('dialogue-select').value=rows[0].id;editDialogue(rows[0]);$('dialogue-status').textContent='找到 '+rows.length+' 条问答'}else{editDialogue(null);$('dialogue-status').textContent='没有找到，可点击新增问答。'}};
$('dialogue-select').onchange=()=>{editDialogue(dialogueRows.find(x=>x.id===$('dialogue-select').value));$('dialogue-status').textContent=''};
$('dialogue-new').onclick=()=>{editDialogue(null);$('dialogue-select').value='';$('dialogue-status').textContent='正在新增问答';$('dialogue-title').focus()};
$('dialogue-reload').onclick=loadDialogues;
function revealAssistantPanel(id){
 workChat.menu(true);const module=$(id)?.closest('.chat-module');if(module)module.open=true;
 const panel=$(id);if(!panel||panel.hidden)return;
 for(let ancestor=panel.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;
 panel.scrollIntoView({behavior:'smooth',block:'start'});
}
$('dialogue-shortcut').onclick=()=>revealAssistantPanel('dialogue-panel');
function resetAnswerEditor(){
 answerEditGeneration++;answerEditLoad=null;setAnswerEditBusy(false);setPairEditing(false);$('question').style.height='';
 displayedReply=null;inlineDialogue=null;$('edit-answer').hidden=true;$('answer').hidden=false;$('answer').readOnly=true;$('answer-edit-label').hidden=true;$('answer-edit-more').open=false;$('answer-edit-form').hidden=true;$('answer-edit-form').reset();$('answer-edit-status').hidden=true;$('answer-edit-status').textContent='';$('answer-edit-title').textContent='';$('answer-edit-hint').textContent='';
}
function editableDialogueId(data){
 if(data.metrics?.dialogueId)return data.metrics.dialogueId;
 if(data.metrics?.kind==='customer-talk-guidance'&&data.metrics.articleId&&!data.metrics.originalRequested)return 'knowledge:'+data.metrics.articleId;
 return null;
}
function setAnswerEditable(data,question,requestContext){
 const id=editableDialogueId(data),publicReply=assistantMode==='customer'&&isDialogueOwner()&&!data.metrics?.restricted&&!data.table&&!data.action&&!data.draft&&!data.saleFlow&&(['assistant-social','kitty-chat'].includes(data.metrics?.kind)||data.metrics?.kind==='external-chat'&&data.metrics.intent==='chat');
 const canCreate=data.unresolved===true||data.metrics?.unresolved===true||publicReply;
 displayedReply={data,question,requestContext,id,style:answerReplyStyle,canCreate,correctionOnly:!id&&!canCreate};
 setPairEditing(false);setAnswerAccess();resizeAnswerBox();
}
function answerEditStatus(message,state=''){const box=$('answer-edit-status');box.hidden=!message;box.textContent=message;box.setAttribute('data-state',state)}
function closeAnswerEdit(){
 answerEditGeneration++;answerEditLoad=null;setAnswerEditBusy(false);inlineDialogue=null;$('question').style.height='';$('answer').hidden=false;$('answer-edit-label').hidden=true;$('answer-edit-more').open=false;$('answer-edit-form').reset();$('answer').value=displayedReply?.data.answer||'';setPairEditing(false);setAnswerAccess();resizeAnswerBox();setSpeechButtons();
}

// Keep both original fields in one modal; moving DOM preserves values and listeners.
let answerEditGeneration=0,answerEditSaving=false,answerComposeOriginal='';
let answerEditScroll=null;
const answerEditorHomes=[];
function setAnswerEditBusy(busy){
 answerEditSaving=busy;
 $('answer-edit-cancel').disabled=busy;$('answer-edit-dialog-close').disabled=busy;
 if(!busy){$('answer-edit-save').disabled=false;$('ask').querySelector('.send-key').disabled=false}
}
function presentAnswerEditor(){
 const dialog=$('answer-edit-dialog');if(!canEditPair()||dialog.open)return;
 answerComposeOriginal=$('question').value;
 answerEditScroll={thread:$('work-thread').scrollTop,page:window.scrollY||0};
 const slots=[
  ['question','answer-edit-question-slot'],['answer-edit-label','answer-edit-answer-slot'],
  ['answer','answer-edit-answer-slot'],['answer-edit-more','answer-edit-settings-slot'],
  ['answer-edit-form','answer-edit-footer'],['answer-edit-status','answer-edit-status-slot']
 ];
 for(const [id,slot]of slots){
  const node=$(id),home=document.createComment('answer-editor-home:'+id);
  node.before(home);answerEditorHomes.push({node,home,form:node.getAttribute('form'),required:node.required,ariaLabel:node.getAttribute('aria-label')});
  $(slot).append(node);
 }
 $('question').setAttribute('form','answer-edit-form');$('question').required=false;
 $('answer-edit-question-label').setAttribute('for','question');$('question').setAttribute('aria-label','问题，多种问法用斜线分隔');
 // Optional language/public settings are outside the footer form while the dialog is open.
 for(const id of ['answer-edit-other','answer-edit-public'])$(id).setAttribute('form','answer-edit-form');
 dialog.showModal();$('answer-edit-dialog-title').focus({preventScroll:true});
}
function restoreAnswerEditor(){
 const dialog=$('answer-edit-dialog');
 if(dialog.open)dialog.close();
 for(const {node,home,form,required,ariaLabel}of answerEditorHomes.splice(0)){
  home.replaceWith(node);if(form===null)node.removeAttribute('form');else node.setAttribute('form',form);
  if(typeof required==='boolean')node.required=required;
  if(ariaLabel===null)node.removeAttribute('aria-label');else node.setAttribute('aria-label',ariaLabel);
 }
 $('answer-edit-question-label').removeAttribute('for');
 for(const id of ['answer-edit-other','answer-edit-public'])$(id).removeAttribute('form');
 if(answerEditScroll){const position=answerEditScroll;answerEditScroll=null;
  requestAnimationFrame(()=>{$('work-thread').scrollTo({top:position.thread,behavior:'auto'});window.scrollTo({top:position.page,behavior:'auto'})});
 }
}
$('answer-edit-dialog-close').onclick=()=>{if(!answerEditSaving)$('answer-edit-cancel').click()};
$('answer-edit-dialog').addEventListener('cancel',event=>{event.preventDefault();if(!answerEditSaving)$('answer-edit-cancel').click()});
let inlineQuestionInitial='',answerEditLoad=null;
const isDialogueOwner=()=>me?.roleCode==='owner'&&me.assistantCustomerOnly!==true;
const canEditPair=()=>!!me&&(assistantMode==='store'&&!customerLocked||assistantMode==='customer'&&isDialogueOwner());
const canPublishPair=()=>canEditPair()&&me.roleCode==='owner'&&!displayedReply?.correctionOnly;
const canEditDisplayedAnswer=()=>canEditPair()&&!!displayedReply?.data.answer;
function setAnswerAccess(){
 const editing=canEditDisplayedAnswer()&&!!inlineDialogue;$('answer').readOnly=!editing;$('answer').required=editing;
 $('answer').setAttribute('aria-label',editing?'回答，正在修改':canEditPair()?'助理回答，点修改按钮可修改问答':'助理回答');
}
function resizeAnswerBox(){
 const box=$('answer');box.style.height='auto';box.style.height=Math.min(520,Math.max(140,box.scrollHeight+4))+'px';
}
const hasQuestionWays=value=>/[\/／]/.test(String(value||''));
const questionNorm=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s，,。.!！?？、：:“”"'‘’]/g,'');
function setPairEditing(editing){
 if(editing)presentAnswerEditor();else restoreAnswerEditor();
 const edit=$('edit-answer');edit.hidden=!canEditDisplayedAnswer();edit.disabled=editing;edit.setAttribute('aria-expanded',String(editing));
 document.querySelector('.question-row').classList.toggle('editing-question',editing);
 $('question-label').textContent=editing?'同义问法（用 / 分隔）':'输入问题或说话';
 $('question').maxLength=canEditPair()?4800:240;
 const saveLabel=displayedReply?.correctionOnly?'提交纠错':canPublishPair()?'保存问答':'提交审核';$('answer-edit-save').textContent=saveLabel;
 $('answer-edit-form').hidden=!editing;$('answer-edit-cancel').hidden=!editing;$('answer-edit-more').hidden=!editing;
 for(const button of document.querySelectorAll('#flow-choices button,#open-draft,#action-button'))button.disabled=editing;
 const key=$('ask').querySelector('.send-key');key.textContent='发送';key.title='发送';key.setAttribute('aria-label','发送给助理');
 $('answer-edit-public-setting').hidden=!canPublishPair();$('answer-edit-more').querySelector('summary').textContent=canPublishPair()?'回答语言与顾客权限':'回答语言';
}
function resizeQuestionEditor(){
 const box=$('question');if(!inlineDialogue){box.style.height='';return}
 box.style.height='auto';box.style.height=Math.min(360,Math.max(130,box.scrollHeight))+'px';
}
async function openAnswerEdit({preserveQuestion=false,auto=false,fromAnswer=false}={}){
 if(!canEditPair())return false;if(inlineDialogue){presentAnswerEditor();return true}if(answerEditLoad)return answerEditLoad;
 const reply=displayedReply,epoch=modeEpoch,editQueryVersion=queryVersion,originalAnswer=reply?.data.answer||'',editGeneration=++answerEditGeneration;
 const questionAtLoad=$('question').value;
 
 if(voiceSession)stopVoiceSession();else stopSpeech();$('result').hidden=false;$('answer-edit-save').disabled=true;setPairEditing(true);answerEditStatus('正在载入问答…');
 const work=async()=>{
  try{
   const firstQuestion=splitQuestionWays($('question').value)[0]||reply?.question||'';
   const view=reply?.correctionOnly?{items:[]}:await api(canPublishPair()?'/api/assistant/dialogues':'/api/assistant/feedback?'+new URLSearchParams({draft:'1',question:reply?.question||firstQuestion,dialogueId:reply?.id||''}));if(epoch!==modeEpoch||editQueryVersion!==queryVersion||editGeneration!==answerEditGeneration||displayedReply!==reply||!canEditPair())return false;
   const typed=$('question').value;if(auto&&!hasQuestionWays(typed)){answerEditStatus('');if(!reply)$('result').hidden=true;return false}
   const ways=splitQuestionWays(typed),first=ways[0]||reply?.question||'';
   let row=reply?.id?view.items?.find(x=>x.id===reply.id):!reply?view.items?.find(x=>x.enabled&&(x.questions||[]).some(q=>splitQuestionWays(q).some(v=>questionNorm(v)===questionNorm(first)))):null;
   if(reply?.id&&!row)throw Error('没有找到这条问答，请重新提问后再修改。');
   row||={title:first.slice(0,80),questions:reply?splitQuestionWays(reply.question):ways,answer:reply?.data.answer||'',answerMandarin:reply?.data.answer||'',version:0,enabled:true,customerVisible:assistantMode==='customer'&&isDialogueOwner()};
   const currentReply=reply||{data:{answer:row.answer,unresolved:!row.id,metrics:{}},question:first,requestContext:null,id:row.id||null,style:customerReplyStyle,canCreate:!row.id};
   if(!reply){displayedReply=currentReply;$('answer').value=row.answer;$('basis').textContent='';$('sources').replaceChildren();renderFollowups([]);resetTariffExport();$('action').hidden=true;$('draft').hidden=true}
   inlineDialogue=row;inlineReplyStyle=replyStyle(currentReply.style);
   const questionChangedWhileLoading=typed!==questionAtLoad;
   if(!preserveQuestion&&!questionChangedWhileLoading)$('question').value=(row.questions?.length?row.questions.flatMap(splitQuestionWays):[currentReply.question]).join(' / ');
   inlineQuestionInitial=$('question').value;setPairEditing(true);resizeQuestionEditor();
   $('answer-edit-title').textContent=row.title;
   $('answer-edit-label').textContent=currentReply.correctionOnly?'建议改成的回答（用 / 分隔）':'回答（用 / 分隔）';
   $('answer-edit-other-label').textContent=inlineReplyStyle==='mandarin'?'可选川渝话回答（用 / 分隔，可留空）':'可选普通话回答（用 / 分隔，可留空）';
   const answerBox=$('answer'),typedAnswer=answerBox.value,selection=[answerBox.selectionStart,answerBox.selectionEnd];
   const changedWhileLoading=fromAnswer&&typedAnswer!==originalAnswer;
   const fullAnswer=inlineReplyStyle==='mandarin'?row.answerMandarin||row.answer:row.answer;
   answerBox.value=changedWhileLoading?typedAnswer:fullAnswer;
   if(fromAnswer&&document.activeElement===answerBox){const offset=changedWhileLoading?0:Math.max(0,fullAnswer.indexOf(originalAnswer));answerBox.setSelectionRange(offset+selection[0],offset+selection[1])}
   $('answer-edit-other').value=!row.id?'':inlineReplyStyle==='mandarin'?row.answer:row.answerMandarin||'';
   $('answer-edit-public').checked=row.customerVisible===true;$('answer-edit-more').open=false;$('answer').hidden=false;$('answer-edit-label').hidden=false;$('answer-edit-form').hidden=false;answerEditStatus('');
   setAnswerAccess();resizeAnswerBox();setSpeechButtons();if(currentReply.correctionOnly)answerEditStatus('修改后的问与答一起提交核对，尚不改变库存、金额或开单结果。');
   if(!auto&&!fromAnswer)$('answer-edit-dialog-title').focus({preventScroll:true});
   return true;
  }catch(error){if(epoch===modeEpoch&&editGeneration===answerEditGeneration&&displayedReply===reply){setPairEditing(false);answerEditStatus('暂时不能修改：'+error.message,'error')}return false}
  finally{if(editGeneration===answerEditGeneration)$('answer-edit-save').disabled=false}
 };
 const loading=work();answerEditLoad=loading;try{return await loading}finally{if(answerEditLoad===loading)answerEditLoad=null}
}
$('edit-answer').onclick=()=>openAnswerEdit();
$('question').addEventListener('input',()=>{
 if(inlineDialogue){resizeQuestionEditor();return}
 if(canEditPair()&&hasQuestionWays($('question').value))openAnswerEdit({preserveQuestion:true,auto:true});
});
$('answer').addEventListener('focus',()=>{if(canEditDisplayedAnswer()&&!$('answer').readOnly)openAnswerEdit({fromAnswer:true,preserveQuestion:hasQuestionWays($('question').value)})});
$('answer').addEventListener('input',()=>{
 resizeAnswerBox();
 const box=$('answer-edit-status');if(inlineDialogue&&box.dataset.state==='error'&&box.textContent.startsWith('请'))answerEditStatus('');
 if(!inlineDialogue&&canEditDisplayedAnswer())openAnswerEdit({fromAnswer:true,preserveQuestion:true});
});
$('answer-edit-cancel').onclick=()=>{if(answerEditSaving)return;const compose=answerComposeOriginal;closeAnswerEdit();$('question').value=compose;workChat.resizeInput();answerEditStatus('已取消修改，原问答保留。');$('edit-answer').focus({preventScroll:true})};
async function saveAnswerPair(){
 const row=inlineDialogue,reply=displayedReply,epoch=modeEpoch,editGeneration=answerEditGeneration,editQueryVersion=queryVersion;if(!row||!canEditPair()||$('answer-edit-save').disabled)return;
 const current=()=>epoch===modeEpoch&&editQueryVersion===queryVersion&&editGeneration===answerEditGeneration&&displayedReply===reply&&canEditPair();
 const primary=$('answer').value.trim(),other=$('answer-edit-other').value.trim();
 if(!primary||!splitQuestionWays(primary).length){answerEditStatus('请填写正确回答。','error');$('answer').focus();return}
 if(reply.canCreate&&reply.data.unresolved&&primary===reply.data.answer){answerEditStatus('请先填写正确回答，再保存问答。','error');$('answer').focus();return}
 const raw=$('question').value;if(reply.correctionOnly&&raw===reply.question&&primary===reply.data.answer){answerEditStatus('请先修改问法或回答，再提交纠错。','error');$('answer').focus();return}
 const questions=row.slot&&!row.questions?.length&&raw===inlineQuestionInitial?[]:[...new Set(splitQuestionWays(raw))];
 if(!questions.length&&!row.slot){answerEditStatus('请填写至少一种问法。','error');$('question').focus();return}
 const body={id:row.id,version:row.version,title:row.id?row.title:(questions[0]||reply.question).slice(0,80),questions,answer:inlineReplyStyle==='mandarin'?other||primary:primary,answerMandarin:inlineReplyStyle==='mandarin'?primary:other,enabled:row.enabled,customerVisible:$('answer-edit-public').checked};
 setAnswerEditBusy(true);$('answer-edit-save').disabled=true;$('ask').querySelector('.send-key').disabled=true;answerEditStatus(canPublishPair()?'正在保存…':'正在提交…');
 try{
  if(!canPublishPair()){
   const saved=await api('/api/assistant/feedback',{question:reply.question,originalAnswer:reply.data.answer,dialogueId:row.id||null,dialogueVersion:row.version,pairEdit:true,correctionOnly:reply.correctionOnly===true,sourceKind:reply.data.metrics?.kind||'',flowStage:reply.data.metrics?.flowStage||'',reason:reply.correctionOnly?'业务回答纠错，提交核对':'修改问答，提交老板确认',suggestedQuestions:questions,suggestion:body.answer,suggestionMandarin:body.answerMandarin});
   if(!current())return;
   closeAnswerEdit();$('question').value=reply.question;answerEditStatus(reply.correctionOnly?'已提交纠错，问与答已一起记录，可在“知识审核 → 回答纠错”核对。':'已提交审核，问和答一起等待老板确认。','success');$('answer-edit-status').dataset.recordId=saved.id;return;
  }
  const saved=await api('/api/assistant/dialogues/save',body);if(!current())return;
  const nextQuestion=saved.questions[0]||reply.question;reply.question=nextQuestion;
  let answer=reply.style==='mandarin'?saved.answerMandarin||saved.answer:saved.answer,previewError='';
  if(splitQuestionWays(answer).length>1){
   try{const preview=await api('/api/assistant/ask',{question:nextQuestion,context:reply.requestContext,customerReplyStyle:reply.style,mode:assistantMode});if(!current())return;reply.data=preview;reply.id=editableDialogueId(preview);conversationContext=preview.context||null;answer=preview.answer;renderFollowups(preview.followups);renderEvidence(preview)}
   catch(error){previewError=error.message;answer=splitQuestionWays(answer)[0]||reply.data.answer}
  }
  if(!current())return;
  $('current-question').querySelector('p').textContent=nextQuestion;
  reply.id=saved.id;reply.canCreate=false;reply.data.unresolved=false;reply.data.metrics={...reply.data.metrics,dialogueId:saved.id,unresolved:false};reply.data.answer=answer;$('answer').value=answer;
  const sources=(reply.data.sources||[]).filter(x=>x.id!==saved.id);sources.push({id:saved.id,label:saved.title+' · 第'+saved.version+'版',href:'/assistant#dialogue-panel'});reply.data.sources=sources;
  $('sources').replaceChildren();for(const source of sources){const a=document.createElement('a');a.href=source.href;a.target='_top';a.textContent=source.label;$('sources').append(a)}
  if(!dialogueRows.some(x=>x.id===saved.id)){dialogueRows.push(saved);const option=document.createElement('option');option.value=saved.id;$('dialogue-select').append(option)}else dialogueRows=dialogueRows.map(x=>x.id===saved.id?saved:x);
  if(editingDialogue?.id===saved.id)editDialogue(saved);for(const option of $('dialogue-select').options||[])if(option.value===saved.id)option.textContent=saved.title+' · '+(saved.enabled?'启用':'停用')+' · 第'+saved.version+'版';
  closeAnswerEdit();$('question').value=nextQuestion;answerEditStatus(previewError?'保存成功。暂未刷新回答：'+previewError+'。请再次提问查看。':'保存成功，已记住 '+saved.questions.length+' 种问法、'+splitQuestionWays(primary).length+' 种答法。','success');setSpeechButtons();
 }catch(error){if(current())answerEditStatus('保存失败：'+error.message,'error')}
 finally{if(editGeneration===answerEditGeneration)setAnswerEditBusy(false)}
}
$('answer-edit-form').onsubmit=async e=>{
 e.preventDefault();
 if(answerEditLoad&&!await answerEditLoad)return;
 if(!inlineDialogue&&!await openAnswerEdit({fromAnswer:true,preserveQuestion:true}))return;
 await saveAnswerPair();
};

$('dialogue-form').onsubmit=async e=>{
 e.preventDefault();if(assistantMode==='customer')return;const body={...(editingDialogue?{id:editingDialogue.id}:{}),version:editingDialogue?.version||0,title:$('dialogue-title').value.trim(),questions:splitQuestionWays($('dialogue-questions').value),answer:$('dialogue-answer').value.trim(),answerMandarin:$('dialogue-mandarin').value.trim(),enabled:$('dialogue-enabled').checked,customerVisible:$('dialogue-public').checked};
 $('dialogue-save').disabled=true;$('dialogue-status').textContent='保存中…';
 try{editingDialogue=await api('/api/assistant/dialogues/save',body);await loadDialogues();$('dialogue-status').textContent='保存成功，第'+editingDialogue.version+'版已生效，修改记录已保留。'}catch(error){$('dialogue-status').textContent='保存失败：'+error.message}finally{$('dialogue-save').disabled=false}
};
function revealAssistantHash(hash=location.hash){
 if(assistantMode!=='store'||me?.roleCode!=='owner')return;
 if(hash==='#dialogue-panel'||hash==='#phrase-panel')revealAssistantPanel(hash.slice(1));
}
window.addEventListener('hashchange',()=>revealAssistantHash());
document.addEventListener('click',event=>{
 const link=event.target.closest?.('a[href]');if(!link)return;
 const target=new URL(link.href,location.href);
 if(target.origin===location.origin&&target.pathname===location.pathname&&target.search===location.search)revealAssistantHash(target.hash);
});
applyMode();

(async()=>{try{me=await api('/api/me');await loadAssistantOrganization();window.PageHelp?.setUser(me);if(me.assistantCustomerOnly){customerLocked=true;assistantMode='customer'}applyMode();restorePendingSale();$('who').textContent=assistantMode==='customer'?(isDialogueOwner()?'顾客咨询 · 老板预览':'顾客咨询'):me.name+' · '+(me.role||'已登录');attendance();reports();loadCapabilities();loadSupervision();if(me.roleCode==='owner'&&assistantMode==='store'){$('phrase-panel').hidden=false;loadDialogues();if(location.hash==='#dialogue-panel')setTimeout(()=>revealAssistantPanel('dialogue-panel'),80);if(location.hash==='#phrase-panel')setTimeout(()=>revealAssistantPanel('phrase-panel'),80);if(location.hash==='#report-panel')revealAssistantPanel('report-panel');loadPhrases().catch(e=>$('phrase-status').textContent=e.message)}}catch(e){$('status').textContent=e.message}})();

$('chat-store-messages').onclick=()=>{const open=$('comms-preview-open');if(open){workChat.menu(false);open.click();}else $('status').textContent='门店消息正在加载，请稍后再试。';};
