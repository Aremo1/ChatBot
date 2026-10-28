/**
 * Database initialization and schema setup.
 *
 * The SQLite store is created and migrated lazily by
 * `config/db-sqlite.js` on first use, so this hook only needs to open
 * the database once at boot to surface any failure early.
 */

const { openDb, DB_PATH } = require('../config/db-sqlite');

async function initDb() {
  await openDb();
  console.log(`✅ SQLite schema ready (${DB_PATH})`);
}

module.exports = { initDb };
