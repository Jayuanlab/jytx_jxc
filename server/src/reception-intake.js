const c = require('./common');
const profileChoices = {
 gender: ['未了解','男','女','顾客未说明'],
 ageBand: ['未了解','18岁以下','18—24岁','25—34岁','35—44岁','45—54岁','55—64岁','65岁及以上'],
 residenceType: ['未了解','镇上','村里','外地'],
};
const budgetBands = {
 unknown: [null,null], none: [null,null], under500: [0,499.99],
 '500to999': [500,999.99], '1000to1999': [1000,1999.99],
 '2000to2999': [2000,2999.99], '3000to4999': [3000,4999.99], over5000: [5000,null], custom: [null,null],
};
const fields = ['needs','budgetBand','budgetMin','budgetMax','followUpNeed','followUpAt','viewedProducts','customerProfile','supplementPending','intakeVersion','mobileAppLoggedIn','companionCount','visitorCount','effectiveVisitorCount'];
function mobileAppLogin(value){if(value==null)return null;if(typeof value!=='boolean')throw new c.HttpError(400,'移动APP登录请选择是或否');return value;}
const text = (value,max=1000) => String(value ?? '').trim().slice(0,max);
function followDate(value){
 const raw=text(value,40);if(!raw)return '';
 const local=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)?raw+'+08:00':raw;
 const date=new Date(local);if(Number.isNaN(date.getTime()))throw new c.HttpError(400,'回访时间不正确');return date.toISOString();
}
function viewed(store,value){
 let rows=value;if(typeof rows==='string'){try{rows=JSON.parse(rows||'[]');}catch{throw new c.HttpError(400,'看过的商品资料格式不正确');}}
 if(!Array.isArray(rows)||rows.length>20)throw new c.HttpError(400,'每次接待最多记录20款看过的商品');
 return rows.map(item=>{
  if(!item||typeof item!=='object')throw new c.HttpError(400,'看过的商品资料不正确');
  const skuId=text(item.skuId,100),product=skuId?store.products.find(p=>p.skuId===skuId):null;
  if(skuId&&!product)throw new c.HttpError(400,'商品档案不存在，请重新选择或手工记录');
  const name=product?.name||text(item.name,150);if(!name)throw new c.HttpError(400,'请填写看过的商品名称');
  const price=item.price===''||item.price==null?null:c.money(item.price,'当时商品价位');
  return {skuId,name,price};
 });
}
function build(store,payload,previous=null){
 const deferred=payload.deferDetails===true||payload.deferDetails==='true';
 const needs=payload.needs===undefined?text(previous?.needs):text(payload.needs);
 const band=payload.budgetBand===undefined?(previous?.budgetBand||'unknown'):(text(payload.budgetBand,30)||'unknown');
 if(!Object.hasOwn(budgetBands,band))throw new c.HttpError(400,'请选择预算范围，未了解到可选暂未了解');
 let [min,max]=budgetBands[band];
 if(band==='custom'){
  const read=(key)=>payload[key]===undefined?previous?.[key]:payload[key];
  const low=read('budgetMin'),high=read('budgetMax');
  min=low==null||low===''?null:c.money(low,'预算下限');max=high==null||high===''?null:c.money(high,'预算上限');
  if(min===null&&max===null)throw new c.HttpError(400,'自填预算请至少填写一个金额');
  if(min!==null&&max!==null&&min>max)throw new c.HttpError(400,'预算下限不能大于上限');
 }
 const profile={...(previous?.customerProfile||{})};
 for(const key of ['description','gender','ageBand','occupation','residenceType','town','village','address']){
  const value=payload[key]===undefined?profile[key]:payload[key];
  profile[key]=text(value,key==='description'?2000:key==='address'?500:100)||(['gender','ageBand','residenceType'].includes(key)?'未了解':'');
  if(profileChoices[key]&&!profileChoices[key].includes(profile[key]))throw new c.HttpError(400,'顾客'+({gender:'性别',ageBand:'年龄段',residenceType:'住地'})[key]+'选项不正确');
 }
 const follow=payload.followUpNeed===undefined?(previous?.followUpNeed||'unknown'):text(payload.followUpNeed,20);
 if(!['yes','no','unknown'].includes(follow))throw new c.HttpError(400,'请选择是否需要跟进');
 const followUpAt=follow==='no'?'':payload.followUpAt===undefined?(previous?.followUpAt||''):followDate(payload.followUpAt);
 return {intakeVersion:2,needs,budgetBand:band,budgetMin:min,budgetMax:max,
  customerProfile:profile,viewedProducts:payload.viewedProducts===undefined?(previous?.viewedProducts||[]):viewed(store,payload.viewedProducts),
  followUpNeed:follow,followUpAt,supplementPending:deferred||!needs||follow==='unknown'||(follow==='yes'&&!followUpAt),
  mobileAppLoggedIn:payload.mobileAppLoggedIn===undefined?(typeof previous?.mobileAppLoggedIn==='boolean'?previous.mobileAppLoggedIn:null):mobileAppLogin(payload.mobileAppLoggedIn)};
}
function apply(row,patch,user){
 const changes=fields.filter(key=>Object.hasOwn(patch,key)&&JSON.stringify(row[key])!==JSON.stringify(patch[key])).map(key=>({field:key,before:row[key]??null,after:patch[key]??null}));
 Object.assign(row,patch);row.intakeUpdatedAt=c.now();row.intakeUpdatedBy=user.id;return changes;
}
module.exports={build,apply,fields,mobileAppLogin};

