const fs = require('fs');
const path = require('path');
const {randomBytes, createHash} = require('crypto');
const {DatabaseSync} = require('node:sqlite');
let database;
const lifetimeMs = 8 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
function connection() {
  if(database)return database;
  const filename=process.env.STORE_AUTH_DB_PATH ||
    (process.env.NODE_ENV==='test'?':memory:':path.join(__dirname,'..','data','auth-sessions.sqlite'));
  if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
  database=new DatabaseSync(filename);
  database.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  if(filename!==':memory:')fs.chmodSync(filename,0o600);
  return database;
}
function issue(userId) {
  const token=randomBytes(32).toString('base64url');
  const db=connection();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token),userId,Date.now()+lifetimeMs);
  return token;
}
function get(token) {
  if(!token)return null;
  const row=connection().prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash = ?').get(digest(token));
  return row&&row.expires_at>Date.now()?{userId:row.user_id,expiresAt:row.expires_at}:null;
}
function revoke(token) {
  if(token)connection().prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
}
function revokeUser(userId) { connection().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); }
function close(){if(database){database.close();database=null;}}
module.exports={issue,get,revoke,revokeUser,close};

// PostgreSQL runtime keeps the legacy synchronous adapter for existing isolated tests.
if (process.env.STORE_ENGINE === 'postgres') { const pgAuth=require('./capacity/auth'); module.exports={issue:pgAuth.issue,get:pgAuth.get,revoke:pgAuth.revoke,revokeUser:pgAuth.revokeUser,close:async()=>{}}; }
