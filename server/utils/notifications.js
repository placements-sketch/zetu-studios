const config = require('../config');
// Required as a module object (not destructured) so tests can substitute a
// failing transport and prove a booking survives a broken mail server.
const mailer = require('./mailer');
const sendMail = (...args) => mailer.sendMail(...args);
const { all } = require('../db/init');
const { slotsLabel } = require('../../public/js/constants');
const { mapBookingRow, todayKey } = require('./validate');

const BRAND_BG = '#071310';
const BRAND_ACCENT = '#d7ff3d';
const BRAND_TEXT = '#f2f5ee';
const BRAND_DIM = '#93a89f';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prettyDate(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

// Inline styles only — every serious mail client strips <style> blocks.
function layout({ heading, accentLabel, rows = [], bodyNote, footNote, cardsHtml = '' }) {
  const rowHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 0;color:${BRAND_DIM};font-size:13px;width:140px;vertical-align:top;">${escapeHtml(
          label
        )}</td>
        <td style="padding:8px 0;color:${BRAND_TEXT};font-size:14px;vertical-align:top;">${value}</td>
      </tr>`
    )
    .join('');

  const button = config.APP_URL
    ? `<tr><td style="padding-top:24px;">
         <a href="${escapeHtml(config.APP_URL)}"
            style="display:inline-block;background:${BRAND_ACCENT};color:#0e1713;text-decoration:none;
                   font-weight:700;font-size:13px;padding:11px 22px;border-radius:24px;">
           Open the calendar
         </a>
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#05100d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05100d;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:${BRAND_BG};border:1px solid rgba(210,222,214,0.12);
                    border-radius:18px;padding:30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td>
          <div style="font-size:15px;font-weight:700;color:${BRAND_TEXT};letter-spacing:0.3px;">
            zetu<span style="color:${BRAND_ACCENT};">studio</span>
          </div>
          <div style="margin-top:6px;font-size:11px;font-weight:700;letter-spacing:1.2px;
                      text-transform:uppercase;color:${BRAND_ACCENT};">${escapeHtml(accentLabel)}</div>
          <h1 style="margin:12px 0 0;font-size:21px;line-height:1.3;color:${BRAND_TEXT};font-weight:700;">
            ${escapeHtml(heading)}
          </h1>
          ${
            bodyNote
              ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:${BRAND_DIM};">${bodyNote}</p>`
              : ''
          }
        </td></tr>
        <tr><td style="padding-top:20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-top:1px solid rgba(210,222,214,0.12);">
            ${rowHtml}${cardsHtml}
          </table>
        </td></tr>
        ${button}
        <tr><td style="padding-top:26px;border-top:1px solid rgba(210,222,214,0.12);margin-top:20px;">
          <p style="margin:14px 0 0;font-size:11.5px;line-height:1.6;color:#4d6058;">
            ${escapeHtml(footNote || 'Automatic notification from the Zetu Studio booking system.')}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function bookingRows(booking) {
  return [
    ['Date', escapeHtml(prettyDate(booking.date))],
    ['Time', escapeHtml(slotsLabel(booking.slots))],
    ['Shoot type', escapeHtml(booking.type)],
    ['Client name', escapeHtml(booking.name)],
    [
      'Booked by',
      `${escapeHtml(booking.booked_by_name)}<br><a href="mailto:${escapeHtml(
        booking.booked_by_email
      )}" style="color:${BRAND_ACCENT};">${escapeHtml(booking.booked_by_email)}</a>`
    ],
    ['Details', escapeHtml(booking.description).replace(/\n/g, '<br>')]
  ];
}

function bookingText(booking) {
  return [
    `Date:        ${prettyDate(booking.date)}`,
    `Time:        ${slotsLabel(booking.slots)}`,
    `Shoot type:  ${booking.type}`,
    `Client name: ${booking.name}`,
    `Booked by:   ${booking.booked_by_name} <${booking.booked_by_email}>`,
    `Details:     ${booking.description}`
  ].join('\n');
}

/** A new booking was made. */
async function notifyBookingCreated(booking) {
  if (!config.NOTIFY_ON_BOOKING) return false;

  const when = `${prettyDate(booking.date)} · ${slotsLabel(booking.slots)}`;

  return sendMail({
    subject: `New booking — ${booking.type} on ${prettyDate(booking.date)}`,
    text: `A new shoot has been booked.\n\n${bookingText(booking)}\n`,
    html: layout({
      accentLabel: 'New booking',
      heading: when,
      bodyNote: `A new shoot has been booked by ${escapeHtml(booking.booked_by_name)}.`,
      rows: bookingRows(booking)
    })
  });
}

/** A booking was cancelled. `cancelledBy` is the acting user. */
async function notifyBookingCancelled(booking, cancelledBy) {
  if (!config.NOTIFY_ON_CANCEL) return false;

  const byOwner = cancelledBy.email === booking.booked_by_email;
  const actor = `${cancelledBy.name} <${cancelledBy.email}>`;
  const note = byOwner
    ? 'Cancelled by the person who made the booking.'
    : `Cancelled by ${escapeHtml(actor)} (${escapeHtml(cancelledBy.role)}) on their behalf.`;

  const rows = bookingRows(booking).concat([['Cancelled by', escapeHtml(actor)]]);

  return sendMail({
    subject: `Cancelled — ${booking.type} on ${prettyDate(booking.date)}`,
    text:
      `A booking has been cancelled. The slot is free again.\n\n` +
      `${bookingText(booking)}\nCancelled by: ${actor}\n`,
    html: layout({
      accentLabel: 'Booking cancelled',
      heading: `${prettyDate(booking.date)} · ${slotsLabel(booking.slots)}`,
      bodyNote: `${note} The slot is free again.`,
      rows,
      footNote: 'The time is now available for booking.'
    })
  });
}

/** The day's schedule. Sent once each morning. */
async function sendDailyDigest(dateKey = todayKey()) {
  const rows = await all('SELECT * FROM bookings WHERE date = ? ORDER BY slots', [dateKey]);
  const bookings = rows.map(mapBookingRow);

  if (bookings.length === 0) {
    return sendMail({
      subject: `No shoots today — ${prettyDate(dateKey)}`,
      text: `Nothing is booked for ${prettyDate(dateKey)}. The studio is free all day.`,
      html: layout({
        accentLabel: "Today's schedule",
        heading: prettyDate(dateKey),
        bodyNote: 'Nothing is booked today — the studio is free all day.',
        rows: [],
        footNote: 'Daily schedule digest from the Zetu Studio booking system.'
      })
    });
  }

  const cards = bookings
    .map(
      b => `
      <tr><td style="padding:14px 0;border-bottom:1px solid rgba(210,222,214,0.10);">
        <div style="font-size:15px;font-weight:700;color:${BRAND_ACCENT};">${escapeHtml(
          slotsLabel(b.slots)
        )}</div>
        <div style="margin-top:4px;font-size:14px;color:${BRAND_TEXT};">${escapeHtml(
          b.type
        )} — ${escapeHtml(b.name)}</div>
        <div style="margin-top:3px;font-size:12.5px;color:${BRAND_DIM};">${escapeHtml(
          b.description
        )}</div>
        <div style="margin-top:5px;font-size:11.5px;color:#4d6058;">${escapeHtml(
          b.booked_by_name
        )} · ${escapeHtml(b.booked_by_email)}</div>
      </td></tr>`
    )
    .join('');

  const plain = bookings
    .map(b => `${slotsLabel(b.slots)}\n  ${b.type} — ${b.name}\n  ${b.description}\n  ${b.booked_by_name} <${b.booked_by_email}>`)
    .join('\n\n');

  const count = `${bookings.length} shoot${bookings.length === 1 ? '' : 's'}`;

  return sendMail({
    subject: `Today's schedule — ${count} on ${prettyDate(dateKey)}`,
    text: `${count} booked for ${prettyDate(dateKey)}.\n\n${plain}\n`,
    html: layout({
      accentLabel: "Today's schedule",
      heading: prettyDate(dateKey),
      bodyNote: `${count} booked today.`,
      cardsHtml: cards,
      footNote: 'Daily schedule digest from the Zetu Studio booking system.'
    })
  });
}

// ── Daily digest scheduler ──────────────────────────────────────────────────
// A plain timer rather than a cron dependency. Re-arms after every run and
// survives clock drift by recomputing the delay each time.

let digestTimer = null;

function msUntilNextDigest(now = new Date()) {
  const [hh, mm] = String(config.DAILY_DIGEST_TIME).split(':').map(Number);
  const hour = Number.isInteger(hh) && hh >= 0 && hh < 24 ? hh : 7;
  const minute = Number.isInteger(mm) && mm >= 0 && mm < 60 ? mm : 0;

  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  return next.getTime() - now.getTime();
}

function startDigestScheduler() {
  if (!config.DAILY_DIGEST_ENABLED) return null;
  if (digestTimer) return digestTimer;

  const schedule = () => {
    const delay = msUntilNextDigest();

    digestTimer = setTimeout(async () => {
      try {
        await sendDailyDigest();
      } catch (err) {
        console.error('Daily digest failed:', err.message);
      }
      schedule(); // re-arm for tomorrow
    }, delay);

    // Never hold the process open just for the digest.
    if (digestTimer.unref) digestTimer.unref();
  };

  schedule();

  const hours = (msUntilNextDigest() / 3600000).toFixed(1);
  console.log(`✓ Daily digest scheduled for ${config.DAILY_DIGEST_TIME} (in ${hours}h)`);
  return digestTimer;
}

function stopDigestScheduler() {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }
}

module.exports = {
  notifyBookingCreated,
  notifyBookingCancelled,
  sendDailyDigest,
  startDigestScheduler,
  stopDigestScheduler,
  msUntilNextDigest,
  prettyDate
};
