const { readStore, transaction } = require("../server/src/repository");
const { Bitable, processSales, processStocktakes, syncInventory } =
  require("../server/src/feishu-base-workflows");
const { processQuickSales } = require("../server/src/feishu-quick-sales");
const { processProducts } = require("../server/src/feishu-products");
const { processPurchases } = require("../server/src/feishu-purchases");
const { syncDaily } = require("../server/src/feishu-daily");
const { notice, sendNotices } = require("../server/src/feishu-notices");
const guardian = require("../server/src/guardian");

function collectNotices() {
  transaction((store) => {
    for (const job of store.feishuJobs || []) {
      const kind = job.key.startsWith("sale:") ? "销售" :
        job.key.startsWith("purchase:") ? "采购" :
        job.key.startsWith("stocktake:") ? "盘点" : "";
      if (kind) notice(store, job.key, kind, job.result);
    }
    guardian.collect(store);
  });
}
async function cycle(client) {
  const products = await processProducts(client);
  const purchases = await processPurchases(client);
  const quickSales = await processQuickSales(client);
  const sales = await processSales(client);
  const stocktakes = await processStocktakes(client);
  collectNotices();
  const notices = await sendNotices(client);
  const inventory = await syncInventory(client, readStore());
  const daily = await syncDaily(client, readStore());
  return { products, purchases, quickSales, sales, stocktakes, notices, inventory, daily };
}
async function main() {
  const client = new Bitable();
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await cycle(client);
      console.log(new Date().toISOString(), JSON.stringify(result));
    } catch (error) {
      console.error(new Date().toISOString(), String(error.stack || error));
      if (process.argv.includes("--once")) process.exitCode = 1;
    } finally {
      busy = false;
    }
  };
  await run();
  if (!process.argv.includes("--once"))
    setInterval(run, Number(process.env.FEISHU_WORKER_INTERVAL_MS || 30000));
}
if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
module.exports = { cycle, collectNotices };



