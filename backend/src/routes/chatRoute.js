/**
 * Chat routes (CRUD for chats)
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

// The "other" participant of a direct chat, from the caller's point of
// view. The parameter label must match the position of its first
// appearance in the final SQL, so it is generated per query.
function otherUserJoin(userIdParam) {
  return `LEFT JOIN users u ON u.id = CASE WHEN c.user1_id = $${userIdParam} THEN c.user2_id ELSE c.user1_id END`;
}

router.get('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const result = await client.query(
        `SELECT c.*, u.name AS other_user_name, u.avatar_url AS other_user_avatar,
           (SELECT COUNT(*) FROM messages m
             WHERE m.chat_id = c.id AND m.is_read = 0 AND m.sender_id <> $1) AS unread_count,
           (SELECT m2.content FROM messages m2
             WHERE m2.chat_id = c.id ORDER BY m2.id DESC LIMIT 1) AS last_message,
           (SELECT m3.created_at FROM messages m3
             WHERE m3.chat_id = c.id ORDER BY m3.id DESC LIMIT 1) AS last_message_at
         FROM chats c ${otherUserJoin(1)}
         WHERE c.user1_id = $1 OR c.user2_id = $1
         ORDER BY c.updated_at DESC`,
        [decoded.id]
      );
      res.json({ success: true, chats: result.rows });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/:chatId', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { chatId } = req.params;
    const client = await getClient();
    try {
      const chatResult = await client.query(
        'SELECT * FROM chats WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
        [chatId, decoded.id]
      );
      if (chatResult.rows.length === 0) return res.status(404).json({ message: 'Chat not found' });
      const chat = chatResult.rows[0];

      // Resolve the other participant (kept as a second query so the
      // $n placeholders always appear in ascending order — SQLite binds
      // array parameters by position of first appearance).
      const otherId = String(chat.user1_id) === String(decoded.id) ? chat.user2_id : chat.user1_id;
      const otherResult = await client.query('SELECT id, name, avatar_url FROM users WHERE id = $1', [otherId]);
      const other = otherResult.rows[0] || null;

      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = (page - 1) * limit;
      const messagesResult = await client.query(
        `SELECT m.*, u.name AS sender_name, u.avatar_url AS sender_avatar
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.chat_id = $1
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT $2 OFFSET $3`,
        [chatId, limit, offset]
      );
      res.json({
        success: true,
        chat: {
          ...chat,
          other_user_name: other ? other.name : null,
          other_user_avatar: other ? other.avatar_url : null,
        },
        messages: messagesResult.rows,
        pagination: { page, limit, hasMore: messagesResult.rows.length === limit },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { userId, otherUserId } = req.body;
    if (userId == null || otherUserId == null) {
      return res.status(400).json({ message: 'Missing userId or otherUserId' });
    }
    if (String(userId) !== String(decoded.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (String(userId) === String(otherUserId)) {
      return res.status(400).json({ message: 'Cannot chat with yourself' });
    }
    const client = await getClient();
    try {
      const other = await client.query('SELECT id FROM users WHERE id = $1 AND is_active = 1', [otherUserId]);
      if (other.rows.length === 0) return res.status(404).json({ message: 'User not found' });

      const existing = await client.query(
        'SELECT * FROM chats WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
        [userId, otherUserId]
      );
      if (existing.rows.length > 0) return res.json({ success: true, chat: existing.rows[0], message: 'Chat already exists' });

      const result = await client.query(
        "INSERT INTO chats (type, user1_id, user2_id, created_at, updated_at) VALUES ('direct', $1, $2, NOW(), NOW()) RETURNING *",
        [userId, otherUserId]
      );
      res.json({ success: true, chat: result.rows[0], message: 'Chat created' });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
