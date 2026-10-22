'use strict';
const c=require('./common'),fields=require('./staff-permission-catalog'),workflow=require('./staff-workflow'),delegation=require('./review-delegation');
const roles=[{value:'employee',label:'营业员'},{value:'warehouse',label:'仓管'},{value:'manager',label:'店长'}];
function target(store,id){const row=(store.users||[]).find(x=>x.id===id);if(!row)throw new c.HttpError(404,'员工不存在');if(row.roleCode==='owner'||row.assistantCustomerOnly||row.roleCode==='customer-assistant')throw new c.HttpError(400,'请选择营业员、仓管或店长');return row;}
function get(store,user,id){c.permit(user,'manageUsers');const row=target(store,id);return {user:c.publicUser(row),revision:row.permissionRevision||0,roles,fields,reviewSubjectIds:row.reviewSubjectIds||[],reviewSubjects:delegation.staff(store).filter(u=>u.id!==row.id&&u.roleCode!=='owner').map(u=>({id:u.id,name:u.name})),defaults:Object.fromEntries(roles.map(r=>[r.value,c.capabilities({roleCode:r.value,permissions:workflow.permissionsFor(store,r.value,r.value==='employee'?['sale:create','sale:return']:r.value==='warehouse'?['purchase:create','stock:adjust']:[])})]))};}
function save(store,user,body){
 c.permit(user,'manageUsers');const row=target(store,body.userId);
 if(!roles.some(x=>x.value===body.roleCode))throw new c.HttpError(400,'请选择营业员、仓管或店长');
 if(body.revision!==(row.permissionRevision||0))throw new c.HttpError(409,'员工权限已被修改，请重新打开后再保存');
 const values=body.capabilities;
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==fields.length||fields.some(x=>typeof values[x.key]!=='boolean')||Object.keys(values).some(k=>!fields.some(x=>x.key===k)))throw new c.HttpError(400,'请完整勾选员工权限');
 if(values.redReview===true)throw new c.HttpError(400,'红冲必须由老板本人批准，不能授权员工审核');
 const subjects=body.reviewSubjectIds===undefined?(row.reviewSubjectIds||[]).filter(id=>delegation.staff(store).some(u=>u.id===id&&u.roleCode!=='owner')):body.reviewSubjectIds;
 if(!Array.isArray(subjects)||subjects.length>500||subjects.some(id=>typeof id!=='string'||id===row.id||!delegation.staff(store).some(u=>u.id===id&&u.roleCode!=='owner')))throw new c.HttpError(400,'请选择当前门店在职员工作为审核对象，不能选择本人');
 const before={role:row.role,reviewSubjectIds:row.reviewSubjectIds||[],capabilities:Object.fromEntries(fields.map(x=>[x.label,c.capabilities(row)[x.key]]))};
 const managed=new Set(fields.map(x=>x.code));
 row.permissions=[...(row.permissions||[]).filter(x=>!managed.has(x)),...fields.filter(x=>values[x.key]).map(x=>x.code)];
 row.capabilityOverrides=Object.fromEntries(fields.map(x=>[x.key,values[x.key]]));
 row.reviewSubjectIds=[...new Set(subjects)];
 row.roleCode=body.roleCode;row.role=roles.find(x=>x.value===body.roleCode).label;
 row.permissionRevision=(row.permissionRevision||0)+1;
 c.audit(store,user,'user:permissions',{employee:row.name,before,after:{role:row.role,reviewSubjectIds:row.reviewSubjectIds,capabilities:Object.fromEntries(fields.map(x=>[x.label,c.capabilities(row)[x.key]]))}});
 return {...c.publicUser(row),message:'员工权限已保存，新操作立即生效'};
}
module.exports={get,save};
