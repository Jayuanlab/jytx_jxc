const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

let database;
const normalize = (value) => String(value || '').normalize('NFKC').trim().toLowerCase();
function username(value) {
  const result = normalize(value);
  if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(result)) throw new Error('账号须为2至32位汉字、字母、数字或_.-');
  return result;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new Error('密码须为10至128位');
  return value;
}
function connection() {
  if (database) return database;
  const filename = process.env.STORE_CREDENTIALS_DB_PATH ||
    (process.env.NODE_ENV === 'test' ? ':memory:' : path.join(__dirname, '..', 'data', 'local-credentials.sqlite'));
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  database = new DatabaseSync(filename);
  database.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS credentials (user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)');
  if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  return database;
}
function hash(secret, salt) { return scryptSync(secret, Buffer.from(salt, 'hex'), 64); }
function getForUser(userId) {
  const row = connection().prepare('SELECT username FROM credentials WHERE user_id = ?').get(userId);
  return row ? { username: row.username } : null;
}
function list() { return connection().prepare('SELECT user_id,username FROM credentials ORDER BY username').all(); }
function set(userId, value, secret) {
  const name = username(value);
  password(secret);
  const db = connection();
  const existing = db.prepare('SELECT user_id FROM credentials WHERE username = ?').get(name);
  if (existing && existing.user_id !== userId) throw new Error('该登录账号已被使用');
  const salt = randomBytes(32).toString('hex');
  const digest = hash(secret, salt).toString('hex');
  db.prepare('INSERT INTO credentials(user_id,username,salt,password_hash,failures,locked_until) VALUES(?,?,?,?,0,0) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,salt=excluded.salt,password_hash=excluded.password_hash,failures=0,locked_until=0').run(userId, name, salt, digest);
  return { username: name };
}
function verify(value, secret) {
  let name;
  if (typeof secret !== 'string' || secret.length > 128) return { ok: false };
  try { name = username(value); } catch { return { ok: false }; }
  const db = connection();
  const row = db.prepare('SELECT * FROM credentials WHERE username = ?').get(name);
  if (!row) { hash(String(secret || ''), '00'.repeat(32)); return { ok: false }; }
  if (row.locked_until > Date.now()) return { ok: false, locked: true };
  const candidate = hash(String(secret || ''), row.salt);
  const valid = timingSafeEqual(candidate, Buffer.from(row.password_hash, 'hex'));
  if (!valid) {
    const failures = row.locked_until && row.locked_until <= Date.now() ? 1 : row.failures + 1;
    db.prepare('UPDATE credentials SET failures=?,locked_until=? WHERE user_id=?').run(failures, failures >= 5 ? Date.now() + 15 * 60 * 1000 : 0, row.user_id);
    return { ok: false, locked: failures >= 5 };
  }
  db.prepare('UPDATE credentials SET failures=0,locked_until=0 WHERE user_id=?').run(row.user_id);
  return { ok: true, userId: row.user_id };
}
function verifyForUser(userId, secret) {
  const row = connection().prepare('SELECT username FROM credentials WHERE user_id=?').get(userId);
  return row ? verify(row.username, secret).ok : false;
}
function generatePassword() { return randomBytes(15).toString('base64url'); }
function close() { if (database) { database.close(); database = null; } }
module.exports = { getForUser, list, set, verify, verifyForUser, generatePassword, close };

// PostgreSQL runtime keeps the legacy synchronous adapter for existing isolated tests.
if (process.env.STORE_ENGINE === 'postgres') { const pgAuth=require('./capacity/auth'); module.exports={getForUser:pgAuth.getForUser,set:pgAuth.set,verify:pgAuth.verify,verifyForUser:pgAuth.verifyForUser,generatePassword:pgAuth.generatePassword,close:async()=>{}}; }
