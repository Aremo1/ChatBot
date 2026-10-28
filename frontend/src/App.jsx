import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API;

const TOKEN_KEY = 'rhosam.token';
const USER_KEY = 'rhosam.user';

/** Thin fetch wrapper: JSON in/out, Bearer token, throws on non-2xx. */
async function request(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data || {};
}

function timeLabel(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const sameId = (a, b) => String(a) === String(b);
const isGroupChat = (chat) => Boolean(chat) && (chat.type === 'group' || Number(chat.is_group) === 1);

const SMILEYS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
  '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘',
  '😎', '🤩', '🥳', '😏', '😞', '😔', '😟', '😕',
  '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭',
  '😤', '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨',
  '🤔', '🤗', '🤭', '🤫', '🤥', '😶', '😐', '😑',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '❤️', '💔',
];

const STICKERS = [
  '🎉', '🎈', '🎂', '🎁', '😺', '🐶', '🦄', '🐢',
  '🌹', '🌈', '⭐', '🔥', '💯', '🥳', '😎', '🥰',
];

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

function Avatar({ name, url, size = 'w-10 h-10', group }) {
  if (url) {
    return <img src={url} alt={name || 'user'} className={`${size} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${size} rounded-full ${group ? 'bg-secondary-500' : 'bg-primary-500'} flex items-center justify-center text-white font-semibold text-sm shrink-0`}>
      {group ? '👥' : (name || 'U').charAt(0).toUpperCase()}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} bg-dark-800 rounded-2xl border border-dark-600 max-h-[90vh] overflow-y-auto`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-dark-700 rounded-lg">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-primary-500';
const primaryBtn =
  'w-full bg-primary-500 hover:bg-primary-600 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60';
const ghostBtn =
  'px-3 py-1.5 rounded-lg border border-dark-600 text-gray-300 hover:border-primary-500 hover:text-white transition-colors text-sm';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  // Session
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [booting, setBooting] = useState(true);

  // Auth modal
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Password reset (OTP)
  const [showReset, setShowReset] = useState(false);
  const [resetStep, setResetStep] = useState('email');
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetInfo, setResetInfo] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Forced password change (admin-created accounts)
  const [showChangePw, setShowChangePw] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [changePwError, setChangePwError] = useState('');
  const [changePwLoading, setChangePwLoading] = useState(false);

  // Chats
  const [chats, setChats] = useState([]);
  const [currentChat, setCurrentChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [messageError, setMessageError] = useState('');
  const [sending, setSending] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);

  // People search / add
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleMode, setPeopleMode] = useState('contact'); // contact | groupMember
  const [peopleQuery, setPeopleQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');

  // Group creation
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [groupPeople, setGroupPeople] = useState([]);
  const [groupSelected, setGroupSelected] = useState([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState('');

  // Contact requests
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  // Notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);

  // Admin
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminRole, setAdminRole] = useState('user');
  const [adminMsg, setAdminMsg] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  // Settings (profile picture + privacy)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftOnline, setDraftOnline] = useState(true);
  const [draftVisibility, setDraftVisibility] = useState('everyone');
  const [draftSearch, setDraftSearch] = useState(true);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);

  // Smileys / stickers
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState('smileys');

  // Presence / typing
  const [onlineIds, setOnlineIds] = useState([]);
  const [typingFrom, setTypingFrom] = useState(null);

  // PWA install
  const [installPrompt, setInstallPrompt] = useState(null);

  const socketRef = useRef(null);
  const currentChatRef = useRef(null);
  const userRef = useRef(null);
  const tokenRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingSeenRef = useRef(0);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => { currentChatRef.current = currentChat; }, [currentChat]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  /* ---------------- PWA install prompt ---------------- */
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } finally {
      setInstallPrompt(null);
    }
  };

  /* ---------------- session restore ---------------- */
  useEffect(() => {
    (async () => {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);
      if (!savedToken || !savedUser) {
        setBooting(false);
        return;
      }
      try {
        const data = await request('/api/auth/me', { token: savedToken });
        if (data.success && data.user) {
          setUser(data.user);
          setToken(savedToken);
        } else {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      } catch (e) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  /* ---------------- data loaders ---------------- */
  const loadChats = useCallback(async (tok) => {
    const t = tok || tokenRef.current;
    if (!t) return;
    try {
      const data = await request('/api/chats', { token: t });
      if (data.success) setChats(data.chats || []);
    } catch (e) {
      console.error('Failed to fetch chats:', e);
    }
  }, []);

  const loadNotifications = useCallback(async (tok) => {
    const t = tok || tokenRef.current;
    if (!t) return;
    try {
      const data = await request('/api/notifications', { token: t });
      if (data.success) {
        setNotifications(data.notifications || []);
        setUnread(Number(data.unread) || 0);
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    }
  }, []);

  const loadRequests = useCallback(async (tok) => {
    const t = tok || tokenRef.current;
    if (!t) return;
    try {
      const data = await request('/api/requests', { token: t });
      if (data.success) {
        setIncoming(data.incoming || []);
        setOutgoing(data.outgoing || []);
      }
    } catch (e) {
      console.error('Failed to fetch requests:', e);
    }
  }, []);

  const searchPeople = useCallback(async (q, tok) => {
    const t = tok || tokenRef.current;
    if (!t) return;
    setPeopleLoading(true);
    try {
      const data = await request(`/api/local/users?q=${encodeURIComponent(q || '')}`, { token: t });
      setPeople(data.users || []);
      setPeopleError('');
    } catch (e) {
      setPeople([]);
      setPeopleError(e.message || 'Could not search people');
    } finally {
      setPeopleLoading(false);
    }
  }, []);

  const loadAdminUsers = useCallback(async (tok) => {
    const t = tok || tokenRef.current;
    if (!t) return;
    try {
      const data = await request('/api/admin/users', { token: t });
      if (data.success) setAdminUsers(data.users || []);
    } catch (e) {
      setAdminError(e.message || 'Could not load users');
    }
  }, []);

  const searchGroupPeople = useCallback(async (q, tok) => {
    const t = tok || tokenRef.current;
    if (!t) return;
    try {
      const data = await request(`/api/local/users?q=${encodeURIComponent(q || '')}`, { token: t });
      setGroupPeople(data.users || []);
    } catch (e) {
      setGroupPeople([]);
    }
  }, []);

  /* ---------------- messages ---------------- */
  const loadMessages = useCallback(async (chatId, tok) => {
    const t = tok || tokenRef.current;
    if (!t || !chatId) return;
    try {
      const data = await request(`/api/messages?chatId=${chatId}&limit=100`, { token: t });
      if (data.success) setMessages(data.messages || []);
      const list = data.messages || [];
      await Promise.all(
        list
          .filter((m) => !m.is_read && !sameId(m.sender_id, userRef.current?.id))
          .map((m) => request(`/api/messages/${m.id}/read`, { method: 'PATCH', token: t }).catch(() => {}))
      );
      setChats((prev) =>
        prev.map((c) => (sameId(c.id, chatId) ? { ...c, unread_count: 0 } : c))
      );
    } catch (e) {
      console.error('Failed to fetch messages:', e);
    }
  }, []);

  const selectChat = useCallback((chat) => {
    setCurrentChat(chat);
    setMessageError('');
    setTypingFrom(null);
    loadMessages(chat.id);
    setPeopleOpen(false);
    setGroupOpen(false);
  }, [loadMessages]);

  /** Reload the chat list and re-select a chat by id (fresh fields). */
  const refreshAndSelect = useCallback(async (chatId) => {
    await loadChats();
    try {
      const fresh = await request('/api/chats', { token: tokenRef.current });
      const chat = (fresh.chats || []).find((c) => sameId(c.id, chatId));
      if (chat) selectChat(chat);
    } catch (e) { /* non-fatal */ }
  }, [loadChats, selectChat]);

  /* ---------------- socket ---------------- */
  useEffect(() => {
    if (!user || !token) return undefined;

    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('user_joined', user.id);
    });

    socket.on('presence', (payload) => {
      if (payload && Array.isArray(payload.online)) setOnlineIds(payload.online);
    });
    socket.on('user_joined', (userId) => {
      setOnlineIds((prev) => (prev.includes(String(userId)) ? prev : [...prev, String(userId)]));
    });
    socket.on('user_left', (userId) => {
      setOnlineIds((prev) => prev.filter((id) => id !== String(userId)));
    });

    socket.on('new_message', (msg) => {
      if (!msg) return;
      const chatId = String(msg.chat_id ?? msg.chatId);
      const openId = currentChatRef.current && String(currentChatRef.current.id);
      if (openId && openId === chatId) {
        setMessages((prev) => (prev.some((m) => sameId(m.id, msg.id)) ? prev : [msg, ...prev]));
        request(`/api/messages/${msg.id}/read`, { method: 'PATCH', token: tokenRef.current }).catch(() => {});
      } else {
        setChats((prev) =>
          prev.map((c) =>
            String(c.id) === chatId
              ? { ...c, unread_count: Number(c.unread_count || 0) + 1, last_message: msg.content }
              : c
          )
        );
      }
    });

    socket.on('message_read', (payload) => {
      if (!payload || payload.messageId == null) return;
      const openId = currentChatRef.current && String(currentChatRef.current.id);
      if (payload.chatId && openId && String(payload.chatId) !== openId) return;
      setMessages((prev) =>
        prev.map((m) => (sameId(m.id, payload.messageId) ? { ...m, is_read: 1 } : m))
      );
    });

    socket.on('message_edited', (msg) => {
      if (!msg) return;
      setMessages((prev) => prev.map((m) => (sameId(m.id, msg.id) ? { ...m, ...msg } : m)));
    });

    socket.on('message_deleted', (payload) => {
      if (!payload) return;
      setMessages((prev) => prev.filter((m) => !sameId(m.id, payload.messageId)));
    });

    socket.on('notification', (n) => {
      if (!n) return;
      setNotifications((prev) => [n, ...prev].slice(0, 50));
      setUnread((prev) => prev + 1);
    });

    socket.on('new_request', (req) => {
      if (!req) return;
      setIncoming((prev) => (prev.some((r) => sameId(r.id, req.id)) ? prev : [req, ...prev]));
    });

    socket.on('request_cancelled', (payload) => {
      const id = payload && payload.request && payload.request.id;
      if (id == null) return;
      setIncoming((prev) => prev.filter((r) => !sameId(r.id, id)));
    });

    socket.on('request_accepted', () => {
      loadChats();
      loadRequests();
    });

    // Group membership changed — refresh the chat list.
    socket.on('chat_added', () => loadChats());
    socket.on('chat_removed', (payload) => {
      const id = payload && payload.chatId;
      if (currentChatRef.current && sameId(currentChatRef.current.id, id)) {
        setCurrentChat(null);
        setMessages([]);
      }
      loadChats();
    });

    socket.on('typing', (payload) => {
      if (!payload) return;
      const openId = currentChatRef.current && String(currentChatRef.current.id);
      if (!openId || String(payload.chatId) !== openId) return;
      if (sameId(payload.userId, userRef.current?.id)) return;
      if (payload.isTyping === false) {
        setTypingFrom(null);
        return;
      }
      setTypingFrom(payload.name || 'Someone');
      const seen = ++typingSeenRef.current;
      setTimeout(() => {
        if (typingSeenRef.current === seen) setTypingFrom(null);
      }, 2500);
    });

    loadChats(token);
    loadNotifications(token);
    loadRequests(token);

    return () => {
      socket.emit('user_left', user.id);
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingFrom]);

  /* ---------------- auth actions ---------------- */
  const finishAuth = (data) => {
    const nextUser = data.user;
    const nextToken = data.token;
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    localStorage.setItem(TOKEN_KEY, nextToken);
    setUser(nextUser);
    setToken(nextToken);
    setAuthError('');
    setShowAuth(false);
    if (nextUser.mustChangePassword) {
      setChangePwError('');
      setShowChangePw(true);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/local/signin' : '/api/local/signup';
      const body =
        authMode === 'login'
          ? { email: authEmail, password: authPassword }
          : { email: authEmail, password: authPassword, name: authName };
      const data = await request(endpoint, { method: 'POST', body });
      if (data.success && data.token) {
        setAuthEmail('');
        setAuthPassword('');
        setAuthName('');
        setAuthMode('login');
        finishAuth(data);
      } else {
        setAuthError(data.message || 'Authentication failed');
      }
    } catch (err) {
      setAuthError(err.message || 'Could not reach the server');
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await request('/api/local/signout', { method: 'POST', token });
    } catch (e) {
      // The token is discarded regardless.
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    socketRef.current?.emit('user_left', user?.id);
    socketRef.current?.disconnect();
    socketRef.current = null;
    setUser(null);
    setToken(null);
    setChats([]);
    setMessages([]);
    setCurrentChat(null);
    setNotifications([]);
    setUnread(0);
    setIncoming([]);
    setOutgoing([]);
    setOnlineIds([]);
    setShowAuth(false);
  };

  /* ---------------- password reset flow ---------------- */
  const openReset = () => {
    setShowAuth(false);
    setShowReset(true);
    setResetStep('email');
    setResetEmail(authEmail);
    setResetOtp('');
    setResetToken('');
    setResetPassword('');
    setResetError('');
    setResetInfo('');
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetLoading(true);
    try {
      const data = await request('/api/local/forgot-password', {
        method: 'POST',
        body: { email: resetEmail },
      });
      setResetInfo(data.devCode ? `Dev code (SMTP not configured): ${data.devCode}` : '');
      setResetStep('otp');
    } catch (err) {
      setResetError(err.message || 'Could not send the code');
    } finally {
      setResetLoading(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetLoading(true);
    try {
      const data = await request('/api/local/verify-otp', {
        method: 'POST',
        body: { email: resetEmail, code: resetOtp },
      });
      setResetToken(data.resetToken);
      setResetStep('password');
    } catch (err) {
      setResetError(err.message || 'Incorrect code');
    } finally {
      setResetLoading(false);
    }
  };

  const submitNewPassword = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetLoading(true);
    try {
      await request('/api/local/reset-password', {
        method: 'POST',
        body: { resetToken, password: resetPassword },
      });
      setShowReset(false);
      setAuthMode('login');
      setAuthEmail(resetEmail);
      setShowAuth(true);
    } catch (err) {
      setResetError(err.message || 'Could not reset the password');
    } finally {
      setResetLoading(false);
    }
  };

  /* ---------------- forced password change ---------------- */
  const submitChangePw = async (e) => {
    e.preventDefault();
    setChangePwError('');
    setChangePwLoading(true);
    try {
      const data = await request('/api/local/change-password', {
        method: 'POST',
        token,
        body: { currentPassword: curPw, newPassword: newPw },
      });
      if (data.success) {
        const updated = { ...user, mustChangePassword: false };
        localStorage.setItem(USER_KEY, JSON.stringify(updated));
        setUser(updated);
        setShowChangePw(false);
        setCurPw('');
        setNewPw('');
      }
    } catch (err) {
      setChangePwError(err.message || 'Could not change the password');
    } finally {
      setChangePwLoading(false);
    }
  };

  /* ---------------- sending messages ---------------- */
  const sendChatMessage = async (content, type = 'text', attachment = null) => {
    const text = content == null ? '' : String(content).trim();
    if (!text && !attachment) return;
    if (!currentChatRef.current || sending) return;
    const chat = currentChatRef.current;
    setSending(true);
    try {
      const data = await request('/api/messages', {
        method: 'POST',
        token,
        body: {
          chatId: chat.id,
          content: text || (attachment ? attachment.name : ''),
          type,
          ...(attachment ? { attachment } : {}),
        },
      });
      if (data.success && data.message) {
        const msg = data.message;
        setMessages((prev) => (prev.some((m) => sameId(m.id, msg.id)) ? prev : [msg, ...prev]));
        setChats((prev) =>
          prev.map((c) =>
            sameId(c.id, chat.id)
              ? { ...c, last_message: msg.content, updated_at: msg.created_at, unread_count: 0 }
              : c
          )
        );
        setMessageError('');
        emitTyping(false);
      } else {
        setMessageError(data.message || 'Failed to send message');
      }
    } catch (err) {
      setMessageError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || !currentChat) return;
    const content = input;
    setInput('');
    await sendChatMessage(content, 'text');
  };

  const sendSticker = async (sticker) => {
    setShowPicker(false);
    await sendChatMessage(sticker, 'sticker');
  };

  const onFileSelected = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!currentChatRef.current) return;
    setAttachBusy(true);
    setMessageError('');
    try {
      const dataUrl = await readAsDataURL(file);
      const up = await request('/api/uploads', {
        method: 'POST',
        token,
        body: { file: dataUrl, name: file.name },
      });
      if (up.success && up.attachment) {
        await sendChatMessage('', 'text', up.attachment);
      } else {
        setMessageError(up.message || 'Upload failed');
      }
    } catch (err) {
      setMessageError(err.message || 'Upload failed');
    } finally {
      setAttachBusy(false);
    }
  };

  const emitTyping = (isTyping) => {
    const socket = socketRef.current;
    const chat = currentChatRef.current;
    if (!socket || !chat) return;
    socket.emit('typing', {
      chatId: chat.id,
      userId: userRef.current?.id,
      recipientId: otherIdOf(chat),
      name: userRef.current?.name,
      isTyping,
    });
  };

  const onComposerChange = (e) => {
    setInput(e.target.value);
    const socket = socketRef.current;
    const chat = currentChatRef.current;
    if (!socket || !chat) return;
    socket.emit('typing', {
      chatId: chat.id,
      userId: userRef.current?.id,
      recipientId: otherIdOf(chat),
      name: userRef.current?.name,
      isTyping: true,
    });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit('typing', {
        chatId: chat.id,
        userId: userRef.current?.id,
        recipientId: otherIdOf(chat),
        name: userRef.current?.name,
        isTyping: false,
      });
    }, 1500);
  };

  /** The other participant of a direct chat, from this client's view. */
  function otherIdOf(chat) {
    if (!chat || !user || isGroupChat(chat)) return null;
    return sameId(chat.user1_id, user.id) ? chat.user2_id : chat.user1_id;
  }

  /* ---------------- contact requests ---------------- */
  const sendRequest = async (receiverId) => {
    setPeopleError('');
    try {
      await request('/api/requests', { method: 'POST', token, body: { receiverId } });
      await searchPeople(peopleQuery);
      await loadRequests();
    } catch (err) {
      setPeopleError(err.message || 'Could not send the request');
    }
  };

  const acceptRequest = async (req) => {
    try {
      const data = await request(`/api/requests/${req.id}/accept`, { method: 'POST', token });
      setIncoming((prev) => prev.filter((r) => !sameId(r.id, req.id)));
      if (data.success && data.chat) {
        await refreshAndSelect(data.chat.id);
      }
      setRequestsOpen(false);
    } catch (err) {
      setPeopleError(err.message || 'Could not accept the request');
    }
  };

  const rejectRequest = async (req) => {
    try {
      await request(`/api/requests/${req.id}/reject`, { method: 'POST', token });
      setIncoming((prev) => prev.filter((r) => !sameId(r.id, req.id)));
    } catch (err) {
      setPeopleError(err.message || 'Could not decline the request');
    }
  };

  const cancelRequest = async (req) => {
    try {
      await request(`/api/requests/${req.id}`, { method: 'DELETE', token });
      setOutgoing((prev) => prev.filter((r) => !sameId(r.id, req.id)));
    } catch (err) {
      setPeopleError(err.message || 'Could not cancel the request');
    }
  };

  /* ---------------- chat creation ---------------- */
  const openChatWith = async (targetUserId) => {
    try {
      const data = await request('/api/chats', {
        method: 'POST',
        token,
        body: { userId: user.id, otherUserId: targetUserId },
      });
      if (data.success && data.chat) {
        await refreshAndSelect(data.chat.id);
        setPeopleOpen(false);
      }
    } catch (err) {
      setPeopleError(err.message || 'Could not start a chat');
    }
  };

  /* ---------------- groups ---------------- */
  const openGroupModal = () => {
    setGroupOpen(true);
    setGroupName('');
    setGroupQuery('');
    setGroupSelected([]);
    setGroupError('');
    searchGroupPeople('');
  };

  const toggleGroupMember = (u) => {
    setGroupSelected((prev) =>
      prev.some((id) => sameId(id, u.id))
        ? prev.filter((id) => !sameId(id, u.id))
        : [...prev, u.id]
    );
  };

  const createGroup = async (e) => {
    e.preventDefault();
    setGroupError('');
    if (!groupName.trim()) {
      setGroupError('Give the group a name');
      return;
    }
    if (groupSelected.length === 0) {
      setGroupError('Pick at least one person to add');
      return;
    }
    setGroupBusy(true);
    try {
      const data = await request('/api/chats', {
        method: 'POST',
        token,
        body: { name: groupName.trim(), memberIds: groupSelected },
      });
      if (data.success && data.chat) {
        setGroupOpen(false);
        await refreshAndSelect(data.chat.id);
      }
    } catch (err) {
      setGroupError(err.message || 'Could not create the group');
    } finally {
      setGroupBusy(false);
    }
  };

  const addMemberToGroup = async (userId) => {
    if (!currentChat) return;
    setPeopleError('');
    try {
      await request(`/api/chats/${currentChat.id}/members`, {
        method: 'POST',
        token,
        body: { userId },
      });
      setPeopleOpen(false);
      await refreshAndSelect(currentChat.id);
    } catch (err) {
      setPeopleError(err.message || 'Could not add this person');
    }
  };

  const leaveGroup = async () => {
    if (!currentChat) return;
    if (!window.confirm(`Leave "${currentChat.other_user_name || 'this group'}"?`)) return;
    try {
      await request(`/api/chats/${currentChat.id}/leave`, { method: 'POST', token });
      setCurrentChat(null);
      setMessages([]);
      await loadChats();
    } catch (err) {
      setMessageError(err.message || 'Could not leave the group');
    }
  };

  /* ---------------- notifications ---------------- */
  const toggleNotifications = async () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      await loadNotifications();
      if (unread > 0) {
        try {
          await request('/api/notifications/read', { method: 'POST', token, body: {} });
          setUnread(0);
          setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
        } catch (e) {
          // Non-fatal: the badge refreshes next time.
        }
      }
    }
  };

  /* ---------------- admin ---------------- */
  const openAdmin = () => {
    setAdminOpen(true);
    setAdminError('');
    setAdminMsg('');
    loadAdminUsers();
  };

  const adminCreateUser = async (e) => {
    e.preventDefault();
    setAdminError('');
    setAdminMsg('');
    setAdminLoading(true);
    try {
      const data = await request('/api/admin/users', {
        method: 'POST',
        token,
        body: {
          email: adminEmail,
          name: adminName,
          ...(adminPassword ? { password: adminPassword } : {}),
          role: adminRole,
        },
      });
      setAdminMsg(
        data.temporaryPassword
          ? `Created ${data.user.email}. Temporary password: ${data.temporaryPassword}`
          : `Created ${data.user.email}`
      );
      setAdminEmail('');
      setAdminName('');
      setAdminPassword('');
      setAdminRole('user');
      await loadAdminUsers();
    } catch (err) {
      setAdminError(err.message || 'Could not create the user');
    } finally {
      setAdminLoading(false);
    }
  };

  const adminResetPassword = async (u) => {
    setAdminError('');
    setAdminMsg('');
    try {
      const data = await request(`/api/admin/users/${u.id}/reset-password`, {
        method: 'POST',
        token,
        body: {},
      });
      setAdminMsg(`New password for ${u.email}: ${data.temporaryPassword}`);
    } catch (err) {
      setAdminError(err.message || 'Could not reset the password');
    }
  };

  const adminToggle = async (u, patch, label) => {
    setAdminError('');
    setAdminMsg('');
    try {
      await request(`/api/admin/users/${u.id}`, { method: 'PATCH', token, body: patch });
      setAdminMsg(label);
      await loadAdminUsers();
    } catch (err) {
      setAdminError(err.message || 'Could not update the user');
    }
  };

  /* ---------------- settings (profile + privacy) ---------------- */
  const openSettings = () => {
    setDraftOnline(user.onlineStatus !== false);
    setDraftVisibility(user.onlineVisibility || 'everyone');
    setDraftSearch(user.showInSearch !== false);
    setSettingsMsg('');
    setSettingsError('');
    setSettingsOpen(true);
    setNotifOpen(false);
  };

  const saveAvatar = async (file) => {
    if (!file) return;
    setSettingsError('');
    setAvatarBusy(true);
    try {
      const dataUrl = await readAsDataURL(file);
      const data = await request('/api/users/me/avatar', {
        method: 'POST',
        token,
        body: { avatar: dataUrl },
      });
      if (data.success) {
        const updated = { ...user, avatarUrl: data.avatarUrl + '?t=' + Date.now() };
        localStorage.setItem(USER_KEY, JSON.stringify(updated));
        setUser(updated);
        setSettingsMsg('Profile picture updated');
        await loadChats();
      }
    } catch (err) {
      setSettingsError(err.message || 'Could not upload the picture');
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSettingsError('');
    setSettingsMsg('');
    try {
      const data = await request(`/api/users/${user.id}`, {
        method: 'PATCH',
        token,
        body: {
          onlineStatus: draftOnline,
          onlineVisibility: draftVisibility,
          showInSearch: draftSearch,
        },
      });
      if (data.success) {
        const updated = { ...user, ...(data.user || {}) };
        localStorage.setItem(USER_KEY, JSON.stringify(updated));
        setUser(updated);
        setSettingsMsg('Settings saved');
      }
    } catch (err) {
      setSettingsError(err.message || 'Could not save the settings');
    }
  };

  /* ---------------- render helpers ---------------- */
  const openRequests = async () => {
    setRequestsOpen(true);
    setNotifOpen(false);
    setRequestsLoading(true);
    try {
      await loadRequests();
    } finally {
      setRequestsLoading(false);
    }
  };

  const openPeople = (mode = 'contact') => {
    setPeopleOpen(true);
    setPeopleMode(mode);
    setNotifOpen(false);
    setPeopleError('');
    searchPeople('');
  };

  const pendingIncomingFor = (u) =>
    incoming.find((r) => sameId(r.sender_id, u.id));

  if (booting) {
    return (
      <div className="flex h-screen items-center justify-center bg-dark-900 text-light-200">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  /* ---------------- signed out ---------------- */
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-dark-900 text-light-200 p-4">
        <div className="w-full max-w-md p-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">Sign in to Chat</h1>
            <p className="text-gray-400 mt-1">Anyone can create an account and start messaging</p>
          </div>

          <div className="mt-6 space-y-3">
            <button
              onClick={() => { setAuthMode('login'); setAuthError(''); setShowAuth(true); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dark-600 hover:border-primary-500 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Email / password sign-in
            </button>
            <button
              onClick={() => { setAuthMode('signup'); setAuthError(''); setShowAuth(true); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dark-600 hover:border-primary-500 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a3 3 0 01-3 3v6a3 3 0 01-3-3V6a3 3 0 013-3h6a3 3 0 013 3z" />
              </svg>
              Create an account
            </button>
            <button
              onClick={openReset}
              className="w-full text-sm text-gray-400 hover:text-primary-400 py-2 transition-colors"
            >
              Forgot your password?
            </button>
            {installPrompt && (
              <button
                onClick={installApp}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-primary-500 text-primary-400 hover:bg-primary-500/10 transition-colors"
              >
                📲 Install the app
              </button>
            )}
          </div>

          {authError && <p className="mt-4 text-sm text-red-400 text-center">{authError}</p>}

          {/* Auth modal */}
          {showAuth && (
            <Modal title={authMode === 'login' ? 'Sign in' : 'Create account'} onClose={() => setShowAuth(false)}>
              <form onSubmit={handleAuth} className="space-y-4">
                {authMode === 'signup' && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Name</label>
                    <input type="text" value={authName} onChange={(e) => setAuthName(e.target.value)}
                      className={inputCls} placeholder="Your name" autoFocus required />
                  </div>
                )}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Email</label>
                  <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}
                    className={inputCls} placeholder="you@example.com" autoFocus required />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Password</label>
                  <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}
                    className={inputCls} placeholder="At least 8 characters" required />
                </div>
                {authError && <p className="text-sm text-red-400">{authError}</p>}
                <button type="submit" className={primaryBtn} disabled={authLoading}>
                  {authLoading ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}
                </button>
              </form>
              <div className="mt-4 space-y-2 text-center text-sm text-gray-500">
                <button type="button"
                  onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); }}
                  className="text-primary-400 hover:text-primary-300 underline">
                  {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </button>
                <div>
                  <button type="button" onClick={openReset} className="text-gray-400 hover:text-primary-400 underline">
                    Forgot password?
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {/* Password reset modal */}
          {showReset && (
            <Modal title="Reset password" onClose={() => setShowReset(false)}>
              {resetStep === 'email' && (
                <form onSubmit={submitForgot} className="space-y-4">
                  <p className="text-sm text-gray-400">
                    Enter your email and we will send you a 6-digit code.
                  </p>
                  <input type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)}
                    className={inputCls} placeholder="you@example.com" autoFocus required />
                  {resetError && <p className="text-sm text-red-400">{resetError}</p>}
                  <button type="submit" className={primaryBtn} disabled={resetLoading}>
                    {resetLoading ? 'Sending…' : 'Send code'}
                  </button>
                </form>
              )}

              {resetStep === 'otp' && (
                <form onSubmit={submitOtp} className="space-y-4">
                  <p className="text-sm text-gray-400">Enter the 6-digit code sent to {resetEmail}.</p>
                  {resetInfo && <p className="text-sm text-yellow-400 break-all">{resetInfo}</p>}
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, ''))}
                    className={inputCls + ' text-center tracking-[0.5em] text-xl'} placeholder="000000"
                    autoFocus required />
                  {resetError && <p className="text-sm text-red-400">{resetError}</p>}
                  <button type="submit" className={primaryBtn} disabled={resetLoading || resetOtp.length !== 6}>
                    {resetLoading ? 'Verifying…' : 'Verify code'}
                  </button>
                  <button type="button" onClick={() => setResetStep('email')} className="w-full text-sm text-gray-400 underline">
                    Use a different email
                  </button>
                </form>
              )}

              {resetStep === 'password' && (
                <form onSubmit={submitNewPassword} className="space-y-4">
                  <p className="text-sm text-gray-400">Choose a new password (at least 8 characters).</p>
                  <input type="password" value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className={inputCls} placeholder="New password" autoFocus required />
                  {resetError && <p className="text-sm text-red-400">{resetError}</p>}
                  <button type="submit" className={primaryBtn} disabled={resetLoading}>
                    {resetLoading ? 'Saving…' : 'Set new password'}
                  </button>
                </form>
              )}
            </Modal>
          )}
        </div>
      </div>
    );
  }

  /* ---------------- signed in ---------------- */
  const onlineSet = new Set(onlineIds.map(String));
  const pendingCount = incoming.length;
  const groupChat = isGroupChat(currentChat);

  return (
    <div className="flex h-screen bg-dark-900 text-light-200 overflow-hidden">
      {/* Sidebar — full screen on mobile when no chat is open */}
      <div className={`${currentChat ? 'hidden md:flex' : 'flex'} w-full md:w-1/3 min-w-0 md:min-w-[260px] bg-dark-800 border-r border-dark-700 flex-col`}>
        <div className="p-4 flex items-center gap-3 border-b border-dark-700">
          <Avatar name={user.name} url={user.avatarUrl} />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{user.name}</h2>
            <p className="text-sm text-gray-400 truncate">{user.email}</p>
          </div>
          {installPrompt && (
            <button onClick={installApp} title="Install app" className="p-2 hover:bg-dark-700 rounded-lg text-gray-400 hover:text-white">
              📲
            </button>
          )}
          <button onClick={signOut} title="Sign out" className="p-2 hover:bg-dark-700 rounded-lg text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Action bar */}
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-dark-700">
          <button onClick={() => openPeople('contact')} className={`${ghostBtn} flex-1`}>🔍 Find people</button>
          <button onClick={openGroupModal} className={`${ghostBtn} flex-1`}>👥 New group</button>
          <button onClick={openRequests} className={`${ghostBtn} relative`}>
            Requests
            {pendingCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {pendingCount}
              </span>
            )}
          </button>
          <button onClick={toggleNotifications} className={`${ghostBtn} relative`} title="Notifications">
            🔔
            {unread > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {unread}
              </span>
            )}
          </button>
          <button onClick={openSettings} className={ghostBtn} title="Settings">⚙️</button>
          {user.role === 'admin' && (
            <button onClick={openAdmin} className={ghostBtn} title="Admin">🛡️</button>
          )}
        </div>

        {/* Notification dropdown */}
        {notifOpen && (
          <div className="mx-3 mt-3 bg-dark-700 border border-dark-600 rounded-lg max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`p-3 border-b border-dark-600 last:border-b-0 ${n.is_read ? 'opacity-60' : ''}`}>
                  <p className="text-sm font-medium text-white">{n.title}</p>
                  <p className="text-xs text-gray-400">{n.body}</p>
                  <p className="text-xs text-gray-500 mt-1">{timeLabel(n.created_at)}</p>
                </div>
              ))
            )}
          </div>
        )}

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Conversations</h3>
          <div className="space-y-2">
            {chats.length === 0 && (
              <p className="text-sm text-gray-500">
                No conversations yet. Use <span className="text-primary-400">Find people</span> to
                search for a colleague, or start a <span className="text-primary-400">New group</span>.
              </p>
            )}
            {chats.map((chat) => {
              const active = currentChat && sameId(currentChat.id, chat.id);
              const group = isGroupChat(chat);
              const isOnline = !group && onlineSet.has(String(otherIdOf(chat)));
              const unreadCount = Number(chat.unread_count || 0);
              return (
                <button
                  key={chat.id}
                  onClick={() => selectChat(chat)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                    active ? 'bg-primary-500/20 border border-primary-500' : 'hover:bg-dark-700 border border-transparent'
                  }`}
                >
                  <div className="relative">
                    <Avatar name={chat.other_user_name} url={chat.other_user_avatar} group={group} />
                    {isOnline && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-dark-800 rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className={`font-medium truncate ${active ? 'text-white' : 'text-gray-300'}`}>
                      {chat.other_user_name || 'Unknown user'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {group
                        ? `${Number(chat.member_count) || 1} members`
                        : (chat.last_message || (isOnline ? 'Online' : 'Offline'))}
                      {!group && chat.last_message ? '' : ''}
                    </p>
                  </div>
                  {unreadCount > 0 && (
                    <span className="bg-primary-500 text-white text-xs rounded-full px-2 py-0.5">
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main chat area — hidden on mobile until a chat is open */}
      <div className={`${currentChat ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden min-w-0`}>
        {!currentChat ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-6">
              <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <h2 className="text-xl font-semibold text-gray-400 mb-2">Select a conversation</h2>
              <p className="text-gray-600">Choose a chat, or find a colleague to start a new one.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-2 md:px-4 py-3 border-b border-dark-700 bg-dark-800">
              <button
                onClick={() => setCurrentChat(null)}
                title="Back to chats"
                className="md:hidden p-2 text-gray-400 hover:text-white"
              >
                ←
              </button>
              <Avatar name={currentChat.other_user_name} url={currentChat.other_user_avatar} group={groupChat} size="w-9 h-9" />
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">{currentChat.other_user_name}</h2>
                <p className="text-xs text-gray-400">
                  {groupChat
                    ? `${Number(currentChat.member_count) || (currentChat.members && currentChat.members.length) || 1} members`
                    : typingFrom
                      ? `${typingFrom} is typing…`
                      : onlineSet.has(String(otherIdOf(currentChat)))
                        ? 'Online'
                        : 'Offline'}
                </p>
              </div>
              {groupChat && (
                <>
                  <button onClick={() => openPeople('groupMember')} className={ghostBtn} title="Add people">＋ Add</button>
                  <button onClick={leaveGroup} className={ghostBtn} title="Leave group">Leave</button>
                </>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <p className="text-center text-sm text-gray-600 pt-8">
                  {groupChat ? 'No messages yet — say hello to the group 👋' : 'No messages yet — say hello 👋'}
                </p>
              )}
              {messages.map((msg) => {
                const mine = sameId(msg.sender_id, user.id);
                const isSticker = msg.message_type === 'sticker';
                const hasAttachment = Boolean(msg.attachment_url);
                const textIsJustName = hasAttachment && msg.content === msg.attachment_name;

                if (isSticker) {
                  return (
                    <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className="text-center">
                        {!mine && <p className="text-xs font-medium text-primary-300 mb-1">{msg.sender_name}</p>}
                        <span className="text-6xl leading-none" role="img" aria-label="sticker">{msg.content}</span>
                        <p className={`text-xs mt-1 ${mine ? 'text-primary-200' : 'text-gray-500'}`}>
                          {timeLabel(msg.created_at)}
                          {mine && Number(msg.is_read) === 1 ? ' · read' : ''}
                        </p>
                      </div>
                    </div>
                  );
                }

                const isImage = hasAttachment && (msg.attachment_mime || '').startsWith('image/');
                return (
                  <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] px-4 py-2 rounded-lg ${mine ? 'bg-primary-500 text-white rounded-br-md' : 'bg-dark-700 text-gray-200 rounded-bl-md'}`}>
                      {!mine && (
                        <p className="text-xs font-medium text-primary-300 mb-1">{msg.sender_name}</p>
                      )}
                      {hasAttachment && isImage && (
                        <a href={API + msg.attachment_url} target="_blank" rel="noreferrer" className="block mb-1">
                          <img src={API + msg.attachment_url} alt={msg.attachment_name || 'attachment'}
                            className="max-h-48 rounded object-contain" loading="lazy" />
                        </a>
                      )}
                      {hasAttachment && !isImage && (
                        <a href={API + msg.attachment_url} target="_blank" rel="noreferrer"
                          className={`inline-flex items-center gap-2 mb-1 px-2 py-1 rounded text-sm underline ${
                            mine ? 'text-white' : 'text-primary-300'
                          }`}>
                          📎 {msg.attachment_name}
                        </a>
                      )}
                      {msg.content && !textIsJustName && (
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                      )}
                      <p className={`text-xs mt-1 flex items-center gap-2 ${mine ? 'text-primary-200' : 'text-gray-500'}`}>
                        <span>{timeLabel(msg.created_at)}</span>
                        {msg.is_edited ? <span>(edited)</span> : null}
                        {mine && Number(msg.is_read) === 1 && <span>· read</span>}
                        {mine && (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => {
                                const next = window.prompt('Edit message', msg.content);
                                if (next && next.trim() && next !== msg.content) {
                                  request(`/api/messages/${msg.id}/edit`, {
                                    method: 'PATCH',
                                    token,
                                    body: { content: next.trim() },
                                  })
                                    .then((d) => {
                                      if (d.success) {
                                        setMessages((prev) =>
                                          prev.map((m) => (sameId(m.id, msg.id) ? { ...m, content: d.message.content, is_edited: 1 } : m))
                                        );
                                      }
                                    })
                                    .catch((err) => setMessageError(err.message));
                                }
                              }}
                              className="opacity-60 hover:opacity-100"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => {
                                if (!window.confirm('Delete this message?')) return;
                                request(`/api/messages/${msg.id}`, { method: 'DELETE', token })
                                  .then(() => setMessages((prev) => prev.filter((m) => !sameId(m.id, msg.id))))
                                  .catch((err) => setMessageError(err.message));
                              }}
                              className="opacity-60 hover:opacity-100"
                            >
                              ✕
                            </button>
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {messageError && <p className="text-sm text-red-400 px-4 pb-2">{messageError}</p>}

            {showPicker && (
              <div className="mx-4 mb-2 bg-dark-800 border border-dark-600 rounded-lg p-3">
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setPickerTab('smileys')}
                    className={`text-sm px-3 py-1 rounded ${pickerTab === 'smileys' ? 'bg-primary-500 text-white' : 'text-gray-400'}`}
                  >
                    😊 Smilies
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerTab('stickers')}
                    className={`text-sm px-3 py-1 rounded ${pickerTab === 'stickers' ? 'bg-primary-500 text-white' : 'text-gray-400'}`}
                  >
                    🎉 Stickers
                  </button>
                  <button type="button" onClick={() => setShowPicker(false)} className="ml-auto text-gray-500 hover:text-white" title="Close picker">
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                  {(pickerTab === 'smileys' ? SMILEYS : STICKERS).map((s, i) => (
                    <button
                      key={s + i}
                      type="button"
                      className={`rounded hover:bg-dark-700 py-1 ${pickerTab === 'stickers' ? 'text-2xl' : 'text-xl'}`}
                      onClick={() => {
                        if (pickerTab === 'smileys') {
                          setInput((prev) => prev + s);
                        } else {
                          sendSticker(s);
                        }
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={sendMessage} className="flex gap-2 md:gap-3 px-2 md:px-4 py-3 border-t border-dark-700 bg-dark-800">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,application/zip,.doc,.docx,.xls,.xlsx"
                onChange={onFileSelected}
                data-testid="attachment-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                title="Attach a file"
                disabled={attachBusy}
                className="p-2 rounded-lg hover:bg-dark-700 text-xl disabled:opacity-50"
              >
                {attachBusy ? '⏳' : '📎'}
              </button>
              <button
                type="button"
                onClick={() => setShowPicker((v) => !v)}
                title="Smileys and stickers"
                className="p-2 rounded-lg hover:bg-dark-700 text-xl"
              >
                {showPicker ? '😄' : '😊'}
              </button>
              <input
                type="text"
                value={input}
                onChange={onComposerChange}
                placeholder="Type a message…"
                className={inputCls + ' min-w-0'}
              />
              <button type="submit" className={primaryBtn + ' w-auto px-4 md:px-6'} disabled={!input.trim() || sending}>
                Send
              </button>
            </form>
          </>
        )}
      </div>

      {/* Find people / add to group modal */}
      {peopleOpen && (
        <Modal title={peopleMode === 'groupMember' ? 'Add people to the group' : 'Find people'} onClose={() => setPeopleOpen(false)}>
          <div className="relative mb-4">
            <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={peopleQuery}
              onChange={(e) => { setPeopleQuery(e.target.value); searchPeople(e.target.value); }}
              className={inputCls + ' pl-10'}
              placeholder="Search by name or email"
              autoFocus
            />
          </div>

          {peopleError && <p className="text-sm text-red-400 mb-2">{peopleError}</p>}

          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {peopleLoading ? (
              <p className="text-sm text-gray-500">Searching…</p>
            ) : people.length === 0 ? (
              <p className="text-sm text-gray-500">No users match that search.</p>
            ) : (
              people.map((u) => {
                if (peopleMode === 'groupMember') {
                  const currentIds = (currentChat && currentChat.members || []).map((m) => String(m.user_id));
                  const alreadyIn = currentIds.includes(String(u.id));
                  return (
                    <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-dark-700">
                      <Avatar name={u.name} url={u.avatar_url} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">{u.name}</p>
                        <p className="text-xs text-gray-500 truncate">{u.email}</p>
                      </div>
                      {alreadyIn ? (
                        <span className="text-xs text-gray-500 px-2">In group</span>
                      ) : (
                        <button onClick={() => addMemberToGroup(u.id)} className={ghostBtn + ' border-primary-500 text-primary-400'}>＋ Add</button>
                      )}
                    </div>
                  );
                }
                const pending = pendingIncomingFor(u);
                return (
                  <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-dark-700">
                    <Avatar name={u.name} url={u.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{u.name}</p>
                      <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    </div>
                    {u.connection === 'connected' ? (
                      <button onClick={() => openChatWith(u.id)} className={ghostBtn}>Message</button>
                    ) : u.connection === 'pending_out' ? (
                      <span className="text-xs text-gray-500 px-2">Request sent</span>
                    ) : u.connection === 'pending_in' && pending ? (
                      <span className="flex gap-2">
                        <button onClick={() => acceptRequest(pending)} className={ghostBtn + ' border-green-500 text-green-400'}>Accept</button>
                        <button onClick={() => rejectRequest(pending)} className={ghostBtn + ' border-red-500 text-red-400'}>Decline</button>
                      </span>
                    ) : (
                      <button onClick={() => sendRequest(u.id)} className={ghostBtn + ' border-primary-500 text-primary-400'}>+ Add</button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Modal>
      )}

      {/* New group chat modal */}
      {groupOpen && (
        <Modal title="New group chat" onClose={() => setGroupOpen(false)}>
          <form onSubmit={createGroup} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Group name</label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className={inputCls}
                placeholder="e.g. Marketing team"
                maxLength={60}
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Add people</label>
              <input
                type="text"
                value={groupQuery}
                onChange={(e) => { setGroupQuery(e.target.value); searchGroupPeople(e.target.value); }}
                className={inputCls}
                placeholder="Search by name or email"
              />
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto border border-dark-600 rounded-lg p-2">
              {groupPeople.length === 0 ? (
                <p className="text-sm text-gray-500 p-1">No users to add.</p>
              ) : (
                groupPeople.map((u) => {
                  const selected = groupSelected.some((id) => sameId(id, u.id));
                  return (
                    <button
                      type="button"
                      key={u.id}
                      onClick={() => toggleGroupMember(u)}
                      className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
                        selected ? 'bg-primary-500/20 border border-primary-500' : 'hover:bg-dark-700 border border-transparent'
                      }`}
                    >
                      <Avatar name={u.name} url={u.avatar_url} size="w-8 h-8" />
                      <span className="flex-1 text-left min-w-0">
                        <span className="block text-sm font-medium text-white truncate">{u.name}</span>
                        <span className="block text-xs text-gray-500 truncate">{u.email}</span>
                      </span>
                      <span className={`w-5 h-5 rounded border flex items-center justify-center text-xs ${
                        selected ? 'bg-primary-500 border-primary-500 text-white' : 'border-dark-500'
                      }`}>
                        {selected ? '✓' : ''}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <p className="text-xs text-gray-500">
              {groupSelected.length} {groupSelected.length === 1 ? 'person' : 'people'} selected
            </p>

            {groupError && <p className="text-sm text-red-400">{groupError}</p>}

            <button type="submit" className={primaryBtn} disabled={groupBusy}>
              {groupBusy ? 'Creating…' : 'Create group'}
            </button>
          </form>
        </Modal>
      )}

      {/* Contact requests modal */}
      {requestsOpen && (
        <Modal title="Contact requests" onClose={() => setRequestsOpen(false)}>
          {peopleError && <p className="text-sm text-red-400 mb-2">{peopleError}</p>}
          {requestsLoading && <p className="text-sm text-gray-500">Loading…</p>}

          <h3 className="text-sm font-medium text-gray-400 mt-2 mb-2">Incoming</h3>
          {incoming.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No incoming requests.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {incoming.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-dark-700">
                  <Avatar name={r.sender_name} url={r.sender_avatar} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{r.sender_name}</p>
                    <p className="text-xs text-gray-500 truncate">{r.sender_email}</p>
                  </div>
                  <button onClick={() => acceptRequest(r)} className={ghostBtn + ' border-green-500 text-green-400'}>Accept</button>
                  <button onClick={() => rejectRequest(r)} className={ghostBtn + ' border-red-500 text-red-400'}>Decline</button>
                </div>
              ))}
            </div>
          )}

          <h3 className="text-sm font-medium text-gray-400 mb-2">Sent</h3>
          {outgoing.length === 0 ? (
            <p className="text-sm text-gray-500">No sent requests.</p>
          ) : (
            <div className="space-y-2">
              {outgoing.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-dark-700">
                  <Avatar name={r.receiver_name} url={r.receiver_avatar} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{r.receiver_name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {r.receiver_email} · <span className={r.status === 'accepted' ? 'text-green-400' : r.status === 'rejected' ? 'text-red-400' : 'text-yellow-400'}>{r.status}</span>
                    </p>
                  </div>
                  {r.status === 'pending' && (
                    <button onClick={() => cancelRequest(r)} className={ghostBtn}>Cancel</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Admin modal */}
      {adminOpen && (
        <Modal title="Admin · user management" onClose={() => setAdminOpen(false)} wide>
          <form onSubmit={adminCreateUser} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <input type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)}
              className={inputCls} placeholder="Full name" required />
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
              className={inputCls} placeholder="Work email" required />
            <input type="text" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
              className={inputCls} placeholder="Password (blank = generate)" />
            <div className="flex gap-2">
              <select value={adminRole} onChange={(e) => setAdminRole(e.target.value)}
                className={inputCls + ' flex-1'}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className={primaryBtn + ' w-auto px-5'} disabled={adminLoading}>
                {adminLoading ? '…' : 'Add user'}
              </button>
            </div>
          </form>

          {adminMsg && <p className="text-sm text-green-400 mb-2 break-all">{adminMsg}</p>}
          {adminError && <p className="text-sm text-red-400 mb-2">{adminError}</p>}

          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {adminUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg bg-dark-700">
                <Avatar name={u.name} url={u.avatarUrl} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white truncate">
                    {u.name}{' '}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-secondary-500' : 'bg-dark-600'}`}>
                      {u.role}
                    </span>
                    {!u.isActive && <span className="text-xs px-1.5 py-0.5 rounded bg-red-600 ml-1">disabled</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{u.email}</p>
                </div>
                <button onClick={() => adminResetPassword(u)} className={ghostBtn} title="Generate a new password">
                  Reset pw
                </button>
                <button
                  onClick={() => adminToggle(u, { role: u.role === 'admin' ? 'user' : 'admin' },
                    `${u.email} is now ${u.role === 'admin' ? 'a user' : 'an admin'}`)}
                  className={ghostBtn}
                >
                  {u.role === 'admin' ? 'Demote' : 'Promote'}
                </button>
                <button
                  onClick={() => adminToggle(u, { isActive: !u.isActive },
                    `${u.email} ${u.isActive ? 'disabled' : 'enabled'}`)}
                  className={ghostBtn}
                >
                  {u.isActive ? 'Disable' : 'Enable'}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Settings: profile picture + privacy */}
      {settingsOpen && (
        <Modal title="Settings" onClose={() => setSettingsOpen(false)}>
          <div className="flex items-center gap-4 mb-5">
            <Avatar name={user.name} url={user.avatarUrl} size="w-16 h-16" />
            <div className="flex-1">
              <p className="text-white font-medium">{user.name}</p>
              <p className="text-sm text-gray-500">{user.email}</p>
              <label className="mt-2 inline-block text-sm text-primary-400 hover:text-primary-300 cursor-pointer">
                {avatarBusy ? 'Uploading…' : '📷 Change picture'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={avatarBusy}
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0];
                    e.target.value = '';
                    if (file) saveAvatar(file);
                  }}
                />
              </label>
            </div>
          </div>

          <form onSubmit={saveSettings} className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Show my online status</p>
                <p className="text-xs text-gray-500">Turn off to appear offline to everyone</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draftOnline}
                onClick={() => setDraftOnline((v) => !v)}
                className={`w-11 h-6 rounded-full transition-colors ${draftOnline ? 'bg-primary-500' : 'bg-dark-600'}`}
              >
                <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${draftOnline ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <div>
              <p className="text-sm text-white mb-2">Who can see that I’m online?</p>
              <div className="space-y-2">
                {[
                  ['everyone', 'Everyone'],
                  ['contacts', 'My contacts only'],
                  ['nobody', 'Nobody'],
                ].map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      value={value}
                      checked={draftVisibility === value}
                      onChange={() => setDraftVisibility(value)}
                      className="accent-primary-500"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Appear in people search</p>
                <p className="text-xs text-gray-500">Let others find you by name or email</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draftSearch}
                onClick={() => setDraftSearch((v) => !v)}
                className={`w-11 h-6 rounded-full transition-colors ${draftSearch ? 'bg-primary-500' : 'bg-dark-600'}`}
              >
                <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${draftSearch ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {settingsMsg && <p className="text-sm text-green-400">{settingsMsg}</p>}
            {settingsError && <p className="text-sm text-red-400">{settingsError}</p>}

            <button type="submit" className={primaryBtn}>Save settings</button>
          </form>
        </Modal>
      )}

      {/* Forced password change */}
      {showChangePw && (
        <Modal title="Change your password" onClose={() => {}}>
          <form onSubmit={submitChangePw} className="space-y-4">
            <p className="text-sm text-gray-400">
              Your account was created by an administrator. Set a password of your own to continue.
            </p>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Current password</label>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)}
                className={inputCls} placeholder="Current password" required autoFocus />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">New password</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                className={inputCls} placeholder="At least 8 characters" required />
            </div>
            {changePwError && <p className="text-sm text-red-400">{changePwError}</p>}
            <button type="submit" className={primaryBtn} disabled={changePwLoading}>
              {changePwLoading ? 'Saving…' : 'Update password'}
            </button>
            <button type="button" onClick={signOut} className="w-full text-sm text-gray-400 underline">
              Sign out instead
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
