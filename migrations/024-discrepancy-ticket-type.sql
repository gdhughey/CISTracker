-- Migration 024: add inventory_discrepancy to service_tickets type CHECK constraint.
-- SQLite does not support ALTER TABLE … ADD CONSTRAINT, so we drop and recreate the table.
-- The table was also recreated in migration 023 (which was empty in practice), so this is safe.

CREATE TABLE IF NOT EXISTS service_tickets_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL CHECK(type IN ('add_item', 'quantity_change', 'other', 'inventory_discrepancy')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  payload      TEXT NOT NULL DEFAULT '{}',
  admin_notes  TEXT DEFAULT '',
  resolved_by  INTEGER REFERENCES users(id),
  resolved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO service_tickets_new SELECT * FROM service_tickets;

DROP TABLE service_tickets;

ALTER TABLE service_tickets_new RENAME TO service_tickets;
