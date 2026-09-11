const express = require('express');
const { getDb } = require('../db/init');
const { verifyToken, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all bookings for a specific date
router.get('/date/:date', verifyToken, (req, res) => {
  const { date } = req.params;
  const db = getDb();

  db.all('SELECT * FROM bookings WHERE date = ? ORDER BY slots', [date], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch bookings' });
    }
    const bookings = rows.map(row => ({
      ...row,
      slots: JSON.parse(row.slots)
    }));
    res.json({ bookings });
  });
});

// Get calendar overview (all dates with booking counts)
router.get('/calendar/:month/:year', verifyToken, (req, res) => {
  const { month, year } = req.params;
  const db = getDb();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;

  db.all(
    'SELECT DISTINCT date, COUNT(*) as count FROM bookings WHERE date LIKE ? GROUP BY date',
    [`${prefix}%`],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch calendar' });
      }
      res.json({ dates: rows || [] });
    }
  );
});

// Create a booking
router.post('/', verifyToken, (req, res) => {
  const { date, slots, name, type, description } = req.body;
  const { email, name: userName } = req.user;

  if (!date || !slots || !name || !type || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const db = getDb();
  const slotsJson = JSON.stringify(slots);

  // Check for conflicts
  db.get(
    'SELECT * FROM bookings WHERE date = ? AND slots = ?',
    [date, slotsJson],
    (err, existing) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to create booking' });
      }

      if (existing) {
        return res.status(409).json({ error: 'This time slot is no longer available' });
      }

      db.run(
        'INSERT INTO bookings (date, slots, name, type, description, booked_by_email, booked_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [date, slotsJson, name, type, description, email, userName],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create booking' });
          }

          res.status(201).json({
            booking: {
              id: this.lastID,
              date,
              slots,
              name,
              type,
              description,
              booked_by_email: email,
              booked_by_name: userName,
              created_at: new Date().toISOString()
            }
          });
        }
      );
    }
  );
});

// Get user's bookings
router.get('/my-bookings', verifyToken, (req, res) => {
  const { email } = req.user;
  const db = getDb();

  db.all(
    'SELECT * FROM bookings WHERE booked_by_email = ? ORDER BY date DESC',
    [email],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch bookings' });
      }
      const bookings = rows.map(row => ({
        ...row,
        slots: JSON.parse(row.slots)
      }));
      res.json({ bookings });
    }
  );
});

// Get all bookings (admin only)
router.get('/admin/all', verifyToken, isAdmin, (req, res) => {
  const db = getDb();

  db.all('SELECT * FROM bookings ORDER BY date DESC, slots', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch bookings' });
    }
    const bookings = rows.map(row => ({
      ...row,
      slots: JSON.parse(row.slots)
    }));
    res.json({ bookings });
  });
});

// Get admin stats
router.get('/admin/stats', verifyToken, isAdmin, (req, res) => {
  const db = getDb();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  db.all('SELECT * FROM bookings', (err, allBookings) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }

    const thisMonth = allBookings.filter(b => b.date.startsWith(currentMonth)).length;
    const typeCounts = {};
    allBookings.forEach(b => {
      typeCounts[b.type] = (typeCounts[b.type] || 0) + 1;
    });

    let topType = '—';
    let topCount = 0;
    Object.entries(typeCounts).forEach(([type, count]) => {
      if (count > topCount) {
        topType = type;
        topCount = count;
      }
    });

    res.json({
      stats: {
        totalBookings: allBookings.length,
        thisMonth,
        topType
      }
    });
  });
});

// Cancel booking
router.delete('/:id', verifyToken, (req, res) => {
  const { id } = req.params;
  const { email, role } = req.user;
  const db = getDb();

  db.get('SELECT * FROM bookings WHERE id = ?', [id], (err, booking) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to cancel booking' });
    }

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Only allow owner or admin to cancel
    if (booking.booked_by_email !== email && role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to cancel this booking' });
    }

    db.run('DELETE FROM bookings WHERE id = ?', [id], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to cancel booking' });
      }
      res.json({ message: 'Booking cancelled' });
    });
  });
});

module.exports = router;
