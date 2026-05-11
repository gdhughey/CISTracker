-- Migration 010: equipment models table + model_id on equipment
CREATE TABLE IF NOT EXISTS models (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  image_path  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_models_category ON models(category_id);

ALTER TABLE equipment ADD COLUMN model_id INTEGER REFERENCES models(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_model ON equipment(model_id);
