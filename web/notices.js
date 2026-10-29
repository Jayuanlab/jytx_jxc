const $ = id => document.getElementById(id);
const E = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={all:'全部消息',cash:'现金收款',aggregate:'账户分项核对',business:'其他业务',approval:'审批待办'};
let data={rows:[],unread:0},view=new URLSearchParams(location.search).get('category')||'all',busy=false;if(!labels[view])view='all';
const selected=new Set();
async function api(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:undefined,body:body?JSON.stringify(body):undefined});
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(response.status===401?'请先登录':value.error?.message||'操作失败');
  return value;
}
function visible(){return data.rows.filter(row=>view==='all'||row.category===view);}
function render(){
  const rows=visible(),unread=rows.filter(row=>!row.readAt);
  $('unread').textContent=labels[view]+' · 未读 '+unread.length+' 条（全部 '+data.unread+' 条）';
  $('category').value=view;
  $('rows').innerHTML=rows.length?rows.map(row=>
    '<article class="item '+(row.readAt?'':'unread')+'"><div class="item-head"><label class="item-choice">'+(!row.readAt?'<input type="checkbox" data-select="'+E(row.key)+'" '+(selected.has(row.key)?'checked':'')+' aria-label="选择此消息">':'')+'<span>'+E(labels[row.category]||'业务消息')+'</span></label><small>'+E(row.readAt?'已查看':'未查看')+'</small></div><h2>'+E(row.kind||'业务消息')+'</h2><p>'+E(row.summary||'')+'</p><small>操作流水号：'+E(row.operationNo||'未关联单据，待定位')+(row.receiptId?' · 收款流水：'+E(row.receiptId):'')+' · '+E(row.createdAt?new Date(row.createdAt).toLocaleString('zh-CN'):'历史记录')+'</small>'+
    (typeof row.href==='string'&&row.href.startsWith('/')&&!row.href.startsWith('//')&&!row.href.includes('\\')?'<p><a href="'+E(row.href)+'">打开这张原单</a></p>':'')+
    (row.inquiry?'<p><a href="/work-arrangements?id='+encodeURIComponent(row.inquiry.id)+'">已交 '+E(row.inquiry.employeeName)+' 待查 · '+E(row.inquiry.status)+' ›</a></p>':(['cash','aggregate'].includes(row.category)?'<div><button type="button" data-inquire="'+E(row.key)+'">有疑点，交营业员待查</button></div>':''))+
    (row.readAt?'':'<div><button type="button" data-key="'+E(row.key)+'">标记这笔已查看</button></div>')+'</article>').join(''):'<p>此类暂无消息。</p>';
  $('mark-selected').disabled=busy||!selected.size;
  $('mark-selected').textContent='批量标记已查看（'+selected.size+'）';
  $('select-visible').disabled=busy||!unread.length;
  $('clear-selected').disabled=busy||!selected.size;
}
async function load(){
  try{data=await api('/api/local-notices');for(const key of selected)if(!data.rows.some(row=>row.key===key&&!row.readAt))selected.delete(key);render();$('status').textContent='';}
  catch(error){$('status').innerHTML=error.message==='请先登录'?'<a href="/login?next=/notices">请先登录</a>':E(error.message);}
}
async function mark(keys){
  if(busy||!keys.length)return;
  busy=true;render();
  try{let count=0;for(let i=0;i<keys.length;i+=100){const result=await api('/api/local-notices/read',{keys:keys.slice(i,i+100)});count+=result.updated||0;}selected.clear();await load();$('status').textContent='已标记 '+count+' 条消息；原单、账目和审批状态未改变。';}
  catch(error){$('status').textContent=error.message;}
  finally{busy=false;render();}
}
$('rows').addEventListener('click',event=>{const button=event.target.closest('button[data-key]');if(button)mark([button.dataset.key]);});
$('rows').addEventListener('click',event=>{
  const button=event.target.closest('button[data-inquire]');if(!button)return;
  const row=data.rows.find(x=>x.key===button.dataset.inquire);if(!row)return;
  $('inquiry-key').value=row.key;
  $('inquiry-title').textContent='交营业员待查 · '+(row.operationNo||row.kind);
  $('inquiry-employee').innerHTML='<option value="">请选择负责人</option>'+(data.staff||[]).map(x=>'<option value="'+E(x.id)+'"'+(x.id===row.suggestedEmployeeId?' selected':'')+'>'+E(x.name)+'</option>').join('');
  $('inquiry-reason').value='';$('inquiry-dialog').showModal();
});
$('inquiry-cancel').addEventListener('click',()=>$('inquiry-dialog').close());
$('inquiry-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const key=$('inquiry-key').value,employeeId=$('inquiry-employee').value,reason=$('inquiry-reason').value.trim();
  if(!employeeId||reason.length<3){$('status').textContent='请选择负责人，并写明至少3字的具体疑点。';return;}
  busy=true;$('inquiry-submit').disabled=true;
  try{const result=await api('/api/local-notices/inquire',{key,employeeId,reason});$('inquiry-dialog').close();await load();$('status').textContent=result.message+'；请在工作安排查看反馈。';}
  catch(error){$('status').textContent=error.message;}
  finally{busy=false;$('inquiry-submit').disabled=false;render();}
});
$('rows').addEventListener('change',event=>{const input=event.target.closest('input[data-select]');if(!input)return;if(input.checked)selected.add(input.dataset.select);else selected.delete(input.dataset.select);render();});
$('category').addEventListener('change',event=>{view=event.target.value;selected.clear();render();});
$('select-visible').addEventListener('click',()=>{for(const row of visible())if(!row.readAt)selected.add(row.key);render();});
$('clear-selected').addEventListener('click',()=>{selected.clear();render();});
$('mark-selected').addEventListener('click',()=>mark([...selected]));
$('refresh').addEventListener('click',load);
load();setInterval(()=>{if(!busy)load();},30000);
