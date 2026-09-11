const { TOTAL_SLOTS, SHOOT_TYPES, LIMITS } = require('../../public/js/constants');

// Thrown by the validators below; turned into a 400 by the error handler.
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireString(value, field, { max, min = 1 } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new ValidationError(`${field} is required`);
  }
  if (max && trimmed.length > max) {
    throw new ValidationError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

function normaliseEmail(value) {
  const email = requireString(value, 'Email', { max: LIMITS.email }).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new ValidationError('Invalid email format');
  }
  return email;
}

// Obvious choices that a short-minimum rule would otherwise allow.
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', 'qwerty',
  'qwerty123', 'letmein', 'welcome', 'admin123', 'zetustudio', 'zetustudios',
  'changeme', 'iloveyou', 'abc123', 'monkey', 'football', 'starwars'
]);

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }
  if (value.length > LIMITS.password) {
    throw new ValidationError(`Password must be ${LIMITS.password} characters or fewer`);
  }
  if (WEAK_PASSWORDS.has(value.toLowerCase())) {
    throw new ValidationError('That password is too common — please choose another');
  }
  // Character variety matters more than length rules alone.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  if (classes < 2) {
    throw new ValidationError(
      'Password must mix at least two of: lowercase, uppercase, numbers, symbols'
    );
  }
  return value;
}

// 0-4, for the strength meter. Mirrored in the browser via the shared module.
function passwordStrength(value) {
  if (typeof value !== 'string' || value.length === 0) return 0;
  if (WEAK_PASSWORDS.has(value.toLowerCase())) return 1;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (classes >= 2) score += 1;
  if (classes >= 3 && value.length >= 10) score += 1;
  return Math.min(score, 4);
}

// Accepts YYYY-MM-DD and rejects impossible calendar dates such as 2026-02-31.
function validateDate(value) {
  const date = requireString(value, 'Date', { max: 10 });
  if (!DATE_RE.test(date)) {
    throw new ValidationError('Date must be in YYYY-MM-DD format');
  }

  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new ValidationError('That is not a real date');
  }
  return date;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

function rejectPastDate(date) {
  // Both sides are zero-padded YYYY-MM-DD, so a string compare is a date compare.
  if (date < todayKey()) {
    throw new ValidationError('That date has already passed');
  }
  return date;
}

// Returns a sorted, de-duplicated array of valid slot indices.
function validateSlots(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('Select at least one time slot');
  }
  if (value.length > TOTAL_SLOTS) {
    throw new ValidationError('Too many time slots selected');
  }

  const slots = [];
  for (const raw of value) {
    if (!Number.isInteger(raw) || raw < 0 || raw >= TOTAL_SLOTS) {
      throw new ValidationError(`Slot must be a whole number between 0 and ${TOTAL_SLOTS - 1}`);
    }
    if (!slots.includes(raw)) slots.push(raw);
  }
  return slots.sort((a, b) => a - b);
}

function validateShootType(value) {
  const type = requireString(value, 'Type of shoot', { max: 60 });
  if (!SHOOT_TYPES.includes(type)) {
    throw new ValidationError('Unknown type of shoot');
  }
  return type;
}

function validateMonthYear(month, year) {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new ValidationError('Month must be between 1 and 12');
  }
  if (!Number.isInteger(y) || y < 1970 || y > 3000) {
    throw new ValidationError('Year is out of range');
  }
  return { month: m, year: y };
}

function validateId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new ValidationError('Invalid booking id');
  }
  return id;
}

// Rows written before validation existed may hold non-array slot data, and a
// throw inside an sqlite callback would take the process down.
function parseSlots(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch (_) {
    return [];
  }
}

function mapBookingRow(row) {
  return { ...row, slots: parseSlots(row.slots) };
}

module.exports = {
  ValidationError,
  requireString,
  normaliseEmail,
  validatePassword,
  passwordStrength,
  validateDate,
  rejectPastDate,
  validateSlots,
  validateShootType,
  validateMonthYear,
  validateId,
  parseSlots,
  mapBookingRow,
  todayKey
};
