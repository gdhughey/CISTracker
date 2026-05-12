# CLAUDE.md

This file is the orientation doc for any Claude session opening the CISTracker repo. Read it before making changes — it captures the deployed state, conventions, and traps that aren't obvious from skimming the source.

---

## What this is

**CISTracker** is a self-hosted equipment checkout & inventory tracker for a high-school CyberLab. Single Node.js process backed by SQLite, served over HTTPS via nginx. Used in production; ~7,600 inventory items across 6 physical locations.

Deployed at: **https://cistracker.net**

---

## Live deployment

| Thing | Value |
|---|---|
| Server hostname | `inventory` (10.0.2.127 on the LAN) |
| Server user | `gdhughey` |
| App path | `/opt/CISTracker` |
| systemd unit | `cistracker.service` |
| Database file | `/opt/CISTracker/data/cyberlab.db` (SQLite) |
| Public URL | https://cistracker.net (nginx on 443 → port 3000) |
| Node version | 20 |
| Remote SSH | `ssh -p 2222 gdhughey@<tailscale-ip>` |

**Deploy command (always this, never re-install):**
```bash
cd /opt/CISTracker && sudo -u cistracker git pull origin main && sudo systemctl restart cistracker
```

**Force deploy (if pull fails):**
```bash
cd /opt/CISTracker && sudo -u cistracker git fetch origin && sudo -u cistracker git reset --hard origin/main && sudo systemctl restart cistracker
```

The DB filename is `cyberlab.db` for legacy reasons — do not rename it. Same with the `cyberlab_sid` session cookie name and `cyberlab_mfa_challenge` cookie — leave them alone.

---

## Stack

- **Backend**: Node.js 20 + Express 4
- **Database**: SQLite via `better-sqlite3` (synchronous — no async/await for queries)
- **Auth**: bcrypt + server-side sessions + HttpOnly cookies + TOTP MFA + WebAuthn passkeys
- **CSRF**: double-submit cookie pattern (`csrf_token` cookie + `X-CSRF-Token` header)
- **Headers**: `helmet` with strict CSP (allows `unpkg.com` for CDN scripts)
- **QR scanner**: `@zxing/browser` from CDN (NOT jsQR — breaks iOS Safari camera after 1 sec)
- **Reverse proxy / TLS**: nginx on port 443; Cloudflare DNS + Cloudflare global API key for certbot DNS-01 challenge
- **Remote access**: Tailscale (SSH on port 2222)
- **Process supervisor**: systemd

Frontend is **vanilla JS, no framework, no build step**. `public/js/app.js` is a single ~4,300-line file. CSS is one `app.css` file. Every interactive button uses inline `onclick=` (this is why CSP allows `'unsafe-inline'` for `script-src-attr` only).

---

## File layout

```
/
├── server.js                          # Express setup, mounts routes, runs migrations on boot
├── package.json
├── .env                               # NOT in git — see .env.example for keys
├── install-cistracker.sh              # canonical installer (systemd + nginx TLS + certbot + tailscale)
│
├── migrations/
│   ├── 001-initial.sql                # users, sessions, equipment, checkout_log, audit_log
│   ├── 002-queue-tickets.sql          # equipment_queue, tickets + equipment.location text col
│   ├── 003-due-date.sql               # equipment.due_date
│   ├── 004-passkeys.sql               # passkeys table (WebAuthn)
│   ├── 005-locations-student-group.sql # locations table + users.student_group
│   ├── 006-staff-group.sql            # staff role
│   ├── 007-seed-locations.sql         # seed locations from equipment.location text
│   ├── 008-ticket-attachments.sql     # ticket image paths
│   ├── 009-categories.sql             # categories table
│   ├── 010-models.sql                 # models table
│   ├── 011-location-fk.sql            # equipment.location_id FK
│   ├── 012-service-tickets.sql        # service_tickets table
│   ├── 013-inventory-audit.sql        # inventory_audits + audit_entries tables
│   ├── 014-seed-categories.sql        # seed categories from equipment data
│   ├── 015-seed-models.sql            # seed models, backfill model_id + location_id
│   ├── 016-equipment-quantity.sql     # equipment.quantity column
│   ├── 017-reseed-locations.sql       # re-seed locations from free-text values
│   ├── 018-checklist-audit.sql        # inventory_audits.type + audit_entries.verified
│   ├── 019-equipment-units.sql        # equipment_units table (per-unit serial/barcode)
│   ├── 020-quantity-checkout.sql      # equipment.checked_out_count for partial bulk checkouts
│   └── 021-audit-location.sql        # audit_entries.location_id + inventory_audits.scope_location_id
│
├── src/
│   ├── config.js
│   ├── db/
│   │   ├── connection.js              # better-sqlite3, WAL mode, FK on
│   │   └── migrate.js                 # auto-runs all migrations on boot
│   ├── middleware/
│   │   ├── auth.js, csrf.js, helmet.js, rateLimit.js, validate.js, audit.js, error.js
│   ├── routes/
│   │   ├── auth.js                    # login, logout, MFA, passkeys, change-pw, forgot-pw
│   │   ├── equipment.js               # inventory CRUD, checkout/checkin, units, mass cart
│   │   ├── admin.js                   # users CRUD, audit log, overdue, locations, categories, models
│   │   ├── queue.js                   # waitlist
│   │   ├── tickets.js                 # IT support tickets
│   │   ├── serviceTickets.js          # service request tickets (account changes, equipment requests)
│   │   ├── inventoryAudit.js          # inventory audits (checklist + manual)
│   │   └── passkey.js                 # WebAuthn register/verify/login
│   ├── services/
│   │   ├── equipmentService.js
│   │   ├── equipmentUnitService.js    # per-unit serial/barcode CRUD
│   │   ├── inventoryAuditService.js   # audit create/populate/entries/close
│   │   ├── serviceTicketService.js
│   │   ├── categoryService.js, modelService.js
│   │   ├── userService.js, sessionService.js, mfaService.js, passkeyService.js
│   │   ├── emailService.js, reminderService.js
│   │   ├── ticketService.js, queueService.js, auditService.js
│   └── utils/sanitize.js
│
└── public/
    ├── index.html                     # all views in one HTML file
    ├── css/app.css                    # IBM Plex Sans/Mono, dark theme CSS vars
    └── js/app.js                      # entire SPA (~4,300 lines)
```

---

## Database schema essentials

```
users              id, username, email, password_hash, role, mfa_enabled, mfa_secret,
                   must_change_pw, failed_logins, locked_until, recovery_token,
                   recovery_expires, created_at, updated_at

sessions           id (hex), user_id (FK CASCADE), ip_address, user_agent,
                   created_at, last_seen, expires_at

equipment          id, name, type, serial_number, barcode (CIS-NNNNNN), category, status,
                   checked_out_by, checked_out_at, due_date, image_path, notes,
                   location (free text, legacy), location_id (FK → locations),
                   quantity (default 1), checked_out_count (partial checkout tracking),
                   model_id (FK → models), created_at, updated_at

equipment_units    id, equipment_id (FK CASCADE), serial_number, barcode, notes, created_at
                   -- Per-unit rows for qty>1 items. Each unit gets its own CIS barcode + serial.

checkout_log       id, equipment_id, action ('checkout'|'checkin'), performed_by,
                   checkout_user, notes, source, image_path, created_at

audit_log          id, user_id (FK NULL on user delete — NOT cascade), action, target,
                   ip_address, user_agent, details (JSON), created_at

locations          id, name (unique), description, created_at

categories         id, name (unique), created_at

models             id, name, category_id, created_at

service_tickets    id, type, requester_id, status, payload (JSON), admin_notes, created_at

equipment_queue    id, equipment_id, user_id, position, joined_at

tickets            id, user_id, assigned_to, equipment_id, subject, description,
                   status, priority, created_at, updated_at

ticket_comments    id, ticket_id, user_id, body, created_at

passkeys           id, user_id (FK CASCADE), credential_id (unique), public_key,
                   counter, transports, device_name, backed_up, created_at, last_used_at

inventory_audits   id, created_by (FK → users), notes, type ('manual'|'checklist'),
                   status ('open'|'closed'), scope_location_id (FK → locations, optional),
                   created_at, closed_at

audit_entries      id, audit_id (FK CASCADE), model_id, category_id, item_name,
                   expected_qty, counted_qty, notes, verified (0/1),
                   location_id (FK → locations), created_at
```

**Critical trap:** `audit_log.user_id` is NOT `ON DELETE CASCADE`. When deleting a user, you must `UPDATE audit_log SET user_id = NULL WHERE user_id = ?` first or the delete fails on a FK constraint. See `userService.deleteUser` for the working pattern.

---

## Auth flow notes

- **Password login**: `POST /api/auth/login` → optionally returns `MFA_REQUIRED` → `POST /api/auth/mfa-verify` → session cookie
- **Passkey login**: `POST /api/passkey/login-options` → WebAuthn → `POST /api/passkey/login-verify` → session cookie
- **Lockout**: `loginLimiter` is a no-op shim. `failed_logins`/`locked_until` columns exist for forensics but are never enforced. Don't add code that reads them.
- **Session timeouts**: idle = 15 min (sliding), absolute = 8 h from creation. Enforced in `sessionService.lookup`.
- **CSRF**: every state-changing request needs `X-CSRF-Token` header = `csrf_token` cookie value. The frontend `api()` helper does this automatically.

---

## Frontend conventions

- **No build step.** Edit `app.js`, `git push`, `git pull` on server, restart. That's the entire deploy.
- `esc()` for any user string going into `innerHTML`. Never concatenate raw user data into HTML.
- `api(path, { method, body })` is the only way to call the server. Auto-includes CSRF header. Redirects to `/` on 401 (session expired).
- `toast(msg, 'success'|'error'|'info')` for notifications.
- Sidebar nav: `<div class="nav-item" data-view="X" onclick="switchView('X')">` — `switchView` hides all `[id^="view-"]`, shows the match, calls `loadX()`, starts the 90s live-refresh interval.
- **Live refresh**: `VIEW_REFRESH` map in app.js maps each view name to its reload function. `startRefreshInterval()` / `stopRefreshInterval()` manage a 90s `setInterval`. `visibilitychange` triggers an immediate reload + restarts interval on tab return.
- onclick parameter escaping: when building HTML strings with onclick attrs, NEVER use `JSON.stringify()` on values that go inside double-quoted attrs — it wraps them in extra double-quotes. Use manual escaping or `esc()` + template literal single-quotes.

---

## Inventory / Equipment features (current state)

### Quantity + per-unit tracking
- Each `equipment` row has a `quantity` field. Items with qty=1 are "single items"; qty>1 are "bulk items."
- Bulk items have `equipment_units` child rows — each unit has its own `serial_number` and `barcode` (CIS-NNNNNN).
- `checked_out_count` tracks how many units of a bulk item are currently checked out. Status stays `available` until all units are out; shows in the inventory "Out" filter when `checked_out_count > 0`.
- The detail panel renders all units for bulk items with per-unit Check Out button.

### Mass checkout cart
- Any available item gets a 🛒 button. Cart is a floating FAB showing count.
- Cart supports up to 50 items. Batch checkout via `POST /api/equipment/checkout/batch`.

### Mass return cart
- A parallel return cart for bulk-returning checked-out items.

### Location + category filter chips
- Inventory view has location chips and category chips — selecting one filters the table.
- Location chips are built from `locations` table + free-text `equipment.location` fallback for items not linked to a managed location.

---

## Inventory Audit features (current state)

### Two audit types
- **Manual**: add items one by one as you count.
- **Checklist**: auto-populates all inventory items (or scoped to one location). Progress bar, verify/count/reason per row.

### Checklist by location (migration 021)
- Start Audit modal has an optional location scope picker. Blank = all locations.
- `scope_location_id` stored on `inventory_audits`; audit header shows scope badge.
- Each `audit_entries` row has `location_id` (from `equipment.location_id` at populate time).
- Checklist renders **location section headers** grouping items (sticky headers, item count).
- **Location filter chips** let you jump to / filter a single location. Works in combination with status chips (All / Unchecked / Match / Discrepancy).

### Audit history
- Closed audits shown as cards in "Past Audits." Each card shows entry count, date, creator, notes.
- Edit notes and delete available on open and closed audits.

---

## Problems we've solved (bug history)

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Empty checkout modal | `statusFilter` excluded bulk items with partial checkouts | Fixed filter: bulk items appear in 'Out' filter when `checked_out_count > 0` |
| Unit checkout button broken | `JSON.stringify()` in onclick attr double-quoted params | Manual HTML escaping instead of `JSON.stringify()` |
| Location/category chip filter broken | `JSON.stringify()` in `data-` attributes inside double-quoted HTML | Same root cause — escaped manually |
| Checklist audit broken | Duplicate `auditHistoryList` div in HTML | Removed duplicate div |
| Production 502 on restart | nginx proxied requests during the ~2s app startup window | Not a bug — just timing; normal |
| Page "bugs out" after idle | Stale data + potential CSRF drift + no 401 handling | Live refresh: 90s poll + visibilitychange + 401→redirect |

---

## Recent feature timeline (most recent first)

1. **Live refresh + audit by location** — 90s auto-refresh, tab-visibility refresh, 401 redirect; checklist audit groups by location with section headers, location filter chips, optional scope picker in Start Audit modal. (migration 021)
2. **Per-unit checkout** — Check Out button per unit in detail panel, unit picker in bulk checkout modal, quantity-aware checkout logic. (migrations 019-020)
3. **Mass return cart** — select multiple checked-out items and return them at once.
4. **Mass checkout cart** — 🛒 button on available items, floating FAB, batch checkout up to 50 items.
5. **Checklist audit** — pre-populates all inventory as a checklist, progress bar, verify/count/reason per row, filter by status. (migration 018)
6. **Inventory audit system** — manual and checklist audit types, audit history, edit/delete. (migration 013)
7. **Service tickets** — account change requests, equipment requests, admin approve/reject. Email notifications on new ticket.
8. **Equipment units** — per-unit serial/barcode for qty>1 items, seeded from CIS Spring 2026 inventory sheets.
9. **Inventory quantity** — `quantity` column on equipment, Qty column in table, per-serial rows in add-item modal.
10. **Location filter chips** — location chips in inventory view built from `locations` table. (migration 017 re-seeded locations)
11. **Location FK on equipment** — `equipment.location_id` links to managed `locations` table. (migration 011)
12. **Models + categories tables** — managed lookup tables for equipment classification. (migrations 009-010, 014-015)
13. **WebAuthn passkeys** — Face ID, Touch ID, Windows Hello, security keys. iCloud/Google passkeys sync across devices.
14. **Login lockout removed** — both IP rate limit and per-account lockout are gone (user got locked out of their own server).
15. **LAN-only HTTPS** — replaced Cloudflare Tunnel with nginx TLS, Tailscale for remote SSH on port 2222.
16. **First-time onboarding tour** — localStorage-gated walkthrough. `replayTour()` on window to re-run.

---

## Things to NOT do

- ❌ **Don't add a build step.** No webpack, vite, esbuild, TypeScript, React. Edit → push → restart.
- ❌ **Don't rename the session cookie or DB file.** `cyberlab_sid`, `cyberlab.db`, `cyberlab_mfa_challenge` are baked into existing data.
- ❌ **Don't use JSON.stringify() for onclick parameters** in dynamically generated HTML strings. It wraps values in double quotes which breaks HTML attribute parsing. Use `esc()` + single-quoted JS strings.
- ❌ **Don't hardcode personal email addresses** — use env vars (`RESEND_SUPPORT_FORWARD`, `RESEND_DROPPED_FORWARD`).
- ❌ **Don't replace ZXing** with raw `getUserMedia` + `jsQR`. ZXing is the only thing that works cross-browser on iOS Safari.
- ❌ **Don't add user-facing "CyberLab"** branding. The app is "CISTracker."
- ❌ **Don't skip migrations.** Name them sequentially (`022-something.sql`) and they auto-run on boot.
- ❌ **Don't amend or force-push.** The server deploys blindly with `git pull` — rewritten history breaks the working tree.

---

## Things to DO

- ✅ Use `req.audit('action_name', target, { details })` for any privileged action.
- ✅ Use zod schemas via `validate(schema)` middleware for any new POST/PUT body.
- ✅ When deleting a user, `UPDATE audit_log SET user_id = NULL` first. See `userService.deleteUser`.
- ✅ Run `node --check <file>` on each modified backend file before committing. No CI — syntax errors go straight to prod.
- ✅ `better-sqlite3` is synchronous. Never use async/await for DB calls.
- ✅ When in doubt about UI patterns, grep `app.js` for a similar feature.

---

## Known shortcuts / intentional choices

- One big `app.js` — intentional. The user explicitly wants it. Don't refactor into modules.
- Every mutation re-fetches from server (`loadItems()` etc.) — intentional. No optimistic updates. Simpler and LAN latency is fine.
- Inline `onclick=` everywhere — refactoring to `addEventListener` would tighten CSP but isn't worth the diff.
- `failed_logins` / `locked_until` columns stay in schema for forensics even though nothing reads them.

---

## Useful `.env` keys

```
SESSION_SECRET=          # 64 random bytes, REQUIRED
APP_URL=https://cistracker.net
TLS_ENABLED=true
DB_PATH=./data/cyberlab.db
SEED_ADMIN_PASSWORD=     # leave empty to auto-generate on first seed
RESEND_API_KEY=          # for email (service tickets, forgot-pw, dropped-ticket alerts)
RESEND_FROM=             # sender address
RESEND_SUPPORT_FORWARD=  # where new IT tickets get forwarded
RESEND_DROPPED_FORWARD=  # where dropped-without-resolve tickets get forwarded
```

---

## Operator commands

```bash
# Deploy
cd /opt/CISTracker && sudo -u cistracker git pull origin main && sudo systemctl restart cistracker

# Force deploy
cd /opt/CISTracker && sudo -u cistracker git fetch origin && sudo -u cistracker git reset --hard origin/main && sudo systemctl restart cistracker

# Tail logs
sudo journalctl -u cistracker -f
sudo journalctl -u cistracker -n 50 --no-pager

# Check migrations applied
sudo journalctl -u cistracker -n 20 --no-pager | grep -i migrat

# Inspect DB
sudo sqlite3 /opt/CISTracker/data/cyberlab.db
# .tables  /  SELECT * FROM inventory_audits;  etc.

# npm install (only if package-lock changed)
cd /opt/CISTracker && sudo -u cistracker npm install
```

---

## When the user says...

| They say | They mean |
|---|---|
| "deploy" / "push it" | I commit + push to main; they run the deploy command on the server |
| "the server" | Ubuntu box at /opt/CISTracker, accessed via Tailscale SSH |
| "the app" | https://cistracker.net |
| "the inventory" | The `equipment` table (~7,600 rows) |
| "tickets" | IT support ticket system (`tickets` + `ticket_comments`) |
| "service tickets" | Service request tickets (`service_tickets`) |
| "audit" | Inventory audit system (`inventory_audits` + `audit_entries`) |
| "build it" | Implement, commit, push. They'll deploy. |
| "do it dont ask for permission" | Proceed with all tool calls and edits autonomously |
