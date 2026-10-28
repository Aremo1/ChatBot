/**
 * Message routes (CRUD for messages)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { getClient } = require('../config/db-sqlite');
const { emitToUser, createNotification } = require('../utils/notify');

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

// Load the participants of a chat so we know who to notify/emit to.
async function getParticipants(client, chatId) {
  const result = await client.query('SELECT id, user1_id, user2_id FROM chats WHERE id = $1', [chatId]);
  return result.rows[0] || null;
}

router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { chatId, content, type = 'text' } = req.body;
    if (!chatId || !content || !String(content).trim()) {
      return res.status(400).json({ message: 'Missing chatId or content' });
    }
    const client = await getClient();
    try {
      const chat = await getParticipants(client, chatId);
      if (!chat) return res.status(404).json({ message: 'Chat not found' });
      const isMember =
        String(chat.user1_id) === String(decoded.id) || String(chat.user2_id) === String(decoded.id);
      if (!isMember) return res.status(403).json({ message: 'Access denied' });

      const result = await client.query(
        'INSERT INTO messages (chat_id, sender_id, content, message_type, is_read, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW()) RETURNING *',
        [chatId, decoded.id, String(content).trim(), type]
      );
      const message = result.rows[0];

      // Keep the chat list ordered by most recent activity.
      await client.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);

      const sender = await client.query('SELECT id, name, avatar_url FROM users WHERE id = $1', [decoded.id]);
      const enriched = {
        ...message,
        sender_name: sender.rows[0] ? sender.rows[0].name : decoded.name,
        sender_avatar: sender.rows[0] ? sender.rows[0].avatar_url : null,
        senderId: message.sender_id,
      };

      // Real-time delivery to both participants (skip the sender — the
      // sender appends the message from the HTTP response itself).
      const otherId =
        String(chat.user1_id) === String(decoded.id) ? chat.user2_id : chat.user1_id;
      emitToUser(otherId, 'new_message', enriched);
      emitToUser(decoded.id, 'new_message_self', enriched);

      await createNotification(
        otherId,
        'message',
        'New message',
        `${enriched.sender_name}: ${String(content).slice(0, 60)}`,
        { chatId: chat.id, messageId: message.id }
      );

      res.json({ success: true, message: enriched });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Send message error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { chatId } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    if (!chatId) return res.status(400).json({ message: 'Missing chatId' });
    const client = await getClient();
    try {
      const chat = await getParticipants(client, chatId);
      if (!chat) return res.status(404).json({ message: 'Chat not found' });
      const isMember =
        String(chat.user1_id) === String(decoded.id) || String(chat.user2_id) === String(decoded.id);
      if (!isMember) return res.status(403).json({ message: 'Access denied' });

      const result = await client.query(
        `SELECT m.*, u.name AS sender_name, u.avatar_url AS sender_avatar
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.chat_id = $1
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT $2 OFFSET $3`,
        [chatId, limit, (page - 1) * limit]
      );
      const countResult = await client.query(
        'SELECT COUNT(*) AS total FROM messages WHERE chat_id = $1',
        [chatId]
      );
      res.json({
        success: true,
        messages: result.rows,
        count: Number(countResult.rows[0].total) || 0,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('List messages error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.patch('/:messageId/read', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { messageId } = req.params;
    const client = await getClient();
    try {
      const existing = await client.query('SELECT * FROM messages WHERE id = $1', [messageId]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: 'Message not found' });
      }
      const message = existing.rows[0];
      // Only the non-sender may mark a message as read.
      if (String(message.sender_id) === String(decoded.id)) {
        return res.json({ success: true, message, alreadyRead: true });
      }
      const chat = await getParticipants(client, message.chat_id);
      if (!chat || (String(chat.user1_id) !== String(decoded.id) && String(chat.user2_id) !== String(decoded.id))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      await client.query('UPDATE messages SET is_read = 1, updated_at = NOW() WHERE id = $1', [messageId]);
      const updated = { ...message, is_read: 1 };

      // Tell the sender their message was read.
      emitToUser(message.sender_id, 'message_read', { messageId: message.id, chatId: message.chat_id });

      // Reading a message also clears its "new message" notification.
      await client.query(
        `UPDATE notifications SET is_read = 1
         WHERE user_id = $1 AND type = 'message'
           AND CAST(json_extract(data, '$.chatId') AS TEXT) = $2`,
        [decoded.id, String(message.chat_id)]
      );

      res.json({ success: true, message: updated });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Mark read error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ------------------------------------------------------------------
// Edit a message (sender only).
// ------------------------------------------------------------------
router.patch('/:messageId/edit', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { content } = req.body || {};
    if (!content || !String(content).trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }
    const client = await getClient();
    try {
      const found = await client.query('SELECT * FROM messages WHERE id = $1', [req.params.messageId]);
      if (found.rows.length === 0) return res.status(404).json({ message: 'Message not found' });
      const message = found.rows[0];
      if (String(message.sender_id) !== String(decoded.id)) {
        return res.status(403).json({ message: 'Only the sender can edit a message' });
      }
      await client.query(
        'UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2',
        [String(content).trim(), message.id]
      );
      const updated = { ...message, content: String(content).trim(), is_edited: 1 };
      const chat = await getParticipants(client, message.chat_id);
      if (chat) {
        const otherId = String(chat.user1_id) === String(decoded.id) ? chat.user2_id : chat.user1_id;
        emitToUser(otherId, 'message_edited', updated);
        emitToUser(decoded.id, 'message_edited', updated);
      }
      res.json({ success: true, message: updated });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Edit message error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ------------------------------------------------------------------
// Delete a message (sender or chat member).
// ------------------------------------------------------------------
router.delete('/:messageId', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const found = await client.query('SELECT * FROM messages WHERE id = $1', [req.params.messageId]);
      if (found.rows.length === 0) return res.status(404).json({ message: 'Message not found' });
      const message = found.rows[0];
      const chat = await getParticipants(client, message.chat_id);
      const isMember = chat &&
        (String(chat.user1_id) === String(decoded.id) || String(chat.user2_id) === String(decoded.id));
      if (!isMember) return res.status(403).json({ message: 'Access denied' });

      await client.query('DELETE FROM messages WHERE id = $1', [message.id]);
      if (chat) {
        const otherId = String(chat.user1_id) === String(decoded.id) ? chat.user2_id : chat.user1_id;
        emitToUser(otherId, 'message_deleted', { messageId: message.id, chatId: message.chat_id });
        emitToUser(decoded.id, 'message_deleted', { messageId: message.id, chatId: message.chat_id });
      }
      res.json({ success: true, message: { ...message, deleted: true } });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Delete message error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
