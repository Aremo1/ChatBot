// Trace the module loading chain
const Module = require('module');
const fs = require('fs');

// Patch Module._load to trace
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  console.log('  requiring:', request, 'from:', parent ? parent.filename : '<entry>');
  try {
    return originalLoad.apply(this, arguments);
  } catch (err) {
    console.log('  ERROR requiring', request, ':', err.message);
    throw err;
  }
};

console.log('=== Loading db.js ===');
const db = require('./src/config/db');
console.log('=== db loaded, type:', typeof db);
console.log('=== dbkeys:', Object.keys(db));
console.log('=== db.query:', typeof db.query);
console.log('=== db.connect:', typeof db.connect);

// Now check the exported functions
console.log('=== Testing getClient-like behavior ===');
const clients = [];
(async () => {
  for (let i = 0; i < 2; i++) {
    const c = await db.connect();
    clients.push(c);
    console.log(`connect #${i} returned:`, typeof c.query);
  }
  clients.forEach(c => c.release());
  console.log('All connections released');
})().catch(e => console.error('connect error:', e.message));
