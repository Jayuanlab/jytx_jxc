'use strict';
// Preserve full serial text and true worksheet row numbers. No filename/hash supplied
// by the browser is treated as proof: hashes below are calculated from actual bytes.
const {createHash}=require('node:crypto'),c=require('./common');
const MAX_ROWS=100,MAX_BYTES=600000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const aliases={
 serialNo:['serialNo','IMEI','IMEI1','串号','串码','手机串号','完整串号','序列号','SN'],
 skuId:['skuId','SKU','商品ID','型号ID'],externalCode:['externalCode','商品编码','商品编号','货号'],
 name:['name','型号','手机型号','商品名称','品名','商品名'],supplierId:['supplierId','供货商ID','供应商ID'],supplier:['supplier','供应商','供货商','供货单位'],
 warehouseId:['warehouseId','仓库ID'],warehouse:['warehouse','仓库','所属仓库','入库仓库'],
 costPrice:['costPrice','进价','进货价','成本价','单位成本','期初成本','采购单价'],salePrice:['salePrice','零售价','售价','预设售价'],
 type:['type','一级分类','商品类型','手机类型'],subType:['subType','二级分类','品牌'],thirdType:['thirdType','三级分类'],
 actualPurchaseDate:['actualPurchaseDate','实际进货日期','进货日期'],planItemId:['planItemId','订货明细ID']
};
const key=value=>String(value??'').trim().normalize('NFKC').toLowerCase(),headers=new Map(Object.entries(aliases).flatMap(([field,names])=>names.map(name=>[key(name),field])));
function csv(text){
 const delimiter=text.split(/\r?\n/,1)[0].includes('\t')?'\t':',',rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell==='')quoted=true;else if(quoted)quoted=false;else cell+=ch;}
 else if(ch===delimiter&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=ch;
 if(rows.length>MAX_ROWS+12||row.length>40)throw new c.HttpError(400,'整表最多100台、40列，请分批并保留完整串号');}
 if(quoted)throw new c.HttpError(400,'CSV引号未闭合，请重新导出');if(cell!==''||row.length)rows.push([...row,cell]);return rows;
}
function normalizeTable(table,sheet){
 let header=-1,fields;
 for(let i=0;i<Math.min(10,table.length);i++){const mapped=table[i].map(value=>headers.get(key(value))||'');if(mapped.includes('serialNo')&&mapped.some(x=>['skuId','externalCode','name'].includes(x))){header=i;fields=mapped;break;}}
 if(header<0)throw new c.HttpError(400,'表头须包含“型号（或SKU/商品编码）”与“串号”，每行一台手机');
 const used=fields.filter(Boolean);if(new Set(used).size!==used.length)throw new c.HttpError(400,'表头存在重复含义列，请保留一个型号、串号、成本等字段');
 const rows=[];
 for(let i=header+1;i<table.length;i++){if(!table[i].some(value=>String(value??'').trim()!==''))continue;const row={};for(let j=0;j<fields.length;j++)if(fields[j]){const value=table[i][j];row[fields[j]]=value==null?'':String(value).trim();}rows.push({...row,rowProvenance:{sheet,row:i+1}});}
 if(!rows.length||rows.length>MAX_ROWS)throw new c.HttpError(400,'请一次填写1至100台手机，每行一台；不能截断超出部分');return rows;
}
function read(payload){
 const choices=[payload.fileBase64!=null,payload.paste!=null,Array.isArray(payload.rows)].filter(Boolean).length;if(choices!==1)throw new c.HttpError(400,'请选择一份表格、粘贴整表或手工整表，不要同时提交多个来源');
 if(payload.fileBase64!=null){
  const sourceFile=String(payload.sourceFile||'').trim();if(!sourceFile||sourceFile.length>160||/[\\/\x00-\x1f]/.test(sourceFile)||!/\.(?:xlsx?|csv)$/i.test(sourceFile))throw new c.HttpError(400,'请选择原始XLS、XLSX或CSV文件');
  const encoded=payload.fileBase64;if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_BYTES/3)*4||!encoded.length||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw new c.HttpError(400,'文件编码或大小不正确，原文件最多600KB');
  const bytes=Buffer.from(encoded,'base64');if(bytes.length>MAX_BYTES||bytes.toString('base64')!==encoded)throw new c.HttpError(400,'文件编码或大小不正确');
  const sourceSha256=sha(bytes);let rows,sheet;
  if(/\.csv$/i.test(sourceFile)){sheet='CSV';const text=bytes.toString('utf8').replace(/^\uFEFF/,'');if(text.includes('\uFFFD'))throw new c.HttpError(400,'CSV请另存为UTF-8，或直接粘贴Excel表格');rows=normalizeTable(csv(text),sheet);}
  else {let workbook;const XLSX=require('xlsx');try{workbook=XLSX.read(bytes,{type:'buffer',cellDates:false,cellFormula:true,sheetRows:MAX_ROWS+12});}catch{throw new c.HttpError(400,'Excel文件无法读取，请确认文件完整或改用粘贴整表');}
   const names=workbook.SheetNames.filter(name=>workbook.Sheets[name]?.['!ref']);sheet=String(payload.sheet||'').trim();if(!sheet){if(names.length!==1)throw new c.HttpError(400,'文件包含多个工作表，请填写本次导入的准确工作表名称：'+names.join('、'));sheet=names[0];}if(!names.includes(sheet))throw new c.HttpError(400,'未找到指定工作表');
   const ws=workbook.Sheets[sheet],range=XLSX.utils.decode_range(ws['!fullref']||ws['!ref']);if(range.e.r>=MAX_ROWS+11||range.e.c>=40)throw new c.HttpError(400,'工作表超出100台或40列范围，请分表导入，不能截断尾部');
   const table=[];for(let r=0;r<=range.e.r;r++){const cells=[];for(let col=0;col<=range.e.c;col++){const cell=ws[XLSX.utils.encode_cell({r,c:col})];if(cell?.f)throw new c.HttpError(400,'原表第'+(r+1)+'行含公式，请先粘贴为值，避免公式缓存与原值不一致');cells.push(cell?.v??'');}table.push(cells);}rows=normalizeTable(table,sheet);
  }
  return {kind:'file',sourceFile,sourceSha256,sheet,rows};
 }
 if(payload.paste!=null){if(typeof payload.paste!=='string'||!payload.paste.trim()||Buffer.byteLength(payload.paste)>MAX_BYTES)throw new c.HttpError(400,'请粘贴有表头的Excel整表，最多600KB');const text=payload.paste.replace(/^\uFEFF/,'');return {kind:'paste',sourceFile:'Excel粘贴整表.tsv',sourceSha256:sha(Buffer.from(text)),sheet:'粘贴整表',rows:normalizeTable(csv(text),'粘贴整表')};}
 if(!payload.rows.length||payload.rows.length>MAX_ROWS)throw new c.HttpError(400,'请填写1至100台手机，每行一台');
 const input=payload.rows.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row))throw new c.HttpError(400,'整表行格式不正确');const out={};for(const field of Object.keys(aliases))if(row[field]!=null)out[field]=row[field];return out;});
 return {kind:'manual',sourceFile:'手工整表.json',sourceSha256:sha(JSON.stringify(input)),sheet:'手工整表',rows:input.map((row,i)=>({...row,rowProvenance:{sheet:'手工整表',row:i+2}}))};
}
module.exports={read,MAX_ROWS};
