/**
 * SQLite database client helper for local auth + chat storage.
 *
 * This is the SINGLE source of truth for every route (auth, users,
 * chats, messages, requests, notifications). It exposes a pg-style
 * client so route handlers can keep using `result.rows`, `$n`
 * placeholders and `NOW()` — those are translated to SQLite here.
 *
 * SQLite binds `?` parameters by position, while Postgres binds by
 * number. Routes may reference the same parameter twice (e.g. a LIKE
 * used on two columns) or out of order, so `$n` placeholders are
 * rewritten to `?` in order of *first appearance* and the parameter
 * array is re-ordered to match. That keeps query code portable.
 */

const sqlite3 = require('sqlite3');
const path = require('path');

// One shared database file used by every module. Override for tests
// with LOCAL_DB_PATH (absolute or relative to process.cwd()).
const DB_PATH = process.env.LOCAL_DB_PATH
  ? path.resolve(process.env.LOCAL_DB_PATH)
  : path.join(__dirname, '../../local_users.db');

let dbPromise = null;

function execAsync(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT DEFAULT '',
    provider TEXT DEFAULT 'local',
    role TEXT DEFAULT 'user',
    must_change_password INTEGER DEFAULT 0,
    online_status INTEGER DEFAULT 1,
    online_visibility TEXT DEFAULT 'everyone',
    show_in_search INTEGER DEFAULT 1,
    google_id TEXT,
    oauth_token TEXT,
    oauth_refresh_token TEXT,
    last_email_check TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'direct',
    name TEXT,
    user1_id INTEGER NOT NULL,
    user2_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT DEFAULT '',
    body TEXT DEFAULT '',
    data TEXT DEFAULT '{}',
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS chat_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    UNIQUE(chat_id, user_id),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS gmail_tokens (
    user_id INTEGER PRIMARY KEY,
    token TEXT,
    refresh_token TEXT,
    expiry_date TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_members_chat ON chat_members(chat_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id)`,
];

// Columns added after the first release — applied with ALTER TABLE
// when missing so existing databases keep working.
const COLUMN_MIGRATIONS = [
  ['users', 'google_id', 'TEXT'],
  ['users', 'oauth_token', 'TEXT'],
  ['users', 'oauth_refresh_token', 'TEXT'],
  ['users', 'last_email_check', 'TEXT'],
  ['users', 'role', `TEXT DEFAULT 'user'`],
  ['users', 'must_change_password', 'INTEGER DEFAULT 0'],
  ['users', 'online_status', 'INTEGER DEFAULT 1'],
  ['users', 'online_visibility', `TEXT DEFAULT 'everyone'`],
  ['users', 'show_in_search', 'INTEGER DEFAULT 1'],
  ['chats', 'name', 'TEXT'],
  ['messages', 'attachment_url', 'TEXT'],
  ['messages', 'attachment_name', 'TEXT'],
  ['messages', 'attachment_mime', 'TEXT'],
  ['messages', 'attachment_size', 'INTEGER'],
];

async function ensureColumns(db) {
  for (const [table, column, type] of COLUMN_MIGRATIONS) {
    const cols = await new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(${table})`, (err, rows) =>
        err ? reject(err) : resolve(rows || [])
      );
    });
    if (!cols.some((c) => c.name === column)) {
      await execAsync(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}

async function openDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await new Promise((resolve, reject) => {
        const handle = new sqlite3.Database(DB_PATH, (err) =>
          err ? reject(err) : resolve(handle)
        );
      });
      for (const sql of SCHEMA) {
        await execAsync(db, sql);
      }
      await ensureColumns(db);
      return db;
    })().catch((err) => {
      dbPromise = null; // allow retry on next request
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Translate Postgres-isms into SQLite:
 *  - NOW()          -> datetime('now')
 *  - $n placeholders -> one `?` per *occurrence*, plus the list of
 *    original parameter indexes in occurrence order. A parameter can
 *    be referenced several times (e.g. `name LIKE $2 OR email LIKE
 *    $2`), so each `?` must be bound to the value for its own `$n`.
 */
function translate(sql) {
  let out = String(sql).replace(/\bNOW\(\)/gi, "datetime('now')");
  if (!/\$\d+/.test(out)) return { sql: out, occ: null };
  const occ = [];
  out = out.replace(/\$(\d+)/g, (_m, digits) => {
    occ.push(parseInt(digits, 10));
    return '?';
  });
  return { sql: out, occ };
}

/** Expand the caller's params to one value per placeholder occurrence. */
function bindParams(params, occ) {
  if (!occ) return params;
  const list = Array.isArray(params) ? params : [];
  return occ.map((n) => list[n - 1]);
}

async function getClient() {
  const db = await openDb();

  return {
    query: (sql, params = []) =>
      new Promise((resolve, reject) => {
        const t = translate(sql);
        db.all(t.sql, bindParams(params, t.occ), (err, rows) => {
          if (err) reject(err);
          else resolve({ rows: rows || [] });
        });
      }),
    run: (sql, params = []) =>
      new Promise((resolve, reject) => {
        const t = translate(sql);
        db.run(t.sql, bindParams(params, t.occ), function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        });
      }),
    get: (sql, params = []) =>
      new Promise((resolve, reject) => {
        const t = translate(sql);
        db.get(t.sql, bindParams(params, t.occ), (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      }),
    release: () => { /* no-op for SQLite */ },
    close: () => { dbPromise = null; },
  };
}

module.exports = { getClient, DB_PATH, openDb };
