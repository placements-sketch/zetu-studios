#!/usr/bin/env node
// Sets an account's password from the command line. The last resort when
// nobody can sign in — no server or browser required.
//
//   npm run set-password -- zetustudios@shopzetu.com
//   npm run set-password -- zetustudios@shopzetu.com "New Password 123"
//   npm run set-password -- zetustudios@shopzetu.com "Handover 123" --must-change
//   npm run set-password -- --list
//
// With no password argument you are prompted, and the input is not echoed.
// --must-change marks the password as temporary: the account is forced to
// replace it at the next sign-in. Use it when handing a system over.

const bcrypt = require('bcrypt');
const readline = require('readline');
const config = require('./config');
const { initDb, closeDb, all, get, run } = require('./db/init');
const { validatePassword, ValidationError } = require('./utils/validate');

// Reads a line without echoing it, so the password stays out of the scrollback.
function promptHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const onData = char => {
      if (['\n', '\r', ''].includes(char.toString())) return;
      readline.moveCursor(process.stdout, -1000, 0);
      readline.clearLine(process.stdout, 1);
      process.stdout.write(question + '*'.repeat(rl.line.length));
    };

    process.stdin.on('data', onData);
    rl.question(question, answer => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function listAccounts() {
  const users = await all(`
    SELECT email, name, role, must_change_password FROM users
    ORDER BY CASE role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, email
  `);

  console.log(`\n${users.length} account${users.length === 1 ? '' : 's'}:\n`);
  for (const u of users) {
    const flag = u.must_change_password ? '  (must set password)' : '';
    console.log(`  ${u.role.padEnd(11)} ${u.email.padEnd(32)} ${u.name}${flag}`);
  }
  console.log();
}

async function main() {
  const argv = process.argv.slice(2).filter(a => a !== '--');
  const mustChange = argv.includes('--must-change');
  const args = argv.filter(a => a !== '--must-change');

  await initDb();

  if (args.length === 0 || args[0] === '--list' || args[0] === '-l') {
    await listAccounts();
    if (args.length === 0) {
      console.log('Usage: npm run set-password -- <email> [new password]\n');
      return 1;
    }
    return 0;
  }

  const email = String(args[0]).trim().toLowerCase();
  const user = await get('SELECT id, name, email, role FROM users WHERE email = ?', [email]);

  if (!user) {
    console.error(`\n✗ No account with the email "${email}".`);
    console.error('  Run with --list to see the accounts that exist.\n');
    return 1;
  }

  console.log(`\nAccount: ${user.name} <${user.email}>  (${user.role})\n`);

  let password = args[1];

  if (!password) {
    password = await promptHidden('New password: ');
    const again = await promptHidden('Confirm:      ');

    if (password !== again) {
      console.error('\n✗ The passwords do not match. Nothing was changed.\n');
      return 1;
    }
  }

  try {
    validatePassword(password);
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(`\n✗ ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  await run(
    `UPDATE users
       SET password_hash = ?, must_change_password = ?, password_changed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [hash, mustChange ? 1 : 0, user.id]
  );

  console.log(`✓ Password updated for ${user.email}.`);
  if (mustChange) {
    console.log('  Marked as temporary — they must set their own password at the next sign-in.');
  } else {
    console.log('  They can sign in with it immediately.');
  }
  console.log();
  return 0;
}

main()
  .then(async code => {
    await closeDb();
    process.exit(code);
  })
  .catch(async err => {
    console.error('\nset-password failed:', err.message, '\n');
    await closeDb();
    process.exit(2);
  });
