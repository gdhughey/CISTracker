-- Migration 013: inventory audit sessions + entries
CREATE TABLE IF NOT EXISTS inventory_audits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at  TEXT
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id     INTEGER NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
  model_id     INTEGER REFERENCES models(id) ON DELETE SET NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  item_name    TEXT NOT NULL,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty  INTEGER NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entries_audit ON audit_entries(audit_id);
