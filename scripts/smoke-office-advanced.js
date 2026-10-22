const assert = require("node:assert/strict");
const { chromium } = require("C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const base = process.env.STORE_TEST_BASE || "http://127.0.0.1:3101";
  const tab = (name) => page.getByRole("navigation").getByRole("button", { name }).click();
  const form = () => page.locator("#modal-form");
  const save = async () => {
    await form().getByRole("button", { name: "确认提交" }).click();
    await page.waitForFunction(() => !document.querySelector("#modal-form") || Boolean(document.querySelector("#modal-error")?.textContent), { timeout: 10000 });
    if (await form().count()) throw new Error("页面提交失败：" + await page.locator("#modal-error").textContent());
  };
  try {
    await page.goto(base + "/app");
    await page.getByRole("button", { name: "进入工作台" }).click();
    await page.getByRole("heading", { name: "门店总览" }).waitFor();

    await tab("工资与提成");
    await page.getByRole("button", { name: "提成与底薪设置" }).click();
    await page.getByRole("heading", { name: "提成与底薪设置" }).waitFor();
    await page.getByRole("row").filter({ hasText: "测试店员" }).getByRole("button", { name: "设置底薪" }).click();
    await form().locator('[name="amount"]').fill("2000");
    await save();
    await page.getByRole("row").filter({ hasText: "Type-C 快充线" }).getByRole("button", { name: "设置提成" }).click();
    await form().locator('[name="mode"]').selectOption("piece");
    await form().locator('[name="value"]').fill("5");
    await save();

    await tab("订货与入库");
    await page.getByRole("button", { name: "新建订货" }).click();
    await form().locator('[name="supplierId"]').selectOption("demo-supplier-b");
    await form().locator('[name="skuId"]').selectOption("demo-cable-001");
    await form().locator('[name="quantity"]').fill("3");
    await form().locator('[name="costPrice"]').fill("11");
    await save();
    await page.getByRole("button", { name: "分批收货" }).first().click();
    await form().locator('[name="quantity"]').fill("2");
    await save();

    await tab("供应商往来");
    await page.getByRole("row").filter({ hasText: "示例配件供货商" }).getByRole("button", { name: "查看往来" }).click();
    await page.getByRole("button", { name: "调价补差" }).click();
    await form().locator('[name="itemId"]').selectOption({ index: 0 });
    await form().locator('[name="scope"]').selectOption("all");
    await form().locator('[name="unitAmount"]').fill("1");
    await form().locator('[name="reference"]').fill("AUTO-PRICE-001");
    await form().locator('[name="note"]').fill("测试批次整批补差协议");
    await save();

    await tab("开单");
    await page.getByRole("button", { name: "添加商品" }).click();
    await form().locator('[name="skuId"]').selectOption("demo-card-001");
    await form().locator('[name="carrier"]').fill("测试运营商");
    await form().locator('[name="cardNo"]').fill("DEMO-CARD-NO-001");
    await form().locator('[name="expected"]').fill("20");
    await save();
    await page.locator("#sale-checkout").getByRole("button", { name: "确认收款并开单" }).click();
    await page.getByText(/开单成功/).waitFor();
    await tab("号卡佣金");
    await page.getByRole("button", { name: "记录佣金" }).first().click();
    await form().locator('[name="type"]').selectOption("confirm");
    await form().locator('[name="amount"]').fill("20");
    await save();
    await page.getByRole("button", { name: "记录佣金" }).first().click();
    await form().locator('[name="type"]').selectOption("receive");
    await form().locator('[name="amount"]').fill("10");
    await save();

    assert.deepEqual(errors, []);
    console.log("飞书工作台底薪、提成、订货分批收货、调价补差、号卡佣金流程通过");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
