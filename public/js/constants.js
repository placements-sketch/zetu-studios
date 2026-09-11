const SLOT_DEFS = [
  { slots: [0], label: '09:00 - 11:00' },
  { slots: [1], label: '11:00 - 13:00' },
  { slots: [2], label: '13:00 - 15:00' },
  { slots: [3], label: '15:00 - 17:00' },
  { slots: [4], label: '17:00 - 19:00' }
];

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
