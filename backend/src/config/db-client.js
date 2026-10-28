/** Database client helper.

 * Uses PostgreSQL when available and the database is running. If the
 * PostgreSQL connection fails or no PostgreSQL server is configured,
 * falls back to SQLite so the local sign-in and chat flow works out
 * of the box without a dedicated database server.
 */

const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const { promisify } = require('util');

require('dotenv').config();

// Attempt to connect to PostgreSQL. If it fails (no server, auth error,
// etc.) we fall back to an SQLite store so the app remains usable.
let pg;
let poolError = null;

const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'chatbot',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pgPool.query('SELECT 1')
  .then(() => {
    console.log('Database pool connected (PostgreSQL)');
    pg = pgPool;
  })
  .catch((err) => {
    console.warn('PostgreSQL unavailable, falling back to SQLite:', err.message);
    poolError = err;
  });

const openDb = async () => {
  if (!dbPromise) {
    dbPromise = open({
      filename: path.join(__dirname, '../../local_users.db'),
      driver: sqlite3.Database,
    });
  }
  const db = dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      provider TEXT DEFAULT 'local',
      is_active BOOLEAN DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'direct',
      user1_id INTEGER NOT NULL,
      user2_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      is_read BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  return db;
};

let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = openDb();
  }
  return dbPromise;
}

async function getClient() {
  // Prefer PostgreSQL when it's available and the connection succeeded
  if (pg && !poolError) {
    return pg;
  }
  // Fall back to SQLite
  const db = await getDb();
  return {
    query: (sql, params) => db.all(sql, params),
    run: (sql, params) => db.run(sql, params),
    get: (sql, params) => db.get(sql, params),
    release: () => { /* no-op for SQLite */ },
    close: () => { if (dbPromise) dbPromise = null; },
  };
}

module.exports = pg;
module.exports.getClient = getClient;
