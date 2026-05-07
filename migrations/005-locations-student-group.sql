-- Migration 005: locations table + student_group on users

-- Managed locations that can be assigned to equipment
CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  building    TEXT,
  room        TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Student group assignment for period-based access tracking
-- Values: am | pm | allday | none
ALTER TABLE users ADD COLUMN student_group TEXT NOT NULL DEFAULT 'none'
  CHECK(student_group IN ('am', 'pm', 'allday', 'none'));
