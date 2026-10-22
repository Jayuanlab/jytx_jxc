'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const folder=path.resolve(__dirname,'../data/knowledge-imports/mobile-20261009');
const input=JSON.parse(fs.readFileSync(path.join(folder,'extracted.json'),'utf8'));
const docs=input.documents,hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const canonical=docs.filter(d=>!d.name.includes('副本'));
const groups=[...new Set(docs.map(d=>d.sha256))].map(sha=>docs.filter(d=>d.sha256===sha));
const duplicates=groups.filter(g=>g.length>1).map(g=>({canonical:g.find(d=>!d.name.includes('副本')).name,copies:g.filter(d=>d.name.includes('副本')).map(d=>d.name),sha256:g[0].sha256}));
const compilation=canonical.find(d=>d.name.includes('合辑'));
const overlaps=['08_业务知识考核题库.docx','09_通过产品拉动融合升档.docx','10_升档促销产品细则.docx','11_顾客场景问答话术.docx'].map(name=>{
 const d=docs.find(d=>d.name===name), body=compilation.blocks.map(b=>b.text).join('\n');
 if(!body.includes(d.blocks.map(b=>b.text).join('\n')))throw new Error('合辑并非原样全文: '+name);
 return {file:name,coveredBy:compilation.name,blocks:d.blocks.length,completeTextMatch:true};
});
const issues=[];
function issue(id,title,detail,refs,kind='待核实'){const item={id,title,detail,kind,refs:refs.map(([file,blockId])=>{const d=docs.find(d=>d.name===file),b=d?.blocks.find(b=>b.id===blockId);if(!b)throw Error(file+' '+blockId);return {file,blockId,quote:b.text};})};issues.push(item);return item;}
const f03='03_套餐资费与宽带资料.docx',f05='05_终端购机政策汇总.docx',f09='09_通过产品拉动融合升档.docx',f10='10_升档促销产品细则.docx',f11='11_顾客场景问答话术.docx',fsales='门店卖机话术知识库.docx';
issue('fttr-boundary','全光 WiFi 升档临界值写法不一致','09 的“大于30元”不含恰好30元；10 的“≥30元”和39升69例子包含30元。须确认30元是否可办，且 WiFi、看家等20元爆品不能统一当作30元。',[[f09,'p6'],[f09,'p22'],[f10,'t14'],[f10,'p16']],'口径冲突');
issue('hebao-member','和包券超级版会员费不一致','同篇超级版条件写109元年包，办理要点写219元年包；未说明不同版本或档位。须补齐版本与档次对应关系。',[[f05,'p58'],[f05,'p60']],'口径冲突');
issue('commission-example','升档酬金案例档位和公式不一致','案例写39升69，直达激励却使用(99-59)×3+40；两个算式本身分别等于150和160，但业务档位不能对应，不可据此自动算酬金。',[[f10,'p16'],[f09,'t18']],'案例错位');
issue('bayu-period','巴渝卡有效期和签约期未区分','03写2026升级版有效期2年，11的8元存量客户改套餐情境写签约期3年；可能是不同版本或叠加合约，不能把有效期与签约期混成一个字段。',[[f03,'p14'],[f11,'p14'],[f11,'p16']]);
issue('ranges','终端政策若干范围丢失连接符','原文出现10150元、1202160元、38269档、6505000元等连写，不能擅自猜测上下限。须对照原始Excel恢复区间。',[[f05,'p51'],[f05,'p52'],[f05,'p58'],[f05,'p59']],'排版错乱');
issue('vip-terms','AI购机叠加包表格排版和适用档次待核实','章节标题“最低59元套餐”下列出38/58/79/99超级版档次；原文伪表格使用竖线连写。不要把超级版档次直接当作客户实际月租，须补对应规则和原表。',[[f05,'p24'],[f05,'p25']]);
issue('voucher-exclusions','话费券互斥条款适用范围未统一','促销1及速记写40–50元与百G流量在79及以下互斥；促销5写40–50元、5–6折互斥未限定79。需确认各档套餐、渠道和30天边界。',[[f10,'p5'],[f10,'p28'],[f10,'t34']],'适用范围不清');
issue('fttr-channel','福利超市与百G流量的渠道例外容易遗漏','概括说可同办；细则另写云客服外呼渠道30天内不能同办。属于带例外规则，办理前需要确认渠道，不能仅引用概括。',[[f10,'p15'],[f10,'p28']]);
issue('broadband-versions','二宽、旺铺通和套餐版本不能混为同一报价','03分别有17/22元旺铺通、15/20元旺铺通宽带速查；11二宽有17/22、28/30、100/500M并留60–68元区间空白。需补具体产品名、客户类别、速率、设备和安装费。',[[f03,'p12'],[f03,'t34'],[f11,'p5'],[f11,'p9'],[f11,'p12']]);
issue('new-family-version','顾客话术套餐档次未对上套餐总表','11列149、159、60元方案，03列2023数家/2026全家享/5GA不同版本，不能因价格相似自动对应。需补11每个方案产品编码、版本和生效期限。',[[f11,'p20'],[f11,'p21'],[f11,'p24'],[f03,'t25'],[f03,'t29']]);
issue('subsidy-scope','“全场手机国补”缺少核销适用条件','话术给15%和500元封顶，却未列商品范围、资格、销售价、平台/地区及活动时间。暂不作为所有手机均能参加的承诺，不自动写入国补计算规则。',[[f11,'p38']]);
issue('device-promise','话术中的续航、耐用、防水和优惠承诺需按机型核实','“正常用两天一充”“洗个澡就充满”“掉水盆不怕”“两三年不卡”“今天过了可能没价”等为示例话术，不能当作任何机型的事实或实际活动。',[[fsales,'p9'],[fsales,'p31'],[fsales,'p35'],[fsales,'p54']],'示例须核实');
issue('phone-specs','机型参数存在地区版本混用与未核对项','官网抽查的荣耀X70、荣耀400、vivo Y500、iPhone17与表内关键参数不同；荣耀400还混入地区版本。整段机型表先隔离为待核实，库存与售价仍以商品档案为准。',[[fsales,'p78'],[fsales,'p79'],[fsales,'p95'],[fsales,'p107']],'参数需纠正');
issue('procedure-open','开卡流程仍有待补充字段','反诈登记、系统入口、首充、签署协议、开户成功标志、写卡失败和支付失败处理尚未填全。不会把“最终版”标题当作已经完成核对。', [['01_开卡入网开户流程.docx','p3'],['01_开卡入网开户流程.docx','t5'],['01_开卡入网开户流程.docx','p14'],['01_开卡入网开户流程.docx','p15']],'缺少细节');
issue('procedure-fusion','融合开户副卡数量与总表未区分','流程固定2或4张副卡，而全家享69档表为1张副卡；不同产品可不同，流程应按选中套餐决定张数，异常与首充/安装流程仍待补。', [['02_融合套餐入网开户流程.docx','t5'],[f03,'t29']],'流程需细化');
issue('campus-eligibility','校园卡办理对象仍待补','原文只说校园客户，学生身份、年龄/地区要求未填，不凭资费表承诺任何客户都能办；3年承诺和4年赠送为不同字段，并不矛盾。',[['04_校园青春卡资费.docx','p2'],['04_校园青春卡资费.docx','p10'],['04_校园青春卡资费.docx','p11']],'资格未补');
issue('family-table','全家享部分档位“免费成员”为空白','79/99/119/139档免费成员字段未填，不能把空白解释成0，也不能套用169档。',[[f03,'t29']],'表格空项');
issue('shujia-169','数字家庭169档有三种组合','两个169档是智能/安防版，另一个169档1000分钟40GB，翻倍表使用40GB。需要选具体版本，不能看到169就默认为同一权益。',[[f03,'t25'],[f10,'t24']],'版本须选择');
issue('seasonal','新春营销、目标机型等适用期限未填','资料含“新春营销”及季度更新机型，没有活动截止时间；不能仅因本次导入就认定活动全年可用。',[[f03,'p20'],[f05,'p32']],'有效期未填');
const articles=[];
function add(key,file,start,end,title,category,tags,summary,opts={}){
 const d=docs.find(d=>d.name===file),blocks=d.blocks.filter(b=>{const n=Number(b.id.slice(1));return n>=start&&n<=end});if(!blocks.length)throw Error(key);
 const aliases=groups.find(g=>g[0].sha256===d.sha256).filter(g=>g.name!==file).map(g=>({name:g.name,sha256:g.sha256,duplicateOf:file}));
 const reps=overlaps.some(o=>o.file===file)?[{name:compilation.name,sha256:compilation.sha256,duplicateOf:file}]:[];
 const reviewIssues=(opts.issues||[]).map(id=>{const found=issues.find(i=>i.id===id);if(!found)throw Error(id);return {id,title:found.title,detail:found.detail};});
 const row={id:'mobile-20261009-'+key,title,category,tags:tags.map(t=>t.slice(0,30)),keywords:tags,summary,body:blocks.map(b=>b.text).join('\n'),sourceTier:opts.tier||'store_policy',sourceLabel:opts.tier==='store_training'?'店内话术资料':opts.tier==='store_exam'?'店内考核题库':'店内现行资料（用户提供）',policyStatus:opts.status||(reviewIssues.length?'needs_review':'current'),asOf:input.asOf,sourceDocumentDate:opts.date||'2026-09-26',applicableScope:opts.scope||'重庆移动；用户本次提供为店内现行资料，具体客户资格按产品规则核对',sourceFiles:[{name:file,sha256:d.sha256},...aliases,...reps],sourceRefs:blocks.map(b=>({file,blockId:b.id,label:(b.kind==='table'?'表格 ':'段落 ')+b.id})),sourceBlocks:blocks.map(({style,...b})=>b),reviewIssues,enabled:true,importBatch:'mobile-20261009'};
 if(row.body.length>6000)throw Error('Too long '+title);articles.push(row);
}
add('open','01_开卡入网开户流程.docx',1,16,'新办移动号卡：开户流程','移动办理流程',['开卡','开户','办卡','新办号码','买一张卡','入网开户','实名认证'],'开户共11步，实名必须本人持证到场；首充、协议和异常处理仍需补齐。',{issues:['procedure-open']});
add('fusion','02_融合套餐入网开户流程.docx',1,22,'融合套餐：开户与宽带安装流程','移动办理流程',['融合开户','融合套餐流程','办宽带流程','装宽带流程','主副卡'],'融合开户共13步，每张卡本人实名；副卡张数须按具体套餐选择，不能固定套用。',{issues:['procedure-fusion']});
add('feixiang',f03,4,12,'神州行飞享2023：单卡资费与宽带','移动资费',['飞享','神州行飞享','单卡资费'],'本表列18至298元档；须叠加云盘或和留言合约包之一，并核对存量升档条件。');
add('bayu',f03,14,20,'巴渝卡2026升级版：资费与合约期限','移动资费',['巴渝卡','巴渝','AI体育包','AI智客礼'],'保留原始月租、全国和重庆流量表；有效期2年与场景话术签约3年尚需区分。',{issues:['bayu-period','seasonal']});
add('shujia',f03,23,26,'全球通数字家庭2023：套餐权益','移动资费',['数字家庭套餐','数家套餐','全球通数字家庭'],'分智能、安防和全融合组合；169元档存在不同语音和流量版本，须选定版型。',{issues:['shujia-169']});
add('family',f03,27,29,'全家享2026：月租、流量与副卡','移动资费',['全家享','全家享2026','全家享69','全家享79','全家享99','全家享119','全家享139','全家享169'],'69元档列300分钟、15GB、300M宽带、1张副卡；部分档位免费成员数原文空白。',{status:'current',issues:['family-table']});
add('5ga',f03,30,31,'全球通5GA2026：套餐权益','移动资费',['5GA','5GA套餐','全球通5GA'],'199至999元档表保留语音、流量、宽带、副卡和国漫权益；先核对具体档次。');
add('broadband',f03,33,36,'宽带产品速查：版型与报价','移动资费',['宽带产品','旺铺通','旺商通','二宽','第二条宽带','网龄宽带','租房宽带','度假宽带','乡村振兴'],'宽带产品按版型、客户类别、设备和安装要求区别，报价不在不同版本间互相套用。',{issues:['broadband-versions']});
add('family2025',f03,38,40,'全家乐2025：多人保底与酬金','移动资费',['全家乐','多人保底','家庭群','全家乐酬金'],'原表按家庭消费区间分类；巴渝卡可作成员不可作主卡，办宽带竣工酬金分6个月返。');
add('campus','04_校园青春卡资费.docx',1,11,'校园青春卡：资费、承诺与副卡','移动资费',['校园青春卡','青春卡','动感地带','校园副卡'],'19/39/59元档承诺期3年；校园流量包赠送4年，两者不同。学生身份要求仍待补。',{status:'current',issues:['campus-eligibility']});
add('terminal',f05,3,22,'2026终端直降：条件、金额与办理步骤','终端购机政策',['终端直降','信用购','AI豆','购机直降','升档价差','超级版','优选会员139'],'升档价差版区分24/36期、预存权益包和目标客户；金额表仅为升档价差版示例。');
add('ai-festival',f05,24,26,'AI购机节：叠加包档位','终端购机政策',['AI购机节','叠加包','1元领手机'],'超级版档次与实际套餐月租对应未说明，原文表格排版待核实。',{issues:['vip-terms']});
add('shuncha',f05,28,36,'顺差让利：标准版与流量版','终端购机政策',['顺差让利','顺差','机卡合一','120GB融合版'],'区分标准版、12GB版、120GB融合版及会员搭载；直降次月与第三月各结50%。',{issues:['seasonal']});
add('ai-phone',f05,38,46,'AI手机合约：档案与分月酬金','终端购机政策',['AI手机合约','AI购机权益包','AI融合权益包','和动力'],'三项合约加入购物车一起提交，保存人机合影及串号特写；酬金T+1起分6个月返，须满足在网条件。');
add('yiye',f05,48,53,'异业购：非手机终端直降','终端购机政策',['异业购','金币直降','非手机终端','儿童手表金币'],'原文部分金额区间连写，须从原始Excel核对，不能自动猜测金额范围。',{issues:['ranges']});
add('hebao',f05,55,64,'和包券：超级版与纯享版','终端购机政策',['和包券','和包','和包券超级版','和包券会员费','电动车直降'],'超级版109/219元会员费写法不一致，金额区间也有连写；待确认版本后使用。',{issues:['hebao-member','ranges']});
const f06='06_常见业务办理与售后.docx';
add('porting',f06,3,8,'携号转网：转入与转出','移动办理流程',['携号转网','携转','转入','转出'],'转入先用本机向原运营商申请授权码；合约、欠费和活动捆绑要核对。');
add('sim-replace',f06,9,14,'补卡：实名、费用和异地办理','移动办理流程',['补卡','异地补卡','V3'],'原资料写本人持有效证件原件到场，V3免费，其余10元；本店异地办理能力须按现场核对。');
add('package-change',f06,15,23,'套餐变更：升档、降档与生效','移动办理流程',['套餐变更','改套餐','降档','降低月租','升档生效'],'单卡升档可立即或次月，融合升档立即生效；未到期降档先处理合约。');
add('transfer-close',f06,24,30,'过户与销户：办理要求','移动办理流程',['过户','销户','改名字','换户主'],'过户新旧机主本人各持证件；销户处理按原文指定办理点核实。');
add('broadband-service',f06,31,36,'宽带售后：报修与自查','移动办理流程',['宽带报修','宽带故障','网络故障','一键响应'],'先指导重启光猫，仍不能使用走移家人一键响应或联系资料中的安装师傅。');
const exam=docs.find(d=>d.name==='08_业务知识考核题库.docx'),questionBlocks=exam.blocks.filter(b=>/^第\d+题/.test(b.text));
const questionNumbers=questionBlocks.map(b=>Number(b.text.match(/^第(\d+)题/)[1])).sort((a,b)=>a-b);
if(questionNumbers.length!==22||questionNumbers.some((n,i)=>n!==i+1))throw Error('题号不完整');
for(const b of questionBlocks){const n=Number(b.text.match(/^第(\d+)题/)[1]),i=exam.blocks.indexOf(b),answer=exam.blocks[i+1];if(!answer?.text.startsWith('正确答案：'))throw Error('答案错位 '+n);
 const cleanQuestion=b.text.split(' - A、')[0].replace(/^第\d+题（[^）]+）/,'').slice(0,60);
 add('exam-'+n,exam.name,Number(b.id.slice(1)),Number(answer.id.slice(1)),`考核第${n}题：${cleanQuestion}`,'移动考核题库',['考核题库','第'+n+'题','业务考试',cleanQuestion],n===11?'第11题要求选“错误项”，答案B、C、D；这些选项不能当作正确业务规则。':'保留原题、完整选项和答案；错项仅供复习，不作为办理依据。',{tier:'store_exam',scope:'重庆移动员工考核复习；试题选项含错误项，不能单独抽取为业务规则'});
}
add('upgrade-marketing',f09,4,24,'融合升档：客户分类与营销酬金','移动促销',['融合升档','升档营销','产品拉动升档','升档酬金','两异酬金'],'先区分客户类别，酬金倍数是店内内部激励口径；爆品临界值与案例尚待核实。',{date:'2026-09-27',issues:['fttr-boundary','commission-example']});
add('voucher',f10,4,9,'升档话费券：条件与互斥','移动促销',['升档话费券','话费券','直降话费券','话费券40','话费券50'],'话费券客户标签和互斥要求按具体档次核对，不能把“全量用户”理解成任意客户均可办。',{date:'2026-09-27',issues:['voucher-exclusions']});
add('fttr',f10,11,16,'福利超市爆品：全光、WiFi与看家','移动促销',['福利超市','福利超市爆品','爆品','全光WiFi','全光wifi','FTTR','升档送FTTR','升档送wifi','升档送看家'],'不同爆品有不同价差、价格和签约期；全光临界值、渠道例外与酬金案例待确认。',{date:'2026-09-27',issues:['fttr-boundary','fttr-channel','commission-example']});
add('double-data',f10,18,24,'升档流量翻倍：焕新版与数家版','移动促销',['流量翻倍','升档流量翻倍','焕新版','数家版'],'入网6个月以上、近30天升档至指定套餐；赠重庆流量1倍、100GB封顶，3年到期取消，不共享结转。',{date:'2026-09-27',scope:'重庆移动指定存量用户；数家只能数家升数家，169档需选版型',issues:['shujia-169'],status:'current'});
add('100gb',f10,26,34,'回家行动百G流量：资格和互斥','移动促销',['百G流量','百g流量','升档享百G流量','100GB','回家行动'],'仅回家行动、20元以下升至指定69及以上套餐；互斥的档次/渠道范围仍须确认。',{date:'2026-09-27',issues:['voucher-exclusions','fttr-channel']});
for(const [n,start,end,title,tags,ids] of [
 [1,4,12,'已有宽带再装一条：二宽报价',['二宽报价','第二条宽带多少钱'],['broadband-versions']],
 [2,14,17,'8元存量套餐改巴渝卡',['8元改巴渝卡','巴渝卡签约'],['bayu-period']],
 [3,19,21,'160元以内家庭融合推荐',['149元套餐','159元套餐','160元以内'],['new-family-version']],
 [4,23,29,'异网58元客户携入方案',['全球通超级家60','携入方案'],['new-family-version']],
 [5,31,35,'电动车购机直降说明',['电动车','领电动车'],['hebao-member']],
 [6,37,39,'国补和以旧换新说明',['国补优惠','国补资格','以旧换新'],['subsidy-scope']],
 [7,41,43,'副卡分户和过户',['副卡改名字','副卡过户','副卡分户'],[]]
])add('scene-'+n,f11,start,end,title,'顾客场景话术',tags,'场景应答需先核对客户条件和具体产品版本；相关金额和规则保留出处。',{tier:'store_training',date:'2026-09-27',issues:ids});
add('sales-six',fsales,3,27,'卖机接待：六步法与开场','销售话术',['成交六步法','迎客','卖机话术','开场','迎客破冰'],'从迎客、问需求、试机到收款送客；示例中的续航、优惠和服务承诺须对照实际商品核实。',{tier:'store_training',date:'2026-09-27',issues:['device-promise']});
add('sales-objections',fsales,28,45,'卖机接待：常见顾虑与回应','销售话术',['嫌贵','太贵','网上便宜','怕卡','顾客异议','再考虑'],'先了解顾虑，再说明可核实的商品和服务；耐用年限、赠品和活动不按示例直接承诺。',{tier:'store_training',date:'2026-09-27',issues:['device-promise']});
add('parameters',fsales,46,56,'手机参数：用顾客听得懂的话解释','销售话术',['参数解释','防水','IP68','IP69','快充','RAM','ROM'],'参数说明仅为话术草稿，实际续航、防水、性能和充电效果不能一概而论。',{tier:'store_training',date:'2026-09-27',issues:['device-promise']});
add('phone-list',fsales,57,71,'原始机型速选名单：待核实版型','机型资料待核实',['机型名单','主销机型','iPhone18','小米18','FindX10','X500'],'此名单与参数段未完全对应；不据此新增库存、承诺在售或推断机型配置。',{tier:'store_training',date:'2026-09-27',issues:['phone-specs']});
for(const [key,start,end,title,tags] of [['huawei',73,76,'华为',['华为参数','Mate80参数','Pura80参数','nova15参数']],['honor',77,80,'荣耀',['荣耀参数','荣耀400','荣耀X70','荣耀Magic8']],['xiaomi',81,88,'小米和红米',['小米参数','红米参数','Turbo4','K90','Note15']],['oppo',89,92,'OPPO',['OPPO参数','FindX9','Reno15']],['vivo',93,98,'vivo 和 iQOO',['vivo参数','vivoY500','iQOO参数']],['realme',99,101,'真我',['真我参数','realme参数']],['oneplus',102,104,'一加',['一加参数','Ace6']],['apple',105,107,'苹果',['苹果参数','iPhone17','iPhone18参数']]])add('spec-'+key,fsales,start,end,title+'机型参数：待核实','机型资料待核实',tags,'原始参数完整保留，但未经逐型号/地区核验，暂不作为产品确定配置。',{tier:'store_training',date:'2026-09-27',issues:['phone-specs']});
const ownerFile='老板补充口径_20261009.txt',ownerText=fs.readFileSync(path.join(folder,ownerFile),'utf8').replace(/^\uFEFF/,'').trim();
const fttrResolution=issues.find(i=>i.id==='fttr-boundary');fttrResolution.status='resolved';fttrResolution.resolution='老板本次确认升档增加30元及以上，可9元办理全光；具体资格、收费周期和合约以营业员现场核实为准。';
for(const article of articles){article.reviewIssues=article.reviewIssues.filter(i=>i.id!=='fttr-boundary');if(article.id.endsWith('-fttr')){article.enabled=false;article.retiredReason='老板说明有旧版口径；全光门槛及办理价按本次补充资料，其他爆品保留原文归档。';}}
articles.push({id:'mobile-20261009-fttr-current',title:'全光办理：老板补充门槛与办理价',category:'移动促销',tags:['全光','FTTR','全光WiFi','全光办理价','全光升档门槛'],keywords:['全光','FTTR','全光WiFi','全光办理价','全光升档门槛'],summary:'升档增加30元及以上，可9元办理全光；营业员核对具体产品和办理条件。',body:'老板确认：升档增加30元及以上，可9元办理全光。\n9元的收费周期、合约期及其他客户条件尚未说明，不能推定为9元/月；营业员根据移动 BOSS 核实后办理。',sourceTier:'store_policy',sourceLabel:'老板补充口径（参考话术）',policyStatus:'current',asOf:input.asOf,sourceDocumentDate:input.asOf,applicableScope:'本店机器人参考话术；营业员负责核实具体产品与资格',sourceFiles:[{name:ownerFile,sha256:hash(fs.readFileSync(path.join(folder,ownerFile)))}],sourceRefs:[{file:ownerFile,blockId:'owner-1',label:'老板补充第1项'}],sourceBlocks:[{id:'owner-1',kind:'paragraph',text:'老板确认：升档增加30元及以上，可9元办理全光。'},{id:'owner-note',kind:'paragraph',text:'9元的收费周期、合约期及其他客户条件尚未说明，不能推定为9元/月；营业员根据移动 BOSS 核实后办理。'}],sourceFields:['threshold','handlingFee'],userConfirmed:true,reviewIssues:[],enabled:true,importBatch:'mobile-20261009'});
const checkedAnswers=questionBlocks.map(b=>{const answer=exam.blocks[exam.blocks.indexOf(b)+1],marks=[...b.text.matchAll(/(?:^| - )([A-F])、([^]*?)(?= - [A-F]、|$)/g)].filter(m=>m[2].includes('✅')).map(m=>m[1]);const expected=[...answer.text.matchAll(/[A-F]/g)].map(m=>m[0]);if(marks.join('')!==expected.join(''))throw Error('勾选答案不匹配 '+b.id);return {number:Number(b.text.match(/^第(\d+)题/)[1]),blockId:b.id,checked:marks,answer:expected,consistent:true};});
const report={asOf:input.asOf,inputFiles:docs.length,uniqueBinaryFiles:canonical.length,duplicates,overlaps,exam:{questionCount:22,missingNumbers:[],answerMarkMismatch:0,questions:checkedAnswers,note:'按主题重排但原始题号完整；第11题是选错误项。'},issues,organization:{articleCount:articles.length,current:articles.filter(a=>a.enabled!==false&&a.policyStatus==='current').length,needsReview:articles.filter(a=>a.enabled!==false&&a.policyStatus==='needs_review').length,disabled:articles.filter(a=>a.enabled===false).length,note:'说明文件仅归档为整理依据；不执行文档中的覆盖/删除指令。合辑与副本归并到原篇来源；原件和数字未修改。'},ownerClarifications:{file:ownerFile,sha256:hash(fs.readFileSync(path.join(folder,ownerFile))),text:ownerText,unassignedNote:'新版139元通赔会员和60元电池保尚未明确对应产品，保留参考备注。'},sources:docs.map(({name,sha256,contentSha256,characters})=>({name,sha256,contentSha256,characters}))};
const specFile=path.join(folder,'model-spec-agent.json');if(fs.existsSync(specFile))report.externalSpotCheck=JSON.parse(fs.readFileSync(specFile,'utf8'));
const agentFile=path.join(folder,'audit-agent.json');if(fs.existsSync(agentFile))report.independentAudit=JSON.parse(fs.readFileSync(agentFile,'utf8'));
const bundle={schemaVersion:1,id:'mobile-20261009',asOf:input.asOf,sourceAssertion:'用户在本次提供为现行资料；文档原有待核对和具体缺项均保留，不表示运营商官方已审核',articles,report};bundle.fingerprint=hash(bundle);
fs.writeFileSync(path.join(folder,'bundle.json'),JSON.stringify(bundle,null,2)+'\n','utf8');fs.writeFileSync(path.join(folder,'audit-report.json'),JSON.stringify(report,null,2)+'\n','utf8');
const htmlTemplate=fs.readFileSync(path.resolve(__dirname,'../web/knowledge-review.html'),'utf8'),css=fs.readFileSync(path.resolve(__dirname,'../web/knowledge.css'),'utf8'),js=fs.readFileSync(path.resolve(__dirname,'../web/knowledge-review.js'),'utf8');
const localHTML=htmlTemplate.replace('<link rel="stylesheet" href="/knowledge.css">','<style>'+css+'</style>').replace('<script src="/knowledge-review.js" defer></script>','').replace('</body>','<script type="application/json" id="review-data">'+JSON.stringify(report).replace(/</g,'\u003c')+'</script><script>'+js.replace(/<\/script/gi,'<\\/script')+'</script></body>');
fs.writeFileSync(path.join(folder,'整理核对报告.html'),localHTML,'utf8');
console.log(JSON.stringify({files:report.inputFiles,uniqueFiles:report.uniqueBinaryFiles,duplicates:duplicates.length,overlappingDocuments:overlaps.length,articles:articles.length,current:report.organization.current,needsReview:report.organization.needsReview,issues:issues.length,fingerprint:bundle.fingerprint}));
module.exports={bundle,report};
