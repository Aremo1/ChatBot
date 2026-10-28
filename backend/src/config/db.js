/**
 * Database connection configuration
 */

const { Pool } = require('pg');
const { config } = require('dotenv');
const path = require('path');

// Load the backend's .env file explicitly (the server may boot from any
// working directory, and dotenv by default searches up from process.cwd()
// which would miss the backend/.env file when started from the project root).
config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'chatbot',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.query('SELECT 1')
  .then(() => console.log('Database pool connected'))
  .catch((err) => console.error('Database pool connection error:', err.message));

/** Acquire a client from the pool. */
async function getClient() {
  return pool.connect();
}

module.exports = pool;
module.exports.getClient = getClient;
