# CISTracker

Self-hosted equipment checkout & inventory tracker.

Runs as a single Node.js process backed by SQLite, with QR-code scanning for fast check-in/out. Designed to be deployed on a dedicated Ubuntu server inside a school network, served over HTTPS via nginx with a locally-trusted certificate, and reached remotely via Tailscale SSH.

## Stack

- **Runtime:** Node.js 20 + Express 4
- **Database:** SQLite (better-sqlite3)
- **Auth:** bcrypt + server-side sessions + HttpOnly cookies + TOTP MFA + WebAuthn passkeys
- **CSRF:** double-submit cookie pattern
- **Headers:** helmet (CSP, HSTS when TLS is enabled)
- **QR scanner:** `@zxing/browser` (camera-based, works on iOS Safari over HTTPS)
- **Passkeys:** `@simplewebauthn/server` + `@simplewebauthn/browser` (Face ID / Touch ID / Windows Hello / hardware keys)
- **Email:** Resend (transactional notifications + ticket forwarding)
- **Reverse proxy / TLS:** nginx on port 443 with an `mkcert`-issued local CA cert; clients add a DNS override so `cistracker.net` resolves to the server's LAN IP
- **Remote access:** Tailscale (SSH on port 2222)
- **Process manager:** systemd

## Install on Ubuntu

```bash
curl -fsSL https://raw.githubusercontent.com/gdhughey/CISTracker/main/install-cistracker.sh | sudo bash
```

> **Air-gapped / school-network install?** If the target server can't reach GitHub or npm, see [`docs/OFFLINE-INSTALL.md`](docs/OFFLINE-INSTALL.md) — build a single tarball at home, copy it via USB, run one script on the server.

The installer:

1. Creates a system user and clones the repo to `/opt/CISTracker`
2. Generates a fresh `.env` with a random `SESSION_SECRET`
3. Runs all migrations and seeds the admin user (random password printed once)
4. Registers a `cistracker.service` systemd unit
5. Installs nginx with an mkcert-issued cert covering the configured hostnames
6. Sets up Tailscale for remote access on port 2222 (you'll be prompted to authenticate)

Re-running the installer updates the app in place while preserving the database, uploads, and `.env`.

### Accessing the public hostname

`cistracker.net` is served only on the LAN. Devices that should reach it add a DNS override:

- **Windows**: append `<server-LAN-IP>  cistracker.net` to `C:\Windows\System32\drivers\etc\hosts`
- **macOS / Linux**: append the same line to `/etc/hosts`
- **iOS / Android**: a small profile / DNS app does the trick (or join Tailscale and use MagicDNS)

The mkcert root CA must be installed on each client device once so the browser trusts the cert. After that, https://cistracker.net works exactly like a public site — including the camera-required APIs (QR scanning, WebAuthn passkeys).

### Remote SSH

The server is reachable via Tailscale on port 2222:

```bash
ssh -p 2222 gdhughey@<tailscale-host-or-ip>
```

No port forwarding required — Tailscale's WireGuard mesh handles the routing.

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

> **Note on passkeys in dev:** WebAuthn requires either `localhost` or HTTPS, and the relying-party ID is derived from `APP_URL`. For local dev keep `APP_URL=http://localhost:3000` — passkeys registered against `localhost` won't work against `cistracker.net` and vice versa.

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
- Sessions stored server-side, looked up by `HttpOnly` + `SameSite=Strict` cookie
- Idle timeout (15 min default) and absolute timeout (8 h default) both enforced
- CSRF protection via double-submit cookie pattern
- API rate limiting (100 req / min)
- Helmet security headers + strict CSP (HSTS on when `TLS_ENABLED=true`)
- TOTP MFA available per user
- WebAuthn passkeys for password-less sign-in (one passkey per browser/device, syncs cross-device on Apple/Google ecosystems)
- Every security-relevant action written to `audit_log`
- Service runs as an unprivileged user, not root

> **Note:** the per-account login lockout was deliberately removed. The `failed_logins` and `locked_until` columns remain in the schema for forensic reasons but are not enforced. Passkeys + bcrypt's natural slowness (≈ 100 ms / hash at cost 12) are considered sufficient for a school-LAN deployment.

## Useful endpoints

| Path | Auth | Notes |
|---|---|---|
| `GET /healthz`                      | none  | Plain JSON `{ ok: true }` |
| `GET /api/equipment`                | user  | All inventory |
| `GET /api/equipment/lookup?code=…`  | user  | Resolve a barcode/serial to an item (used by the QR scanner) |
| `POST /api/equipment/:id/checkout`  | user  | Admins can pass `for_user_id` for kiosk mode |
| `GET /api/admin/users`              | admin | User management (CRUD + email change + password reset) |
| `GET /api/admin/audit`              | admin | Recent audit entries |
| `GET/POST/DELETE /api/passkey[/:id]`| user  | Manage your own passkeys |
| `POST /api/passkey/login-options`   | none  | Start a WebAuthn sign-in flow |
| `POST /api/passkey/login-verify`    | none  | Complete it; creates a session on success |
| `POST /api/tickets`                 | user  | File a support ticket; forwards to `RESEND_SUPPORT_FORWARD` |

## Configuration reference (`.env`)

Bare minimum:

| Key | Notes |
|---|---|
| `SESSION_SECRET` | 64 random bytes, **required**. The installer generates one. |
| `APP_URL`        | Used as the WebAuthn origin and in the boot banner |
| `DB_PATH`        | Default `./data/cyberlab.db` (legacy filename — leave alone in production) |
| `TLS_ENABLED`    | `true` once nginx is terminating TLS in front of the app |

Optional:

| Key | Notes |
|---|---|
| `RESEND_API_KEY`            | Without this, all outbound mail is logged + skipped (app still works) |
| `RESEND_SUPPORT_FORWARD`    | Where new tickets get forwarded |
| `RESEND_DROPPED_FORWARD`    | Where "ticket dropped without resolution" alerts go |
| `SEED_ADMIN_PASSWORD`       | Leave blank to auto-generate a strong password on first seed |

## Operator commands

Quick reference for the deployed server:

```bash
# Deploy a new commit
cd /opt/CISTracker
sudo git pull origin main
sudo npm install            # only if package-lock changed
sudo systemctl restart cistracker

# Tail logs
sudo journalctl -u cistracker -f

# Inspect the database
sudo sqlite3 /opt/CISTracker/data/cyberlab.db
```

## License

Private project — no license granted.
