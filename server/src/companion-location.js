 'use strict';
const c=require('./common'),roles=require('./assistant-roles');
const FRESH=30*60000,RETENTION=24*3600000;
function row(store,user){return (store.companionProfiles||[]).find(x=>x.userId===user.id);}
function location(store,user,{now=Date.now()}={}){
 roles.permitPersonal(user);const p=row(store,user)?.currentLocation;
 if(!p||!Number.isFinite(Date.parse(p.observedAt))||now-Date.parse(p.observedAt)>RETENTION)return null;
 return {...p,stale:now-Date.parse(p.observedAt)>FRESH};
}
function version(store,user){return row(store,user)?.locationVersion||0;}
function manual(body){
 const label=typeof body.label==='string'?body.label.trim():'';
 const city=typeof body.city==='string'?body.city.trim():'';
 if(!label||label.length>160||!city||city.length>60)throw new c.HttpError(400,'请填写所在城市和具体街道或地标');
 return {source:'你填写的位置',label,city,district:'',street:'',landmark:label,addressResolved:false,latitude:null,longitude:null,accuracy:null,observedAt:c.now()};
}
function coordinates(body,{now=Date.now()}={}){
 const {latitude,longitude,accuracy,observedAt}=body;
 if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy<0||accuracy>100000)throw new c.HttpError(400,'定位数据不正确，请重新定位');
 const time=Date.parse(observedAt);if(!Number.isFinite(time)||time>now+60000||now-time>5*60000)throw new c.HttpError(400,'定位时间已过期，请重新定位');
 return {latitude:Number(latitude.toFixed(6)),longitude:Number(longitude.toFixed(6)),accuracy:Math.ceil(accuracy),observedAt:new Date(time).toISOString()};
}
function save(store,user,body,value){
 roles.permitPersonal(user);
 if(!Number.isInteger(body.version)||body.version!==version(store,user))throw new c.HttpError(409,'位置已经更新，请刷新后重试');
 const p=row(store,user)||{id:user.id,userId:user.id,nickname:user.name,city:'',interests:'',routine:'',shareWithModel:false};
 if(!row(store,user))(store.companionProfiles||=[]).push(p);
 p.currentLocation=value;p.locationVersion=(p.locationVersion||0)+1;
 // Audit the action only; do not copy precise coordinates into general operation logs.
 c.audit(store,user,'companion:location',user.id);return location(store,user);
}
function saveManual(store,user,body){roles.permitPersonal(user);return save(store,user,body,manual(body));}
function clear(store,user,body){roles.permitPersonal(user);const p=row(store,user);if(body.version!==version(store,user))throw new c.HttpError(409,'位置已经更新，请刷新后重试');if(p){delete p.currentLocation;p.locationVersion=(p.locationVersion||0)+1;}c.audit(store,user,'companion:location-clear',user.id);return {cleared:true};}
function createClient({env=process.env,fetchImpl=globalThis.fetch}={}){
 const key=env.AMAP_WEB_SERVICE_KEY;let active=0;
 const configured=()=>Boolean(key&&env.COMPANION_LOCATION_ENABLED!=='false');
 async function get(path,params){
  const url=new URL('https://restapi.amap.com/v3/'+path);url.search=new URLSearchParams({...params,key,output:'JSON'});
  const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('source-unavailable');
  const reader=r.body.getReader();let n=0,parts=[];while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>256*1024){await reader.cancel();throw Error('source-too-large');}parts.push(Buffer.from(value));}
  const data=JSON.parse(Buffer.concat(parts).toString('utf8'));if(data.status!=='1')throw Error('source-unavailable');return data;
 }
 async function reverse(coords){
  if(!configured())return {...coords,source:'手机定位',label:'地址查询待接通',city:'',district:'',street:'',landmark:'',addressResolved:false};
  if(active>=4)throw new c.HttpError(503,'地址查询繁忙，稍后再试');active++;
  try{
   // Browser geolocation is WGS84. Convert through the provider before GCJ02 reverse lookup.
   const conversion=await get('assistant/coordinate/convert',{locations:coords.longitude+','+coords.latitude,coordsys:'gps'});
   const converted=String(conversion.locations||'').split(',').map(Number);
   if(converted.length!==2||!converted.every(Number.isFinite)||Math.abs(converted[0])>180||Math.abs(converted[1])>90)throw Error('invalid-coordinate');
   const d=await get('geocode/regeo',{location:converted[0].toFixed(6)+','+converted[1].toFixed(6),extensions:'all',radius:'100'}),a=d.regeocode?.addressComponent||{};
   const text=v=>typeof v==='string'?v.slice(0,160):'';
   const province=text(a.province),city=text(a.city)||province,district=text(a.district),street=text(a.streetNumber?.street),number=text(a.streetNumber?.number),label=text(d.regeocode?.formatted_address);
   if(!label||!city)throw Error('no-address');
   const pois=(d.regeocode?.pois||[]).filter(p=>Number.isFinite(Number(p.distance))&&Number(p.distance)<=100).sort((x,y)=>Number(x.distance)-Number(y.distance));
   const landmark=text(pois[0]?.name);
   return {...coords,source:'手机定位 / 高德地图',label,city,district,street:street+number,landmark,addressResolved:true,mapCoordinates:converted,coordinateSystem:'GCJ02',queriedAt:c.now()};
  }catch(e){if(e instanceof c.HttpError)throw e;throw new c.HttpError(503,'地图地址暂时查不到，原位置保留。可以改填街道或附近地标。');}finally{active--;}
 }
 return {configured,reverse};
}
const defaultClient=createClient();
function snapshot(store,user,client=defaultClient){roles.permitPersonal(user);return {version:version(store,user),current:location(store,user),mapConfigured:client.configured(),freshMinutes:30};}
function answer(store,user,question){
 if(!/^(?:请|帮我|看看|看一下|查一下)?(?:我(?:现在)?(?:在|到)哪[里儿]?|我现在的位置|我的(?:具体|当前)?位置|(?:现在|目前)(?:在|到)哪[里儿]?)[？?。！!]*$/.test(String(question).trim()))return null;
 const p=location(store,user);
 const metrics={kind:'personal-location'};
 if(!p)return {answer:'还没有你这次的位置。打开“当前位置”，点“我在哪里”并允许手机定位；也可以填城市、街道或附近地标。',sources:[{label:'更新我的当前位置',href:'/companion?tab=location'}],metrics,channel:'life',modelConnected:false};
 const when=new Date(p.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
 const accuracy=p.accuracy!==null?'，定位误差约'+p.accuracy+'米':'';
 return {answer:(p.stale?'上次记录的位置是：':'你这次提供的位置是：')+p.label+(p.addressResolved&&p.landmark?'；附近地标：'+p.landmark:'')+'。记录时间：'+when+accuracy+'。'+(p.stale?'位置超过30分钟，请重新定位，不能据此确定你现在还在那里。':!p.addressResolved&&p.latitude!==null?'手机已取得坐标，街道地址查询还没接通；可以补填附近地标。':''),sources:[{label:'查看或更新位置',href:'/companion?tab=location'}],metrics,channel:'life',modelConnected:false};
}
module.exports={coordinates,manual,save,saveManual,clear,location,version,snapshot,answer,createClient,defaultClient};
