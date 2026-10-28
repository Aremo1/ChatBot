/**
 * Creates/migrates the SQLite schema. Run with: npm run setup-db
 */

const { initDb } = require('../utils/db');

initDb()
  .then(() => {
    console.log('Database setup complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Database setup failed:', err.message);
    process.exit(1);
  });
