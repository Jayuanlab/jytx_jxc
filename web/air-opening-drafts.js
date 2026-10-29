function createTodoFocus115(parameter,label,back,hidden=[]){
 const id=new URLSearchParams(location.search).get(parameter)||'';let box=null;
 const matches=row=>!!row&&String(row.id||'')===id;
 function select(rows,root){
  if(!id)return rows;const visible=rows.filter(matches),host=document.getElementById(root);
  if(host){if(!box){box=document.createElement('section');box.className='panel todo-focus';box.setAttribute('role','status');host.before(box);for(let node=host.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;box.scrollIntoView({block:'start'});}
   box.replaceChildren();const title=document.createElement('strong'),detail=document.createElement('p'),all=document.createElement('a'),pending=document.createElement('a');
   title.textContent=visible.length?'当前待办 · '+label:'未找到这张'+label;
   const row=visible[0];detail.textContent=row?'单号 '+String(row.displayNo||row.number||row.id)+' · '+String(row.status||'请核对原单')+'。这里只显示这一张原单。':'原单不存在或当前账号不可见，请返回待办刷新。';
   all.href=back;all.textContent='查看全部'+label;pending.href='/m#pending';pending.textContent='返回我的待办';box.append(title,detail,all,document.createTextNode(' · '),pending);
   for(const key of hidden){const node=document.getElementById(key);if(node)node.hidden=true;}
  }return visible;
 }
 return {id,matches,select};
}
const todoFocus115=createTodoFocus115("draft","空充期初草稿","/air-recharge",["air-opening-form"]);
(()=>{
 const $=id=>document.getElementById(id),E=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const form=$('air-opening-form');let busy=false,owner=false,lastReady=null,attempt=null,loading=false;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 form.elements.businessDate.max=today;form.elements.businessDate.value=today;
 function status(message,bad=false){$('air-opening-status').textContent=message;$('air-opening-status').className=bad?'error':'opening-success';}
 function state(ready){if(lastReady!==ready){lastReady=ready;window.dispatchEvent(new CustomEvent('air-opening-updated',{detail:{hasOpening:ready}}));}}
 async function api(body){
  const signature=body?JSON.stringify(body):null;
  if(body&&(!attempt||attempt.signature!==signature))attempt={signature,key:crypto.randomUUID()};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const r=await fetch('/api/air-opening-drafts',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','Idempotency-Key':attempt.key}:undefined,body:signature||undefined,credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const data=await r.json();if(!r.ok){if(body&&r.status<500)attempt=null;throw Error(data.error?.message||'操作未成功，请刷新后重试');}if(body)attempt=null;return data;
  }catch(e){if(e.name==='AbortError')throw Error('等待结果超时，请点刷新核实；未成功时可原样重试，系统会防止重复入账');throw e;}finally{clearTimeout(timer);}
 }
 function buttons(){for(const b of document.querySelectorAll('#air-opening-panel button'))b.disabled=busy;}
 async function load(){
  if(loading)return;loading=true;
  try{const [me,result]=await Promise.all([fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('登录已过期，请重新登录');return r.json();}),api()]);
   owner=me.roleCode==='owner';const rows=todoFocus115.select(result.rows||[],'air-opening-list'),pending=rows.some(r=>r.status==='待确认');
   $('air-opening-title').textContent=result.hasOpening?'期初已确认':'先完成平台期初';
   $('air-opening-guide').textContent=result.hasOpening?'已可以开现金充值单；遗漏流水按实际记录补齐后再对账。':owner?'①核对起始日期和余额 → ②确认期初 → ③开充值单。余额填起始时点的数。':'①填起始日期和余额 → ②提交老板确认 → ③确认后开充值单。不要把当前余额当成之前的起点。';
   form.hidden=!!todoFocus115.id||result.hasOpening||pending;
   $('air-opening-submit').textContent=owner?'确认期初并启用充值':'提交老板确认';
   $('air-opening-list').innerHTML=(!todoFocus115.id&&result.opening?'<p class="opening-success">✓ '+E(result.opening.businessDate)+' 起始余额 '+Number(result.opening.amount).toFixed(2)+' 元</p>':'')+rows.map(row=>'<article class="entry"><strong>'+Number(row.amount).toFixed(2)+' 元 · '+E(row.status)+'</strong><p>起始日期 '+E(row.businessDate||row.submittedAt?.slice(0,10)||'待核对')+' · '+E(row.staffName)+'</p><p>'+E(row.evidence)+'</p>'+(row.decisionNote?'<p>'+E(row.decisionNote)+'</p>':'')+(owner&&row.status==='待确认'?'<div class="air-opening-actions"><button type="button" data-id="'+E(row.id)+'" data-approve="true">✓ 确认期初</button><button type="button" data-id="'+E(row.id)+'" data-approve="false" class="opening-secondary">退回</button></div>':'')+'</article>').join('');
   if(pending&&!owner)status('已提交，等老板确认。确认后会自动更新，也可点刷新。');
   state(result.hasOpening);buttons();
  }finally{loading=false;}
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  const d=Object.fromEntries(new FormData(form)),payload={action:owner?'register':'submit',amount:Number(d.amount),businessDate:d.businessDate,evidence:d.evidence.trim()};
  if(owner&&!confirm('确认以 '+payload.businessDate+' 的 '+payload.amount.toFixed(2)+' 元作为起始余额？\n之后发生的实际流水再逐笔补齐。'))return;
  busy=true;buttons();status('正在提交，请稍候…');
  try{await api(payload);status(owner?'✓ 期初已确认，可以开充值单了。':'✓ 已提交老板确认，确认前不会入账。');await load();alert(owner?'期初确认成功，现在可以开充值单。':'提交成功，请老板在本页确认期初。');}
  catch(e){status(e.message,true);await load().catch(()=>{});}finally{busy=false;buttons();}
 });
 $('air-opening-list').addEventListener('click',async event=>{
  const b=event.target.closest('button[data-id]');if(!b||busy||!owner)return;
  const approve=b.dataset.approve==='true',entry=b.closest('article').innerText;
  if(!confirm((approve?'确认这份期初资料并启用充值？':'退回这份期初资料？')+'\n'+entry))return;
  busy=true;buttons();status('正在处理，请稍候…');
  try{await api({action:'decide',id:b.dataset.id,approve});status(approve?'✓ 期初已确认，可以开充值单。':'已退回，可重新填写。');await load();alert(approve?'期初确认成功，现在可以开充值单。':'资料已退回。');}
  catch(e){status(e.message,true);await load().catch(()=>{});}finally{busy=false;buttons();}
 });
 $('air-opening-refresh').addEventListener('click',()=>load().catch(e=>status(e.message,true)));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)load().catch(e=>status(e.message,true));});
 setInterval(()=>{if(!document.hidden&&!busy&&lastReady===false)load().catch(e=>status(e.message,true));},15000);
 load().catch(e=>status('读取未成功：'+e.message+'。请点刷新重试。',true));
})();
