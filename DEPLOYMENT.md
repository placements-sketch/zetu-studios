# Deployment

## Before you go live

Work through all of these. The first two are not optional.

- [ ] **Set a real `JWT_SECRET`.** The server refuses to start in production
      with the sample value, because anyone who has seen this repository could
      otherwise forge an admin session. Generate one:
      ```powershell
      npm run secret
      ```
- [ ] **Change the admin password.** Set `ADMIN_PASSWORD` in the environment
      *before the first start* (the account is seeded once), or change it
      afterwards via `/api/auth/change-password`.
- [ ] Set `NODE_ENV=production`.
- [ ] Serve over HTTPS — tokens are bearer credentials and travel in a header.
- [ ] Set `CORS_ORIGIN` to your own domain, or leave it unset for same-origin.
- [ ] Arrange backups of `data/zetu.db`.
- [ ] Set `SUPER_ADMIN_PASSWORD` *before* the first start, or copy the
      generated one from the log — it is printed only once.
- [ ] Configure SMTP and run `npm run mail:test`, or accept that no
      notifications will be sent.
- [ ] Set `APP_URL` so emails link back to the calendar.
- [ ] Run `npm test` one last time.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` when live. |
| `PORT` | `5000` | Most hosts set this for you. |
| `JWT_SECRET` | sample value | **Required in production.** Long and random. |
| `JWT_EXPIRES_IN` | `7d` | Session lifetime. |
| `DB_PATH` | `./data/zetu.db` | Put this on a persistent disk. |
| `CORS_ORIGIN` | `*` in dev, unset in prod | Comma-separated origins. |
| `ADMIN_EMAIL` | `admin@zetustudio.com` | Seeded on first run only. |
| `ADMIN_PASSWORD` | `admin123` | Change before first start. |
| `BCRYPT_ROUNDS` | `10` | Raise for more resistance to offline cracking. |
| `SUPER_ADMIN_EMAIL` | `zetustudios@shopzetu.com` | The studio account. Seeded once. |
| `SUPER_ADMIN_PASSWORD` | generated | Set before first start, or read it from the log. |
| `APP_URL` | — | Public URL; adds a button to notification emails. |
| `SMTP_HOST` / `SMTP_PORT` | — / `587` | Unset disables all mail. |
| `SMTP_USER` / `SMTP_PASS` | — | Both required. See [NOTIFICATIONS.md](NOTIFICATIONS.md). |
| `NOTIFY_EMAIL` | super admin address | Where notifications go. |
| `DAILY_DIGEST_TIME` | `07:00` | Server local time. |

Email setup, provider presets and troubleshooting:
[NOTIFICATIONS.md](NOTIFICATIONS.md).

> Run only **one** instance. The daily digest and the rate limiter both live in
> process memory, so several instances mean several digests and a weaker limit.

The server reads a `.env` file in the project root if present. Real environment
variables always take precedence.

## The persistent-disk problem

SQLite is a file. Any host with an ephemeral filesystem will silently discard
every booking on each deploy or restart. Before choosing a host, confirm it
offers a persistent volume and point `DB_PATH` at it.

## Option 1 — Render.com

1. Push the repository to GitHub.
2. New → Web Service, pointed at the repo.
3. Build command `npm install`, start command `npm start`.
4. Add a **Disk** mounted at `/data`, then set `DB_PATH=/data/zetu.db`.
   Without this your bookings vanish on every deploy.
5. Add `NODE_ENV`, `JWT_SECRET` and `ADMIN_PASSWORD` as environment variables.

## Option 2 — Railway.app

1. New Project → Deploy from GitHub.
2. Add a Volume, mount it at `/data`, set `DB_PATH=/data/zetu.db`.
3. Add the same environment variables. Railway supplies `PORT` itself.

## Option 3 — A VPS (DigitalOcean, Hetzner, …)

```bash
git clone <your-repo> /var/www/zetu
cd /var/www/zetu
npm ci --omit=dev

cat > .env <<'ENV'
NODE_ENV=production
PORT=5000
JWT_SECRET=<paste from: npm run secret>
ADMIN_PASSWORD=<a strong password>
ENV
chmod 600 .env

npm install -g pm2
pm2 start server/server.js --name zetu-booking
pm2 save
pm2 startup
```

Nginx in front:

```nginx
server {
  listen 80;
  server_name booking.zetustudio.com;

  location / {
    proxy_pass         http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

`X-Forwarded-For` matters: the sign-in rate limiter keys on the client IP, and
without it every request looks like it came from the proxy.

Then HTTPS:

```bash
sudo certbot --nginx -d booking.zetustudio.com
```

## Backups

```bash
# safe while the server runs
sqlite3 /data/zetu.db ".backup '/backups/zetu-$(date +%F).db'"
```

A nightly cron job plus off-machine copies is enough for a studio calendar.

## Monitoring

`GET /api/health` returns `200` with `{"status":"ok","database":"ok"}` when the
process is up *and* the database answers, and `503` when it does not. Point
your uptime checker at it rather than at `/`.

## Upgrading

```bash
git pull
npm ci --omit=dev
npm test
pm2 restart zetu-booking
```

Schema changes are applied automatically at startup with
`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Back up the
database file before upgrading anyway.
