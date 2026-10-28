/**
 * Rhosam ChatBot Backend
 * Express + Socket.IO server with Google OAuth and Gmail API integration
 */

const { app, server } = require('./app');
const { initDb } = require('./utils/db');
const { getClient } = require('./config/db-sqlite');
const bcrypt = require('bcrypt');

const PORT = process.env.PORT || 4000;

/**
 * Make sure an admin account exists so someone can add users and
 * reset passwords. If ADMIN_EMAIL/ADMIN_PASSWORD are set in the
 * environment the account is created (or updated) on every boot.
 */
async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const client = await getClient();
  try {
    const trimmed = String(email).trim().toLowerCase();
    const existing = await client.query('SELECT * FROM users WHERE email = $1', [trimmed]);
    const hash = await bcrypt.hash(String(password), 10);

    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO users (local_id, email, password_hash, name, provider, role, must_change_password, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'local', 'admin', 0, 1, NOW(), NOW())`,
        [Math.random().toString(36).slice(2) + Date.now().toString(36), trimmed, hash, process.env.ADMIN_NAME || 'Administrator']
      );
      console.log(`🛂 Admin account created for ${trimmed}`);
    } else if (existing.rows[0].role !== 'admin' || existing.rows[0].password_hash !== hash) {
      await client.query(
        "UPDATE users SET role = 'admin', password_hash = $1, is_active = 1, must_change_password = 0, updated_at = NOW() WHERE id = $2",
        [hash, existing.rows[0].id]
      );
      console.log(`🛂 Admin account ensured for ${trimmed}`);
    }
  } finally {
    client.release();
  }
}

// Initialize database
initDb()
  .then(() => bootstrapAdmin())
  .then(async () => {
    console.log('✅ Database connected');
    // Fail loudly (at boot) if SMTP is misconfigured.
    try {
      const { verifyMail } = require('./utils/mailer');
      await verifyMail();
    } catch (e) {
      console.error('SMTP check failed:', e.message);
    }
    server.listen(PORT, () => {
      console.log(`🚀 ChatBot server running on http://localhost:${PORT}`);
      console.log(`🔌 Socket.io ready`);
    });
  })
  .catch((err) => {
    console.error('❌ Database initialization failed:', err.message);
    process.exit(1);
  });

module.exports = { app, server };
