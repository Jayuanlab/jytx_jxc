(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StoreTariffExport=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const names={bayu:'巴渝卡',feixiang:'神州行飞享',"4g-feixiang":'4G飞享套餐',campus:'校园青春卡',family:'全家享',"digital-family":'数字家庭',"5ga":'5G-A'};
 const order=Object.keys(names),typeKey=row=>Object.hasOwn(names,row.family)?row.family:'other',typeName=row=>names[typeKey(row)]||'其他套餐';
 const note='全国/通用、重庆和定向流量分别列示，不能相加当作全国通用流量；国内流量不含港澳台和国外。未列明不等于0。这里只核对已录入资料，实际总费、办理资格和活动条件仍需移动 BOSS 核实。';
 const number=(value,unit)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?String(value)+unit:'未列明';
 function types(rows){return [...order,'other'].map(key=>({key,label:names[key]||'其他套餐',count:rows.filter(row=>typeKey(row)===key).length})).filter(row=>row.count);}
 function entry(row,index){
  const lines=['【'+index+'】'+String(row.planName||'未命名套餐'),'套餐类型：'+typeName(row),'基础月费：'+number(row.baseMonthlyFee,'元/月')+'（实际总费另核）','通话：'+number(row.minutes??row.voiceMinutes,'分钟/月'),'全国/通用流量：'+number(row.domesticGB,'GB/月')+(row.domesticGB!=null&&row.domesticFlowLabel?'（原资料标注：'+row.domesticFlowLabel+'）':''),'重庆流量：'+number(row.chongqingGB,'GB/月'),'定向流量：'+number(row.directedGB,'GB/月')+(row.directedGB!=null?'（适用APP另核）':''),'范围未明确流量：'+number(row.unspecifiedGB,'GB/月')+(row.unspecifiedGB!=null?'（不可作为全国通用流量）':'')];
  if(row.exclusiveFlowText)lines.push('专属流量说明：'+row.exclusiveFlowText);
  if(row.broadband)lines.push('宽带：'+row.broadband);
  if(row.subcards!=null)lines.push('副卡：'+number(row.subcards,'张')+'（共享规则另核）');
  if(row.commitment)lines.push('承诺期：'+row.commitment);
  const conditions=[...new Set([row.feeNote,...(row.conditions||[])].filter(Boolean))].join('；');if(conditions)lines.push('费用与办理条件：'+conditions);
  lines.push('资料状态：'+(row.statusLabel||(['current','needs_review'].includes(row.status)?row.status==='current'?'现行参考，资格与总费另核':'待核实':row.status||'待核实')));
  if(row.reviewReasons?.length)lines.push('待核问题：'+row.reviewReasons.join('；'));
  if(row.sourceDocumentDate)lines.push('资料日期：'+row.sourceDocumentDate);
  const refs=(row.sources||[]).map(source=>source.label).filter(Boolean);if(refs.length)lines.push('资料出处：'+[...new Set(refs)].join('；'));
  return lines.join('\n');
 }
 function text(rows,{title='套餐资费核对清单',asOf,groupByType=false}={}){
  const out=[title,'套餐档数：'+rows.length];if(asOf){const at=new Date(asOf);if(!Number.isNaN(at.getTime()))out.push('数据提取时间：'+at.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}));}out.push(note,'');
  let index=1;
  if(groupByType){for(const group of types(rows)){out.push('========== '+group.label+'（'+group.count+'档） ==========','');for(const row of rows.filter(row=>typeKey(row)===group.key))out.push(entry(row,index++),'');}}
  else for(const row of rows)out.push(entry(row,index++),'');
  return out.join('\n').trim()+'\n';
 }
 return {note,typeKey,typeName,types,text};
});
