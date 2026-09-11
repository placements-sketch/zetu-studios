const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
let warned = false;

// Tests (and anyone wanting a dry run) can capture mail instead of sending it.
let outbox = null;

function enableOutbox() {
  outbox = [];
  return outbox;
}

function getOutbox() {
  return outbox;
}

function disableOutbox() {
  outbox = null;
}

function getTransport() {
  if (transport) return transport;
  if (!config.MAIL_CONFIGURED) return null;

  transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    // A hung mail server must never hold a booking request open.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });

  return transport;
}

/**
 * Sends one message. Never throws — a failed notification must not fail the
 * booking that triggered it. Returns true when the message was handed off.
 */
async function sendMail({ to, subject, text, html }) {
  const recipient = to || config.NOTIFY_EMAIL;

  if (outbox) {
    outbox.push({ to: recipient, subject, text, html });
    return true;
  }

  const tx = getTransport();
  if (!tx) {
    if (!warned) {
      console.warn(
        '⚠ Email not configured — set SMTP_HOST, SMTP_USER and SMTP_PASS to enable ' +
          'notifications. Skipping all mail until then.'
      );
      warned = true;
    }
    console.log(`   (would have emailed ${recipient}: ${subject})`);
    return false;
  }

  try {
    const from = config.MAIL_FROM || config.SMTP_USER;
    const info = await tx.sendMail({
      from: `"${config.MAIL_FROM_NAME}" <${from}>`,
      to: recipient,
      subject,
      text,
      html
    });
    console.log(`✓ Emailed ${recipient}: ${subject} (${info.messageId})`);
    return true;
  } catch (err) {
    console.error(`✗ Could not email ${recipient}: ${subject} —`, err.message);
    return false;
  }
}

// Checks the credentials without sending anything. Used by `npm run mail:test`
// and at startup so a bad password is discovered early, not on first booking.
async function verifyConnection() {
  const tx = getTransport();
  if (!tx) return { ok: false, reason: 'not configured' };

  try {
    await tx.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function resetTransport() {
  transport = null;
  warned = false;
}

module.exports = {
  sendMail,
  verifyConnection,
  resetTransport,
  enableOutbox,
  disableOutbox,
  getOutbox
};
