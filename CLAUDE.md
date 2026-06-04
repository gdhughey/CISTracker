# CISTracker — CLAUDE.md

Equipment checkout and inventory tracking system for a cyber lab / classroom environment.

---

## Project Layout

```
/opt/CISTracker/
├── server.js                    # Express app entry point
├── src/
│   ├── config.js
│   ├── db/
│   │   ├── connection.js        # better-sqlite3 singleton
│   │   └── migrate.js           # runs migrations in order
│   ├── routes/
│   │   ├── admin.js
│   │   ├── auth.js
│   │   ├── equipment.js
│   │   ├── inventoryAudit.js
│   │   ├── passkey.js
│   │   ├── queue.js
│   │   ├── serviceTickets.js
│   │   └── tickets.js
│   ├── services/
│   │   ├── auditService.js
│   │   ├── broadcastService.js
│   │   ├── categoryService.js
│   │   ├── emailService.js
│   │   ├── equipmentService.js
│   │   ├── equipmentUnitService.js
│   │   ├── inventoryAuditService.js
│   │   ├── mfaService.js
│   │   ├── modelService.js
│   │   ├── passkeyService.js
│   │   ├── profanityService.js
│   │   ├── queueService.js
│   │   ├── reminderService.js
│   │   ├── reservationService.js
│   │   ├── serviceTicketService.js
│   │   ├── sessionService.js
│   │   ├── ticketService.js
│   │   └── userService.js
│   └── utils/
│       └── sanitize.js
├── public/
│   ├── index.html
│   └── js/
│       ├── app.js               # ~362KB single-file SPA frontend (ALL UI lives here)
│       └── vendor/
│           ├── simplewebauthn.min.js
│           └── zxing-browser.min.js
├── migrations/                  # 30 SQL migration files, run in sequence
├── scripts/                     # one-off import/seed/maintenance scripts
├── data/
│   └── cyberlab.db              # SQLite database (production)
├── uploads/                     # multer file uploads (ticket attachments)
├── ecosystem.config.js          # PM2 process config
└── .env                         # PORT=3000, DB_PATH, APP_URL, TLS_ENABLED
```

---

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js ≥20, Express 4 |
| Database | SQLite via better-sqlite3 (sync API — no async DB calls) |
| Frontend | Vanilla JS SPA — zero build step, no bundler, no framework |
| Auth | Session cookies (`cyberlab_sid`), bcrypt, WebAuthn/passkey, TOTP MFA |
| Email | Resend API |
| QR/Barcode | qrcode (gen), zxing-browser (scan) |
| Process | PM2 (`npm start` → `node server.js`) |
| HTTPS | Let's Encrypt (Cloudflare DNS-01) + nginx reverse proxy |
| Monitoring | Prometheus node exporter + Grafana (Raspberry Pi at 10.0.2.72) |

---

## User Roles

```
student → staff → admin → owner
```

- **student** — can check out equipment, view their own checkouts
- **staff** — all student actions + manage checkouts, approve requests
- **admin** — all staff actions + manage users, equipment, inventory audits
- **owner** — all admin actions + system config, migrations, destructive ops

---

## Auth Flow

1. Page loads → `DOMContentLoaded` → `GET /api/auth/me`
2. If session valid: returns user profile, SPA renders app
3. If not: SPA renders login form
4. Cookie: `cyberlab_sid` (HttpOnly, Secure in prod)
5. Passkey (WebAuthn) supported via `@simplewebauthn/server`
6. TOTP MFA via `speakeasy`

---

## Database

- **Engine**: SQLite, synchronous (`better-sqlite3`)
- **Location**: `./data/cyberlab.db` (prod) — never `cistracker.db` in `/opt/CISTracker/` root (that's empty)
- **Migrations**: `node src/db/migrate.js` — applies files from `migrations/` in numeric order, idempotent

### Key Tables (from migrations)

| Table | Migration | Purpose |
|-------|-----------|---------|
| users | 001 | All users; roles: student/staff/admin/owner |
| items | 001 | Equipment records (canonical inventory) |
| checkouts | 001 | Active checkouts |
| passkeys | 004 | WebAuthn credentials |
| groups | 005/006 | Student groups and staff groups |
| categories | 009 | Equipment categories |
| models | 010 | Equipment models |
| service_tickets | 012 | Hardware damage/service requests |
| inventory_audits | 013 | Periodic inventory check records |
| equipment_units | 019 | Individual serialized units per item |
| reservations | (022+) | Period-based checkout reservations (AM/PM/all-day) |
| storage_locations | 026 | v2 storage location system |
| word_blacklist | 030 | Profanity filter wordlist |
| group_keys | 035 | Group enrollment keys |

---

## Key Behaviors & Invariants

### Dedupe
- `POST /api/equipment` returns **409** on duplicate barcode (not silent insert)
- `serviceTickets` approve path surfaces duplicates as 409
- Service-level dedupe kept for scan flow only

### Promise.all in `showApp()`
- `showApp()` calls badge loaders and `loadItems` in `Promise.all`
- Badge loaders individually catch errors; `loadItems` equipment fetch is a single point of failure
- Admin/owner load additional badge promises — a failure there cascades and can block app init

### Reservations
- Period-based: AM / PM / all-day slots
- Configurable auto-return times
- Lives in `reservationService.js`

### Group Keys (migration 035)
- Groups have join keys (`group_keys` table)
- Students use a key to enroll in a group
- See `cistracker_group_key_patch.py` in `/home/cisadmin/` for patching history

---

## File Permissions (Critical)

Files are split between two owners — watch for permission errors:

| Owner | Files |
|-------|-------|
| `root:root` (rw-r-----) | `app.js`, `CLAUDE.md`, `server.js`, `install-cistracker.sh`, `migrate_optiplex.py` |
| `cistracker:cistracker` (rw-rw----) | migrations, services, routes, scripts, `.env`, `ecosystem.config.js` |

**cisadmin cannot read root-owned files directly.** Use `sudo cat` or `sudo grep` when reading `app.js` or `CLAUDE.md`. The process runs as the `cistracker` user.

---

## Running the App

```bash
# Production (PM2 — already running)
pm2 status
pm2 logs cistracker

# Dev / watch mode
cd /opt/CISTracker && npm run dev   # node --watch server.js

# Run migrations
cd /opt/CISTracker && npm run migrate

# Check what's listening
ss -tlnp | grep 3000
```

---

## Deployments

**Always broadcast a 5-minute warning before deploying to production.**

```bash
# Example broadcast (adjust to your broadcast mechanism)
# Notify users: "CISTracker restarting in 5 minutes for maintenance"
pm2 restart cistracker
```

Do NOT skip the warning. Users lose unsaved checkout state on restart.

---

## Common Debugging Patterns

```bash
# Read app.js (root-owned — needs sudo)
sudo grep -n "functionName\|keyword" /opt/CISTracker/public/js/app.js

# Check DB directly
sqlite3 /opt/CISTracker/data/cyberlab.db ".tables"
sqlite3 /opt/CISTracker/data/cyberlab.db "SELECT * FROM users LIMIT 5;"

# Check PM2 logs
pm2 logs cistracker --lines 100

# Check nginx
sudo nginx -t
sudo systemctl status nginx

# Check active sessions
sqlite3 /opt/CISTracker/data/cyberlab.db "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 10;"
```

---

## Known Bugs & Past Incidents

- **2026-05-18**: Silent dedupe on `POST /api/equipment` — fixed, now returns 409
- **2026-05-19**: `serviceTickets` approve path had same silent dedupe — fixed, now 409
- **showApp() Promise.all fragility**: outer `Promise.all` has no error handling; badge loader failure can silently block app init for admin/owner users

---

## Design Rules

- **No build step** — all frontend goes in `public/js/app.js`. No webpack, no Vite, no TypeScript.
- **Sync DB only** — `better-sqlite3` is synchronous. Never add async DB calls.
- **Frontend fix > data migration** — for UX-shaped complaints, change how the frontend represents data before touching the database.
- **Zod for validation** — input validation at route boundaries uses Zod schemas.
- **DOMPurify for output** — all user-generated content rendered to HTML goes through `isomorphic-dompurify`.

---

## Infrastructure

| Service | Location |
|---------|----------|
| CISTracker (prod) | This server, port 3000, nginx proxied |
| Domain | cistracker.net (Cloudflare) |
| TLS | Let's Encrypt, certbot with Cloudflare DNS-01, auto-renew |
| Grafana | Raspberry Pi, 10.0.2.72 |
| Prometheus | Raspberry Pi, 10.0.2.72 |
| Node exporter | This server |
