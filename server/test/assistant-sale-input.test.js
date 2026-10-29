const {test}=require('node:test'),assert=require('node:assert/strict');
const input=require('../../web/assistant-sale-input');
const p=(skuId,name,thirdType,no,status='可售')=>({skuId,name,thirdType,type:'智能手机',trackSerial:true,warehouseId:'A',quantity:1,serials:[{no,status}],salePrice:2399});
const rows=[p('h60','华为 Mate 60 128GB','Mate 60','869000000001234'),p('h70','华为 Mate 70 256GB','Mate 70','869000000011234'),p('o13','OPPO Reno 13 256GB','Reno 13','869000000002345')];
test('按库存型号和容量筛选，不把缺货型号换成同品牌其他机',()=>{
 assert.deepEqual(input.candidates(rows,'卖一台华为 Mate60 手机').map(x=>x.skuId),['h60']);
 assert.deepEqual(input.candidates(rows,'成交华为手机256G').map(x=>x.skuId),['h70']);
 assert.deepEqual(input.candidates(rows,'华为 Mate80 手机'),[]);
 assert.deepEqual(input.candidates(rows,'华为 Mate60 手机256GB'),[]);
 assert.equal(input.candidates(rows,'华为手机').length,2);
 assert.equal(input.candidates([{...rows[0],type:'儿童手表',name:'华为儿童手表',thirdType:'儿童手表'}],'华为手机').length,0);
 assert.deepEqual(input.candidates(rows,'华为 Mate60 手机，串号AB1234').map(x=>x.skuId),['h60']);
 assert.deepEqual(input.candidates(rows,'华为 Mate60 手机，IMEI869000000001234').map(x=>x.skuId),['h60']);
 assert.equal(input.candidates([{...rows[0],active:false},{...rows[1],quantity:0},rows[2]],'华为手机').length,0);
 assert.equal(input.candidates([p('old','华为旧手机','旧手机','SOLD','已售')],'华为手机').length,0);
 assert.equal(input.candidates([p('apple','Apple iPhone 15 128GB','iPhone 15','A-1234')],'苹果手机').length,1);
});
test('串号支持完整值、后四位、口述数字；重尾号必须返回候选',()=>{
 assert.equal(input.serialMatches(rows,'串号后四位幺二三四').matches.length,2);
 assert.equal(input.serialMatches(rows,'869000000001234').matches[0].p.skuId,'h60');
 assert.equal(input.serialMatches(rows,'串号是 869 000 000 001 234').matches[0].p.skuId,'h60');
 assert.equal(input.serialMatches(rows,'9999').matches.length,0);
 assert.equal(input.serialMatches(rows,'顾客手机号13800138000',true).token,'');
 assert.equal(input.serialMatches(rows,'12345').matches.length,0,'完整值不能当作后四位');
 assert.equal(input.serialMatches([...rows,rows[0]],'1234').matches.length,2,'相同库存响应去重');
 assert.equal(input.serialMatches([p('p','手机','', 'AB-CD-1234')],'ab-cd-1234').matches.length,1);
});
test('收款方式理解否定和更正，混合支付不擅自选一种',()=>{
 for(const text of ['不是现金，是微信','不用现金，走微信','现金没付，银行卡付的'])assert.equal(input.payment(text),text.includes('银行卡')?'银行卡':'微信');
 for(const text of ['现金和微信各付一部分','微信没到账','不付现金','还没付钱'])assert.equal(input.payment(text),'');
 assert.equal(input.payment('微信支付的'),'微信');
});
test('成交价按分读取，电话号码和串号不被当作价格',()=>{
 for(const [text,value]of [['一千九百九十九元',1999],['两千元',2000],['售价一千九百九十九点五元',1999.5],['三十九块',39],['一九九九',1999],['一千零一元',1001],['十万',100000],['十九',19],['1999元',1999],['售价1999.50元',1999.5],['改成1999',1999],['卖了1999块',1999]])assert.equal(input.price(text),value);
 for(const text of ['一一百','一千百','零千','一百一','一千九','十九点五六七','0','-1','1.001','1.2.3','13800138000','串号1234','今天1999台'])assert.equal(input.price(text),null,text);
 assert.equal(input.price('售价1.001元',true),null);
 assert.equal(input.price('手机号13800138000',true),null);
});
test('只采明确的姓名、手机号、售价与附件，不从数字臆造字段',()=>{
 assert.deepEqual(input.facts('卖一台华为Mate60手机，串号1234，顾客叫张三，手机号13800138000，售价1999元，不是现金，是微信，没有附件'),{customerName:'张三',customerPhone:'13800138000',salePrice:1999,account:'微信',giftRequested:''});
 assert.deepEqual(input.facts('手机1234，13800138000'),{});
 assert.deepEqual(input.facts('营业员叫张三'),{});
 assert.equal(input.facts('电话一三八零零一三八零零零').customerPhone,'13800138000');
});
