const http = require("http");

const fs = require("fs");
const { serveStaticAsset } = require("./static-assets");

const pathModule = require("path");

const { randomBytes, createHash } = require("crypto");

const { readStore, transaction: repositoryTransaction, saveKnowledgeFile, readKnowledgeFile } = require("./repository");
const { AsyncLocalStorage } = require("node:async_hooks");
const workRequestContext = new AsyncLocalStorage();

const { sendJson, readJsonBody, readMultipartForm } = require("./http");

const c = require("./common");
const documentNumbers = require("./document-numbers");

const erp = require("./erp");

const salesList = require("./sales-list");

const capacitySalesList = process.env.STORE_ENGINE === "postgres" ? require("./capacity/sales-list") : null;

const warehouses = require("./warehouses");
const inventoryTransfers = require("./inventory-transfers");

const payroll = require("./payroll");

const legacy = require("./services");

const suppliers = require("./suppliers");

const search = require("./search");

const redReversals = require("./red-reversals");
const saleReturnRequests=require('./sale-return-requests'),purchaseReturnRequests=require('./purchase-return-requests');
const catalogReviews=require('./catalog-reviews');
const purchasePriceCorrections=require('./purchase-price-corrections');

const reviewDelegation = require('./review-delegation');

const saleExchanges = require("./sale-exchanges");

const financialDocuments = require("./financial-documents");

const productPricing = require("./product-pricing");

const inventoryDetails = require("./inventory-details");

const stocktakeSheets = require("./stocktake-sheets");

const vocabulary = require("./search-vocabulary");

const closeouts = require("./closeouts");

const dailyClose = require("./daily-close");

const cashHandovers = require("./cash-handovers");

const salePayments = require("./sale-payments");
const paymentAccounts = require("./payment-accounts");

const fundsNetwork = require("./funds-network");

const guardian = require("./guardian");

const qrProducts = require("./qr-products");
const repairFilms = require("./film-catalog");

const carrierRentals = require("./carrier-rentals");
const businessOptions = require("./business-options");
const orderRedPackets = require("./order-red-packets");

const govSubsidy = require("./gov-subsidy");

const receptions = require("./receptions");

const receptionAttempts = require("./reception-attempts");

const operationLogDetails = require("./operation-log-details");

const learning = require("./learning");

const conversions = require("./conversions");

const workbench = require("./workbench");

const copilot = require("./copilot");

const personalAssistant = require("./personal-assistant");
const attendanceReport = require("./attendance-report");

const assistantChat = require("./assistant-chat");

const stocktakePhoto=require("./stocktake-photo"),companionLibrary=require("./companion-library"),companionVision=require("./companion-vision");
const staffDuties=require("./staff-duties"),usedPhones=require("./used-phones");
const companionFamily=require("./companion-family"),companionFamilyHttp=require("./companion-family-http"),companionLocation=require("./companion-location"),companionEmergency=require("./companion-emergency");
const companionBilling=require('./companion-billing'),systemModelUsage=require('./system-model-usage');
const companionDelivery=require('./companion-delivery');
const assistantRoles=require("./assistant-roles"),companion=require("./companion"),companionChat=require("./companion-chat"),learningHub=require("./learning-hub");
const companionAccess=require("./companion-access"),companionMemoryTools=require("./companion-memory-tools");
const tokenPrices=require("./companion-billing-prices"),tokenLedger=require("./companion-billing-ledger"),tokenReconciliation=require("./companion-billing-reconciliation"),operationalHealth=require("./operational-health");

const companionNews = require("./companion-news"),companionWechat=require("./companion-wechat");

const assistantDialogue = require("./assistant-dialogue");

const assistantFeedback = require("./assistant-feedback");

const staffWorkflow = require("./staff-workflow");

const staffPermissions = require("./staff-permissions");

const storeBackups = require("./store-backups");
const opsStatus = require("./ops-status"), opsFaults = require("./ops-faults");

const assistantPhrases = require("./assistant-phrases");

const assistantCapabilities = require("./assistant-capabilities");

const assistantSupervision = require("./assistant-supervision");

const employeeKnowledge = require("./employee-knowledge");

const knowledgeImport = require("./employee-knowledge-import");

const knowledgeUpload = require("./knowledge-upload");

const workJournal = require("./work-journal");

const supplierCosts = require("./supplier-costs");

const feishuAuth = require("./feishu-auth");

const localNotices = require("./local-notices");

const storeCommunication = require("./store-communication");

const communicationEvents = require("./store-communication-events");

const { notice: recordNotice } = require("./feishu-notices");

const authSessions = require("./auth-sessions");

const localCredentials = require("./local-credentials");

const capacityEnabled=process.env.STORE_ENGINE === 'postgres';

const capacityAuth=capacityEnabled?require('./capacity/auth'):null;

const organization=capacityEnabled?require('./capacity/organization'):null;

const capacityQueries=capacityEnabled?require('./capacity/queries'):null;

const capacityContext=require('./capacity/context');

const oauthStates = new Map();

const staffInvites = new Map();

const feishuAppId = process.env.FEISHU_APP_ID || process.env.APP_ID;

const feishuAppSecret = process.env.FEISHU_APP_SECRET || process.env.APP_SECRET;

const publicOrigin = process.env.APP_PUBLIC_ORIGIN || process.env.FEISHU_PUBLIC_ORIGIN || "";

const feishuReady = process.env.HIDE_FEISHU !== "1" && Boolean(feishuAppId && feishuAppSecret && publicOrigin);

const secureCookie = publicOrigin.startsWith("https:") ? "; Secure" : "";

function cookie(req, name) {

  const raw = String(req.headers.cookie || "").split(";").map((part) => part.trim());

  const item = raw.find((part) => part.startsWith(name + "="));

  return item ? item.slice(name.length + 1) : "";

}

function newSession(user) { return authSessions.issue(user.id); }

const loopback = (req) =>

  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

const developmentLogin = (req) =>

  process.env.NODE_ENV !== "production" &&

  !process.env.WECHAT_APP_SECRET &&

  loopback(req);



async function login(req, body) {

  const store = await readStore();

  let user;

  if (body.code) {

    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET)

      throw new c.HttpError(503, "微信登录尚未配置，请联系老板");

    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");

    url.search = new URLSearchParams({

      appid: process.env.WECHAT_APP_ID,

      secret: process.env.WECHAT_APP_SECRET,

      js_code: body.code,

      grant_type: "authorization_code",

    }).toString();

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    const result = await response.json();

    if (!result.openid || result.errcode)

      throw new c.HttpError(401, "微信登录未成功，请重试");

    user = store.users.find(

      (u) => u.openid === result.openid && u.status === "active",

    );

    if (!user) throw new c.HttpError(403, "此微信尚未绑定员工账号，请联系老板");

  } else {

    if (!developmentLogin(req)) throw new c.HttpError(403, "请使用微信登录");

    user = c.userById(store, body.userId);

  }

  const token = await newSession(user);

  return { token, user: c.publicUser(user), localExperience: !body.code };

}

async function authorizationStore(req){return capacityEnabled?{users:req.erpSession?[req.erpSession.user]:[]}:await readStore();}

function authenticate(req, store) {

  const token = String(req.headers.authorization || "").replace(/^Bearer /, "") || cookie(req, "erp_session");

  const session = capacityEnabled ? req.erpSession : authSessions.get(token);

  if (!session || session.expiresAt <= Date.now())

    throw new c.HttpError(401, "登录已失效，请重新登录");

  systemModelUsage.identify(session.userId);
  return c.userById(store, session.userId);

}

// Attendance is shared server state; no token, payload actor or local preference can unlock it.
function workLock(store, user) {
  const exempt = user.roleCode === "owner" || user.assistantCustomerOnly === true || user.roleCode === "customer-assistant" || assistantRoles.personalOnly(user);
  const unlocked = { locked: false, code: null, checkedOutAt: null, attendanceId: null, recovery: "checkin" };
  if (exempt) return unlocked;
  const rows = (store.attendance || []).map((row,index) => ({row,index,time:Date.parse(row.checkInAt)}))
    .filter(item => item.row.userId === user.id && Number.isFinite(item.time))
    .sort((a,b) => b.time-a.time || Number(Boolean(a.row.checkOutAt))-Number(Boolean(b.row.checkOutAt)) || a.index-b.index);
  const row = rows[0]?.row;
  if (!row) return unlocked;
  const ended = Date.parse(row.checkOutAt);
  if (!row.checkOutAt || !Number.isFinite(ended) || ended < Date.parse(row.checkInAt)) return { ...unlocked, attendanceId: row.id };
  return { locked: true, code: "ATTENDANCE_CHECKED_OUT", checkedOutAt: row.checkOutAt, attendanceId: row.id, recovery: "checkin" };
}
const workSessionAccess = new Set([
  "/api/auth/login", "/api/auth/local/login", "/api/auth/logout", "/api/auth/local/self-set",
  "/api/store-communication/send", "/api/store-communication/read", "/api/store-communication/ack",
  "/api/store-communication/clear", "/api/store-communication/withdraw", "/api/store-communication/local-save"
]);
function workSessionAllowed(path, body) {
  return workSessionAccess.has(path) || (path === "/api/assistant/attendance" && body?.action === "checkin");
}
function assertWorkSession(store, user, path, body) {
  if (workSessionAllowed(path, body)) return;
  const state = workLock(store, user);
  if (!state.locked) return;
  const error = new c.HttpError(423, "你已签退，工作页面已锁定。请先重新签到，再办理业务。");
  error.code = state.code; error.workLock = state;
  throw error;
}
function workWritePermission(user, path) {
  if (actions[path]) c.permit(user, actions[path][0]);
  else if (["/api/auth/local/admin-set", "/api/users/invite", "/api/organization/branches", "/api/organization/grants",
      "/api/assistant/knowledge/upload", "/api/assistant/knowledge/upload-preview"].includes(path) || path.startsWith("/api/system/backups")) c.permit(user, "manageUsers");
}
function transaction(mutator) {
  return repositoryTransaction(store => {
    const current = workRequestContext.getStore();
    if (current && current.req.method === "POST" && current.path.startsWith("/api/") && !workSessionAllowed(current.path, current.body)) {
      const user = authenticate(current.req, store);
      workWritePermission(user, current.path);
      assertWorkSession(store, user, current.path, current.body);
    }
    return mutator(store);
  });
}

function getResult(path, query, store, user) {

  query = documentNumbers.queryParams(store, query);

  switch (path) {

    case "/api/document-numbers/lookup": return documentNumbers.lookup(store,user,query.get("q"));

    case "/api/store-communication":

      return storeCommunication.list(store,user,query.get("peer")||"all",query.get("before")||"",query.get("history")==="1",query.get("withdrawAfter")||"0");

    case "/api/store-communication/summary":

      return storeCommunication.summary(store,user);

    case "/api/store-communication/local-status":

      return storeCommunication.localStatus(store,user,query.get("messageId"));

    case "/api/store-communication/assessment":

      return storeCommunication.assessment(store,user,query);

    case "/api/store-communication/assessment-settings":

      return storeCommunication.assessmentSettings(store,user);

    case "/api/inventory/transfers": return inventoryTransfers.list(store,user);

    case "/api/local-notices":

      return localNotices.list(store, user);

    case "/api/me":

      return { ...c.publicUser(user), workLock: workLock(store, user) };

    case "/api/assistant/roles": return assistantRoles.catalog(user);

    case "/api/companion/wechat": return companionWechat.snapshot(store,user);

    case "/api/companion": return {...companion.snapshot(store,user),...companionChat.status(),billing:companionBilling.snapshot(store,user),location:companionLocation.snapshot(store,user),emergency:companionEmergency.snapshot(store,user),family:companionFamily.snapshot(store,user,companionFamily.defaultService.configured()),library:companionLibrary.snapshot(store,user)};
    case "/api/companion/library": return companionLibrary.snapshot(store,user);
    case "/api/companion/family": return companionFamily.snapshot(store,user,companionFamily.defaultService.configured());
    case "/api/companion/billing": return companionBilling.snapshot(store,user);
    case "/api/companion/billing/system": return systemModelUsage.snapshot(store,user);
    case "/api/companion/billing/manage": return companionBilling.management(store,user);
    case "/api/companion/billing/prices": return tokenPrices.list(store,user);
    case "/api/companion/billing/ledger": return tokenLedger.list(store,user,{kind:query.get("kind")||undefined,month:query.get("month")||undefined,userId:query.get("userId")||undefined,all:query.get("all")==="true",limit:query.get("limit")||undefined,before:query.get("before")||undefined});
    case "/api/companion/billing/reconciliation": return tokenReconciliation.list(store,user,{id:query.get("id")||undefined});
    case "/api/companion/accounts": return companionAccess.summary(store,user);
    case "/api/companion/memory/health": return companionMemoryTools.summary(store,user);

    case "/api/learning/hub": return learningHub.stats(store,user);

    case "/api/assistant/capabilities":

      return assistantCapabilities.catalog(store,user);

    case "/api/assistant/knowledge-review":

      return knowledgeImport.report(store,user);

    case "/api/assistant/knowledge":

      return employeeKnowledge.catalog(store,user,query.get("q")||"");

    case "/api/assistant/supervision":

      return assistantSupervision.snapshot(store,user,{date:query.get("date")||c.day(),employeeId:query.get("employeeId")||null});

    case "/api/work-journal/reviewers": return workJournal.reviewers(store,user);
    case "/api/work-journal":

      return workJournal.list(store,user);

    case "/api/assistant/attendance-report":
      return attendanceReport.report(store,user,query.get("month") || c.month());

    case "/api/assistant/attendance":

      return personalAssistant.getAttendance(store, user, query.get("date") || c.day());

    case "/api/assistant/reports":

      return personalAssistant.reports(store, user);

    case "/api/assistant/feedback":

      return assistantFeedback.list(store, user, query);

    case "/api/assistant/dialogues":

      return assistantDialogue.list(store, user);

    case "/api/assistant/phrases":

      return assistantPhrases.list(store, user);

    case "/api/workbench":

      return workbench.summary(store, user);

    case "/api/users/permissions":

      return staffPermissions.get(store,user,query.get("userId"));

    case "/api/system/backups":

      return storeBackups.list(store,user);

    case "/api/users":

      return store.users.filter(row=>!assistantRoles.personalOnly(row)).map((row) => ({

        ...c.publicUser(row),

        ...(c.capabilities(user).manageUsers ? { feishuBound: Boolean(row.feishuOpenId) } : {}),

      }));

    case "/api/repair-films/search":
      return repairFilms.search(store, user, query);
    case "/api/repair-films/resolve":
      return repairFilms.resolve(store, user, query);
    case "/api/repair-films/setup":
      return repairFilms.setup(store, user);

    case "/api/qr/products":

      qrProducts.permitPrint(user);

      return qrProducts.list(store);

    case "/api/qr/resolve":

      return qrProducts.resolve(store, query.get("code"));

    case "/api/products":

      return erp.listProducts(store, user);

    case "/api/warehouses":

      return warehouses.WAREHOUSES;

    case "/api/stocktake-photo/status": return stocktakePhoto.status(store,user);
    case "/api/stocktake-catalog":

      return stocktakeSheets.catalog(store,user);

    case "/api/stocktake-sheets":

      return stocktakeSheets.list(store,user);

    case "/api/serial-stocktakes":

      return inventoryDetails.listCounts(store, user);

    case "/api/inventory":

      return erp.inventory(store, user);

    case "/api/categories":

      return [...new Set(store.products.map((p) => p.type))];

    case "/api/category-hierarchy":

      return legacy.getCategoryHierarchy(store);

    case "/api/stock-movements":

      return store.movements.slice(0, 200).map((m) => {

        const { cost, ...row } = m;

        return c.capabilities(user).cost ? m : row;

      });

    case "/api/purchase-orders":

      return suppliers.purchaseRows(store, user);

    case "/api/suppliers/directory":

      return suppliers.directory(store, user);

    case "/api/suppliers":

      return suppliers.list(store, user, query.get("q") || "");

    case "/api/supplier-detail":

      return suppliers.detail(store, user, query.get("id"));

    case "/api/supplier-candidates":

      return supplierCosts.candidates(store, user, query.get("id"));

    case "/api/supplier-statement":

      return suppliers.statement(

        store,

        user,

        query.get("id"),

        query.get("from"),

        query.get("to"),

      );

    case "/api/procurement-plans":

      return suppliers.planRows(store, user);

    case "/api/system-check":

      c.permit(user, "manageUsers");

      return { checkedAt: c.now(), findings: guardian.inspect(store), stats: { products: store.products.length, inventoryUnits: store.inventory.reduce((n, x) => n + x.quantity, 0), serials: store.inventory.reduce((n, x) => n + (x.serials || []).length, 0), sales: store.sales.length, suppliers: store.suppliers.length, testProducts: store.products.filter((x) => x.testData).length } };

    case "/api/funds-network":

      return fundsNetwork.network(store, user);

    case "/api/payment-accounts":
      return paymentAccounts.list(store,user);

    case "/api/sale-payments":

      return salePayments.list(store, user);

    case "/api/cash-handovers":

      return cashHandovers.list(store, user);

    case "/api/air-recharge/balance":

      return dailyClose.airBalance(store, user);

    case "/api/air-recharge/cash-sales":

      return dailyClose.airCashSales(store, user);

    case "/api/air-recharge":

      return dailyClose.airList(store, user);

    case "/api/daily-closeouts":

      return dailyClose.list(store, user);

    case "/api/daily-closeouts/preview":

      return dailyClose.preview(store, user, query.get("date") || c.day());

    case "/api/closeouts":

      return closeouts.closeouts(store, user);

    case "/api/closeouts/preview":

      return closeouts.snapshot(store, user, query.get("cashierId"));

    case "/api/search":

      return search.search(store, user, query);

    case "/api/product-price-changes":

      return productPricing.list(store, user);

    case "/api/financial-documents":

      return financialDocuments.list(store,user,query);

    case '/api/sale-return-requests': return saleReturnRequests.list(store,user);
    case '/api/purchase-return-requests': return purchaseReturnRequests.list(store,user);
    case '/api/catalog-reviews': return catalogReviews.list(store,user);
    case '/api/red-reversals/sources': return redReversals.sources(store,user);

    case "/api/red-reversals":

      return redReversals.list(store, user);

    case "/api/search/synonyms":

      c.permit(user, "manageProducts");

      return store.searchSynonyms;

    case "/api/gift-approvals":

      return erp.giftApprovals(store, user);

    case "/api/gifts/rules":

      c.permit(user, "sell");

      return erp.giftRules(store);

    case "/api/sale-orders":

      return erp.orders(store, user, query.get("q") || "");

    case "/api/dashboard":

    case "/api/reports":

    case "/api/daily-report":

      return erp.report(store, user, query.get("date") || c.day());

    case "/api/finance":

      return erp.finance(store, user);

    case "/api/payroll":

      return payroll.getPayroll(

        store,

        user,

        query.get("month") || c.month(),

        query.get("employeeId"),

      );

    case "/api/payroll/settings":

      return payroll.settings(store, user, query.get("month") || c.month());

    case "/api/gov-subsidy":

      return govSubsidy.claims(store, user);

    case "/api/customer-journey":

      return receptions.journey(store, user, query.get("customerId"));

    case "/api/receptions/commission-options":

      return receptions.commissionOptions(store, user, query.get("id"));

    case "/api/conversion-claims":

      return conversions.list(store, user);

    case "/api/conversion-candidates":

      return conversions.candidates(store, user, query.get("id"));

    case "/api/learning":

      return learning.list(store, user);

    case "/api/receptions":

      return receptions.list(store, user);

    case "/api/receptions/link-candidates":

      return receptions.linkCandidates(store, user, query.get("id"), query.get("phone"));

    case "/api/receptions/attempts":

      return receptionAttempts.list(store, user);

    case "/api/order-red-packets":
      return orderRedPackets.list(store, user, query);
    case "/api/order-red-packets/sources":
      return orderRedPackets.sources(store, user, query);

    case "/api/carrier-business-options":
      return businessOptions.list(store, user);

    case "/api/carrier-services":

      return carrierRentals.list(store, user);

    case "/api/card-businesses":

      return erp.cards(store, user);

    case "/api/opening-balance/template":

      c.permit(user, "opening");

      return legacy.getOpeningBalanceTemplate(store);

    case "/api/opening-balance/status":

      c.permit(user, "opening");

      return {

        ...legacy.getOpeningBalanceStatus(store),

        locked: erp.openingLocked(store),

        stockValue: c.round(

          store.inventory.reduce(

            (n, s) => n + s.quantity * (s.costPrice || 0),

            0,

          ),

        ),

      };

    case "/api/operation-logs/detail":

      return operationLogDetails.detail(store,user,query.get("id"));

    case "/api/operation-logs":

      c.permit(user, "manageUsers");

      return store.operationLogs;

    default:

      throw new c.HttpError(404, "接口不存在");

  }

}

const actions = {
  "/api/companion/emergency": ["learn", companionEmergency.save],
  "/api/companion/location/manual": ["learn", companionLocation.saveManual],
  "/api/companion/location/clear": ["learn", companionLocation.clear],
  "/api/companion/library/photo/confirm": ["learn",companionVision.confirm],
  "/api/companion/library/photo/dismiss": ["learn",companionVision.dismiss],
  "/api/companion/library/save": ["learn",companionLibrary.save],
  "/api/companion/library/change": ["learn",companionLibrary.change],
  "/api/companion/library/open": ["learn",companionLibrary.opened],
  "/api/companion/library/news/open": ["learn",companionLibrary.openNews],
  "/api/companion/library/news/save": ["learn",companionLibrary.saveNews],
  "/api/companion/library/draft/dismiss": ["learn",companionLibrary.dismiss],
  "/api/companion/family/member": ["learn", companionFamily.saveMember],
  "/api/companion/family/member/state": ["learn", companionFamily.changeMember],
  "/api/companion/family/record": ["learn", companionFamily.saveRecord],
  "/api/companion/family/record/archive": ["learn", companionFamily.archiveRecord],
  "/api/companion/family/draft/dismiss": ["learn", companionFamily.dismissDraft],
  "/api/companion/family/message": ["learn", companionFamily.ownerMessage],
  "/api/companion/family/viewed": ["learn", companionFamily.ownerViewed],

  "/api/companion/billing/ack": ["learn", companionBilling.ack],
  "/api/companion/accounts": ["manageUsers", companionAccess.create],
  "/api/companion/accounts/status": ["manageUsers", companionAccess.status],
  "/api/companion/billing/default": ["manageUsers", companionBilling.saveDefault],
  "/api/companion/billing/plan": ["manageUsers", companionBilling.configure],
  "/api/companion/billing/grant": ["manageUsers", companionBilling.grant],
  "/api/companion/billing/prices": ["manageUsers", tokenPrices.save],
  "/api/companion/billing/reconciliation/import": ["manageUsers", tokenReconciliation.importStatement],

  "/api/companion/delivery/received": ["learn", companionDelivery.receipt],
  "/api/companion/delivery/opened": ["learn", companionDelivery.opened],
  "/api/companion/profile": ["learn", companion.saveProfile],

  "/api/companion/news/settings": ["learn", companionNews.save],

  "/api/companion/wechat/settings": ["learn", companionWechat.save],

  "/api/companion/wechat/ingest": ["learn", companionWechat.ingest],

  "/api/companion/memory/family-observation": ["learn", companion.familyObservation],
  "/api/companion/memory": ["learn", companion.memory],

  "/api/companion/memory/remove": ["learn", companion.removeMemory],

  "/api/companion/favor": ["learn", companion.favor],

  "/api/companion/favor/remove": ["learn", companion.removeFavor],

  "/api/companion/reminder": ["learn", companion.reminder],

  "/api/companion/reminder/complete": ["learn", companion.completeReminder],

  "/api/companion/screen/clear": ["learn", companion.clearScreen],
  "/api/companion/screen/restore": ["learn", companion.restoreScreen],
  "/api/companion/history/clear": ["learn", companion.clearHistory],

  "/api/learning/practice": ["learn", learningHub.practice],

  "/api/learning/contribution-award": ["manageUsers", learningHub.award],

  "/api/assistant/knowledge/save": ["manageUsers", employeeKnowledge.save],

  "/api/assistant/knowledge/remove": ["manageUsers", employeeKnowledge.remove],

  "/api/work-journal": ["communicate", workJournal.create],
  "/api/work-journal/assign": ["manageUsers", workJournal.assign],
  "/api/duties/schedule": ["dutyManage",staffDuties.saveSchedule],
  "/api/duties/arrange": ["dutyManage",staffDuties.arrange],
  "/api/duties/review": ["workReview",staffDuties.review],
  "/api/duties/reassign": ["dutyManage",staffDuties.reassign],
  "/api/used-phones/policy": ["manageUsers",usedPhones.savePolicy],
  "/api/used-phones/update": ["usedPhoneAssess",usedPhones.update],
  "/api/used-phones/review": ["usedPhoneReview",usedPhones.review],
  "/api/used-phones/assign": ["manageUsers",usedPhones.assign],
  "/api/work-journal/review": ["workReview", workJournal.review],

  "/api/assistant/attendance": ["learn", personalAssistant.attendance],

  "/api/assistant/reports": ["learn", personalAssistant.submitReport],

  "/api/assistant/reports/review": ["manageUsers", personalAssistant.reviewReport],

  "/api/assistant/feedback": ["learn", assistantFeedback.submit],

  "/api/assistant/feedback/review": ["feedbackReview", assistantFeedback.review],

  "/api/assistant/dialogues/save": ["manageUsers", assistantDialogue.save],

  "/api/assistant/phrases": ["manageUsers", assistantPhrases.save],

  "/api/assistant/phrases/delete": ["manageUsers", assistantPhrases.remove],

  '/api/reviews/assign': ['manageUsers', reviewDelegation.assign],

  "/api/users/permissions": ["manageUsers", staffPermissions.save],

  "/api/system/backups": ["manageUsers", storeBackups.create],

  "/api/system/backups/restore": ["manageUsers", storeBackups.restore],

  "/api/users": ["manageUsers", (store, user, data) => {

    const name = c.text(data.name, "员工姓名");

    if (name.length > 40) throw new c.HttpError(400, "员工姓名不能超过 40 字");

    if (store.users.some((row) => row.name === name))

      throw new c.HttpError(409, "员工姓名已存在，请核对");

    const roles = {

      manager: { role: "店长", permissions: [] },

      employee: { role: "店员", permissions: ["sale:create", "sale:return"] },

      warehouse: { role: "仓管", permissions: ["purchase:create", "stock:adjust"] },

    };

    const selected = roles[data.roleCode];

    if (!selected) throw new c.HttpError(400, "请选择店长、店员或仓管角色");

    const employee = {

      id: c.id("USR"), name, role: selected.role, roleCode: data.roleCode,

      status: "active", permissions: staffWorkflow.permissionsFor(store,data.roleCode,selected.permissions),

    };

    store.users.push(employee);

    c.audit(store, user, "user:create", `${employee.name} · ${employee.role}`);

    return { ...c.publicUser(employee), feishuBound: false };

  }],

  "/api/users/status": ["manageUsers", (store, user, data) => {

    const employee = store.users.find((row) => row.id === data.userId);

    if (!employee) throw new c.HttpError(404, "员工账号不存在");

    if (employee.roleCode === "owner") throw new c.HttpError(400, "不能停用老板账号");

    if (!["active", "disabled"].includes(data.status))

      throw new c.HttpError(400, "员工状态不正确");

    employee.status = data.status;

    c.audit(store, user, "user:status", `${employee.name} · ${employee.status}`);

    return { ...c.publicUser(employee), feishuBound: Boolean(employee.feishuOpenId) };

  }],

  "/api/store-communication/send": ["communicate", storeCommunication.send],

  "/api/store-communication/local-save": ["communicate", storeCommunication.saveLocal],

  "/api/store-communication/cloud-clean": ["manageUsers", storeCommunication.cloudClean],

  "/api/store-communication/read": ["communicate", storeCommunication.read],

  "/api/store-communication/ack": ["communicate", storeCommunication.ack],

  "/api/store-communication/assessment-settings": ["manageUsers", storeCommunication.saveAssessmentSettings],

  "/api/store-communication/withdraw": ["communicate", storeCommunication.withdraw],

  "/api/store-communication/clear": ["communicate", storeCommunication.clearThread],

  "/api/store-communication/publish": ["screenEdit", storeCommunication.publish],

  "/api/store-communication/update": ["screenEdit", storeCommunication.update],

  "/api/store-communication/close": ["screenEdit", storeCommunication.close],

  "/api/local-notices/read": ["manageUsers", localNotices.read],

  "/api/products": ["manageProducts", erp.saveProduct],

  "/api/product-price-changes": ["manageProducts", productPricing.request],

  "/api/product-price-changes/review": ["manageUsers", productPricing.review],

  "/api/search/synonyms": ["manageProducts", vocabulary.saveGroup],

  "/api/search/synonyms/delete": ["manageProducts", vocabulary.deleteGroup],

  "/api/purchase-orders": ["purchase", erp.purchase],
  "/api/inventory/transfers": ["purchase", inventoryTransfers.create],
  "/api/purchase-price-corrections": ["manageUsers", purchasePriceCorrections.confirm],

  "/api/sale-orders": ["sell", (store,user,payload)=>{ repairFilms.validateSale(store,user,payload); return erp.sale(store,user,payload); }],

  "/api/payment-accounts": ["createPaymentAccounts", paymentAccounts.save],

  "/api/sale-payments/confirm": ["learn", salePayments.confirm],

  "/api/sale-payments/dispute": ["learn", salePayments.dispute],

  "/api/sale-payments/assign": ["manageUsers", salePayments.assign],

  "/api/sale-payments/cash-declare": ["sell", salePayments.declareCash],

  "/api/gift-orders": ["sell", erp.supplementGift],

  "/api/gift-approvals/review": ["giftApprove", erp.reviewGiftApproval],

  "/api/users/gift-approval": ["manageUsers", (store, user, data) => {

    const target = store.users.find((row) => row.id === data.userId);

    if (!target || target.roleCode === "owner") throw new c.HttpError(404, "请选择要授权的非老板账号");

    target.permissions ||= [];

    target.permissions = target.permissions.filter((code) => code !== "gift:approve");

    if (data.enabled === true) target.permissions.push("gift:approve");

    if(target.capabilityOverrides)target.capabilityOverrides.giftApprove=data.enabled===true;

    target.permissionRevision=(target.permissionRevision||0)+1;

    c.audit(store, user, "user:gift-approval", `${target.name} · ${data.enabled === true ? "授予" : "收回"}赠品审批权`);

    return {...c.publicUser(target), feishuBound: Boolean(target.feishuOpenId)};

  }],

  "/api/gifts/rules": ["manageUsers", erp.saveGiftRules],

  "/api/sale-returns": ["returnSale", saleReturnRequests.request],

  "/api/sale-exchanges": ["returnSale", saleReturnRequests.requestExchange],
  '/api/sale-return-requests/review': ['manageUsers',saleReturnRequests.review],

  "/api/financial-documents": ["finance", financialDocuments.create],

  "/api/closeouts": ["sell", closeouts.submit],

  "/api/daily-closeouts": ["sell", dailyClose.submit],

  "/api/air-recharge": ["finance", dailyClose.airEntry],

  "/api/air-recharge/funding": ["finance", dailyClose.airFunding],

  "/api/air-recharge/cash-sales": ["sell", dailyClose.airCashSale],

  "/api/fund-transfers": ["finance", fundsNetwork.createTransfer],

  "/api/fund-transfers/confirm": ["finance", fundsNetwork.confirmTransfer],

  "/api/fund-transfers/reject": ["finance", fundsNetwork.rejectTransfer],

  "/api/cash-handovers": ["sell", cashHandovers.create],

  "/api/cash-handovers/confirm": ["learn", cashHandovers.confirm],

  "/api/cash-handovers/reject": ["learn", cashHandovers.reject],

  "/api/daily-closeouts/claim": ["sell", dailyClose.claim],

  "/api/daily-closeouts/review": ["sell", dailyClose.review],

  "/api/daily-closeouts/resubmit": ["sell", dailyClose.resubmit],

  "/api/daily-closeouts/lock": ["manageUsers", dailyClose.lock],

  "/api/daily-closeouts/unlock": ["manageUsers", dailyClose.unlock],

  "/api/closeouts/confirm": ["manageUsers", closeouts.confirm],

  "/api/closeouts/revise": ["sell", closeouts.revise],

  "/api/stocktake-sheets/compare": ["stocktake", stocktakeSheets.compare],

  "/api/stocktake-sheets/review": ["manageUsers", stocktakeSheets.review],

  "/api/stocktakes": ["stocktake", erp.stocktake],

  "/api/serial-stocktakes": ["stocktake", inventoryDetails.count],

  "/api/serial-stocktakes/review": ["manageUsers", inventoryDetails.review],

  "/api/inventory/bind-serials": ["stocktake", inventoryDetails.bind],

  "/api/expenses": ["finance", erp.expense],

  "/api/red-reversals": ["redRequest", redReversals.request],

  "/api/red-reversals/review": ["redReview", redReversals.review],

  "/api/suppliers": ["purchase", suppliers.save],

  "/api/supplier-payments": ["supplierSettle", erp.paySupplier],

  "/api/supplier-refunds": ["supplierSettle", suppliers.refund],

  "/api/supplier-offsets": ["supplierSettle", suppliers.offset],

  "/api/supplier-offsets/reverse": ["supplierSettle", suppliers.reverseOffset],

  "/api/supplier-opening": ["opening", suppliers.opening],

  "/api/supplier-adjustments": ["supplierAdjust", suppliers.adjustment],

  "/api/supplier-prices": ["supplierAdjust", supplierCosts.confirm],

  "/api/purchase-returns": ["purchase", purchaseReturnRequests.request],
  '/api/purchase-return-requests': ['purchase',purchaseReturnRequests.request],
  '/api/purchase-return-requests/review': ['manageUsers',purchaseReturnRequests.review],
  '/api/catalog-reviews/review': ['manageUsers',catalogReviews.review],

  "/api/procurement-plans": ["purchase", suppliers.plan],

  "/api/procurement-plans/close": ["purchase", suppliers.closePlan],

  "/api/procurement-plans/payment-review": ["manageUsers", suppliers.reviewPlanPayment],

  "/api/procurement-plans/assign": ["manageUsers", suppliers.assignPlan],

  "/api/gov-subsidy/confirm": ["finance", govSubsidy.confirm],

  "/api/gov-subsidy/receive": ["finance", govSubsidy.receive],

  "/api/gov-subsidy/refund": ["manageUsers", govSubsidy.refund],

  "/api/conversion-claims": ["sell", conversions.submit],

  "/api/conversion-claims/review": ["manageUsers", conversions.review],

  "/api/learning": ["learn", learning.create],

  "/api/learning/review": ["learningReview", learning.review],

  "/api/receptions": ["sell", receptions.create],

  "/api/receptions/update": ["sell", receptions.update],

  "/api/receptions/supplement": ["sell", receptions.supplement],

  "/api/receptions/wechat": ["sell", receptions.claimWechat],

  "/api/receptions/wechat/confirm": ["finance", receptions.confirmWechat],

  "/api/receptions/assist": ["sell", receptions.addAssist],

  "/api/receptions/assist/confirm": ["finance", receptions.confirmAssist],

  "/api/receptions/link": ["sell", receptions.linkExisting],

  "/api/receptions/close": ["sell", receptions.close],

  "/api/receptions/close/confirm": ["finance", receptions.confirmClose],

  "/api/receptions/rules": ["manageUsers", receptions.saveRules],

  "/api/receptions/commission": ["manageUsers", receptions.allocateCommission],

  "/api/order-red-packets/request": ["sell", orderRedPackets.request],
  "/api/order-red-packets/withdraw": ["sell", orderRedPackets.withdraw],
  "/api/order-red-packets/review": ["manageUsers", orderRedPackets.review],
  "/api/order-red-packets/pay": ["manageUsers", orderRedPackets.pay],

  "/api/carrier-business-options": ["sell", businessOptions.create],
  "/api/carrier-services": ["sell", carrierRentals.create],

  "/api/carrier-services/confirm": ["finance", carrierRentals.confirm],

  "/api/carrier-services/receive": ["finance", carrierRentals.receive],

  "/api/card-events": ["finance", erp.cardEvent],

  "/api/payroll/rules": ["managePay", payroll.saveRule],

  "/api/payroll/salaries": ["managePay", payroll.saveSalary],

  "/api/payroll/resolve": [

    "managePay",

    (store, user, data) =>

      payroll.resolveEntry(store, user, data.entryId, data),

  ],

  "/api/payroll/adjustments": ["confirmPay", payroll.saveAdjustment],

  "/api/payroll/confirm": ["confirmPay", payroll.confirm],

  "/api/payroll/pay": ["confirmPay", payroll.markPaid],

  "/api/opening-balance/import": ["opening", erp.openingCommit],

  "/api/users/bind": [

    "manageUsers",

    (store, user, data) => {

      const employee = c.userById(store, data.employeeId);

      const openid = c.text(data.openid, "微信标识");

      if (store.users.some((u) => u.id !== employee.id && u.openid === openid))

        throw new c.HttpError(409, "微信已绑定其他员工");

      employee.openid = openid;

      c.audit(store, user, "user:bind", employee.name);

      return c.publicUser(employee);

    },

  ],

};

async function mutate(req, path, body) {

  const action = actions[path];

  if (!action) throw new c.HttpError(404, "接口不存在");

  const key = c.text(req.headers["idempotency-key"], "请求编号");

  if (key.length > 160) throw new c.HttpError(400, "请求编号过长");

  const digest = createHash("sha256")

    .update(JSON.stringify(body))

    .digest("hex");

  return transaction((store) => {

    const user = authenticate(req, store);

    c.permit(user, path === "/api/payment-accounts" ? (body?.id == null || body.id === "" ? "createPaymentAccounts" : "manageUsers") : action[0]);
    assertWorkSession(store, user, path, body);
    if (["/api/order-red-packets/review", "/api/order-red-packets/pay"].includes(path)) orderRedPackets.assertOwner(store, user);

    const previous = store.requestRecords.find(

      (r) => r.key === key && r.userId === user.id && r.path === path,

    );

    if (previous) {

      if (previous.digest !== digest)

        throw new c.HttpError(409, "请求内容已变化，请重新提交");

      return path === "/api/products" ? erp.visibleProduct(previous.result, user) : path === "/api/inventory/transfers" ? inventoryTransfers.visible(previous.result,user) : previous.result;

    }

    const auditCount = store.operationLogs.length;

    const result = action[1](store, user, documentNumbers.input(store, body));

    const businessNotice = {

      "/api/sale-orders": "销售开单",

      "/api/purchase-orders": "采购入库",

      "/api/sale-returns": "销售退货申请",

      "/api/sale-exchanges": "销售换货申请",

      "/api/financial-documents": "收付款登记",

      "/api/purchase-returns": "采购退货申请",

      "/api/stocktakes": "库存盘点",

      "/api/expenses": "费用登记",

      "/api/gift-orders": "赠品出库",

    }[path];

    if (businessNotice) {

      const orderId = result?.id || result?.orderId || key;

      recordNotice(store, "local:" + path + ":" + key, businessNotice, {

        id: orderId, summary: user.name + " 提交 · " + businessNotice + " · " + orderId,

        amount: result?.totalAmount ?? result?.amount,

      });

    }

    if (store.operationLogs.length === auditCount)

      c.audit(store, user, "api:write", `${path} · ${result?.id || result?.orderId || key}`);

    store.requestRecords.push({

      key,

      userId: user.id,

      path,

      digest,

      result,

      createdAt: c.now(),

    });

    return result;

  });

}

// Same-origin identity for browser home-screen shortcuts; no service worker or auth changes.
function workbenchHtmlIdentity(html, route = "") {
  const personalPage = ["/companion", "/companion-admin"].includes(route);
  const sessionControls = '<link id="workbench-session-controls" rel="stylesheet" href="/session-controls.css?v=20261012-account-logout"><script defer src="/session-controls.js?v=20261012-account-logout"></script>';
  const identity = (personalPage ? '<link id="companion-identity" rel="manifest" href="/companion.webmanifest?v=20261013">' : '<link id="workbench-identity" rel="manifest" href="/workbench.webmanifest?v=20261012-mobile-icon">')
    + '<link rel="icon" type="image/x-icon" href="/favicon.ico?v=20261012-mobile-icon">'
    + '<link rel="icon" type="image/png" sizes="192x192" href="/workbench-icon-192.png?v=20261012-mobile-icon">'
    + '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20261012-mobile-icon">'
    + '<meta name="theme-color" content="#245fe2">'
    + (personalPage ? '<meta name="application-name" content="我的个人助理">' : '<meta name="application-name" content="聚友通信工作台">')
    + (personalPage ? '<meta name="apple-mobile-web-app-title" content="个人助理">' : '<meta name="apple-mobile-web-app-title" content="聚友工作台">');
  const attribute = (tag, name) => {
    const match = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').toLowerCase();
  };
  html=html.replace(/(src="\/(?:office|office-inventory|office-red|trade-documents|receptions|sales-list|sale-payments|work-journal|learning|search|qr|assistant|daily-close|stocktake|cash-handover|office-gifts|gift-approvals|sale-feedback|entry-feedback|close|carrier|subsidy)\.js)(?:\?[^"]*)?"/g, '$1?v=20261012-document-numbers"');
  html=html.replace(/(src="\/(?:receptions|carrier)\.js)(?:\?[^"]*)?"/g, '$1?v=20261012-mobile-app-login"');
  html=html.replace(/(src="\/office\.js)(?:\?[^"]*)?"/g, '$1?v=20261012-multi-account"');
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, (head) => {
    const cleaned = head.replace(/<(link|meta)\b[^>]*>/gi, (tag, kind) => {
      if (kind.toLowerCase() === 'link' && attribute(tag, 'rel').split(/\s+/).some((rel) => ['icon', 'manifest', 'apple-touch-icon', 'apple-touch-icon-precomposed'].includes(rel))) return '';
      if (kind.toLowerCase() === 'meta' && ['theme-color', 'application-name', 'apple-mobile-web-app-title'].includes(attribute(tag, 'name'))) return '';
      return tag;
    });
    return cleaned.replace(/(src="\/login\.js)(?:\?[^"]*)?"/g, '$1?v=20261012-account-logout"').replace(/<\/head\s*>$/i, identity + sessionControls + '</head>');
  });
}

function paymentSplitsHtml(html, route) {
  if (!['/app','/carrier','/order-red-packets','/order-red-packets.html'].includes(route)) return html;
  const assets = [];
  if (!/<script\b[^>]*\bsrc\s*=\s*["']\/payment-splits\.js(?:\?[^"']*)?["']/i.test(html))
    assets.push('<script id="workbench-payment-splits" defer src="/payment-splits.js?v=20261012-multi-account"></script>');
  if (!/<link\b[^>]*\bhref\s*=\s*["']\/payment-splits\.css(?:\?[^"']*)?["']/i.test(html))
    assets.push('<link data-payment-splits-style="1" rel="stylesheet" href="/payment-splits.css?v=20261012-multi-account">');
  return html.replace(/<head\b[^>]*>/i, head => head + assets.join(''));
}

function orderRedPacketsHtml(html, route) {
  const workPages = new Set(['/app','/carrier','/receptions','/repair-materials','/stocktake','/sales-list','/search','/air-recharge','/funds','/sale-payments','/cash-handover','/daily-close','/close','/work-journal','/qr','/learning','/subsidy','/gift-approvals','/order-red-packets','/order-red-packets.html']);
  if (!workPages.has(route)) return html;
  const assets = [];
  if (!/<script\b[^>]*\bsrc\s*=\s*["']\/order-red-packets-ui\.js(?:\?[^"']*)?["']/i.test(html))
    assets.push('<script id="workbench-order-red-packets" defer src="/order-red-packets-ui.js?v=20261013-order-red-packets"></script>');
  if (!/<link\b[^>]*\bhref\s*=\s*["']\/order-red-packets-ui\.css(?:\?[^"']*)?["']/i.test(html))
    assets.push('<link id="workbench-order-red-packets-style" rel="stylesheet" href="/order-red-packets-ui.css?v=20261013-order-red-packets">');
  return html.replace(/<head\b[^>]*>/i, head => head + assets.join(''));
}

function workSessionHtml(html, route) {
  if (route === "/login") return html;
  const tags = '<link id="workbench-work-session-style" rel="stylesheet" href="/work-session.css?v=20261012-attendance-feedback"><script defer src="/work-session.js?v=20261012-attendance-feedback"></script>';
  const clean = html.replace(/<link\b[^>]*href=["']\/work-session\.css(?:\?[^"']*)?["'][^>]*>/gi, "")
    .replace(/<script\b[^>]*src=["']\/work-session\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi, "");
  return clean.replace(/<head(\s[^>]*)?>/i, match => match + tags);
}

async function handle(req, res, options = {}) {

  let receptionBody = null;

  let requestStore = null;

  try {

    const origin = req.headers.origin;

    if (origin && origin !== publicOrigin && !(process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))

      throw new c.HttpError(403, "不允许的请求来源");

    if (req.method === "OPTIONS") {

      sendJson(res, 204, {});

      return;

    }

    const url = new URL(req.url, "http://localhost");

    const path = url.pathname;

    if(capacityEnabled && req.method==="POST" && req.headers["x-store-branch"] && req.headers["x-store-branch"]!==capacityContext.current().branchId)throw new c.HttpError(409,"门店已切换，请重新打开此页面，核对资料后再提交");

    if(path.startsWith('/api/'))res.setHeader('Cache-Control','private, no-store');
    if(await companionFamilyHttp.handle(req,res,path,options.companionFamilyService||companionFamily.defaultService))return;
    const workbenchBrandFiles = {
      "/favicon.ico": ["favicon.ico", "image/x-icon"],
      "/workbench-icon-192.png": ["workbench-icon-192.png", "image/png"],
      "/workbench-icon-512.png": ["workbench-icon-512.png", "image/png"],
      "/workbench-icon-maskable-512.png": ["workbench-icon-maskable-512.png", "image/png"],
      "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
      "/workbench.webmanifest": ["workbench.webmanifest", "application/manifest+json; charset=utf-8"],
      "/companion.webmanifest": ["companion.webmanifest", "application/manifest+json; charset=utf-8"],
    };
    if (req.method === "GET" && workbenchBrandFiles[path]) {
      const [file, contentType] = workbenchBrandFiles[path];
      let content;
      try { content = fs.readFileSync(pathModule.join(__dirname, "..", "..", "web", file)); }
      catch (error) { throw new c.HttpError(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500, "品牌图标暂不可用，请稍后刷新"); }
      const etag = '"' + createHash("sha256").update(content).digest("hex") + '"';
      const cacheHeaders = {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=0, must-revalidate",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'",
      };
      const matches = String(req.headers["if-none-match"] || "").split(",").some(value => {
        const tag = value.trim();
        return tag === "*" || tag.replace(/^W\//, "") === etag;
      });
      if (matches) {
        res.writeHead(304, cacheHeaders);
        res.end();
        return;
      }
      res.writeHead(200, { ...cacheHeaders, "Content-Length": content.length });
      res.end(content);
      return;
    }
    const officeFiles = {
      "/order-red-packets": ["order-red-packets.html", "text/html; charset=utf-8"],
      "/order-red-packets.html": ["order-red-packets.html", "text/html; charset=utf-8"],
      "/order-red-packets-ui.js": ["order-red-packets-ui.js", "text/javascript; charset=utf-8"],
      "/order-red-packets-ui.css": ["order-red-packets-ui.css", "text/css; charset=utf-8"],
      "/order-red-packets.js": ["order-red-packets.js", "text/javascript; charset=utf-8"],
      "/order-red-packets.css": ["order-red-packets.css", "text/css; charset=utf-8"],
      "/repair-materials": ["repair-materials.html", "text/html; charset=utf-8"],
      "/repair-materials.js": ["repair-materials.js", "text/javascript; charset=utf-8"],
      "/repair-materials.css": ["repair-materials.css", "text/css; charset=utf-8"],
      "/photo-tools.js": ["photo-tools.js", "text/javascript; charset=utf-8"],
      "/companion-family.js": ["companion-family.js", "text/javascript; charset=utf-8"],
      "/companion-library.js": ["companion-library.js", "text/javascript; charset=utf-8"],
      "/family.css": ["family.css", "text/css; charset=utf-8"],
      "/family.js": ["family.js", "text/javascript; charset=utf-8"],
      "/family": ["family.html", "text/html; charset=utf-8"],

      "/page-help.js": ["page-help.js", "text/javascript; charset=utf-8"],

      "/page-help.css": ["page-help.css", "text/css; charset=utf-8"],

      "/system-readiness": ["system-readiness.html", "text/html; charset=utf-8"],
      "/system-readiness.js": ["system-readiness.js", "text/javascript; charset=utf-8"],
      "/system-readiness.css": ["system-readiness.css", "text/css; charset=utf-8"],
      "/companion-admin": ["companion-admin.html", "text/html; charset=utf-8"],
      "/companion-admin.js": ["companion-admin.js", "text/javascript; charset=utf-8"],
      "/companion-admin.css": ["companion-admin.css", "text/css; charset=utf-8"],
      "/companion-memory-tools.js": ["companion-memory-tools.js", "text/javascript; charset=utf-8"],
      "/organization": ["organization.html", "text/html; charset=utf-8"],

      "/organization.js": ["organization.js", "text/javascript; charset=utf-8"],

      "/organization.css": ["organization.css", "text/css; charset=utf-8"],

      "/branch-context.js": ["branch-context.js", "text/javascript; charset=utf-8"],

      "/app": ["office.html", "text/html; charset=utf-8"],

      "/duties": ["duties.html", "text/html; charset=utf-8"],
      "/duties.js": ["duties.js", "text/javascript; charset=utf-8"],
      "/used-phones": ["used-phones.html", "text/html; charset=utf-8"],
      "/used-phones.js": ["used-phones.js", "text/javascript; charset=utf-8"],
      "/staff-tasks.css": ["staff-tasks.css", "text/css; charset=utf-8"],
      "/stocktake-photo.js": ["stocktake-photo.js", "text/javascript; charset=utf-8"],
      "/stocktake": ["stocktake.html", "text/html; charset=utf-8"],

      "/stocktake.js": ["stocktake.js", "text/javascript; charset=utf-8"],

      "/stocktake.css": ["stocktake.css", "text/css; charset=utf-8"],

      "/sales-list": ["sales-list.html", "text/html; charset=utf-8"],

      "/sales-list.js": ["sales-list.js", "text/javascript; charset=utf-8"],

      "/sales-list.css": ["sales-list.css", "text/css; charset=utf-8"],

      "/trade-documents.js": ["trade-documents.js", "text/javascript; charset=utf-8"],

      "/system-admin.js": ["system-admin.js", "text/javascript; charset=utf-8"],

      "/system-admin.css": ["system-admin.css", "text/css; charset=utf-8"],

      "/login": ["login.html", "text/html; charset=utf-8"],

      "/login.js": ["login.js", "text/javascript; charset=utf-8"],

      "/login.css": ["login.css", "text/css; charset=utf-8"],

      "/search": ["search.html", "text/html; charset=utf-8"],

      "/search.js": ["search.js", "text/javascript; charset=utf-8"],

      "/search-admin.js": ["search-admin.js", "text/javascript; charset=utf-8"],

      "/office-red.js": ["office-red.js", "text/javascript; charset=utf-8"],

      "/office-inventory.js": ["office-inventory.js", "text/javascript; charset=utf-8"],

      "/office-pricing.js": ["office-pricing.js", "text/javascript; charset=utf-8"],

      "/search.css": ["search.css", "text/css; charset=utf-8"],

      "/air-recharge": ["air-recharge.html", "text/html; charset=utf-8"],

      "/air-recharge.js": ["air-recharge.js", "text/javascript; charset=utf-8"],

      "/air-recharge.css": ["air-recharge.css", "text/css; charset=utf-8"],

      "/funds": ["funds.html", "text/html; charset=utf-8"],

      "/funds.js": ["funds.js", "text/javascript; charset=utf-8"],

      "/funds.css": ["funds.css", "text/css; charset=utf-8"],

      "/payment-accounts": ["payment-accounts.html", "text/html; charset=utf-8"],
      "/payment-accounts.js": ["payment-accounts.js", "text/javascript; charset=utf-8"],
      "/payment-accounts.css": ["payment-accounts.css", "text/css; charset=utf-8"],
      "/payment-splits.css": ["payment-splits.css", "text/css; charset=utf-8"],
      "/payment-splits.js": ["payment-splits.js", "text/javascript; charset=utf-8"],

      "/sale-payments": ["sale-payments.html", "text/html; charset=utf-8"],

      "/sale-payments.js": ["sale-payments.js", "text/javascript; charset=utf-8"],

      "/cash-handover": ["cash-handover.html", "text/html; charset=utf-8"],

      "/cash-handover.js": ["cash-handover.js", "text/javascript; charset=utf-8"],

      "/cash-handover.css": ["cash-handover.css", "text/css; charset=utf-8"],

      "/entry-feedback.js": ["entry-feedback.js", "text/javascript; charset=utf-8"],

      "/entry-feedback.css": ["entry-feedback.css", "text/css; charset=utf-8"],

      "/daily-close": ["daily-close.html", "text/html; charset=utf-8"],

      "/daily-close.js": ["daily-close.js", "text/javascript; charset=utf-8"],

      "/daily-close.css": ["daily-close.css", "text/css; charset=utf-8"],

      "/close": ["close.html", "text/html; charset=utf-8"],

      "/close.js": ["close.js", "text/javascript; charset=utf-8"],

      "/close.css": ["close.css", "text/css; charset=utf-8"],

      "/knowledge-review": ["knowledge-review.html", "text/html; charset=utf-8"],

      "/knowledge-review.js": ["knowledge-review.js", "text/javascript; charset=utf-8"],

      "/knowledge": ["knowledge.html", "text/html; charset=utf-8"],

      "/knowledge.js": ["knowledge.js", "text/javascript; charset=utf-8"],

      "/knowledge.css": ["knowledge.css", "text/css; charset=utf-8"],

      "/work-journal": ["work-journal.html", "text/html; charset=utf-8"],

      "/work-journal.js": ["work-journal.js", "text/javascript; charset=utf-8"],

      "/work-journal.css": ["work-journal.css", "text/css; charset=utf-8"],

      "/kitty": ["assistant.html", "text/html; charset=utf-8"],

      "/companion": ["companion.html", "text/html; charset=utf-8"],

      "/companion.js": ["companion.js", "text/javascript; charset=utf-8"],
    "/companion-request.js": ["companion-request.js", "text/javascript; charset=utf-8"],
      "/companion-billing.js": ["companion-billing.js", "text/javascript; charset=utf-8"],
      "/companion-speech.js": ["companion-speech.js", "text/javascript; charset=utf-8"],

      "/companion.css": ["companion.css", "text/css; charset=utf-8"],

      "/learning-hub.js": ["learning-hub.js", "text/javascript; charset=utf-8"],

      "/learning-hub.css": ["learning-hub.css", "text/css; charset=utf-8"],

      "/assistant": ["assistant.html", "text/html; charset=utf-8"],

      "/assistant.js": ["assistant.js", "text/javascript; charset=utf-8"],
      "/attendance-management.js": ["attendance-management.js", "text/javascript; charset=utf-8"],
      "/attendance-management.css": ["attendance-management.css", "text/css; charset=utf-8"],
      "/work-session.js": ["work-session.js", "text/javascript; charset=utf-8"],
      "/work-session.css": ["work-session.css", "text/css; charset=utf-8"],

      "/assistant-sale-input.js": ["assistant-sale-input.js", "text/javascript; charset=utf-8"],

      "/assistant-tariff-export.js": ["assistant-tariff-export.js", "text/javascript; charset=utf-8"],

      "/assistant.css": ["assistant.css", "text/css; charset=utf-8"],

      "/brain": ["brain.html", "text/html; charset=utf-8"],

      "/brain.js": ["brain.js", "text/javascript; charset=utf-8"],

      "/brain.css": ["brain.css", "text/css; charset=utf-8"],

      "/qr": ["qr.html", "text/html; charset=utf-8"],

      "/qr.js": ["qr.js", "text/javascript; charset=utf-8"],

      "/qr.css": ["qr.css", "text/css; charset=utf-8"],

      "/learning": ["learning.html", "text/html; charset=utf-8"],

      "/learning.js": ["learning.js", "text/javascript; charset=utf-8"],

      "/receptions": ["receptions.html", "text/html; charset=utf-8"],

      "/receptions.js": ["receptions.js", "text/javascript; charset=utf-8"],

      "/reception-profile.js": ["reception-profile.js", "text/javascript; charset=utf-8"],

      "/receptions.css": ["receptions.css", "text/css; charset=utf-8"],

      "/carrier": ["carrier.html", "text/html; charset=utf-8"],

      "/carrier.js": ["carrier.js", "text/javascript; charset=utf-8"],
      "/business-options-ui.js": ["business-options-ui.js", "text/javascript; charset=utf-8"],
      "/business-options-ui.css": ["business-options-ui.css", "text/css; charset=utf-8"],

      "/carrier.css": ["carrier.css", "text/css; charset=utf-8"],

      "/subsidy": ["subsidy.html", "text/html; charset=utf-8"],

      "/subsidy.js": ["subsidy.js", "text/javascript; charset=utf-8"],

      "/subsidy.css": ["subsidy.css", "text/css; charset=utf-8"],

      "/jsQR.js": ["jsQR.js", "text/javascript; charset=utf-8"],

      "/sale-capture.js": ["sale-capture.js", "text/javascript; charset=utf-8"],

      "/submit-voice.js": ["submit-voice.js", "text/javascript; charset=utf-8"],

      "/sale-feedback.js": ["sale-feedback.js", "text/javascript; charset=utf-8"],

      "/m": ["feishu-mobile.html", "text/html; charset=utf-8"],

      "/notices": ["notices.html", "text/html; charset=utf-8"],

      "/notices.js": ["notices.js", "text/javascript; charset=utf-8"],

      "/notices.css": ["notices.css", "text/css; charset=utf-8"],

      "/feishu-mobile.css": ["feishu-mobile.css", "text/css; charset=utf-8"],

      "/feishu-mobile.js": ["feishu-mobile.js", "text/javascript; charset=utf-8"],

      "/store-communication.js": ["store-communication.js", "text/javascript; charset=utf-8"],

      "/store-communication.css": ["store-communication.css", "text/css; charset=utf-8"],

      "/session-controls.js": ["session-controls.js", "text/javascript; charset=utf-8"],

      "/session-controls.css": ["session-controls.css", "text/css; charset=utf-8"],

      "/mobile-nav.js": ["mobile-nav.js", "text/javascript; charset=utf-8"],

      "/mobile-nav.css": ["mobile-nav.css", "text/css; charset=utf-8"],

      "/readable-ui.css": ["readable-ui.css", "text/css; charset=utf-8"],

      "/store-theme.css": ["store-theme.css", "text/css; charset=utf-8"],

      "/office-gifts.js": ["office-gifts.js", "text/javascript; charset=utf-8"],

      "/gift-approvals": ["gift-approvals.html", "text/html; charset=utf-8"],

      "/gift-approvals.js": ["gift-approvals.js", "text/javascript; charset=utf-8"],

      "/office.js": ["office.js", "text/javascript; charset=utf-8"],

      "/operation-logs.js": ["operation-logs.js", "text/javascript; charset=utf-8"],

      "/office.css": ["office.css", "text/css; charset=utf-8"],

      "/ui-refresh.css": ["ui-refresh.css", "text/css; charset=utf-8"],

      "/office-desktop.css": ["office-desktop.css", "text/css; charset=utf-8"],

    };

    if (req.method === "GET" && officeFiles[path]) {

      const [file, contentType] = officeFiles[path];
      const filename=pathModule.join(__dirname, "..", "..", "web", file);
      if ((contentType.startsWith("text/javascript") || contentType.startsWith("text/css")) && await serveStaticAsset(req,res,filename,contentType)) return;

      res.writeHead(200, {

        "Content-Type": contentType,

        "Cache-Control": "no-store",

        "X-Content-Type-Options": "nosniff",

        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'",

      });


      if(contentType.startsWith("text/html")) {

        const branchScript=capacityEnabled && path!=="/kitty" && !["login.html","organization.html","family.html"].includes(file)

          ? '<script defer src="/branch-context.js?v=20261010-sales-list"></script>' : "";

        const readableStyle=["companion.html","family.html"].includes(file)?"":'<link rel="stylesheet" href="/readable-ui.css?v=20261010-readable"><link rel="stylesheet" href="/store-theme.css?v=20261010-interface">';

        res.end(workbenchHtmlIdentity(workSessionHtml(paymentSplitsHtml(orderRedPacketsHtml(fs.readFileSync(filename,"utf8"),path),path),path).replace("</head>",branchScript+readableStyle+"</head>"),path));

      } else fs.createReadStream(filename).pipe(res);

      return;

    }

    if (req.method === "GET" && path === "/api/auth/feishu/start") {

      if (!feishuReady) throw new c.HttpError(503, "飞书登录尚未配置");

      const setup = url.searchParams.get("setup") || "";

      const invite = url.searchParams.get("invite") || "";

      const bootstrap = process.env.FEISHU_BOOTSTRAP_TOKEN || "";

      if (setup && (!bootstrap || setup !== bootstrap))

        throw new c.HttpError(403, "初始化链接无效");

      if (invite && (!staffInvites.has(invite) || staffInvites.get(invite).expiresAt < Date.now()))

        throw new c.HttpError(403, "员工邀请链接已过期");

      if (setup && invite) throw new c.HttpError(400, "登录链接无效");

      const state = randomBytes(24).toString("base64url");

      oauthStates.set(state, { expiresAt: Date.now() + 5 * 60 * 1000, setup: Boolean(setup), invite, next: url.searchParams.get("sales") === "1" ? "/app?tab=sales" : url.searchParams.get("orders") === "1" ? "/app?tab=orders" : url.searchParams.get("mobile") === "1" ? "/m" : url.searchParams.get("search") === "1" ? "/search" : url.searchParams.get("cashhandover") === "1" ? "/cash-handover" : url.searchParams.get("dailyclose") === "1" ? "/daily-close" : url.searchParams.get("close") === "1" ? "/close" : url.searchParams.get("brain") === "1" ? "/brain" : url.searchParams.get("qr") === "1" ? "/qr" : url.searchParams.get("learning") === "1" ? "/learning" : url.searchParams.get("receptions") === "1" ? "/receptions" : url.searchParams.get("carrier") === "1" ? "/carrier" : url.searchParams.get("subsidy") === "1" ? "/subsidy" : "/m" });

      const callback = publicOrigin + "/api/auth/feishu/callback";

      res.writeHead(302, {

        Location: feishuAuth.authorizationUrl(feishuAppId, callback, state),

        "Set-Cookie": `feishu_oauth_state=${state}; Path=/api/auth/feishu; HttpOnly; SameSite=Lax; Max-Age=300${secureCookie}`,

        "Cache-Control": "no-store",

        "Referrer-Policy": "no-referrer",

      });

      res.end();

      return;

    }

    if (req.method === "GET" && path === "/api/auth/feishu/callback") {

      if (!feishuReady) throw new c.HttpError(503, "飞书登录尚未配置");

      const state = url.searchParams.get("state") || "";

      const pending = oauthStates.get(state);

      oauthStates.delete(state);

      if (!pending || pending.expiresAt < Date.now() || cookie(req, "feishu_oauth_state") !== state)

        throw new c.HttpError(403, "登录验证已过期，请从飞书重新进入");

      const code = url.searchParams.get("code") || "";

      if (!code) throw new c.HttpError(401, "飞书未完成登录授权");

      const identity = await feishuAuth.getUserFromCode(code, feishuAppId, feishuAppSecret);

      const user = await transaction((store) => {

        let found = store.users.find((row) => row.feishuOpenId === identity.openId && row.status === "active");

        if (!found && pending.setup) {

          const owner = store.users.find((row) => row.roleCode === "owner" && row.status === "active");

          if (!owner || store.users.some((row) => row.feishuOpenId))

            throw new c.HttpError(403, "老板账号已绑定，不能重复初始化");

          owner.feishuOpenId = identity.openId;

          c.audit(store, owner, "user:feishu-bootstrap", identity.name);

          found = owner;

        }

        if (!found && pending.invite) {

          const invitation = staffInvites.get(pending.invite);

          if (!invitation || invitation.expiresAt < Date.now())

            throw new c.HttpError(403, "员工邀请链接已过期");

          const employee = c.userById(store, invitation.userId);

          if (employee.feishuOpenId && employee.feishuOpenId !== identity.openId)

            throw new c.HttpError(409, "该员工已绑定其他飞书账号");

          if (store.users.some((row) => row.id !== employee.id && row.feishuOpenId === identity.openId))

            throw new c.HttpError(409, "此飞书账号已绑定其他员工");

          employee.feishuOpenId = identity.openId;

          c.audit(store, employee, "user:feishu-bind", identity.name);

          found = employee;

        }

        if (!found) throw new c.HttpError(403, "飞书账号尚未绑定店员，请联系老板");

        return c.publicUser(found);

      });

      if (pending.invite) staffInvites.delete(pending.invite);

      const token = await newSession(user);

      res.writeHead(302, {

        Location: pending.next || "/app",

        "Set-Cookie": [

          `erp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secureCookie}`,

          `feishu_oauth_state=; Path=/api/auth/feishu; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`,

        ],

        "Cache-Control": "no-store",

      });

      res.end();

      return;

    }

    const demoFiles = {

      "/demo": ["demo.html", "text/html; charset=utf-8"],

      "/demo.js": ["demo.js", "text/javascript; charset=utf-8"],

      "/demo.css": ["demo.css", "text/css; charset=utf-8"],

    };

    if (req.method === "GET" && demoFiles[path]) {

      if (!developmentLogin(req)) throw new c.HttpError(403, "本地演示仅在本机开放");

      const [file, contentType] = demoFiles[path];

      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });

      fs.createReadStream(pathModule.join(__dirname, "..", "..", "web", file)).pipe(res);

      return;

    }

    if (req.method === "GET" && path === "/") {

      res.writeHead(302, { Location: "/login", "Cache-Control": "no-store" });

      res.end();

      return;

    }

    if (req.method === "GET" && ["/health"].includes(path)) {

      if(capacityEnabled) await require("./capacity/postgres").health();

      sendJson(res, 200, {

        ok: true,

        name: "聚友通信城进销存",

        storage: capacityEnabled ? "postgresql" : "sqlite",

        message: "门店进销存服务正常",

      });

      return;

    }

    if (req.method === "POST" && path.startsWith("/api/") && !workSessionAllowed(path, null) && path !== "/api/assistant/attendance") {
      const lockStore = await readStore(), viewer = authenticate(req, lockStore);
      workWritePermission(viewer, path);
      assertWorkSession(lockStore, viewer, path, null);
    }

    if (path.startsWith("/api/organization")) {

      if(!capacityEnabled) { sendJson(res,200,{enabled:false,storage:"sqlite"});return; }

      const viewer=authenticate(req,await authorizationStore(req));

      if(assistantRoles.customer(viewer))throw new c.HttpError(403,"此账号不能访问门店管理");

      if(req.method==="GET" && path==="/api/organization")sendJson(res,200,await organization.summary(viewer));

      else if(req.method==="GET" && path==="/api/organization/report")sendJson(res,200,await capacityQueries.report(viewer,url.searchParams));

      else if(req.method==="POST" && path==="/api/organization/select")sendJson(res,200,await capacityAuth.switchBranch(capacityAuth.token(req),(await readJsonBody(req)).branchId,viewer));

      else if(req.method==="POST" && path==="/api/organization/branches")sendJson(res,200,await organization.createBranch(viewer,await readJsonBody(req)));

      else if(req.method==="POST" && path==="/api/organization/grants")sendJson(res,200,await organization.grant(viewer,await readJsonBody(req)));

      else throw new c.HttpError(404,"组织接口不存在");

      return;

    }

    if (req.method === "GET" && path === "/api/auth/mode") {

      sendJson(res, 200, {

        localExperience: developmentLogin(req),

        feishu: feishuReady,

        users: developmentLogin(req) ? (await readStore()).users.map(c.publicUser) : [],

      });

      return;

    }

    if (req.method === "GET" && path === "/api/auth/local/status") {

      const store = await readStore();

      const user = authenticate(req, store);

      sendJson(res, 200, {

        user: c.publicUser(user),

        credential: await localCredentials.getForUser(user.id),

        ...(c.capabilities(user).manageUsers ? {

          users: await Promise.all(store.users.map(async (row) => ({

            id: row.id, name: row.name, role: row.role, status: row.status,

            username: (await localCredentials.getForUser(row.id))?.username || "",

          }))),

        } : {}),

      });

      return;

    }

    if (req.method === "POST" && path === "/api/auth/local/login") {

      const body = await readJsonBody(req);

      const result = await localCredentials.verify(body.username, body.password);

      if (capacityEnabled && result.ok) capacityContext.current().branchId=result.branchId;

      if (!result.ok) throw new c.HttpError(401, result.locked

        ? "密码连续输错，账号暂锁15分钟"

        : "账号或密码不正确");

      let user;

      try { user = c.userById(await readStore(), result.userId); }

      catch { throw new c.HttpError(401, "账号或密码不正确"); }

      const token = await newSession(user);

      res.writeHead(200, {

        "Content-Type": "application/json; charset=utf-8",

        "Set-Cookie": "erp_session="+token+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800"+secureCookie,

        "Cache-Control": "no-store",

      });

      res.end(JSON.stringify({ user: c.publicUser(user) }));

      return;

    }

    if (req.method === "POST" && path === "/api/auth/local/self-set") {

      const store = await readStore();

      const user = authenticate(req, store);

      const body = await readJsonBody(req);

      if (body.repeat !== undefined && body.password !== body.repeat)
        throw new c.HttpError(400, "两次输入的新密码不一致");

      if (await localCredentials.getForUser(user.id) &&

          !(await localCredentials.verifyForUser(user.id, body.currentPassword)))

        throw new c.HttpError(403, "原密码不正确");

      try { await localCredentials.set(user.id, body.username, body.password); }

      catch (error) { throw new c.HttpError(400, error.message); }

      // Password changes invalidate every previous device/session before issuing
      // a replacement cookie for the person making this change.
      await authSessions.revokeUser(user.id);

      await transaction((current) => c.audit(current, c.userById(current, user.id),

        "auth:local-self-set", "设置本人登录账号"));

      const token = await newSession(user);
      res.setHeader("Set-Cookie", "erp_session="+token+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800"+secureCookie);

      sendJson(res, 200, { ok: true, username: (await localCredentials.getForUser(user.id)).username, sessionRefreshed: true });

      return;

    }

    if (req.method === "POST" && path === "/api/auth/local/admin-set") {

      const store = await readStore();

      const admin = authenticate(req, store);

      c.permit(admin, "manageUsers");

      const body = await readJsonBody(req);

      const employee = c.userById(store, body.userId);

      if (employee.id === admin.id) throw new c.HttpError(400, "请通过本人设置修改老板账号");

      const generated = localCredentials.generatePassword();

      let credential;

      try { credential = await localCredentials.set(employee.id, body.username, generated); }

      catch (error) { throw new c.HttpError(400, error.message); }

      await authSessions.revokeUser(employee.id);

      await transaction((current) => c.audit(current, c.userById(current, admin.id),

        "auth:local-admin-set", "为"+employee.name+"设置登录账号"));

      sendJson(res, 200, { username: credential.username, password: generated });

      return;

    }

    if (req.method === "POST" && path === "/api/auth/logout") {

      const presentedTokens = new Set([
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
        cookie(req, "erp_session"),
      ].filter(Boolean));

      for (const token of presentedTokens) await authSessions.revoke(token);

      res.writeHead(200, {

        "Content-Type": "application/json; charset=utf-8",

        "Set-Cookie": `erp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`,

        "Cache-Control": "no-store",

      });

      res.end("{\"ok\":true}");

      return;

    }

    if (req.method === "POST" && path === "/api/users/invite") {

      if (!feishuReady) throw new c.HttpError(503, "飞书登录尚未配置");

      const store = await readStore();

      c.permit(authenticate(req, store), "manageUsers");

      const body = await readJsonBody(req);

      const employee = c.userById(store, body.userId);

      if (employee.roleCode === "owner") throw new c.HttpError(400, "老板账号已通过初始化绑定");

      if (employee.feishuOpenId) throw new c.HttpError(409, "该员工已绑定飞书账号，无需再次注册");

      const invite = randomBytes(24).toString("base64url");

      staffInvites.set(invite, { userId: employee.id, expiresAt: Date.now() + 30 * 60 * 1000 });

      sendJson(res, 200, {

        user: c.publicUser(employee),

        url: `${publicOrigin}/api/auth/feishu/start?invite=${invite}`,

        expiresInMinutes: 30,

      });

      return;

    }

    if (req.method === "POST" && path === "/api/auth/login") {

      sendJson(res, 200, await login(req, await readJsonBody(req)));

      return;

    }

    if (path.startsWith("/api/") && path!=="/api/me") {

      const initialStore = await authorizationStore(req);

      const viewer = authenticate(req, initialStore);

      if(!capacityEnabled)requestStore=initialStore;

      if(!companionAccess.allowed(viewer,path))throw new c.HttpError(403,"个人助理账号不能访问门店经营资料");
      if (assistantRoles.customer(viewer) && !assistantRoles.personalOnly(viewer) && path!=="/api/assistant/ask")
        throw new c.HttpError(403, "接待专用账号仅能使用顾客咨询");

    }

    if(req.method==="GET" && path==="/api/sales-list") {

      const viewer=authenticate(req,await authorizationStore(req));

      sendJson(res,200,capacityEnabled?await capacitySalesList.report(viewer,url.searchParams):salesList.report(await readStore(),viewer,salesList.filters(url.searchParams)));

      return;

    }

    if(req.method==="GET" && ["/api/sale-orders/page","/api/serials/lookup"].includes(path)) {

      const viewer=authenticate(req,await authorizationStore(req));

      if(capacityEnabled)sendJson(res,200,path==="/api/sale-orders/page"?await capacityQueries.salesPage(viewer,url.searchParams):await capacityQueries.serials(viewer,url.searchParams));

      else if(path==="/api/sale-orders/page")sendJson(res,200,{rows:erp.orders(await readStore(),viewer,url.searchParams.get("q")||""),nextCursor:null,limit:null});

      else throw new c.HttpError(404,"此串号接口尚未启用");

      return;

    }

    if (req.method === "POST" && ["/api/assistant/knowledge/upload-preview", "/api/assistant/knowledge/upload"].includes(path)) {

      const user = authenticate(req, requestStore || (await readStore()));

      c.permit(user, "manageUsers");

      const form = await readMultipartForm(req);

      if (form.files.length !== 1 || form.files[0].fieldName !== "file") throw new c.HttpError(400, "请每次选择一个学习资料文件");

      const file = form.files[0], prepared = knowledgeUpload.prepare(file);

      if (path.endsWith("upload-preview")) {

        sendJson(res, 200, knowledgeUpload.preview(await readStore(), user, prepared));

      } else {

        const result = await transaction(store => {

          const currentUser = authenticate(req, store);

          const saved = knowledgeUpload.apply(store, currentUser, prepared, form.fields);

          const fileSaved=saveKnowledgeFile(prepared.sha256, file.buffer);

          return capacityEnabled?Promise.resolve(fileSaved).then(()=>saved):saved;

        });

        sendJson(res, 200, result);

      }

      return;

    }

    if (

      req.method === "POST" &&

      path === "/api/opening-balance/preview-excel"

    ) {

      const user = authenticate(req, await readStore());

      c.permit(user, "opening");

      const form = await readMultipartForm(req);

      const file = form.files[0];

      if (!file) throw new c.HttpError(400, "请选择Excel文件");

      const rows = legacy.readOpeningBalanceRowsFromWorkbook(file.buffer);

      const preview = erp.openingPreview(await readStore(), user, rows);

      sendJson(res, 200, {

        ...preview,

        sourceRows: rows,

        source: file.fileName,

      });

      return;

    }

    if (req.method === "GET") {

      if (path === "/api/system/operations" || path === "/api/system/faults" || path === "/api/system/health-detail") {
        res.setHeader("Cache-Control", "private, no-store");
        const user = authenticate(req, await authorizationStore(req));
        const result = path === "/api/system/health-detail" ? {operations:await operationalHealth.status(user),asOf:c.now()} : path.endsWith("/operations") ? await opsStatus.status(user) : await opsFaults.list(user);
        sendJson(res, 200, result);
        return;
      }

      if (path === "/api/store-communication/events") {

        const user = authenticate(req, await authorizationStore(req));

        c.permit(user, "communicate");

        communicationEvents.subscribe(req, res, user.id, async () => {

          if(capacityEnabled) { req.erpSession=await authSessions.get(capacityAuth.token(req)); if(req.erpSession?.branchId!==capacityContext.current().branchId)throw new c.HttpError(401,"门店已切换，请重新连接"); }

          const current = authenticate(req, await authorizationStore(req));

          if (current.id !== user.id || current.status !== "active") throw new c.HttpError(401, "登录已变化");

          c.permit(current, "communicate");

        });

        return;

      }

      const store = requestStore || (await readStore());

      if(path==='/api/stocktake-photo/status'){sendJson(res,200,stocktakePhoto.status(store,authenticate(req,store),options.stocktakeVisionClient));return;}
      if(path==='/api/duties'){const client=options.stocktakeVisionClient||stocktakePhoto.defaultClient;sendJson(res,200,staffDuties.snapshot(store,authenticate(req,store),url.searchParams.get('date')||c.day(),client.configured()));return;}
      if(path==='/api/used-phones'){const client=options.stocktakeVisionClient||stocktakePhoto.defaultClient;sendJson(res,200,usedPhones.snapshot(store,authenticate(req,store),client.configured()));return;}
      if(path==='/api/store-communication/attachment'){
        const user=authenticate(req,store);c.permit(user,'communicate');const photo=storeCommunication.attachment(store,user,url.searchParams.get('messageId'),url.searchParams.get('attachmentId'));res.writeHead(200,{'Content-Type':photo.mime,'Content-Length':photo.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'});res.end(photo.bytes);return;
      }
      if(path==='/api/companion/library/photo'||path==='/api/companion/library/audio'){
        const info=(path.endsWith('/audio')?companionLibrary.audioFile:companionLibrary.photo)(store,authenticate(req,store),url.searchParams.get('id')),content=await readKnowledgeFile(info.hash);if(!content)throw new c.HttpError(404,'照片暂不可读，请稍后再试');const headers={'Content-Type':info.mime,'Content-Length':content.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
        if(info.mime.startsWith('audio/')){headers['Accept-Ranges']='bytes';const range=req.headers.range;if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start=m&&m[1]?Number(m[1]):0,end=m&&m[2]?Number(m[2]):content.length-1;if(m&&!m[1]&&m[2]){start=Math.max(0,content.length-Number(m[2]));end=content.length-1;}if(!m||(!m[1]&&!m[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=content.length||end<start){res.writeHead(416,{'Content-Range':'bytes */'+content.length,'Cache-Control':'private, no-store'});res.end();return;}end=Math.min(end,content.length-1);headers['Content-Range']='bytes '+start+'-'+end+'/'+content.length;headers['Content-Length']=end-start+1;res.writeHead(206,headers);res.end(content.subarray(start,end+1));return;}}
        res.writeHead(200,headers);res.end(content);return;
      }
      if(path==='/api/duties/photo'||path==='/api/used-phones/photo'){
        const user=authenticate(req,store),info=path==='/api/duties/photo'?staffDuties.photo(store,user,url.searchParams.get('id'),url.searchParams.get('submissionId')):usedPhones.photo(store,user,url.searchParams.get('id'),Number(url.searchParams.get('index')));
        const content=await readKnowledgeFile(info.hash);if(!content)throw new c.HttpError(404,'照片暂不可读，请联系负责人');
        res.writeHead(200,{'Content-Type':info.mime,'Content-Length':content.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(content);return;
      }
      if (path === "/api/assistant/knowledge/file") {

        c.permit(authenticate(req, store), "learn");

        const sha256 = url.searchParams.get("sha256");

        const record = (store.knowledgeUploads || []).find(row => row.sha256 === sha256);

        const original = record && await readKnowledgeFile(sha256);

        if (!original) throw new c.HttpError(404, "原文件不存在，请核对资料来源");

        res.writeHead(200, {

          "Content-Type": "application/octet-stream",

          "Content-Disposition": "attachment; filename=\"learning-material\"; filename*=UTF-8''" + encodeURIComponent(record.name).replace(/['()*]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase()),

          "Content-Length": original.length,

          "Cache-Control": "no-store",

          "X-Content-Type-Options": "nosniff",

        });

        res.end(original);

        return;

      }

      if (path === "/api/qr/label.svg") {

        const user = authenticate(req, store);

        qrProducts.permitPrint(user);

        const product = store.products.find((row) => row.skuId === url.searchParams.get("skuId"));

        if (!product) throw new c.HttpError(404, "商品不存在");

        const svg = await qrProducts.svg(product);

        res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });

        res.end(svg);

        return;

      }

      if(path==="/api/system/backups/download"){

        const content=storeBackups.download(store,authenticate(req,store),url.searchParams.get("id"));

        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Content-Disposition":'attachment; filename="'+url.searchParams.get("id")+'.json"',"Cache-Control":"no-store","Content-Length":Buffer.byteLength(content)});res.end(content);return;

      }

      if (path === "/api/supplier-statement/export") {

        const user = authenticate(req, store);

        const report = suppliers.statement(

          store,

          user,

          url.searchParams.get("id"),

          url.searchParams.get("from"),

          url.searchParams.get("to"),

        );

        const XLSX = require("xlsx");

        const workbook = XLSX.utils.book_new();

        const labels = {

          payable: "我待付",

          cash: "对方应退",

          advance: "预付货款",

          credit: "仅抵货款",

        };

        const sheets = [

          [

            "往来余额",

            [

              ["供应商", report.supplier.name],

              ["期间", report.from, report.to],

              ["类别", "期初", "期末"],

              ...Object.keys(labels).map((k) => [

                labels[k],

                report.opening[k],

                report.closing[k],

              ]),

            ],

          ],

          [

            "往来明细",

            [

              [

                "日期",

                "业务",

                "往来类型",

                "金额",

                "原款项",

                "对应款项",

                "备注",

              ],

              ...report.rows.map((r) => [

                r.date,

                r.type,

                r.kind || "",

                r.amount,

                r.sourceId || "",

                r.targetId || "",

                r.note,

              ]),

            ],

          ],

          [

            "实际收付",

            [

              ["日期", "类型", "金额", "账户", "交易备注"],

              ...report.cash.map((r) => [

                r.date,

                r.type === "payment" ? "付款" : "收退款",

                r.type === "payment" ? -r.amount : r.amount,

                r.account,

                r.note,

              ]),

            ],

          ],

        ];

        for (const [name, rows] of sheets) {

          const sheet = XLSX.utils.aoa_to_sheet(rows);

          sheet["!cols"] = rows[0].map(() => ({ wch: 24 }));

          XLSX.utils.book_append_sheet(workbook, sheet, name);

        }

        const buffer = XLSX.write(workbook, {

          bookType: "xlsx",

          type: "buffer",

        });

        res.writeHead(200, {

          "Content-Type":

            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

          "Content-Disposition":

            'attachment; filename="supplier-statement.xlsx"',

          "Cache-Control": "no-store",

          "Content-Length": buffer.length,

        });

        res.end(buffer);

        return;

      }

      sendJson(

        res,

        200,

        getResult(path, url.searchParams, store, authenticate(req, store)),

      );

      return;

    }

    if (req.method === "POST") {

      if(path.startsWith("/api/system/backups"))c.permit(authenticate(req,requestStore || await readStore()),"manageUsers");

      if(['/api/duties/submit','/api/used-phones/analyze','/api/used-phones/create'].includes(path)){
        const store=requestStore||await readStore(),user=authenticate(req,store);c.permit(user,path==='/api/duties/submit'?'communicate':'usedPhoneAssess');
        const body=await readJsonBody(req,path==='/api/duties/submit'?5*1024*1024:12*1024*1024),client=options.stocktakeVisionClient||stocktakePhoto.defaultClient;
        if(path==='/api/used-phones/analyze'){sendJson(res,200,await usedPhones.analyze(store,user,body,client));return;}
        const key=c.text(req.headers['idempotency-key'],'请求编号');if(key.length>160)throw new c.HttpError(400,'请求编号过长');const digest=createHash('sha256').update(JSON.stringify(body)).digest('hex');
        const replay=store.requestRecords.find(r=>r.userId===user.id&&r.path===path&&r.key===key);if(replay){if(replay.digest!==digest)throw new c.HttpError(409,'请求内容已变化，请重新提交');sendJson(res,200,replay.result);return;}
        let photos,analysis=null;
        if(path==='/api/duties/submit'){
          const prepared=staffDuties.prepareSubmit(store,user,body);photos=[stocktakePhoto.image(body.image)];analysis={available:false,message:'图片模型尚未接通，待负责人查看照片'};
          if(client.configured())try{analysis={available:true,...await client.checkCleanliness(photos[0].data,prepared.row.area)};}catch{analysis={available:false,message:'本次图片检查未完成，待负责人查看照片'};}
        }else photos=usedPhones.photos(body.images);
        const result=await transaction(fresh=>{
          const current=authenticate(req,fresh);c.permit(current,path==='/api/duties/submit'?'communicate':'usedPhoneAssess');
          const previous=fresh.requestRecords.find(r=>r.userId===current.id&&r.path===path&&r.key===key);if(previous){if(previous.digest!==digest)throw new c.HttpError(409,'请求内容已变化，请重新提交');return previous.result;}
          const result=path==='/api/duties/submit'?staffDuties.submit(fresh,current,body,photos[0],analysis):usedPhones.create(fresh,current,body,photos);
          const saved=photos.map(p=>saveKnowledgeFile(p.hash,p.bytes));fresh.requestRecords.push({key,userId:current.id,path,digest,result,createdAt:c.now()});
          const pending=saved.filter(value=>value&&typeof value.then==='function');return pending.length?Promise.all(pending).then(()=>result):result;
        });sendJson(res,200,result);return;
      }
      if(path==="/api/stocktake-photo/recognize"){
        const store=requestStore||await readStore(),user=authenticate(req,store);c.permit(user,"stocktake");
        const body=await readJsonBody(req,5*1024*1024);
        sendJson(res,200,await stocktakePhoto.recognize(store,user,body,options.stocktakeVisionClient));return;
      }
      const body = await readJsonBody(req,path.startsWith("/api/system/backups/")?50*1024*1024:path==='/api/companion/library/audio'?3*1024*1024:undefined);
      const workRequest = workRequestContext.getStore();
      if (workRequest) workRequest.body = body;
      const lockStore = requestStore || await readStore(), lockUser = authenticate(req, lockStore);
      workWritePermission(lockUser, path);
      assertWorkSession(lockStore, lockUser, path, body);

      if(path==='/api/used-phones/quote'){const store=requestStore||await readStore();c.permit(authenticate(req,store),'usedPhoneAssess');sendJson(res,200,usedPhones.quote(store,usedPhones.input(body)));return;}
      if(path==="/api/system/backups/preview"){const store=requestStore||await readStore();sendJson(res,200,storeBackups.preview(store,authenticate(req,store),body));return;}

      if(path==="/api/inventory/transfers/preview"){const store=requestStore||await readStore();sendJson(res,200,inventoryTransfers.preview(store,authenticate(req,store),body));return;}

      if (path === "/api/receptions") receptionBody = body;

      if (path === "/api/gifts/quote") {

        const store = requestStore || (await readStore());

        sendJson(res, 200, erp.quoteSaleGift(store, authenticate(req, store), body));

        return;

      }

      if(path==='/api/companion/library/photo/recognize'){
        const store=requestStore||await readStore(),user=authenticate(req,store);assistantRoles.permitPersonal(user);
        const key=c.text(req.headers['idempotency-key'],'请求编号');if(key.length>160)throw new c.HttpError(400,'请求编号过长');
        const old=companionVision.previous(store,user,body,key);if(old){sendJson(res,200,old);return;}
        const prepared=await companionVision.prepare(store,user,body,{client:options.companionVisionClient||companionVision.defaultClient,readFile:readKnowledgeFile});
        const result=await transaction(s=>companionVision.commit(s,authenticate(req,s),body,prepared,key));sendJson(res,200,result);return;
      }
      if(path==='/api/companion/library/photo'||path==='/api/companion/library/audio'){
        const user=authenticate(req,requestStore||await readStore());assistantRoles.permitPersonal(user);const photo=path.endsWith('/audio')?companionLibrary.audio(body.data):stocktakePhoto.image(body.image),key=c.text(req.headers['idempotency-key'],'请求编号');if(key.length>160)throw new c.HttpError(400,'请求编号过长');
        const digest=require('node:crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex');
        const result=await transaction(s=>{const current=authenticate(req,s),old=(s.requestRecords||[]).find(r=>r.userId===current.id&&r.path===path&&r.key===key);if(old){if(old.digest!==digest)throw new c.HttpError(409,'照片已变化，请重新提交');return old.result;}const result=(path.endsWith('/audio')?companionLibrary.saveAudio:companionLibrary.savePhoto)(s,current,body,photo);const fileSaved=!result.alreadySaved?saveKnowledgeFile(photo.hash,photo.bytes):null;(s.requestRecords||=[]).push({key,userId:current.id,path,digest,result,createdAt:c.now()});return capacityEnabled?Promise.resolve(fileSaved).then(()=>result):result;});sendJson(res,200,result);return;
      }
      if(path==='/api/companion/family/invite'){
        const service=options.companionFamilyService||companionFamily.defaultService;
        const result=await transaction(s=>service.invite(s,authenticate(req,s),body,capacityContext.current()));
        sendJson(res,200,result);return;
      }
      if(path==='/api/companion/location/gps'){
        const store=requestStore||await readStore(),user=authenticate(req,store);assistantRoles.permitPersonal(user);
        if(!Number.isInteger(body.version)||body.version!==companionLocation.version(store,user))throw new c.HttpError(409,'位置已经更新，请刷新后重试');
        const coords=companionLocation.coordinates(body),client=options.companionLocationClient||companionLocation.defaultClient;
        const previous=companionLocation.location(store,user);
        if(previous?.queriedAt&&Date.now()-Date.parse(previous.queriedAt)<10000)throw new c.HttpError(429,'刚刚已定位，请稍后再试');
        const value=await client.reverse(coords);
        const result=await transaction(current=>companionLocation.save(current,authenticate(req,current),body,value));
        sendJson(res,200,result);return;
      }
      if(path==="/api/companion/memory/preview"){const store=requestStore||await readStore();sendJson(res,200,companionMemoryTools.preview(store,authenticate(req,store),body));return;}
      if (path === "/api/companion/chat") {

        const store=requestStore||await readStore(),user=authenticate(req,store);assistantRoles.permitPersonal(user);

        const question=c.text(body.question,"消息"),key=c.text(req.headers["idempotency-key"],"请求编号");

        if(key.length>160)throw new c.HttpError(400,"请求编号过长");

        const previous=companionChat.previous(store,user,question,key);
        if(previous){sendJson(res,200,previous);return;}
        const metered=companionBilling.metered({base:options.companionModelClient||companionChat.client,user,key,mutate:fn=>transaction(current=>fn(current,authenticate(req,current)))});
        let response;
        try{response=await companionChat.prepare(store,user,{question},{scope:capacityContext.current(),client:options.assistantChatClient,companionModelClient:metered,liveQuery:options.liveQuery});}
        catch(error){if(![402,503].includes(error.statusCode))throw error;response={answer:error.message,sources:[],channel:'life',modelConnected:false,metrics:{kind:'personal-usage-limit'}};}
        const billing=typeof metered.billingMetadata==="function"?metered.billingMetadata():null;
        if(billing)response={...response,billing};
        const result=await transaction(current=>companionChat.commit(current,authenticate(req,current),question,response,key));

        sendJson(res,200,result);return;

      }

      if (path === "/api/assistant/ask") {

        const store = requestStore || (await readStore());

        sendJson(res, 200, await assistantChat.ask(store, authenticate(req, store), body, {client:options.assistantChatClient,scope:capacityContext.current(),companionModelClient:options.companionModelClient,liveQuery:options.liveQuery}));

        return;

      }

      if (path === "/api/copilot/sales-review") {

        const store = requestStore || (await readStore());

        sendJson(res, 200, copilot.reviewSale(store, authenticate(req, store), body));

        return;

      }

      if (path === "/api/purchase-price-corrections/preview") {
        const store = requestStore || (await readStore());
        sendJson(res, 200, purchasePriceCorrections.preview(store, authenticate(req, store), body));
        return;
      }

      if (path === "/api/supplier-prices/preview") {

        const store = requestStore || (await readStore());

        sendJson(

          res,

          200,

          supplierCosts.preview(store, authenticate(req, store), body),

        );

        return;

      }

      if (path === "/api/purchase-returns/preview") {

        const store = requestStore || (await readStore());

        sendJson(

          res,

          200,

          supplierCosts.previewReturn(store, authenticate(req, store), body),

        );

        return;

      }

      const result = await mutate(req, path, body);
      if(path==="/api/companion/accounts/status")await authSessions.revokeUser(result.id);

      // Wake viewers only after the transaction committed; the event carries no message text.

      if (path.startsWith("/api/store-communication/"))

        communicationEvents.changed(path, result, authenticate(req, requestStore || {users:[req.erpSession.user]}).id);

      sendJson(res, 200, result);

      if (options.onMutation)

        Promise.resolve().then(() => options.onMutation(path)).catch((error) =>

          console.error("附加同步失败：", error.message),

        );

      return;

    }

    throw new c.HttpError(405, "请求方式不支持");

  } catch (error) {

    const faultId = opsFaults.record({path:String(req.url||"").split("?")[0],method:req.method}, error, error.statusCode || 500);
    // The failed business transaction has rolled back. Persist a separate, masked attempt.

    let attempt = null;

    if (receptionBody !== null && error.code !== "ATTENDANCE_CHECKED_OUT") {

      try {

        attempt = await transaction((store) => receptionAttempts.failed(

          store, authenticate(req, store), receptionBody,

          req.headers['idempotency-key'], error,

        ));

      } catch (logError) {

        console.error('接待单失败记录写入失败：', logError.message);

      }

    }

    sendJson(res, error.statusCode || 500, {

      ...(error.code === "ATTENDANCE_CHECKED_OUT" ? { code: error.code, workLock: error.workLock } : {}),
      error: {

        message: error.statusCode

          ? error.message

          : "服务器处理失败，请稍后重试",

        ...(error.code === "ATTENDANCE_CHECKED_OUT" ? { code: error.code, workLock: error.workLock } : {}),
        ...(attempt ? { attemptId: attempt.id } : {}),
        ...(faultId ? { faultId } : {}),

      },

    });

    if (!error.statusCode) console.error(error);

  }

}

function createServer(options = {}) {

  return http.createServer((req, res) => {

    const work=()=>workRequestContext.run({req,path:new URL(req.url,"http://localhost").pathname,body:null},()=>documentNumbers.run(()=>systemModelUsage.run({},()=>handle(req,res,options))));

    const result=capacityEnabled?capacityAuth.request(req,work):work();

    Promise.resolve(result).catch(error=>{const faultId=opsFaults.record({path:String(req.url||"").split("?")[0],method:req.method},error,503);if(!res.headersSent)sendJson(res,503,{error:{message:"数据库连接暂不可用，请稍后重试",faultId}});else res.end();});

  });

}

module.exports = { createServer };













