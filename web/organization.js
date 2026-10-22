(()=>{'use strict';
const E=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const $=id=>document.getElementById(id);
async function api(path,body){const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await res.json();if(!res.ok)throw Error(data.error?.message||'操作未成功');return data;}
let org;
async function load(){org=await api('/api/organization');if(!org.enabled){$('org-status').textContent='扩容环境尚未启用';return;}
 $('org-title').textContent=org.tenant.name+' · 门店管理';
 $('branch-select').innerHTML=org.branches.filter(x=>x.status==='active').map(x=>'<option value="'+E(x.id)+'">'+E(x.code+' '+x.name)+'</option>').join('');
 $('branch-select').value=org.currentBranchId;$('create-section').hidden=!org.canManage;$('grant-section').hidden=!org.canManage;
 if(org.canManage){const users=await api('/api/users');$('grant-user').innerHTML='<option value="">请选择本店员工</option>'+users.filter(x=>x.roleCode!=='owner'&&x.status==='active').map(x=>'<option value="'+E(x.id)+'">'+E(x.name)+'</option>').join('');$('grant-branches').innerHTML=org.branches.filter(x=>x.status==='active').map(x=>'<option value="'+E(x.id)+'"'+(x.id===org.currentBranchId?' selected':'')+'>'+E(x.code+' '+x.name)+'</option>').join('');}
 $('org-status').textContent='当前门店：'+(org.branches.find(x=>x.id===org.currentBranchId)?.name||'');}
$('switch-form').onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
 try{await api('/api/organization/select',{branchId:$('branch-select').value});sessionStorage.removeItem('assistant-sale-draft');sessionStorage.removeItem('erp-reception-draft-after-login-v1');location.href='/m';}
 catch(error){$('org-status').textContent=error.message;button.disabled=false;}};
$('grant-form').onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await api('/api/organization/grants',{userId:$('grant-user').value,branchIds:Array.from($('grant-branches').selectedOptions,x=>x.value)});$('grant-status').textContent='授权已保存，员工重新登录后生效。';}catch(error){$('grant-status').textContent=error.message;}finally{button.disabled=false;}};
$('create-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{const created=await api('/api/organization/branches',Object.fromEntries(new FormData(form)));form.reset();await load();$('org-status').textContent='已建立门店：'+created.name+'，选择后进入空账套。';}catch(error){$('org-status').textContent=error.message;}finally{button.disabled=false;}};
$('report-form').onsubmit=async event=>{event.preventDefault();const p=new URLSearchParams(new FormData(event.currentTarget));try{const data=await api('/api/organization/report?'+p);$('report-rows').innerHTML=data.branches.map(row=>'<article><h3>'+E(row.code+' '+row.name)+'</h3><p>销售 '+row.saleCount+' 单 · 退货 '+row.returnCount+' 单</p><strong>净销售 ¥'+row.netAmount.toFixed(2)+'</strong>'+(row.salesGrossProfit!=null?'<p>销售毛利 ¥'+row.salesGrossProfit.toFixed(2)+'</p>':'')+'</article>').join('');$('report-status').textContent='合计净销售 ¥'+data.totals.netAmount.toFixed(2)+' · '+data.totals.saleCount+' 单';}catch(error){$('report-status').textContent=error.message;}};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('report-from').value=today;$('report-to').value=today;
load().catch(error=>{$('org-status').textContent=error.message;});
})();
