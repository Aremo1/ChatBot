/**
 * Socket.IO handlers for real-time chat.
 *
 * Presence is filtered per viewer: a user decides whether they appear
 * online at all (online_status) and who may see them (online_visibility:
 * everyone | contacts | nobody). Rosters and join/leave events are
 * therefore computed for each connected socket, never broadcast raw.
 */

const { emitToUser, createNotification } = require('../utils/notify');
const { getClient } = require('../config/db-sqlite');

/** userId -> Set of socket ids (a user may have several tabs open) */
const onlineUsers = new Map();

/** socket.id -> joined userId */
const socketUsers = new Map();

let ioInstance = null;

// Short-lived caches so presence broadcasts don't hammer the DB.
const TTL_MS = 3000;
const settingsCache = new Map(); // userId -> { value, expires }
const contactCache = new Map(); // "a:b" -> { value, expires }

function clearPresenceCaches() {
  settingsCache.clear();
  contactCache.clear();
}

function addOnline(userId, socketId) {
  const id = String(userId);
  if (!onlineUsers.has(id)) onlineUsers.set(id, new Set());
  const wasOffline = onlineUsers.get(id).size === 0;
  onlineUsers.get(id).add(socketId);
  socketUsers.set(socketId, id);
  return wasOffline;
}

function removeOnline(userId, socketId) {
  const id = String(userId);
  const set = onlineUsers.get(id);
  socketUsers.delete(socketId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    onlineUsers.delete(id);
    return true; // went fully offline
  }
  return false;
}

function presenceList() {
  return Array.from(onlineUsers.keys());
}

/** Can `viewerId` see that `targetId` is online? */
async function canSeeOnline(viewerId, targetId) {
  const viewer = String(viewerId);
  const target = String(targetId);
  if (viewer === target) return true;

  let entry = settingsCache.get(target);
  if (!entry || entry.expires < Date.now()) {
    const client = await getClient();
    try {
      const r = await client.query(
        'SELECT online_status, online_visibility FROM users WHERE id = $1',
        [target]
      );
      entry = {
        value: r.rows[0]
          ? { online: Boolean(r.rows[0].online_status), visibility: r.rows[0].online_visibility || 'everyone' }
          : { online: false, visibility: 'nobody' },
        expires: Date.now() + TTL_MS,
      };
    } finally {
      client.release();
    }
    settingsCache.set(target, entry);
  }

  if (!entry.value.online) return false;
  if (entry.value.visibility === 'everyone') return true;
  if (entry.value.visibility === 'nobody') return false;

  // 'contacts' — an accepted request between the two users.
  const key = viewer + ':' + target;
  let contact = contactCache.get(key);
  if (!contact || contact.expires < Date.now()) {
    const client = await getClient();
    try {
      const r = await client.query(
        `SELECT 1 AS ok FROM requests
         WHERE status = 'accepted'
           AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
         LIMIT 1`,
        [viewer, target]
      );
      contact = { value: r.rows.length > 0, expires: Date.now() + TTL_MS };
    } finally {
      client.release();
    }
    contactCache.set(key, contact);
  }
  return contact.value;
}

/** The online roster as `viewerId` is allowed to see it. */
async function rosterFor(viewerId) {
  const online = presenceList();
  const visible = [];
  for (const id of online) {
    if (await canSeeOnline(viewerId, id)) visible.push(id);
  }
  return visible;
}

/** Push a fresh, viewer-specific roster to every connected socket. */
async function broadcastPresence() {
  clearPresenceCaches();
  if (!ioInstance) return;
  for (const [socketId, viewer] of socketUsers) {
    if (!viewer) continue;
    const socket = ioInstance.sockets.sockets.get(socketId);
    if (!socket) continue;
    const online = await rosterFor(viewer);
    socket.emit('presence', { online });
  }
}

/** Emit a presence event only to sockets allowed to see `targetId`. */
async function emitPresenceFiltered(event, targetId, payload) {
  if (!ioInstance) return;
  const viewers = new Set(socketUsers.values());
  for (const viewer of viewers) {
    if (await canSeeOnline(viewer, targetId)) {
      ioInstance.to('user_' + String(viewer)).emit(event, payload);
    }
  }
}

/**
 * Setup all socket handlers
 */
function setupSocketHandlers(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`🔗 Client connected: ${socket.id}`);
    let joinedUserId = null;

    // Join arbitrary rooms (chat rooms, user rooms like "user_12").
    socket.on('join_room', (room) => {
      if (!room) return;
      socket.join(String(room));
    });

    // Presence: the client announces who it is after signing in.
    socket.on('user_joined', async (userId) => {
      if (userId == null) return;
      joinedUserId = String(userId);
      socket.join('user_' + joinedUserId);
      const cameOnline = addOnline(userId, socket.id);
      // Always send THIS socket the roster it is allowed to see.
      const online = await rosterFor(joinedUserId);
      socket.emit('presence', { online });
      if (cameOnline) {
        settingsCache.delete(String(userId));
        await emitPresenceFiltered('user_joined', userId, joinedUserId);
        console.log(`👤 User ${userId} joined (online)`);
      }
    });

    // Send a message over the socket (real-time path; the HTTP route
    // is the source of truth, this stays for clients that prefer it).
    socket.on('send_message', async (msg) => {
      try {
        if (!msg || !msg.chatId || !msg.content || msg.senderId == null) return;
        const client = await getClient();
        try {
          const chatResult = await client.query('SELECT id, user1_id, user2_id FROM chats WHERE id = $1', [msg.chatId]);
          if (chatResult.rows.length === 0) return;
          const chat = chatResult.rows[0];
          const isMember =
            String(chat.user1_id) === String(msg.senderId) || String(chat.user2_id) === String(msg.senderId);
          if (!isMember) return;

          const result = await client.query(
            'INSERT INTO messages (chat_id, sender_id, content, message_type, is_read, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW()) RETURNING *',
            [chat.id, msg.senderId, String(msg.content).trim(), msg.type || 'text']
          );
          const savedMsg = result.rows[0];
          await client.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chat.id]);
          const sender = await client.query('SELECT id, name, avatar_url FROM users WHERE id = $1', [msg.senderId]);
          const otherId = String(chat.user1_id) === String(msg.senderId) ? chat.user2_id : chat.user1_id;
          const messageData = {
            ...savedMsg,
            sender_name: sender.rows[0] ? sender.rows[0].name : null,
            sender_avatar: sender.rows[0] ? sender.rows[0].avatar_url : null,
            senderId: savedMsg.sender_id,
          };

          emitToUser(otherId, 'new_message', messageData);
          emitToUser(msg.senderId, 'new_message_self', messageData);
          await createNotification(
            otherId,
            'message',
            'New message',
            `${messageData.sender_name || 'Someone'}: ${String(msg.content).slice(0, 60)}`,
            { chatId: chat.id, messageId: savedMsg.id }
          );
        } finally {
          client.release();
        }
      } catch (err) {
        console.error('Error handling send_message:', err);
      }
    });

    // Typing indicator — relayed to the other participant only.
    socket.on('typing', (payload) => {
      if (!payload || payload.chatId == null || payload.userId == null) return;
      const otherId = payload.recipientId != null
        ? payload.recipientId
        : payload.otherUserId;
      if (otherId == null) return;
      emitToUser(otherId, 'typing', {
        chatId: payload.chatId,
        userId: String(payload.userId),
        name: payload.name || null,
        isTyping: payload.isTyping !== false,
      });
    });

    // Message read status: relay to everyone in the chat room.
    socket.on('mark_message_read', (payload) => {
      if (!payload) return;
      const { messageId, chatId } = payload;
      if (messageId == null) return;
      io.emit('message_read', { messageId, chatId });
    });

    // Group member left — inform every remaining member that the group
    // is still there. The socket that fired the leave event should keep
    // the group (it may be the last member), so we broadcast to the
    // room via the Socket.IO adapter and skip the sender socket.
    socket.on('chat_removed', (payload) => {
      const id = payload && payload.chatId;
      if (!id) return;
      for (const memberId of Object.keys(io.sockets.adapter.rooms.get(id) || {})) {
        if (memberId === socket.id) continue;
        io.to('user_' + memberId).emit('chat_removed', { chatId: id });
      }
    });

    // User leaving (explicit, e.g. sign-out).
    socket.on('user_left', async (userId) => {
      if (userId == null) return;
      const wentOffline = removeOnline(userId, socket.id);
      if (wentOffline) {
        settingsCache.delete(String(userId));
        await emitPresenceFiltered('user_left', userId, String(userId));
      }
    });

    // Cleanup on disconnection.
    socket.on('disconnect', async () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      if (joinedUserId) {
        const wentOffline = removeOnline(joinedUserId, socket.id);
        if (wentOffline) {
          settingsCache.delete(joinedUserId);
          await emitPresenceFiltered('user_left', joinedUserId, joinedUserId);
        }
      }
    });
  });
}

module.exports = { setupSocketHandlers, broadcastPresence, clearPresenceCaches };
