# CISTracker: Local Mode + Stats Polish

**Date:** 2026-04-29  
**Status:** Approved  
**Scope:** Single PR — local conversion + stats card redesign

---

## Problem

The app currently reaches out to three external services at runtime:

| Dependency | Purpose |
|---|---|
| `fonts.googleapis.com` | IBM Plex Sans/Mono fonts |
| `unpkg.com` | ZXing QR scanner + SimpleWebAuthn browser library |
| Resend (API) | All transactional email |

Teacher requirement: the app must work entirely on the school LAN with no outbound internet traffic. Additionally, the inventory stats cards at the top of the main view need more visual clarity.

---

## Approach

Approach 1 (chosen): Surgical — vendor all external assets locally, remove email entirely, redesign stats cards. One PR, low risk.

---

## Section 1: Going Local

### Fonts

- Download IBM Plex Sans (weights 300, 400, 500, 600) and IBM Plex Mono (weights 400, 500) as `.woff2` files
- Place in `public/fonts/`
- Replace `@import url('https://fonts.googleapis.com/...')` in `public/css/app.css` with `@font-face` declarations pointing to `/fonts/*.woff2`

### CDN Scripts

- Download `@zxing/browser@0.1.5` UMD bundle → `public/js/vendor/zxing-browser.min.js`
- Download `@simplewebauthn/browser@11.0.0` UMD bundle → `public/js/vendor/simplewebauthn.min.js`
- Update both `<script src="https://unpkg.com/...">` tags in `public/index.html` to local paths

### CSP (helmet.js)

- Remove `unpkg.com` from `script-src`
- Remove `fonts.googleapis.com` and `fonts.gstatic.com` from `style-src` / `font-src`
- No other CSP changes

---

## Section 2: Email Removal

### Files deleted

- `src/services/emailService.js`
- `src/services/reminderService.js` (daily overdue cron — `node-cron` dependency also removed)

### Routes removed

- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### UI changes

- Remove "Forgot password?" link from login page (`public/index.html`)
- Admin password reset (`POST /api/admin/users/:id/reset-password`): already returns `{ tempPassword }` in the JSON response. Surface this in a modal in the admin UI ("Temp password: `XXXXXXXX` — share this with the student") instead of emailing it.

### Config cleanup

- Remove `RESEND_API_KEY`, `RESEND_SUPPORT_FORWARD`, `RESEND_DROPPED_FORWARD`, `RESEND_NO_REPLY_FROM`, `RESEND_SUPPORT_FROM` from `.env.example`
- Remove `resend` from `package.json` dependencies
- Remove `node-cron` from `package.json` dependencies (was only used in reminderService)

### Callers to clean up

| File | Change |
|---|---|
| `src/routes/auth.js` | Remove forgot-password + reset-password handlers; remove emailService import |
| `src/routes/admin.js` | Remove `sendPasswordReset`, `sendNewAccount`, `sendEmailChangedNotice` calls; surface temp password in response |
| `src/routes/tickets.js` | Remove `sendSupportTicket`, `sendTicketDropped` calls; remove emailService import |
| `src/routes/equipment.js` | Remove `sendQueueNotification` call; remove emailService import |
| `src/services/equipmentService.js` | Remove any emailService reference |
| `src/config.js` | Remove `resend` config block |
| `server.js` | Remove reminderService require/init |

### What admins lose

- Daily overdue email reminders → overdue tab in admin panel still shows all overdue items
- New account welcome email → admin shares credentials manually
- Queue "it's your turn" notification → students check the app
- Ticket forwarding to external email → tickets are managed entirely in-app
- Self-service forgot-password flow → admin resets passwords manually

---

## Section 3: Stats Card Redesign (Option A)

### Target elements

The 4 stat cards at the top of the inventory view: Total, Available, Checked Out, Overdue.

### Visual spec

```
┌─────────────────────┐
│ ███ (color border)  │  ← 3px top border, color per card
│                     │
│  7,612              │  ← 28px, font-weight 600, color matches border
│  TOTAL ITEMS        │  ← 11px, uppercase, letter-spacing 0.06em, --text-sec
│                     │
└─────────────────────│
```

| Card | Border + number color | CSS var |
|---|---|---|
| Total | Blue | `var(--accent)` = `#4f8ef7` |
| Available | Green | `var(--green)` = `#34d399` |
| Checked Out | Amber | `var(--amber)` = `#fbbf24` |
| Overdue | Red | `var(--red)` = `#f87171` |

**Card background:** `var(--bg-elevated)` = `#171b26` (unchanged)  
**Card border:** `#252836` (one step up from current `--border`)  
**Number color:** matches the top border color per card  
**Label:** `var(--text-sec)` = `#9ca3af`, `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.06em`

### Implementation

- Update the stat card HTML in `public/index.html` (the 4 `.stat-card` or equivalent divs)
- Update `.stat-card` CSS in `public/css/app.css`
- Color variants applied via inline style or modifier classes (e.g. `.stat-card--blue`, `.stat-card--green`, etc.)

---

## Out of Scope

- No changes to the Cloudflare Tunnel setup (infrastructure, not app code)
- No changes to WebAuthn passkey flow beyond the vendored script path
- No other UI views beyond the stats cards
- No build step introduced
- No new npm dependencies added

---

## Deployment

Standard deploy: `sudo git pull origin main && sudo npm install && sudo systemctl restart cistracker`

`npm install` is needed to remove `resend` and `node-cron` from `node_modules`. Flag this to the operator.
