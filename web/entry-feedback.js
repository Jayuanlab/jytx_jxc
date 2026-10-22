(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function requestId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256);
    return 'req-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function request(path, body, key) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
    try {
      let response;
      try { response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:body?{'Content-Type':'application/json','Idempotency-Key':key}:undefined,body:body?JSON.stringify(body):undefined}); }
      catch { const error=new Error(body?'网络连接中断，提交结果待核对。请先刷新记录；若未找到，可按原内容重试。':'网络连接失败，请重试。');error.uncertain=Boolean(body);throw error; }
      if(response.status===401){const error=new Error('登录已失效，请重新登录。已填内容仍在当前页面。');error.relogin=true;throw error;}
      let data;
      try { data=await response.json(); }
      catch { const error=new Error(body?'未收到可识别的提交结果，请先核对记录。':'服务器未返回可识别的数据，请重试。');error.uncertain=Boolean(body);throw error; }
      if(!response.ok){const error=new Error(data.error?.message||'操作未成功，请稍后重试。');error.uncertain=Boolean(body&&response.status>=500);throw error;}
      return data;
    } finally {clearTimeout(timer);}
  }
  function create(page) {
    let userId='', records=[], storageKey='';
    const attempts=new WeakMap(), busy=new WeakSet();
    const status=document.getElementById('status'), history=document.getElementById('entry-failures');
    const short=value=>String(value||'').replace(/^([A-Z]{2,5})-([0-9a-f]{8})-[0-9a-f-]{20,}$/i,'$1-$2');
    function renderFailures(){if(history)history.innerHTML=records.length?records.map(row=>'<article class="entry-failure"><strong>'+escape(row.uncertain?'结果待核对':'提交未成功')+'</strong><p>'+escape(row.message)+'</p><small>'+escape(new Date(row.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+' · 记录 '+escape(row.id)+'</small>'+(row.resolved?'<p class="entry-resolved">已按原请求重试成功，单号 '+escape(row.resolvedDisplayNo||row.resolved)+'</p>':'')+'</article>').join(''):'<p class="entry-hint">暂无提交失败记录。</p>';}
    function saveFailures(){try{if(userId)sessionStorage.setItem(storageKey,JSON.stringify(records));}catch{}renderFailures();}
    function setUser(user){if(userId===user.id)return;userId=user.id;storageKey='store-entry-failures:'+page+':'+user.id;try{records=JSON.parse(sessionStorage.getItem(storageKey)||'[]');if(!Array.isArray(records))records=[];records=records.slice(0,20);}catch{records=[];}renderFailures();}
    function show(message,bad=false){status.hidden=false;status.textContent=message;status.className='entry-status '+(bad?'bad':'good');status.scrollIntoView({block:'center'});}
    function dialog(title,message,bad=false,relogin=false){document.getElementById('entry-result')?.remove();const box=document.createElement('dialog');box.id='entry-result';box.className='entry-result '+(bad?'bad':'good');box.innerHTML='<h2>'+escape(title)+'</h2><p>'+escape(message)+'</p><div class="entry-actions">'+(relogin?'<a href="/login?next='+encodeURIComponent(location.pathname)+'">重新登录</a>':'')+'<button type="button">'+(relogin?'留在这里':'知道了')+'</button></div>';document.body.append(box);box.querySelector('button').onclick=()=>box.remove();box.addEventListener('close',()=>box.remove());if(box.showModal)box.showModal();else box.setAttribute('open','');}
    function issues(form){return [...form.querySelectorAll('input,select,textarea')].filter(el=>!el.disabled&&!el.closest('[hidden]')&&(!el.checkValidity()||(el.required&&el.type!=='checkbox'&&!el.value.trim()))).map(el=>({el,message:el.dataset.error||'请补齐或修正标红的内容'}));}
    function showIssues(form,items,focus=false){const box=form.querySelector('.entry-errors');if(box){box.hidden=!items.length;box.innerHTML=items.length?'<strong>尚未提交，请检查以下 '+items.length+' 项</strong>'+items.map(({el,message})=>'<button type="button" data-entry-field="'+escape(el.name)+'">'+escape(message)+'</button>').join(''):'';}for(const el of form.querySelectorAll('input,select,textarea'))el.setAttribute('aria-invalid',String(items.some(item=>item.el===el)));if(focus&&items[0]){items[0].el.scrollIntoView({block:'center'});items[0].el.focus({preventScroll:true});}}
    function bind(form,options){
      form.noValidate=true;
      const errorBox=document.createElement('div');errorBox.className='entry-errors';errorBox.hidden=true;errorBox.setAttribute('role','alert');form.prepend(errorBox);
      errorBox.onclick=event=>{const b=event.target.closest('[data-entry-field]');if(b){const el=form.elements[b.dataset.entryField];el.scrollIntoView({block:'center'});el.focus({preventScroll:true});}};
      for(const event of ['input','change'])form.addEventListener(event,()=>{if(!errorBox.hidden)showIssues(form,issues(form));});
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(busy.has(form))return;
        const invalid=issues(form);if(invalid.length){showIssues(form,invalid,true);return;}showIssues(form,[]);
        if(!userId){show('账号尚未读取成功，请先刷新页面内容。',true);return;}
        const data=options.payload(form),extra=options.validate?.(data,form)||[];if(extra.length){showIssues(form,extra,true);return;}
        const signature=JSON.stringify([options.path,data]);let attempt=attempts.get(form);if(!attempt||attempt.signature!==signature){attempt={signature,key:requestId()};attempts.set(form,attempt);}
        const controls=[...form.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]),button=form.querySelector('button[type=submit]'),caption=button.textContent;
        busy.add(form);controls.forEach(([el])=>el.disabled=true);button.textContent='正在提交…';
        try {
          const row=await request(options.path,data,attempt.key);attempts.delete(form);
          for(const failure of records)if(failure.requestKey===attempt.key){failure.resolved=row.id;failure.resolvedDisplayNo=row.displayNo||row.number||row.id;}saveFailures();
          const message=options.success(row,data);show('✓ '+message);dialog(options.title||'提交成功',message);window.speakSubmitSuccess?.();
          try{await options.afterSuccess?.(row,data,form);}catch{show('✓ 已保存，单号 '+(row.displayNo||row.number||row.id)+'。列表刷新失败，请稍后刷新；无需重新提交。');}
        } catch(error) {
          const id='失败-'+attempt.key.slice(-8),record={id,requestKey:attempt.key,at:new Date().toISOString(),message:error.message,uncertain:Boolean(error.uncertain)};
          records=[record,...records.filter(row=>row.requestKey!==attempt.key)].slice(0,20);saveFailures();
          const title=error.uncertain?'提交结果待核对':'提交未成功';show(title+'：'+error.message,true);dialog(title,error.message+' 记录编号：'+id,true,error.relogin);
        } finally {busy.delete(form);controls.forEach(([el,disabled])=>el.disabled=disabled);button.textContent=caption;}
      });
    }
    renderFailures();return {bind,show,setUser,request:path=>request(path),short};
  }
  window.EntryFeedback={create};
})();
