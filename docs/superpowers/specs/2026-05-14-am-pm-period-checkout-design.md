# AM/PM Period-Based Checkout — Design Spec

**Goal:** Allow items to be shared across class periods — AM students auto-return at period end, PM students can then check the same item out, while all-day or multi-day students keep items through both periods.

**Architecture:** Thin layer on top of the existing checkout system. Add `checkout_type` to the equipment table, a `period_settings` config table, a `periodService.js` cron, and new email templates. No reservation system — checkout remains first-come-first-served.

**Tech Stack:** Node.js + better-sqlite3, node-cron (already installed), Resend email (already wired), vanilla JS frontend

---

## Backlog (all approved for this spec)

1. **AM/PM period checkout** — core feature
2. **Checkout receipt email** — student gets email on checkout: item, due date/time, return instructions
3. **Pre-due reminder** (1 day before) — extend existing reminderService cron
4. **"My Equipment" student view** — dedicated view for all current checkouts, one-tap return
5. **Mass return button** — admin bulk-return all items or selected items

---

## Data Model

### Migration 031: period_checkout

```sql
ALTER TABLE equipment ADD COLUMN checkout_type TEXT NOT NULL DEFAULT 'allday';

CREATE TABLE IF NOT EXISTS period_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  am_end_time TEXT    NOT NULL DEFAULT '11:30',
  pm_end_time TEXT    NOT NULL DEFAULT '15:00',
  timezone    TEXT    NOT NULL DEFAULT 'America/New_York',
  school_days TEXT    NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO period_settings (id) VALUES (1);
```

**checkout_type values:** `'am'` | `'pm'` | `'allday'`

**student_group → checkout_type default mapping:**
- `student_group = 'am'` → default `checkout_type = 'am'`
- `student_group = 'pm'` → default `checkout_type = 'pm'`
- `'allday'` / `'none'` → default `checkout_type = 'allday'`
- Student can always override to `'allday'` for exclusive multi-day use

---

## Backend

### New: `src/services/periodService.js`

- `getSettings()` — reads period_settings row
- `updateSettings(data)` — saves and reschedules cron
- `runAutoReturn(type)` — batch-checkins all `checkout_type = type` items; sends auto-return email to each; triggers queue notification for next in line
- `scheduleAutoReturns()` — wires up node-cron at AM and PM end times on school days; called on startup and after updateSettings

**`runAutoReturn` error handling:** log and continue on individual item failure; don't abort the batch.

### New routes (add to `src/routes/admin.js`)

```
GET  /api/admin/period-settings   → getSettings()
PUT  /api/admin/period-settings   → updateSettings(body), reschedule cron
```

### Modified: checkout endpoints

Both `POST /:id/checkout` and `POST /batch-checkout` accept optional `checkout_type` in body. If absent, derive from borrower's `student_group`. Write to `equipment.checkout_type`. On checkin: reset to `'allday'`.

### New email templates (`src/services/emailService.js`)

**sendPeriodAutoReturn(user, itemName, type)** — "Your AM-period checkout was automatically returned at 11:30am."

**sendCheckoutReceipt(user, items, dueInfo)** — "You checked out N item(s). Due back: [date/time]. Return instructions."

---

## Frontend

### Checkout modal — period selector

For AM/PM students, show above Duration slider:
```
Checkout type:
  [AM Period — returns 11:30am]  [PM Period — returns 3:00pm]  [Full checkout — N days]
```
"Full checkout" reveals the Duration slider. AM/PM hide it. Sends `checkout_type` in POST body.

Admins and all-day students see only the Duration slider (existing behavior).

### Two new status badge states

`getItemStatus()` returns `'am_period'` or `'pm_period'` when `checkout_type` is set. Badges show:
- `"Out — back at 11:30am"` (amber)
- `"Out — back at 3:00pm"` (amber)

These tell PM students an item will be available at period end without showing it as fully blocked.

### Admin settings — Period Settings section

New section in Admin tab:
```
Period Settings
  AM ends: [11:30]    PM ends: [15:00]    (HH:MM, 24h)
  School days: [☑Mon] [☑Tue] [☑Wed] [☑Thu] [☑Fri] [☐Sat] [☐Sun]
  [Save]
```
`PUT /api/admin/period-settings` on save. Toast on success.

### "My Equipment" student view

New nav item (visible to all roles): shows everything the current user has checked out.

Each row: item name, CIS barcode, checkout type badge, due date/time, one-tap "Return" button.

Admins see an additional selector to view any user's equipment.

### Mass return button

In the admin area (and selection bar), a "Return All" or "Return Selected" button that calls a batch-checkin API endpoint for multiple items at once. Confirms before submitting. Reuses existing `confirmBatchCheckout` pattern in reverse.

---

## Error Handling

- Auto-return failure per item: log, continue with rest of batch
- Email failure: log, don't throw (existing pattern)
- Admin changes period times mid-day: existing checkouts keep their type; new checkouts use new times
- Weekend / holiday: cron fires but finds 0 items; no-op
