// Single source of truth for slot definitions.
// Loaded as a plain <script> in the browser (globals) and via require() on the
// server (see the CommonJS export at the bottom) so the two can never drift.

const SLOT_DEFS = [
  { slots: [0], label: '09:00 - 11:00', startHour: 9, endHour: 11 },
  { slots: [1], label: '11:00 - 13:00', startHour: 11, endHour: 13 },
  { slots: [2], label: '13:00 - 15:00', startHour: 13, endHour: 15 },
  { slots: [3], label: '15:00 - 17:00', startHour: 15, endHour: 17 },
  { slots: [4], label: '17:00 - 19:00', startHour: 17, endHour: 19 }
];

// The hour a slot begins, used to hide or reject slots that have already
// started today.
function slotStartHour(index) {
  const def = SLOT_DEFS.find(d => d.slots[0] === index);
  return def ? def.startHour : null;
}

// True when this slot has already started (or passed) on the given date.
function slotHasPassed(dateKey, slotIndex, now = new Date()) {
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  if (dateKey > todayStr) return false;
  if (dateKey < todayStr) return true;

  const start = slotStartHour(slotIndex);
  if (start === null) return false;
  return now.getHours() >= start;
}

const BLOCK_DEFS = [
  { slots: [0, 1, 2], label: 'Half day — Morning', sub: '09:00 – 15:00' },
  { slots: [2, 3, 4], label: 'Half day — Afternoon', sub: '13:00 – 19:00' },
  { slots: [0, 1, 2, 3, 4], label: 'Full day', sub: '09:00 – 19:00' }
];

const TOTAL_SLOTS = 5;

const SHOOT_TYPES = [
  'Photography',
  'Videography',
  'Product Shoot',
  'Portrait Session',
  'Event Coverage',
  'Content / Social Media',
  'Other'
];

// Field length caps — enforced on the server, mirrored in the UI's maxlength.
const LIMITS = {
  name: 80,
  description: 500,
  userName: 80,
  email: 120,
  password: 200
};

// Human-readable time range for an arbitrary set of slot indices.
// Used by the booking cards and the admin list.
function slotsLabel(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return 'Booking';

  const sorted = [...new Set(slots)].sort((a, b) => a - b);

  const block = BLOCK_DEFS.find(
    b => b.slots.length === sorted.length && b.slots.every((s, i) => s === sorted[i])
  );
  if (block) return `${block.label} (${block.sub})`;

  if (sorted.length === 1) {
    const def = SLOT_DEFS.find(d => d.slots[0] === sorted[0]);
    return def ? def.label : `Slot ${sorted[0]}`;
  }

  // Contiguous run -> single range; otherwise list each slot.
  const isContiguous = sorted.every((s, i) => i === 0 || s === sorted[i - 1] + 1);
  const labelFor = i => (SLOT_DEFS.find(d => d.slots[0] === i) || { label: '' }).label;

  if (isContiguous) {
    const start = labelFor(sorted[0]).split(' - ')[0];
    const end = labelFor(sorted[sorted.length - 1]).split(' - ')[1];
    if (start && end) return `${start} - ${end}`;
  }

  return sorted.map(labelFor).filter(Boolean).join(', ');
}

// Role hierarchy, mirrored from the server. Never compare roles with === in
// the UI: a superadmin must satisfy every admin check too.
const ROLE_RANK = { client: 0, admin: 1, superadmin: 2 };

function roleAtLeast(role, required) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[required] ?? -1);
}

function isAdminRole(role) {
  return roleAtLeast(role, 'admin');
}

function isSuperAdminRole(role) {
  return roleAtLeast(role, 'superadmin');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SLOT_DEFS, BLOCK_DEFS, TOTAL_SLOTS, SHOOT_TYPES, LIMITS, slotsLabel,
    slotStartHour, slotHasPassed,
    ROLE_RANK, roleAtLeast, isAdminRole, isSuperAdminRole
  };
}
