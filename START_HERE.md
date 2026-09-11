# Start here

Five minutes from zero to a running booking system.

## 1. Install Node.js

Version 18 or newer, from <https://nodejs.org>. Check it worked:

```powershell
node -v
```

## 2. Install dependencies

From the project folder — **not** from the Desktop:

```powershell
cd "C:\Users\WorkPC\Desktop\Zetu Studios"
npm install
```

## 3. Start the server

```powershell
npm start
```

You should see:

```
✓ Database connected at ...\data\zetu.db
✓ Database initialized
Zetu Studio Booking System running on http://localhost:5000
  environment: development
  notifications: disabled (SMTP_HOST/SMTP_USER/SMTP_PASS not set)
```

On the very first start it also prints the **super admin password** in a box.
Copy it — it is shown once and never again.

## 4. Open it

Go to <http://localhost:5000> and sign in.

| Account | Email | Password |
| --- | --- | --- |
| Super admin | `zetustudios@shopzetu.com` | printed once at first start |
| Demo admin | `admin@zetustudio.com` | `admin123` |

Change both before anyone else can reach the system — see
[DEPLOYMENT.md](DEPLOYMENT.md).

## 5. Check it works

```powershell
npm test          # 77 tests, against a temporary database
npm run doctor    # check the real database for inconsistent data
```

## 6. Turn on email notifications (optional)

Bookings, cancellations and a daily schedule digest can email
`zetustudios@shopzetu.com`. Copy `.env.example` to `.env`, fill in the four
`SMTP_*` values, then:

```powershell
npm run mail:test
```

Full instructions, including how to get a Google App Password:
[NOTIFICATIONS.md](NOTIFICATIONS.md). Until it is configured, everything else
works normally and skipped messages are logged.

---

## If something goes wrong

| Symptom | Fix |
| --- | --- |
| `Could not read package.json` | You are in the wrong folder. `cd "C:\Users\WorkPC\Desktop\Zetu Studios"` first. |
| `npm: command not found` | Node.js is not installed or not on PATH. |
| `EADDRINUSE` / port in use | `$env:PORT=3001; npm start` |
| `Cannot reach the server` toast | The server is not running. `npm start`. |
| `Too many sign-in attempts` | The rate limiter, working as intended. Wait 15 minutes, or restart the server to clear it. |
| Lost the super admin password | See "The password" in [NOTIFICATIONS.md](NOTIFICATIONS.md). |
| `npm install` fails building sqlite3 | You need build tools for native modules, or a Node version with a prebuilt sqlite3 binary. |

## Where to go next

1. [QUICKSTART.md](QUICKSTART.md) — feature tour and customisation
2. [NOTIFICATIONS.md](NOTIFICATIONS.md) — roles, permissions and email
3. [DEPLOYMENT.md](DEPLOYMENT.md) — putting it online safely
4. [README.md](README.md) — full reference
