(() => {
  'use strict';
  if(new URLSearchParams(location.search).get('mode')==='customer'){location.replace('/kitty');return;}
  const $ = id => document.getElementById(id);
  const messages = $('messages');
  const question = $('question');
  const status = $('status');
  let context = null, task = null, busy = false, turn = 0, currentMe=null;

  function key() { return globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2); }
  async function api(path, body, requestKey=key()) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? {'content-type':'application/json','idempotency-key':requestKey} : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) { location.href = '/login?next=/assistant'; throw Error('请先登录'); }
      const error = Error(data.error?.message || '请求失败，请稍后重试');
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }
  function setStatus(message, error=false) { status.textContent=message; status.classList.toggle('error',error); }
  const mobileScreen=()=>matchMedia('(max-width:850px)').matches;
  function scrollEnd() { if(!mobileScreen())messages.scrollTop = messages.scrollHeight; }
  function fitViewport(){
    const viewport=window.visualViewport;
    document.documentElement.style.setProperty('--assistant-viewport-height',Math.round(viewport?.height||window.innerHeight)+'px');
    document.documentElement.style.setProperty('--assistant-viewport-top',Math.round(viewport?.offsetTop||0)+'px');
  }
  window.visualViewport?.addEventListener('resize',fitViewport);
  window.visualViewport?.addEventListener('scroll',fitViewport);
  window.addEventListener('resize',fitViewport);
  question.addEventListener('focus',()=>requestAnimationFrame(fitViewport));
  question.addEventListener('blur',()=>requestAnimationFrame(fitViewport));
  fitViewport();
  const dictation=createWorkDictation({question,voiceButton:$('voice-input'),keyboardButton:$('keyboard-input'),voiceStatus:$('voice-status'),sendButton:$('send'),isBusy:()=>busy,isMobile:mobileScreen});
  function focusComposer(){dictation.focus();}

  // Voice input changes only the unsent draft. Browser permission and recognition
  // availability are handled explicitly; no recognition event submits a message.
  function createWorkDictation({question,voiceButton,keyboardButton,voiceStatus,sendButton,isBusy,isMobile}){
    const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
    let session=null,typing=!isMobile();
    const limit=question.maxLength>0?question.maxLength:1000;
    const report=text=>{voiceStatus.textContent=text;voiceStatus.hidden=!text;};
    function refresh(){
      question.readOnly=Boolean(session)||(isMobile()&&!typing);
      question.setAttribute('inputmode',question.readOnly?'none':'text');
      question.placeholder=question.readOnly?'点“语音输入”说话；要修改文字请点“键盘输入”':'输入工作问题，Enter 发送，Shift+Enter 换行';
      keyboardButton.textContent=isMobile()&&typing?'收起键盘':'键盘输入';
      keyboardButton.setAttribute('aria-pressed',String(isMobile()&&typing));
      voiceButton.textContent=session?(session.stopping?'正在结束…':'结束语音'):'语音输入';
      voiceButton.setAttribute('aria-pressed',String(Boolean(session)));
      sendButton.disabled=isBusy()||Boolean(session);
    }
    function detach(rec,abort=false){
      if(!rec)return;
      rec.onresult=rec.onend=rec.onerror=rec.onstart=null;
      if(abort)try{rec.abort();}catch{}
    }
    function endMessage(active){
      return active.limitReached?'文字已达到输入上限，请检查后发送。':active.timeLimitReached?'本段已听满5分钟，文字已保留；可检查发送或再点语音继续。':question.value.trim()!==active.base?'已转成文字，请检查后点发送。':'没有识别到新内容，可以再点“语音输入”。';
    }
    function finish(active,message,abort=false){
      if(session!==active)return;
      session=null;clearTimeout(active.timer);clearTimeout(active.stopTimer);clearTimeout(active.restartTimer);
      detach(active.rec,abort);active.rec=null;
      refresh();if(message)report(message);
    }
    function stop(){
      const active=session;if(!active||active.stopping)return;
      active.stopping=true;clearTimeout(active.timer);clearTimeout(active.restartTimer);refresh();report('正在结束语音，请稍候检查文字。');
      if(!active.rec){finish(active,endMessage(active));return;}
      active.stopTimer=setTimeout(()=>finish(active,endMessage(active),true),2500);
      try{active.rec.stop();}catch{finish(active,'已有文字已保留，请检查后发送。',true);}
    }
    function cancel(){const active=session;if(active)finish(active,'',true);report('');}
    function resumeAfterPause(active,rec,abort=false){
      if(session!==active||active.rec!==rec)return;
      detach(rec,abort);active.rec=null;
      if(active.stopping){finish(active,endMessage(active));return;}
      active.emptyEnds=(active.segmentHadWords?0:active.emptyEnds+1);
      report('仍在听，可以停顿后继续说；说完点“结束语音”。');
      active.restartTimer=setTimeout(()=>capture(active),Math.min(2500,350+active.emptyEnds*250));
    }
    function capture(active){
      if(session!==active||active.stopping)return;
      let rec;try{rec=new Speech();}catch{finish(active,'当前浏览器无法继续语音识别，已有文字已保留。',true);return;}
      active.rec=rec;active.segmentHadWords=false;
      const base=question.value.trim();
      rec.lang='zh-CN';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
      rec.onstart=()=>{if(session===active&&active.rec===rec&&!active.stopping)report('正在听，可停顿后继续说，最长5分钟；说完点“结束语音”。');};
      rec.onresult=event=>{
        if(session!==active||active.rec!==rec)return;
        const words=Array.from(event.results).map(result=>result[0]?.transcript||'').join('').trim();
        if(words)active.segmentHadWords=true;
        const text=[base,words].filter(Boolean).join(' ');
        question.value=text.slice(0,limit);
        if(text.length>=limit){active.limitReached=true;stop();}
      };
      rec.onend=()=>resumeAfterPause(active,rec);
      rec.onerror=event=>{
        if(session!==active||active.rec!==rec)return;
        if(event.error==='no-speech'){resumeAfterPause(active,rec,true);return;}
        const messages={'not-allowed':'麦克风未获允许，请在浏览器的网站权限中允许麦克风后重试。','service-not-allowed':'浏览器语音服务不可用，可以点“键盘输入”。','audio-capture':'未找到可用麦克风，请检查手机麦克风权限。',network:'语音识别服务暂时连不上，已有文字已保留。',aborted:'语音已停止，已有文字已保留。','language-not-supported':'当前浏览器暂不支持中文语音识别。'};
        finish(active,messages[event.error]||'语音识别未完成，已有文字已保留，可重试。',true);
      };
      try{rec.start();}catch{finish(active,'语音无法启动，已有文字已保留，可重试或点“键盘输入”。',true);}
    }
    function start(){
      if(isBusy())return;
      if(session){stop();return;}
      typing=false;question.blur();refresh();
      if(!Speech){report('当前浏览器未提供语音识别，请更新浏览器后重试，或点“键盘输入”。');return;}
      if(window.isSecureContext===false){report('语音输入需要安全连接，请从门店正式网址打开。');return;}
      const active={rec:null,base:question.value.trim(),stopping:false,timer:null,stopTimer:null,restartTimer:null,emptyEnds:0};session=active;
      refresh();report('正在打开语音输入，请按浏览器提示允许麦克风。');
      active.timer=setTimeout(()=>{active.timeLimitReached=true;stop();},300000);
      capture(active);
    }
    voiceButton.addEventListener('click',start);
    keyboardButton.addEventListener('click',()=>{
      if(isBusy())return;
      cancel();typing=isMobile()?!typing:true;refresh();
      if(typing)question.focus({preventScroll:true});else question.blur();
    });
    window.addEventListener('resize',refresh);
    window.addEventListener('pagehide',cancel);
    window.addEventListener('message',event=>{if(event.origin===window.location.origin&&event.source===window.parent&&event.data?.type==='assistant:close')cancel();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
    refresh();
    return {stop,cancel,isActive:()=>Boolean(session),focus:()=>{if(!question.readOnly)question.focus({preventScroll:true});}};
  }
  // End voice input.
  function bubble(role, text) {
    const article=document.createElement('article'); article.className='turn '+role;
    const label=document.createElement('span'); label.className='turn-label'; label.textContent=role==='user'?'你':'工作助理';
    const body=document.createElement('div'); body.className='bubble'; body.textContent=text;
    article.append(label,body); messages.append(article); scrollEnd(); return article;
  }
  function safeHref(href) { return typeof href==='string' && href.startsWith('/') && !href.startsWith('//') && !href.includes('\\'); }
  function safeSourceHref(href){if(safeHref(href))return true;try{const u=new URL(href);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['consumer.huawei.com','www.honor.com','www.vivo.com.cn','www.oppo.com','www.oneplus.com','www.mi.com','www.apple.com.cn','detail.zol.com.cn','product.pconline.com.cn'].includes(u.hostname);}catch{return false;}}
  function addButton(box,label,handler) {
    const button=document.createElement('button'); button.type='button'; button.textContent=label; button.addEventListener('click',handler); box.append(button);
  }
  function showTable(parent,data) {
    if (!Array.isArray(data?.rows)||!Array.isArray(data?.columns)||!data.rows.length) return;
    const wrap=document.createElement('div'); wrap.className='reply-table';
    const table=document.createElement('table');
    if(data.title){const caption=document.createElement('caption');caption.textContent=data.title;table.append(caption);}
    const thead=document.createElement('thead'),header=document.createElement('tr');
    for(const column of data.columns){const th=document.createElement('th');th.textContent=column.label||column.key;header.append(th);}
    thead.append(header);table.append(thead);
    const tbody=document.createElement('tbody');
    for(const row of data.rows.slice(0,100)){
      const tr=document.createElement('tr');
      for(const column of data.columns){const td=document.createElement('td');td.textContent=String(row?.[column.key]??'');tr.append(td);}
      tbody.append(tr);
    }
    table.append(tbody);wrap.append(table);parent.append(wrap);
  }
  function showScreenAction(article,action){
    if(!action||!['screen-publish','screen-update','screen-edit-choose'].includes(action.type))return;
    const tools=document.createElement('div');tools.className='reply-tools screen-action';
    if(action.type==='screen-edit-choose'){const link=document.createElement('a');link.href='/assistant-tools';link.textContent='选择电子屏通知';tools.append(link);article.append(tools);return;}
    if(!currentMe?.capabilities?.screenEdit)return;
    const p=action.payload;if(!p||typeof p.title!=='string'||typeof p.content!=='string'||action.type==='screen-update'&&(!p.id||!Number.isInteger(p.revision)))return;
    const button=document.createElement('button');button.type='button';button.textContent=action.type==='screen-update'?'确认采用这版':'确认发布到电子屏';
    const message=document.createElement('span');message.setAttribute('role','status');let requestKey=key(),sending=false,done=false,expired=false;
    const currentScreen=async()=>{
      const data=await api('/api/store-communication');
      return (data.managedAnnouncements||[]).find(row=>row.id===p.id)||null;
    };
    const inspectVersion=row=>{
      if(row&&row.revision===p.revision)return false;
      if(row&&row.title===p.title&&row.content===p.content){
        done=true;button.textContent='已生效';message.textContent='电子屏当前已经是这一版文案。';
      }else{
        expired=true;message.textContent='这份草稿对应的电子屏内容已变化，请重新向工作助理提出修改要求。';
      }
      button.disabled=true;
      return true;
    };
    button.onclick=async()=>{
      if(sending||done||expired)return;
      sending=true;button.disabled=true;message.textContent='正在核对并保存电子屏内容…';
      try{
        const who=await api('/api/me');
        if(who.id!==currentMe.id||!who.capabilities?.screenEdit)throw Error('登录账号已变化，请重新打开本人草稿');
        if(action.type==='screen-update'&&inspectVersion(await currentScreen()))return;
        await api('/api/store-communication/'+(action.type==='screen-update'?'update':'publish'),p,requestKey);
        done=true;button.textContent='已发布';message.textContent='电子屏内容已保存，轮播会自动更新。';
      }catch(e){
        if(e.statusCode===409&&action.type==='screen-update'){
          try{if(inspectVersion(await currentScreen()))return;}catch{}
        }
        message.textContent='尚未确认发布：'+e.message+'。可保留草稿重试。';
      }finally{sending=false;if(!done&&!expired)button.disabled=false;}
    };
    tools.append(button,message);article.append(tools);
  }
  function showReply(data, asked) {
    const article=bubble('assistant',String(data.answer||'暂时没有可显示的回答。'));
    if(data.metrics?.phoneSpecifications||/来源|依据|明细|详情|查看|单据|记录|核对/.test(asked)||/完整明细见销售单|完整数量见销售单/.test(data.answer||'')) if(Array.isArray(data.sources)&&data.sources.length){
      const sources=document.createElement('div');sources.className='reply-tools';
      for(const source of data.sources.slice(0,8))if(safeSourceHref(source.href)){
        const link=document.createElement('a');link.href=source.href;link.textContent=source.label||'查看来源';if(!safeHref(source.href)){link.target='_blank';link.rel='noopener noreferrer';}sources.append(link);
      }
      if(sources.childElementCount)article.append(sources);
    }
    showTable(article,data.table);showScreenAction(article,data.action);
    const tools=document.createElement('div');tools.className='reply-tools';
    if(data.action?.type==='navigate'&&safeHref(data.action.href)){
      const link=document.createElement('a');link.href=data.action.href;link.textContent=data.action.label||'打开功能';tools.append(link);
    }
    if(data.draft){
      const note=document.createElement('span');note.className='evidence';note.textContent='已准备草稿，请在业务页面核对后提交。';article.append(note);
      const link=document.createElement('a');link.href='/app?tab=sales';link.textContent='打开销售单';tools.append(link);
    }
    if(tools.childElementCount)article.append(tools);
    if(data.piAgent?.status==='degraded'||data.piAgent?.status==='unavailable'){
      const evidence=document.createElement('small');evidence.className='evidence';evidence.textContent='Pi 服务暂不可用，已显示系统结果。';article.append(evidence);
    }
    scrollEnd();
  }
  async function send(value) {
    if(dictation.isActive()){dictation.stop();return;}
    const text=String(value||'').trim(); if(!text||busy)return;
    dictation.cancel();
    busy=true;const seq=++turn;$('send').disabled=true;question.value='';
    const welcome=messages.querySelector('.welcome');if(welcome)welcome.remove();
    bubble('user',text);setStatus('正在处理…');
    try {
      const data=await api('/api/assistant/ask',{question:text,context,mode:'store'});
      if(seq!==turn)return;
      context=data.context||null;task=data.task||task;showReply(data,text);
      setStatus(data.piAgent?.status==='unavailable'?'Pi 服务暂不可用，已显示系统结果。':'');
    } catch(error) { if(seq===turn){bubble('assistant',error.message);setStatus(error.message,true);} }
    finally { if(seq===turn){busy=false;$('send').disabled=false;focusComposer();} }
  }
  $('compose').addEventListener('submit',event=>{event.preventDefault();send(question.value);});
  question.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send(question.value);}});
  $('suggestions').addEventListener('click',event=>{const button=event.target.closest('button[data-question]');if(button)send(button.dataset.question);});
  const startNewTopic=async()=>{
    if(busy)return;
    dictation.cancel();
    try{if(task?.id&&Number.isInteger(task.revision))await api('/api/assistant-memory/task-close',{id:task.id,revision:task.revision});}
    catch(error){setStatus('结束上个任务失败：'+error.message,true);return;}
    context=null;task=null;turn++;messages.replaceChildren();
    const block=document.createElement('div');block.className='welcome';
    const title=document.createElement('h1');title.textContent='新对话已开始';
    const description=document.createElement('p');description.textContent='说说接下来要处理什么工作。';
    block.append(title,description);messages.append(block);setStatus('');focusComposer();
  };
  $('new-topic').addEventListener('click',startNewTopic);
  $('new-topic-mobile').addEventListener('click',startNewTopic);
  async function loadCapabilities(){
    try{
      const data=await api('/api/assistant/capabilities');const box=$('capability-list');box.replaceChildren();
      for(const item of (data.items||[])){
        const row=document.createElement('div');row.className='capability';
        const title=document.createElement('strong');title.textContent=item.label;row.append(title);
        if(item.description){const p=document.createElement('p');p.textContent=item.description;row.append(p);}
        if(item.example)addButton(row,'问：'+item.example,()=>send(item.example));
        if(safeHref(item.href)){const a=document.createElement('a');a.href=item.href;a.textContent='打开功能';row.append(a);}
        box.append(row);
      }
      if(!box.childElementCount)box.textContent='当前账号暂无可用功能。';
    }catch(error){$('capability-list').textContent='功能目录暂不可用：'+error.message;}
  }
  async function restoreTask(){
    try{
      const data=await api('/api/assistant-memory');task=data.task||null;
      if(!task?.turns?.length)return;
      messages.querySelector('.welcome')?.remove();
      for(const item of task.turns.slice(-8)){bubble('user',String(item.question||''));const article=bubble('assistant',String(item.answer||''));if(item===task.turns.at(-1))showScreenAction(article,task.action);}
      context=task.context||null;
    }catch{ /* A missing memory service does not block chat. */ }
  }
  (async()=>{
    try{
      const me=await api('/api/me');currentMe=me;
      if(me.assistantCustomerOnly||me.roleCode==='customer-assistant'){location.replace('/kitty');return;}
      $('identity').textContent=me.name||'已登录';
      await Promise.allSettled([loadCapabilities(),restoreTask()]);
      setStatus('按你的账号权限查询；业务操作需要你在系统中确认。');
    }catch(error){setStatus(error.message,true);}
  })();
})();
