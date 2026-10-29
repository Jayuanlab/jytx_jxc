const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { initialize } = require("./common");
const { upgrade } = require("./suppliers");
let database;
let inTransaction = false;
function connection() {
  if (database) return database;
  const filename =
    process.env.STORE_DB_PATH ||
    path.join(__dirname, "..", "data", "store.sqlite");
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  database = new DatabaseSync(filename);
  database.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value))); CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, record_key TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), PRIMARY KEY(collection, record_key)); CREATE TABLE IF NOT EXISTS knowledge_files (sha256 TEXT PRIMARY KEY, content BLOB NOT NULL);",
  );
  if (
    !database.prepare("SELECT 1 FROM metadata WHERE key = 'initialized'").get()
  ) {
    const source =
      process.env.STORE_SEED_PATH ||
      path.join(__dirname, "..", "data", "store.json");
    const seed = JSON.parse(fs.readFileSync(source, "utf8"));
    if (filename !== ":memory:") {
      const backup = path.join(
        path.dirname(filename),
        "before-erp-upgrade.json",
      );
      if (!fs.existsSync(backup)) fs.copyFileSync(source, backup);
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      persist(upgrade(initialize(seed)));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return database;
}
function persist(store) {
  require("./fifo-costs").assertStore(store);
  const db = database;
  db.exec("DELETE FROM metadata; DELETE FROM records;");
  const meta = db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)");
  const record = db.prepare(
    "INSERT INTO records(collection,record_key,position,value) VALUES (?,?,?,?)",
  );
  meta.run("initialized", "true");
  for (const [key, value] of Object.entries(store)) {
    if (!Array.isArray(value)) {
      meta.run(key, JSON.stringify(value));
      continue;
    }
    meta.run(`array:${key}`, "true");
    value.forEach((item, position) =>
      record.run(key, String(position), position, JSON.stringify(item)),
    );
  }
}
function readRawStore() {
  const db = connection();
  const store = {};
  for (const row of db.prepare("SELECT key,value FROM metadata").all()) {
    if (row.key.startsWith("array:")) store[row.key.slice(6)] = [];
    else if (row.key !== "initialized") store[row.key] = JSON.parse(row.value);
  }
  for (const row of db
    .prepare(
      "SELECT collection,value FROM records ORDER BY collection,position",
    )
    .all())
    store[row.collection].push(JSON.parse(row.value));
  return upgrade(initialize(store));
}
function readStore() { const store=readRawStore(); require("./document-numbers").remember(store); return store; }
// Read and write under one database lock, after the HTTP body has arrived.
function transaction(work) {
  require('./rule-authority').assertRuntime();
  const db = connection();
  db.exec("BEGIN IMMEDIATE");
  inTransaction = true;
  try {
    const store = readRawStore(), numbers=require("./document-numbers"), before=numbers.capture(store);
    const ruleBefore=structuredClone(store);
    const result = work(store);
    if (result && typeof result.then === "function")
      throw new Error("Transaction callback must be synchronous");
    numbers.commitNew(store,before);
    require("./rule-configuration-guard").transition(ruleBefore,store);
    require('./product-archive-integrity').assertProductArchivePreserved(ruleBefore,store);
    persist(store);
    db.exec("COMMIT");
    return numbers.project(result,store);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { inTransaction = false; }
}
function saveKnowledgeFile(sha256, content) {
  if (!inTransaction) throw new Error("Knowledge originals must be saved inside the store transaction");
  connection().prepare("INSERT OR IGNORE INTO knowledge_files(sha256,content) VALUES(?,?)").run(sha256, content);
}
function readKnowledgeFile(sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256 || "")) return null;
  const row = connection().prepare("SELECT content FROM knowledge_files WHERE sha256=?").get(sha256);
  return row ? Buffer.from(row.content) : null;
}
function writeStore(store) {
  const db = connection();
  db.exec("BEGIN IMMEDIATE");
  try {
    const next=upgrade(initialize(store));
    if(process.env.NODE_ENV!=='test')require('./product-archive-integrity').assertProductArchivePreserved(readRawStore(),next);
    persist(next);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function resetStore(store) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Reset is only available in isolated tests");
  writeStore(store);
}
module.exports = { readStore, transaction, writeStore, resetStore, saveKnowledgeFile, readKnowledgeFile };

// PostgreSQL runtime keeps the legacy synchronous adapter for existing isolated tests.
if (process.env.STORE_ENGINE === 'postgres') module.exports = {...require('./capacity/postgres'), writeStore(){throw new Error('Use scoped transactions');}, resetStore(){throw new Error('Use isolated branch fixtures');}};
