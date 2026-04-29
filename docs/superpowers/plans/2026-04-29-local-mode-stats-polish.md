# Local Mode + Stats Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert CISTracker to run fully on the school LAN (no outbound internet at runtime) and redesign the inventory stats cards for visual clarity.

**Architecture:** Three workstreams executed sequentially: (1) vendor all external static assets into `public/`, (2) strip the entire Resend email layer and all code that depends on it, (3) update stats card CSS. No new npm runtime dependencies added. No test framework exists — syntax verified with `node --check`, behavior verified by starting the server manually.

**Tech Stack:** Node.js 20, Express 4, better-sqlite3, vanilla JS/CSS, helmet CSP, node-cron (removed), resend (removed).

---

## File Map

| File | Change |
|---|---|
| `public/fonts/ibm-plex-sans-{300,400,500,600}.woff2` | CREATE — vendored font files |
| `public/fonts/ibm-plex-mono-{400,500}.woff2` | CREATE — vendored font files |
| `public/js/vendor/zxing-browser.min.js` | CREATE — vendored QR scanner |
| `public/js/vendor/simplewebauthn.min.js` | CREATE — vendored WebAuthn library |
| `public/css/app.css` | MODIFY — `@font-face` replaces `@import`; stats card styles |
| `public/index.html` | MODIFY — local script src paths |
| `src/middleware/helmet.js` | MODIFY — remove external origins from CSP |
| `src/services/emailService.js` | DELETE |
| `src/services/reminderService.js` | DELETE |
| `src/config.js` | MODIFY — remove `resend` + `reminders` config blocks |
| `server.js` | MODIFY — remove reminderService require/init (line 69) |
| `src/routes/auth.js` | MODIFY — remove forgot-password + reset-password routes and emailService import |
| `src/routes/admin.js` | MODIFY — remove emailService import and three email calls |
| `src/routes/tickets.js` | MODIFY — remove emailService import and two email calls |
| `src/services/equipmentService.js` | MODIFY — remove inline emailService require + sendQueueNotification call (lines 172–176) |
| `package.json` | MODIFY — remove `resend`, `node-cron` |
| `package-lock.json` | MODIFY — updated by npm |
| `.env.example` | MODIFY — remove Resend + reminder keys |

---

### Task 1: Download and vendor IBM Plex fonts

**Files:**
- Create: `public/fonts/ibm-plex-sans-300.woff2`, `ibm-plex-sans-400.woff2`, `ibm-plex-sans-500.woff2`, `ibm-plex-sans-600.woff2`
- Create: `public/fonts/ibm-plex-mono-400.woff2`, `ibm-plex-mono-500.woff2`
- Modify: `public/css/app.css`

- [ ] **Step 1: Download woff2 files from Google Fonts**

Run from the project root. This is a one-time development-time download — files get committed to the repo and served locally forever after.

```bash
mkdir -p public/fonts

# Fetch the Google Fonts CSS — it contains the exact woff2 URLs with font-weight metadata
curl -sA "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" \
  -o /tmp/gfonts.css

# Parse and download each woff2 with a predictable name
node -e "
const fs = require('fs');
const https = require('https');
const css = fs.readFileSync('/tmp/gfonts.css', 'utf8');
const blocks = css.match(/@font-face \{[^}]+\}/g) || [];
let pending = blocks.length;
blocks.forEach(block => {
  const familyMatch = block.match(/font-family: '([^']+)'/);
  const weightMatch = block.match(/font-weight: (\d+)/);
  const urlMatch = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
  if (!familyMatch || !weightMatch || !urlMatch) { pending--; return; }
  const family = familyMatch[1].toLowerCase().replace('ibm plex ', '').replace(' ', '-');
  const weight = weightMatch[1];
  const dest = 'public/fonts/ibm-plex-' + family + '-' + weight + '.woff2';
  console.log('Downloading', dest);
  const file = fs.createWriteStream(dest);
  https.get(urlMatch[1], res => {
    res.pipe(file);
    file.on('finish', () => { file.close(); if (--pending === 0) console.log('Done'); });
  });
});
"
```

Verify all 6 files exist and are non-empty:
```bash
ls -la public/fonts/
# Expected: 6 files, each > 20 KB
```

- [ ] **Step 2: Replace `@import` with `@font-face` declarations in `app.css`**

In `public/css/app.css`, line 4 currently reads:
```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
```

Replace that single line with:
```css
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 300; font-display: swap; src: url('/fonts/ibm-plex-sans-300.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/ibm-plex-sans-400.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/ibm-plex-sans-500.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/ibm-plex-sans-600.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/ibm-plex-mono-400.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/ibm-plex-mono-500.woff2') format('woff2'); }
```

- [ ] **Step 3: Verify fonts load from local**

```bash
node server.js &
SERVER_PID=$!
# Open http://localhost:3000 in browser
# DevTools → Network tab → filter by "Font"
# Confirm: zero requests to fonts.googleapis.com or fonts.gstatic.com
# Confirm: 6 requests to /fonts/ibm-plex-*.woff2 each return 200
# Confirm: text renders in IBM Plex Sans (not system fallback)
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add public/fonts/ public/css/app.css
git commit -m "Vendor IBM Plex fonts locally — remove Google Fonts CDN dependency"
```

---

### Task 2: Download and vendor CDN scripts

**Files:**
- Create: `public/js/vendor/zxing-browser.min.js`
- Create: `public/js/vendor/simplewebauthn.min.js`
- Modify: `public/index.html`

- [ ] **Step 1: Download vendor scripts**

```bash
mkdir -p public/js/vendor

# ZXing QR scanner — exact version that index.html currently references
curl -sL "https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js" \
  -o public/js/vendor/zxing-browser.min.js

# SimpleWebAuthn browser library — exact version that index.html currently references
curl -sL "https://unpkg.com/@simplewebauthn/browser@11.0.0/dist/bundle/index.umd.min.js" \
  -o public/js/vendor/simplewebauthn.min.js
```

Verify:
```bash
ls -la public/js/vendor/
# zxing-browser.min.js  — expect ~300 KB
# simplewebauthn.min.js — expect ~100 KB
```

- [ ] **Step 2: Update script tags in `public/index.html`**

Find these two lines (near the bottom of index.html, around line 276–277):
```html
<script src="https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js"></script>
<script src="https://unpkg.com/@simplewebauthn/browser@11.0.0/dist/bundle/index.umd.min.js"></script>
```

Replace with:
```html
<script src="/js/vendor/zxing-browser.min.js"></script>
<script src="/js/vendor/simplewebauthn.min.js"></script>
```

- [ ] **Step 3: Verify scripts load locally and QR scanner works**

```bash
node server.js &
SERVER_PID=$!
# Open http://localhost:3000 → DevTools → Network tab
# Confirm: zero requests to unpkg.com
# Confirm: /js/vendor/zxing-browser.min.js returns 200
# Confirm: /js/vendor/simplewebauthn.min.js returns 200
# Navigate to Check Out — start a QR scan — confirm camera activates
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add public/js/vendor/ public/index.html
git commit -m "Vendor ZXing + SimpleWebAuthn locally — remove unpkg.com CDN dependency"
```

---

### Task 3: Tighten CSP

**Files:**
- Modify: `src/middleware/helmet.js`

- [ ] **Step 1: Remove external origins from CSP directives**

In `src/middleware/helmet.js`, replace the entire `cspDirectives` object (lines 5–29) with:

```js
const cspDirectives = {
  defaultSrc: ["'self'"],
  // All scripts now served from /js/ — no CDN needed
  scriptSrc: ["'self'"],
  // Inline onclick= handlers require this; see CLAUDE.md for context
  scriptSrcAttr: ["'unsafe-inline'"],
  // Fonts and styles are fully local
  styleSrc: ["'self'", "'unsafe-inline'"],
  fontSrc: ["'self'", 'data:'],
  // blob: for getUserMedia camera stream; data: for generated QR images
  imgSrc: ["'self'", 'data:', 'blob:'],
  mediaSrc: ["'self'", 'blob:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};
```

Removed from previous version:
- `scriptSrc`: removed `'https://unpkg.com'`
- `styleSrc`: removed `'https://fonts.googleapis.com'`
- `fontSrc`: removed `'https://fonts.gstatic.com'`
- `imgSrc`: removed `'https://api.qrserver.com'` (dead entry — app uses local `qrcode` npm package)

- [ ] **Step 2: Verify syntax**

```bash
node --check src/middleware/helmet.js
```

Expected: no output (exit 0).

- [ ] **Step 3: Verify CSP header contains no external origins**

```bash
node server.js &
SERVER_PID=$!
curl -sI http://localhost:3000 | grep -i content-security-policy
# Confirm output does NOT contain: unpkg.com, googleapis.com, gstatic.com, qrserver.com
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/middleware/helmet.js
git commit -m "Tighten CSP — remove unpkg.com, Google Fonts, and dead api.qrserver.com entries"
```

---

### Task 4: Delete email service files and clean server.js + config.js

**Files:**
- Delete: `src/services/emailService.js`
- Delete: `src/services/reminderService.js`
- Modify: `server.js` (remove line 69)
- Modify: `src/config.js` (remove `resend` + `reminders` blocks)

- [ ] **Step 1: Delete the service files**

```bash
rm src/services/emailService.js
rm src/services/reminderService.js
```

- [ ] **Step 2: Remove reminderService from server.js**

In `server.js`, line 69 currently reads:
```js
  require('./src/services/reminderService').start();
```

Delete that line entirely.

- [ ] **Step 3: Remove `resend` and `reminders` blocks from config.js**

In `src/config.js`, delete the `resend` block (lines 54–66):
```js
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    noReplyFrom: process.env.RESEND_NOREPLY_FROM || 'CISTracker <noreply@cistracker.net>',
    supportFrom: process.env.RESEND_SUPPORT_FROM || 'CISTracker Support <support@cistracker.net>',
    supportForwardTo: process.env.RESEND_SUPPORT_FORWARD || '',
    droppedForwardTo: process.env.RESEND_DROPPED_FORWARD || '',
  },
```

Also delete the `reminders` block (lines 68–72):
```js
  reminders: {
    reminderDays: int(process.env.REMINDER_DAYS, 3),
    alertDays: int(process.env.ALERT_DAYS, 5),
    cron: process.env.REMINDER_CRON || '0 9 * * *',
  },
```

- [ ] **Step 4: Verify syntax**

```bash
node --check server.js
node --check src/config.js
```

Expected: no output from either (exit 0).

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "Delete emailService + reminderService — remove Resend dependency and overdue cron"
```

---

### Task 5: Remove forgot-password routes from auth.js

**Files:**
- Modify: `src/routes/auth.js`

- [ ] **Step 1: Remove emailService import**

In `src/routes/auth.js`, line 9 reads:
```js
const emailService = require('../services/emailService');
```

Delete that line.

- [ ] **Step 2: Remove the forgot-password and reset-password route handlers**

In `src/routes/auth.js`, find and delete the following two route blocks entirely (from the `router.post` line through the closing `});`):

```js
router.post('/forgot-password', loginLimiter, validate(forgotSchema), async (req, res) => {
  // ... handler body ...
});
```

```js
router.post('/reset-password', validate(resetSchema), async (req, res) => {
  // ... handler body ...
});
```

Also delete the `forgotSchema` and `resetSchema` zod definitions (around line 47 and nearby) since nothing else uses them.

- [ ] **Step 3: Verify syntax**

```bash
node --check src/routes/auth.js
```

Expected: no output (exit 0).

- [ ] **Step 4: Confirm server starts and auth still works**

```bash
node server.js &
SERVER_PID=$!
# Confirm clean startup — no "Cannot find module" or reference errors
# Open http://localhost:3000, log in with username + password — confirm it works
kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.js
git commit -m "Remove forgot-password routes from auth — email-based reset gone, admin resets manually"
```

---

### Task 6: Remove email calls from admin.js and tickets.js

**Files:**
- Modify: `src/routes/admin.js`
- Modify: `src/routes/tickets.js`

- [ ] **Step 1: Clean admin.js**

In `src/routes/admin.js`:

**Remove the import** (line 8):
```js
const emailService = require('../services/emailService');
```

**Remove the `sendNewAccount` call** (line 63 — inside the create-user handler):
```js
  emailService.sendNewAccount(req.body.email, req.body.username, tempPw).catch(() => {});
```
Delete that line. The `tempPw` is still returned in the JSON response — the frontend already shows it via `toast()` in `app.js`.

**Remove the `sendEmailChangedNotice` call** (line 86 — inside the update-user handler):
```js
    emailService.sendEmailChangedNotice(req.body.email, user.username).catch(() => {});
```
Delete that line.

**Remove the `sendPasswordReset` call** (line 96 — inside the reset-password branch):
```js
    emailService.sendPasswordReset(user.email, user.username, resetPw).catch(() => {});
```
Delete that line. The `resetPw` is still returned as `tempPassword` in the JSON response — the frontend already shows it via `toast('Temporary password: ${tempPassword}', 'info')` in `app.js`.

- [ ] **Step 2: Verify admin.js syntax**

```bash
node --check src/routes/admin.js
```

Expected: no output (exit 0).

- [ ] **Step 3: Clean tickets.js**

In `src/routes/tickets.js`:

**Remove the import** (line 5):
```js
const emailService = require('../services/emailService');
```

**Remove the `sendSupportTicket` call and its catch block** (lines 68–70):
```js
  emailService.sendSupportTicket(ticket, req.user.username).catch(err => {
    console.error('[email] sendSupportTicket failed:', err?.message || err);
  });
```
Delete all three lines.

**Remove the `sendTicketDropped` call and its catch block** (lines 103–105):
```js
      emailService.sendTicketDropped(updated, req.user.username).catch(err => {
        console.error('[email] sendTicketDropped failed:', err?.message || err);
      });
```
Delete all three lines.

- [ ] **Step 4: Verify tickets.js syntax**

```bash
node --check src/routes/tickets.js
```

Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js src/routes/tickets.js
git commit -m "Remove email calls from admin and ticket routes"
```

---

### Task 7: Remove email call from equipmentService.js

**Files:**
- Modify: `src/services/equipmentService.js`

- [ ] **Step 1: Remove the inline emailService require and sendQueueNotification call**

In `src/services/equipmentService.js`, lines 171–176 currently read:
```js
  // Send queue notification outside the transaction (async, fire-and-forget)
  if (nextInQueue) {
    const emailService = require('./emailService');
    const item = getById(equipmentId);
    emailService.sendQueueNotification(
      nextInQueue.email, nextInQueue.username, item?.name || 'Equipment'
    ).catch(() => {});
  }
```

Replace those 7 lines with nothing — delete them entirely. The `nextInQueue` value is still returned by the function (line 178: `return { item: getById(equipmentId), nextInQueue }`), so the caller still knows if someone is next in queue; the notification just silently goes away.

- [ ] **Step 2: Verify syntax**

```bash
node --check src/services/equipmentService.js
```

Expected: no output (exit 0).

- [ ] **Step 3: Verify full server startup**

```bash
node server.js &
SERVER_PID=$!
# Confirm clean startup — no module errors in output
# Open http://localhost:3000, log in, check out an item — confirm no errors
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/services/equipmentService.js
git commit -m "Remove sendQueueNotification from equipmentService — queue still works, just no email ping"
```

---

### Task 8: Uninstall npm packages and clean .env.example

**Files:**
- Modify: `package.json` (via npm)
- Modify: `package-lock.json` (via npm)
- Modify: `.env.example`

- [ ] **Step 1: Uninstall resend and node-cron**

```bash
npm uninstall resend node-cron
```

Expected: `package.json` updated, both packages removed from `node_modules/`.

- [ ] **Step 2: Verify server still starts**

```bash
node --check server.js
node server.js &
SERVER_PID=$!
# Confirm no "Cannot find module 'resend'" or "Cannot find module 'node-cron'" errors
kill $SERVER_PID
```

- [ ] **Step 3: Remove dead keys from .env.example**

In `.env.example`, delete the entire `# Email (Resend...)` section:
```
# Email (Resend — get an API key at resend.com)
RESEND_API_KEY=
RESEND_NOREPLY_FROM=CISTracker <noreply@cistracker.net>
RESEND_SUPPORT_FROM=CISTracker Support <support@cistracker.net>
# Where new support tickets get forwarded
RESEND_SUPPORT_FORWARD=
# Where to send the alert when an admin drops a ticket without resolving it
RESEND_DROPPED_FORWARD=
```

Also delete the reminder schedule section:
```
# Reminder schedule (overdue items)
REMINDER_DAYS=3
ALERT_DAYS=5
REMINDER_CRON=0 9 * * *
```

Leave `APP_URL` — it's still used in the boot banner and WebAuthn origin configuration.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "Remove resend + node-cron packages and clean .env.example"
```

---

### Task 9: Stats card CSS redesign

**Files:**
- Modify: `public/css/app.css`

- [ ] **Step 1: Replace stat card CSS rules**

In `public/css/app.css`, find the stats bar block (currently around lines 175–190):

```css
/* ── Stats bar ── */
.stats-bar {
  padding:14px 24px; display:flex; gap:14px; flex-shrink:0;
}
.stat-card {
  flex:1; background:var(--bg-surface); border:1px solid var(--border-sub);
  border-radius:10px; padding:14px 18px;
}
.stat-num {
  font-family:var(--mono); font-size:22px; font-weight:600; margin-bottom:2px;
}
.stat-num.c-text { color:var(--text-sec); }
.stat-num.c-green { color:var(--green); }
.stat-num.c-amber { color:var(--amber); }
.stat-num.c-red { color:var(--red); }
.stat-label { font-size:11px; color:var(--text-muted); }
```

Replace it with:

```css
/* ── Stats bar ── */
.stats-bar {
  padding:14px 24px; display:flex; gap:14px; flex-shrink:0;
}
.stat-card {
  flex:1; background:var(--bg-surface); border:1px solid var(--border-sub);
  border-top-width:3px; border-top-style:solid;
  border-radius:10px; padding:14px 18px;
}
.stat-card:has(.c-text)  { border-top-color: var(--accent); }
.stat-card:has(.c-green) { border-top-color: var(--green); }
.stat-card:has(.c-amber) { border-top-color: var(--amber); }
.stat-card:has(.c-red)   { border-top-color: var(--red); }
.stat-num {
  font-family:var(--mono); font-size:28px; font-weight:600; line-height:1; margin-bottom:4px;
}
.stat-num.c-text  { color:var(--accent); }
.stat-num.c-green { color:var(--green); }
.stat-num.c-amber { color:var(--amber); }
.stat-num.c-red   { color:var(--red); }
.stat-label { font-size:11px; color:var(--text-sec); text-transform:uppercase; letter-spacing:0.06em; }
```

Changes from current:
- `.stat-card`: adds `border-top-width:3px; border-top-style:solid;` (the 1px side/bottom borders from `border:1px solid` are preserved; top width is overridden to 3px)
- Four `:has()` rules: set `border-top-color` per card matching the existing number color class
- `.stat-num`: `font-size` 22px → 28px; `margin-bottom` 2px → 4px; added `line-height:1`
- `.stat-num.c-text`: was `color:var(--text-sec)` (gray) → now `color:var(--accent)` (blue) so the total card has a colored number too
- `.stat-label`: `color:var(--text-muted)` → `color:var(--text-sec)`; added `text-transform:uppercase; letter-spacing:0.06em`

- [ ] **Step 2: Verify in browser**

```bash
node server.js &
SERVER_PID=$!
# Open http://localhost:3000, log in, go to Inventory
# Confirm: 4 stat cards each have a colored top border (blue/green/amber/red)
# Confirm: numbers are larger (28px) and colored to match their border
# Confirm: labels are uppercase with letter-spacing
# Confirm: narrow the browser to mobile width — cards wrap correctly (existing responsive rules intact)
kill $SERVER_PID
```

- [ ] **Step 3: Commit**

```bash
git add public/css/app.css
git commit -m "Redesign inventory stats cards — colored top borders, larger numbers, uppercase labels"
```

---

## Final Verification

After all 9 tasks complete, run a full end-to-end check:

```bash
node server.js &
SERVER_PID=$!
```

Open http://localhost:3000 in browser. Open DevTools → Network tab. Then:

1. **Log in** — confirm IBM Plex fonts load from `/fonts/*.woff2` (no googleapis.com requests)
2. **Inventory view** — confirm zero requests to unpkg.com, googleapis.com, gstatic.com, qrserver.com, resend.com
3. **Stats cards** — confirm colored top borders, larger numbers, uppercase labels
4. **Check Out** — start a QR scan — confirm camera activates (ZXing still works from vendor file)
5. **Admin → Users → Reset password** — confirm toast shows temp password (email not sent, that's correct)
6. **CSP check** — `curl -sI http://localhost:3000 | grep content-security-policy` — confirm no external origins

```bash
kill $SERVER_PID
```

Then push and deploy:
```bash
git push origin main
```

On the server:
```bash
sudo git pull origin main
sudo npm install   # REQUIRED — removes resend/node-cron from node_modules
sudo systemctl restart cistracker
sudo journalctl -u cistracker -n 20 --no-pager   # confirm clean startup
```
