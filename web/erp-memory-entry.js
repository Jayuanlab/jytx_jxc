'use strict';
(()=>{
 const root=document.querySelector('main')||document.body,panel=document.createElement('section');panel.className='panel';
 const h=document.createElement('h2');h.textContent='规则记忆与连续办理';
 const p=document.createElement('p');p.textContent='正在读取已确认的规则与当前任务…';
 const a=document.createElement('a');a.href='/assistant-memory';a.textContent='查看、教学或修改规则记忆';
 const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button'),answer=document.createElement('div');
 label.textContent='查询已记住的规则';input.name='question';input.required=true;input.placeholder='例如：付款用哪个微信？';label.append(input);button.textContent='查询规则';form.append(label,button);panel.append(h,p,a,form,answer);root.append(panel);
 form.onsubmit=async event=>{event.preventDefault();button.disabled=true;answer.textContent='正在查询规则记忆…';try{const response=await fetch('/api/assistant-memory/recall?q='+encodeURIComponent(input.value),{credentials:'same-origin',cache:'no-store'}),d=await response.json();if(!response.ok)throw Error(d.error?.message||'读取失败');answer.replaceChildren();if(d.state!=='connected'){answer.textContent='规则记忆暂不可用，请到规则记忆页面核对。';return;}for(const r of d.matches){const item=document.createElement('p');item.textContent=r.title+'：'+r.content+' 适用：'+r.conditions+' 例外：'+r.counterexample;answer.append(item);}if(!d.matches.length)answer.textContent='未找到当前可用的相关规则，请补充或核对资料。';}catch(e){answer.textContent=e.message;}finally{button.disabled=false;}};
 fetch('/api/assistant-memory',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{p.textContent='已确认规则 '+d.rules.filter(r=>r.status==='active').length+' 条'+(d.task?'；当前任务：'+d.task.topic:'；当前没有未结束任务')+(d.sync.pending?'；待同步 '+d.sync.pending+' 条':'')+'。实际业务状态仍查原单。';}).catch(()=>{p.textContent='登录后可查看本账号规则和未完成任务。';});
})();
