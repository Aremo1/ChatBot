/**
 * Authentication routes (Google OAuth + local login)
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { getClient } = require('../config/db-sqlite');
const crypto = require('crypto');

const randomSecret = () => crypto.randomBytes(24).toString('hex');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function generateToken(user) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider
  }, JWT_SECRET, { expiresIn: '7d' });
}

async function createOrGetUser({ googleId, email, name, avatarUrl, oauthToken, refreshToken }) {
  const client = await getClient();
  try {
    const existing = await client.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    if (existing.rows.length > 0) return existing.rows[0];
    const passwordHash = await bcrypt.hash(randomSecret(), 10);
    const result = await client.query('INSERT INTO users (email, password_hash, name, avatar_url, provider, google_id, oauth_token, oauth_refresh_token, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NOW(), NOW()) RETURNING *', [email, passwordHash, name, avatarUrl, 'google', googleId, oauthToken, refreshToken]);
    return result.rows[0];
  } finally {
    client.release();
  }
}

router.post('/google/register', async (req, res) => {
  try {
    const { idToken, name, avatarUrl, oauthToken, refreshToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'Missing idToken' });
    const ticket = await oauth2Client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const picture = payload.picture;
    const user = await createOrGetUser({ googleId, email, name: name || payload.name, avatarUrl: picture || avatarUrl, oauthToken, refreshToken });
    const token = generateToken(user);
    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url }, token, message: 'Account created successfully with Google' });
  } catch (err) {
    console.error('Google register error:', err.message);
    res.status(500).json({ message: 'Google authentication failed', error: err.message });
  }
});

router.post('/google/login', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'Missing idToken' });
    const ticket = await oauth2Client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const picture = payload.picture;
    const client = await getClient();
    try {
      const result = await client.query('SELECT * FROM users WHERE google_id = $1 AND is_active = true', [googleId]);
      if (result.rows.length === 0) return res.status(401).json({ message: 'User not found. Please register with Google first.' });
      const user = result.rows[0];
      await client.query('UPDATE users SET updated_at = NOW() WHERE id = $1', [user.id]);
      const token = generateToken(user);
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url }, token, message: 'Welcome back!' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Google login error:', err.message);
    res.status(500).json({ message: 'Google authentication failed', error: err.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const client = await getClient();
    try {
      const result = await client.query('SELECT * FROM users WHERE id = $1 AND is_active = 1', [decoded.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
      const { publicUser } = require('../utils/auth');
      res.json({ success: true, user: publicUser(result.rows[0]) });
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ message: 'Invalid token' });
    if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'Token expired' });
    console.error('Get me error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/gmail/refresh-token', async (req, res) => {
  try {
    const { refreshToken, userId } = req.body;
    if (!refreshToken || !userId) return res.status(400).json({ message: 'Missing refreshToken or userId' });
    const client = await getClient();
    try {
      const result = await client.query('UPDATE users SET oauth_refresh_token = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, avatar_url', [refreshToken, userId]);
      if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
      res.json({ success: true, user: result.rows[0], message: 'Google token refreshed successfully' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Refresh token error:', err.message);
    res.status(500).json({ message: 'Failed to refresh token', error: err.message });
  }
});

router.post('/gmail/start-session', async (req, res) => {
  try {
    const { email, scope = 'https://www.googleapis.com/auth/gmail.modify' } = req.body;
    const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scope.split(' '), prompt: 'consent', include_granted_scopes: false });
    const client = await getClient();
    try {
    const result = await client.query("INSERT INTO users (email, password_hash, name, provider, google_id, is_active, created_at, updated_at) VALUES ($1, $2, $3, 'google_oauth', $4, 1, NOW(), NOW()) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, provider = 'google_oauth', google_id = COALESCE(users.google_id, EXCLUDED.google_id), updated_at = NOW() RETURNING id, email, name, avatar_url", [email, bcrypt.hash(randomSecret(), 10), email, email]);
    res.json({ success: true, authUrl, sessionId: result.rows[0].id, message: 'Please complete Google OAuth in your browser' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Start session error:', err.message);
    res.status(500).json({ message: 'Failed to start Google session', error: err.message });
  }
});

module.exports = router;