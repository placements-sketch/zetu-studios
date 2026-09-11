// End-to-end API tests. Uses node:test + fetch — no extra dependencies.
// Runs against a throwaway database so your real data/zetu.db is untouched.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `zetu-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.PORT = '0'; // let the OS pick a free port
process.env.BCRYPT_ROUNDS = '4'; // keep hashing fast in tests

const { start, stop } = require('../server/server');

let baseUrl;
let adminToken;
let clientToken;

// A date far enough out that it is always in the future.
const FUTURE = `${new Date().getFullYear() + 2}-03-14`;
const OTHER_DAY = `${new Date().getFullYear() + 2}-03-15`;

function req(pathname, { method = 'GET', token, body } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` })
    },
    ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) })
  }).then(async res => ({ status: res.status, body: await res.text().then(t => {
    try { return JSON.parse(t); } catch (_) { return t; }
  }) }));
}

function book(token, overrides = {}) {
  return req('/api/bookings', {
    method: 'POST',
    token,
    body: {
      date: FUTURE,
      slots: [0],
      name: 'Test Client',
      type: 'Photography',
      description: 'A test shoot',
      ...overrides
    }
  });
}

test.before(async () => {
  const server = await start();
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@zetustudio.com', password: 'admin123' }
  });
  adminToken = login.body.token;

  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Client One',
      email: 'client@example.com',
      password: 'secret123',
      confirmPassword: 'secret123'
    }
  });
  clientToken = reg.body.token;
});

test.after(async () => {
  await stop();
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) { /* windows may still hold a handle */ }
    }
  }
});

// ── Health & routing ────────────────────────────────────────────────────────

test('health check reports the database is reachable', async () => {
  const res = await req('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.database, 'ok');
});

test('unknown API routes return JSON, not an HTML error page', async () => {
  const res = await req('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(typeof res.body, 'object');
  assert.match(res.body.error, /Unknown endpoint/);
});

test('unknown page routes fall back to the SPA', async () => {
  const res = await fetch(`${baseUrl}/some/deep/link`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /html/);
});

test('malformed JSON returns a JSON 400', async () => {
  const res = await req('/api/auth/login', { method: 'POST', body: '{not json' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Malformed JSON body');
});

test('security headers are set', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

// ── Authentication ──────────────────────────────────────────────────────────

test('login succeeds with the seeded admin account', async () => {
  const res = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@zetustudio.com', password: 'admin123' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'admin');
  assert.ok(res.body.token);
});

test('login is case-insensitive on the email', async () => {
  const res = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'ADMIN@ZetuStudio.com', password: 'admin123' }
  });
  assert.equal(res.status, 200);
});

test('login rejects a wrong password without revealing the account exists', async () => {
  const wrongPass = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@zetustudio.com', password: 'nope' }
  });
  const noUser = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'ghost@example.com', password: 'nope' }
  });
  assert.equal(wrongPass.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPass.body.error, noUser.body.error);
});

test('register rejects a whitespace-only name', async () => {
  const res = await req('/api/auth/register', {
    method: 'POST',
    body: { name: '   ', email: 'blank@example.com', password: 'secret123', confirmPassword: 'secret123' }
  });
  assert.equal(res.status, 400);
});

test('register rejects a duplicate email that differs only in case', async () => {
  const res = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Impostor', email: 'CLIENT@Example.com', password: 'secret123', confirmPassword: 'secret123' }
  });
  assert.equal(res.status, 409);
});

test('register rejects a mismatched confirmation and a short password', async () => {
  const mismatch = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'X', email: 'x1@example.com', password: 'secret123', confirmPassword: 'other123' }
  });
  const short = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'X', email: 'x2@example.com', password: '123', confirmPassword: '123' }
  });
  assert.equal(mismatch.status, 400);
  assert.equal(short.status, 400);
});

test('register refuses the reserved admin address', async () => {
  const res = await req('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Fake Admin',
      email: 'admin@zetustudio.com',
      password: 'secret123',
      confirmPassword: 'secret123'
    }
  });
  assert.equal(res.status, 400);
});

test('protected routes reject missing and malformed tokens', async () => {
  assert.equal((await req('/api/bookings/my-bookings')).status, 401);
  assert.equal((await req('/api/bookings/my-bookings', { token: 'garbage' })).status, 401);
});

test('/auth/me returns a clean user object without JWT internals', async () => {
  const res = await req('/api/auth/me', { token: adminToken });
  assert.equal(res.status, 200);
  assert.deepEqual(
    Object.keys(res.body.user).sort(),
    ['email', 'id', 'mustChangePassword', 'name', 'role']
  );
  // The point of this test: token bookkeeping must not leak into the response.
  assert.equal(res.body.user.iat, undefined);
  assert.equal(res.body.user.exp, undefined);
  assert.equal(res.body.user.password_hash, undefined);
});

// ── Booking validation ──────────────────────────────────────────────────────

test('booking rejects an invalid date', async () => {
  const res = await book(adminToken, { date: 'not-a-date' });
  assert.equal(res.status, 400);
});

test('booking rejects a date that does not exist on the calendar', async () => {
  const res = await book(adminToken, { date: `${new Date().getFullYear() + 2}-02-31` });
  assert.equal(res.status, 400);
});

test('booking rejects a date in the past', async () => {
  const res = await book(adminToken, { date: '2001-01-01' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /passed/);
});

test('booking rejects out-of-range slot indices', async () => {
  const res = await book(adminToken, { slots: [9, 9, 9] });
  assert.equal(res.status, 400);
});

test('booking rejects slots that are not an array', async () => {
  const res = await book(adminToken, { slots: { evil: true } });
  assert.equal(res.status, 400);
});

test('booking rejects an empty slot list', async () => {
  const res = await book(adminToken, { slots: [] });
  assert.equal(res.status, 400);
});

test('booking rejects an unknown shoot type', async () => {
  const res = await book(adminToken, { type: 'Definitely Not A Real Type' });
  assert.equal(res.status, 400);
});

test('booking rejects blank details and over-long fields', async () => {
  assert.equal((await book(adminToken, { description: '   ' })).status, 400);
  assert.equal((await book(adminToken, { name: 'x'.repeat(500) })).status, 400);
  assert.equal((await book(adminToken, { description: 'x'.repeat(5000) })).status, 400);
});

// ── Double-booking: the bug this suite exists for ───────────────────────────

test('a valid booking is created', async () => {
  const res = await book(clientToken, { slots: [0] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.booking.slots, [0]);
});

test('an identical slot cannot be booked twice', async () => {
  const res = await book(adminToken, { slots: [0] });
  assert.equal(res.status, 409);
});

test('a full day cannot be booked over an existing single slot', async () => {
  const res = await book(adminToken, { slots: [0, 1, 2, 3, 4] });
  assert.equal(res.status, 409, 'overlapping full-day booking must be refused');
});

test('a half day cannot be booked over an existing single slot', async () => {
  const res = await book(adminToken, { slots: [0, 1, 2] });
  assert.equal(res.status, 409);
});

test('a non-overlapping slot on the same day is still allowed', async () => {
  const res = await book(adminToken, { slots: [3, 4] });
  assert.equal(res.status, 201);
});

test('a slot overlapping only at the edge of a block is refused', async () => {
  const res = await book(adminToken, { slots: [2, 3] });
  assert.equal(res.status, 409);
});

test('slots are stored sorted and de-duplicated', async () => {
  const res = await book(adminToken, { date: OTHER_DAY, slots: [2, 1, 1, 0] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.booking.slots, [0, 1, 2]);
});

test('concurrent bookings for the same slot: exactly one wins', async () => {
  const day = `${new Date().getFullYear() + 2}-06-01`;
  const results = await Promise.all([
    book(adminToken, { date: day, slots: [1] }),
    book(clientToken, { date: day, slots: [1] }),
    book(adminToken, { date: day, slots: [1] })
  ]);
  const created = results.filter(r => r.status === 201);
  const refused = results.filter(r => r.status === 409);
  assert.equal(created.length, 1, 'exactly one concurrent booking should succeed');
  assert.equal(refused.length, 2);
});

// ── Reading bookings ────────────────────────────────────────────────────────

test('date lookup returns parsed slot arrays', async () => {
  const res = await req(`/api/bookings/date/${FUTURE}`, { token: clientToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.bookings.length >= 2);
  res.body.bookings.forEach(b => assert.ok(Array.isArray(b.slots)));
});

test('calendar overview reports occupied slots and fullness', async () => {
  const [y, m] = FUTURE.split('-');
  const res = await req(`/api/bookings/calendar/${Number(m)}/${y}`, { token: clientToken });
  assert.equal(res.status, 200);
  const day = res.body.dates.find(d => d.date === FUTURE);
  assert.ok(day, 'the booked date should appear in the calendar');
  assert.deepEqual(day.occupiedSlots, [0, 3, 4]);
  assert.equal(day.isFull, false);
});

test('calendar rejects an out-of-range month', async () => {
  assert.equal((await req('/api/bookings/calendar/13/2027', { token: adminToken })).status, 400);
  assert.equal((await req('/api/bookings/calendar/0/2027', { token: adminToken })).status, 400);
});

test('my-bookings returns only the caller’s own bookings', async () => {
  const res = await req('/api/bookings/my-bookings', { token: clientToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.bookings.length > 0);
  res.body.bookings.forEach(b => assert.equal(b.booked_by_email, 'client@example.com'));
});

// ── Authorisation ───────────────────────────────────────────────────────────

test('a client cannot reach the admin endpoints', async () => {
  assert.equal((await req('/api/bookings/admin/all', { token: clientToken })).status, 403);
  assert.equal((await req('/api/bookings/admin/stats', { token: clientToken })).status, 403);
});

test('an admin can list every booking and read stats', async () => {
  const all = await req('/api/bookings/admin/all', { token: adminToken });
  const stats = await req('/api/bookings/admin/stats', { token: adminToken });
  assert.equal(all.status, 200);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.stats.totalBookings, all.body.bookings.length);
  assert.ok(stats.body.stats.uniqueClients >= 1);
});

test('a client cannot cancel someone else’s booking', async () => {
  const mine = await req('/api/bookings/admin/all', { token: adminToken });
  const adminsBooking = mine.body.bookings.find(
    b => b.booked_by_email === 'admin@zetustudio.com'
  );
  const res = await req(`/api/bookings/${adminsBooking.id}`, {
    method: 'DELETE',
    token: clientToken
  });
  assert.equal(res.status, 403);
});

test('a client can cancel their own booking, freeing the slot', async () => {
  const mine = await req('/api/bookings/my-bookings', { token: clientToken });
  const booking = mine.body.bookings.find(b => b.date === FUTURE);

  const del = await req(`/api/bookings/${booking.id}`, { method: 'DELETE', token: clientToken });
  assert.equal(del.status, 200);

  // The freed slot can now be booked again.
  const rebook = await book(adminToken, { slots: booking.slots });
  assert.equal(rebook.status, 201);
});

test('an admin can cancel any booking', async () => {
  const all = await req('/api/bookings/admin/all', { token: adminToken });
  const target = all.body.bookings.find(b => b.booked_by_email === 'client@example.com');
  if (!target) return; // nothing left to cancel
  const res = await req(`/api/bookings/${target.id}`, { method: 'DELETE', token: adminToken });
  assert.equal(res.status, 200);
});

test('cancelling a missing or invalid booking id is handled', async () => {
  assert.equal((await req('/api/bookings/999999', { method: 'DELETE', token: adminToken })).status, 404);
  assert.equal((await req('/api/bookings/abc', { method: 'DELETE', token: adminToken })).status, 400);
});
