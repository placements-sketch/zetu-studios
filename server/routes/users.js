const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { all, get, run } = require('../db/init');
const { verifyToken, isSuperAdmin } = require('../middleware/auth');
const { ValidationError, validateId } = require('../utils/validate');
const config = require('../config');

const router = express.Router();

// Roles a super admin may assign. 'superadmin' is deliberately absent — the
// super admin is seeded from configuration, not granted through the API.
const ASSIGNABLE_ROLES = ['client', 'admin'];

// Everything here is super-admin only.
router.use(verifyToken, isSuperAdmin);

// List every account, with how many bookings each one holds.
router.get('/', async (req, res, next) => {
  try {
    const users = await all(`
      SELECT u.id, u.name, u.email, u.role, u.created_at, u.must_change_password,
             COUNT(b.id) AS booking_count
      FROM users u
      LEFT JOIN bookings b ON b.booked_by_email = u.email
      GROUP BY u.id
      ORDER BY
        CASE u.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        u.name COLLATE NOCASE
    `);
    res.json({ users, assignableRoles: ASSIGNABLE_ROLES });
  } catch (err) {
    next(err);
  }
});

// Promote or demote an account.
router.patch('/:id/role', async (req, res, next) => {
  try {
    const id = validateId(req.params.id);
    const role = req.body?.role;

    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new ValidationError(`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    }

    const user = await get('SELECT id, name, email, role FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // The super admin cannot be demoted — not by another super admin, and not
    // by themselves. Otherwise the studio could lock itself out entirely.
    if (user.role === 'superadmin' || user.email === config.SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'The super admin account cannot be demoted' });
    }

    if (user.role === role) {
      return res.json({ user, message: `Already ${role}` });
    }

    await run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    console.log(`✓ ${req.user.email} changed ${user.email}: ${user.role} → ${role}`);

    res.json({ user: { ...user, role }, message: `${user.name} is now ${role}` });
  } catch (err) {
    next(err);
  }
});

// Reset someone's password. Returns a temporary password, shown once, which
// the user is then forced to replace at their next sign-in.
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = validateId(req.params.id);

    const user = await get('SELECT id, name, email, role FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Unambiguous alphabet: no O/0, I/l/1 — these get read aloud and retyped.
    const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let temporary = '';
    for (const byte of crypto.randomBytes(12)) {
      temporary += ALPHABET[byte % ALPHABET.length];
    }
    // Keep it in readable groups: xxxx-xxxx-xxxx
    temporary = `${temporary.slice(0, 4)}-${temporary.slice(4, 8)}-${temporary.slice(8, 12)}`;

    const hash = await bcrypt.hash(temporary, config.BCRYPT_ROUNDS);
    await run(
      'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
      [hash, id]
    );

    console.log(`✓ ${req.user.email} reset the password for ${user.email}`);

    res.json({
      user,
      temporaryPassword: temporary,
      message: `${user.name} must set a new password at their next sign-in`
    });
  } catch (err) {
    next(err);
  }
});

// Delete an account. Its bookings are removed with it.
router.delete('/:id', async (req, res, next) => {
  try {
    const id = validateId(req.params.id);

    const user = await get('SELECT id, name, email, role FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'superadmin' || user.email === config.SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'The super admin account cannot be deleted' });
    }

    if (user.id === req.user.id) {
      return res.status(403).json({ error: 'You cannot delete your own account' });
    }

    const { changes } = await run('DELETE FROM bookings WHERE booked_by_email = ?', [user.email]);
    await run('DELETE FROM users WHERE id = ?', [id]);
    console.log(`✓ ${req.user.email} deleted account ${user.email} (${changes} bookings removed)`);

    res.json({
      message: `${user.name} removed`,
      bookingsRemoved: changes
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
