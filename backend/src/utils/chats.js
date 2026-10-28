/**
 * Shared chat helpers — direct (2-person) and group chats use
 * different membership sources, so every route goes through these.
 */

/** Fetch a chat row or null. */
async function getChat(client, chatId) {
  const r = await client.query('SELECT * FROM chats WHERE id = $1', [chatId]);
  return r.rows[0] || null;
}

/** Every participant id of a chat, as strings. */
async function memberIds(client, chat) {
  if (!chat) return [];
  if (chat.type === 'group') {
    const r = await client.query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chat.id]);
    return r.rows.map((row) => String(row.user_id));
  }
  return [String(chat.user1_id), String(chat.user2_id)];
}

/** Is this user allowed to read/post in this chat? */
async function isMember(client, chat, userId) {
  const ids = await memberIds(client, chat);
  return ids.includes(String(userId));
}

/** Full member rows (id, name, avatar_url, email) for a group. */
async function memberRows(client, chatId) {
  const r = await client.query(
    `SELECT m.user_id, m.role, m.joined_at, u.name, u.email, u.avatar_url
     FROM chat_members m JOIN users u ON u.id = m.user_id
     WHERE m.chat_id = $1
     ORDER BY m.joined_at ASC`,
    [chatId]
  );
  return r.rows;
}

module.exports = { getChat, memberIds, isMember, memberRows };
