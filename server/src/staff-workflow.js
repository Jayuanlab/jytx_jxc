'use strict';
const c=require('./common');
// This shop's workflow is opt-in. Other tenants keep their original role defaults.
const extra=['purchase:create','product:update','cost:view','supplier:view','stock:adjust'];
function permissionsFor(store,roleCode,fallback){
 const configured=store.staffRoleDefaults?.[roleCode];
 return Array.isArray(configured)?[...new Set([...fallback,...configured.filter(x=>extra.includes(x))])]:[...fallback];
}
function enable(store,owner){
 c.permit(owner,'manageUsers');
 store.staffRoleDefaults={...store.staffRoleDefaults,
  employee:[...new Set(['sale:create','sale:return',...extra])],
  warehouse:[...extra]};
 const changed=[];
 for(const row of store.users||[]){
  if(!['employee','warehouse'].includes(row.roleCode)||row.assistantCustomerOnly)continue;
  const next=permissionsFor(store,row.roleCode,row.permissions||[]);
  if(JSON.stringify(next)!==JSON.stringify(row.permissions||[])){row.permissions=next;changed.push(row.name);}
 }
 c.audit(store,owner,'user:store-workflow','营业员可订货、采购入库、维护商品、盘点及查看进货价；账号：'+(changed.join('、')||'已配置'));
 return {changed,defaults:store.staffRoleDefaults};
}
module.exports={permissionsFor,enable};
