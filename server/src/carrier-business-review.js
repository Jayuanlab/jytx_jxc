'use strict';
const c=require('./common'),business=require('./business-reconciliation'),crypto=require('crypto');
const KEY='carrierBusinessReconciliation',EFFECT='仅批复移动业务登记事实；未配置酬金继续待配置，每月结算单比对和实际到账另行核对，不改原酬金或资金。';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function source(s,id){const row=(s.businessReconciliations||[]).find(r=>r.id===id&&r.sourceCollection==='carrierServices');return row?{row}:null;}
function evidence(s,row){return [KEY,row,(s.carrierServices||[]).find(r=>r.id===row.sourceId)||null,business.project(s,row)];}
function protectedSource(row){return ['cashHandovers','fundTransfers'].includes(row.sourceCollection);}
function rows(s,u){if(u.roleCode!=='owner')return [];const numbers=new Map((s.documentNumbers||[]).map(r=>[r.sourceId,r.displayNo]));return business.pending(s).filter(r=>r.sourceCollection==='carrierServices').map(r=>{
 const original=(s.carrierServices||[]).find(o=>o.id===r.sourceId),p=business.project(s,r),no=numbers.get(r.sourceId)||original?.displayNo||r.sourceId,parts=original?.schedule||[];
 const issues=[];if(!original)issues.push('原移动业务单不存在');if(p.sourceChanged)issues.push('原单事实已变化，请先打开原单刷新');if(r.status==='disputed')issues.push('此前有业务差异，请逐笔核实');
 const missing=!parts.length,note=missing?'酬金规则待配置，预计金额未知；本次仅核对登记事实，不填零、不确认结算或到账':'每月结算及到账另行核对，本次不改酬金金额';
 return {id:r.id,displayNo:no,label:(original?.typeName||'移动业务')+' · '+no,sub:(original?.employeeName||r.registeredByName)+' · '+(original?.serviceDate||'日期待核')+' · 移动业务编号 '+(original?.externalOrderNo||'待核'),at:r.registeredAt,status:r.status,amount:null,href:'/business-reconciliation?id='+encodeURIComponent(r.id)+'&todo=1',token:hash(evidence(s,r)),unavailable:issues.length>0,prelim:{advisoryOnly:true,level:issues.length||missing?'warning':'info',opinion:issues.length?issues.join('；'):note},details:{业务编号:original?.externalOrderNo||'待核',业务类型:original?.typeName||'待核',办理日期:original?.serviceDate||'待核',经办人:original?.employeeName||r.registeredByName,预计酬金:missing?'待配置，金额未知':parts.map(x=>x.month+'：'+x.expected+'元').join('；'),移动结算确认:missing?'尚无计划':parts.map(x=>x.month+'：'+(x.confirmed==null?'待结算单':x.confirmed+'元')).join('；'),实际到账:missing?'不能据此判断':parts.map(x=>x.month+'：'+x.received+'元').join('；')}};
 });}
function resolve(s,u,p,current){
 if(u.roleCode!=='owner')throw new c.HttpError(403,'仅老板本人可批复移动酬金登记');
 const found=source(s,p.id);if(!found)throw new c.HttpError(409,'原移动业务待办不存在');
 const r=found.row,view=business.project(s,r);if(!['pending','disputed'].includes(r.status))throw new c.HttpError(409,'该登记已核对，请刷新');
 if(current.unavailable||view.sourceChanged||r.status==='disputed')throw new c.HttpError(409,'本单存在差异或已变化，请打开原单核实后办理');
 const note=String(p.note||'').trim();if(!p.approve&&!note)throw new c.HttpError(400,'登记业务差异须填写说明');
 return {path:'/api/business-reconciliation/decide',body:{id:r.id,version:r.version,decision:p.approve?'match':'dispute',note:note||(p.approve?'老板批量核对移动业务登记事实；预计酬金、每月移动结算及实际到账继续分别核对。':''),goodsChecked:false,acknowledgePendingFunds:true,acknowledgeOpenLosses:true}};
}
function complete(s,u,id){const r=source(s,id)?.row;if(r?.status!=='reconciled')return;const at=c.now();for(const n of [...(s.feishuNotices||[]),...(s.localCatalogNotices||[])])if(!n.readAt&&(n.businessReconciliationId===id||String(n.key||'').startsWith('business-reconciliation:'+id+':'))){n.readAt=at;n.resolvedAt=at;n.resolvedBy=u.id;n.resolution='业务登记已核对；每月结算及实际到账仍独立核对';}}
module.exports={KEY,EFFECT,source,evidence,protectedSource,rows,resolve,complete};
