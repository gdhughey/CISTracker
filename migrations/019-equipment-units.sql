-- Migration 019: per-unit tracking for items with quantity > 1
-- equipment_units stores individual serial/barcode entries under a parent equipment row.
CREATE TABLE IF NOT EXISTS equipment_units (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id   INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  serial_number  TEXT    NOT NULL DEFAULT '',
  barcode        TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
