#!/usr/bin/env node
// Data integrity check.
//
// Rows written before the server validated its input can still be invalid:
// overlapping bookings, impossible dates, unknown shoot types, corrupt slot
// data. This reports them and, with --fix, resolves overlaps by keeping the
// booking that was made first.
//
//   node server/doctor.js          report only
//   node server/doctor.js --fix    also remove the losing side of each overlap

const { initDb, closeDb, all, run } = require('./db/init');
const { parseSlots, validateDate, validateSlots, ValidationError } = require('./utils/validate');
const { SHOOT_TYPES, TOTAL_SLOTS } = require('../public/js/constants');
const config = require('./config');

const FIX = process.argv.includes('--fix');

function isValidDate(date) {
  try {
    validateDate(date);
    return true;
  } catch (err) {
    if (err instanceof ValidationError) return false;
    throw err;
  }
}

function isValidSlots(raw) {
  try {
    validateSlots(JSON.parse(raw));
    return true;
  } catch (_) {
    return false;
  }
}

async function main() {
  await initDb();

  const bookings = await all('SELECT * FROM bookings ORDER BY date, id');
  const problems = [];
  const toDelete = [];

  console.log(`\nChecking ${bookings.length} booking${bookings.length === 1 ? '' : 's'}…\n`);

  // 1. Structurally invalid rows.
  for (const b of bookings) {
    if (!isValidDate(b.date)) {
      problems.push(`#${b.id}: invalid date "${b.date}"`);
    }
    if (!isValidSlots(b.slots)) {
      problems.push(`#${b.id}: invalid slot data ${JSON.stringify(b.slots)}`);
    }
    if (!SHOOT_TYPES.includes(b.type)) {
      problems.push(`#${b.id}: unknown shoot type "${b.type}"`);
    }
    if (!b.description || !String(b.description).trim()) {
      problems.push(`#${b.id}: empty description`);
    }
  }

  // 2. Overlapping bookings — the defect the old exact-match conflict check let through.
  const byDate = new Map();
  for (const b of bookings) {
    if (!byDate.has(b.date)) byDate.set(b.date, []);
    byDate.get(b.date).push(b);
  }

  for (const [date, sameDay] of byDate) {
    const owner = new Map(); // slot index -> booking that holds it

    for (const b of sameDay.sort((x, y) => x.id - y.id)) {
      const slots = parseSlots(b.slots);
      const clashes = slots.filter(s => owner.has(s));

      if (clashes.length > 0) {
        const against = [...new Set(clashes.map(s => owner.get(s).id))].join(', #');
        problems.push(
          `#${b.id} on ${date} overlaps #${against} on slot${
            clashes.length === 1 ? '' : 's'
          } ${clashes.join(', ')} — "${b.name}" vs earlier booking`
        );
        toDelete.push(b);
      } else {
        for (const s of slots) owner.set(s, b);
      }
    }

    const used = owner.size;
    if (used > TOTAL_SLOTS) {
      problems.push(`${date}: ${used} slots occupied but only ${TOTAL_SLOTS} exist`);
    }
  }

  // 3. Bookings whose account no longer exists.
  const orphans = await all(`
    SELECT b.id, b.booked_by_email FROM bookings b
    LEFT JOIN users u ON u.email = b.booked_by_email
    WHERE u.id IS NULL
  `);
  for (const o of orphans) {
    problems.push(`#${o.id}: booked by "${o.booked_by_email}", which has no account`);
  }

  // 4. Role integrity — unknown roles, and a missing or duplicated super admin.
  const VALID_ROLES = ['client', 'admin', 'superadmin'];
  const allUsers = await all('SELECT id, name, email, role FROM users');

  for (const u of allUsers) {
    if (!VALID_ROLES.includes(u.role)) {
      problems.push(`user #${u.id} "${u.email}" has unknown role "${u.role}"`);
    }
  }

  const supers = allUsers.filter(u => u.role === 'superadmin');
  if (supers.length === 0) {
    problems.push('no super admin account exists — restart the server to re-seed it');
  } else if (supers.length > 1) {
    problems.push(
      `${supers.length} super admin accounts exist (${supers.map(u => u.email).join(', ')}) — ` +
        'there should be exactly one'
    );
  } else if (supers[0].email !== config.SUPER_ADMIN_EMAIL) {
    problems.push(
      `super admin is "${supers[0].email}" but SUPER_ADMIN_EMAIL is "${config.SUPER_ADMIN_EMAIL}"`
    );
  }

  // 5. Duplicate accounts differing only by case.
  const users = await all('SELECT id, email FROM users');
  const seen = new Map();
  for (const u of users) {
    const key = u.email.toLowerCase();
    if (seen.has(key)) {
      problems.push(`user #${u.id} "${u.email}" duplicates user #${seen.get(key)}`);
    } else {
      seen.set(key, u.id);
    }
  }

  if (problems.length === 0) {
    console.log('✓ No problems found.\n');
    return 0;
  }

  console.log(`Found ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  problems.forEach(p => console.log('  •', p));

  if (!FIX) {
    if (toDelete.length > 0) {
      console.log(
        `\n${toDelete.length} overlapping booking${toDelete.length === 1 ? '' : 's'} can be ` +
          'removed automatically (the earlier booking is kept):'
      );
      toDelete.forEach(b => console.log(`  • #${b.id} ${b.date} — ${b.name} (${b.type})`));
      console.log('\nRe-run with --fix to remove them. Back up data/zetu.db first.');
    }
    console.log('\nAnything else listed above needs a manual decision.\n');
    return 1;
  }

  if (toDelete.length === 0) {
    console.log('\nNothing here can be fixed automatically — resolve the above by hand.\n');
    return 1;
  }

  console.log(`\nRemoving ${toDelete.length} overlapping booking(s)…`);
  for (const b of toDelete) {
    await run('DELETE FROM bookings WHERE id = ?', [b.id]);
    console.log(`  ✓ removed #${b.id} (${b.date}, ${b.name})`);
  }
  console.log('\nDone. Re-run without --fix to confirm.\n');
  return 0;
}

main()
  .then(async code => {
    await closeDb();
    process.exit(code);
  })
  .catch(async err => {
    console.error('Doctor failed:', err);
    await closeDb();
    process.exit(2);
  });
