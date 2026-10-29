'use strict';
const crypto=require('node:crypto');
const POLICY='knowledge-chunks-v1';
const MAX=1200,TARGET=700,OVERLAP=70;
const clean=value=>String(value||'').replace(/\r\n?/g,'\n').replace(/[\t ]+/g,' ').trim();
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const heading=text=>/^#{1,6}\s+/.test(text)||/^.{2,32}[：:]$/.test(text)||/^[一二三四五六七八九十]+[、.．]\s*.{2,35}$/.test(text);
function sentences(text){return clean(text).split(/(?<=[。！？；;])\s*|\n+/).map(clean).filter(Boolean);}
function prose(block,context){
 const parts=[],lines=sentences(block.text);let current='',room=MAX-Math.min(context.length+1,160);
 for(const line of lines){
  if(line.length>room){if(current){parts.push(current);current='';}for(let i=0;i<line.length;i+=room-OVERLAP)parts.push(line.slice(i,i+room));continue;}
  if(current&&current.length+line.length>TARGET){parts.push(current);current=current.slice(-OVERLAP);}
  current+=(current?'\n':'')+line;
 }
 if(current)parts.push(current);
 return parts.map((text,i)=>({kind:'prose',text:(context?context+'。':'')+text,sourceBlockId:block.id||'',part:i+1,context}));
}
function table(block,context,notes=''){
 const rows=Array.isArray(block.rows)?block.rows:[],headers=(rows[0]||[]).map(clean),out=[];
 for(let i=1;i<rows.length;i++){
  const cells=(rows[i]||[]).map(clean),fields=headers.map((h,j)=>h+'：'+(cells[j]||'未列明')).join('；');
  const text=[context,fields,notes].filter(Boolean).join('。');
  if(text.length>MAX)throw Object.assign(Error('表格单行及条件过长，请拆分资料后人工核对'),{code:'KNOWLEDGE_ROW_TOO_LONG',row:i});
  out.push({kind:'table-row',text,sourceBlockId:block.id||'',row:i,context});
 }
 return out;
}
function split(article){
 if(!article||!article.id||!Number.isInteger(article.version)||!Array.isArray(article.sourceBlocks))throw Error('资料版本或原文段落不完整');
 const blocks=article.sourceBlocks,base=[clean(article.title),clean(article.category)].filter(Boolean).join(' · '),parts=[];
 let section='';
 for(let i=0;i<blocks.length;i++){
  const block=blocks[i],value=clean(block.text);
  if(!value)continue;
  if(block.kind==='heading'||heading(value)){section=value.replace(/^#{1,6}\s+/,'');continue;}
  const context=[base,section].filter(Boolean).join(' / ');
  if(block.kind==='table'){
   let notes='';for(let j=i+1;j<blocks.length&&j<=i+3;j++){const next=clean(blocks[j].text);if(!/^(?:注|备注|说明|条件|办理要求)[：:]/.test(next))break;notes+=(notes?'；':'')+next;}
   parts.push(...table(block,context,notes));
  }else parts.push(...prose(block,context));
 }
 if(!parts.length)throw Error('资料没有可检索的正文');
 return parts.map((part,index)=>({
  id:digest([POLICY,article.id,article.version,index,part.text].join('|')),
  articleId:article.id,articleVersion:article.version,policy:POLICY,index,
  sourceSha256:article.uploadSha256||article.sourceFiles?.[0]?.sha256||null,
  sourceBlockId:part.sourceBlockId,row:part.row||null,part:part.part||null,
  kind:part.kind,text:part.text,contentHash:digest(part.text)
 }));
}
module.exports={split,POLICY,MAX,TARGET,OVERLAP};
