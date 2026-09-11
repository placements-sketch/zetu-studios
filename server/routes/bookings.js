const express = require('express');
const { all, get, run, withTransaction } = require('../db/init');
const { verifyToken, isAdmin, hasAtLeast } = require('../middleware/auth');
const {
  ValidationError,
  requireString,
  validateDate,
  rejectPastDate,
  validateSlots,
  validateShootType,
  validateMonthYear,
  validateId,
  parseSlots,
  mapBookingRow
} = require('../utils/validate');
const { LIMITS, TOTAL_SLOTS, slotHasPassed, slotsLabel } = require('../../public/js/constants');
const { notifyBookingCreated, notifyBookingCancelled } = require('../utils/notifications');

const router = express.Router();

// Get all bookings for a specific date
router.get('/date/:date', verifyToken, async (req, res, next) => {
  try {
    const date = validateDate(req.params.date);
    const rows = await all('SELECT * FROM bookings WHERE date = ? ORDER BY slots', [date]);
    res.json({ bookings: rows.map(mapBookingRow) });
  } catch (err) {
    next(err);
  }
});

// Calendar overview for a month: one row per date with how many slots are taken.
router.get('/calendar/:month/:year', verifyToken, async (req, res, next) => {
  try {
    const { month, year } = validateMonthYear(req.params.month, req.params.year);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;

    const rows = await all('SELECT date, slots FROM bookings WHERE date LIKE ?', [`${prefix}-%`]);

    // Group in JS because occupied-slot counts need the parsed slot arrays,
    // which SQL cannot see inside the JSON column.
    const byDate = new Map();
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, { bookings: 0, occupied: new Set() });
      const entry = byDate.get(row.date);
      entry.bookings += 1;
      for (const slot of parseSlots(row.slots)) entry.occupied.add(slot);
    }

    const dates = [...byDate.entries()]
      .map(([date, entry]) => ({
        date,
        count: entry.bookings,
        occupiedSlots: [...entry.occupied].sort((a, b) => a - b),
        occupied: entry.occupied.size,
        isFull: entry.occupied.size >= TOTAL_SLOTS
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({ dates, totalSlots: TOTAL_SLOTS });
  } catch (err) {
    next(err);
  }
});

// Create a booking
router.post('/', verifyToken, async (req, res, next) => {
  try {
    const date = rejectPastDate(validateDate(req.body?.date));
    const slots = validateSlots(req.body?.slots);

    // A date check alone still allows booking this morning's slot this
    // afternoon, so reject any slot that has already started today.
    const passed = slots.filter(slot => slotHasPassed(date, slot));
    if (passed.length > 0) {
      throw new ValidationError(
        `That time has already started today (${slotsLabel(passed)}). Pick a later slot.`
      );
    }
    const name = requireString(req.body?.name, 'Your name', { max: LIMITS.name });
    const type = validateShootType(req.body?.type);
    const description = requireString(req.body?.description, 'Shoot details', {
      max: LIMITS.description
    });

    const { email, name: userName } = req.user;

    const booking = await withTransaction(async () => {
      const existing = await all('SELECT id, slots FROM bookings WHERE date = ?', [date]);

      // Any shared slot index is a clash — an exact-match check would happily
      // let a full-day booking land on top of an existing 09:00 slot.
      const taken = new Set();
      for (const row of existing) {
        for (const slot of parseSlots(row.slots)) taken.add(slot);
      }

      const clashes = slots.filter(slot => taken.has(slot));
      if (clashes.length > 0) {
        const err = new Error('That time is no longer available — part of it is already booked');
        err.status = 409;
        throw err;
      }

      const result = await run(
        'INSERT INTO bookings (date, slots, name, type, description, booked_by_email, booked_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [date, JSON.stringify(slots), name, type, description, email, userName]
      );

      return {
        id: result.lastID,
        date,
        slots,
        name,
        type,
        description,
        booked_by_email: email,
        booked_by_name: userName,
        created_at: new Date().toISOString()
      };
    });

    res.status(201).json({ booking });

    // After the response: a slow or broken mail server must not delay or fail
    // the booking itself. sendMail never throws, but guard anyway.
    notifyBookingCreated(booking).catch(err =>
      console.error('Booking notification failed:', err.message)
    );
  } catch (err) {
    next(err);
  }
});

// Get the signed-in user's bookings
router.get('/my-bookings', verifyToken, async (req, res, next) => {
  try {
    const rows = await all(
      'SELECT * FROM bookings WHERE booked_by_email = ? ORDER BY date DESC, slots',
      [req.user.email]
    );
    res.json({ bookings: rows.map(mapBookingRow) });
  } catch (err) {
    next(err);
  }
});

// Get all bookings (admin only)
router.get('/admin/all', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM bookings ORDER BY date DESC, slots');
    res.json({ bookings: rows.map(mapBookingRow) });
  } catch (err) {
    next(err);
  }
});

// Admin stats — aggregated in SQL rather than by pulling every row into memory.
router.get('/admin/stats', verifyToken, isAdmin, async (req, res, next) => {
  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = `${currentMonth}-${String(now.getDate()).padStart(2, '0')}`;

    const [totals, monthRow, upcomingRow, topRow, clientsRow] = await Promise.all([
      get('SELECT COUNT(*) AS total FROM bookings'),
      get('SELECT COUNT(*) AS count FROM bookings WHERE date LIKE ?', [`${currentMonth}-%`]),
      get('SELECT COUNT(*) AS count FROM bookings WHERE date >= ?', [today]),
      get('SELECT type, COUNT(*) AS count FROM bookings GROUP BY type ORDER BY count DESC, type ASC LIMIT 1'),
      get('SELECT COUNT(DISTINCT booked_by_email) AS count FROM bookings')
    ]);

    res.json({
      stats: {
        totalBookings: totals.total,
        thisMonth: monthRow.count,
        upcoming: upcomingRow.count,
        uniqueClients: clientsRow.count,
        topType: topRow ? topRow.type : '—'
      }
    });
  } catch (err) {
    next(err);
  }
});

// Cancel a booking
router.delete('/:id', verifyToken, async (req, res, next) => {
  try {
    const id = validateId(req.params.id);
    const { email, role } = req.user;

    const booking = await get('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.booked_by_email !== email && !hasAtLeast(role, 'admin')) {
      return res.status(403).json({ error: 'Not authorized to cancel this booking' });
    }

    await run('DELETE FROM bookings WHERE id = ?', [id]);
    res.json({ message: 'Booking cancelled', id });

    notifyBookingCancelled(mapBookingRow(booking), req.user).catch(err =>
      console.error('Cancellation notification failed:', err.message)
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
