// Reproduce the pool.connect is not a function error
const { Pool } = require('pg');
require('dotenv').config();

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

console.log('pool type:', typeof pool);
console.log('pool.query type:', typeof pool.query);
console.log('pool.connect type:', typeof pool.connect);
console.log('pool.connect is function:', typeof pool.connect === 'function');
console.log('pool.connect name:', pool.connect ? pool.connect.name : 'n/a');

// Try to get a client
async function test() {
  try {
    const client = await pool.connect();
    console.log('Got client:', !!client);
    client.release();
  } catch (err) {
    console.log('pool.connect error:', err.message);
  }
}

test();
