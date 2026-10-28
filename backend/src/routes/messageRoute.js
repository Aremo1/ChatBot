/**
 * Message routes (send/list/read/edit/delete) for direct and group
 * chats, including attachment metadata for uploaded files.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { getClient } = require('../config/db-sqlite');
const { getChat, memberIds, isMember } = require('../utils/chats');
const { emitToUser, createNotification } = require('../utils/notify');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';
const MAX_CONTENT = 4000;

function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

/** Validate attachment metadata (the file itself is uploaded first). */
function sanitizeAttachment(att) {
  if (!att) return null;
  const url = String(att.url || '');
  if (!url.startsWith('/uploads/attachments/')) return null;
  return {
    url,
    name: String(att.name || 'attachment').slice(0, 200),
    mime: String(att.mime || 'application/octet-stream').slice(0, 100),
    size: Number(att.size) || 0,
  };
}

/**
 * Deliver a saved message to every other participant of the chat
 * (works for both direct and group chats) and notify them.
 */
async function deliverToOthers(client, chat, message, sender, content) {
  const ids = await memberIds(client, chat);
  const senderId = String(message.sender_id);
  const enriched = {
    ...message,
    sender_name: sender ? sender.name : null,
    sender_avatar: sender ? sender.avatar_url : null,
    senderId: message.sender_id,
    chat_id: chat.id,
  };

  for (const id of ids) {
    if (id === senderId) {
      emitToUser(id, 'new_message_self', enriched);
      continue;
    }
    emitToUser(id, 'new_message', enriched);
    await createNotification(
      id,
      'message',
      chat.type === 'group' ? `New message in ${chat.name}` : 'New message',
      chat.type === 'group'
        ? `${enriched.sender_name || 'Someone'}: ${String(content).slice(0, 60)}`
        : `${enriched.sender_name || 'Someone'}: ${String(content).slice(0, 60)}`,
      { chatId: chat.id, messageId: message.id }
    );
  }
  return enriched;
}

// ------------------------------------------------------------------
// Send a message
// ------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { chatId, content, type = 'text', attachment } = req.body;

    const text = content == null ? '' : String(content).trim();
    const att = sanitizeAttachment(attachment);
    if (!chatId) return res.status(400).json({ message: 'Missing chatId' });
    if (!text && !att) return res.status(400).json({ message: 'Message cannot be empty' });
    if (text.length > MAX_CONTENT) return res.status(400).json({ message: 'Message is too long' });

    const client = await getClient();
    try {
      const chat = await getChat(client, chatId);
      if (!chat) return res.status(404).json({ message: 'Chat not found' });
      if (!(await isMember(client, chat, decoded.id))) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const finalType = att ? (att.mime && att.mime.startsWith('image/') ? 'image' : 'file') : type;

      const result = await client.query(
        `INSERT INTO messages (chat_id, sender_id, content, message_type, is_read,
                               attachment_url, attachment_name, attachment_mime, attachment_size,
                               created_at, updated_at)
         VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, NOW(), NOW()) RETURNING *`,
        [chat.id, decoded.id, text || att.name, finalType,
         att ? att.url : null, att ? att.name : null,
         att ? att.mime : null, att ? att.size : null]
      );
      const message = result.rows[0];

      // Keep the chat list ordered by most recent activity.
      await client.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat.id]);

      const sender = await client.query('SELECT id, name, avatar_url FROM users WHERE id = $1', [decoded.id]);
      const enriched = await deliverToOthers(client, chat, message, sender.rows[0], text || att.name);

      res.json({ success: true, message: enriched });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Send message error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ------------------------------------------------------------------
// List messages
// ------------------------------------------------------------------
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
      const chat = await getChat(client, chatId);
      if (!chat) return res.status(404).json({ message: 'Chat not found' });
      if (!(await isMember(client, chat, decoded.id))) {
        return res.status(403).json({ message: 'Access denied' });
      }

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

// ------------------------------------------------------------------
// Mark as read
// ------------------------------------------------------------------
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
      const chat = await getChat(client, message.chat_id);
      if (!chat || !(await isMember(client, chat, decoded.id))) {
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
      const chat = await getChat(client, message.chat_id);
      if (chat) {
        const ids = await memberIds(client, chat);
        for (const id of ids) emitToUser(id, 'message_edited', updated);
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
// Delete a message (member of the chat).
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
      const chat = await getChat(client, message.chat_id);
      if (!chat || !(await isMember(client, chat, decoded.id))) {
        return res.status(403).json({ message: 'Access denied' });
      }

      await client.query('DELETE FROM messages WHERE id = $1', [message.id]);
      if (chat) {
        const ids = await memberIds(client, chat);
        for (const id of ids) {
          emitToUser(id, 'message_deleted', { messageId: message.id, chatId: message.chat_id });
        }
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
