-- Add name column to equipment_units so individual units can have custom labels
ALTER TABLE equipment_units ADD COLUMN name TEXT NOT NULL DEFAULT '';
