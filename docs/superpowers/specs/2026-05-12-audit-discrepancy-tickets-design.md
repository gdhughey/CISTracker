# Audit Discrepancy → Service Ticket

**Date:** 2026-05-12  
**Status:** Approved

---

## Summary

When any user closes an inventory audit that contains discrepancies (counted qty ≠ expected qty), the system automatically creates one combined `inventory_discrepancy` service ticket summarizing all mismatches and emails every admin. An admin can then approve (which updates `equipment.quantity` to match the counted values) or reject (paper trail only, no DB changes).

---

## Trigger

**On Close Audit** — the `POST /api/inventory-audit/:id/close` route, after marking the audit closed, queries `audit_entries` for all rows belonging to that audit where `counted_qty ≠ expected_qty`. If any exist, it creates one service ticket and fires the email. If none exist, the audit closes silently with no ticket.

---

## Schema Change

**Migration 024** — recreate the `service_tickets` table with `'inventory_discrepancy'` added to the `type` CHECK constraint. SQLite does not support `ALTER TABLE … ADD CONSTRAINT`, so the migration drops and recreates the table (safe since it was also dropped + recreated in migration 023 and will be empty in practice).

New CHECK: `type IN ('add_item', 'quantity_change', 'other', 'inventory_discrepancy')`

---

## Service Ticket

**Type:** `inventory_discrepancy`

**Payload (JSON):**
```json
{
  "audit_id": 5,
  "audit_notes": "Classroom B count May 2026",
  "closed_by": "Garrett_Hughey",
  "discrepancies": [
    { "entry_id": 12, "item_name": "HP Compaq", "expected_qty": 12, "counted_qty": 9, "notes": "3 units missing" },
    { "entry_id": 17, "item_name": "GPU GTX 1080", "expected_qty": 4, "counted_qty": 5, "notes": "extra found" }
  ]
}
```

- `entry_id` is stored so the approve handler can look up the current item name for the quantity update.
- `discrepancies` is an array, one object per mismatched entry.

---

## Email

**Function:** `emailService.notifyAdminsAuditDiscrepancy(ticket, closedByUsername, discrepancies)`

**Sender:** `support@cistracker.net`  
**Recipients:** All users where `role = 'admin'` and `email IS NOT NULL AND email != ''`  
**Subject:** `[Audit Discrepancy] X item(s) need review — Audit #N`

**Body:** HTML table listing each discrepancy — Item Name | Expected | Counted | Notes — followed by a "Review in CISTracker" button linking to `APP_URL`.

---

## Approve Action

When an admin approves an `inventory_discrepancy` ticket, the `executeCallback` in `serviceTicketService.approve` iterates `payload.discrepancies` and for each entry:

1. Looks up `audit_entries` by `entry_id` to get `item_name` (canonical name at audit time).
2. Finds matching `equipment` rows by `lower(trim(name)) = lower(trim(item_name))`.
3. Updates `equipment.quantity = counted_qty` for each matched row.
4. If no matching equipment row exists (item was deleted), skips silently — does not error.

All updates run in a single transaction. The ticket status then moves to `'approved'`.

**Reject:** No DB changes. Status moves to `'rejected'`. Admin notes field is available for explanation.

---

## Service Tickets View (Frontend)

- Discrepancy tickets show a `🔍 Discrepancy Report` type badge (amber color) in the ticket list.
- Detail panel renders the discrepancy table: columns Item | Expected | Counted | Diff | Notes. Diff cell is red when counted < expected, green when counted > expected.
- Approve / Reject buttons are present for admins as with all other service ticket types.

---

## What Does NOT Change

- Users cannot manually create `inventory_discrepancy` tickets from the service tickets UI — they are only created by the close-audit flow.
- The audit itself closes regardless of whether ticket creation succeeds (non-blocking).
- If email sending fails, it is swallowed silently (same pattern as rest of app).
- Manual audits (type = `'manual'`) also trigger this on close if their entries have discrepancies.

---

## Files Touched

| File | Change |
|---|---|
| `migrations/024-discrepancy-ticket-type.sql` | Recreate `service_tickets` with new type |
| `src/services/inventoryAuditService.js` | `closeAudit()` creates ticket + fires email |
| `src/services/serviceTicketService.js` | `approve()` callback handles `inventory_discrepancy` qty updates |
| `src/services/emailService.js` | Add `notifyAdminsAuditDiscrepancy()` |
| `src/routes/serviceTickets.js` | Pass execute callback for `inventory_discrepancy` type on approve |
| `public/js/app.js` | Discrepancy badge + detail table in service tickets view |
| `public/css/app.css` | Discrepancy badge style |
