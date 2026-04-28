# CISTracker

Self-hosted equipment checkout & inventory tracker.

Runs as a single Node.js process backed by SQLite, with QR-code scanning for fast check-in/out. Designed to be deployed on a dedicated Ubuntu server inside a school network and (optionally) exposed publicly via a Cloudflare Tunnel.

## Stack

- **Runtime:** Node.js 20 + Express 4
- **Database:** SQLite (better-sqlite3)
- **Auth:** bcrypt + server-side sessions + HttpOnly cookies + TOTP MFA
- **CSRF:** double-submit cookie pattern
- **Headers:** helmet (CSP, HSTS, etc.)
- **QR scanner:** `@zxing/browser` (camera-based, works on iOS Safari)
- **Email:** Resend (transactional + ticket forwarding)
- **Reverse proxy / TLS:** Cloudflare Tunnel (or nginx if running on-prem only)
- **Process manager:** systemd

## Install on Ubuntu

```bash
curl -fsSL https://raw.githubusercontent.com/gdhughey/CISTracker/main/install-cistracker.sh | sudo bash
```

The installer creates a system user, clones the repo to `/opt/CISTracker`, generates a fresh `.env` with a random `SESSION_SECRET`, runs migrations, seeds the admin (random password printed once), registers a `cistracker.service` systemd unit, and optionally installs `cloudflared` for the public tunnel.

Re-running the installer updates the app in place while preserving the database, uploads, and `.env`.

### Cloudflare Tunnel

Set `CLOUDFLARED_TOKEN` in `/opt/CISTracker/.env` (token is from the Cloudflare Zero Trust dashboard) and the installer wires up `cloudflared.service` so the box reaches the internet without any port forwarding. SSH-over-tunnel is supported via `cloudflared access ssh --hostname <host>`.

## Quick start (development)

```bash
git clone https://github.com/gdhughey/CISTracker.git
cd CISTracker
npm install
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET
npm run migrate
npm run seed
npm start
```

Open `http://localhost:3000` and log in with the seeded admin credentials. The seed script prints a random password the first time it runs.

## Inventory data import

The repo ships three seed scripts for the lab inventory:

| Script | What it does |
|---|---|
| `scripts/seed-inventory.js`    | Pages 1–3 of the Spring 2026 PDF (Northeast closet items) |
| `scripts/seed-inventory-v2.js` | Pages 29–61 (motherboards, GPUs, CPUs, RAM, storage, HP Compaq desktops, peripherals, cables) |
| `scripts/seed-inventory-v3.js` | Backfills the `location` column for everything imported by v1 + v2 |

Each is idempotent — they tag a guard row in the DB and exit early on re-run.

## Security model

- All passwords hashed with bcrypt cost 12
- Sessions stored server-side, looked up by HttpOnly + SameSite=Strict cookie
- Idle timeout (15 min default) and absolute timeout (8 h default) both enforced
- CSRF protection via double-submit cookie pattern
- Rate limiting on login (5/15min) and API (100/min)
- Helmet security headers + strict CSP
- Account lockout after 5 failed logins
- TOTP MFA available per user (admin-required for admin accounts)
- Every security-relevant action written to `audit_log`
- Service runs as an unprivileged user, not root

## Useful endpoints

| Path | Auth | Notes |
|---|---|---|
| `GET /healthz`             | none  | Plain JSON `{ ok: true }` |
| `GET /api/equipment`       | user  | All inventory |
| `GET /api/equipment/lookup?code=…` | user  | Resolve a barcode/serial to an item (used by the QR scanner) |
| `POST /api/equipment/:id/checkout` | user  | Admins can pass `for_user_id` for kiosk mode |
| `GET /api/admin/users`     | admin | User management |
| `GET /api/admin/audit`     | admin | Last 100 audit entries |
| `POST /api/tickets`        | user  | File a support ticket; forwards to `RESEND_SUPPORT_FORWARD` |

## License

Private project — no license granted.
