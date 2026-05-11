-- Migration 011: add location_id FK to equipment (text field kept for compat)
ALTER TABLE equipment ADD COLUMN location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_location ON equipment(location_id);
