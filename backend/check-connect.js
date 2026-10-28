// Debug what the pg Pool actually exposes
const pg = require('pg');

// Test 1: plain Pool with no connection config
const pool1 = new pg.Pool({});
console.log('1. plain Pool:');
console.log('   connect type:', typeof pool1.connect);
console.log('   connect is function:', typeof pool1.connect === 'function');

// Test 2: disconnect existing clients and force a new connection
const pool2 = new pg.Pool({
  connectionString: 'postgresql://postgres:@localhost:5432/chatbot',
});
pool2.connect()
  .then(client => {
    console.log('2. pool with conn string: connected');
    client.release();
    return pool2.end();
  })
  .catch(err => {
    console.log('2. pool error (expected - no server):', err.code || err.message);
  })
  .finally(() => {
    setTimeout(() => {
      console.log('done');
    }, 100);
  });
