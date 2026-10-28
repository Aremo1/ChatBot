const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const result = originalLoad.apply(this, arguments);
  if (request === './db' || request === 'db') {
    console.log('=== utils/db.js required, pool keys:', Object.keys(result).join(', '));
    console.log('=== pool.query:', typeof result.query);
    console.log('=== pool.connect:', typeof result.connect);
  }
  return result;
};

const { initDb } = require('./src/utils/db');
console.log('initDb loaded');

(async () => {
  try {
    console.log('Calling initDb...');
    await initDb();
    console.log('initDb succeeded');
  } catch (e) {
    console.log('initDb failed:', e.message);
    console.log('stack:', e.stack);
  }
})();
