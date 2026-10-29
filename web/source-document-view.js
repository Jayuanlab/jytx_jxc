(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StoreOriginalDocument=api;})(typeof window==='object'?window:this,function(){
  'use strict';
  const E=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const missing=value=>value===null||value===undefined||value==='';
  const value=(input,empty='未填写')=>missing(input)?'<span class="source-missing">'+E(empty)+'</span>':E(input);
  const money=input=>missing(input)?'<span class="source-missing">原单未填写金额</span>':'¥'+E(Number(input).toFixed(2));
  const date=input=>!input?'未记录':/^\d{4}-\d{2}-\d{2}$/.test(input)?input:Number.isNaN(Date.parse(input))?String(input):new Date(input).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const field=(label,input,empty)=>'<div class="source-field"><dt>'+E(label)+'</dt><dd>'+value(input,empty)+'</dd></div>';
  function carrierFields(row){
    return '<dl class="source-fields">'+field('移动业务名称',row.businessName,'业务名称未填写')+field('业务类型',row.typeName)+field('业务细类',row.subTypeName,'业务细类未填写')+(row.productName?field('具体产品／档位',row.productName):'')+
      field('办理日期',date(row.businessDate))+field('办理员工',row.employeeName)+field('顾客手机号',row.customerMask)+field('移动系统业务编号（原填）',row.externalOrderNo)+
      field('关联销售单号（原填）',row.reference,'未填写关联单号')+field('运营商',row.operator)+field('移动APP登录',row.mobileAppLoggedIn===true?'是':row.mobileAppLoggedIn===false?'否':null,'未登记')+
      field('备注',row.note,'未填写备注')+'</dl>'+
      (row.missingBusinessName?'<p class="source-warning">原单业务名称或细类不完整，请经办人补充说明后再核对。</p>':'')+
      '<section class="source-commission"><h5>原单酬金计划</h5>'+(row.commissionSourceName?'<p class="source-recorded-at">标准来源：'+E(row.commissionSourceName)+' · '+E(row.commissionSourceRange)+'</p>':'')+(row.expectedCommissionTotal!=null?'<p>预计总酬金 <strong>'+money(row.expectedCommissionTotal)+'</strong></p>':'')+'<p>酬金规则：'+value(row.commissionRuleLabel,row.commissionRuleStatus||'未配置')+(row.commissionRuleRevision!=null?' · 版本 '+E(row.commissionRuleRevision):'')+'</p>'+
      (row.hasCommissionPlan?'<div class="source-table-scroll"><table><thead><tr><th>结算月</th><th>预计酬金</th><th>移动确认</th><th>实际到账</th><th>结算单号</th></tr></thead><tbody>'+row.schedule.map(part=>'<tr><td>'+value(part.month)+'</td><td>'+money(part.expected)+'</td><td>'+value(part.confirmed==null?null:'¥'+Number(part.confirmed).toFixed(2),'未登记确认')+'</td><td>'+value(part.received==null?null:'¥'+Number(part.received).toFixed(2),'未登记到账')+'</td><td>'+value(part.statementNo)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="source-warning">'+(row.expectedCommissionTotal!=null?'基础酬金总额已知，但返还周期未注明，返期待核实。移动确认和到账仍须分别核对。':'原单尚未建立逐月结算计划，预计酬金、移动确认和到账情况尚不能核实，不能按0元认定已结清。')+'</p>')+'</section>';
  }
  function render(doc){
    if(!doc?.available)return '<section class="source-original" aria-label="原单内容"><h4>原单内容</h4><p class="source-warning">当前未取到原单内容，不能依据空白信息确认核对。请刷新或核对原单关联。</p></section>';
    let body;
    if(doc.carrier)body=carrierFields(doc.carrier);
    else body='<dl class="source-fields">'+field('业务内容',doc.businessName,'原单未填写业务内容')+field('往来对象',doc.counterparty||doc.object)+field('业务日期',date(doc.businessDate))+field('经办人',doc.recordedByName)+
      '<div class="source-field"><dt>原单金额</dt><dd>'+money(doc.amount)+'</dd></div>'+field('原单状态',doc.businessStatus)+field('原填写流水号／关联号',doc.reference)+field('备注／事由',doc.note)+'</dl>';
    if(doc.items?.length)body+='<section><h5>原单商品与串号</h5><div class="source-items">'+doc.items.map(item=>'<div class="source-item"><strong>'+E(item.name)+'</strong><p>'+[item.code?'商品编码 '+E(item.code):'',item.quantity!=null?'数量 '+E(item.quantity):'',item.received!=null?'实际收货／实点 '+E(item.received):'',item.warehouse?'仓库 '+E(item.warehouse):''].filter(Boolean).join(' · ')+'</p>'+((item.serialNo||item.serials?.length)?'<p class="source-serial">串号 '+E([item.serialNo,...(item.serials||[])].filter(Boolean).join('、'))+'</p>':'')+'</div>').join('')+'</div></section>';
    if(doc.payments?.length)body+='<section><h5>原单分笔款项</h5>'+doc.payments.map(part=>'<p>'+value(part.accountName,'原单未填账户')+'　'+money(part.amount)+(part.reference?'　流水号 '+E(part.reference):'')+(part.status?'　'+E(part.status):'')+'</p>').join('')+'</section>';
    return '<section class="source-original" aria-label="原单内容"><header><h4>原单内容</h4><span class="source-document-number">'+E(doc.displayNo)+'</span></header>'+body+'<p class="source-recorded-at">原单登记时间：'+E(date(doc.recordedAt))+'</p></section>';
  }
  return {render,carrierFields};
});
