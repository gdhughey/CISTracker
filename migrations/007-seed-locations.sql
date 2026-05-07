-- Migration 007: Seed the locations table from distinct equipment.location values
-- Uses INSERT OR IGNORE so re-running is safe and manually-added locations are preserved.

INSERT OR IGNORE INTO locations (name)
SELECT DISTINCT trim(location)
FROM equipment
WHERE trim(location) != '';
