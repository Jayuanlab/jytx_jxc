'use strict';
const c=require('./common'),schedule=require('./announcement-schedule');
const clean=(v,n=40)=>String(v||'').replace(/[\x00-\x1f]/g,'').slice(0,n);
const relevantTypes=new Set(['智能机','功能机','配件','配件产品','维修']);
const MIN_CELEBRATION_PROFIT=50;
const COUPON_REWARD_POLICY=Object.freeze({firstHigherRateItem:26,higherRate:30,lowerRate:null,displayNumbers:false});
const COUPON_CAMPAIGN_MONTH='2026-10';
// Every live-card source must be present in the summary read projection.
const READ_COLLECTIONS=Object.freeze(['users','storeAnnouncements','sales','carrierServices','redReversals','saleReturns','costAdjustments']);
const daily={
 morning:['早上好，欢迎光临聚友。愿今天的每一次相遇都舒心。','新的一天，从一句真诚的问候开始。欢迎光临！','早安，愿您带着好心情，找到合适的手机与配件。','早上好，慢慢挑，合适的才是最好的。','早安，今天也用认真和耐心迎接每一位顾客。','早上好，愿今天的小确幸从这里开始。','早安，聚友欢迎您，祝您今天顺顺利利。'],
 noon:['中午好，忙碌之余也记得喝口水。','午间好，愿您此刻轻松一点，心情好一点。','中午好，来聚友看看，也给自己一点放松时间。','午间好，认真服务，也别忘了照顾自己。','中午好，愿这一段小休息让下午更有精神。','午间好，欢迎光临，慢慢看，不着急。','中午好，愿今天的好心情继续在线。'],
 afternoon:['下午好，欢迎光临，愿您在这里找到称心的选择。','午后好，喝口水，接着把每件小事做好。','下午好，认真听需求，才能推荐更合适的选择。','午后好，愿今天的相遇都带着一点惊喜。','下午好，慢慢挑，我们愿意耐心为您介绍。','午后好，给设备一点关照，也给自己一点轻松。','下午好，愿每一次用心都能被看见。'],
 evening:['晚上好，欢迎光临聚友，愿您晚间愉快。','夜色渐浓，服务的热情不打烊。欢迎光临！','晚上好，忙了一天，愿您此刻轻松一点。','晚间好，慢慢挑选，我们会耐心为您介绍。','晚上好，愿今天以一份好心情收尾。','晚间好，欢迎来聚友看看，愿您有所收获。','晚上好，感谢您今天的光临与信任。'],
 overnight:['欢迎光临聚友，愿您此刻平安顺心。','夜深了，愿每一份认真都有温暖的回应。','欢迎光临，慢慢看，愿您找到合适的选择。','夜间好，感谢您的到来，愿您一切顺利。','愿忙碌后的片刻，带来一点轻松。','欢迎光临聚友，祝您购物愉快。','愿这一刻的相遇，带来一点好心情。']
};
const extras=['小笑话：手机说它今天很有精神，因为刚刚“充满电”。','小笑话：手机壳问手机：“我保护得怎么样？”手机说：“稳稳的！”','小笑话：充电器说：“别着急，能量慢慢来。”','小笑话：屏幕问贴膜：“你怎么总挡在我前面？”贴膜说：“因为我想保护你。”','今天的小提醒：买配件先核对型号，合适才更省心。','今天的小提醒：维修前说清问题，处理起来更顺畅。','今天的小提醒：手机和配件慢慢挑，适合自己的最重要。','小笑话：手机问耳机：“听到我说话了吗？”耳机说：“听得清清楚楚！”','今天的小提醒：贴膜之前先清洁屏幕，细节会更服帖。','小笑话：数据线问手机：“我们熟吗？”手机说：“一插就通！”','今天的小提醒：选充电器时先核对接口和适配功率。'];
function period(hour){return hour<6?'overnight':hour<11?'morning':hour<14?'noon':hour<18?'afternoon':'evening'}
function celebrationProfit(sale,store){
 if(sale.status!=='completed'||!Number.isFinite(Number(sale.amount))||Number(sale.amount)<=0)return null;
 if(sale.reversalId||sale.reversedAt||sale.isReversal||(store.redReversals||[]).some(r=>['已红冲','已通过','approved'].includes(r.status)&&(r.sourceId===sale.id||r.orderId===sale.id)))return null;
 if((store.saleReturns||[]).some(r=>r.orderId===sale.id))return null;
 const items=(sale.items||[]).filter(i=>relevantTypes.has(i.type)&&Number(i.quantity)>0);
 if(!items.length||items.some(i=>Number(i.returnedQuantity||0)>0||typeof i.profit!=='number'||!Number.isFinite(i.profit)))return null;
 const profit=items.reduce((sum,i)=>sum+Number(i.profit),0)-Number(sale.giftCost||0)-(store.costAdjustments||[]).filter(a=>a.orderId===sale.id).reduce((sum,a)=>sum+Number(a.costDelta||0),0);
 return Number.isFinite(profit)?Math.round(profit*100)/100:null;
}
function feed(store,at=Date.now()){
 const date=c.day(at),hour=new Date(at+8*3600000).getUTCHours(),createdAt=date+'T00:00:00+08:00';
 const index=Math.floor(Date.parse(date+'T00:00:00Z')/86400000),p=period(hour);
 const slide=(id,title,content,theme,layout,extra={})=>({id:'AUTO:'+date+':'+id,title,content,level:'normal',author:'工作助理',createdAt,display:{mode:'fixed',seconds:16},visual:{theme,layout},automatic:true,...extra});
 const hello=slide('hello:'+p,'每日问候',daily[p][index%7],'sky',p==='morning'?'sun':p==='evening'||p==='overnight'?'star':'leaf');
 const extraContent=extras[(index+3)%extras.length];
 const extra=slide('daily:'+p,'今日一则',extraContent,'mint',extraContent.startsWith('小笑话')?'smile':/维修/.test(extraContent)?'repair':'phone');
 const known=new Map((store.users||[]).filter(u=>u.status==='active'&&!u.assistantCustomerOnly&&!['owner','customer-assistant','personal-assistant'].includes(u.roleCode)).map(u=>[u.id,u]));
 const reversed=new Set((store.redReversals||[]).filter(r=>['已红冲','已通过','approved'].includes(r.status)).map(r=>r.sourceId||r.orderId));
 const todayCards=new Map();
 for(const row of store.carrierServices||[]){if(row.type!=='card'||row.subType!=='new'||row.serviceDate!==date||reversed.has(row.id))continue;const who=known.get(row.employeeId||row.operatorId);if(!who)continue;todayCards.set(who.id,{name:clean(who.name,12),count:(todayCards.get(who.id)?.count||0)+1})}
 const ranking=[...todayCards.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN')).slice(0,3);
 const cardBoard=ranking.length?slide('card-board','今日办卡榜','今日新开卡已登记：'+ranking.map(r=>r.name+' '+r.count+'笔').join('、')+'。谢谢大家用心服务！','sky','card'):null;
 const campaignActive=date.slice(0,7)===COUPON_CAMPAIGN_MONTH;
 const couponCount=campaignActive?(store.carrierServices||[]).filter(r=>r.type==='contract'&&r.subTypeName==='终端优惠券'&&String(r.serviceDate||'').startsWith(COUPON_CAMPAIGN_MONTH)&&String(r.serviceDate||'')<=date&&!reversed.has(r.id)).length:0;
 const couponBoard=campaignActive&&couponCount>0?slide('coupon-congratulations','优惠券祝贺','恭喜大家完成终端优惠券办理！感谢用心服务，继续加油！','mint','coupon'):null;
 const sales=(store.sales||[]).filter(r=>r.createdAt&&Number.isFinite(Date.parse(r.createdAt))&&Date.parse(r.createdAt)<=at&&at-Date.parse(r.createdAt)<2*3600000&&c.day(r.createdAt)===date).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
 const seen=new Set(),wins=[];
 for(const sale of sales){const who=known.get(sale.salespersonId||sale.operatorId),profit=celebrationProfit(sale,store);if(!who||seen.has(who.id)||profit===null||profit<MIN_CELEBRATION_PROFIT)continue;seen.add(who.id);
  wins.push(slide('sale:'+sale.id,'成交祝贺','恭喜'+clean(who.name,20)+'完成一笔精彩成交！感谢你的用心服务，继续加油！','peach','fireworks',{createdAt:sale.createdAt,validUntil:new Date(Date.parse(sale.createdAt)+2*3600000).toISOString(),sourceId:sale.id}));if(wins.length===3)break;
 }
 const manualVisual=row=>{if(row.display?.mode!=='fixed'||String(row.content||'').length>100)return undefined;const title=String(row.title||'');const layout=/轻松/.test(title)?'smile':/早间/.test(title)?'sun':/晚间|凌晨/.test(title)?'star':/午间/.test(title)?'tea':/服务/.test(title)?'phone':'leaf';return {theme:layout==='smile'?'peach':layout==='leaf'?'mint':'sky',layout};};
 const manual=(store.storeAnnouncements||[]).filter(r=>schedule.active(r,at)).slice().sort((a,b)=>Number(b.level==='important')-Number(a.level==='important')||(b.sequence||0)-(a.sequence||0)).map(r=>({id:r.id,title:r.title,content:r.content,level:r.level,revision:r.revision||0,display:r.display||{mode:'scroll'},createdAt:r.createdAt,visual:manualVisual(r),automatic:false}));
 const automatic=[hello,extra,...(cardBoard?[cardBoard]:[]),...(couponBoard?[couponBoard]:[]),...wins],result=[];
 if(!manual.length)return automatic;
 const count=Math.max(manual.length,automatic.length);
 for(let i=0;i<count;i++){
  if(manual[i])result.push(manual[i]);
  if(automatic[i])result.push(automatic[i]);
 }
 return result;
}
module.exports={feed,celebrationProfit,MIN_CELEBRATION_PROFIT,COUPON_REWARD_POLICY,READ_COLLECTIONS};
