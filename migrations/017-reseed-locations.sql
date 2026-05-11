-- Migration 017: Re-seed locations from equipment free-text location values.
-- Migration 007 ran before equipment data was imported so the table was left
-- empty. INSERT OR IGNORE preserves any manually-added locations.

INSERT OR IGNORE INTO locations (name)
SELECT DISTINCT trim(location)
FROM equipment
WHERE trim(location) != ''
  AND trim(location) NOT IN (SELECT name FROM locations);
