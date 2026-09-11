const fs = require('fs');
const path = require('path');

// Minimal .env loader — keeps the project dependency-free. Values already
// present in the real environment always win over the file.
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const DEFAULT_SECRET = 'zetu-studio-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;

// Shipping the sample secret to production would let anyone mint admin tokens.
if (IS_PRODUCTION && JWT_SECRET === DEFAULT_SECRET) {
  console.error(
    '\nFATAL: JWT_SECRET is still the default value while NODE_ENV=production.\n' +
    'Anyone who has seen this repository could forge admin sessions.\n' +
    'Set a long random JWT_SECRET before starting in production, e.g.\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

const config = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT: Number.isFinite(Number(process.env.PORT)) && process.env.PORT !== ''
    ? Number(process.env.PORT)
    : 5000,
  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'zetu.db'),
  // Comma-separated list, or "*" to allow any origin.
  CORS_ORIGIN: process.env.CORS_ORIGIN || (IS_PRODUCTION ? '' : '*'),
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || 'admin@zetustudio.com').toLowerCase(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  ADMIN_NAME: process.env.ADMIN_NAME || 'Studio Admin',
  BCRYPT_ROUNDS: Number(process.env.BCRYPT_ROUNDS) || 10,

  // ── Super admin ───────────────────────────────────────────────────────────
  // The studio's own account. Outranks admin: can promote and demote admins,
  // and cannot be demoted or deleted by anyone else.
  SUPER_ADMIN_EMAIL: (process.env.SUPER_ADMIN_EMAIL || 'zetustudios@shopzetu.com').toLowerCase(),
  SUPER_ADMIN_NAME: process.env.SUPER_ADMIN_NAME || 'Zetu Studios',
  // Leave unset and a strong password is generated and printed once at first
  // start. It is never written to disk in plain text.
  SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD || '',

  // ── Email notifications ───────────────────────────────────────────────────
  // Notifications are skipped (with a log line) until SMTP_HOST, SMTP_USER and
  // SMTP_PASS are all set, so the app runs fine unconfigured.
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  // Port 465 is implicit TLS; 587 upgrades via STARTTLS.
  SMTP_SECURE: process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : Number(process.env.SMTP_PORT) === 465,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  // Where notifications are delivered. Defaults to the super admin's address.
  NOTIFY_EMAIL: (process.env.NOTIFY_EMAIL || process.env.SUPER_ADMIN_EMAIL || 'zetustudios@shopzetu.com').toLowerCase(),
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME || 'Zetu Studio Bookings',
  // Defaults to SMTP_USER, since most providers reject a From they do not own.
  MAIL_FROM: process.env.MAIL_FROM || process.env.SMTP_USER || '',

  NOTIFY_ON_BOOKING: process.env.NOTIFY_ON_BOOKING !== 'false',
  NOTIFY_ON_CANCEL: process.env.NOTIFY_ON_CANCEL !== 'false',

  // Daily digest of the day's shoots. HH:MM in the server's local time.
  DAILY_DIGEST_ENABLED: process.env.DAILY_DIGEST_ENABLED !== 'false',
  DAILY_DIGEST_TIME: process.env.DAILY_DIGEST_TIME || '07:00',

  // Public base URL, used for links inside emails.
  APP_URL: (process.env.APP_URL || '').replace(/\/$/, '')
};

// True only when every credential the transport needs is present.
config.MAIL_CONFIGURED = Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);

module.exports = config;
