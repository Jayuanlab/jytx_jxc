// Installs a separate local demo ledger. Refuses to overwrite existing data.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const dataDir = path.join(root, "server", "data");
const seed = path.join(dataDir, "store.json");
const database = path.join(dataDir, "store.sqlite");
if (fs.existsSync(seed) || fs.existsSync(database)) {
  console.error("已有账套数据，未覆盖。请先在独立目录使用测试版项目。");
  process.exitCode = 1;
} else {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(path.join(root, "examples", "test-store.json"), seed, fs.constants.COPYFILE_EXCL);
  console.log(`测试账套已准备：${seed}`);
}
