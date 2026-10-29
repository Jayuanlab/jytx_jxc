'use strict';
const capabilities = require('./assistant-capabilities');
// Navigation uses the same permission-filtered directory that the screen displays.
const targets = [
  ['product-create', /新增商品|新建商品|商品建档|新建.*商品资料|新增.*商品资料/],
  ['answer-feedback', /回答纠错|助理纠错|问答纠错|错误回答|纠错审核/],
  ['payroll-management', /工资管理|审核工资|工资审核|工资增减|增减工资/],
  ['payroll-details', /工资明细|提成明细|工资查询|查询工资|查工资|工资单/],
  ['upload', /(?:上传|传上去|传到|放|存|添加).{0,8}(?:学习资料|业务资料|知识资料|文件|文档)|(?:学习资料|业务资料|知识资料|文件|文档).{0,8}(?:上传|传上去|放|存|添加)/],
  ['knowledge-review', /资费核对|政策核对|资料核对|知识核对|知识审核|待核实资料/],
  ['gift', /赠品审批|附件审批|赠品审核|超限赠品/],
  ['receipt-query', /收款单查询|查询收款单(?:入口|页面)?/],
  ['payment', /收款确认|收款核对|到账确认|销售收款/],
  ['shift', /当日中途扎账|中途扎账|临时扎账|交接班|交班结算|交班|交班账/],
  ['close', /即时扎账|每日扎账|当日扎账|日结|扎账|轧账|扎帐|轧帐/],
  ['recharge', /现金充值|话费充值|顾客充值|充值单/],
  ['cash', /现金交接|现金交款|交现金|现金上交/],
  ['funds', /资金收支|资金流水|财务流水|收支流水|转款|转账|财务结算/],
  ['suppliers', /供应商往来|供货商往来|供应商账|供货商账|供应商|供货商/],
  ['procurement', /订货单|采购单|采购验收|订货|进货|收货|验货|验收/],
  ['reception', /接待单|建接待|顾客跟进|客户跟进/],
  ['pricing', /商品调价|商品改价|调价|改零售价/],
  ['sale', /销售单|销售开单|开单/],
  ['aftersale', /退货|售后|退款|红冲/],
  ['stock', /库存|盘点|盘库/],
  ['search', /综合查询|智能查询|智能搜索|串号追踪|串码追踪|订单追踪|流水号追踪|发票单号|发票查询|发票号|单号查询/],
  ['pending', /待办|待审核|待确认|待我处理/],
  ['carrier', /移动酬金|移动业务|号卡销售/],
  ['subsidy', /国补|补贴结算/],
  ['learning', /学习单|复盘单/],
  ['journal', /小事工单|小事记录|工作日志|工作记录/],
  ['points', /工作积分|员工积分|积分核定/],
  ['reports', /向老板报告|情况报告|员工报告/],
  ['knowledge', /学习资料|业务知识|知识库|推销技巧|销售技巧/],
  ['guardian', /数字大脑|账套巡检|异常巡检/],
  ['home', /首页|工作台/],
];
function findEntry(store, user, question) {
  const q = String(question || '').trim();
  const stopped=require('./reception-availability').answer(q);if(stopped)return stopped;
  if (!q || /(?:不要|别|不想|不用).{0,5}(?:打开|进入|跳转|上传)/.test(q)) return null;
  if (/在哪(?:个)?(?:仓|库)|在哪个仓库|哪个库房|放在哪|放哪里/.test(q) && /手机|商品|库存|串号|串码/.test(q) && !/页面|界面|菜单|按钮|功能|入口/.test(q)) return null;
  const explicit = /打开|进入|带我去|带我到|跳转|去哪里|去哪儿|在哪里|在哪儿|在哪|放哪里|放哪儿|放哪|传到哪里|传到哪|找不到|哪个页面|哪个菜单|入口|怎么进|怎样进|如何进/.test(q);
  const task = /(?:我要|我想|帮我|给我|准备|开始).{0,8}(?:交接班|交班|现金交款|交现金|现金上交|现金充值|话费充值|顾客充值|学习单|工作日志|小事记录|小事工单|工资管理|工资明细|查工资)|(?:我要|我想|帮我|给我).{0,10}(?:上传|传上去|放).{0,8}(?:资料|文件|文档)/.test(q);
  if (!explicit && !task) return null;
  const target = targets.find(([, pattern]) => pattern.test(q));
  if (!target) return null;
  const item = capabilities.catalog(store, user).items.find(row => row.id === target[0]);
  if (!item) return {answer:'当前岗位没有这项功能的权限，请让老板或有权限的同事办理。',sources:[],metrics:{kind:'function-entry',allowed:false,featureId:target[0]}};
  return {
    answer: item.description,
    sources: [{label:item.label,id:'功能入口',href:item.href}],
    action: {type:'navigate',label:'打开'+item.label,href:item.href},
    metrics: {kind:'function-entry',allowed:true,featureId:item.id},
    followups: [],
  };
}
module.exports = {findEntry};
