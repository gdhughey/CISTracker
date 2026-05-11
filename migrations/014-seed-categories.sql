-- Migration 014: seed categories from distinct equipment.category values
INSERT OR IGNORE INTO categories (name)
SELECT DISTINCT trim(category)
FROM equipment
WHERE trim(category) != '';
