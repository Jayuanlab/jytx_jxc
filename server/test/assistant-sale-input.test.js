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

test('整段指令提取多字段，不用固定问答顺序',()=>{
 const d=input.analyze('华为手机 后四位幺二三四 售价2399元 顾客张三 手机号13900001099 微信付款 送一个手机壳和一张钢化膜');
 assert.deepEqual(d.issues,{});assert.equal(d.serialToken,'1234');
 assert.deepEqual(d.facts,{salePrice:2399,customerPhone:'13900001099',account:'微信',customerName:'张三',giftRequested:'一个手机壳和一张钢化膜'});
 assert.deepEqual(d.giftRequests,[{name:'手机壳',quantity:1},{name:'钢化膜',quantity:1}]);
});
test('多金额、多串号、多手机号必须核对，更正可以覆盖',()=>{
 assert.ok(input.analyze('售价1999元，售价1899元').issues.salePrice);
 assert.equal(input.analyze('售价2399元，改成2299元').facts.salePrice,2299);
 assert.ok(input.analyze('串号1234，串号2345').issues.serial);
 assert.ok(input.analyze('手机号13800138000，电话13900001099').issues.customerPhone);
 assert.equal(input.analyze('电话改为13900001099').facts.customerPhone,'13900001099');
 for(const q of ['售价1.001元','售价-1元','售价0元','售价1.2.3元'])assert.ok(input.analyze(q).issues.salePrice,q);
});
test('补充字段不会被当前问题错误套用，裸数字只用于所选字段',()=>{
 assert.deepEqual(input.analyze('微信付款，售价1999元','customerName').facts,{salePrice:1999,account:'微信'});
 assert.equal(input.analyze('1999','price').facts.salePrice,1999);
 assert.equal(input.analyze('1999','payment').facts.salePrice,undefined);
 assert.equal(input.analyze('1234','serial').serialToken,'1234');
 assert.equal(input.analyze('张三','customerName').facts.customerName,'张三');
 assert.equal(input.analyze('顾客叫张三售价2399元微信付款').facts.customerName,'张三');
 assert.equal(input.analyze('手机号改为13900001099').facts.salePrice,undefined);
});
test('附件只从可售库存匹配，后补不臆造商品',()=>{
 const gifts=[{skuId:'case',name:'手机保护壳（模拟）',warehouseId:'B',quantity:3},{skuId:'film',name:'钢化膜（模拟）',warehouseId:'B',quantity:4}];
 assert.equal(input.giftCandidates(gifts,'手机壳')[0].skuId,'case');
 assert.equal(input.giftCandidates(gifts,'膜')[0].skuId,'film');
 assert.equal(input.giftCandidates(gifts,'不存在的附件').length,0);
 assert.equal(input.giftCandidates([{...gifts[0],quantity:0}],'手机壳').length,0);
 assert.deepEqual(input.analyze('没有附件').giftRequests,[]);
 assert.equal(input.analyze('微信未到账').facts.account,undefined);
});

test('截图中的口语开单同时提取无标签姓名、手机号、手机尾号和售价',()=>{
 const q='帮我开一个单。陈文琼。15923432599，手机1234，售价2599';
 const d=input.analyze(q);
 assert.deepEqual(d.issues,{});assert.equal(d.serialToken,'1234');assert.equal(d.saleRequest,true);
 assert.deepEqual(d.facts,{salePrice:2599,customerPhone:'15923432599',customerName:'陈文琼'});
 const matches=input.serialMatches(input.candidates(rows,q),d.serialToken).matches;
 assert.equal(matches.length,2,'真实库存有重尾号时仍返回全部候选，不能猜');
 const unique=input.serialMatches(input.candidates([rows[0]],q),d.serialToken).matches;
 assert.equal(unique[0].serialNo,'869000000001234');
});
test('手机尾号简写支持间隔、中文数字和紧邻价格，客户手机号不当作串号',()=>{
 for(const q of ['手机1234，售价2599','手机：1234 售价2599','手机幺二三四售价2599','手机是１２３４，成交价2599']){
  const d=input.analyze(q);assert.equal(d.serialToken,'1234',q);assert.equal(d.facts.salePrice,2599,q);
 }
 for(const q of ['手机15923432599','手机12345','手机1234GB','华为P1234','手机1234元','手机1234 5']){
  assert.equal(input.analyze(q).serialToken,'',q);assert.equal(input.serialToken(q,true),'',q);
 }
 const d=input.analyze('15923432599','serial');assert.equal(d.serialToken,'');assert.equal(d.facts.customerPhone,'15923432599');
 assert.equal(input.serialToken('15923432599'),'');
 assert.equal(input.analyze('串号15923432599').serialToken,'15923432599','明确说串号时保留完整值');
 assert.equal(input.analyze('帮我开单，串号990000000001234，售价2599').facts.customerPhone,undefined);
});
test('开单里的顾客姓名可在手机号前后，兼容口述数字与字段乱序',()=>{
 for(const q of [
  '开单。陈文琼。一五九二三四三二五九九。手机幺二三四。售价2599',
  '手机1234，售价2599，15923432599，陈文琼',
  '售价2599，陈文琼15923432599，手机1234',
  '帮我开单，陈文琼，159 2343 2599，手机1234'
 ]){
  const d=input.analyze(q);assert.deepEqual(d.issues,{},q);assert.equal(d.facts.customerName,'陈文琼',q);assert.equal(d.facts.customerPhone,'15923432599',q);assert.equal(d.serialToken,'1234',q);
 }
});
test('客户字段不从查账、发票、员工或供应商信息推测',()=>{
 for(const q of ['查询15923432599','手机号资源15923432599','帮我开单，发票号15923432599，手机1234，售价2599','帮我开单，营业员陈文琼15923432599，手机1234，售价2599','帮我开单，供应商15923432599，手机1234，售价2599']){
  assert.equal(input.analyze(q).facts.customerPhone,undefined,q);
 }
 for(const text of ['华为','微信付款','现金到账','帮我开个单','你好','营业员陈文琼']){
  const d=input.analyze('帮我开单，'+text+'，15923432599，手机1234，售价2599');assert.equal(d.facts.customerName,undefined,text);
 }
 for(const q of ['查一下手机1234，售价2599','查询库存，手机1234，成交价2599','统计今天卖了手机1234，售价2599']){
  assert.equal(input.analyze(q).saleRequest,false,q);
 }
});
test('简写字段冲突仍需核对，明确客户姓名优先且不提取串号内的手机号',()=>{
 assert.ok(input.analyze('开单，手机1234，手机2345，售价2599').issues.serial);
 const d=input.analyze('开单，陈文琼，15923432599，13900001099，手机1234，售价2599');
 assert.ok(d.issues.customerPhone);assert.equal(d.facts.customerPhone,undefined);assert.equal(d.facts.customerName,undefined);assert.equal(d.serialToken,'1234');
 assert.equal(input.analyze('开单，顾客张三，陈文琼，15923432599，手机1234，售价2599').facts.customerName,'张三');
 assert.equal(input.analyze('开单，串号159234325990001，售价2599').facts.customerPhone,undefined);
});

test('简写开单由真实串号定位，称呼与尾号可紧连且售价可以后补',()=>{
 for(const q of ['开个单刘德华1234。','帮我开一个单刘德华1234','开单，刘德华1234','开单 刘德华１２３４','开单刘德华幺二三四','开单，刘德华，1234']){
  const d=input.analyze(q);assert.deepEqual(d.issues,{},q);assert.equal(d.saleRequest,true,q);assert.equal(d.serialToken,'1234',q);assert.equal(d.facts.customerName,'刘德华',q);assert.equal(d.facts.salePrice,undefined,q);
 }
 for(const q of ['串号1234。','手机1234。','手机串号1234','手机串号']){
  const d=input.analyze(q);assert.equal(d.saleRequest,true,q);assert.equal(d.serialToken,q==='手机串号'?'':'1234',q);assert.equal(d.facts.customerName,undefined,q);assert.equal(d.facts.salePrice,undefined,q);
 }
 const full=input.analyze('开单刘德华869000000001234');assert.equal(full.serialToken,'869000000001234');assert.equal(full.facts.customerName,'刘德华');
});
test('简写开单里的售价、电话、容量与查询数字不能充当串号',()=>{
 for(const q of ['开单刘德华，售价2599','开单刘德华2599元','开单刘德华13800138000','开单华为P1234','开单华为1234GB','开单，发票号1234','开单，员工刘德华1234'])assert.equal(input.analyze(q).serialToken,'',q);
 for(const q of ['查串号1234','查手机1234','今天手机1234销量多少','串号1234退货','取消手机1234'])assert.equal(input.analyze(q).saleRequest,false,q);
 const d=input.analyze('开个单刘德华1234，售价2599');assert.equal(d.serialToken,'1234');assert.equal(d.facts.customerName,'刘德华');assert.equal(d.facts.salePrice,2599);
 assert.ok(input.analyze('开单刘德华1234，2345').issues.serial);
});
