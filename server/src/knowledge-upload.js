'use strict';
const {createHash}=require('node:crypto');
const {inflateRawSync}=require('node:zlib');
const c=require('./common'),knowledge=require('./employee-knowledge');
const MAX_FILE=5*1024*1024,MAX_XML=3*1024*1024,MAX_TEXT=120000,MAX_PART=5800;
function fail(message){throw new c.HttpError(400,message);}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// Only read the main Word XML, never extract paths or follow external relationships.
function documentXml(buffer){
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))fail('Word 文件格式不正确，请另存为 .docx 后上传');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
 if(count!==buffer.readUInt16LE(end+8)||count>4096||start+size!==end)fail('Word 文件结构不正确');
 let pos=start,found=null;
 for(let i=0;i<count;i++){
  if(pos+46>end||buffer.readUInt32LE(pos)!==0x02014b50)fail('Word 文件目录损坏');
  const flags=buffer.readUInt16LE(pos+8),method=buffer.readUInt16LE(pos+10),crc=buffer.readUInt32LE(pos+16),packed=buffer.readUInt32LE(pos+20),unpacked=buffer.readUInt32LE(pos+24),nameLength=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32),offset=buffer.readUInt32LE(pos+42);
  const next=pos+46+nameLength+extra+comment;if(next>end)fail('Word 文件目录损坏');
  const name=buffer.subarray(pos+46,pos+46+nameLength).toString('utf8');pos=next;
  if(name!=='word/document.xml')continue;
  if(found||flags&1||![0,8].includes(method)||unpacked>MAX_XML||offset+30>start||buffer.readUInt32LE(offset)!==0x04034b50)fail('Word 正文损坏、已加密或过大，请拆分后上传');
  const dataStart=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
  if(dataStart+packed>start||buffer.subarray(offset+30,offset+30+buffer.readUInt16LE(offset+26)).toString('utf8')!==name)fail('Word 正文结构损坏');
  try{found=method===0?buffer.subarray(dataStart,dataStart+packed):inflateRawSync(buffer.subarray(dataStart,dataStart+packed),{maxOutputLength:MAX_XML});}catch{fail('Word 正文无法读取，请重新保存文件');}
  if(found.length!==unpacked||crc32(found)!==crc)fail('Word 正文校验失败，请重新保存文件');
 }
 if(pos!==end||!found)fail('没有找到 Word 正文，请上传 .docx 文件');return decodeText(found);
}
function decodeText(buffer){
 let encoding='utf-8';
 if(buffer[0]===0xff&&buffer[1]===0xfe)encoding='utf-16le';
 if(buffer[0]===0xfe&&buffer[1]===0xff)encoding='utf-16be';
 try{return new TextDecoder(encoding,{fatal:true}).decode(buffer).replace(/\r\n?/g,'\n');}catch{fail('文字编码无法读取，请保存为 UTF-8 或 Unicode 后上传');}
}
function entities(text){
 return text.replace(/&([^;]+);/g,(_,entity)=>{
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(Object.hasOwn(named,entity))return named[entity];
  const n=/^#x[0-9a-f]+$/i.test(entity)?parseInt(entity.slice(2),16):/^#\d+$/.test(entity)?Number(entity.slice(1)):NaN;
  if(!Number.isInteger(n)||n<=0||n>0x10ffff||n>=0xd800&&n<=0xdfff)fail('Word 正文含有无法读取的字符');return String.fromCodePoint(n);
 });
}
function wordBlocks(xml){
 if(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))fail('Word 正文格式不支持，请重新保存文件');
 const blocks=[],stack=[],paragraphs=[],tables=[];let inText=0,skip=0,counter=0,pid=0,tid=0;
 function close(local){
  if(local==='t')inText--;
  if(local==='p'){
   const text=(paragraphs.pop()||'').trim(),table=tables.at(-1);
   if(table){if(table.cell)table.cell.push(text);}else if(text)blocks.push({id:'p'+(++pid),kind:'paragraph',text});
  }
  if(local==='tc'){const table=tables.at(-1);if(table?.row){table.row.push((table.cell||[]).filter(Boolean).join('\n'));for(let i=1;i<(table.span||1);i++)table.row.push('');}if(table)table.cell=null;}
  if(local==='tr'){const table=tables.at(-1);if(table?.row)table.rows.push(table.row);if(table)table.row=null;}
  if(local==='tbl'){
   const table=tables.pop(),rows=table.rows.filter(row=>row.some(Boolean));
   if(rows.length){const text=rows.map(row=>row.map(cell=>cell||'（空）').join(' | ')).join('\n');if(tables.length){const parent=tables.at(-1);if(parent.cell)parent.cell.push(text);}else blocks.push({id:'t'+(++tid),kind:'table',rows,text});}
  }
 }
 for(const token of xml.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)||[]){
  if(++counter>200000)fail('Word 正文太复杂，请拆分后上传');
  if(!token.startsWith('<')){if(inText&&paragraphs.length&&!skip)paragraphs[paragraphs.length-1]+=entities(token);continue;}
  if(token.startsWith('<?')||token.startsWith('<!--'))continue;
  const tag=token.match(/^<(\/)?([\w:.-]+)(?:\s[^<>]*)?\/?\s*>$/);if(!tag)fail('Word 正文结构不正确');
  const full=tag[2],local=full.split(':').at(-1),closing=Boolean(tag[1]),self=/\/\s*>$/.test(token);
  if(closing){const entry=stack.pop();if(!entry||entry.full!==full)fail('Word 正文结构不完整');if(entry.skip){skip--;continue;}if(!skip)close(local);continue;}
  const ignored=['del','drawing','object'].includes(local);if(!self)stack.push({full,skip:ignored});if(ignored){if(!self)skip++;continue;}if(skip)continue;
  if(local==='tbl')tables.push({rows:[],row:null,cell:null});
  if(local==='tr'&&tables.length)tables.at(-1).row=[];
  if(local==='tc'&&tables.length){tables.at(-1).cell=[];tables.at(-1).span=1;}
  if(local==='gridSpan'&&tables.at(-1)?.cell){const value=token.match(/(?:\w+:)?val\s*=\s*["'](\d+)["']/)?.[1];if(!value||Number(value)>32)fail('Word 表格合并列过多，请拆分后上传');tables.at(-1).span=Number(value);}
  if(local==='p')paragraphs.push('');
  if(local==='t')inText++;
  if(['br','cr','tab'].includes(local)&&paragraphs.length)paragraphs[paragraphs.length-1]+=local==='tab'?'\t':'\n';
  if(self)close(local);
 }
 if(stack.length||paragraphs.length||tables.length)fail('Word 正文结构不完整');return blocks;
}
function splitBlocks(blocks){
 const parts=[];let current=[],length=0;
 const tableText=rows=>rows.map(r=>r.map(v=>v||'（空）').join(' | ')).join('\n');
 const flush=()=>{if(current.length){parts.push(current);current=[];length=0;}};
 const add=block=>{if(length+block.text.length+(current.length?1:0)>MAX_PART)flush();current.push(block);length+=block.text.length+(current.length>1?1:0);};
 for(const block of blocks){
  if(block.text.length<=MAX_PART){add(block);continue;}
  if(block.kind==='table'){
   const header=block.rows[0];let rows=[header];if(tableText(rows).length>MAX_PART)fail('表格的一行太长，请拆分后上传');
   for(const row of block.rows.slice(1)){
    if(tableText([...rows,row]).length>MAX_PART){
     if(rows.length===1)fail('表格的一行太长，请拆分后上传');
     add({...block,rows,text:tableText(rows)});rows=[header,row];
     if(tableText(rows).length>MAX_PART)fail('表格的一行太长，请拆分后上传');
    }else rows.push(row);
   }
   add({...block,rows,text:tableText(rows)});
  }else{
   for(let i=0;i<block.text.length;){let end=Math.min(i+MAX_PART,block.text.length);if(end<block.text.length&&/[\uD800-\uDBFF]/.test(block.text[end-1]))end--;add({...block,text:block.text.slice(i,end)});i=end;}
  }
 }
 flush();if(parts.length>30)fail('资料内容太多，请分成几个文件上传');return parts;
}
function prepare(file){
 if(!file||!Buffer.isBuffer(file.buffer))fail('请选择学习资料文件');
 if(!file.buffer.length)fail('文件是空的，请重新选择');if(file.buffer.length>MAX_FILE)throw new c.HttpError(413,'每个文件最多 5MB，请拆分后上传');
 const name=String(file.fileName||'').normalize('NFKC').replace(/\\/g,'/').split('/').at(-1);
 if(!name||name.length>160||/[\x00-\x1f\x7f]/.test(name))fail('文件名不正确或太长');
 const ext=name.match(/\.(docx|txt|md)$/i)?.[1]?.toLowerCase();if(!ext)fail('目前支持 Word（.docx）、文字（.txt）和 Markdown（.md）文件');
 const blocks=ext==='docx'?wordBlocks(documentXml(file.buffer)):decodeText(file.buffer).split(/\n\s*\n/).map((text,index)=>({id:'p'+(index+1),kind:'paragraph',text:text.trim()})).filter(block=>block.text);
 if(!blocks.length)fail('没有读到正文文字，扫描图片请先转成可选中文字的文件');
 const text=blocks.map(block=>block.text).join('\n');if(text.length>MAX_TEXT)fail('正文最多 12 万字，请拆分后上传');if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))fail('文件含有非文字内容，请重新保存为文字文件');
 const sha256=createHash('sha256').update(file.buffer).digest('hex'),parts=splitBlocks(blocks);
 return {name,ext,sha256,bytes:file.buffer.length,characters:text.length,title:name.replace(/\.(docx|txt|md)$/i,'').slice(0,65),parts};
}
function preview(store,user,prepared){
 c.permit(user,'manageUsers');const previous=(store.knowledgeUploads||[]).find(row=>row.sha256===prepared.sha256);
 return {name:prepared.name,bytes:prepared.bytes,characters:prepared.characters,title:prepared.title,duplicate:!!previous,articleIds:previous?.articleIds||[],parts:prepared.parts.map((blocks,index)=>({number:index+1,body:blocks.map(b=>b.text).join('\n')})),note:'提取正文和表格文字；图片等内容保留在原文件中。上传后先标记待核实，可阅读学习，核对后可修改资料状态。'};
}
function apply(store,user,prepared,settings={}){
 c.permit(user,'manageUsers');const previous=(store.knowledgeUploads||[]).find(row=>row.sha256===prepared.sha256);
 if(previous)return {...previous,duplicate:true};
 const title=String(settings.title||prepared.title).trim(),category=String(settings.category||'学习资料').trim();
 if(!title||title.length>65||!category||category.length>30)fail('标题最多 65 字，分类最多 30 字，请核对');
 const articleIds=[],stamp=c.now(),downloadHref='/api/assistant/knowledge/file?sha256='+prepared.sha256;
 for(const [index,blocks] of prepared.parts.entries()){
  const body=blocks.map(b=>b.text).join('\n');
  const saved=knowledge.save(store,user,{title:title+(prepared.parts.length>1?'（'+(index+1)+'/'+prepared.parts.length+'）':''),category,summary:body.slice(0,220),body,tags:[category],enabled:true,policyStatus:'needs_review'});
  Object.assign(store.employeeKnowledge.find(r=>r.id===saved.id),{uploadSha256:prepared.sha256,sourceTier:'store_training',sourceLabel:'店内上传学习资料',sourceFiles:[{name:prepared.name,sha256:prepared.sha256,downloadHref}],sourceBlocks:blocks.map((b,i)=>({...b,id:'block-'+(i+1)})),sourceRefs:blocks.map((b,i)=>({file:prepared.name,blockId:'block-'+(i+1),label:'正文第 '+(i+1)+' 块'})),tables:blocks.filter(b=>b.kind==='table').map(b=>({headers:b.rows[0],rows:b.rows.slice(1)})),importedAt:stamp,sourceNotes:'原文件保留；上传不表示资费或办理条件已经确认。'});
  articleIds.push(saved.id);
 }
 const record={sha256:prepared.sha256,name:prepared.name,bytes:prepared.bytes,characters:prepared.characters,title,category,articleIds,uploadedAt:stamp,uploadedBy:user.id,uploadedByName:user.name};
 store.knowledgeUploads ||= [];store.knowledgeUploads.push(record);
 c.audit(store,user,'knowledge:upload',JSON.stringify({...record,articles:store.employeeKnowledge.filter(row=>articleIds.includes(row.id))}));
 return {...record,duplicate:false};
}
module.exports={prepare,preview,apply,MAX_FILE};

