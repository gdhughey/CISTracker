-- Migration 023: recreate equipment, equipment_units, checkout_log,
-- equipment_queue, and locations tables dropped in migration 022.
-- All tables start empty (fresh start).

CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  building    TEXT,
  room        TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  type              TEXT DEFAULT '',
  serial_number     TEXT DEFAULT '',
  barcode           TEXT DEFAULT '',
  category          TEXT DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','checked_out')),
  checked_out_by    INTEGER REFERENCES users(id),
  checked_out_at    TEXT,
  due_date          TEXT,
  image_path        TEXT,
  notes             TEXT DEFAULT '',
  location          TEXT DEFAULT '',
  location_id       INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  checked_out_count INTEGER NOT NULL DEFAULT 0,
  model_id          INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_status   ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_barcode  ON equipment(barcode);
CREATE INDEX IF NOT EXISTS idx_equipment_serial   ON equipment(serial_number);
CREATE INDEX IF NOT EXISTS idx_equipment_location ON equipment(location_id);

CREATE TABLE IF NOT EXISTS equipment_units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL DEFAULT '',
  barcode       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkout_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  action       TEXT NOT NULL CHECK(action IN ('checkout','checkin')),
  performed_by INTEGER NOT NULL REFERENCES users(id),
  checkout_user TEXT NOT NULL,
  notes        TEXT DEFAULT '',
  source       TEXT DEFAULT 'Manual',
  image_path   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkout_log_equipment ON checkout_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_checkout_log_user      ON checkout_log(performed_by);
CREATE INDEX IF NOT EXISTS idx_checkout_log_created   ON checkout_log(created_at);

CREATE TABLE IF NOT EXISTS equipment_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  notified     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(equipment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_equipment ON equipment_queue(equipment_id, position);
CREATE INDEX IF NOT EXISTS idx_queue_user      ON equipment_queue(user_id);
