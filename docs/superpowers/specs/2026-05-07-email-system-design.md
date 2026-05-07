# Email System Design
**Date:** 2026-05-07
**Status:** Approved

---

## Overview

Add a complete transactional email system to CISTracker using the Resend API. All outbound email sends from `noreply@cistracker.net`. A separate Cloudflare Email Routing rule forwards `support@cistracker.net` to the admin's Gmail — that is a DNS/Cloudflare config step, not application code.

---

## Architecture

**Approach:** Simple direct calls. Each route handler calls the appropriate `emailService` function after its DB operation, wrapped so email failure never breaks the API response. A node-cron job handles the daily overdue reminder.

---

## New Files

### `src/services/emailService.js`
Single module — all outbound email goes through here. Uses the `resend` npm package. Exports one named async function per email type. All functions catch their own errors (log warning, never throw) so callers never need to catch.

| Function | Trigger |
|---|---|
| `sendWelcome(user, tempPassword)` | Admin creates a user |
| `sendPasswordReset(user, resetUrl)` | Forgot password request |
| `sendEmailChanged(newEmail, username)` | Admin changes a user's email |
| `sendQueueNotification(user, equipmentName)` | Item checked in, next person in queue notified |
| `sendOverdueReminder(user, items)` | Daily cron — student has overdue items |
| `sendTicketConfirmation(user, ticket)` | Student submits a ticket |
| `sendTicketStatusUpdate(user, ticket)` | Admin changes ticket status |

Emails use plain HTML with inline styles (dark background, white card). A shared wrapper provides a consistent header and footer across all templates. No external CSS frameworks.

### `src/services/reminderService.js`
Starts a node-cron job at 8am daily (configurable via `RESEND_OVERDUE_HOUR`). Queries overdue equipment grouped by the user who has it, then calls `sendOverdueReminder()` for each affected student. Started once in `server.js` on boot.

---

## Changes to Existing Files

### `src/routes/admin.js`
- After user create → `sendWelcome(user, tempPassword)`
- After admin password reset → `sendWelcome(user, resetPw)` (reuses welcome template)
- After email change → `sendEmailChanged(newEmail, username)`

### `src/routes/equipment.js`
- Checkin route: `popNext()` already runs inside the transaction and returns `nextInQueue`. After the transaction, if `nextInQueue` is set → `sendQueueNotification(nextInQueue, item.name)`

### `src/routes/tickets.js`
- After ticket create → `sendTicketConfirmation(req.user, ticket)`
- After ticket update (admin, status changed) → look up ticket owner, call `sendTicketStatusUpdate(owner, updatedTicket)`

### `src/routes/auth.js`
- Add `POST /api/auth/forgot-password` — accepts `{ email }`, always returns 200, generates 32-byte hex token stored in `users.recovery_token` + `users.recovery_expires` (1hr TTL), calls `sendPasswordReset()`. Rate-limited with existing `loginLimiter`.
- Add `POST /api/auth/reset-password` — accepts `{ token, newPassword }`, validates token exists and not expired, sets new password via bcrypt, clears `recovery_token` + `recovery_expires`.

No new migration needed — `recovery_token` and `recovery_expires` columns already exist in migration 001.

### `src/config.js`
- `resend.apiKey` — from `RESEND_API_KEY`
- `resend.from` — `'noreply@cistracker.net'`
- `resend.overdueHour` — from `RESEND_OVERDUE_HOUR`, default `8`

### `package.json`
- Add `resend`
- Add `node-cron`

### `server.js`
- `require('./src/services/reminderService')` to start the cron job on boot

### `public/index.html` + `public/js/app.js`
- Add "Forgot password?" link on login form
- Add reset-password view (token + new password form), shown when URL contains `?token=`

---

## Forgot Password Flow

```
1. Student clicks "Forgot password?" on login page
2. POST /api/auth/forgot-password { email }
   → Always returns 200 (never reveals if email exists)
   → If user found: generate 32-byte random hex token
     store on users.recovery_token + users.recovery_expires (now + 1hr)
     sendPasswordReset(user, `${APP_URL}/reset-password?token=TOKEN`)
3. Student clicks link → frontend shows set-new-password form
4. POST /api/auth/reset-password { token, newPassword }
   → Validate token exists + not expired
   → bcrypt new password, clear recovery_token + recovery_expires
   → Return 200, frontend redirects to login
```

---

## Email Templates

All emails share a common HTML wrapper (header with "CISTracker" branding, footer with "cistracker.net"). Inline styles only, no external dependencies.

| Email | Subject |
|---|---|
| Welcome | "Your CISTracker account is ready" |
| Password reset | "Reset your CISTracker password" |
| Email changed | "Your CISTracker email was updated" |
| Queue notification | "Your waitlisted item is now available" |
| Overdue reminder | "You have overdue equipment" |
| Ticket confirmation | "We received your support ticket #ID" |
| Ticket status update | "Your ticket #ID has been updated" |

---

## Environment Variables

```
RESEND_API_KEY=           # required for email to send
RESEND_OVERDUE_HOUR=8     # hour (0-23) for daily overdue cron, default 8
```

Existing vars `RESEND_SUPPORT_FORWARD` and `RESEND_DROPPED_FORWARD` are unchanged.

---

## Out of Scope

- `support@cistracker.net` inbox — handled by Cloudflare Email Routing forwarding to Gmail, no application code needed
- Email unsubscribe — all emails are transactional (account/operational), no marketing
- Email retry/persistence — failures are logged as warnings; low-stakes enough that no retry queue is warranted
