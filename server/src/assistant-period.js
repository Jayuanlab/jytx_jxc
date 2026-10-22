// Read-only sales statistics. All business dates use Asia/Shanghai.
const c = require('./common');
const brands = ['华为','荣耀','OPPO','vivo','苹果','iPhone','小米','红米','三星','一加','realme','魅族','中兴','努比亚'];
const phones = new Set(['智能机','智能手机','功能机','老人机','二手机','二手手机']);
const datePattern = /20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?/g;
const relativePattern = /上个星期|上星期|上一个月|上个月|这个星期|这星期|本星期|这个月|本月|上月|这月|本周|这周|上一周|上周|今年|去年|全年|(?:最近|近|过去)[一二三四五六七八九十百零\d]+天/g;
const stamp = date => Date.parse(date+'T00:00:00Z');
const iso = time => new Date(time).toISOString().slice(0,10);
const addDays = (date,n) => iso(stamp(date)+n*86400000);
function validDate(value) {
  const match=value.match(/^(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})日?$/);
  if(!match)throw new c.HttpError(400,'日期不正确');
  const date=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
  if(!Number.isFinite(stamp(date))||iso(stamp(date))!==date)throw new c.HttpError(400,'日期不正确');
  return date;
}
function span(kind,startDate,endDate,label) {
  if(startDate>endDate)throw new c.HttpError(400,'开始日期不能晚于结束日期');
  if((stamp(endDate)-stamp(startDate))/86400000+1>366)throw new c.HttpError(400,'一次最多统计366天，请缩短日期范围');
  return {kind,startDate,endDate,label};
}
function dayCount(text) {
  if(/^\d+$/.test(text))return Number(text);
  if(/^[一二三四五六七八九]$/.test(text))return '一二三四五六七八九'.indexOf(text)+1;
  if(text==='十')return 10;
  const match=text.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  return match ? (match[1]?'一二三四五六七八九'.indexOf(match[1])+1:1)*10+(match[2]?'一二三四五六七八九'.indexOf(match[2])+1:0) : NaN;
}
function parse(question,today=c.day()) {
  const dates=[...question.matchAll(datePattern)];
  for(const match of dates)validDate(match[0]);
  if(dates.length>1){
    if(dates.length!==2||!/^(?:\s*(?:到|至|—|–|~|～|-|、)\s*)$/.test(question.slice(dates[0].index+dates[0][0].length,dates[1].index)))throw new c.HttpError(400,'请指定一个连续日期范围，例如2026-09-01到2026-09-30');
    const start=validDate(dates[0][0]),end=validDate(dates[1][0]);
    return span('custom',start,end,start===end?start:start+'至'+end);
  }
  const relative=[...question.matchAll(relativePattern)];
  if(relative.length>1||relative.length&&dates.length)throw new c.HttpError(400,'请一次指定一个统计时段，例如本月或上个月');
  if(relative.length){
    const term=relative[0][0];
    if(/周|星期/.test(term)){
      const monday=addDays(today,-((new Date(stamp(today)).getUTCDay()+6)%7));
      return /上/.test(term)?span('last-week',addDays(monday,-7),addDays(monday,-1),'上周'):span('week',monday,today,'本周');
    }
    if(/月/.test(term)){
      const first=today.slice(0,7)+'-01';
      if(/上/.test(term)){const end=addDays(first,-1);return span('last-month',end.slice(0,7)+'-01',end,'上个月');}
      return span('month',first,today,'本月');
    }
    if(/年/.test(term)){
      const year=Number(today.slice(0,4))-Number(term==='去年');
      return span(term==='去年'?'last-year':'year',year+'-01-01',term==='去年'?year+'-12-31':today,term==='去年'?'去年':'今年');
    }
    const n=dayCount(term.replace(/最近|过去|近|天/g,''));
    if(!Number.isSafeInteger(n)||n<1||n>366)throw new c.HttpError(400,'天数请填1到366，例如最近7天');
    return span('recent',addDays(today,1-n),today,'最近'+n+'天');
  }
  if(dates.length){
    const remainder=question.slice(dates[0].index+dates[0][0].length);
    if(/^\s*(?:到|至|—|–|~|～)\s*(?:\d|[一二三四五六七八九十])/.test(remainder))throw new c.HttpError(400,'请写完整的起止日期，例如2026-09-01到2026-09-30');
    return null; // Single-day queries retain the existing daily workflow.
  }
  if(/(?:\d{1,2}|[一二三四五六七八九十]+)月(?:\d{1,2}|[一二三四五六七八九十]+)(?:日|号)?\s*(?:到|至)/.test(question))throw new c.HttpError(400,'请补全年份并填写完整起止日期，例如2026-09-01到2026-09-30');
  const months=[...question.matchAll(/(20\d{2})[-年/.](\d{1,2})(?:月|(?![\d\-/\.]))/g)];
  if(months.length>1)throw new c.HttpError(400,'请指定一个月份，或填写完整起止日期');
  if(months.length){
    const year=Number(months[0][1]),month=Number(months[0][2]);
    if(month<1||month>12)throw new c.HttpError(400,'月份不正确');
    const start=year+'-'+String(month).padStart(2,'0')+'-01',last=iso(Date.UTC(year,month,0));
    return span('named-month',start,start.slice(0,7)===today.slice(0,7)?today:last,year+'年'+month+'月');
  }
  if(!months.length&&/(?:\d{1,2}|[一二三四五六七八九十]+)月/.test(question))throw new c.HttpError(400,'请补充年份，例如2026年9月');
  const year=question.match(/(20\d{2})年/);
  return year?span('named-year',year[1]+'-01-01',year[1]===today.slice(0,4)?today:year[1]+'-12-31',year[1]+'年'):null;
}
const money = value => '¥'+c.round(value).toFixed(2);
const cents = value => Math.round(c.round(Number(value||0))*100);
const detailed = q => /详细|明细|具体|展开|怎么算|如何计算|核算过程|逐笔|每笔/.test(q);
function query(store,user,question) {
  if(/知识|技巧|怎么学习|如何学习|学习资料|移动酬金|移动业务|国补|补贴|工资|房租|充值|采购|进货|库存|仓库/.test(question))return null;
  const isProfit=/毛利|利润|赚了多少|赚多少钱|挣了多少|挣多少钱/.test(question);
  const isItems=/卖了什么|售出什么|卖了哪些|售出哪些|卖了没有|售出没有|有没有卖|是否卖了/.test(question);
  const isVolume=/销量|销售数量|卖出数量|售出数量|(?:卖|售出|销售).{0,6}(?:多少|几).{0,3}(?:台|件|个)|多少台|几台/.test(question);
  const isSummary=/销售额|营业额|卖了多少|成交多少|销售情况|销售统计|统计.{0,8}销售|销售汇总/.test(question);
  if(!isProfit&&!isItems&&!isVolume&&!isSummary)return null;
  const period=parse(question);
  if(!period)return null;
  if(/同比|环比|对比|比较|比上|比去/.test(question))return {answer:'这项跨期间对比还没有接入。请先分别查询两个时段，我不会把汇总当成对比结果。',sources:[],unsupportedRange:true};
  const caps=c.capabilities(user);
  if(isProfit&&!caps.profit)return {answer:'当前岗位没有成本或毛利查看权限。',sources:[]};
  const namedStaff=(store.users||[]).filter(row=>row.name&&question.includes(row.name)&&!(row.roleCode==='owner'&&row.name==='老板'&&!/老板(?:的)?(?:销量|销售额|营业额|毛利|营业员)/.test(question))).sort((a,b)=>b.name.length-a.name.length);
  if(namedStaff.length>1)return {answer:'请一次查询一位营业员，或不指定姓名查询当前账号可见的销售汇总。',sources:[]};
  const staff=namedStaff[0];
  if(staff&&!caps.allSales&&staff.id!==user.id)return {answer:'当前岗位没有查看其他营业员销量的权限。',sources:[]};
  if(!staff&&/(?:营业员|员工|店员|销售员)/.test(question))return {answer:'请说营业员的完整姓名，我会按销售单和退货单统计。',sources:[]};
  const staffId=staff?.id||null,brand=brands.find(word=>question.toLowerCase().includes(word.toLowerCase()))||null;
  const phonesOnly=/手机|智能机|功能机|二手机|多少台|几台/.test(question);
  const queryType=isProfit?'profit':isVolume?'volume':isItems?'items':'summary';
  if(['profit','summary'].includes(queryType)&&(brand||phonesOnly))return {answer:'按品牌或手机品类的金额、赠品成本分摊还需单独核定。可以先查该品牌销量，或问“'+period.label+'销售毛利”“'+period.label+'营业额”。',sources:[],unsupportedFilter:true};
  const productMap=new Map((store.products||[]).map(p=>[p.skuId,p]));
  const matches=item=>{
    const p=productMap.get(item.skuId)||{};
    if(phonesOnly&&!phones.has(item.type||p.type))return false;
    return !brand||[item.name,p.name,p.shortName,p.subType,p.thirdType,...(Array.isArray(p.aliases)?p.aliases:[])].some(word=>String(word||'').toLowerCase().includes(brand.toLowerCase()));
  };
  const owned=row=> (caps.allSales||(row.salespersonId||row.operatorId)===user.id)&&(!staffId||(row.salespersonId||row.operatorId)===staffId);
  const startMs=Date.parse(period.startDate+'T00:00:00+08:00'),endMs=Date.parse(period.endDate+'T00:00:00+08:00')+86400000;
  const inPeriod=value=>{if(value===undefined||value===null)return false;const time=new Date(value).getTime();return Number.isFinite(time)&&time>=startMs&&time<endMs;};
  const visibleOrders=new Map(),sources=[],events=[],grouped=new Map();
  let salesCents=0,returnsCents=0,profitCents=0,giftCents=0,adjustmentCents=0,soldUnits=0,returnedUnits=0,orderCount=0,returnOrderCount=0,giftCount=0,adjustmentCount=0;
  const financial=['profit','summary'].includes(queryType),unit=phonesOnly?'台':'件';
  const source=(label,id)=>({label,id:String(id),href:'/app?tab=orders'});
  const record=(row,sign)=>{
    const items=(row.items||[]).filter(matches);
    if(!financial&&!items.length)return;
    if(sign===1){orderCount++;salesCents+=cents(row.amount);profitCents+=cents(row.profit);}else{returnOrderCount++;returnsCents+=cents(row.amount);profitCents-=cents(row.profit);}
    const quantity=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
    if(sign===1)soldUnits+=quantity;else returnedUnits+=quantity;
    sources.push(source(sign===1?'销售单':'退货单',row.id));
    if(financial)events.push({date:c.day(row.createdAt),kind:sign===1?'销售':'退货',id:row.id,amount:money(sign*Number(row.amount||0)),...(caps.profit?{profit:money(sign*Number(row.profit||0))}:{})});
    else for(const item of items){
      const name=item.name||productMap.get(item.skuId)?.name||'未命名商品';
      events.push({date:c.day(row.createdAt),kind:sign===1?'销售':'退货',id:row.id,name,quantity:sign*Number(item.quantity||0)});
      const key=item.skuId||name,g=grouped.get(key)||{name,sold:0,returned:0};
      if(sign===1)g.sold+=Number(item.quantity||0);else g.returned+=Number(item.quantity||0);grouped.set(key,g);
    }
  };
  for(const row of store.sales||[]){
    if(!owned(row))continue;
    visibleOrders.set(row.id,row);
    if(inPeriod(row.createdAt))record(row,1);
    if(financial&&caps.profit)for(const gift of row.giftOrders||[])if(inPeriod(gift.createdAt)){
      giftCents+=cents(gift.cost);giftCount++;sources.push(source('赠品关联销售单',row.id));
      events.push({date:c.day(gift.createdAt),kind:'赠品',id:gift.id||row.id,amount:money(0),profit:money(-Number(gift.cost||0))});
    }
  }
  for(const row of store.saleReturns||[])if(owned(row)&&inPeriod(row.createdAt))record(row,-1);
  if(financial&&caps.profit)for(const row of store.costAdjustments||[])if(row.orderId&&visibleOrders.has(row.orderId)&&inPeriod(row.createdAt)){
    adjustmentCents-=cents(row.costDelta);adjustmentCount++;sources.push(source('成本调整关联销售单',row.orderId));
    events.push({date:c.day(row.createdAt),kind:'成本调整',id:row.id,amount:money(0),profit:money(-Number(row.costDelta||0))});
  }
  const salesAmount=salesCents/100,returnAmount=returnsCents/100,netSales=(salesCents-returnsCents)/100;
  const adjustedGrossProfit=caps.profit&&financial?(profitCents-giftCents+adjustmentCents)/100:null;
  const label=period.label+(staff?staff.name+'的':'')+(financial?'':brand?brand+(phonesOnly?'手机':'商品'):phonesOnly?'手机':'商品');
  let text;
  if(queryType==='volume')text=!orderCount&&!returnOrderCount?label+'没有销量记录。':returnedUnits?label+'卖出 '+soldUnits+' '+unit+'，退货 '+returnedUnits+' '+unit+'，净售 '+(soldUnits-returnedUnits)+' '+unit+'。':label+'卖出 '+soldUnits+' '+unit+'。';
  else if(queryType==='items'){
    const parts=[...grouped.values()].filter(row=>row.sold).slice(0,8).map(row=>row.name+' '+row.sold+' '+unit);
    text=parts.length?label+'卖了：'+parts.join('；')+'。':label+'没有销售记录。';
    if(returnedUnits)text+='退货 '+returnedUnits+' '+unit+'，净售 '+(soldUnits-returnedUnits)+' '+unit+'。';
    if([...grouped.values()].filter(row=>row.sold).length>8)text+='其余可查看明细。';
  }else if(queryType==='profit')text=!orderCount&&!returnOrderCount&&!giftCount&&!adjustmentCount?label+'没有销售毛利记录。':label+'销售毛利 '+money(adjustedGrossProfit)+'，还没扣工资、房租等费用。';
  else text=!orderCount&&!returnOrderCount?label+'没有销售记录。':label+'销售 '+orderCount+' 单，销售额 '+money(salesAmount)+'。';
  if(queryType==='summary'&&returnOrderCount)text+='退货 '+money(returnAmount)+'，净销售额 '+money(netSales)+'。';
  const detail=detailed(question);
  if(detail&&events.length){
    if(!financial)text+=[orderCount&&'销售单 '+orderCount+' 笔',returnOrderCount&&'退货单 '+returnOrderCount+' 笔'].filter(Boolean).join('，')+'。';
    else if(queryType==='profit')text+=[salesAmount&&'销售额 '+money(salesAmount),returnAmount&&'退货 '+money(returnAmount),giftCents&&'赠品成本 '+money(giftCents/100),adjustmentCents&&'成本调整 '+money(adjustmentCents/100)].filter(Boolean).join('，')+'。';
    else if(caps.profit)text+='销售毛利 '+money(adjustedGrossProfit)+'。';
  }
  const metrics={kind:'sales-period',queryType,startDate:period.startDate,endDate:period.endDate,soldUnits,returnedUnits,netUnits:soldUnits-returnedUnits,orderCount,returnOrderCount,salesAmount,returnAmount,netSales,adjustedGrossProfit,giftCost:caps.profit&&financial?giftCents/100:null,costAdjustmentProfit:caps.profit&&financial?adjustmentCents/100:null,brand,phonesOnly,staffId};
  // Volume responses never expose amounts derived from unrelated items in a mixed order.
  if(!financial)for(const key of ['salesAmount','returnAmount','netSales'])delete metrics[key];
  const uniqueSources=[...new Map(sources.map(row=>[row.id,row])).values()];
  const result={answer:text,sources:[{label:'销售单查询',id:period.label,href:'/app?tab=orders'},...uniqueSources.slice(0,19)],metrics,period};
  if(detail){
    const columns=[{key:'date',label:'日期'},{key:'kind',label:'类型'},{key:'id',label:'单号'},...(financial?[{key:'amount',label:'金额'},...(caps.profit?[{key:'profit',label:'毛利影响'}]:[])]:[{key:'name',label:'商品'},{key:'quantity',label:'数量'}])];
    result.table={title:period.label+'明细',columns,rows:events.sort((a,b)=>a.date.localeCompare(b.date)).slice(0,100)};
    result.note='统计范围：'+period.startDate+'至'+period.endDate+'（含首尾两天）。退货按发生日扣减；赠品与成本调整按各自发生日计入。'+(events.length>100?'本次展示前100行，其余请查销售单。':'');
  }
  return result;
}
function replacePeriod(question,term){
  const dates=[...question.matchAll(datePattern)];
  if(dates.length===2){const start=dates[0].index,end=dates[1].index+dates[1][0].length;return question.slice(0,start)+term+question.slice(end);}
  return question.replace(datePattern,term).replace(relativePattern,term).replace(/20\d{2}[-年/.]\d{1,2}月?|20\d{2}年/g,term);
}
module.exports={parse,query,replacePeriod};
