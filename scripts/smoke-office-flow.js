const assert = require("node:assert/strict");
const { chromium } = require("C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = process.env.STORE_TEST_BASE || "http://127.0.0.1:3101";
  const tab = (name) => page.getByRole("navigation").getByRole("button", { name }).click();
  const form = () => page.locator("#modal-form");
  const save = async () => { await form().getByRole("button", { name: "确认提交" }).click(); await form().waitFor({ state: "detached" }); };
  try {
    await page.goto(base + "/app");
    await page.getByRole("button", { name: "进入工作台" }).click();
    await page.getByRole("heading", { name: "门店总览" }).waitFor();

    await tab("商品管理");
    await page.getByRole("button", { name: "新增商品" }).click();
    await form().locator('[name="name"]').fill("自动化测试数据线");
    await form().locator('[name="externalCode"]').fill("AUTO-CABLE-001");
    await form().locator('[name="type"]').fill("配件");
    await form().locator('[name="salePrice"]').fill("25");
    await save();
    await page.getByText("自动化测试数据线").waitFor();

    await tab("订货与入库");
    await page.getByRole("button", { name: "直接采购入库" }).click();
    await form().locator('[name="supplierId"]').selectOption("demo-supplier-b");
    await form().locator('[name="skuId"]').selectOption({ label: "自动化测试数据线" });
    await form().locator('[name="quantity"]').fill("4");
    await form().locator('[name="costPrice"]').fill("10");
    await save();
    await page.getByText("自动化测试数据线 × 4").waitFor();

    await tab("开单");
    await page.getByRole("button", { name: "添加商品" }).click();
    const saleProductId = await form().locator('[name="skuId"] option').filter({ hasText: "自动化测试数据线" }).getAttribute("value");
    await form().locator('[name="skuId"]').selectOption(saleProductId);
    await form().locator('[name="quantity"]').fill("1");
    await form().locator('[name="salePrice"]').fill("25");
    await save();
    await page.locator("#sale-checkout").getByRole("button", { name: "确认收款并开单" }).click();
    await page.getByText(/开单成功/).waitFor();

    await tab("销售单与退货");
    const saleRow = page.getByRole("row").filter({ hasText: "自动化测试数据线 × 1" }).first();
    await saleRow.getByRole("button", { name: "退货" }).click();
    await form().locator('input[type="number"]').first().fill("1");
    await form().locator('[name="reason"]').fill("自动化测试退货");
    await save();

    await tab("供应商往来");
    const supplierRow = page.getByRole("row").filter({ hasText: "示例配件供货商" });
    await supplierRow.getByRole("button", { name: "查看往来" }).click();
    await page.getByRole("heading", { name: "示例配件供货商" }).waitFor();
    await page.getByRole("button", { name: "付款 / 预付" }).click();
    await form().locator('[name="amount"]').fill("10");
    await save();

    assert.deepEqual(errors, []);
    console.log("飞书工作台商品、入库、销售、原单退货、供应商付款流程通过");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
