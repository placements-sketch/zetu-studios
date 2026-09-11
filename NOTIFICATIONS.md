# Email notifications & the Super Admin

## The Super Admin

`zetustudios@shopzetu.com` is the studio's own account and the top of the role
hierarchy:

| Role | Can do |
| --- | --- |
| `client` | Book slots, see and cancel their own bookings. |
| `admin` | Everything a client can, plus see every booking with client contact details, and cancel anyone's booking. |
| `superadmin` | Everything an admin can, plus view the user list, promote and demote admins, and remove accounts. |

Higher roles inherit every permission below them — a super admin passes every
admin check.

### What protects it

- It cannot be demoted, not even by itself.
- It cannot be deleted.
- The `superadmin` role cannot be granted through the API; it is seeded from
  `SUPER_ADMIN_EMAIL` in the configuration.
- If the role is ever changed directly in the database, the next server start
  puts it back.

### The password — handing the system to someone else

The system is designed so you never have to know your client's password.

**On a fresh install**, if `SUPER_ADMIN_PASSWORD` is not set, a strong password
is generated and printed **once** to the server log, and the account is marked
*temporary*. Whoever signs in with it is stopped at a "set your password"
screen and cannot reach the app until they choose their own.

**When handing over**, set a temporary password you can read out, and mark it
as one that must be replaced:

```powershell
npm run set-password -- zetustudios@shopzetu.com "TempHandover 2026" --must-change
```

Give them that password. On their first sign-in they are required to replace
it, and from then on only they know it.

**Changing it later**: sign in, click **Account** in the header, and use
"Change password". The panel also lets them change the display name.

**If they forget it**, you have three options, in order of preference:

1. Another super admin resets it from the **Users** tab → *Reset password*.
   A temporary password appears once, to pass along.
2. From the machine running the server:
   ```powershell
   npm run set-password -- zetustudios@shopzetu.com --must-change
   ```
   You are prompted for the password and the input is not echoed.
3. Delete the account and restart — the seed recreates it and prints a new
   temporary password:
   ```powershell
   node -e "const s=require('sqlite3');const d=new s.Database('data/zetu.db');d.run(`DELETE FROM users WHERE email='zetustudios@shopzetu.com'`,e=>console.log(e||'removed'))"
   npm start
   ```

`npm run set-password -- --list` shows every account and which ones still owe a
password change.

### Password rules

At least 8 characters, and a mix of at least two of: lowercase, uppercase,
numbers, symbols. Common choices (`password`, `admin123`, …) are refused. The
same rules run in the browser and on the server, so the form never promises
something the API will reject. A strength meter shows as you type.

### Managing users

Sign in as the super admin and open the **Users** tab. Each account shows its
role and how many bookings it holds. From there you can make someone an admin,
demote them, or remove the account.

Removing an account also removes its bookings, freeing those slots. The
confirmation says how many will go.

**Reset password** on any account generates a temporary password, shown once.
It uses an unambiguous alphabet — no `O`/`0` or `I`/`l`/`1` — and is grouped as
`xxxx-xxxx-xxxx`, so it survives being read aloud or written down. The account
is then forced to choose its own password at the next sign-in, and is tagged
**Must set password** in the list until it does.

> A role change takes effect when the affected person next signs in, because
> their role is carried in their existing token.

---

## Notifications

Three things email `zetustudios@shopzetu.com`:

| Event | Subject | Contains |
| --- | --- | --- |
| Booking created | `New booking — <type> on <date>` | Date, time range, shoot type, client name, who booked it, and the details. |
| Booking cancelled | `Cancelled — <type> on <date>` | The same, plus who cancelled it and whether it was the owner or an admin. |
| Daily digest | `Today's schedule — N shoots on <date>` | Every booking for today, in time order. Sent each morning. |

Notifications never block or break a booking. They are sent *after* the
response, and a dead mail server produces a log line, not a failed booking.
This is covered by tests.

### Setting it up (Google Workspace)

`shopzetu.com` on Google Workspace is the simplest option here: no new vendor,
and these notifications go to a single internal mailbox, so sender reputation
and DNS setup are not a concern the way they would be for mail to customers.

1. Enable 2-Step Verification on `zetustudios@shopzetu.com`.
2. Create an App Password at <https://myaccount.google.com/apppasswords>
   (choose "Mail"). You get a 16-character password.
3. Put it in `.env`:

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=zetustudios@shopzetu.com
SMTP_PASS=abcdefghijklmnop
```

4. Test it:

```powershell
npm run mail:test
```

That checks the connection, sends one real email, and explains the failure if
something is wrong.

> Use the **App Password**, not the account's normal password — Google rejects
> the latter for SMTP. Workspace admins can disable App Passwords org-wide; if
> the option is missing, that is why.

### Other providers

Only the four `SMTP_*` values change. Nothing else in the app cares.

| Provider | Host | Port | User | Password |
| --- | --- | --- | --- | --- |
| Google Workspace | `smtp.gmail.com` | 587 | the address | App Password |
| Outlook 365 | `smtp.office365.com` | 587 | the address | account or app password |
| SendGrid | `smtp.sendgrid.net` | 587 | `apikey` | the API key |
| Mailgun | `smtp.mailgun.org` | 587 | the SMTP login | the SMTP password |
| Resend | `smtp.resend.com` | 587 | `resend` | the API key |

Switch to a transactional provider if you later email *clients* rather than
just the studio — deliverability to many domains is where those earn their
keep, and Gmail's daily send cap starts to matter.

### Settings

| Variable | Default | Notes |
| --- | --- | --- |
| `SMTP_HOST` | — | Unset disables all mail. |
| `SMTP_PORT` | `587` | 465 uses implicit TLS. |
| `SMTP_USER` / `SMTP_PASS` | — | Both required. |
| `NOTIFY_EMAIL` | `SUPER_ADMIN_EMAIL` | Where notifications go. |
| `MAIL_FROM` | `SMTP_USER` | Most providers reject a From they do not own. |
| `MAIL_FROM_NAME` | `Zetu Studio Bookings` | Display name. |
| `NOTIFY_ON_BOOKING` | `true` | Set `false` to mute new bookings. |
| `NOTIFY_ON_CANCEL` | `true` | Set `false` to mute cancellations. |
| `DAILY_DIGEST_ENABLED` | `true` | Set `false` to turn the digest off. |
| `DAILY_DIGEST_TIME` | `07:00` | Server local time, `HH:MM`. |
| `APP_URL` | — | Adds an "Open the calendar" button to emails. |

### Checking it

```powershell
npm run mail:test      # verify credentials and send a test email
```

Or, signed in as the super admin:

- `GET /api/mail/status` — configuration and connection state
- `POST /api/mail/digest` — send today's digest immediately

### If mail is not configured

Everything else works normally. The server logs a warning at startup and one
line per skipped message, naming the recipient and subject, so you can see what
*would* have been sent.

### Limitations

- The digest timer lives in the server process. If the server is down at
  `DAILY_DIGEST_TIME`, that day's digest is skipped rather than sent late.
- Running several server instances means several digests and several
  notifications per event. Run one, or disable the digest on all but one.
- There is no retry. A message that fails is logged and dropped.
