/**
 * Local auth routes (email + password sign-in/sign-up/sign-out,
 * password reset with a 6-digit emailed OTP, and people search).
 * Self-hosted provider so anyone can create an account and chat.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getClient } = require('../config/db-sqlite');
const { signToken, verifyToken, publicUser } = require('../utils/auth');
const { sendMail, canExposeOtp, htmlShell } = require('../utils/mailer');

const router = express.Router();

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

function generateLocalId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badEmail(email) {
  return !email || !EMAIL_RE.test(String(email).trim().toLowerCase());
}

// ------------------------------------------------------------------
// Sign-up
// ------------------------------------------------------------------
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: 'Missing email, password or name',
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const normalizedName = String(name).trim();

    if (badEmail(trimmedEmail)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const localId = generateLocalId();

    const client = await getClient();
    try {
      const result = await client.query(
        `INSERT INTO users (local_id, email, password_hash, name, provider, role, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'local', 'user', 1, NOW(), NOW()) RETURNING *`,
        [localId, trimmedEmail, hashedPassword, normalizedName]
      );
      const user = result.rows[0];
      res.json({
        success: true,
        user: publicUser(user),
        token: signToken(user),
        message: 'Account created successfully',
      });
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }
    console.error('Local signup error:', err);
    res.status(500).json({ success: false, message: 'Sign-up failed' });
  }
});

// ------------------------------------------------------------------
// Sign-in
// ------------------------------------------------------------------
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing email or password',
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const client = await getClient();
    try {
      const result = await client.query('SELECT * FROM users WHERE email = $1', [trimmedEmail]);
      const user = result.rows[0];

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      if (user.is_active !== 1) {
        return res.status(403).json({
          success: false,
          message: 'This account has been disabled. Contact an administrator to reactivate it.',
        });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      res.json({
        success: true,
        user: publicUser(user),
        token: signToken(user),
        message: 'Welcome back!',
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Local signin error:', err);
    res.status(500).json({ success: false, message: 'Sign-in failed' });
  }
});

// ------------------------------------------------------------------
// Sign-out. Tokens are stateless (JWT), so the client discards its
// copy; this endpoint exists so the UI has a real API to call and so
// future token blacklisting has a home.
// ------------------------------------------------------------------
router.post('/signout', (req, res) => {
  res.json({ success: true, message: 'Signed out' });
});

// ------------------------------------------------------------------
// Current user (Bearer token first, legacy localId header as fallback)
// ------------------------------------------------------------------
router.get('/me', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    const client = await getClient();
    try {
      let user = null;
      if (decoded) {
        const r = await client.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
        user = r.rows[0];
      } else if (req.headers.localid) {
        const r = await client.query('SELECT * FROM users WHERE local_id = $1', [req.headers.localid]);
        user = r.rows[0];
      }
      if (!user) return res.status(401).json({ success: false, message: 'Missing session' });
      res.json({ success: true, user: publicUser(user) });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Local me error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ------------------------------------------------------------------
// Change password (signed in)
// ------------------------------------------------------------------
router.post('/change-password', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'Invalid token' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Missing current or new password' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    const client = await getClient();
    try {
      const r = await client.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
      const user = r.rows[0];
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      const valid = await bcrypt.compare(String(currentPassword), user.password_hash);
      if (!valid) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      const hash = await bcrypt.hash(String(newPassword), 10);
      await client.query(
        'UPDATE users SET password_hash = $1, must_change_password = 0, updated_at = NOW() WHERE id = $2',
        [hash, user.id]
      );
      res.json({ success: true, message: 'Password updated' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ------------------------------------------------------------------
// Password reset — step 1: email a 6-digit OTP
// ------------------------------------------------------------------
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (badEmail(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }
    const trimmedEmail = String(email).trim().toLowerCase();
    const client = await getClient();
    try {
      const r = await client.query('SELECT id, name FROM users WHERE email = $1 AND is_active = 1', [trimmedEmail]);
      // Always answer success so the endpoint cannot be used to probe
      // which emails are registered.
      if (r.rows.length === 0) {
        return res.json({ success: true, message: 'If that account exists, a reset code has been sent.' });
      }

      const recent = await client.query(
        "SELECT created_at FROM password_resets WHERE email = $1 AND used = 0 ORDER BY id DESC LIMIT 1",
        [trimmedEmail]
      );
      if (recent.rows.length > 0) {
        const last = Date.parse(recent.rows[0].created_at + 'Z') || 0;
        const ageSeconds = (Date.now() - last) / 1000;
        if (ageSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
          return res.status(429).json({
            success: false,
            message: `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - ageSeconds)}s before requesting another code`,
          });
        }
      }

      const code = crypto.randomInt(100000, 1000000).toString();
      const hashedCode = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

      await client.query(
        'INSERT INTO password_resets (email, code, expires_at, attempts, used, created_at) VALUES ($1, $2, $3, 0, 0, NOW())',
        [trimmedEmail, hashedCode, expiresAt]
      );

      const { mocked } = await sendMail({
        to: trimmedEmail,
        subject: 'Your Rhosam Chat password reset code',
        text: [
          `Hi ${r.rows[0].name || ''},`,
          '',
          `Your password reset code is: ${code}`,
          '',
          `It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
        ].join('\n'),
        html: htmlShell('Reset your password', [
          `Hi ${r.rows[0].name || ''},`,
          `Your 6-digit code is: <strong style="font-size:22px;letter-spacing:6px;color:#0f172a">${code}</strong>`,
          `It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
        ]),
      });

      res.json({
        success: true,
        message: 'If that account exists, a reset code has been sent.',
        // Exposed only when SMTP is not configured (local dev/tests).
        ...(canExposeOtp() ? { devCode: code, devMocked: mocked } : {}),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ------------------------------------------------------------------
// Password reset — step 2: verify the OTP
// ------------------------------------------------------------------
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (badEmail(email) || !code) {
      return res.status(400).json({ success: false, message: 'Email and code are required' });
    }
    const trimmedEmail = String(email).trim().toLowerCase();
    const client = await getClient();
    try {
      const r = await client.query(
        'SELECT * FROM password_resets WHERE email = $1 AND used = 0 ORDER BY id DESC LIMIT 1',
        [trimmedEmail]
      );
      const record = r.rows[0];
      if (!record) {
        return res.status(400).json({ success: false, message: 'No reset code requested. Start again.' });
      }
      if (Date.parse(record.expires_at) < Date.now()) {
        return res.status(400).json({ success: false, message: 'That code has expired. Request a new one.' });
      }
      if (record.attempts >= OTP_MAX_ATTEMPTS) {
        return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.' });
      }

      const ok = await bcrypt.compare(String(code).trim(), record.code);
      if (!ok) {
        await client.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [record.id]);
        const attemptsLeft = OTP_MAX_ATTEMPTS - (record.attempts + 1);
        return res.status(400).json({
          success: false,
          message: `Incorrect code. ${Math.max(attemptsLeft, 0)} attempts left.`,
        });
      }

      await client.query('UPDATE password_resets SET used = 1 WHERE id = $1', [record.id]);

      const userResult = await client.query('SELECT * FROM users WHERE email = $1', [trimmedEmail]);
      const user = userResult.rows[0];
      // Short-lived token that only authorizes a password reset.
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../utils/auth');
      const resetToken = jwt.sign(
        { id: user.id, purpose: 'reset' },
        JWT_SECRET,
        { expiresIn: '15m' }
      );
      res.json({ success: true, resetToken, message: 'Code verified' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ------------------------------------------------------------------
// Password reset — step 3: set the new password
// ------------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, password } = req.body || {};
    if (!resetToken || !password) {
      return res.status(400).json({ success: false, message: 'Reset token and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../utils/auth');
    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Reset link is invalid or expired' });
    }
    if (decoded.purpose !== 'reset') {
      return res.status(401).json({ success: false, message: 'Invalid reset token' });
    }

    const client = await getClient();
    try {
      const hash = await bcrypt.hash(String(password), 10);
      await client.query(
        'UPDATE users SET password_hash = $1, must_change_password = 0, updated_at = NOW() WHERE id = $2',
        [hash, decoded.id]
      );
      await client.query(
        "UPDATE password_resets SET used = 1 WHERE email = (SELECT email FROM users WHERE id = $1) AND used = 0",
        [decoded.id]
      );
      res.json({ success: true, message: 'Password has been reset. You can sign in now.' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ------------------------------------------------------------------
// People search — manually find and add other users.
// Requires a signed-in caller; returns each person's relationship to
// the caller (none / pending_out / pending_in / connected) so the UI
// can offer the right action.
// ------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'Invalid token' });

    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const client = await getClient();
    try {
      const rows = q
        ? await client.query(
            `SELECT id, email, name, avatar_url, provider FROM users
             WHERE is_active = 1 AND show_in_search = 1 AND id != $1 AND (name LIKE $2 OR email LIKE $2)
             ORDER BY name ASC LIMIT $3`,
            [decoded.id, '%' + q + '%', limit]
          )
        : await client.query(
            `SELECT id, email, name, avatar_url, provider FROM users
             WHERE is_active = 1 AND show_in_search = 1 AND id != $1
             ORDER BY name ASC LIMIT $2`,
            [decoded.id, limit]
          );

      const users = [];
      for (const u of rows.rows) {
        const rel = await client.query(
          `SELECT id, status, sender_id FROM requests
           WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
           ORDER BY id DESC LIMIT 1`,
          [decoded.id, u.id]
        );
        let connection = 'none';
        const pending = rel.rows[0];
        if (pending && pending.status === 'pending') {
          connection = String(pending.sender_id) === String(decoded.id) ? 'pending_out' : 'pending_in';
        } else if (pending && pending.status === 'accepted') {
          connection = 'connected';
        }
        users.push({ ...u, connection });
      }

      res.json({ success: true, users });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Local users error:', err);
    res.status(500).json({ success: false, message: 'Failed to load users' });
  }
});

module.exports = router;
