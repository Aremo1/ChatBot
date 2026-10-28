/**
 * User routes: people lookup, own-profile updates (profile picture,
 * privacy settings) — blocking-free.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { getClient } = require('../config/db-sqlite');
const { publicUser } = require('../utils/auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';

const AVATARS_DIR = path.join(__dirname, '../../uploads/avatars');
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const VISIBILITIES = ['everyone', 'contacts', 'nobody'];

function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

router.get('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'No token provided' });
    const client = await getClient();
    try {
      const q = String(req.query.q || '').trim();
      let result;
      if (q) {
        const like = '%' + q + '%';
        result = await client.query(
          `SELECT id, email, name, avatar_url, provider, is_active, created_at FROM users
           WHERE id != $1 AND is_active = 1 AND show_in_search = 1 AND (name LIKE $2 OR email LIKE $2)
           ORDER BY name ASC LIMIT 50`,
          [decoded.id, like]
        );
      } else {
        result = await client.query(
          `SELECT id, email, name, avatar_url, provider, is_active, created_at FROM users
           WHERE id != $1 AND is_active = 1 AND show_in_search = 1
           ORDER BY created_at DESC`,
          [decoded.id]
        );
      }
      res.json({ success: true, users: result.rows });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ------------------------------------------------------------------
// Update own profile: name / avatar / privacy settings
// ------------------------------------------------------------------
router.patch('/:userId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const { userId } = req.params;
    const { email, avatarUrl, name, oauthToken, refreshToken, lastEmailCheck,
      onlineStatus, onlineVisibility, showInSearch } = req.body;
    if (String(userId) !== String(decoded.id)) return res.status(403).json({ message: 'Access denied' });

    const updates = [];
    const values = [];
    if (email) { updates.push('email = $' + (values.length + 1)); values.push(email); }
    if (avatarUrl) { updates.push('avatar_url = $' + (values.length + 1)); values.push(avatarUrl); }
    if (name) { updates.push('name = $' + (values.length + 1)); values.push(name); }
    if (oauthToken) { updates.push('oauth_token = $' + (values.length + 1)); values.push(oauthToken); }
    if (refreshToken) { updates.push('oauth_refresh_token = $' + (values.length + 1)); values.push(refreshToken); }
    if (lastEmailCheck) { updates.push('last_email_check = $' + (values.length + 1)); values.push(new Date(lastEmailCheck)); }

    if (onlineStatus !== undefined) {
      updates.push('online_status = $' + (values.length + 1));
      values.push(onlineStatus ? 1 : 0);
    }
    if (onlineVisibility !== undefined) {
      if (!VISIBILITIES.includes(onlineVisibility)) {
        return res.status(400).json({ message: 'onlineVisibility must be everyone, contacts or nobody' });
      }
      updates.push('online_visibility = $' + (values.length + 1));
      values.push(onlineVisibility);
    }
    if (showInSearch !== undefined) {
      updates.push('show_in_search = $' + (values.length + 1));
      values.push(showInSearch ? 1 : 0);
    }

    if (updates.length === 0) return res.json({ success: true, message: 'No changes' });
    updates.push('updated_at = NOW()');
    values.push(userId);
    const client = await getClient();
    try {
      const result = await client.query(
        'UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + values.length + ' RETURNING *',
        values
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

      // Presence rules may have changed — push fresh rosters out.
      if (onlineStatus !== undefined || onlineVisibility !== undefined) {
        try {
          const { broadcastPresence } = require('../socket/socketHandler');
          broadcastPresence().catch((e) => console.error('Presence broadcast failed:', e.message));
        } catch (e) {
          console.error('Presence broadcast unavailable:', e.message);
        }
      }

      res.json({ success: true, user: publicUser(result.rows[0]), message: 'User updated' });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ------------------------------------------------------------------
// Upload a profile picture (data URL in JSON; stored on disk and
// served from /uploads/avatars/…)
// ------------------------------------------------------------------
router.post('/me/avatar', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'Invalid token' });

    const { avatar } = req.body || {};
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(avatar || ''));
    if (!match) {
      return res.status(400).json({ success: false, message: 'Send a PNG, JPEG, WebP or GIF data URL' });
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
      return res.status(400).json({ success: false, message: 'Image must be between 1 byte and 2 MB' });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
    const filename = `u${decoded.id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(AVATARS_DIR, filename), buffer);
    const avatarUrl = `/uploads/avatars/${filename}`;

    const client = await getClient();
    try {
      const found = await client.query('SELECT avatar_url FROM users WHERE id = $1', [decoded.id]);
      if (found.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      const previous = found.rows[0].avatar_url;
      await client.query(
        'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
        [avatarUrl, decoded.id]
      );
      // Best-effort cleanup of the previous uploaded picture.
      if (previous && previous.startsWith('/uploads/avatars/')) {
        try { fs.unlinkSync(path.join(__dirname, '../..', previous)); } catch (e) { /* ignore */ }
      }
      res.json({ success: true, avatarUrl, message: 'Profile picture updated' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Avatar upload error:', err.message);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

module.exports = router;
