'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),c=require('../src/common'),news=require('../src/companion-news');
const now=Date.parse('2026-10-11T09:00:00+08:00'),owner={id:'owner',name:'模拟老板',status:'active',roleCode:'owner'},other={...owner,id:'other'},staff={id:'staff',status:'active',roleCode:'employee'};
const make=()=>c.initialize({users:[owner,other,staff],sales:[],inventory:[],products:[]});
const item=(title='城区发布暴雨预警',link='https://www.chinanews.com.cn/test/1.shtml',at=now-1000)=>'<item><title><![CDATA['+title+']]></title><link>'+link+'</link><pubDate>'+new Date(at).toUTCString()+'</pubDate></item>';
const rss=value=>'<rss><channel>'+value+'</channel></rss>';
test('只读取有近期发布日期的可信链接，去掉无日期、过期、未来及恶意地址',()=>{
 const xml=rss(item()+item('旧闻','https://www.chinanews.com.cn/old.shtml',now-8*86400000)+item('未来','https://www.chinanews.com.cn/future.shtml',now+86400000)+item('危险','javascript:alert(1)')+'<item><title>无时间</title><link>https://www.chinanews.com.cn/a.shtml</link></item>'+item('伪站','https://www.chinanews.com.cn.evil.test/a'));
 const parsed=news.parse(xml,{now});assert.equal(parsed.length,1);assert.deepEqual(parsed[0].categories,['incident']);assert.equal(parsed[0].source,'中新网');assert.match(parsed[0].publishedAt,/2026-10-11/);
});
test('同一标题和同一链接仅留一条，http受信地址转成https，不引入任意来源',()=>{
 const rows=news.parse(rss(item()+item('城区发布暴雨预警','https://www.chinanews.com.cn/test/2.shtml')+item('区  城发布暴雨预警','http://www.chinanews.com.cn/test/1.shtml')),{now});
 assert.equal(news.dedupe(rows,now).length,1);assert.ok(rows.every(x=>x.url.startsWith('https://')));
});
test('来源部分失败和全部失败都有明确状态，不伪造成功或当前新闻',async()=>{
 const one=await news.collect({now,fetchImpl:async url=>url.includes('society')?new Response(rss(item())):new Response('',{status:503})});assert.equal(one.status,'partial');assert.equal(one.sourceCount,1);assert.equal(one.items.length,1);
 const zero=await news.collect({now,fetchImpl:async()=>new Response(rss(item('旧闻','https://www.chinanews.com.cn/old.shtml',now-8*86400000)))});assert.equal(zero.status,'unavailable');assert.deepEqual(zero.items,[]);
});
test('服务器后台无需网页即可搜集，每小时一次、私有关注设置和停用状态各自有效',async()=>{
 const store=make();news.save(store,other,{enabled:false,categories:['travel'],keywords:'模拟关键词'});const protectedBefore=JSON.stringify({sales:store.sales,inventory:store.inventory,memories:store.companionMemories}),otherBefore=JSON.stringify(store.companionProfiles[0]);let fetches=0;
 const repository={readStore:async()=>store,transaction:async fn=>fn(store)},fetchImpl=async()=>{fetches++;return new Response(rss(item()+item('社保政策发布','https://www.chinanews.com.cn/test/3.shtml')+item('其他消息','https://www.chinanews.com.cn/test/4.shtml')))};
 const result=await news.refresh(repository,{now,fetchImpl});assert.equal(result.checkedProfiles,1);assert.equal(fetches,8);assert.equal(news.snapshot(store,owner,{now}).items.length,2);assert.equal(JSON.stringify(store.companionProfiles.find(x=>x.userId===other.id)),otherBefore);
 assert.equal((await news.refresh(repository,{now:now+1000,fetchImpl})).status,'idle');assert.equal(fetches,8);assert.equal(JSON.stringify({sales:store.sales,inventory:store.inventory,memories:store.companionMemories}),protectedBefore);
 assert.throws(()=>news.snapshot(store,staff),{statusCode:403});assert.throws(()=>news.save(store,{...owner,assistantCustomerOnly:true},{enabled:true,categories:[],keywords:''}),{statusCode:403});
});
test('后台失败保留上次近期消息并标明失败，修改主题立刻过滤，不返回另一个人的内容',async()=>{
 const store=make(),repo={readStore:async()=>store,transaction:async fn=>fn(store)};
 news.save(store,other,{enabled:false,categories:['travel'],keywords:''});
 await news.refresh(repo,{now,fetchImpl:async()=>new Response(rss(item()))});const previous=news.snapshot(store,owner,{now}).lastSuccessAt;
 await news.refresh(repo,{now:now+3600000,fetchImpl:async()=>new Response('',{status:503})});const digest=news.snapshot(store,owner,{now:now+3600000});assert.equal(digest.status,'unavailable');assert.equal(digest.items.length,1);assert.equal(digest.lastSuccessAt,previous);
 assert.deepEqual(news.snapshot(store,other,{now}).items,[]);news.save(store,owner,{enabled:true,categories:['travel'],keywords:''});assert.deepEqual(news.snapshot(store,owner,{now}).items,[]);
 assert.throws(()=>news.save(store,owner,{enabled:true,categories:['bad'],keywords:''}),{statusCode:400});
});
test('搜集时改变订阅配置，以提交时的设置为准，关键词不发送给第三方',async()=>{
 const store=make(),repo={readStore:async()=>store,transaction:async fn=>fn(store)};news.save(store,other,{enabled:false,categories:[],keywords:''});let calls=0;
 await news.refresh(repo,{now,fetchImpl:async url=>{calls++;assert.ok(!url.includes('私人关键词'));news.save(store,owner,{enabled:false,categories:[],keywords:'私人关键词'});return new Response(rss(item()));}});
 assert.equal(calls,8);assert.equal(news.snapshot(store,owner,{now}).checkedAt,null);assert.deepEqual(news.snapshot(store,owner,{now}).items,[]);
});

test('中文新闻源未写时区的发布时间按北京时间解析，不受服务器时区影响',()=>{
 const rows=news.parse('<rss><item><title>医保政策</title><link>https://www.chinanews.com.cn/test.shtml</link><pubDate>2026-10-11 08:30:00</pubDate></item></rss>',{now});assert.equal(rows.length,1);assert.equal(rows[0].publishedAt,'2026-10-11T00:30:00.000Z');
});

test('社区筛选避开泛居民消费新闻，保留社区通知和民生政策',()=>{
 const rows=news.parse(rss(item('居民消费意愿稳步回暖')+item('小区发布停水通知','https://www.chinanews.com.cn/test/2.shtml')+item('医疗保障新规发布','https://www.chinanews.com.cn/test/3.shtml')),{now});assert.deepEqual(rows[0].categories,[]);assert.ok(rows[1].categories.includes('community'));assert.ok(rows[2].categories.includes('policy'));
});

test('老年主题覆盖养老退休、健康和防骗；原全选升级，手动缩小订阅仍保留',()=>{
 const rows=news.parse(rss(item('银龄旅游专列开行')+item('养老服务补贴政策','https://www.chinanews.com.cn/test/2.shtml')+item('防跌倒健康课堂开讲','https://www.chinanews.com.cn/test/3.shtml')+item('警方提示养老诈骗陷阱','https://www.chinanews.com.cn/test/4.shtml')),{now});
 assert.ok(rows.every(news.seniorItem));assert.ok(rows[0].categories.includes('senior'));assert.ok(rows[2].categories.includes('health'));assert.ok(rows[3].categories.includes('safety'));
 assert.ok(news.settings({newsSubscription:{categories:['community','incident','policy','travel']}}).categories.includes('senior'));
 assert.deepEqual(news.settings({newsSubscription:{categories:['travel']}}).categories,['travel']);
});
test('老年关注优先但可关闭，重新归类旧保存消息，不丢失一般消息和自选项',()=>{
 const store=make(),rows=news.parse(rss(item('旅游景区开放','https://www.chinanews.com.cn/test/1.shtml',now-1000)+item('退休养老金政策','https://www.chinanews.com.cn/test/2.shtml',now-10000)),{now});
 store.companionProfiles.push({userId:owner.id,newsDigest:{status:'ok',items:rows.map(x=>({...x,categories:[]}))}});
 assert.equal(news.snapshot(store,owner,{now}).items[0].title,'退休养老金政策');
 news.save(store,owner,{enabled:true,categories:['travel','senior'],keywords:'',seniorFirst:false});
 assert.equal(news.snapshot(store,owner,{now}).items[0].title,'旅游景区开放');
 assert.throws(()=>news.save(store,owner,{enabled:true,categories:[],seniorFirst:'yes'}),{statusCode:400});
 assert.deepEqual(news.settings({newsSubscription:{version:2,categories:['community','incident','policy','travel']}}).categories,['community','incident','policy','travel']);
});
test('筛选前保留足够消息，老年报道不会被其他即时新闻挤掉，整点继续搜集',async()=>{
 const store=make(),repo={readStore:async()=>store,transaction:async fn=>fn(store)};
 news.save(store,other,{enabled:false,categories:[],keywords:''});
 const many=Array.from({length:120},(_,i)=>item('社区发布通知'+i,'https://www.chinanews.com.cn/test/'+i+'.shtml',now-i*1000)).join('')+item('老年大学开学','https://www.chinanews.com.cn/senior.shtml',now-200000);
 await news.refresh(repo,{now:now+25*60000,fetchImpl:async()=>new Response(rss(many))});
 assert.equal(news.snapshot(store,owner,{now}).items[0].title,'老年大学开学');
 assert.equal(news.snapshot(store,owner,{now}).items.length,100);
 assert.equal(news.eligible(store,now+60*60000).length,1);
});
test('老年消息和连续追问只用本人摘要，分页不重复，暂停或取消主题仍生效',()=>{
 const store=make(),rows=Array.from({length:7},(_,i)=>news.parse(rss(item('老人社区活动'+i,'https://www.chinanews.com.cn/test/'+i+'.shtml',now-i*1000)),{now})[0]);
 store.companionProfiles.push({userId:owner.id,newsDigest:{status:'ok',items:rows}});
 const options=news.query('帮我看看老年人的新闻');assert.equal(options.topic,'senior');
 const first=news.answer(store,owner,{...options,now}),next=news.answer(store,owner,{...news.query('还有呢',first.metrics),now});assert.equal(first.sources.length,5);assert.equal(next.sources.length,2);assert.ok(next.sources.every(x=>!first.sources.some(y=>y.id===x.id)));
 assert.equal(news.query('继续',null),null);assert.equal(news.query('我退休后该怎么安排生活',null),null);assert.equal(news.query('最近的政策',first.metrics).topic,'policy');
 assert.equal(news.answer(store,other,{topic:'senior',now}).sources.length,0);
 news.save(store,owner,{enabled:true,categories:[],keywords:''});assert.equal(news.answer(store,owner,{topic:'senior',now}).sources.length,0);
});

test('科技前沿覆盖AI机器人航天新能源，保留原个性化订阅，专门追问不混入其他主题',()=>{
 const rows=news.parse(rss(item('AI机器人进入家庭')+item('我国航天科研突破','https://www.chinanews.com.cn/test/2.shtml')+item('固态电池取得进展','https://www.chinanews.com.cn/test/3.shtml')+item('社区助餐活动','https://www.chinanews.com.cn/test/4.shtml')),{now});
 assert.ok(rows.slice(0,3).every(x=>x.categories.includes('technology')));
 assert.equal(rows[3].categories.includes('technology'),false);
 assert.ok(news.settings({newsSubscription:{version:2,categories:['community','incident','policy','travel','senior','health','safety']}}).categories.includes('technology'));
 assert.deepEqual(news.settings({newsSubscription:{version:2,categories:['senior']}}).categories,['senior']);
 const s=make();s.companionProfiles.push({userId:owner.id,newsDigest:{items:rows,status:'ok'}});
 const r=news.answer(s,owner,{...news.query('科技前沿有什么新闻'),now});assert.equal(r.sources.length,3);assert.ok(!r.answer.includes('社区助餐活动'));assert.equal(news.query('最近的科技',r.metrics).topic,'technology');
});
