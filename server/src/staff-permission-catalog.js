'use strict';
// These are the existing business permissions; owner-only administration stays separate.
module.exports=[
 {key:'sell',code:'sale:create',label:'销售开单',group:'门店业务'},
 {key:'returnSale',code:'sale:return',label:'销售退货与换货',group:'门店业务'},
 {key:'purchase',code:'purchase:create',label:'订货与采购入库',group:'门店业务'},
 {key:'manageProducts',code:'product:update',label:'商品管理与调价申请',group:'门店业务'},
 {key:'stocktake',code:'stock:adjust',label:'库存盘点与串号补录',group:'门店业务'},
 {key:'cost',code:'cost:view',label:'查看进货价',group:'查询与资料'},
 {key:'allSales',code:'report:view',label:'查看全店销售',group:'查询与资料'},
 {key:'supplierView',code:'supplier:view',label:'供应商往来查询',group:'查询与资料'},
 {key:'profit',code:'finance:view_profit',label:'查看毛利与利润',group:'财务与审核'},
 {key:'finance',code:'finance:view',label:'资金流水与费用登记',group:'财务与审核'},
 {key:'financeReceive',code:'finance:receive',label:'成为收款账户持有人',group:'财务与审核'},
 {key:'createPaymentAccounts',code:'payment-account:create',label:'新增支付账户（不能修改已有账户）',group:'查询与资料'},
 {key:'supplierSettle',code:'supplier:settle',label:'供应商付款与结算',group:'财务与审核'},
 {key:'supplierAdjust',code:'supplier:adjust',label:'供应商往来调整与退货',group:'财务与审核'},
 {key:'giftApprove',code:'gift:approve',label:'赠品审批',group:'财务与审核'},
 {key:'screenEdit',code:'screen:edit',label:'电子屏编辑与发布',group:'特殊权限'},
 {key:'redRequest',code:'red:request',label:'申请单据红冲',group:'特殊权限'},
 {key:'redReview',code:'red:review',label:'红冲审核仅老板本人',group:'特殊权限',readonly:true},
 {key:'feedbackReview',code:'feedback:review',label:'审核员工提交的问答纠错',group:'内容审核'},
 {key:'learningReview',code:'learning:review',label:'审核学习单与核定学习积分',group:'内容审核'},
 {key:'managePay',code:'payroll:manage',label:'管理底薪与提成规则（含补录提成）',group:'财务与审核'},
 {key:'viewAllPay',code:'payroll:view_all',label:'查看全员工资明细',group:'财务与审核'}
];
