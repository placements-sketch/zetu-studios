const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const userRoutes = require('./routes/users');
const { initDb, closeDb, get } = require('./db/init');
const { verifyToken, isSuperAdmin } = require('./middleware/auth');
const { verifyConnection } = require('./utils/mailer');
const {
  startDigestScheduler,
  stopDigestScheduler,
  sendDailyDigest
} = require('./utils/notifications');
const { SLOT_DEFS, BLOCK_DEFS, SHOOT_TYPES, TOTAL_SLOTS, LIMITS } = require('../public/js/constants');

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.set('trust proxy', 1); // correct req.ip behind a reverse proxy

// CORS: same-origin by default in production, permissive in development.
const corsOrigin = config.CORS_ORIGIN;
if (corsOrigin === '*') {
  app.use(cors());
} else if (corsOrigin) {
  app.use(cors({ origin: corsOrigin.split(',').map(o => o.trim()).filter(Boolean) }));
}

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Baseline security headers (a hand-rolled subset of what helmet would set).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (config.IS_PRODUCTION) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// There is no build step and no hashed filenames, so a cached index.html or
// app.js from a previous version produces confusing half-updated pages.
// "no-cache" does not mean "do not cache" — the browser keeps the file but
// revalidates every time, so an unchanged file costs a 304 and a changed one
// is always picked up.
app.use(
  express.static(PUBLIC_DIR, {
    // Let the SPA handler render index.html so it can stamp asset versions;
    // otherwise this middleware answers "/" first and the tags go out bare.
    index: false,
    etag: true,
    lastModified: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  })
);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/users', userRoutes);

// Client-visible configuration, so the UI never hard-codes what the server enforces.
app.get('/api/config', (req, res) => {
  res.json({
    slots: SLOT_DEFS,
    blocks: BLOCK_DEFS,
    shootTypes: SHOOT_TYPES,
    totalSlots: TOTAL_SLOTS,
    limits: LIMITS,
    // The login screen only advertises the demo account outside production.
    isDevelopment: !config.IS_PRODUCTION,
    demoEmail: config.IS_PRODUCTION ? null : config.ADMIN_EMAIL
  });
});

// Mail diagnostics — super admin only, so credentials cannot be probed anonymously.
app.get('/api/mail/status', verifyToken, isSuperAdmin, async (req, res) => {
  const result = await verifyConnection();
  res.json({
    configured: config.MAIL_CONFIGURED,
    host: config.SMTP_HOST || null,
    port: config.SMTP_PORT,
    user: config.SMTP_USER || null,
    notifyEmail: config.NOTIFY_EMAIL,
    dailyDigest: config.DAILY_DIGEST_ENABLED ? config.DAILY_DIGEST_TIME : false,
    connection: result.ok ? 'ok' : result.reason
  });
});

// Send today's digest on demand, for testing the pipeline end to end.
app.post('/api/mail/digest', verifyToken, isSuperAdmin, async (req, res, next) => {
  try {
    const sent = await sendDailyDigest();
    res.json({ sent, to: config.NOTIFY_EMAIL });
  } catch (err) {
    next(err);
  }
});

// Health check — verifies the database actually answers, not just that we are up.
app.get('/api/health', async (req, res) => {
  try {
    await get('SELECT 1 AS ok');
    res.json({ status: 'ok', database: 'ok', uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});

// Unknown API routes must answer JSON — the client parses every response as JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown endpoint: ${req.method} ${req.originalUrl}` });
});

// Asset versioning ────────────────────────────────────────────────────────
// There is no build step, so /css/app.css is the same URL forever and a
// browser that cached it may keep showing an old page. Stamping the tags with
// a version derived from file modification times makes any edit a new URL,
// which no cache can serve stale — entirely sidestepping the problem.
let cachedVersion = null;

function assetVersion() {
  if (cachedVersion && config.IS_PRODUCTION) return cachedVersion;

  let newest = 0;
  for (const dir of ['css', 'js']) {
    const full = path.join(PUBLIC_DIR, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      const { mtimeMs } = fs.statSync(path.join(full, file));
      if (mtimeMs > newest) newest = mtimeMs;
    }
  }

  cachedVersion = Math.round(newest).toString(36);
  return cachedVersion;
}

function renderIndex() {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const v = assetVersion();
  // Only local /css/ and /js/ references — external CDN links are left alone.
  return html.replace(/(src|href)="(\/(?:css|js)\/[^"?]+)"/g, `$1="$2?v=${v}"`);
}

// SPA fallback for everything else.
app.get(/.*/, (req, res) => {
  res.type('html').send(renderIndex());
});

// Central error handler — always JSON for API callers.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Body parser failures arrive here as SyntaxError.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }

  const status = err.status || 500;
  if (status >= 500) console.error('Unhandled error:', err);

  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our end' : err.message
  });
});

let server = null;

async function start() {
  await initDb();

  server = await new Promise((resolve, reject) => {
    const s = app.listen(config.PORT);
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });

  console.log(`Zetu Studio Booking System running on http://localhost:${server.address().port}`);
  console.log(`  environment: ${config.NODE_ENV}`);

  if (config.MAIL_CONFIGURED) {
    console.log(`  notifications: ${config.NOTIFY_EMAIL} via ${config.SMTP_HOST}`);
    // Report bad credentials at boot rather than on the first booking.
    verifyConnection().then(r => {
      if (r.ok) console.log('✓ SMTP connection verified');
      else console.warn('⚠ SMTP check failed:', r.reason);
    });
    startDigestScheduler();
  } else {
    console.log('  notifications: disabled (SMTP_HOST/SMTP_USER/SMTP_PASS not set)');
  }

  return server;
}

async function stop() {
  stopDigestScheduler();
  if (server) {
    await new Promise(resolve => server.close(resolve));
    server = null;
  }
  await closeDb();
}

// Close the database cleanly so no write is left half-applied.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n${signal} received, shutting down…`);
    try {
      await stop();
    } finally {
      process.exit(0);
    }
  });
}

process.on('unhandledRejection', err => {
  console.error('Unhandled promise rejection:', err);
});

if (require.main === module) {
  start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, start, stop };
