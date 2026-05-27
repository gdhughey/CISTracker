-- Track which named group an item belongs to regardless of its display name.
-- Items created via the group panel get group_key set; items created standalone
-- keep group_key = '' and fall back to name-derived grouping.

ALTER TABLE equipment ADD COLUMN group_key TEXT NOT NULL DEFAULT '';
