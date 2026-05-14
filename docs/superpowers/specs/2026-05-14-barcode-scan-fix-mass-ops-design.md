# Design: Barcode Scan Fix + Mass Delete / Mass Print Labels

**Date:** 2026-05-14  
**Status:** Approved

---

## Overview

Three changes to CISTracker:

1. **Fix barcode scan** — unit barcodes (stored in `equipment_units`) are not found by the QR scan lookup, which only searches the `equipment` table.
2. **Mass delete** — admins can select multiple inventory items and delete them in one action.
3. **Mass print labels** — any user can select multiple items and print all their QR labels in one print job.

---

## Part 1 — Fix: Barcode Scan Lookup

### Root Cause

`GET /api/equipment/lookup?code=CIS-000256` calls `equipmentService.findByIdentifier()`, which only searches `equipment.barcode` and `equipment.serial_number`. Individual unit barcodes live in the `equipment_units` table (added via migration script in a previous session). Scanning a unit label returns 404.

### Fix

Update `findByIdentifier()` in `equipmentService.js` to add a fallback:

1. Search `equipment.barcode` / `equipment.serial_number` (existing).
2. If no match, search `equipment_units.barcode` for the code.
3. If found in units, return the parent `equipment` row via `equipment_units.equipment_id`.

No changes to the checkout/checkin routes — they still operate on `equipment.id`. The scan result card shows the parent item name and barcode, which is correct since checkout is tracked at parent level.

### Schema assumption for equipment_units

The table was created on production via a script (no local migration file). Assumed columns based on prior sessions:

```sql
equipment_units (
  id INTEGER PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  name TEXT,
  barcode TEXT,
  serial_number TEXT,
  notes TEXT
)
```

If the actual column names differ, adjust the fallback query accordingly.

---

## Part 2 — Multi-Select UI

### Location

Added to the **All Items** (`view-inventory`) view only. No other views are affected.

### Entering Selection Mode

A "Select" toggle button appears in the inventory toolbar (admin always sees it; non-admin sees it but only gets Print Labels action). Clicking it shows checkboxes on each item card.

### Controls (shown while in selection mode)

| Control | Behavior |
|---------|----------|
| Header checkbox | Select / deselect all currently visible items |
| Category dropdown | "Select all in [Category]" — checks every item matching that category regardless of scroll position |
| Location dropdown | "Select all in [Location]" — same for location |
| Selected count label | Live count, e.g. "47 selected" |
| Cancel button | Exits selection mode, clears all checkboxes |

### Action Bar

A fixed bar appears at the bottom of the screen when ≥1 item is selected:

```
[ Delete (47) ]   [ Print Labels (47) ]    × Cancel
```

- **Delete** — admin only (hidden for non-admin users)
- **Print Labels** — visible to all users
- **Cancel** — clears selection, hides bar

---

## Part 3 — Mass Delete

### Frontend

Clicking "Delete (N)": shows a confirmation modal ("Delete 47 items? This cannot be undone."). On confirm, calls the bulk delete endpoint.

### Backend

New endpoint:

```
DELETE /api/equipment/bulk
Body: { ids: [1, 2, 3, ...] }
Auth: admin only
```

Runs `equipmentService.remove()` for each ID inside a single SQLite transaction. Returns `{ deleted: N }`.

Each delete clears FK references (tickets.equipment_id → NULL, deletes checkout_log rows) consistent with the existing single-item `remove()` function.

Audit log entry: `equipment_bulk_delete` with `{ count: N, ids: [...] }`.

---

## Part 4 — Mass Print Labels

### Frontend

Clicking "Print Labels (N)": fetches QR data for all selected items, then opens a popup window with all labels laid out, then calls `window.print()`.

Flow:

1. Collect selected `id` array.
2. `GET /api/equipment/labels/bulk?ids=1,2,3,...`
3. Backend returns `[{ asset_id, name, qr_data_url }, ...]`.
4. Frontend builds an HTML string with one label div per item using the same thermal CSS as the existing single-label print.
5. `window.open()` → write HTML → `window.print()`.

### Backend

New endpoint:

```
GET /api/equipment/labels/bulk?ids=1,2,3,...
Auth: any authenticated user
```

- Parses `ids` query param (comma-separated integers, max 200).
- For each ID: calls `equipmentService.getById()`, generates QR via `QRCode.toDataURL()`.
- Skips items with no barcode (same behavior as single-label endpoint).
- Returns `{ labels: [{ asset_id, name, qr_data_url }] }`.

### Label Layout

Each label uses the same thermal CSS class structure as the single-label print. Labels are `display: block` with `page-break-inside: avoid` so the browser paginates them correctly on thermal stock.

---

## Files to Change

| File | Change |
|------|--------|
| `src/services/equipmentService.js` | Add unit-barcode fallback to `findByIdentifier()` |
| `src/routes/equipment.js` | Add `DELETE /bulk` and `GET /labels/bulk` endpoints |
| `public/js/app.js` | Add selection mode UI, action bar, bulk delete flow, bulk print flow |
| `public/index.html` | Add action bar HTML container if needed |

---

## Out of Scope

- Bulk checkout / check-in (not requested)
- Selection mode on Overdue or other views
- Persistent saved selections
- PDF download (user confirmed browser print dialog is sufficient)
