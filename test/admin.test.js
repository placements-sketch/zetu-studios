// Super admin role, user management, and email notifications.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `zetu-admin-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.PORT = '0';
process.env.BCRYPT_ROUNDS = '4';
process.env.SUPER_ADMIN_PASSWORD = 'super-secret-123';
process.env.DAILY_DIGEST_ENABLED = 'false'; // no timers during tests

const { start, stop } = require('../server/server');
const mailer = require('../server/utils/mailer');
const { sendDailyDigest, msUntilNextDigest } = require('../server/utils/notifications');
const config = require('../server/config');

let baseUrl;
let superToken;
let adminToken;
let clientToken;
let clientId;
let outbox;

const FUTURE = `${new Date().getFullYear() + 2}-08-20`;

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

  // Capture mail instead of sending it.
  outbox = mailer.enableOutbox();

  superToken = (await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'zetustudios@shopzetu.com', password: 'super-secret-123' }
  })).body.token;

  adminToken = (await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@zetustudio.com', password: 'admin123' }
  })).body.token;

  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Client Two',
      email: 'client2@example.com',
      password: 'secret123',
      confirmPassword: 'secret123'
    }
  });
  clientToken = reg.body.token;
  clientId = reg.body.user.id;
});

test.after(async () => {
  mailer.disableOutbox();
  await stop();
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) { /* windows may hold the handle */ }
    }
  }
});

// ── Super admin seeding and role hierarchy ──────────────────────────────────

test('the super admin account is seeded with the superadmin role', async () => {
  const me = await req('/api/auth/me', { token: superToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'zetustudios@shopzetu.com');
  assert.equal(me.body.user.role, 'superadmin');
});

test('the super admin satisfies admin-only endpoints', async () => {
  const all = await req('/api/bookings/admin/all', { token: superToken });
  const stats = await req('/api/bookings/admin/stats', { token: superToken });
  assert.equal(all.status, 200, 'superadmin must pass the admin guard');
  assert.equal(stats.status, 200);
});

test('a plain admin cannot reach super-admin endpoints', async () => {
  assert.equal((await req('/api/users', { token: adminToken })).status, 403);
  assert.equal((await req('/api/mail/status', { token: adminToken })).status, 403);
});

test('a client cannot reach super-admin endpoints', async () => {
  assert.equal((await req('/api/users', { token: clientToken })).status, 403);
});

// ── User management ─────────────────────────────────────────────────────────

test('the super admin can list every account', async () => {
  const res = await req('/api/users', { token: superToken });
  assert.equal(res.status, 200);
  const emails = res.body.users.map(u => u.email);
  assert.ok(emails.includes('zetustudios@shopzetu.com'));
  assert.ok(emails.includes('client2@example.com'));
  // Super admin is listed first.
  assert.equal(res.body.users[0].role, 'superadmin');
});

test('the super admin can promote a client to admin and back', async () => {
  const up = await req(`/api/users/${clientId}/role`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'admin' }
  });
  assert.equal(up.status, 200);
  assert.equal(up.body.user.role, 'admin');

  const down = await req(`/api/users/${clientId}/role`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'client' }
  });
  assert.equal(down.status, 200);
  assert.equal(down.body.user.role, 'client');
});

test('a promoted admin gains admin access on their next sign-in', async () => {
  await req(`/api/users/${clientId}/role`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'admin' }
  });

  const fresh = (await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'client2@example.com', password: 'secret123' }
  })).body.token;

  assert.equal((await req('/api/bookings/admin/all', { token: fresh })).status, 200);

  await req(`/api/users/${clientId}/role`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'client' }
  });
});

test('the superadmin role cannot be assigned through the API', async () => {
  const res = await req(`/api/users/${clientId}/role`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'superadmin' }
  });
  assert.equal(res.status, 400);
});

test('an unknown role is rejected', async () => {
  const res = await req(`/api/users/${clientId}/role`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'wizard' }
  });
  assert.equal(res.status, 400);
});

test('the super admin cannot be demoted, even by itself', async () => {
  const users = await req('/api/users', { token: superToken });
  const superUser = users.body.users.find(u => u.role === 'superadmin');

  const res = await req(`/api/users/${superUser.id}/role`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'client' }
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /cannot be demoted/);
});

test('the super admin cannot be deleted', async () => {
  const users = await req('/api/users', { token: superToken });
  const superUser = users.body.users.find(u => u.role === 'superadmin');

  const res = await req(`/api/users/${superUser.id}`, { method: 'DELETE', token: superToken });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /cannot be deleted/);
});

test('the super admin cannot delete their own account', async () => {
  const me = await req('/api/auth/me', { token: superToken });
  const res = await req(`/api/users/${me.body.user.id}`, { method: 'DELETE', token: superToken });
  assert.equal(res.status, 403);
});

test('deleting an account removes its bookings too', async () => {
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Temp User',
      email: 'temp@example.com',
      password: 'secret123',
      confirmPassword: 'secret123'
    }
  });

  await req('/api/bookings', {
    method: 'POST',
    token: reg.body.token,
    body: {
      date: FUTURE,
      slots: [4],
      name: 'Temp',
      type: 'Photography',
      description: 'will be removed with the account'
    }
  });

  const del = await req(`/api/users/${reg.body.user.id}`, { method: 'DELETE', token: superToken });
  assert.equal(del.status, 200);
  assert.equal(del.body.bookingsRemoved, 1);

  // The slot is free again.
  const rebook = await req('/api/bookings', {
    method: 'POST',
    token: superToken,
    body: {
      date: FUTURE,
      slots: [4],
      name: 'Studio',
      type: 'Photography',
      description: 'slot reclaimed'
    }
  });
  assert.equal(rebook.status, 201);
});

test('deleting a missing user returns 404', async () => {
  assert.equal((await req('/api/users/999999', { method: 'DELETE', token: superToken })).status, 404);
});

// ── Notifications ───────────────────────────────────────────────────────────

test('creating a booking emails the notification address', async () => {
  outbox.length = 0;

  const res = await req('/api/bookings', {
    method: 'POST',
    token: clientToken,
    body: {
      date: FUTURE,
      slots: [0],
      name: 'Amina W.',
      type: 'Portrait Session',
      description: 'Headshots for the new team page'
    }
  });
  assert.equal(res.status, 201);

  // The mail is sent after the response, so give it a tick.
  await new Promise(r => setTimeout(r, 150));

  assert.equal(outbox.length, 1, 'exactly one notification');
  const mail = outbox[0];
  assert.equal(mail.to, 'zetustudios@shopzetu.com');
  assert.match(mail.subject, /New booking/);
  assert.match(mail.subject, /Portrait Session/);
  assert.match(mail.text, /Amina W\./);
  assert.match(mail.text, /09:00 - 11:00/);
  assert.match(mail.html, /Headshots for the new team page/);
});

test('cancelling a booking emails the notification address', async () => {
  const mine = await req('/api/bookings/my-bookings', { token: clientToken });
  const booking = mine.body.bookings.find(b => b.date === FUTURE);

  outbox.length = 0;
  const del = await req(`/api/bookings/${booking.id}`, { method: 'DELETE', token: clientToken });
  assert.equal(del.status, 200);

  await new Promise(r => setTimeout(r, 150));

  assert.equal(outbox.length, 1);
  assert.match(outbox[0].subject, /Cancelled/);
  assert.match(outbox[0].to, /zetustudios@shopzetu\.com/);
});

test('a booking still succeeds when the mail server throws', async () => {
  // Substitute a send path that rejects, the way a dead SMTP host would.
  const original = mailer.sendMail;
  let attempted = false;
  mailer.sendMail = async () => {
    attempted = true;
    throw new Error('SMTP connection refused');
  };

  try {
    const res = await req('/api/bookings', {
      method: 'POST',
      token: superToken,
      body: {
        date: FUTURE,
        slots: [1],
        name: 'Resilience Check',
        type: 'Photography',
        description: 'mail server is down'
      }
    });

    assert.equal(res.status, 201, 'the booking must survive a mail failure');

    // Let the fire-and-forget notification reject and be caught.
    await new Promise(r => setTimeout(r, 150));
    assert.ok(attempted, 'a notification should have been attempted');

    // The booking is really in the database, not rolled back.
    const check = await req(`/api/bookings/date/${FUTURE}`, { token: superToken });
    assert.ok(
      check.body.bookings.some(b => b.name === 'Resilience Check'),
      'the booking must be persisted despite the mail failure'
    );
  } finally {
    mailer.sendMail = original;
  }
});

test('a cancellation still succeeds when the mail server throws', async () => {
  const original = mailer.sendMail;
  mailer.sendMail = async () => {
    throw new Error('SMTP connection refused');
  };

  try {
    const all = await req('/api/bookings/admin/all', { token: superToken });
    const target = all.body.bookings.find(b => b.name === 'Resilience Check');

    const del = await req(`/api/bookings/${target.id}`, { method: 'DELETE', token: superToken });
    assert.equal(del.status, 200, 'the cancellation must survive a mail failure');
    await new Promise(r => setTimeout(r, 150));
  } finally {
    mailer.sendMail = original;
  }
});

test('the daily digest lists the day’s bookings', async () => {
  await req('/api/bookings', {
    method: 'POST',
    token: superToken,
    body: {
      date: FUTURE,
      slots: [2],
      name: 'Digest Subject',
      type: 'Event Coverage',
      description: 'should appear in the digest'
    }
  });

  outbox.length = 0;
  await sendDailyDigest(FUTURE);

  assert.equal(outbox.length, 1);
  const mail = outbox[0];
  assert.match(mail.subject, /Today's schedule/);
  assert.match(mail.text, /Digest Subject/);
  assert.match(mail.html, /Digest Subject/);
  assert.match(mail.html, /13:00 - 15:00/);
});

test('the daily digest reports an empty day', async () => {
  outbox.length = 0;
  await sendDailyDigest('2099-12-25');

  assert.equal(outbox.length, 1);
  assert.match(outbox[0].subject, /No shoots today/);
  assert.match(outbox[0].text, /free all day/);
});

test('the digest escapes HTML in booking details', async () => {
  const day = `${new Date().getFullYear() + 2}-08-21`;
  await req('/api/bookings', {
    method: 'POST',
    token: superToken,
    body: {
      date: day,
      slots: [0],
      name: '<script>alert(1)</script>',
      type: 'Photography',
      description: 'Details with <b>markup</b> & an ampersand'
    }
  });

  outbox.length = 0;
  await sendDailyDigest(day);

  const html = outbox[0].html;
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'the name should be escaped');
  assert.ok(html.includes('&amp;'), 'ampersands should be escaped');
});

test('the digest scheduler computes a delay inside the next 24 hours', () => {
  const ms = msUntilNextDigest(new Date());
  assert.ok(ms > 0, 'delay must be in the future');
  assert.ok(ms <= 24 * 60 * 60 * 1000, 'delay must be within a day');
});

test('mail status is reported to the super admin', async () => {
  const res = await req('/api/mail/status', { token: superToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.notifyEmail, 'zetustudios@shopzetu.com');
  assert.equal(res.body.configured, config.MAIL_CONFIGURED);
});

test('notifications default to the super admin address', () => {
  assert.equal(config.NOTIFY_EMAIL, 'zetustudios@shopzetu.com');
  assert.equal(config.SUPER_ADMIN_EMAIL, 'zetustudios@shopzetu.com');
});
