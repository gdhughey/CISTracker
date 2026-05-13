-- Add product_number column to equipment (model/part number, same across all units of an item)
ALTER TABLE equipment ADD COLUMN product_number TEXT NOT NULL DEFAULT '';
