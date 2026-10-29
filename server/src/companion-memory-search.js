 'use strict';
// Deterministic retrieval of confirmed personal facts, without exporting the whole notebook.
const groups=[
 ['wake',/起床|起身|早起|起得|醒来|几点醒/],
 ['sleep',/睡觉|睡眠|入睡|睡着|就寝|熬夜|几点睡|失眠/],
 ['walk',/散步|走路|步行|遛弯|溜达/],
 ['spice',/辣椒|吃辣|辣的|麻辣|辛辣|清淡|口味/],
 ['tea',/喝.{0,4}茶|清茶|绿茶|红茶|茶叶|茶水|饮茶/],
 ['fish',/钓鱼|垂钓/], ['sing',/唱歌|唱山歌|山歌|歌曲/],
 ['travel',/旅游|旅行|出游|景点/], ['technology',/科技|技术前沿|人工智能|机器人/],
 ['food',/饮食|吃什么|饭菜|做饭|菜谱|蔬菜|水果/],
 ['chatstyle',/回答.{0,4}(?:长|短)|简短|啰嗦|多说|少说|说慢|语速|方言|称呼|聊天方式/]
];
const relatives=[['女儿',/女儿|闺女/],['儿子',/儿子/],['母亲',/母亲|妈妈/],['父亲',/父亲|爸爸/],['配偶',/老伴|爱人|妻子|丈夫|老婆|老公/],['朋友',/朋友|老友|亲友/]];
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase();
const stop=new Set(['喜欢','习惯','什么','怎么','这个','那个','现在','今天','昨天','以前','平时','每天','记得','记住','知道','事情','情况','问题','可以','一下','帮我','请问','我的','你的','我们','他们','是不是','有没有','你还','还记','记忆','告诉','告诉我','我想','最近','时候','你','我','的','了','吗','呢','不','是','都','就','还','好','请','在','能','有']);
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
function terms(text){const cleaned=normalize(text).replace(/[，。！？?！、；;：:\s]+/g,' '),out=new Set();for(const {segment,isWordLike} of segmenter.segment(cleaned)){if(isWordLike&&segment.length>=2&&!stop.has(segment))out.add(segment);}for(const run of cleaned.match(/[\p{Script=Han}]{2,}/gu)||[])for(let i=0;i<run.length-1;i++){const term=run.slice(i,i+2);if(!stop.has(term)&&!/[我的了吗呢你]/.test(term))out.add(term);}return out;}
const concepts=text=>new Set(groups.filter(([,re])=>re.test(normalize(text))).map(([id])=>id));
const person=text=>relatives.filter(([,re])=>re.test(text)).map(([id])=>id);
const broad=q=>/^(?:你还?记得我(?:的(?:习惯|爱好|情况|记忆))?(?:吗|什么)?|你(?:了解|认识)我吗|我的(?:记忆|情况|习惯|爱好)(?:有哪些|是什么|呢)?)[?？。\s]*$/.test(q);
const generic=q=>/^(?:聊聊|随便聊聊|继续(?:说说)?|接着说|说说今天|今天心情|聊聊今天)/.test(q)||/接着说昨天的事/.test(q);
function rank(rows,userId,q,{limit=12,budget=3500,now=Date.now(),personalize=false}={}){
 const candidates=rows.filter(r=>r.userId===userId&&r.confirmed===true&&r.active!==false&&typeof r.content==='string'&&r.content.trim()&&(!r.expiresAt||Date.parse(r.expiresAt)>now));
 const query=normalize(q),qt=terms(q),qc=concepts(q),qp=person(q),all=broad(query);
 let scored=candidates.map(r=>{const text=normalize(r.content),rt=terms(text),rc=concepts(text),rp=person(text);let score=0;
  if(qp.length&&!qp.some(p=>rp.includes(p)))return {r,score:0};
  if(!qp.length&&/^(?:我|我的)/.test(query)&&rp.length)return {r,score:0};
  for(const term of qt)if(rt.has(term))score+=2;
  for(const topic of qc)if(rc.has(topic))score+=8;
  if(qp.length)score+=4;
  if(all)score=Math.max(score,1);
  return {r,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||Date.parse(b.r.updatedAt||b.r.createdAt||0)-Date.parse(a.r.updatedAt||a.r.createdAt||0));
 // Casual conversation may use a few confirmed habits/interests, never unrelated health or relatives.
 if(!scored.length&&personalize&&generic(query))scored=candidates.filter(r=>['习惯','爱好'].includes(r.category)||r.category==='其他'&&/散步|清茶|钓鱼|唱歌/.test(r.content)).filter(r=>!person(r.content).length).slice(-3).reverse().map(r=>({r,score:1}));
 const selected=[];let size=0;for(const {r} of scored){if(selected.length>=Math.min(12,Math.max(1,limit)))break;if(size+r.content.length>budget)continue;size+=r.content.length;selected.push(r);}return selected;
}
function recallQuestion(q){return broad(normalize(q))||/记得|记住过|记录过|保存过/.test(q)||/我的.{0,6}(?:口味|兴趣).{0,8}(?:什么|怎样|哪些|吗|呢|[?？])/.test(q)||/(?:我|我的|亲友|女儿|儿子|老伴|朋友).{0,14}(?:喜欢什么|几点(?:起床|睡|醒)|什么(?:口味|习惯)|爱好|习惯|能吃辣|吃不吃辣)/.test(q);}
module.exports={rank,concepts,recallQuestion,broad};
