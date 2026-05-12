# Live Refresh + Audit by Location — Design Spec
_Date: 2026-05-12_

---

## Overview

Two independent features:

1. **Live Refresh** — fix "page bugs out after sitting idle" by auto-refreshing data and handling session expiry gracefully.
2. **Audit by Location** — checklist audit groups items by location section (A) and supports scoping an audit to one location (B).

---

## Feature 1: Live Refresh

### Problem
After sitting on the page for a while, inventory data goes stale and CSRF token drift causes silent API failures. Users see outdated availability counts and checkout states.

### Solution: Tab-visibility + periodic poll

**Mechanism:**
- `visibilitychange` listener: when the tab becomes visible (user returns to it), refresh the data for the current view.
- 90-second `setInterval` while the tab is active: refresh current view data in the background.
- 401 handler: if any API call returns 401, redirect to `/` (session expired → re-login).

**Refresh scope per view:**
| View | Refresh action |
|------|---------------|
| `inventory` | `loadItems()` |
| `inv-audit` | `loadAuditView()` |
| `service` | `loadSvcTickets()` |
| `tickets` | `loadTickets()` |
| `audit` | `loadAudit()` |
| `users` | `loadUsers()` |
| `locations` | `loadLocations()` |

**Implementation details:**
- Track `let _refreshInterval = null` and `let _currentView = null`.
- On view switch: clear old interval, set `_currentView`, start new interval calling the view's refresh function.
- `visibilitychange`: if `document.visibilityState === 'visible'`, call the current view's refresh.
- Modify `api()`: if response status is 401, `window.location.href = '/'`.
- Interval only runs while tab is visible (pause on hidden, resume on visible) to avoid wasted polls.

---

## Feature 2: Checklist Audit by Location

### A — Grouped view (location section headers in checklist)

Checklist rows are organized under collapsible/static location section headers. Items with no location appear under an "Unassigned" section at the bottom.

**Location filter chips** (new row above status chips):
- "All Locations" (default), then one chip per distinct location in the audit
- Selecting a location chip scrolls to that section and filters the list to that location only
- Location chips + status chips work together (AND filter)

**Rendering:**
- `renderClRows()` groups entries by `location_name` (sorted alphabetically, nulls last)
- Each group renders a `<div class="cl-location-header">` before its rows
- Header shows location name + item count for that section

### B — Scoped audit (audit locked to one location)

**Start Audit modal** gains a location picker:
- Optional `<select>` — "All Locations (default)" + one option per managed location
- If a location is selected, the audit is scoped: only items from that location are populated
- Scope is stored on the audit record (`scope_location_id`)
- Audit header shows "Scoped to: Room 101" badge when scoped

### Backend changes

**Migration 019:**
```sql
ALTER TABLE audit_entries ADD COLUMN location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE inventory_audits ADD COLUMN scope_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
```

**`populate(auditId, locationId?)`:**
- Joins `equipment` → `locations` to get `location_id` per item
- When `locationId` is provided, adds `WHERE e.location_id = ?` filter
- Stores `location_id` on each inserted `audit_entries` row

**`getEntries(auditId)`:**
- Joins `locations` to return `location_name` alongside each entry

**Route `POST /:id/populate`:**
- Accepts optional `location_id` in request body, passes to `populate()`

**Route `POST /`:**
- Accepts optional `scope_location_id` in request body, stores on audit

---

## Data Flow

```
Start Audit (optional location) → POST /api/inventory-audit {type:'checklist', scope_location_id?}
→ POST /api/inventory-audit/:id/populate {location_id?}
→ audit_entries rows include location_id
→ GET /api/inventory-audit/:id returns entries with location_name
→ renderChecklistAudit() groups by location_name
→ location chips + status chips filter the view
```

---

## Out of Scope
- Real-time multi-user sync (WebSocket)
- Audit history diff view
- Exporting audit to CSV

---

## Files Changed

| File | Change |
|------|--------|
| `migrations/019-audit-location.sql` | New migration |
| `src/services/inventoryAuditService.js` | populate + getEntries updates |
| `src/routes/inventoryAudit.js` | Accept scope_location_id + location_id params |
| `public/js/app.js` | Live refresh logic, audit modal, renderChecklistAudit, renderClRows |
