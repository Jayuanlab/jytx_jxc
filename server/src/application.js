const http = require("http");

const fs = require("fs");
const { serveStaticAsset } = require("./static-assets");

const pathModule = require("path");

const { randomBytes, createHash } = require("crypto");

const { readStore, transaction: repositoryTransaction, saveKnowledgeFile, readKnowledgeFile } = require("./repository");
const {readSessionStore}=require("./session-read");
const { AsyncLocalStorage } = require("node:async_hooks");
const workRequestContext = new AsyncLocalStorage();

const { sendJson, readJsonBody, readMultipartForm } = require("./http");

const c = require("./common");
const documentNumbers = require("./document-numbers");

const erp = require("./erp");
const saleReceipt=require("./sale-receipt");
const paymentReceipt=require("./payment-receipt");

const salesList = require("./sales-list");

const capacitySalesList = process.env.STORE_ENGINE === "postgres" ? require("./capacity/sales-list") : null;

const warehouses = require("./warehouses");
const productCategories = require("./product-categories");
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
const receiptReconciliation = require('./receipt-reconciliation');
const paymentRequests = require("./payment-requests");
const normalWorkflow=require('./normal-workflow'),businessReconciliation=require('./business-reconciliation'),moneyVerifications=require('./money-verifications'),inventoryLossCases=require('./inventory-loss-cases'),normalPayments=require('./normal-payment-registration');

const productPricing = require("./product-pricing");

const inventoryDetails = require("./inventory-details");
const serialSourceCorrections=require('./serial-source-corrections');
const openingStockAppend=require('./opening-stock-append');
const batchPhoneIntake=require('./batch-phone-intake');
const openingQuantityAppend=require('./opening-quantity-append');

const stocktakeSheets = require("./stocktake-sheets");

const vocabulary = require("./search-vocabulary");

const closeouts = require("./closeouts");

const dailyClose = require("./daily-close");
const airAccounts=require("./air-accounts");
const airFundingOrders=require("./air-funding-orders");
const storeWalletFunding=require("./store-wallet-funding-requests");
const airHistory = require("./air-history-service");
const airApprovals = require("./air-history-approvals");
const airOpeningDrafts = require("./air-opening-drafts");
const openingImportDrafts = require("./opening-import-drafts");
const bossBatch = require("./boss-batch");
const bossOverview = require("./boss-overview");
const airPending = require("./air-history-pending");
const personnel = require("./personnel");
const assistantUnresolved = require("./assistant-unresolved");

const cashHandovers = require("./cash-handovers");
const mobileCoinClaims=require("./mobile-coin-claims");
const mobileActivitySales=require("./mobile-activity-sales");
const businessChangeReturns=require("./business-change-returns");
const supplierOutboundTracking=require("./supplier-outbound-tracking");
const supplierExchanges=require("./supplier-exchanges");

const salePayments = require("./sale-payments");
const saleFundResponsibility=require("./sale-fund-responsibility");
const paymentAccounts = require("./payment-accounts");

const fundsNetwork = require("./funds-network");
const masterData=require("./master-data");

const guardian = require("./guardian");

const qrProducts = require("./qr-products");
const repairFilms = require("./film-catalog");

const carrierRentals = require("./carrier-rentals");
const mobileCardBundles = require("./mobile-card-bundles");
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
const staffRoster = require("./staff-roster");
const attendanceReport = require("./attendance-report");

const assistantChat = require("./assistant-chat");

const stocktakePhoto=require("./stocktake-photo"),companionLibrary=require("./companion-library"),companionVision=require("./companion-vision");
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

async function newSession(user) { const policy=require("./attendance-access");policy.assertClock(user,c.now(),policy.restricted(user)?await readSessionStore():null);return authSessions.issue(user.id); }

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

async function authorizationStore(req){if(capacityEnabled&&req.erpSession&&require("./attendance-access").restricted(req.erpSession.user))return readSessionStore();return capacityEnabled?{users:req.erpSession?[req.erpSession.user]:[]}:await readStore();}

function authenticate(req, store) {

  const token = String(req.headers.authorization || "").replace(/^Bearer /, "") || cookie(req, "erp_session");

  const session = capacityEnabled ? req.erpSession : authSessions.get(token);

  if (!session || session.expiresAt <= Date.now())

    throw new c.HttpError(401, "登录已失效，请重新登录");

  if(require('./attendance-session-cutoff').revoked(session,store.attendanceSessionCutoffs))throw new c.HttpError(401,'已签退，请重新登录');
  systemModelUsage.identify(session.userId);
  const currentUser=c.userById(store, session.userId);require("./attendance-access").assertClock(currentUser,c.now(),store);return currentUser;

}

// Attendance is shared server state; no token, payload actor or local preference can unlock it.
function workLock(store, user) { return require("./attendance-access").state(store,user); }
const workSessionAccess = new Set([
  "/api/personnel/leaves", "/api/personnel/leaves/decide", "/api/personnel/schedule", "/api/auth/login", "/api/auth/local/login", "/api/auth/logout", "/api/auth/local/self-set",
  "/api/store-communication/send", "/api/store-communication/read", "/api/store-communication/ack",
  "/api/store-communication/clear", "/api/store-communication/withdraw", "/api/store-communication/local-save"
]);
function workSessionAllowed(path, body) {
  return workSessionAccess.has(path) || (path === "/api/assistant/attendance" && ["checkin", "fieldwork-start"].includes(body?.action));
}
function assertWorkSession(store, user, path, body) {
  if (workSessionAllowed(path, body)) return;
  require("./attendance-access").assertActive(store,user);
}
function workWritePermission(user, path) {
  if(path.startsWith("/api/statement-comparisons")){c.permit(user,"finance");return;}
  if (actions[path]) c.permit(user, actions[path][0]);
  else if (["/api/auth/local/admin-set", "/api/users/invite", "/api/organization/branches", "/api/organization/grants",
      "/api/assistant/knowledge/vectorize"].includes(path) || path.startsWith("/api/system/backups")) c.permit(user, "manageUsers");
  else if(["/api/assistant/knowledge/upload", "/api/assistant/knowledge/upload-preview"].includes(path)) c.permit(user,"knowledgeSubmit");
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
    case '/api/sale-opening':
      c.permit(user, 'sell');
      return {
        inventory: getResult('/api/inventory', query, store, user),
        products: getResult('/api/products', query, store, user),
        users: getResult('/api/users', query, store, user),
        receptions: { rows: getResult('/api/receptions', query, store, user).rows.filter(row=>row.status!=='已结案'&&!row.publicAssist) },
        searchMeta: getResult('/api/search', new URLSearchParams('scope=meta'), store, user),
        warehouses: getResult('/api/warehouses', query, store, user),
      };
    case '/api/sale-fund-responsibility': return saleFundResponsibility.list(store,user,query);
    case '/api/normal-workflow': return normalWorkflow.dashboard(store,user);
    case '/api/business-reconciliation': return businessReconciliation.list(store,user,query);
    case '/api/money-verifications': return moneyVerifications.list(store,user,query);
    case '/api/inventory-loss-cases': return inventoryLossCases.list(store,user,query);
    case '/api/normal-payments': return normalPayments.list(store,user,query);

    case "/api/document-numbers/lookup": return documentNumbers.lookup(store,user,query.get("q"));

    case "/api/store-communication":

      return storeCommunication.list(store,user,query.get("peer")||"all",query.get("before")||"",query.get("history")==="1",query.get("withdrawAfter")||"0");

    case "/api/pending-urges":
      c.permit(user,"communicate");
      return require('./pending-urges').list(store,user);

    case "/api/store-communication/summary":

      return storeCommunication.summary(store,user);

    case "/api/store-communication/local-status":

      return storeCommunication.localStatus(store,user,query.get("messageId"));

    case "/api/store-communication/assessment":

      return storeCommunication.assessment(store,user,query);

    case "/api/store-communication/assessment-settings":

      return storeCommunication.assessmentSettings(store,user);

    case "/api/batch-phone-intake/options": return batchPhoneIntake.options(store,user);
    case "/api/inventory/transfers": return inventoryTransfers.list(store,user);
    case "/api/inventory/source-corrections": return serialSourceCorrections.get(store,user,{serialNo:query.get('serialNo')});

    case "/api/local-notices":

      return localNotices.list(store, user,query);

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

    case "/api/work-journal/references":{
      const kind=query.get('kind');if(!['sale','reception'].includes(kind))throw new c.HttpError(400,'请选择关联类型');
      const rows=kind==='sale'?getResult('/api/sale-orders',new URLSearchParams(),store,user):getResult('/api/receptions',new URLSearchParams(),store,user).rows.filter(row=>!row.publicAssist);
      return rows.map(row=>({id:row.id,displayNo:row.displayNo||row.number||row.id,label:(row.displayNo||row.number||row.id)+' · '+(kind==='sale'?(row.items||[]).map(i=>i.name).join('、'):row.purpose||'')}));
    }
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

    case "/api/personnel":
      return personnel.list(store,user);

    case "/api/workbench":

      return airFundingOrders.workbench(store,user,airPending.workbench(store, user, workbench.summary(store, user)));

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

      return qrProducts.resolve(store, query.get("code"), {skuId:query.get("skuId")||undefined,warehouseId:query.get("warehouseId")||undefined});

    case "/api/products":

      return erp.listProducts(store, user, {catalog:query.get("view")==="catalog"}).map(row=>query.get("view")==="picker"?require("./entry-read-profiles").compact(row):row);

    case "/api/warehouses":

      return warehouses.WAREHOUSES;

    case "/api/stocktake-catalog":

      return stocktakeSheets.catalog(store,user);

    case "/api/stocktake-sheets":

      return stocktakeSheets.list(store,user);

    case "/api/serial-stocktakes":

      return inventoryDetails.listCounts(store, user);

    case "/api/inventory":

      return erp.currentInventory(store, user).filter(row=>query.get("view")!=="materials"||row.stockManaged!==false&&!row.trackSerial&&Number(row.quantity)>0).map(row=>query.get("view")==="materials"?{...require("./entry-read-profiles").compact(row),serials:[]}:row);

    case "/api/product-category-paths":
      return productCategories.list(store, user);

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

      return require('./document-query').purchaseRows(store,user,query);

    case "/api/suppliers/directory":

      return suppliers.directory(store, user);

    case "/api/suppliers":

      return suppliers.list(store, user, query.get("q") || "");

    case "/api/supplier-detail":

      return suppliers.detail(store, user, query.get("id"));

    case "/api/opening-purchase-return-candidates": return require("./opening-purchase-returns").candidates(store,user);
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

      return require('./document-query').planRows(store,user,query);

    case "/api/accounting-model": { const model=require("./store-accounting-model");return {model:model.model(user),accounting:model.accounting(store,user,query.get("date")||c.day())}; }
    case "/api/system-check": {

      c.permit(user, "manageUsers");

      const inStockSkuIds = new Set(store.inventory.filter((row) => Number(row.quantity) > 0).map((row) => row.skuId));
      return { checkedAt: c.now(), findings: guardian.inspect(store), receptionReview:guardian.receptionReview(store), stats: { products: store.products.length, inStockModels: store.products.filter((p) => inStockSkuIds.has(p.skuId)).length, zeroStockProducts: store.products.filter((p) => !inStockSkuIds.has(p.skuId)).length, inventoryUnits: store.inventory.reduce((n, x) => n + x.quantity, 0), serials: store.inventory.reduce((n, x) => n + (x.serials || []).length, 0), sales: store.sales.length, suppliers: store.suppliers.length, testProducts: store.products.filter((x) => x.testData).length } };
    }

    case "/api/boss-work": return require("./boss-work").list(store,user,query);
    case "/api/display-preferences": return require("./display-preferences").list(store,user,query);
    case "/api/master-data-requests": return {rows:require("./master-data-requests").list(store,user)};
    case "/api/batch-review": return require("./batch-review").list(store,user);
    case "/api/master-data": return masterData.summary(store,user);
    case "/api/funds-ledgers": return require("./shared-finance").ledgers(store,user,query);
    case "/api/my-finance": return require("./my-finance").report(store,user,query);
    case "/api/finance-batch": return require("./finance-batch").preview(store,user);
    case "/api/finance-processing": return require("./shared-finance").processing(store,user);
    case "/api/funds-network":

      return require("./shared-finance").network(store, user);

    case "/api/payment-accounts":
      return paymentAccounts.list(store,user);
    case "/api/store-transfers":
      return require("./store-transfer").list(store,user,query);
    case "/api/wallet-cash-exchanges":
      return require('./wallet-cash-exchanges').list(store,user,query);

    case "/api/sale-payments":

      return saleFundResponsibility.decoratePayments(store,salePayments.list(store, user));

    case "/api/mobile-coin-claims": return mobileCoinClaims.list(store,user,query);
    case "/api/mobile-activity-sales": return mobileActivitySales.list(store,user,query);
    case "/api/mobile-activity-sales/options": return mobileActivitySales.options(store,user);
    case "/api/business-change-returns": return businessChangeReturns.list(store,user,query);
    case "/api/business-change-returns/options": return businessChangeReturns.options(store,user);
    case "/api/supplier-exchanges": return supplierExchanges.list(store,user,query);
    case "/api/supplier-exchanges/options": return supplierExchanges.options(store,user);
    case "/api/supplier-outbound-tracking": return supplierOutboundTracking.list(store,user,query);
    case "/api/supplier-outbound-tracking/options": return supplierOutboundTracking.options(store,user);
    case "/api/cash-handovers":

      return cashHandovers.list(store, user);

    case "/api/cash-handover-recipients":

      return cashHandovers.recipients(store, user);

    case "/api/boss-batch":
      return bossBatch.list(store,user);

    case "/api/boss-overview":
      return airFundingOrders.overview(store,user,airPending.overview(store, user, bossOverview.summary(store,user)));

    case "/api/opening-import-drafts":
      return openingImportDrafts.list(store,user);

    case "/api/air-opening-drafts":
      return airOpeningDrafts.list(store,user);

    case "/api/procurement-plans/payment-documents": return require("./procurement-payment-documents").list(store,user,query);
    case "/api/document-center": return require("./document-center").list(store,user);
    case "/api/store-wallet-funding-requests": return storeWalletFunding.list(store,user,Object.fromEntries(query));
    case "/api/air-funding-orders": return airFundingOrders.list(store,user,Object.fromEntries(query));
    case "/api/air-accounts": return airAccounts.statement(store,user,Object.fromEntries(query));
    case "/api/air-recharge/balance":

      return airHistory.balance(store, user);

    case "/api/air-recharge/history":
      return airHistory.list(store, user);

    case "/api/air-recharge/history/drafts":
      return airApprovals.list(store, user);

    case "/api/air-recharge/cash-sales":

      return dailyClose.airCashSales(store, user);

    case "/api/air-recharge":

      return dailyClose.airList(store, user);

    case "/api/daily-closeouts":

      return dailyClose.list(store, user, {id:query.get('closeout')||'',limit:query.get('all')==='1'?0:20}).map(row=>query.get('summary')==='1'&&!query.get('closeout')?require('./entry-read-profiles').closeSummary(row):row);

    case "/api/daily-closeouts/simple-preview": return require('./simple-daily-close').preview(store,user);
    case "/api/daily-closeouts/simple": return require('./simple-daily-close').list(store,user,{date:query.get('date')});
    case "/api/pending-special": return require('./pending-special').list(store,user);

    case "/api/attendance/night-access": return require("./attendance-access").listGrants(store,user);
    case "/api/assistant-finance": return require("./assistant-finance").build(store,user,query.get("date")||c.day());
    case "/api/daily-cash-receipts":
      return require("./daily-cash-receipts").list(store, user, query);

    case "/api/daily-closeouts/preview":

      return dailyClose.preview(store, user, query.get("date") || c.day());

    case "/api/closeouts":

      return closeouts.closeouts(store, user, query);

    case "/api/closeouts/preview":

      return closeouts.snapshot(store, user, query.get("cashierId"));

    case "/api/document-query": return require("./document-query-center").query(store,user,query);
    case "/api/search":

      return search.search(store, user, query);

    case "/api/product-price-changes":

      return productPricing.list(store, user);

    case "/api/payment-requests": return paymentRequests.visible(store,user);

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

      return erp.orders(store, user, query.get("q") || "").filter(order=>query.get("view")!=="repair"||order.repairContext?.kind==="repair"||(order.items||[]).some(item=>item.type==="维修"&&item.stockManaged===false));

    case "/api/dashboard":

    case "/api/reports":

    case "/api/daily-report":

      return erp.report(store, user, query.get("date") || c.day());

    case "/api/finance":
      return require('./finance-query').list(store,user,query);

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

    case "/api/carrier-product-commission": return require("./carrier-product-commission").catalog(store,user);
    case "/api/carrier-commission-rules": return require("./carrier-commission-rules").list(store,user);
    case "/api/carrier-services":

      return carrierRentals.list(store, user);
    case "/api/mobile-card-bundles":
      return mobileCardBundles.list(store,user);

    case "/api/card-businesses":

      return erp.cards(store, user);

    case "/api/opening-balance/template":

      c.permit(user, "sell");

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

      {const q=String(query.get('q')||'').trim().toLowerCase(),from=query.get('from')||'',to=query.get('to')||'';
       if(!q&&!from&&!to)return store.operationLogs;
       return store.operationLogs.filter(row=>{const day=String(row.createdAt||'').slice(0,10);return (!from||day>=from)&&(!to||day<=to)&&(!q||[row.operator,row.action,typeof row.detail==='string'?row.detail:JSON.stringify(row.detail||{})].join(' ').toLowerCase().includes(q));});}

    default:

      throw new c.HttpError(404, "接口不存在");

  }

}

const actions = {
  "/api/attendance/night-access/decide":["manageUsers",(store,user,body)=>require("./attendance-access").decide(store,user,body)],
  "/api/master-data/job-titles": ["manageUsers",require("./staff-rename").saveTitles],
  "/api/users/rename": ["manageUsers",require("./staff-rename").rename],
  "/api/product-category-paths/delete": ["manageUsers",require("./category-empty-delete").remove],
  "/api/batch-review/decide": ["learn",(store,user,payload)=>require("./batch-dispatch").execute(store,user,payload,{actions,assertWorkSession})],
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

  "/api/work-journal": ["learn", workJournal.create],

  "/api/work-journal/review": ["manageUsers", workJournal.review],

  "/api/assistant/attendance": ["learn", personalAssistant.attendance],
  "/api/personnel/schedule": ["learn", staffRoster.save],

  "/api/personnel/leaves": ["learn", personnel.submit],
  "/api/personnel/leaves/decide": ["learn", personnel.decide],
  "/api/personnel/assign": ["manageUsers", personnel.assignment],

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
  "/api/store-communication/urge": ["communicate", require('./pending-urges').urge],

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
  "/api/local-notices/inquire": ["manageUsers", localNotices.inquire],

  "/api/product-category-paths": ["catalogAdd", productCategories.add],
  "/api/products": ["catalogAdd", erp.saveProduct],
  "/api/boss-work": ["manageUsers",require("./boss-work").create],
  "/api/boss-work/change": ["learn",require("./boss-work").change],
  "/api/display-preferences": ["learn",require("./display-preferences").save],
  "/api/master-data/parties": ["catalogAdd",masterData.saveParty],
  "/api/master-data/warehouses": ["catalogAdd",require("./warehouse-directory").save],

  "/api/product-price-changes": ["manageProducts", productPricing.request],

  "/api/product-price-changes/review": ["manageUsers", productPricing.review],

  "/api/search/synonyms": ["manageProducts", vocabulary.saveGroup],

  "/api/search/synonyms/delete": ["manageProducts", vocabulary.deleteGroup],

  "/api/purchase-orders": ["purchase", erp.purchase],
  "/api/inventory/transfers": ["purchase", inventoryTransfers.create],
  "/api/inventory/source-corrections": ["manageUsers", serialSourceCorrections.confirm],
  "/api/batch-phone-intake/commit": ["purchase", batchPhoneIntake.commit],
  "/api/inventory/opening-append": ["manageUsers", openingStockAppend.confirm],
  "/api/inventory/opening-quantity-append": ["manageUsers", openingQuantityAppend.confirm],
  "/api/purchase-price-corrections": ["manageUsers", purchasePriceCorrections.confirm],

  "/api/sale-orders": ["sell", (store,user,payload)=>{ repairFilms.validateSale(store,user,payload); return erp.sale(store,user,payload); }],

  "/api/payment-accounts": ["createPaymentAccounts", paymentAccounts.save],

  "/api/sale-payments/declare-paid": ["sell", salePayments.declarePaid],
  "/api/sale-payments/boss-received": ["manageUsers", salePayments.bossReceived],

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

  '/api/business-reconciliation/decide':['manageUsers',businessReconciliation.decide],
  '/api/business-reconciliation/instruct':['manageUsers',businessReconciliation.instruct],
  '/api/business-reconciliation/inquiry/ask':['manageUsers',(store,user,payload)=>require('./business-inquiry').ask(store,user,payload)],
  '/api/business-reconciliation/inquiry/answer':['communicate',(store,user,payload)=>require('./business-inquiry').answer(store,user,payload)],
  '/api/business-reconciliation/refresh':['learn',businessReconciliation.refresh],
  '/api/sale-fund-responsibility/handover-allocation':['manageUsers',saleFundResponsibility.commit],
  '/api/sale-fund-responsibility/actual-receipt':['manageUsers',saleFundResponsibility.receiptConfirm],
  '/api/sale-fund-responsibility/correct-cash-source':['manageUsers',(s,u,p)=>require('./owner-direct-cash').correct(s,u,p)],
  '/api/money-verifications/confirm':['learn',moneyVerifications.confirm],
  '/api/inventory-loss-cases/action':['stocktake',inventoryLossCases.act],
  '/api/normal-payments':['paymentRegister',normalPayments.create],
  '/api/normal-payments/supplier':['paymentRegister',normalPayments.supplierPayment],
  '/api/normal-payments/request':['paymentRegister',normalPayments.request],
  '/api/normal-payments/execute-request':['paymentRegister',normalPayments.executeRequest],
  "/api/financial-documents": ["learn", financialDocuments.create],
  "/api/financial-documents/reconcile": ["manageUsers", receiptReconciliation.reconcile],
  "/api/finance-batch/decide": ["manageUsers",require("./finance-batch").decide],
  "/api/daily-closeouts/withdraw": ["sell",require("./daily-close-withdrawal").withdraw],
  "/api/financial-documents/return": ["manageUsers",require('./receipt-revisions').returnReceipt],
  "/api/financial-documents/revise": ["receiptRegister",require('./receipt-revisions').revise],
  "/api/payment-requests": ["sell", paymentRequests.submit],
  "/api/payment-requests/decide": ["manageUsers", paymentRequests.decide],

  "/api/closeouts": ["sell", closeouts.submit],

  "/api/mobile-coin-claims/preview": ["finance", mobileCoinClaims.preview],
  "/api/mobile-coin-claims": ["finance", mobileCoinClaims.create],
  "/api/mobile-coin-claims/receive": ["finance", mobileCoinClaims.receive],
  "/api/mobile-activity-sales": ["sell", mobileActivitySales.create],
  "/api/mobile-activity-sales/preview": ["sell", mobileActivitySales.preview],
  "/api/mobile-activity-sales/topup-confirm": ["finance", mobileActivitySales.confirmTopup],
  "/api/mobile-activity-sales/hebao-confirm": ["finance", mobileActivitySales.confirmHebao],
  "/api/mobile-activity-sales/businesses": ["catalogAdd", mobileActivitySales.addBusiness],
  "/api/mobile-activity-sales/setup-hebao": ["manageUsers", mobileActivitySales.setupHebao],
  "/api/mobile-activity-sales/rate": ["managePay", mobileActivitySales.saveRate],
  "/api/business-change-returns": ["sell", businessChangeReturns.create],
  "/api/business-change-returns/submit": ["sell", businessChangeReturns.submit],
  "/api/business-change-returns/review": ["manageUsers", businessChangeReturns.review],
  "/api/business-change-returns/refund": ["sell", businessChangeReturns.refund],
  "/api/business-change-returns/receive": ["manageUsers", businessChangeReturns.receive],
  "/api/business-change-returns/withhold-tax": ["manageUsers", businessChangeReturns.withholdTax],
  "/api/business-change-returns/tax-pay": ["manageUsers", businessChangeReturns.taxPay],
  "/api/business-change-returns/settle-boss-advance": ["manageUsers", businessChangeReturns.settleBossAdvance],
  "/api/supplier-exchanges": ["purchase",supplierExchanges.create],
  "/api/supplier-exchanges/review": ["manageUsers",supplierExchanges.review],
  "/api/supplier-exchanges/cancel": ["purchase",supplierExchanges.cancel],
  "/api/supplier-exchanges/handoff": ["purchase",supplierExchanges.handoff],
  "/api/supplier-exchanges/receipt": ["purchase",supplierExchanges.receipt],
  "/api/supplier-exchanges/settle": ["supplierSettle",supplierExchanges.settle],
  "/api/supplier-exchanges/followup": ["purchase",supplierExchanges.followup],
  "/api/supplier-outbound-tracking": ["purchase", supplierOutboundTracking.create],
  "/api/supplier-outbound-tracking/review": ["manageUsers", supplierOutboundTracking.review],
  "/api/supplier-outbound-tracking/confirm-due": ["purchase", supplierOutboundTracking.confirmDue],
  "/api/supplier-outbound-tracking/handoff": ["purchase", supplierOutboundTracking.handoff],
  "/api/supplier-outbound-tracking/receive-cash": ["paymentRegister", supplierOutboundTracking.receiveCash],
  "/api/supplier-outbound-tracking/receive-goods": ["purchase", supplierOutboundTracking.receiveGoods],
  "/api/supplier-outbound-tracking/followup": ["purchase", supplierOutboundTracking.followup],
  "/api/daily-closeouts": ["sell", dailyClose.submit],
  "/api/daily-closeouts/simple": ["sell", require('./simple-daily-close').submit],
  "/api/daily-closeouts/simple/check": ["sell", require('./simple-daily-close').check],
  "/api/daily-closeouts/simple/review": ["sell", require('./simple-daily-close').review],
  "/api/daily-closeouts/simple/seen": ["manageUsers", require('./simple-daily-close').markSeen],
  "/api/pending-special/preview": ["manageUsers", require('./pending-special').preview],
  "/api/pending-special/commit": ["manageUsers", require('./pending-special').commit],

  "/api/boss-batch/decide": ["manageUsers", bossBatch.decide],

  "/api/opening-import-drafts": ["sell", openingImportDrafts.action],

  "/api/air-opening-drafts": ["sell", (store, user, payload) => { if (payload.action === "decide" && payload.approve === false) return airOpeningDrafts.action(store, user, payload); if ((store.airRechargeEvents || []).length) throw new c.HttpError(409, "期初已经存在，请刷新后开充值单；历史单据仍按原审批处理"); if ((store.airHistoryDrafts || []).some(row => ["待店长初审", "待老板终审"].includes(row.status))) throw new c.HttpError(409, "已有待审空充资料，请先处理原申请"); return airOpeningDrafts.action(store, user, payload); }],

  "/api/air-recharge": ["finance", (store, user, payload) => { if (payload.kind === "opening") throw new c.HttpError(409, "空充期初须在 /air-history 经店长初审、老板终审"); return dailyClose.airEntry(store, user, payload); }],

  "/api/air-recharge/funding": ["finance", airFundingOrders.directDisabled],
  "/api/store-wallet-funding-requests": ["sell",storeWalletFunding.create],
  "/api/store-wallet-funding-requests/pay": ["manageUsers",storeWalletFunding.pay],
  "/api/store-wallet-funding-requests/reject": ["manageUsers",storeWalletFunding.reject],
  "/api/store-wallet-funding-requests/remind": ["manageUsers",storeWalletFunding.remind],
  "/api/store-wallet-funding-requests/confirm": ["sell",storeWalletFunding.confirm],
  "/api/store-wallet-funding-requests/cancel": ["sell",storeWalletFunding.cancel],
  "/api/air-funding-orders": ["sell",airFundingOrders.create],
  "/api/air-funding-orders/pay": ["manageUsers",airFundingOrders.pay],
  "/api/air-funding-orders/confirm": ["sell",airFundingOrders.confirm],
  "/api/air-funding-orders/assign": ["manageUsers",airFundingOrders.assign],
  "/api/air-funding-orders/cancel": ["sell",airFundingOrders.cancel],
  "/api/air-funding-orders/remind": ["manageUsers",airFundingOrders.remind],
  "/api/air-funding-orders/reference": ["sell",airFundingOrders.reference],
  "/api/air-accounts/reference": ["sell", airAccounts.supplement],

  "/api/air-recharge/cash-sales": ["sell", dailyClose.airCashSale],

  "/api/air-recharge/history": ["communicate", (store, user, payload) => {
    if (payload.action === "preview") return airHistory.preview(store, user, payload);
    if (payload.action === "submit") return airApprovals.submit(store, user, payload);
    if (payload.action === "review") return airApprovals.review(store, user, payload);
    if (payload.action === "settle") return airHistory.settle(store, user, payload);
    throw new c.HttpError(400, "请选择预览、提交、审核或补核");
  }],

  "/api/fund-transfers": ["paymentRegister", fundsNetwork.createTransfer],
  "/api/store-transfers": ["paymentRegister", require("./store-transfer").create],
  "/api/store-transfers/reverse": ["paymentRegister", require("./store-transfer").reverse],
  "/api/wallet-cash-exchanges": ["paymentRegister", require('./wallet-cash-exchanges').link],

  "/api/fund-transfers/confirm": ["learn", fundsNetwork.confirmTransfer],

  "/api/fund-transfers/reject": ["learn", fundsNetwork.rejectTransfer],

  "/api/cash-handovers": ["sell", cashHandovers.create],

  "/api/cash-handover-recipients": ["manageUsers", cashHandovers.setRecipient],

  "/api/cash-handover-recipients/add": ["manageUsers", cashHandovers.addRecipient],

  "/api/cash-handovers/resubmit": ["sell", cashHandovers.resubmit],

  "/api/cash-handovers/reverse": ["sell", require("./internal-store-transfers").reverse],

  "/api/cash-handovers/confirm": ["learn", cashHandovers.confirm],

  "/api/cash-handovers/reject": ["learn", cashHandovers.reject],

  "/api/daily-closeouts/claim": ["sell", dailyClose.claim],

  "/api/daily-closeouts/review": ["sell", dailyClose.review],

  "/api/daily-closeouts/resubmit": ["sell", dailyClose.resubmit],

  "/api/daily-closeouts/lock": ["manageUsers", dailyClose.lock],

  "/api/daily-closeouts/unlock": ["manageUsers", dailyClose.unlock],

  "/api/closeouts/confirm": ["sell", closeouts.confirm],

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

  "/api/suppliers": ["catalogAdd", suppliers.save],

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

  "/api/receptions/assistant-draft": ["sell", receptions.assistantDraft],
  "/api/receptions": ["sell", receptions.create],

  "/api/receptions/update": ["sell", receptions.update],

  "/api/receptions/supplement": ["sell", receptions.supplement],

  "/api/receptions/wechat": ["sell", receptions.claimWechat],

  "/api/receptions/wechat/confirm": ["finance", receptions.confirmWechat],

  "/api/receptions/follow-up": ["sell", receptions.addFollowUp],

  "/api/receptions/follow-up/confirm": ["finance", receptions.confirmFollowUp],

  "/api/receptions/quality-review": ["finance", receptions.reviewInvalidQuality],

  "/api/receptions/assist": ["sell", receptions.addAssist],

  "/api/receptions/assist/confirm": ["finance", receptions.confirmAssist],

  "/api/receptions/link": ["sell", receptions.linkExisting],

  "/api/receptions/close": ["sell", receptions.close],

  "/api/receptions/close/confirm": ["finance", receptions.confirmClose],

  "/api/receptions/rules": ["manageUsers", receptions.saveRules],

  "/api/receptions/commission": ["manageUsers", receptions.allocateCommission],

  "/api/assistant-finance/reference": ["learn", (s,u,p)=>require("./assistant-finance").saveReference(s,u,p)],
  "/api/assistant-finance/count": ["learn", (s,u,p)=>require("./assistant-finance").count(s,u,p)],
  "/api/assistant-finance/confirm": ["learn", (s,u,p)=>require("./assistant-finance").confirm(s,u,p)],
  "/api/order-red-packets/request": ["sell", orderRedPackets.request],
  "/api/order-red-packets/withdraw": ["sell", orderRedPackets.withdraw],
  "/api/order-red-packets/review": ["manageUsers", orderRedPackets.review],
  "/api/order-red-packets/pay": ["manageUsers", orderRedPackets.pay],

  "/api/carrier-business-options": ["catalogAdd", businessOptions.create],
  "/api/carrier-commission-rules/save": ["manageUsers",(s,u,p)=>require("./carrier-commission-rules").save(s,u,p)],
  "/api/carrier-commission-rules/apply": ["manageUsers",(s,u,p)=>require("./carrier-commission-rules").apply(s,u,p)],
  "/api/carrier-services": ["sell", carrierRentals.create],
  "/api/mobile-card-bundles": ["sell", mobileCardBundles.create],

  "/api/carrier-services/confirm": ["finance", carrierRentals.confirm],

  "/api/carrier-services/receive": ["finance", carrierRentals.receive],

  "/api/card-events": ["finance", erp.cardEvent],

  "/api/payroll/rules": ["managePay", payroll.saveRule],

  "/api/payroll/salaries": ["managePay", payroll.saveSalary],

  "/api/payroll/business-ensure": ["managePay", payroll.ensureBusinessEntry],

  "/api/payroll/carrier-rate": ["managePay", payroll.carrierRate],

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

    c.permit(user, path === "/api/payment-accounts" ? (body?.id == null || body.id === "" ? "catalogAdd" : "manageUsers") : action[0]);
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
    const receiptIdsBefore=new Set((store.receipts||[]).map(row=>row.id));

    const beforeFinance=require("./finance-prompt-cleanup").capture(store,path,body);
    const beforeNormal=normalWorkflow.capture(store,path);
    const input = documentNumbers.input(store,body);
    const result = require("./master-data-requests").gate(store,user,path,input) || action[1](store,user,input);

    const normalChanged=normalWorkflow.after(store,user,beforeNormal);
    require("./finance-prompt-cleanup").after(store,user,beforeFinance);
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

    if (businessNotice && (path==='/api/sale-orders' || (!normalChanged.length && !result?.pendingNoticeKey))) {

      const orderId = result?.id || result?.orderId || key;

      recordNotice(store, "local:" + path + ":" + key, businessNotice, {

        id: orderId, summary: user.name + " 提交 · " + businessNotice + " · " + orderId,

        amount: result?.totalAmount ?? result?.amount,

      });

    }
    if(path==='/api/sale-payments/declare-paid' && result?.orderId && result?.partId && !result.alreadyDeclared && !result.scanReceiptConfirmed){
      const order=(store.sales||[]).find(row=>row.id===result.orderId);
      const part=(order?.paymentParts||[]).find(row=>row.id===result.partId);
      if(part){
        const aggregate=/聚合|微信|支付宝|扫码|云闪付|二维码/.test(String(part.account||''));
        recordNotice(store,'sale-customer-paid-declared:'+order.id+':'+part.id,'营业员登记顾客已付款',{
          id:order.id,category:aggregate?'aggregate':'business',
          summary:user.name+' · '+String(part.account||'非现金')+' ¥'+Number(part.amount).toFixed(2)+' · 营业员登记，供老板查看；有疑点可交回待查',
          amount:part.amount,
        });
      }
    }
    for(const receipt of store.receipts||[]){
      if(require('./scan-collection').isScan(store,receipt,receipt.transactionDate||require('./common').day(receipt.createdAt)))continue;
      if(receiptIdsBefore.has(receipt.id)||receipt.kind!=='sale'||!(Number(receipt.amount)>0))continue;
      const isCash=receipt.account==='现金',isAggregate=/聚合|微信|支付宝|扫码|云闪付|二维码/.test(String(receipt.account||''));
      if(!isCash&&!isAggregate)continue;
      const kind=isCash?'现金收款登记':'账户分项核对收款登记';
      recordNotice(store,'receipt-posted:'+receipt.id,kind,{
        id:receipt.sourceId,receiptId:receipt.id,category:isCash?'cash':'aggregate',
        summary:user.name+' · '+String(receipt.account||'收款')+' ¥'+Number(receipt.amount).toFixed(2)+' · '+(isCash?(receipt.cashDestination==='employee'?'现金由营业员保管；不表示已交给老板':'现金已记入门店现金；请核对实际保管人'):'收款已登记，供老板查看；有疑点可交回待查'),
        amount:receipt.amount,
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
  if(route==='/login')html=html.replace('data-help-target="login-account-help"','data-help-all');

  // The style namespace must exist before the first paint, including login/logout.
  if(!['/sale-receipt','/payment-receipt','/companion','/companion-admin','/kitty'].includes(route)){
    html=html.replace(/<body\b([^>]*)>/i,(_tag,attrs)=>{
      const classes=['calm-workbench',...(route==='/receptions'?['calm-receptions']:[])];
      const pattern=/\bclass\s*=\s*(["'])(.*?)\1/i;
      if(pattern.test(attrs))attrs=attrs.replace(pattern,(_m,q,value)=>'class='+q+[...new Set(value.split(/\s+/).concat(classes))].join(' ')+q);
      else attrs+=' class="'+classes.join(' ')+'"';
      return '<body'+attrs+'>';
    });
  }

  if(!['/sale-receipt','/payment-receipt','/companion','/companion-admin','/kitty'].includes(route)&&!html.includes('href="/mobile-reading.css'))html=html.replace(/<\/head\s*>/i,'<link id="mobile-reading-style" rel="stylesheet" href="/mobile-reading.css?v=20261018-v128"></head>');
  if(['/m','/app','/boss-overview','/funds','/sale-payments','/business-reconciliation','/cash-handover'].includes(route))html=html.replace(/<\/head\s*>/i,'<link id="compact-work-notice-style" rel="stylesheet" href="/compact-work-notices.css?v=20261018-v126"><script defer src="/sale-fund-responsibility-entry.js?v=20261018-v126"></script></head>');
  if(['/business-reconciliation','/m','/app','/boss-overview','/stocktake','/payment-requests'].includes(route))html=html.replace(/<\/head\s*>/i,'<script defer src="/normal-workflow-entry.js?v=20261018-v120"></script></head>');
  if(['/app','/master-data'].includes(route))html=html.replace(/<\/head\s*>/i,'<link rel="stylesheet" href="/directory-edit.css?v=20261017-v84"><script defer src="/directory-edit.js?v=20261024-basic-finance-r1"></script></head>');
  if(["/m","/app","/master-data","/boss-overview","/carrier","/payment-accounts"].includes(route))html=html.replace(/<\/head\s*>/i,'<link rel="stylesheet" href="/master-review-entry.css?v=20261017-v81"><script defer src="/master-review-entry.js?v=20261017-v81"></script></head>');
  html=html.replace(/(office[.]js|trade-documents[.]js|store-communication[.]js|notices[.]js|mobile-nav[.]js)[?]v=[^\"'<> ]*/g,'$1?v=20261018-v110');
  if(['/m','/app','/boss-overview','/funds','/stocktake','/sales-list','/search','/opening-drafts','/carrier','/air-recharge','/air-accounts','/sale-payments','/cash-handover','/daily-close','/close','/work-journal','/qr','/learning','/subsidy','/gift-approvals','/order-red-packets','/notices','/personnel','/payment-accounts','/receptions','/repair-materials','/repair-services','/organization','/brain','/used-phones','/work-arrangements','/master-data'].includes(route)&&!html.includes('workbench-display-order'))html=html.replace('</head>','<link rel="stylesheet" href="/display-order.css?v=20261017-v80"><script id="workbench-display-order" defer src="/display-order.js?v=20261017-v80"></script><script defer src="/privacy-display.js?v=20261018-v118"></script></head>');
  const personalPage = ["/companion", "/companion-admin"].includes(route);
  const sessionControls = '<link id="workbench-session-controls" rel="stylesheet" href="/session-controls.css?v=20261020-visible-exit"><script defer src="/session-controls.js?v=20261012-account-logout"></script>';
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
  html=html.replace(/(src="\/(?:office|office-inventory|office-red|trade-documents|sales-list|sale-payments|work-journal|learning|search|qr|daily-close|stocktake|cash-handover|office-gifts|gift-approvals|sale-feedback|entry-feedback|close|carrier|subsidy)\.js)(?:\?[^"]*)?"/g, '$1?v=20261014-boss-help"');
  html=html.replace(/(src="\/carrier\.js)(?:\?[^"]*)?"/g, '$1?v=20261014-boss-help"');
  html=html.replace(/(src="\/office\.js)(?:\?[^"]*)?"/g, '$1?v=20261012-multi-account"');
  if (!personalPage && route !== "/login") {
    const referenceAssets = '<link rel="stylesheet" href="/reference-photo.css?v=20261016-v73"><link rel="stylesheet" href="/opening-people.css?v=20261016-v73"><script id="workbench-reference-photo" defer src="/reference-photo.js?v=20261016-v73"></script>';
    html=html.replace(/<\/head\s*>/i,referenceAssets+'</head>');
    html=html.replace(/(src="\/office\.js)(?:\?[^"]*)?"/g,'$1?v=20261016-reference-people-v73"');
  }
  if(!personalPage&&route!=="/login")html=html.replace(/<\/head\s*>/i,'<script defer src="/air-accounts-entry.js?v=20261016-v75"></script></head>');
  if(route==="/air-recharge")html=html.replace(/<b class="entry-required">必填<\/b><\/span><input name="platformRef"[^>]+>/,'（选填）</span><input name="platformRef" maxlength="80">');
  if(route==="/daily-close")html=html.replace(/(src="\/daily-close\.js)(?:\?[^"]*)?"/g,'$1?v=20261016-air-accounts-v74"').replace(/(<input name="(?:bankRef|platformRef)"[^>]*?) required/g,'$1').replace('例如实际转出 2000 元，移动BOSS增加 1996 元：两项金额和各自流水同时记录，差额 4 元单列待核。','按3‰计费，实付2000元，手续费6元，平台到账1994元；流水号选填。').replace('平台充值入金</h3>','平台充值入金（BOSS平台手续费3‰）</h3>');
  if(["/m","/boss-overview"].includes(route)&&!html.includes("workbench-boss-work"))html=html.replace(/<\/head\s*>/i,'<link rel="stylesheet" href="/master-data.css?v=20261024-basic-finance-r1"><link rel="stylesheet" href="/boss-work.css?v=20261017-v79"><script id="workbench-boss-work" defer src="/boss-work-ui.js?v=20261017-v79"></script></head>');
  if(['/m','/app','/funds','/master-data','/payment-accounts','/carrier'].includes(route)&&!html.includes('workbench-master-data'))html=html.replace('</head>','<link rel="stylesheet" href="/master-data.css?v=20261024-basic-finance-r1"><script id="workbench-master-data" defer src="/master-data-ui.js?v=20261024-basic-finance-r1"></script></head>');
  if(route==='/m'&&!html.includes('workbench-personal-shortcuts'))html=html.replace('</head>','<link rel="stylesheet" href="/personal-shortcuts.css?v=20261018-v133"><script defer src="/guide-habits.js?v=20261022-guide-first-v4"></script><script id="workbench-personal-shortcuts" defer src="/personal-shortcuts.js?v=20261018-v133"></script></head>');
  if(['/m','/app','/boss-overview','/boss-batch','/sale-fund-responsibility','/sale-payments','/business-reconciliation','/payment-requests','/cash-handover','/daily-close','/close','/funds','/gift-approvals','/air-history','/air-accounts','/receptions','/learning','/knowledge-review','/opening-drafts','/work-journal'].includes(route)&&!html.includes('workbench-task-readable'))html=html.replace('</head>','<link rel="stylesheet" href="/task-readable.css?v=20261018-v133"><script id="workbench-task-readable" defer src="/task-readable.js?v=20261018-v133"></script></head>');
  if(['/m','/business-reconciliation','/sale-fund-responsibility'].includes(route)&&!html.includes('workbench-pending-focus'))html=html.replace('</head>','<link id="workbench-pending-focus" rel="stylesheet" href="/pending-focus.css?v=20261018-v134">'+(route==='/m'?'<script defer src="/pending-focus.js?v=20261018-v134"></script>':'')+'</head>');
  if(route==='/daily-close'&&!html.includes('workbench-daily-compact'))html=html.replace('</head>','<link id="workbench-daily-compact" rel="stylesheet" href="/daily-compact.css?v=20261018-v135r1"><script defer src="/daily-compact.js?v=20261018-v135"></script></head>');
  const revisedAssets=new Set(['sale-code-resolver.js','sale-capture.js','barcode-display.css','qr.js','business-reconciliation.js','normal-workflow-entry.js','business-reconciliation.css','privacy-display.js','search.css','office-gifts.js','office.js','office.css','office-inventory.js','office-opening-quantity.js','office-red.js','trade-documents.js','store-communication.js','notices.js','mobile-nav.js','order-red-packets.js','boss-overview.js','feishu-mobile.js','search.js','daily-close.js','cash-handover.js','funds.js','learning.js','opening-drafts.js','close.js','gift-approvals.js','air-opening-drafts.js','receptions.js','assistant.js','personnel.js','knowledge-review.js'].map(name=>'/'+name));
  html=html.replace(/\b(src|href)=(['"])(\/[^'"<>?#]+)(?:\?[^'"<>]*)?\2/g,(tag,attribute,quote,asset)=>revisedAssets.has(asset)?attribute+'='+quote+asset+'?v=20261018-v121'+quote:tag);html=html.replace(/(src=["']\/office-batch-phones\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v119$2');html=html.replace(/(src|href)=(["'])(\/(?:business-reconciliation\.(?:js|css)|normal-workflow-entry\.js|office-gifts\.js))(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261018-v120$2');html=html.replace(/(src=["']\/office\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v123$2');html=html.replace(/(src=["']\/funds\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v124$2');html=html.replace(/(src|href)=(["'])(\/(?:office\.js|qr\.js|payment-splits\.(?:js|css)))(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261018-v125$2');html=html.replace(/(src=["']\/fund-ledgers\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v127$2');html=html.replace(/(src|href)=(["'])(\/(?:feishu-mobile\.(?:js|css)|mobile-reading\.css))(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261018-v128$2');html=html.replace(/(src=["']\/(?:feishu-mobile|sale-fund-responsibility)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v132$2');html=html.replace(/(src|href)=(["'])(\/feishu-mobile\.(?:js|css))(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261018-v132r1$2');html=html.replace(/(src=["']\/mobile-nav\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v132r1$2');html=html.replace(/(src=["']\/(?:business-reconciliation|sale-fund-responsibility)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v134$2');html=html.replace(/(src=["']\/daily-close\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261018-v135$2');if(route==='/business-reconciliation')html=html.replaceAll('business-reconciliation.js?v=20261018-v134','business-reconciliation.js?v=20261028-inline-original-r1').replaceAll('business-reconciliation.css?v=20261018-v120','business-reconciliation.css?v=20261027-task-layout-r1');if(route==='/cash-handover'||route==='/sale-fund-responsibility'||route==='/funds'||route==='/payment-requests')html=html.replace(/\/(cash-handover|sale-fund-responsibility|funds|payment-requests)\.js(?:\?[^\"']*)?/g,'/$1.js?v=20261018-v136');
  html=html.replace(/(src|href)=(["'])(\/(?:office|trade-documents|operation-logs|daily-close|daily-compact|funds|store-communication)\.js)(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261018-v137$2');
  html=html.replace(/(src|href)=(["'])(\/daily-close\.js)(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261018-v138$2');
  html=html.replace(/(src|href)=(["'])(\/daily-close\.js)(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261018-v140$2');
  if(route==='/app')html=html.replace(/(src|href)=(["'])(\/(?:office\.css|office-inventory\.js))(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261019-inventory-summary$2');
  html=html.replace(/(src=["']\/privacy-display\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261019-privacy-toggle-r2$2');
  if(route==='/sales-list')html=html.replace(/(src|href)=(["'])(\/sales-list\.(?:js|css))(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261019-gifts-r1$2');
  if(route==='/funds')html=html.replace(/(src=["']\/(?:fund-ledgers|funds)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261019-personal-finance-r1$2');
  html=html.replace(/(src=["']\/(?:personal-shortcuts|master-review-entry|boss-work-ui|sale-fund-responsibility-entry|store-communication)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261022-guide-first-v4$2');
  if(route==='/receptions')html=html.replace(/(src=["']\/receptions\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261022-entry-v1$2');
  if(route==='/receptions')html=html.replace('</head>','<script defer src="/reception-voice.js?v=20261020-continuous-r1"></script><script defer src="/reception-assistant-ui.js?v=20261020-continuous-r1"></script></head>');
  if(route==='/m')html=html.replace(/(src=["']\/(?:personal-shortcuts|feishu-mobile)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-directory-r2$2');
  if(route==='/m')html=html.replace('</head>','<link rel="stylesheet" href="/screen-warm.css?v=20261020-continuous-r1"></head>');
  html=html.replace(/(src|href)=(["'])(\/(?:store-communication\.js|mobile-nav\.js|assistant\.js|personal-shortcuts\.js|feishu-mobile\.js|calm-workbench\.css))(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261020-stable-r1$2');
  if(route === '/carrier' || route === '/sales-list')html=html.replace(/(src=["']\/(?:carrier|sales-list)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-auto-rules$2');
  if(route==='/funds'||route==='/assistant-finance')html=html.replace(/(src=["']\/(?:finance-processing|fund-ledgers|assistant-finance)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-blind-cash$2');
  html=html.replace(/(src=["']\/(?:payment-splits|air-recharge|office)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-cash-destination$2');
  if(route==='/business-reconciliation')html=html.replace(/(src=["']\/business-reconciliation\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-payment-options$2');
  html=html.replace(/(src=["']\/(?:office|trade-documents)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-finance-query-final$2');
  html=html.replace(/(href=["']\/(?:office|finance-processing)\.css)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-finance-query-final$2');
  html=html.replace(/(src=["']\/sales-list\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-compact-amount$2');
  html=html.replace(/(src=["']\/(?:feishu-mobile|finance-processing)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-finance-query-final$2');
  html=html.replace(/(src=["']\/office-gifts\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261020-quick-gift$2');
  html=html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, (head) => {
    const cleaned = head.replace(/<(link|meta)\b[^>]*>/gi, (tag, kind) => {
      if (kind.toLowerCase() === 'link' && attribute(tag, 'rel').split(/\s+/).some((rel) => ['icon', 'manifest', 'apple-touch-icon', 'apple-touch-icon-precomposed'].includes(rel))) return '';
      if (kind.toLowerCase() === 'meta' && ['theme-color', 'application-name', 'apple-mobile-web-app-title'].includes(attribute(tag, 'name'))) return '';
      return tag;
    });
    return cleaned.replace(/(src="\/login\.js)(?:\?[^"]*)?"/g, '$1?v=20261012-account-logout"').replace(/<\/head\s*>$/i, identity + sessionControls + (route === '/login' || personalPage ? '' : '<link rel="stylesheet" href="/horizontal-layout.css?v=20261018-horizontal-r3">') + (!personalPage ? '<link rel="stylesheet" href="/calm-workbench.css?v=20261020-continuous-r1"><script defer src="/calm-workbench.js?v=20261020-r1"></script>' : '') + '</head>');
  });
  // Discover all existing style sheets in the head before the first paint; retain cascade order.
  if(!['/sale-receipt','/companion','/companion-admin','/kitty','/family','/display'].includes(route)&&!html.includes('workbench-task-readable'))html=html.replace('</head>','<link rel="stylesheet" href="/task-readable.css?v=20261021-type-r2"><script id="workbench-task-readable" defer src="/task-readable.js?v=20261021-type-r2"></script></head>');
  html=html.replace(/(\/task-readable\.(?:css|js)|\/mobile-nav\.js)(?:\?[^"'\s<>]*)?/g,'$1?v=20261021-type-r2');
  if(['/funds','/daily-close','/receptions','/m'].includes(route)){
    html=html.replace('</head>','<link rel="stylesheet" href="/finance-workflow-polish.css?v=20261021-workflow-r1">'+(route==='/funds'?'<script defer src="/finance-batch-ui.js?v=20261021-readonly-messages-r1"></script>':route==='/daily-close'?'<script defer src="/daily-withdrawal-ui.js?v=20261021-workflow-r1"></script>':route==='/m'?'<script defer src="/home-session-inline.js?v=20261021-workflow-r1"></script>':'')+'</head>');
  }
  html=html.replace(/(src=["']\/(?:reception-assistant-ui|feishu-mobile|daily-close)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261021-workflow-r1$2');
  if(route==='/air-accounts')html=html.replace(/(src=["']\/air-accounts\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261021-air-flow-r1$2');
  if(!route.startsWith('/api/')&&route!=='/login')html=html.replace(/<head([^>]*)>/i,'<head$1><script src="/entry-read-coordinator.js?v=20261021-speed-r1"></script>');
  html=html.replace(/(src=["']\/(?:feishu-mobile|pending-focus|sale-fund-responsibility-entry|store-communication)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261021-speed-r1$2');
  html=html.replace(/(src=["']\/office\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261022-sale-opening-v1$2');
  html=html.replace(/(src=["']\/(?:personal-shortcuts|search)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261021-document-query-r1$2');
  if(route!=='/document-query')html=html.replace(/href=(["'])\/search\1/g,'href="/document-query"').replace(/>综合查询</g,'>单据查询<');
  const firstPaintStyles=[];
  html=html.replace(/<link\b[^>]*>/gi,tag=>/\brel\s*=\s*["']stylesheet["']/i.test(tag)?(firstPaintStyles.push(tag),''):tag);
  const firstPaintBoot='<script id="first-paint-preferences">(()=>{try{if(localStorage.getItem("store-task-large-text-v1")==="1"||(localStorage.getItem("store-task-large-text-v1")===null&&localStorage.getItem("store-mobile-text-size")==="double"))document.documentElement.classList.add("task-text-large");const q=new URLSearchParams(location.search);if(location.pathname==="/daily-close"&&!q.has("closeout"))document.documentElement.classList.add("settlement-layout-pending");}catch{}})();</script>';
  html=html.replace(/<\/head\s*>/i,firstPaintStyles.join('')+firstPaintBoot+'</head>');
  // Keep the focused closeout and numbered pending-item UI in sync after deployment.
  html=html.replace(/(src|href)=(['"])(\/(?:daily-close\.(?:js|css)|feishu-mobile\.js|notices\.js|store-communication\.js))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261021-closeout-focus-r2$2');
  html=html.replace(/(src|href)=(['"])(\/(?:notices\.(?:js|css)|boss-work-ui\.js))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261022-inquiry-r1$2');
  html=html.replace(/(src|href)=(['"])(\/(?:office-inventory\.js|feishu-mobile\.js|sale-payments\.js|sale-fund-responsibility\.js|office\.js|payment-splits\.js|daily-close\.(?:js|css)|business-reconciliation\.js|trade-documents\.js))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261022-guide-first-v4$2');
  html=html.replace(/(src=['"]\/feishu-mobile\.js)(?:\?[^'"]*)?(['"])/g,'$1?v=20261025-shared-cash-associations-r1$2');
  html=html.replace(/(src=["']\/daily-close\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-wallet-book-v1$2');
  if(route==='/receptions')html=html.replace(/(src|href)=(['"])(\/(?:reception-assistant-ui\.js|calm-workbench\.css))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261022-voice-right-v1$2');
  if(!['/login','/companion','/companion-admin','/kitty','/family','/display','/sale-receipt'].includes(route))html=html.replace(/<head([^>]*)>/i,'<head$1><script src="/work-continuity-core.js?v=20261022-resume-v1"></script><script src="/work-continuity.js?v=20261025-shared-cash-navigation-r1"></script>');
  html=html.replace(/(src=["']\/(?:office|carrier|receptions|reception-assistant-ui)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261022-resume-v1$2');
  // Refresh both electronic-screen assets together so the visible back control and its handler match.
  html=html.replace(/(src|href)=(['"])(\/(?:store-communication\.(?:js|css)|mobile-nav\.js))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261024-screen-home-label-v3$2');
  if(route==='/app')html=html.replace(/(src|href)=(['"])(\/(?:office-inventory\.js|office\.css))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261024-inventory-three-fields$2');
  if(route==='/app')html=html.replace(/(src|href)=(['"])(\/(?:office-inventory\.js|office\.css|display-order\.js))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261024-inventory-query-compact-r1$2');
  if(route==='/business-reconciliation')html=html.replace(/(src|href)=(['"])(\/business-reconciliation\.(?:js|css))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261027-task-layout-r1$2');
  if(route==='/receptions')html=html.replace(/(src|href)=(['"])(\/(?:reception-assistant-ui\.js|receptions\.js|receptions\.css))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261027-service-assessment-r1$2');
  if(route==='/air-recharge')html=html.replace(/(src|href)=(['"])(\/air-recharge\.js)(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261027-service-assessment-r1$2');
  if(route==='/brain')html=html.replace(/(src|href)=(['"])(\/brain\.js)(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261027-service-assessment-r1$2');
  if(route==='/carrier')html=html.replace(/(src|href)=(['"])(\/carrier\.js)(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261028-bayu-bundle-r1$2');
  return html;
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
  const workPages = new Set(['/business-reconciliation','/supplier-exchanges','/supplier-outbound-tracking','/work-arrangements','/master-data','/app','/carrier','/receptions','/repair-materials','/repair-services','/stocktake','/sales-list','/search','/air-recharge','/funds','/sale-payments','/cash-handover','/daily-close','/close','/work-journal','/qr','/learning','/subsidy','/gift-approvals','/order-red-packets','/order-red-packets.html']);
  if (!workPages.has(route)) return html;
  if (!['/order-red-packets','/order-red-packets.html'].includes(route)) return html
    .replace(/<script\b[^>]*\bsrc\s*=\s*["']\/order-red-packets-ui\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi,'')
    .replace(/<link\b[^>]*\bhref\s*=\s*["']\/order-red-packets-ui\.css(?:\?[^"']*)?["'][^>]*>/gi,'');
  const assets = [];
  if (!/<script\b[^>]*\bsrc\s*=\s*["']\/order-red-packets-ui\.js(?:\?[^"']*)?["']/i.test(html))
    assets.push('<script id="workbench-order-red-packets" defer src="/order-red-packets-ui.js?v=20261013-order-red-packets"></script>');
  if (!/<link\b[^>]*\bhref\s*=\s*["']\/order-red-packets-ui\.css(?:\?[^"']*)?["']/i.test(html))
    assets.push('<link id="workbench-order-red-packets-style" rel="stylesheet" href="/order-red-packets-ui.css?v=20261013-order-red-packets">');
  return html.replace(/<head\b[^>]*>/i, head => head + assets.join(''));
}

function workSessionHtml(html, route) {
  if (route === "/login") return html;
  const tags = '<link id="workbench-work-session-style" rel="stylesheet" href="/work-session.css?v=20261027-resignin-fix"><script defer src="/work-session.js?v=20261027-resignin-fix"></script>';
  const clean = html.replace(/<link\b[^>]*href=["']\/work-session\.css(?:\?[^"']*)?["'][^>]*>/gi, "")
    .replace(/<script\b[^>]*src=["']\/work-session\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi, "");
  return clean.replace(/<head(\s[^>]*)?>/i, match => match + tags);
}

async function handle(req, res, options = {}) {
  const requestStarted=performance.now();

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
    if(req.method==='GET'&&(path==='/receptions'||path==='/receptions.html')){
      res.writeHead(302,{'Location':'/m','Cache-Control':'no-store'});res.end();return;
    }
    if(req.method==='GET'&&['/reception-disabled-ui.js'].includes(path)){
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      res.end(fs.readFileSync(pathModule.join(__dirname,'../../web/reception-disabled-ui.js')));return;
    }


    if(capacityEnabled && req.method==="POST" && req.headers["x-store-branch"] && req.headers["x-store-branch"]!==capacityContext.current().branchId)throw new c.HttpError(409,"门店已切换，请重新打开此页面，核对资料后再提交");

    if(path.startsWith('/api/')){res.setHeader('Cache-Control','private, no-store');if(req.erpSession?.userId){const scope=capacityContext.current();res.setHeader('X-Store-Work-Context',encodeURIComponent(JSON.stringify([req.erpSession.userId,scope.tenantId||'single',scope.branchId||'single'])));}}
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
      "/screen-warm.css":["screen-warm.css","text/css; charset=utf-8"],
      "/workbench-all":["workbench-directory.html","text/html; charset=utf-8"],
      "/workbench-directory.js":["workbench-directory.js","text/javascript; charset=utf-8"],
      "/workbench-directory.css":["workbench-directory.css","text/css; charset=utf-8"],
      "/calm-workbench.css":["calm-workbench.css","text/css; charset=utf-8"],
      "/calm-workbench.js":["calm-workbench.js","text/javascript; charset=utf-8"],
      "/reception-voice.js":["reception-voice.js","text/javascript; charset=utf-8"],
      "/reception-assistant-ui.js":["reception-assistant-ui.js","text/javascript; charset=utf-8"],
      "/attendance-night-access":["attendance-night-access.html","text/html; charset=utf-8"],
      "/attendance-night-access.js":["attendance-night-access.js","text/javascript; charset=utf-8"],
      "/assistant-finance": ["assistant-finance.html", "text/html; charset=utf-8"],
      "/assistant-finance.js": ["assistant-finance.js", "text/javascript; charset=utf-8"],
      "/assistant-finance.css": ["assistant-finance.css", "text/css; charset=utf-8"],
      "/daily-cash-receipts":["daily-cash-receipts.html","text/html; charset=utf-8"],
      "/daily-cash-receipts.js":["daily-cash-receipts.js","text/javascript; charset=utf-8"],
      "/daily-cash-receipts.css":["daily-cash-receipts.css","text/css; charset=utf-8"],
      "/sale-fund-responsibility":["sale-fund-responsibility.html","text/html; charset=utf-8"],
      "/sale-fund-responsibility.js":["sale-fund-responsibility.js","text/javascript; charset=utf-8"],
      "/sale-fund-responsibility.css":["sale-fund-responsibility.css","text/css; charset=utf-8"],
      "/sale-fund-responsibility-entry.js":["sale-fund-responsibility-entry.js","text/javascript; charset=utf-8"],
      "/compact-work-notices.css":["compact-work-notices.css","text/css; charset=utf-8"],
      "/document-center": ["document-center.html", "text/html; charset=utf-8"],
      "/funds/documents": ["document-center.html", "text/html; charset=utf-8"],
      "/document-center.js": ["document-center.js", "text/javascript; charset=utf-8"],
      "/document-center.css": ["document-center.css", "text/css; charset=utf-8"],
      "/funding-requests": ["funding-hub.html", "text/html; charset=utf-8"],
      "/funding-hub.js": ["funding-hub.js", "text/javascript; charset=utf-8"],
      "/funding-hub.css": ["funding-hub.css", "text/css; charset=utf-8"],
      "/store-wallet-funding": ["store-wallet-funding.html", "text/html; charset=utf-8"],
      "/store-wallet-funding.js": ["store-wallet-funding.js", "text/javascript; charset=utf-8"],
      "/order-red-packets": ["order-red-packets.html", "text/html; charset=utf-8"],
      "/order-red-packets.html": ["order-red-packets.html", "text/html; charset=utf-8"],
      "/order-red-packets-ui.js": ["order-red-packets-ui.js", "text/javascript; charset=utf-8"],
      "/order-red-packets-ui.css": ["order-red-packets-ui.css", "text/css; charset=utf-8"],
      "/order-red-packets.js": ["order-red-packets.js", "text/javascript; charset=utf-8"],
      "/order-red-packets.css": ["order-red-packets.css", "text/css; charset=utf-8"],
      "/repair-materials": ["repair-materials.html", "text/html; charset=utf-8"],
      "/repair-materials.js": ["repair-materials.js", "text/javascript; charset=utf-8"],
      "/repair-materials.css": ["repair-materials.css", "text/css; charset=utf-8"],
      "/repair-services": ["repair-services.html", "text/html; charset=utf-8"],
      "/repair-services.js": ["repair-services.js", "text/javascript; charset=utf-8"],
      "/repair-services.css": ["repair-services.css", "text/css; charset=utf-8"],
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

      '/business-reconciliation':['business-reconciliation.html','text/html; charset=utf-8'],
      '/supplier-exchanges':['supplier-exchanges.html','text/html; charset=utf-8'],
      '/supplier-exchanges.js':['supplier-exchanges.js','text/javascript; charset=utf-8'],
      '/supplier-exchanges.css':['supplier-exchanges.css','text/css; charset=utf-8'],
      '/supplier-outbound-tracking':['supplier-outbound-tracking.html','text/html; charset=utf-8'],
      '/supplier-outbound-tracking.js':['supplier-outbound-tracking.js','text/javascript; charset=utf-8'],
      '/supplier-outbound-tracking.css':['supplier-outbound-tracking.css','text/css; charset=utf-8'],
      '/business-reconciliation.js':['business-reconciliation.js','text/javascript; charset=utf-8'],
      '/source-document-view.js':['source-document-view.js','text/javascript; charset=utf-8'],
      '/source-document-view.css':['source-document-view.css','text/css; charset=utf-8'],
      '/business-reconciliation.css':['business-reconciliation.css','text/css; charset=utf-8'],
      '/ui-task-reading.css':['ui-task-reading.css','text/css; charset=utf-8'],
      '/ui-task-reading.js':['ui-task-reading.js','text/javascript; charset=utf-8'],
      '/normal-workflow-entry.js':['normal-workflow-entry.js','text/javascript; charset=utf-8'],
      "/entry-benchmark.js": ["entry-benchmark.js", "text/javascript; charset=utf-8"],
      "/app": ["office.html", "text/html; charset=utf-8"],
      "/sale-receipt": ["sale-receipt.html", "text/html; charset=utf-8"],
      "/payment-receipt": ["payment-receipt.html", "text/html; charset=utf-8"],
      "/payment-receipt.js": ["payment-receipt.js", "text/javascript; charset=utf-8"],
      "/sale-receipt.js": ["sale-receipt.js", "text/javascript; charset=utf-8"],
      "/sale-receipt.css": ["sale-receipt.css", "text/css; charset=utf-8"],
      "/batch-phone-intake": ["batch-phone-intake.html", "text/html; charset=utf-8"],
      "/office-batch-phones.js": ["office-batch-phones.js", "text/javascript; charset=utf-8"],

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
      "/login-refresh.css": ["login-refresh.css", "text/css; charset=utf-8"],
      "/attendance": ["attendance.html", "text/html; charset=utf-8"],
      "/attendance.js": ["attendance.js", "text/javascript; charset=utf-8"],
      "/attendance.css": ["attendance.css", "text/css; charset=utf-8"],

      "/document-query": ["document-query.html", "text/html; charset=utf-8"],
      "/document-query.js": ["document-query-client.js", "text/javascript; charset=utf-8"],
      "/document-query.css": ["document-query.css", "text/css; charset=utf-8"],
      "/search": ["search.html", "text/html; charset=utf-8"],

      "/search.js": ["search.js", "text/javascript; charset=utf-8"],

      "/search-admin.js": ["search-admin.js", "text/javascript; charset=utf-8"],

      "/office-red.js": ["office-red.js", "text/javascript; charset=utf-8"],

      "/work-continuity-core.js": ["work-continuity-core.js", "text/javascript; charset=utf-8"],
      "/work-continuity.js": ["work-continuity.js", "text/javascript; charset=utf-8"],
      "/office-inventory.js": ["office-inventory.js", "text/javascript; charset=utf-8"],
      "/office-opening-quantity.js": ["office-opening-quantity.js", "text/javascript; charset=utf-8"],

      "/office-pricing.js": ["office-pricing.js", "text/javascript; charset=utf-8"],

      "/search.css": ["search.css", "text/css; charset=utf-8"],

      "/payment-requests": ["payment-requests.html", "text/html; charset=utf-8"],
      "/payment-requests.js": ["payment-requests.js", "text/javascript; charset=utf-8"],
      "/payment-requests.css": ["payment-requests.css", "text/css; charset=utf-8"],
      "/personnel": ["personnel.html", "text/html; charset=utf-8"],
      "/personnel.js": ["personnel.js", "text/javascript; charset=utf-8"],
      "/personnel.css": ["personnel.css", "text/css; charset=utf-8"],
      "/boss-overview": ["boss-overview.html", "text/html; charset=utf-8"],
      "/boss-overview.js": ["boss-overview.js", "text/javascript; charset=utf-8"],
      "/boss-overview.css": ["boss-overview.css", "text/css; charset=utf-8"],
      "/batch-review.js": ["batch-review.js", "text/javascript; charset=utf-8"],
      "/batch-review.css": ["batch-review.css", "text/css; charset=utf-8"],
      "/master-review-entry.css": ["master-review-entry.css", "text/css; charset=utf-8"],
      "/master-review-entry.js": ["master-review-entry.js", "text/javascript; charset=utf-8"],
      "/boss-batch": ["boss-batch.html", "text/html; charset=utf-8"],
      "/boss-batch.js": ["boss-batch.js", "text/javascript; charset=utf-8"],
      "/boss-batch.css": ["boss-batch.css", "text/css; charset=utf-8"],
      "/opening-drafts": ["opening-drafts.html", "text/html; charset=utf-8"],
      "/opening-drafts.js": ["opening-drafts.js", "text/javascript; charset=utf-8"],
      "/air-recharge": ["air-recharge.html", "text/html; charset=utf-8"],

      "/air-history": ["air-history.html", "text/html; charset=utf-8"],
      "/air-history.js": ["air-history.js", "text/javascript; charset=utf-8"],
      "/air-history.css": ["air-history.css", "text/css; charset=utf-8"],

      "/air-recharge.js": ["air-recharge.js", "text/javascript; charset=utf-8"],
      "/air-opening-drafts.js": ["air-opening-drafts.js", "text/javascript; charset=utf-8"],

      "/air-recharge.css": ["air-recharge.css", "text/css; charset=utf-8"],

      "/work-arrangements": ["work-arrangements.html", "text/html; charset=utf-8"],
      "/boss-work-ui.js": ["boss-work-ui.js", "text/javascript; charset=utf-8"],
      "/boss-work.css": ["boss-work.css", "text/css; charset=utf-8"],
      "/display-order.js": ["display-order.js", "text/javascript; charset=utf-8"],
      "/display-order.css": ["display-order.css", "text/css; charset=utf-8"],
      "/privacy-display.js": ["privacy-display.js", "text/javascript; charset=utf-8"],
      "/directory-edit.js": ["directory-edit.js", "text/javascript; charset=utf-8"],
      "/directory-edit.css": ["directory-edit.css", "text/css; charset=utf-8"],
      "/master-data": ["master-data.html", "text/html; charset=utf-8"],
      "/master-data-ui.js": ["master-data-ui.js", "text/javascript; charset=utf-8"],
      "/master-data.css": ["master-data.css", "text/css; charset=utf-8"],
      "/statement-comparisons": ["statement-comparisons.html", "text/html; charset=utf-8"],
      "/statement-comparisons.js": ["statement-comparisons.js", "text/javascript; charset=utf-8"],
      "/statement-comparisons.css": ["statement-comparisons.css", "text/css; charset=utf-8"],
      "/funds": ["funds.html", "text/html; charset=utf-8"],
      "/my-finance": ["my-finance.html", "text/html; charset=utf-8"],
      "/my-finance.js": ["my-finance.js", "text/javascript; charset=utf-8"],
      "/my-finance.css": ["my-finance.css", "text/css; charset=utf-8"],

      "/fund-ledgers.js": ["fund-ledgers.js", "text/javascript; charset=utf-8"],
      "/finance-batch-ui.js": ["finance-batch-ui.js", "text/javascript; charset=utf-8"],
      "/daily-withdrawal-ui.js": ["daily-withdrawal-ui.js", "text/javascript; charset=utf-8"],
      "/home-session-inline.js": ["home-session-inline.js", "text/javascript; charset=utf-8"],
      "/finance-workflow-polish.css": ["finance-workflow-polish.css", "text/css; charset=utf-8"],
      "/finance-processing.js": ["finance-processing.js", "text/javascript; charset=utf-8"],
      "/finance-processing.css": ["finance-processing.css", "text/css; charset=utf-8"],
      "/fund-ledgers.css": ["fund-ledgers.css", "text/css; charset=utf-8"],
      "/funds.js": ["funds.js", "text/javascript; charset=utf-8"],

      "/funds.css": ["funds.css", "text/css; charset=utf-8"],

      "/payment-accounts": ["payment-accounts.html", "text/html; charset=utf-8"],
      "/payment-accounts.js": ["payment-accounts.js", "text/javascript; charset=utf-8"],
      "/payment-accounts.css": ["payment-accounts.css", "text/css; charset=utf-8"],
      "/payment-splits.css": ["payment-splits.css", "text/css; charset=utf-8"],
      "/payment-splits.js": ["payment-splits.js", "text/javascript; charset=utf-8"],

      "/sale-payments": ["sale-payments.html", "text/html; charset=utf-8"],

      "/sale-payments.js": ["sale-payments.js", "text/javascript; charset=utf-8"],

      "/mobile-coin-claims": ["mobile-coin-claims.html", "text/html; charset=utf-8"],
      "/mobile-activity-sales": ["mobile-activity-sales.html", "text/html; charset=utf-8"],
      "/business-change-returns": ["business-change-returns.html", "text/html; charset=utf-8"],
      "/business-change-returns.js": ["business-change-returns.js", "text/javascript; charset=utf-8"],
      "/business-change-returns.css": ["business-change-returns.css", "text/css; charset=utf-8"],
      "/mobile-activity-sales.js": ["mobile-activity-sales.js", "text/javascript; charset=utf-8"],
      "/mobile-coin-claims.js": ["mobile-coin-claims.js", "text/javascript; charset=utf-8"],
      "/cash-handover": ["cash-handover.html", "text/html; charset=utf-8"],

      "/cash-handover.js": ["cash-handover.js", "text/javascript; charset=utf-8"],

      "/cash-handover.css": ["cash-handover.css", "text/css; charset=utf-8"],

      "/entry-feedback.js": ["entry-feedback.js", "text/javascript; charset=utf-8"],

      "/entry-feedback.css": ["entry-feedback.css", "text/css; charset=utf-8"],

      "/daily-close": ["daily-close.html", "text/html; charset=utf-8"],
      "/simple-daily-close": ["simple-daily-close.html", "text/html; charset=utf-8"],
      "/pending-special": ["pending-special.html", "text/html; charset=utf-8"],
      "/pending-special.js": ["pending-special.js", "text/javascript; charset=utf-8"],
      "/simple-daily-close.js": ["simple-daily-close.js", "text/javascript; charset=utf-8"],
      "/simple-daily-close.css": ["simple-daily-close.css", "text/css; charset=utf-8"],

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

      "/kitty": ["kitty.html", "text/html; charset=utf-8"],
      "/kitty.js": ["kitty.js", "text/javascript; charset=utf-8"],
      "/kitty-aliyun-reader.js": ["kitty-aliyun-reader.js", "text/javascript; charset=utf-8"],
      "/kitty.css": ["kitty.css", "text/css; charset=utf-8"],

      "/companion": ["companion.html", "text/html; charset=utf-8"],

      "/companion.js": ["companion.js", "text/javascript; charset=utf-8"],
    "/companion-request.js": ["companion-request.js", "text/javascript; charset=utf-8"],
      "/companion-billing.js": ["companion-billing.js", "text/javascript; charset=utf-8"],
      "/companion-speech.js": ["companion-speech.js", "text/javascript; charset=utf-8"],

      "/companion.css": ["companion.css", "text/css; charset=utf-8"],

      "/learning-hub.js": ["learning-hub.js", "text/javascript; charset=utf-8"],

      "/learning-hub.css": ["learning-hub.css", "text/css; charset=utf-8"],

      "/assistant": [new URL(req.url,"http://localhost").searchParams.get("work-signin")==="1"?"assistant.html":"pi-work.html", "text/html; charset=utf-8"],
      "/assistant-tools": ["assistant.html", "text/html; charset=utf-8"],
      "/pi-work.js": ["pi-work.js", "text/javascript; charset=utf-8"],
      "/pi-work.css": ["pi-work.css", "text/css; charset=utf-8"],

      "/assistant.js": ["assistant.js", "text/javascript; charset=utf-8"],
      "/attendance-management.js": ["attendance-management.js", "text/javascript; charset=utf-8"],
      "/attendance-management.css": ["attendance-management.css", "text/css; charset=utf-8"],
      "/work-session.js": ["work-session.js", "text/javascript; charset=utf-8"],
      "/work-session.css": ["work-session.css", "text/css; charset=utf-8"],

      "/assistant-sale-input.js": ["assistant-sale-input.js", "text/javascript; charset=utf-8"],

      "/assistant-tariff-export.js": ["assistant-tariff-export.js", "text/javascript; charset=utf-8"],

      "/assistant.css": ["assistant.css", "text/css; charset=utf-8"],

      "/brain-models.js": ["brain-models.js", "text/javascript; charset=utf-8"],
      "/brain-models.css": ["brain-models.css", "text/css; charset=utf-8"],
      "/assistant-memory": ["assistant-memory.html", "text/html; charset=utf-8"],
      "/rule-authority-page.js": ["rule-authority-page.js", "text/javascript; charset=utf-8"],
      "/erp-memory-page.js": ["erp-memory-page.js", "text/javascript; charset=utf-8"],
      "/erp-memory-entry.js": ["erp-memory-entry.js", "text/javascript; charset=utf-8"],
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
      "/mobile-card-bundles": ["mobile-card-bundles.html", "text/html; charset=utf-8"],
      "/mobile-card-bundles.js": ["mobile-card-bundles.js", "text/javascript; charset=utf-8"],
      "/mobile-card-bundles.css": ["mobile-card-bundles.css", "text/css; charset=utf-8"],
      "/store-transfer": ["store-transfer.html", "text/html; charset=utf-8"],
      "/store-transfer.js": ["store-transfer.js", "text/javascript; charset=utf-8"],
      "/store-transfer.css": ["store-transfer.css", "text/css; charset=utf-8"],
      "/topup-pairs": ["topup-pairs.html", "text/html; charset=utf-8"],
      "/topup-pairs.js": ["topup-pairs.js", "text/javascript; charset=utf-8"],
      "/topup-pairs.css": ["topup-pairs.css", "text/css; charset=utf-8"],

      "/carrier-commission-rules": ["carrier-commission-rules.html", "text/html; charset=utf-8"],
      "/carrier-commission-products.js": ["carrier-commission-products.js", "text/javascript; charset=utf-8"],
      "/carrier-commission-rules.js": ["carrier-commission-rules.js", "text/javascript; charset=utf-8"],
      "/carrier-commission-rules.css": ["carrier-commission-rules.css", "text/css; charset=utf-8"],
      "/carrier.js": ["carrier.js", "text/javascript; charset=utf-8"],
      "/air-accounts": ["air-accounts.html", "text/html; charset=utf-8"],
      "/air-accounts.js": ["air-accounts.js", "text/javascript; charset=utf-8"],
      "/air-accounts.css": ["air-accounts.css", "text/css; charset=utf-8"],
      "/air-accounts-entry.js": ["air-accounts-entry.js", "text/javascript; charset=utf-8"],
      "/reference-photo.js": ["reference-photo.js","text/javascript; charset=utf-8"],
      "/reference-photo.css": ["reference-photo.css","text/css; charset=utf-8"],
      "/opening-people.css": ["opening-people.css","text/css; charset=utf-8"],
      "/reference-ocr-v73/tesseract.min.js": ["reference-ocr-v73/tesseract.min.js","text/javascript; charset=utf-8"],
      "/reference-ocr-v73/worker.min.js": ["reference-ocr-v73/worker.min.js","text/javascript; charset=utf-8"],
      "/reference-ocr-v73/lang/eng.traineddata.gz": ["reference-ocr-v73/lang/eng.traineddata.gz","application/octet-stream"],
      "/reference-ocr-v73/core/tesseract-core.wasm.js": ["reference-ocr-v73/core/tesseract-core.wasm.js","text/javascript; charset=utf-8"],
      "/reference-ocr-v73/core/tesseract-core-simd.wasm.js": ["reference-ocr-v73/core/tesseract-core-simd.wasm.js","text/javascript; charset=utf-8"],
      "/reference-ocr-v73/core/tesseract-core-lstm.wasm.js": ["reference-ocr-v73/core/tesseract-core-lstm.wasm.js","text/javascript; charset=utf-8"],
      "/reference-ocr-v73/core/tesseract-core-simd-lstm.wasm.js": ["reference-ocr-v73/core/tesseract-core-simd-lstm.wasm.js","text/javascript; charset=utf-8"],
      "/business-options-ui.js": ["business-options-ui.js", "text/javascript; charset=utf-8"],
      "/business-options-ui.css": ["business-options-ui.css", "text/css; charset=utf-8"],

      "/carrier.css": ["carrier.css", "text/css; charset=utf-8"],

      "/subsidy": ["subsidy.html", "text/html; charset=utf-8"],

      "/subsidy.js": ["subsidy.js", "text/javascript; charset=utf-8"],

      "/subsidy.css": ["subsidy.css", "text/css; charset=utf-8"],

      "/jsQR.js": ["jsQR.js", "text/javascript; charset=utf-8"],

      "/sale-capture.js": ["sale-capture.js", "text/javascript; charset=utf-8"],
      "/sale-code-resolver.js": ["sale-code-resolver.js", "text/javascript; charset=utf-8"],
      "/barcode-display.css": ["barcode-display.css", "text/css; charset=utf-8"],
      "/vendor/zxing-library.min.js": ["vendor/zxing-library.min.js", "text/javascript; charset=utf-8"],
      "/vendor/zxing-library-LICENSE.txt": ["vendor/zxing-library-LICENSE.txt", "text/plain; charset=utf-8"],

      "/submit-voice.js": ["submit-voice.js", "text/javascript; charset=utf-8"],

      "/sale-feedback.js": ["sale-feedback.js", "text/javascript; charset=utf-8"],

      "/m": ["feishu-mobile.html", "text/html; charset=utf-8"],

      "/notices": ["notices.html", "text/html; charset=utf-8"],

      "/notices.js": ["notices.js", "text/javascript; charset=utf-8"],

      "/notices.css": ["notices.css", "text/css; charset=utf-8"],

      "/feishu-mobile.css": ["feishu-mobile.css", "text/css; charset=utf-8"],
      "/mobile-reading.css": ["mobile-reading.css", "text/css; charset=utf-8"],

      "/task-readable.js": ["task-readable.js", "text/javascript; charset=utf-8"],
      "/task-readable.css": ["task-readable.css", "text/css; charset=utf-8"],
      "/mobile-large-all.js": ["mobile-large-all.js", "text/javascript; charset=utf-8"],
      "/mobile-large-all.css": ["mobile-large-all.css", "text/css; charset=utf-8"],
      "/visual-refresh.css": ["visual-refresh.css", "text/css; charset=utf-8"],
      "/daily-compact.js": ["daily-compact.js", "text/javascript; charset=utf-8"],
      "/daily-funds-layout.js": ["daily-funds-layout.js", "text/javascript; charset=utf-8"],
      "/daily-funds-layout.css": ["daily-funds-layout.css", "text/css; charset=utf-8"],
      "/daily-compact.css": ["daily-compact.css", "text/css; charset=utf-8"],
      "/entry-read-coordinator.js": ["entry-read-coordinator.js", "text/javascript; charset=utf-8"],
      "/pending-focus.js": ["pending-focus.js", "text/javascript; charset=utf-8"],
      "/pending-focus.css": ["pending-focus.css", "text/css; charset=utf-8"],
      "/guide-habits.js": ["guide-habits.js", "text/javascript; charset=utf-8"],
      "/personal-shortcuts.js": ["personal-shortcuts.js", "text/javascript; charset=utf-8"],
      "/personal-shortcuts.css": ["personal-shortcuts.css", "text/css; charset=utf-8"],
      "/feishu-mobile.js": ["feishu-mobile.js", "text/javascript; charset=utf-8"],
      "/pending-alerts.js": ["pending-alerts.js", "text/javascript; charset=utf-8"],
      "/pending-alerts.css": ["pending-alerts.css", "text/css; charset=utf-8"],

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
      "/horizontal-layout.css": ["horizontal-layout.css", "text/css; charset=utf-8"],

      "/office-desktop.css": ["office-desktop.css", "text/css; charset=utf-8"],
      "/corporate-clean.css": ["corporate-clean.css", "text/css; charset=utf-8"],

    };

    if (req.method === "GET" && path === "/assistant" && url.searchParams.get("work-signin") === "1") { res.writeHead(302,{Location:"/attendance","Cache-Control":"no-store"}); res.end(); return; }
    if (req.method === "GET" && path === "/document-center") { res.writeHead(302,{Location:"/funds/documents"+url.search,"Cache-Control":"no-store"}); res.end(); return; }
    if (req.method === "GET" && path === "/daily-close" && !url.search) { res.writeHead(302,{Location:"/simple-daily-close","Cache-Control":"no-store"}); res.end(); return; }
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

        const branchScript=capacityEnabled && path!=="/kitty" && !["login.html","organization.html"].includes(file)

          ? '<script defer src="/branch-context.js?v=20261010-sales-list"></script>' : "";

        const readableStyle=["companion.html","kitty.html"].includes(file)?"":'<link rel="stylesheet" href="/readable-ui.css?v=20261010-readable"><link rel="stylesheet" href="/store-theme.css?v=20261010-interface">';

        let html = fs.readFileSync(filename,"utf8");
        if(path==='/m'&&!html.includes('data-home-layout="20261026"')){try{const identity=await readSessionStore(),viewer=authenticate(req,identity);if(workLock(identity,viewer).locked)html=require('./home-initial').shell(html);else{const initialStore=await readStore(capacityEnabled?{collections:['displayPreferences','storeAnnouncements']}:undefined);html=require('./home-initial').inject(html,initialStore,viewer);}}catch{html=require('./home-initial').shell(html);}}


        html=html.replace('</head>','<script defer src="/reception-disabled-ui.js?v=20261027-r1"></script></head>');
        let renderedHtml=path==='/m'&&html.includes('data-home-layout="20261026"')?html:require("./ui-corporate-clean").render(path==="/assistant"?html.replace("<head>","<head>"+branchScript):workbenchHtmlIdentity(workSessionHtml(paymentSplitsHtml(orderRedPacketsHtml(html,path),path),path).replace("</head>",branchScript+readableStyle+"</head>"),path),path);
        renderedHtml=renderedHtml.replace(/(src=["']\/(?:office|feishu-mobile|boss-overview|air-recharge|carrier|repair-services|assistant|search|document-query-client|work-journal)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261027-without-intake-r1$2');
        if(path==='/m')renderedHtml=renderedHtml.replace(/(src=["']\/feishu-mobile\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261028-cash-assistant-r2$2');
        if(path==='/sale-payments')renderedHtml=renderedHtml.replace(/(src=["']\/sale-payments\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261028-cash-assistant-r3$2');
        renderedHtml=renderedHtml.replace(/(src|href)=(["'])(\/(?:carrier(?:-commission-(?:rules|products))?\.(?:js|css)|source-document-view\.(?:js|css)))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261028-product-commission-r1$2');
        renderedHtml=renderedHtml.replace(/(src=["']\/(?:feishu-mobile|carrier)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261028-mobile-entry-chooser-r3$2');
        const finalHtml=path==='/business-reconciliation'?renderedHtml.replace(/(src|href)=(['"])(\/business-reconciliation\.(?:js|css))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261027-task-layout-r1$2'):renderedHtml;
        const largeTextHtml=finalHtml.replace(/<\/head\s*>/i,'<link rel="stylesheet" href="/mobile-large-all.css?v=20261028-r1"><script defer src="/mobile-large-all.js?v=20261028-r1"></script></head>');
        const visualHtml=!['/sale-receipt','/payment-receipt'].includes(path)?largeTextHtml.replace(/<\/head\s*>/i,'<link rel="stylesheet" href="/visual-refresh.css?v=20261028-r2"></head>'):largeTextHtml;
        res.end(url.searchParams.get("entryBench")==="1"?require("./entry-benchmark").inject(visualHtml):visualHtml);

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
      if(req.method==="GET" && !["/api/assistant/attendance","/api/store-communication","/api/personnel/leaves","/api/home-entry"].includes(path) && require("./attendance-access").restricted(viewer)) require("./attendance-access").assertActive(Array.isArray(initialStore.attendance)?initialStore:await readSessionStore(),viewer);

      if(!companionAccess.allowed(viewer,path))throw new c.HttpError(403,"个人助理账号不能访问门店经营资料");
      if (assistantRoles.customer(viewer) && !assistantRoles.personalOnly(viewer) && path!=="/api/assistant/ask")
        throw new c.HttpError(403, "接待专用账号仅能使用顾客咨询");

    }

    if(req.method==="GET" && path==="/api/assistant/roles"){sendJson(res,200,assistantRoles.catalog(authenticate(req,await authorizationStore(req))));return;}
    if(req.method==="GET" && ["/api/home-entry","/api/inventory/entry","/api/store-communication/summary"].includes(path)){
      const identity=await readSessionStore(),viewer=authenticate(req,identity),lock=workLock(identity,viewer);
      if(path==="/api/home-entry"){
        let unread=null;if(!lock.locked&&viewer.roleCode==='owner'){const minimal=requestStore||await readStore(capacityEnabled?{collections:['localCatalogNotices','feishuNotices']}:undefined);unread=require('./local-notices').allNotices?require('./local-notices').allNotices(minimal).filter(r=>!r.readAt).length:[...(minimal.localCatalogNotices||[]),...(minimal.feishuNotices||[])].filter(r=>!r.readAt).length;}
        sendJson(res,200,{...c.publicUser(viewer),owner:viewer.roleCode==='owner',workLock:lock,noticeUnread:unread});return;
      }
      require('./attendance-access').assertActive(identity,viewer);
      const collections=path==="/api/inventory/entry"?['warehouseProfiles']:[...new Set(['staffMessages','staffMessageReads','staffMessageReceipts',...require('./screen-live').READ_COLLECTIONS])];
      const store=requestStore||await readStore(capacityEnabled?{collections}:undefined);
      sendJson(res,200,path==="/api/inventory/entry"?{user:{...c.publicUser(viewer),workLock:lock},warehouses:warehouses.WAREHOUSES}:getResult(path,url.searchParams,store,viewer));return;
    }

    if(req.method==="GET" && (path==="/api/inventory/bootstrap"||path==="/api/warehouses"||path==="/api/product-category-paths"||(path==="/api/display-preferences"&&['catalog','home','boss','home-shortcuts','privacy','pending-alert'].includes(url.searchParams.get('page'))))) {
      const viewer=authenticate(req,await authorizationStore(req));
      const bootstrap=require('./inventory-bootstrap'),catalog=path!=="/api/display-preferences"||url.searchParams.get('page')==='catalog';
      const collections=path==="/api/inventory/bootstrap"?bootstrap.collections:path==="/api/warehouses"?["warehouseProfiles"]:catalog?['products','displayPreferences','catalogAdditionReviews','suppliers']:['displayPreferences','workbenchDirectoryEntries'];
      const started=performance.now(),store=requestStore||await readStore(capacityEnabled?{collections}:undefined),loaded=performance.now();
      const result=path==="/api/inventory/bootstrap"?bootstrap.get(store,viewer,{history:url.searchParams.get('history')==='1',options:url.searchParams.get('options')==='1',warehouse:url.searchParams.get('warehouse')||'',supplier:url.searchParams.get('supplier')||'',productGroup:url.searchParams.get('productGroup')||'',category:url.searchParams.get('category')||''}):getResult(path,url.searchParams,store,viewer);
      res.setHeader('Server-Timing','store;dur='+(loaded-started).toFixed(1)+',compute;dur='+(performance.now()-loaded).toFixed(1));
      sendJson(res,200,result);return;
    }

    if(req.method==="GET" && path==="/api/sales-list") {

      const viewer=authenticate(req,await authorizationStore(req));

      if(url.searchParams.get('optionsOnly')==='1'){
        sendJson(res,200,{options:capacityEnabled?await capacitySalesList.filterOptions(viewer):salesList.filterOptions(await readStore(),viewer)});
      }else sendJson(res,200,capacityEnabled?await capacitySalesList.report(viewer,url.searchParams):salesList.report(await readStore(),viewer,salesList.filters(url.searchParams)));

      return;

    }

    if(req.method==="GET" && ["/api/sale-orders/page","/api/serials/lookup"].includes(path)) {

      const viewer=authenticate(req,await authorizationStore(req));

      if(capacityEnabled)sendJson(res,200,path==="/api/sale-orders/page"?await capacityQueries.salesPage(viewer,url.searchParams):await capacityQueries.serials(viewer,url.searchParams));

      else if(path==="/api/sale-orders/page")sendJson(res,200,require('./document-query').salesPage(await readStore(),viewer,url.searchParams));

      else throw new c.HttpError(404,"此串号接口尚未启用");

      return;

    }

    if(path.startsWith('/api/assistant-memory')){await require('./erp-memory-gateway').handle(req,res,path,{readStore,persist:transaction,authenticate,sendJson,readJsonBody,scope:capacityContext.current()});return;}
    if(path.startsWith('/api/statement-comparisons')){
      await require('./statement-comparison-http').handle(req,res,{readStore,transaction,saveKnowledgeFile,readKnowledgeFile,authenticate,assertWorkSession,requestStore,capacityEnabled,onBody:body=>{const current=workRequestContext.getStore();if(current)current.body=body;}});
      return;
    }

    if (req.method === "POST" && ["/api/assistant/knowledge/upload-preview", "/api/assistant/knowledge/upload"].includes(path)) {

      const user = authenticate(req, requestStore || (await readStore()));

      c.permit(user, "knowledgeSubmit");

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

      c.permit(user, "sell");

      const form = await readMultipartForm(req);

      const file = form.files[0];

      if (!file) throw new c.HttpError(400, "请选择Excel文件");

      const rows = legacy.readOpeningBalanceRowsFromWorkbook(file.buffer);

      const preview = openingImportDrafts.preview(await readStore(), user, rows);

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

      const saleOpening=require('./sale-opening-read'),salePart=path==='/api/sale-opening'?(url.searchParams.get('part')||'base'):null;
      const entryReadOptions=capacityEnabled&&(path==='/api/pending-urges'?{collections:['workJournals','learningRecords','dailyCloseouts','leaveRequests','fundTransfers','cashHandovers','masterDataRequests','attendance','personnelConfig'],sharedCollections:[],saleSerialMode:'none'}:require("./entry-read-profiles").options(path,url.searchParams)||(['/api/products','/api/sale-opening','/api/procurement-plans','/api/purchase-orders','/api/suppliers/directory','/api/inventory'].includes(path)?{sharedCollections:['searchSynonyms'],...(salePart?saleOpening.readOptions(salePart):path==='/api/products'?{collections:['products','purchases','openingImportBatches','suppliers']}:{} )}:undefined));
      const saleReadStarted=path==='/api/sale-opening'?performance.now():0;
      const store = requestStore || (await (["/api/me","/api/users"].includes(path) ? readSessionStore() : readStore(entryReadOptions)));
      if((path.startsWith('/api/receptions/')||path.startsWith('/api/conversion-claims'))&&path!=='/api/receptions')require('./reception-availability').assertEnabled();
      if(path==='/api/receptions/audio'){
        const user=authenticate(req,store),meta=require('./reception-audio').replay(store,user,url.searchParams.get('id'));
        const bytes=await readKnowledgeFile(meta.hash);
        if(!bytes||createHash('sha256').update(bytes).digest('hex')!==meta.hash)throw new c.HttpError(503,'接待录音暂时无法读取，请联系管理员核对原文件');
        res.writeHead(200,{'Content-Type':meta.mime,'Content-Length':bytes.length,'Cache-Control':'private, no-store','Content-Disposition':'inline','X-Content-Type-Options':'nosniff'});
        res.end(bytes);return;
      }
      if(path==='/api/assistant/knowledge/index-status'){
        const user=authenticate(req,store);c.permit(user,'learn');
        const listed=employeeKnowledge.catalog(store,user),index=await require('./knowledge-vector-store.cjs').list(),byId=new Map(index.map(row=>[row.articleId,row]));
        sendJson(res,200,{rows:listed.items.filter(row=>!row.id.startsWith('active-rule-')).map(row=>({id:row.id,vectorState:require('./knowledge-vector-store.cjs').status(row,byId.get(row.id))}))});return;
      }
      if(path==='/api/assistant/knowledge/chunk-preview'){
        const user=authenticate(req,store);sendJson(res,200,require('./knowledge-vectorize.cjs').preview(store,user,url.searchParams.get('id')));return;
      }
      if(path==='/api/sale-opening'){
        const readFinished=performance.now(),result=saleOpening.get(store,authenticate(req,store),url.searchParams),assembled=performance.now();
        sendJson(res,200,result,{timings:{pre:saleReadStarted-requestStarted,read:readFinished-saleReadStarted,assemble:assembled-readFinished}});return;
      }
      if(path==="/api/payment-receipt"){const user=authenticate(req,store);let branch={};if(capacityEnabled){const profile=await organization.summary(user);branch=profile.branches.find(row=>row.id===profile.currentBranchId);if(!branch)throw new c.HttpError(403,"当前门店不可用");}sendJson(res,200,paymentReceipt.get(store,user,url.searchParams.get("receiptId"),branch));return;}
      if(path==="/api/sale-receipt"){const user=authenticate(req,store);let branch={};if(capacityEnabled){const profile=await organization.summary(user);branch=profile.branches.find(row=>row.id===profile.currentBranchId);if(!branch)throw new c.HttpError(403,"当前门店不可用");}sendJson(res,200,saleReceipt.get(store,user,url.searchParams.get("orderId"),branch));return;}

      if (path === "/api/opening-balance/template" && url.searchParams.get("format") !== "json") {
        const user = authenticate(req, store);
        c.permit(user, "sell");
        const template = legacy.getOpeningBalanceTemplate(store);
        const XLSX = require("xlsx");
        const columns = [...template.requiredColumns, ...template.optionalColumns];
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet([columns]);
        sheet['!cols'] = columns.map(name => ({wch: Math.max(14, name.length * 2 + 4)}));
        XLSX.utils.book_append_sheet(workbook, sheet, "期初数据填写");
        const examples = XLSX.utils.json_to_sheet(template.sampleRows, {header: columns});
        XLSX.utils.book_append_sheet(workbook, examples, "填写示例勿导入");
        const buffer = XLSX.write(workbook, {bookType: "xlsx", type: "buffer"});
        res.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="opening-balance-template.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent("期初建账模板.xlsx"),
          "Content-Length": buffer.length,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(buffer);
        return;
      }



      if(path==='/api/store-communication/attachment'){
        const user=authenticate(req,store);c.permit(user,'communicate');const photo=storeCommunication.attachment(store,user,url.searchParams.get('messageId'),url.searchParams.get('attachmentId'));res.writeHead(200,{'Content-Type':photo.mime,'Content-Length':photo.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'});res.end(photo.bytes);return;
      }
      if(path==='/api/companion/library/photo'||path==='/api/companion/library/audio'){
        const info=(path.endsWith('/audio')?companionLibrary.audioFile:companionLibrary.photo)(store,authenticate(req,store),url.searchParams.get('id')),content=await readKnowledgeFile(info.hash);if(!content)throw new c.HttpError(404,'照片暂不可读，请稍后再试');const headers={'Content-Type':info.mime,'Content-Length':content.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
        if(info.mime.startsWith('audio/')){headers['Accept-Ranges']='bytes';const range=req.headers.range;if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start=m&&m[1]?Number(m[1]):0,end=m&&m[2]?Number(m[2]):content.length-1;if(m&&!m[1]&&m[2]){start=Math.max(0,content.length-Number(m[2]));end=content.length-1;}if(!m||(!m[1]&&!m[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=content.length||end<start){res.writeHead(416,{'Content-Range':'bytes */'+content.length,'Cache-Control':'private, no-store'});res.end();return;}end=Math.min(end,content.length-1);headers['Content-Range']='bytes '+start+'-'+end+'/'+content.length;headers['Content-Length']=end-start+1;res.writeHead(206,headers);res.end(content.subarray(start,end+1));return;}}
        res.writeHead(200,headers);res.end(content);return;
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

      const body = await readJsonBody(req,path.startsWith("/api/system/backups/")?50*1024*1024:path==='/api/receptions/audio/stage'?8*1024*1024:path==='/api/companion/library/audio'?3*1024*1024:undefined);
      const workRequest = workRequestContext.getStore();
      if (workRequest) workRequest.body = body;
      const lockStore = requestStore || await readStore(), lockUser = authenticate(req, lockStore);
      if(path==='/api/receptions'||path.startsWith('/api/receptions/')||path.startsWith('/api/conversion-claims'))require('./reception-availability').assertEnabled();
      workWritePermission(lockUser, path);
      assertWorkSession(lockStore, lockUser, path, body);
      if(path==='/api/receptions/audio/stage'){
        c.permit(lockUser,'sell');
        const audio=require('./reception-audio'),file=audio.decode(body),key=c.text(req.headers['idempotency-key'],'录音请求编号');
        const result=await transaction(store=>{const user=authenticate(req,store);c.permit(user,'sell');const saved=audio.stage(store,user,body,file,key),fileSaved=saved.alreadySaved?null:saveKnowledgeFile(file.hash,file.bytes);return capacityEnabled?Promise.resolve(fileSaved).then(()=>saved):saved;});
        sendJson(res,200,result);return;
      }
      if(path==='/api/receptions/assistant-draft'){
        c.permit(lockUser,'sell');
        const transcript=c.text(body.assistantTranscript||body.transcript,'接待原话');
        if(transcript.length>20000)throw new c.HttpError(400,'本次接待内容过长，请分次整理');
        sendJson(res,200,receptions.assistantDraft(lockStore,lockUser,{transcript}));return;
      }
      if(path==='/api/assistant/knowledge/vectorize'){
        c.permit(lockUser,'manageUsers');
        const row=await transaction(store=>require('./knowledge-vectorize.cjs').approve(store,authenticate(req,store),body));
        sendJson(res,200,await require('./knowledge-vectorize.cjs').embed(row,capacityContext.current(),lockUser.id));return;
      }


      if(path==="/api/system/backups/preview"){const store=requestStore||await readStore();sendJson(res,200,storeBackups.preview(store,authenticate(req,store),body));return;}

      if(path==='/api/sale-fund-responsibility/correct-cash-source-preview'){const store=requestStore||await readStore();sendJson(res,200,require('./owner-direct-cash').correctionPreview(store,authenticate(req,store),body));return;}
      if(["/api/sale-fund-responsibility/handover-preview","/api/sale-fund-responsibility/actual-receipt-preview"].includes(path)){const store=requestStore||await readStore();sendJson(res,200,(path.endsWith("/handover-preview")?saleFundResponsibility.preview:saleFundResponsibility.receiptPreview)(store,authenticate(req,store),body));return;}
      if(path==="/api/inventory/transfers/preview"){const store=requestStore||await readStore();sendJson(res,200,inventoryTransfers.preview(store,authenticate(req,store),body));return;}
      if(path==="/api/inventory/source-corrections/preview"){const store=requestStore||await readStore();sendJson(res,200,serialSourceCorrections.preview(store,authenticate(req,store),body));return;}
      if(path==="/api/batch-phone-intake/preview"){const store=requestStore||await readStore();sendJson(res,200,batchPhoneIntake.preview(store,authenticate(req,store),body));return;}
      if(path==="/api/inventory/opening-append/preview"){const store=requestStore||await readStore();sendJson(res,200,openingStockAppend.preview(store,authenticate(req,store),body));return;}
      if(path==="/api/inventory/opening-quantity-append/preview"){const store=requestStore||await readStore();sendJson(res,200,openingQuantityAppend.preview(store,authenticate(req,store),body));return;}

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

        const actor = authenticate(req,store);
        const kittyMode = !assistantRoles.personalOnly(actor) && (body.mode==='customer'||actor.assistantCustomerOnly||actor.roleCode==='customer-assistant');
        const reply = kittyMode ? await require('./kitty-pi-client.cjs').ask(store,actor,body,capacityContext.current()) : await require('./erp-memory-gateway').ask(store,actor,body,{scope:capacityContext.current(),persist:transaction,read:readStore,key:String(req.headers['idempotency-key']||''),ask:(s,u,p)=>require('./assistant-pi-chat').agentAsk(s,u,p,{scope:capacityContext.current(),liveQuery:options.liveQuery})});
        if (reply.mode === "store" && reply.unresolved === true) {
          try { reply.feedbackTicket = await repositoryTransaction(current => assistantUnresolved.capture(current, authenticate(req,current), body.question, reply)); }
          catch { reply.feedbackCaptureFailed = true; }
        }
        sendJson(res, 200, reply);

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

      if(path==="/api/store-communication/urge") communicationEvents.changed("/api/store-communication/send",result,result.senderId);

      if(path === "/api/order-red-packets/pay" && result.notificationMessageId) communicationEvents.changed("/api/store-communication/send", {senderId:result.senderId,recipientId:result.recipientId}, result.senderId);
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

      ...(error.workLock ? { code: error.code, workLock: error.workLock } : {}),
      error: {

        message: error.statusCode

          ? error.message

          : "服务器处理失败，请稍后重试",

        ...(error.workLock ? { code: error.code, workLock: error.workLock } : {}),
        ...(attempt ? { attemptId: attempt.id } : {}),
        ...(faultId ? { faultId } : {}),

      },

    });

    if (!error.statusCode) console.error(error);

  }

}

function createServer(options = {}) {
 require('./erp-memory-gateway').startWorker({read:readStore,persist:repositoryTransaction,run:capacityContext.run});

  return http.createServer((req, res) => {

    const work=()=>workRequestContext.run({req,path:new URL(req.url,"http://localhost").pathname,body:null},()=>documentNumbers.run(()=>systemModelUsage.run({},()=>handle(req,res,options))));

    const result=capacityEnabled?capacityAuth.request(req,work):work();

    Promise.resolve(result).catch(error=>{const faultId=opsFaults.record({path:String(req.url||"").split("?")[0],method:req.method},error,503);if(!res.headersSent)sendJson(res,503,{error:{message:"数据库连接暂不可用，请稍后重试",faultId}});else res.end();});

  });

}

module.exports = { createServer };


















