// Check what db.js actually exports
const p = require('./src/config/db');
console.log('has query:', typeof p.query);
console.log('has connect:', typeof p.connect);
console.log('exports:', JSON.stringify(p));
