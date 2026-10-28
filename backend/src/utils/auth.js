/**
 * Shared auth helpers so every route signs and checks tokens the same
 * way (one secret, one payload shape, one verification entry point).
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET =
  process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';

/** Public shape of a user as returned by the API. */
function publicUser(u) {
  if (!u) return null;
  return {
    id: String(u.id),
    email: u.email,
    name: u.name,
    avatarUrl: u.avatar_url || '',
    provider: u.provider || 'local',
    role: u.role || 'user',
    mustChangePassword: Boolean(u.must_change_password),
    onlineStatus: u.online_status === undefined ? true : Boolean(u.online_status),
    onlineVisibility: u.online_visibility || 'everyone',
    showInSearch: u.show_in_search === undefined ? true : Boolean(u.show_in_search),
    isActive: u.is_active === undefined ? true : Boolean(u.is_active),
  };
}

/** Sign a 7-day access token for a user. */
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      provider: user.provider,
      role: user.role || 'user',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/** Verify the bearer token on a request; returns the payload or null. */
function verifyToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

/** Express middleware: 401 unless a valid token is present. */
function requireAuth(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded) return res.status(401).json({ message: 'Invalid token' });
  req.user = decoded;
  next();
}

/** Express middleware: 403 unless the caller is an admin. */
function requireAdmin(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded) return res.status(401).json({ message: 'Invalid token' });
  if (decoded.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  req.user = decoded;
  next();
}

module.exports = { JWT_SECRET, signToken, verifyToken, requireAuth, requireAdmin, publicUser };
