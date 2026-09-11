const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('../config');

const DB_PATH = config.DB_PATH;
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;

function getDb() {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

// Promisified wrappers so routes can use async/await instead of nested callbacks.
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

// Serialises write transactions so the conflict check and the insert that
// follows it cannot be interleaved by a concurrent booking request.
let txChain = Promise.resolve();

function withTransaction(work) {
  const result = txChain.then(async () => {
    await run('BEGIN IMMEDIATE');
    try {
      const value = await work();
      await run('COMMIT');
      return value;
    } catch (err) {
      try {
        await run('ROLLBACK');
      } catch (_) {
        /* rollback of an already-aborted transaction is not interesting */
      }
      throw err;
    }
  });

  // Keep the chain alive even when this transaction rejects.
  txChain = result.catch(() => {});
  return result;
}

function connect() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, err => {
      if (err) return reject(err);
      console.log('✓ Database connected at', DB_PATH);
      resolve();
    });
  });
}

async function createSchema() {
  await run('PRAGMA foreign_keys = ON');

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slots TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      booked_by_email TEXT NOT NULL,
      booked_by_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Added after the first release — existing databases need it backfilled.
  await addColumnIfMissing('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing('users', 'password_changed_at', 'DATETIME');

  // date is filtered on by every read path; email drives "my bookings".
  await run('CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)');
  await run('CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(booked_by_email)');
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
}

// ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite, so check first.
async function addColumnIfMissing(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  if (columns.some(c => c.name === column)) return;

  await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`✓ Added ${table}.${column}`);
}

// Existing databases were created before email was COLLATE NOCASE, so the same
// address could be registered twice in different cases. Normalise and report.
async function normaliseExistingEmails() {
  const rows = await all('SELECT id, email FROM users');
  const mixed = rows.filter(r => r.email !== r.email.toLowerCase());

  for (const row of mixed) {
    const lower = row.email.toLowerCase();
    const clash = rows.find(r => r.id !== row.id && r.email.toLowerCase() === lower);

    if (clash) {
      console.warn(
        `⚠ Duplicate account detected: "${row.email}" (id ${row.id}) collides with ` +
        `"${clash.email}" (id ${clash.id}). Leaving both in place — merge them manually.`
      );
      continue;
    }

    await run('UPDATE users SET email = ? WHERE id = ?', [lower, row.id]);
    await run('UPDATE bookings SET booked_by_email = ? WHERE booked_by_email = ?', [
      lower,
      row.email
    ]);
  }
}

async function seedAdmin() {
  const existing = await get('SELECT id FROM users WHERE email = ?', [config.ADMIN_EMAIL]);
  if (existing) return;

  const hash = await bcrypt.hash(config.ADMIN_PASSWORD, config.BCRYPT_ROUNDS);
  await run(
    'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)',
    [config.ADMIN_NAME, config.ADMIN_EMAIL, hash, 'admin']
  );
  console.log('✓ Admin user created:', config.ADMIN_EMAIL);

  if (config.IS_PRODUCTION && config.ADMIN_PASSWORD === 'admin123') {
    console.warn('⚠ The admin account is using the default password. Change it now.');
  }
}

// The studio's own account. Created once, then always kept at the superadmin
// role — so an accidental demotion in the database repairs itself on restart.
async function seedSuperAdmin() {
  const email = config.SUPER_ADMIN_EMAIL;
  const existing = await get('SELECT id, role FROM users WHERE email = ?', [email]);

  if (existing) {
    if (existing.role !== 'superadmin') {
      await run('UPDATE users SET role = ? WHERE id = ?', ['superadmin', existing.id]);
      console.log('✓ Restored superadmin role for', email);
    }
    return;
  }

  // A generated password is printed once and never stored in plain text.
  const generated = !config.SUPER_ADMIN_PASSWORD;
  const password = config.SUPER_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');

  const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  // Whoever receives this handover password is required to replace it on first
  // sign-in, so the temporary one never becomes the permanent one.
  await run(
    'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)',
    [config.SUPER_ADMIN_NAME, email, hash, 'superadmin']
  );

  console.log('✓ Super admin created:', email);

  if (generated) {
    console.log(`
  +------------------------------------------------------------+
  |  SUPER ADMIN PASSWORD - shown once, copy it now             |
  +------------------------------------------------------------+
     email:    ${email}
     password: ${password}

  Sign in and change it, or set SUPER_ADMIN_PASSWORD in .env
  before first start to choose your own.
`);
  }
}

async function initDb() {
  await connect();
  await createSchema();
  await normaliseExistingEmails();
  await seedAdmin();
  await seedSuperAdmin();
  console.log('✓ Database initialized');
}

function closeDb() {
  return new Promise(resolve => {
    if (!db) return resolve();
    db.close(() => {
      db = null;
      resolve();
    });
  });
}

module.exports = { getDb, initDb, closeDb, run, get, all, withTransaction, DB_PATH };
