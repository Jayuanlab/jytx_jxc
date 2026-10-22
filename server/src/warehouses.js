const c = require('./common');
const WAREHOUSES = Object.freeze([
  {id:'wh-a',code:'A',name:'A仓·手机数码',scope:'智能机、功能机、二手机、笔记本、儿童手表及数码产品'},
  {id:'wh-b',code:'B',name:'B仓·配件',scope:'日常零售配件'},
  {id:'wh-c',code:'C',name:'C仓·移动业务',scope:'与A仓共用商品类别、品牌、型号分类；移动商品名称加YD'},
  {id:'wh-other',code:'OTHER',name:'其他仓',scope:'独立实物仓，可按数量或串号入库、销售、盘点和调拨；服务项目不形成实物库存'}
]);
const byId = id => WAREHOUSES.find(row=>row.id===id);
const baseName = name => String(name||'').trim().replace(/(?:\s*[（(]\s*YD\s*[）)])+\s*$/i,'').trim();
function productName(name,warehouseId){
  const text=String(name||'').trim();
  return warehouseId==='wh-c'?baseName(text)+'（YD）':text;
}
function suggest(product){
  if(product.stockManaged===false)return '';
  if(/[（(]\s*YD\s*[）)]\s*$/i.test(String(product.name||'')))return 'wh-c';
  const type=String(product.type||'');const detail=[product.name,product.subType,product.thirdType].join(' ');
  if(/智能机|智能手机|功能机|二手机|笔记本|电脑|手表|数码|平板/.test(type)||/笔记本|儿童手表|智能手表|平板电脑/.test(detail))return 'wh-a';
  if(/号卡|移动业务|运营商/.test(type)||/摄像头|路由器|活动物品|活动礼品|移动业务/.test(detail))return 'wh-c';
  return 'wh-b';
}
function resolveName(value,product){
  const text=String(value||'').trim();
  if(text==='服务项目')return {id:'',name:'服务项目'};
  if(!text||text==='销售仓'){const row=byId(suggest({...product,stockManaged:true}));return row}
  const aliases={'A仓':'wh-a','A':'wh-a','手机数码仓':'wh-a','B仓':'wh-b','B':'wh-b','配件仓':'wh-b','C仓':'wh-c','C':'wh-c','移动业务仓':'wh-c','其他':'wh-other','其他仓':'wh-other'};
  const row=byId(aliases[text]||text)||WAREHOUSES.find(item=>item.name===text);
  if(!row)throw new c.HttpError(400,'仓库名称只能填 A仓、B仓、C仓、其他或服务项目');
  return row;
}
function selected(product,requested){
  if(product.stockManaged===false)return 'wh-other';
  const id=requested||product.warehouseId||'wh-other';
  if(!byId(id))throw new c.HttpError(400,'请选择 A、B、C 仓或其他');
  return id;
}
function distinguishNames(store){
  const changed=[];
  for(const p of store.products){
    if(p.stockManaged===false||p.warehouseId!=='wh-c')continue;
    const normalized=productName(p.name,p.warehouseId);
    if(normalized!==p.name){
      const original=baseName(p.name);
      p.name=normalized;changed.push(p.skuId);
      p.aliases=[...new Set([...(p.aliases||[]),original].filter(Boolean))];
    }
  }
  return changed;
}
function migrate(store,user){
  if(store.warehouseMigrationVersion>=1)return {changed:false,products:0,stockRows:0};
  for(const row of store.inventory){
    const p=store.products.find(item=>item.skuId===row.skuId);
    if(!p||p.stockManaged===false)continue;
    const target=byId(p.warehouseId)?p.warehouseId:suggest(p);
    const current=row.warehouseId||'wh-sale';
    if(current==='wh-sale'&&store.inventory.some(other=>other!==row&&other.skuId===row.skuId&&other.warehouseId===target))
      throw new c.HttpError(409,'三仓迁移发现同一商品目标仓已存在库存，请先核对：'+p.skuId);
    if(current!=='wh-sale'&&current!==target)
      throw new c.HttpError(409,'商品档案与现有仓位不一致，请先核对：'+p.skuId);
  }
  let productCount=0,stockRows=0;
  for(const p of store.products){if(p.stockManaged===false)continue;if(!byId(p.warehouseId)){p.warehouseId=suggest(p);productCount++}}
  const at=c.now();const sourceId='WH-SETUP-20261009';
  for(const row of store.inventory){
    const p=store.products.find(item=>item.skuId===row.skuId);
    if(!p||p.stockManaged===false||row.warehouseId&&row.warehouseId!=='wh-sale')continue;
    const target=byId(p.warehouseId);if(!target)continue;
    const qty=Number(row.quantity||0),value=Number(row.stockValue||0);
    if(qty||value){
      for(const [warehouseId,warehouseName,quantity,cost,type] of [
        ['wh-sale','销售仓',-qty,-value,'三仓建账转出'],[target.id,target.name,qty,value,'三仓建账转入']]){
        store.movements.unshift({id:c.id('MV'),skuId:p.skuId,product:p.name,warehouseId,warehouseName,quantity,cost,type,sourceId,operatorId:user.id,operator:user.name,createdAt:at});
      }
    }
    row.warehouseId=target.id;row.warehouseName=target.name;stockRows++;
  }
  const renamed=distinguishNames(store);
  store.warehouseMigrationVersion=1;
  c.audit(store,user,'warehouse:setup','A/B/C三仓建账；商品 '+productCount+' 种；库存行 '+stockRows+' 行；YD 区分 '+renamed.length+' 种');
  return {changed:true,products:productCount,stockRows,renamed:renamed.length};
}
module.exports={WAREHOUSES,byId,suggest,resolveName,selected,distinguishNames,migrate,baseName,productName};
