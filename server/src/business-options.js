"use strict";
const c = require('./common');
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const SUB_NAMES = {new:'新开卡',replace:'补卡',topup:'话费充值',fusion:'融合宽带',other:'其他',up:'套餐升档',down:'套餐降档',device:'设备绑合约',unknown:'未分类／未设置细类'};
const GROUPS = {receptionSource:'接待来源',receptionPurpose:'接待来意'};
function bad(message) { throw new c.HttpError(400,message); }
function actor(store,user) {
  const actual = c.userById(store,user?.id);
  if (actual.roleCode !== user.roleCode || actual.assistantCustomerOnly || !['owner','manager','employee','warehouse'].includes(actual.roleCode)) throw new c.HttpError(403,'当前账号不能使用营业业务选项');
  return actual;
}
function bases() {
  const carrier = require('./carrier-rentals');
  return {types:carrier.TYPES,subTypes:carrier.SUBTYPES};
}
function text(value,label,max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length>max || /[\u0000-\u001f\u007f]/.test(value)) bad(label+'须为1至'+max+'字且不能含控制字符');
  return value.trim();
}
const key = value => value.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
function custom(store) { return store.businessOptions || []; }
function typeFor(store,id) {
  const {types} = bases();
  if (own(types,id)) return {id,name:types[id],baseType:id,custom:false};
  const row = custom(store).find(item=>item.kind==='type'&&item.id===id);
  if (!row || !(own(types,row.baseType)||row.baseType==='other')) bad('业务类型不存在，请重新选择');
  return {id:row.id,name:row.name,baseType:row.baseType,custom:true};
}
function canonicalSubTypes(baseType) { return bases().subTypes[baseType] || ['unknown']; }
function subName(baseType,id) { return id==='other' ? (baseType==='broadband'?'其他宽带':'其他套餐变更') : SUB_NAMES[id]; }
function subTypes(store,type) {
  return [...canonicalSubTypes(type.baseType).map(id=>({id,name:subName(type.baseType,id),baseSubType:id,custom:false})),...custom(store).filter(row=>row.kind==='subType'&&row.parentId===type.id).map(row=>({id:row.id,name:row.name,baseSubType:row.baseSubType,custom:true}))];
}
function list(store,user) {
  const actual=actor(store,user), {types,subTypes:subBases}=bases();
  const rows=[...Object.keys(types).map(id=>typeFor(store,id)),...custom(store).filter(row=>row.kind==='type').map(row=>typeFor(store,row.id))];
  const baseTypes=[...Object.entries(types).map(([id,name])=>({id,name})),{id:'other',name:'其他业务（仅分月酬金）'}];
  const baseSubTypes=Object.fromEntries([...Object.keys(subBases),'other'].map(type=>[type,canonicalSubTypes(type).map(id=>({id,name:subName(type,id)}))]));
  const groups=Object.fromEntries(Object.keys(GROUPS).map(kind=>[kind,custom(store).filter(row=>row.kind===kind).map(({id,name})=>({id,name}))]));
  return {types:rows.map(row=>({...row,subTypes:subTypes(store,row)})),baseTypes,baseSubTypes,groups,canCreate:c.capabilities(actual).catalogAdd===true,canCreateReception:c.capabilities(actual).catalogAdd===true};
}
function validatePayload(payload) {
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) bad('新增业务选项须为对象');
  if (!['type','subType',...Object.keys(GROUPS)].includes(payload.kind)) bad('仅可新增业务类型、细类、接待来源或来意');
  const allowed = payload.kind==='type'?['kind','name','baseType']:payload.kind==='subType'?['kind','name','parentId','baseSubType']:['kind','name'];
  if (Object.keys(payload).some(field=>!allowed.includes(field))) bad('此接口只支持新增，不能修改、停用或变更已有选项');
}
function create(store,user,payload) {
  const actual=actor(store,user);c.permit(actual,'catalogAdd');validatePayload(payload);
  const kind=payload.kind,name=text(payload.name,'选项名称',own(GROUPS,kind)?40:60);
  let parent=null,baseType=null,baseSubType=null;
  if (kind==='type') {
    baseType=text(payload.baseType,'统计基础类型',20);
    if (!(own(bases().types,baseType)||baseType==='other')) bad('请选择现有统计基础类型或其他业务');
    const names=list(store,actual).types.map(row=>row.name);
    if(names.some(value=>key(value)===key(name))) throw new c.HttpError(409,'业务类型名称已存在，请直接选择');
  } else if(kind==='subType') {
    parent=typeFor(store,text(payload.parentId,'所属业务类型',100));baseType=parent.baseType;
    baseSubType=payload.baseSubType==null?'unknown':text(payload.baseSubType,'统计基础细类',20);
    if(!canonicalSubTypes(baseType).includes(baseSubType)) bad('统计基础细类不属于所选业务类型');
    if(subTypes(store,parent).some(row=>key(row.name)===key(name))) throw new c.HttpError(409,'该业务类型下细类名称已存在，请直接选择');
  } else if (custom(store).some(row=>row.kind===kind&&key(row.name)===key(name))) throw new c.HttpError(409,GROUPS[kind]+'名称已存在，请直接选择');
  const row={id:c.id(kind==='type'?'BT':kind==='subType'?'BS':'BO'),kind,name,parentId:parent?.id||null,parentName:parent?.name||null,baseType,baseSubType,createdAt:c.now(),creatorId:actual.id,creator:actual.name};
  store.businessOptions ||= [];store.businessOptions.push(row);
  // Only the local catalog-review channel is used; there is no external notice/outbox.
  require('./catalog-reviews').recordAddition(store,actual,{kind:'businessOption',sourceId:row.id,name:row.name});
  const options=list(store,actual);
  const option=kind==='type'?options.types.find(item=>item.id===row.id):kind==='subType'?options.types.find(item=>item.id===parent.id).subTypes.find(item=>item.id===row.id):options.groups[kind].find(item=>item.id===row.id);
  return {option,options};
}
function resolve(store,payload) {
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) bad('业务登记内容不正确');
  const type=typeFor(store,text(payload.type,'移动业务类型',100));
  const subId=payload.subType==null||payload.subType===''?'unknown':text(payload.subType,'业务细类',100);
  const sub=subTypes(store,type).find(row=>row.id===subId);
  if (!sub || !canonicalSubTypes(type.baseType).includes(sub.baseSubType)) bad('业务细类不属于所选业务类型，请重新选择');
  return {type:type.baseType,typeName:type.name,subType:sub.baseSubType,...(type.custom||sub.custom?{subTypeName:sub.name,businessTypeId:type.id,businessSubTypeId:sub.id,businessOptionSnapshot:{typeId:type.id,typeName:type.name,baseType:type.baseType,subTypeId:sub.id,subTypeName:sub.name,baseSubType:sub.baseSubType}}:{})};
}
module.exports={list,create,resolve};
