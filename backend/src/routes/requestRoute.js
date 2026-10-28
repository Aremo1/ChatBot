/**
 * Contact / connection requests.
 *
 * One employee searches for another (manual search), sends a request,
 * and the receiver accepts or rejects it. Accepting opens a direct
 * chat. Both sides get real-time socket events and persisted
 * notifications.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { getClient } = require('../config/db-sqlite');
const { emitToUser, createNotification } = require('../utils/notify');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';

/** Verify the bearer token; returns decoded payload or null. */
function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// List my incoming (pending) and outgoing requests.
router.get('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const incoming = await client.query(
        `SELECT r.*, u.name AS sender_name, u.email AS sender_email, u.avatar_url AS sender_avatar
         FROM requests r JOIN users u ON u.id = r.sender_id
         WHERE r.receiver_id = $1 AND r.status = 'pending'
         ORDER BY r.created_at DESC`,
        [decoded.id]
      );
      const outgoing = await client.query(
        `SELECT r.*, u.name AS receiver_name, u.email AS receiver_email, u.avatar_url AS receiver_avatar
         FROM requests r JOIN users u ON u.id = r.receiver_id
         WHERE r.sender_id = $1
         ORDER BY r.created_at DESC`,
        [decoded.id]
      );
      res.json({ success: true, incoming: incoming.rows, outgoing: outgoing.rows });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('List requests error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// List my accepted connections (the people I can chat with).
router.get('/connections', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const result = await client.query(
        `SELECT r.id AS request_id, r.created_at AS connected_at,
                u.id, u.name, u.email, u.avatar_url
         FROM requests r
         JOIN users u ON u.id = CASE WHEN r.sender_id = $1 THEN r.receiver_id ELSE r.sender_id END
         WHERE r.status = 'accepted' AND (r.sender_id = $1 OR r.receiver_id = $1)
         ORDER BY r.created_at DESC`,
        [decoded.id]
      );
      res.json({ success: true, connections: result.rows });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('List connections error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Cancel an outgoing pending request (or remove a connection).
router.delete('/:id', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const found = await client.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
      if (found.rows.length === 0) return res.status(404).json({ message: 'Request not found' });
      const request = found.rows[0];
      if (String(request.sender_id) !== String(decoded.id)) {
        return res.status(403).json({ message: 'Only the sender can cancel this request' });
      }
      if (request.status === 'rejected') {
        return res.status(409).json({ message: 'This request was already rejected' });
      }
      await client.query('DELETE FROM requests WHERE id = $1', [request.id]);
      emitToUser(request.receiver_id, 'request_cancelled', { request });
      res.json({ success: true, message: request.status === 'pending' ? 'Request cancelled' : 'Connection removed' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Cancel request error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Send a request to another user (manual search + add).
router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const { receiverId } = req.body;
    if (!receiverId) return res.status(400).json({ message: 'Missing receiverId' });
    if (String(receiverId) === String(decoded.id)) {
      return res.status(400).json({ message: 'You cannot send a request to yourself' });
    }
    const client = await getClient();
    try {
      const receiver = await client.query('SELECT id, name, email FROM users WHERE id = $1 AND is_active = 1', [receiverId]);
      if (receiver.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      const existing = await client.query(
        `SELECT * FROM requests
         WHERE status = 'pending'
           AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
        [decoded.id, receiverId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ message: 'A request with this user is already pending' });
      }
      const accepted = await client.query(
        `SELECT * FROM requests WHERE status = 'accepted'
           AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
        [decoded.id, receiverId]
      );
      if (accepted.rows.length > 0) {
        return res.status(409).json({ message: 'You are already connected with this user' });
      }
      const result = await client.query(
        'INSERT INTO requests (sender_id, receiver_id, status, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
        [decoded.id, receiverId, 'pending']
      );
      const request = result.rows[0];
      await createNotification(
        receiverId,
        'request',
        'New contact request',
        `${decoded.name || 'Someone'} wants to connect with you`,
        { requestId: request.id, senderId: decoded.id, senderName: decoded.name }
      );
      emitToUser(receiverId, 'new_request', { ...request, sender_name: decoded.name, sender_email: decoded.email });
      res.json({ success: true, request, message: 'Request sent' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Send request error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Accept a request -> creates (or reuses) the direct chat.
router.post('/:id/accept', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const found = await client.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
      if (found.rows.length === 0) return res.status(404).json({ message: 'Request not found' });
      const request = found.rows[0];
      if (String(request.receiver_id) !== String(decoded.id)) {
        return res.status(403).json({ message: 'Only the receiver can accept this request' });
      }
      if (request.status !== 'pending') {
        return res.status(409).json({ message: 'This request is no longer pending' });
      }
      await client.query('UPDATE requests SET status = $1, updated_at = NOW() WHERE id = $2', ['accepted', request.id]);

      // Find or create the direct chat between the two users.
      const existingChat = await client.query(
        'SELECT * FROM chats WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
        [request.sender_id, request.receiver_id]
      );
      let chat;
      if (existingChat.rows.length > 0) {
        chat = existingChat.rows[0];
      } else {
        const inserted = await client.query(
          'INSERT INTO chats (type, user1_id, user2_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
          ['direct', request.sender_id, request.receiver_id]
        );
        chat = inserted.rows[0];
      }

      await createNotification(
        request.sender_id,
        'request_accepted',
        'Request accepted',
        `${decoded.name || 'Someone'} accepted your contact request`,
        { requestId: request.id, chatId: chat.id }
      );
      emitToUser(request.sender_id, 'request_accepted', { request: { ...request, status: 'accepted' }, chat });
      res.json({ success: true, request: { ...request, status: 'accepted' }, chat, message: 'Request accepted' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Accept request error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Reject a request.
router.post('/:id/reject', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    const client = await getClient();
    try {
      const found = await client.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
      if (found.rows.length === 0) return res.status(404).json({ message: 'Request not found' });
      const request = found.rows[0];
      if (String(request.receiver_id) !== String(decoded.id)) {
        return res.status(403).json({ message: 'Only the receiver can reject this request' });
      }
      if (request.status !== 'pending') {
        return res.status(409).json({ message: 'This request is no longer pending' });
      }
      await client.query('UPDATE requests SET status = $1, updated_at = NOW() WHERE id = $2', ['rejected', request.id]);
      await createNotification(
        request.sender_id,
        'request_rejected',
        'Request declined',
        `${decoded.name || 'Someone'} declined your contact request`,
        { requestId: request.id }
      );
      emitToUser(request.sender_id, 'request_rejected', { request: { ...request, status: 'rejected' } });
      res.json({ success: true, request: { ...request, status: 'rejected' }, message: 'Request rejected' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Reject request error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
