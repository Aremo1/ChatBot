/**
 * Admin API — lets an administrator add users and reset their
 * passwords, list accounts and toggle access. Every endpoint here
 * requires the caller's JWT to carry role === 'admin'.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getClient } = require('../config/db-sqlite');
const { requireAdmin, publicUser } = require('../utils/auth');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(requireAdmin);

// List accounts (optionally filtered by ?q=).
router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const client = await getClient();
    try {
      const result = q
        ? await client.query(
            'SELECT * FROM users WHERE name LIKE $1 OR email LIKE $1 ORDER BY created_at DESC LIMIT 100',
            ['%' + q + '%']
          )
        : await client.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 100');
      res.json({ success: true, users: result.rows.map(publicUser) });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin creates a user account (optionally with a chosen password;
// otherwise a temporary one is generated and emailed/returned).
router.post('/users', async (req, res) => {
  try {
    const { email, name, password, role = 'user' } = req.body || {};
    const trimmedEmail = String(email || '').trim().toLowerCase();
    const trimmedName = String(name || '').trim();

    if (!EMAIL_RE.test(trimmedEmail)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }
    if (!trimmedName) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (role !== 'user' && role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Role must be user or admin' });
    }

    const generated = !password;
    const rawPassword = password
      ? String(password)
      : crypto.randomBytes(9).toString('base64url');
    if (!generated && rawPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const hash = await bcrypt.hash(rawPassword, 10);
    const localId = Math.random().toString(36).slice(2) + Date.now().toString(36);

    const client = await getClient();
    try {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [trimmedEmail]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists' });
      }
      const result = await client.query(
        `INSERT INTO users (local_id, email, password_hash, name, provider, role, must_change_password, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'local', $5, $6, 1, NOW(), NOW()) RETURNING *`,
        [localId, trimmedEmail, hash, trimmedName, role, generated ? 1 : 0]
      );
      const user = result.rows[0];

      if (generated) {
        await sendMail({
          to: trimmedEmail,
          subject: 'Your Rhosam Chat account',
          text: [
            `Hi ${trimmedName},`,
            '',
            'An administrator created an account for you on Rhosam Chat.',
            `Your temporary password is: ${rawPassword}`,
            '',
            'You will be asked to change it after signing in.',
          ].join('\n'),
        });
      }

      res.json({
        success: true,
        user: publicUser(user),
        // Temporary password is returned to the admin so they can hand
        // it over directly when email is not configured.
        ...(generated ? { temporaryPassword: rawPassword } : {}),
        message: 'User created',
      });
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }
    console.error('Admin create user error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin resets a user's password (chosen or generated).
router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body || {};
    const generated = !password;
    const rawPassword = password
      ? String(password)
      : crypto.randomBytes(9).toString('base64url');
    if (rawPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const client = await getClient();
    try {
      const found = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (found.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      const target = found.rows[0];

      const hash = await bcrypt.hash(rawPassword, 10);
      await client.query(
        'UPDATE users SET password_hash = $1, must_change_password = $2, updated_at = NOW() WHERE id = $3',
        [hash, generated ? 1 : 0, target.id]
      );
      // Consume any outstanding reset codes for this account.
      await client.query('UPDATE password_resets SET used = 1 WHERE email = $1 AND used = 0', [target.email]);

      if (generated) {
        await sendMail({
          to: target.email,
          subject: 'Your password was reset',
          text: [
            `Hi ${target.name},`,
            '',
            'An administrator reset your Rhosam Chat password.',
            `Your temporary password is: ${rawPassword}`,
            '',
            'You will be asked to change it after signing in.',
          ].join('\n'),
        });
      }

      res.json({
        success: true,
        ...(generated ? { temporaryPassword: rawPassword } : {}),
        message: 'Password reset',
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Admin reset password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin updates account state (role / active flag / profile).
router.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, isActive, name } = req.body || {};
    const updates = [];
    const values = [];

    if (role !== undefined) {
      if (role !== 'user' && role !== 'admin') {
        return res.status(400).json({ success: false, message: 'Role must be user or admin' });
      }
      updates.push('role = $' + (values.length + 1));
      values.push(role);
    }
    if (isActive !== undefined) {
      updates.push('is_active = $' + (values.length + 1));
      values.push(isActive ? 1 : 0);
    }
    if (name) {
      updates.push('name = $' + (values.length + 1));
      values.push(String(name).trim());
    }
    if (updates.length === 0) {
      return res.json({ success: true, message: 'No changes' });
    }

    const client = await getClient();
    try {
      const found = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (found.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      // Do not let an admin lock themselves out or demote themselves.
      if (String(userId) === String(req.user.id)) {
        return res.status(400).json({ success: false, message: 'You cannot change your own account here' });
      }
      updates.push('updated_at = NOW()');
      values.push(userId);
      const result = await client.query(
        'UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + values.length + ' RETURNING *',
        values
      );
      res.json({ success: true, user: publicUser(result.rows[0]), message: 'User updated' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
