/**
 * Notifications API — persisted inbox for requests, accepts and
 * new messages, with unread counts and mark-as-read.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { getClient } = require('../config/db-sqlite');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';

function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// List my notifications (newest first) plus unread count.
router.get('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const result = await client.query(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
        [decoded.id]
      );
      const counts = await client.query(
        'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = 0',
        [decoded.id]
      );
      res.json({
        success: true,
        notifications: result.rows,
        unread: Number(counts.rows[0].unread) || 0,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('List notifications error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Mark notifications as read. Body: { ids?: number[] } — empty marks all.
router.post('/read', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { ids } = req.body || {};
    const client = await getClient();
    try {
      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map((_, i) => '$' + (i + 2)).join(', ');
        await client.query(
          `UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND id IN (${placeholders})`,
          [decoded.id, ...ids]
        );
      } else {
        await client.query('UPDATE notifications SET is_read = 1 WHERE user_id = $1', [decoded.id]);
      }
      const counts = await client.query(
        'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = 0',
        [decoded.id]
      );
      res.json({ success: true, unread: Number(counts.rows[0].unread) || 0 });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Read notifications error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
