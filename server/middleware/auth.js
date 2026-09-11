const jwt = require('jsonwebtoken');
const config = require('../config');

const JWT_SECRET = config.JWT_SECRET;

// Role hierarchy. Higher rank implies every permission of the ranks below it,
// so an admin check must never be a literal `role === 'admin'` comparison.
const ROLES = { client: 0, admin: 1, superadmin: 2 };

function rankOf(role) {
  return ROLES[role] ?? -1;
}

function hasAtLeast(role, required) {
  return rankOf(role) >= rankOf(required);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (!token || scheme.toLowerCase() !== 'bearer') {
    return res.status(401).json({ error: 'No token provided', code: 'invalid_token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      name: decoded.name
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'invalid_token' });
  }
}

// Requires `role` or anything above it.
function requireRole(role) {
  return function guard(req, res, next) {
    if (!hasAtLeast(req.user?.role, role)) {
      return res.status(403).json({
        error: role === 'superadmin' ? 'Super admin access required' : 'Admin access required'
      });
    }
    next();
  };
}

// Admin *or* super admin.
const isAdmin = requireRole('admin');
// Super admin only.
const isSuperAdmin = requireRole('superadmin');

// Fixed-window limiter, in memory. Enough to blunt credential stuffing on a
// single-process deployment; swap for a shared store if you run several.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  // Drop expired buckets so the map cannot grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function limiter(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }
    next();
  };
}

module.exports = {
  generateToken,
  verifyToken,
  isAdmin,
  isSuperAdmin,
  requireRole,
  hasAtLeast,
  rankOf,
  ROLES,
  rateLimit,
  JWT_SECRET
};
