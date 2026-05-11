-- Migration 016: add quantity column to equipment for bulk/consumable items
-- quantity = 1 for individually tracked items (default)
-- quantity > 1 for bulk items after consolidation script runs
ALTER TABLE equipment ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;
