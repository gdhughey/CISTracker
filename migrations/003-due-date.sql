-- v3: Add due_date to equipment for checkout duration tracking
ALTER TABLE equipment ADD COLUMN due_date TEXT DEFAULT NULL;
