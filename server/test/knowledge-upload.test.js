'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{deflateRawSync}=require('node:zlib');
const c=require('../src/common'),upload=require('../src/knowledge-upload'),knowledge=require('../src/employee-knowledge');
const owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'员工',roleCode:'employee',status:'active'};
function store(){return c.initialize({users:[owner,staff],sales:[{id:'sale-keep'}],inventory:[{id:'stock-keep'}],receipts:[{id:'cash-keep'}]});}
function file(text,name='学习.md'){return {fileName:name,buffer:Buffer.from(text)};}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function word(xml){
 const raw=Buffer.from(xml),packed=deflateRawSync(raw),name=Buffer.from('word/document.xml'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc32(raw),16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
 return {fileName:'学习.docx',buffer:Buffer.concat([local,name,packed,central,name,end])};
}
test('预览不写入；确认保留出处、待核状态、审计，文字不变业务账',()=>{
 const s=store(),f=file('验收流程\n先数货\n\n现金交接\n接收人确认'),p=upload.prepare(f),before=JSON.stringify(s);
 assert.equal(upload.preview(s,owner,p).parts.length,1);assert.equal(JSON.stringify(s),before);
 const result=upload.apply(s,owner,p,{title:'门店学习',category:'收货培训'}),row=s.employeeKnowledge[0];
 assert.equal(row.title,'门店学习');assert.equal(row.body,'验收流程\n先数货\n现金交接\n接收人确认');assert.equal(row.policyStatus,'needs_review');assert.equal(row.sourceTier,'store_training');assert.equal(row.sourceFiles[0].sha256,p.sha256);assert.ok(row.sourceFiles[0].downloadHref);
 assert.deepEqual(s.sales,[{id:'sale-keep'}]);assert.deepEqual(s.inventory,[{id:'stock-keep'}]);assert.deepEqual(s.receipts,[{id:'cash-keep'}]);assert.equal(s.operationLogs.filter(l=>l.action==='knowledge:upload').length,1);assert.equal(result.articleIds[0],row.id);
 knowledge.save(s,owner,{...row,body:'修订后的验收流程'});
 const edited=s.employeeKnowledge[0];assert.equal(edited.sourceFiles[0].sha256,p.sha256);assert.equal(edited.sourceBlocks[0].text,'修订后的验收流程');
 const state=JSON.stringify(s);assert.equal(upload.apply(s,owner,upload.prepare({...f,fileName:'同版副本.md'})).duplicate,true);assert.equal(JSON.stringify(s),state);assert.equal(upload.preview(s,owner,p).duplicate,true);
});
test('长文分篇无丢字；新文件不覆盖旧版或老板修改',()=>{
 const s=store(),text='学习资料'.repeat(5000)+'结束',p=upload.prepare(file(text)),preview=upload.preview(s,owner,p);
 assert.ok(preview.parts.length>1);assert.equal(preview.parts.map(p=>p.body).join(''),text);assert.ok(preview.parts.every(p=>p.body.length<=5800));
 const a=upload.apply(s,owner,p),b=upload.apply(s,owner,upload.prepare(file('新版内容','学习.md')));
 assert.equal(b.duplicate,false);assert.equal(s.employeeKnowledge.length,a.articleIds.length+1);assert.equal(s.knowledgeUploads.length,2);
});
test('权限、无字、格式、编码、大小、损坏和压缩膨胀限制明确拒绝',()=>{
 const s=store(),p=upload.prepare(file('资料'));
 assert.throws(()=>upload.preview(s,staff,p),/权限/);assert.throws(()=>upload.apply(s,staff,p),/权限/);
 for(const f of [file(''),file(' \n'),file('文字','资料.pdf'),file('文字','脚本.html'),{fileName:'编码.txt',buffer:Buffer.from([255,255])},file('\0非文字')])assert.throws(()=>upload.prepare(f));
 assert.throws(()=>upload.prepare({fileName:'大文件.txt',buffer:Buffer.alloc(upload.MAX_FILE+1)}),/5MB/);
 assert.throws(()=>upload.prepare(word('<w:document><w:body><w:p>未结束')),/不完整/);
 assert.throws(()=>upload.prepare(word('<!DOCTYPE x><w:document/>')),/不支持/);
 assert.throws(()=>upload.prepare(word('<w:document>'+('a'.repeat(4*1024*1024))+'</w:document>')),/过大/);
 const invalid=word('<w:document/>');invalid.buffer[invalid.buffer.length-23]^=1;assert.throws(()=>upload.prepare(invalid));
});
test('Word 顺序、表格分钟和流量列、空单元格、合并列、换行和实体保持；删除文字不混入',()=>{
 const p=t=>'<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>',cell=t=>'<w:tc>'+p(t)+'</w:tc>';
 const xml='<?xml version="1.0"?><w:document xmlns:w="x"><w:body>'+p('先学 &amp; 核对')+'<w:tbl><w:tr>'+cell('档位')+cell('分钟数')+cell('全国流量')+'</w:tr><w:tr>'+cell('19元')+cell('200')+cell('30GB')+'</w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>'+p('合并备注')+'</w:tc>'+cell('5GB')+'</w:tr></w:tbl><w:p><w:r><w:t>结束</w:t><w:br/><w:t>继续</w:t></w:r><w:del>'+p('删除内容')+'</w:del></w:p></w:body></w:document>';
 const prepared=upload.prepare(word(xml)),blocks=prepared.parts[0];
 assert.equal(blocks[0].text,'先学 & 核对');assert.deepEqual(blocks[1].rows,[['档位','分钟数','全国流量'],['19元','200','30GB'],['合并备注','','5GB']]);assert.equal(blocks[2].text,'结束\n继续');assert.ok(!blocks.map(b=>b.text).join('').includes('删除内容'));
});

