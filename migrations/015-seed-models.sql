-- Migration 015: create one model per distinct (name, category) group,
-- backfill model_id on equipment rows, backfill location_id from locations table.

-- Step 1: Insert a model for each distinct (name, trimmed-category) combo
INSERT OR IGNORE INTO models (name, category_id)
SELECT
  e.name,
  c.id
FROM (
  SELECT DISTINCT name, trim(category) AS category FROM equipment
) e
LEFT JOIN categories c ON lower(c.name) = lower(e.category);

-- Step 2: Backfill model_id on equipment rows
UPDATE equipment
SET model_id = (
  SELECT m.id FROM models m
  LEFT JOIN categories c ON c.id = m.category_id
  WHERE lower(m.name) = lower(equipment.name)
    AND (
      lower(coalesce(c.name,'')) = lower(trim(coalesce(equipment.category,'')))
      OR (trim(coalesce(equipment.category,'')) = '' AND m.category_id IS NULL)
    )
  LIMIT 1
)
WHERE model_id IS NULL;

-- Step 3: Backfill location_id from locations table (match by name)
UPDATE equipment
SET location_id = (
  SELECT l.id FROM locations l
  WHERE lower(l.name) = lower(trim(equipment.location))
  LIMIT 1
)
WHERE trim(coalesce(location,'')) != ''
  AND location_id IS NULL;
