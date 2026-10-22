// Read-only interpretation: values are suggestions until the salesperson confirms the sales form.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AssistantSaleInput=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const accounts=['现金','微信','支付宝','银行卡','云闪付'];
  const digits=value=>String(value||'').normalize('NFKC').replace(/[零〇○一二两三四五六七八九幺]/g,ch=>({'零':'0','〇':'0','○':'0','一':'1','二':'2','两':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','幺':'1'})[ch]);
  const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s_-]/g,'');
  function candidates(rows,request){
    const q=String(request||'').normalize('NFKC');
    const brands=['华为','荣耀','OPPO','vivo','苹果','iPhone','小米','红米','三星','一加','realme','魅族','中兴','努比亚'];
    let brand=brands.find(x=>q.toLowerCase().includes(x.toLowerCase()))||'';
    const models=(q.replace(/(?:串号|串码|imei|后四位|后4位|尾号)(?:的)?(?:后四位|后4位)?\s*(?:是|为|改为|改成|[:：])?\s*[a-z0-9-]+/gi,'').match(/[a-z]+[\s-]*\d+(?:[\s-]*(?:pro\+?|plus|ultra|max|se))*/gi)||[]).map(normalize);
    const capacity=q.match(/(?<!\d)(\d{1,4})\s*(GB|G|TB|T)(?![a-z])/i);
    const size=capacity?normalize(capacity[1]+(/t/i.test(capacity[2])?'tb':'gb')):'';
    const haystack=p=>normalize([p.name,p.shortName,p.subType,p.thirdType,...(p.aliases||[])].join(' '));
    const brandMatch=p=>!brand||haystack(p).includes(normalize(brand))||(brand==='苹果'&&/iphone|apple/.test(haystack(p)))||(brand==='iPhone'&&haystack(p).includes('苹果'));
    const matching=(rows||[]).filter(p=>p.active!==false&&p.stockManaged!==false&&[p.type,p.subType,p.thirdType].some(x=>/智能手机|智能机|功能机|老人机|老年机|按键机|二手机|二手手机|^手机$/i.test(x||''))&&p.trackSerial&&Boolean(p.warehouseId)&&Number(p.quantity)>0&&(p.serials||[]).some(s=>['可售','未激活'].includes(s.status))&&brandMatch(p));
    // A stated model or capacity narrows stock. A miss never falls back to a different phone.
    const namedModels=[...new Set(matching.map(p=>String(p.thirdType||'').trim()).filter(x=>x.length>1&&!brands.some(b=>normalize(b)===normalize(x))&&normalize(q).includes(normalize(x))))];
    const longest=namedModels.sort((a,b)=>b.length-a.length)[0];
    return matching.filter(p=>models.every(model=>haystack(p).includes(model))&&(!longest||haystack(p).includes(normalize(longest)))&&(!size||haystack(p).replace(/(?<!\d)(\d{1,4})g(?!b)/g,'$1gb').includes(size)));
  }
  function serialMentions(value){
    const q=digits(value);
    const patterns=[
      /(?:串号|串码|imei|后四位|后4位|尾号)(?:的)?(?:后四位|后4位)?\s*(?:是|为|改为|改成|[:：])?\s*([a-z0-9-]+(?:\s+\d+)*)/gi,
      // “手机1234” is a serial suffix. A model, phone number or longer number is not.
      /手机\s*(?:是|为|[:：])?\s*(\d{4})(?!\s*\d)(?=$|[\s，,。；;、！？!?]|售价|成交价|卖价|价格|顾客|客户|手机号|电话|微信|现金|支付宝|银行卡|云闪付|附件|赠品|已经|销售|已售|卖了|售出|是不是|是否)/gi
    ];
    return patterns.flatMap(pattern=>[...q.matchAll(pattern)].map(match=>({token:match[1].replace(/\s/g,''),index:match.index,end:match.index+match[0].length}))).sort((a,b)=>a.index-b.index);
  }
  function serialToken(value,labeledOnly=false){
    const q=digits(value).trim(),mention=serialMentions(q)[0];
    const raw=mention?mention.token:labeledOnly?'':q.replace(/^[：:]|[。！!？?]+$/g,'');
    const token=raw.replace(/\s/g,'');
    if(!mention&&/^1[3-9]\d{9}$/.test(token))return '';
    return /^(?:\d{4}|[a-z0-9-]{5,40})$/i.test(token)?token:'';
  }
  function serialMatches(rows,value,labeledOnly=false){
    const token=serialToken(value,labeledOnly),seen=new Set();if(!token)return {token,matches:[]};
    const matches=[];for(const p of rows||[])for(const s of p.serials||[]){
      const no=String(s.no||'');const same=/^\d{4}$/.test(token)?no.endsWith(token):no.toLowerCase()===token.toLowerCase();
      const key=JSON.stringify([p.skuId,p.warehouseId,no]);
      if(same&&['可售','未激活'].includes(s.status)&&!seen.has(key)){seen.add(key);matches.push({p,serialNo:no});}
    }
    return {token,matches};
  }
  function payment(value){
    const q=String(value||'').replace(/\s/g,'');const found=[];
    for(const account of accounts){let at=-1;while((at=q.indexOf(account,at+1))>=0){
      const prefix=q.slice(Math.max(0,at-10),at).split(/[，,。；;]/).at(-1);
      const suffix=q.slice(at+account.length,at+account.length+6);
      if(!/(?:不|不是|不用|没用|没有用|不要|别用|非)(?:用|走|付|付款|支付|通过)?$/.test(prefix)&&! /^(?:没付|未付|没收|未收|没有付|没到账|未到账|没有到账)/.test(suffix))found.push(account);
    }}
    const unique=[...new Set(found)];return unique.length===1?unique[0]:'';
  }
  function chineseAmount(value){
    const parts=value.split('点');if(parts.length>2||!parts[0])return null;
    const decimal=parts[1]===undefined?'':digits(parts[1]);if(parts[1]!==undefined&&!/^\d{1,2}$/.test(decimal))return null;
    const text=parts[0];let integer=0;
    if(/^[零〇一二两三四五六七八九]+$/.test(text))integer=Number(digits(text));
    else{
      // Require descending units and an explicit last unit: “一千九” is ambiguous.
      if(!/^[零〇一二两三四五六七八九十百千万]+$/.test(text)||/[一二两三四五六七八九]{2}|[零〇][十百千万]/.test(text)||/[十百千万].*[一二两三四五六七八九]$/.test(text)&&!/[十零〇][一二两三四五六七八九]$/.test(text))return null;
      let pending=0,section=0,lastUnit=10000;const units={十:10,百:100,千:1000,万:10000};
      for(const ch of text){if(!units[ch]){pending=Number(digits(ch));continue}const unit=units[ch];if(unit===10000){if(integer||!section&&!pending)return null;integer=(section+pending)*unit;section=0;pending=0;lastUnit=10000;continue}if(unit>=lastUnit||!pending&&!(unit===10&&section===0))return null;section+=(pending||1)*unit;pending=0;lastUnit=unit;}
      integer+=section+pending;
    }
    const amount=Number(integer+(decimal?'.'+decimal:''));return amount>0&&amount<100000000?amount:null;
  }
  function price(value,labeledOnly=false){
    const q=String(value||'').normalize('NFKC').trim();
    const match=q.match(/(?:售价|成交价|卖价|价格)(?:格)?\s*(?:是|为|改为|改成|[:：])?\s*(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万点]+)(?![\d.])/);
    const raw=match?match[1]:labeledOnly?'':q.replace(/^(?:卖了|卖|收了|收|就收|就卖|改成|改为)\s*/,'').replace(/\s*(?:元|块钱|块)[。！!？?]*$/,'');
    if(/^[零〇一二两三四五六七八九十百千万点]+$/.test(raw))return chineseAmount(raw);
    if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(raw))return null;
    const amount=Number(raw);return Number.isFinite(amount)&&amount>0?amount:null;
  }
  function facts(value){
    const q=String(value||'').normalize('NFKC'),result={};
    const name=q.match(/(?:(?:顾客|客户|用户)(?:姓名|名字|叫)|姓名|名字)(?:是|为|[:：])?\s*([^，,。；;\d]{1,30})/);
    if(name)result.customerName=name[1].trim();
    const phone=digits(q).match(/(?:手机号|手机号码|电话号码|电话)(?:是|为|[:：])?\s*(1[3-9](?:\s*\d){9})(?!\d)/);
    if(phone)result.customerPhone=phone[1].replace(/\s/g,'');
    const amount=price(q,true);if(amount!==null)result.salePrice=amount;
    const account=payment(q);if(account)result.account=account;
    if(/(?:没有|没|不带|不用|不需要|无)附件/.test(q))result.giftRequested='';
    return result;
  }
  
  function statusQuery(value){
    const q=String(value||'').normalize('NFKC');
    if(/统计|销量|营业额|销售额|销售数量|多少(?:台|件|单)|几台/.test(q))return false;
    return /已(?:经)?(?:销售|售出|卖出|卖掉)|销售(?:了|过)|售出|卖(?:了|掉|出|过)|已售|在库|还在库|状态/.test(q)&&/查|查询|核对|是不是|是否|有没有|了吗|了没|吗|嘛|状态|记录|找不到|查不到/.test(q);
  }
  function receptionRequest(value){
    const q=String(value||'');
    if(/统计|多少|几位|几人|怎么|如何/.test(q))return false;
    return /(?:准备|开|建|做|填|记|录|新增).{0,6}(?:接待单|接待记录)|^(?:接待单|记个接待)[。！!\s]*$/.test(q)||/(?:来(?:了)?(?:个|一位|一名)顾客|顾客来(?:看|问|咨询)|客户来(?:看|问|咨询))/.test(q);
  }
  function singlePhoneSale(value){
    const q=String(value||'');
    return !/查|统计|多少|几台|是不是|是否|吗|没有|没卖|未成交|预订|怎么|如何/.test(q)&&/(?:我|我们|刚|刚刚|刚才|今天|又|已经)?\s*(?:卖了|卖出|售出|成交|销售了)\s*(?:一|1)(?:台|部)/.test(q);
  }
  function analyze(value,focus=''){
    const q=String(value||'').normalize('NFKC'),result=facts(q),issues={},serials=[];
    const prices=[],moneySpans=[],moneyPattern=/(?:售价|成交价|卖价|价格|改价|改成|改为|卖(?:了)?|成交)(?:格)?\s*(?:是|为|改为|改成|改到|[:：])?\s*(-?\d+(?:\.\d+)*|[零〇一二两三四五六七八九十百千万点]+)\s*(元|块钱|块)?/g;
    for(const match of q.matchAll(moneyPattern)){
      moneySpans.push({index:match.index,end:match.index+match[0].length});
      if(/(?:手机号|电话号码|串号|尾号)\s*$/.test(q.slice(Math.max(0,match.index-10),match.index)))continue;
      if(/^[卖成]/.test(match[0])&&!match[2]&&/^\s*(?:台|部|件|个|张)/.test(q.slice(match.index+match[0].length)))continue;
      const amount=price(match[1]);if(amount===null)issues.salePrice='售价必须大于0，最多两位小数；请写清金额。';else prices.push(amount);
    }
    const uniquePrices=[...new Set(prices)];
    if(uniquePrices.length>1&&!/(?:售价|成交价|价格|卖价)(?:改为|改成|改到)|改价|改成|改为/.test(q))issues.salePrice='出现多个售价，请确认本单售价。';
    if(uniquePrices.length&&!issues.salePrice)result.salePrice=prices.at(-1);
    const mentions=serialMentions(q);
    for(const {token} of mentions){
      if(/^(?:\d{4}|[a-z0-9-]{5,40})$/i.test(token))serials.push(token);else issues.serial='串号没有识别清楚，请输入后四位或完整串号。';
    }
    const explicitOrder=/(?:开|建|做|填|出).{0,6}(?:销售)?单|录单|(?:记|登记|录入).{0,6}(?:销售|成交)|(?:销售|成交).{0,6}(?:记一下|登记|录入)|^(?:销售单|开单)[。！!\s]*$/.test(q)&&!/(?:采购单|订货单|接待单|赠品单|入库单|退货单)/.test(q);
    const saleVerb=/卖出|售出|成交(?!价)|销售了|卖了/.test(q);
    const dataQuery=statusQuery(q)||/查|查询|统计|核算|库存|销量|营业额|赚了|进货|退货|作废|取消/.test(q);
    const saleRequest=Boolean(focus)||explicitOrder||Boolean((saleVerb||mentions.length||/手机(?:串号|串码)/.test(q))&&!dataQuery);
    const bareSerials=[],phoneRanges=[...digits(q).matchAll(/(?<!\d)(1[3-9](?:\s*\d){9})(?!\s*\d)/g)].map(x=>({index:x.index,end:x.index+x[0].length}));
    if(saleRequest&&(explicitOrder||focus==='serial')){
      for(const match of digits(q).matchAll(/(?<![a-z0-9.])(\d{4,40})(?![a-z0-9.])/gi)){
        const token=match[1],end=match.index+match[0].length;
        if(/^1[3-9]\d{9}$/.test(token)||[...mentions,...moneySpans,...phoneRanges].some(x=>match.index<x.end&&end>x.index))continue;
        const prefix=q.slice(0,match.index).split(/[，,。；;！？!?]/).at(-1).trim(),suffix=q.slice(end);
        if(/(?:售价|成交价|卖价|价格|金额|收了|收款|预算|发票|订单号|流水号|手机号|电话|营业员|操作员|员工|供货商|供应商|备注|数量|容量)/.test(prefix)||/^\s*(?:元|块|GB|G|TB|T|台|部|件|个|张|分钟)/i.test(suffix))continue;
        bareSerials.push({token,index:match.index,end});serials.push(token);
      }
    }
    if(new Set(serials.map(x=>x.toLowerCase())).size>1)issues.serial='出现多个串号，请明确这台手机的完整串号。';
    const phoneLabels=[...digits(q).matchAll(/(?:手机号|手机号码|电话号码|电话)(?:是|为|改为|改成|[:：])?\s*([\d\s]+)/g)];
    const barePhones=saleRequest?[...digits(q).matchAll(/(?<!\d)(1[3-9](?:\s*\d){9})(?!\s*\d)/g)].filter(match=>{
      const end=match.index+match[0].length;
      if([...mentions,...phoneLabels.map(x=>({index:x.index,end:x.index+x[0].length}))].some(x=>match.index<x.end&&end>x.index))return false;
      const prefix=q.slice(0,match.index).split(/[，,。；;！？!?]/).at(-1).trim();
      return !/(?:发票|单号|订单号|流水号|串号|串码|imei|营业员|操作员|员工|供货商|供应商|备注)/i.test(prefix);
    }):[];
    const phones=[...phoneLabels.map(x=>x[1].replace(/\s/g,'')),...barePhones.map(x=>x[1].replace(/\s/g,''))];
    if(phones.some(x=>!/^1[3-9]\d{9}$/.test(x)))issues.customerPhone='顾客手机号应为11位；不提供可以跳过。';
    if(new Set(phones).size>1&&!/(?:手机号|手机号码|电话号码|电话)(?:改为|改成)/.test(q))issues.customerPhone='出现多个手机号，请确认顾客手机号。';
    if(phones.length&&!issues.customerPhone)result.customerPhone=phones.at(-1);
    const name=q.match(/(?:(?:顾客|客户|用户)(?:姓名|名字|叫)?|姓名|名字)(?:是|为|改为|改成|[:：])?\s*([^，,。；;\d]{1,40}?)(?=\s*(?:手机号|手机号码|电话号码|电话|售价|成交价|价格|串号|串码|尾号|附件|赠品|微信|现金|支付宝|付款|发票|备注)|[，,。；;\d]|$)/);
    if(name)result.customerName=name[1].trim();
    // A standalone name beside the single customer phone is a draft suggestion, never an employee lookup.
    if(!result.customerName&&!issues.customerPhone&&new Set(phones).size===1){
      const nearby=[];
      for(const phone of barePhones){
        const left=q.slice(0,phone.index).split(/[，,。；;！？!?]/).map(x=>x.trim()).filter(Boolean).at(-1)||'';
        const right=q.slice(phone.index+phone[0].length).split(/[，,。；;！？!?]/).map(x=>x.trim()).filter(Boolean)[0]||'';
        const candidate=[left,right].find(text=>/^[\u3400-\u9fff]{2,12}(?:·[\u3400-\u9fff]{1,12})?$/.test(text)&&!/(?:开单|个单|张单|销售|成交|手机|串号|售价|价格|付款|收款|到账|微信|现金|支付宝|银行卡|云闪付|营业员|操作员|员工|供货商|供应商|附件|赠品|备注|姓名|名字|身份证|发票|没有|不用|不要|华为|荣耀|苹果|小米|红米|三星|一加|魅族|中兴|努比亚|帮我|我要|我叫|你好|谢谢)/.test(text));
        if(candidate)nearby.push(candidate);
      }
      if(new Set(nearby).size===1)result.customerName=nearby[0];
    }
    // In an order instruction, a name attached to the serial can be suggested without a phone number.
    if(!result.customerName&&saleRequest&&!issues.serial){
      const suggested=[];
      for(const serial of [...bareSerials,...mentions]){
        let text=q.slice(0,serial.index).split(/[，,。；;！？!?]/).map(x=>x.trim()).filter(Boolean).at(-1)||'';
        text=text.replace(/^(?:请|帮我|给我|麻烦你|麻烦|我想|我要)?\s*(?:(?:开|建|做|填|出)\s*(?:一下|一个|一张|一笔|个|张|笔)?\s*(?:销售)?单|录单)[\s：:]*/,'').trim();
        if(/^[\u3400-\u9fff]{2,12}(?:·[\u3400-\u9fff]{1,12})?$/.test(text)&&!/(?:手机|串号|串码|销售|售价|价格|付款|收款|到账|微信|现金|支付宝|营业员|操作员|员工|供货商|供应商|附件|赠品|备注|姓名|名字|身份证|发票|没有|不用|不要|华为|荣耀|苹果|小米|红米|三星|一加|魅族|中兴|努比亚|帮我|我要|你好|谢谢|数量)/.test(text))suggested.push(text);
      }
      if(new Set(suggested).size===1)result.customerName=suggested[0];
    }
    if(!result.account&&accounts.filter(x=>q.includes(x)).length>1&&!/(不是|不用|没用|不要|没付|未付)/.test(q))issues.account='出现多种收款方式，请确认；混合支付请打开完整销售单核对。';
    let giftRequests;
    if(/(?:没有|没|不带|不用|不需要|无)(?:附件|赠品)|(?:不送|不赠送)/.test(q)){giftRequests=[];result.giftRequested='';}
    else{
      const gift=q.match(/(?:附件|赠品|赠送|送)(?:有|是|为|[:：]|了)?\s*(.+?)(?=[，,。；;]|\s*(?:顾客|客户|手机号|手机号码|电话|售价|成交价|微信|现金|支付宝|银行卡|云闪付|发票|备注)|$)/);
      if(gift){
        const text=gift[1].trim();result.giftRequested=text;
        giftRequests=text.split(/和|及|、|加上/).map(part=>{
          const qty=part.match(/([1-9]\d*|[一二两三四五六七八九十]+)\s*(?:个|件|张|条|只|台|套)/);
          const quantity=qty?(/^[0-9]+$/.test(qty[1])?Number(qty[1]):chineseAmount(qty[1])):1;
          return {name:part.replace(/([1-9]\d*|[一二两三四五六七八九十]+)\s*(?:个|件|张|条|只|台|套)/,'').replace(/^(?:一个|一张|一条|个|张|条)/,'').trim(),quantity};
        }).filter(x=>x.name);
        if(!giftRequests.length)issues.gift='请补充附件名称，或点“无附件”。';
      }
    }
    const invoice=q.match(/(?:发票号|发票单号|发票号码)(?:是|为|[:：])?\s*([a-z0-9-]{1,100})/i);if(invoice)result.invoiceNo=invoice[1];
    const note=q.match(/备注(?:是|为|[:：])?\s*(.+)$/);if(note)result.orderNote=note[1].trim().slice(0,500);
    // Bare answers are interpreted only for the field the salesperson selected.
    if(focus==='price'&&!uniquePrices.length&&!issues.salePrice){const amount=price(q);if(amount!==null)result.salePrice=amount;}
    if(focus==='serial'&&!serials.length){const token=serialToken(q);if(token)serials.push(token);}
    if(focus==='customerPhone'&&!phoneLabels.length&&/^1[3-9]\d{9}$/.test(digits(q).trim()))result.customerPhone=digits(q).trim();
    if(focus==='customerName'&&!Object.keys(result).length&&!serials.length&&!Object.keys(issues).length&&/^[\u4e00-\u9fa5a-zA-Z·\s]{1,30}$/.test(q))result.customerName=q.trim();
    for(const key of Object.keys(issues))delete result[key];
    return {facts:result,issues,serialToken:issues.serial?'':serials[0]||'',giftRequests,saleRequest};
  }
  function giftCandidates(rows,request){
    const term=normalize(request).replace(/(?:手机)?保护壳|手机壳|壳子/g,'壳').replace(/钢化膜|手机膜|贴膜/g,'膜').replace(/充电头|快充头/g,'充电器');
    return (rows||[]).filter(p=>p.active!==false&&p.stockManaged!==false&&p.warehouseId&&Number(p.quantity)>0&&(!p.trackSerial||(p.serials||[]).some(s=>['可售','未激活'].includes(s.status)))).filter(p=>{
      const text=normalize([p.name,p.shortName,...(p.aliases||[])].join(' ')).replace(/(?:手机)?保护壳|手机壳|壳子/g,'壳').replace(/钢化膜|手机膜|贴膜/g,'膜').replace(/充电头|快充头/g,'充电器');
      return Boolean(term)&&(text.includes(term)||term.length>1&&term.includes(normalize(p.name).replace(/（模拟）|\(模拟\)/g,'')));
    });
  }

  return {accounts,digits,candidates,serialToken,serialMatches,payment,price,facts,analyze,giftCandidates,statusQuery,receptionRequest,singlePhoneSale};
});
