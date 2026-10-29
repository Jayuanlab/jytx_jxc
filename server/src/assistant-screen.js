'use strict';
const c=require('./common'),live=require('./screen-live'),screenTime=require('./screen-time');
const SCREEN=/电子屏|显示屏|大屏|屏幕通知|滚动字幕|屏上(?:内容|文字)/;
function query(store,user,question,{context=null,at=Date.now()}={}){
 const raw=String(question||'').trim(),continuity=require('./assistant-continuity'),valid=continuity.valid(context,user,at)&&!continuity.independent(raw,context);
 const follow=valid&&(context.screen||SCREEN.test(context.topicQuestion||context.question||''));
 if(!SCREEN.test(raw)&&!follow&&!/^(?:出|发|发布)(?:一条|个)?通知/.test(raw))return null;
 user=require('./master-data').actor(store,user);c.permit(user,'learn');
 const ctx=valid?context.screen:null,q=raw,active=(store.storeAnnouncements||[]).filter(r=>r.active).slice().reverse();
 const result=(answer,extra={})=>({answer,sources:[],metrics:{kind:'screen-help'},conversationHint:{topic:'screen',id:ctx?.id||null,revision:ctx?.revision??null,draftContent:ctx?.draftContent||''},...extra});
 if(/(?:不要|不用|不必|别|无需).{0,10}(?:修改|更改|替换|发布)/.test(q))return result('好的，保留当前电子屏内容。');
 const wantsEdit=/更新|丰富|问候|笑话|动漫|动画|成交鼓[励劢]|编辑|修改|更改|更换|替换|重写|润色|换一版|改一下|改成|改为|换成|写成|简短|短一点|精简|温馨|活跃|生机|起草|编排|重排|交给你|新(?:的)?内容/.test(q);
 if(!wantsEdit&&/显示什么|播什么|当前内容|现在.*(?:内容|文字)|之前的内容|原文/.test(q)){
  const rows=live.feed(store,at).filter(r=>!/:repeat:\d+$/.test(r.id));return result('当前轮播：'+rows.map(r=>r.title+'：'+r.content).join('；'),{metrics:{kind:'screen-current',count:rows.length}});
 }
 if(!c.capabilities(user).screenEdit)return result('当前账号可查看电子屏；修改内容需要电子屏编辑权限。',{metrics:{kind:'screen-denied',denied:true}});
 if(!follow&&!wantsEdit&&/自动|随时|轮播|变换|图案|祝贺|恭喜/.test(q)&&!/(?:电子屏|显示屏|大屏)(?:显示|发布|播报)|(?:出|发|发布)(?:一条|个)?通知/.test(q))return result('电子屏按北京时间轮换问候和配图；笑话作为轻松一刻，每块屏幕每天最多3次，两次之间至少穿插3条其他正文，不连续播放。编辑正文先给草稿和确认按钮，用户点击确认后才保存；仅已核实的手机、配件或维修收益达到条件才播放礼花祝贺。当天已登记的新开卡可上榜，终端优惠券暂时只显示祝贺和鼓励，不显示笔数、目标、金额或倒计时；酬金未核定不说成已到账。查看不会修改当前内容。',{action:{type:'navigate',label:'查看电子屏',href:'/m'},metrics:{kind:'screen-live-policy'}});
 const options=active.map((r,i)=>({index:i+1,title:r.title,content:r.content}));
 const choose=()=>result(active.length>1?'要修改哪一条？选中后告诉我想怎么改。':'请告诉我想显示的内容。',{action:{type:'screen-edit-choose',label:active.length?'选择要修改的通知':'填写新通知',options},metrics:{kind:'screen-edit-list',count:active.length}});
 let index=q.match(/第([一二三四五六七八九十]|\d{1,2})条/),map={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
 const byTitle=active.filter(r=>r.title?.length>=2&&q.includes(r.title));
 const creative=/问候|笑话|动漫|动画|丰富|成交鼓[励劢]/.test(q);
 const forceNew=creative&&!index&&byTitle.length===0&&!ctx?.id||/^(?:请|帮我|给我)?(?:出|发|发布)(?:一条|个)?通知/.test(q)&&!/修改|改成|换成/.test(q);
 const period=screenTime.periodIn(q),day=/白天|白日/.test(q)&&!period;
 const scheduled=period?active.filter(r=>screenTime.periodOfSchedule(r.schedule)===period):day?active.filter(r=>r.schedule?.mode==='time'&&r.schedule.start==='06:00'&&r.schedule.end==='18:00'):[];
 const target=forceNew?null:index?active[(map[index[1]]||Number(index[1]))-1]:byTitle.length===1?byTitle[0]:scheduled.length===1?scheduled[0]:ctx?.id?active.find(r=>r.id===ctx.id):active.length===1?active[0]:null;
 if(index&&!target)return choose();
 if(ctx?.id===target?.id&&target&&Number.isSafeInteger(ctx.revision)&&ctx.revision!==(target.revision||0)&&!index)return result('这条通知已被更新，请重新选择当前内容。',{action:{type:'screen-edit-choose',label:'重新选择通知',options},metrics:{kind:'screen-conflict'}});
 const match=q.match(/(?:改成|改为|修改为|更新为|换成|换为|写成|内容是|内容为|(?:电子屏|显示屏|大屏)(?:显示|发布|播报)|(?:出|发|发布)(?:一条|个)?通知)[：:，,\s]*([\s\S]+)$/);
 let content=screenTime.bodyOnly(match?.[1]?.trim().replace(/^[“"「]+|[”"」]+$/g,'').trim());
 const styleOnly=content&&/^(?:更|再)?(?:温馨|温暖|活跃|简短|生动|有活力|生机勃勃)(?:一些|一点|点|些|的|吧|。|！)*$/.test(content);
 if(!content||styleOnly){
  if(!wantsEdit&&follow&&ctx?.draftContent){content=ctx.draftContent;}
  else {
  if(!wantsEdit)return choose();
  if(active.length>1&&!target&&!forceNew)return choose();
  const original=String(ctx?.draftContent||target?.content||'').trim();
  if(creative){const greeting={morning:'早上好，欢迎光临本店，祝您今天顺心！',noon:'中午好，欢迎光临本店，祝您午间愉快！',afternoon:'下午好，欢迎光临本店，愿您午后愉快！',evening:'晚上好，欢迎光临本店，祝您晚间愉快！',overnight:'欢迎光临本店，祝您购物愉快！'}[period||screenTime.periodOfSchedule(target?.schedule)]||'欢迎光临本店，祝您购物愉快！';const text=[greeting];if(/笑话|丰富/.test(q))text.push('轻松一下：手机说它今天很有精神，因为刚刚充满电。');if(/动漫|动画/.test(q))text.push('认真服务，细心核对，愿大家今天顺顺利利。');content=text.join('\n');}
  else if(/简短|短一点|精简/.test(q)&&/新系统/.test(original))content='每笔交易同步登记新系统，缺少的商品或选项及时补录。谢谢大家！';
  else if(/简短|短一点|精简/.test(q))content=original.replace(/即刻/g,'及时').replace(/。{2,}/g,'。').replace(/所有商品所有交易/g,'每笔交易');
  else if(/新系统/.test(original)&&/商品|交易/.test(original)){const variants=['新的一天，一起把服务做好。每笔交易请同步登记新系统，缺少的商品或选项及时补录。谢谢大家的认真与配合！','认真服务，也把每一笔记录做好。所有交易同步登记新系统，缺少的商品和选项及时补录。谢谢大家一路配合、互相支持！','聚友因你的用心而更温暖。每笔交易同步登记新系统，缺少的商品或选项及时补录。让我们一起把工作做得更顺心！'];content=variants.find(v=>v!==original)||variants[0];}
  else content=original?(original.startsWith('用心服务，温暖相伴。')?'认真相伴，一起向前。'+original.slice(10):'用心服务，温暖相伴。'+original.replace(/^认真相伴，一起向前。/,'')):'欢迎来到聚友！认真接待，彼此支持，一起收获今天的小美好。';
  }
 }
 content=screenTime.bodyOnly(content);
 if(!content||content.length>500)return result('新文案须为1至500字，请缩短后再试。');
 if(active.length&&!target&&!forceNew)return choose();
 const playback=target?.schedule||screenTime.scheduleFor(period||screenTime.greetingPeriod(content));
 if(!screenTime.fits(content,playback))return result('这段正文的早中晚问候与所选播放时段不一致，请选择对应时段的内容或改用全天适用的正文。',{metrics:{kind:'screen-time-conflict'}});
 const payload={...(target?{id:target.id,revision:target.revision||0}:{}),title:target?.title||(creative?'门店问候与鼓励':'暖心门店'),content,level:target?.level||'normal',schedule:playback,display:target?.display||{mode:'fixed',seconds:14}};
 return result('已准备文案：'+content+'\n点击下方确认按钮后才会保存到电子屏；当前内容尚未改变。',{action:{type:target?'screen-update':'screen-publish',label:target?'确认采用这版':'确认发布',payload,...(target?{before:{title:target.title,content:target.content}}:{})},metrics:{kind:'screen-edit-draft',announcementId:target?.id||null},conversationHint:{topic:'screen',id:target?.id||null,revision:target?.revision??null,draftContent:content}});
}
module.exports={query};
