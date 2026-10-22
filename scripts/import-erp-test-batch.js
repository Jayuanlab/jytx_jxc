const path = require("node:path");
const { importFile } = require("../server/src/test-data-import");
const filename = process.argv[2];
const mode = process.argv[3];
if (!filename || !["--preview", "--commit"].includes(mode)) {
  console.error("用法: node scripts/import-erp-test-batch.js BATCH.json --preview|--commit");
  process.exit(2);
}
try {
  const result = importFile(path.resolve(filename), { preview: mode === "--preview" });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}