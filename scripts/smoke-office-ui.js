const assert = require("node:assert/strict");
const { chromium } = require("C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = process.env.STORE_TEST_BASE || "http://127.0.0.1:3101";
  try {
    await page.goto(base + "/app");
    await page.getByRole("button", { name: "进入工作台" }).click();
    await page.getByRole("heading", { name: "门店总览" }).waitFor();
    for (const [tab, title] of [
      ["开单", "销售开单"], ["销售单与退货", "销售单与退货"], ["库存与盘点", "库存与盘点"],
      ["订货与入库", "订货与采购入库"], ["供应商往来", "供应商往来"],
      ["收支流水", "收支流水"], ["商品管理", "商品管理"],
      ["号卡佣金", "号卡佣金"], ["工资与提成", "工资与提成"],
      ["日报", "经营日报"], ["员工账号", "员工账号"], ["期初导入", "期初导入"], ["操作日志", "操作日志"],
    ]) {
      await page.getByRole("navigation").getByRole("button", { name: tab }).click();
      await page.getByRole("heading", { name: title }).waitFor();
    }
    assert.deepEqual(errors, []);
    console.log("飞书工作台全部 14 个页面本机浏览器加载通过");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
