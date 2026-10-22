'use strict';
const c = require('./common');
const personalOnly = user => user.roleCode === 'personal-assistant';
const customer = user => personalOnly(user) || user.assistantCustomerOnly === true || user.roleCode === 'customer-assistant';
const personal = user => personalOnly(user) || !customer(user) && user.roleCode === 'owner';
function catalog(user) {
 return {work: !customer(user), customer: !personalOnly(user), personal: personal(user),
  entries: [...(!personalOnly(user)?[{id:'customer',name:'小猫咪机器人',href:'/kitty'}]:[]),
   ...(!customer(user)?[{id:'work',name:'工作助理',href:'/assistant?mode=store'},{id:'learning',name:'软件学习天地',href:'/learning'}]:[]),
   ...(personal(user)?[{id:'personal',name:'我的个人助理',href:'/companion'}]:[])]};
}
function permitPersonal(user) {
 if (!personal(user)) throw new c.HttpError(403, '此账号尚未开通个人助理，请联系管理员');
}
// Work greetings are allowed; personal life and entertainment belong to the personal entrance.
function offWork(question) {
 return /天气|新闻|八卦|明星|娱乐|电影推荐|讲.{0,4}笑话|笑一个|陪我聊|闲聊|退休生活|天热.{0,10}聊|聊两句|起居|睡眠|几点起床|人情账|亲朋|亲戚|生活习惯|养生|减肥|健身|运动计划|我的爱好|记住|记下来|记一下|我喜欢|我叫|红烧肉|菜谱|做饭|去哪里玩/.test(question)
  && !/顾客|客户|销售|推销|话术|实战|练习|培训|学习|营业厅|门店|手机卡|套餐|资费|宽带|库存|交班/.test(question);
}
const workQuestion=q=>/门店|店里|营业|员工|工作|销售|开单|订货|入库|采购|退货|换货|售后|盘点|库存|仓库|串号|串码|供货|供应|商品|手机|号卡|办理|套餐|资费|短信|验证码|流量|通话|电话|宽带|全光|看家|泛屏|灵犀|OTV|合约|充值|收款|付款|账|毛利|工资|积分|业务|学习|培训|话术|推销|陈列|回访|交班|协助|客户|顾客|政策|审批|资金|成本|同义词|华为|荣耀|苹果|OPPO|vivo|iPhone|红米|小米/i.test(q);
module.exports = {customer, personalOnly, personal, catalog, permitPersonal, offWork, workQuestion};
