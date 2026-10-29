const c = require('./common');
const policyKnowledge = require('./policy-knowledge-query');
const customerTalk = require('./customer-talk-query');
const seeds = [
  {id:'knowledge-reception',title:'从接待开始：小事也留单',category:'接待与销售',summary:'每次接待都留下过程；有手机号可关联客户，无手机号也保留底根，积分由老板核定。',tags:['接待','手机号','底根','无效单','小事'],body:'先记录顾客来意、你做了什么、结果怎样。客户姓名和手机号尽量征得本人同意后填写；无手机号也可建接待底根，不编造号码。\n有手机号只是有效性核对的一项依据，最终有效性和奖励以店内确认结果为准。无手机号接待按基本积分规则提交核定，不自行认定已获奖励。\n未成交时写明顾客关心的问题和后续约定；后来成交时关联原接待单，保留每位员工参与的时间与内容。\n例：顾客问儿童手表，我比较了续航和定位功能，顾客要回家商量，约定周末再来。'},
  {id:'knowledge-needs',title:'先问需求，再推荐商品',category:'接待与销售',summary:'先了解用途、预算和在意的功能，提供两三个适合的选项，解释差别，让顾客自己选择。',tags:['需求','推荐','推销','选机','预算','销售技巧'],body:'先问：主要给谁用？平时最常做什么？预算大致多少？最看重续航、拍照、耐用还是方便使用？\n复述需求确认理解，再从真实可售库存选两三个合适商品。用顾客熟悉的使用场景说明差别，不夸大功能，不承诺未核实的优惠。\n顾客犹豫时问：您主要还在考虑哪一点？可以演示、查证或稍后跟进。避免催促或把高价当作唯一推荐。\n推荐理由、异议和最终选择都记在接待单，方便同事接手和后续复盘。'},
  {id:'knowledge-demo',title:'商品演示与顾客异议',category:'接待与销售',summary:'用实际演示解释价值，先听完顾客顾虑，再查证并回应；不懂的问题先核实。',tags:['演示','异议','话术','贵','便宜','不懂'],body:'先征得同意再演示顾客最在意的一两个功能。例如字体大小、拍照、儿童手表操作。演示使用样机，避免更改顾客私人资料。\n顾客说贵，先问在比较哪款、差在哪个需求，再说明可核实的配置、服务和价格差异。不要贬低其他商家。\n不确定商品参数、活动条件或办理资格时，明确说我帮您核实，不让助理编答案。核实后再给明确结论。\n成交前复述型号、容量、颜色、价格和服务范围，避免口头约定与单据不一致。'},
  {id:'knowledge-serial',title:'选货与串号：后四位先找，完整号确认',category:'商品与库存',summary:'扫码、拍照识别或后四位都能辅助查找；后四位可能重复，出库必须确认完整串号和库存状态。',tags:['串号','后四位','扫码','库存','选货','IMEI'],body:'先按仓库、品牌、型号筛选实际库存，再扫码或输入串号。后四位只用于缩小范围，出现多条必须让人选定，不能让助理猜。\n核对完整串号、机型、容量、颜色、成色和可售状态。识别结果与实物不一致时停止确认并重新核对。\n无串号配件按商品编码或二维码和数量处理；A 手机数码仓、B 配件仓、C 移动业务仓以当前档案为准。同名商品核对所属仓库；C仓直接建档或入库，名称按原商品显示。\n商品名称、售价和成本从当前档案读取；没有价格或货物不存在时先补档，不填估算数字充当事实。'},
  {id:'knowledge-price',title:'成交价格与改价留痕',category:'商品与库存',summary:'先使用档案零售价，再核对本单成交价；改本单价格和调整商品档案价格是两个操作，都要留依据。',tags:['售价','调价','零售价','优惠','成交价'],body:'选择商品后先看档案零售价是否带入售价框。确认顾客选购的数量和本单成交价格，再核对优惠后的应收金额。\n临时优惠只修改本单售价，填写原因；长期价格变化走商品调价流程。遵循当前权限规则，涉及审批时提交给有权限的人。\n已经完成的销售单不通过直接改历史金额来修账，应走原单关联的退货或红冲流程。\n在顾客可听见的场景，不主动播报成本、毛利或员工奖励，避免把内部核算信息当作销售话术。'},
  {id:'knowledge-gift',title:'附件与赠品的核对',category:'接待与销售',summary:'使用“附件核对”的中性提示；赠品也扣库存和成本，超限按当前规则送审，补送关联原销售单。',tags:['附件','赠品','搭配','补送','成本'],body:'成交前问营业员是否有需要一起登记的附件，不主动对顾客提示一定有赠品。哪些商品赠送，以实际承诺和批准结果为准。\n选择店内可搭配商品，核对数量、成本和库存。赠品成本计入本单核算，不能用零售价代替成本。\n毛利比例、单件成本上限以老板当前设置为准；超限提交老板或有赠品审批权限的老板娘确认，助理只提供提示。\n销售单提交后补送，另开赠品单并关联原销售单号，保留申请、审批和实际交付记录。'},
  {id:'knowledge-cash',title:'现金收款与交接：双方确认',category:'资金与交班',summary:'现金收到抽屉与交给老板是两个环节；交出人登记，实际接收人确认，未确认不能当作已交清。',tags:['现金','抽屉','交接','交款','交给老板娘','收款'],body:'现金收款先数清金额，核对销售单应收和找零，实际放入门店现金抽屉后登记。非本人实际收款时提交接收人核对，不能替别人确认收到了钱。\n交款时先清点金额，注明交给谁、现金还是存银行、交接时间及关联单据。由实际接收人确认到账或收到现金。\n未确认交接保留在待办，发现差异写原因并核对凭据，不补填虚假确认。老板或老板娘之间的转款也按实际经营用途记录。\n收款截图只是核对线索，最终以真实到账或实点现金为依据；不因截图存在就自动认定已收款。'},
  {id:'knowledge-receipt',title:'采购验收与分批入库',category:'采购与验收',summary:'订货、付款、发货和收货分别记；收到多少确认多少，未到部分继续挂账，不能把已付款当作已收货。',tags:['采购','验收','收货','入库','供货商','分批'],body:'营业员从本人工单进入验收，核对订货单、供应商和实物。记录数量、完整串号、型号、状态和差异，并保留凭据。\n分批到货按实际收到数量确认。未收到、少货或问题货继续保留待处理，不补齐未到数量。\n支付供应商款项是资金记录，验收入库是库存记录，两者分别核对。只有全部完成入库及应处理事项后，订单才按当前流程闭合。\n发现多货、错货、损坏、重复串号时说明原因并提交处理，每位经手人和每一步都留痕。'},
  {id:'knowledge-boss',title:'移动 BOSS 空充与现金核对',category:'移动与国补',summary:'平台充值区分实付、手续费和实际增加余额；现金话费充值与平台扣减分别登记，再对余额核差。',tags:['BOSS','boss','空充','充值','手续费','移动'],body:'向平台充入资金时记录实付金额、手续费和实际到账余额。例如实付 2000、扣费 4、余额增加 1996，应分别登记，不能把 2000 全记成可用余额。\n按本店规定，柜台话费充值收现金，确认业务号码、金额和实际成功结果。失败或结果不明确时先核实，避免重复充值。\n话费充值收回的现金、平台余额扣减和可能的服务收益分别核算，现金回收不等于全部是门店利润。\n日结照移动 BOSS 的数据核对笔数、金额和期末余额；没有接口取数时人工填外部数字，系统算差异，不编造平台余额。'},
  {id:'knowledge-carrier',title:'移动业务分月酬金',category:'移动与国补',summary:'预估酬金、移动确认酬金和实际到账分开记录，按业务单逐月核对，不把预计金额当作收到的钱。',tags:['酬金','分期','移动业务','佣金','次月','结算'],body:'记录真实办理的业务类型、套餐档位、外部业务号、办理人和客户标识。套餐与奖励条件使用经过确认的最新规则，不套用旧口径。\n按约定的月份建立预计应得金额；移动结算表确认后再记确认金额，到账后记实际收款及对应月份。\n预计、确认、到账分别展示。少发、延后、扣回或条件未达成要留说明和结算凭据，不直接把差额抹掉。\n申请营业员红包或奖励时关联业务单，由老板核定；奖励作为门店支出记录，不能自动抵扣工资，也不能再次重复发放。'},
  {id:'knowledge-subsidy',title:'国补销售与后续核销',category:'移动与国补',summary:'普通销售和国补销售区分通道；顾客实付、平台补贴、确认金额及到账分别跟踪，退货关联原业务。',tags:['国补','补贴','核销','国补退货','普通销售'],body:'开单时选择实际销售通道，确认商品、串号、销售价格和顾客实付，再关联平台单号及核销凭据。\n适用范围、资格、金额和平台要求以当时真实规则为准；知识库不代替平台校验，不凭传言自动计算补贴。\n预估补贴、平台确认补贴和到账分开登记。平台应收与顾客付款分别核对，避免漏记或重复确认。\n退货或取消必须关联原销售、补贴及平台撤销记录。按真实流程办理回退，原记录保留，新处理留痕。'},
  {id:'knowledge-after-sale',title:'售后、退货与红冲',category:'售后与核对',summary:'售后从原单追踪，退货、退款、库存及补贴分别核对；纠错保留原记录，不能直接删除交易痕迹。',tags:['售后','退货','红冲','退款','换货'],body:'先找原销售单、流水号或完整串号，核对实物、原收款、已送附件以及顾客的问题。后四位只用于找候选。\n实际退回商品按状态验收；退款记录实际支付账户、金额和接收结果。退货入库、退款到账和补贴撤销是不同环节。\n红冲是原单关联的冲销处理，不是删除记录。说明原因，按权限确认，保留原单、红冲单和操作人。\n仅修改说明文字不能解决金额或库存差异；未核实事项留待办，避免先关单再补证据。'},
  {id:'knowledge-assist',title:'协助与成果转化有依据',category:'员工参与与奖励',summary:'推荐客户、主动协助、后续转化都记录贡献；助理整理证据和建议，老板最后判断有效性及分配。',tags:['协助','转化','提成','奖励','成果'],body:'协助单写清发起人、协助人、参与时间、具体做了什么和对应接待或交易。双方有争议时保留各自说明。\n前期接待后来由另一员工成交，可申请成果转化，关联客户手机号、原接待、后续跟进和成交单，不凭同一手机号自动认定全部贡献。\n助理只根据已登记事实提供参考，最终由老板判定。协助提成按当前核定规则从原销售人的提成中分出，避免重复计奖。\n没有成交也可记录真实服务和学习；积分和现金奖励分别核定，积分不自动等同工资或已付款。'},
  {id:'knowledge-reflection',title:'学习单与小事复盘',category:'员工参与与奖励',summary:'问答、整理、演示、协助和验收都能形成学习记录；写清事件、所学和改进，老板审核后核分。',tags:['学习单','复盘','培训','小事','积分','知识'],body:'每天挑一件真实参与的事：帮顾客设置字体、学习新机型、整理标签、协助验收、核对现金或观察同事接待。\n按事件、学到的内容、心得与下次改进填写；关联接待、销售或业务单，具体说明自己的参与，不复制空泛评价。\n例：我帮顾客调整手机字体并教他找设置；学会先问对方是否看得清；下次先备份并只改顾客同意的项目。\n学习内容和贡献供老板审核。没有登记不等于没有工作，助理可以提醒补记录，但不能凭记录少就自动处罚。'},
  {id:'knowledge-close',title:'日结与交班核对',category:'资金与交班',summary:'经营日报自动汇总只是账面结果；实点现金、贵重品及外部平台逐项核对，再按复核流程确认。',tags:['日结','扎账','轧账','交班','核对'],body:'先看当日销售、采购入库、退货、资金和往来汇总，再核对现金抽屉、贵重库存及外部平台数字。\n说明现金从哪里来、交给谁、是否已确认。老板个人经营垫款、内部转款与门店收入费用要区分，不能把转款算成再次营业收入。\n差异写原因和处理进展；一方提交、另一人按真实流程复核。仍待确认的处理单交给老板待办，不假装已结清。\n锁定后需要修正时走老板授权的解锁或调整流程，保留每次确认、驳回和更正的记录。'},
  {id:'knowledge-privacy',title:'真实数据、权限与顾客资料',category:'售后与核对',summary:'助理只按当前账号权限使用真实已录入数据；不知道就查证，客户资料按业务所需收集和使用。',tags:['真实数据','权限','隐私','资料','客户信息','保密'],body:'接待时说明为什么需要手机号或资料；非必要不收集、不传播，不把顾客资料发到无关群聊或私人设备。\n助理回答真实账目要注明可查询的单据，缺失就说明未记录或待确认，不把推测当事实。知识技巧属于培训建议，不等于该笔业务已经发生。\n不要共享员工账号。谁登录谁开单、谁操作谁留痕，审批和收款确认由有权限且实际参与的人完成。\n顾客在场时语音尽量只说选购所需信息；成本、毛利、工资及内部监督信息不要公开播报。'},
];
const builtInIds = new Set(seeds.map(row => row.id));
const brief = value => String(value || '').trim();
function rowFor(store, id) {
  const seed = seeds.find(row => row.id === id);
  const custom = (store.employeeKnowledge || []).find(row => row.id === id);
  return custom ? {...seed, ...custom, builtIn:!!seed} : seed ? {...seed,enabled:true,version:1,builtIn:true} : null;
}
function all(store) {
  const ids = [...seeds.map(row => row.id), ...(store.employeeKnowledge || []).filter(row => !builtInIds.has(row.id)).map(row => row.id)];
  return [...new Set(ids)].map(id => rowFor(store,id)).filter(Boolean).map(row => JSON.parse(JSON.stringify({...row,tags:[...(row.tags||[])]}))); 
}
function catalog(store, user, query = '') {
  c.permit(user,'learn');
  const q = brief(query).toLocaleLowerCase('zh-CN').slice(0,120);
  const canManage = c.capabilities(user).manageUsers;
  const managed = all(store).filter(row=>row.submissionStatus!=='pending'||canManage||row.uploadedBy===user.id).sort((a,b)=>sourceRank(a)-sourceRank(b));
  const items = managed.filter(row => row.enabled !== false && (!q || [row.title,row.category,row.summary,row.body,row.applicableScope,...row.tags,...(row.keywords||[]),...(row.customerQuestions||[]),...(row.matchKeywords||[]).flat(),...(row.sourceFiles||[]).map(f=>f.name)].join(' ').toLocaleLowerCase('zh-CN').includes(q)));
  const authority=require('./rule-authority'),old=items.filter(r=>authority.protectedTopic(r));const current=authority.publicPolicy().rules.map(r=>({id:'active-rule-'+r.topicKey,title:r.title,summary:r.content,body:r.content,category:'当前经营规则',tags:['现行规则'],enabled:true,policyStatus:'current',version:r.version,authorityPolicyId:authority.publicPolicy().policyId}));
  return {items:[...current,...items.filter(r=>!authority.protectedTopic(r))],historicalItems:old.map(r=>({...r,policyStatus:'historical',historyOnly:true,notice:'仅历史查询，办理以当前经营规则为准'})),categories:[...new Set(managed.filter(row => row.enabled!==false).map(row=>row.category))],canManage,canSubmit:c.capabilities(user).knowledgeSubmit,...(canManage?{manageItems:managed}:{}),note:'店内提供的现行资料优先；待核实内容不作确定报价。真实账目仍从业务单据查询。'};
}
function clean(value,label,max) {
  const text=c.text(value,label);
  if(text.length>max)throw new c.HttpError(400,`${label}不能超过${max}字`);
  return text;
}
function sourceRank(row) {return ['store_policy','store_training','store_exam'].includes(row.sourceTier)?(row.policyStatus==='current'?0:2):1;}
function optionalText(value,label,max) {if(value==null||value==='')return '';return clean(value,label,max);}
function policyDate(value,label) {
  if(value==null||value==='')return '';
  if(typeof value!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new c.HttpError(400,label+'不正确');
  return value;
}
function conversationFields(payload,before) {
  const fields=['customerQuestions','matchKeywords'];
  if(fields.some(name=>Object.hasOwn(payload,name))&&!before?.conversationTopic)throw new c.HttpError(400,'只有接话话术可以维护常见问法和关键词组合');
  const result={};
  if(Object.hasOwn(payload,'customerQuestions')){
    if(!Array.isArray(payload.customerQuestions)||payload.customerQuestions.length>12||payload.customerQuestions.some(value=>typeof value!=='string'||!value.trim()||value.trim().length>240))throw new c.HttpError(400,'常见问法最多12句，每句须填写且不超过240字');
    result.customerQuestions=[...new Set(payload.customerQuestions.map(brief))];
  }
  if(Object.hasOwn(payload,'matchKeywords')){
    if(!Array.isArray(payload.matchKeywords)||payload.matchKeywords.length>8||payload.matchKeywords.some(group=>!Array.isArray(group)||!group.length||group.length>12||group.some(value=>typeof value!=='string'||!value.trim()||value.trim().length>30)))throw new c.HttpError(400,'关键词组合最多8组，每组1至12个词，每词须填写且不超过30字');
    result.matchKeywords=payload.matchKeywords.map(group=>[...new Set(group.map(brief))]);
  }
  return result;
}
function save(store,user,payload) {
  c.permit(user,'manageUsers');
  const id=payload.id?clean(payload.id,'文章编号',100):c.id('KN');
  const before=payload.id?rowFor(store,id):null;
  if(payload.id&&!before)throw new c.HttpError(404,'知识文章不存在');
  if(payload.version!==undefined&&payload.version!==before?.version)throw new c.HttpError(409,'资料已经被修改，请刷新后再保存');
  const title=clean(payload.title,'标题',80),category=clean(payload.category,'分类',30),summary=clean(payload.summary,'简要说明',240),body=clean(payload.body,'正文',6000);
  if(payload.enabled!==undefined&&typeof payload.enabled!=='boolean')throw new c.HttpError(400,'启用状态不正确');
  const tags=(Array.isArray(payload.tags)?payload.tags:(payload.tags?String(payload.tags).split(/[，,、\n]/):before?.tags||[])).map(brief).filter(Boolean);
  if(tags.length>20||tags.some(tag=>tag.length>30))throw new c.HttpError(400,'关键词最多20个，每个不超过30字');
  const policyStatus=payload.policyStatus===undefined?before?.policyStatus:payload.policyStatus;
  if(policyStatus!==undefined&&!['current','needs_review','historical'].includes(policyStatus))throw new c.HttpError(400,'资料状态不正确');
  const applicableScope=payload.applicableScope===undefined?before?.applicableScope:optionalText(payload.applicableScope,'适用范围',400);
  const validFrom=payload.validFrom===undefined?before?.validFrom:policyDate(payload.validFrom,'生效日期'),validTo=payload.validTo===undefined?before?.validTo:policyDate(payload.validTo,'截至日期');
  if(validFrom&&validTo&&validFrom>validTo)throw new c.HttpError(400,'截至日期不能早于生效日期');
  const conversation=conversationFields(payload,before);
  const stamp=c.now(),row={...before,...conversation,id,title,category,summary,body,tags:[...new Set(tags)],enabled:payload.enabled===undefined?before?.enabled!==false:payload.enabled,version:(before?.version||0)+1,updatedAt:stamp,updatedBy:user.id,updatedByName:user.name};
  delete row.builtIn;
  if(policyStatus!==undefined)row.policyStatus=policyStatus;
  if(applicableScope!==undefined)row.applicableScope=applicableScope;
  if(validFrom!==undefined)row.validFrom=validFrom;
  if(validTo!==undefined)row.validTo=validTo;
  if(before?.importBatch || before?.uploadSha256){
    row.editedAfterImport=true;
    if(summary!==before.summary){const note='摘要已由老板修订，不能当作原文逐字引用；原文件出处保留。';row.sourceNotes=[brief(before.sourceNotes),brief(before.sourceNotes).includes(note)?'':note].filter(Boolean).join('\n');}
    if(body!==before.body){row.sourceBlocks=[{id:'edit-v'+row.version,kind:'paragraph',text:body}];row.tables=[];row.keywords=row.tags;row.sourceLabel='店内修订资料';row.sourceRevisionNote='原文件出处保留；正文已由老板修订，不能当作原文逐字引用。';}
    if(before.policyStatus==='needs_review'&&policyStatus==='current'){row.reviewDecision={by:user.id,name:user.name,at:stamp,status:'current',previousIssues:before.reviewIssues||[]};row.reviewIssues=[];row.asOf=c.day(stamp);}
  }
  // Every edit creates a new version. The previous embedding may remain for audit,
  // but is never eligible for customer retrieval until this version is reviewed.
  if(before?.customerVisible){row.customerVisible=false;row.submissionStatus='pending';row.indexContentHash=null;}
  store.employeeKnowledge ||= [];
  const index=store.employeeKnowledge.findIndex(item=>item.id===id);
  if(index<0)store.employeeKnowledge.push(row);else store.employeeKnowledge[index]=row;
  store.operationLogs ||= [];
  c.audit(store,user,'knowledge:save',JSON.stringify({id,version:row.version,before,after:row}));
  return JSON.parse(JSON.stringify({...row,builtIn:builtInIds.has(id)}));
}
function remove(store,user,payload) {
  c.permit(user,'manageUsers');
  const before=rowFor(store,payload.id);
  if(!before)throw new c.HttpError(404,'知识文章不存在');
  const result=save(store,user,{...before,enabled:false});
  return {disabled:true,id:result.id,version:result.version};
}
const topics=[
  ['knowledge-reception',/(?:怎么|如何|怎样|技巧|学习|知识).*(?:接待|无手机号|底根)|(?:接待|无手机号|底根).*(?:怎么|如何|怎样|技巧|学习|知识)/],
  ['knowledge-gift',/(?:附件|赠品|补送)/],
  ['knowledge-receipt',/(?:验收|收货|分批|采购|供应商|供货商)/],
  ['knowledge-cash',/(?:现金|抽屉|交款|交给老板娘|收款)/],
  ['knowledge-close',/(?:日结|扎账|轧账|交班)/],
  ['knowledge-subsidy',/(?:国补|补贴|核销)/],
  ['knowledge-carrier',/(?:酬金|分期|移动业务|红包)/],
  ['knowledge-boss',/(?:BOSS|空充|充值|手续费)/i],
  ['knowledge-after-sale',/(?:售后|退货|退款|红冲|换货)/],
  ['knowledge-assist',/(?:协助|转化|提成)/],
  ['knowledge-reflection',/(?:学习单|复盘|培训|小事|积分)/],
  ['knowledge-serial',/(?:串号|后四位|扫码|选货|库存)/],
  ['knowledge-price',/(?:售价|零售价|调价|优惠)/],
  ['knowledge-demo',/(?:异议|演示|话术|顾客说贵)/],
  ['knowledge-privacy',/(?:隐私|保密|权限|客户资料|真实数据)/],
  ['knowledge-needs',/(?:推销|销售|需求|推荐|选机|预算)/],
];
function query(store,user,question,options={}) {
  const currentRule=require('./rule-authority').query(question,user);if(currentRule)return currentRule;
  const q=brief(question);
  const explicitCase=/^(?:请|帮我|给我)?(?:详细|具体)?(?:学习|查看|看看|调出|展开|全文|详细).{0,12}(?:办卡接待案例|销售卡案例|选号话术)/.test(q);
  if(explicitCase){
    const cases=all(store).filter(row=>!row.sourceTier&&!row.builtIn&&row.enabled!==false&&(q.includes(row.title)||(row.tags||[]).some(tag=>['办卡接待案例','销售卡案例','选号话术'].includes(tag)&&q.includes(tag))));
    if(cases.length){
      c.permit(user,'learn');
      if(cases.length>1)return {answer:'找到多个接待案例，请选择要学习的内容。',sources:cases.slice(0,6).map(row=>({id:row.id,label:row.title,href:'/knowledge#'+encodeURIComponent(row.id)})),metrics:{knowledge:true,kind:'training-guidance',needsClarification:true}};
      const item=cases[0],detailed=/详细|全文|展开|具体步骤/.test(q);
      return {answer:detailed?item.title+'：'+item.body:item.summary,sources:[{id:item.id,label:item.title,href:'/knowledge#'+encodeURIComponent(item.id)}],action:{type:'navigate',label:'查看接待案例',href:'/knowledge#'+encodeURIComponent(item.id)},metrics:{knowledge:true,articleId:item.id,version:item.version,kind:'training-guidance',caseExample:true}};
    }
  }
  const talk=customerTalk.query(store,user,q,all(store),options);if(talk)return talk;
  const policy=policyKnowledge.query(store,user,q,all(store));
  if(policy)return policy;
  const training=/(?:知识库|业务知识|推销技巧|销售技巧|学习资料|怎么(?:接待|推荐|验收|收货|交款|交接|核对|办)|如何(?:接待|推荐|验收|收货|交款|交接|核对|办)|怎样(?:接待|推荐|验收|收货|交款|交接|核对|办)|(?:现金|采购|赠品|酬金|国补|售后|红冲|串号|协助|日结|交班|空充).{0,12}(?:怎么做|怎么处理|怎么核对|怎么记|如何|学习|技巧)|学习.{0,20}(?:业务|销售|接待|现金|国补|移动|库存|验收|知识|技巧)|给我.{0,5}(?:培训|学习|知识|话术)|(?:话术|顾客说贵).{0,12}(?:怎么|如何|技巧|学习))/;
  const directTitle=all(store).find(row=>!row.sourceTier&&row.enabled!==false&&(q===row.title||/(?:详细|学习|查看|阅读|全文|步骤|展开)/.test(q)&&q.includes(row.title)));
  const procedural=/(?:怎么|如何|怎样).{0,12}(?:推荐|接待|验收|收货|交接|核对|登记|选机)|(?:接待|现金|采购|验收|赠品|附件|酬金|国补|售后|红冲|串号|协助|日结|交班|空充|充值).{0,12}(?:怎么(?:做|办|处理|核对|登记|记账|验收|选择|确认|退货)|如何(?:做|办理|处理|核对|登记|验收|选择|确认)|步骤|流程|技巧|学习)/.test(q);
  const caseRequest=/(?:学习|查看|看看|调出|详细|全文).{0,12}(?:办卡接待案例|销售卡案例|选号话术)/.test(q);
  if(!training.test(q)&&!procedural&&!directTitle&&!caseRequest)return null;
  const navigation=/^(?:帮我)?(?:打开|找出|看看|进入)?(?:业务知识|知识库|学习资料)(?:在哪里|入口|设置)?$/.test(q);
  const active=all(store).filter(row=>row.enabled!==false);
  const customMatches=active.filter(row=>!row.sourceTier&&!row.builtIn&&(row.title.length>2&&q.includes(row.title)||(row.tags||[]).some(tag=>tag.length>=2&&q.includes(tag)))).sort((a,b)=>b.title.length-a.title.length);
  const match=navigation?null:directTitle||customMatches[0]||rowFor(store,topics.find(([,pattern])=>pattern.test(q))?.[0]);
  if(match&&require('./rule-authority').protectedTopic(match)){const reply=require('./rule-authority').query('查看规则：'+match.title+' '+match.summary,user);if(reply)return reply;}const item=match&&match.enabled!==false?match:null;
  if(!item)return {answer:'已内置接待、销售、验收、现金交接和业务结算知识。打开学习资料，可按分类或关键词查找。',sources:[{id:'知识库',label:'业务知识与销售技巧',href:'/knowledge'}],action:{type:'navigate',label:'打开学习资料',href:'/knowledge'}};
  const detailed=/(详细|全文|展开|具体步骤)/.test(q);
  return {answer:detailed?`${item.title}：${item.body}`:item.summary,sources:[{id:item.id,label:item.title,href:'/knowledge#'+encodeURIComponent(item.id)}],action:{type:'navigate',label:'看步骤并写学习单',href:'/knowledge#'+encodeURIComponent(item.id)},metrics:{knowledge:true,articleId:item.id,version:item.version,kind:'training-guidance'}};
}
module.exports={catalog,query,save,remove};
