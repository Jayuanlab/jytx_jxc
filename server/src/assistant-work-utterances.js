'use strict';

// Questions the owner has actually used. This file only recognises intent; every
// number and permission decision still comes from the live business modules.
const WORK_DATE = /今天|今日|当天|本日|昨天|昨日|前天|20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}/;
const SCREEN = /电子屏|显示屏|大屏|屏幕通知|出通知|发通知|发布通知|发送成绩单|鼓励员工加油/;
const STAFF_WORK = /接待单|接待人数|到店人数|到店.{0,5}多少人|营业厅.{0,6}多少人|来了多少人|客流|工单|工作日志|做了什么|干了什么|从早到晚|全部流水|行程|成绩单|成绩如何|移动业务|酬金|佣金/;
const SALES_BRIEF = /(?:汇报|报告|说说|看看|查|查询|统计).{0,12}(?:销售情况|销售业绩|卖货情况)|(?:今天|今日|昨天|昨日).{0,8}(?:销售情况|销售业绩)|(?:销售情况|销售业绩).{0,8}(?:汇报|报告|怎样|怎么样|如何)/;
const PENDING = /待我处理|我.{0,4}(?:待办|待审核|待确认|要处理)|员工.{0,4}待办|营业员.{0,4}待办/;
const ATTENDANCE = /(?:今天|今日|昨天|昨日).{0,8}(?:谁.{0,4}(?:上班|到岗|签到)|上班.{0,4}(?:几|多少)人|上班人数|出勤|考勤)|(?:考勤|出勤).{0,8}(?:时间|明细|记录)/;
const STOCK = /(?:查|看|统计|还有|剩|库存|在库).{0,12}(?:库存|现货|仓库|有多少货)/;
const SUPPLIER = /^(?:请|帮我|给我|我要)?(?:查|查询|看|列出|显示|调出)(?:一下|所有|全部)?(?:供货商|供应商)(?:档案|名单|列表)?[？?。!！\s]*$/;

function classify(question) {
  const q = String(question || '').normalize('NFKC').trim();
  if (!q) return null;
  // A sale or document creation stays in the existing serial and draft flow.
  if (/(?:开|建|做|填|创建|新建).{0,5}(?:销售|接待|订货|采购)单|帮我卖|我要卖|卖一台|下单/.test(q)) return null;
  if (SCREEN.test(q)) return {kind:'screen', question:q};
  if (STAFF_WORK.test(q)) {
    if (/怎么|如何|在哪|入口|新建|填写|办理|处理不了|待结案|待审核|待处理|待确认|取消必填|修改|设置|删除/.test(q)&&!/成绩如何/.test(q)) return null;
    let canonical=q;
    if (/到店.{0,5}多少人|营业厅.{0,6}多少人|接待了.{0,5}(?:几|多少)人/.test(q)) canonical+=' 接待人数';
    if (/他们.{0,8}(?:做了什么|干了什么)|从早到晚|全部流水|行程/.test(q)) canonical+=' 工单';
    if (/做了.{0,4}(?:多少|几)笔.{0,3}移动/.test(q)) canonical+=' 移动业务';
    if (/挣了.{0,5}(?:酬金|佣金)/.test(q)) canonical+=' 酬金';
    return {kind:'staff-work',question:canonical,requiresDay:/(?:每天|所有|全部)/.test(q)&&!WORK_DATE.test(q),requiresName:/单个营业员|某个营业员|某位营业员|该员工|这个营业员/.test(q)};
  }
  if (SALES_BRIEF.test(q)) return {kind:'sales-brief',question:q};
  if (PENDING.test(q)) return {kind:'pending',question:q};
  if (ATTENDANCE.test(q)) return {kind:'attendance',question:q};
  if (STOCK.test(q)) return {kind:'stock',question:q};
  if (SUPPLIER.test(q)) return {kind:'supplier',question:q};
  return null;
}

module.exports={classify};
