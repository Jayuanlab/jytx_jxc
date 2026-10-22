(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WechatNotificationCore=factory();}(this,function(){
 'use strict';
 var topics=[
 {id:'community',label:'社区通知',pattern:/社区|小区|物业|停水|停电|街道|便民|居民.{0,8}(通知|通告|公告)/},
 {id:'incident',label:'突发与预警',pattern:/火灾|起火|洪水|洪灾|防汛|暴雨|山洪|泥石流|地震|预警/},
 {id:'policy',label:'政策民生',pattern:/政策|退休|养老金|医保|社保|补贴|新规/},
 {id:'travel',label:'旅游活动',pattern:/旅游|旅行|景区|文旅|出游|活动报名|聚会|节庆/},
 {id:'senior',label:'老年生活',pattern:/老年|老人|银龄|养老|适老|助老|敬老|高龄|老年大学/},
 {id:'health',label:'健康养生',pattern:/健康|养生|血压|血糖|慢病|用药|睡眠|防跌倒|体检/},
 {id:'safety',label:'防骗提醒',pattern:/防骗|反诈|诈骗|骗局|消费警示|非法集资/},
 {id:'technology',label:'科技前沿',pattern:/人工智能|(?:^|[^A-Za-z])AI(?:$|[^A-Za-z])|大模型|机器人|航天|卫星|量子|芯片|新能源|脑机接口|无人机|核聚变/}
 ];
 function classify(text){return topics.filter(function(x){return x.pattern.test(text);}).map(function(x){return x.id;});}
 function matched(text,settings){return classify(text).some(function(id){return settings.categories.indexOf(id)>=0;})||String(settings.keywords||'').split(/[,，、\n]/).some(function(word){return word.trim()&&text.indexOf(word.trim())>=0;});}
 function readable(body){var s=String(body||'').trim();return !!s&&!/^(?:\[?\d+条\]?|你(?:收到|接收)(?:了)?(?:一条|一则)?|收到(?:了)?)(?:新的?)?(?:微信)?消息[。！!]?$/i.test(s)&&!/^请.{0,12}(查看|查阅)(?:消息)?[。！!]?$/i.test(s);}
 function fromToast(toast,appId,since){
  // Filter app identity and timestamp before touching notification content.
  if(!toast.appInfo||toast.appInfo.appUserModelId!==appId||Date.parse(toast.creationTime)<since)return null;
  var binding=toast.notification.visual.getBinding('ToastGeneric');if(!binding)return null;
  var parts=[],texts=binding.getTextElements();for(var i=0;i<texts.size;i++)parts.push(String(texts.getAt(i).text||''));
  return {appId:appId,appName:toast.appInfo.displayInfo.displayName,notificationId:String(toast.id),notificationAt:new Date(toast.creationTime).toISOString(),title:(parts[0]||'').slice(0,180),body:parts.slice(1).join('\n').slice(0,3000)};
 }
 return {topics:topics,classify:classify,matched:matched,readable:readable,fromToast:fromToast};
}));
