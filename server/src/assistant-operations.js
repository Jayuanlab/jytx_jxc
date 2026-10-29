const c=require('./common');
const money=n=>'¥'+c.round(n).toFixed(2);
const own=r=>r.employeeId||r.ownerId||r.salespersonId||r.operatorId;
function query(store,user,q,{date=c.day(),context=null}={}){
 if(context?.userId===user.id&&Number.isFinite(context.at)&&Date.now()-context.at>=0&&Date.now()-context.at<1800000&&/电子屏|显示屏|大屏/.test(context.question||'')&&/^(?:把?第[一二三四五六七八九十\d]+条.{0,20}(?:改成|改为|修改为|更新为|换成|设为|设置为)|(?:重新)?(?:更换|编辑|修改)(?:一下)?(?:内容|文字)?|(?:重新写|重写|再写|换一版|新文案|润色)(?:一下|一版)?)/.test(q))q='显示屏'+q;
 if(/电子屏|显示屏|大屏|屏幕通知|出通知|发通知|发布通知|发送成绩单|鼓励员工加油/.test(q)){
  const schedule=require('./announcement-schedule');
  const wantsEdit=/编辑|修改|更改|更换|替换|重新编排|重排|调整|设置|维护|改一下|改成|改为|换成|设为|在哪里|在哪儿|怎么改|如何改|重新写|重写|再写|换一版|新文案|润色|起草/.test(q);
  if(!wantsEdit&&/现在|当前|正在|显示什么|播什么|有什么|之前的内容|原来的内容|旧内容|原文/.test(q)){
   const rows=(store.storeAnnouncements||[]).filter(r=>schedule.active(r,Date.now()));
   return {answer:rows.length?(/之前|原来|旧内容|原文/.test(q)?'当前保存的电子屏原文有 ':'电子屏当前显示 ')+rows.length+' 条：'+rows.map(r=>r.title+'：'+r.content).join('；')+'。':'电子屏当前没有已排期显示的通知。',sources:rows.map(r=>({label:'电子屏通知',id:r.id,href:'/m'})),metrics:{kind:'screen-current',count:rows.length}};
  }
  if(!c.capabilities(user).screenEdit)return {answer:'你可以问我“显示屏现在显示什么”；编辑显示屏需要电子屏管理权限，请联系老板或获授权的人员。',sources:[],metrics:{denied:true}};
  if(wantsEdit){
   const active=(store.storeAnnouncements||[]).filter(r=>r.active).slice().reverse();
   const table={columns:[{key:'序号',label:'序号'},{key:'标题',label:'标题'},{key:'当前内容',label:'当前内容'}],rows:active.map((r,i)=>({序号:i+1,标题:r.title,当前内容:r.content}))};
   const guide=active.length?'当前有 '+active.length+' 条可编辑内容。'+active.slice(0,3).map((r,i)=>'第'+(i+1)+'条“'+r.title+'”：'+r.content).join('；')+'。点“选择并编辑显示屏内容”，填好后我给你预览，确认才保存。':'当前没有可编辑的已发布字幕。点“起草新显示屏内容”，填好后我给你预览，确认才发布。';
   const choose={type:'screen-edit-choose',label:active.length?'选择并编辑显示屏内容':'起草新显示屏内容',options:active.map((r,i)=>({index:i+1,title:r.title,content:r.content}))};
   const change=q.match(/(?:改成|改为|修改为|更新为|换成|设为|设置为)[：:，,\s]*(.+)$/);
   if(!change&&active.length===1&&!/怎么|如何|在哪里|在哪儿|入口|教程|步骤/.test(q)){
    const target=active[0],original=String(target.content||'');
    const proposal=/新系统/.test(original)&&/测试/.test(original)&&/积分/.test(original)?'聚友新系统即将开启测试！欢迎大家积极体验、提出建议。参与测试可获得积分，让我们一起把服务做得更好。':null;
    if(proposal){const payload={id:target.id,revision:target.revision||0,title:target.title,content:proposal,level:target.level||'normal',schedule:target.schedule||{mode:'all'},display:target.display||{mode:'scroll'}};return {answer:'我根据当前内容拟了一版：'+proposal+' 原文是“'+original+'”。觉得合适就点“确认采用这版显示屏文案”；想调整也可说“把显示屏第1条改成：你的文字”。',sources:[],action:{type:'screen-update',label:'确认采用这版显示屏文案',payload,before:{title:target.title,content:original}},metrics:{kind:'screen-edit-draft',announcementId:target.id}};}
   }
   if(!change)return {answer:guide,sources:[],table,action:choose,metrics:{kind:'screen-edit-list',count:active.length}};
   const text=change[1].trim().replace(/^[“"「]+|[”"」]+$/g,'').trim();
   if(!text||text.length>500)return {answer:'新内容须为1到500字。'+guide,sources:[],table,action:choose,metrics:{kind:'screen-edit-list',count:active.length}};
   const before=q.slice(0,change.index);
   const number=before.match(/第([一二三四五六七八九十]|\d{1,2})条/);
   const chinese={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
   const index=number?(chinese[number[1]]||Number(number[1]))-1:-1;
   const byTitle=active.filter(r=>r.title?.length>=2&&before.includes(r.title));
   const target=index>=0?active[index]:byTitle.length===1?byTitle[0]:active.length===1?active[0]:null;
   if(!target)return {answer:(number?'所选序号没有对应的字幕。':'请指定要改哪一条。')+guide,sources:[],table,action:choose,metrics:{kind:'screen-edit-list',count:active.length}};
   const payload={id:target.id,revision:target.revision||0,title:target.title,content:text,level:target.level||'normal',schedule:target.schedule||{mode:'all'},display:target.display||{mode:'scroll'}};
   return {answer:'修改预览：原内容“'+target.content+'” → 新内容“'+text+'”。确认后只修改“'+target.title+'”这一条，其他字幕不变。',sources:[],action:{type:'screen-update',label:'确认保存这条显示屏内容',payload,before:{title:target.title,content:target.content}},metrics:{kind:'screen-edit-draft',announcementId:target.id}};
  }
  if(/成绩单|鼓励员工加油/.test(q)&&/(发送|发布|播|显示|出|电子屏|大屏)/.test(q)){
   const all=c.capabilities(user).allSales===true,staffId=all?null:user.id;
   const sales=(store.sales||[]).filter(r=>(!staffId||own(r)===staffId)&&r.createdAt&&c.day(r.createdAt)===date&&Number(r.amount)>0);
   const mobile=[...(store.carrierServices||[]),...(store.mobileCardBundles||[])].filter(r=>(!staffId||own(r)===staffId)&&c.day(r.serviceDate||r.createdAt)===date);
   const content='今日'+(all?'全店':'本人')+'有交易销售单 '+sales.length+' 张，销售金额 '+money(sales.reduce((n,r)=>n+Number(r.amount||0),0))+'；移动业务 '+mobile.length+' 笔。大家继续加油！';
   const payload={title:'今日成绩与鼓励',content,level:'normal',schedule:{mode:'all'},display:{mode:'scroll'}};
   return {answer:'电子屏成绩单草稿：'+content+' 核对数字后，点确认发布；默认全天滚动显示。',sources:sales.slice(0,10).map(r=>({label:'销售单',id:r.id,href:'/app?tab=orders'})),action:{type:'screen-publish',label:'核对后发布到电子屏',payload},metrics:{kind:'screen-draft',salesCount:sales.length,mobileCount:mobile.length}};
  }
  if(!/怎么|如何|在哪|什么通知/.test(q)){
   const content=q.match(/(?:出|发|发布)(?:一条|个)?通知[：:，,\s]*(.+)/)?.[1]||q.match(/(?:电子屏|显示屏|大屏)(?:显示|发布|播报)[：:，,\s]*(.+)/)?.[1];
   if(content&&content.trim().length>=3&&content.trim().length<=500){
    const payload={title:'店内通知',content:content.trim(),level:'normal',schedule:{mode:'all'},display:{mode:'scroll'}};
    return {answer:'电子屏通知草稿：'+payload.content+' 核对内容后，点确认发布；默认全天滚动显示。',sources:[],action:{type:'screen-publish',label:'核对后发布到电子屏',payload},metrics:{kind:'screen-draft'}};
   }
  }
  if(/通知|成绩单|鼓励|加油|发布|发送/.test(q))return {answer:'请告诉我通知正文或说“发送成绩单”。我会先给你看草稿，确认后才发布到电子屏。',sources:[{label:'电子屏设置',id:'screen',href:'/m?panel=electronic-screen'}],action:{type:'navigate',label:'打开电子屏设置',href:'/m?panel=electronic-screen'}};
 } if(!/接待单|接待人数|到店人数|来了多少人|客流|工单|做了什么|干了什么|全天|从早到晚|全部流水|行程|成绩单|成绩如何|移动业务|新办卡组合|巴渝卡|酬金|佣金/.test(q)||/怎么|如何|在哪|入口|开单|新建|填写|办理/.test(q))return null;
 const all=c.capabilities(user).allSales===true;
 const person=(store.users||[]).filter(x=>x.name&&q.includes(x.name)).sort((a,b)=>b.name.length-a.name.length)[0];
 if(person&&person.id!==user.id&&!all)return {answer:'当前岗位不能查询其他营业员的记录。',sources:[],metrics:{denied:true}};
 const id=person?.id||(all&&!/我自己|我本人|我的/.test(q)?null:user.id),who=person?.name||(id?'你':'全店');
 const events=[];
 const add=(rows,kind,href,time,detail)=>{for(const row of rows||[]){const at=time(row);if((id?own(row)!==id:!all&&own(row)!==user.id)||!at||Number.isNaN(Date.parse(at))||c.day(at)!==date)continue;events.push({at,time:String(at).slice(11,16),kind,id:row.id,detail:detail(row),href});}};
 add(store.receptions,'接待单','/receptions',r=>r.createdAt,r=>[r.customerMask||'顾客',r.purpose||'来意未填','到店 '+(r.visitorCount||1)+' 人',r.duplicateOf?'疑似重复':r.validity||'待核定'].join('，'));
 add(store.workJournals,'工作日志','/work-journal',r=>r.occurredAt||r.createdAt,r=>[r.title||r.content||r.summary||'事项',r.status||'待核定'].join('，'));
 add(store.sales,'销售单','/app?tab=orders',r=>r.createdAt,r=>money(r.amount||0));
 add(store.carrierServices,'移动业务','/carrier',r=>[r.serviceDate,r.createdAt].find(Boolean),r=>(r.typeName||'业务')+'，编号 '+(r.externalOrderNo||r.id));
 add(store.mobileCardBundles,'移动业务','/mobile-card-bundles',r=>[r.serviceDate,r.createdAt].find(Boolean),r=>'新办卡组合，编号 '+(r.externalOrderNo||r.id)+'，实收 '+money(r.customerPay||0)+'，红包代替提成');
 events.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 const re=events.filter(x=>x.kind==='接待单'),mb=events.filter(x=>x.kind==='移动业务'),sl=events.filter(x=>x.kind==='销售单'&&Number((store.sales||[]).find(r=>r.id===x.id)?.amount||0)>0);
 const byReception=new Map((store.receptions||[]).map(r=>[r.id,r])),byMobile=new Map((store.carrierServices||[]).map(r=>[r.id,r])),bySale=new Map((store.sales||[]).map(r=>[r.id,r]));
 const visitors=re.reduce((n,x)=>n+Math.max(1,Number(byReception.get(x.id)?.visitorCount)||1),0);
 const effective=re.reduce((n,x)=>{const r=byReception.get(x.id);return n+(r.duplicateOf||r.validity==='无效'?0:Math.max(0,Number(r.effectiveVisitorCount??r.visitorCount??1)||0));},0);
 const commission=mb.reduce((n,x)=>n+(byMobile.get(x.id)?.schedule||[]).reduce((m,p)=>m+Number(p.expected||0),0),0);
 const confirmed=mb.reduce((n,x)=>n+(byMobile.get(x.id)?.schedule||[]).reduce((m,p)=>m+Number(p.confirmed||0),0),0);
 let answer;
 if(/酬金|佣金/.test(q))answer=date+who+'办理移动业务 '+mb.length+' 笔，其中新办卡组合 '+mb.filter(x=>byMobile.has(x.id)===false).length+' 笔。普通业务单预计酬金 '+money(commission)+'，移动公司已确认 '+money(confirmed)+'。新办卡组合的顾客实收与营业员红包另算，红包代替提成；到账请查原单。';
 else if(/移动业务|新办卡组合|巴渝卡/.test(q))answer=date+who+'登记移动业务 '+mb.length+' 笔，其中新办卡组合 '+mb.filter(x=>byMobile.has(x.id)===false).length+' 笔；组合单红包代替营业员提成。';
 else if(/接待人数|到店人数|来了多少人|客流/.test(q))answer=date+who+'登记接待单 '+re.length+' 张、来客 '+visitors+' 人；扣除疑似重复及无效单，当前可计 '+effective+' 人。待核定单仍可能变化。';
 else if(/成绩单|成绩如何/.test(q))answer=date+who+'有交易金额的销售单 '+sl.length+' 张，销售金额 '+money(sl.reduce((n,x)=>n+Number(bySale.get(x.id)?.amount||0),0))+'；另有移动业务 '+mb.length+' 笔。销售额不是利润，移动酬金单独核算。';
 else if(/接待单/.test(q))answer=date+who+'接待单 '+re.length+' 张，来客 '+visitors+' 人、当前可计 '+effective+' 人。逐单见下表。';
 else answer=date+who+'有 '+events.length+' 项已登记工作：接待 '+re.length+' 张、工作日志 '+events.filter(x=>x.kind==='工作日志').length+' 条、销售单 '+sl.length+' 张、移动业务 '+mb.length+' 笔。按时间列在下表；未登记的活动无法据此认定。';
 return {answer,sources:events.slice(0,20).map(x=>({label:x.kind,id:String(x.id),href:x.href})),table:{columns:[{key:'time',label:'时间'},{key:'kind',label:'事项'},{key:'id',label:'单号'},{key:'detail',label:'内容'}],rows:events.map(({time,kind,id,detail})=>({time,kind,id,detail}))},metrics:{kind:'staff-daily-operations',date,staffId:id,eventCount:events.length,receptionCount:re.length,validVisitors:effective,mobileCount:mb.length,salesCount:sl.length,expectedCommission:c.round(commission),confirmedCommission:c.round(confirmed)}};
}
module.exports={query};




