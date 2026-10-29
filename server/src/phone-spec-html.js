'use strict';
const clean=v=>String(v??'').normalize('NFKC').replace(/\u00a0/g,' ').trim();
function decode(s){return String(s).replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const p=parseInt(n[0].toLowerCase()==='x'?n.slice(1):n,n[0].toLowerCase()==='x'?16:10);return p>0&&p<=0x10ffff?String.fromCodePoint(p):'';}).replace(/&(nbsp|amp|lt|gt|quot|apos|times|yen);/gi,(_,n)=>({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",times:'×',yen:'¥'}[n.toLowerCase()]));}
function text(html){const source=String(html).replace(/<([a-z]+)\b([^>]*\bcc-product-content-container\b[^>]*)>/gi,(whole,tag,attrs)=>whole+decode(attrs.match(/\bdata-value="([^"]*)"/i)?.[1]||''));return clean(decode(source.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<sup\b[\s\S]*?<\/sup>/gi,'').replace(/<(?:br|\/?p|\/?div|\/?li|\/?h[1-6]|\/?th|\/?td|\/?dt|\/?dd|\/?span)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' '))).split('\n').map(s=>clean(s).replace(/\s+/g,' ')).filter(Boolean);}
const groups=[['huawei','华为',['华为','huawei']],['honor','荣耀',['荣耀','honor']],['vivo','vivo',['vivo']],['oppo','OPPO',['oppo']],['xiaomi','小米',['小米','xiaomi']],['redmi','红米',['红米','redmi']],['oneplus','一加',['一加','oneplus']],['iqoo','iQOO',['iqoo']],['apple','苹果',['苹果','apple','iphone']],['samsung','三星',['三星','samsung']]];
function identity(value,brandHint=''){
 let s=clean(value).replace(/^立即查看\s*/,'').replace(/^【([^】]+)】[\s\S]*$/,'$1').replace(/(?:规格参数|详细参数|手机产品参数|手机参数|产品参数|参数|技术规格).*$/,'').split(/\s[-|｜]\s|[|｜]/)[0].replace(/-(?:金属|续航|超长|硬核|4K).*$/i,'').replace(/\s+\d+[kK].*$/,'').replace(/\s+(?:长焦|原生|人像|旗舰|轻薄|性能|超感|续航|智能手机|官方网站|官方).*/,'').trim();
 if(/官方网站|官网/.test(value))s=s.split('-')[0].trim();
 const capacity=s.match(/(?:\s|\()((?:\d+\s*(?:GB)?\s*[+/]\s*)?\d+\s*(?:GB|TB|G|T)?)(?:\)|\s*\([12]\))?$/i);
 let variant=null;
 if(capacity&&/(?:[+/]|[GT])/i.test(capacity[1])){variant=clean(capacity[1]).replace(/\s+/g,'').toUpperCase().replace(/GB/g,'G').replace(/G(?=[+/])/g,'').replace('/','+');s=s.slice(0,capacity.index).trim();}
 s=s.replace(/\([12]\)$/,'').trim();
 const group=groups.find(g=>g[2].some(a=>s.toLowerCase().startsWith(a.toLowerCase())))||groups.find(g=>g[2].some(a=>clean(brandHint).toLowerCase()===a.toLowerCase()));
 let brand=group?.[0]||'',brandName=group?.[1]||'';
 if(group&&group[0]!=='apple')for(const alias of [...group[2]].sort((a,b)=>b.length-a.length))if(s.toLowerCase().startsWith(alias.toLowerCase())){s=s.slice(alias.length).trim();break;}
 if(group?.[0]==='apple')s=s.replace(/^(?:苹果|apple)\s*/i,'');
 if(!group){const m=s.match(/^([\u4e00-\u9fff]{2,4})([a-z].*)$/i);if(m){brand=brandName=m[1];s=m[2];}}
 const model=s.toLowerCase().replace(/[\s._-]/g,'').replace(/全网通$/,'');
 if(!brand||model.length<2||model.length>48||!/^[a-z0-9\u4e00-\u9fff]+$/.test(model)||!/\d|iphoneair/.test(model))return null;
 return {key:brand+':'+model+':cn',brand,brandName,model,displayName:brandName+' '+s,variant,region:'中国大陆'};
}
function links(html,base){const out=[];for(const m of String(html).matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi)){const href=m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];if(!href)continue;try{out.push({url:new URL(decode(href),base).href,label:text(m[2]).join(' '),title:decode(m[1].match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1]||'')});}catch{}}return out;}
function compatibleVariant(a,b){if(!a||!b)return true;const left=a.replace(/GB|G/g,'').split('+'),right=b.replace(/GB|G/g,'').split('+');return left.at(-1)===right.at(-1)&&(left.length!==2||right.length!==2||left[0]===right[0]);}
function parse(html,url,expected){
 const title=decode(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]*>/g,'').trim();
 const got=identity(title,expected.brandName);if(!got||got.key!==expected.key)return {status:'model-mismatch',title};
 // Manufacturer pages are family specifications. A retailer's single-version
 // page may only supply that version; never borrow its data for another memory.
 if(!compatibleVariant(got.variant,expected.variant))return {status:'variant-mismatch',title};
 const lines=text(html),fields=[],tableRows=[];
 const pacific=/^https:\/\/product\.pconline\.com\.cn\//.test(url);
 if(pacific)for(const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(m=>text(m[1]).join(' '));if(cells.length===2)tableRows.push(cells);}
 function get(labels,extract){if(pacific){for(const [label,raw] of tableRows)if(labels.includes(label.replace(/[：:]$/,''))){const value=extract(raw);if(value)return value;}return null;}for(let i=0;i<lines.length;i++){const label=lines[i].replace(/[：:]$/,'').replace(/\d+$/,'').trim();if(!labels.includes(label))continue;const raw=lines.slice(i+1,i+7).join(' ');const value=extract(raw);if(value)return value;}return null;}
 function add(key,label,value){if(value&&value.length<=180&&!/https?:|<|>|指令|忽略|system prompt|密码|口令/i.test(value))fields.push({key,label,value,sourceUrl:url});}
 add('chipset','处理器',get(['CPU型号','CPU','移动平台','处理器'],s=>s.match(/(?:高通)?(?:第[一二三四五六七八九十]+代)?(?:骁龙|天玑|麒麟|联发科|Exynos|A\d+\s*(?:Pro)?)[a-zA-Z0-9\s®+.-]{0,40}/i)?.[0]?.trim().replace(/\s+(?:CPU|GPU|RAM|ROM).*$/i,'')));
 add('screenSize','屏幕尺寸',get(['屏幕尺寸','屏幕大小','尺寸(英寸)','尺寸（英寸）','尺寸'],s=>s.match(/\b\d(?:\.\d{1,2})?\s*英寸/)?.[0]));
 add('screenType','屏幕材质',get(['屏幕材质','屏幕类型','类型'],s=>s.match(/(?:AMOLED|OLED|LCD|LTPO\s*OLED)/i)?.[0]));
 add('resolution','屏幕分辨率',get(['分辨率','屏幕分辨率'],s=>s.match(/\d{3,4}\s*[×xX*]\s*\d{3,4}/)?.[0]?.replace(/[xX*]/,'×')));
 add('refreshRate','最高刷新率',get(['刷新率','屏幕刷新率'],s=>{const vals=[...s.matchAll(/(\d{2,3})\s*Hz/gi)].map(m=>Number(m[1])).filter(x=>x>=60&&x<=240);return vals.length?Math.max(...vals)+' Hz':null;})||get(['类型','屏幕类型'],s=>{const m=s.match(/(\d{2,3})\s*Hz/i);return m&&Number(m[1])<=240?m[1]+' Hz':null;}));
 add('battery',pacific?'电池容量（参数库）':'电池典型容量',get(['电池容量','电池'],s=>{const m=s.match(/(?:典型容量\s*[:：]\s*)?(\d{4,5})\s*mAh\b/i);return m?m[1]+' mAh':null;}));
 add('charging','有线充电',get(['有线充电','有线快充','充电规格','快速充电','充电'],s=>{const m=s.match(/(?:最大(?:支持)?|支持最大超级快充|最大输出功率|手机支持的充电器最大输出功率)?\s*(\d{1,3})\s*[wW]\b/);return m?m[1]+' W（最大支持值，实际功率会变化）':null;}));
 add('rearCamera','后置主摄像素',get(['后置摄像头像素','后置摄像头','后置','像素'],s=>{const m=s.match(/(?:后置摄像头\s*1\s*[:：]\s*)?(\d{3,5})\s*万(?:像素)?/);return m?m[1]+' 万像素':null;}));
 add('storage','存储版本',get(['机身内存','机身存储(ROM)','机身存储（ROM）','ROM容量','运行内存容量 + 机身存储容量'],s=>{const m=s.match(/\d{1,4}\s*(?:GB|TB)(?:\s*[+/、,，]\s*\d{1,4}\s*(?:GB|TB)){0,7}/i);return m?.[0];}));
 add('os','出厂系统',get(['操作系统','操作系统版本'],s=>s.match(/(?:HarmonyOS|MagicOS|ColorOS|OriginOS|Android|iOS)\s*\d+(?:\.\d+){0,2}/i)?.[0]));
 return {status:fields.length>=3?'ok':'insufficient-fields',title,identity:got,fields};
}
module.exports={identity,parse,links,text,compatibleVariant};
