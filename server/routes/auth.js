const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/init');
const { generateToken, verifyToken } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  // Validation
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  if (email.toLowerCase() === 'admin@zetustudio.com') {
    return res.status(400).json({ error: 'That email is reserved' });
  }

  try {
    const db = getDb();
    const passwordHash = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, 'client'],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Account with that email already exists' });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }

        const user = { id: this.lastID, name, email, role: 'client' };
        const token = generateToken(user);
        res.json({ user, token });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const db = getDb();
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Login failed' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    try {
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Incorrect email or password' });
      }

      const token = generateToken(user);
      res.json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        token
      });
    } catch (err) {
      res.status(500).json({ error: 'Login failed' });
    }
  });
});

// Get current user (for token verification)
router.get('/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
