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
const todoFocus115=createTodoFocus115("request","赠品申请","/gift-approvals",[]);
const documentNo = (row) => String(row?.displayNo || row?.number || row?.id || "");
function redPacketEntry(){return '';}
const documentRef = (row, field) => String(row?.[field.replace(/Id$/, "DisplayNo")] || row?.[field.replace(/Id$/, "No")] || row?.[field] || "");
const $=id=>document.getElementById(id);
const E=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const M=value=>'¥'+Number(value||0).toFixed(2);
let rows=[];
async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options});const data=await response.json();if(!response.ok)throw new Error(response.status===401?'请先用员工账号登录':data.error?.message||'操作失败');return data;}
function card(row){
  const pending=row.status==='待审批';
  return '<article class="request '+(pending?'pending':'done')+'"><h2>'+E(row.kind)+' · '+E(row.status)+'</h2><small>申请单 '+E(documentNo(row))+' · 销售单 '+E(documentRef(row,'orderId'))+'<br>申请人 '+E(row.requestedBy)+' · '+E(new Date(row.createdAt).toLocaleString('zh-CN'))+'</small><p>'+E((row.quotedItems||row.items).map(item=>(item.name||item.skuId)+' × '+item.quantity+(item.serialNo?' · '+item.serialNo:'')+(item.cost!=null?' · 成本 '+M(item.cost):'')).join('、'))+'</p><p class="money">申请时预估成本 '+M(row.estimatedCost)+'</p><p class="warning">'+E((row.limitReasons||[]).join('；'))+'</p><p>赠送说明：'+E(row.reason)+'</p>'+(row.reviewedBy?'<p>审核：'+E(row.reviewedBy)+' · '+E(row.reviewNote||'无备注')+(row.actualCost!=null?' · 实际成本 '+M(row.actualCost):'')+'</p>':'')+redPacketEntry('giftApprovals',row)+(row.canApprove?'<div class="actions"><button data-id="'+E(row.id)+'" data-decision="approve">批准并出库</button><button class="reject" data-id="'+E(row.id)+'" data-decision="reject">驳回</button></div>':'')+'</article>';
}
async function load(){try{rows=await api('/api/gift-approvals');const visible=todoFocus115.select(rows,'pending');$('pending').innerHTML=visible.filter(row=>row.status==='待审批').map(card).join('')||'<p>暂无待审批赠品。</p>';$('history').innerHTML=visible.filter(row=>row.status!=='待审批').map(card).join('')||'<p>暂无已处理记录。</p>';}catch(error){$('message').textContent=error.message;}}
document.addEventListener('click',async event=>{const button=event.target.closest('button[data-decision]');if(!button)return;const row=rows.find(item=>item.id===button.dataset.id);if(!row)return;const approve=button.dataset.decision==='approve';const note=prompt(approve?'请核对销售单、赠品和成本；可填写批准备注：':'请填写驳回原因：');if(note===null)return;if(!approve&&!note.trim()){$('message').textContent='驳回必须填写原因';return;}if(approve&&!confirm('确认批准这笔超限赠品？批准后立即扣库存并计入销售单成本。'))return;button.disabled=true;try{await api('/api/gift-approvals/review',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({id:row.id,approve,note})});$('message').textContent=approve?'已批准并出库':'已驳回，库存未变';await load();}catch(error){$('message').textContent=error.message;}finally{button.disabled=false;}});
load();
