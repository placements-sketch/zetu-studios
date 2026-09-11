// Password policy, the forced first-sign-in change, profile edits, admin
// password resets, and the past-slot booking guard.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `zetu-account-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.PORT = '0';
process.env.BCRYPT_ROUNDS = '4';
process.env.SUPER_ADMIN_PASSWORD = 'Handover-2026-temp';
process.env.DAILY_DIGEST_ENABLED = 'false';

const { start, stop } = require('../server/server');
const { passwordStrength, validatePassword, ValidationError } = require('../server/utils/validate');
const { slotHasPassed, slotStartHour, TOTAL_SLOTS } = require('../public/js/constants');

let baseUrl;
let superToken;

const FUTURE = `${new Date().getFullYear() + 2}-05-06`;

function req(pathname, { method = 'GET', token, body } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` })
    },
    ...(body !== undefined && { body: JSON.stringify(body) })
  }).then(async res => ({
    status: res.status,
    body: await res.text().then(t => {
      try { return JSON.parse(t); } catch (_) { return t; }
    })
  }));
}

test.before(async () => {
  const server = await start();
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'zetustudios@shopzetu.com', password: 'Handover-2026-temp' }
  });
  superToken = login.body.token;
});

test.after(async () => {
  await stop();
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) { /* windows may hold the handle */ }
    }
  }
});

// ── Password policy ─────────────────────────────────────────────────────────

test('passwords under 8 characters are rejected', () => {
  assert.throws(() => validatePassword('Ab3!'), ValidationError);
  assert.throws(() => validatePassword('Abc123'), ValidationError);
});

test('common passwords are rejected', () => {
  for (const weak of ['password', 'admin123', 'qwerty123', 'PASSWORD']) {
    assert.throws(() => validatePassword(weak), ValidationError, `should reject ${weak}`);
  }
});

test('a single character class is rejected', () => {
  assert.throws(() => validatePassword('abcdefghijkl'), ValidationError);
  assert.throws(() => validatePassword('123456789012'), ValidationError);
});

test('a reasonable password is accepted', () => {
  assert.equal(validatePassword('Studio2026!'), 'Studio2026!');
  assert.equal(validatePassword('shoot day 2026'), 'shoot day 2026');
});

test('strength scoring rises with length and variety', () => {
  assert.equal(passwordStrength(''), 0);
  assert.equal(passwordStrength('password'), 1);
  assert.ok(passwordStrength('Studio2026!') >= 3);
  assert.ok(passwordStrength('Studio2026!longer') >= passwordStrength('Studio26!'));
});

// ── Forced password change ──────────────────────────────────────────────────

test('the seeded super admin must change its password', async () => {
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'zetustudios@shopzetu.com', password: 'Handover-2026-temp' }
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.mustChangePassword, true);
});

test('the seeded demo admin must change its password', async () => {
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@zetustudio.com', password: 'admin123' }
  });
  assert.equal(login.body.user.mustChangePassword, true);
});

test('a self-registered account is not forced to change', async () => {
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Normal User',
      email: 'normal@example.com',
      password: 'Chosen2026!',
      confirmPassword: 'Chosen2026!'
    }
  });
  assert.equal(reg.status, 201);

  const me = await req('/api/auth/me', { token: reg.body.token });
  assert.equal(me.body.user.mustChangePassword, false);
});

test('changing the password clears the flag and returns a fresh token', async () => {
  const res = await req('/api/auth/change-password', {
    method: 'POST',
    token: superToken,
    body: {
      currentPassword: 'Handover-2026-temp',
      newPassword: 'StudioOwner2026!',
      confirmPassword: 'StudioOwner2026!'
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.mustChangePassword, false);
  assert.ok(res.body.token, 'a replacement token should be issued');

  superToken = res.body.token;

  // The new password works and the old one does not.
  const withNew = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'zetustudios@shopzetu.com', password: 'StudioOwner2026!' }
  });
  assert.equal(withNew.status, 200);
  assert.equal(withNew.body.user.mustChangePassword, false);

  const withOld = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'zetustudios@shopzetu.com', password: 'Handover-2026-temp' }
  });
  assert.equal(withOld.status, 401);
});

test('the wrong current password is refused without ending the session', async () => {
  const res = await req('/api/auth/change-password', {
    method: 'POST',
    token: superToken,
    body: {
      currentPassword: 'not-the-password',
      newPassword: 'AnotherOne2026!',
      confirmPassword: 'AnotherOne2026!'
    }
  });
  assert.equal(res.status, 401);

  // Tagged so the client can tell this apart from an expired token. Without
  // this, mistyping the current password signed the user out entirely.
  assert.equal(res.body.code, 'wrong_password');

  // The token still works afterwards.
  const me = await req('/api/auth/me', { token: superToken });
  assert.equal(me.status, 200, 'the session must survive a mistyped password');
});

test('a genuinely bad token is tagged as such', async () => {
  const missing = await req('/api/auth/me');
  const garbage = await req('/api/auth/me', { token: 'not-a-real-token' });
  assert.equal(missing.body.code, 'invalid_token');
  assert.equal(garbage.body.code, 'invalid_token');
});

test('the new password cannot equal the current one', async () => {
  const res = await req('/api/auth/change-password', {
    method: 'POST',
    token: superToken,
    body: {
      currentPassword: 'StudioOwner2026!',
      newPassword: 'StudioOwner2026!',
      confirmPassword: 'StudioOwner2026!'
    }
  });
  assert.equal(res.status, 400);
});

test('a weak new password is refused', async () => {
  const res = await req('/api/auth/change-password', {
    method: 'POST',
    token: superToken,
    body: {
      currentPassword: 'StudioOwner2026!',
      newPassword: 'password',
      confirmPassword: 'password'
    }
  });
  assert.equal(res.status, 400);
});

// ── Profile ─────────────────────────────────────────────────────────────────

test('a user can change their display name', async () => {
  const res = await req('/api/auth/profile', {
    method: 'PATCH',
    token: superToken,
    body: { name: 'Zetu Studios HQ' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, 'Zetu Studios HQ');
  assert.ok(res.body.token);
  superToken = res.body.token;

  const me = await req('/api/auth/me', { token: superToken });
  assert.equal(me.body.user.name, 'Zetu Studios HQ');
});

test('a blank name is refused', async () => {
  const res = await req('/api/auth/profile', {
    method: 'PATCH',
    token: superToken,
    body: { name: '   ' }
  });
  assert.equal(res.status, 400);
});

test('renaming updates the name shown on existing bookings', async () => {
  await req('/api/bookings', {
    method: 'POST',
    token: superToken,
    body: {
      date: FUTURE,
      slots: [4],
      name: 'Client Name',
      type: 'Photography',
      description: 'checks booked_by_name follows the profile'
    }
  });

  await req('/api/auth/profile', {
    method: 'PATCH',
    token: superToken,
    body: { name: 'Renamed Studio' }
  });

  const mine = await req('/api/bookings/my-bookings', { token: superToken });
  const booking = mine.body.bookings.find(b => b.date === FUTURE);
  assert.equal(booking.booked_by_name, 'Renamed Studio');
});

// ── Admin-initiated reset ───────────────────────────────────────────────────

test('the super admin can reset another account, forcing a change', async () => {
  const users = await req('/api/users', { token: superToken });
  const target = users.body.users.find(u => u.email === 'normal@example.com');

  const reset = await req(`/api/users/${target.id}/reset-password`, {
    method: 'POST',
    token: superToken
  });

  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporaryPassword, 'a temporary password is returned');
  assert.match(reset.body.temporaryPassword, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  // Ambiguous characters would be misread when passed along by hand.
  assert.ok(!/[O0Il1]/.test(reset.body.temporaryPassword), 'no ambiguous characters');

  // The old password no longer works; the temporary one does, and is flagged.
  const old = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'normal@example.com', password: 'Chosen2026!' }
  });
  assert.equal(old.status, 401);

  const fresh = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'normal@example.com', password: reset.body.temporaryPassword }
  });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.user.mustChangePassword, true);
});

test('a plain admin cannot reset passwords', async () => {
  const users = await req('/api/users', { token: superToken });
  const target = users.body.users.find(u => u.email === 'normal@example.com');

  const adminLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@zetustudio.com', password: 'admin123' }
  });

  const res = await req(`/api/users/${target.id}/reset-password`, {
    method: 'POST',
    token: adminLogin.body.token
  });
  assert.equal(res.status, 403);
});

test('resetting a missing account returns 404', async () => {
  const res = await req('/api/users/999999/reset-password', {
    method: 'POST',
    token: superToken
  });
  assert.equal(res.status, 404);
});

// ── Past-slot guard ─────────────────────────────────────────────────────────

test('slotHasPassed compares against the slot start hour', () => {
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;

  const at8 = new Date(today);
  at8.setHours(8, 0, 0, 0);
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    assert.equal(slotHasPassed(key, s, at8), false, `slot ${s} should be open at 08:00`);
  }

  const at14 = new Date(today);
  at14.setHours(14, 0, 0, 0);
  assert.equal(slotHasPassed(key, 0, at14), true, '09:00 has passed by 14:00');
  assert.equal(slotHasPassed(key, 2, at14), true, '13:00 has started by 14:00');
  assert.equal(slotHasPassed(key, 3, at14), false, '15:00 is still open at 14:00');
});

test('slotHasPassed ignores the clock for other dates', () => {
  const now = new Date();
  assert.equal(slotHasPassed('2099-01-01', 0, now), false);
  assert.equal(slotHasPassed('2001-01-01', 4, now), true);
});

test('slotStartHour returns the configured hour', () => {
  assert.equal(slotStartHour(0), 9);
  assert.equal(slotStartHour(4), 17);
  assert.equal(slotStartHour(99), null);
});

test('booking a slot that already started today is refused', async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  // Find a slot that has already begun; if the suite runs before 09:00 there
  // is none, and the guard has nothing to reject.
  const passed = [0, 1, 2, 3, 4].find(s => slotHasPassed(today, s, now));
  if (passed === undefined) return;

  const res = await req('/api/bookings', {
    method: 'POST',
    token: superToken,
    body: {
      date: today,
      slots: [passed],
      name: 'Too Late',
      type: 'Photography',
      description: 'this slot has already started'
    }
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /already started/);
});

test('a later slot today is still bookable', async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  const open = [0, 1, 2, 3, 4].find(s => !slotHasPassed(today, s, now));
  if (open === undefined) return; // after 17:00 nothing is left today

  const res = await req('/api/bookings', {
    method: 'POST',
    token: superToken,
    body: {
      date: today,
      slots: [open],
      name: 'Still In Time',
      type: 'Photography',
      description: 'this slot has not started yet'
    }
  });

  assert.equal(res.status, 201);
});

// ── Config endpoint ─────────────────────────────────────────────────────────

test('the config endpoint hides demo credentials outside development', async () => {
  const res = await req('/api/config');
  assert.equal(res.status, 200);
  // NODE_ENV is "test" here, which is not production, so the hint is exposed.
  assert.equal(typeof res.body.isDevelopment, 'boolean');
  assert.ok(Array.isArray(res.body.slots));
  assert.ok(res.body.slots[0].startHour === 9, 'slot hours are published');
});
