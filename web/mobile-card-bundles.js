'use strict';
const $=id=>document.getElementById(id);
const TIERS={19:{pay:70,packet:20},29:{pay:80,packet:20},39:{pay:110,packet:28},59:{pay:140,packet:35}};
const yuan=value=>'¥'+Number(value||0).toFixed(2),escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let currentUser=null,attempt=null,busy=false;
const targetBundleId=new URLSearchParams(location.search).get('order')||'',bundleRecordId=id=>'bundle-record-'+String(id);
let locatedBundle='';
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
async function api(path,init){const response=await fetch(path,{credentials:'same-origin',...init});let data;try{data=await response.json()}catch{throw new Error('未收到可识别的服务器响应，请勿重新开单，先查询原单')}if(!response.ok){const error=new Error(data.error?.message||'请求失败');error.status=response.status;throw error}return data}
function renderTier(){const tier=$('tier').value,rule=TIERS[tier];$('customer-pay').textContent=yuan(rule.pay);$('selected-tier').textContent=tier+'元档';$('red-packet').textContent=yuan(rule.packet)}
function locateBundle(rows){
 if(!targetBundleId)return;
 let notice=$('bundle-order-location');if(!notice){notice=document.createElement('p');notice.id='bundle-order-location';$('records').before(notice);}
 const row=rows.find(item=>String(item.id)===targetBundleId),target=row&&$(bundleRecordId(row.id));
 if(!target){notice.className='error';notice.setAttribute('role','alert');notice.textContent='当前账号未找到这张组合办理原单，请返回“我的财务”核对单号或联系老板。';if(locatedBundle!=='missing:'+targetBundleId){locatedBundle='missing:'+targetBundleId;requestAnimationFrame(()=>notice.scrollIntoView({block:'center',behavior:'auto'}));}return;}
 notice.className='hint';notice.setAttribute('role','status');notice.textContent='已定位组合办理原单：'+(row.displayNo||row.id);
 target.style.outline='3px solid #1c7076';target.style.outlineOffset='5px';target.style.scrollMarginTop='24px';target.tabIndex=-1;
 if(locatedBundle!==targetBundleId){locatedBundle=targetBundleId;requestAnimationFrame(()=>target.scrollIntoView({block:'center',behavior:'auto'}));}
}
function render(data){
 $('load-state').hidden=true;$('workspace').hidden=false;
 const account=$('account'),oldAccount=account.value;account.replaceChildren(new Option('请选择实际收款码或门店现金',''),...(data.accounts||[]).map(row=>new Option(row.channel==='现金'?'门店现金':row.name+' · '+(row.ownerName||'实际持有人'),row.id)));if([...account.options].some(x=>x.value===oldAccount))account.value=oldAccount;
 const employee=$('employee');employee.replaceChildren();if(currentUser.roleCode==='owner'){employee.append(new Option('请选择营业员',''),...(data.employees||[]).map(row=>new Option(row.name,row.id)));employee.disabled=false}else{employee.append(new Option(currentUser.name,currentUser.id));employee.disabled=true}
 $('submit').disabled=!data.canCreate;$('result').textContent=data.canCreate?'':'当前账号没有收款登记权限，不能创建这张单。';
 $('summary').innerHTML=(data.summary||[]).map(row=>'<tr><td>'+escapeHtml(row.tier)+'元档</td><td>'+row.orders+'</td><td>'+yuan(row.customerIncome)+'</td><td>'+yuan(row.redPacketRequested)+'</td><td>'+yuan(row.redPacketPaid)+'</td></tr>').join('');
 $('records').innerHTML=(data.rows||[]).length?data.rows.map(row=>'<article class="record" id="'+escapeHtml(bundleRecordId(row.id))+'"><strong>'+escapeHtml(row.displayNo||row.id)+' · '+escapeHtml(row.tier)+'元档</strong> <span class="status">'+escapeHtml(row.incomeStatus)+'</span><p>新办号码 '+escapeHtml(row.openedMask)+' · 实收 '+yuan(row.customerPay)+' · '+escapeHtml(row.employeeName)+'</p><p>收款 '+escapeHtml(row.receiptAccount)+' · 持有人 '+escapeHtml(row.receiptHolder||'待核实')+' · 凭据 '+escapeHtml(row.receiptReference)+'</p><p>红包 '+yuan(row.requestedRedPacket)+' · '+escapeHtml(row.redPacketStatus)+'　<a href="/order-red-packets?request='+encodeURIComponent(row.redPacketId||'')+'">查看申请</a></p><small>业务编号 '+escapeHtml(row.externalOrderNo)+' · '+escapeHtml(row.serviceDate)+'</small></article>').join(''):'<p class="hint">目前没有新办卡组合办理单。</p>';
 locateBundle(data.rows||[]);
}
async function load(){try{const data=await api('/api/mobile-card-bundles');render(data)}catch(error){$('load-state').textContent=error.message==='LOGIN'?'请先登录工作台。':error.message}}
async function submit(event){event.preventDefault();if(busy)return;const form=$('bundle-form'),data=Object.fromEntries(new FormData(form));data.employeeId=$('employee').value;data.completedLines=[...document.querySelectorAll('[data-completed-line]:checked')].map(input=>input.dataset.completedLine);const account=$('account').value;if(data.completedLines.length!==4||!account||!$('confirmed').checked){$('result').textContent='请逐项确认四项业务办成，选择实际收款码或现金账户，并核对付款凭据。';$('result').className='error';return}if(!form.reportValidity())return;
 const body=JSON.stringify(data);if(attempt&&attempt.body!==body){$('result').textContent='上次提交结果尚未核对，请保留原内容并重试同一次请求。';$('result').className='error';return}attempt||={key:crypto.randomUUID(),body};busy=true;$('submit').disabled=true;$('result').className='';$('result').textContent='正在登记，请不要重复开单…';
 try{const result=await api('/api/mobile-card-bundles',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':attempt.key},body});attempt=null;$('result').textContent='已登记 '+(result.displayNo||result.id)+'；顾客实收已记一次，红包申请待老板核定。';form.reset();form.elements.serviceDate.value=today();renderTier();await load()}catch(error){if(error.status>=400&&error.status<500)attempt=null;$('result').className='error';$('result').textContent=error.message+(attempt?'；请按原内容重试或查询原单，避免重复开单。':'；请核对内容后再提交。')}finally{busy=false;$('submit').disabled=false}}
document.addEventListener('DOMContentLoaded',async()=>{try{currentUser=await api('/api/me');$('bundle-form').elements.serviceDate.value=today();$('tier').addEventListener('change',renderTier);$('bundle-form').addEventListener('submit',submit);$('refresh').addEventListener('click',load);renderTier();await load()}catch(error){$('load-state').textContent=error.message==='LOGIN'?'请先登录工作台。':error.message}});
