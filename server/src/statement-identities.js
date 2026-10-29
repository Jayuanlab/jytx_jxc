'use strict';
// Domain reference implementation for R09-R13. No database write or money posting.
const {createHash}=require('node:crypto');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text=x=>String(x??'').normalize('NFKC').trim();
function reference(raw,type='auto'){
 const original=text(raw),damaged=typeof raw==='number'&&!Number.isSafeInteger(raw);let value=original.replace(/\s/g,'').toUpperCase(),partial=type==='suffix',precision=null;
 const legacy=/^TAIL(\d+):[^:]+:[^:]+:(.+)$/.exec(value),label=/^(?:尾|后)(?:[一二三四五六七八九十\d]+位|号|码)?[:：]?(\d+)$/.exec(value);
 if(legacy){value=legacy[2];partial=true;precision=Number(legacy[1]);}
 else if(label){value=label[1];partial=true;}
 else if(type!=='full'&&/^[*X•…]+[A-Z0-9]+$/.test(value)){value=value.replace(/^[*X•…]+/,'');partial=true;}
 else if(type==='auto'&&/^\d{1,6}$/.test(value))partial=true;
 return {original,value,partial,precision:precision||value.length,damaged};
}
function rowValid(row){const parsed=new Date(String(row.date||'')+'T00:00:00Z');return !!row.id&&!!row.domain&&/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===row.date&&Number.isSafeInteger(row.amountCents)&&!row.revokedAt&&!row.reversed;}
function sameFacts(a,b){return a.domain===b.domain&&a.date===b.date&&a.amountCents===b.amountCents&&(!a.direction||!b.direction||a.direction===b.direction);}
function resolve(external,internal){
 const originals=internal.filter(rowValid),ids=originals.map(r=>r.id);if(new Set(ids).size!==ids.length)throw Error('内部记录主键重复，不能认可证据');
 const decisions=external.map(e=>{
  const base={externalId:e.id,sourceSha256:e.sourceSha256||'',sheet:e.sheet||'',row:e.row??null,externalReference:text(e.reference),originalReference:null,sourceId:null,method:null};
  if(!rowValid(e))return {...base,status:'invalid',reason:'日期、金额、原行标识或来源域不完整'};
  const er=reference(e.reference,e.referenceType),facts=originals.filter(i=>sameFacts(e,i)),prepared=facts.map(i=>({i,ref:reference(i.reference,i.referenceType)}));
  if(er.damaged)return {...base,status:'invalid',reason:'外部流水号已损失数字精度，请重新导出文本流水号，不能自动认可'};
  const exact=prepared.filter(v=>!er.damaged&&!v.ref.damaged&&!er.partial&&!v.ref.partial&&er.value&&er.value===v.ref.value);
  const tail=prepared.filter(v=>!er.damaged&&!v.ref.damaged&&(er.partial||v.ref.partial)&&er.value&&v.ref.value&&(er.value.endsWith(v.ref.value)||v.ref.value.endsWith(er.value)));
  let pool=exact,method='full';if(!pool.length){pool=tail;method='suffix';}
  if(!pool.length){pool=prepared.filter(v=>!(v.i.referenceVerified&&er.value&&v.ref.value&&!er.partial&&!v.ref.partial&&er.value!==v.ref.value));method='unique_facts';}
  if(pool.length!==1)return {...base,status:pool.length?'ambiguous':facts.length?'conflict':'unmatched',reason:pool.length?'存在多笔相同日期金额或尾号，不能唯一对应':facts.length?'已核实完整流水号与外部证据冲突':'未找到日期、金额和业务范围一致的内部记录',candidateIds:pool.slice(0,10).map(v=>v.i.id)};
  const v=pool[0];return {...base,status:'recognized',reason:method==='full'?'完整流水号及业务事实唯一对应':method==='suffix'?'尾号、日期、金额及业务范围唯一对应':'按真实流水的日期、金额及业务范围唯一定位；原填写保留',sourceId:v.i.id,sourceCollection:v.i.collection||'',receiptId:v.i.receiptId||null,originalReference:v.ref.original,method,sourceFingerprint:digest(v.i),evidenceKey:digest([e.domain,e.sourceSha256||e.id,e.sheet||'',e.row??e.id,v.i.id])};
 });
 const claimed=new Map();for(const d of decisions)if(d.status==='recognized'){const group=claimed.get(d.sourceId)||[];group.push(d);claimed.set(d.sourceId,group);}
 for(const group of claimed.values())if(group.length>1)for(const d of group){d.status='ambiguous';d.reason='多条外部原流水争用同一内部记录，保留全部原行待查';d.candidateIds=[d.sourceId];d.sourceId=null;d.method=null;delete d.evidenceKey;}
 const externalIds=external.map(r=>r.id);if(new Set(externalIds).size!==externalIds.length)throw Error('外部原行标识重复，不能重复认可');
 return {decisions,summary:{recognized:decisions.filter(r=>r.status==='recognized').length,full:decisions.filter(r=>r.status==='recognized'&&r.method==='full').length,suffix:decisions.filter(r=>r.status==='recognized'&&r.method==='suffix').length,uniqueFacts:decisions.filter(r=>r.status==='recognized'&&r.method==='unique_facts').length,pending:decisions.filter(r=>r.status!=='recognized').length},noAdditionalReceipt:true};
}
module.exports={reference,resolve,sameFacts};
