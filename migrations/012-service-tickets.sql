-- Migration 012: service tickets (inventory change approval queue)
CREATE TABLE IF NOT EXISTS service_tickets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL CHECK(type IN ('add_item','quantity_change','other')),
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending','approved','rejected')),
  admin_notes  TEXT NOT NULL DEFAULT '',
  resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_svc_tickets_status ON service_tickets(status);
CREATE INDEX IF NOT EXISTS idx_svc_tickets_requester ON service_tickets(requested_by);
