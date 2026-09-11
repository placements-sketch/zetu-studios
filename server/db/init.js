const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'zetu.db');

// Create database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('✓ Database connected at', DB_PATH);
  }
});

// Get database instance
function getDb() {
  return db;
}

// Initialize database tables
function initDb() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'client',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create bookings table
      db.run(`
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

      // Seed admin user
      db.get('SELECT id FROM users WHERE email = ?', ['admin@zetustudio.com'], async (err, row) => {
        if (!row) {
          try {
            const hash = await bcrypt.hash('admin123', 10);
            db.run(
              'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
              ['Studio Admin', 'admin@zetustudio.com', hash, 'admin'],
              (err) => {
                if (!err) console.log('✓ Admin user created');
              }
            );
          } catch (e) {
            console.error('Admin creation error:', e);
          }
        }
      });

      setTimeout(() => {
        console.log('✓ Database initialized');
        resolve();
      }, 500);
    });
  });
}

module.exports = { getDb, initDb };
