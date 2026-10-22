const { randomUUID } = require("crypto");
const staffPermissionFields = require("./staff-permission-catalog");
const { HttpError } = require("./http");
const id = (prefix) => `${prefix}-${randomUUID()}`;
const now = () => new Date().toISOString();
const day = (value = now()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const month = (value = now()) => day(value).slice(0, 7);
const round = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
function number(value, label, minimum = 0) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim()) ||
    value == null ||
    typeof value === "boolean" ||
    !Number.isFinite(Number(value)) ||
    Math.abs(Number(value)) > 1000000000 ||
    Number(value) < minimum
  )
    throw new HttpError(400, `${label}不正确`);
  return Number(value);
}
function money(value, label = "金额") {
  return round(number(value, label));
}
function quantity(value) {
  const n = number(value, "数量", 1);
  if (!Number.isSafeInteger(n)) throw new HttpError(400, "数量必须为正整数");
  return n;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, `请填写${label}`);
  return value.trim();
}
function validMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || ""))
    throw new HttpError(400, "工资月份不正确");
  return value;
}
function capabilities(user) {
  const customerOnly = user.assistantCustomerOnly === true || user.roleCode === "customer-assistant" || user.roleCode === "personal-assistant";
  const owner = !customerOnly && user.roleCode === "owner";
  const manager = !customerOnly && user.roleCode === "manager";
  const has = (code) => !customerOnly && (user.permissions || []).includes(code);
  const result = {
    learn: true,
    communicate: !customerOnly,
    managePay: owner || has("payroll:manage"),
    viewAllPay: owner || has("payroll:view_all"),
    confirmPay: owner,
    sell: owner || manager || has("sale:create"),
    purchase: owner || manager || has("purchase:create"),
    returnSale: owner || manager || has("sale:return"),
    manageProducts: owner || manager || has("product:update"),
    createPaymentAccounts: owner || has("payment-account:create"),
    cost: owner || manager || has("cost:view"),
    profit: owner || has("finance:view_profit"),
    finance: owner || manager || has("finance:view"),
    financeReceive: owner || manager || has("finance:receive"),
    supplierView: owner || manager || has("supplier:view"),
    supplierSettle: owner || has("supplier:settle"),
    supplierAdjust: owner || has("supplier:adjust"),
    allSales: owner || manager || has("report:view"),
    stocktake: owner || manager || has("stock:adjust"),
    screenEdit: owner || has('screen:edit'),
    redRequest: owner || manager || has('finance:view') || has('red:request'),
    redReview: owner,
    feedbackReview: owner || has('feedback:review'),
    learningReview: owner || has('learning:review'),
    dutyManage: owner || has('duties:manage'),
    workReview: owner || has('work:review'),
    usedPhoneAssess: owner || manager || has('used-phone:assess'),
    usedPhoneReview: owner || has('used-phone:review'),
    opening: owner,
    manageUsers: owner,
    giftApprove: owner || has("gift:approve"),
  };
  if(!owner&&!customerOnly)for(const field of staffPermissionFields){
    if(typeof user.capabilityOverrides?.[field.key]==="boolean")result[field.key]=user.capabilityOverrides[field.key];
  }
  result.redReview = owner; // 红冲必须由老板本人批准，员工授权不能覆盖。
  return result;
}
function permit(user, action) {
  if (!capabilities(user)[action])
    throw new HttpError(403, "当前账号没有此操作权限");
}
function userById(store, userId) {
  const user = store.users.find(
    (u) => u.id === userId && u.status === "active",
  );
  if (!user) throw new HttpError(403, "账号不存在或已停用");
  return user;
}
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    roleCode: user.roleCode,
    status: user.status,
    branchIds: user.branchIds || [],
    assistantCustomerOnly: user.assistantCustomerOnly === true || user.roleCode === "customer-assistant" || user.roleCode === "personal-assistant",
    personalAssistantOnly: user.roleCode === "personal-assistant",
    capabilities: capabilities(user),
  };
}
function audit(store, user, action, detail) {
  store.operationLogs.unshift({
    id: id("LOG"),
    operatorId: user.id,
    operator: user.name,
    action,
    detail,
    createdAt: now(),
  });
}
function initialize(store) {
  for (const key of [
    "products",
    "inventory",
    "sales",
    "purchases",
    "saleReturns",
    "saleReturnRequests",
    "purchaseReturnRequests",
    "catalogAdditionReviews",
    "localCatalogNotices",
    "saleExchanges",
    "otherIncome",
    "purchaseReturns",
    "stocktakes",
    "movements",
    "operationLogs",
    "expenses",
    "receipts",
    "commissionRules",
    "salaryRates",
    "commissionEntries",
    "payrollStatements",
    "payrollAdjustments",
    "storeAnnouncements",
    "staffMessages",
    "staffMessageReads",
    "staffMessageReceipts",
    "cardBusinesses",
    "customers",
    "receptions",
    "receptionAttempts",
    "learningRecords",
    "workJournals",
    "dutyAssignments", "usedPhoneAssessments",
    "employeeKnowledge",
    "knowledgeImports",
    "conversionClaims",
    "assistCommissionAllocations",
    "carrierServices",
    "dailyCloseouts",
    "cashHandovers",
    "fundTransfers",
    "airRechargeEvents",
    "govSubsidyClaims",
    "cardEvents",
    "requestRecords",
    "suppliers",
    "supplierEntries",
    "supplierSettlements",
    "supplierCash",
    "supplierAdjustments",
    "costAdjustments",
    "procurementPlans",
    "searchSynonyms",
    "redReversals",
    "productPriceChanges",
    "attendance",
    "assistantReports",
    "assistantPhrases",
    "assistantDialogues",
    "assistantAnswerFeedback",
    "companionProfiles", "companionMemories", "companionMessages", "companionFavors", "companionReminders", "learningContributionAwards",
  ])
    store[key] ||= [];
  return store;
}
module.exports = {
  id,
  now,
  day,
  month,
  round,
  number,
  money,
  quantity,
  text,
  validMonth,
  capabilities,
  permit,
  userById,
  publicUser,
  audit,
  initialize,
  HttpError,
};

