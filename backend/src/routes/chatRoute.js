/**
 * Chat routes (CRUD for chats)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { getClient } = require('../config/db-sqlite');
const { isMember, memberRows } = require('../utils/chats');
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
        `SELECT c.*,
           CASE WHEN c.type = 'group' THEN c.name ELSE u.name END AS other_user_name,
           CASE WHEN c.type = 'group' THEN '' ELSE u.avatar_url END AS other_user_avatar,
           CASE WHEN c.type = 'group' THEN 1 ELSE 0 END AS is_group,
           (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id = c.id) AS member_count,
           (SELECT COUNT(*) FROM messages m
             WHERE m.chat_id = c.id AND m.is_read = 0 AND m.sender_id <> $1) AS unread_count,
           (SELECT m2.content FROM messages m2
             WHERE m2.chat_id = c.id ORDER BY m2.id DESC LIMIT 1) AS last_message,
           (SELECT m3.created_at FROM messages m3
             WHERE m3.chat_id = c.id ORDER BY m3.id DESC LIMIT 1) AS last_message_at
         FROM chats c ${otherUserJoin(1)}
         WHERE (c.type = 'direct' AND (c.user1_id = $1 OR c.user2_id = $1))
            OR (c.type = 'group' AND EXISTS (
                  SELECT 1 FROM chat_members m2
                   WHERE m2.chat_id = c.id AND m2.user_id = $1))
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
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });      const { chatId } = req.params;
      const client = await getClient();
      try {
        const chatResult = await client.query('SELECT * FROM chats WHERE id = $1', [chatId]);
        if (chatResult.rows.length === 0) return res.status(404).json({ message: 'Chat not found' });
        const chat = chatResult.rows[0];
        if (!(await isMember(client, chat, decoded.id))) {
          return res.status(404).json({ message: 'Chat not found' });
        }

        let other = null;
        let members = [];
        if (chat.type === 'group') {
          members = await memberRows(client, chat.id);
        } else {
          // Resolve the other participant (kept as a second query so the
          // $n placeholders always appear in ascending order — SQLite binds
          // array parameters by position of first appearance).
          const otherId = String(chat.user1_id) === String(decoded.id) ? chat.user2_id : chat.user1_id;
          const otherResult = await client.query('SELECT id, name, avatar_url FROM users WHERE id = $1', [otherId]);
          other = otherResult.rows[0] || null;
        }

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
          is_group: chat.type === 'group' ? 1 : 0,
          member_count: chat.type === 'group' ? members.length : 2,
          other_user_name: other ? other.name : null,
          other_user_avatar: other ? other.avatar_url : null,
          members,
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
});router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { userId, otherUserId, name, memberIds } = req.body;

    const client = await getClient();
    try {
      // ----------------------------------------------------------
      // Group chat: { name, memberIds }
      // ----------------------------------------------------------
      if (name !== undefined || memberIds !== undefined) {
        const groupName = String(name || '').trim();
        const invited = Array.isArray(memberIds)
          ? [...new Set(memberIds.map(String))].filter((id) => id !== String(decoded.id))
          : [];
        if (!groupName) return res.status(400).json({ message: 'Group name is required' });
        if (groupName.length > 60) return res.status(400).json({ message: 'Group name is too long' });
        if (invited.length === 0) return res.status(400).json({ message: 'Invite at least one person' });

        const placeholders = invited.map((_, i) => '$' + (i + 1)).join(', ');
        const valid = await client.query(
          `SELECT id, name FROM users WHERE id IN (${placeholders}) AND is_active = 1`,
          invited
        );
        if (valid.rows.length === 0) return res.status(404).json({ message: 'No valid users to add' });

        const inserted = await client.query(
          "INSERT INTO chats (type, name, user1_id, user2_id, created_at, updated_at) VALUES ('group', $1, $2, $2, NOW(), NOW()) RETURNING *",
          [groupName, decoded.id]
        );
        const chat = inserted.rows[0];
        await client.query(
          "INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())",
          [chat.id, decoded.id]
        );
        for (const u of valid.rows) {
          await client.query(
            'INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, \'member\', NOW())',
            [chat.id, u.id]
          );
          await createNotification(
            u.id,
            'group',
            'Added to a group',
            `${decoded.name || 'Someone'} added you to "${groupName}"`,
            { chatId: chat.id, chatName: groupName }
          );
          emitToUser(u.id, 'chat_added', { chatId: chat.id, name: groupName });
        }

        return res.json({
          success: true,
          chat: { ...chat, is_group: 1, member_count: valid.rows.length + 1 },
          message: 'Group created',
        });
      }

      // ----------------------------------------------------------
      // Direct chat: { userId, otherUserId }
      // ----------------------------------------------------------
      if (userId == null || otherUserId == null) {
        return res.status(400).json({ message: 'Missing userId or otherUserId' });
      }
      if (String(userId) !== String(decoded.id)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      if (String(userId) === String(otherUserId)) {
        return res.status(400).json({ message: 'Cannot chat with yourself' });
      }
      const other = await client.query('SELECT id FROM users WHERE id = $1 AND is_active = 1', [otherUserId]);
      if (other.rows.length === 0) return res.status(404).json({ message: 'User not found' });

      const existing = await client.query(
        "SELECT * FROM chats WHERE type = 'direct' AND ((user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1))",
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

// ------------------------------------------------------------------
// Add someone to a group chat.
// ------------------------------------------------------------------
router.post('/:chatId/members', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ message: 'Missing userId' });

    const client = await getClient();
    try {
      const chatResult = await client.query('SELECT * FROM chats WHERE id = $1', [req.params.chatId]);
      if (chatResult.rows.length === 0) return res.status(404).json({ message: 'Chat not found' });
      const chat = chatResult.rows[0];
      if (chat.type !== 'group') return res.status(400).json({ message: 'Cannot add members to a direct chat' });
      if (!(await isMember(client, chat, decoded.id))) {
        return res.status(403).json({ message: 'Only group members can add people' });
      }

      const target = await client.query('SELECT id, name FROM users WHERE id = $1 AND is_active = 1', [userId]);
      if (target.rows.length === 0) return res.status(404).json({ message: 'User not found' });

      const already = await client.query(
        'SELECT id FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chat.id, userId]
      );
      if (already.rows.length > 0) return res.status(409).json({ message: 'Already in this group' });

      await client.query(
        "INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW())",
        [chat.id, userId]
      );
      await client.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat.id]);
      await createNotification(
        userId,
        'group',
        'Added to a group',
        `${decoded.name || 'Someone'} added you to "${chat.name}"`,
        { chatId: chat.id, chatName: chat.name }
      );
      emitToUser(userId, 'chat_added', { chatId: chat.id, name: chat.name });

      const members = await memberRows(client, chat.id);
      res.json({ success: true, member_count: members.length, message: 'Member added' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Add member error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ------------------------------------------------------------------
// Leave a group chat.
// ------------------------------------------------------------------
router.post('/:chatId/leave', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });

    const client = await getClient();
    try {
      const chatResult = await client.query('SELECT * FROM chats WHERE id = $1', [req.params.chatId]);
      if (chatResult.rows.length === 0) return res.status(404).json({ message: 'Chat not found' });
      const chat = chatResult.rows[0];
      if (chat.type !== 'group') return res.status(400).json({ message: 'Cannot leave a direct chat' });

      const membership = await client.query(
        'SELECT id FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chat.id, decoded.id]
      );
      if (membership.rows.length === 0) return res.status(403).json({ message: 'You are not in this group' });

      await client.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chat.id, decoded.id]);
      const remaining = await client.query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chat.id]);

      if (remaining.rows.length === 0) {
        await client.query('DELETE FROM chats WHERE id = $1', [chat.id]);
      } else {
        await client.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat.id]);
        for (const row of remaining.rows) {
          emitToUser(row.user_id, 'chat_removed', { chatId: chat.id });
        }
      }
      res.json({ success: true, message: 'You left the group' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Leave group error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
