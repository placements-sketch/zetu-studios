#!/usr/bin/env node
// Verifies the SMTP settings and sends one real test email.
//
//   npm run mail:test
//
// Use this after filling in SMTP_* in .env, before trusting the system to
// notify anyone. It sends to NOTIFY_EMAIL (the super admin address).

const config = require('./config');
const { verifyConnection, sendMail } = require('./utils/mailer');

function line(label, value) {
  console.log(`  ${String(label).padEnd(16)} ${value}`);
}

async function main() {
  console.log('\nEmail configuration\n');
  line('SMTP host', config.SMTP_HOST || '(not set)');
  line('SMTP port', `${config.SMTP_PORT} (${config.SMTP_SECURE ? 'implicit TLS' : 'STARTTLS'})`);
  line('SMTP user', config.SMTP_USER || '(not set)');
  line('SMTP pass', config.SMTP_PASS ? `set, ${config.SMTP_PASS.length} characters` : '(not set)');
  line('From', config.MAIL_FROM || config.SMTP_USER || '(not set)');
  line('Notify', config.NOTIFY_EMAIL);
  line('Daily digest', config.DAILY_DIGEST_ENABLED ? config.DAILY_DIGEST_TIME : 'disabled');
  console.log();

  if (!config.MAIL_CONFIGURED) {
    console.error('✗ Not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env.\n');
    console.error('  For Google Workspace:');
    console.error('    SMTP_HOST=smtp.gmail.com');
    console.error('    SMTP_PORT=587');
    console.error(`    SMTP_USER=${config.NOTIFY_EMAIL}`);
    console.error('    SMTP_PASS=<16-character App Password, not the account password>\n');
    console.error('  App Passwords need 2-Step Verification on the account:');
    console.error('    https://myaccount.google.com/apppasswords\n');
    return 1;
  }

  process.stdout.write('Checking the connection… ');
  const check = await verifyConnection();

  if (!check.ok) {
    console.log('failed\n');
    console.error(`✗ ${check.reason}\n`);

    if (/invalid login|username and password not accepted|535/i.test(check.reason)) {
      console.error('  That looks like a credentials problem. With Google Workspace you must');
      console.error('  use an App Password, not the normal account password.\n');
    } else if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(check.reason)) {
      console.error('  The server could not be reached. Check SMTP_HOST and SMTP_PORT, and');
      console.error('  whether outbound port ' + config.SMTP_PORT + ' is blocked here.\n');
    }
    return 1;
  }

  console.log('ok');
  process.stdout.write(`Sending a test email to ${config.NOTIFY_EMAIL}… `);

  const sent = await sendMail({
    subject: 'Zetu Studio — test notification',
    text:
      'This is a test from the Zetu Studio booking system.\n\n' +
      'If you are reading this, booking and cancellation notifications will arrive here.\n',
    html:
      '<div style="font-family:system-ui,sans-serif;max-width:520px;">' +
      '<h2 style="margin:0 0 10px;">Zetu Studio — test notification</h2>' +
      '<p style="color:#555;line-height:1.6;">This is a test from the booking system. ' +
      'If you are reading this, booking and cancellation notifications will arrive here.</p>' +
      '</div>'
  });

  if (!sent) {
    console.log('failed');
    console.error('\n✗ The connection worked but the message was rejected. See the error above.\n');
    return 1;
  }

  console.log('sent');
  console.log(`\n✓ Check the inbox for ${config.NOTIFY_EMAIL}. Look in spam if it is not there.\n`);
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('\nmail:test failed:', err.message, '\n');
    process.exit(2);
  });
