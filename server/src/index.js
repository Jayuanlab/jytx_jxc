const { createServer } = require("./application");
const { transaction, readStore } = require("./repository");
const { inventoryRows } = require("./feishu-inventory");
const { sync } = require("../../scripts/feishu-inventory");
const { startAttendanceSpotCheckWorker } = require("./attendance-spotcheck-worker");
const ready=Promise.resolve(transaction(() => {}));
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "127.0.0.1";
const feishuConfigured = process.env.HIDE_FEISHU !== "1" && Boolean(
  (process.env.FEISHU_APP_ID || process.env.APP_ID) &&
  (process.env.FEISHU_APP_SECRET || process.env.APP_SECRET) &&
  process.env.FEISHU_BASE_APP_TOKEN && process.env.FEISHU_BASE_TABLE_ID,
);
let syncing = false;
let pending = false;
async function syncInventory() {
  if (!feishuConfigured) return;
  if (syncing) { pending = true; return; }
  syncing = true;
  try {
    do {
      pending = false;
      const result = await sync(inventoryRows(await readStore()), {
        FEISHU_APP_ID: process.env.FEISHU_APP_ID || process.env.APP_ID,
        FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || process.env.APP_SECRET,
        FEISHU_BASE_APP_TOKEN: process.env.FEISHU_BASE_APP_TOKEN,
        FEISHU_BASE_TABLE_ID: process.env.FEISHU_BASE_TABLE_ID,
      });
      console.log("飞书库存同步：", result);
    } while (pending);
  } finally { syncing = false; }
}
const inventoryActions = new Set([
  "/api/products", "/api/purchase-orders", "/api/sale-orders", "/api/sale-returns",
  "/api/stocktakes", "/api/purchase-returns", "/api/opening-balance/import",
  "/api/gift-orders", "/api/gift-approvals/review",
]);
const server = createServer({ onMutation: (path) => inventoryActions.has(path) ? syncInventory() : undefined });
const capacityEvents=process.env.STORE_ENGINE==='postgres'?require('./capacity/events'):null;
let closing=false,attendanceSpotCheckWorker=null;
async function shutdown(){if(closing)return;closing=true;const workerStopping=attendanceSpotCheckWorker?attendanceSpotCheckWorker.stop():null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(workerStopping)await workerStopping;if(capacityEvents){await capacityEvents.close();await require('./capacity/postgres').close();}}
process.once('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
process.once('SIGINT',()=>shutdown().then(()=>process.exit(0)));
ready.then(async()=>{if(capacityEvents)await capacityEvents.start();server.listen(port, host, () =>
  {
    console.log(`聚友通信城进销存已启动：http://${host}:${port}/app`);
    if(!closing)attendanceSpotCheckWorker=startAttendanceSpotCheckWorker();
    if (feishuConfigured) syncInventory().catch((error) => console.error("飞书库存同步失败：", error.message));
  },
);}).catch(error=>{console.error("数据库初始化失败：",error.message);process.exitCode=1;});
