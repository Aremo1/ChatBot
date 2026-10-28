/**
 * End-to-end API + Socket.IO test suite for the Rhosam ChatBot
 * backend. Run the server first, then:
 *
 *   node test-api.js [baseUrl]
 *
 * Covers: sign-up/sign-in/sign-out, profile, people search, contact
 * requests (send/accept/reject/cancel), connections, chats, messages
 * (send/list/read/edit/delete), notifications, the 6-digit OTP
 * password-reset flow, admin user creation/password reset, and the
 * real-time socket path (presence, messages, typing, read receipts).
 */

const { createRequire } = require('module');
const frontendRequire = createRequire(require('path').join(__dirname, '../frontend/package.json'));
const { io: ioClient } = frontendRequire('socket.io-client');

const BASE = process.argv[2] || 'http://localhost:4100';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  return { status: res.status, body: json };
}

function connectSocket() {
  return ioClient(BASE, { transports: ['websocket'], reconnection: false });
}

function waitFor(socket, event, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

const stamp = Date.now().toString(36);

async function main() {
  const aliceEmail = `alice-${stamp}@example.com`;
  const bobEmail = `bob-${stamp}@example.com`;
  const carolEmail = `carol-${stamp}@example.com`;
  const PW = 'password123';

  // ----------------------------------------------------------------
  section('Health');
  const health = await api('GET', '/health');
  check('GET /health returns ok', health.status === 200 && health.body.status === 'ok');

  // ----------------------------------------------------------------
  section('Sign-up / Sign-in / Sign-out');
  const signup = await api('POST', '/api/local/signup', {
    body: { email: aliceEmail, password: PW, name: 'Alice' },
  });
  check('sign-up creates account with token',
    signup.status === 200 && signup.body.success && Boolean(signup.body.token));
  check('sign-up returns role user',
    signup.body && signup.body.user && signup.body.user.role === 'user');

  const dupSignup = await api('POST', '/api/local/signup', {
    body: { email: aliceEmail, password: PW, name: 'Alice' },
  });
  check('duplicate email rejected with 409', dupSignup.status === 409);

  const weakSignup = await api('POST', '/api/local/signup', {
    body: { email: `weak-${stamp}@example.com`, password: 'short', name: 'Weak' },
  });
  check('short password rejected', weakSignup.status === 400);

  const badLogin = await api('POST', '/api/local/signin', {
    body: { email: aliceEmail, password: 'wrong-password' },
  });
  check('wrong password rejected with 401', badLogin.status === 401);

  const aliceLogin = await api('POST', '/api/local/signin', {
    body: { email: aliceEmail, password: PW },
  });
  const aliceToken = aliceLogin.body && aliceLogin.body.token;
  const aliceId = aliceLogin.body && aliceLogin.body.user && aliceLogin.body.user.id;
  check('sign-in returns token', Boolean(aliceToken));

  const signout = await api('POST', '/api/local/signout', { token: aliceToken });
  check('sign-out succeeds', signout.status === 200 && signout.body.success);

  const me = await api('GET', '/api/auth/me', { token: aliceToken });
  check('GET /api/auth/me returns the user',
    me.status === 200 && me.body.user && me.body.user.email === aliceEmail);
  check('/me exposes role', me.body && me.body.user && me.body.user.role === 'user');

  const meNoToken = await api('GET', '/api/auth/me');
  check('GET /api/auth/me without token is 401', meNoToken.status === 401);

  // ----------------------------------------------------------------
  section('Bob sign-up + sockets');
  const bobSignup = await api('POST', '/api/local/signup', {
    body: { email: bobEmail, password: PW, name: 'Bob' },
  });
  const bobToken = bobSignup.body && bobSignup.body.token;
  const bobId = bobSignup.body && bobSignup.body.user && bobSignup.body.user.id;
  check('bob signed up', Boolean(bobToken));

  const aliceSocket = connectSocket();
  const bobSocket = connectSocket();
  const aliceConnected = waitFor(aliceSocket, 'connect');
  const bobConnected = waitFor(bobSocket, 'connect');
  await Promise.all([aliceConnected, bobConnected]);
  check('alice socket connected', aliceSocket.connected);
  check('bob socket connected', bobSocket.connected);

  const alicePresence = waitFor(aliceSocket, 'presence');
  aliceSocket.emit('user_joined', aliceId);
  const presence = await alicePresence;
  check('presence roster received after user_joined',
    presence && Array.isArray(presence.online) && presence.online.includes(String(aliceId)));

  bobSocket.emit('user_joined', bobId);

  // ----------------------------------------------------------------
  section('People search (manual add)');
  const search = await api('GET', `/api/local/users?q=${encodeURIComponent('bob')}`, { token: aliceToken });
  const bobResult = search.body && search.body.users && search.body.users.find((u) => String(u.id) === String(bobId));
  check('search finds bob by name', search.status === 200 && Boolean(bobResult));
  check('search reports relationship none', bobResult && bobResult.connection === 'none');

  const searchNoAuth = await api('GET', '/api/local/users?q=bob');
  check('search requires auth', searchNoAuth.status === 401);

  // ----------------------------------------------------------------
  section('Contact requests: send / accept / reject');
  const newReqNotification = waitFor(bobSocket, 'notification');
  const newReqEvent = waitFor(bobSocket, 'new_request');
  const sendReq = await api('POST', '/api/requests', { token: aliceToken, body: { receiverId: bobId } });
  check('request sent', sendReq.status === 200 && sendReq.body.success);
  const reqId = sendReq.body && sendReq.body.request && sendReq.body.request.id;
  check('socket new_request delivered to receiver', Boolean(await newReqEvent));
  const reqNotification = await newReqNotification;
  check('socket notification delivered to receiver',
    reqNotification && reqNotification.type === 'request');

  const dupReq = await api('POST', '/api/requests', { token: aliceToken, body: { receiverId: bobId } });
  check('duplicate pending request rejected with 409', dupReq.status === 409);

  const afterSend = await api('GET', `/api/local/users?q=${encodeURIComponent('bob')}`, { token: aliceToken });
  const bobAfter = afterSend.body && afterSend.body.users && afterSend.body.users.find((u) => String(u.id) === String(bobId));
  check('search shows pending_out for the sender', bobAfter && bobAfter.connection === 'pending_out',
    bobAfter && bobAfter.connection);
  const bobView = await api('GET', `/api/local/users?q=${encodeURIComponent('alice')}`, { token: bobToken });
  const aliceInView = bobView.body && bobView.body.users && bobView.body.users.find((u) => String(u.id) === String(aliceId));
  check('search shows pending_in for the receiver', aliceInView && aliceInView.connection === 'pending_in',
    aliceInView && aliceInView.connection);

  const selfReq = await api('POST', '/api/requests', { token: aliceToken, body: { receiverId: aliceId } });
  check('request to self rejected', selfReq.status === 400);

  const wrongAccept = await api('POST', `/api/requests/${reqId}/accept`, { token: aliceToken });
  check('sender cannot accept own request', wrongAccept.status === 403);

  const listIncoming = await api('GET', '/api/requests', { token: bobToken });
  check('receiver sees pending incoming request',
    listIncoming.body && listIncoming.body.incoming.some((r) => String(r.id) === String(reqId)));

  const acceptEvent = waitFor(aliceSocket, 'request_accepted');
  const acceptNotification = waitFor(aliceSocket, 'notification');
  const accept = await api('POST', `/api/requests/${reqId}/accept`, { token: bobToken });
  check('request accepted', accept.status === 200 && accept.body.success);
  const chatId = accept.body && accept.body.chat && accept.body.chat.id;
  check('accept creates a direct chat', Boolean(chatId));
  check('socket request_accepted delivered to sender', Boolean(await acceptEvent));
  check('accept also produced a notification', Boolean(await acceptNotification));

  const acceptAgain = await api('POST', `/api/requests/${reqId}/accept`, { token: bobToken });
  check('accepting twice rejected with 409', acceptAgain.status === 409);

  // Reject flow with a third user.
  const carolSignup = await api('POST', '/api/local/signup', {
    body: { email: carolEmail, password: PW, name: 'Carol' },
  });
  const carolToken = carolSignup.body && carolSignup.body.token;
  const carolId = carolSignup.body && carolSignup.body.user && carolSignup.body.user.id;
  const carolSock = connectSocket();
  await waitFor(carolSock, 'connect');
  const carolPresence = waitFor(carolSock, 'presence');
  carolSock.emit('user_joined', carolId);
  await carolPresence;
  const carolReq = await api('POST', '/api/requests', { token: carolToken, body: { receiverId: bobId } });
  const carolReqId = carolReq.body && carolReq.body.request && carolReq.body.request.id;
  const rejectEvent = waitFor(carolSock, 'request_rejected');
  const reject = await api('POST', `/api/requests/${carolReqId}/reject`, { token: bobToken });
  check('request rejected', reject.status === 200 && reject.body.success);
  const listAfterReject = await api('GET', '/api/requests', { token: carolToken });
  check('rejected request no longer incoming',
    listAfterReject.body && !listAfterReject.body.incoming.some((r) => String(r.id) === String(carolReqId)));

  const connections = await api('GET', '/api/requests/connections', { token: aliceToken });
  check('connections list contains bob',
    connections.body && connections.body.connections.some((c) => String(c.id) === String(bobId)));

  // ----------------------------------------------------------------
  section('Chats & messages');
  const chatsRes = await api('GET', '/api/chats', { token: aliceToken });
  check('alice sees the accepted chat',
    chatsRes.status === 200 && chatsRes.body.chats.some((c) => String(c.id) === String(chatId)));
  const listedChat = chatsRes.body.chats.find((c) => String(c.id) === String(chatId));
  check('chat list includes other participant name',
    listedChat && listedChat.other_user_name === 'Bob');
  check('chat list includes unread_count field', listedChat && listedChat.unread_count !== undefined);

  const chatDetail = await api('GET', `/api/chats/${chatId}?limit=50`, { token: aliceToken });
  check('chat detail loads messages', chatDetail.status === 200 && Array.isArray(chatDetail.body.messages));

  const notMember = await api('GET', `/api/chats/${chatId}`, { token: carolToken });
  check('non-member cannot open the chat', notMember.status === 404 || notMember.status === 403);

  const newMessagePromise = waitFor(bobSocket, 'new_message');
  const msgNotificationPromise = waitFor(bobSocket, 'notification');
  const sendMsg = await api('POST', '/api/messages', {
    token: aliceToken,
    body: { chatId, content: 'Hi Bob, are you there?' },
  });
  check('message sent', sendMsg.status === 200 && sendMsg.body.success);
  const messageId = sendMsg.body && sendMsg.body.message && sendMsg.body.message.id;
  const liveMessage = await newMessagePromise;
  check('socket new_message delivered to the other participant',
    liveMessage && liveMessage.content === 'Hi Bob, are you there?');
  const msgNotification = await msgNotificationPromise;
  check('message produces a notification for the receiver',
    msgNotification && msgNotification.type === 'message');

  const listMsgs = await api('GET', `/api/messages?chatId=${chatId}&limit=50`, { token: aliceToken });
  check('messages list returns the message',
    listMsgs.status === 200 && listMsgs.body.messages.some((m) => String(m.id) === String(messageId)));

  const chatsAfterMsg = await api('GET', '/api/chats', { token: bobToken });
  const bobChat = chatsAfterMsg.body.chats.find((c) => String(c.id) === String(chatId));
  check('unread count visible to receiver', bobChat && Number(bobChat.unread_count) === 1);
  check('last message preview present', bobChat && bobChat.last_message === 'Hi Bob, are you there?');

  const sendForbidden = await api('POST', '/api/messages', {
    token: carolToken,
    body: { chatId, content: 'intruder' },
  });
  check('non-member cannot post to the chat', sendForbidden.status === 403);

  const readPromise = waitFor(aliceSocket, 'message_read');
  const markRead = await api('PATCH', `/api/messages/${messageId}/read`, { token: bobToken });
  check('message marked as read', markRead.status === 200 && markRead.body.success);
  check('read receipt socket event delivered', Boolean(await readPromise));

  const notifsAfterRead = await api('GET', '/api/notifications', { token: bobToken });
  const msgNotif = notifsAfterRead.body.notifications.find((n) => n.type === 'message');
  check('reading a message clears its notification',
    !msgNotif || Number(msgNotif.is_read) === 1, JSON.stringify(notifsAfterRead.body.notifications && notifsAfterRead.body.notifications[0]));

  // Edit + delete
  const editPromise = waitFor(aliceSocket, 'message_edited');
  const edit = await api('PATCH', `/api/messages/${messageId}/edit`, {
    token: aliceToken,
    body: { content: 'Hi Bob, edited message' },
  });
  check('sender can edit message', edit.status === 200 && edit.body.success);
  const edited = await editPromise;
  check('message_edited socket event delivered', edited && edited.content === 'Hi Bob, edited message');

  const editForbidden = await api('PATCH', `/api/messages/${messageId}/edit`, {
    token: bobToken,
    body: { content: 'hacked' },
  });
  check('non-sender cannot edit', editForbidden.status === 403);

  const bobMsg = await api('POST', '/api/messages', { token: bobToken, body: { chatId, content: 'Reply from Bob' } });
  const bobMsgId = bobMsg.body && bobMsg.body.message && bobMsg.body.message.id;
  const deletePromise = waitFor(aliceSocket, 'message_deleted');
  const del = await api('DELETE', `/api/messages/${bobMsgId}`, { token: bobToken });
  check('sender can delete message', del.status === 200 && del.body.success);
  check('message_deleted socket event delivered', Boolean(await deletePromise));

  // ----------------------------------------------------------------
  section('Notifications');
  const notifs = await api('GET', '/api/notifications', { token: aliceToken });
  check('notifications list returned',
    notifs.status === 200 && Array.isArray(notifs.body.notifications));
  check('unread count reported', typeof (notifs.body && notifs.body.unread) === 'number');

  const readAll = await api('POST', '/api/notifications/read', { token: aliceToken, body: {} });
  check('mark all read works', readAll.status === 200 && readAll.body.success);
  const notifsAfter = await api('GET', '/api/notifications', { token: aliceToken });
  check('unread is zero after mark-read', notifsAfter.body.unread === 0);

  // ----------------------------------------------------------------
  section('Password reset with 6-digit OTP');
  const forgot = await api('POST', '/api/local/forgot-password', { body: { email: aliceEmail } });
  check('forgot-password accepted', forgot.status === 200 && forgot.body.success);
  const otp = forgot.body && forgot.body.devCode;
  check('OTP provided when SMTP is not configured (dev)', Boolean(otp) && /^\d{6}$/.test(otp));

  const wrongOtp = await api('POST', '/api/local/verify-otp', {
    body: { email: aliceEmail, code: '000000' },
  });
  check('wrong OTP rejected', wrongOtp.status === 400);

  const verify = await api('POST', '/api/local/verify-otp', {
    body: { email: aliceEmail, code: otp },
  });
  check('correct OTP verified', verify.status === 200 && Boolean(verify.body.resetToken));
  const resetToken = verify.body && verify.body.resetToken;

  const verifyAgain = await api('POST', '/api/local/verify-otp', {
    body: { email: aliceEmail, code: otp },
  });
  check('OTP cannot be reused', verifyAgain.status === 400);

  const reset = await api('POST', '/api/local/reset-password', {
    body: { resetToken, password: 'brandnewpass1' },
  });
  check('password reset accepted', reset.status === 200 && reset.body.success);

  const oldPwLogin = await api('POST', '/api/local/signin', {
    body: { email: aliceEmail, password: PW },
  });
  check('old password no longer works', oldPwLogin.status === 401);

  const newPwLogin = await api('POST', '/api/local/signin', {
    body: { email: aliceEmail, password: 'brandnewpass1' },
  });
  check('new password signs in', newPwLogin.status === 200 && newPwLogin.body.success);
  const aliceToken2 = newPwLogin.body && newPwLogin.body.token;

  const unknownEmailForgot = await api('POST', '/api/local/forgot-password', {
    body: { email: `nobody-${stamp}@example.com` },
  });
  check('unknown email does not leak existence',
    unknownEmailForgot.status === 200 && unknownEmailForgot.body.success &&
    !unknownEmailForgot.body.devCode);

  // Change password while signed in
  const changePw = await api('POST', '/api/local/change-password', {
    token: aliceToken2,
    body: { currentPassword: 'brandnewpass1', newPassword: 'thirdpass123' },
  });
  check('change password works', changePw.status === 200 && changePw.body.success);
  const thirdLogin = await api('POST', '/api/local/signin', {
    body: { email: aliceEmail, password: 'thirdpass123' },
  });
  check('changed password signs in', thirdLogin.status === 200 && thirdLogin.body.success);

  // ----------------------------------------------------------------
  section('Admin: add users and reset passwords');
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    check('ADMIN_EMAIL/ADMIN_PASSWORD provided for admin tests', false,
      'start the server with ADMIN_EMAIL and ADMIN_PASSWORD set');
  } else {
    const adminLogin = await api('POST', '/api/local/signin', {
      body: { email: adminEmail, password: adminPassword },
    });
    check('admin can sign in', adminLogin.status === 200 && adminLogin.body.success);
    const adminToken = adminLogin.body && adminLogin.body.token;
    check('admin role is admin',
      adminLogin.body && adminLogin.body.user && adminLogin.body.user.role === 'admin');

    const adminList = await api('GET', '/api/admin/users', { token: adminToken });
    check('admin can list users',
      adminList.status === 200 && Array.isArray(adminList.body.users) && adminList.body.users.length >= 3);

    const nonAdminList = await api('GET', '/api/admin/users', { token: aliceToken2 });
    check('non-admin blocked from admin API', nonAdminList.status === 403);

    const created = await api('POST', '/api/admin/users', {
      token: adminToken,
      body: { email: `staff-${stamp}@example.com`, name: 'New Staff' },
    });
    check('admin can create a user', created.status === 200 && created.body.success);
    check('temporary password returned to admin', Boolean(created.body.temporaryPassword));
    const staffId = created.body.user && created.body.user.id;
    const tempPw = created.body.temporaryPassword;

    const staffLogin = await api('POST', '/api/local/signin', {
      body: { email: `staff-${stamp}@example.com`, password: tempPw },
    });
    check('created user can sign in with temp password', staffLogin.status === 200);
    check('created user must change password',
      staffLogin.body.user && staffLogin.body.user.mustChangePassword === true);

    const resetPw = await api('POST', `/api/admin/users/${staffId}/reset-password`, {
      token: adminToken,
      body: { password: 'resetbypass99' },
    });
    check('admin can reset a password', resetPw.status === 200 && resetPw.body.success);

    const staffLogin2 = await api('POST', '/api/local/signin', {
      body: { email: `staff-${stamp}@example.com`, password: 'resetbypass99' },
    });
    check('reset password works for the user', staffLogin2.status === 200);

    const genReset = await api('POST', `/api/admin/users/${staffId}/reset-password`, {
      token: adminToken,
      body: {},
    });
    check('admin can generate a password', genReset.status === 200 && Boolean(genReset.body.temporaryPassword));

    const staffLogin3 = await api('POST', '/api/local/signin', {
      body: { email: `staff-${stamp}@example.com`, password: genReset.body.temporaryPassword },
    });
    check('generated password signs in', staffLogin3.status === 200);

    const disabled = await api('PATCH', `/api/admin/users/${staffId}`, {
      token: adminToken,
      body: { isActive: false },
    });
    check('admin can deactivate a user', disabled.status === 200 && disabled.body.success);
    const disabledLogin = await api('POST', '/api/local/signin', {
      body: { email: `staff-${stamp}@example.com`, password: genReset.body.temporaryPassword },
    });
    check('deactivated user cannot sign in', disabledLogin.status === 403);

    const noAdminEmail = await api('POST', '/api/admin/users', {
      token: aliceToken2,
      body: { email: `sneaky-${stamp}@example.com`, name: 'Sneaky' },
    });
    check('non-admin cannot create users', noAdminEmail.status === 403);
  }

  // ----------------------------------------------------------------
  section('Real-time: typing indicator');
  const typingPromise = waitFor(bobSocket, 'typing');
  aliceSocket.emit('typing', {
    chatId,
    userId: aliceId,
    recipientId: bobId,
    name: 'Alice',
    isTyping: true,
  });
  const typing = await typingPromise;
  check('typing event relayed to the other participant',
    typing && String(typing.userId) === String(aliceId) && typing.isTyping === true);

  // ----------------------------------------------------------------
  section('Profile picture & privacy settings');
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const avatarUpload = await api('POST', '/api/users/me/avatar', {
    token: aliceToken2,
    body: { avatar: 'data:image/png;base64,' + png1x1 },
  });
  check('profile picture uploads',
    avatarUpload.status === 200 && avatarUpload.body.avatarUrl);
  if (avatarUpload.body && avatarUpload.body.avatarUrl) {
    const img = await fetch(BASE + avatarUpload.body.avatarUrl);
    const type = img.headers.get('content-type') || '';
    check('profile picture is served statically', img.status === 200 && type.includes('image'));
  } else {
    check('profile picture is served statically', false, 'no avatarUrl');
  }
  const badAvatar = await api('POST', '/api/users/me/avatar', {
    token: aliceToken2,
    body: { avatar: 'not-an-image' },
  });
  check('invalid picture rejected', badAvatar.status === 400);

  const saveSettings = await api('PATCH', `/api/users/${aliceId}`, {
    token: aliceToken2,
    body: { onlineStatus: true, onlineVisibility: 'contacts', showInSearch: false },
  });
  check('privacy settings save',
    saveSettings.status === 200 && saveSettings.body.user &&
    saveSettings.body.user.onlineVisibility === 'contacts' &&
    saveSettings.body.user.showInSearch === false);

  const badVisibility = await api('PATCH', `/api/users/${aliceId}`, {
    token: aliceToken2,
    body: { onlineVisibility: 'somewhere' },
  });
  check('invalid visibility rejected', badVisibility.status === 400);

  const foreignPatch = await api('PATCH', `/api/users/${aliceId}`, {
    token: carolToken,
    body: { onlineStatus: false },
  });
  check('cannot change someone else settings', foreignPatch.status === 403);

  const hiddenSearch = await api('GET', '/api/local/users?q=alice', { token: bobToken });
  check('hidden from search when showInSearch is off',
    hiddenSearch.status === 200 &&
    !(hiddenSearch.body.users || []).some((u) => String(u.id) === String(aliceId)));

  // Presence privacy: Bob's roster must drop Alice when she hides,
  // and come back when she re-enables her status.
  const rosterHidden = waitFor(bobSocket, 'presence');
  await api('PATCH', `/api/users/${aliceId}`, {
    token: aliceToken2,
    body: { onlineStatus: false },
  });
  const hiddenRoster = await rosterHidden;
  check('presence broadcast hides user who turned status off',
    hiddenRoster && Array.isArray(hiddenRoster.online) &&
    !hiddenRoster.online.includes(String(aliceId)));

  const rosterBack = waitFor(bobSocket, 'presence');
  await api('PATCH', `/api/users/${aliceId}`, {
    token: aliceToken2,
    body: { onlineStatus: true, onlineVisibility: 'everyone', showInSearch: true },
  });
  const restoredRoster = await rosterBack;
  check('presence broadcast restores user who turned status on',
    restoredRoster && restoredRoster.online.includes(String(aliceId)));

  // ----------------------------------------------------------------
  section('Smileys & stickers');
  const stickerMsg = await api('POST', '/api/messages', {
    token: aliceToken2,
    body: { chatId, content: '🎉', type: 'sticker' },
  });
  check('sticker message stored with type sticker',
    stickerMsg.status === 200 && stickerMsg.body.message &&
    stickerMsg.body.message.message_type === 'sticker');
  const stickerList = await api('GET', `/api/messages?chatId=${chatId}&limit=5`, { token: aliceToken2 });
  check('sticker listed back',
    stickerList.body.messages.some((m) => m.message_type === 'sticker' && m.content === '🎉'));

  // ----------------------------------------------------------------
  section('Invalid input handling');
  const noChatMsg = await api('POST', '/api/messages', {
    token: aliceToken2,
    body: { chatId: 999999, content: 'ghost' },
  });
  check('message to missing chat is 404', noChatMsg.status === 404);

  const badToken = await api('GET', '/api/chats', { token: 'not-a-real-token' });
  check('invalid token rejected with 401', badToken.status === 401);

  const missingFields = await api('POST', '/api/messages', {
    token: aliceToken2,
    body: { chatId },
  });
  check('empty content rejected', missingFields.status === 400);

  // ----------------------------------------------------------------
  aliceSocket.close();
  bobSocket.close();
  carolSock.close();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
