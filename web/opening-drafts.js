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
const todoFocus115=createTodoFocus115("draft","商品期初草稿","/opening-drafts",["preview"]);
const $=id=>document.getElementById(id),E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let preview=null;
async function api(path,options){const headers={...options?.headers,...(options?.method==='POST'?{'Idempotency-Key':crypto.randomUUID()}:{})};const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers});const v=await r.json();if(!r.ok)throw Error(v.error?.message||v.message||'操作失败');return v}
function table(rows){return '<div style="overflow:auto"><table><thead><tr><th>商品</th><th>仓库</th><th>数量</th><th>成本均价</th><th>预设售价</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+E(r.name||r['商品名称'])+'</td><td>'+E(r.warehouseName||r['仓库'])+'</td><td>'+E(r.quantity??r['期初数量'])+'</td><td>'+E(r.costPrice??r['成本均价'])+'</td><td>'+E(r.salePrice??r['预设售价'])+'</td></tr>').join('')+'</tbody></table></div>'}
async function load(){try{const d=await api('/api/opening-import-drafts');const visible=todoFocus115.select(d.rows,'drafts');$('drafts').innerHTML=visible.length?visible.map(r=>'<article><h3>'+E(r.source)+' · '+E(r.staffName)+' · '+E(r.status)+'</h3><p>'+E(r.productCount)+' 个商品，库存价值 ¥'+E(r.stockValue)+'</p><details><summary>核对逐行数据</summary>'+table(r.items||[])+'</details>'+(d.canDecide&&r.status==='待确认'?'<p><button data-id="'+E(r.id)+'" data-approve="1">确认入账</button><button data-id="'+E(r.id)+'" data-approve="0">驳回</button></p>':'')+'</article>').join('<hr>'):'暂无期初草稿';if(d.locked)$('preview-result').textContent='本账套已有业务记录，不能重新期初导入。'}catch(e){$('status').textContent=e.message}}
$('preview').onclick=async()=>{try{const f=$('file').files[0];if(!f)throw Error('请选择 Excel 文件');const fd=new FormData();fd.append('file',f);preview=await api('/api/opening-balance/preview-excel',{method:'POST',body:fd});$('preview-result').innerHTML='<p>预览 '+E(preview.productCount)+' 个商品，库存价值 ¥'+E(preview.stockValue)+'。请逐行核对。</p>'+table(preview.sourceRows||[])+'<button id="submit">提交老板确认</button>';$('submit').onclick=async()=>{try{if(!confirm('确认提交期初资料给老板核对？'))return;await api('/api/opening-import-drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit',rows:preview.sourceRows,source:preview.source})});$('status').textContent='已提交老板确认，尚未入账。';await load()}catch(e){$('status').textContent=e.message}}}catch(e){$('status').textContent=e.message}};
$('drafts').onclick=async e=>{const b=e.target.closest('button[data-id]');if(!b)return;const approve=b.dataset.approve==='1',note=prompt(approve?'请输入核对说明（可留空）':'请输入驳回原因');if(note===null)return;if(approve&&!confirm('确认已核对逐行数据，并正式导入当前账套？'))return;try{await api('/api/opening-import-drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'decide',id:b.dataset.id,approve,note})});$('status').textContent=approve?'已确认入账。':'已驳回。';await load()}catch(err){$('status').textContent=err.message}};
$('refresh').onclick=load;load();
