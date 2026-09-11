const express = require('express');
const bcrypt = require('bcrypt');
const { get, run } = require('../db/init');
const { generateToken, verifyToken, rateLimit } = require('../middleware/auth');
const config = require('../config');
const {
  ValidationError,
  requireString,
  normaliseEmail,
  validatePassword
} = require('../utils/validate');
const { LIMITS } = require('../../public/js/constants');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Try again in a few minutes.'
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many accounts created from this address. Try again later.'
});

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    // Seeded and reset accounts must replace their temporary password before
    // they can use the app.
    mustChangePassword: Boolean(user.must_change_password)
  };
}

// Register
router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Name', { max: LIMITS.userName });
    const email = normaliseEmail(req.body?.email);
    const password = validatePassword(req.body?.password);

    if (password !== req.body?.confirmPassword) {
      throw new ValidationError('Passwords do not match');
    }

    if (email === config.ADMIN_EMAIL) {
      throw new ValidationError('That email is reserved');
    }

    const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

    let result;
    try {
      result = await run(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, email, passwordHash, 'client']
      );
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) {
        return res.status(409).json({ error: 'Account with that email already exists' });
      }
      throw err;
    }

    const user = { id: result.lastID, name, email, role: 'client' };
    res.status(201).json({ user, token: generateToken(user) });
  } catch (err) {
    next(err);
  }
});

// Login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new ValidationError('Email and password required');
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);

    // Same message and a comparable amount of work either way, so the response
    // does not reveal whether the address exists.
    if (!user) {
      await bcrypt.compare(password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    res.json({ user: publicUser(user), token: generateToken(user) });
  } catch (err) {
    next(err);
  }
});

// Current user — re-read from the database so a deleted account or a changed
// role takes effect immediately instead of living on inside an old token.
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const user = await get(
      'SELECT id, name, email, role, must_change_password FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists', code: 'invalid_token' });
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// Change password
router.post('/change-password', verifyToken, async (req, res, next) => {
  try {
    const currentPassword = req.body?.currentPassword;
    const newPassword = validatePassword(req.body?.newPassword);

    if (newPassword !== req.body?.confirmPassword) {
      throw new ValidationError('New passwords do not match');
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists', code: 'invalid_token' });
    }

    const isValid = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!isValid) {
      // The session is fine — only the value typed into the form was wrong.
      // Tagged so the client does not mistake this for an expired token and
      // sign the user out mid-form.
      return res
        .status(401)
        .json({ error: 'Current password is incorrect', code: 'wrong_password' });
    }

    if (newPassword === currentPassword) {
      throw new ValidationError('The new password must be different from the current one');
    }

    const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
    await run(
      `UPDATE users
         SET password_hash = ?, must_change_password = 0, password_changed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [hash, user.id]
    );

    const updated = { ...user, must_change_password: 0 };
    res.json({
      message: 'Password updated',
      user: publicUser(updated),
      // A fresh token so the rest of the session is not stuck behind the flag.
      token: generateToken(updated)
    });
  } catch (err) {
    next(err);
  }
});

// Update your own display name.
router.patch('/profile', verifyToken, async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Name', { max: LIMITS.userName });

    await run('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
    // Bookings store the name at the time of booking; keep the "booked by"
    // label in step so the studio sees the current name.
    await run('UPDATE bookings SET booked_by_name = ? WHERE booked_by_email = ?', [
      name,
      req.user.email
    ]);

    const user = await get(
      'SELECT id, name, email, role, must_change_password FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({ user: publicUser(user), token: generateToken(user), message: 'Name updated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
