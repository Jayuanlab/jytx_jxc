'use strict';
const c=require('./common'),{createHash}=require('crypto');
const HOME=['module-purchase','module-sales','module-master-data','module-review','module-mobile','module-finance','module-payroll','module-learning'];
const BOSS=['overview','operating-summary','boss-decisions','urgent','others','batches','staff','notes','business-modules'];
const normalizeType=p=>p.type==='智能手机'?'智能机':p.type==='二手机'?'二手手机':p.type==='其他数码'?'数码产品':/^(配件和维修|配件\s*[/／]\s*维修)$/.test(p.type||'')?(p.stockManaged===false?'维修':'配件'):p.type||'待归类';
function actor(store,user){return require('./master-data').actor(store,user);}
function descriptor(store,user,p){const actual=actor(store,user);if(!['home','boss','catalog','privacy'].includes(p.page))throw new c.HttpError(400,'不支持这个页面布局');if(p.page==='boss'&&actual.roleCode!=='owner')throw new c.HttpError(403,'老板看台仅老板可调整');if(p.page==='catalog')c.permit(actual,'catalogAdd');const warehouseId=p.page==='catalog'?String(p.warehouseId||''):'';if(warehouseId&&!require('./warehouse-directory').find(warehouseId))throw new c.HttpError(400,'仓库不存在');const parentPath=p.page==='catalog'?(p.parentPath||[]):[];if(!Array.isArray(parentPath)||parentPath.length>2||parentPath.some(x=>typeof x!=='string'||!x.trim()||x.length>100||/[\x00-\x1f\x7f]/.test(x)))throw new c.HttpError(400,'分类位置不正确');const key=JSON.stringify([p.page,p.page==='catalog'?'branch':actual.id,warehouseId,parentPath]);return {actual,warehouseId,parentPath,key};}
function siblingNames(store,{warehouseId,parentPath}){const result=new Set();const add=path=>{if(path.length>parentPath.length&&parentPath.every((s,i)=>path[i]===s))result.add(path[parentPath.length]);};for(const p of store.products||[])if(!warehouseId||p.warehouseId===warehouseId){const path=[normalizeType(p),p.subType||'待归类',p.thirdType||'待归类'];add(path);const aliases={'老人机':'功能机','老年机':'功能机','按键机':'功能机','老人手机':'功能机','老年手机':'功能机','维修':'维修材料'};if(aliases[path[0]])add([aliases[path[0]],...path.slice(1)]);}for(const row of store.productCategoryCatalog?.paths||[])if(!warehouseId||row.warehouseId===warehouseId)add(row.path);return [...result];}
function save(store,user,p){const d=descriptor(store,user,p);if(p.page==='privacy'){if(typeof p.enabled!=='boolean'||Object.keys(p).some(k=>!['page','enabled','revision'].includes(k)))throw new c.HttpError(400,'防窥设置不正确');const old=(store.displayPreferences||[]).find(r=>r.key===d.key);if(p.revision!==(old?.revision||0))throw new c.HttpError(409,'防窥设置已变化，请刷新');const row=old||{id:'DP-'+createHash('sha256').update(d.key).digest('hex').slice(0,24),key:d.key,page:'privacy',userId:d.actual.id,warehouseId:'',parentPath:[],revision:0,order:[]};row.enabled=p.enabled;row.revision++;row.updatedAt=c.now();if(!old)(store.displayPreferences||=[]).push(row);return structuredClone(row);}if(Object.keys(p).some(k=>!['page','warehouseId','parentPath','order','revision'].includes(k)))throw new c.HttpError(400,'只能修改显示顺序');if(!Array.isArray(p.order)||p.order.length>2000||!p.order.length||p.order.some(x=>typeof x!=='string'))throw new c.HttpError(400,'显示顺序不正确');const known=p.page==='home'?HOME:p.page==='boss'?BOSS:siblingNames(store,d);if(new Set(p.order).size!==p.order.length||p.order.some(x=>!known.includes(x)))throw new c.HttpError(400,'只能在同一级已有项目中调整顺序');const existing=(store.displayPreferences||[]).find(x=>x.key===d.key);if(p.revision!==(existing?.revision||0))throw new c.HttpError(409,'显示顺序已在其他页面调整，请刷新后重试');const at=c.now(),row=existing||{id:'DP-'+createHash('sha256').update(d.key).digest('hex').slice(0,24),key:d.key,page:p.page,userId:p.page==='catalog'?null:d.actual.id,warehouseId:d.warehouseId,parentPath:d.parentPath,revision:0};const before=row.order?.slice()||[];row.order=p.order.slice();row.revision++;row.updatedAt=at;row.updatedBy=d.actual.id;if(!existing)(store.displayPreferences||=[]).push(row);c.audit(store,d.actual,'display:order',JSON.stringify({page:p.page,warehouseId:d.warehouseId,parentPath:d.parentPath,before,order:row.order}));return {...structuredClone(row),message:'显示顺序已保存'};}
function list(store,user,query){const actual=actor(store,user),page=query.get('page')||'home';if(!['home','boss','catalog','privacy'].includes(page))throw new c.HttpError(400,'页面不正确');if(page==='boss'&&actual.roleCode!=='owner')throw new c.HttpError(403,'老板看台仅老板可查看');const rows=(store.displayPreferences||[]).filter(r=>r.page===page&&(page==='catalog'||r.userId===actual.id));return {page,canAdjust:page!=='catalog'||c.capabilities(actual).catalogAdd===true,rows:structuredClone(rows),recent:page==='catalog'?(store.catalogAdditionReviews||[]).filter(r=>r.kind==='product').map(r=>({id:r.sourceId,at:r.createdAt})):[],paths:page==='catalog'?structuredClone(store.productCategoryCatalog?.paths||[]):[],suppliers:page==='catalog'?(store.suppliers||[]).filter(r=>r.active!==false).map(({id,name})=>({id,name})):[]};}
module.exports={HOME,BOSS,normalizeType,descriptor,siblingNames,save,list};

const priorDirectoryList=module.exports.list;module.exports.list=function(s,u,q){const r=priorDirectoryList(s,u,q);r.canDeleteCategory=u.roleCode==='owner'&&require('./master-data').actor(s,u).roleCode==='owner';return r;};

// Personal shortcuts reuse the authenticated per-account display preference store.
const previousShortcutsList=module.exports.list,previousShortcutsSave=module.exports.save;
module.exports.list=function(s,u,q){return q.get('page')==='home-shortcuts'?require('./personal-shortcuts').list(s,u):previousShortcutsList(s,u,q);};
module.exports.save=function(s,u,p){return p?.page==='home-shortcuts'?require('./personal-shortcuts').save(s,u,p):previousShortcutsSave(s,u,p);};

// Account migrations may update userId while leaving the composite key behind.
// Personal privacy settings belong to the authenticated account, including old keys.
const previousPrivacySave=module.exports.save;
module.exports.save=function(store,user,payload){
  if(payload?.page!=='privacy')return previousPrivacySave(store,user,payload);
  const d=descriptor(store,user,payload),rows=(store.displayPreferences||[]).filter(r=>r.page==='privacy'&&r.userId===d.actual.id);
  if(rows.length>1||(store.displayPreferences||[]).some(r=>r.key===d.key&&r.userId!==d.actual.id))throw new c.HttpError(409,'个人防窥配置重复，请联系老板核对');
  const row=rows[0];if(!row||row.key===d.key)return previousPrivacySave(store,user,payload);
  const oldKey=row.key;row.key=d.key;
  try{const result=previousPrivacySave(store,user,payload);c.audit(store,d.actual,'privacy:key-repair',{id:row.id,beforeKey:oldKey,key:d.key});return result;}
  catch(error){row.key=oldKey;throw error;}
};

const directoryList=module.exports.list,directorySave=module.exports.save;
module.exports.list=(s,u,q)=>q.get('page')==='home-directory'?require('./workbench-directory').list(s,u):directoryList(s,u,q);
module.exports.save=(s,u,p)=>p?.page==='home-directory'?require('./workbench-directory').save(s,u,p):directorySave(s,u,p);

const alertList=module.exports.list,alertSave=module.exports.save;
module.exports.list=(s,u,q)=>q.get('page')==='pending-alert'?require('./pending-alert-preference').list(s,u):alertList(s,u,q);
module.exports.save=(s,u,p)=>p?.page==='pending-alert'?require('./pending-alert-preference').save(s,u,p):alertSave(s,u,p);
