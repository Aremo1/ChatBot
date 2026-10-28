/**
 * Shared helpers for pushing notifications to the database and to
 * connected sockets. Routes call these so request/message events reach
 * the user whether or not they currently have a page open.
 */

const { getClient } = require('../config/db-sqlite');

/** Lazily grab the Socket.IO instance (avoids a require cycle). */
function getIo() {
  try {
    const { io } = require('../app');
    return io;
  } catch (e) {
    return null;
  }
}

/** Emit an event to every socket belonging to one user. */
function emitToUser(userId, event, payload) {
  if (userId == null) return;
  const io = getIo();
  if (!io) return;
  io.to('user_' + String(userId)).emit(event, payload);
}

/** Persist a notification row and push it to the user in real time. */
async function createNotification(userId, type, title, body, data = {}) {
  if (userId == null) return null;
  const client = await getClient();
  try {
    const result = await client.query(
      'INSERT INTO notifications (user_id, type, title, body, data, is_read, created_at) VALUES ($1, $2, $3, $4, $5, 0, NOW()) RETURNING *',
      [userId, type, title, body, JSON.stringify(data)]
    );
    const notification = result.rows[0];
    emitToUser(userId, 'notification', notification);
    return notification;
  } finally {
    client.release();
  }
}

module.exports = { getIo, emitToUser, createNotification };
