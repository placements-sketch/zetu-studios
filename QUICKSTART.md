# Feature guide & customisation

Assumes the app is already running — if not, see [START_HERE.md](START_HERE.md).

## The three tabs

### Book a shoot

A month calendar. Each day shows how many of the five daily slots are still
open, and past days are greyed out and not clickable.

Click a day to open the booking panel. It offers:

- **Two-hour slots** — 09:00–11:00, 11:00–13:00, 13:00–15:00, 15:00–17:00, 17:00–19:00
- **Half day** — morning (09:00–15:00) or afternoon (13:00–19:00)
- **Full day** — 09:00–19:00

Anything that overlaps an existing booking is marked **Unavailable**, and the
server refuses it too, so two people clicking at the same moment cannot both
get the slot.

Use `‹` and `›` to move between months. Press `Esc` to close the panel.

### My bookings

Everything you have booked, split into **Upcoming** and **Past**, each card
showing the date, the time range, the shoot type and your notes. Cancel your
own bookings from here.

### Users (super admin only)

Every account, its role and how many bookings it holds. Promote trusted staff
to admin, demote them, or remove an account entirely — removing one cancels its
bookings and frees those slots.

The super admin row is marked **Protected**: it cannot be demoted or removed.

See [NOTIFICATIONS.md](NOTIFICATIONS.md) for what each role can do.

### All bookings (admin only)

Studio-wide statistics — total bookings, upcoming, this month, unique clients
and the most-booked shoot type — plus every booking on the calendar with who
made it. Filter by Upcoming / Past / All. An admin can cancel any booking.

## Accounts

Anyone can register from the sign-in screen. New accounts are **clients**: they
can book, see their own bookings and cancel their own bookings.

**Admins** additionally see the "All bookings" tab, every client's contact
details, and can cancel anyone's booking.

**The super admin** (`zetustudios@shopzetu.com`) outranks admins: it manages
users from the Users tab and receives all email notifications.

To promote someone, sign in as the super admin and use the Users tab — no
database surgery required. Full detail in [NOTIFICATIONS.md](NOTIFICATIONS.md).

### Resetting the admin password

The signed-in user can change their own password via the API:

```powershell
# while signed in, from the browser console
await api.changePassword('currentPassword', 'newPassword', 'newPassword')
```

If the admin password is lost entirely, delete the admin row and restart — the
seed will recreate it from `ADMIN_PASSWORD` in your `.env`:

```powershell
node -e "const s=require('sqlite3');const d=new s.Database('data/zetu.db');d.run(`DELETE FROM users WHERE email='admin@zetustudio.com'`,e=>console.log(e||'removed'))"
npm start
```

## Customising

### Working hours and slots

Edit `public/js/constants.js`. It is the single source of truth — the browser
loads it as a script and the server `require`s the same file, so the two can
never disagree.

```js
const SLOT_DEFS = [
  { slots: [0], label: '09:00 - 11:00' },
  ...
];
const TOTAL_SLOTS = 5;   // must match the number of SLOT_DEFS entries
```

If you change the number of slots, update `TOTAL_SLOTS` and `BLOCK_DEFS` to
match, then run `npm test`.

> Bookings already in the database store raw slot indices. Changing what an
> index means will relabel existing bookings — do it before you go live, or
> clear the bookings table afterwards.

### Shoot types

Also in `public/js/constants.js`. The server rejects any type not on this
list, so add new ones here rather than only in the UI.

### Field length limits

`LIMITS` in the same file. The UI uses them for `maxlength`, the server
enforces them.

### Colours and branding

`public/css/variables.css` holds the whole palette:

```css
--accent: #d7ff3d;   /* the lime highlight */
--void:   #071310;   /* page background */
```

`public/favicon.svg` is the tab icon. The wordmark is the `.brandmark` markup
in `public/index.html`.

## Testing

```powershell
npm test                                  # everything
node --test test/api.test.js              # API only
node --test test/validate.test.js         # validation only
```

Tests spin up the real server on a random port against a temporary database in
your temp folder, then delete it.

## Checking your data

```powershell
npm run doctor
```

Scans the database for overlapping bookings, invalid dates, unknown shoot
types, orphaned bookings and duplicate accounts. Add `-- --fix` to remove
overlaps automatically, keeping whichever booking was made first. Back up the
database before doing that.

## Data

Everything lives in `data/zetu.db`, a single SQLite file. To back up, copy that
file while the server is stopped. To reset completely, delete it and restart.
