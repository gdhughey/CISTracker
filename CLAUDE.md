# CLAUDE.md

This file is the orientation doc for any Claude session opening the CISTracker repo. Read it before making changes — it captures the deployed state, conventions, and traps that aren't obvious from skimming the source.

---

## What this is

**CISTracker** is a self-hosted equipment checkout & inventory tracker for a high-school CyberLab. Single Node.js process backed by SQLite, served behind a Cloudflare Tunnel. Used in production by one school; ~7,600 inventory items across 6 physical locations.

Deployed at: **https://cistracker.net**

---

## Live deployment

| Thing | Value |
|---|---|
| Server hostname | `inventory` (192.168.1.168 on the LAN) |
| Server user | `gdhughey` |
| App path | `/opt/CISTracker` |
| systemd unit | `cistracker.service` |
| Database file | `/opt/CISTracker/data/cyberlab.db` (SQLite, see `.env` `DB_PATH`) |
| Public URL | https://cistracker.net (nginx on port 443 → port 3000; DNS resolves to LAN IP) |
| Node version | 20 |
| Remote SSH | `ssh -p 2222 gdhughey@<tailscale-ip>` (requires Tailscale on your device) |

The DB filename is `cyberlab.db` for legacy reasons (renaming would orphan the prod database). Same with the `cyberlab_sid` session cookie name and `cyberlab_mfa_challenge` cookie name — leave them alone.

---

## Stack

- **Backend**: Node.js 20 + Express 4
- **Database**: SQLite via `better-sqlite3` (synchronous; no async/await for queries)
- **Auth**: bcrypt + server-side sessions + HttpOnly cookies + TOTP MFA + WebAuthn passkeys
- **CSRF**: double-submit cookie pattern (`csrf_token` cookie + `X-CSRF-Token` header)
- **Headers**: `helmet` with strict CSP (allows `unpkg.com` for CDN scripts)
- **QR scanner**: `@zxing/browser` from CDN (NOT jsQR — that broke iOS Safari camera after 1 sec)
- **Email**: Resend (transactional + ticket forwarding). NOT nodemailer (we explicitly don't depend on it; deleting it cleared the high-severity tar/node-pre-gyp CVE chain)
- **Reverse proxy / TLS**: nginx on port 443 with mkcert local CA cert; Windows DNS override resolves `cistracker.net` to the LAN IP
- **Remote access**: Tailscale (SSH on port 2222, replaces Cloudflare SSH tunnel)
- **Process supervisor**: systemd

Frontend is **vanilla JS, no framework, no build step**. `public/js/app.js` is a single ~1700-line file. CSS is one `app.css` file. Every interactive button uses inline `onclick=` (this is why CSP allows `'unsafe-inline'` for `script-src-attr` only).

---

## File layout

```
/
├── server.js                          # Express setup, mounts routes, runs migrations on boot
├── package.json                       # cistracker@1.0.0, no nodemailer/multer (those are removed)
├── .env                               # NOT in git — see .env.example for keys
├── ecosystem.config.js                # legacy pm2 config, not used (we use systemd)
├── install-cistracker.sh              # the canonical installer (creates user, clones repo, sets up systemd + cloudflared)
│
├── migrations/
│   ├── 001-initial.sql                # users, sessions, equipment, checkout_log, audit_log
│   ├── 002-queue-tickets.sql          # equipment_queue, tickets, ticket_comments + adds equipment.location
│   ├── 003-due-date.sql               # adds equipment.due_date
│   └── 004-passkeys.sql               # passkeys table for WebAuthn
│
├── scripts/
│   ├── seed.js                        # admin user seed (random pw if SEED_ADMIN_PASSWORD unset)
│   ├── seed-inventory.js              # v1: pages 1-3 of CIS Spring Inventory PDF (Northeast closet)
│   ├── seed-inventory-v2.js           # v2: pages 29-61 (motherboards, GPUs, CPUs, RAM, storage, HP Compaqs, peripherals)
│   └── seed-inventory-v3.js           # v3: backfills `location` column for v1+v2 items
│
├── src/
│   ├── config.js                      # all env-driven config in one place; required('SESSION_SECRET') throws on boot if missing
│   ├── db/
│   │   ├── connection.js              # better-sqlite3 init, foreign_keys=ON, WAL mode
│   │   └── migrate.js                 # auto-runs every migration on server boot
│   ├── middleware/
│   │   ├── auth.js                    # loadSession, requireAuth, requireRole('admin')
│   │   ├── csrf.js                    # double-submit pattern
│   │   ├── helmet.js                  # CSP allows unpkg.com for ZXing + simplewebauthn CDN
│   │   ├── rateLimit.js               # apiLimiter active; loginLimiter is a no-op shim (see "Lockout removed" below)
│   │   ├── validate.js                # zod-based body validation
│   │   ├── audit.js                   # attaches req.audit() to every request
│   │   └── error.js                   # 404 + 500 handlers
│   ├── routes/
│   │   ├── auth.js                    # login, logout, register, mfa-*, change-password, forgot-password, reset-password
│   │   ├── equipment.js               # inventory CRUD, lookup, label, checkout/checkin (admin can pass for_user_id for kiosk)
│   │   ├── admin.js                   # /api/admin/users (CRUD + email change), /api/admin/audit, /api/admin/overdue
│   │   ├── queue.js                   # waitlist for already-checked-out items
│   │   ├── tickets.js                 # support tickets w/ self-assign + drop-without-resolve email alert
│   │   └── passkey.js                 # WebAuthn register/verify/login (6 endpoints)
│   ├── services/
│   │   ├── userService.js             # bcrypt hash + verify, deleteUser does manual FK cleanup (audit_log NULL not CASCADE)
│   │   ├── sessionService.js          # idle + absolute timeout enforced
│   │   ├── equipmentService.js        # findByIdentifier dedupes by barcode/serial; checkin is IDOR-safe
│   │   ├── ticketService.js
│   │   ├── queueService.js
│   │   ├── auditService.js
│   │   ├── reminderService.js         # node-cron daily overdue reminders
│   │   ├── emailService.js            # Resend wrappers; one-and-only outbound mail surface
│   │   ├── passkeyService.js          # SQLite layer for the passkeys table
│   │   └── mfaService.js              # speakeasy TOTP + qrcode
│   └── utils/
│       └── sanitize.js                # stripHtml() via DOMPurify, escapeForSheets()
│
└── public/
    ├── index.html                     # all views in one file (login, change-pw, app layout w/ 7 views)
    ├── css/app.css                    # IBM Plex Sans/Mono, dark theme
    ├── js/app.js                      # the whole SPA
    └── images/logo.jpg                # custom logo (replaces 🛡 emoji)
```

---

## Database schema essentials

```
users           id, username (unique), email (unique), password_hash, role, mfa_enabled,
                mfa_secret, must_change_pw, failed_logins, locked_until (legacy, not enforced),
                recovery_token, recovery_expires, created_at, updated_at
sessions        id (random hex), user_id (FK CASCADE), ip_address, user_agent,
                created_at, last_seen, expires_at
equipment       id, name, type, serial_number, barcode (CIS-NNNNNN), category, status,
                checked_out_by, checked_out_at, due_date, image_path, notes, location,
                created_at, updated_at
checkout_log    id, equipment_id, action ('checkout'|'checkin'), performed_by,
                checkout_user, notes, source, image_path, created_at
audit_log       id, user_id (FK NULL on user delete — NOT cascade), action, target,
                ip_address, user_agent, details (JSON), created_at
equipment_queue id, equipment_id, user_id, position, joined_at
tickets         id, user_id (reporter), assigned_to, equipment_id, subject, description,
                status, priority, created_at, updated_at
ticket_comments id, ticket_id, user_id, body, created_at
passkeys        id, user_id (FK CASCADE), credential_id (unique, base64url),
                public_key (base64url), counter, transports, device_name, backed_up,
                created_at, last_used_at
```

**Trap:** `audit_log.user_id` is *not* `ON DELETE CASCADE`. When deleting a user, you must `UPDATE audit_log SET user_id = NULL WHERE user_id = ?` first or the delete fails on a FK constraint. See `userService.deleteUser`.

---

## Auth flow notes

- **Password login**: `POST /api/auth/login` → optionally returns `MFA_REQUIRED` → `POST /api/auth/mfa-verify` → session cookie
- **Passkey login**: `POST /api/passkey/login-options` → browser does WebAuthn dance → `POST /api/passkey/login-verify` → same session cookie
- **Lockout removed**: `loginLimiter` middleware is a no-op shim and the `isLocked()` check is gone. The `failed_logins` and `locked_until` columns still exist for forensic reasons but are not enforced. Leave them in the schema; just don't add new code that reads them.
- **Session timeouts**: idle = 15 min (sliding), absolute = 8 h from creation. Both enforced in `sessionService.lookup`.
- **CSRF**: every state-changing request needs the `X-CSRF-Token` header set to the value of the `csrf_token` cookie. The frontend's `api()` helper does this automatically; the passkey login flow reads the cookie manually via `getCsrfCookie()` because it runs pre-session.

---

## Frontend conventions

- Don't introduce a build step. No bundler, no React, no TypeScript. The whole point is "edit `app.js`, ssh in, `git pull`, restart." A build step ruins that.
- `esc()` (in app.js) for any user-supplied string going into `innerHTML`. Never concatenate raw user data into HTML.
- `api(path, { method, body })` is the only way to call the server. It auto-includes the CSRF header.
- `toast(msg, 'success'|'error'|'info')` for non-blocking notifications; `confirm()` / `prompt()` for blocking ones (we deliberately use the browser dialogs — keeps the code tiny).
- Sidebar nav is `<div class="nav-item" data-view="X" onclick="switchView('X')">` — `switchView` hides every `[id^="view-"]` and shows the matching one, then dispatches to a `loadX()` function.
- Each view's data load function is responsible for its own error state; render an `<div class="empty-state">` on failure.

---

## Operator commands (run on the server)

```bash
# Deploy a new commit
cd /opt/CISTracker
sudo git pull origin main
sudo npm install            # only if package-lock changed
sudo systemctl restart cistracker

# Tail logs
sudo journalctl -u cistracker -f
sudo journalctl -u cistracker -n 50 --no-pager

# Confirm migrations applied
sudo journalctl -u cistracker -n 20 --no-pager | grep -i migrat

# Inspect DB
sudo sqlite3 /opt/CISTracker/data/cyberlab.db
# .tables, SELECT * FROM users; etc.

# Audit dependencies
cd /opt/CISTracker && npm audit

# Run an inventory seed (idempotent — guard rows prevent double-import)
sudo node scripts/seed-inventory.js
sudo node scripts/seed-inventory-v2.js
sudo node scripts/seed-inventory-v3.js
```

When the user asks "deploy this," they mean `sudo git pull && sudo systemctl restart cistracker` — not a re-install. Don't suggest `npm audit fix --force` unless `npm audit` actually reports vulns.

---

## Recent feature timeline (so you know what's done)

In rough order of when they landed — most recent at top:

1. **WebAuthn passkeys** (commit 40eae9a + c3250f4 + 7c56ed1) — register/login via Face ID, Touch ID, Windows Hello, security keys. iCloud/Google passkeys sync across the user's devices automatically. New `Account → Passkeys` sidebar view, "Sign in with passkey" button on login page.
2. **Login lockout removed** — both the IP rate limit and per-account lockout are gone. The user got locked out of their own server testing, decided it's not worth it for a school lab.
3. **Sticky search bar on inventory** — fixed iOS Safari yanking the page back to the top when typing in search while scrolled down. `.top-bar { position: sticky; top: 0 }`.
4. **Drop CyberLab branding** from user-facing strings (page title, login subtitle, footer, tour bubbles, MFA issuer, email body). Internal cookie/db names kept (renaming would log everyone out).
5. **Ticket: drop-without-resolve email** — when an admin clicks "Drop assignment" on a ticket whose status isn't `resolved`/`closed`, the ticket details get emailed to `RESEND_DROPPED_FORWARD` (.env value).
6. **Ticket: self-assignment** — admins can claim/take-over/drop tickets. Specific audit entries (`ticket_self_assign`, `ticket_assign`, `ticket_unassign`) instead of generic `ticket_update`.
7. **First-time onboarding tour** — runs once per user/browser via `localStorage`, walks the 5 main views with overlay bubbles. `replayTour()` exposed on `window` for re-running.
8. **Per-admin ticket badge** — each admin's "I've seen these" state is in localStorage so dismissing the badge for one admin doesn't clear it for others.
9. **Admin can change a user's email** + email-changed-notice sent to the new address.
10. **Security hardening pass** — removed dead Ollama/scan code (was the source of multer + nodemailer + tar CVEs), bumped bcrypt 5→6 + isomorphic-dompurify (clears tar/node-pre-gyp/dompurify advisories), fixed broken forgot-password email (was passing a URL where the function expected a username), removed `ChangeMe!2026` default admin password (now generates random), enforced absolute session timeout, dropped hardcoded personal email fallback for ticket forwarding.
11. **Inventory v3 location backfill** — `scripts/seed-inventory-v3.js` sets `location` for every existing item via category + name rules. Idempotent; re-run safe.
12. **Ticket count badge admin-only** — students no longer see a "1" next to Tickets.
13. **LAN-only HTTPS** — replaced Cloudflare Tunnel with nginx TLS (mkcert local CA), Windows DNS override for `cistracker.net`, Group Policy CA cert deployment, and Tailscale for remote SSH on port 2222. App runs with zero outbound internet traffic.

---

## Things to NOT do

- ❌ **Don't add a build step.** No webpack, vite, esbuild, TypeScript, React. The whole stack is "edit, ssh, restart." Adding compilation breaks that.
- ❌ **Don't rename the session cookie or DB file.** `cyberlab_sid`, `cyberlab.db`, `cyberlab_mfa_challenge` are baked into existing data. Renaming logs everyone out / orphans the DB.
- ❌ **Don't hardcode personal email addresses** anywhere in the source. Use env vars (`RESEND_SUPPORT_FORWARD`, `RESEND_DROPPED_FORWARD`) with empty defaults.
- ❌ **Don't replace ZXing** with raw `getUserMedia` + `jsQR` for the QR scanner. That approach dies after ~1 second on iOS Safari. ZXing's `BrowserMultiFormatReader` is the only thing that works cross-browser.
- ❌ **Don't add user-facing "CyberLab"** branding. The lab is the customer; the app is "CISTracker."
- ❌ **Don't skip migrations.** They auto-run on boot via `runMigrations()` in `server.js`. If you add one, name it `005-something.sql` and it'll just work.
- ❌ **Don't leave `--amend` or force pushes lying around.** The user pulls + restarts blindly; rewritten history breaks their working tree.

---

## Things to DO

- ✅ Use `req.audit('action_name', target, { details })` for any privileged action.
- ✅ Use zod schemas via `validate(schema)` middleware for any new POST/PUT body. Compose with `.transform(stripHtml)` on free-text fields.
- ✅ When you delete a user, NULL their FK in `audit_log` first. There's a working pattern in `userService.deleteUser` — copy it.
- ✅ When making backend changes, run `node --check <file>` on each modified file before committing. The deploy is "git pull + restart" — there's no CI catching syntax errors.
- ✅ Commit messages: imperative mood, brief summary line, then a paragraph or bullet list explaining *why*. Style examples are in `git log`.
- ✅ When in doubt about UI patterns, copy from a similar feature already in `app.js` (e.g. "how do I add a sidebar nav item" — search for `data-view=`).

---

## Known shortcuts taken

- The frontend is one big file because that's what the user asked for. Don't refactor it into modules unless the user explicitly asks.
- Every state-mutation in `app.js` re-fetches from the server (`loadItems()`, `loadTickets()`) instead of optimistic updates. This is intentional — it's simpler and the server is on the same LAN for the typical user, so latency is fine.
- Inline `onclick=` handlers everywhere. Refactoring to `addEventListener` would let us tighten CSP (drop `'unsafe-inline'` from `script-src-attr`) but it's not worth the diff size right now.
- We keep the `failed_logins` / `locked_until` columns in `users` even though nothing reads them. Schema stability > perfect cleanliness.

---

## Useful `.env` keys

```
SESSION_SECRET=          # 64 random bytes, REQUIRED
APP_URL=https://cistracker.net
TLS_ENABLED=true         # toggles HSTS + upgrade-insecure-requests in CSP
DB_PATH=./data/cyberlab.db
SEED_ADMIN_PASSWORD=     # leave empty to auto-generate on first seed
RESEND_API_KEY=
RESEND_SUPPORT_FORWARD=  # where ticket creation emails go
RESEND_DROPPED_FORWARD=  # where "ticket dropped without resolution" alerts go
```

---

## When the user says...

| ...they mean |
|---|
| "deploy" / "push it" | I commit + push to main; they `sudo git pull && sudo systemctl restart cistracker` on the server |
| "the server" | The Ubuntu box at /opt/CISTracker, accessed via SSH |
| "the app" | https://cistracker.net (or `inventory:3000` on LAN) |
| "the inventory" | The `equipment` table — currently ~7600 rows |
| "tickets" | The support ticket system (`tickets` + `ticket_comments` tables) |
| "build it" | Implement the feature, commit, push. They'll deploy. |
| "anything else?" / "what features" | Suggest a small ranked list, ask which they want — don't unilaterally build |

---

If you need history beyond this doc, the previous handoff is at `C:\Users\gdhug\Desktop\cistracker-handoff.json`. Full session transcripts live in `~/.claude/projects/`.
