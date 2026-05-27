# Model-Specific QR Codes for Equipment Groups

**Date:** 2026-05-19  
**Status:** Approved  
**Feature:** Per-model drawer QR labels within equipment groups

---

## Problem

The "CPUs" group (and others like "HP Compaq") contains multiple distinct models stored in separate physical drawers. Currently one group QR exists for the whole group — scanning it auto-picks any available unit regardless of model. Staff need to print a separate QR label per drawer (per model) so scanning a drawer's QR only offers units of that specific model.

---

## Decision

Use `product_number` as the model key. Name-stripping was rejected because the live data already has `"AMD FX4300"` and `"AMD FX 4300"` (same chip, different spelling) which would silently create duplicate model buckets. `product_number` is admin-curated, stable, and already in the schema.

Items with an empty `product_number` remain part of the whole-group scan — they are never invisible.

---

## Data Model

No schema changes. `product_number` on the `equipment` table is the model key.

**Admin workflow:** Edit each item in a group and set `product_number` to the canonical model name (e.g., `"Intel E5200"`, `"AMD FX 4300"`). This also normalizes spelling inconsistencies that already exist.

---

## QR Code Format

| Type | Encoded value | Example |
|------|--------------|---------|
| Whole-group (existing) | `GRP:{group_key}` | `GRP:CPUs` |
| Model-specific (new) | `GRPM:{group_key}::{product_number}` | `GRPM:CPUs::Intel E5200` |

Double-colon (`::`) separates group key from product number to avoid ambiguity with colons inside either value.

---

## Backend Changes

### 1. New endpoint — list models in a group

```
GET /api/equipment/group-models?key={group_key}
```

Returns distinct `product_number` values for items in the group that have a non-empty product number, plus counts.

**Response:**
```json
{
  "models": [
    { "product_number": "Intel E5200", "total": 16, "available": 10 },
    { "product_number": "AMD FX 4300", "total": 8,  "available": 5  }
  ],
  "unassigned": 3
}
```

`unassigned` = items in the group with empty `product_number` (informational, not an error).

Auth: same as `/group-label` — `requireRole(['admin','owner'])`.

### 2. Extend existing group-label endpoint

```
GET /api/equipment/group-label?key={group_key}&model={product_number}
```

When `model` query param is present, count members filtered by `product_number = model`. Encodes `GRPM:{group_key}::{product_number}` as the QR data. Returns the same shape as the existing response.

When `model` is absent, existing behavior is unchanged.

### 3. Extend lookup endpoint

Handle the `GRPM:` prefix in `GET /api/equipment/lookup?code=GRPM:CPUs::Intel+E5200`:

- Parse: split on first `::` → `groupKey = "CPUs"`, `productNumber = "Intel E5200"`
- Query: items where `group_key = groupKey AND product_number = productNumber`
- Return same JSON shape as `GRP:` lookup but with `group.model = productNumber` added
- 404 if no items match; 409 if none are available (same error pattern as GRP:)

---

## Frontend Changes

### Print flow — `printGroupQR(key)`

1. Fetch `GET /api/equipment/group-models?key={key}`
2. **If `models` is empty** (no items have a product_number): fall back to current behavior — generate and show single whole-group QR immediately.
3. **If `models` has entries**: show a picker modal with:
   - **Whole Group** row at top — availability count for all items, "Print QR" button (existing group QR)
   - Divider
   - One row per model — `product_number` label, `available / total` count, "Print QR" button
4. Clicking any "Print QR" button opens the existing QR preview modal (`printGroupQR` with model param, or existing whole-group path). Uses the `_pendingGroupPrint` variable pattern (no data in `onclick` attributes).

### Scan flow — `handleScannedCode` + `showGroupScanPicker`

When lookup returns a `GRPM:` code response, the backend returns `group.model = "Intel E5200"`. The frontend passes this to `showGroupScanPicker(resultDiv, groupKey, model)`:

- `showGroupScanPicker` gains an optional `model` parameter
- When set: filter `ITEMS` to `group_key === groupKey && item.product_number === model`
- When absent: existing behavior (all items in group), unchanged

### Label preview modal

Same UI as the current group QR modal. The label info line changes from `"Auto-pick next available"` to `"Model: {product_number} · Auto-pick next available"`.

---

## Error States

| Condition | Behavior |
|-----------|----------|
| Group has no items with product_number | No model picker shown; whole-group QR only |
| Scanned GRPM: code, group_key not found | 404 toast |
| Scanned GRPM: code, no available units of that model | 409 toast: "No available {model} in this group" |
| Item has product_number removed after QR was printed | Same 409 path — surfaced clearly |

---

## Out of Scope

- Editing `product_number` in bulk (admin edits items one at a time via existing edit form)
- Automatically detecting models from item names
- Any schema migration
