const {test}=require('node:test'),assert=require('node:assert/strict'),c=require('../src/common'),copilot=require('../src/copilot');
const staff={id:'staff',roleCode:'employee',status:'active',permissions:['sale:create','cost:view']};
function fixture(){return c.initialize({users:[staff],products:[{skuId:'phone',name:'华为测试手机',type:'智能手机',warehouseId:'A',active:true,stockManaged:true,trackSerial:true,salePrice:2399}],inventory:[{skuId:'phone',warehouseId:'A',quantity:1,costPrice:100,serials:[{no:'123456789012345',status:'可售',costPrice:1800}]}]})}
function inspect(price,user=staff){return copilot.reviewSale(fixture(),user,{account:'微信',items:[{skuId:'phone',quantity:1,serialNo:'123456789012345',salePrice:price}]})}
test('成交价复核使用本台串号成本，不拿库存均价判断',()=>{
 const r=inspect(1500);assert.equal(r.ready,true);assert.ok(r.findings.some(x=>x.code==='below-cost-0'&&/1800/.test(x.message)));assert.ok(r.findings.some(x=>x.code==='deep-discount-0'));assert.equal(inspect(2399).findings.some(x=>/below-cost|deep-discount|price-deviation/.test(x.code)),false);
});
test('售价明显高于档案参考值提醒多输数字，20%是复核阈值不是市场定价',()=>{
 assert.ok(inspect(23990).findings.some(x=>x.code==='price-deviation-0'&&/20%/.test(x.message)));assert.equal(inspect(2500).findings.some(x=>x.code==='price-deviation-0'),false);
});
test('没有成本查看权限也能提醒复核，但不披露成本数字',()=>{
 const user={...staff,permissions:['sale:create']},r=inspect(1500,user),warning=r.findings.find(x=>x.code==='below-cost-0');assert.ok(warning);assert.doesNotMatch(warning.message,/1800/);
});
