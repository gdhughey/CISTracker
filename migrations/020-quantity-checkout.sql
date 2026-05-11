-- Migration 020: quantity-aware checkout
-- Adds checked_out_count so bulk items track how many units are currently out
-- without locking the entire row when only some units are checked out.

ALTER TABLE equipment ADD COLUMN checked_out_count INTEGER NOT NULL DEFAULT 0;

-- Backfill: any existing checked_out row that is qty=1 already has count=1 implied;
-- for qty>1 rows that were previously flipped to checked_out, treat as all-out.
UPDATE equipment
SET checked_out_count = quantity
WHERE status = 'checked_out' AND quantity > 1;
